-- 0025 · Чати друзів, етап 2 (2026-11-16): дуелі вдвох/групою («Детектив помилок», «Швидкий переклад») і «Тема дня» від вчителя.
-- Дуель: однакові раунди для всіх (seed), рівень — автора дуелі, 24 год на гру, зараховується лише перша спроба кожного.
-- Результати бачать лише учасники чату (RLS через RPC); у чат іде службове повідомлення з результатом (Realtime оновлює картку).
-- «Тема дня» вставляє функція push (service role) як службове повідомлення { event: 'topic' } — окремої таблиці не потрібно.
create table if not exists public.chat_duels (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  game text not null check (game in ('detective', 'rush')),
  seed integer not null,
  level text not null check (level in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1')),
  created_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists chat_duels_room on public.chat_duels (room_id, created_at desc);
alter table public.chat_duels enable row level security;

create table if not exists public.chat_duel_results (
  duel_id uuid not null references public.chat_duels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score between 0 and 100000),
  hits integer not null default 0 check (hits between 0 and 1000),
  total integer not null default 0 check (total between 0 and 1000),
  created_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);
alter table public.chat_duel_results enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_duels' and policyname = 'chat_duels_sel') then
    create policy chat_duels_sel on public.chat_duels for select to authenticated using (public.is_chat_member(room_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_duel_results' and policyname = 'chat_duel_results_sel') then
    create policy chat_duel_results_sel on public.chat_duel_results for select to authenticated
      using (exists (select 1 from public.chat_duels d where d.id = duel_id and public.is_chat_member(d.room_id)));
  end if;
end $$;

-- Нова дуель: учасник чату (у 1:1 — лише друзі без блокування), до 10 на чат за добу; картка в чаті
create or replace function public.chat_duel_create(p_room uuid, p_game text, p_level text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_other uuid; v_seed int := floor(random() * 2000000000)::int;
  v_level text := case when p_level in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1') then p_level else 'B1' end;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  if p_game not in ('detective', 'rush') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if (select r.kind from public.chat_rooms r where r.id = p_room) = 'dm' then
    select m.user_id into v_other from public.chat_members m where m.room_id = p_room and m.user_id <> v_uid limit 1;
    if v_other is null or private.chat_blocked(v_uid, v_other) then raise exception 'blocked' using errcode = '22023'; end if;
    if not private.is_friend(v_uid, v_other) then raise exception 'not_friends' using errcode = '22023'; end if;
  end if;
  if (select count(*) from public.chat_duels d where d.room_id = p_room and d.created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  insert into public.chat_duels (room_id, created_by, game, seed, level) values (p_room, v_uid, p_game, v_seed, v_level) returning id into v_id;
  insert into public.chat_messages (room_id, user_id, kind, body, meta)
  values (p_room, v_uid, 'challenge', '', jsonb_build_object('duel_id', v_id, 'game', p_game, 'level', v_level, 'seed', v_seed, 'name', private.friend_name(v_uid)));
  return v_id;
end $$;

-- Результат дуелі: лише учасник чату, лише до кінця дуелі, лише перша спроба
create or replace function public.chat_duel_submit(p_duel uuid, p_score integer, p_hits integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); d record; v_first boolean;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select * into d from public.chat_duels x where x.id = p_duel;
  if d.id is null or not public.is_chat_member(d.room_id) then raise exception 'not_member' using errcode = '22023'; end if;
  if now() > d.ends_at then raise exception 'duel_over' using errcode = '22023'; end if;
  insert into public.chat_duel_results (duel_id, user_id, score, hits, total)
  values (p_duel, v_uid, least(greatest(coalesce(p_score, 0), 0), 100000), least(greatest(coalesce(p_hits, 0), 0), 1000), least(greatest(coalesce(p_total, 0), 0), 1000))
  on conflict on constraint chat_duel_results_pkey do nothing;
  v_first := found;
  if v_first then
    perform private.chat_system(d.room_id, v_uid, jsonb_build_object('event', 'duel_score', 'duel_id', p_duel, 'game', d.game,
      'name', private.friend_name(v_uid), 'score', least(greatest(coalesce(p_score, 0), 0), 100000)));
  end if;
  return jsonb_build_object('first', v_first, 'room_id', d.room_id, 'results', public.chat_duel_results_of(p_duel));
end $$;

-- Таблиця дуелі: учасники з результатами (за спаданням), хто ще не грав — у кінці
create or replace function public.chat_duel_results_of(p_duel uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); d record;
begin
  select * into d from public.chat_duels x where x.id = p_duel;
  if d.id is null or not public.is_chat_member(d.room_id) then raise exception 'not_member' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', private.friend_name(m.user_id), 'me', m.user_id = v_uid,
            'score', r.score, 'hits', r.hits, 'total', r.total) order by r.score desc nulls last, r.created_at, m.joined_at), '[]'::jsonb)
            from public.chat_members m left join public.chat_duel_results r on r.duel_id = d.id and r.user_id = m.user_id
           where m.room_id = d.room_id and (m.left_at is null or r.user_id is not null));
end $$;

-- Дуелі чату за 7 днів
create or replace function public.chat_duels_list(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'game', d.game, 'level', d.level, 'seed', d.seed, 'ends_at', d.ends_at,
            'over', now() > d.ends_at, 'mine', d.created_by = auth.uid(), 'results', public.chat_duel_results_of(d.id)) order by d.created_at desc)
          from public.chat_duels d where d.room_id = p_room and d.created_at > now() - interval '7 days'), '[]'::jsonb);
end $$;

revoke execute on function public.chat_duel_create(uuid, text, text), public.chat_duel_submit(uuid, integer, integer, integer),
  public.chat_duel_results_of(uuid), public.chat_duels_list(uuid) from public, anon;
grant execute on function public.chat_duel_create(uuid, text, text), public.chat_duel_submit(uuid, integer, integer, integer),
  public.chat_duel_results_of(uuid), public.chat_duels_list(uuid) to authenticated;
