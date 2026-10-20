-- 2026-10-20 修 hentai_archive_event 的 auth_rls_initplan（WARN，性能）
--
-- 现状（20260918-02 第 3 步建的）：
--   create policy "Enable users to crud their own data only" on public.hentai_archive_event
--     for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- 问题：auth.uid() 被当成逐行表达式，每扫一行调一次 current_setting()。表长大后是本项目
--       最热的查询（视图 join / 判重批量查询都会命中）。
--
-- 修法：谓词改成 (select auth.uid())。子查询在语句开始时求值一次（InitPlan），之后逐行只比 UUID。
--       这不是放宽或收紧权限 —— 表达式为 NULL 时的语义与 && 一致（auth.uid() 为空则两边都 false），
--       策略含义完全不变，只是求值次数从 O(行数) 变成 O(1)。
--
-- 不改动：授权（select/insert/update/delete 仍给 authenticated）、策略名、for all、角色。
--          写入主路径已走 private definer（20261020-01），本策略只约束直连事件表的读写。
-- 验证：执行完跑 20261020-05-event-policy-test.sql。
-- 回滚：
--   drop policy "Enable users to crud their own data only" on public.hentai_archive_event;
--   create policy "Enable users to crud their own data only" on public.hentai_archive_event
--     for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

begin;

drop policy "Enable users to crud their own data only" on public.hentai_archive_event;

create policy "Enable users to crud their own data only" on public.hentai_archive_event
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- 断言
do $$
declare
  v_cnt   int;
  v_qual  text;
  v_check text;
begin
  select count(*) into v_cnt
  from pg_policies
  where schemaname = 'public' and tablename = 'hentai_archive_event';
  if v_cnt <> 1 then
    raise exception '事件表策略数应为 1，实际 %', v_cnt;
  end if;

  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    into v_qual, v_check
  from pg_policy
  where polrelid = 'public.hentai_archive_event'::regclass
    and polname = 'Enable users to crud their own data only';

  if v_qual is null or v_check is null then
    raise exception '策略缺少 USING 或 WITH CHECK：% / %', v_qual, v_check;
  end if;

  -- 形态校验：子查询（InitPlan）形式，而不是逐行函数调用
  if v_qual not like '%SubPlan%' and v_qual not like '%SELECT auth.uid()%' then
    raise exception 'USING 未改成 (select auth.uid()) 形式：%', v_qual;
  end if;
  if v_check not like '%SubPlan%' and v_check not like '%SELECT auth.uid()%' then
    raise exception 'WITH CHECK 未改成 (select auth.uid()) 形式：%', v_check;
  end if;

  -- 角色与命令范围未变
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'hentai_archive_event'
                    and policyname = 'Enable users to crud their own data only'
                    and cmd = 'ALL'
                    and roles = '{authenticated}') then
    raise exception '策略的命令范围或角色被改动';
  end if;

  if not has_table_privilege('authenticated', 'public.hentai_archive_event', 'select')
     or not has_table_privilege('authenticated', 'public.hentai_archive_event', 'insert')
     or not has_table_privilege('authenticated', 'public.hentai_archive_event', 'update') then
    raise exception 'authenticated 的事件表授权被意外收回（直连路径会失效）';
  end if;

  raise notice '事件表策略已改为 InitPlan 形式：%', v_qual;
end $$;

notify pgrst, 'reload schema';

commit;
