-- 0024 · Чати друзів: виправлення після рецензії (2026-11-16).
-- 1) Учасники групи не бачать чужих last_read_at / notified_at / muted (список учасників — лише через chat_room_members()).
-- 2) Виклик у чаті 1:1 — лише між друзями без блокування; нагадування про виклик не приходить від заблокованої людини.
-- 3) «Відстає» — за темпом на вчора (сьогоднішні 15 хв ще можна зробити): без щоденних push майже всім.
alter policy chat_members_sel on public.chat_members using ((select auth.uid()) = user_id);

create or replace function public.chat_challenge_create(p_room uuid, p_kind text, p_target integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tz text; v_today date; v_id uuid; v_target int; v_other uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  if p_kind not in ('daily15', 'words', 'talks') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if (select r.kind from public.chat_rooms r where r.id = p_room) = 'dm' then
    select m.user_id into v_other from public.chat_members m where m.room_id = p_room and m.user_id <> v_uid limit 1;
    if v_other is null or private.chat_blocked(v_uid, v_other) then raise exception 'blocked' using errcode = '22023'; end if;
    if not private.is_friend(v_uid, v_other) then raise exception 'not_friends' using errcode = '22023'; end if;
  end if;
  v_target := case p_kind when 'daily15' then least(greatest(coalesce(p_target, 7), 3), 7)
                          when 'words' then least(greatest(coalesce(p_target, 200), 20), 1000)
                          else least(greatest(coalesce(p_target, 5), 1), 30) end;
  v_tz := coalesce((select fp.tz from public.friend_profiles fp where fp.user_id = v_uid), 'Europe/Kyiv');
  v_today := (now() at time zone v_tz)::date;
  if (select count(*) from public.chat_challenges c where c.room_id = p_room and c.cancelled_at is null and c.ends_on >= v_today) >= 3 then
    raise exception 'too_many_challenges' using errcode = '22023';
  end if;
  insert into public.chat_challenges (room_id, created_by, kind, target, starts_on, ends_on, tz)
  values (p_room, v_uid, p_kind, v_target, v_today, v_today + 6, v_tz) returning id into v_id;
  insert into public.chat_messages (room_id, user_id, kind, body, meta)
  values (p_room, v_uid, 'challenge', '', jsonb_build_object('challenge_id', v_id, 'kind', p_kind, 'target', v_target, 'name', private.friend_name(v_uid)));
  return v_id;
end $$;

create or replace function public.chat_challenge_laggards()
returns table (user_id uuid, room_id uuid, room_title text, kind text, target integer, value integer, expected integer, days_left integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return query
    with c as (
      select c.*, (now() at time zone c.tz)::date as today from public.chat_challenges c
       where c.cancelled_at is null and c.ends_on >= (now() at time zone c.tz)::date and c.starts_on < (now() at time zone c.tz)::date
    ), v as (
      select m.user_id, c.room_id, c.kind, c.target, c.today, c.ends_on, c.starts_on, c.created_by,
             private.challenge_value(c.kind, m.user_id, c.starts_on, c.today) as value,
             private.challenge_value(c.kind, m.user_id, c.starts_on, c.today - 1) as value_y,
             ceil(c.target * ((c.today - c.starts_on)::numeric / (c.ends_on - c.starts_on + 1)))::int as expected
        from c join public.chat_members m on m.room_id = c.room_id and m.left_at is null and not m.muted
    )
    select v.user_id, v.room_id,
           coalesce(r.title, (select private.friend_name(m2.user_id) from public.chat_members m2 where m2.room_id = r.id and m2.user_id <> v.user_id limit 1)),
           v.kind, v.target, v.value, v.expected, (v.ends_on - v.today)::int
      from v join public.chat_rooms r on r.id = v.room_id
     where v.value < v.target and v.value_y < v.expected
       and (v.created_by is null or v.created_by = v.user_id or not private.chat_blocked(v.user_id, v.created_by));
end $$;
