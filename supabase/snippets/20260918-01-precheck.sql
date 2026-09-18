-- 迁移前置校验（只读，单结果集）
select 'bad_hash_format' as check, count(*)::text as value
  from public.hentai_archive where title_hash !~ '^[0-9a-f]{64}$'
union all
select 'bad_title', count(*)::text
  from public.hentai_archive where title is null or btrim(title) = '' or length(title) > 255
union all
select 'hash_with_multi_title', count(*)::text
  from (select user_id, title_hash from public.hentai_archive group by 1, 2 having count(distinct title) > 1) x
union all
select 'hash_with_multi_gid', count(*)::text
  from (select user_id, title_hash from public.hentai_archive group by 1, 2 having count(distinct gid) > 1) x
union all
select 'null_gid', count(*)::text
  from public.hentai_archive where gid is null
union all
select 'status_' || status::text, count(*)::text
  from public.hentai_archive group by status
order by 1;
