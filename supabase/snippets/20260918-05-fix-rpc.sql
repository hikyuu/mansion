-- 2026-09-18 修正 upsert_hentai_archive：PL/pgSQL 输出参数名与列名同名导致 42702 ambiguous
-- 修法：ON CONFLICT ON CONSTRAINT <约束名> + 表别名限定所有列引用
-- 函数定义与 20260918-02-normalize.sql 中的版本保持一致（新建库时直接用 02 即可）
begin;

create or replace function public.upsert_hentai_archive(
  p_gid    bigint,
  p_title  text,
  p_date   timestamptz,
  p_status bigint
)
returns table (
  id             bigint,
  user_id        uuid,
  gallery_id     bigint,
  status         bigint,
  watermark_date timestamptz,
  updated_time   timestamptz,
  gid            bigint,
  title          varchar(255),
  title_hash     varchar(64)
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hash       varchar(64);
  v_gallery_id bigint;
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'title 不能为空';
  end if;

  -- 与前端 sha256Hex(title) 等价的派生逻辑
  v_hash := encode(sha256(convert_to(p_title, 'UTF8')), 'hex');

  -- 注：output 参数名与列名同名（便于前端直接映射），因此 ON CONFLICT 必须用约束名，
  -- 且所有列引用都要用表别名限定，否则 PL/pgSQL 会把标识符解析为变量 → 42702 ambiguous
  insert into public.hentai_gallery as gal (title, title_hash, gid)
  values (p_title, v_hash, p_gid)
  on conflict on constraint hentai_gallery_user_id_title_hash_unique do update
    set title        = excluded.title,
        gid          = excluded.gid,
        updated_time = now()
  returning gal.id into v_gallery_id;

  return query
  with up as (
    insert into public.hentai_archive_event as ev (gallery_id, status, watermark_date)
    values (v_gallery_id, p_status, p_date)
    on conflict on constraint hentai_archive_event_user_id_gallery_id_status_unique do update
      set watermark_date = excluded.watermark_date,
          updated_time   = now()
    returning ev.*
  )
  select up.id, up.user_id, up.gallery_id, up.status, up.watermark_date, up.updated_time,
         g.gid, g.title, g.title_hash
  from up
  join public.hentai_gallery g on g.id = up.gallery_id;
end;
$$;

comment on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint)
  is '归档写入唯一入口：原子 upsert 画廊 + 事件，返回与旧 DTO 等价的字段';

grant execute on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
