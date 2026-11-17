// Edge Function `push`: нагадування Web Push. Викликає pg_cron кожні 15 хв (міграція 0011) із заголовком x-cron-secret.
// Для кожної увімкненої підписки, чий локальний час (tz) щойно минув remind_at і якій сьогодні ще не надсилали:
// рахує картки до повторення і сьогоднішній час, складає текст українською, шле Web Push (VAPID), позначає last_sent_day.
// Недійсні підписки (404/410) видаляє.
// Ручних секретів не потрібно (міграція 0014): ключі VAPID функція створює сама й зберігає в public.app_keys
// (RLS без політик — лише service role); секрет x-cron-secret — у Vault, читається через push_cron_secret().
// Публічний ключ клієнт отримує запитом { action: 'vapid' } (без входу). Env VAPID_* / CRON_SECRET — лише як перевизначення.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { buildMessage, isDue, safeEqual, streakFrom, type Kinds, type Message } from './logic.ts';
import { b64uDecode, b64uEncode, sendPush, type PushKeys, type Vapid } from './webpush.ts';
import { cors } from '../_shared/http.ts';
import { generateJson } from '../_shared/gemini.ts';
import { FAST_MODELS } from '../_shared/config.ts';
import { readMemory } from '../_shared/prompts.ts';
import { createHomework } from '../_shared/homework.ts';
import { tutorNudge, tutorCount, postTutor, tutorWeekly, weeklyDue } from '../_shared/grouptutor.ts';
import { nudgeInput, cleanNudge, monitorDue, NUDGE_SCHEMA, NUDGE_PROMPT, chatNotifyDue, chatMessageText, challengeDue, challengeNudge, topicDue, groupLevel, pickTopic, type Topic } from './logic.ts';

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

/** Персональне нагадування з пам'яті вчителя (швидка модель, до 6 с); будь-який збій — звичайний текст */
async function personalize(db: SupabaseClient, userId: string, msg: Message, st: { due: number; todaySec: number; streak: number }): Promise<Message> {
  try {
    const { data } = await db.from('profiles').select('data').eq('user_id', userId).maybeSingle();
    const d = (data?.data || {}) as Record<string, any>;
    const input = nudgeInput({ memory: readMemory(d.memory), lastFocus: d.lastFocus, level: d.level || d.settings?.level, interests: d.about?.interests, avoid: d.about?.avoid, ...st });
    if (!input) return msg;
    const r = await Promise.race([
      generateJson(FAST_MODELS, { system: NUDGE_PROMPT, contents: [{ role: 'user', parts: [{ text: input }] }], schema: NUDGE_SCHEMA, temperature: 0.8, thinking: 'off', maxTokens: 400, timeoutMs: 6000 }),
      new Promise<null>(res => setTimeout(() => res(null), 7000)),
    ]);
    return cleanNudge(r, msg);
  } catch (e) { console.error('nudge', (e as Error).message?.slice(0, 120)); return msg; }
}

/** Щоденний автомонітор: глибока перевірка tutor (текст, JSON, TTS, Live); збій → запис у client_errors і push адміністраторам */
async function monitor(db: SupabaseClient, secret: string, vapid: Vapid) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/tutor`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify({ action: 'health', deep: true }) })
    .then(r => r.json().catch(() => ({ error: `status ${r.status}` }))).catch(e => ({ error: String(e?.message || e) }));
  const bad = Object.entries((res && typeof res === 'object' ? res : {}) as Record<string, any>).filter(([, v]) => !v || v.ok === false || (typeof v === 'string'));
  const live = (res as any)?.live_ws?.info;
  if (live && (!live.setup || !live.audio_bytes)) bad.push(['live_ws', { error: `setup ${live.setup} audio ${live.audio_bytes} ${live.close_reason || ''}` }]);
  // автотест якості моделей (еталон із 30 речень): погані моделі tutor відкладає сам; тривога — якщо добрих не лишилось
  const ev = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/tutor`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify({ action: 'health', deep: true, eval: true }) })
    .then(r => r.json()).catch(() => null) as Record<string, { recall?: number; excluded?: boolean }> | null;
  const scored = Object.values(ev || {}).filter(v => typeof v?.recall === 'number');
  const good = scored.filter(v => !v.excluded);
  if (!scored.length || !good.length) bad.push(['quality', { error: scored.length ? 'усі моделі нижче порогу якості' : 'автотест якості не відповів' }]);
  console.info('quality', JSON.stringify(ev).slice(0, 400));
  console.info('monitor', bad.length ? bad.map(([k]) => k).join(',') : 'ok');
  if (!bad.length) return;
  const text = bad.map(([k, v]) => `${k}: ${String(v?.error || v || '').slice(0, 120)}`).join('; ');
  const admins = (Deno.env.get('ALLOWED_USERS') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const ids = (users?.users || []).filter(u => admins.includes(u.id.toLowerCase()) || (u.email && admins.includes(u.email.toLowerCase()))).map(u => u.id);
  if (ids[0]) await db.from('client_errors').insert({ user_id: ids[0], build: 'monitor', route: 'monitor', message: `Автомонітор: ${text}`.slice(0, 1000), ua: 'pg_cron' });
  const { data: subs } = ids.length ? await db.from('push_subscriptions').select('endpoint, keys').in('user_id', ids).eq('enabled', true) : { data: [] };
  for (const s of subs || []) await sendPush({ endpoint: s.endpoint, keys: s.keys }, { title: 'myEnglish: збій AI', body: text.slice(0, 180), url: '#/admin', tag: 'myenglish-monitor' }, vapid).catch(() => {});
}


/** Надіслати push усім увімкненим підпискам людини (kinds.chat не вимкнено); недійсні — видалити. Повертає кількість доставлених */
async function sendToUser(db: SupabaseClient, userId: string, msg: Message, vapid: Vapid, opts: { ttl?: number; urgency?: string } = {}) {
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, keys, kinds').eq('user_id', userId).eq('enabled', true).limit(10);
  let sent = 0;
  for (const s of subs || []) {
    if ((s.kinds as Record<string, unknown>)?.chat === false) continue;
    // повідомлення друзів і запити — високий пріоритет (Android у режимі економії інакше відкладає), живуть добу
    const r = await sendPush({ endpoint: s.endpoint, keys: s.keys }, msg, vapid, { ttl: opts.ttl ?? 24 * 3600, urgency: opts.urgency ?? 'normal' }).catch(() => ({ status: 0, text: '' }));
    if (r.status === 404 || r.status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
    else if (r.status >= 200 && r.status < 300) sent++;
  }
  return sent;
}

/** Ім'я для друзів (як private.friend_name): власне → з профілю → «Учень» */
async function friendName(db: SupabaseClient, userId: string) {
  const [{ data: fp }, { data: pr }] = await Promise.all([
    db.from('friend_profiles').select('display_name').eq('user_id', userId).maybeSingle(),
    db.from('profiles').select('data').eq('user_id', userId).maybeSingle(),
  ]);
  const n = String(fp?.display_name || '').trim() || String((pr?.data as any)?.about?.name || '').trim() || 'Учень';
  return { data: n.slice(0, 40) };
}

/** Нове повідомлення в чаті друзів (тригер chat_messages_after → сюди): push учасникам, які зараз не читають чат */
async function chatPush(db: SupabaseClient, id: string, vapid: Vapid) {
  const { data: m } = await db.from('chat_messages').select('id, room_id, user_id, kind, body, meta, deleted_at').eq('id', id).maybeSingle();
  if (!m || m.deleted_at || !['text', 'voice', 'challenge'].includes(m.kind)) return { sent: 0 };
  const [{ data: room }, { data: members }, { data: sender }] = await Promise.all([
    db.from('chat_rooms').select('kind, title').eq('id', m.room_id).maybeSingle(),
    db.from('chat_members').select('user_id, last_read_at, notified_at, muted').eq('room_id', m.room_id).is('left_at', null),
    friendName(db, m.user_id),
  ]);
  if (!room) return { sent: 0 };
  const { data: blocks } = await db.from('chat_blocks').select('user_id').eq('blocked_id', m.user_id).is('removed_at', null);
  const blockedBy = new Set((blocks || []).map(b => b.user_id));
  const now = Date.now();
  const text = chatMessageText({ kind: m.kind, body: m.body || '', sender, room, meta: m.meta || {} });
  let sent = 0;
  for (const r of members || []) {
    if (r.user_id === m.user_id || blockedBy.has(r.user_id) || !chatNotifyDue(now, r)) continue;
    const n = await sendToUser(db, r.user_id, { ...text, url: `#/friends/chat/${m.room_id}`, tag: `myenglish-chat-${m.room_id}` }, vapid, { urgency: 'high' });
    if (n) { sent += n; await db.from('chat_members').update({ notified_at: new Date().toISOString() }).eq('room_id', m.room_id).eq('user_id', r.user_id); }
  }
  return { sent };
}


/** «Тема дня» від вчителя: у кожній живій групі (≥ 2 учасники, повідомлення за 14 днів) — питання англійською за рівнем групи */
const TOPICS_URL = 'https://raw.githubusercontent.com/pavlozhyhalov/myEnglish/main/data/topics.json';
async function topicOfDay(db: SupabaseClient, vapid: Vapid) {
  const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: rooms } = await db.from('chat_rooms').select('id, title').eq('kind', 'group').gte('last_msg_at', since14).limit(200);
  if (!rooms?.length) return;
  const topics = ((await fetch(TOPICS_URL).then(r => r.json()).catch(() => null))?.topics || []) as Topic[];
  if (!topics.length) { console.error('topics unavailable'); return; }
  let posted = 0;
  for (const room of rooms) {
    const { data: members } = await db.from('chat_members').select('user_id, muted').eq('room_id', room.id).is('left_at', null);
    if (!members || members.length < 2) continue;
    const { data: recent } = await db.from('chat_messages').select('meta, created_at').eq('room_id', room.id).eq('kind', 'system')
      .eq('meta->>event', 'topic').gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('created_at', { ascending: false }).limit(90);
    if (recent?.[0] && Date.now() - Date.parse(recent[0].created_at) < 20 * 3600e3) continue;   // сьогодні вже була
    const { data: profs } = await db.from('profiles').select('data').in('user_id', members.map(m => m.user_id));
    const level = groupLevel((profs || []).map(p => String((p.data as any)?.settings?.level || (p.data as any)?.level || '')));
    const t = pickTopic(topics, level, new Set((recent || []).map(r => String((r.meta as any)?.topic_id || ''))));
    if (!t) continue;
    const { error } = await db.from('chat_messages').insert({ room_id: room.id, user_id: members[0].user_id, kind: 'system', body: '',
      meta: { event: 'topic', topic_id: t.id, q: t.q, en: t.en, uk: t.uk, a: (t.a || []).slice(0, 3), level } });
    if (error) { console.error('topic insert', error.message); continue; }
    posted++;
    // щопонеділка — ще й нове домашнє (у кожного своє)
    let hw = false;
    // щопонеділка; нова група без жодного домашнього — одразу на найближчому ранковому запуску
    const { count: hwCount } = await db.from('chat_homework').select('id', { count: 'exact', head: true }).eq('room_id', room.id);
    if (new Date().getUTCDay() === 1 || !hwCount) {
      try { hw = !!(await createHomework(db, room.id, null, 6))?.created; } catch (e) { console.error('homework', (e as Error).message?.slice(0, 120)); }
    }
    for (const m of members) {
      if (m.muted) continue;
      await sendToUser(db, m.user_id, { title: (hw ? `Нове домашнє завдання · «${room.title || 'Група'}»` : `Тема дня в групі «${room.title || 'Група'}»`).slice(0, 70),
        body: (hw ? `У кожного своє — відкрийте й подивіться. Тема дня: ${t.q}` : t.q).slice(0, 170), url: `#/friends/chat/${room.id}`, tag: `myenglish-topic-${room.id}` }, vapid);
    }
  }
  console.info('topic of day', posted);
}


/** Неділя ~17:00 UTC: підсумок тижня в кожній живій групі — текст вчителя, найактивніші, спільні помилки (без імен) */
async function weeklyPush(db: SupabaseClient, vapid: Vapid) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: rooms } = await db.from('chat_rooms').select('id, title').eq('kind', 'group').gte('last_msg_at', since).limit(200);
  let posted = 0;
  for (const room of rooms || []) {
    try {
      const { count } = await db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('room_id', room.id).eq('kind', 'system')
        .eq('meta->>event', 'weekly').gte('created_at', new Date(Date.now() - 6 * 864e5).toISOString());
      if (count) continue;
      const w = await tutorWeekly(db, room.id);
      if (!w) continue;
      const { data: members } = await db.from('chat_members').select('user_id, muted').eq('room_id', room.id).is('left_at', null).order('joined_at');
      if (!members?.length) continue;
      await db.from('chat_messages').insert({ room_id: room.id, user_id: members[0].user_id, kind: 'system', body: '', meta: { event: 'weekly', text: w.text, stars: w.stars, mistakes: w.mistakes } });
      posted++;
      for (const m of members) if (!m.muted) await sendToUser(db, m.user_id, { title: `Підсумок тижня в групі «${room.title || 'Група'}»`.slice(0, 70), body: w.text.slice(0, 170), url: `#/friends/chat/${room.id}`, tag: `myenglish-weekly-${room.id}` }, vapid);
    } catch (e) { console.error('weekly', (e as Error).message?.slice(0, 120)); }
  }
  console.info('weekly summary', posted);
}

/** Раз на добу: тим, хто відстає у спільному виклику, — нагадування (одне на людину, найвідсталіший виклик) */
async function challengePush(db: SupabaseClient, vapid: Vapid) {
  const { data, error } = await db.rpc('chat_challenge_laggards');
  if (error) { console.error('laggards', error.message); return; }
  const byUser = new Map<string, any>();
  for (const r of (data || []) as any[]) {
    const gap = (r.expected - r.value) / Math.max(1, r.target);
    if (!byUser.has(r.user_id) || gap > byUser.get(r.user_id).gap) byUser.set(r.user_id, { ...r, gap });
  }
  let sent = 0;
  for (const r of byUser.values()) sent += await sendToUser(db, r.user_id, { ...challengeNudge(r), url: `#/friends/chat/${r.room_id}`, tag: `myenglish-challenge-${r.room_id}` }, vapid);
  // вчитель у групах: раз на день — перевірка домашнього (хвалить, жартома сварить); не в перший день після видачі
  const { data: hwRooms } = await db.from('chat_homework').select('room_id, created_at').gt('due_at', new Date().toISOString())
    .lt('created_at', new Date(Date.now() - 20 * 3600e3).toISOString()).limit(200);
  for (const room of new Set((hwRooms || []).map(r => r.room_id))) {
    try {
      if (await tutorCount(db, room, 20, 'nudge')) continue;
      const n = await tutorNudge(db, room);
      if (!n) continue;
      const { data: rm } = await db.from('chat_rooms').select('title').eq('id', room).maybeSingle();
      const { data: author } = await db.from('chat_members').select('user_id').eq('room_id', room).is('left_at', null).order('joined_at').limit(1).maybeSingle();
      if (!author) continue;
      await postTutor(db, room, author.user_id, n.text, { mode: 'nudge' });
      const { data: muted } = await db.from('chat_members').select('user_id').eq('room_id', room).eq('muted', true);
      const skip = new Set((muted || []).map(m => m.user_id));
      for (const uid of n.lazy) if (!skip.has(uid)) sent += await sendToUser(db, uid, { title: `Вчитель у групі «${rm?.title || 'Група'}»`.slice(0, 70), body: n.text.slice(0, 170), url: `#/friends/chat/${room}`, tag: `myenglish-tutor-${room}` }, vapid);
    } catch (e) { console.error('tutor nudge', (e as Error).message?.slice(0, 120)); }
  }
  // домашнє: термін спливає протягом доби, а завдання ще лишились
  const { data: hw, error: he } = await db.rpc('chat_homework_laggards');
  if (he) console.error('hw laggards', he.message);
  for (const r of (hw || []) as Array<{ user_id: string; room_id: string; room_title: string | null; left_tasks: number }>) {
    if (!r.left_tasks) continue;
    sent += await sendToUser(db, r.user_id, { title: `Виконайте домашнє завдання${r.room_title ? ` · «${r.room_title}»` : ''}`.slice(0, 70), body: `Лишилось ${r.left_tasks} з 3 — термін завтра. Встигнете!`,
      url: `#/friends/chat/${r.room_id}`, tag: `myenglish-hw-${r.room_id}` }, vapid);
  }
  console.info('challenge push', byUser.size, sent);
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
  // запит у друзі (тригер friend_requests_notify, міграція 0030): новий — тому, кому надіслали; прийнято — тому, хто надсилав
  if ((body as { action?: string })?.action === 'friend') {
    const b = body as { from?: string; to?: string; status?: string };
    const uuid = /^[0-9a-f-]{36}$/;
    if (!uuid.test(String(b.from)) || !uuid.test(String(b.to))) return json({ error: 'bad_request' }, 400);
    try {
      if (b.status === 'pending') {
        const { data: name } = await friendName(db, String(b.from));
        return json({ sent: await sendToUser(db, String(b.to), { title: 'Запит у друзі', body: `${name} хоче додати вас у друзі`, url: '#/friends', tag: `myenglish-req-${b.from}` }, vapid, { urgency: 'high', ttl: 7 * 86400 }) });
      }
      if (b.status === 'accepted') {
        const { data: name } = await friendName(db, String(b.to));
        return json({ sent: await sendToUser(db, String(b.from), { title: 'Запит прийнято', body: `${name} тепер у ваших друзях — напишіть англійською!`, url: '#/friends', tag: `myenglish-req-${b.to}` }, vapid, { urgency: 'high', ttl: 3 * 86400 }) });
      }
      return json({ sent: 0 });
    } catch (e) { console.error('friend push', (e as Error).message?.slice(0, 120)); return json({ error: 'failed' }, 500); }
  }
  // «Написати розробнику» (міграція 0036): нове звернення — адміністраторам (app_admins), відповідь — автору
  if (['feedback', 'feedback_reply'].includes(String((body as { action?: string })?.action))) {
    const b = body as { action: string; id?: string };
    if (!/^[0-9a-f-]{36}$/.test(String(b.id))) return json({ error: 'bad_request' }, 400);
    try {
      const { data: f } = await db.from('feedback').select('id, user_id, kind, body, reply').eq('id', String(b.id)).maybeSingle();
      if (!f) return json({ sent: 0 });
      if (b.action === 'feedback_reply') {
        return json({ sent: await sendToUser(db, f.user_id, { title: 'Відповідь розробника', body: String(f.reply || '').slice(0, 160), url: '#/feedback', tag: `myenglish-fb-${f.id}` }, vapid, { urgency: 'high', ttl: 7 * 86400 }) });
      }
      const [{ data: name }, { data: admins }] = await Promise.all([friendName(db, f.user_id), db.from('app_admins').select('user_id')]);
      const label = f.kind === 'idea' ? 'Ідея' : f.kind === 'bug' ? 'Помилка' : 'Звернення';
      let sent = 0;
      for (const a of admins || []) {
        if (a.user_id === f.user_id) continue;
        sent += await sendToUser(db, a.user_id, { title: `${label} від ${name}`, body: String(f.body).slice(0, 160), url: '#/admin', tag: `myenglish-fb-${f.id}` }, vapid, { urgency: 'high', ttl: 7 * 86400 });
      }
      return json({ sent });
    } catch (e) { console.error('feedback push', (e as Error).message?.slice(0, 120)); return json({ error: 'failed' }, 500); }
  }
  // запрошення в групу (тригер chat_group_invites_notify, міграція 0035)
  if ((body as { action?: string })?.action === 'group_invite') {
    const b = body as { room?: string; from?: string; to?: string };
    const uuid = /^[0-9a-f-]{36}$/;
    if (!uuid.test(String(b.room)) || !uuid.test(String(b.from)) || !uuid.test(String(b.to))) return json({ error: 'bad_request' }, 400);
    try {
      const [{ data: name }, { data: room }] = await Promise.all([friendName(db, String(b.from)), db.from('chat_rooms').select('title').eq('id', String(b.room)).maybeSingle()]);
      return json({ sent: await sendToUser(db, String(b.to), { title: 'Запрошення в групу', body: `${name} запрошує вас у групу «${room?.title || 'Група'}»`, url: '#/friends',
        tag: `myenglish-ginv-${b.room}` }, vapid, { urgency: 'high', ttl: 7 * 86400 }) });
    } catch (e) { console.error('group invite push', (e as Error).message?.slice(0, 120)); return json({ error: 'failed' }, 500); }
  }
  // нове повідомлення в чаті друзів (тригер бази)
  if ((body as { action?: string; id?: string })?.action === 'chat') {
    const id = String((body as { id?: string }).id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request' }, 400);
    try { return json(await chatPush(db, id, vapid)); } catch (e) { console.error('chat push', (e as Error).message?.slice(0, 160)); return json({ error: 'failed' }, 500); }
  }
  const { data: subs, error } = await db.from('push_subscriptions')
    .select('id, user_id, endpoint, keys, tz, remind_at, kinds, last_sent_day').eq('enabled', true).limit(5000);
  if (error) { console.error('subs', error.message); return json({ error: 'db' }, 500); }

  const now = new Date();
  // раз на добу (перший запуск після 06:00 UTC) — автомонітор AI у фоні, щоб не затримувати нагадування
  if (monitorDue(now)) {
    const job = monitor(db, secret, vapid).catch(e => console.error('monitor', (e as Error).message));
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(job);
  }
  if (topicDue(now)) {
    const job = topicOfDay(db, vapid).catch(e => console.error('topic', (e as Error).message));
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(job);
  }
  if (weeklyDue(now)) {
    const job = weeklyPush(db, vapid).catch(e => console.error('weekly', (e as Error).message));
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(job);
  }
  if (challengeDue(now)) {
    const job = challengePush(db, vapid).catch(e => console.error('challenge push', (e as Error).message));
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(job);
  }
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
      const base = buildMessage({ ...st, kinds: s.kinds || {} });
      if (!base) { out.skipped++; continue; }
      const msg = await personalize(db, s.user_id, base, st);
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
