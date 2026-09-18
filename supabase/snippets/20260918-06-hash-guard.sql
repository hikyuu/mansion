-- 2026-09-18 增量：冲突更新时同步 title_hash + 派生列一致性触发器
-- 内容与 20260918-02-normalize.sql 的 8/8b 节保持一致（02 用于全新重建，本文件用于对已迁移库打补丁）
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

  v_hash := encode(sha256(convert_to(p_title, 'UTF8')), 'hex');

  -- output 参数名与列名同名，故 ON CONFLICT 用约束名、列引用一律用表别名限定，避免 42702
  insert into public.hentai_gallery as gal (title, title_hash, gid)
  values (p_title, v_hash, p_gid)
  on conflict on constraint hentai_gallery_user_id_title_hash_unique do update
    set title        = excluded.title,
        title_hash   = excluded.title_hash,
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

grant execute on function public.upsert_hentai_archive(bigint, text, timestamptz, bigint) to authenticated;

-- 派生列一致性守卫：title_hash 必须等于 sha256(title)
create or replace function public.hentai_gallery_assert_title_hash()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.title_hash is distinct from encode(sha256(convert_to(new.title, 'UTF8')), 'hex') then
    raise exception 'title_hash 与 sha256(title) 不一致：%', left(new.title, 40);
  end if;
  return new;
end;
$$;

drop trigger if exists hentai_gallery_assert_title_hash on public.hentai_gallery;
create trigger hentai_gallery_assert_title_hash
  before insert or update of title, title_hash on public.hentai_gallery
  for each row execute function public.hentai_gallery_assert_title_hash();

notify pgrst, 'reload schema';

commit;
