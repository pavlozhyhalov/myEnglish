-- Картки: порожні (null) службові поля FSRS замінюються типовими значеннями, а не відхиляють усю пачку синхронізації.
-- Причина (2026-11-04): «Повернути до вивчення» для слова, що ще не вчилось, відновлювало попередній стан з null у elapsed_days тощо,
-- і upsert карток падав з 400 (not-null) — нові картки з розмови не доходили на сервер.
-- NOT NULL перевіряється після BEFORE-тригерів, тож тригер «лікує» рядок і для старих версій застосунку.
create or replace function public.cards_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.uk := coalesce(new.uk, '');
  new.examples := coalesce(new.examples, '[]'::jsonb);
  new.tags := coalesce(new.tags, '{}'::text[]);
  new.extra := coalesce(new.extra, '{}'::jsonb);
  new.stability := coalesce(new.stability, 0);
  new.difficulty := coalesce(new.difficulty, 0);
  new.elapsed_days := coalesce(new.elapsed_days, 0);
  new.scheduled_days := coalesce(new.scheduled_days, 0);
  new.learning_steps := coalesce(new.learning_steps, 0);
  new.reps := coalesce(new.reps, 0);
  new.lapses := coalesce(new.lapses, 0);
  new.state := coalesce(new.state, 0);
  new.deleted := coalesce(new.deleted, false);
  return new;
end;
$$;

create or replace trigger cards_fill_defaults before insert or update on public.cards
  for each row execute function public.cards_fill_defaults();
