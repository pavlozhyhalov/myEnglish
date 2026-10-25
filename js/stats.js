// Активність, стрік, XP, помилки — похідні дані зі сховища
import * as store from './store.js';

export const XP = { perMinute: 2, perCard: 1, perLesson: 20, perTest: 30 };
const ACTIVE_DAY_SEC = 5 * 60;   // день зараховується в стрік від 5 хв практики

export function dayKey(d = new Date()) {
  const t = new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
export const today = () => dayKey();

/** Записати сесію практики (секунди й XP). ref — id розмови, щоб її видалення прибирало й статистику */
export function logSession(type, seconds, extraXp = 0, ref = null) {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 5 && !extraXp) return null;
  const xp = Math.round(seconds / 60 * XP.perMinute) + extraXp;
  return store.put('sessions', { type, seconds, xp, day: today(), ts: store.nowIso(), ref: ref || null });
}

/** Таймер активності сторінки: рахує лише видимий час, з паузою після 2 хв бездіяльності */
export function activityTimer(type) {
  let acc = 0, last = Date.now(), lastInput = Date.now(), xp = 0, stopped = false, ref = null;
  const tick = () => {
    const now = Date.now();
    if (!document.hidden && now - lastInput < 120000) acc += now - last;
    last = now;
  };
  const iv = setInterval(tick, 5000);
  const mark = () => { tick(); lastInput = Date.now(); };
  const evs = ['pointerdown', 'keydown', 'touchstart'];
  evs.forEach(e => window.addEventListener(e, mark, { passive: true }));
  return {
    addXp(n) { xp += n; mark(); },
    setRef(r) { ref = r; },
    poke: mark,
    seconds() { tick(); return acc / 1000; },
    stop() {
      if (stopped) return null;
      stopped = true; tick(); clearInterval(iv);
      evs.forEach(e => window.removeEventListener(e, mark));
      return logSession(type, acc / 1000, xp, ref);
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
  const d = new Date();
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
  const d = new Date();
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
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); out.push({ key: k, seconds: m.get(k) || 0, date: d }); }
  return out;
}

export function totalXp() { return store.all('sessions').reduce((a, s) => a + (s.xp || 0), 0); }
export function xpWeek() {
  const from = new Date(); from.setDate(from.getDate() - 6);
  const k = dayKey(from);
  return store.all('sessions').filter(s => s.day >= k).reduce((a, s) => a + (s.xp || 0), 0);
}
/** Рівень гейміфікації: кожен рівень потребує на 100 XP більше */
export function xpLevel(xp = totalXp()) {
  let lvl = 1, need = 200, rest = xp;
  while (rest >= need) { rest -= need; lvl++; need += 100; }
  return { lvl, rest, need };
}
export function totalSeconds() { return store.all('sessions').reduce((a, s) => a + (s.seconds || 0), 0); }

// ---------- Помилки ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim();
export const MISTAKE_TYPES = ['articles', 'tenses', 'prepositions', 'word_order', 'vocabulary', 'pronunciation', 'other'];

export function addMistake({ wrong, right, type, explanation_uk, source, ref }) {
  if (!wrong || !right || norm(wrong) === norm(right)) return null;
  if (!MISTAKE_TYPES.includes(type)) type = 'other';
  const ex = store.all('mistakes').find(m => norm(m.wrong) === norm(wrong) && norm(m.right) === norm(right));
  if (ex) { ex.count = (ex.count || 1) + 1; ex.streak = 0; ex.resolved = false; return store.put('mistakes', ex); }
  return store.put('mistakes', { wrong, right, type, explanation_uk: explanation_uk || '', source: source || 'tutor', count: 1, streak: 0, resolved: false, ref: ref || null });
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
export function lessonsToReview() {
  const now = new Date();
  return store.all('lessons_progress').filter(p => p.next_review && new Date(p.next_review) <= now);
}

/** Рівень за навичками: з останнього тесту на рівень + сигнали розмов */
export function skillLevels() {
  const prof = store.prof();
  const out = { grammar: null, vocabulary: null, listening: null, speaking: null, ...(prof.skills || {}) };
  const signals = store.all('tutor_chats').filter(c => c.summary?.level_signal).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  if (signals.length) {
    const order = ['A2', 'B1', 'B2', 'C1'];
    const avg = signals.reduce((a, c) => a + Math.max(0, order.indexOf(c.summary.level_signal)), 0) / signals.length;
    out.speaking = order[Math.round(avg)];
  }
  return out;
}

// ---------- Видалення розмови разом із її статистикою ----------
/**
 * Прибирає розмову, її час/XP (сесії з ref = id) і помилки з її підсумку:
 * помилка, створена цією розмовою, видаляється; додана до наявної — зменшує лічильник.
 */
export function deleteChat(id) {
  const chat = store.get('tutor_chats', id);
  if (!chat) return;
  let sessions = store.all('sessions').filter(s => s.ref === id);
  if (!sessions.length) {
    // старі розмови без прив'язки: та сама дата і тривалість
    const day = dayKey(chat.created_at);
    const s = store.all('sessions').find(x => !x.ref && ['tutor', 'voice', 'writing'].includes(x.type) && x.day === day && Math.abs((x.seconds || 0) - (chat.seconds || 0)) <= 2);
    if (s) sessions = [s];
  }
  for (const s of sessions) store.remove('sessions', s.id);
  const list = chat.summary?.mistakes || chat.summary?.corrections || [];
  for (const m of list) {
    const ex = store.all('mistakes').find(x => norm(x.wrong) === norm(m.wrong) && norm(x.right) === norm(m.right));
    if (!ex) continue;
    if ((ex.count || 1) > 1) { ex.count -= 1; store.put('mistakes', ex); }
    else if (!ex.ref || ex.ref === id) store.remove('mistakes', ex.id);
  }
  store.remove('tutor_chats', id);
}
