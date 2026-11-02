// Фразник: готові фрази для реальних ситуацій. Кожна фраза — FSRS-картка («Мої слова») з тегами phrase і sit:<id>
import * as store from './store.js';
import * as srs from './srs.js';

/** Ситуації: id, підпис, іконка Phosphor */
export const SITUATIONS = [
  { id: 'doctor', uk: 'Лікар і аптека', icon: 'first-aid' },
  { id: 'phone', uk: 'Телефон і дзвінки', icon: 'phone' },
  { id: 'shop', uk: 'Магазин і сервіс', icon: 'shopping-cart' },
  { id: 'cafe', uk: 'Кафе й ресторан', icon: 'coffee' },
  { id: 'travel', uk: 'Транспорт і подорожі', icon: 'airplane-tilt' },
  { id: 'home', uk: 'Житло й сусіди', icon: 'house' },
  { id: 'work', uk: 'Робота', icon: 'briefcase' },
  { id: 'smalltalk', uk: 'Знайомство й small talk', icon: 'hand-waving' },
  { id: 'office', uk: 'Банк, пошта, документи', icon: 'bank' },
  { id: 'other', uk: 'Інше', icon: 'chat-centered-text' },
];
export const situation = (id) => SITUATIONS.find(s => s.id === id) || SITUATIONS[SITUATIONS.length - 1];

const norm = (s) => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '').trim();
const clean = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const isPhrase = (c) => c?.extra?.kind === 'phrase' || (Array.isArray(c?.tags) && c.tags.includes('phrase'));
export const phraseSituation = (c) => {
  const id = c?.extra?.situation || (c?.tags || []).find(t => String(t).startsWith('sit:'))?.slice(4);
  return SITUATIONS.some(s => s.id === id) ? id : 'other';
};

/** Усі фрази (не видалені), нові — першими */
export function allPhrases() {
  return store.all('cards').filter(isPhrase).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
/** Map: situationId → [картки] (лише непорожні ситуації) */
export function phrasesBySituation() {
  const m = new Map();
  for (const c of allPhrases()) {
    const id = phraseSituation(c);
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(c);
  }
  return m;
}
export function phraseCount() { return allPhrases().length; }

// Ключові слова ситуацій (укр/англ, основи слів). Перевіряються по черзі — перша з найбільшою кількістю збігів перемагає
const KEYS = {
  doctor: ['лікар', 'аптек', 'хвор', 'болить', 'біль', 'симптом', 'рецепт', 'ліки', 'таблет', 'стоматолог', 'зуб', 'температур', 'лікарн', 'клінік', 'медсестр', 'doctor', 'gp', 'pharma', 'chemist', 'prescription', 'medicine', 'symptom', 'pain', 'hurt', 'sore', 'dentist', 'appointment', 'hospital', 'clinic', 'nurse', 'tablet', 'pill', 'sick', 'allerg', 'temperature'],
  phone: ['телефон', 'дзвін', 'дзвон', 'зателефон', 'подзвон', 'гаряча лінія', 'оператор', 'автовідповідач', 'phone', 'call', 'ring', 'voicemail', 'hold', 'speak to', 'line', 'message'],
  shop: ['магазин', 'покуп', 'чек', 'повернен', 'обмін', 'розмір', 'знижк', 'ремонт', 'перукар', 'сервіс', 'доставк', 'гарантій', 'shop', 'store', 'receipt', 'refund', 'return', 'exchange', 'size', 'discount', 'repair', 'haircut', 'delivery', 'warranty', 'checkout', 'till', 'buy', 'price'],
  cafe: ['кафе', "кав'ярн", 'кава', 'каву', 'ресторан', 'замов', 'офіціант', 'меню', 'столик', 'рахунок', 'бар', 'їж', 'обід', 'вечер', 'cafe', 'café', 'coffee', 'restaurant', 'order', 'waiter', 'menu', 'table', 'bill', 'bar', 'lunch', 'dinner', 'tea', 'food', 'drink'],
  travel: ['поїзд', 'потяг', 'квиток', 'аеропорт', 'літак', 'рейс', 'готел', 'автобус', 'таксі', 'метро', 'вокзал', 'подорож', 'багаж', 'кордон', 'паспорт', 'маршрут', 'дорог', 'train', 'ticket', 'airport', 'flight', 'plane', 'hotel', 'bus', 'taxi', 'tube', 'underground', 'station', 'travel', 'trip', 'luggage', 'baggage', 'passport', 'check-in', 'platform', 'directions', 'journey', 'booking'],
  home: ['житл', 'квартир', 'сусід', 'орендодав', 'оренд', 'будинок', 'кімнат', 'ремонт квартири', 'сантехнік', 'комунальн', 'flat', 'apartment', 'neighbour', 'neighbor', 'landlord', 'rent', 'tenant', 'house', 'room', 'plumber', 'heating', 'leak', 'noise', 'bills'],
  work: ['робот', 'нарад', 'колег', 'співбесід', 'начальник', 'керівник', 'проєкт', 'офіс', 'зміна', 'зарплат', 'work', 'job', 'meeting', 'colleague', 'interview', 'manager', 'boss', 'project', 'deadline', 'shift', 'salary', 'team', 'client'],
  smalltalk: ['знайом', 'small talk', 'погод', 'вихідн', 'хобі', 'вечірк', 'друз', 'привіт', 'розмова з', 'nice to meet', 'weather', 'weekend', 'hobby', 'party', 'friend', 'introduce', 'where are you from', 'chat'],
  office: ['банк', 'пошт', 'посилк', 'документ', 'рахун', 'картк', 'переказ', 'реєстрац', 'державн', 'установ', 'анкет', 'форм', 'віз', 'дозвіл', 'bank', 'post', 'parcel', 'document', 'account', 'card', 'transfer', 'register', 'council', 'form', 'visa', 'permit', 'id', 'certificate', 'office'],
};
// ключ — з початку слова; короткий (≤ 4 літер) — ціле слово з закінченням (id, bar, tea, зуб, чек…), інакше «чек» знайшовся б у «чекати»
const W = "a-zа-яіїєґ'";
const reCache = new Map();
function keyRe(w) {
  if (!reCache.has(w)) {
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tail = w.length <= 4 ? `(?:s|es|ed|ing|[аиуіяюоеєї])?(?![${W}])` : '';
    reCache.set(w, new RegExp(`(?:^|[^${W}])${e}${tail}`));
  }
  return reCache.get(w);
}
/** Ситуація за текстом (назва місії/сценарію, тема розмови): 'other', якщо нічого не підійшло */
export function guessSituation(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[’]/g, "'") + ' ';
  let best = 'other', score = 0;
  for (const [id, words] of Object.entries(KEYS)) {
    let n = 0;
    for (const w of words) if (keyRe(w).test(t)) n++;
    if (n > score) { score = n; best = id; }
  }
  return best;
}

/** Переклад кількох фраз одним запитом (рядок на фразу); null — не вийшло */
async function translateLines(lines) {
  try {
    const { user } = await import('./supa.js');
    if (!user() || !navigator.onLine) return null;
    const { tutor } = await import('./ai.js');
    const r = await tutor('translate', { text: lines.join('\n') });
    const out = String(r?.uk || r?.text || '').split('\n').map(s => s.trim()).filter(Boolean);
    return out.length === lines.length ? out : null;
  } catch { return null; }
}

/**
 * Зберегти фрази у фразник: list = [{ en, uk? }] (або рядки). Дублікати (за en, без регістру й пробілів) не створюються:
 * наявна картка лише отримує мітку фрази. Переклад відсутніх uk — одним запитом translate (без мережі — пізніше, fillMissing).
 * Повертає { added, existing }.
 */
export async function savePhrases(list, { situation: sit = 'other', source = 'manual' } = {}) {
  sit = SITUATIONS.some(s => s.id === sit) ? sit : 'other';
  const seen = new Set();
  const items = (Array.isArray(list) ? list : []).map(x => (typeof x === 'string' ? { en: x } : x || {}))
    .map(x => ({ en: clean(x.en), uk: clean(x.uk) }))
    .filter(x => x.en && /[a-z]/i.test(x.en) && !seen.has(norm(x.en)) && seen.add(norm(x.en)));
  const byEn = new Map(store.all('cards').map(c => [norm(c.en), c]));
  let existing = 0;
  const fresh = [];
  for (const x of items) {
    const ex = byEn.get(norm(x.en));
    if (!ex) { fresh.push(x); continue; }
    existing++;
    if (!isPhrase(ex)) {
      ex.tags = [...new Set([...(ex.tags || []), 'phrase', `sit:${sit}`])];
      ex.extra = { ...(ex.extra || {}), kind: 'phrase', situation: sit, source };
      if (!ex.uk && x.uk) ex.uk = x.uk;
      store.put('cards', ex);
    }
  }
  const need = fresh.filter(x => !x.uk);
  if (need.length) {
    const uk = await translateLines(need.map(x => x.en));
    if (uk) need.forEach((x, i) => { x.uk = clean(uk[i]); });
  }
  let added = 0;
  for (const x of fresh) {
    const r = srs.addCard({ en: x.en, uk: x.uk || '', tags: ['phrase', `sit:${sit}`], extra: { kind: 'phrase', situation: sit, source } });
    if (r.created) added++; else existing++;
  }
  return { added, existing };
}

/** Чи вже є фраза у фразнику */
export function hasPhrase(en) { const k = norm(en); return store.all('cards').some(c => isPhrase(c) && norm(c.en) === k); }

/** Дозаповнити переклади фраз без uk (одним запитом); повертає кількість заповнених */
let filling = null;
export function fillMissing(cards = allPhrases()) {
  if (filling) return filling;
  const need = cards.filter(c => isPhrase(c) && !c.uk).slice(0, 30);
  if (!need.length) return Promise.resolve(0);
  filling = translateLines(need.map(c => c.en)).then(uk => {
    if (!uk) return 0;
    let n = 0;
    need.forEach((c, i) => { const row = store.get('cards', c.id); if (row && !row.uk && uk[i]) { row.uk = clean(uk[i]); store.put('cards', row); n++; } });
    return n;
  }).finally(() => { filling = null; });
  return filling;
}

/** Перемістити фразу в іншу ситуацію */
export function movePhrase(card, sit) {
  if (!card || !SITUATIONS.some(s => s.id === sit)) return;
  card.tags = [...(card.tags || []).filter(t => !String(t).startsWith('sit:')), `sit:${sit}`];
  card.extra = { ...(card.extra || {}), situation: sit };
  store.put('cards', card);
}
