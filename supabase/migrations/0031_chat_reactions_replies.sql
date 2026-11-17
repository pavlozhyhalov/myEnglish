-- 0031 · Реакції, відповіді на повідомлення, підсумок тижня в групі (2026-11-17, власник: «реакції, відповіді на повідомлення, репліки вчителя й підсумок в кінці тижня»).
-- Реакція — одна на людину на повідомлення (who = uuid або 'tutor' — вчитель реагує сам). Відповідь — chat_messages.reply_to (лише в межах того самого чату).
alter table public.chat_messages add column if not exists reply_to uuid references public.chat_messages(id) on delete set null;

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  who text not null,                                   -- uuid учасника або 'tutor'
  user_id uuid references auth.users(id) on delete cascade,
  kind text check (kind is null or kind in ('like', 'love', 'haha', 'smart', 'bravo')),   -- null — реакцію знято (м'яко)
  created_at timestamptz not null default now(),
  primary key (message_id, who)
);
create index if not exists chat_reactions_room on public.chat_reactions (room_id);
alter table public.chat_reactions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_reactions' and policyname = 'chat_reactions_sel') then
    create policy chat_reactions_sel on public.chat_reactions for select to authenticated using (public.is_chat_member(room_id));
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions') then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end $$;

-- Поставити / змінити / зняти (p_kind = null) свою реакцію
create or replace function public.chat_react(p_message uuid, p_kind text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_room uuid;
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  select x.room_id into v_room from public.chat_messages x where x.id = p_message and x.deleted_at is null;
  if v_room is null or not public.is_chat_member(v_room) then raise exception 'not_member' using errcode = '22023'; end if;
  if p_kind is null then
    update public.chat_reactions r set kind = null, created_at = now() where r.message_id = p_message and r.who = v_uid::text;
    return null;
  end if;
  if p_kind not in ('like', 'love', 'haha', 'smart', 'bravo') then raise exception 'bad_kind' using errcode = '22023'; end if;
  insert into public.chat_reactions as r (message_id, room_id, who, user_id, kind) values (p_message, v_room, v_uid::text, v_uid, p_kind)
  on conflict on constraint chat_reactions_pkey do update set kind = excluded.kind, created_at = now();
  return p_kind;
end $$;

-- Відповідь — лише на повідомлення з того самого чату (інакше прибирається)
create or replace function public.chat_messages_reply_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reply_to is not null and not exists (select 1 from public.chat_messages x where x.id = new.reply_to and x.room_id = new.room_id) then
    new.reply_to := null;
  end if;
  return new;
end $$;
create or replace trigger chat_messages_reply_check before insert on public.chat_messages
for each row execute function public.chat_messages_reply_check();

-- Підсумок тижня (функція push, лише service role): хвилини занять за тиждень, повідомлення в групі, домашнє
create or replace function public.chat_week_board(p_room uuid)
returns table (user_id uuid, name text, level text, minutes integer, messages integer, homework_done boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return query
    select m.user_id, private.friend_name(m.user_id),
           coalesce((select p.data -> 'settings' ->> 'level' from public.profiles p where p.user_id = m.user_id), 'B1'),
           (coalesce((select sum(s.seconds) from public.sessions s where s.user_id = m.user_id and not s.deleted and s.day > current_date - 7), 0) / 60)::int,
           (select count(*)::int from public.chat_messages x where x.room_id = p_room and x.user_id = m.user_id and x.kind in ('text', 'voice')
             and x.deleted_at is null and x.created_at > now() - interval '7 days'),
           exists (select 1 from public.chat_homework_tasks t join public.chat_homework h on h.id = t.homework_id
                    where h.room_id = p_room and t.user_id = m.user_id and t.done_at > now() - interval '7 days')
      from public.chat_members m where m.room_id = p_room and m.left_at is null
     order by 4 desc;
end $$;

revoke execute on function public.chat_week_board(uuid) from public, anon, authenticated;
grant execute on function public.chat_week_board(uuid) to service_role;
revoke execute on function public.chat_messages_reply_check() from public, anon, authenticated;
revoke execute on function public.chat_react(uuid, text) from public, anon;
grant execute on function public.chat_react(uuid, text) to authenticated;
