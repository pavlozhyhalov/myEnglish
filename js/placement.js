// Визначення рівня: адаптивний алгоритм (computer-adaptive testing) — чисті функції без DOM,
// щоб їх можна було перевірити симуляцією (Node) і використати на сторінці тесту.
//
// Модель: Раш з вгадуванням (4 варіанти): P(правильно | θ, d) = 1/4 + 3/4 · σ(1.7 · (θ − d)),
// де d — індекс рівня питання (A1 = 0 … C1 = 4). Рівень учня = ⌊θ⌋: найвищий рівень, на якому
// він відповідає правильно хоча б на ~62% питань. Оцінка θ — EAP (апостеріорне середнє) на сітці
// зі слабким нормальним апріорі: для першої навички — посередині шкали, для наступних — біля оцінки
// попередніх (так алгоритм швидше знаходить межу і не «стрибає» після однієї випадкової відповіді).

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const TOP = LEVELS.length - 1;
/** Порядок частин тесту і правило зупинки для кожної */
export const SKILLS = ['grammar', 'vocabulary', 'reading', 'listening'];
export const RULES = {
  grammar: { min: 8, max: 20 },
  vocabulary: { min: 8, max: 20 },
  reading: { min: 8, max: 12 },
  listening: { min: 8, max: 12 },
};
export const SE_STOP = 0.45;
/** Додаткова умова зупинки (класифікаційна): ≥ 60% імовірності на одному рівні або SE ≤ 0.35 */
export const MASS_STOP = 0.6;
export const SE_FINE = 0.35;
/** Ваги навичок у загальному рівні (перенормовуються за тими, що були пройдені) */
export const WEIGHTS = { grammar: 0.25, vocabulary: 0.25, reading: 0.2, listening: 0.15, writing: 0.075, speaking: 0.075 };
export const RECEPTIVE = SKILLS;

const A = 1.7, C = 0.25;
const GRID = (() => { const g = []; for (let t = -1.5; t <= TOP + 1.5 + 1e-9; t += 0.05) g.push(+t.toFixed(2)); return g; })();
const sig = (x) => 1 / (1 + Math.exp(-x));

/** Імовірність правильної відповіді */
export const pCorrect = (theta, d) => C + (1 - C) * sig(A * (theta - d));

/** Інформація Фішера питання рівня d у точці θ (3PL з c = 1/4) */
export function info(theta, d) {
  const p = pCorrect(theta, d);
  const q = 1 - p;
  return A * A * (q / p) * ((p - C) / (1 - C)) ** 2;
}

/** Апріорі: перша навичка — N(1.5, 1.5²) (між A2 і B1); далі — біля оцінки попередніх, σ = 1.2 */
export function priorFrom(prevThetas = []) {
  const xs = prevThetas.filter(Number.isFinite);
  if (!xs.length) return { mu: 1.5, sd: 1.5 };
  return { mu: xs.reduce((a, b) => a + b, 0) / xs.length, sd: 1.2 };
}

/**
 * EAP-оцінка θ і її стандартна похибка (апостеріорне SD).
 * responses: [{ lvl: 0..4 | 'B1', ok: bool }]
 */
export function estimateTheta(responses, prior = priorFrom()) {
  const rs = responses.map(r => ({ d: typeof r.lvl === 'number' ? r.lvl : LEVELS.indexOf(r.level ?? r.lvl), ok: !!r.ok })).filter(r => r.d >= 0);
  const logw = GRID.map(t => {
    let l = -0.5 * ((t - prior.mu) / prior.sd) ** 2;
    for (const { d, ok } of rs) { const p = pCorrect(t, d); l += Math.log(ok ? p : 1 - p); }
    return l;
  });
  const mx = Math.max(...logw);
  const w = logw.map(l => Math.exp(l - mx));
  const sum = w.reduce((a, b) => a + b, 0);
  const theta = GRID.reduce((a, t, i) => a + t * w[i], 0) / sum;
  const v = GRID.reduce((a, t, i) => a + (t - theta) ** 2 * w[i], 0) / sum;
  return { theta, se: Math.sqrt(v), n: rs.length };
}

/** Рівень (індекс) за θ */
export const levelIdx = (theta) => Math.max(0, Math.min(TOP, Math.floor(theta + 1e-6)));
export const levelOf = (theta) => LEVELS[levelIdx(theta)];

/** «B1+» — коли θ у верхній частині рівня (дробова частина ≥ 0.6) */
export function displayLevel(theta) {
  const i = levelIdx(theta);
  const frac = theta - i;
  return LEVELS[i] + (frac >= 0.6 && frac < 1 ? '+' : '');
}

const Phi = (x) => {   // нормальна функція розподілу (наближення Абрамовіца — Стіган)
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

/** Розподіл імовірності між рівнями (нормальне наближення апостеріорі) */
export function levelMass(theta, se) {
  const s = Math.max(se, 0.05);
  return LEVELS.map((_, i) => {
    const lo = i === 0 ? -Infinity : i, hi = i === TOP ? Infinity : i + 1;
    return (hi === Infinity ? 1 : Phi((hi - theta) / s)) - (lo === -Infinity ? 0 : Phi((lo - theta) / s));
  });
}

/**
 * Впевненість: { sure: true, label: 'впевнено' } або { sure: false, label: 'між B1 і B2', range: ['B1','B2'] }.
 * «Впевнено» — якщо ≥ 70% імовірності припадає на сам рівень.
 */
export function confidence(theta, se) {
  const m = levelMass(theta, se);
  const i = levelIdx(theta);
  if (m[i] >= 0.7) return { sure: true, label: 'впевнено' };
  const j = i === 0 ? 1 : i === TOP ? TOP - 1 : (m[i - 1] > m[i + 1] ? i - 1 : i + 1);
  const [a, b] = [Math.min(i, j), Math.max(i, j)];
  return { sure: false, label: `між ${LEVELS[a]} і ${LEVELS[b]}`, range: [LEVELS[a], LEVELS[b]] };
}

/** Чи завершувати частину: щонайменше min питань; далі — SE ≤ 0.45 або max; також якщо питання скінчились */
export function shouldStop(skill, est, available = Infinity) {
  const r = RULES[skill] || { min: 8, max: 12 };
  if (est.n >= r.max || available <= 0) return true;
  if (est.n < r.min || est.se > SE_STOP) return false;
  // точність досягнуто; біля межі двох рівнів — ще кілька питань, поки не стане ясно, з якого боку від неї учень
  const m = levelMass(est.theta, est.se)[levelIdx(est.theta)];
  return m >= MASS_STOP || est.se <= SE_FINE;
}

/**
 * Наступне питання навички.
 * - рівень найближчої до θ межі (з першим питанням — на півкроку легше: старт без «завалу»);
 * - у межах рівня: спершу питання, яких не було в останніх спробах (seen), випадково;
 * - ніколи не повторює питання в межах спроби (used);
 * - не бере два питання з того самого тексту (group) поспіль, якщо є інші.
 * bank: [{ id, skill, level, group? }]; rnd — генератор випадкових чисел (для симуляції)
 */
export function pickItem(bank, { skill, theta, n = 0, used = new Set(), seen = new Set(), lastGroup = null, rnd = Math.random }) {
  const pool = bank.filter(q => q.skill === skill && !used.has(q.id) && LEVELS.includes(q.level));
  if (!pool.length) return null;
  const target = n === 0 ? theta - 0.5 : theta;
  // класифікаційний CAT: питання рівня найближчої межі (рівень d «відділяє» d від d−1) — так найшвидше видно,
  // з якого боку межі учень; за рівної відстані — інформативніше питання
  const c0 = Math.max(0, Math.min(TOP, Math.round(target)));
  const order = LEVELS.map((_, d) => d).sort((a, b) => (Math.abs(a - c0) - Math.abs(b - c0)) || (info(target, b) - info(target, a)));
  const isSeen = (q) => seen.has(q.id) || (q.group != null && seen.has(`group:${q.group}`));
  const sameGroup = (q) => lastGroup != null && q.group != null && q.group === lastGroup;
  const any = (list) => list.length ? list[Math.floor(rnd() * list.length)] : null;
  // спершу найінформативніший рівень; свіжі й не з того самого тексту — найкраще
  for (const tier of [(q) => !isSeen(q) && !sameGroup(q), (q) => !sameGroup(q), () => true]) {
    for (const d of order.slice(0, 2)) {
      const c = pool.filter(q => q.level === LEVELS[d] && tier(q));
      if (c.length) return any(c);
    }
  }
  // на двох найближчих рівнях не лишилось — будь-який найближчий
  for (const d of order) {
    const c = pool.filter(q => q.level === LEVELS[d]);
    if (c.length) return any(c.filter(q => !isSeen(q)).length ? c.filter(q => !isSeen(q)) : c);
  }
  return null;
}

/** Скільки питань навички ще доступно */
export const available = (bank, skill, used) => bank.filter(q => q.skill === skill && !used.has(q.id) && LEVELS.includes(q.level)).length;

/** Які навички є в банку (частини без питань пропускаються) */
export const skillsIn = (bank) => SKILLS.filter(s => bank.some(q => q.skill === s && LEVELS.includes(q.level)));

/** Письмо/говоріння → θ: рівень + підрівень (low .2, mid .5, high .8) */
export function productiveTheta(level, sublevel = 'mid') {
  const i = LEVELS.indexOf(level);
  if (i < 0) return null;
  return i + ({ low: 0.2, mid: 0.5, high: 0.8 }[sublevel] ?? 0.5);
}

/**
 * Загальний рівень: зважене θ за навичками (ваги перенормовано на пройдені),
 * з обмеженням «не вище найслабшої рецептивної навички + 1 рівень».
 * thetas: { grammar: θ, …, writing?: θ, speaking?: θ }
 */
export function overall(thetas) {
  const keys = Object.keys(WEIGHTS).filter(k => Number.isFinite(thetas[k]));
  if (!keys.length) return null;
  const wsum = keys.reduce((a, k) => a + WEIGHTS[k], 0);
  let theta = keys.reduce((a, k) => a + WEIGHTS[k] * thetas[k], 0) / wsum;
  const rec = RECEPTIVE.filter(k => Number.isFinite(thetas[k]));
  if (rec.length) {
    const cap = Math.min(...rec.map(k => levelIdx(thetas[k]))) + 1;   // найвищий допустимий рівень
    if (levelIdx(theta) > cap) theta = cap + 0.5;
  }
  return { theta, level: levelOf(theta), display: displayLevel(theta) };
}

/** Друге питання до того самого тексту (читання: два питання на текст ідуть поспіль, текст показано один раз) */
export function partnerOf(bank, last, used) {
  if (!last || last.group == null) return null;
  return bank.find(q => q.group === last.group && q.skill === last.skill && q.id !== last.id && !used.has(q.id)) || null;
}

/**
 * Наступне питання частини або null (частину завершено).
 * Пара питань до одного тексту не розривається; правило зупинки перевіряється після завершення пари.
 */
export function nextItem(bank, { skill, est, used, seen = new Set(), last = null, rnd = Math.random }) {
  const max = (RULES[skill] || { max: 12 }).max;
  const partner = last && last.skill === skill ? partnerOf(bank, last, used) : null;
  if (partner && est.n < max) return partner;
  if (shouldStop(skill, est, available(bank, skill, used))) return null;
  return pickItem(bank, { skill, theta: est.theta, n: est.n, used, seen, lastGroup: last?.group ?? null, rnd });
}

/** Наближена похибка загального θ (за похибками рецептивних навичок і їхніми вагами) */
export function overallSE(ses) {
  const keys = RECEPTIVE.filter(k => Number.isFinite(ses[k]));
  if (!keys.length) return 1;
  const w = keys.reduce((a, k) => a + WEIGHTS[k], 0);
  return Math.sqrt(keys.reduce((a, k) => a + (WEIGHTS[k] / w) ** 2 * ses[k] ** 2, 0));
}
