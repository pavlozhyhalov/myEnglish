-- myEnglish: початкова схема.
-- Ідентифікатори записів — текст, генеруються на клієнті (uuid або детерміновані
-- для стартових карток: "cnc:12"), первинний ключ (user_id, id).
-- updated_at ставить клієнт — синхронізація last-write-wins.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb,       -- рівень, ціль, налаштування, меню швидкого доступу
  updated_at timestamptz not null default now()
);

create table public.decks (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  name text not null,
  enabled boolean not null default true,
  builtin boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table public.cards (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  deck_id text not null,
  en text not null,
  uk text not null default '',
  ipa text,
  pos text,
  examples jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  extra jsonb not null default '{}'::jsonb,      -- колокації, синоніми, cefr
  -- стан FSRS
  due timestamptz,
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days integer not null default 0,
  scheduled_days integer not null default 0,
  learning_steps integer not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  state smallint not null default 0,
  last_review timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);
create index cards_due_idx on public.cards (user_id, due);

create table public.reviews (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  card_id text not null,
  rating smallint not null,
  state smallint,
  ts timestamptz not null default now(),
  elapsed integer,                               -- мс на відповідь
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index reviews_ts_idx on public.reviews (user_id, ts);

create table public.lessons_progress (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,                              -- id уроку граматики
  best integer not null default 0,               -- найкращий результат, %
  last_score integer not null default 0,
  attempts integer not null default 0,
  completed_at timestamptz,
  next_review timestamptz,
  review_stage smallint not null default 0,      -- 0 → повтор через 7 дн, 1 → через 30 дн, 2 → готово
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.mistakes (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  wrong text not null,
  "right" text not null,
  type text not null default 'other',
  explanation_uk text,
  source text not null default 'tutor',          -- tutor | test | exercise
  count integer not null default 1,
  streak integer not null default 0,             -- правильних застосувань поспіль
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table public.sessions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  type text not null,                            -- cards | grammar | tutor | voice | listening | ...
  seconds integer not null default 0,
  xp integer not null default 0,
  day date not null,
  ts timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index sessions_day_idx on public.sessions (user_id, day);

create table public.tutor_chats (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  mode text not null,
  scenario text,
  title text,
  messages jsonb,                                -- повний текст, чиститься через 30 днів
  summary jsonb,                                 -- зберігається назавжди
  seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table public.tests (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  type text not null,                            -- placement | lesson | weekly
  ref text,
  scores jsonb not null default '{}'::jsonb,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  text_calls integer not null default 0,
  voice_seconds integer not null default 0,
  tts_calls integer not null default 0,
  primary key (user_id, day)
);

-- RLS: кожен бачить і змінює лише свої рядки
do $$
declare t text;
begin
  foreach t in array array['profiles','decks','cards','reviews','lessons_progress','mistakes','sessions','tutor_chats','tests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t||'_del', t);
  end loop;
end $$;

-- ai_usage: читати можна, писати — лише edge-функції (service role)
alter table public.ai_usage enable row level security;
create policy ai_usage_sel on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

-- Атомарний інкремент лічильника (викликається з edge-функцій service role)
create or replace function public.bump_ai_usage(p_user uuid, p_text int, p_voice int, p_tts int)
returns public.ai_usage
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage as u (user_id, day, text_calls, voice_seconds, tts_calls)
  values (p_user, (now() at time zone 'Europe/Warsaw')::date, p_text, p_voice, p_tts)
  on conflict (user_id, day) do update
    set text_calls = u.text_calls + excluded.text_calls,
        voice_seconds = u.voice_seconds + excluded.voice_seconds,
        tts_calls = u.tts_calls + excluded.tts_calls
  returning u.*;
$$;
revoke all on function public.bump_ai_usage(uuid,int,int,int) from public, anon, authenticated;

-- Повний текст розмов старше 30 днів прибирається, підсумок лишається
create or replace function public.purge_old_chats()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tutor_chats set messages = null, updated_at = now()
  where messages is not null and created_at < now() - interval '30 days';
$$;
revoke all on function public.purge_old_chats() from public, anon, authenticated;

-- Кеш озвучки Gemini TTS
insert into storage.buckets (id, name, public) values ('tts', 'tts', false)
on conflict (id) do nothing;
