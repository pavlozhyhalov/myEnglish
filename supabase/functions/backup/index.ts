// Edge Function `backup` (2026-11-28, міграція 0040): щоденна зашифрована резервна копія бази в приватний бакет `backups`.
// Викликає pg_cron ~02:17 UTC із заголовком x-cron-secret (той самий секрет, що й для `push`).
// daily/<дата>.meb — 7 днів; щопонеділка ще weekly/<дата>.meb — 28 днів. Збій → client_errors (route `backup`) — видно на #/admin.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { runBackup } from '../_shared/backup.ts';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: secret } = await db.rpc('push_cron_secret');
  if (typeof secret !== 'string' || !safeEqual(req.headers.get('x-cron-secret') || '', secret)) return json({ error: 'unauthorized' }, 401);
  try {
    const r = await runBackup(db);
    console.log('backup', r.paths.join(','), r.bytes);
    return json({ ok: true, ...r });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    console.error('backup failed', msg);
    const { data: admins } = await db.from('app_admins').select('user_id').limit(1);
    const uid = admins?.[0]?.user_id;
    if (uid) await db.from('client_errors').insert({ user_id: uid, build: 'backup', route: 'backup', message: `Резервна копія не вдалась: ${msg}`, ua: 'pg_cron' });
    return json({ ok: false, error: msg }, 500);
  }
});
