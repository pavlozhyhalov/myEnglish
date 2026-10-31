// Активність (час), стрік, помилки — похідні дані зі сховища
import * as store from './store.js';

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
export function activityTimer(type) {
  let acc = 0, total = 0, last = Date.now(), lastInput = Date.now(), stopped = false, ref = null;
  const saved = [];   // id проміжних записів — щоб проставити їм ref (видалення розмови прибирає весь її час)
  const tick = () => {
    const now = Date.now();
    if (!document.hidden && now - lastInput < 120000) acc += now - last;
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
  const mark = () => { tick(); lastInput = Date.now(); };
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
  store.remove('tutor_chats', id);
}
