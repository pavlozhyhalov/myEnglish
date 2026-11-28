-- 0042 · Місячний бюджет AI на людину й захист від використання вчителя не за призначенням
-- (2026-11-28, власник: «ліміти з використання платних токенів — можна юзати безперервно; захист, щоб не використовували ШІ як безкоштовний варіант для своїх цілей»).
-- cost_micros — фактична вартість текстових викликів і озвучення за токенами (рахує сервер, _shared/meter.ts), мільйонні долара;
-- live_issued — секунди голосу, на які видано токени Live (сервер; клієнт не може це занизити);
-- offtopic — запити не про англійську за день (після межі вчитель відповідає шаблоном без AI).
alter table public.ai_usage add column if not exists cost_micros bigint not null default 0;
alter table public.ai_usage add column if not exists live_issued integer not null default 0;
alter table public.ai_usage add column if not exists offtopic integer not null default 0;

create or replace function public.add_user_cost(p_user uuid, p_micros bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  if p_micros is null or p_micros <= 0 then return; end if;
  insert into public.ai_usage (user_id, day, cost_micros) values (p_user, v_day, least(p_micros, 50000000))
  on conflict (user_id, day) do update set cost_micros = public.ai_usage.cost_micros + excluded.cost_micros;
end $$;

-- Сума за поточний місяць (за київським/варшавським днем, як денні ліміти)
create or replace function public.ai_month(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date; r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  select jsonb_build_object(
      'cost_micros', coalesce(sum(cost_micros), 0),
      'voice_seconds', coalesce(sum(voice_seconds), 0),
      'live_issued', coalesce(sum(live_issued), 0),
      'voice_billed', coalesce(sum(greatest(voice_seconds, live_issued / 3)), 0),
      'text_calls', coalesce(sum(text_calls), 0))
    into r
    from public.ai_usage
   where user_id = p_user and day >= date_trunc('month', v_day)::date and day <= v_day;
  return r;
end $$;

-- Видати токен голосу на p_sec секунд, якщо за день видано менше p_cap секунд (атомарно)
create or replace function public.charge_live_issue(p_user uuid, p_sec int, p_cap int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date; v_ok boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.ai_usage (user_id, day) values (p_user, v_day) on conflict (user_id, day) do nothing;
  update public.ai_usage u set live_issued = u.live_issued + greatest(p_sec, 0)
   where u.user_id = p_user and u.day = v_day and u.live_issued < p_cap
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.bump_offtopic(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date; v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.ai_usage (user_id, day, offtopic) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set offtopic = public.ai_usage.offtopic + 1
  returning offtopic into v_n;
  return v_n;
end $$;

revoke execute on function public.add_user_cost(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.ai_month(uuid) from public, anon, authenticated;
revoke execute on function public.charge_live_issue(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.bump_offtopic(uuid) from public, anon, authenticated;
grant execute on function public.add_user_cost(uuid, bigint) to service_role;
grant execute on function public.ai_month(uuid) to service_role;
grant execute on function public.charge_live_issue(uuid, integer, integer) to service_role;
grant execute on function public.bump_offtopic(uuid) to service_role;
