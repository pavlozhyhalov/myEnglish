// «Правила тижня»: до 3 правил граматики, на яких учень зосереджується цілий тиждень.
// Решта помилок чекає своєї черги — 58 відкритих помилок одночасно не виправити.
// Фокус заморожується на ISO-тиждень (місцевий час) у profiles.data.weeklyFocus — синхронізується, тож телефон і ноутбук бачать те саме;
// сервер (tutor) читає його й у кожній розмові створює нагоди вжити ці правила.
// Формат: { week: 'YYYY-Www', rules: [id ×≤3], started: iso, start: { [id]: відкритих на початку }, swaps: 0..2,
//           skipped: [id] (замінені — не повертаються цього тижня), closed: [{ rule, at }] (закриті й замінені новим правилом) }
import * as store from './store.js';
import { user } from './supa.js';
import { RULES, ruleLabel } from './rules.js';

export const FOCUS_SIZE = 3;
export const SWAPS_MAX = 2;
const DAY = 864e5;

/** ISO-тиждень дати за місцевим часом: '2026-W45' */
export function isoWeek(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));        // четвер цього тижня визначає рік
  const w1 = new Date(t.getFullYear(), 0, 4, 12);
  const n = 1 + Math.round(((t - w1) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`;
}

/** Скільки днів тижня лишилось, включно з сьогодні (Пн — 7, Нд — 1) */
export function daysLeftInWeek(d = new Date()) { return 7 - ((d.getDay() + 6) % 7); }

const isRule = (id) => typeof id === 'string' && id !== 'other' && !!RULES[id];
const openMistakes = () => store.all('mistakes').filter(m => !m.deleted && !m.resolved && isRule(m.rule));
const openOf = (rule) => openMistakes().filter(m => m.rule === rule);

/**
 * Кандидати в правила тижня: Σ по відкритих помилках правила (count × вага свіжості 1 + 1/(днів від оновлення + 1));
 * рівні бали — більше різних помилок вище. exclude — правила, які не пропонувати.
 */
export function ruleCandidates({ exclude = [], now = Date.now() } = {}) {
  const skip = new Set(exclude);
  const by = new Map();
  for (const m of openMistakes()) {
    if (skip.has(m.rule)) continue;
    const t = Date.parse(m.updated_at || m.created_at || '') || now;
    const days = Math.max(0, (now - t) / DAY);
    const e = by.get(m.rule) || { rule: m.rule, score: 0, distinct: 0 };
    e.score += (m.count || 1) * (1 + 1 / (Math.floor(days) + 1));
    e.distinct++;
    by.set(m.rule, e);
  }
  return [...by.values()].sort((a, b) => (b.score - a.score) || (b.distinct - a.distinct) || a.rule.localeCompare(b.rule));
}

/** Фокус поточного тижня з профілю (без створення); застарілий або зіпсований — null */
export function currentFocus(now = new Date()) {
  const f = store.prof().weeklyFocus;
  if (!f || typeof f !== 'object' || f.week !== isoWeek(now) || !Array.isArray(f.rules)) return null;
  const rules = f.rules.filter(isRule).slice(0, FOCUS_SIZE);
  if (!rules.length) return null;
  return { ...f, rules };
}
/** Правила фокусу поточного тижня (для впорядкування повтору; нічого не створює) */
export function focusRules(now = new Date()) { return currentFocus(now)?.rules || []; }

function save(f) {
  const clean = {
    week: f.week, rules: f.rules.slice(0, FOCUS_SIZE), started: f.started, start: f.start || {},
    swaps: Math.max(0, Math.min(SWAPS_MAX, Number(f.swaps) || 0)),
    skipped: [...new Set(f.skipped || [])].slice(-12),
    closed: (f.closed || []).slice(-12),
  };
  store.setProf({ weeklyFocus: clean });
  return clean;
}

/**
 * Фокус поточного тижня; якщо його немає або він з минулого тижня — створює (до 3 правил з найбільшою вагою).
 * Наявний фокус цього тижня (зокрема з іншого пристрою) не змінюється. Відкритих помилок з правилом немає — null.
 */
export function weeklyFocus(now = new Date()) {
  const cur = currentFocus(now);
  if (cur) return cur;
  // після входу новий тиждень обираємо лише після першої синхронізації цього запуску: інакше пристрій, що ще не отримав
  // вибір іншого пристрою, перезапише його своїм (профіль синхронізується цілим записом)
  if (user() && navigator.onLine && !store.syncedOnce()) return null;
  const cands = ruleCandidates({ now: now.getTime() }).slice(0, FOCUS_SIZE);
  if (!cands.length) return null;
  const rules = cands.map(c => c.rule);
  return save({ week: isoWeek(now), rules, started: now.toISOString(), start: Object.fromEntries(rules.map(r => [r, openOf(r).length])), swaps: 0, skipped: [], closed: [] });
}

/** Прогрес правила тижня */
function ruleProgress(f, rule) {
  const all = store.all('mistakes').filter(m => !m.deleted && m.rule === rule);
  const open = all.filter(m => !m.resolved);
  const since = Date.parse(f.started) || 0;
  const closedThisWeek = all.filter(m => m.resolved && (Date.parse(m.updated_at || '') || 0) >= since).length;
  const startOpen = Number.isFinite(f.start?.[rule]) ? f.start[rule] : open.length + closedThisWeek;
  return {
    rule, label: ruleLabel(rule) || rule,
    startOpen, openNow: open.length, closedThisWeek,
    streakMin: open.length ? Math.min(3, ...open.map(m => m.streak || 0)) : 3,
    done: open.length === 0,
  };
}

/** Прогрес правил тижня: [{ rule, label, startOpen, openNow, closedThisWeek, streakMin, done }] (порожньо — фокусу немає) */
export function focusProgress(f = weeklyFocus()) {
  if (!f) return [];
  return f.rules.map(r => ruleProgress(f, r));
}

/** Закриті цього тижня правила, на місце яких уже взято нові */
export function closedEarlier(f = currentFocus()) {
  return (f?.closed || []).filter(x => isRule(x?.rule)).map(x => ({ rule: x.rule, label: ruleLabel(x.rule), at: x.at }));
}

const excluded = (f) => [...f.rules, ...(f.skipped || []), ...(f.closed || []).map(x => x.rule)];
/** Наступне правило-кандидат для фокусу (не з поточних, не замінене, не закрите цього тижня) або null */
export function nextCandidate(f = currentFocus()) {
  if (!f) return ruleCandidates()[0] || null;
  return ruleCandidates({ exclude: excluded(f) })[0] || null;
}
export function swapsLeft(f = currentFocus()) { return f ? Math.max(0, SWAPS_MAX - (Number(f.swaps) || 0)) : 0; }
export function canSwap(f = currentFocus()) { return !!f && swapsLeft(f) > 0 && !!nextCandidate(f); }

/** Замінити правило наступним кандидатом (не більше 2 замін на тиждень). Повертає новий фокус або null */
export function swapRule(rule) {
  const f = currentFocus();
  if (!f || !f.rules.includes(rule) || !canSwap(f)) return null;
  const nx = nextCandidate(f);
  const rules = f.rules.map(r => (r === rule ? nx.rule : r));
  return save({ ...f, rules, swaps: (Number(f.swaps) || 0) + 1, skipped: [...(f.skipped || []), rule], start: { ...f.start, [nx.rule]: openOf(nx.rule).length } });
}

/** Чи можна взяти ще правило: є кандидат і є місце (менше 3 правил або одне з них уже закрите) */
export function canAddRule(f = currentFocus()) {
  if (!f) return !!nextCandidate(null);
  const room = f.rules.length < FOCUS_SIZE || focusProgress(f).some(p => p.done);
  return room && !!nextCandidate(f);
}

/**
 * Взяти ще правило: на вільне місце, а якщо правил уже 3 — замість першого закритого (воно лишається в «закрито цього тижня»).
 * Повертає новий фокус або null.
 */
export function addFocusRule(now = new Date()) {
  const f = currentFocus(now);
  if (!f) return weeklyFocus(now);
  if (!canAddRule(f)) return null;
  const nx = nextCandidate(f);
  let rules = f.rules.slice(), closed = (f.closed || []).slice();
  if (rules.length >= FOCUS_SIZE) {
    const doneRule = focusProgress(f).find(p => p.done)?.rule;
    rules = rules.filter(r => r !== doneRule);
    closed.push({ rule: doneRule, at: now.toISOString() });
  }
  rules.push(nx.rule);
  return save({ ...f, rules, closed, start: { ...f.start, [nx.rule]: openOf(nx.rule).length } });
}

/** Короткий підпис правил тижня для описів («Пропущене am/is/are…, Артикль the») */
export function focusLabels(f = currentFocus(), { onlyOpen = true } = {}) {
  if (!f) return [];
  const pr = focusProgress(f);
  return pr.filter(p => !onlyOpen || !p.done).map(p => p.label);
}
