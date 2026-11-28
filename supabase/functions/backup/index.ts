// Edge Function `backup` (2026-11-28, міграція 0040): щоденна зашифрована резервна копія бази в приватний бакет `backups`.
// Викликає pg_cron ~02:17 UTC із заголовком x-cron-secret (той самий секрет, що й для `push`).
// daily/<дата>.meb — 7 днів; щопонеділка ще weekly/<дата>.meb — 28 днів. Збій → client_errors (route `backup`) — видно на #/admin.
// Звіти копій поза Supabase (міграція 0043): GitHub Actions шле { kind: db|restore|files, ok, file, bytes, counts } із заголовком x-offsite-secret →
// app_keys 'offsite_backup' (видно на #/admin); збій — у журнал і push адміністраторам (push, дія admin_alert).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { runBackup, cleanReport, mergeStatus, readOffsite, saveOffsite } from '../_shared/backup.ts';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Збій копії: запис у журнал помилок (#/admin) і push адміністраторам */
async function alertAdmins(db: SupabaseClient, text: string) {
  const { data: admins } = await db.from('app_admins').select('user_id').limit(1);
  const uid = admins?.[0]?.user_id;
  if (uid) await db.from('client_errors').insert({ user_id: uid, build: 'backup', route: 'backup', message: text.slice(0, 1000), ua: 'backup' });
  const { data: secret } = await db.rpc('push_cron_secret');
  if (typeof secret === 'string') await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ action: 'admin_alert', title: 'myEnglish: резервна копія', text }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const offsiteHdr = req.headers.get('x-offsite-secret');
  if (offsiteHdr) {
    const { data: os } = await db.rpc('offsite_secret');
    if (typeof os !== 'string' || !safeEqual(offsiteHdr, os)) return json({ error: 'unauthorized' }, 401);
    const r = cleanReport(await req.json().catch(() => null));
    if (!r) return json({ error: 'bad_request' }, 400);
    await saveOffsite(db, mergeStatus(await readOffsite(db), r.kind, r.entry));
    if (!r.entry.ok) await alertAdmins(db, `Резервна копія поза Supabase (${r.kind}) не вдалась${r.entry.detail ? `: ${r.entry.detail}` : ''}`);
    return json({ ok: true });
  }
  const { data: secret } = await db.rpc('push_cron_secret');
  if (typeof secret !== 'string' || !safeEqual(req.headers.get('x-cron-secret') || '', secret)) return json({ error: 'unauthorized' }, 401);
  try {
    const r = await runBackup(db);
    console.log('backup', r.paths.join(','), r.bytes);
    return json({ ok: true, ...r });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    console.error('backup failed', msg);
    await alertAdmins(db, `Резервна копія не вдалась: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
