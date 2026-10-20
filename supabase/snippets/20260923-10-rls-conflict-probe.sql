-- 2026-09-23 RLS 冲突可见性探针（事务内执行，结束自动回滚：不留数据、不留策略改动）
--
-- 目的：迁移（20260923-08）把 hentai_gallery 的 SELECT 策略设成了 using (true)。
--       若你想收紧成「只读自己有关联事件的画廊」以减少共享目录的枚举面，必须先跑本探针确认
--       upsert_hentai_archive 的 ON CONFLICT DO UPDATE 路径还走不走得通。
--
-- 前提：已执行 20260923-08-share-gallery.sql（探针会按名删除其 SELECT 策略）。
--
-- 判读（只看最后一行结果，不看中间的 NOTICE）：
--   OK           → 返回恰好 1 行：冲突更新不依赖 SELECT 可见性，可以收紧 SELECT
--   FAIL: ...    → 报错：收紧会直接打断 RPC
--   返回 0 行 / 其它行数 → 收紧后 RPC 静默返回空（前端拿到 null，等同写入失败）
--   后两种情况都必须保持 using (true)。若确实要收紧，只能把写入搬进非暴露 schema 的
--   SECURITY DEFINER 函数（函数内必须自带 auth.uid() 校验），不能靠策略收紧。

begin;

-- 1. 预置：以登录用户身份先建一行（此时策略仍宽松）
set local role authenticated;
set local request.jwt.claims = '{"sub":"608bc996-7b53-4eb7-8068-201556307a96","role":"authenticated"}';
do $$
begin
  perform public.upsert_hentai_archive(888888888, '__rls_conflict_probe__', '2026-01-01T00:00:00Z', 304);
end $$;

-- 2. 切回 owner：把 SELECT 策略收紧为「完全不可见」（事务内改动，回滚自动还原）
reset role;
drop policy "gallery catalog readable by authenticated" on public.hentai_gallery;
create policy "probe_deny_select" on public.hentai_gallery
  for select to authenticated using (false);

create temp table _probe_result (result text) on commit drop;
grant insert on _probe_result to authenticated;

-- 3. 再次 upsert 同 title：这一次必然走 ON CONFLICT DO UPDATE 路径
set local role authenticated;
set local request.jwt.claims = '{"sub":"608bc996-7b53-4eb7-8068-201556307a96","role":"authenticated"}';
do $$
declare
  v_n int;
begin
  select count(*) into v_n
  from public.upsert_hentai_archive(888888888, '__rls_conflict_probe__', '2026-02-01T00:00:00Z', 304);

  if v_n = 1 then
    insert into _probe_result
    values ('OK: SELECT 收紧为 false 后 RPC 仍返回 1 行 → 冲突更新不依赖 SELECT 可见性，可以收紧');
  else
    insert into _probe_result
    values (format('返回 %s 行 → 收紧后 RPC 静默返回空（前端拿到 null），不可收紧', v_n));
  end if;
exception when others then
  insert into _probe_result
  values (format('FAIL: %s (SQLSTATE %s) → 收紧会直接打断 RPC，必须保持 using (true)', sqlerrm, sqlstate));
end $$;

-- 4. 输出结论
reset role;
select result from _probe_result;

rollback;

-- ================================================================
-- 若探针结论为 OK，可把共享目录的 SELECT 换成下面这版（仅能读到自己有关联事件的画廊）：
--
--   drop policy "gallery catalog readable by authenticated" on public.hentai_gallery;
--   create policy "gallery catalog readable when referenced by own event" on public.hentai_gallery
--     for select to authenticated
--     using (exists (
--       select 1 from public.hentai_archive_event e
--        where e.gallery_id = public.hentai_gallery.id
--          and e.user_id = (select auth.uid())
--     ));
--
-- 注意：ON CONFLICT 的冲突行若不可见，Postgres 可能改为直接抛 23505，而不是走更新分支；
--       本探针若返回 FAIL 号即为该情况，不要照上面的策略改动。
-- ================================================================
