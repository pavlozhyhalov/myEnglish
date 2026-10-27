-- Web Push нагадування (функція 3).
-- Клієнт зберігає підписку PushManager у push_subscriptions (лише свої рядки, RLS).
-- pg_cron кожні 15 хв викликає edge-функцію `push` (net.http_post) із заголовком x-cron-secret;
-- значення секрету — у Supabase Vault (`push_cron_secret`), те саме значення — у секреті функції CRON_SECRET.
-- Ідемпотентно: if not exists / create or replace, без drop/revoke.
--
-- Після застосування (один раз, вручну, значення НЕ комітити):
--   select vault.create_secret('<випадковий рядок 32+ символи>', 'push_cron_secret', 'myEnglish: x-cron-secret для функції push');
--   + секрет функції CRON_SECRET з тим самим значенням.
-- Змінити значення: select vault.update_secret((select id from vault.secrets where name = 'push_cron_secret'), '<нове>');

create extension if not exists pg_net;          -- уже ввімкнено для Resonance (0005); тут — про всяк випадок
create extension if not exists pg_cron;         -- на Supabase створює схему cron
create extension if not exists supabase_vault;  -- на Supabase ввімкнено за замовчуванням

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  keys jsonb not null default '{}'::jsonb,                    -- { p256dh, auth } з PushSubscription.toJSON()
  tz text not null default 'Europe/Kyiv',                     -- IANA, з Intl.DateTimeFormat().resolvedOptions().timeZone
  remind_at time not null default '19:00',
  kinds jsonb not null default '{"cards": true, "streak": true}'::jsonb,
  enabled boolean not null default true,
  last_sent_day date,                                         -- локальний (tz) день останнього надсилання
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint like 'https://%' and length(endpoint) <= 1024)
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_enabled on public.push_subscriptions (enabled) where enabled;

alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_sel') then
    create policy push_subscriptions_sel on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_ins') then
    create policy push_subscriptions_ins on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_upd') then
    create policy push_subscriptions_upd on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_del') then
    create policy push_subscriptions_del on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Перевірка полів на сервері: невідомий часовий пояс → Europe/Kyiv; kinds — лише відомі ключі; updated_at — серверний час
create or replace function public.push_subscriptions_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then
    new.tz := 'Europe/Kyiv';
  end if;
  new.kinds := jsonb_build_object(
    'cards', coalesce((new.kinds ->> 'cards')::boolean, true),
    'streak', coalesce((new.kinds ->> 'streak')::boolean, true));
  if jsonb_typeof(new.keys) <> 'object' or length(new.keys::text) > 512 then
    raise exception 'bad push keys';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace trigger push_subscriptions_check before insert or update on public.push_subscriptions
for each row execute function public.push_subscriptions_check();

-- Не більше 10 підписок на користувача (пристрої/браузери)
create or replace function public.push_subscriptions_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- upsert наявної кінцевої точки (BEFORE INSERT спрацьовує й тоді) — не рахуємо
  if exists (select 1 from public.push_subscriptions where endpoint = new.endpoint) then return new; end if;
  if (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'too many push subscriptions';
  end if;
  return new;
end $$;

create or replace trigger push_subscriptions_limit before insert on public.push_subscriptions
for each row execute function public.push_subscriptions_limit();

-- Розклад: кожні 15 хв. cron.schedule з тією самою назвою оновлює наявне завдання (pg_cron ≥ 1.4).
-- Секрет читається з Vault у момент виклику; якщо його ще немає — заголовок порожній і функція відповість 401.
select cron.schedule(
  'myenglish-push-reminders',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
