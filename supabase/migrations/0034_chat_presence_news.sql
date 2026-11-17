-- 0034 · Живі чати (власник 2026-11-17: «щоб групи були живими і спілкування було як у групах, так і в особистих»).
-- 1) Присутність: «у мережі / був(-ла) N хв тому» (user_presence.seen_at, серцебиття chat_seen() з пристрою) і «Переглянуто»
--    (last_read_at інших учасників) — через chat_room_people(). Хто приховав присутність, той не показує свою і не бачить чужу (як у месенджерах).
-- 2) «Друкує…» — Realtime Broadcast у приватному каналі room:<id>: читати й надсилати можуть лише учасники чату (політики на realtime.messages).
-- 3) Новини друзів у групах: серія днів, складений іспит рівня, новий рекорд у грі → службове повідомлення { event: 'news' } у всіх моїх групах,
--    вчитель одразу ставить «Браво». Кожна новина — один раз (chat_news_log), рекорди — не частіше раз на добу. Вимикається в налаштуваннях (shareNews).

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now(),
  hidden boolean not null default false
);
alter table public.user_presence enable row level security;   -- без політик: лише через функції нижче

create or replace function public.chat_seen()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.user_presence as p (user_id, seen_at) values (v_uid, now())
  on conflict on constraint user_presence_pkey do update set seen_at = now();
end $$;

create or replace function public.chat_presence_hidden(p_hidden boolean default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v boolean;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_hidden is not null then
    insert into public.user_presence as p (user_id, hidden) values (v_uid, p_hidden)
    on conflict on constraint user_presence_pkey do update set hidden = excluded.hidden;
  end if;
  select p.hidden into v from public.user_presence p where p.user_id = v_uid;
  return coalesce(v, false);
end $$;

-- Учасники чату + коли були в мережі й до якого моменту прочитали (null — приховано)
create or replace function public.chat_room_people(p_room uuid)
returns table (user_id uuid, name text, role text, is_me boolean, is_friend boolean, blocked boolean, seen_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_hidden boolean;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  v_hidden := coalesce((select p.hidden from public.user_presence p where p.user_id = v_uid), false);
  return query
    select m.user_id, private.friend_name(m.user_id), m.role, m.user_id = v_uid, private.is_friend(v_uid, m.user_id),
           exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = m.user_id and b.removed_at is null),
           case when m.user_id = v_uid or v_hidden or coalesce(p.hidden, false) then null else p.seen_at end,
           case when m.user_id = v_uid or v_hidden or coalesce(p.hidden, false) then null else m.last_read_at end
      from public.chat_members m
      left join public.user_presence p on p.user_id = m.user_id
     where m.room_id = p_room and m.left_at is null
     order by (m.user_id = v_uid) desc, m.joined_at;
end $$;

-- «Друкує…» і «прочитано» наживо: приватні канали room:<uuid> лише для учасників
create or replace function public.chat_rt_member(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic !~ '^room:[0-9a-f-]{36}$' then return false; end if;
  return public.is_chat_member(substr(p_topic, 6)::uuid);
end $$;
revoke execute on function public.chat_rt_member(text) from public, anon;
grant execute on function public.chat_rt_member(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'chat_room_read') then
    create policy chat_room_read on realtime.messages for select to authenticated
      using (realtime.messages.extension in ('broadcast', 'presence') and public.chat_rt_member((select realtime.topic())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'chat_room_write') then
    create policy chat_room_write on realtime.messages for insert to authenticated
      with check (realtime.messages.extension in ('broadcast', 'presence') and public.chat_rt_member((select realtime.topic())));
  end if;
end $$;

-- ---------- Новини друзів у групах ----------
create table if not exists public.chat_news_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  value text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, value)
);
alter table public.chat_news_log enable row level security;   -- без політик

create or replace function public.chat_share_news(p_kind text, p_value text, p_score integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text; v_room uuid; v_msg uuid; n int := 0; v_val text := left(coalesce(p_value, ''), 40);
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if p_kind = 'streak' then
    if v_val not in ('3', '7', '14', '21', '30', '50', '75', '100', '150', '200', '300', '365', '500', '730', '1000') then return 0; end if;
  elsif p_kind = 'exam' then
    if v_val not in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1') then return 0; end if;
  elsif p_kind = 'record' then
    if v_val !~ '^(detective|rush|explain|minute|articles|samewords|build)$' or p_score is null or p_score < 1 or p_score > 100000 then return 0; end if;
    -- рекорд: не частіше раз на добу; значення — гра + рахунок (той самий рекорд двічі не публікується)
    if exists (select 1 from public.chat_news_log l where l.user_id = v_uid and l.kind = 'record' and l.created_at > now() - interval '20 hours') then return 0; end if;
    v_val := v_val || ':' || p_score;
  else
    return 0;
  end if;
  insert into public.chat_news_log (user_id, kind, value) values (v_uid, p_kind, v_val) on conflict do nothing;
  if not found then return 0; end if;
  v_name := private.friend_name(v_uid);
  for v_room in
    select m.room_id from public.chat_members m join public.chat_rooms r on r.id = m.room_id
     where m.user_id = v_uid and m.left_at is null and r.kind = 'group'
       and (select count(*) from public.chat_members x where x.room_id = m.room_id and x.left_at is null) >= 2
  loop
    insert into public.chat_messages (room_id, user_id, kind, body, meta)
    values (v_room, v_uid, 'system', '', jsonb_build_object('event', 'news', 'kind', p_kind, 'value', split_part(v_val, ':', 1), 'score', p_score, 'name', v_name))
    returning id into v_msg;
    insert into public.chat_reactions (message_id, room_id, who, user_id, kind) values (v_msg, v_room, 'tutor', null, 'bravo') on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.chat_seen(), public.chat_presence_hidden(boolean), public.chat_room_people(uuid), public.chat_share_news(text, text, integer) from public, anon;
grant execute on function public.chat_seen(), public.chat_presence_hidden(boolean), public.chat_room_people(uuid), public.chat_share_news(text, text, integer) to authenticated;
