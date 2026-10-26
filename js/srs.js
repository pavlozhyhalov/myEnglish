// Інтервальне повторення: обгортка над ts-fsrs + черга карток
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.js';
import * as store from './store.js';
import { withCards, deckIndex, slug } from './data.js';
import { today } from './stats.js';
import { fitOrder, diff } from './level.js';

export { Rating, State };
let scheduler = null;
let schedRetention = null;
function sched() {
  const r = store.settings().retention || 0.9;
  if (!scheduler || schedRetention !== r) {
    scheduler = fsrs(generatorParameters({ request_retention: r, enable_fuzz: true, maximum_interval: 3650 }));
    schedRetention = r;
  }
  return scheduler;
}

export const MY_DECK = { id: 'my', name: 'Мої слова', emoji: 'writing' };

function toFsrs(row) {
  if (!row.reps && !row.last_review) return createEmptyCard(new Date());
  return {
    due: new Date(row.due), stability: row.stability, difficulty: row.difficulty,
    elapsed_days: row.elapsed_days || 0, scheduled_days: row.scheduled_days || 0,
    learning_steps: row.learning_steps || 0, reps: row.reps, lapses: row.lapses,
    state: row.state, last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}
function applyFsrs(row, c) {
  row.due = c.due.toISOString(); row.stability = c.stability; row.difficulty = c.difficulty;
  row.elapsed_days = c.elapsed_days; row.scheduled_days = c.scheduled_days; row.learning_steps = c.learning_steps;
  row.reps = c.reps; row.lapses = c.lapses; row.state = c.state;
  row.last_review = c.last_review ? c.last_review.toISOString() : null;
}

/** Інтервали для 4 оцінок, у днях */
// показаний на кнопках прогноз і фактичний розклад беруться з одного розрахунку (fuzz FSRS випадковий)
const previews = new WeakMap();
export function preview(row, now = new Date()) {
  const r = sched().repeat(toFsrs(row), now);
  previews.set(row, { at: now.getTime(), r });
  const out = {};
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[g] = (r[g].card.due - now) / 864e5;
  return out;
}

/** Оцінити картку: оновлює стан FSRS, пише журнал reviews */
export function grade(row, rating, elapsedMs = null) {
  const now = new Date();
  const prevState = row.reps ? row.state : State.New;
  const pv = previews.get(row);
  previews.delete(row);
  const { card } = pv && now - pv.at < 30 * 60 * 1000 ? pv.r[rating] : sched().next(toFsrs(row), now, rating);
  applyFsrs(row, card);
  store.put('cards', row);
  store.put('reviews', { card_id: row.id, rating, state: prevState, ts: now.toISOString(), elapsed: elapsedMs ? Math.round(elapsedMs) : null });
  return row;
}

// ---------- Колоди ----------
export async function decks() {
  const idx = await deckIndex();
  const rows = idx.map(d => {
    const r = store.get('decks', d.id);
    return { ...d, builtin: true, enabled: r ? r.enabled : d.default !== false };
  });
  const my = store.get('decks', MY_DECK.id);
  rows.push({ ...MY_DECK, builtin: false, enabled: my ? my.enabled : true, count: store.all('cards').filter(c => c.deck_id === 'my').length });
  return rows;
}
export function setDeckEnabled(d, enabled) {
  const r = store.get('decks', d.id) || { id: d.id, name: d.name, builtin: d.id !== 'my' };
  r.enabled = enabled;
  store.put('decks', r);
}
function enabledSet(decksList) { return new Set(decksList.filter(d => d.enabled).map(d => d.id)); }

export function starterId(deckId, en) { return `${deckId}:${slug(en)}`; }

/** Рядок картки зі стартового набору (ще не в сховищі) */
export function rowFromStarter(deckId, c) {
  return {
    id: starterId(deckId, c.en), deck_id: deckId, en: c.en, uk: c.uk, ipa: c.ipa || null, pos: c.pos || null,
    examples: c.ex ? [{ en: c.ex, uk: c.exUk || '' }] : [], tags: c.tags || [], extra: {},
    stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, due: null, last_review: null,
  };
}

/** Нові картки, введені сьогодні */
export function newIntroducedToday() {
  const d = today();
  const ids = new Set();
  for (const r of store.all('reviews')) if (r.state === 0 && r.ts && localDay(r.ts) === d) ids.add(r.card_id);
  return ids.size;
}
function localDay(iso) { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }

/** Картки до повтору (вже вивчались), з увімкнених колод */
export async function dueCards(now = new Date()) {
  const en = enabledSet(await decks());
  return store.all('cards')
    .filter(c => en.has(c.deck_id) && c.reps > 0 && c.due && new Date(c.due) <= now)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
}

/**
 * Нові картки на сьогодні: власні («Мої слова») першими, далі стартові колоди за рівнем:
 * спершу колоди мого рівня, потім наступного, потім нижчих (від найближчого). Колоди на 2+ рівні вище нових слів не дають.
 */
export async function newCards(limit) {
  const ds = await decks();
  const en = enabledSet(ds);
  const left = Math.max(0, (limit ?? store.settings().newPerDay) - newIntroducedToday());
  if (!left) return [];
  const out = [];
  const known = new Set(store.all('cards').filter(c => c.reps > 0).map(c => c.id));
  const knownEn = new Set(store.all('cards').filter(c => c.reps > 0).map(c => String(c.en).toLowerCase()));
  // власні непройдені
  for (const c of store.all('cards')) {
    if (out.length >= left) break;
    if (en.has(c.deck_id) && !c.reps) out.push(c);
  }
  if (out.length < left) {
    const starters = ds.filter(d => d.builtin && en.has(d.id) && diff(d.level) <= 1);
    // групи за доречністю рівня (свій → наступний → нижчі, ближчі першими); усередині групи колоди чергуються.
    // Файли колод вантажаться погрупно: наступна група — лише якщо попередньої не вистачило
    for (const group of [...new Set(starters.map(d => fitOrder(d.level)))].sort((a, b) => a - b)) {
      if (out.length >= left) break;
      const iters = (await withCards(starters.filter(d => fitOrder(d.level) === group))).map(d => ({ d, i: 0 }));
      while (out.length < left && iters.some(it => it.i < it.d.cards.length)) {
        for (const it of iters) {
          while (it.i < it.d.cards.length) {
            const c = it.d.cards[it.i++];
            const id = starterId(it.d.id, c.en);
            // те саме слово в іншій колоді — не вводимо вдруге
            if (known.has(id) || out.some(o => o.id === id || o.en.toLowerCase() === c.en.toLowerCase()) || knownEn.has(c.en.toLowerCase())) continue;
            out.push(store.get('cards', id) || rowFromStarter(it.d.id, c));
            break;
          }
          if (out.length >= left) break;
        }
      }
    }
  }
  return out;
}

export async function counts() {
  const due = await dueCards();
  const fresh = await newCards();
  const learned = store.all('cards').filter(c => c.stability >= 21).length;
  return { due: due.length, fresh: fresh.length, learned, total: store.all('cards').filter(c => c.reps > 0).length };
}

/** Прогноз повторів на N днів вперед */
export function forecast(days = 7) {
  const out = Array(days).fill(0);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (const c of store.all('cards')) {
    if (!c.reps || !c.due) continue;
    // різниця календарних днів (округлення — доба переходу на літній/зимовий час має 23/25 год)
    const due = new Date(c.due); due.setHours(0, 0, 0, 0);
    const d = Math.round((due - start) / 864e5);
    if (d < days) out[Math.max(0, d)]++;
  }
  return out;
}

/** Додати слово в «Мої слова» (не дублює) */
export function addCard({ en, uk, ipa, pos, examples, tags, extra, deck_id = 'my' }) {
  const exists = store.all('cards').find(c => c.en.trim().toLowerCase() === en.trim().toLowerCase());
  if (exists) return { row: exists, created: false };
  const row = {
    deck_id, en: en.trim(), uk: (uk || '').trim(), ipa: ipa || null, pos: pos || null,
    examples: examples || [], tags: tags || [], extra: extra || {},
    stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, due: null, last_review: null,
  };
  store.put('cards', row);
  return { row, created: true };
}

/** Тип картки для показу: чергуємо напрямки, нові — завжди EN→UK */
export function cardKind(row) {
  if (!row.reps) return 'en-uk';
  const hasCloze = row.examples?.[0]?.en && clozeOf(row);
  const kinds = ['en-uk', 'uk-en', 'audio', hasCloze ? 'cloze' : 'uk-en'];
  return kinds[row.reps % 4];
}
export function clozeOf(row) {
  const ex = row.examples?.[0]?.en || '';
  const word = row.en.replace(/^(to|a|an|the)\s+/i, '');
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'i');
  if (!re.test(ex) || word.split(' ').length > 4) return null;
  return { text: ex.replace(re, '_____'), answer: ex.match(re)[0] };
}
