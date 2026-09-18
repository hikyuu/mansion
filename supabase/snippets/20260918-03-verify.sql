-- 迁移后校验（只读，单结果集）
select 'gallery_rows' as check, count(*)::text as value from public.hentai_gallery
union all select 'event_rows', count(*)::text from public.hentai_archive_event
union all select 'legacy_rows', count(*)::text from public.hentai_archive_legacy
union all select 'view_rows', count(*)::text from public.hentai_archive
union all select 'view_status_200', count(*)::text from public.hentai_archive where status = 200
union all select 'view_status_304', count(*)::text from public.hentai_archive where status = 304
union all select 'view_status_400', count(*)::text from public.hentai_archive where status = 400
union all select 'view_vs_legacy_mismatch', count(*)::text
  from public.hentai_archive v
  join public.hentai_archive_legacy l on l.id = v.id
  where v.date <> l.date or v.status <> l.status or v.title <> l.title
     or v.title_hash <> l.title_hash or v.created_time <> l.created_time or v.gid <> l.gid
union all select 'view_security_invoker', coalesce((
  select 'true' from pg_class where relname = 'hentai_archive' and relkind = 'v'
    and reloptions::text like '%security_invoker=true%'), 'false')
union all select 'rpc_upsert_hentai_archive', count(*)::text from pg_proc where proname = 'upsert_hentai_archive'
union all select 'rls_gallery', (select relrowsecurity::text from pg_class where relname = 'hentai_gallery')
union all select 'rls_event', (select relrowsecurity::text from pg_class where relname = 'hentai_archive_event')
order by 1;
