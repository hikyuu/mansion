-- 2026-10-20 收紧 hentai_gallery 的 SELECT：只读自己有过事件的画廊（消掉「全站标题可枚举」）
--
-- 前提：已执行 20261020-01-gallery-write-path-definer.sql。
--   旧模型下不能收紧 —— 20260923-10 探针就是为了确认这点：INVOKER 写入时，
--   ON CONFLICT 的冲突行一旦不可见，更新分支会走不通（23505 或静默 0 行）。
--   收口后 ON CONFLICT 与回读 join 都在 private definer 内完成，不再看调用者可见性，收紧安全。
--
-- 影响面：
--   - security_invoker 视图 hentai_archive 只读自己事件的 joined 行，行为不变；
--   - 前端从不直连 hentai_gallery（src/dao/hentai-archive.ts 只查视图），无感；
--   - 归档写入（RPC）无感。
--
-- 执行身份：表 owner（Dashboard SQL Editor / db query 均为 postgres）。
-- 回滚：drop policy "gallery catalog readable by own event" on public.hentai_gallery;
--       create policy "gallery catalog readable by authenticated" on public.hentai_gallery
--         for select to authenticated using (true);

begin;

drop policy if exists "gallery catalog readable by authenticated" on public.hentai_gallery;

-- 谓词里的 auth.uid() 用 (select auth.uid()) 形式：让规划器按语句缓存，避免逐行求值。
-- 子查询本身也受 hentai_archive_event 的 RLS 约束（user_id = auth.uid()），双重一致。
create policy "gallery catalog readable by own event" on public.hentai_gallery
  for select to authenticated
  using (exists (
    select 1
      from public.hentai_archive_event e
     where e.gallery_id = public.hentai_gallery.id
       and e.user_id = (select auth.uid())
  ));

comment on policy "gallery catalog readable by own event" on public.hentai_gallery
  is '只读且不可枚举：只能看到自己产生过事件的画廊；security_invoker 视图的 join 依赖此策略';

-- ---------------------------------------------------------------- 断言
do $$
declare
  v_select_policies int;
begin
  select count(*) into v_select_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'hentai_gallery' and cmd = 'SELECT';

  if v_select_policies <> 1 then
    raise exception 'SELECT 策略数应为 1，实际 %', v_select_policies;
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'hentai_gallery'
                    and policyname = 'gallery catalog readable by own event') then
    raise exception '未找到收紧后的 SELECT 策略';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'hentai_gallery'
                and policyname = 'gallery catalog readable by authenticated') then
    raise exception '旧的全开 SELECT 策略仍在';
  end if;
  if not has_table_privilege('authenticated', 'public.hentai_gallery', 'select') then
    raise exception 'authenticated 缺少 SELECT 授权（视图会失效）';
  end if;

  raise notice 'SELECT 已收紧：仅自己产生过事件的画廊可见';
end $$;

notify pgrst, 'reload schema';

commit;
