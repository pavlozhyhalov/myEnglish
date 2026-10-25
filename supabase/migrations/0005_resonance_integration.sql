-- Інтеграція з Resonance: час навчання за день → Resonance «Мови → English» (type 'lang', один запис на день,
-- external_id = 'myenglish:<day>'). Ключ генерується в цій базі й назовні не виходить; у Resonance — лише його sha256
-- (таблиця external_ingest_keys + RPC ingest_upsert у проєкті Resonance). Потрібне розширення pg_net.
create table if not exists public.integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  resonance_url text not null,
  resonance_apikey text not null,
  resonance_key text not null,
  resonance_item_id text not null,
  resonance_item_name text not null default 'English',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.integrations enable row level security;
-- політик немає: читають лише security definer функції нижче

-- функції в схемі private (не відкрита через API — їх не викликати ззовні)
create schema if not exists private;

create or replace function private.resonance_push_day(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.integrations; v_sec int; v_ts timestamptz;
begin
  select * into i from public.integrations where user_id = p_user and enabled;
  if not found then return; end if;
  select coalesce(sum(seconds), 0), max(ts) into v_sec, v_ts from public.sessions where user_id = p_user and day = p_day;
  perform net.http_post(
    url := i.resonance_url || '/rest/v1/rpc/ingest_upsert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', i.resonance_apikey),
    body := jsonb_build_object(
      'p_token', i.resonance_key,
      'p_external_id', 'myenglish:' || p_day::text,
      'p_type', 'lang',
      'p_duration', v_sec,
      'p_started_at', coalesce(v_ts, (p_day::timestamp + time '12:00') at time zone 'Europe/Warsaw'),
      'p_details', jsonb_build_object('item_id', i.resonance_item_id, 'name', i.resonance_item_name, 'source', 'myEnglish')
    )
  );
end $$;

create or replace function private.sessions_resonance_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform private.resonance_push_day(new.user_id, new.day); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.day is distinct from new.day) then perform private.resonance_push_day(old.user_id, old.day); end if;
  return null;
end $$;

create or replace trigger sessions_resonance after insert or update or delete on public.sessions
for each row execute function private.sessions_resonance_trg();
