-- 2026-10-21 hentai_import_log 只读校验（不写数据、不改结构）
--
-- 用法：先在 Dashboard 执行 20261021-01-import-log.sql，再执行本文件。
-- 判读要点：
--   table_exists = 1、check_count = 5、policy_count = 1、policy_initplan = 1、
--   rls_enabled = 1、index_exists = 1
--   auth_grant = t,t,t,t / anon_grant = f,f,f,f
-- 说明：第 4 节的数据类查询在 Dashboard（postgres）执行时不受 RLS 约束、且 auth.uid() 为 null，
--       因此按 user_id 分组展示；在应用里执行则自动只看到自己的行。

-- ---------------------------------------------------------------- 1. 结构
select 'table_exists' as check,
       (case when to_regclass('public.hentai_import_log') is not null then 1 else 0 end)::text as value
union all
select 'check_count',
       (select count(*)::text from pg_constraint
         where conrelid = 'public.hentai_import_log'::regclass and contype = 'c')
union all
select 'unique_key',
       (select count(*)::text from pg_constraint
         where conrelid = 'public.hentai_import_log'::regclass
           and conname = 'hentai_import_log_user_id_title_hash_unique')
union all
select 'index_exists',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and tablename = 'hentai_import_log'
           and indexname = 'hentai_import_log_user_id_batch_id_idx')
union all
select 'rls_enabled',
       (select relrowsecurity::text from pg_class where oid = 'public.hentai_import_log'::regclass)
union all
select 'policy_count',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'hentai_import_log')
union all
select 'policy_initplan',
       (select (case when pg_get_expr(polqual, polrelid) like '%SubPlan%'
                       or pg_get_expr(polqual, polrelid) like '%SELECT auth.uid()%'
                     then 1 else 0 end)::text
          from pg_policy
         where polrelid = 'public.hentai_import_log'::regclass
           and polname = 'Enable users to crud their own import log')
union all
select 'auth_grant',
       concat_ws(',',
         has_table_privilege('authenticated', 'public.hentai_import_log', 'select'),
         has_table_privilege('authenticated', 'public.hentai_import_log', 'insert'),
         has_table_privilege('authenticated', 'public.hentai_import_log', 'update'),
         has_table_privilege('authenticated', 'public.hentai_import_log', 'delete'))
union all
select 'anon_grant',
       concat_ws(',',
         has_table_privilege('anon', 'public.hentai_import_log', 'select'),
         has_table_privilege('anon', 'public.hentai_import_log', 'insert'),
         has_table_privilege('anon', 'public.hentai_import_log', 'update'),
         has_table_privilege('anon', 'public.hentai_import_log', 'delete'))
union all
select 'row_count', (select count(*)::text from public.hentai_import_log);

-- ---------------------------------------------------------------- 2. 列定义
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'hentai_import_log'
order by ordinal_position;

-- ---------------------------------------------------------------- 3. 策略与授权明细
-- 注意：policyname / cmd / roles 是 pg_policies 视图的列，pg_policy 只有 polname/polcmd/polroles
select policyname, cmd, roles::text, qual as using_expr, with_check as check_expr
from pg_policies
where schemaname = 'public' and tablename = 'hentai_import_log';

select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'hentai_import_log'
group by grantee
order by grantee;

-- ---------------------------------------------------------------- 4. 数据口径示例（按 user 分组；在应用里跑则自动只剩本人）

-- 4a. 每位用户的补录数量 / 涉及批次数
select user_id,
       count(*)                             as import_log_rows,
       count(distinct batch_id)             as batch_count,
       min(imported_time)                   as first_import,
       max(imported_time)                   as last_import
from public.hentai_import_log
group by user_id
order by import_log_rows desc;

-- 4b. 补录归档 vs 线上归档（同一用户的事件按 title_hash 归一，200/304/400 都算"有归档"）
select 'archived_total' as metric, count(*)::text as value
from (
  select distinct user_id, title_hash from public.hentai_archive
) v
union all
select 'archived_imported', count(*)::text
from (
  select distinct v.user_id, v.title_hash
  from public.hentai_archive v
  join public.hentai_import_log l
    on l.user_id = v.user_id and l.title_hash = v.title_hash
) x
union all
select 'import_log_without_archive', count(*)::text
from public.hentai_import_log l
left join public.hentai_archive v
  on v.user_id = l.user_id and v.title_hash = l.title_hash
where v.id is null;

-- 4c. 某批次明细（把 <batch_id> 换成面板上显示的批次号）
-- select file_name, file_mtime, gid, status, title, imported_time
-- from public.hentai_import_log
-- where batch_id = '<batch_id>'
-- order by imported_time desc;

-- 4d. 筛选"补录的归档"完整行（可直接接着业务查询）
-- select v.*
-- from public.hentai_archive v
-- join public.hentai_import_log l
--   on l.user_id = v.user_id and l.title_hash = v.title_hash
-- where v.status = 200
-- order by v.date desc;

-- 4e. 对账：已归档但无标记（导入时日志写失败的残留），面板可一键补标记
-- select v.user_id, v.title_hash, v.title, v.date, v.status
-- from public.hentai_archive v
-- left join public.hentai_import_log l
--   on l.user_id = v.user_id and l.title_hash = v.title_hash
-- where l.id is null
--   and v.title_hash in (select title_hash from public.hentai_import_log)
-- order by v.date desc;
