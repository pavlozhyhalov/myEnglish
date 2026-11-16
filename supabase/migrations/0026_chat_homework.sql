-- 0026 · Домашнє завдання від вчителя в групах (2026-11-16, власник: «як в школі, але індивідуальні — у всіх різні рівні»).
-- Одне домашнє на групу (тиждень), у кожного учасника свої 3 завдання (рівень, слабкі правила, слова, інтереси) — генерує функція
-- (tutor `homework` на запит учасника або push щопонеділка) через service role. Завдання бачить лише власник (RLS); клас бачить лише «N з 3».
-- Виконання рахує сервер: write — англійські слова в групі, speak — секунди голосових у групі, lesson — урок ≥ 80% після видачі, words — повторені картки.
create table if not exists public.chat_homework (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '7 days'
);
create index if not exists chat_homework_room on public.chat_homework (room_id, created_at desc);
alter table public.chat_homework enable row level security;

create table if not exists public.chat_homework_tasks (
  homework_id uuid not null references public.chat_homework(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '',
  tasks jsonb not null default '[]'::jsonb,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (homework_id, user_id)
);
alter table public.chat_homework_tasks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_homework' and policyname = 'chat_homework_sel') then
    create policy chat_homework_sel on public.chat_homework for select to authenticated using (public.is_chat_member(room_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_homework_tasks' and policyname = 'chat_homework_tasks_sel') then
    create policy chat_homework_tasks_sel on public.chat_homework_tasks for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

-- Значення одного завдання за період (лише числа)
create or replace function private.homework_value(p_task jsonb, p_user uuid, p_room uuid, p_from timestamptz, p_to timestamptz)
returns integer language sql stable security definer set search_path = '' as $$
  select case p_task ->> 'kind'
    when 'write' then (select coalesce(sum(cardinality(regexp_split_to_array(btrim(x.body), '\s+'))), 0)::int from public.chat_messages x
                        where x.room_id = p_room and x.user_id = p_user and x.kind = 'text' and x.deleted_at is null
                          and x.body ~ '[A-Za-z]' and x.created_at between p_from and p_to)
    when 'speak' then (select coalesce(round(sum(coalesce((x.meta ->> 'dur')::numeric, 0))), 0)::int from public.chat_messages x
                        where x.room_id = p_room and x.user_id = p_user and x.kind = 'voice' and x.deleted_at is null and x.created_at between p_from and p_to)
    when 'lesson' then (select case when exists (select 1 from public.lessons_progress l where l.user_id = p_user and l.id = p_task ->> 'lesson_id'
                          and not l.deleted and l.updated_at between p_from and p_to and coalesce(l.last_score, 0) >= 80) then 1 else 0 end)
    when 'words' then (select count(*)::int from public.cards c where c.user_id = p_user and not c.deleted and coalesce(c.reps, 0) > 0
                        and c.last_review between p_from and p_to)
    else 0 end;
$$;

-- Стан домашнього в групі: найновіше за 14 днів — мої завдання з прогресом і клас (лише «виконано N з M»)
create or replace function public.chat_homework_status(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); hw record; v_to timestamptz;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  if not public.is_chat_member(p_room) then raise exception 'not_member' using errcode = '22023'; end if;
  select * into hw from public.chat_homework h where h.room_id = p_room and h.created_at > now() - interval '14 days' order by h.created_at desc limit 1;
  if hw.id is null then return null; end if;
  v_to := least(now(), hw.due_at);
  return jsonb_build_object(
    'id', hw.id, 'created_at', hw.created_at, 'due_at', hw.due_at, 'over', now() > hw.due_at,
    'mine', (select jsonb_build_object('note', t.note, 'done_at', t.done_at, 'tasks',
               (select coalesce(jsonb_agg(e.task || jsonb_build_object('value', private.homework_value(e.task, v_uid, p_room, hw.created_at, v_to)) order by e.i), '[]'::jsonb)
                  from jsonb_array_elements(t.tasks) with ordinality e(task, i)))
             from public.chat_homework_tasks t where t.homework_id = hw.id and t.user_id = v_uid),
    'class', (select coalesce(jsonb_agg(jsonb_build_object('name', private.friend_name(t.user_id), 'me', t.user_id = v_uid,
                'done', (select count(*) from jsonb_array_elements(t.tasks) e(task)
                          where private.homework_value(e.task, t.user_id, p_room, hw.created_at, v_to) >= coalesce((e.task ->> 'target')::int, 1)),
                'total', jsonb_array_length(t.tasks)) order by t.created_at), '[]'::jsonb)
              from public.chat_homework_tasks t join public.chat_members m on m.room_id = p_room and m.user_id = t.user_id and m.left_at is null
             where t.homework_id = hw.id));
end $$;

-- «Виконав(-ла) домашнє»: сервер перевіряє всі завдання й один раз пише про це в групу
create or replace function public.chat_homework_done(p_homework uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); hw record; t record; v_ok boolean;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select * into hw from public.chat_homework h where h.id = p_homework;
  if hw.id is null or not public.is_chat_member(hw.room_id) or now() > hw.due_at then return false; end if;
  select * into t from public.chat_homework_tasks x where x.homework_id = hw.id and x.user_id = v_uid;
  if t.user_id is null or t.done_at is not null then return false; end if;
  select bool_and(private.homework_value(e.task, v_uid, hw.room_id, hw.created_at, now()) >= coalesce((e.task ->> 'target')::int, 1)) into v_ok
    from jsonb_array_elements(t.tasks) e(task);
  if not coalesce(v_ok, false) then return false; end if;
  update public.chat_homework_tasks x set done_at = now() where x.homework_id = hw.id and x.user_id = v_uid and x.done_at is null;
  perform private.chat_system(hw.room_id, v_uid, jsonb_build_object('event', 'homework_done', 'homework_id', hw.id, 'name', private.friend_name(v_uid)));
  return true;
end $$;

-- Для функції push: хто не встигає з домашнім (термін — до 30 год), лише service role
create or replace function public.chat_homework_laggards()
returns table (user_id uuid, room_id uuid, room_title text, left_tasks integer, due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return query
    select t.user_id, h.room_id, r.title,
           (select count(*)::int from jsonb_array_elements(t.tasks) e(task)
             where private.homework_value(e.task, t.user_id, h.room_id, h.created_at, now()) < coalesce((e.task ->> 'target')::int, 1)),
           h.due_at
      from public.chat_homework h
      join public.chat_homework_tasks t on t.homework_id = h.id and t.done_at is null
      join public.chat_members m on m.room_id = h.room_id and m.user_id = t.user_id and m.left_at is null and not m.muted
      join public.chat_rooms r on r.id = h.room_id
     where h.due_at > now() and h.due_at < now() + interval '30 hours';
end $$;

revoke execute on function public.chat_homework_laggards() from public, anon, authenticated;
grant execute on function public.chat_homework_laggards() to service_role;
revoke execute on function public.chat_homework_status(uuid), public.chat_homework_done(uuid) from public, anon;
grant execute on function public.chat_homework_status(uuid), public.chat_homework_done(uuid) to authenticated;
