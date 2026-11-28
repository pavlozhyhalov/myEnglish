-- 0041 · Облік фактичних токенів Gemini (2026-11-28, власник: «планую платний Gemini — маю розуміти умови, щоб закладати в ціну»).
-- Сума за день × модель × вид (text / stream / tts / live) — без ідентифікатора людини. Пишуть: функції (service role, _shared/meter.ts)
-- і клієнт голосу (add_live_tokens: Live-з'єднання йде з браузера напряму до Google, сервер токенів не бачить).
-- Читає адмінка (#/admin → «Собівартість AI», дія `costs` функції admin).

create table if not exists public.ai_tokens (
  day date not null default current_date,
  model text not null,
  kind text not null,
  calls integer not null default 0,
  in_text bigint not null default 0,
  in_audio bigint not null default 0,
  out_text bigint not null default 0,
  out_audio bigint not null default 0,
  thoughts bigint not null default 0,
  primary key (day, model, kind)
);
alter table public.ai_tokens enable row level security;
-- політик немає: читає й пише лише service role через функції нижче

create or replace function public.add_ai_tokens(p_model text, p_kind text, p_calls integer, p_in_text bigint, p_in_audio bigint,
  p_out_text bigint, p_out_audio bigint, p_thoughts bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_tokens as t (day, model, kind, calls, in_text, in_audio, out_text, out_audio, thoughts)
  values (current_date, left(p_model, 80), left(p_kind, 16), greatest(p_calls, 0), greatest(p_in_text, 0), greatest(p_in_audio, 0),
    greatest(p_out_text, 0), greatest(p_out_audio, 0), greatest(p_thoughts, 0))
  on conflict (day, model, kind) do update set
    calls = t.calls + excluded.calls, in_text = t.in_text + excluded.in_text, in_audio = t.in_audio + excluded.in_audio,
    out_text = t.out_text + excluded.out_text, out_audio = t.out_audio + excluded.out_audio, thoughts = t.thoughts + excluded.thoughts
$$;

-- голос: клієнт після розмови; лише користувач, що увійшов, і з розумною межею на одну розмову (запобіжник від сміття)
create or replace function public.add_live_tokens(p_model text, p_in_text bigint, p_in_audio bigint, p_out_text bigint, p_out_audio bigint, p_thoughts bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  if coalesce(p_model, '') !~ '^[a-z0-9.\-]{1,80}$' then return; end if;
  if greatest(p_in_text, p_in_audio, p_out_text, p_out_audio, p_thoughts) > 5000000 or least(p_in_text, p_in_audio, p_out_text, p_out_audio, p_thoughts) < 0 then return; end if;
  perform public.add_ai_tokens(p_model, 'live', 1, p_in_text, p_in_audio, p_out_text, p_out_audio, p_thoughts);
end $$;

revoke all on function public.add_ai_tokens(text, text, integer, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.add_ai_tokens(text, text, integer, bigint, bigint, bigint, bigint, bigint) to service_role;
revoke all on function public.add_live_tokens(text, bigint, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.add_live_tokens(text, bigint, bigint, bigint, bigint, bigint) to authenticated;
