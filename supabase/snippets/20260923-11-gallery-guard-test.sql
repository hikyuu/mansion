-- 2026-09-23 共享目录守卫回归测试（事务内执行，测完整体回滚，不留数据）
--
-- 覆盖 20260923-08-share-gallery.sql 引入的三条安全不变量：
--   1. 身份不可变：title/title_hash 落库后不可改（否则可把别人事件指向的画廊改头换面）
--   2. gid 可刷新：共享目录的 last-writer-wins 语义必须仍然可用
--   3. 禁删：delete 无策略且已收回授权（共享目录删除会级联清空所有用户的事件）
--
-- 断言失败会抛异常中断并回滚；成功输出 guard_ok。
-- 前提：已执行 20260923-08-share-gallery.sql。

begin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"608bc996-7b53-4eb7-8068-201556307a96","role":"authenticated"}';

do $$
declare
  v_hash varchar(64) := encode(sha256(convert_to('__guard_probe__', 'UTF8')), 'hex');
  v_gid  bigint;
begin
  -- 1) 合法插入：内容寻址身份，应成功
  insert into public.hentai_gallery (title, title_hash, gid)
  values ('__guard_probe__', v_hash, 12345);

  -- 2) gid 刷新：应成功
  update public.hentai_gallery
     set gid = 54321, updated_time = now()
   where title_hash = v_hash;

  select gid into v_gid from public.hentai_gallery where title_hash = v_hash;
  if v_gid <> 54321 then
    raise exception 'gid 刷新未生效：%', v_gid;
  end if;

  -- 3) 身份篡改：必须被拒
  begin
    update public.hentai_gallery
       set title = '__guard_hijack__',
           title_hash = encode(sha256(convert_to('__guard_hijack__', 'UTF8')), 'hex')
     where title_hash = v_hash;
    raise exception '__guard_fail__ 身份篡改未被拒绝：title/title_hash 可被改写';
  exception
    when others then
      if sqlerrm like '%__guard_fail__%' then
        raise;
      end if;
      raise notice '身份篡改已被拒绝：%', sqlerrm;
  end;

  -- 4) 删除：必须被拒
  begin
    delete from public.hentai_gallery where title_hash = v_hash;
    raise exception '__guard_fail__ DELETE 未被拒绝：共享目录可被删除并级联清空他人事件';
  exception
    when others then
      if sqlerrm like '%__guard_fail__%' then
        raise;
      end if;
      raise notice 'DELETE 已被拒绝：%', sqlerrm;
  end;
end $$;

select 'guard_ok' as result, '身份不可变 / gid 可刷新 / 禁删 全部通过' as detail;

rollback;
