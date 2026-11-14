-- 0020 · Адмін-сторінка: активність кожного зареєстрованого користувача (2026-11-14, власник: «Що по активності зареєстрованих осіб?»).
-- Лише агрегати: ім'я з профілю або частина email до «@» (повний email не віддається), дати, хвилини, рівень, лічильники.
-- Вміст розмов, тексти помилок і карток не читаються. Тестові акаунти (@myenglish.test) не враховуються.
-- Виклик — лише service role (edge-функція `admin` після перевірки ALLOWED_USERS), як admin_stats (0013).
create or replace function public.admin_users()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;

  with
  real_users as (
    select u.id, u.email, u.created_at from auth.users u
     where coalesce(u.email, '') not ilike '%@myenglish.test'
  ),
  ses as (
    select s.user_id, s.day, s.type, s.seconds from public.sessions s
      join real_users ru on ru.id = s.user_id
     where s.seconds > 0 and not coalesce(s.deleted, false)
  ),
  aiu as (
    select a.* from public.ai_usage a join real_users ru on ru.id = a.user_id
  ),
  act as (
    select user_id, day from ses
    union
    select user_id, day from aiu where text_calls > 0 or tts_calls > 0 or voice_seconds > 0 or live_tokens > 0
  ),
  per as (
    select ru.id, ru.email, ru.created_at,
      p.data as pdata,
      (select max(a.day) from act a where a.user_id = ru.id) as last_active,
      (select coalesce(sum(s.seconds), 0) from ses s where s.user_id = ru.id) as sec_total,
      (select coalesce(sum(s.seconds), 0) from ses s where s.user_id = ru.id and s.day >= v_today - 6) as sec7,
      (select jsonb_agg(coalesce((select sum(s.seconds) from ses s where s.user_id = ru.id and s.day = d::date), 0) order by d)
         from generate_series(v_today - 6, v_today, interval '1 day') d) as days7,
      (select coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'sec', t.sec, 'sec7', t.sec7) order by t.sec7 desc, t.sec desc), '[]'::jsonb)
         from (select s.type, sum(s.seconds) as sec, coalesce(sum(s.seconds) filter (where s.day >= v_today - 6), 0) as sec7
                 from ses s where s.user_id = ru.id group by s.type) t) as by_type,
      (select count(*) from public.tutor_chats c where c.user_id = ru.id and c.mode = 'voice' and not c.deleted
          and c.created_at > now() - interval '7 days') as voice7,
      (select count(*) from public.tutor_chats c where c.user_id = ru.id and c.mode = 'voice' and not c.deleted) as voice_total,
      (select jsonb_build_object('level', coalesce(t.scores->>'overall', t.scores->>'level'), 'at', t.created_at)
         from public.tests t where t.user_id = ru.id and t.type = 'placement' order by t.created_at desc limit 1) as placement,
      exists (select 1 from public.push_subscriptions ps where ps.user_id = ru.id and ps.enabled) as push,
      (select count(*) from public.cards c where c.user_id = ru.id and not c.deleted and c.state = 2) as cards_learned,
      (select count(*) from public.cards c where c.user_id = ru.id and not c.deleted) as cards_total,
      (select count(*) from public.lessons_progress l where l.user_id = ru.id and l.completed_at is not null) as lessons_done,
      (select count(*) from public.mistakes m where m.user_id = ru.id and not m.deleted and not m.resolved) as mistakes_open,
      (select count(*) from public.mistakes m where m.user_id = ru.id and not m.deleted and m.resolved) as mistakes_closed,
      (select jsonb_build_object('text', a.text_calls, 'strong', a.strong_calls, 'voice_sec', a.voice_seconds, 'tts', a.tts_calls, 'live', a.live_tokens)
         from aiu a where a.user_id = ru.id and a.day = v_today) as ai_today
    from real_users ru left join public.profiles p on p.user_id = ru.id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'today', v_today,
    'summary', jsonb_build_object(
      'total', (select count(*) from real_users),
      'active_today', (select count(distinct user_id) from act where day = v_today),
      'active7', (select count(distinct user_id) from act where day >= v_today - 6),
      'new7', (select count(*) from real_users where created_at > now() - interval '7 days'),
      'sec7', (select coalesce(sum(seconds), 0) from ses where day >= v_today - 6),
      'ai_today', (select jsonb_build_object(
          'text', coalesce(sum(text_calls), 0), 'strong', coalesce(sum(strong_calls), 0),
          'voice_sec', coalesce(sum(voice_seconds), 0), 'tts', coalesce(sum(tts_calls), 0), 'live', coalesce(sum(live_tokens), 0),
          'users', count(*) filter (where text_calls > 0 or voice_seconds > 0 or tts_calls > 0))
        from aiu where day = v_today)
    ),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'name', coalesce(nullif(btrim(left(x.pdata->'about'->>'name', 40)), ''), split_part(coalesce(x.email, ''), '@', 1)),
        'created_at', x.created_at,
        'last_active', x.last_active,
        'sec7', x.sec7, 'sec_total', x.sec_total, 'days7', x.days7, 'by_type', x.by_type,
        'level', coalesce(x.pdata->'settings'->>'level', x.pdata->>'level'),
        'level_source', x.pdata->>'levelSource',
        'placement', x.placement,
        'voice7', x.voice7, 'voice_total', x.voice_total,
        'push', x.push,
        'onboarded', coalesce(x.pdata->'onboarded', x.pdata->'settings'->'onboarded'),
        'cards_learned', x.cards_learned, 'cards_total', x.cards_total,
        'lessons_done', x.lessons_done,
        'mistakes_open', x.mistakes_open, 'mistakes_closed', x.mistakes_closed,
        'ai_today', x.ai_today
      ) order by x.last_active desc nulls last, x.created_at desc) from per x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function public.admin_users() from public, anon, authenticated;
grant execute on function public.admin_users() to service_role;
