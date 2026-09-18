-- RPC 写入验证（模拟登录用户，测完整体回滚，不留数据）
-- 断言失败会抛异常中断，事务回滚；成功则输出 rpc_ok。
begin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"608bc996-7b53-4eb7-8068-201556307a96","role":"authenticated"}';

do $$
declare
  v_id1  bigint;
  v_wm1  timestamptz;
  v_wm2  timestamptz;
  v_gcnt int;
  v_ecnt int;
  v_vcnt int;
begin
  -- 首次写入：应新建画廊 + 事件
  select id, watermark_date into v_id1, v_wm1
  from public.upsert_hentai_archive(999999999, '__mansion_rpc_test__', '2026-01-01T00:00:00Z', 304);
  if v_id1 is null then
    raise exception 'RPC 首次写入未返回事件行';
  end if;
  if v_wm1 <> timestamptz '2026-01-01T00:00:00Z' then
    raise exception '首次写入水位线错误：%', v_wm1;
  end if;

  -- 同 (user, gallery, status) 再次写入：应走 conflict update 并推进水位线
  select watermark_date into v_wm2
  from public.upsert_hentai_archive(999999999, '__mansion_rpc_test__', '2026-02-01T00:00:00Z', 304);
  if v_wm2 <> timestamptz '2026-02-01T00:00:00Z' then
    raise exception '冲突更新未推进水位线：%', v_wm2;
  end if;

  -- 同画廊另一个 status：应新增事件行（画廊仍然只有一行）
  perform public.upsert_hentai_archive(999999999, '__mansion_rpc_test__', '2026-03-01T00:00:00Z', 200);

  select count(*) into v_gcnt from public.hentai_gallery where title = '__mansion_rpc_test__';
  select count(*) into v_ecnt
    from public.hentai_archive_event e
    join public.hentai_gallery g on g.id = e.gallery_id
   where g.title = '__mansion_rpc_test__';
  select count(*) into v_vcnt from public.hentai_archive where title = '__mansion_rpc_test__';

  if v_gcnt <> 1 then raise exception '画廊行数应为 1，实际 %', v_gcnt; end if;
  if v_ecnt <> 2 then raise exception '事件行数应为 2，实际 %', v_ecnt; end if;
  if v_vcnt <> 2 then raise exception '视图行数应为 2，实际 %', v_vcnt; end if;
end $$;

select 'rpc_ok' as result, '新建/冲突更新/多状态/视图可读 全部通过' as detail;

rollback;
