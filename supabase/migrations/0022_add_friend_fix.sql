-- 0022 · «Не вдалося додати друга» (2026-11-16, учениця): у add_friend вихідна колонка friend_id (RETURNS TABLE) збігалась
-- з назвою колонки в ON CONFLICT (user_id, friend_id) → «column reference "friend_id" is ambiguous». Конфлікт — за назвою обмеження.
create or replace function public.add_friend(p_code text)
 returns table(friend_id uuid, name text, status text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_friend uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if (select count(*) from private.friend_attempts a where a.user_id = v_uid and a.ts > now() - interval '1 hour') >= 20 then
    return query select null::uuid, null::text, 'rate_limited'::text; return;
  end if;
  insert into private.friend_attempts (user_id) values (v_uid);

  select f.user_id into v_friend from public.friend_profiles f where f.code = v_code;
  if v_friend is null then return query select null::uuid, null::text, 'not_found'::text; return; end if;
  if v_friend = v_uid then return query select null::uuid, null::text, 'self'::text; return; end if;
  if not exists (select 1 from public.friendships x where x.user_id = v_uid and x.friend_id = v_friend and x.removed_at is null)
     and (select count(*) from public.friendships x where x.user_id = v_uid and x.removed_at is null) >= 100 then
    return query select null::uuid, null::text, 'too_many_friends'::text; return;
  end if;
  perform public.my_friend_code(null);
  insert into public.friendships as x (user_id, friend_id) values (v_uid, v_friend), (v_friend, v_uid)
  on conflict on constraint friendships_pkey do update set removed_at = null, created_at = now()
   where x.removed_at is not null;
  return query select v_friend, private.friend_name(v_friend), 'ok'::text;
end $function$;
