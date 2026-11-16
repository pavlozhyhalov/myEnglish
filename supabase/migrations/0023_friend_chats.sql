-- 0023 · «Друзі»: чати 1:1 і групи до 10 людей, голосові повідомлення, приватні виправлення вчителя, блокування, спільні виклики (2026-11-16).
-- Повідомлення бачать лише учасники (RLS); виправлення — лише автор (chat_feedback); видалення м'яке (deleted_at, текст стирається).
-- Нові повідомлення: Supabase Realtime (публікація supabase_realtime) у відкритому чаті; поза застосунком — Web Push через функцію push
-- (тригер → pg_net → push { action: 'chat' } із секретом cron із Vault).
-- Ідемпотентно: if not exists / create or replace, без drop/delete.

-- ---------- Таблиці ----------
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  title text check (title is null or char_length(title) between 1 and 60),
  dm_key text unique,                                   -- 'uidA:uidB' (за зростанням) — один чат на пару
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_msg_at timestamptz not null default now()
);
alter table public.chat_rooms enable row level security;

create table if not exists public.chat_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz not null default now(),
  notified_at timestamptz,                              -- останній push про цей чат (не частіше, доки не прочитано)
  muted boolean not null default false,
  primary key (room_id, user_id)
);
create index if not exists chat_members_user on public.chat_members (user_id) where left_at is null;
alter table public.chat_members enable row level security;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'voice', 'challenge', 'system')),
  body text not null default '' check (char_length(body) <= 2000),
  audio_path text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_messages_room_ts on public.chat_messages (room_id, created_at desc);
create index if not exists chat_messages_user_ts on public.chat_messages (user_id, created_at desc);
alter table public.chat_messages enable row level security;

-- Виправлення вчителя до власного повідомлення — бачить лише автор
create table if not exists public.chat_feedback (
  message_id uuid primary key references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fixes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_feedback_user_ts on public.chat_feedback (user_id, created_at desc);
alter table public.chat_feedback enable row level security;

create table if not exists public.chat_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (user_id, blocked_id),
  constraint chat_block_not_self check (user_id <> blocked_id)
);
alter table public.chat_blocks enable row level security;

create table if not exists public.chat_challenges (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('daily15', 'words', 'talks')),
  target integer not null check (target between 1 and 1000),
  starts_on date not null,
  ends_on date not null,
  tz text not null default 'Europe/Kyiv',
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists chat_challenges_room on public.chat_challenges (room_id, ends_on desc);
alter table public.chat_challenges enable row level security;

-- ---------- Допоміжні ----------
-- Чи учасник (у політиках — від імені користувача; security definer, щоб не впиратися в RLS chat_members)
create or replace function public.is_chat_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = auth.uid() and m.left_at is null);
$$;

create or replace function private.chat_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_blocks b where b.removed_at is null
                  and ((b.user_id = p_a and b.blocked_id = p_b) or (b.user_id = p_b and b.blocked_id = p_a)));
$$;

create or replace function private.is_friend(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships x where x.user_id = p_a and x.friend_id = p_b and x.removed_at is null);
$$;

create or replace function private.chat_system(p_room uuid, p_user uuid, p_meta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_messages (room_id, user_id, kind, body, meta) values (p_room, p_user, 'system', '', p_meta);
end $$;

-- ---------- Політики ----------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_rooms' and policyname = 'chat_rooms_sel') then
    create policy chat_rooms_sel on public.chat_rooms for select to authenticated using (public.is_chat_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_members' and policyname = 'chat_members_sel') then
    create policy chat_members_sel on public.chat_members for select to authenticated using (public.is_chat_member(room_id));
  end if;
  -- повідомлення: лише учасники; повідомлення людей, яких я заблокував, — не бачу
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'chat_messages_sel') then
    create policy chat_messages_sel on public.chat_messages for select to authenticated using (
      public.is_chat_member(room_id)
      and not exists (select 1 from public.chat_blocks b where b.user_id = (select auth.uid()) and b.blocked_id = chat_messages.user_id and b.removed_at is null));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'chat_messages_ins') then
    create policy chat_messages_ins on public.chat_messages for insert to authenticated with check (
      user_id = (select auth.uid()) and kind in ('text', 'voice') and deleted_at is null and public.is_chat_member(room_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_feedback' and policyname = 'chat_feedback_sel') then
    create policy chat_feedback_sel on public.chat_feedback for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_blocks' and policyname = 'chat_blocks_sel') then
    create policy chat_blocks_sel on public.chat_blocks for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_challenges' and policyname = 'chat_challenges_sel') then
    create policy chat_challenges_sel on public.chat_challenges for select to authenticated using (public.is_chat_member(room_id));
  end if;
end $$;

-- ---------- Тригери повідомлень ----------
-- Перевірка повідомлень учня (text/voice): очищення, довжина, шлях аудіо, частота, блокування й дружба в чаті 1:1
create or replace function public.chat_messages_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_other uuid; v_dur numeric;
begin
  if new.kind not in ('text', 'voice') then return new; end if;
  new.id := gen_random_uuid();
  new.created_at := now();
  new.deleted_at := null;
  new.body := btrim(regexp_replace(coalesce(new.body, ''), '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'));
  if new.kind = 'text' then
    if char_length(new.body) = 0 or char_length(new.body) > 1000 then raise exception 'bad_message' using errcode = '22023'; end if;
    new.audio_path := null; new.meta := '{}'::jsonb;
  else
    new.body := left(new.body, 2000);
    if new.audio_path is null or new.audio_path !~ ('^' || new.room_id::text || '/' || new.user_id::text || '/[A-Za-z0-9_-]{8,64}\.(webm|mp4|m4a|ogg|aac|mp3)$') then
      raise exception 'bad_audio' using errcode = '22023';
    end if;
    v_dur := case when jsonb_typeof(new.meta -> 'dur') = 'number' then least(greatest((new.meta ->> 'dur')::numeric, 0), 120) else 0 end;
    new.meta := jsonb_build_object('dur', round(v_dur, 1));
  end if;
  if (select count(*) from public.chat_messages x where x.user_id = new.user_id and x.created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  select r.kind into v_kind from public.chat_rooms r where r.id = new.room_id;
  if v_kind = 'dm' then
    select m.user_id into v_other from public.chat_members m where m.room_id = new.room_id and m.user_id <> new.user_id limit 1;
    if v_other is null or private.chat_blocked(new.user_id, v_other) then raise exception 'blocked' using errcode = '22023'; end if;
    if not private.is_friend(new.user_id, v_other) then raise exception 'not_friends' using errcode = '22023'; end if;
  end if;
  return new;
end $$;

create or replace trigger chat_messages_check before insert on public.chat_messages
for each row execute function public.chat_messages_check();

-- Після нового повідомлення: час останнього повідомлення, автор — прочитав; push іншим учасникам (функція push, через pg_net)
create or replace function public.chat_messages_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_rooms r set last_msg_at = new.created_at where r.id = new.room_id;
  if new.kind in ('text', 'voice', 'challenge') then
    update public.chat_members m set last_read_at = now() where m.room_id = new.room_id and m.user_id = new.user_id;
    begin
      perform net.http_post(
        url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
        body := jsonb_build_object('action', 'chat', 'id', new.id),
        timeout_milliseconds := 15000);
    exception when others then
      raise warning 'chat push: %', sqlerrm;   -- повідомлення важливіше за сповіщення
    end;
  end if;
  return null;
end $$;

create or replace trigger chat_messages_after after insert on public.chat_messages
for each row execute function public.chat_messages_after();

-- Realtime: нові й видалені повідомлення у відкритому чаті (RLS діє і для підписок)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ---------- Сховище голосових повідомлень ----------
-- Шлях: <room_id>/<user_id>/<id>.<ext>. Читають учасники чату; пише й видаляє лише автор у власній теці.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-voice', 'chat-voice', false, 3145728, array['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/aac', 'audio/mpeg'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_voice_select_member') then
    create policy chat_voice_select_member on storage.objects for select to authenticated
      using (bucket_id = 'chat-voice' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
             and public.is_chat_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_voice_insert_own') then
    create policy chat_voice_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'chat-voice' and (storage.foldername(name))[2] = auth.uid()::text
                  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
                  and public.is_chat_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_voice_delete_own') then
    create policy chat_voice_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'chat-voice' and (storage.foldername(name))[2] = auth.uid()::text);
  end if;
end $$;

-- ---------- RPC: чати ----------
-- Чат 1:1 з другом (створюється за першого відкриття)
create or replace function public.chat_open_dm(p_friend uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_key text; v_room uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_friend is null or p_friend = v_uid or not private.is_friend(v_uid, p_friend) then raise exception 'not_friends' using errcode = '22023'; end if;
  if private.chat_blocked(v_uid, p_friend) then raise exception 'blocked' using errcode = '22023'; end if;
  v_key := least(v_uid::text, p_friend::text) || ':' || greatest(v_uid::text, p_friend::text);
  select r.id into v_room from public.chat_rooms r where r.dm_key = v_key;
  if v_room is null then
    insert into public.chat_rooms (kind, dm_key, created_by) values ('dm', v_key, v_uid)
    on conflict (dm_key) do nothing returning id into v_room;
    if v_room is null then select r.id into v_room from public.chat_rooms r where r.dm_key = v_key; end if;
  end if;
  insert into public.chat_members (room_id, user_id) values (v_room, v_uid), (v_room, p_friend)
  on conflict on constraint chat_members_pkey do update set left_at = null where public.chat_members.left_at is not null;
  return v_room;
end $$;

-- Нова група: назва 1–60, учасники — лише мої друзі, разом зі мною до 10; до 10 нових груп на добу
create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_title text := nullif(left(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g')), 60), '');
  v_room uuid; v_ids uuid[];
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if v_title is null then raise exception 'bad_title' using errcode = '22023'; end if;
  if (select count(*) from public.chat_rooms r where r.created_by = v_uid and r.kind = 'group' and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(coalesce(p_members, '{}')) u
   where u <> v_uid and private.is_friend(v_uid, u) and not private.chat_blocked(v_uid, u);
  if cardinality(v_ids) > 9 then raise exception 'too_many' using errcode = '22023'; end if;
  insert into public.chat_rooms (kind, title, created_by) values ('group', v_title, v_uid) returning id into v_room;
  insert into public.chat_members (room_id, user_id, role) values (v_room, v_uid, 'owner');
  insert into public.chat_members (room_id, user_id) select v_room, u from unnest(v_ids) u;
  perform private.chat_system(v_room, v_uid, jsonb_build_object('event', 'created', 'name', private.friend_name(v_uid), 'title', v_title));
  return v_room;
end $$;

-- Запросити друзів у групу (будь-який учасник; лише свої друзі; разом до 10)
create or replace function public.chat_invite(p_room uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_n int; u uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_rooms r where r.id = p_room and r.kind = 'group') or not public.is_chat_member(p_room) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_members, '{}')) x
   where x <> v_uid and private.is_friend(v_uid, x) and not private.chat_blocked(v_uid, x)
     and not exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = x and m.left_at is null);
  select count(*) into v_n from public.chat_members m where m.room_id = p_room and m.left_at is null;
  if v_n + cardinality(v_ids) > 10 then raise exception 'too_many' using errcode = '22023'; end if;
  foreach u in array v_ids loop
    insert into public.chat_members (room_id, user_id) values (p_room, u)
    on conflict on constraint chat_members_pkey do update set left_at = null, joined_at = now(), last_read_at = now(), role = 'member';
    perform private.chat_system(p_room, u, jsonb_build_object('event', 'joined', 'name', private.friend_name(u), 'by', private.friend_name(v_uid)));
  end loop;
  return cardinality(v_ids);
end $$;

-- Вийти з групи (м'яко: left_at). Останній, хто вийшов, — група просто лишається без учасників.
create or replace function public.chat_leave(p_room uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_rooms r where r.id = p_room and r.kind = 'group') then raise exception 'not_group' using errcode = '22023'; end if;
  update public.chat_members m set left_at = now() where m.room_id = p_room and m.user_id = v_uid and m.left_at is null;
  if not found then return false; end if;
  perform private.chat_system(p_room, v_uid, jsonb_build_object('event', 'left', 'name', private.friend_name(v_uid)));
  -- власник пішов — роль переходить до найдавнішого учасника
  if not exists (select 1 from public.chat_members m where m.room_id = p_room and m.left_at is null and m.role = 'owner') then
    update public.chat_members m set role = 'owner'
     where m.room_id = p_room and m.user_id = (select m2.user_id from public.chat_members m2 where m2.room_id = p_room and m2.left_at is null order by m2.joined_at limit 1);
  end if;
  return true;
end $$;

create or replace function public.chat_rename(p_room uuid, p_title text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_title text := nullif(left(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g')), 60), '');
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if v_title is null then raise exception 'bad_title' using errcode = '22023'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  update public.chat_rooms r set title = v_title where r.id = p_room and r.kind = 'group' and r.title is distinct from v_title;
  if found then perform private.chat_system(p_room, v_uid, jsonb_build_object('event', 'renamed', 'name', private.friend_name(v_uid), 'title', v_title)); end if;
  return v_title;
end $$;

-- Прочитано (відкритий чат) / без сповіщень
create or replace function public.chat_read(p_room uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_members m set last_read_at = now() where m.room_id = p_room and m.user_id = auth.uid() and m.left_at is null;
$$;
create or replace function public.chat_mute(p_room uuid, p_on boolean)
returns boolean language sql security definer set search_path = '' as $$
  update public.chat_members m set muted = coalesce(p_on, false) where m.room_id = p_room and m.user_id = auth.uid() and m.left_at is null returning muted;
$$;

-- Видалити власне повідомлення (м'яко: текст і шлях до аудіо стираються, рядок лишається позначкою «видалено»)
create or replace function public.chat_delete_message(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_path text;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select x.audio_path into v_path from public.chat_messages x where x.id = p_id and x.user_id = v_uid and x.deleted_at is null and x.kind in ('text', 'voice');
  if not found then return null; end if;
  update public.chat_messages x set deleted_at = now(), body = '', audio_path = null, meta = '{}'::jsonb where x.id = p_id;
  update public.chat_feedback f set fixes = '[]'::jsonb where f.message_id = p_id;
  return coalesce(v_path, '');   -- клієнт сам видаляє аудіофайл зі сховища (політика chat_voice_delete_own)
end $$;

-- Список чатів: назва (для 1:1 — ім'я друга), останнє повідомлення, непрочитані
create or replace function public.chat_list()
returns table (id uuid, kind text, title text, other_id uuid, members integer, last_at timestamptz, last_kind text, last_body text,
               last_mine boolean, last_name text, last_meta jsonb, unread integer, muted boolean, is_friend boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query
    select r.id, r.kind,
           case when r.kind = 'dm' then private.friend_name(o.uid) else r.title end,
           o.uid,
           (select count(*)::int from public.chat_members m2 where m2.room_id = r.id and m2.left_at is null),
           coalesce(lm.created_at, r.created_at),
           lm.kind,
           case when lm.deleted_at is not null then null else left(lm.body, 140) end,
           lm.user_id = v_uid,
           case when lm.user_id is null then null else private.friend_name(lm.user_id) end,
           lm.meta,
           (select count(*)::int from public.chat_messages x
             where x.room_id = r.id and x.created_at > m.last_read_at and x.user_id <> v_uid and x.deleted_at is null and x.kind in ('text', 'voice', 'challenge')
               and not exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = x.user_id and b.removed_at is null)),
           m.muted,
           case when r.kind = 'dm' then private.is_friend(v_uid, o.uid) else null end
      from public.chat_members m
      join public.chat_rooms r on r.id = m.room_id
      left join lateral (select m3.user_id as uid from public.chat_members m3 where r.kind = 'dm' and m3.room_id = r.id and m3.user_id <> v_uid limit 1) o on true
      left join lateral (select x.created_at, x.kind, x.body, x.user_id, x.deleted_at, x.meta from public.chat_messages x
                          where x.room_id = r.id
                            and not exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = x.user_id and b.removed_at is null)
                          order by x.created_at desc limit 1) lm on true
     where m.user_id = v_uid and m.left_at is null
       and (r.kind = 'group' or (lm.created_at is not null
            and not exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = o.uid and b.removed_at is null)))
     order by 6 desc;
end $$;

-- Учасники чату: ім'я, роль, чи це я, чи друг (щоб запросити/написати)
create or replace function public.chat_room_members(p_room uuid)
returns table (user_id uuid, name text, role text, is_me boolean, is_friend boolean, blocked boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  return query
    select m.user_id, private.friend_name(m.user_id), m.role, m.user_id = v_uid, private.is_friend(v_uid, m.user_id),
           exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = m.user_id and b.removed_at is null)
      from public.chat_members m where m.room_id = p_room and m.left_at is null
     order by (m.user_id = v_uid) desc, m.joined_at;
end $$;

-- ---------- Блокування ----------
-- Заблокувати: дружба припиняється, у 1:1 писати не можна, у групах його повідомлень я не бачу; додати за кодом він мене не зможе
create or replace function public.chat_block(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_user is null or p_user = v_uid then return false; end if;
  insert into public.chat_blocks as b (user_id, blocked_id) values (v_uid, p_user)
  on conflict on constraint chat_blocks_pkey do update set removed_at = null, created_at = now() where b.removed_at is not null;
  update public.friendships x set removed_at = now()
   where x.removed_at is null and ((x.user_id = v_uid and x.friend_id = p_user) or (x.user_id = p_user and x.friend_id = v_uid));
  return true;
end $$;

create or replace function public.chat_unblock(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  update public.chat_blocks b set removed_at = now() where b.user_id = v_uid and b.blocked_id = p_user and b.removed_at is null;
  return found;
end $$;

create or replace function public.chat_my_blocks()
returns table (user_id uuid, name text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query select b.blocked_id, private.friend_name(b.blocked_id), b.created_at
                 from public.chat_blocks b where b.user_id = v_uid and b.removed_at is null order by b.created_at desc;
end $$;

-- add_friend: заблоковані (в будь-який бік) — «такого коду немає»
create or replace function public.add_friend(p_code text)
 returns table(friend_id uuid, name text, status text)
 language plpgsql security definer set search_path to ''
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
  if v_friend is null or private.chat_blocked(v_uid, v_friend) then return query select null::uuid, null::text, 'not_found'::text; return; end if;
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

-- ---------- Спільні виклики ----------
-- Значення учасника за період (лише числа — друзі не бачать, що саме він вчив)
create or replace function private.challenge_value(p_kind text, p_user uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'daily15' then (select count(*)::int from (select s.day from public.sessions s
                           where s.user_id = p_user and not s.deleted and s.day between p_from and p_to
                           group by s.day having sum(s.seconds) >= 900) d)
    when 'words' then (select count(*)::int from public.cards c
                         where c.user_id = p_user and not c.deleted and coalesce(c.reps, 0) > 0
                           and c.last_review >= p_from::timestamptz - interval '1 day' and c.last_review::date between p_from and p_to)
    when 'talks' then (select count(*)::int from public.tutor_chats t
                         where t.user_id = p_user and not t.deleted and t.mode in ('voice', 'chat', 'scenario')
                           and jsonb_array_length(coalesce(t.messages, '[]'::jsonb)) >= 4
                           and t.created_at::date between p_from and p_to)
    else 0 end;
$$;

-- Новий виклик на 7 днів (від сьогодні за часовим поясом автора); до 3 активних у чаті; картка в чаті
create or replace function public.chat_challenge_create(p_room uuid, p_kind text, p_target integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tz text; v_today date; v_id uuid; v_target int;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  if p_kind not in ('daily15', 'words', 'talks') then raise exception 'bad_kind' using errcode = '22023'; end if;
  v_target := case p_kind when 'daily15' then least(greatest(coalesce(p_target, 7), 3), 7)
                          when 'words' then least(greatest(coalesce(p_target, 200), 20), 1000)
                          else least(greatest(coalesce(p_target, 5), 1), 30) end;
  v_tz := coalesce((select fp.tz from public.friend_profiles fp where fp.user_id = v_uid), 'Europe/Kyiv');
  v_today := (now() at time zone v_tz)::date;
  if (select count(*) from public.chat_challenges c where c.room_id = p_room and c.cancelled_at is null and c.ends_on >= v_today) >= 3 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  insert into public.chat_challenges (room_id, created_by, kind, target, starts_on, ends_on, tz)
  values (p_room, v_uid, p_kind, v_target, v_today, v_today + 6, v_tz) returning id into v_id;
  insert into public.chat_messages (room_id, user_id, kind, body, meta)
  values (p_room, v_uid, 'challenge', '', jsonb_build_object('challenge_id', v_id, 'kind', p_kind, 'target', v_target, 'name', private.friend_name(v_uid)));
  return v_id;
end $$;

create or replace function public.chat_challenge_cancel(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  update public.chat_challenges c set cancelled_at = now() where c.id = p_id and c.created_by = v_uid and c.cancelled_at is null;
  return found;
end $$;

-- Виклики чату (активні й завершені за останні 14 днів) з прогресом кожного учасника
create or replace function public.chat_challenges_list(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'target', c.target, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'today', (now() at time zone c.tz)::date, 'mine', c.created_by = v_uid, 'cancelled', c.cancelled_at is not null,
      'people', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.friend_name(m.user_id), 'me', m.user_id = v_uid,
                   'value', private.challenge_value(c.kind, m.user_id, c.starts_on, least(c.ends_on, (now() at time zone c.tz)::date)))
                   order by m.joined_at), '[]'::jsonb)
                   from public.chat_members m where m.room_id = c.room_id and m.left_at is null)
    ) order by c.created_at desc)
    from public.chat_challenges c
   where c.room_id = p_room and c.ends_on >= (now() at time zone c.tz)::date - 14
  ), '[]'::jsonb);
end $$;

-- Для функції push: учасники активних викликів, що відстають від темпу (лише service role)
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
      select m.user_id, c.room_id, c.kind, c.target, c.today, c.ends_on, c.starts_on,
             private.challenge_value(c.kind, m.user_id, c.starts_on, c.today) as value,
             ceil(c.target * ((c.today - c.starts_on + 1)::numeric / (c.ends_on - c.starts_on + 1)))::int as expected
        from c join public.chat_members m on m.room_id = c.room_id and m.left_at is null and not m.muted
    )
    select v.user_id, v.room_id,
           coalesce(r.title, (select private.friend_name(m2.user_id) from public.chat_members m2 where m2.room_id = r.id and m2.user_id <> v.user_id limit 1)),
           v.kind, v.target, v.value, v.expected, (v.ends_on - v.today)::int
      from v join public.chat_rooms r on r.id = v.room_id
     where v.value < v.target and v.value < v.expected;
end $$;

-- ---------- Адмінка: лише кількість, без тексту ----------
create or replace function public.admin_chat_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'groups', (select count(*) from public.chat_rooms r where r.kind = 'group' and exists (select 1 from public.chat_members m where m.room_id = r.id and m.left_at is null)),
    'dms', (select count(*) from public.chat_rooms r where r.kind = 'dm' and exists (select 1 from public.chat_messages x where x.room_id = r.id)),
    'today', (select count(*) from public.chat_messages x where x.kind in ('text', 'voice') and x.created_at > now() - interval '1 day'),
    'week', (select count(*) from public.chat_messages x where x.kind in ('text', 'voice') and x.created_at > now() - interval '7 days'),
    'voice_week', (select count(*) from public.chat_messages x where x.kind = 'voice' and x.created_at > now() - interval '7 days'),
    'senders_week', (select count(distinct x.user_id) from public.chat_messages x where x.kind in ('text', 'voice') and x.created_at > now() - interval '7 days'),
    'checks_week', (select count(*) from public.chat_feedback f where f.created_at > now() - interval '7 days'),
    'fixes_week', (select coalesce(sum(jsonb_array_length(f.fixes)), 0) from public.chat_feedback f where f.created_at > now() - interval '7 days'),
    'challenges', (select count(*) from public.chat_challenges c where c.cancelled_at is null and c.ends_on >= current_date));
end $$;

-- ---------- Push: тип сповіщень «chat» у підписці ----------
create or replace function public.push_subscriptions_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then
    new.tz := 'Europe/Kyiv';
  end if;
  new.kinds := jsonb_build_object(
    'cards', coalesce((new.kinds ->> 'cards')::boolean, true),
    'streak', coalesce((new.kinds ->> 'streak')::boolean, true),
    'chat', coalesce((new.kinds ->> 'chat')::boolean, true));
  if jsonb_typeof(new.keys) <> 'object' or length(new.keys::text) > 512 then
    raise exception 'bad push keys';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- Права ----------
revoke execute on function public.chat_challenge_laggards() from public, anon, authenticated;
revoke execute on function public.admin_chat_stats() from public, anon, authenticated;
revoke execute on function public.chat_messages_check() from public, anon, authenticated;
revoke execute on function public.chat_messages_after() from public, anon, authenticated;
grant execute on function public.chat_challenge_laggards(), public.admin_chat_stats() to service_role;
revoke execute on function public.chat_open_dm(uuid), public.chat_create_group(text, uuid[]), public.chat_invite(uuid, uuid[]), public.chat_leave(uuid),
  public.chat_rename(uuid, text), public.chat_read(uuid), public.chat_mute(uuid, boolean), public.chat_delete_message(uuid), public.chat_list(),
  public.chat_room_members(uuid), public.chat_block(uuid), public.chat_unblock(uuid), public.chat_my_blocks(), public.chat_challenge_create(uuid, text, integer),
  public.chat_challenge_cancel(uuid), public.chat_challenges_list(uuid), public.is_chat_member(uuid) from public, anon;
grant execute on function public.chat_open_dm(uuid), public.chat_create_group(text, uuid[]), public.chat_invite(uuid, uuid[]), public.chat_leave(uuid),
  public.chat_rename(uuid, text), public.chat_read(uuid), public.chat_mute(uuid, boolean), public.chat_delete_message(uuid), public.chat_list(),
  public.chat_room_members(uuid), public.chat_block(uuid), public.chat_unblock(uuid), public.chat_my_blocks(), public.chat_challenge_create(uuid, text, integer),
  public.chat_challenge_cancel(uuid), public.chat_challenges_list(uuid), public.is_chat_member(uuid) to authenticated;
