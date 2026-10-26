-- Посилення бекенду за результатами рев'ю.
-- Без drop/revoke (Supabase MCP вимагає для них ручного підтвердження): доступ обмежено перевіркою ролі всередині функцій.

-- 1. Атомарний облік AI-лімітів: перевірка й списання однією операцією (без гонки паралельних запитів)
alter table public.ai_usage add column if not exists live_tokens integer not null default 0;

create or replace function public.charge_ai_usage(p_user uuid, p_text int, p_voice int, p_tts int, p_live int,
  p_lim_text int, p_lim_voice int, p_lim_tts int, p_lim_live int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date; v_ok boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.ai_usage (user_id, day) values (p_user, v_day) on conflict (user_id, day) do nothing;
  update public.ai_usage u
     set text_calls = u.text_calls + p_text, voice_seconds = u.voice_seconds + p_voice,
         tts_calls = u.tts_calls + p_tts, live_tokens = u.live_tokens + p_live
   where u.user_id = p_user and u.day = v_day
     and (p_text = 0 or u.text_calls < p_lim_text)
     and (p_tts = 0 or u.tts_calls < p_lim_tts)
     and (p_live = 0 or (u.live_tokens < p_lim_live and u.voice_seconds < p_lim_voice))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- 2. Глибока діагностика: слот займається до запуску перевірок (не частіше разу на 10 хв, навіть при паралельних запитах)
create or replace function public.claim_health_slot()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(7340021);
  if exists (select 1 from public.health_checks where ts > now() - interval '10 minutes') then return null; end if;
  insert into public.health_checks (result) values ('{"status":"running"}'::jsonb) returning id into v_id;
  return v_id;
end $$;

-- 3. Resonance: збій інтеграції ніколи не ламає запис сесії; незмінені рядки (повторна синхронізація) не шлють запитів
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
exception when others then
  raise warning 'resonance_push_day failed: %', sqlerrm;
end $$;

create or replace function private.sessions_resonance_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.seconds is not distinct from new.seconds and old.day is not distinct from new.day then return null; end if;
  if tg_op in ('INSERT', 'UPDATE') then perform private.resonance_push_day(new.user_id, new.day); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.day is distinct from new.day) then perform private.resonance_push_day(old.user_id, old.day); end if;
  return null;
end $$;
