-- 2026-09-23 hentai_gallery 全局化迁移后校验（只读，单结果集）
--
-- 判读要点（必须成立）：
--   gallery_rows == gallery_distinct_hash  （唯一键已生效）
--   gallery_has_user_id = 0                （列已移除）
--   event_rows / view_rows 与迁移前一致
--   legacy_rows_missing_in_view = 0        （迁移没丢任何归档）
--   event_orphan = 0
--   fk_del_action = r，gallery_delete_grant = false
--   gallery_policies 含 INSERT/SELECT/UPDATE 且不含 DELETE
--
-- 仅作观察、不作为失败判据（见文件末尾说明）：
--   legacy_matched_value_drift / view_rows_beyond_snapshot / gid_changed_rows
select 'gallery_rows' as check, count(*)::text as value
  from public.hentai_gallery
union all select 'gallery_distinct_hash', count(distinct title_hash)::text
  from public.hentai_gallery
union all select 'gallery_has_user_id', (select count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'hentai_gallery' and column_name = 'user_id')
union all select 'event_rows', count(*)::text
  from public.hentai_archive_event
union all select 'view_rows', count(*)::text
  from public.hentai_archive
union all select 'legacy_rows', count(*)::text
  from public.hentai_archive_legacy
union all select 'legacy_rows_missing_in_view', (
  select count(*)::text
  from public.hentai_archive_legacy l
  left join public.hentai_archive v
    on v.user_id = l.user_id and v.title_hash = l.title_hash and v.status = l.status
  where v.id is null
)
union all select 'legacy_matched_value_drift', (
  select count(*)::text
  from public.hentai_archive v
  join public.hentai_archive_legacy l
    on l.user_id = v.user_id and l.title_hash = v.title_hash and l.status = v.status
  where v.date <> l.date or v.created_time <> l.created_time or v.title <> l.title
)
union all select 'view_rows_beyond_snapshot', (
  select count(*)::text
  from public.hentai_archive v
  left join public.hentai_archive_legacy l
    on l.user_id = v.user_id and l.title_hash = v.title_hash and l.status = v.status
  where l.id is null
)
union all select 'gid_changed_rows', (
  select count(*)::text
  from public.hentai_archive v
  join public.hentai_archive_legacy l
    on l.user_id = v.user_id and l.title_hash = v.title_hash and l.status = v.status
  where v.gid <> l.gid
)
-- 与旧表的比对口径（重要，避免误判）：
--   1) 按业务键 (user_id, title_hash, status) 而非 id：视图的 id 是事件 id，旧表的 id 是归档行 id，
--      两套独立序列，按 id 对齐会假报差异（20260918-03-verify.sql 的 view_vs_legacy_mismatch 即有此问题）。
--   2) hentai_archive_legacy 是 2026-09-18 迁移时冻结的快照，不再随应用写入更新。因此
--      legacy_matched_value_drift（水位线被后续写入推进）与 view_rows_beyond_snapshot（快照之后新产生的归档）
--      都只会单向增长，属于「应用一直在用」的正常证据，不是迁移缺陷。
--   3) gid 差异同源：02 归一化时把 gallery.gid 取成了「该 title_hash 下最后写入行的 gid」，
--      同一画廊其它状态的旧行保留着更早的 gid；且共享目录下它现在是 last-writer-wins。gid 仅是元数据。
union all select 'event_orphan', count(*)::text
  from public.hentai_archive_event e
  left join public.hentai_gallery g on g.id = e.gallery_id
 where g.id is null
union all select 'unique_title_hash_constraint', count(*)::text
  from pg_constraint c join pg_class t on t.oid = c.conrelid
 where t.relname = 'hentai_gallery' and c.conname = 'hentai_gallery_title_hash_unique'
union all select 'fk_del_action', coalesce((
  select c.confdeltype::text
  from pg_constraint c join pg_class t on t.oid = c.conrelid
  where t.relname = 'hentai_archive_event' and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%gallery_id%'
  limit 1), 'missing')
union all select 'gallery_delete_grant', has_table_privilege('authenticated', 'public.hentai_gallery', 'delete')::text
union all select 'gallery_select_grant', has_table_privilege('authenticated', 'public.hentai_gallery', 'select')::text
union all select 'gallery_rls', coalesce((select relrowsecurity::text from pg_class where relname = 'hentai_gallery'), 'missing')
union all select 'gallery_policies', coalesce((
  select string_agg(policyname || ':' || cmd, ', ' order by cmd)
  from pg_policies where schemaname = 'public' and tablename = 'hentai_gallery'), 'none')
union all select 'event_rls_policy', coalesce((
  select string_agg(policyname || ':' || cmd, ', ' order by cmd)
  from pg_policies where schemaname = 'public' and tablename = 'hentai_archive_event'), 'none')
union all select 'immutable_trigger', count(*)::text
  from pg_trigger tg join pg_class t on t.oid = tg.tgrelid
 where t.relname = 'hentai_gallery' and tg.tgname = 'hentai_gallery_assert_identity_immutable'
union all select 'rpc_upsert_hentai_archive', count(*)::text
  from pg_proc where proname = 'upsert_hentai_archive'
order by 1;
