-- 2026-11-23 · Помилки, які учень уже вжив правильно в розмовах (власник: «проведи аналіз у всіх — може, ми вже закрили якісь помилки»).
-- Відкрита помилка закривається, якщо її правильна форма (≥ 2 слова) трапилась у власній репліці учня
-- (розмови з вчителем + переписка з друзями) ПІСЛЯ появи помилки, не в розмові, де її зроблено,
-- у репліці без помилкової форми, і після цього помилкову форму він більше не вживав.
-- Видалення немає: resolved = true, серія = 2 (як після двох правильних), updated_at = now() — клієнти підтягнуть зміну синхронізацією.
create or replace function private.close_mistakes_by_usage()
returns table (user_id uuid, closed int)
language sql
security definer
set search_path = public
as $$
  with lines as (
    select c.user_id, c.id as src, c.created_at as at,
      ' ' || regexp_replace(lower(replace(replace(m->>'text', '’', ''''), 'ʼ', '''')), '[^a-z'']+', ' ', 'g') || ' ' as t
    from public.tutor_chats c,
      jsonb_array_elements(case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end) m
    where not c.deleted and m->>'role' = 'user' and coalesce((m->>'cue')::boolean, false) = false
    union all
    select cm.user_id, cm.id::text, cm.created_at,
      ' ' || regexp_replace(lower(replace(replace(cm.body, '’', ''''), 'ʼ', '''')), '[^a-z'']+', ' ', 'g') || ' '
    from public.chat_messages cm
    where cm.deleted_at is null and cm.kind in ('text', 'voice') and cm.body is not null and cm.user_id is not null
  ), mk as (
    select m.user_id, m.id, m.ref, m.created_at,
      ' ' || trim(regexp_replace(lower(replace(m."right", '’', '''')), '[^a-z'']+', ' ', 'g')) || ' ' as r,
      ' ' || trim(regexp_replace(lower(replace(m.wrong, '’', '''')), '[^a-z'']+', ' ', 'g')) || ' ' as w
    from public.mistakes m
    where not m.deleted and not m.resolved
  ), agg as (
    select mk.user_id, mk.id,
      max(l.at) filter (where position(mk.r in l.t) > 0 and position(mk.w in l.t) = 0) as good_at,
      max(l.at) filter (where length(trim(mk.w)) > 0 and position(mk.w in l.t) > 0) as bad_at
    from mk
    join lines l on l.user_id = mk.user_id and l.at > mk.created_at and l.src is distinct from mk.ref
    where array_length(regexp_split_to_array(trim(mk.r), ' '), 1) >= 2
    group by mk.user_id, mk.id
  ), upd as (
    update public.mistakes m
       set resolved = true, streak = greatest(coalesce(m.streak, 0), 2), updated_at = now()
      from agg
     where m.user_id = agg.user_id and m.id = agg.id
       and agg.good_at is not null and (agg.bad_at is null or agg.bad_at < agg.good_at)
       and not m.resolved and not m.deleted
    returning m.user_id
  )
  select upd.user_id, count(*)::int from upd group by upd.user_id;
$$;
revoke all on function private.close_mistakes_by_usage() from public, anon, authenticated;
