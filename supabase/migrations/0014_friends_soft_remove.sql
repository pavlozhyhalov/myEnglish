-- Друзі: додавання й м'яке видалення дружби (removed_at) + службові ключі функції push.
-- Лише create or replace / if not exists і update з явним where: Supabase MCP просить ручного підтвердження для руйнівних команд.
-- Ідемпотентно: if not exists / create or replace.

-- ---------- 1. Дружба: м'яке видалення ----------
alter table public.friendships add column if not exists removed_at timestamptz;
create index if not exists friendships_active on public.friendships (user_id) where removed_at is null;

-- Додати друга за кодом: взаємна дружба (повторне додавання після видалення — відновлює її).
-- Обмеження: 20 спроб за годину, до 100 активних друзів, не себе.
-- Помилки повертаються полем status (а не винятком): виняток відкотив би й запис спроби, і ліміт не працював би.
-- status: ok | not_found | self | rate_limited | too_many_friends
-- Журнал спроб не чиститься: рахуються лише спроби за останню годину (індекс user_id, ts), рядків щонайбільше 20 на годину на людину.
create or replace function public.add_friend(p_code text)
returns table (friend_id uuid, name text, status text)
language plpgsql security definer set search_path = '' as $$
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
  on conflict (user_id, friend_id) do update set removed_at = null, created_at = now()
   where x.removed_at is not null;   -- активна дружба лишається з початковою датою
  return query select v_friend, private.friend_name(v_friend), 'ok'::text;
end $$;

-- Прибрати друга (в обидва боки): позначка removed_at
create or replace function public.remove_friend(p_friend uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  update public.friendships x set removed_at = now()
   where x.removed_at is null
     and ((x.user_id = v_uid and x.friend_id = p_friend) or (x.user_id = p_friend and x.friend_id = v_uid));
  return found;
end $$;

-- Статистика друзів: лише ім'я, стрік, секунди сьогодні та за тиждень (Пн–Нд) — за днем друга в його часовому поясі.
-- Лише активна дружба (removed_at is null).
create or replace function public.friends_stats()
returns table (friend_id uuid, name text, streak integer, today_seconds integer, week_seconds integer, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return query
    with fr as (
      select x.friend_id as fid, x.created_at,
             (now() at time zone coalesce((select fp.tz from public.friend_profiles fp where fp.user_id = x.friend_id), 'Europe/Kyiv'))::date as today
        from public.friendships x where x.user_id = v_uid and x.removed_at is null
    )
    select fr.fid,
           private.friend_name(fr.fid),
           private.streak_days(fr.fid, fr.today),
           coalesce((select sum(s.seconds) from public.sessions s where s.user_id = fr.fid and s.day = fr.today and not s.deleted), 0)::int,
           coalesce((select sum(s.seconds) from public.sessions s
                      where s.user_id = fr.fid and not s.deleted
                        and s.day between date_trunc('week', fr.today)::date and fr.today), 0)::int,
           fr.created_at
      from fr
     order by 3 desc, 5 desc;
end $$;

-- ---------- 2. Функція push: ключі VAPID і секрет cron без ручних секретів ----------
-- app_keys: службові ключі (VAPID). RLS увімкнено, політик немає — читає й пише лише service role (обходить RLS).
create table if not exists public.app_keys (
  id text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_keys enable row level security;

-- Секрет заголовка x-cron-secret: значення генерується в базі й назовні не виходить (лише функції push через service role)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_cron_secret', 'myEnglish: x-cron-secret для функції push');
  end if;
end $$;

create or replace function public.push_cron_secret()
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1);
end $$;
