-- Рядок інтеграції власника створюється вручну (ключ — encode(extensions.gen_random_bytes(32),'hex'),
-- його sha256 → Resonance external_ingest_keys), потім вмикається і переносяться всі дні.
update public.integrations set enabled = true, updated_at = now() where enabled = false;
select private.resonance_push_day(user_id, day) from (select distinct user_id, day from public.sessions) d;
