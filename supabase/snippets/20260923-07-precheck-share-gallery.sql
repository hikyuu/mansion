-- 2026-09-23 hentai_gallery 全局化前置校验（只读，单结果集）
--
-- 判读要点：
--   will_delete_rows   = 迁移会合并掉的画廊行数（>0 说明存在跨用户同名画廊）
--   event_needs_rewire = 需要重挂 gallery_id 的事件行数（必须 < event_rows）
--   hash_multi_title   = 必须为 0（同 hash 不同 title 违背内容寻址，先查清再迁移）
--   event_orphan       = 必须为 0
--   fk_del_action      = 迁移前应为 c(cascade)，迁移后应为 r(restrict)
select 'gallery_rows' as check, count(*)::text as value
  from public.hentai_gallery
union all select 'gallery_distinct_hash', count(distinct title_hash)::text
  from public.hentai_gallery
union all select 'will_delete_rows', (count(*) - count(distinct title_hash))::text
  from public.hentai_gallery
union all select 'hash_multi_title', count(*)::text
  from (select title_hash from public.hentai_gallery group by 1 having count(distinct title) > 1) x
union all select 'gallery_null_user_id', count(*)::text
  from public.hentai_gallery where user_id is null
union all select 'event_rows', count(*)::text
  from public.hentai_archive_event
union all select 'event_needs_rewire', count(*)::text
  from public.hentai_archive_event e
  join public.hentai_gallery g on g.id = e.gallery_id
  join (select title_hash, min(id) as keep_id from public.hentai_gallery group by 1) k
    on k.title_hash = g.title_hash
 where e.gallery_id <> k.keep_id
union all select 'event_orphan', count(*)::text
  from public.hentai_archive_event e
  left join public.hentai_gallery g on g.id = e.gallery_id
 where g.id is null
union all select 'view_rows', count(*)::text
  from public.hentai_archive
union all select 'fk_gallery_id_del_action', coalesce((
  select c.confdeltype::text
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'hentai_archive_event' and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%gallery_id%'
  limit 1), 'missing')
union all select 'gallery_delete_grant', has_table_privilege('authenticated', 'public.hentai_gallery', 'delete')::text
union all select 'gallery_rls', coalesce((select relrowsecurity::text from pg_class where relname = 'hentai_gallery'), 'missing')
union all select 'gallery_policies', coalesce((
  select string_agg(policyname || ':' || cmd, ', ' order by cmd)
  from pg_policies where schemaname = 'public' and tablename = 'hentai_gallery'), 'none')
order by 1;
