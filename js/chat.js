// Переписка з друзями (міграція 0023): чати 1:1 і групи до 10 людей, голосові, приватні виправлення вчителя, спільні виклики.
// Дані — лише на сервері (RLS: повідомлення бачать учасники, виправлення — автор). Нові повідомлення — Supabase Realtime у відкритому чаті
// (запасний варіант — опитування раз на 15 с), поза застосунком — Web Push (функція push).
// Перевірка: текст — tutor `friend_check` після надсилання; голос — tutor `friend_voice` (розпізнавання + перевірка + вставка).
// Помилки з переписки йдуть у «Мої помилки» (source 'chat-friends', ref = id повідомлення) лише на пристрої, що надіслав.
import { getSupa, user } from './supa.js';
import { tutor } from './ai.js';
import { addMistake, isDisputed } from './stats.js';
import { getMic, micAvailable } from './speech.js';

const COLS = 'id, room_id, user_id, kind, body, audio_path, meta, created_at, deleted_at';
export const PAGE = 50;
export const MAX_GROUP = 10;
export const VOICE_MAX_MS = 60_000;

export class ChatError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const ERR = {
  not_friends: 'Ви більше не друзі — написати не можна.',
  blocked: 'Написати не можна: людину заблоковано.',
  rate_limited: 'Забагато повідомлень. Зачекайте трохи.',
  too_many_challenges: 'У чаті може бути до 3 активних викликів.',
  too_many: 'У групі може бути до 10 людей.',
  bad_title: 'Введіть назву групи.',
  bad_message: 'Повідомлення порожнє або задовге (до 1000 символів).',
  not_member: 'Ви не учасник цього чату.',
  bad_audio: 'Не вдалося надіслати голосове.',
};
export const chatErrText = (e) => ERR[e?.code] || (navigator.onLine ? 'Не вдалося. Спробуйте ще раз.' : 'Немає мережі');
function wrap(error) {
  const m = String(error?.message || '');
  const code = Object.keys(ERR).find(k => m.includes(k)) || error?.code || 'server';
  return new ChatError(code, m);
}

export async function rpc(name, args = {}) {
  const c = await getSupa();
  const { data, error } = await c.rpc(name, args);
  if (error) throw wrap(error);
  return data;
}

export const listChats = () => rpc('chat_list');
export const roomMembers = (room) => rpc('chat_room_members', { p_room: room });
export const openDm = (friend) => rpc('chat_open_dm', { p_friend: friend });
export const createGroup = (title, members) => rpc('chat_create_group', { p_title: title, p_members: members });
export const invite = (room, members) => rpc('chat_invite', { p_room: room, p_members: members });
export const leave = (room) => rpc('chat_leave', { p_room: room });
export const rename = (room, title) => rpc('chat_rename', { p_room: room, p_title: title });
export const markRead = (room) => rpc('chat_read', { p_room: room }).catch(() => {});
export const mute = (room, on) => rpc('chat_mute', { p_room: room, p_on: on });
export const block = (uid) => rpc('chat_block', { p_user: uid });
export const unblock = (uid) => rpc('chat_unblock', { p_user: uid });
export const myBlocks = () => rpc('chat_my_blocks');
export const challenges = (room) => rpc('chat_challenges_list', { p_room: room });
export const createChallenge = (room, kind, target) => rpc('chat_challenge_create', { p_room: room, p_kind: kind, p_target: target });
export const cancelChallenge = (id) => rpc('chat_challenge_cancel', { p_id: id });
// домашнє від вчителя (міграція 0026): у кожного своє; стан — моє з прогресом і клас «N з 3»
export const homework = (room) => rpc('chat_homework_status', { p_room: room });
export const homeworkDone = (id) => rpc('chat_homework_done', { p_homework: id }).catch(() => false);
export const newHomework = (room) => tutor('homework', { room_id: room });
export const hwTaskDone = (t) => (t.value || 0) >= (t.target || 1);

/** Повідомлення чату: найновіші PAGE (або старші за before), у хронологічному порядку */
export async function messages(room, before = null) {
  const c = await getSupa();
  let q = c.from('chat_messages').select(COLS).eq('room_id', room).order('created_at', { ascending: false }).limit(PAGE);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw wrap(error);
  return (data || []).reverse();
}

/** Виправлення вчителя до моїх повідомлень (RLS: лише свої) → Map(id → fixes) */
export async function feedback(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const c = await getSupa();
  const { data } = await c.from('chat_feedback').select('message_id, fixes').in('message_id', ids.slice(0, 200));
  // «Не згоден» — виправлення більше не показується (profiles.data.disputes)
  for (const r of data || []) out.set(r.message_id, (Array.isArray(r.fixes) ? r.fixes : []).filter(f => !isDisputed(f.wrong, f.right)));
  return out;
}

/** Підписка на зміни чату (нові й видалені повідомлення). Повертає функцію відписки. */
export function subscribe(room, onChange, onStatus) {
  let ch = null, dead = false;
  getSupa().then(c => {
    if (dead) return;
    ch = c.channel(`chat:${room}:${Math.random().toString(36).slice(2, 10)}`)   // унікальна тема: повторне відкриття не натрапить на канал, що ще закривається
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room}` }, (p) => { try { onChange(p.new || p.old, p.eventType); } catch (e) { console.warn('chat rt', e); } })
      .subscribe((st) => onStatus?.(st));
  }).catch(() => onStatus?.('CHANNEL_ERROR'));
  return () => { dead = true; if (ch) getSupa().then(c => c.removeChannel(ch)).catch(() => {}); };
}

/** Надіслати текст: вставка (миттєво) → перевірка вчителем у фоні (onFixes) */
export async function sendText(room, body) {
  const c = await getSupa();
  const { data, error } = await c.from('chat_messages').insert({ room_id: room, user_id: user()?.id, kind: 'text', body }).select(COLS).single();
  if (error) throw wrap(error);
  return data;
}

/** Перевірка тексту вчителем; виправлення — у «Мої помилки» */
export async function checkMessage(msg) {
  const r = await tutor('friend_check', { message_id: msg.id });
  const fixes = Array.isArray(r?.fixes) ? r.fixes : [];
  logFixes(fixes, msg.id);
  return { fixes: fixes.filter(f => !isDisputed(f.wrong, f.right)), skipped: r?.skipped || null };
}

// помилки повідомлення — у «Мої помилки» один раз (повтор запиту після втраченої відповіді не подвоює лічильник)
const LOGGED = 'me:chat-logged';
function logFixes(fixes, ref) {
  if (!fixes.length) return;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(LOGGED) || '[]'); } catch { /* приватний режим */ }
  if (seen.includes(ref)) return;
  try { localStorage.setItem(LOGGED, JSON.stringify([...seen, ref].slice(-300))); } catch { /* */ }
  for (const f of fixes) {
    try { addMistake({ wrong: f.wrong, right: f.right, type: 'other', rule: f.rule, explanation_uk: f.why_uk, source: 'chat-friends', ref }); }
    catch (e) { console.warn('chat mistake', e); }
  }
}

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mpeg': 'mp3' };
const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36));
const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });

/** Надіслати голосове: файл у сховище → сервер розпізнає, перевіряє й вставляє повідомлення → { message, fixes } */
export async function sendVoice(room, blob, dur) {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const ext = EXT[mime] || 'webm';
  const path = `${room}/${user()?.id}/${rid()}.${ext}`;
  const c = await getSupa();
  const up = await c.storage.from('chat-voice').upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new ChatError('bad_audio', up.error.message);
  // файл не видаляємо при збої: сервер міг уже вставити повідомлення (відповідь загубилась); якщо вставки не було — прибирає сервер
  const r = await tutor('friend_voice', { room_id: room, path, audio: await toB64(blob), mime, dur: Math.round(dur * 10) / 10 });
  if (r?.message?.id) logFixes(r.fixes || [], r.message.id);
  return r;
}

/** Видалити своє повідомлення (м'яко) і його аудіофайл */
export async function deleteMessage(m) {
  const path = await rpc('chat_delete_message', { p_id: m.id });
  if (path) getSupa().then(c => c.storage.from('chat-voice').remove([path])).catch(() => {});
  return path != null;
}

const urlCache = new Map();
export async function audioUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const c = await getSupa();
  const { data, error } = await c.storage.from('chat-voice').createSignedUrl(path, 3600);
  if (error) throw wrap(error);
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3_300_000 });
  return data.signedUrl;
}

/** Підписані адреси для всіх голосових одним запитом — щоб перший дотик «Слухати» одразу запускав звук (iOS) */
export async function prefetchAudio(paths) {
  const need = [...new Set(paths)].filter(p => p && !(urlCache.get(p)?.exp > Date.now()));
  if (!need.length) return;
  try {
    const c = await getSupa();
    const { data } = await c.storage.from('chat-voice').createSignedUrls(need.slice(0, 100), 3600);
    for (const d of data || []) if (d.signedUrl && d.path) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3_300_000 });
  } catch { /* тоді — за першим дотиком */ }
}
export const cachedAudioUrl = (path) => (urlCache.get(path)?.exp > Date.now() ? urlCache.get(path).url : null);

export const canVoice = () => typeof MediaRecorder !== 'undefined' && micAvailable();

/** Запис голосового: { stop() → Promise<{ blob, dur }>, cancel() }, onTick(сек) */
export async function startRecording({ onTick, maxMs = VOICE_MAX_MS } = {}) {
  const stream = await getMic();
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); rec.start(250); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const t0 = Date.now();
  let done;
  const finished = new Promise(res => { done = res; });
  rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); done(); };
  const iv = setInterval(() => onTick?.((Date.now() - t0) / 1000), 250);
  const auto = setTimeout(() => halt(), maxMs);
  let stopped = false, cancelled = false;
  function halt() { if (stopped) return; stopped = true; clearInterval(iv); clearTimeout(auto); if (rec.state !== 'inactive') rec.stop(); }
  return {
    auto: finished,
    async stop() { const dur = (Date.now() - t0) / 1000; halt(); await finished; return { blob: new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] }), dur }; },
    cancel() { cancelled = true; halt(); },
    get cancelled() { return cancelled; },
  };
}

// ---------- Виклики ----------
export const CHALLENGES = [
  { kind: 'daily15', icon: 'timer', label: '15 хв щодня', sub: 'Кожен день тижня — від 15 хвилин занять', target: 7, unit: (n) => plural(n, 'день', 'дні', 'днів') },
  { kind: 'words', icon: 'cards', label: '200 слів за тиждень', sub: 'Повторені й нові слова в картках', target: 200, unit: (n) => plural(n, 'слово', 'слова', 'слів') },
  { kind: 'talks', icon: 'chat-circle-dots', label: '5 розмов з вчителем', sub: 'Голосом або в чаті, від 2 реплік', target: 5, unit: (n) => plural(n, 'розмова', 'розмови', 'розмов') },
];
function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return many; if (b === 1) return one; if (b >= 2 && b <= 4) return few; return many; }
export const challengeDef = (kind) => CHALLENGES.find(c => c.kind === kind) || CHALLENGES[0];
export function challengeTitle(kind, target) {
  if (kind === 'daily15') return target >= 7 ? '15 хв щодня' : `15 хв · ${target} ${plural(target, 'день', 'дні', 'днів')}`;
  if (kind === 'words') return `${target} ${plural(target, 'слово', 'слова', 'слів')} за тиждень`;
  return `${target} ${plural(target, 'розмова', 'розмови', 'розмов')} з вчителем`;
}
export const challengeActive = (c) => !c.cancelled && c.ends_on >= c.today;
/** Днів лишилось (включно з сьогодні) */
export const daysLeft = (c) => Math.max(0, Math.round((Date.parse(c.ends_on) - Date.parse(c.today)) / 864e5) + 1);
