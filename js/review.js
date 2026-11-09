// Повторення пройденого й розвиток слабких місць (2026-11-09, власник: «навіть якщо рівень закритий — час від часу повторювати
// попередні рівні; слабкі місця щоб розвивалися»).
// 1) Пройдені уроки повторюються завжди: 7 → 30 → 90 → 180 днів і далі раз на пів року (stats.recordLesson, REVIEW_DAYS).
// 2) Слабкі місця: правила з ≥ 3 відкритими помилками (правила тижня — першими) повертають пов'язані уроки свого й нижчих рівнів
//    на повторення, якщо до них не поверталися 14+ днів (до 3 уроків на день — щоб «Урок дня» не засипало).
// 3) Набір «Повторення» (#/exercises/grammar/review): уроки до повторення + уроки слабких правил + випадкові пройдені нижчих рівнів.
import * as store from './store.js';
import { RULES } from './rules.js';
import { lessonsToReview } from './stats.js';
import { myLevel, LEVELS } from './level.js';
import { grammarIndex } from './data.js';
import { focusRules } from './focus.js';

/** Правило помилки → уроки граматики, що його пояснюють («словникові» правила — без уроків) */
export const RULE_LESSONS = {
  'articles-a': ['articles-a-an', 'articles'],
  'articles-the': ['articles', 'articles-a-an', 'zero-article'],
  'articles-extra': ['zero-article', 'articles', 'articles-advanced'],
  'third-person-s': ['present-simple-basics'],
  'be-auxiliary': ['to-be', 'present-continuous-basic', 'was-were'],
  'continuous': ['present-continuous-basic', 'present-simple-continuous', 'past-simple-continuous'],
  'stative-verbs': ['stative-verbs'],
  'past-simple': ['past-simple-basics', 'past-simple-continuous'],
  'irregular-verbs': ['past-simple-basics'],
  'perfect-vs-past': ['present-perfect-basic', 'perfect-vs-past', 'present-perfect'],
  'perfect-duration': ['present-perfect', 'perfect-continuous'],
  'future-plans': ['going-to', 'future-forms'],
  'future-will': ['will-future', 'future-forms'],
  'conditionals': ['conditionals-0-1', 'conditional-2', 'conditional-3'],
  'modals': ['can-cant', 'should-must-basic', 'modals-ability', 'modals-obligation'],
  'infinitive-to': ['gerund-infinitive'],
  'gerund-infinitive': ['like-love-hate-ing', 'gerund-infinitive', 'verb-patterns-advanced'],
  'questions': ['wh-questions-basic', 'questions', 'question-tags'],
  'negation': ['present-simple-basics', 'to-be'],
  'word-order': ['adjectives-word-order-basic', 'adverbs-frequency', 'wh-questions-basic'],
  'prep-time': ['prepositions-time'],
  'prep-place': ['prepositions-basic', 'prepositions-place'],
  'prep-dependent': ['verb-prepositions'],
  'countable': ['countable-uncountable', 'some-any-much-many', 'quantifiers'],
  'plurals': ['plurals-this-that'],
  'pronouns': ['object-pronouns', 'possessive-pronouns', 'possessives'],
  'comparatives': ['comparatives', 'superlatives'],
  'agreement': ['there-is-are', 'present-simple-basics'],
  'passive-reported': ['passive-basic', 'reported-statements'],
};

const DAY = 864e5;
const WEAK_MIN = 3;          // відкритих помилок на правило, щоб воно вважалося слабким місцем
const WEAK_GAP = 14 * DAY;   // не частіше, ніж раз на 2 тижні для одного уроку
const WEAK_PER_DAY = 3;
const KEY = 'me:review-upkeep';
const WEAK_KEY = 'me:weak-at';
const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const rank = (l) => LEVELS.indexOf(l);

/** Слабкі правила: { rule, open } за спаданням; правила тижня — першими */
export function weakRules() {
  const n = new Map();
  for (const m of store.all('mistakes')) if (!m.deleted && !m.resolved && m.rule && RULE_LESSONS[m.rule]) n.set(m.rule, (n.get(m.rule) || 0) + (m.count || 1));
  const focus = new Set(focusRules());
  return [...n.entries()].filter(([r, k]) => k >= WEAK_MIN || focus.has(r))
    .map(([rule, open]) => ({ rule, open, focus: focus.has(rule) }))
    .sort((a, b) => (b.focus - a.focus) || (b.open - a.open));
}

/** Уроки слабких правил свого й нижчих рівнів (метадані з індексу граматики) */
export function weakLessons(idx, level = myLevel()) {
  const byId = new Map(idx.map(l => [l.id, l]));
  const out = [], seen = new Set();
  for (const w of weakRules()) for (const id of RULE_LESSONS[w.rule]) {
    const l = byId.get(id);
    if (!l || seen.has(id) || rank(l.level) > rank(level)) continue;
    seen.add(id); out.push({ ...l, rule: w.rule, ruleLabel: RULES[w.rule]?.uk || w.rule });
  }
  return out;
}

/** Раз на добу: старі пройдені уроки без дати повтору — у довгий цикл; уроки слабких правил — на повторення */
export async function reviewUpkeep({ force = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  try { if (!force && localStorage.getItem(KEY) === today) return 0; } catch {}
  const idx = await grammarIndex();
  const now = Date.now();
  let changed = 0;
  // 1) слабкі місця — пройдені уроки цих правил на повторення (той самий урок — не частіше, ніж раз на 14 днів;
  //    дата останнього такого повернення — localStorage, бо updated_at змінює будь-який запис прогресу)
  const weakAt = readJson(WEAK_KEY);
  let added = 0;
  for (const l of weakLessons(idx)) {
    if (added >= WEAK_PER_DAY) break;
    const p = store.get('lessons_progress', l.id);
    if (!p?.completed_at) continue;   // непройдені уроки нижчих рівнів курс і так дає першими («прогалини нижче»)
    if (p.next_review && Date.parse(p.next_review) <= now) continue;   // уже чекає повтору
    const last = Math.max(Date.parse(weakAt[l.id] || 0) || 0, Date.parse(p.completed_at) || 0);
    if (now - last < WEAK_GAP) continue;
    p.next_review = new Date(now).toISOString();
    store.put('lessons_progress', p); weakAt[l.id] = new Date(now).toISOString(); added++; changed++;
  }
  writeJson(WEAK_KEY, weakAt);
  // 2) уроки, у яких повтори раніше закінчувались (next_review = null після 30 днів), — повтор через 90 днів від останнього заняття
  for (const p of store.all('lessons_progress')) {
    if (!p.completed_at || p.next_review) continue;
    const last = Date.parse(p.updated_at || p.completed_at) || now;
    p.review_stage = Math.max(p.review_stage || 0, 2);
    p.next_review = new Date(Math.max(now, last + 90 * DAY)).toISOString();
    store.put('lessons_progress', p); changed++;
  }
  try { localStorage.setItem(KEY, today); } catch {}
  return changed;
}

/**
 * Уроки для набору «Повторення»: до повтору (найдавніші першими) → слабкі правила → випадкові пройдені нижчих рівнів.
 * Повертає метадані уроків з причиною (why: 'due' | 'weak' | 'old').
 */
export async function reviewSet(max = 5) {
  const idx = await grammarIndex();
  const byId = new Map(idx.map(l => [l.id, l]));
  const out = [], seen = new Set();
  const add = (l, why) => { if (l && !seen.has(l.id) && out.length < max) { seen.add(l.id); out.push({ ...l, why }); } };
  const weak = weakLessons(idx);
  const weakBy = new Map(weak.map(l => [l.id, l]));
  // урок, що чекає повтору через слабке місце, — з назвою правила
  lessonsToReview().sort((a, b) => String(a.next_review).localeCompare(String(b.next_review))).forEach(p => add(weakBy.get(p.id) || byId.get(p.id), 'due'));
  weak.filter(l => store.get('lessons_progress', l.id)?.completed_at || rank(l.level) < rank(myLevel())).forEach(l => add(l, 'weak'));
  const lower = idx.filter(l => rank(l.level) < rank(myLevel()) || (rank(l.level) === rank(myLevel()) && store.get('lessons_progress', l.id)?.completed_at));
  lower.sort(() => Math.random() - 0.5).forEach(l => add(l, 'old'));
  return out;
}

/** Скільки уроків чекає повтору зараз (для плиток) */
export const dueCount = () => lessonsToReview().length;
