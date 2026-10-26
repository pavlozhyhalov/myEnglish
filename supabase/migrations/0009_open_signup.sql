-- Реєстрація відкрита для всіх (рішення власника 2026-10-26: «тут буде небагато людей»).
-- Email підтверджується одразу: вбудована пошта Supabase надсилає листи лише учасникам команди проєкту,
-- тож лист-підтвердження іншим людям не дійде. Захист від масових реєстрацій — не більше 10 нових акаунтів за добу.
-- Назва функції лишається старою (тригер owner_only_signup уже прив'язаний до неї).
create or replace function public.owner_only_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from auth.users where created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Too many signups today, try again tomorrow';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;
