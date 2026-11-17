-- 0035 · Запрошення в групу й закріплене повідомлення (власник 2026-11-17: «дай запит в існуючу групу всім, кого там ще немає»;
-- «закріплення повідомлення зверху для адміністратора — написати, закріпити, і воно в швидкому доступі»).
-- 1) Запрошення в групу — як запит у друзі: учасник групи запрошує будь-кого з сайту (без дружби), людина приймає або відхиляє
--    (дзвіночок, «Друзі», push). Не більше вільних місць у групі (до 10), не заблокованим, відхилене — повтор через 7 днів.
-- 2) Закріплене повідомлення: у групі закріплює/відкріплює лише творець групи (role 'owner'), у чаті 1:1 — будь-хто з двох.
--    Видно смужкою під шапкою чату; службове повідомлення «… закріплює повідомлення».

create table if not exists public.chat_group_invites (
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  from_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (room_id, to_id)
);
alter table public.chat_group_invites enable row level security;   -- без політик: лише через функції

create or replace function public.chat_group_invite_send(p_room uuid, p_users uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_to uuid; n int := 0; v_free int;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if (select r.kind from public.chat_rooms r where r.id = p_room) is distinct from 'group' or not public.is_chat_member(p_room) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  v_free := 10 - (select count(*) from public.chat_members m where m.room_id = p_room and m.left_at is null)
               - (select count(*) from public.chat_group_invites i where i.room_id = p_room and i.status = 'pending' and i.created_at > now() - interval '14 days');
  foreach v_to in array coalesce(p_users, '{}'::uuid[]) loop
    exit when v_free <= 0 or n >= 10;
    continue when v_to is null or v_to = v_uid or private.chat_blocked(v_uid, v_to);
    continue when exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = v_to and m.left_at is null);
    continue when not exists (select 1 from auth.users u where u.id = v_to);
    insert into public.chat_group_invites as i (room_id, to_id, from_id) values (p_room, v_to, v_uid)
    on conflict on constraint chat_group_invites_pkey do update set status = 'pending', from_id = excluded.from_id, created_at = now(), responded_at = null
      where i.status in ('cancelled', 'accepted') or (i.status = 'declined' and i.responded_at < now() - interval '7 days')
         or (i.status = 'pending' and i.created_at < now() - interval '14 days');
    if found then n := n + 1; v_free := v_free - 1; end if;
  end loop;
  return n;
end $$;

-- вхідні запрошення (і хто з групи вже там — для картки)
create or replace function public.chat_group_invites_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('room_id', i.room_id, 'title', r.title, 'from', private.friend_name(i.from_id), 'at', i.created_at,
            'members', (select count(*) from public.chat_members m where m.room_id = i.room_id and m.left_at is null),
            'names', (select coalesce(jsonb_agg(x.n), '[]'::jsonb) from (select private.friend_name(m.user_id) n from public.chat_members m
                       where m.room_id = i.room_id and m.left_at is null order by m.joined_at limit 4) x)) order by i.created_at desc), '[]'::jsonb)
          from public.chat_group_invites i join public.chat_rooms r on r.id = i.room_id
         where i.to_id = v_uid and i.status = 'pending' and i.created_at > now() - interval '14 days' and not private.chat_blocked(v_uid, i.from_id));
end $$;

create or replace function public.chat_group_invite_respond(p_room uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_inv public.chat_group_invites;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select * into v_inv from public.chat_group_invites i where i.room_id = p_room and i.to_id = v_uid and i.status = 'pending';
  if v_inv.room_id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not coalesce(p_accept, false) then
    update public.chat_group_invites i set status = 'declined', responded_at = now() where i.room_id = p_room and i.to_id = v_uid;
    return null;
  end if;
  if public.is_chat_member(p_room) then
    update public.chat_group_invites i set status = 'accepted', responded_at = now() where i.room_id = p_room and i.to_id = v_uid;
    return p_room;
  end if;
  if exists (select 1 from public.chat_members m where m.room_id = p_room and m.left_at is null and private.chat_blocked(v_uid, m.user_id)) then raise exception 'blocked' using errcode = '22023'; end if;
  if (select count(*) from public.chat_members m where m.room_id = p_room and m.left_at is null) >= 10 then raise exception 'too_many' using errcode = '22023'; end if;
  insert into public.chat_members (room_id, user_id) values (p_room, v_uid)
  on conflict on constraint chat_members_pkey do update set left_at = null, joined_at = now(), last_read_at = now(), role = 'member';
  update public.chat_group_invites i set status = 'accepted', responded_at = now() where i.room_id = p_room and i.to_id = v_uid;
  perform public.my_friend_code(null);
  perform private.chat_system(p_room, v_uid, jsonb_build_object('event', 'joined', 'name', private.friend_name(v_uid)));
  return p_room;
end $$;

-- push: «Емма запрошує вас у групу «…»»
create or replace function public.chat_group_invites_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending' or old.created_at is distinct from new.created_at) then
    begin
      perform net.http_post(
        url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
        body := jsonb_build_object('action', 'group_invite', 'room', new.room_id, 'from', new.from_id, 'to', new.to_id),
        timeout_milliseconds := 15000);
    exception when others then raise warning 'group invite push: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
create or replace trigger chat_group_invites_notify after insert or update on public.chat_group_invites
for each row execute function public.chat_group_invites_notify();

-- дзвіночок: + запрошення в групи
create or replace function public.my_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return jsonb_build_object(
    'chats', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from public.chat_list() limit 12) c),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.from_id, 'name', private.friend_name(r.from_id)) order by r.created_at desc), '[]'::jsonb)
                 from public.friend_requests r where r.to_id = v_uid and r.status = 'pending' and not private.chat_blocked(v_uid, r.from_id)),
    'invites', public.chat_group_invites_list(),
    'homework', (select coalesce(jsonb_agg(jsonb_build_object('room_id', h.room_id, 'title', r.title, 'due_at', h.due_at,
                   'done', (select count(*) from jsonb_array_elements(t.tasks) e(task)
                             where private.homework_value(e.task, v_uid, h.room_id, h.created_at, now()) >= coalesce((e.task ->> 'target')::int, 1)),
                   'total', jsonb_array_length(t.tasks)) order by h.due_at), '[]'::jsonb)
                 from public.chat_homework h
                 join public.chat_homework_tasks t on t.homework_id = h.id and t.user_id = v_uid and t.done_at is null
                 join public.chat_members m on m.room_id = h.room_id and m.user_id = v_uid and m.left_at is null
                 join public.chat_rooms r on r.id = h.room_id
                where h.due_at > now()
                  and h.id = (select h2.id from public.chat_homework h2 where h2.room_id = h.room_id order by h2.created_at desc limit 1)),
    'duels', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'room_id', d.room_id, 'title', coalesce(r.title, private.friend_name(d.created_by)),
                   'game', d.game, 'level', d.level, 'seed', d.seed, 'by', private.friend_name(d.created_by), 'ends_at', d.ends_at) order by d.created_at desc), '[]'::jsonb)
              from public.chat_duels d
              join public.chat_members m on m.room_id = d.room_id and m.user_id = v_uid and m.left_at is null
              join public.chat_rooms r on r.id = d.room_id
             where d.ends_at > now() and coalesce(d.created_by, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid
               and not exists (select 1 from public.chat_duel_results x where x.duel_id = d.id and x.user_id = v_uid)
               and not exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = d.created_by and b.removed_at is null)));
end $$;

-- ---------- Закріплене повідомлення ----------
alter table public.chat_rooms add column if not exists pinned_id uuid references public.chat_messages (id) on delete set null;
alter table public.chat_rooms add column if not exists pinned_by uuid references auth.users (id) on delete set null;
alter table public.chat_rooms add column if not exists pinned_at timestamptz;

create or replace function public.chat_can_pin(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m join public.chat_rooms r on r.id = m.room_id
                  where m.room_id = p_room and m.user_id = auth.uid() and m.left_at is null and (r.kind = 'dm' or m.role = 'owner'));
$$;

create or replace function public.chat_pin(p_room uuid, p_message uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_msg public.chat_messages;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.chat_can_pin(p_room) then raise exception 'not_allowed' using errcode = '22023'; end if;
  if p_message is null then
    if (select r.pinned_id from public.chat_rooms r where r.id = p_room) is null then return false; end if;
    update public.chat_rooms r set pinned_id = null, pinned_by = v_uid, pinned_at = now() where r.id = p_room;
    perform private.chat_system(p_room, v_uid, jsonb_build_object('event', 'unpinned', 'name', private.friend_name(v_uid)));
    return true;
  end if;
  select * into v_msg from public.chat_messages x where x.id = p_message and x.room_id = p_room and x.deleted_at is null;
  if v_msg.id is null or not (v_msg.kind in ('text', 'voice') or (v_msg.kind = 'system' and v_msg.meta ->> 'event' in ('tutor', 'topic'))) then
    raise exception 'bad_message' using errcode = '22023';
  end if;
  update public.chat_rooms r set pinned_id = p_message, pinned_by = v_uid, pinned_at = now() where r.id = p_room;
  perform private.chat_system(p_room, v_uid, jsonb_build_object('event', 'pinned', 'name', private.friend_name(v_uid), 'message_id', p_message,
    'text', left(coalesce(nullif(v_msg.body, ''), v_msg.meta ->> 'text', v_msg.meta ->> 'q', ''), 120)));
  return true;
end $$;

create or replace function public.chat_pinned(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  select jsonb_build_object('id', x.id, 'kind', x.kind, 'body', x.body, 'meta', x.meta, 'user_id', x.user_id, 'created_at', x.created_at,
           'name', case when x.kind = 'system' then 'Вчитель' else private.friend_name(x.user_id) end,
           'pinned_at', r.pinned_at, 'pinned_by', private.friend_name(r.pinned_by), 'can_pin', public.chat_can_pin(p_room))
    into v
    from public.chat_rooms r join public.chat_messages x on x.id = r.pinned_id and x.deleted_at is null
   where r.id = p_room;
  return coalesce(v, jsonb_build_object('can_pin', public.chat_can_pin(p_room)));
end $$;

revoke execute on function public.chat_group_invites_notify() from public, anon, authenticated;
revoke execute on function public.chat_group_invite_send(uuid, uuid[]), public.chat_group_invites_list(), public.chat_group_invite_respond(uuid, boolean),
  public.chat_can_pin(uuid), public.chat_pin(uuid, uuid), public.chat_pinned(uuid) from public, anon;
grant execute on function public.chat_group_invite_send(uuid, uuid[]), public.chat_group_invites_list(), public.chat_group_invite_respond(uuid, boolean),
  public.chat_can_pin(uuid), public.chat_pin(uuid, uuid), public.chat_pinned(uuid) to authenticated;
