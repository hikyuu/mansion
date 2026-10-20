-- 2026-10-20 hentai_gallery 写路径收口：撤销直连 INSERT/UPDATE，改由 SECURITY DEFINER 承担
--
-- Advisor 报出的两条（0024 permissive RLS policy / "allows unrestricted access"）：
--   1. "gallery catalog creatable by authenticated"        INSERT  with check (true)
--   2. "gallery catalog gid refreshable by authenticated"  UPDATE  using (true) with check (true)
--
-- 根因（不是策略写懒了，是权限模型错位）：
--   upsert_hentai_archive 是 SECURITY INVOKER，函数内的 insert/update 用的是调用者
--   (authenticated) 的权限，因此必须给 authenticated 开整张表的 INSERT/UPDATE，策略也只能恒真。
--   结果是「为了让 RPC 能写，整张表对 authenticated 敞开」—— 谁都能绕过 RPC，
--   直连 PostgREST 往共享目录里插任意行、改任意行的 gid。
--
-- 修复思路：把权限从「表」下移到「函数」
--   1. 真正的写入逻辑搬进 private schema 的 SECURITY DEFINER 函数；
--      private 不在 config.toml 的 api.schemas 里，PostgREST 不暴露，没有 REST 端点；
--   2. 函数自带授权判定：auth.uid() 为空直接拒绝，user_id 一律取 auth.uid()，
--      不接受外部传入 —— 这是必须的，因为 SECURITY DEFINER 以 owner 身份运行会绕过 RLS，
--      策略在这个函数里完全不生效，唯一的门禁就是函数体自己；
--   3. public.upsert_hentai_archive 保留同名同签名，改成 SECURITY INVOKER 薄壳，
--      前端 supabase.rpc(...) 零改动；EXECUTE 只授给 authenticated
--      （Postgres 默认给 PUBLIC 授 EXECUTE，必须显式收回，否则 anon 也能调）；
--   4. 删掉两条恒真写策略 + 收回表的 INSERT/UPDATE 授权 → 直连写路径彻底关闭。
--   5. 顺带解锁：ON CONFLICT 的冲突行可见性与回读 join 都在 definer 内完成，
--      不再依赖调用者的 SELECT 可见性（如需收紧 SELECT，见附录 A）。
--
-- 保持不变：SELECT 策略与授权（security_invoker 视图 hentai_archive 的 join 依赖）、
--           身份不可变触发器、delete 无策略且无授权。
--
-- 执行身份：表 owner（Supabase Dashboard SQL Editor 即 postgres）。
--   注意：不要对该表 force row level security —— definer 以 owner 身份写入，会被自己的 RLS 挡住。
-- 验证：执行完跑 20261020-02-gallery-write-path-test.sql。
-- 回滚：见文件末尾。

begin;

-- ---------------------------------------------------------------- 1. 私有 schema
-- 只做「函数容器」：不进 api.schemas，不带 REST 端点。
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- 2. 写入实现（SECURITY DEFINER）
-- search_path 置空 + 全限定名：防止调用方用 search_path 劫持函数内解析到的对象。
create or replace function private.upsert_hentai_archive(
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
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_hash       varchar(64);
  v_gallery_id bigint;
begin
  -- 门禁 1：必须已登录。匿名登录关闭时 auth.uid() 为空，直接拒绝；
  -- 将来若开启匿名登录，认证过的匿名用户仍然拿到自己的 uid，写入语义不变（只写自己的事件）。
  if v_uid is null then
    raise exception '未登录：缺少有效的 auth.uid()' using errcode = '28000';
  end if;

  -- 门禁 2：入参校验。title_hash 由库侧从 title 派生，调用方无法指定任意 hash。
  if p_title is null or btrim(p_title) = '' then
    raise exception 'title 不能为空' using errcode = '22023';
  end if;
  if length(p_title) > 255 then
    raise exception 'title 超长：% 字符（上限 255）', length(p_title) using errcode = '22001';
  end if;
  if p_gid is null then
    raise exception 'gid 不能为空' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'date 不能为空' using errcode = '22023';
  end if;
  if p_status is null or p_status not in (200, 304, 400) then
    raise exception 'status 非法：%（只允许 200/304/400）', p_status using errcode = '22023';
  end if;

  -- 与前端 sha256Hex(title) 等价的派生逻辑
  v_hash := encode(sha256(convert_to(p_title, 'UTF8')), 'hex');

  -- 共享目录：冲突目标是全局唯一的 title_hash。
  -- 身份由内容寻址决定且落库后不可变（见 hentai_gallery_assert_identity_immutable 触发器），
  -- 故冲突更新只刷新 gid/updated_time，绝不重写 title/title_hash。
  -- p_gid 语义为「任意用户最近一次见到的值」(last-writer-wins)，仅作追溯元数据。
  insert into public.hentai_gallery as gal (title, title_hash, gid)
  values (p_title, v_hash, p_gid)
  on conflict on constraint hentai_gallery_title_hash_unique do update
    set gid          = excluded.gid,
        updated_time = now()
  returning gal.id into v_gallery_id;

  -- 事件归属只取 auth.uid()：不接受调用方传入，杜绝替别人写事件。
  -- 这里 definer 会绕过 hentai_archive_event 的 RLS，所以 user_id 必须显式写死为 v_uid。
  return query
  with up as (
    insert into public.hentai_archive_event as ev (user_id, gallery_id, status, watermark_date)
    values (v_uid, v_gallery_id, p_status, p_date)
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

comment on function private.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  is '归档写入唯一实现（SECURITY DEFINER，不可经 REST 调用）：自带 auth.uid() 门禁，user_id 不可伪造';

revoke all on function private.upsert_hentai_archive(bigint, text, timestamptz, bigint) from public, anon;
grant execute on function private.upsert_hentai_archive(bigint, text, timestamptz, bigint) to authenticated;

-- ---------------------------------------------------------------- 3. 对外 RPC：薄壳（SECURITY INVOKER）
-- 签名、返回列、返回行数与旧版完全一致，前端 supabase.rpc('upsert_hentai_archive', ...) 无需改动。
-- 薄壳本身不持有额外权限：即使将来误把 EXECUTE 授给 anon，anon 也会在调用 impl 时被权限拒掉。
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
language sql
security invoker
set search_path = ''
as $$
  select * from private.upsert_hentai_archive(p_gid, p_title, p_date, p_status);
$$;

comment on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  is '归档写入唯一入口（薄壳）：只读调用 private 实现，写权限不落在调用者身上';

revoke all on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  to authenticated;

-- ---------------------------------------------------------------- 4. 关掉直连写路径
-- 4a. 两条恒真写策略不再需要（写入已不经过调用者的表权限）；策略留着只会误导后人和 Advisor。
drop policy if exists "gallery catalog creatable by authenticated"   on public.hentai_gallery;
drop policy if exists "gallery catalog gid refreshable by authenticated" on public.hentai_gallery;

-- 4b. 收回表级写授权：PostgREST 的 insert/update 在权限检查阶段就被拒（42501），
--     不依赖 RLS —— 策略与授权两层同时失效，才叫真正关死。
revoke insert, update on public.hentai_gallery from authenticated, anon;
revoke delete on public.hentai_gallery from authenticated, anon;

-- 4c. SELECT 保留：security_invoker 视图 hentai_archive 的 join 需要它。
--     using (true) 是有意的 —— 本表只存全局共享的 title/title_hash/gid，不含任何用户数据。
--     若不想让 authenticated 枚举全站标题，见附录 A（现在收紧已经安全，不再打断 RPC）。
grant select on public.hentai_gallery to authenticated;

comment on policy "gallery catalog readable by authenticated" on public.hentai_gallery
  is '只读共享目录：表内无用户数据，写入必须走 upsert_hentai_archive；无 INSERT/UPDATE/DELETE 策略';

-- ---------------------------------------------------------------- 5. 断言
do $$
declare
  v_policies text;
begin
  -- 策略：只剩 SELECT
  select string_agg(cmd, ',' order by cmd) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'hentai_gallery';
  if v_policies is distinct from 'SELECT' then
    raise exception 'hentai_gallery 策略应只剩 SELECT，实际：%', coalesce(v_policies, 'none');
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.hentai_gallery'::regclass) then
    raise exception 'hentai_gallery 未启用 RLS';
  end if;

  -- 授权：authenticated 只读
  if has_table_privilege('authenticated', 'public.hentai_gallery', 'insert') then
    raise exception 'authenticated 仍持有 hentai_gallery 的 INSERT 权限';
  end if;
  if has_table_privilege('authenticated', 'public.hentai_gallery', 'update') then
    raise exception 'authenticated 仍持有 hentai_gallery 的 UPDATE 权限';
  end if;
  if has_table_privilege('authenticated', 'public.hentai_gallery', 'delete') then
    raise exception 'authenticated 仍持有 hentai_gallery 的 DELETE 权限';
  end if;
  if not has_table_privilege('authenticated', 'public.hentai_gallery', 'select') then
    raise exception 'authenticated 缺少 hentai_gallery 的 SELECT 权限（视图会失效）';
  end if;
  if has_table_privilege('anon', 'public.hentai_gallery', 'insert')
     or has_table_privilege('anon', 'public.hentai_gallery', 'update')
     or has_table_privilege('anon', 'public.hentai_gallery', 'delete') then
    raise exception 'anon 仍持有 hentai_gallery 的写权限';
  end if;

  -- 函数安全属性：外壳 invoker / 实现 definer，且都钉了 search_path
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'upsert_hentai_archive') then
    raise exception 'public 外壳不应是 SECURITY DEFINER';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'upsert_hentai_archive') then
    raise exception 'private 实现必须是 SECURITY DEFINER';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.proname = 'upsert_hentai_archive'
                and not (array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path=%')) then
    raise exception '写入函数未固定 search_path';
  end if;

  -- 执行权限
  if has_function_privilege('anon', 'public.upsert_hentai_archive(bigint,text,timestamptz,bigint)', 'execute') then
    raise exception 'anon 仍可执行 upsert_hentai_archive';
  end if;
  if not has_function_privilege('authenticated', 'public.upsert_hentai_archive(bigint,text,timestamptz,bigint)', 'execute') then
    raise exception 'authenticated 无法执行 upsert_hentai_archive';
  end if;
  if has_function_privilege('anon', 'private.upsert_hentai_archive(bigint,text,timestamptz,bigint)', 'execute') then
    raise exception 'anon 仍可执行 private 实现';
  end if;

  -- 既有不变量：身份不可变触发器仍在
  if not exists (select 1 from pg_trigger tg
                  join pg_class t on t.oid = tg.tgrelid
                 where t.relname = 'hentai_gallery'
                   and tg.tgname = 'hentai_gallery_assert_identity_immutable') then
    raise exception '缺少身份不可变触发器';
  end if;

  if exists (select 1 from public.hentai_archive_event e
              left join public.hentai_gallery g on g.id = e.gallery_id
              where g.id is null) then
    raise exception '存在未关联画廊的归档事件';
  end if;

  raise notice '写路径收口完成：authenticated 对 hentai_gallery 只读，写入经 private 实现';
end $$;

-- ---------------------------------------------------------------- 6. 让 PostgREST 重新加载
notify pgrst, 'reload schema';

commit;

-- ================================================================
-- 附录 A：收紧 SELECT（独立文件 20261020-03-gallery-select-tighten.sql）
--
-- 20260923-10 的探针结论是「收紧 SELECT 会打断 RPC」，那是在 INVOKER 写入下的限制。
-- 现在 ON CONFLICT 与回读 join 都在 definer 内完成，不再看调用者的可见性，收紧已经安全：
--   - security_invoker 视图 hentai_archive 只读自己事件的 joined 行，不受影响；
--   - 前端从不直连 hentai_gallery（见 src/dao/hentai-archive.ts，只查 hentai_archive）。
--
-- 收紧后 authenticated 直连 `select * from hentai_gallery` 只能看到自己有过事件的画廊；
--   归档写入、视图读取、判重全部照旧。跑 20261020-02 的用例可一并验证。
-- ================================================================
-- 回滚（需 owner）
--   drop function if exists public.upsert_hentai_archive(bigint, text, timestamptz, bigint);
--   drop function if exists private.upsert_hentai_archive(bigint, text, timestamptz, bigint);
--   grant insert, update on public.hentai_gallery to authenticated;
--   create policy "gallery catalog creatable by authenticated" on public.hentai_gallery
--     for insert to authenticated with check (true);
--   create policy "gallery catalog gid refreshable by authenticated" on public.hentai_gallery
--     for update to authenticated using (true) with check (true);
--   -- 再把 20260923-08 第 7 步的 RPC 版本原样 create or replace 回来（p_ 参数同名同签名）
-- ================================================================
