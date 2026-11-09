// Рівень знань: визначається тестом або обирається вручну і керує тим, що пропонує застосунок:
// урок дня, нові слова, складність диктантів, рекомендовані сценарії й письмо, калібрування AI.
import * as store from './store.js';
import { h } from './ui/dom.js';
import { deckIndex, withCards, slug } from './data.js';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const LEVEL_NAME = { A1: 'Початковий', A2: 'Базовий', B1: 'Середній', B2: 'Вище середнього', C1: 'Просунутий' };
export const LEVEL_DESC = {
  A1: 'Прості фрази про себе, родину, покупки. Базові часи й порядок слів.',
  A2: 'Побутові розмови, минулий час, плани. Розумієте повільне чітке мовлення.',
  B1: 'Говорите на знайомі теми, розповідаєте історії, розумієте основне в живій мові.',
  B2: 'Вільно спілкуєтесь з носіями, аргументуєте думку, розумієте фільми й новини.',
  C1: 'Гнучка, точна мова: ідіоми, нюанси, офіційний і розмовний стиль.',
};
/** Поріг готовності до наступного рівня (% опанування поточного) */
export const READY_PCT = 80;

export const rank = (l) => Math.max(0, LEVELS.indexOf(l));
export function myLevel() { const l = store.settings().level; return LEVELS.includes(l) ? l : 'B1'; }
export const nextLevel = (l = myLevel()) => LEVELS[Math.min(LEVELS.length - 1, rank(l) + 1)];
/** Відстань від мого рівня: 0 — мій, <0 — нижче, >0 — вище */
export const diff = (l) => rank(l || 'B1') - rank(myLevel());

export function setLevel(level, source = 'manual') {
  if (!LEVELS.includes(level)) return;
  store.setSetting('level', level);
  picked.clear();   // фільтри сторінок знову показують «мій рівень»
  store.setProf({ level, levelSource: source, levelSetAt: new Date().toISOString() });
}

/** Порядок «за доречністю»: мій рівень → наступний → нижчі (ближчі першими) → вищі */
export function fitOrder(l) {
  const d = diff(l);
  return d === 0 ? 0 : d === 1 ? 1 : d < 0 ? 2 - d : 10 + d;
}
export function byFit(list, get = (x) => x.level) {
  return list.map((x, i) => ({ x, i })).sort((a, b) => fitOrder(get(a.x)) - fitOrder(get(b.x)) || a.i - b.i).map(o => o.x);
}

/** Бейдж рівня: свій — акцентний, вищий за наступний — приглушений */
export function levelTag(l) {
  if (!l) return null;
  const d = diff(l);
  return h('span.tag' + (d === 0 ? '.accent' : d > 1 ? '.far' : ''), { title: LEVEL_NAME[l] }, l);
}

// ---------- Фільтр за рівнем на сторінках завдань ----------
// Вибір пам'ятається для кожної сторінки до перезавантаження; за замовчуванням — «мій рівень»,
// тож зміна рівня в налаштуваннях одразу змінює завдання на всіх сторінках.
const picked = new Map();
export function levelPick(page) { return picked.get(page) || 'mine'; }

/** Елементи вибраного рівня; якщо для мого рівня нічого немає — найближчі (з позначкою fallback) */
export function filterByLevel(list, sel, get = (x) => x.level) {
  if (sel === 'all') return { items: byFit(list, get), fallback: false };
  const l = sel === 'mine' ? myLevel() : sel;
  const items = list.filter(x => get(x) === l);
  if (items.length || sel !== 'mine') return { items, fallback: false };
  const near = byFit(list, get);
  const lv = near.length ? get(near[0]) : null;
  return { items: near.filter(x => get(x) === lv), fallback: lv };
}

/**
 * Рядок чипів «Мій (B1) · A1 · A2 · B1 · B2 · C1 · Усі» з лічильниками.
 * counts — { A1: n, … } (рівні без завдань приховані); onPick(sel) — перемалювати список.
 */
export function levelChips(page, counts, onPick) {
  const wrap = h('div.chips.scroll.level-chips', { role: 'group', 'aria-label': 'Рівень завдань' });
  const opts = [['mine', `Мій · ${myLevel()}`], ...LEVELS.filter(l => counts[l]).map(l => [l, `${l} · ${counts[l]}`]), ['all', 'Усі']];
  const draw = () => wrap.replaceChildren(...opts.map(([v, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(levelPick(page) === v), onclick: () => { picked.set(page, v); draw(); onPick(v); } }, t)));
  draw();
  return wrap;
}
export function levelCounts(list, get = (x) => x.level) {
  const c = {};
  for (const x of list) { const l = get(x); if (l) c[l] = (c[l] || 0) + 1; }
  return c;
}
/** Підпис під списком, коли для мого рівня немає завдань і показано найближчий рівень */
export function fallbackNote(lv) {
  // порожній рядок, а не null: replaceChildren(null) вставив би текст «null»
  return lv ? h('p.xs.dim', { style: { margin: '0 2px' } }, `Для рівня ${myLevel()} тут ще немає завдань — показано найближчий рівень ${lv}.`) : '';
}

/** Детермінований вибір «на сьогодні»: той самий день і рівень → той самий елемент */
export function pickOfDay(list, salt = '') {
  if (!list.length) return null;
  const d = new Date();
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${myLevel()}|${salt}`;
  let hsh = 0; for (const ch of key) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hsh % list.length];
}

const lessonDone = (id) => !!store.get('lessons_progress', id)?.completed_at;

/** Порядок уроків: мій рівень → прогалини нижче (ближчі першими) → наступний → вищі (на відміну від fitOrder, де наступний іде перед нижчими) */
const lessonOrder = (l) => { const d = diff(l); return d <= 0 ? -d : 10 + d; };

/** Наступний урок за рівнем: непройдений свого рівня → прогалини нижче → наступний рівень → будь-який */
export function nextLessonByLevel(idx) {
  const open = idx.map((l, i) => ({ l, i })).filter(o => !lessonDone(o.l.id));
  open.sort((a, b) => lessonOrder(a.l.level) - lessonOrder(b.l.level) || a.i - b.i);
  return open[0]?.l || null;
}

/**
 * Опанування рівня: уроки граматики цього рівня (60%) + слова з колод цього рівня (40%).
 * Слово вважається опанованим після першого успішного повтору з інтервалом ≥ 7 днів.
 */
export async function levelProgress(idx, level = myLevel()) {
  const lessons = idx.filter(l => l.level === level);
  const gDone = lessons.filter(l => lessonDone(l.id)).length;
  const general = (await deckIndex()).filter(d => d.level === level && d.group !== 'work');
  // вимкнені колоди не рахуються (інакше рівень неможливо опанувати); якщо вимкнено всі — рахуємо всі
  const isOn = (d) => { const r = store.get('decks', d.id); return r ? r.enabled !== false : d.default !== false; };
  // вантажаться лише колоди цього рівня
  const decks = await withCards(general.some(isOn) ? general.filter(isOn) : general);
  // слово рахується один раз: те саме слово з іншої колоди (чи «Моїх слів») нова черга вдруге не вводить
  const mastered = new Set();
  for (const c of store.all('cards')) if (c.reps > 0 && (c.scheduled_days || 0) >= 7) { mastered.add(c.id); mastered.add(String(c.en || '').toLowerCase()); }
  const words = new Set();
  let wDone = 0;
  for (const d of decks) for (const c of d.cards) {
    const k = String(c.en).toLowerCase();
    if (words.has(k)) continue;
    words.add(k);
    if (mastered.has(`${d.id}:${slug(c.en)}`) || mastered.has(k)) wDone++;
  }
  const wTotal = words.size;
  const gPct = lessons.length ? gDone / lessons.length : 1;
  const wPct = wTotal ? wDone / wTotal : 1;
  const pct = Math.round((gPct * 0.6 + wPct * 0.4) * 100);
  return { level, pct, ready: pct >= READY_PCT && level !== LEVELS[LEVELS.length - 1], grammar: { done: gDone, total: lessons.length }, words: { done: wDone, total: wTotal } };
}


/**
 * План рівня (2026-11-09): скільки лишилось і за скільки тижнів рівень буде готовий до іспиту у фактичному темпі учня.
 * Уроки: непройдені уроки рівня ÷ темп (пройдені уроки за 14 днів, щонайменше 2 на тиждень).
 * Слова: незакріплені слова рівня ÷ (нових карток на день × 7) + 1 тиждень на закріплення (інтервал ≥ 7 днів).
 * Іспит рівня закриває рівень раніше: план — орієнтир, а не умова.
 */
export function levelPlan(lp) {
  const now = Date.now();
  const recent = store.all('lessons_progress').filter(p => p.completed_at && now - Date.parse(p.completed_at) < 14 * 864e5).length;
  const lessonsPerWeek = Math.max(2, Math.round(recent / 2));
  const perDay = Math.max(1, Number(store.settings().newPerDay) || 15);
  const lessonsLeft = Math.max(0, lp.grammar.total - lp.grammar.done);
  const wordsLeft = Math.max(0, lp.words.total - lp.words.done);
  const wGrammar = lessonsLeft / lessonsPerWeek;
  const wWords = wordsLeft ? wordsLeft / (perDay * 7) + 1 : 0;
  const weeks = Math.max(1, Math.ceil(Math.max(wGrammar, wWords)));
  const date = new Date(now + weeks * 7 * 864e5);
  return { weeks, lessonsLeft, wordsLeft, lessonsPerWeek, perDay, date, dateText: date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) };
}
