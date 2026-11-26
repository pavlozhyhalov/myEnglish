-- 2026-11-26 · App Store 1.2 (вміст користувачів) / DSA: «Поскаржитися» на повідомлення чи людину й модерація.
-- Скарга — звернення в public.feedback з kind = 'report' (той самий push адміністраторам і розділ «Звернення» на #/admin);
-- route = 'report:msg:<uuid>' або 'report:user:<uuid>'. Адміністратор (app_admins) ховає повідомлення — admin_hide_message().
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check check (kind in ('bug', 'idea', 'other', 'report'));

create or replace function public.admin_hide_message(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_admins a where a.user_id = auth.uid()) then raise exception 'not_admin' using errcode = '42501'; end if;
  update public.chat_messages set deleted_at = now(), body = '', audio_path = null
   where id = p_id and deleted_at is null;
  return found;
end $$;
revoke execute on function public.admin_hide_message(uuid) from public, anon;
grant execute on function public.admin_hide_message(uuid) to authenticated;
