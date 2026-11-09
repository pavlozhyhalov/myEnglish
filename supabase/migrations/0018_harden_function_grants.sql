-- Подвійний захист (2026-11-09, порада Security Advisor): службові функції — лише для service_role/cron, без доступу через публічний API.
-- Усередині вони й так перевіряють роль (raise 'forbidden'); тепер anon/authenticated не можуть їх навіть викликати.
revoke execute on function public.push_cron_secret() from public, anon, authenticated;
revoke execute on function public.charge_ai_usage(uuid, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_health_slot() from public, anon, authenticated;
revoke execute on function public.admin_stats(integer) from public, anon, authenticated;
revoke execute on function public.push_subscriptions_limit() from public, anon, authenticated;
-- функції друзів — лише для тих, хто увійшов (без анонімного доступу)
revoke execute on function public.add_friend(text) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.set_friend_name(text) from public, anon;
revoke execute on function public.my_friend_code(text) from public, anon;
revoke execute on function public.friends_stats() from public, anon;
grant execute on function public.add_friend(text), public.remove_friend(uuid), public.set_friend_name(text), public.my_friend_code(text), public.friends_stats() to authenticated;
grant execute on function public.push_cron_secret(), public.charge_ai_usage(uuid, integer, integer, integer, integer, integer, integer, integer, integer), public.claim_health_slot(), public.admin_stats(integer) to service_role;
