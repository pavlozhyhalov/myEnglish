-- 0032 · Пошук людей — серед усіх користувачів (2026-11-17, власник: «не хоче знаходити» — пошук за початком імені не знаходив ученицю).
-- Причина: people_search брав людей лише з friend_profiles, а рядок там з'являється, лише коли людина відкрила «Друзі».
-- Тепер джерело — profiles (усі, хто користувався застосунком); немає рядка в friend_profiles — «можна знайти» (за замовчуванням так).
create or replace function public.people_search(p_q text default '')
returns table (user_id uuid, name text, streak integer, status text, hint text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_q text := btrim(coalesce(p_q, ''));
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query
    with p as (
      select pr.user_id as uid, private.friend_name(pr.user_id) as nm,
             coalesce((select f.discoverable from public.friend_profiles f where f.user_id = pr.user_id), true) as discoverable,
             exists (select 1 from public.chat_members a join public.chat_members b on b.room_id = a.room_id and b.user_id = pr.user_id and b.left_at is null
                      where a.user_id = v_uid and a.left_at is null) as grp,
             (select count(*)::int from public.friendships x join public.friendships y on y.user_id = x.friend_id and y.friend_id = pr.user_id and y.removed_at is null
               where x.user_id = v_uid and x.removed_at is null) as mu,
             (select max(s.day) from public.sessions s where s.user_id = pr.user_id and not s.deleted) as last_day
        from public.profiles pr
       where pr.user_id <> v_uid and not private.chat_blocked(v_uid, pr.user_id)
    )
    select p.uid, p.nm,
           private.streak_days(p.uid, (now() at time zone 'Europe/Kyiv')::date),
           case when private.is_friend(v_uid, p.uid) then 'friend'
                when exists (select 1 from public.friend_requests r where r.from_id = v_uid and r.to_id = p.uid and r.status = 'pending') then 'sent'
                when exists (select 1 from public.friend_requests r where r.from_id = p.uid and r.to_id = v_uid and r.status = 'pending') then 'incoming'
                else 'none' end,
           case when p.grp then 'Спільна група' when p.mu > 0 then p.mu || ' спільн. друз.' else null end
      from p
     where (p.discoverable or p.grp or p.mu > 0)
       and p.nm <> 'Учень'
       and (v_q = '' or p.nm ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
     order by (p.grp or p.mu > 0) desc, p.mu desc, p.last_day desc nulls last
     limit case when v_q = '' then 12 else 20 end;
end $$;

-- Запит: «не можна знайти» лише якщо людина сама вимкнула пошук (рядка в friend_profiles немає — можна)
create or replace function public.friend_request_send(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_user is null or p_user = v_uid then return 'self'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then return 'not_found'; end if;
  if private.chat_blocked(v_uid, p_user) then return 'not_found'; end if;
  if private.is_friend(v_uid, p_user) then return 'friend'; end if;
  if (select count(*) from private.friend_attempts a where a.user_id = v_uid and a.ts > now() - interval '1 hour') >= 20 then return 'rate_limited'; end if;
  insert into private.friend_attempts (user_id) values (v_uid);
  if not coalesce((select f.discoverable from public.friend_profiles f where f.user_id = p_user), true)
     and not exists (select 1 from public.chat_members a join public.chat_members b on b.room_id = a.room_id and b.user_id = p_user and b.left_at is null where a.user_id = v_uid and a.left_at is null)
     and not exists (select 1 from public.friendships x join public.friendships y on y.user_id = x.friend_id and y.friend_id = p_user and y.removed_at is null where x.user_id = v_uid and x.removed_at is null) then
    return 'not_found';
  end if;
  perform public.my_friend_code(null);
  if exists (select 1 from public.friend_requests r where r.from_id = p_user and r.to_id = v_uid and r.status = 'pending') then
    perform private.make_friends(v_uid, p_user);
    return 'accepted';
  end if;
  if (select count(*) from public.friend_requests r where r.from_id = v_uid and r.status = 'pending') >= 30 then return 'too_many'; end if;
  if exists (select 1 from public.friend_requests r where r.from_id = v_uid and r.to_id = p_user and r.status = 'declined' and r.responded_at > now() - interval '7 days') then return 'declined'; end if;
  insert into public.friend_requests as r (from_id, to_id) values (v_uid, p_user)
  on conflict on constraint friend_requests_pkey do update set status = 'pending', created_at = now(), responded_at = null where r.status <> 'pending';
  return 'sent';
end $$;
