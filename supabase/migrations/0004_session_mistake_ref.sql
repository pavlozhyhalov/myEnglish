-- Прив'язка сесій практики й помилок до розмови з вчителем (tutor_chats.id),
-- щоб видалення розмови прибирало її час, XP і помилки зі статистики.
alter table public.sessions add column if not exists ref text;
alter table public.mistakes add column if not exists ref text;
create index if not exists sessions_ref_idx on public.sessions (user_id, ref);
