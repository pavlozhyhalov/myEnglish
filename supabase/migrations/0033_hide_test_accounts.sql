-- 0033 · Тестові акаунти Claude (tutor-eval*) — не показувати в пошуку людей (2026-11-17)
insert into public.friend_profiles (user_id, code, discoverable)
select u.id, private.new_friend_code(), false from auth.users u
 where split_part(u.email, '@', 1) like 'tutor-eval%'
   and not exists (select 1 from public.friend_profiles f where f.user_id = u.id);
update public.friend_profiles f set discoverable = false
 where f.discoverable and f.user_id in (select u.id from auth.users u where split_part(u.email, '@', 1) like 'tutor-eval%');
