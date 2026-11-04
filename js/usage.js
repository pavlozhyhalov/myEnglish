// Слова, які учень сам уживає в розмовах, — автоматично «вивчено» в словнику (запит власника 2026-11-03).
// Джерело — власні репліки учня в розмовах з вчителем (голос, чат, сценарії) і щоденнику (tutor_chats синхронізуються, тож результат той самий на всіх пристроях).
// Слово зараховується, якщо вжите правильно щонайменше у 2 різних розмовах: слова з виправлених фрагментів цієї розмови не рахуються.
// Без AI-запитів: лематизація й колоди — на пристрої.
import * as store from './store.js';
import * as srs from './srs.js';
import { allDecks } from './data.js';
import { lemmas } from './ui/wordtap.js';

export const MIN_CHATS = 2;
const MODES = new Set(['voice', 'chat', 'scenario', 'diary']);
const WINDOW_DAYS = 180;
// службові й надто загальні слова: їх уживання нічого не говорить про словниковий запас
const STOP = new Set(('a an the and or but so if of to in on at by for from with about as into than then that this these those there here ' +
  'i me my mine you your yours he him his she her hers it its we us our they them their what who whom which when where why how ' +
  'be am is are was were been being have has had do does did done not no yes ok okay oh uh um er hmm yeah well very too also just ' +
  'can could will would shall should may might must get got go went gone say said like really thing things one some any all').split(' '));

const norm = (s) => String(s || '').toLowerCase().replace(/[’‘`ʼ]/g, "'");
const tokens = (text) => (norm(text).match(/[a-z]+(?:'[a-z]+)?/g) || []);

/** Ключі картки: «to miss a flight / train» → [«miss a flight», «miss a train»]; без «to»/артикля на початку, без дужок */
function keysOf(en, pos = '') {
  const raw = String(en || '');
  if (/…|\.\.\.|\bsb\b|\bsth\b|somebody|something/i.test(raw)) return [];   // шаблони («My name is …», «to ask sb for sth») — не ловимо
  const vars = raw.split(/\s*\/\s*/);
  const first = vars[0].replace(/\([^)]*\)/g, '').trim().split(/\s+/);
  const out = [];
  vars.forEach((v, i) => {
    let base = v.replace(/\([^)]*\)/g, '').replace(/[.?!,;:]+/g, ' ').trim();
    const noun = /^(a|an|the)\s/i.test(base) || /^n(oun)?\b/i.test(String(pos || ''));
    if (i > 0 && !/\s/.test(base) && first.length > 2) base = [...first.slice(0, -1), base].join(' ');
    const w = tokens(base);
    while (w.length > 1 && /^(to|a|an|the)$/.test(w[0])) w.shift();
    if (!w.length || w.length > 5) return;
    if (w.length === 1 && (STOP.has(w[0]) || w[0].length < 3)) return;
    if (w.every(x => STOP.has(x))) return;
    out.push({ words: w, noun });
  });
  return out;
}

/** Індекс карток: перше слово ключа → [{ words, id, deckId, card }] (колоди + власні картки) */
let indexP = null;
async function cardIndex() {
  if (!indexP) indexP = (async () => {
    const enabled = new Set((await srs.decks()).filter(d => d.enabled).map(d => d.id));
    const m = new Map();
    const add = (en, pos, ref) => { for (const { words, noun } of keysOf(en, pos)) { const k = words[0]; if (!m.has(k)) m.set(k, []); m.get(k).push({ words, noun, ...ref }); } };
    for (const d of await allDecks()) {
      if (!enabled.has(d.id)) continue;
      for (const c of d.cards) add(c.en, c.pos, { id: srs.starterId(d.id, c.en), deckId: d.id, card: c });
    }
    for (const c of store.all('cards')) if (c.deck_id === 'my' || !enabled.has(c.deck_id)) add(c.en, c.pos, { id: c.id, deckId: c.deck_id, card: null });
    return m;
  })().catch(e => { indexP = null; throw e; });
  return indexP;
}

// Питання про слово — не вживання: «I don't understand the word fridge», «Cosy, what do you mean?», «how to say котел»
const ASKING = /\b(don'?t|do not|didn'?t|did not|can'?t) understand\b|\bwhat (do|does|did) (you|it|this|that|the word)\b[^.?!]*\bmean|\bwhat (is|are|'s) (it|this|that|the word|a|an)\b|\bhow (to|do you|can i|i can|would you|will it|it will|it would|could it) (say|translate|be)\b|\btranslate\b|\bwhat (is|does) .{1,30} mean/i;
/** Репліки учня в розмові (без службових, прихованих і питань про значення слів) */
function learnerTexts(chat) {
  return (chat.messages || []).filter(m => m.role === 'user' && !m.hidden && !m.cue && m.text && !ASKING.test(String(m.text))).map(m => String(m.text));
}
/** Слова, які вчитель пояснив у цій розмові (нові слова підсумку): у ній самій учень лише повторює їх — не зараховуємо */
function taughtWords(chat) {
  const s = chat.summary || {};
  const list = [...(Array.isArray(s.new_words) ? s.new_words : []), ...(Array.isArray(s.auto_words) ? s.auto_words : [])];
  const out = new Set();
  for (const w of list) for (const t of tokens(w?.en)) if (!STOP.has(t)) for (const l of lemmas(t)) out.add(l);
  return out;
}
/** Слова з виправлених фрагментів розмови: у цій розмові не зараховуються */
function wrongWords(chat) {
  const fixes = [...(chat.summary?.mistakes || []), ...(chat.messages || []).flatMap(m => (Array.isArray(m.fixes) ? m.fixes : []))];
  const bad = new Set();
  for (const f of fixes) {
    const right = new Set(tokens(f?.right));
    for (const w of tokens(f?.wrong)) if (!right.has(w)) for (const l of lemmas(w)) bad.add(l);
  }
  return bad;
}

/** Ідентифікатори карток, ужитих у розмові: Map id → { ref, sample } */
function usedIn(chat, idx) {
  const bad = wrongWords(chat);
  for (const w of taughtWords(chat)) bad.add(w);
  const found = new Map();
  for (const text of learnerTexts(chat)) {
    const toks = tokens(text);
    const forms = toks.map(t => new Set(lemmas(t)));
    // токен підходить слову ключа; іменник («the check») не впізнаємо за дієслівною формою (checked, checking)
    const fits = (k, word, noun) => forms[k].has(word) && !(noun && toks[k] !== word && /(ed|ing)$/.test(toks[k]));
    // іменник не стоїть після be/feel/very («I'm fine» — не «a fine» «штраф»)
    const PRED = /^(am|is|are|was|were|be|been|being|feel|feels|felt|look|looks|seem|seems|very|so|too|quite|really|pretty)$|'(m|re|s)$/;
    const nounOk = (i, noun) => !noun || i === 0 || !PRED.test(toks[i - 1]);
    const hits = [];
    for (let i = 0; i < toks.length; i++) {
      const seen = new Set();
      for (const f of forms[i]) {
        for (const e of idx.get(f) || []) {
          const n = e.words.length;
          if (seen.has(e) || i + n > toks.length) continue;
          let ok = true;
          for (let j = 0; j < n && ok; j++) ok = fits(i + j, e.words[j], e.noun);
          if (!ok || !nounOk(i, e.noun) || e.words.some(w => bad.has(w))) continue;
          seen.add(e);
          hits.push({ e, from: i, to: i + n });
        }
      }
    }
    // найдовший збіг перемагає: «check in» не зараховує ще й «check», «cook dinner» — «cook»
    hits.sort((a, b) => (b.to - b.from) - (a.to - a.from));
    const taken = new Array(toks.length).fill(null);
    for (const x of hits) {
      const len = x.to - x.from;
      let clash = false;
      for (let k = x.from; k < x.to; k++) if (taken[k] != null && taken[k] > len) clash = true;
      if (clash) continue;
      for (let k = x.from; k < x.to; k++) taken[k] = Math.max(taken[k] || 0, len);
      if (!found.has(x.e.id)) found.set(x.e.id, { ref: x.e, sample: text.length > 160 ? text.slice(0, 157) + '…' : text });
    }
  }
  return found;
}

/**
 * Перерахувати вживання і позначити вивченими слова, ужиті правильно щонайменше в MIN_CHATS розмовах.
 * Повертає список щойно позначених [{ id, en, uk, chats }]. onlyChat — показати лише слова, ужиті в цій розмові.
 */
export async function markUsedWords({ onlyChat = null } = {}) {
  if (store.settings().autoKnown === false) return [];
  const since = Date.now() - WINDOW_DAYS * 864e5;
  const chats = store.all('tutor_chats').filter(c => MODES.has(c.mode) && Date.parse(c.created_at || 0) >= since);
  if (!chats.length) return [];
  const idx = await cardIndex();
  const uses = new Map();   // id → { ref, chats: [{ at, sample }] }
  for (const c of chats) {
    for (const [id, u] of usedIn(c, idx)) {
      const e = uses.get(id) || { ref: u.ref, chats: [] };
      e.chats.push({ id: c.id, at: c.created_at, sample: u.sample });
      uses.set(id, e);
    }
  }
  const out = [];
  for (const [id, u] of uses) {
    const stored = store.get('cards', id);
    // повернуто до вивчення вручну — рахуються лише розмови після цього
    const after = stored?.extra?.relearnAt || null;
    const list = after ? u.chats.filter(x => String(x.at) > after) : u.chats;
    if (list.length < MIN_CHATS) continue;
    if (onlyChat && !list.some(x => x.id === onlyChat)) continue;
    if (stored && srs.isLearned(stored)) continue;
    const row = stored || (u.ref.card ? srs.rowFromStarter(u.ref.deckId, u.ref.card) : null);
    if (!row) continue;
    srs.markKnown(row, { source: 'usage', chats: list.length, sample: list[list.length - 1].sample });
    out.push({ id: row.id, en: row.en, uk: row.uk, chats: list.length });
  }
  if (out.length) indexP = null;   // нові картки в сховищі — індекс перебудується
  return out;
}

// Фонова перевірка всіх розмов: після синхронізації, не частіше ніж раз на 6 годин на пристрої
const RUN_KEY = 'me:usage-run';
export async function backgroundMarkUsed() {
  try { if (Date.now() - Number(localStorage.getItem(RUN_KEY) || 0) < 6 * 3600e3) return []; } catch { /* */ }
  const out = await markUsedWords();
  try { localStorage.setItem(RUN_KEY, String(Date.now())); } catch { /* */ }
  return out;
}
