-- 0029 · Друзі й групи — простіше, як у соцмережах (2026-11-17, власник: «додавання в друзі складне, важко створити комʼюніті»).
-- 1) Запрошення посиланням: friend_preview(code) — ім'я того, хто запросив (для картки «Олівер запрошує вас»), далі add_friend(code) одним дотиком.
-- 2) Посилання на групу: chat_invite_link(room) → код (створюється раз), chat_invite_preview(code), chat_join(code) — вступ без дружби й без коду друга.
-- 3) «Люди, яких ви можете знати»: учасники моїх груп і друзі друзів (friend_suggestions), додати одним дотиком — add_friend_direct(uid),
--    лише якщо є спільна група або спільний друг (без пошуку за іменем — чужі люди не можуть «постукати»).
alter table public.chat_rooms add column if not exists invite_code text;
create unique index if not exists chat_rooms_invite_code on public.chat_rooms (invite_code) where invite_code is not null;

create or replace function public.friend_preview(p_code text)
returns table (name text, status text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); v_friend uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select f.user_id into v_friend from public.friend_profiles f where f.code = v_code;
  if v_friend is null or private.chat_blocked(v_uid, v_friend) then return query select null::text, 'not_found'::text; return; end if;
  if v_friend = v_uid then return query select private.friend_name(v_uid), 'self'::text; return; end if;
  return query select private.friend_name(v_friend), case when private.is_friend(v_uid, v_friend) then 'friends' else 'ok' end;
end $$;

create or replace function public.chat_invite_link(p_room uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) or (select r.kind from public.chat_rooms r where r.id = p_room) <> 'group' then raise exception 'not_member' using errcode = '22023'; end if;
  select r.invite_code into v_code from public.chat_rooms r where r.id = p_room;
  if v_code is null then
    loop
      v_code := private.new_friend_code();   -- 8 знаків без схожих літер
      exit when not exists (select 1 from public.chat_rooms r where r.invite_code = v_code);
    end loop;
    update public.chat_rooms r set invite_code = v_code where r.id = p_room and r.invite_code is null;
    select r.invite_code into v_code from public.chat_rooms r where r.id = p_room;
  end if;
  return v_code;
end $$;

create or replace function public.chat_invite_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); r record;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select * into r from public.chat_rooms x where x.invite_code = v_code and x.kind = 'group';
  if r.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', case when public.is_chat_member(r.id) then 'member' else 'ok' end, 'room_id', r.id, 'title', r.title,
    'members', (select count(*) from public.chat_members m where m.room_id = r.id and m.left_at is null),
    'names', (select coalesce(jsonb_agg(n), '[]'::jsonb) from (select private.friend_name(m.user_id) n from public.chat_members m
               where m.room_id = r.id and m.left_at is null order by m.joined_at limit 3) z));
end $$;

create or replace function public.chat_join(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); v_room uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if (select count(*) from private.friend_attempts a where a.user_id = v_uid and a.ts > now() - interval '1 hour') >= 20 then raise exception 'rate_limited' using errcode = '22023'; end if;
  insert into private.friend_attempts (user_id) values (v_uid);
  select r.id into v_room from public.chat_rooms r where r.invite_code = v_code and r.kind = 'group';
  if v_room is null then raise exception 'not_found' using errcode = '22023'; end if;
  if public.is_chat_member(v_room) then return v_room; end if;
  -- той, кого я заблокував (або хто заблокував мене), — у групі: не вступаю мовчки
  if exists (select 1 from public.chat_members m where m.room_id = v_room and m.left_at is null and private.chat_blocked(v_uid, m.user_id)) then raise exception 'blocked' using errcode = '22023'; end if;
  if (select count(*) from public.chat_members m where m.room_id = v_room and m.left_at is null) >= 10 then raise exception 'too_many' using errcode = '22023'; end if;
  insert into public.chat_members (room_id, user_id) values (v_room, v_uid)
  on conflict on constraint chat_members_pkey do update set left_at = null, joined_at = now(), last_read_at = now(), role = 'member';
  perform public.my_friend_code(null);
  perform private.chat_system(v_room, v_uid, jsonb_build_object('event', 'joined', 'name', private.friend_name(v_uid)));
  return v_room;
end $$;

create or replace function public.friend_suggestions()
returns table (user_id uuid, name text, reason text, room_title text, mutual integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query
    with cand as (
      select m2.user_id as uid, 'group'::text as why, r.title as rt, 0 as mu
        from public.chat_members m1
        join public.chat_rooms r on r.id = m1.room_id and r.kind = 'group'
        join public.chat_members m2 on m2.room_id = m1.room_id and m2.left_at is null and m2.user_id <> v_uid
       where m1.user_id = v_uid and m1.left_at is null
      union all
      select f2.friend_id, 'mutual', null, 1
        from public.friendships f1
        join public.friendships f2 on f2.user_id = f1.friend_id and f2.removed_at is null and f2.friend_id <> v_uid
       where f1.user_id = v_uid and f1.removed_at is null
    ), agg as (
      select uid, max(rt) as rt, sum(mu)::int as mu, bool_or(why = 'group') as g from cand group by uid
    )
    select a.uid, private.friend_name(a.uid), case when a.g then 'group' else 'mutual' end, a.rt, a.mu
      from agg a
     where not private.is_friend(v_uid, a.uid) and not private.chat_blocked(v_uid, a.uid)
     order by a.g desc, a.mu desc
     limit 12;
end $$;

create or replace function public.add_friend_direct(p_user uuid)
returns table (friend_id uuid, name text, status text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_user is null or p_user = v_uid then return query select null::uuid, null::text, 'self'::text; return; end if;
  if (select count(*) from private.friend_attempts a where a.user_id = v_uid and a.ts > now() - interval '1 hour') >= 20 then
    return query select null::uuid, null::text, 'rate_limited'::text; return;
  end if;
  insert into private.friend_attempts (user_id) values (v_uid);
  if private.chat_blocked(v_uid, p_user) then return query select null::uuid, null::text, 'not_found'::text; return; end if;
  -- лише знайомі: спільна група або спільний друг
  if not exists (select 1 from public.chat_members a join public.chat_members b on b.room_id = a.room_id and b.user_id = p_user and b.left_at is null
                  where a.user_id = v_uid and a.left_at is null)
     and not exists (select 1 from public.friendships x join public.friendships y on y.user_id = x.friend_id and y.friend_id = p_user and y.removed_at is null
                  where x.user_id = v_uid and x.removed_at is null) then
    return query select null::uuid, null::text, 'not_found'::text; return;
  end if;
  if (select count(*) from public.friendships x where x.user_id = v_uid and x.removed_at is null) >= 100 then
    return query select null::uuid, null::text, 'too_many_friends'::text; return;
  end if;
  perform public.my_friend_code(null);
  insert into public.friendships as x (user_id, friend_id) values (v_uid, p_user), (p_user, v_uid)
  on conflict on constraint friendships_pkey do update set removed_at = null, created_at = now() where x.removed_at is not null;
  return query select p_user, private.friend_name(p_user), 'ok'::text;
end $$;

revoke execute on function public.friend_preview(text), public.chat_invite_link(uuid), public.chat_invite_preview(text), public.chat_join(text),
  public.friend_suggestions(), public.add_friend_direct(uuid) from public, anon;
grant execute on function public.friend_preview(text), public.chat_invite_link(uuid), public.chat_invite_preview(text), public.chat_join(text),
  public.friend_suggestions(), public.add_friend_direct(uuid) to authenticated;
