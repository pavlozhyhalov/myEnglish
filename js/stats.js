// Активність (час), стрік, помилки — похідні дані зі сховища
import * as store from './store.js';
import { RULES } from './rules.js';
import { focusRules } from './focus.js';

const ACTIVE_DAY_SEC = 5 * 60;   // день зараховується в стрік від 5 хв практики

export function dayKey(d = new Date()) {
  const t = new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
export const today = () => dayKey();

/** Полудень дня d: крок setDate(±1) від полудня не зачіпає годину переходу на літній/зимовий час */
const noon = (d = new Date()) => { const t = new Date(d); t.setHours(12, 0, 0, 0); return t; };

/**
 * Записати сесію практики (лише час). ref — id розмови, щоб її видалення прибирало й статистику.
 * Сесія, що перейшла через північ, ділиться на два записи: час до півночі — у вчорашній день (стрік, тиждень, Resonance).
 * Повертає запис сьогоднішнього дня з загальною тривалістю в seconds (для показу).
 */
export function logSession(type, seconds, ref = null) {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 5) return null;
  const now = new Date(), midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const sinceMidnight = Math.floor((now - midnight) / 1000);
  const before = seconds - sinceMidnight;
  if (before >= 5 && sinceMidnight >= 5) {
    const first = store.put('sessions', { type, seconds: before, xp: 0, day: dayKey(new Date(midnight - 1000)), ts: new Date(midnight - 1000).toISOString(), ref: ref || null });
    const row = store.put('sessions', { type, seconds: sinceMidnight, xp: 0, day: today(), ts: store.nowIso(), ref: ref || null });
    return row && { ...row, seconds, ids: [first?.id, row.id].filter(Boolean) };
  }
  // менше 5 с з одного боку півночі — увесь час у день, де його більше
  const day = before >= sinceMidnight ? dayKey(new Date(midnight - 1000)) : today();
  return store.put('sessions', { type, seconds, xp: 0, day, ts: store.nowIso(), ref: ref || null });
}

/**
 * Таймер активності сторінки: рахує лише видимий час, з паузою після 2 хв бездіяльності.
 * Коли застосунок ховають або закривають, накопичений час одразу записується (інакше незавершене заняття губилося),
 * далі таймер рахує заново; stop() повертає загальну тривалість у seconds.
 */
// Простій: після IDLE_MS без дотиків час не йде; із самого простою зараховується лише GRACE_MS (а не всі 2 хв) —
// крім сторінок, де довго читають чи слухають без дотиків (там простій до 2 хв — це читання).
const IDLE_MS = 120000, GRACE_MS = 30000;
const READING_TYPES = new Set(['reading', 'listening', 'grammar', 'writing', 'diary']);
export function activityTimer(type) {
  let acc = 0, total = 0, last = Date.now(), lastInput = Date.now(), stopped = false, ref = null;
  let idleAdded = 0;   // час, доданий після GRACE_MS без дотиків: якщо простій дійде до IDLE_MS — віднімаємо
  const fullCredit = READING_TYPES.has(type);
  const saved = [];   // id проміжних записів — щоб проставити їм ref (видалення розмови прибирає весь її час)
  const tick = () => {
    const now = Date.now();
    const since = now - lastInput;
    if (!document.hidden && since < IDLE_MS) {
      const dt = now - last;
      acc += dt;
      if (!fullCredit && since > GRACE_MS) idleAdded += Math.min(dt, since - GRACE_MS);
    } else if (idleAdded && since >= IDLE_MS) {
      // це був простій, а не заняття — лишаємо тільки GRACE_MS
      const back = Math.min(idleAdded, acc);
      acc -= back; idleAdded = 0;
    }
    last = now;
  };
  const checkpoint = () => {
    if (stopped) return;
    tick();
    const row = logSession(type, acc / 1000, ref);
    if (row) { saved.push(...[].concat(row.ids || row.id)); total += acc; acc = 0; }
    store.flush();   // одразу на диск: схована вкладка може більше не отримати таймер
  };
  const onHide = () => { if (document.hidden) checkpoint(); };
  const iv = setInterval(tick, 5000);
  const mark = () => { tick(); lastInput = Date.now(); idleAdded = 0; };
  const evs = ['pointerdown', 'keydown', 'touchstart'];
  evs.forEach(e => window.addEventListener(e, mark, { passive: true }));
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', checkpoint);
  return {
    setRef(r) { ref = r; },
    poke: mark,
    seconds() { tick(); return (total + acc) / 1000; },
    stop() {
      if (stopped) return null;
      tick(); clearInterval(iv);
      evs.forEach(e => window.removeEventListener(e, mark));
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', checkpoint);
      if (ref) for (const id of saved) { const r = store.get('sessions', id); if (r && !r.ref) store.put('sessions', { ...r, ref }); }
      const row = logSession(type, acc / 1000, ref);
      stopped = true;
      const sec = Math.round((total + acc) / 1000);
      if (!total) return row;
      return row ? { ...row, seconds: sec } : (sec >= 5 ? { type, seconds: sec, ref } : null);
    },
  };
}

export function secondsByDay() {
  const m = new Map();
  for (const s of store.all('sessions')) m.set(s.day, (m.get(s.day) || 0) + (s.seconds || 0));
  return m;
}
export function todaySeconds() { return secondsByDay().get(today()) || 0; }

export function streak() {
  const m = secondsByDay();
  let n = 0;
  const d = noon();
  if ((m.get(dayKey(d)) || 0) < ACTIVE_DAY_SEC) d.setDate(d.getDate() - 1); // сьогодні ще не зараховано — стрік не рветься
  for (;;) {
    if ((m.get(dayKey(d)) || 0) >= ACTIVE_DAY_SEC) { n++; d.setDate(d.getDate() - 1); } else break;
  }
  return n;
}

/** Поточний тиждень Пн–Нд: active (≥5 хв) і goal (денна мета) */
export function week() {
  const m = secondsByDay();
  const goal = store.settings().dailyGoal * 60;
  const d = noon();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  return names.map((name, i) => {
    const day = new Date(d); day.setDate(d.getDate() + i);
    const k = dayKey(day); const s = m.get(k) || 0;
    return { name, key: k, active: s >= ACTIVE_DAY_SEC, goal: s >= goal, today: k === today(), future: k > today() };
  });
}

export function lastNDays(n) {
  const m = secondsByDay();
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = noon(); d.setDate(d.getDate() - i); const k = dayKey(d); out.push({ key: k, seconds: m.get(k) || 0, date: d }); }
  return out;
}

/** Секунди за останні 7 днів (включно з сьогодні) */
export function weekSeconds() {
  const from = noon(); from.setDate(from.getDate() - 6);
  const k = dayKey(from);
  return store.all('sessions').filter(s => s.day >= k).reduce((a, s) => a + (s.seconds || 0), 0);
}
export function totalSeconds() { return store.all('sessions').reduce((a, s) => a + (s.seconds || 0), 0); }

// ---------- Помилки ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim();
export const MISTAKE_TYPES = ['articles', 'tenses', 'prepositions', 'word_order', 'vocabulary', 'pronunciation', 'other'];

export function addMistake({ wrong, right, type, rule, explanation_uk, source, ref }) {
  if (!wrong || !right || norm(wrong) === norm(right)) return null;
  if (!MISTAKE_TYPES.includes(type)) type = 'other';
  rule = RULES[rule] ? rule : null;
  if (rule && rule !== 'other') type = RULES[rule].type;
  // оскаржене учнем («Не згоден») — не додаємо
  if (isDisputed(wrong, right)) return null;
  // помилка на граматичне правило — серії інших помилок цього правила відступають на крок (не до нуля);
  // у «словникових» правилах кожна помилка окрема — нова помилка інших не чіпає (2026-11-08: 191 з 193 помилок мали серію 0)
  if (rule && !LEXICAL.has(rule)) ruleMiss(rule);
  const ex = store.all('mistakes').find(m => norm(m.wrong) === norm(wrong) && norm(m.right) === norm(right));
  if (ex) { ex.count = (ex.count || 1) + 1; ex.streak = 0; ex.resolved = false; if (rule && !ex.rule) ex.rule = rule; return store.put('mistakes', ex); }
  return store.put('mistakes', { wrong, right, type, rule, explanation_uk: explanation_uk || '', source: source || 'tutor', count: 1, streak: 0, resolved: false, ref: ref || null });
}
const openOfRule = (rule) => store.all('mistakes').filter(m => !m.deleted && !m.resolved && m.rule === rule);
/** «Словникові» правила: кожна помилка — окреме слово чи вислів, тож правило не можна «засвоїти» разом (make/do ≠ borrow/lend) */
export const LEXICAL = new Set(['word-choice', 'collocations', 'prep-dependent', 'irregular-verbs', 'other']);
/** Нова помилка на граматичне правило: серії інших відкритих помилок цього правила — на крок назад */
function ruleMiss(rule) {
  for (const m of openOfRule(rule)) if (m.streak) { m.streak = Math.max(0, m.streak - 1); store.put('mistakes', m); }
}
/** Правильне використання граматичного правила в розмові: +1 до серії кожної відкритої помилки цього правила (3 — закрито) */
export function ruleHit(rule, done = new Set()) {
  if (!rule || LEXICAL.has(rule)) return 0;
  let n = 0;
  for (const m of openOfRule(rule)) if (!done.has(m.id)) { done.add(m.id); mistakeHit(m, true); n++; }
  return n;
}
/** Відкриті помилки, згруповані за правилом (без правила — за типом): прогрес правила = найменша серія серед його помилок */
export function mistakesByRule() {
  const g = new Map();
  for (const m of store.all('mistakes')) {
    if (m.deleted || m.resolved) continue;
    const key = m.rule && m.rule !== 'other' ? m.rule : `type:${m.type || 'other'}`;
    const e = g.get(key) || { key, rule: key.startsWith('type:') ? null : key, label: RULES[key]?.uk || null, type: m.type, total: 0, items: [], streak: 3 };
    e.total += m.count || 1; e.items.push(m); e.streak = Math.min(e.streak, m.streak || 0);
    g.set(key, e);
  }
  return [...g.values()].sort((a, b) => b.total - a.total);
}

// ---------- Прибирання списку помилок (2026-11-08) ----------
/**
 * Раз на добу (після синхронізації): 1) зливає дублікати — та сама правильна форма або та сама помилкова фраза;
 * 2) закриває разові помилки, що не повторювались: з правильним уживанням (серія ≥ 1) — через 14 днів, без нього — через 30.
 * Повертає { merged, closed }. Видалення м'яке (store.remove).
 */
export function tidyMistakes({ force = false } = {}) {
  const KEY = 'me:mk-tidy';
  try { if (!force && localStorage.getItem(KEY) === today()) return { merged: 0, closed: 0 }; } catch {}
  const open = store.all('mistakes').filter(m => !m.deleted && !m.resolved && m.wrong && m.right && m.wrong !== '—')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const byKey = new Map();
  let merged = 0, closed = 0;
  for (const m of open) {
    const kr = 'r:' + norm(m.right), kw = 'w:' + norm(m.wrong);
    const keep = byKey.get(kr) || byKey.get(kw);
    if (keep && keep.id !== m.id && (keep.rule || null) === (m.rule || keep.rule || null)) {
      keep.count = (keep.count || 1) + (m.count || 1);
      keep.streak = Math.max(keep.streak || 0, m.streak || 0);
      if (!keep.rule && m.rule) keep.rule = m.rule;
      if (!keep.explanation_uk && m.explanation_uk) keep.explanation_uk = m.explanation_uk;
      store.put('mistakes', keep); store.remove('mistakes', m.id); merged++;
      continue;
    }
    byKey.set(kr, m); byKey.set(kw, m);
  }
  const now = Date.now(), DAY = 864e5;
  for (const m of store.all('mistakes')) {
    if (m.deleted || m.resolved || (m.count || 1) > 1) continue;
    const quiet = now - Date.parse(m.updated_at || m.created_at || 0);
    if ((m.streak >= 1 && quiet > 14 * DAY) || quiet > 30 * DAY) { m.resolved = true; store.put('mistakes', m); closed++; }
  }
  try { localStorage.setItem(KEY, today()); } catch {}
  return { merged, closed };
}

// ---------- «Не згоден» з виправленням ----------
const disputes = () => (Array.isArray(store.prof().disputes) ? store.prof().disputes : []);
export function isDisputed(wrong, right) {
  const w = norm(wrong), r = norm(right);
  return !!w && disputes().some(d => norm(d.wrong) === w && (!d.right || norm(d.right) === r));
}
/**
 * Учень не згоден з виправленням: вчитель більше його не робить (profiles.data.disputes → сервер),
 * а помилка зникає зі статистики (лічильник −1 або видалення). row — розмова, з підсумку якої прибрати.
 */
export function disputeFix({ wrong, right }, row = null) {
  if (!wrong) return;
  const list = disputes().filter(d => !(norm(d.wrong) === norm(wrong) && norm(d.right) === norm(right)));
  store.setProf({ disputes: [...list, { wrong: String(wrong).slice(0, 120), right: String(right || '').slice(0, 120), at: new Date().toISOString() }].slice(-40) });
  const ex = store.all('mistakes').find(m => !m.deleted && norm(m.wrong) === norm(wrong) && norm(m.right) === norm(right));
  if (ex) { if ((ex.count || 1) > 1) { ex.count -= 1; store.put('mistakes', ex); } else store.remove('mistakes', ex.id); }
  if (row?.summary?.mistakes) {
    row.summary.mistakes = row.summary.mistakes.filter(m => !(norm(m.wrong) === norm(wrong) && norm(m.right) === norm(right)));
    store.put('tutor_chats', row);
  }
}

/** Помилки без правила (старі, з карток виправлень) — класифікувати на сервері; раз на сесію застосунку, до 40 за раз */
let classifying = null;
export function classifyPending() {
  if (classifying) return classifying;
  // лише помилки з мовлення й письма (вправи й тести мають власний тип і часто порожню відповідь «—»)
  const pending = store.all('mistakes').filter(m => !m.deleted && !m.rule && ['tutor', 'diary'].includes(m.source || 'tutor') && m.wrong && m.wrong !== '—').slice(0, 40);
  if (!pending.length) return Promise.resolve(0);
  classifying = import('./ai.js').then(({ tutor }) => tutor('classify', { items: pending.map(m => ({ wrong: m.wrong, right: m.right })) }))
    .then(r => {
      let n = 0;
      for (const x of r?.items || []) {
        const m = pending[x.i];
        if (!m || !RULES[x.rule]) continue;
        m.rule = x.rule;
        if (x.rule !== 'other' && (!m.type || m.type === 'other')) m.type = RULES[x.rule].type;
        store.put('mistakes', m); n++;
      }
      return n;
    })
    .catch(() => 0);
  return classifying;
}
/** Правильне застосування: 3 поспіль — виправлено */
export function mistakeHit(m, correct) {
  m.streak = correct ? (m.streak || 0) + 1 : 0;
  if (!correct) m.count = (m.count || 1) + 1;
  m.resolved = m.streak >= 3;
  store.put('mistakes', m);
}
export function mistakesByType({ includeResolved = false } = {}) {
  const g = new Map();
  for (const m of store.all('mistakes')) {
    if (m.resolved && !includeResolved) continue;
    const e = g.get(m.type) || { type: m.type, total: 0, items: [] };
    e.total += m.count || 1; e.items.push(m);
    g.set(m.type, e);
  }
  return [...g.values()].sort((a, b) => b.total - a.total);
}

// ---------- Уроки ----------
export function lessonDone(id) { const p = store.get('lessons_progress', id); return !!p?.completed_at; }
export function recordLesson(id, score) {
  const p = store.get('lessons_progress', id) || { id, best: 0, attempts: 0, review_stage: 0 };
  p.attempts = (p.attempts || 0) + 1;
  p.last_score = score;
  p.best = Math.max(p.best || 0, score);
  if (score >= 80) {
    const now = new Date();
    if (!p.completed_at) {
      p.completed_at = now.toISOString(); p.review_stage = 0;
      p.next_review = new Date(now.getTime() + 7 * 864e5).toISOString();
    } else if (p.next_review && new Date(p.next_review) <= now) {
      p.review_stage = (p.review_stage || 0) + 1;
      p.next_review = p.review_stage === 1 ? new Date(now.getTime() + 30 * 864e5).toISOString() : null;
    }
  }
  store.put('lessons_progress', p);
  return p;
}
/**
 * Результат тесту за уроком — у прогрес навчання: ≥ 80% зараховує урок (як вправи уроку; впливає на урок дня й опанування рівня),
 * < 60% — урок повертається на повторення (з'явиться серед «Повторити» й у плані). Повертає, що змінилось.
 */
export function applyLessonTest(id, score) {
  const before = store.get('lessons_progress', id);
  const wasDone = !!before?.completed_at;
  const p = recordLesson(id, score);
  let effect = 'none';
  if (score >= 80) effect = wasDone ? 'confirmed' : 'passed';
  else if (score < 60 && wasDone) {
    // зарахований раніше урок «просів» — на повторення
    p.next_review = new Date().toISOString();
    store.put('lessons_progress', p);
    effect = 'review';
  } else if (score < 60) effect = 'fail';
  return effect;
}
/** Тести за уроками, пройдені до того, як результат почав враховуватись (або на іншому пристрої до синхронізації), — застосувати один раз */
export function backfillLessonTests() {
  const tests = store.all('tests').filter(t => t.type === 'lesson' && t.ref && t.scores && t.created_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const t of tests) {
    const p = store.get('lessons_progress', t.ref);
    if (p && String(p.updated_at || '') >= String(t.created_at)) continue;   // прогрес новіший за тест — вже враховано
    applyLessonTest(t.ref, t.scores.score ?? 0);
  }
}
/** Позначити урок «на повторення» (слабкий результат у тижневому тесті) */
export function lessonNeedsReview(id) {
  const p = store.get('lessons_progress', id);
  if (!p?.completed_at) return;   // незарахований урок і так у черзі курсу — не «повтор»
  p.next_review = new Date().toISOString();
  store.put('lessons_progress', p);
}
export function lessonsToReview() {
  const now = new Date();
  return store.all('lessons_progress').filter(p => p.next_review && new Date(p.next_review) <= now);
}

/** Рівень за навичками: з останнього тесту на рівень + сигнали розмов */
export function skillLevels() {
  const prof = store.prof();
  // запасний варіант — бали останнього тесту на рівень (як у «Аналізі»), якщо профіль ще не синхронізувався
  const lastPl = store.all('tests').filter(t => t.type === 'placement' && t.scores).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const fromTest = {};
  for (const k of ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'speaking']) { const v = lastPl?.scores?.[k]; if (typeof v === 'string' && /^[ABC][12]$/.test(v)) fromTest[k] = v; }
  const out = { grammar: null, vocabulary: null, reading: null, listening: null, writing: null, speaking: null, ...fromTest, ...(prof.skills || {}) };
  const signals = store.all('tutor_chats').filter(c => c.summary?.level_signal && c.summary.level_assessment?.enough_data !== false).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  if (signals.length) {
    const order = ['A1', 'A2', 'B1', 'B2', 'C1'];
    const avg = signals.reduce((a, c) => a + Math.max(0, order.indexOf(c.summary.level_signal)), 0) / signals.length;
    out.speaking = order[Math.round(avg)];
  }
  return out;
}

// ---------- Видалення розмови разом із її статистикою ----------
/**
 * Прибирає розмову, її час (сесії з ref = id) і помилки з її підсумку:
 * помилка, створена цією розмовою, видаляється; додана до наявної — зменшує лічильник.
 */
export function deleteChat(id) {
  const chat = store.get('tutor_chats', id);
  if (!chat) return;
  let sessions = store.all('sessions').filter(s => s.ref === id);
  if (!sessions.length) {
    // старі розмови без прив'язки: сесія завершилась після початку розмови (до 6 год) і має ту саму тривалість
    const t0 = Date.parse(chat.created_at);
    const s = store.all('sessions').find(x => !x.ref && ['tutor', 'voice', 'writing'].includes(x.type) && Date.parse(x.ts) >= t0 && Date.parse(x.ts) - t0 < 6 * 3600e3 && Math.abs((x.seconds || 0) - (chat.seconds || 0)) <= 2);
    if (s) sessions = [s];
  }
  for (const s of sessions) store.remove('sessions', s.id);
  const list = chat.summary?.mistakes || chat.summary?.corrections || [];
  for (const m of list) {
    const ex = store.all('mistakes').find(x => norm(x.wrong) === norm(m.wrong) && norm(x.right) === norm(m.right));
    if (!ex) continue;
    if ((ex.count || 1) > 1) { ex.count -= 1; store.put('mistakes', ex); }
    else if (ex.ref === id || (!ex.ref && (ex.source || 'tutor') === 'tutor')) store.remove('mistakes', ex.id);
  }
  // аудіофрагмент розмови (звіт «тоді й зараз») — теж видаляємо зі сховища; без мережі — лишається, не критично
  const clip = chat.summary?.clip?.path;
  if (clip) import('./supa.js').then(({ getSupa }) => getSupa()).then(sb => sb?.storage.from('voice-clips').remove([clip])).catch(() => {});
  store.remove('tutor_chats', id);
}

// ---------- Правила за розкладом (інтервальне повторення помилок, без зміни схеми) ----------
// Остання практика кожної помилки й лічильник за день — у localStorage 'me:rule-practice':
// { at: { [mistakeId]: isoTime }, days: { 'YYYY-MM-DD': n } }. Без сховища — працює з created_at, лічильник лише в пам'яті.
const RP_KEY = 'me:rule-practice';
const RP_SOURCES = new Set(['tutor', 'voice', 'diary', 'exercise']);   // мовлення, письмо, вправи (не тести)
const RP_INTERVAL = [20 * 3600e3, 3 * 864e5, 7 * 864e5];               // серія 0 → 20 год, 1 → 3 дні, 2 → 7 днів
let rpMem = null;
function rpRead() {
  try {
    const v = JSON.parse(localStorage.getItem(RP_KEY) || 'null');
    if (v && typeof v === 'object') return { at: v.at && typeof v.at === 'object' ? v.at : {}, days: v.days && typeof v.days === 'object' ? v.days : {} };
  } catch { /* приватний режим або зіпсовані дані */ }
  return rpMem || { at: {}, days: {} };
}
function rpWrite(v) {
  // лише останні 14 днів лічильника; позначки — лише для наявних помилок
  const keep = Object.keys(v.days).sort().slice(-14);
  v.days = Object.fromEntries(keep.map(k => [k, v.days[k]]));
  rpMem = v;
  try { localStorage.setItem(RP_KEY, JSON.stringify(v)); } catch { /* недоступне — лишається в пам'яті */ }
}
const rpOpen = () => store.all('mistakes').filter(m => !m.deleted && !m.resolved && m.wrong && m.right && m.wrong !== '—'
  && m.type !== 'pronunciation' && RP_SOURCES.has(m.source || 'tutor'));
const rpKey = (m) => (m.rule && m.rule !== 'other' ? m.rule : `type:${m.type || 'other'}`);
/** Час, коли помилку знову варто повторити (мс) */
function rpDueAt(m, at) {
  const last = Date.parse(at[m.id] || m.created_at || m.updated_at || 0) || 0;
  return last + RP_INTERVAL[Math.max(0, Math.min(2, m.streak || 0))];
}

/**
 * Помилки, яким настав час повтору: відкриті, з мовлення/письма/вправ.
 * Порядок: спершу правила тижня (js/focus.js, у їхньому порядку), далі правила з найбільшою кількістю відкритих помилок,
 * найчастіші помилки; не більше 2 на правило в одному наборі.
 * opts.only — лише ці правила (id); opts.perRule — скільки помилок одного правила в наборі (за замовчуванням 2).
 */
export function dueRuleMistakes(limit = 10, now = Date.now(), opts = {}) {
  const { at } = rpRead();
  const only = Array.isArray(opts.only) ? new Set(opts.only) : null;
  const perRuleMax = Math.max(1, Number(opts.perRule) || 2);
  const open = rpOpen().filter(m => !only || only.has(rpKey(m)));
  const focus = safeFocus();
  const rank = (m) => { const i = focus.indexOf(rpKey(m)); return i < 0 ? focus.length : i; };
  const perRule = new Map();
  for (const m of open) perRule.set(rpKey(m), (perRule.get(rpKey(m)) || 0) + 1);
  const due = open.filter(m => rpDueAt(m, at) <= now)
    .sort((a, b) => (rank(a) - rank(b)) || (perRule.get(rpKey(b)) - perRule.get(rpKey(a))) || rpKey(a).localeCompare(rpKey(b))
      || (b.count || 1) - (a.count || 1) || (a.streak || 0) - (b.streak || 0));
  const out = [], used = new Map();
  for (const m of due) {
    if (out.length >= limit) break;
    const k = rpKey(m), n = used.get(k) || 0;
    if (n >= perRuleMax) continue;
    used.set(k, n + 1); out.push(m);
  }
  return out;
}
function safeFocus() { try { return focusRules(); } catch { return []; } }
/**
 * Тренування правил тижня (#/mistakes?practice=due&focus=1): спершу ті, кому настав час повтору (до 3 на правило),
 * а якщо їх замало — інші відкриті помилки цих правил, які сьогодні ще не тренували (менша серія — першими).
 */
export function focusPracticeMistakes(limit = 8, now = Date.now()) {
  const rules = safeFocus();
  if (!rules.length) return [];
  const out = dueRuleMistakes(limit, now, { only: rules, perRule: 3 });
  if (out.length >= Math.min(4, limit)) return out;
  const { at } = rpRead();
  const have = new Set(out.map(m => m.id));
  const extra = rpOpen().filter(m => rules.includes(rpKey(m)) && !have.has(m.id) && !(at[m.id] && dayKey(at[m.id]) === today()))
    .sort((a, b) => rules.indexOf(rpKey(a)) - rules.indexOf(rpKey(b)) || (a.streak || 0) - (b.streak || 0) || (b.count || 1) - (a.count || 1));
  // правила по черзі, щоб набір не складався з одного правила
  const queues = rules.map(r => extra.filter(m => rpKey(m) === r));
  while (out.length < limit && queues.some(q => q.length)) for (const q of queues) if (q.length && out.length < limit) out.push(q.shift());
  return out;
}
/** Скільки помилок чекає на повтор зараз (без обмеження набору) */
export function dueRuleCount(now = Date.now()) {
  const { at } = rpRead();
  return rpOpen().filter(m => rpDueAt(m, at) <= now).length;
}
/** Найближчий час наступного повтору (мс) або null, якщо відкритих помилок немає */
export function nextRulePracticeAt() {
  const { at } = rpRead();
  const t = rpOpen().map(m => rpDueAt(m, at));
  return t.length ? Math.min(...t) : null;
}
/** Скільки помилок повторено сьогодні */
export function rulePracticeToday() { return Number(rpRead().days[today()]) || 0; }
/** Відповідь у повторі правил: серія помилки (3 поспіль — закрито), позначка часу, лічильник дня */
export function logRulePractice(m, correct) {
  if (!m) return;
  mistakeHit(m, correct);
  const v = rpRead();
  const ids = new Set(store.all('mistakes').map(x => x.id));
  v.at = Object.fromEntries(Object.entries(v.at).filter(([id]) => ids.has(id)));
  // лічильник дня — різні помилки: повторний підхід до тієї самої помилки сьогодні не зараховується вдруге
  const again = v.at[m.id] && dayKey(v.at[m.id]) === today();
  v.at[m.id] = new Date().toISOString();
  if (!again) v.days[today()] = (Number(v.days[today()]) || 0) + 1;
  rpWrite(v);
}
