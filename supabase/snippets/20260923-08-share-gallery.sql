-- 2026-09-23 hentai_gallery 全局化：画廊共用 title_hash，归属只留在 hentai_archive_event
--
-- 目标：
--   1. hentai_gallery 由「每用户一份」改为「每 title_hash 一行」的全局目录
--   2. 去掉 gallery.user_id —— 它同时是 auth.users 上的 on delete cascade 源头，
--      共享后会顺着 gallery → event 的级联链删掉别人的事件
--   3. event.gallery_id 外键 cascade → restrict，杜绝一次删除清空全站事件
--   4. RLS 从「归属可见」改为「共享目录」：select/insert/update 放开，delete 一律不给
--   5. 新增身份不可变守卫：title/title_hash 落库后不可改，冲突更新只允许刷新 gid/updated_time
--
-- 前置：先执行 20260923-07-precheck-share-gallery.sql 并确认 will_delete_rows / event_needs_rewire 符合预期。
-- 执行身份：必须用表 owner（Supabase Dashboard SQL Editor 即 postgres）。
--           第 1 步需要绕过 RLS 重挂 event.gallery_id；表 owner 默认绕过 RLS，无需 BYPASSRLS。
-- 前端影响：无。视图列名与 RPC 签名均不变（user_id 本来就取自事件表）。
-- 回滚：本迁移在单事务内，任一断言失败自动整体回滚；已提交后的手工回退见文件末尾说明。

begin;

-- ---------------------------------------------------------------- 0. 快照（行数守恒断言用）
create temp table _mig_gallery_snapshot on commit drop as
select (select count(*) from public.hentai_gallery)                   as gallery_cnt,
       (select count(distinct title_hash) from public.hentai_gallery) as hash_cnt,
       (select count(*) from public.hentai_archive_event)             as event_cnt,
       (select count(*) from public.hentai_archive)                   as view_cnt;

-- ---------------------------------------------------------------- 1. 存量归一：同 title_hash 保留 min(id) 为规范行
create temp table _mig_gallery_map on commit drop as
select g.id                                                 as old_id,
       min(g.id) over (partition by g.title_hash)            as keep_id,
       min(g.created_time) over (partition by g.title_hash)  as min_created,
       max(g.updated_time) over (partition by g.title_hash)  as max_updated
from public.hentai_gallery g;

-- 1a. 规范行的时间范围扩到合并前并集（纯元数据，当前无业务读取，保持语义完整）
update public.hentai_gallery g
   set created_time = m.min_created,
       updated_time = m.max_updated
  from (select distinct keep_id, min_created, max_updated from _mig_gallery_map) m
 where g.id = m.keep_id;

-- 1b. 事件重挂到规范行（同用户同 title_hash 本来只有一行画廊，因此不会撞
--     hentai_archive_event_user_id_gallery_id_status_unique）
update public.hentai_archive_event e
   set gallery_id = m.keep_id
  from _mig_gallery_map m
 where e.gallery_id = m.old_id
   and m.old_id <> m.keep_id;

-- 1c. 删除被合并掉的画廊行（此时已无事件引用）
delete from public.hentai_gallery g
using _mig_gallery_map m
where g.id = m.old_id
  and m.old_id <> m.keep_id;

-- ---------------------------------------------------------------- 2. 去掉 user_id，唯一键降为 title_hash
-- 必须先删掉引用 user_id 的旧策略：RLS 策略会构成列依赖，否则 drop column 报
-- 「cannot drop column user_id ... because other objects depend on it」
drop policy if exists "Enable users to crud their own data only" on public.hentai_gallery;

alter table public.hentai_gallery
  drop constraint if exists hentai_gallery_user_id_title_hash_unique;

-- 该列同时带走 default auth.uid() 与指向 auth.users 的外键
alter table public.hentai_gallery
  drop column user_id;

alter table public.hentai_gallery
  add constraint hentai_gallery_title_hash_unique unique (title_hash);

-- ---------------------------------------------------------------- 3. 外键级联改为 restrict
-- 用动态查找而不是硬编码约束名，避免名字不符时静默保留 cascade
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'hentai_archive_event'
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%gallery_id%'
  limit 1;

  if v_name is not null then
    execute format('alter table public.hentai_archive_event drop constraint %I', v_name);
  end if;
end $$;

alter table public.hentai_archive_event
  add constraint hentai_archive_event_gallery_id_fkey
  foreign key (gallery_id) references public.hentai_gallery (id) on delete restrict;

-- ---------------------------------------------------------------- 4. 身份不可变守卫
-- 共享目录下 UPDATE 必然要向所有登录用户放开（否则 RPC 的 ON CONFLICT DO UPDATE 走不通）。
-- 放开后最危险的不是「改自己的行」，而是「把别人事件指向的那行改成另一个标题」——
-- title/title_hash 一旦可变，他人的归档会静默变成另一个画廊。故落库后锁死身份，只留 gid/updated_time 可变。
create or replace function public.hentai_gallery_assert_identity_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.title is distinct from old.title or new.title_hash is distinct from old.title_hash then
    raise exception 'hentai_gallery 身份不可变：title/title_hash 已存在（hash=%）', left(old.title_hash, 16);
  end if;
  return new;
end;
$$;

comment on function public.hentai_gallery_assert_identity_immutable()
  is '共享目录守卫：title/title_hash 为内容寻址身份，落库后不可变更';

drop trigger if exists hentai_gallery_assert_identity_immutable on public.hentai_gallery;
create trigger hentai_gallery_assert_identity_immutable
  before update on public.hentai_gallery
  for each row execute function public.hentai_gallery_assert_identity_immutable();

-- ---------------------------------------------------------------- 5. RLS：共享目录模型
alter table public.hentai_gallery enable row level security;

create policy "gallery catalog readable by authenticated" on public.hentai_gallery
  for select to authenticated using (true);

create policy "gallery catalog creatable by authenticated" on public.hentai_gallery
  for insert to authenticated with check (true);

create policy "gallery catalog gid refreshable by authenticated" on public.hentai_gallery
  for update to authenticated using (true) with check (true);

-- delete 不建任何策略：RLS 默认拒绝。共享目录下删除会级联清空所有用户的事件，
-- 因此连表 owner 之外的一切角色都不该有这条路径（孤儿行清理另建维护函数处理）。

-- 注意（已知代价）：select 放开后，直连 /rest/v1/hentai_gallery 可枚举系统内
-- 所有被归档过的标题。这是「把 title/title_hash 移出事件表并跨用户共享」的结构性代价——
-- 兼容视图是 security_invoker，调用方必须持有 gallery 的 SELECT 权限，无法靠策略收紧规避。
-- 若这个枚举面不可接受，应放弃共享模型（保持每用户一份），而不是收紧 SELECT：
-- 收紧会同时打断 RPC（见 20260923-10-rls-conflict-probe.sql）。

-- ---------------------------------------------------------------- 6. 授权：收回 delete
revoke delete on public.hentai_gallery from authenticated;
grant select, insert, update on public.hentai_gallery to authenticated;

-- ---------------------------------------------------------------- 7. 写入 RPC
create or replace function public.upsert_hentai_archive(
  p_gid    bigint,
  p_title  text,
  p_date   timestamptz,
  p_status bigint
)
returns table (
  id             bigint,
  user_id        uuid,
  gallery_id     bigint,
  status         bigint,
  watermark_date timestamptz,
  updated_time   timestamptz,
  gid            bigint,
  title          varchar(255),
  title_hash     varchar(64)
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hash       varchar(64);
  v_gallery_id bigint;
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'title 不能为空';
  end if;

  -- 与前端 sha256Hex(title) 等价的派生逻辑
  v_hash := encode(sha256(convert_to(p_title, 'UTF8')), 'hex');

  -- 共享目录：冲突目标是全局唯一的 title_hash，不再是 (user_id, title_hash)。
  -- 身份由内容寻址决定且落库后不可变（见第 4 步触发器），故冲突更新只刷新 gid/updated_time，
  -- 绝不重写 title/title_hash —— 那会把别人事件指向的画廊改头换面。
  -- p_gid 仍是「最近一次见到的 gid」，共享后语义变为「任意用户最近一次见到的值」(last-writer-wins)。
  -- 注：output 参数名与列名同名，故 ON CONFLICT 必须用约束名且列引用一律用表别名限定，避免 42702。
  insert into public.hentai_gallery as gal (title, title_hash, gid)
  values (p_title, v_hash, p_gid)
  on conflict on constraint hentai_gallery_title_hash_unique do update
    set gid          = excluded.gid,
        updated_time = now()
  returning gal.id into v_gallery_id;

  return query
  with up as (
    insert into public.hentai_archive_event as ev (gallery_id, status, watermark_date)
    values (v_gallery_id, p_status, p_date)
    on conflict on constraint hentai_archive_event_user_id_gallery_id_status_unique do update
      set watermark_date = excluded.watermark_date,
          updated_time   = now()
    returning ev.*
  )
  select up.id, up.user_id, up.gallery_id, up.status, up.watermark_date, up.updated_time,
         g.gid, g.title, g.title_hash
  from up
  join public.hentai_gallery g on g.id = up.gallery_id;
end;
$$;

comment on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  is '归档写入唯一入口：原子 upsert 共享画廊 + 事件，返回与旧 DTO 等价的字段';

grant execute on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint) to authenticated;

-- 视图无需重建：它只读 g.gid / g.title / g.title_hash，不引用 g.user_id（user_id 取自事件表）。

-- ---------------------------------------------------------------- 8. 断言
do $$
declare
  s         record;
  v_gallery int;
  v_event   int;
  v_view    int;
  v_orphan  int;
begin
  select * into s from _mig_gallery_snapshot;

  select count(*) into v_gallery from public.hentai_gallery;
  select count(*) into v_event from public.hentai_archive_event;
  select count(*) into v_view from public.hentai_archive;

  if v_gallery <> s.hash_cnt then
    raise exception '画廊行数应等于原去重 title_hash 数 %，实际 %', s.hash_cnt, v_gallery;
  end if;
  if exists (select 1 from (select title_hash from public.hentai_gallery group by 1 having count(*) > 1) x) then
    raise exception 'title_hash 仍有重复';
  end if;
  if v_event <> s.event_cnt then
    raise exception '归档事件丢失：原 % / 现 %', s.event_cnt, v_event;
  end if;
  if v_view <> s.view_cnt then
    raise exception '视图行数变化：原 % / 现 %', s.view_cnt, v_view;
  end if;

  select count(*) into v_orphan
  from public.hentai_archive_event e
  left join public.hentai_gallery g on g.id = e.gallery_id
  where g.id is null;
  if v_orphan > 0 then
    raise exception '存在未关联画廊的归档事件：%', v_orphan;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'hentai_gallery' and column_name = 'user_id') then
    raise exception 'hentai_gallery.user_id 仍然存在';
  end if;
  if not exists (select 1 from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                 where t.relname = 'hentai_gallery' and c.conname = 'hentai_gallery_title_hash_unique') then
    raise exception '缺少 hentai_gallery_title_hash_unique 约束';
  end if;
  if exists (select 1 from pg_constraint c
              join pg_class t on t.oid = c.conrelid
             where t.relname = 'hentai_archive_event' and c.contype = 'f'
               and pg_get_constraintdef(c.oid) ilike '%gallery_id%'
               and c.confdeltype = 'c') then
    raise exception 'gallery_id 外键仍为 on delete cascade';
  end if;

  if has_table_privilege('authenticated', 'public.hentai_gallery', 'delete') then
    raise exception 'authenticated 仍持有 hentai_gallery 的 delete 权限';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'hentai_gallery' and cmd = 'DELETE') then
    raise exception 'hentai_gallery 仍存在 DELETE 策略';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'hentai_gallery' and cmd = 'SELECT') then
    raise exception 'hentai_gallery 缺少 SELECT 策略（RPC 的冲突更新与回读会失效）';
  end if;
  if not (select relrowsecurity from pg_class where relname = 'hentai_gallery') then
    raise exception 'hentai_gallery 未启用 RLS';
  end if;
  if not exists (select 1 from pg_trigger tg
                  join pg_class t on t.oid = tg.tgrelid
                 where t.relname = 'hentai_gallery'
                   and tg.tgname = 'hentai_gallery_assert_identity_immutable') then
    raise exception '缺少身份不可变触发器';
  end if;

  raise notice '共享目录迁移校验通过：画廊 % 行 / 事件 % 行 / 视图 % 行', v_gallery, v_event, v_view;
end $$;

-- ---------------------------------------------------------------- 9. 让 PostgREST 重新加载 schema
notify pgrst, 'reload schema';

commit;

-- ================================================================
-- 迁移后请执行：20260923-09-verify-shared-gallery.sql
-- 若考虑收紧 SELECT 策略，先执行：20260923-10-rls-conflict-probe.sql
--
-- 回滚说明
--   1) 事务内：任一断言失败已自动整体回滚，无需人工干预。
--   2) 已提交后手工回退（需 owner 身份，且不可完全逆）：
--      a. alter table public.hentai_gallery add column user_id uuid;
--      b. update public.hentai_gallery g set user_id = e.user_id
--           from public.hentai_archive_event e where e.gallery_id = g.id;
--         -- 共享行已被多个用户的事件引用，只能取到其中一个，原始归属关系不可逆
--      c. alter table public.hentai_gallery
--           alter column user_id set not null,
--           alter column user_id set default auth.uid(),
--           add constraint hentai_gallery_user_id_fkey foreign key (user_id)
--             references auth.users (id) on delete cascade,
--           drop constraint hentai_gallery_title_hash_unique,
--           add constraint hentai_gallery_user_id_title_hash_unique unique (user_id, title_hash);
--      d. 重建 RLS 策略为 auth.uid() = user_id（select/insert/update/delete），
--         grant select, insert, update, delete on public.hentai_gallery to authenticated;
--      e. event.gallery_id 外键改回 on delete cascade；
--         drop trigger hentai_gallery_assert_identity_immutable on public.hentai_gallery;
--      f. 用 20260918-06-hash-guard.sql 的 RPC 版本覆盖回来（冲突目标换回旧约束名）。
--   3) 被合并掉的画廊行（will_delete_rows）已物理删除，其 gid/updated_time 不可还原。
--      需要完整回退能力时，请在迁移前对 public.hentai_gallery 单独做一次表级备份。
-- ================================================================
