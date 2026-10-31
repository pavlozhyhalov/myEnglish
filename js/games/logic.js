// Ігри: чисті функції без DOM і сховища (покриті node-тестами).
// «Слово дня» (оцінка спроби, стан клавіш, текст для поширення), «Швидкий переклад» (комбо, темп), «Збери речення» (плитки).
import { tilesOf, norm, sameSentence, isSentence } from '../wordlogic.js';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const rank = (l) => Math.max(0, LEVELS.indexOf(l));

// ---------- «Слово дня» ----------
/**
 * Оцінка спроби: 'g' — літера на своєму місці, 'y' — є в слові, але не тут, 'b' — немає (або вже «витрачена»).
 * Повтори літер — як в оригінальному Wordle: спершу збіги на місці, далі жовті лише в межах кількості, що лишилась.
 */
export function scoreGuess(guess, answer) {
  const g = String(guess).toLowerCase(), a = String(answer).toLowerCase();
  const res = Array(g.length).fill('b');
  const left = {};
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) res[i] = 'g';
    else left[a[i]] = (left[a[i]] || 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (res[i] === 'g') continue;
    if (left[g[i]] > 0) { res[i] = 'y'; left[g[i]]--; }
  }
  return res;
}

const STRENGTH = { b: 1, y: 2, g: 3 };
/** Стан клавіш екранної клавіатури: найкращий відомий для кожної літери */
export function keyStates(rows) {
  const st = {};
  for (const { guess, score } of rows) {
    [...guess.toLowerCase()].forEach((ch, i) => {
      if (!st[ch] || STRENGTH[score[i]] > STRENGTH[st[ch]]) st[ch] = score[i];
    });
  }
  return st;
}

export const isWon = (score) => score.length > 0 && score.every(s => s === 'g');

/** Текст для поширення: квадрати без самих літер (не розкриває слово) */
export function shareText({ title, rows, won, max = 6, hint = false }) {
  const sq = { g: '🟩', y: '🟨', b: '⬜' };
  const head = `${title} ${won ? rows.length : 'X'}/${max}${hint ? '*' : ''}`;
  return [head, '', ...rows.map(r => r.score.map(s => sq[s]).join(''))].join('\n');
}

/** Словник допустимих спроб: рядок слів через пробіл → Set */
export function validSet(str, extra = []) {
  const s = new Set(String(str || '').split(/\s+/).filter(w => /^[a-z]{5}$/.test(w)));
  for (const w of extra) if (/^[a-z]{5}$/i.test(w)) s.add(w.toLowerCase());
  return s;
}

/**
 * Кандидати у відповіді для рівня: слова цього рівня і на один нижче (на A1 — лише A1).
 * data — вміст data/words5.json; повертає [{ w, level, deck? | uk, ipa, ex }], відсортовано (стабільний вибір дня).
 */
export function answersFor(data, level) {
  const r = rank(level);
  const ok = (l) => rank(l) === r || rank(l) === r - 1;
  const out = [];
  for (const [w, l, deck] of data.answers || []) if (ok(l)) out.push({ w, level: l, deck });
  for (const [w, l, uk, ipa, ex] of data.extra || []) if (ok(l)) out.push({ w, level: l, uk, ipa, ex });
  return out.sort((a, b) => a.w < b.w ? -1 : a.w > b.w ? 1 : 0);
}

/** Детермінований вибір за ключем (день + рівень): той самий ключ → той самий елемент */
export function pickBy(list, key) {
  if (!list.length) return null;
  let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** Слово картки без «to»/артикля: «to bring» → «bring» (для пошуку картки за відповіддю) */
export const bareWord = (en) => String(en || '').trim().replace(/^(to|a|an|the)\s+/i, '').toLowerCase();

/** Розподіл перемог за кількістю спроб і серії для щоденної гри */
export function updateWordleStats(stats, { won, tries, day, prevDay }) {
  const s = { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], last: null, ...(stats || {}) };
  s.dist = [...(s.dist || [0, 0, 0, 0, 0, 0])];
  if (s.last === day) return s;    // той самий день не рахується двічі
  s.played++;
  if (won) {
    s.won++;
    s.dist[tries - 1] = (s.dist[tries - 1] || 0) + 1;
    s.streak = s.last && s.last === prevDay && s.lastWon !== false ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else s.streak = 0;
  s.last = day; s.lastWon = !!won;
  return s;
}

// ---------- «Швидкий переклад» ----------
export const RUSH_SECONDS = 60;
export const RUSH_LIVES = 3;
/** Множник очок за комбо: кожні 5 правильних поспіль +1, до ×4 */
export const comboMult = (combo) => Math.min(4, 1 + Math.floor(combo / 5));
/** Час на одне слово, мс: прискорюється з кожною правильною відповіддю (6 с → 2,5 с) */
export const rushTimeFor = (correct) => Math.max(2500, 6000 - correct * 180);
/** Очки за правильну відповідь: база 10 × множник + бонус за швидкість (до 5) */
export function rushPoints(combo, msLeft, msTotal) {
  const speed = msTotal > 0 ? Math.max(0, Math.min(1, msLeft / msTotal)) : 0;
  return 10 * comboMult(combo) + Math.round(speed * 5);
}

/**
 * Черга слів: спершу ті, що зараз вчаться або чекають повтору (priority), перемішані з рештою пулу,
 * без повторів англійського слова. Кожне третє — зі «своїх», поки вони є.
 */
export function buildQueue(priority, pool, rng = Math.random) {
  const seen = new Set();
  const uniq = (list) => shuffleArr(list, rng).filter(c => { const k = norm(c.en); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const p = uniq(priority), rest = uniq(pool);
  const out = [];
  while (p.length || rest.length) {
    if (p.length && (out.length % 3 !== 2 || !rest.length)) out.push(p.shift());
    else if (rest.length) out.push(rest.shift());
    else out.push(p.shift());
  }
  return out;
}

/** Варіант «так / ні»: з імовірністю ~50% показуємо чужий переклад */
export function truthPair(card, distractors, rng = Math.random) {
  if (!distractors.length || rng() < 0.5) return { shown: card.uk, truth: true };
  return { shown: distractors[Math.floor(rng() * distractors.length)].uk, truth: false };
}

// ---------- «Збери речення» ----------
export const BUILD_SECONDS = 75;
export const BUILD_BONUS = 4;   // секунд за кожне складене речення

/** Чи годиться речення для гри: 3–10 слів, лише латиниця й звичайні розділові знаки, без «…» і пропусків */
export function goodSentence(en) {
  const s = String(en || '').trim();
  if (!s || /…|\.\.\.|_|\(|\)|\/|\[/.test(s)) return false;
  if (!/^[A-Za-z0-9'’,.!?:;\- "]+$/.test(s)) return false;
  const n = tilesOf(s).length;
  return n >= 3 && n <= 10 && isSentence(s);
}

/** Перемішані плитки, що не збігаються з правильним порядком (якщо це можливо) */
export function shuffledTiles(sentence, rng = Math.random) {
  const tiles = tilesOf(sentence).map((t, i) => ({ t, i }));
  if (tiles.length < 2) return tiles;
  for (let k = 0; k < 12; k++) {
    const s = shuffleArr(tiles, rng);
    if (!sameSentence(s.map(x => x.t).join(' '), sentence)) return s;
  }
  return [...tiles].reverse();
}

/** Перша позиція, де складене речення розходиться з правильним (за нормалізованими словами), або -1 */
export function firstMismatch(built, sentence) {
  const want = tilesOf(sentence).map(norm);
  const got = built.map(norm);
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return i;
  return got.length > want.length ? want.length : -1;
}

/** Очки за речення: по 5 за слово + бонус за серію (до +20) */
export const buildPoints = (words, streak) => words * 5 + Math.min(20, streak * 4);

/** Рекорд за рівнем: { A1: n, … } → нове значення і чи це рекорд */
export function bestUpdate(best, level, score) {
  const prev = best?.[level] || 0;
  return { best: { ...(best || {}), [level]: Math.max(prev, score) }, record: score > prev && score > 0, prev };
}

/** Об'єднати рекорди з двох джерел (локально й у профілі з іншого пристрою): максимум за кожним ключем */
export function mergeBest(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergeBest(out[k] || {}, v);
    else if (typeof v === 'number') out[k] = Math.max(out[k] || 0, v);
  }
  return out;
}

export function shuffleArr(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
