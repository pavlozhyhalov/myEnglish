-- Журнал помилок клієнта (js/errlog.js) і агрегати для адмін-сторінки (edge-функція admin).
-- Без drop/revoke/update без where (Supabase MCP вимагає для них ручного підтвердження).

-- 1. client_errors: вставляє лише користувач, що увійшов, і лише від свого імені; читати користувачам не можна
--    (політики select немає — читає тільки service role у функції admin). Анонімні помилки лишаються на пристрої.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  build text check (char_length(build) <= 40),
  route text check (char_length(route) <= 200),
  message text not null check (char_length(message) <= 1000),
  stack text check (char_length(stack) <= 4000),
  ua text check (char_length(ua) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists client_errors_created_idx on public.client_errors (created_at);
create index if not exists client_errors_user_idx on public.client_errors (user_id, created_at);

alter table public.client_errors enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_errors' and policyname = 'client_errors_ins') then
    create policy client_errors_ins on public.client_errors for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- Перед вставкою: час і автор — лише серверні; не більше 60 записів на користувача за годину (зайві мовчки відкидаються);
-- прибирання записів, старших за 30 днів, — приблизно на кожній 20-й вставці (без pg_cron).
create or replace function private.client_errors_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  if (select count(*) from public.client_errors e where e.user_id = new.user_id and e.created_at > now() - interval '1 hour') >= 60 then
    return null;
  end if;
  if random() < 0.05 then
    delete from public.client_errors e where e.created_at < now() - interval '30 days';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'client_errors_guard' and tgrelid = 'public.client_errors'::regclass) then
    create trigger client_errors_guard before insert on public.client_errors for each row execute function private.client_errors_guard();
  end if;
end $$;

-- 2. Агрегати для адмін-сторінки. Лише service role (виклик з edge-функції admin після перевірки isAdmin).
create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 14), 1), 60);
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_from date := v_today - (v_days - 1);
  r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;

  with
  act as (   -- активність: навчальні сесії (синхронізовані) або виклики AI
    select user_id, day from public.sessions where day >= v_today - 29 and seconds > 0
    union
    select user_id, day from public.ai_usage where day >= v_today - 29
      and (text_calls > 0 or tts_calls > 0 or voice_seconds > 0 or live_tokens > 0)
  ),
  usr as (
    select u.id, u.email, u.created_at, u.last_sign_in_at,
      (select coalesce(sum(s.seconds), 0) from public.sessions s where s.user_id = u.id and s.day >= v_today - 6) as sec7,
      (select max(a.day) from act a where a.user_id = u.id) as last_active
    from auth.users u
  ),
  err as (
    select left(regexp_replace(message, '\d+', 'N', 'g'), 200) as msg,
      count(*) as n, count(distinct user_id) as users, max(created_at) as last_at,
      (array_agg(build order by created_at desc))[1] as build,
      (array_agg(route order by created_at desc))[1] as route,
      (array_agg(ua order by created_at desc))[1] as ua,
      (array_agg(left(stack, 600) order by created_at desc))[1] as stack
    from public.client_errors where created_at > now() - interval '7 days'
    group by 1 order by count(*) desc limit 20
  )
  select jsonb_build_object(
    'generated_at', now(),
    'today', v_today,
    'days', v_days,
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'signups7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'signups_today', (select count(*) from auth.users where (created_at at time zone 'Europe/Warsaw')::date = v_today),
      'active_today', (select count(distinct user_id) from act where day = v_today),
      'active7', (select count(distinct user_id) from act where day >= v_today - 6),
      'active30', (select count(distinct user_id) from act)
    ),
    'signups_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'n',
        (select count(*) from auth.users where (created_at at time zone 'Europe/Warsaw')::date = d::date)) order by d)
      from generate_series(v_from, v_today, interval '1 day') d), '[]'::jsonb),
    'active_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'n',
        (select count(distinct user_id) from act where day = d::date)) order by d)
      from generate_series(v_from, v_today, interval '1 day') d), '[]'::jsonb),
    'user_list', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at,
        'last_active', last_active, 'sec7', sec7) order by last_active desc nulls last, created_at desc)
      from (select * from usr order by last_active desc nulls last, created_at desc limit 200) x), '[]'::jsonb),
    'ai_usage', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', a.user_id, 'email', u.email, 'day', a.day, 'text_calls', a.text_calls, 'tts_calls', a.tts_calls,
        'voice_seconds', a.voice_seconds, 'live_tokens', a.live_tokens) order by a.day desc, a.text_calls desc)
      from public.ai_usage a left join auth.users u on u.id = a.user_id where a.day >= v_from), '[]'::jsonb),
    'ai_totals', (select jsonb_build_object(
        'text_today', coalesce(sum(text_calls) filter (where day = v_today), 0),
        'tts_today', coalesce(sum(tts_calls) filter (where day = v_today), 0),
        'live_today', coalesce(sum(live_tokens) filter (where day = v_today), 0),
        'voice_sec_today', coalesce(sum(voice_seconds) filter (where day = v_today), 0),
        'text7', coalesce(sum(text_calls) filter (where day >= v_today - 6), 0),
        'tts7', coalesce(sum(tts_calls) filter (where day >= v_today - 6), 0),
        'live7', coalesce(sum(live_tokens) filter (where day >= v_today - 6), 0),
        'voice_sec7', coalesce(sum(voice_seconds) filter (where day >= v_today - 6), 0))
      from public.ai_usage where day >= v_today - 6),
    'errors', jsonb_build_object(
      'total7', (select count(*) from public.client_errors where created_at > now() - interval '7 days'),
      'today', (select count(*) from public.client_errors where created_at > (v_today::timestamp at time zone 'Europe/Warsaw')),
      'top', coalesce((select jsonb_agg(to_jsonb(err) order by n desc) from err), '[]'::jsonb)
    )
  ) into r;
  return r;
end $$;
