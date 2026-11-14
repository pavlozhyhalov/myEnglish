// Теми розмов з вчителем: банк data/topics.json + журнал тем profiles.data.topicLog.
// Мета (власник 2026-11-14: «щоб вчитель не спілкувався постійно на одні й ті самі теми»):
// свіжі теми з урахуванням рівня, інтересів, цілей і того, що вже обговорювали; формат розмови теж чергується;
// події з пам'яті вчителя як початок розмови — не частіше ніж раз на 7 днів і ніколи двічі поспіль.
import * as store from './store.js';
import { json } from './data.js';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const rank = (l) => { const i = LEVELS.indexOf(l); return i < 0 ? 2 : i; };
const DAY = 864e5;
/** Скільки останніх розмов не повторюємо тему */
export const RECENT_N = 5;
/** Скільки записів зберігає журнал тем */
export const LOG_MAX = 30;
/** Подія з пам'яті вчителя як початок розмови — не частіше, ніж раз на стільки днів */
export const MEM_GAP_DAYS = 7;

/** Категорії банку (ті самі id — у topic_tags підсумку на сервері) */
export const CATS = ['daily', 'home', 'food', 'shopping', 'travel', 'city', 'nature', 'sport', 'hobbies', 'media', 'tech', 'people', 'culture', 'learning', 'health', 'work', 'future', 'opinion', 'wyr', 'story', 'problem', 'news'];
const CAT_ICON = {
  daily: 'sun', home: 'house', food: 'fork-knife', shopping: 'shopping-cart', travel: 'airplane-tilt', city: 'buildings', nature: 'plant',
  sport: 'barbell', hobbies: 'puzzle-piece', media: 'play', tech: 'phone', people: 'users', culture: 'books', learning: 'graduation-cap',
  health: 'heart', work: 'briefcase', future: 'rocket-launch', opinion: 'chat-centered-text', wyr: 'shuffle', story: 'quotes', problem: 'lightbulb', news: 'lightning',
};
// основи слів категорії — для «тем, яких уникати» з профілю
const CAT_KW = {
  food: ['їжа', 'їжу', 'їжі', 'кухн', 'food'], sport: ['спорт', 'sport'], work: ['робот', 'кар\'єр', 'work', 'job'], people: ['сім', 'родин', 'family'],
  travel: ['подорож', 'travel'], tech: ['технол', 'tech'], media: ['фільм', 'кіно', 'film'], health: ['здоров', 'health'], shopping: ['покуп', 'shopping'],
  news: ['новин', 'news'], home: ['дім', 'home'], future: ['майбут', 'future'],
};
/** Цілі навчання (profiles.data.about.goals і profiles.data.goalTags) → категорії, які частіше пропонувати */
const GOAL_CATS = {
  travel: ['travel', 'city', 'culture', 'nature', 'food'], work: ['work', 'problem', 'tech'], relocation: ['city', 'home', 'culture', 'problem', 'people'],
  moving: ['city', 'home', 'culture', 'problem', 'people'], media: ['media', 'tech', 'news', 'culture'], social: ['people', 'daily', 'wyr', 'story', 'food'],
  people: ['people', 'daily', 'wyr', 'story', 'food'], exam: ['opinion', 'story', 'problem', 'learning', 'news'], kids: ['learning', 'people', 'home'],
  self: ['learning', 'future', 'health'],
};
// формати за замовчуванням для категорії; вага формату за рівнем (складніші — вище)
const CAT_FMT = { opinion: ['debate'], wyr: ['wyr'], story: ['story'], problem: ['solve', 'roleplay'] };
const FMT_W = {
  A1: { chat: 3, quick: 3, describe: 1 },
  A2: { chat: 3, quick: 2, describe: 2, wyr: 2, roleplay: 2, story: 1 },
  B1: { chat: 2, quick: 1, describe: 2, wyr: 2, roleplay: 2, story: 2, debate: 2, solve: 2 },
  B2: { chat: 1, quick: 0.5, describe: 1, wyr: 1, roleplay: 2, story: 2, debate: 3, solve: 2 },
  C1: { chat: 1, quick: 0.3, describe: 1, wyr: 0.7, roleplay: 2, story: 2, debate: 3, solve: 2 },
};

// ---------- банк ----------
let bank = null;
/** Завантажити банк тем (кешується; офлайн — з кешу SW). null — не вдалося. */
export async function loadTopics() {
  if (bank) return bank;
  try { bank = await json('data/topics.json'); } catch (e) { console.warn('topics', e); bank = null; }
  return bank;
}
export const topicsBank = () => bank;

// ---------- журнал тем ----------
const cleanTags = (v) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 4);
/** Журнал тем, новіші першими: [{ key, at, id, topic, tags, mode, fmt, mem }] */
export function topicLog(p = store.prof()) {
  const arr = Array.isArray(p?.topicLog) ? p.topicLog : [];
  return arr.filter(e => e && typeof e === 'object' && e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
/**
 * Записати (або уточнити) тему розмови. key — ідентифікатор розмови (той самий запис оновлюється підсумком).
 * entry: { key, id?, topic?, tags?, mode?, fmt?, mem? }
 */
export function logTopic(entry) {
  if (!entry?.key) return null;
  const log = topicLog();
  const prev = log.find(e => e.key === entry.key) || {};
  const e = { ...prev, key: String(entry.key), at: prev.at || entry.at || new Date().toISOString() };
  if (entry.id) e.id = String(entry.id).slice(0, 60);
  if (entry.topic) e.topic = String(entry.topic).replace(/\s+/g, ' ').trim().slice(0, 80);
  const tags = cleanTags(entry.tags);
  if (tags.length) e.tags = tags;
  if (entry.mode) e.mode = String(entry.mode).slice(0, 12);
  if (entry.fmt) e.fmt = String(entry.fmt).slice(0, 12);
  if (entry.mem) e.mem = String(entry.mem).slice(0, 60);
  const next = [e, ...log.filter(x => x.key !== e.key)].slice(0, LOG_MAX);
  store.setProf({ topicLog: next });
  return e;
}

// ---------- пам'ять як початок розмови ----------
/** Чи можна почати розмову з факту з пам'яті: минула розмова не з пам'яті й за 7 днів не було такого початку */
export function memoryOpenerOk(log = topicLog(), now = new Date()) {
  if (log[0]?.mem) return false;
  return !log.some(e => e.mem && now - Date.parse(e.at) < MEM_GAP_DAYS * DAY);
}
/**
 * Чи можна взяти саме цей факт: ще не використаний; або використаний до дати події, а подія вже минула
 * (тоді — один раз спитати, як усе пройшло).
 */
export function factAllowed(log, factId, eventDate, now = new Date()) {
  if (!memoryOpenerOk(log, now)) return false;
  const uses = log.filter(e => e.mem === factId);
  if (!uses.length) return true;
  if (uses.length >= 2 || !eventDate) return false;
  const last = Math.max(...uses.map(e => Date.parse(e.at)));
  return eventDate.getTime() > last && eventDate.getTime() <= now.getTime();
}

// ---------- вибір тем ----------
/** Детермінований генератор [0,1) за рядком-зерном (для «теми дня») */
export function seeded(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const LETTER = 'a-zа-яіїєґ\'ʼ';
const stemHit = (text, stem) => {
  const s = String(stem || '').toLowerCase().trim();
  if (!s || !text) return false;
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // основа — з початку слова (не «гра» в «програмування»), коротка (≤ 2) — ціле слово
  return new RegExp(`(^|[^${LETTER}])${esc}${s.length <= 2 ? `(?![${LETTER}])` : ''}`, 'i').test(text);
};

/** Інтереси з профілю — окремі пункти «гори, кіно, готування» */
export function interestList(about = {}) {
  return String(about.interests || '').split(/[,;\n/]|\s+(?:і|й|та|and)\s+/).map(x => x.replace(/[.!]+$/, '').trim()).filter(x => x.length >= 2 && x.length <= 40).slice(0, 6);
}
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);

function chooseFmt(t, level, log, rand, formats) {
  const lr = rank(level);
  const byId = new Map(formats.map(f => [f.id, f]));
  let allowed = (t.fmt || CAT_FMT[t.cat] || ['chat', 'describe', 'quick']).filter(f => byId.has(f) && lr >= rank(byId.get(f).min));
  if (!allowed.length) allowed = ['chat'];
  const recentF = log.slice(0, 3).map(e => e.fmt).filter(Boolean);
  const w = allowed.map(f => (FMT_W[level]?.[f] ?? 1) * (recentF.includes(f) ? 0.35 : 1) + 0.01);
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < allowed.length; i++) { r -= w[i]; if (r <= 0) return allowed[i]; }
  return allowed[allowed.length - 1];
}

/** Інструкція для вчителя (іде в системний промпт або першу репліку-сигнал; сервер приймає до 600 символів) */
export function topicText(t, fmt, formats = bank?.formats || []) {
  const F = formats.find(f => f.id === fmt);
  return `Topic: ${t.en}. Format: ${F ? F.en : 'casual chat.'} Open with a question like "${t.q}" Fresh angles when it runs dry: ${(t.a || []).join('; ')}. The student may switch topic at any time.`.slice(0, 600);
}

/**
 * Свіжі теми для учня. Чиста функція (тести без браузера):
 * o = { bank, level, about, goalTags, workFocus, log, n, rand, now }
 * → [{ id, label, sub, icon, cat, fmt, tags, en, topic }] — різні категорії, без тем останніх RECENT_N розмов.
 */
export function pickTopics(o = {}) {
  const b = o.bank || bank;
  if (!b?.topics?.length) return [];
  const level = LEVELS.includes(o.level) ? o.level : 'B1';
  const lr = rank(level);
  const about = o.about || {};
  const log = o.log || [];
  const now = o.now || new Date();
  const rand = o.rand || Math.random;
  const n = Math.max(1, o.n || 5);
  const interests = String(about.interests || '').toLowerCase();
  const avoid = String(about.avoid || '').toLowerCase();
  const goals = [...new Set([...(about.goals || []), ...(o.goalTags || [])])];
  const goalCats = new Set(goals.flatMap(g => GOAL_CATS[g] || []));
  const work = !!o.workFocus || goals.includes('work');
  const recent = log.slice(0, RECENT_N);
  const recentIds = new Set(recent.map(e => e.id).filter(Boolean));
  const exclude = new Set(o.exclude || []);
  const lastCats = new Set(log.slice(0, 2).flatMap(e => e.tags || []));
  const catAt = new Map();
  for (const e of log) for (const c of e.tags || []) if (!catAt.has(c)) catAt.set(c, Date.parse(e.at));
  const used = new Map();
  for (const e of log) if (e.id) used.set(e.id, (used.get(e.id) || 0) + 1);

  const scored = [];
  for (const t of b.topics) {
    const lo = rank(t.lv?.[0]), hi = rank(t.lv?.[1] || t.lv?.[0]);
    const dist = lr < lo ? lo - lr : lr > hi ? lr - hi : 0;
    if (dist > 1 || recentIds.has(t.id) || exclude.has(t.id)) continue;
    if (t.cat === 'work' && !work) continue;
    const kws = [...(t.kw || []), ...(CAT_KW[t.cat] || [])];
    if (avoid && kws.some(k => stemHit(avoid, k))) continue;
    let s = 1 - dist * 0.9;
    if (interests && (t.kw || []).some(k => stemHit(interests, k))) s += 2.5;
    if (goalCats.has(t.cat)) s += 1;
    if (lastCats.has(t.cat)) s -= 1.2;
    else {
      const at = catAt.get(t.cat);
      s += at ? Math.min(21, (now - at) / DAY) / 21 * 0.8 : 0.8;
    }
    s -= 0.4 * (used.get(t.id) || 0);
    s += rand() * 1.2;
    scored.push({ t, s });
  }
  scored.sort((a, b2) => b2.s - a.s);
  const out = [], cats = new Set();
  for (const { t } of scored) {
    if (cats.has(t.cat)) continue;
    cats.add(t.cat);
    const fmt = chooseFmt(t, level, log, rand, b.formats || []);
    const F = (b.formats || []).find(f => f.id === fmt);
    out.push({ id: t.id, label: t.uk, sub: F?.uk || '', icon: CAT_ICON[t.cat] || 'chat-circle-dots', cat: t.cat, fmt, tags: [t.cat], en: t.en, topic: topicText(t, fmt, b.formats || []) });
    if (out.length >= n) break;
  }
  return out;
}

/** Тема з інтересів профілю, яку найдовше не обговорювали (інтереси — завжди особисті, тож у кожній добірці одна) */
export function interestPick(about = {}, log = [], level = 'B1') {
  const recentIds = new Set(log.slice(0, RECENT_N).map(e => e.id));
  const list = interestList(about).map(x => ({ x, id: `int:${slugOf(x)}` })).filter(o => !recentIds.has(o.id));
  if (!list.length) return null;
  const lastAt = (id) => { const e = log.find(l => l.id === id); return e ? Date.parse(e.at) : 0; };
  list.sort((a, b) => lastAt(a.id) - lastAt(b.id));
  const { x, id } = list[0];
  const fmt = rank(level) >= 2 ? 'describe' : 'chat';
  return {
    id, label: x.charAt(0).toUpperCase() + x.slice(1), sub: 'Ваш інтерес', icon: 'heart', cat: 'interest', fmt, tags: ['hobbies'], en: x,
    topic: `Topic: one of the student's interests — «${x}». Go into specifics in a fresh way (a recent experience, a recommendation, an opinion, how they got into it); do not repeat questions from earlier sessions. The student may switch topic at any time.`.slice(0, 600),
  };
}

/** Профіль учня для вибору тем (зі сховища) */
function ctx() {
  const p = store.prof() || {};
  const s = store.settings();
  return { level: s.level, about: p.about || {}, goalTags: Array.isArray(p.goalTags) ? p.goalTags : [], workFocus: !!s.workFocus, log: topicLog(p) };
}

/** Плитки тем для старту розмови: одна з інтересів профілю + свіжі теми банку різних категорій */
export function topicChips(n = 5, o = {}) {
  const c = { ...ctx(), ...o };
  const mine = interestPick(c.about, c.log, c.level);
  const picks = pickTopics({ ...c, n: mine ? n - 1 : n });
  return mine ? [picks[0], mine, ...picks.slice(1)].filter(Boolean) : picks;
}

/** Тема для «просто почати»: найкраща свіжа тема (зерно — для стабільного вибору, наприклад, на день) */
export function defaultPick(o = {}) {
  const c = { ...ctx(), ...o };
  return pickTopics({ ...c, n: 1, rand: o.seed != null ? seeded(o.seed) : o.rand })[0] || null;
}

/** Відновити тему за id і форматом (наприклад, тема дня з адреси) */
export function pickById(id, fmt) {
  const t = bank?.topics?.find(x => x.id === id);
  if (!t) return null;
  const F = (bank.formats || []).find(f => f.id === fmt) || (bank.formats || [])[0];
  return { id: t.id, label: t.uk, sub: F?.uk || '', icon: CAT_ICON[t.cat] || 'chat-circle-dots', cat: t.cat, fmt: F?.id || 'chat', tags: [t.cat], en: t.en, topic: topicText(t, F?.id, bank.formats || []) };
}

/** Позначка теми для адреси: «id~fmt» або «mem~factId» */
export const pickParam = (p) => (p?.mem ? `mem~${p.mem}` : p?.id ? `${p.id}~${p.fmt || ''}` : '');
export function parsePickParam(s) {
  const [a, b] = String(s || '').split('~');
  if (!a) return null;
  return a === 'mem' ? { id: 'mem', mem: b || 'event', tags: ['memory'] } : { id: a, fmt: b || null };
}
