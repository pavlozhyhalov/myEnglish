// «Мій день за 15 хвилин»: три кроки (слова → правила → розмова голосом), що рахуються з локальних даних.
// План обчислюється щоразу заново, але цілі дня фіксуються під час першої побудови за день
// (localStorage 'me:daily' = { day, targets, started }), щоб виконані картки не зменшували ціль.
import * as store from './store.js';
import * as srs from './srs.js';
import * as stats from './stats.js';
import { RULES, ruleLabel } from './rules.js';
import { weeklyFocus, focusProgress } from './focus.js';
import { user } from './supa.js';
import { plural } from './strings.js';

const KEY = 'me:daily';
export const WORDS_MAX = 12;
const RULES_MAX = 5;
const VOICE_SEC = 300;

function readState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.day === stats.today()) return { targets: {}, ...s };
  } catch { /* приватний режим або зіпсований запис */ }
  return { day: stats.today(), targets: {}, started: false };
}
function writeState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }

/** Ціль дня: перше значення за день; нуль може зрости (з'явилось що робити), ненульова — не змінюється */
function freeze(st, k, v) {
  const cur = st.targets[k];
  if (cur == null || (cur === 0 && v > 0)) { st.targets[k] = v; return v; }
  return cur;
}

/** Користувач натиснув «Почати» — після цього з'являється плашка «Далі за планом» */
export function markStarted() { const s = readState(); if (!s.started) { s.started = true; s.startedAt = new Date().toISOString(); writeState(s); } }
export function isStarted() { return readState().started === true; }
/** Плашку «Далі за планом» сховано до завтра (хрестик на плашці) */
export function hideBarToday() { const s = readState(); s.barHidden = true; writeState(s); }
export function barHiddenToday() { return readState().barHidden === true; }

/** Скільки різних карток повторено сьогодні */
export function reviewedToday() {
  const d = stats.today(), ids = new Set();
  for (const r of store.all('reviews')) if (r.ts && stats.dayKey(r.ts) === d) ids.add(r.card_id);
  return ids.size;
}

/** Ціль слів на сьогодні (для тренування з ?daily=1): зафіксована або стандартна */
export function wordsTarget() { return readState().targets.words || WORDS_MAX; }

/** Секунди розмови з вчителем (текст і голос) сьогодні */
export function talkSecondsToday() {
  const d = stats.today();
  return store.all('sessions').filter(s => s.day === d && (s.type === 'voice' || s.type === 'tutor' || s.type === 'fluency')).reduce((a, s) => a + (s.seconds || 0), 0);
}

// ---------- Тема розмови ----------
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_UK = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// «неділ» не в «понеділок»; «серед» і «четвер» — лише як назви днів: не «серед друзів», не «четверо»
const WEEKDAYS_UK = ['(?<!по)неділ', 'понеділ', 'вівтор', 'серед[аиу](?![а-яіїєґ])', 'четвер(?:га|гу|ги)?(?![а-яіїєґ])', 'п\'ятниц', 'субот'];
const DAY_MS = 864e5;
const noonOf = (d) => { const t = new Date(d); t.setHours(12, 0, 0, 0); return t; };
const monthIdx = (w) => {
  // точна назва або англійське скорочення (Nov, Sept) — «3 marathons» не стає березнем
  const s = w.toLowerCase().replace(/\.$/, '');
  let i = MONTHS_EN.findIndex(m => s === m || (s.length >= 3 && s.length <= 4 && m.startsWith(s)));
  if (i < 0) i = MONTHS_UK.indexOf(s);
  return i;
};

/**
 * Дата події, згаданої у факті пам'яті (відносно часу, коли факт записано): ISO, «5 November», «November 5», «5 листопада»,
 * «tomorrow/завтра», «yesterday/вчора», «today/сьогодні», «this weekend/вихідні», «next week», назви днів тижня. null — дати немає.
 */
export function factDate(text, at) {
  const t = String(text || '');
  const base = noonOf(at ? new Date(at) : new Date());
  if (Number.isNaN(base.getTime())) return null;
  let m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (m) return noonOf(new Date(+m[1], +m[2] - 1, +m[3]));
  const withYear = (mon, day) => {
    const d = noonOf(new Date(base.getFullYear(), mon, day));
    // «5 January», записане в грудні, — наступного року
    if (d - base < -180 * DAY_MS) d.setFullYear(d.getFullYear() + 1);
    return d;
  };
  // усі збіги, а не лише перший: «3 marathons on 5 November» — дата друга
  for (const x of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-zА-Яа-яІіЇїЄєҐґ']{3,})/g)) {
    if (monthIdx(x[2]) >= 0 && +x[1] >= 1 && +x[1] <= 31) return withYear(monthIdx(x[2]), +x[1]);
  }
  for (const x of t.matchAll(/\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    if (monthIdx(x[1]) >= 0 && +x[2] >= 1 && +x[2] <= 31) return withYear(monthIdx(x[1]), +x[2]);
  }
  const low = t.toLowerCase();
  const plus = (n) => new Date(base.getTime() + n * DAY_MS);
  if (/\btomorrow\b|завтра/.test(low)) return plus(1);
  if (/\byesterday\b|вчора|учора/.test(low)) return plus(-1);
  if (/\btoday\b|\btonight\b|сьогодні/.test(low)) return plus(0);
  if (/\bweekend\b|вихідн/.test(low)) return plus((6 - base.getDay() + 7) % 7);
  if (/\bnext week\b|наступного тижня/.test(low)) return plus(7);
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(?:on |this |next )?${WEEKDAYS_EN[i]}\\b|${WEEKDAYS_UK[i]}`);
    if (re.test(low)) { const ahead = ((i - base.getDay()) + 7) % 7 || 7; return plus(/\blast\b|минул/.test(low) ? ahead - 7 : ahead); }
  }
  return null;
}

/**
 * Тема розмови на сьогодні:
 * 1) подія з пам'яті вчителя з датою в межах ±7 днів (найновіший факт); 2) порада після минулої розмови;
 * 3) найчастіше відкрите правило з «Моїх помилок»; 4) «Мій день».
 */
export function voiceTopic(now = new Date()) {
  const facts = [...(store.prof().memory?.facts || [])].filter(f => f?.text).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const today = noonOf(now);
  for (const f of facts) {
    const d = factDate(f.text, f.at);
    if (!d) continue;
    const days = Math.round((d - today) / DAY_MS);
    if (Math.abs(days) > 7) continue;
    const when = days > 0 ? 'coming up soon' : days < 0 ? 'that happened recently' : 'happening today';
    return {
      kind: 'event', label: 'Подія з вашого життя', note: f.text,
      topic: `An event in the student's life ${when} (from your memory): «${String(f.text).slice(0, 140)}». Ask about it naturally — plans, feelings, details — and keep the conversation going.`.slice(0, 300),
    };
  }
  const focus = store.prof().lastFocus;
  if (focus) {
    return { kind: 'focus', label: 'Порада з минулої розмови', note: String(focus), topic: `Focus recommended after the last session (practise it naturally in conversation): ${focus}`.slice(0, 300) };
  }
  const byRule = new Map();
  for (const m of store.all('mistakes')) {
    if (m.resolved || !m.rule || m.rule === 'other' || !RULES[m.rule]) continue;
    byRule.set(m.rule, (byRule.get(m.rule) || 0) + (m.count || 1));
  }
  // правило тижня, ще не закрите, — перше; інакше найчастіше
  const fr = safe(() => focusProgress(weeklyFocus(now)).find(p => !p.done)?.rule);
  const top = fr && RULES[fr] ? [fr, byRule.get(fr) || 0] : [...byRule.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const lbl = ruleLabel(top[0]);
    return {
      kind: 'mistakes', label: top[0] === fr ? `Правило тижня: ${lbl}` : `Мої помилки: ${lbl}`, note: null,
      topic: `Work on the student's most frequent mistake pattern «${top[0]}» (${lbl}): briefly show one of their real mistakes (wrong → right), then keep a natural conversation that makes them use the correct form; notice when they get it right.`.slice(0, 300),
    };
  }
  return { kind: 'day', label: 'Мій день', note: null, topic: 'The student\'s day: what they did today and their plans for tomorrow.' };
}

const shortTopic = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/**
 * План дня.
 * Повертає { day, steps, totalMin, doneMin, progress (0..1), allDone, started, next }.
 * Крок: { id, title, desc, minutes, href, done, progress (0..1), skipped, note }.
 */
export async function buildPlan() {
  const st = readState();
  const steps = [];

  // ---- а) Слова ----
  const [due, fresh] = await Promise.all([srs.dueCards(), srs.newCards()]);
  const reviewed = reviewedToday();
  const avail = due.length + fresh.length;
  const wTarget = freeze(st, 'words', Math.min(WORDS_MAX, avail + reviewed));
  if (wTarget > 0 || reviewed > 0) {
    const target = Math.max(1, wTarget);
    const done = reviewed >= target || avail === 0;
    const left = Math.max(0, target - reviewed);
    steps.push({
      id: 'words', icon: 'cards', title: 'Слова',
      desc: done ? `Повторено ${reviewed} ${plural(reviewed, 'слово', 'слова', 'слів')}` : `${left} ${plural(left, 'слово', 'слова', 'слів')}: повтор і нові за рівнем`,
      minutes: Math.max(3, Math.min(6, Math.round(target * 0.45))),
      href: '#/cards/train?daily=1', done, progress: done ? 1 : Math.min(1, reviewed / target), skipped: false,
    });
  }

  // ---- б) Правила (контракт js/stats.js: dueRuleMistakes, rulePracticeToday); правила тижня — першими ----
  const focus = safe(() => weeklyFocus());
  const focusOpen = focus ? (safe(() => focusProgress(focus)) || []).filter(p => !p.done) : [];
  const dueRules = typeof stats.dueRuleMistakes === 'function' ? (safe(() => stats.dueRuleMistakes(RULES_MAX)) || []) : [];
  const practised = typeof stats.rulePracticeToday === 'function' ? (Number(safe(() => stats.rulePracticeToday())) || 0) : 0;
  const rTarget = freeze(st, 'rules', Math.min(RULES_MAX, dueRules.length + practised));
  if (rTarget > 0 || practised > 0) {
    const target = Math.max(1, rTarget);
    // нічого не чекає на повтор (помилки закрито в розмові чи вправах) — крок виконано, як і в словах
    const done = practised >= target || dueRules.length === 0;
    const left = Math.max(0, target - practised);
    steps.push({
      id: 'rules', icon: 'warning-circle', title: 'Правила',
      desc: done && !practised ? 'Сьогодні нічого не чекає на повтор' : done ? `Відпрацьовано ${practised} ${plural(practised, 'помилку', 'помилки', 'помилок')}`
        : focusOpen.length && dueRules.some(m => focusOpen.some(p => p.rule === m.rule))
          ? shortTopic(`Правила тижня: ${focusOpen.map(p => p.label).join(', ')}`, 96)
          : `${left} ${plural(left, 'помилка', 'помилки', 'помилок')} з ваших розмов — закріпити правило`,
      focus: focusOpen.map(p => p.rule),
      minutes: 3, href: '#/mistakes?practice=due', done, progress: done ? 1 : Math.min(1, practised / target), skipped: false,
    });
  }

  // ---- в) Розмова голосом ----
  const talk = talkSecondsToday();
  const vDone = talk >= VOICE_SEC;
  const logged = !!user();
  const t = voiceTopic();
  steps.push({
    id: 'voice', icon: 'microphone', title: 'Розмова голосом',
    desc: vDone ? `Поговорили ${Math.round(talk / 60)} хв` : !logged ? 'Потрібен вхід: вчитель працює після входу в акаунт' : `${t.label}${t.note ? ` · ${shortTopic(t.note)}` : ''}`,
    minutes: 6, href: logged ? `#/tutor?mode=voice&topic=${encodeURIComponent(t.topic.slice(0, 300))}&label=${encodeURIComponent('Мій день')}` : '#/auth',
    done: vDone, progress: vDone ? 1 : Math.min(1, talk / VOICE_SEC), skipped: !logged && !vDone, topic: t,
  });

  // цілі дописуються до свіжого стану: «Почати», натиснуте під час побудови плану, не губиться
  const latest = readState();
  for (const [k, v] of Object.entries(st.targets)) freeze(latest, k, v);
  writeState(latest);
  const counted = steps.filter(s => !s.skipped);
  const totalMin = counted.reduce((a, s) => a + s.minutes, 0);
  const doneMin = counted.reduce((a, s) => a + s.minutes * s.progress, 0);
  const allDone = counted.length > 0 && counted.every(s => s.done);
  return {
    day: st.day, steps, totalMin, doneMin, progress: totalMin ? doneMin / totalMin : 0,
    allDone, started: !!latest.started, next: counted.find(s => !s.done) || null,
  };
}

function safe(fn) { try { return fn(); } catch (e) { console.warn('daily', e); return null; } }
