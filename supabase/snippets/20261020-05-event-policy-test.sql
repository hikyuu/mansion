-- 2026-10-20 事件表策略回归测试（事务内执行，结束整体回滚，不留数据）
--
-- 目的：20261020-04 只是把 auth.uid() 换成了 (select auth.uid())，语义必须一模一样。
--       本测试用「两个真实用户 + 一行他人事件」把 for all 的四个方向都走一遍，
--       证明改写后既没放宽（伪造归属仍被拒）也没收紧（自己的事件仍可增删改查）。
--
-- 断言失败即抛异常中断并回滚；全部通过输出 event_policy_ok。
-- 前提：已执行 20261020-04-event-policy-initplan.sql。

begin;

-- 两个真实用户（事件表 user_id 有指向 auth.users 的外键）
select set_config('app.probe_user_a',
  (select u.id::text from auth.users u order by u.id limit 1), true) as user_a;
select set_config('app.probe_user_b',
  (select u.id::text from auth.users u order by u.id offset 1 limit 1), true) as user_b;

-- 探针画廊 + B 的事件（owner 身份写入，绕过 RLS）
insert into public.hentai_gallery (title, title_hash, gid)
values ('__event_policy_probe__',
        encode(sha256(convert_to('__event_policy_probe__', 'UTF8')), 'hex'),
        424242);

select set_config('app.probe_gallery',
  (select g.id::text from public.hentai_gallery g
    where g.title_hash = encode(sha256(convert_to('__event_policy_probe__', 'UTF8')), 'hex')), true) as gallery;

insert into public.hentai_archive_event (user_id, gallery_id, status, watermark_date)
values (current_setting('app.probe_user_b')::uuid,
        current_setting('app.probe_gallery')::bigint,
        400,
        '2026-01-01T00:00:00Z');

-- ---------------------------------------------------------------- A 视角
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.probe_user_a'), 'role', 'authenticated')::text, true);

set local role authenticated;

do $$
declare
  v_uid  uuid   := auth.uid();
  v_gal  bigint := current_setting('app.probe_gallery')::bigint;
  v_b    uuid   := current_setting('app.probe_user_b')::uuid;
  v_rows int;
  v_owner uuid;
begin
  if v_uid is null or v_b is null then
    raise exception '前置失败：需要至少两个 auth.users（或 claims 未生效）';
  end if;

  -- 1) SELECT：此刻 A 还没有事件，B 的那行必须完全不可见
  select count(*) into v_rows from public.hentai_archive_event e where e.gallery_id = v_gal;
  if v_rows <> 0 then
    raise exception '__fail__ 看得见他人在此画廊的事件（USING 被放宽）：% 行', v_rows;
  end if;

  -- 2) INSERT 自己：必须允许（证明没被误收紧）
  insert into public.hentai_archive_event (user_id, gallery_id, status, watermark_date)
  values (v_uid, v_gal, 304, '2026-02-02T00:00:00Z');

  -- 2b) 写入后可见集合恰好是「自己的那一行」
  select count(*), min(e.user_id::text)::uuid into v_rows, v_owner
    from public.hentai_archive_event e where e.gallery_id = v_gal;
  if v_rows <> 1 or v_owner <> v_uid then
    raise exception '__fail__ 可见集合应为自己的 1 行，实际 % 行 / owner=%', v_rows, v_owner;
  end if;

  -- 3) INSERT 他人：WITH CHECK 必须拒
  begin
    insert into public.hentai_archive_event (user_id, gallery_id, status, watermark_date)
    values (v_b, v_gal, 200, '2026-02-02T00:00:00Z');
    raise exception '__fail__ 可插入他人归属的事件（WITH CHECK 被放宽）';
  exception when insufficient_privilege then
    raise notice '伪造归属的 INSERT 已被拒';
  end;

  -- 4) UPDATE 把自己的事件改成他人：WITH CHECK 必须拒
  begin
    update public.hentai_archive_event set user_id = v_b
     where gallery_id = v_gal and user_id = v_uid;
    raise exception '__fail__ 可把事件归属改给别人（WITH CHECK 被放宽）';
  exception when insufficient_privilege then
    raise notice '改写归属的 UPDATE 已被拒';
  end;

  -- 5) UPDATE 自己的水位线：必须允许
  update public.hentai_archive_event set watermark_date = '2026-03-03T00:00:00Z'
   where gallery_id = v_gal and user_id = v_uid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception '__fail__ 更新自己的事件命中 % 行（应为 1）', v_rows;
  end if;

  -- 6) UPDATE / DELETE 他人的：不可见 → 0 行（不报错，也不改别人）
  update public.hentai_archive_event set watermark_date = now()
   where gallery_id = v_gal and user_id = v_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception '__fail__ 改到了他人的事件（USING 被放宽）：% 行', v_rows;
  end if;

  delete from public.hentai_archive_event
   where gallery_id = v_gal and user_id = v_b;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception '__fail__ 删到了他人的事件（USING 被放宽）：% 行', v_rows;
  end if;

  -- 7) DELETE 自己的：必须允许（for all 的删除方向仍完整）
  delete from public.hentai_archive_event
   where gallery_id = v_gal and user_id = v_uid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception '__fail__ 删除自己的事件命中 % 行（应为 1）', v_rows;
  end if;

  raise notice 'A 视角用例全部通过';
end $$;

reset role;

-- ---------------------------------------------------------------- B 视角
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.probe_user_b'), 'role', 'authenticated')::text, true);

set local role authenticated;

do $$
declare
  v_gal bigint := current_setting('app.probe_gallery')::bigint;
  v_wm  timestamptz;
begin
  if (select count(*) from public.hentai_archive_event e where e.gallery_id = v_gal) <> 1 then
    raise exception '__fail__ B 应只看到自己的 1 行事件';
  end if;

  select e.watermark_date into v_wm
    from public.hentai_archive_event e
   where e.gallery_id = v_gal;

  if v_wm <> '2026-01-01T00:00:00Z'::timestamptz then
    raise exception '__fail__ B 的事件被他人的 UPDATE 改动了：%', v_wm;
  end if;

  raise notice 'B 视角用例全部通过（隔离成立、数据未被越权改动）';
end $$;

reset role;

select 'event_policy_ok' as result,
       '自己的事件可增删改查 / 他人不可见不可写 / 归属不可伪造' as detail;

rollback;
