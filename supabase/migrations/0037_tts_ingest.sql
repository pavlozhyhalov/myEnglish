-- 0037 · Нічне озвучення власних слів учнів голосом Kokoro (власник 2026-11-19: «Так, роби»).
-- Безкоштовного ліміту Gemini TTS не вистачає (~30 записів/добу на всіх), тож щоночі окрема сесія (заплановане завдання) бере власні слова
-- (колода «my») без готового запису в кеші `tts`, озвучує їх Kokoro й завантажує через функцію `tts-ingest` під ключем Gemini
-- (sha256('Kore|' + текст) + '.wav') — застосунок отримує їх як звичайний кешований запис, без ліміту.
-- Секрет функції — у Vault (`tts_ingest_secret`), назовні не виходить: функція читає його через service role.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'tts_ingest_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tts_ingest_secret', 'myEnglish: секрет функції tts-ingest (нічне озвучення Kokoro)');
  end if;
end $$;

create or replace function public.tts_ingest_secret()
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'tts_ingest_secret' limit 1);
end $$;

-- власні слова без запису в кеші (текст — як його надсилає застосунок: trim(en)); лише для service role
create or replace function public.tts_pending_words(p_limit integer default 300)
returns table (text text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return query
    select w.t from (select distinct trim(c.en) t from public.cards c where c.deck_id = 'my' and not c.deleted and length(trim(c.en)) between 1 and 300) w
    where not exists (select 1 from storage.objects o where o.bucket_id = 'tts' and o.name = encode(extensions.digest('Kore|' || w.t, 'sha256'), 'hex') || '.wav')
    order by w.t limit greatest(1, least(p_limit, 1000));
end $$;

revoke execute on function public.tts_ingest_secret(), public.tts_pending_words(integer) from public, anon, authenticated;
grant execute on function public.tts_ingest_secret(), public.tts_pending_words(integer) to service_role;
