-- 0028 · Дзвіночок у шапці (2026-11-16, власник: «колокольчик у шапці зі сповіщеннями; швидший доступ до групи»).
-- my_inbox(): одним викликом — мої чати (з непрочитаними), домашнє, яке ще не виконано, і дуелі, у які я ще не зіграв.
create or replace function public.my_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return jsonb_build_object(
    'chats', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from public.chat_list() limit 12) c),
    'homework', (select coalesce(jsonb_agg(jsonb_build_object('room_id', h.room_id, 'title', r.title, 'due_at', h.due_at,
                   'done', (select count(*) from jsonb_array_elements(t.tasks) e(task)
                             where private.homework_value(e.task, v_uid, h.room_id, h.created_at, now()) >= coalesce((e.task ->> 'target')::int, 1)),
                   'total', jsonb_array_length(t.tasks)) order by h.due_at), '[]'::jsonb)
                 from public.chat_homework h
                 join public.chat_homework_tasks t on t.homework_id = h.id and t.user_id = v_uid and t.done_at is null
                 join public.chat_members m on m.room_id = h.room_id and m.user_id = v_uid and m.left_at is null
                 join public.chat_rooms r on r.id = h.room_id
                where h.due_at > now()
                  and h.id = (select h2.id from public.chat_homework h2 where h2.room_id = h.room_id order by h2.created_at desc limit 1)),
    'duels', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'room_id', d.room_id, 'title', coalesce(r.title, private.friend_name(d.created_by)),
                   'game', d.game, 'level', d.level, 'seed', d.seed, 'by', private.friend_name(d.created_by), 'ends_at', d.ends_at) order by d.created_at desc), '[]'::jsonb)
              from public.chat_duels d
              join public.chat_members m on m.room_id = d.room_id and m.user_id = v_uid and m.left_at is null
              join public.chat_rooms r on r.id = d.room_id
             where d.ends_at > now() and coalesce(d.created_by, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid
               and not exists (select 1 from public.chat_duel_results x where x.duel_id = d.id and x.user_id = v_uid)
               and not exists (select 1 from public.chat_blocks b where b.user_id = v_uid and b.blocked_id = d.created_by and b.removed_at is null)));
end $$;
revoke execute on function public.my_inbox() from public, anon;
grant execute on function public.my_inbox() to authenticated;
