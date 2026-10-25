-- Журнал глибокої діагностики edge-функції tutor (action=health, deep=true): не частіше разу на 10 хв.
create table if not exists public.health_checks (id bigint generated always as identity primary key, ts timestamptz not null default now(), result jsonb);
alter table public.health_checks enable row level security;
-- політик немає: доступ лише через service role (edge-функції)
