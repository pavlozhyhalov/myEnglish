-- Надійна синхронізація між пристроями:
--  * synced_at — серверний час запису; клієнт тягне зміни за ним (а не за клієнтським updated_at,
--    який у офлайн-пристрою може бути «в минулому» відносно курсора іншого пристрою);
--  * sync_guard — last-write-wins на сервері: старіший updated_at не перезаписує новіший;
--  * deleted у sessions / reviews / lessons_progress / tests — м'яке видалення доходить до інших пристроїв.

create or replace function public.sync_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at is not null and old.updated_at is not null and new.updated_at < old.updated_at then
    return null;   -- старіша версія: залишаємо серверну
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

alter table public.decks add column if not exists synced_at timestamptz not null default now();
alter table public.cards add column if not exists synced_at timestamptz not null default now();
alter table public.reviews add column if not exists synced_at timestamptz not null default now();
alter table public.lessons_progress add column if not exists synced_at timestamptz not null default now();
alter table public.mistakes add column if not exists synced_at timestamptz not null default now();
alter table public.sessions add column if not exists synced_at timestamptz not null default now();
alter table public.tutor_chats add column if not exists synced_at timestamptz not null default now();
alter table public.tests add column if not exists synced_at timestamptz not null default now();
alter table public.profiles add column if not exists synced_at timestamptz not null default now();

alter table public.sessions add column if not exists deleted boolean not null default false;
alter table public.reviews add column if not exists deleted boolean not null default false;
alter table public.lessons_progress add column if not exists deleted boolean not null default false;
alter table public.tests add column if not exists deleted boolean not null default false;

create or replace trigger decks_sync before insert or update on public.decks for each row execute function public.sync_guard();
create or replace trigger cards_sync before insert or update on public.cards for each row execute function public.sync_guard();
create or replace trigger reviews_sync before insert or update on public.reviews for each row execute function public.sync_guard();
create or replace trigger lessons_progress_sync before insert or update on public.lessons_progress for each row execute function public.sync_guard();
create or replace trigger mistakes_sync before insert or update on public.mistakes for each row execute function public.sync_guard();
create or replace trigger sessions_sync before insert or update on public.sessions for each row execute function public.sync_guard();
create or replace trigger tutor_chats_sync before insert or update on public.tutor_chats for each row execute function public.sync_guard();
create or replace trigger tests_sync before insert or update on public.tests for each row execute function public.sync_guard();
create or replace trigger profiles_sync before insert or update on public.profiles for each row execute function public.sync_guard();

create index if not exists decks_synced on public.decks (user_id, synced_at);
create index if not exists cards_synced on public.cards (user_id, synced_at);
create index if not exists reviews_synced on public.reviews (user_id, synced_at);
create index if not exists lessons_progress_synced on public.lessons_progress (user_id, synced_at);
create index if not exists mistakes_synced on public.mistakes (user_id, synced_at);
create index if not exists sessions_synced on public.sessions (user_id, synced_at);
create index if not exists tutor_chats_synced on public.tutor_chats (user_id, synced_at);
create index if not exists tests_synced on public.tests (user_id, synced_at);

-- Resonance: м'яко видалені сесії не рахуються; зміна deleted перераховує день
create or replace function private.resonance_push_day(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.integrations; v_sec int; v_ts timestamptz;
begin
  select * into i from public.integrations where user_id = p_user and enabled;
  if not found then return; end if;
  select coalesce(sum(seconds), 0), max(ts) into v_sec, v_ts from public.sessions where user_id = p_user and day = p_day and not deleted;
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
exception when others then
  raise warning 'resonance_push_day failed: %', sqlerrm;
end $$;

create or replace function private.sessions_resonance_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.seconds is not distinct from new.seconds and old.day is not distinct from new.day
     and old.deleted is not distinct from new.deleted then return null; end if;
  if tg_op in ('INSERT', 'UPDATE') then perform private.resonance_push_day(new.user_id, new.day); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.day is distinct from new.day) then perform private.resonance_push_day(old.user_id, old.day); end if;
  return null;
end $$;
