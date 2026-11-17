-- 0036 · «Написати розробнику» (власник 2026-11-17: «роби»): звернення користувачів зі скріншотом → push адміністраторам, розділ «Звернення» на #/admin,
-- відповідь розробника → push людині, рядок у дзвіночку й на сторінці #/feedback.
-- Звернення бачить лише автор (RLS) і адміністратори (функція admin через service role). Скріншоти — приватний бакет feedback (<uid>/<id>.jpg).
-- Адміністратори в базі — public.app_admins (RLS без політик; заповнюється вручну тим самим, що й ALLOWED_USERS) — для цифри в дзвіночку.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_admins enable row level security;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'bug' check (kind in ('bug', 'idea', 'other')),
  body text not null check (char_length(body) between 3 and 2000),
  route text, build text, ua text,
  image_path text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  reply text, replied_at timestamptz, reply_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
alter table public.feedback enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'feedback' and policyname = 'feedback_sel') then
    create policy feedback_sel on public.feedback for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'feedback' and policyname = 'feedback_ins') then
    create policy feedback_ins on public.feedback for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- вставка від клієнта: службові поля не підробити, до 10 звернень на добу, скріншот — лише зі своєї теки
create or replace function public.feedback_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := gen_random_uuid(); new.created_at := now(); new.status := 'new';
  new.reply := null; new.replied_at := null; new.reply_seen_at := null;
  new.route := left(new.route, 200); new.build := left(new.build, 40); new.ua := left(new.ua, 300);
  if new.image_path is not null and new.image_path !~ ('^' || new.user_id::text || '/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$') then new.image_path := null; end if;
  if (select count(*) from public.feedback f where f.user_id = new.user_id and f.created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  return new;
end $$;
create or replace trigger feedback_check before insert on public.feedback for each row execute function public.feedback_check();

-- push: нове звернення — адміністраторам; відповідь — автору
create or replace function public.feedback_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then v_action := 'feedback';
  elsif new.reply is not null and new.reply is distinct from old.reply then v_action := 'feedback_reply';
  else return null; end if;
  begin
    perform net.http_post(
      url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/push',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
      body := jsonb_build_object('action', v_action, 'id', new.id),
      timeout_milliseconds := 15000);
  exception when others then raise warning 'feedback push: %', sqlerrm;
  end;
  return null;
end $$;
create or replace trigger feedback_notify after insert or update on public.feedback for each row execute function public.feedback_notify();

-- автор прочитав відповіді (знімає цифру в дзвіночку)
create or replace function public.feedback_seen()
returns integer language sql security definer set search_path = '' as $$
  with u as (update public.feedback f set reply_seen_at = now()
              where f.user_id = auth.uid() and f.reply is not null and (f.reply_seen_at is null or f.reply_seen_at < f.replied_at) returning 1)
  select count(*)::int from u;
$$;

-- приватний бакет скріншотів
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'feedback_own_ins') then
    create policy feedback_own_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'feedback_own_sel') then
    create policy feedback_own_sel on storage.objects for select to authenticated
      using (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;

-- дзвіночок: + відповіді розробника; адміністраторам — кількість нових звернень
create or replace function public.my_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'need_login' using errcode = '28000'; end if;
  return jsonb_build_object(
    'chats', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from public.chat_list() limit 12) c),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.from_id, 'name', private.friend_name(r.from_id)) order by r.created_at desc), '[]'::jsonb)
                 from public.friend_requests r where r.to_id = v_uid and r.status = 'pending' and not private.chat_blocked(v_uid, r.from_id)),
    'invites', public.chat_group_invites_list(),
    'replies', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'body', left(f.body, 80), 'reply', left(f.reply, 120)) order by f.replied_at desc), '[]'::jsonb)
                from public.feedback f where f.user_id = v_uid and f.reply is not null and (f.reply_seen_at is null or f.reply_seen_at < f.replied_at)),
    'feedback_new', case when exists (select 1 from public.app_admins a where a.user_id = v_uid)
                    then (select count(*) from public.feedback f where f.status = 'new') else 0 end,
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

revoke execute on function public.feedback_check(), public.feedback_notify() from public, anon, authenticated;
revoke execute on function public.feedback_seen() from public, anon;
grant execute on function public.feedback_seen() to authenticated;

-- адміністратор для дзвіночка — творець першої групи (власник); надалі — вручну, як ALLOWED_USERS
insert into public.app_admins (user_id)
select m.user_id from public.chat_members m where m.room_id = 'd998c628-56ed-4e46-9bd8-77f199f063a7' and m.role = 'owner'
on conflict do nothing;
