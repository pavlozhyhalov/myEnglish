-- 0030 · Запити в друзі й пошук людей (2026-11-17, власник: «щоб запити можна було скидати іншим людям, кого бачиш чи знаходиш на сайті, не лише код і посилання»).
-- Пошук: лише люди з іменем і увімкненим «Мене можна знайти» (friend_profiles.discoverable, за замовчуванням так); видно ім'я й серію днів — без рівня й пошти.
-- Запит → у того, кому надіслали, «Прийняти / Відхилити» (сторінка «Друзі», дзвіночок, push). Зустрічний запит — одразу дружба.
-- Посилання-запрошення лишається миттєвим (0029). «Можливо, ви знайомі» тепер теж шле запит (add_friend_direct більше не викликається клієнтом).
alter table public.friend_profiles add column if not exists discoverable boolean not null default true;

create table if not exists public.friend_requests (
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (from_id, to_id),
  constraint friend_request_not_self check (from_id <> to_id)
);
create index if not exists friend_requests_to on public.friend_requests (to_id) where status = 'pending';
alter table public.friend_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'friend_requests' and policyname = 'friend_requests_sel') then
    create policy friend_requests_sel on public.friend_requests for select to authenticated using ((select auth.uid()) in (from_id, to_id));
  end if;
end $$;

create or replace function private.make_friends(p_a uuid, p_b uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.friendships as x (user_id, friend_id) values (p_a, p_b), (p_b, p_a)
  on conflict on constraint friendships_pkey do update set removed_at = null, created_at = now() where x.removed_at is not null;
  update public.friend_requests r set status = 'accepted', responded_at = now()
   where r.status = 'pending' and ((r.from_id = p_a and r.to_id = p_b) or (r.from_id = p_b and r.to_id = p_a));
end $$;

-- Пошук людей. Порожній запит — спершу знайомі (спільна група, спільні друзі), далі нещодавно активні.
create or replace function public.people_search(p_q text default '')
returns table (user_id uuid, name text, streak integer, status text, hint text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_q text := btrim(coalesce(p_q, ''));
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query
    with p as (
      select f.user_id as uid, private.friend_name(f.user_id) as nm, f.discoverable,
             exists (select 1 from public.chat_members a join public.chat_members b on b.room_id = a.room_id and b.user_id = f.user_id and b.left_at is null
                      where a.user_id = v_uid and a.left_at is null) as grp,
             (select count(*)::int from public.friendships x join public.friendships y on y.user_id = x.friend_id and y.friend_id = f.user_id and y.removed_at is null
               where x.user_id = v_uid and x.removed_at is null) as mu,
             (select max(s.day) from public.sessions s where s.user_id = f.user_id and not s.deleted) as last_day
        from public.friend_profiles f
       where f.user_id <> v_uid and not private.chat_blocked(v_uid, f.user_id)
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

-- Надіслати запит (або одразу дружба, якщо є зустрічний)
create or replace function public.friend_request_send(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_user is null or p_user = v_uid then return 'self'; end if;
  if private.chat_blocked(v_uid, p_user) then return 'not_found'; end if;
  if private.is_friend(v_uid, p_user) then return 'friend'; end if;
  if (select count(*) from private.friend_attempts a where a.user_id = v_uid and a.ts > now() - interval '1 hour') >= 20 then return 'rate_limited'; end if;
  insert into private.friend_attempts (user_id) values (v_uid);
  -- знайти можна лише тих, хто дозволив пошук, або знайомих (спільна група / спільний друг)
  if not exists (select 1 from public.friend_profiles f where f.user_id = p_user and f.discoverable)
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
  -- відхилений запит можна повторити не раніше ніж через 7 днів
  if exists (select 1 from public.friend_requests r where r.from_id = v_uid and r.to_id = p_user and r.status = 'declined' and r.responded_at > now() - interval '7 days') then return 'declined'; end if;
  insert into public.friend_requests as r (from_id, to_id) values (v_uid, p_user)
  on conflict on constraint friend_requests_pkey do update set status = 'pending', created_at = now(), responded_at = null where r.status <> 'pending';
  return 'sent';
end $$;

create or replace function public.friend_request_respond(p_from uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not exists (select 1 from public.friend_requests r where r.from_id = p_from and r.to_id = v_uid and r.status = 'pending') then return 'gone'; end if;
  if p_accept and not private.chat_blocked(v_uid, p_from) then
    perform public.my_friend_code(null);
    perform private.make_friends(v_uid, p_from);
    return 'accepted';
  end if;
  update public.friend_requests r set status = 'declined', responded_at = now() where r.from_id = p_from and r.to_id = v_uid and r.status = 'pending';
  return 'declined';
end $$;

create or replace function public.friend_request_cancel(p_to uuid)
returns boolean language sql security definer set search_path = '' as $$
  update public.friend_requests r set status = 'cancelled', responded_at = now()
   where r.from_id = auth.uid() and r.to_id = p_to and r.status = 'pending' returning true;
$$;

create or replace function public.friend_requests_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return jsonb_build_object(
    'incoming', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.from_id, 'name', private.friend_name(r.from_id), 'at', r.created_at,
                   'hint', case when exists (select 1 from public.chat_members a join public.chat_members b on b.room_id = a.room_id and b.user_id = r.from_id and b.left_at is null
                                              where a.user_id = v_uid and a.left_at is null) then 'Спільна група' else null end) order by r.created_at desc), '[]'::jsonb)
                 from public.friend_requests r where r.to_id = v_uid and r.status = 'pending' and not private.chat_blocked(v_uid, r.from_id)),
    'outgoing', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.to_id, 'name', private.friend_name(r.to_id), 'at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                 from public.friend_requests r where r.from_id = v_uid and r.status = 'pending'),
    'discoverable', coalesce((select f.discoverable from public.friend_profiles f where f.user_id = v_uid), true));
end $$;

create or replace function public.friend_set_discoverable(p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'need_login' using errcode = '28000'; end if;
  perform public.my_friend_code(null);
  update public.friend_profiles f set discoverable = coalesce(p_on, true), updated_at = now() where f.user_id = auth.uid();
  return coalesce(p_on, true);
end $$;

-- push: новий запит → тому, кому надіслали; прийнято → тому, хто надсилав (функція push, дія 'friend')
create or replace function public.friend_requests_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and new.status in ('pending', 'accepted') and old.status is distinct from new.status) then
    begin
      perform net.http_post(
        url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
        body := jsonb_build_object('action', 'friend', 'from', new.from_id, 'to', new.to_id, 'status', new.status),
        timeout_milliseconds := 15000);
    exception when others then raise warning 'friend push: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
create or replace trigger friend_requests_notify after insert or update on public.friend_requests
for each row execute function public.friend_requests_notify();

-- дзвіночок: + вхідні запити
create or replace function public.my_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return jsonb_build_object(
    'chats', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from public.chat_list() limit 12) c),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.from_id, 'name', private.friend_name(r.from_id)) order by r.created_at desc), '[]'::jsonb)
                 from public.friend_requests r where r.to_id = v_uid and r.status = 'pending' and not private.chat_blocked(v_uid, r.from_id)),
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

revoke execute on function public.friend_requests_notify() from public, anon, authenticated;
revoke execute on function public.people_search(text), public.friend_request_send(uuid), public.friend_request_respond(uuid, boolean),
  public.friend_request_cancel(uuid), public.friend_requests_list(), public.friend_set_discoverable(boolean) from public, anon;
grant execute on function public.people_search(text), public.friend_request_send(uuid), public.friend_request_respond(uuid, boolean),
  public.friend_request_cancel(uuid), public.friend_requests_list(), public.friend_set_discoverable(boolean) to authenticated;
