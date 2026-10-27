// Edge Function `push`: нагадування Web Push. Викликає pg_cron кожні 15 хв (міграція 0011) із заголовком x-cron-secret.
// Для кожної увімкненої підписки, чий локальний час (tz) щойно минув remind_at і якій сьогодні ще не надсилали:
// рахує картки до повторення і сьогоднішній час, складає текст українською, шле Web Push (VAPID), позначає last_sent_day.
// Недійсні підписки (404/410) видаляє.
// Ручних секретів не потрібно (міграція 0014): ключі VAPID функція створює сама й зберігає в public.app_keys
// (RLS без політик — лише service role); секрет x-cron-secret — у Vault, читається через push_cron_secret().
// Публічний ключ клієнт отримує запитом { action: 'vapid' } (без входу). Env VAPID_* / CRON_SECRET — лише як перевизначення.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { buildMessage, isDue, safeEqual, streakFrom, type Kinds } from './logic.ts';
import { b64uDecode, b64uEncode, sendPush, type PushKeys, type Vapid } from './webpush.ts';
import { cors } from '../_shared/http.ts';

type SubRow = {
  id: string; user_id: string; endpoint: string; keys: PushKeys; tz: string;
  remind_at: string; kinds: Kinds; last_sent_day: string | null;
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

const SUBJECT = 'https://pavlozhyhalov.github.io/myEnglish/';
const service = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/** Ключі VAPID: env → app_keys → згенерувати (P-256) і зберегти; паралельний перший запуск — on conflict, потім перечитати */
let vapidP: Promise<Vapid> | null = null;
function loadVapid(db: SupabaseClient): Promise<Vapid> {
  const envPub = Deno.env.get('VAPID_PUBLIC_KEY'), envPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (envPub && envPriv) return Promise.resolve({ publicKey: envPub, privateKey: envPriv, subject: Deno.env.get('VAPID_SUBJECT') || SUBJECT });
  if (!vapidP) vapidP = (async () => {
    const read = async () => {
      const { data, error } = await db.from('app_keys').select('value').eq('id', 'vapid').maybeSingle();
      if (error) throw new Error('app_keys: ' + error.message);
      return data?.value as { publicKey: string; privateKey: string } | undefined;
    };
    let v = await read();
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const pub = new Uint8Array(65); pub[0] = 4; pub.set(b64uDecode(jwk.x!), 1); pub.set(b64uDecode(jwk.y!), 33);
      const { error } = await db.from('app_keys').upsert({ id: 'vapid', value: { publicKey: b64uEncode(pub), privateKey: jwk.d } }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error('app_keys insert: ' + error.message);
      v = await read();
      if (!v) throw new Error('app_keys: no key after insert');
    }
    return { publicKey: v.publicKey, privateKey: v.privateKey, subject: SUBJECT };
  })().catch((e) => { vapidP = null; throw e; });
  return vapidP;
}

let cronSecretP: Promise<string> | null = null;
function cronSecret(db: SupabaseClient): Promise<string> {
  const env = Deno.env.get('CRON_SECRET');
  if (env) return Promise.resolve(env);
  if (!cronSecretP) cronSecretP = (async () => {
    const { data, error } = await db.rpc('push_cron_secret');
    if (error || typeof data !== 'string' || data.length < 32) throw new Error('cron secret unavailable');
    return data;
  })().catch((e) => { cronSecretP = null; throw e; });
  return cronSecretP;
}

function isoDaysBefore(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function userStats(db: SupabaseClient, userId: string, day: string) {
  const [cards, sess] = await Promise.all([
    db.from('cards').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('deleted', false).not('due', 'is', null).lte('due', new Date().toISOString()),
    db.from('sessions').select('day, seconds')
      .eq('user_id', userId).eq('deleted', false).gte('day', isoDaysBefore(day, 400)).lte('day', day)
      .order('day', { ascending: false }).limit(20000),   // PostgREST обрізає до max-rows (1000) — свіжі дні мають бути в межах
  ]);
  if (cards.error) throw new Error('cards: ' + cards.error.message);
  if (sess.error) throw new Error('sessions: ' + sess.error.message);
  const byDay = new Map<string, number>();
  for (const r of sess.data || []) byDay.set(r.day, (byDay.get(r.day) || 0) + (r.seconds || 0));
  return { due: cards.count || 0, todaySec: byDay.get(day) || 0, streak: streakFrom(byDay, day) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const db = service();
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* cron шле {} */ }

  // публічний ключ для підписки в браузері (без входу; він і так публічний)
  if (body?.action === 'vapid') {
    try { const v = await loadVapid(db); return json({ publicKey: v.publicKey }, 200, { 'Cache-Control': 'public, max-age=3600' }); }
    catch (e) { console.error('vapid', (e as Error).message); return json({ error: 'unavailable' }, 503); }
  }

  let secret = '';
  try { secret = await cronSecret(db); } catch (e) { console.error('cron secret', (e as Error).message); return json({ error: 'unavailable' }, 503); }
  if (!safeEqual(req.headers.get('x-cron-secret') || '', secret)) return json({ error: 'unauthorized' }, 401);

  let vapid: Vapid;
  try { vapid = await loadVapid(db); } catch (e) { console.error('vapid', (e as Error).message); return json({ error: 'vapid_not_configured' }, 500); }
  const { data: subs, error } = await db.from('push_subscriptions')
    .select('id, user_id, endpoint, keys, tz, remind_at, kinds, last_sent_day').eq('enabled', true).limit(5000);
  if (error) { console.error('subs', error.message); return json({ error: 'db' }, 500); }

  const now = new Date();
  const out = { checked: subs?.length || 0, due: 0, sent: 0, skipped: 0, removed: 0, failed: 0 };
  const statsCache = new Map<string, Promise<{ due: number; todaySec: number; streak: number }>>();

  for (const s of (subs || []) as SubRow[]) {
    const { due, day } = isDue(now, s);
    if (!due) continue;
    out.due++;
    // атомарно «займаємо» сьогоднішнє надсилання: паралельний виклик cron не надішле вдруге
    const { data: claimed, error: ce } = await db.from('push_subscriptions')
      .update({ last_sent_day: day }).eq('id', s.id).or(`last_sent_day.is.null,last_sent_day.neq.${day}`).select('id');
    if (ce || !claimed?.length) { if (ce) console.error('claim', ce.message); continue; }
    // тимчасовий збій — повертаємо позначку, наступний запуск cron (у межах вікна) спробує ще раз
    const release = () => db.from('push_subscriptions').update({ last_sent_day: s.last_sent_day }).eq('id', s.id).eq('last_sent_day', day);
    try {
      const key = `${s.user_id}|${day}`;
      if (!statsCache.has(key)) statsCache.set(key, userStats(db, s.user_id, day));
      const st = await statsCache.get(key)!;
      const msg = buildMessage({ ...st, kinds: s.kinds || {} });
      if (!msg) { out.skipped++; continue; }
      const r = await sendPush({ endpoint: s.endpoint, keys: s.keys }, msg, vapid);
      if (r.status === 404 || r.status === 410) {
        await db.from('push_subscriptions').delete().eq('id', s.id);
        out.removed++;
      } else if (r.status >= 200 && r.status < 300) {
        out.sent++;
      } else {
        out.failed++;
        console.error('push', r.status, new URL(s.endpoint).host, r.text);
        if (r.status === 429 || r.status >= 500) await release();
      }
    } catch (e) {
      out.failed++;
      await release();
      console.error('push error', (e as Error)?.message?.slice(0, 200));
    }
  }
  console.info('push run', out);
  return json(out);
});
