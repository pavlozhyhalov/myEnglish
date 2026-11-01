-- Правило граматики для помилки (довідник supabase/functions/_shared/rules.ts ↔ js/rules.js): групування й засвоєння по правилу
alter table public.mistakes add column if not exists rule text;
