-- 0043 · Резервні копії поза Supabase (2026-11-28, власник: «роби все правильно з резервним копіюванням, подивись як у Резонансі»).
-- GitHub Actions щоночі робить повний pg_dump, шифрує й кладе в Cloudflare R2 (.github/workflows/db-backup.yml), щотижня перевіряє відновлення
-- (db-restore-test.yml) і звітує функції `backup` із заголовком x-offsite-secret. Статус — app_keys id 'offsite_backup' (видно на #/admin), збій — push адміністраторам.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'offsite_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'offsite_secret', 'myEnglish: секрет звітів резервного копіювання з GitHub Actions');
  end if;
end $$;

create or replace function public.offsite_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'offsite_secret' limit 1 $$;

revoke all on function public.offsite_secret() from public, anon, authenticated;
grant execute on function public.offsite_secret() to service_role;
