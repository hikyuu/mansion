-- 2026-10-20 写路径收口回归测试（事务内执行，结束整体回滚，不留数据、不留策略改动）
--
-- 覆盖 20261020-01-gallery-write-path-definer.sql 必须成立的四条：
--   1. authenticated 直连 hentai_gallery 的 INSERT/UPDATE 必须被拒（42501，权限层）
--   2. RPC 仍可用：插入路径 / ON CONFLICT 更新路径都返回恰好 1 行，前端零感知
--   3. 事件归属只认 auth.uid()：user_id 不可伪造，画廊按 title_hash 全局唯一
--   4. anon 不能调写 RPC（Postgres 默认给 PUBLIC 授 EXECUTE，这是最容易漏的一步）
--
-- 本文件取代 20260923-11-gallery-guard-test.sql：那一版直接以 authenticated 身份
-- insert/update hentai_gallery，收口后必然失败 —— 失败本身就是新模型的预期。
--
-- 任一断言失败即抛异常中断并回滚；全部通过输出 write_path_ok。

begin;

-- 取一个真实用户：hentai_archive_event.user_id 有指向 auth.users 的外键
select set_config(
         'request.jwt.claims',
         (select json_build_object('sub', u.id::text, 'role', 'authenticated')::text
            from auth.users u order by u.id limit 1),
         true
       ) as jwt_claims;

set local role authenticated;

do $$
declare
  v_uid      uuid := auth.uid();
  v_hash     varchar(64) := encode(sha256(convert_to('__fix_probe__', 'UTF8')), 'hex');
  v_n        int;
  v_gid      bigint;
  v_gal      bigint;
  v_title    text;
  v_hash_out text;
  v_uid_out  text;
  v_wm       timestamptz;
begin
  if v_uid is null then
    raise exception '前置失败：request.jwt.claims 未生效（auth.users 是否为空？）';
  end if;

  -- 1a) 直连 INSERT：权限层必须拒绝
  begin
    insert into public.hentai_gallery (title, title_hash, gid)
    values ('__fix_probe__', v_hash, 1);
    raise exception '__fail__ 直连 INSERT 未被拒：写路径仍可绕过 RPC';
  exception when insufficient_privilege then
    raise notice '直连 INSERT 已被拒（insufficient_privilege）';
  end;

  -- 1b) 直连 UPDATE gid：权限层必须拒绝
  begin
    update public.hentai_gallery set gid = 2 where title_hash = v_hash;
    raise exception '__fail__ 直连 UPDATE 未被拒：gid 仍可被任意改写';
  exception when insufficient_privilege then
    raise notice '直连 UPDATE 已被拒（insufficient_privilege）';
  end;

  -- 1c) 直连 DELETE：仍必须无路径
  begin
    delete from public.hentai_gallery where title_hash = v_hash;
    raise exception '__fail__ DELETE 未被拒：共享目录可被删除';
  exception when insufficient_privilege then
    raise notice '直连 DELETE 已被拒（insufficient_privilege）';
  end;

  -- 2a) RPC 插入路径：恰好 1 行，归属 = 当前用户，hash 由库侧派生
  select count(*), max(r.gid), max(r.user_id::text), max(r.title), max(r.title_hash)
    into v_n, v_gid, v_uid_out, v_title, v_hash_out
    from public.upsert_hentai_archive(111111, '__fix_probe__', '2026-01-01T00:00:00Z', 200) r;
  if v_n <> 1 then
    raise exception '__fail__ RPC 插入路径返回 % 行（应为 1）', v_n;
  end if;
  if v_uid_out <> v_uid::text then
    raise exception '__fail__ 事件归属不是当前用户：%', v_uid_out;
  end if;
  if v_hash_out <> v_hash then
    raise exception '__fail__ 返回的 title_hash 与库侧派生不一致：%', v_hash_out;
  end if;
  if v_title <> '__fix_probe__' then
    raise exception '__fail__ 返回的 title 不一致：%', v_title;
  end if;

  select count(*), max(g.gid), max(g.title), min(g.id)
    into v_n, v_gid, v_title, v_gal
    from public.hentai_gallery g
   where g.title_hash = v_hash;
  if v_n <> 1 then
    raise exception '__fail__ 画廊行数应唯一，实际 %', v_n;
  end if;
  if v_gid <> 111111 then
    raise exception '__fail__ 画廊 gid 未写入：%', v_gid;
  end if;

  -- 2b) RPC 冲突更新路径：同 title 换 status/gid，必须仍返回 1 行并推进水位线
  select count(*), max(r.gid), max(r.watermark_date) into v_n, v_gid, v_wm
    from public.upsert_hentai_archive(222222, '__fix_probe__', '2026-02-01T00:00:00Z', 304) r;
  if v_n <> 1 then
    raise exception '__fail__ RPC 冲突更新路径返回 % 行（应为 1，0 行说明 definer/ON CONFLICT 失效）', v_n;
  end if;
  if v_gid <> 222222 then
    raise exception '__fail__ 冲突更新未刷新 gid：%', v_gid;
  end if;
  if v_wm <> '2026-02-01T00:00:00Z'::timestamptz then
    raise exception '__fail__ 水位线未按入参推进：%', v_wm;
  end if;

  -- 2c) 身份不可变 + 共享目录唯一：title 未被改写，画廊仍只有一行
  select count(*), max(g.gid), max(g.title)
    into v_n, v_gid, v_title
    from public.hentai_gallery g
   where g.title_hash = v_hash;
  if v_n <> 1 then
    raise exception '__fail__ 冲突更新产生了重复画廊行：%', v_n;
  end if;
  if v_title <> '__fix_probe__' then
    raise exception '__fail__ 画廊 title 被改写：%', v_title;
  end if;
  if v_gid <> 222222 then
    raise exception '__fail__ 画廊 gid 未刷新为 last-writer-wins 值：%', v_gid;
  end if;

  -- 2d) 事件：两种状态各一行，且都属于当前用户
  select count(*) into v_n
    from public.hentai_archive_event e
   where e.gallery_id = v_gal;
  if v_n <> 2 then
    raise exception '__fail__ 事件行数应为 2（200 + 304），实际 %', v_n;
  end if;
  if exists (select 1 from public.hentai_archive_event e
              where e.gallery_id = v_gal and e.user_id <> v_uid) then
    raise exception '__fail__ 出现非当前用户的事件（归属被伪造）';
  end if;

  -- 2e) 读路径（security_invoker 视图）不受影响
  select count(*) into v_n
    from public.hentai_archive v
   where v.title_hash = v_hash and v.user_id = v_uid;
  if v_n <> 2 then
    raise exception '__fail__ 视图读到的行数应为 2，实际 %', v_n;
  end if;

  raise notice '写入路径用例全部通过（uid=%）', v_uid;
end $$;

reset role;

-- 3) anon 不得有写入口
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform 1 from public.upsert_hentai_archive(1, '__anon_probe__', '2026-01-01T00:00:00Z', 200);
    raise exception '__fail__ anon 仍能执行写 RPC';
  exception when insufficient_privilege then
    raise notice 'anon 调用写 RPC 已被拒（insufficient_privilege）';
  end;
end $$;

reset role;

-- 4) owner 侧收口形态
do $$
declare
  v_policies text;
begin
  select string_agg(cmd, ',' order by cmd) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'hentai_gallery';
  if v_policies is distinct from 'SELECT' then
    raise exception '__fail__ 策略应只剩 SELECT，实际：%', coalesce(v_policies, 'none');
  end if;

  if has_table_privilege('authenticated', 'public.hentai_gallery', 'insert')
     or has_table_privilege('authenticated', 'public.hentai_gallery', 'update') then
    raise exception '__fail__ authenticated 仍持有写权限';
  end if;

  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'upsert_hentai_archive') then
    raise exception '__fail__ 对外 RPC 不应是 SECURITY DEFINER';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'upsert_hentai_archive') then
    raise exception '__fail__ private 实现必须是 SECURITY DEFINER';
  end if;

  if exists (select 1 from public.hentai_archive_event e
              left join public.hentai_gallery g on g.id = e.gallery_id
              where g.id is null) then
    raise exception '__fail__ 存在未关联画廊的事件';
  end if;
end $$;

select 'write_path_ok' as result,
       '直连写已关闭 / RPC 双路径可用 / 归属不可伪造 / anon 无入口' as detail;

rollback;
