-- Застосунок персональний: реєструватися може лише власник; його email підтверджується одразу
-- (не потрібне посилання з листа, яке веде на Site URL за замовчуванням).
create or replace function public.owner_only_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) <> 'pavlozhyhalov@gmail.com' then
    raise exception 'Signups are disabled for this app';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;
revoke all on function public.owner_only_signup() from public, anon, authenticated;

create trigger owner_only_signup
before insert on auth.users
for each row execute function public.owner_only_signup();
