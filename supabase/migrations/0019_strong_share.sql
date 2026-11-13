-- 0019 · Справедлива частка «сильних» моделей Gemini (2026-11-13, власник: «щоб Gemini вистачало на 10 людей»).
-- Безкоштовний ключ: сильні flash-моделі — ~20 запитів на день кожна, на всіх користувачів разом. Кожен користувач
-- має денну частку сильних викликів (підсумок розмови, аналіз, перевірка текстів); понад неї — lite-моделі (не відмова).
alter table public.ai_usage add column if not exists strong_calls integer not null default 0;

create or replace function public.charge_strong(p_user uuid, p_cap int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date := (now() at time zone 'Europe/Warsaw')::date; v_ok boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  insert into public.ai_usage (user_id, day) values (p_user, v_day) on conflict (user_id, day) do nothing;
  update public.ai_usage u set strong_calls = u.strong_calls + 1
   where u.user_id = p_user and u.day = v_day and u.strong_calls < p_cap
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke execute on function public.charge_strong(uuid, integer) from public, anon, authenticated;
grant execute on function public.charge_strong(uuid, integer) to service_role;
