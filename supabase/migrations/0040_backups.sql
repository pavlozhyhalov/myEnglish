-- 0040 · Резервні копії бази (2026-11-28, власник: «подумай про резервне копіювання даних»).
-- Безкоштовний план Supabase не дає завантажуваних резервних копій, тому — власні:
--   щодня ~02:17 UTC pg_cron → функція `backup` → backup_snapshot() (усі таблиці public + auth.users/identities + перелік файлів)
--   → gzip → AES-256-GCM (ключ — Vault `backup_key`) → приватний бакет `backups`: daily/<дата>.meb (7 днів), weekly/<дата>.meb щопонеділка (28 днів).
-- Копія поза Supabase — адміністратор завантажує файл на #/admin («Резервні копії»). Розшифрування й відновлення — docs/backup.md, scripts/backup-decrypt.js.

insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 104857600)
on conflict (id) do update set public = false;
-- політик для бакета немає: читає й пише лише service role (функції `backup` і `admin`)

-- ключ шифрування: 32 випадкові байти (hex) у Vault, створюється один раз
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'backup_key', 'myEnglish: ключ AES-256-GCM резервних копій');
  end if;
end $$;

create or replace function public.backup_key()
returns text
language sql
security definer
set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'backup_key' limit 1 $$;

create or replace function public.backup_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  r record;
  v jsonb;
  t jsonb := '{}'::jsonb;
begin
  for r in select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', r.tablename) into v;
    t := t || jsonb_build_object('public.' || r.tablename, v);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v from auth.users u;
  t := t || jsonb_build_object('auth.users', v);
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v from auth.identities i;
  t := t || jsonb_build_object('auth.identities', v);
  -- файли: лише перелік (самі файли — у бакетах; кеш озвучення tts відновлюється сам)
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'size', metadata ->> 'size', 'created_at', created_at)), '[]'::jsonb)
    into v from storage.objects where bucket_id not in ('tts', 'backups');
  t := t || jsonb_build_object('storage.objects', v);
  return jsonb_build_object('format', 'myenglish-backup-1', 'at', now(), 'tables', t);
end $$;

revoke all on function public.backup_key() from public, anon, authenticated;
revoke all on function public.backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_key() to service_role;
grant execute on function public.backup_snapshot() to service_role;

select cron.schedule('myenglish-backup', '17 2 * * *', $cron$
  select net.http_post(
    url := 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
