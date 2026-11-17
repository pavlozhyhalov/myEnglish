// Переписка з друзями (міграція 0023): чати 1:1 і групи до 10 людей, голосові, приватні виправлення вчителя, спільні виклики.
// Дані — лише на сервері (RLS: повідомлення бачать учасники, виправлення — автор). Нові повідомлення — Supabase Realtime у відкритому чаті
// (запасний варіант — опитування раз на 15 с), поза застосунком — Web Push (функція push).
// Перевірка: текст — tutor `friend_check` після надсилання; голос — tutor `friend_voice` (розпізнавання + перевірка + вставка).
// Помилки з переписки йдуть у «Мої помилки» (source 'chat-friends', ref = id повідомлення) лише на пристрої, що надіслав.
import { getSupa, user } from './supa.js';
import * as store from './store.js';
import { tutor } from './ai.js';
import { addMistake, isDisputed } from './stats.js';
import { getMic, micAvailable } from './speech.js';

const COLS = 'id, room_id, user_id, kind, body, audio_path, meta, created_at, deleted_at, reply_to';
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
// учасники + «у мережі» і «прочитано» (міграція 0034); старий виклик — запасний
export const roomMembers = (room) => rpc('chat_room_people', { p_room: room }).catch(() => rpc('chat_room_members', { p_room: room }));
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
// вчитель у чаті (міграції 0027, 0034): відповідає на звертання «Teacher, …» / «Вчителю…» — у групі й у чаті з другом
/** Чи звертаються до вчителя (власник 2026-11-17: «просто зверненням "Teacher,", без @ і видумок»).
 *  Так: «Teacher, …», «Hi teacher …», «Teacher how do you say…» (на початку), «…, teacher?» (у кінці), «So, teacher, …», «Вчителю…», «@teacher».
 *  Ні: «my teacher at school», «I asked the teacher» — слово «teacher» у розповіді вчителя не кличе. */
const T_WORD = '(?:teacher|tutor|вчителю|учителю|вчитель|учитель)';
const T_END = '(?=$|[\\s,.!?:;)"»\'’…-])';
const T_START = new RegExp(`^[\\s"«'(]*(?:(?:hi|hey|hello|dear|ok|okay|so|and|please|sorry|thanks|thank you|well|excuse me|good (?:morning|afternoon|evening)|привіт|вітаю|добрий день|шановний|пане)[\\s,!.]+)*@?${T_WORD}${T_END}`, 'iu');
const T_TAIL = new RegExp(`,\\s*@?${T_WORD}\\s*[.!?)…]*\\s*$`, 'iu');
const T_MID = new RegExp(`,\\s*${T_WORD}\\s*,`, 'iu');
const T_ANY = /(^|[^\p{L}])(?:@(?:teacher|tutor)|вчителю|учителю)(?!\p{L})/iu;
export function mentionsTutor(text) {
  const t = String(text || '').slice(0, 1000);
  return T_START.test(t) || T_TAIL.test(t) || T_MID.test(t) || T_ANY.test(t);
}
export const askTutor = (room, messageId, auto = false) => tutor('group_tutor', { room_id: room, message_id: messageId, auto });
export const praiseTutor = (room) => tutor('group_tutor', { room_id: room, praise: true }).catch(() => null);
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
export async function sendText(room, body, replyTo = null) {
  const c = await getSupa();
  const { data, error } = await c.from('chat_messages').insert({ room_id: room, user_id: user()?.id, kind: 'text', body, reply_to: replyTo || null }).select(COLS).single();
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
export async function sendVoice(room, blob, dur, replyTo = null) {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const ext = EXT[mime] || 'webm';
  const path = `${room}/${user()?.id}/${rid()}.${ext}`;
  const c = await getSupa();
  const up = await c.storage.from('chat-voice').upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new ChatError('bad_audio', up.error.message);
  // файл не видаляємо при збої: сервер міг уже вставити повідомлення (відповідь загубилась); якщо вставки не було — прибирає сервер
  const r = await tutor('friend_voice', { room_id: room, path, audio: await toB64(blob), mime, dur: Math.round(dur * 10) / 10, reply_to: replyTo || undefined });
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

// ---------- Реакції (міграція 0031): одна на людину на повідомлення; 'tutor' — реакція вчителя ----------
export const REACTIONS = [
  { kind: 'like', icon: 'thumbs-up', label: 'Клас' },
  { kind: 'love', icon: 'heart', label: 'Супер' },
  { kind: 'haha', icon: 'smiley', label: 'Смішно' },
  { kind: 'smart', icon: 'lightbulb', label: 'Влучно' },
  { kind: 'bravo', icon: 'hands-clapping', label: 'Браво' },
];
export const reactionDef = (k) => REACTIONS.find(r => r.kind === k);
/** Реакції чату → Map(messageId → [{ who, kind }]) */
export async function reactions(room) {
  const c = await getSupa();
  const { data } = await c.from('chat_reactions').select('message_id, who, kind').eq('room_id', room).not('kind', 'is', null).limit(2000);
  const out = new Map();
  for (const r of data || []) { if (!out.has(r.message_id)) out.set(r.message_id, []); out.get(r.message_id).push({ who: r.who, kind: r.kind }); }
  return out;
}
export const react = (messageId, kind) => rpc('chat_react', { p_message: messageId, p_kind: kind || null });
/** Підписка на реакції чату (окремий канал) */
export function subscribeReactions(room, onChange) {
  let ch = null, dead = false;
  getSupa().then(c => {
    if (dead) return;
    ch = c.channel(`react:${room}:${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `room_id=eq.${room}` }, (p) => { try { onChange(p.new); } catch (e) { console.warn('react rt', e); } })
      .subscribe();
  }).catch(() => {});
  return () => { dead = true; if (ch) getSupa().then(c => c.removeChannel(ch)).catch(() => {}); };
}

// ---------- Живий чат (міграція 0034): «друкує…», «прочитано», «у мережі», новини друзів ----------
/** Приватний канал room:<id> (лише учасники): «друкує…» і «прочитав» наживо. Повертає { typing(), read(), close() } */
export function roomLive(room, { onTyping, onRead } = {}) {
  let ch = null, dead = false, ready = false, lastTyping = 0;
  const me = user()?.id;
  getSupa().then(c => {
    if (dead) return;
    ch = c.channel(`room:${room}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => { if (payload?.uid && payload.uid !== me) onTyping?.(payload.uid); })
      .on('broadcast', { event: 'read' }, ({ payload }) => { if (payload?.uid && payload.uid !== me) onRead?.(payload.uid, payload.at); })
      .subscribe((st) => { ready = st === 'SUBSCRIBED'; });
  }).catch(() => {});
  const send = (event, payload) => { if (ready && ch) ch.send({ type: 'broadcast', event, payload: { uid: me, ...payload } }).catch(() => {}); };
  return {
    // не частіше раз на 2,5 с; співрозмовник гасить «друкує…» сам через 5 с без нових сигналів
    typing() { const t = Date.now(); if (t - lastTyping < 2500) return; lastTyping = t; send('typing', {}); },
    read() { send('read', { at: new Date().toISOString() }); },
    close() { dead = true; if (ch) getSupa().then(c => c.removeChannel(ch)).catch(() => {}); },
  };
}

/** «У мережі» — серцебиття з пристрою, поки застосунок на екрані (не частіше раз на хвилину) */
let seenAt = 0;
export function heartbeat() {
  if (!user() || document.hidden || !navigator.onLine || Date.now() - seenAt < 60_000) return;
  seenAt = Date.now();
  rpc('chat_seen').catch(() => { seenAt = 0; });
}
export const presenceHidden = (on = null) => rpc('chat_presence_hidden', { p_hidden: on });
export const ONLINE_MS = 3 * 60_000;
/** Підпис присутності: «у мережі», «востаннє в мережі 5 хв тому», «… сьогодні о 14:05», «… учора», «… 12 лист.» */
export function seenLabel(iso) {
  if (!iso) return '';
  const t = Date.parse(iso), d = Date.now() - t;
  if (d < ONLINE_MS) return 'у мережі';
  if (d < 60 * 60_000) return `востаннє в мережі ${Math.round(d / 60_000)} хв тому`;
  const dt = new Date(t), now = new Date();
  const hm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  if (dt.toDateString() === now.toDateString()) return `востаннє в мережі сьогодні о ${hm}`;
  if (new Date(now - 864e5).toDateString() === dt.toDateString()) return `востаннє в мережі вчора о ${hm}`;
  if (d < 30 * 864e5) return `востаннє в мережі ${dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`;
  return 'давно не заходили';
}

/** «Про що поговорити?» — 3 теми з банку вчителя (data/topics.json) за рівнем; щоразу інші */
let topicsP = null;
export async function starters(level, n = 3) {
  topicsP ||= fetch('data/topics.json').then(r => r.json()).catch(() => { topicsP = null; return { topics: [] }; });
  const all = (await topicsP).topics || [];
  const LV = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1'];
  const i = Math.max(0, LV.indexOf(level === 'A0' ? 'A1' : level));
  const fit = all.filter(t => { const [a, b] = (t.lv || []).map(x => LV.indexOf(x)); return a <= i && i <= (b ?? a); });
  const pool = (fit.length >= n ? fit : all).slice();
  for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  // різні категорії
  const out = [], cats = new Set();
  for (const t of pool) { if (out.length >= n) break; if (cats.has(t.cat)) continue; cats.add(t.cat); out.push(t); }
  return out;
}

/** Новини друзів у групах (серія днів, іспит рівня, рекорд у грі) — лише якщо учень не вимкнув shareNews */
export async function shareNews(kind, value, score = null) {
  if (!user()) return 0;
  if (store.settings().shareNews === false) return 0;
  return rpc('chat_share_news', { p_kind: kind, p_value: String(value), p_score: score }).catch(() => 0);
}
export const STREAK_NEWS = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 300, 365, 500, 730, 1000];
