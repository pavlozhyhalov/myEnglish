-- 0027 · Вчитель — учасник групи (2026-11-16, власник: «щоб вчитель спілкувався з учасниками й сварився (в міру жартуючи), що хтось не виконав завдання»).
-- Репліки вчителя — службові повідомлення { event: 'tutor', text } (вставляє лише сервер). Тут — стан класу для функцій (лише service role).
create or replace function public.chat_homework_board(p_room uuid)
returns table (user_id uuid, name text, level text, done integer, total integer, done_at timestamptz, homework_id uuid, created_at timestamptz, due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare hw record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  select * into hw from public.chat_homework h where h.room_id = p_room and h.due_at > now() order by h.created_at desc limit 1;
  if hw.id is null then return; end if;
  return query
    select t.user_id, private.friend_name(t.user_id),
           coalesce((select p.data -> 'settings' ->> 'level' from public.profiles p where p.user_id = t.user_id), 'B1'),
           (select count(*)::int from jsonb_array_elements(t.tasks) e(task)
             where private.homework_value(e.task, t.user_id, p_room, hw.created_at, now()) >= coalesce((e.task ->> 'target')::int, 1)),
           jsonb_array_length(t.tasks), t.done_at, hw.id, hw.created_at, hw.due_at
      from public.chat_homework_tasks t
      join public.chat_members m on m.room_id = p_room and m.user_id = t.user_id and m.left_at is null
     where t.homework_id = hw.id
     order by t.created_at;
end $$;
revoke execute on function public.chat_homework_board(uuid) from public, anon, authenticated;
grant execute on function public.chat_homework_board(uuid) to service_role;
