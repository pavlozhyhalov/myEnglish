-- Друзі та спільний стрік (функція 8).
-- Кожен має короткий код запрошення; додавання коду створює взаємну дружбу.
-- Друзі бачать ЛИШЕ: ім'я для друзів, поточний стрік, хвилини сьогодні й за поточний тиждень (Пн–Нд) — через friends_stats().
-- Таблиці закриті RLS (лише свої рядки на читання); усі зміни — через security definer RPC з перевіркою auth.uid().
-- Ідемпотентно: if not exists / create or replace, без drop/revoke.
-- Застосовано у production двома частинами: таблиці/політики/індекси (0012a) і допоміжні функції + my_friend_code,
-- set_friend_name, friends_stats (0012b). add_friend і remove_friend (без DELETE — м'яке видалення через removed_at)
-- та friends_stats з фільтром removed_at — у 0014_friends_soft_remove.sql.

create schema if not exists private;

-- Профіль для друзів: код, ім'я для друзів, часовий пояс (щоб «сьогодні» друга рахувалось за його днем)
create table if not exists public.friend_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  display_name text,
  tz text not null default 'Europe/Kyiv',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_code_format check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint friend_name_len check (display_name is null or char_length(display_name) between 1 and 40)
);
alter table public.friend_profiles enable row level security;

create table if not exists public.friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendship_not_self check (user_id <> friend_id)
);
create index if not exists friendships_friend on public.friendships (friend_id);
alter table public.friendships enable row level security;

-- Журнал спроб додати друга (обмеження частоти); без політик — лише для функцій
create table if not exists private.friend_attempts (
  user_id uuid not null,
  ts timestamptz not null default now()
);
create index if not exists friend_attempts_user_ts on private.friend_attempts (user_id, ts);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'friend_profiles' and policyname = 'friend_profiles_sel') then
    create policy friend_profiles_sel on public.friend_profiles for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'friendships' and policyname = 'friendships_sel') then
    create policy friendships_sel on public.friendships for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ---------- Допоміжні (схема private не відкрита через API) ----------

create or replace function private.valid_tz(p_tz text)
returns text language sql stable set search_path = '' as $$
  select coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'Europe/Kyiv');
$$;

-- Код без схожих символів (без I, O, 0, 1): 8 знаків з 32 → 2^40 варіантів
create or replace function private.new_friend_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  idx constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];   -- байти uuid v4 без службових бітів версії/варіанта
  v text; b bytea;
begin
  loop
    b := uuid_send(gen_random_uuid());                     -- криптостійкий генератор, без pgcrypto
    v := '';
    for i in 1..8 loop v := v || substr(alphabet, (get_byte(b, idx[i]) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.friend_profiles where code = v);
  end loop;
  return v;
end $$;

-- Ім'я для друзів: власне → ім'я з профілю (about.name) → нейтральне «Учень». Пошту друзям не показуємо навіть частково.
create or replace function private.friend_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select left(coalesce(
    nullif(btrim((select display_name from public.friend_profiles where user_id = p_user)), ''),
    nullif(btrim((select data -> 'about' ->> 'name' from public.profiles where user_id = p_user)), ''),
    'Учень'), 40);
$$;

-- Стрік як у js/stats.js: день зараховується від 5 хв; сьогодні ще не зараховано — рахуємо від учора
create or replace function private.streak_days(p_user uuid, p_today date)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := p_today; v_n int := 0; v_sec int;
begin
  select coalesce(sum(seconds), 0) into v_sec from public.sessions where user_id = p_user and day = p_today and not deleted;
  if v_sec < 300 then v_day := p_today - 1; end if;
  for v_sec in
    select coalesce(sum(s.seconds), 0)::int
      from generate_series(v_day::timestamp, (p_today - 730)::timestamp, interval '-1 day') g(d)
      left join public.sessions s on s.user_id = p_user and s.day = g.d::date and not s.deleted
     group by g.d order by g.d desc
  loop
    exit when v_sec < 300;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------- RPC для клієнта ----------

-- Мій код (створюється за першого виклику) та ім'я для друзів. p_tz — часовий пояс пристрою.
create or replace function public.my_friend_code(p_tz text default null)
returns table (code text, display_name text, default_name text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  insert into public.friend_profiles (user_id, code, tz)
  values (v_uid, private.new_friend_code(), private.valid_tz(p_tz))
  on conflict (user_id) do nothing;
  if p_tz is not null then
    update public.friend_profiles f set tz = private.valid_tz(p_tz), updated_at = now()
     where f.user_id = v_uid and f.tz is distinct from private.valid_tz(p_tz);
  end if;
  return query
    select f.code, f.display_name,
           left(coalesce(nullif(btrim((select p.data -> 'about' ->> 'name' from public.profiles p where p.user_id = v_uid)), ''), 'Учень'), 40)
      from public.friend_profiles f where f.user_id = v_uid;
end $$;

-- Ім'я, яке бачать друзі (порожнє — за замовчуванням із профілю)
create or replace function public.set_friend_name(p_name text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text := nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), 40), '');
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  perform public.my_friend_code(null);
  update public.friend_profiles f set display_name = v_name, updated_at = now() where f.user_id = v_uid;
  return private.friend_name(v_uid);
end $$;

-- Статистика друзів (перша версія; 0014 замінює її фільтром removed_at is null): лише ім'я, стрік, секунди сьогодні та за тиждень (Пн–Нд) — за днем друга в його часовому поясі
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
        from public.friendships x where x.user_id = v_uid
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
