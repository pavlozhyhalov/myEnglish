// Аналіз навчання: чисті обчислення зі сховища (без DOM і без AI) + компактне зведення (digest) для вчителя.
// Сторінка «Аналіз» (js/pages/analysis.js) малює це, «Консультація» (режим вчителя 'coach') надсилає digest.
import * as store from './store.js';
import { deckIndex, grammarIndex, scenarios as loadScenarios } from './data.js';
import { streak, lessonsToReview, MISTAKE_TYPES, dayKey, secondsByDay } from './stats.js';
import { LEVELS, myLevel, nextLevel, levelProgress, nextLessonByLevel, byFit } from './level.js';
import { confidence as catConfidence } from './placement.js';

const DAY = 864e5;
const ACTIVE_DAY_SEC = 5 * 60;
const rk = (l) => LEVELS.indexOf(l);
const t = (iso) => (iso ? Date.parse(iso) || 0 : 0);
const round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a, b) => (b ? Math.round(a / b * 100) : null);
const noon = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
const shiftKey = (days, from = new Date()) => { const d = noon(from); d.setDate(d.getDate() + days); return dayKey(d); };
const wordsIn = (s) => (String(s || '').match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;

/** Розділи аналізу (і консультації): id → назва */
export const SECTIONS = {
  overview: 'Загальний прогрес',
  placement: 'Рівень за навичками',
  speaking: 'Говоріння',
  writing: 'Письмо',
  vocabulary: 'Слова',
  grammar: 'Граматика',
  mistakes: 'Помилки',
  habits: 'Звички й час',
};
export const CRIT = ['range', 'accuracy', 'fluency', 'interaction', 'coherence'];
export const CRIT_UK = { range: 'Словник і граматика', accuracy: 'Точність', fluency: 'Плавність', interaction: 'Взаємодія', coherence: 'Зв\'язність' };
export const SKILL_UK = { grammar: 'Граматика', vocabulary: 'Лексика', reading: 'Читання', listening: 'Аудіювання', writing: 'Письмо', speaking: 'Говоріння' };

// ---------- Окремі частини (кожна — чиста функція від сховища й каталогів) ----------

/** Останній тест на рівень: рівень і впевненість для кожної навички */
export function placementPart(now = Date.now()) {
  const last = store.all('tests').filter(x => x.type === 'placement' && x.scores).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!last) return null;
  const est = {};
  for (const d of Array.isArray(last.details) ? last.details : []) {
    if (d && typeof d.key === 'string' && d.key.startsWith('est:') && d.key !== 'est:overall' && Number.isFinite(d.theta)) est[d.key.slice(4)] = d;
  }
  const skills = {};
  for (const k of Object.keys(SKILL_UK)) {
    const lv = last.scores[k];
    if (!LEVELS.includes(lv)) continue;
    const e = est[k];
    let conf = null, n = null;
    if (e && Number.isFinite(e.se)) { const c = catConfidence(e.theta, e.se); conf = c.sure ? 'впевнено' : c.label; n = e.n ?? null; }
    else if (k === 'writing') conf = 'за текстом';
    else if (k === 'speaking') conf = 'за розмовою';
    skills[k] = { level: lv, conf, n };
  }
  const days = Math.floor((now - t(last.created_at)) / DAY);
  return { at: last.created_at, days, overall: last.scores.overall || last.scores.level || null, level: last.scores.level || null, skills };
}

/** Розмови з оцінкою рівня (лише достатньо мовлення) — критерії CEFR у часі */
/**
 * Рівень у розмовах — ковзна зважена оцінка за останніми 10 розмовами (а не одна коротка розмова):
 * вага = обсяг власного мовлення (слова, насичення на ~250) × упевненість оцінки × свіжість (0,85 за кожну старішу розмову);
 * замало мовлення (enough_data=false) — вага 0,15. Підрівень: low −0,3, high +0,3. Упевненість — з сумарної ваги й розкиду.
 */
const SUB_OFF = { low: -0.3, mid: 0, high: 0.3 };
const CONF_W = { low: 0.4, medium: 0.7, high: 1 };
const studentWords = (c) => Number(c.summary?.speech?.words) || (c.messages || []).filter(m => m.role === 'user' && !m.hidden)
  .reduce((n, m) => n + (String(m.text || '').match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length, 0);
export function conversationLevel(chats = null, crit = null) {
  const list = (chats || store.all('tutor_chats').filter(c => !c.deleted && !['diary', 'check', 'coach'].includes(c.mode) && c.summary?.level_assessment && LEVELS.includes(c.summary.level_signal)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  let wsum = 0, xsum = 0, n = 0;
  const xs = [];
  list.forEach((c, k) => {
    const a = c.summary.level_assessment;
    const lvl = crit ? (a.criteria || []).find(x => x?.name === crit)?.level : c.summary.level_signal;
    if (!LEVELS.includes(lvl)) return;
    const x = rk(lvl) + (crit ? 0 : (SUB_OFF[a.sublevel] || 0));
    const w = Math.min(1, studentWords(c) / 250) * (a.enough_data === false ? 0.15 : (CONF_W[a.confidence] || 0.6)) * 0.85 ** k;
    if (w <= 0) return;
    wsum += w; xsum += w * x; n++; xs.push([x, w]);
  });
  if (!wsum) return null;
  const mean = xsum / wsum;
  const sd = Math.sqrt(xs.reduce((acc, [x, w]) => acc + w * (x - mean) ** 2, 0) / wsum);
  const i = Math.max(0, Math.min(LEVELS.length - 1, Math.round(mean)));
  const frac = mean - i;
  return {
    level: LEVELS[i], sublevel: frac <= -0.15 ? 'low' : frac >= 0.15 ? 'high' : 'mid', value: Math.round(mean * 100) / 100, sessions: n,
    confidence: wsum >= 2.5 && sd <= 0.5 ? 'high' : wsum >= 1 && sd <= 0.8 ? 'medium' : 'low',
  };
}

export function speakingPart() {
  const chats = store.all('tutor_chats')
    .filter(c => !['diary', 'check', 'coach'].includes(c.mode) && c.summary?.level_assessment && LEVELS.includes(c.summary.level_signal))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const ok = chats.filter(c => c.summary.level_assessment.enough_data !== false);
  const sessions = ok.slice(-8).map(c => {
    const a = c.summary.level_assessment;
    const crit = {};
    for (const x of Array.isArray(a.criteria) ? a.criteria : []) if (CRIT.includes(x?.name) && LEVELS.includes(x.level)) crit[x.name] = x.level;
    return { at: c.created_at, mode: c.mode === 'voice' ? 'voice' : 'text', level: c.summary.level_signal, sublevel: a.sublevel || null, confidence: a.confidence || null, crit };
  });
  // тренд критерію: середнє останніх 3 сесій проти 3 попередніх (лише коли є хоча б 4 сесії з цим критерієм)
  const trend = {};
  for (const k of CRIT) {
    const xs = ok.map(c => (c.summary.level_assessment.criteria || []).find(x => x?.name === k)?.level).filter(l => LEVELS.includes(l)).map(rk);
    if (!xs.length) continue;
    const last3 = xs.slice(-3), prev3 = xs.slice(-6, -3);
    trend[k] = { now: LEVELS[Math.round(avg(last3))], delta: prev3.length && xs.length >= 4 ? round(avg(last3) - avg(prev3), 1) : null, n: xs.length };
  }
  const reasons = ok.slice(-5).reverse().map(c => (c.summary.level_assessment.reasons_uk || [])[0]).filter(Boolean).slice(0, 5);
  const levels = ok.map(c => rk(c.summary.level_signal));
  return {
    total: chats.length, enough: ok.length, insufficient: chats.length - ok.length,
    current: conversationLevel()?.level || (levels.length ? LEVELS[Math.round(avg(levels.slice(-5)))] : null),
    rolling: conversationLevel(),
    sessions, trend, reasons,
    toNext: ok.length ? ok[ok.length - 1].summary.level_assessment.to_next_uk || '' : '',
  };
}

/** Письмо: перевірки текстів (оцінки 0–10) і щоденник (помилок на 100 слів) */
export function writingPart(now = Date.now()) {
  const checks = store.all('tutor_chats').filter(c => c.mode === 'check' && c.summary?.scores).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const keys = ['grammar', 'vocabulary', 'tone', 'structure'];
  const mean = (list) => { const o = {}; for (const k of keys) { const v = avg(list.map(c => Number(c.summary.scores[k])).filter(Number.isFinite)); if (v != null) o[k] = round(v, 1); } return Object.keys(o).length ? o : null; };
  const diary = store.all('tutor_chats').filter(c => c.mode === 'diary' && c.summary?.checked).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const rate = (list) => {
    const w = list.reduce((a, c) => a + wordsIn(c.summary.entry), 0);
    const m = list.reduce((a, c) => a + (c.summary.mistakes || []).length, 0);
    return w >= 30 ? round(m / w * 100, 1) : null;
  };
  const recent = diary.filter(c => now - t(c.created_at) < 30 * DAY);
  const prior = diary.filter(c => now - t(c.created_at) >= 30 * DAY);
  return {
    checks: checks.length,
    scores: mean(checks.slice(-5)), scoresPrev: checks.length > 5 ? mean(checks.slice(-10, -5)) : null,
    diary: diary.length,
    diaryWords: diary.length ? Math.round(avg(diary.map(c => wordsIn(c.summary.entry)))) : null,
    errPer100: rate(recent.length ? recent : diary), errPer100Prev: recent.length && prior.length ? rate(prior) : null,
  };
}

/** Слова: стан FSRS, утримання, закріплені слова за рівнями, слабкі слова */
export function vocabPart(deckIdx = [], now = Date.now()) {
  const cards = store.all('cards').filter(c => c.reps > 0);
  const deckLevel = Object.fromEntries(deckIdx.map(d => [d.id, d.level]));
  const deckGroup = Object.fromEntries(deckIdx.map(d => [d.id, d.group]));
  const ivl = (c) => Number.isFinite(c.scheduled_days) ? c.scheduled_days : (c.stability || 0);
  const learning = cards.filter(c => c.state === 1 || c.state === 3).length;
  const review = cards.filter(c => c.state === 2).length;
  const mature = cards.filter(c => ivl(c) >= 21).length;
  const solid = cards.filter(c => ivl(c) >= 7);
  // до повторення — як у черзі карток (srs.dueCards): лише з увімкнених колод, інакше кнопка «Повторити N» обіцяє більше, ніж покаже
  const deckDefault = Object.fromEntries(deckIdx.map(d => [d.id, d.default !== false]));
  const deckOn = (id) => { const r = store.get('decks', id); return r ? !!r.enabled : deckDefault[id] ?? true; };
  const due = cards.filter(c => c.due && t(c.due) <= now && deckOn(c.deck_id)).length;
  // утримання: лише повтори вже вивчених карток (стан Review до оцінки), «Знову» = забули
  const revs = store.all('reviews').filter(r => r.state === 2 && r.ts);
  const win = (from, to) => { const xs = revs.filter(r => { const d = now - t(r.ts); return d >= from * DAY && d < to * DAY; }); return { n: xs.length, pct: xs.length ? pct(xs.filter(r => r.rating !== 1).length, xs.length) : null }; };
  const ret = win(0, 30), retPrev = win(30, 60);
  const all30 = store.all('reviews').filter(r => r.ts && now - t(r.ts) < 30 * DAY).length;
  // закріплені слова (інтервал ≥ 7 дн.) за рівнем колоди; «Мої слова» і робочі колоди — окремо
  const totals = {}, known = {};
  for (const d of deckIdx) if (d.group !== 'work' && LEVELS.includes(d.level)) totals[d.level] = (totals[d.level] || 0) + (d.count || 0);
  const seen = new Set();
  let own = 0, work = 0;
  for (const c of solid) {
    const k = String(c.en || '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const lv = deckLevel[c.deck_id];
    if (deckGroup[c.deck_id] === 'work') work++;
    else if (LEVELS.includes(lv)) known[lv] = (known[lv] || 0) + 1;
    else own++;
  }
  const byLevel = LEVELS.filter(l => totals[l]).map(l => ({ level: l, known: known[l] || 0, total: totals[l] }));
  const weak = cards.filter(c => (c.lapses || 0) >= 2).sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || t(b.last_review) - t(a.last_review)).slice(0, 8)
    .map(c => ({ en: c.en, uk: c.uk, lapses: c.lapses }));
  return { inWork: cards.length, learning, review, mature, solid: seen.size, due, ret, retPrev, reviews30: all30, byLevel, own, work, weak };
}

/** Граматика: уроки за рівнями, бали, повторення, слабкі уроки, кандидати для плану */
export function grammarPart(gIdx = []) {
  const prog = (id) => store.get('lessons_progress', id);
  const byLevel = LEVELS.map(l => {
    const ls = gIdx.filter(x => x.level === l);
    return { level: l, done: ls.filter(x => prog(x.id)?.completed_at).length, total: ls.length };
  }).filter(x => x.total);
  const tried = store.all('lessons_progress').filter(p => p.attempts > 0);
  const title = Object.fromEntries(gIdx.map(x => [x.id, x]));
  const low = tried.filter(p => (p.best || 0) < 80 && title[p.id]).sort((a, b) => (a.best || 0) - (b.best || 0)).slice(0, 5)
    .map(p => ({ id: p.id, title: title[p.id].title, level: title[p.id].level, best: p.best || 0, attempts: p.attempts }));
  const due = lessonsToReview().filter(p => title[p.id]).map(p => ({ id: p.id, title: title[p.id].title, level: title[p.id].level }));
  const tests = store.all('tests');
  const sc = (type) => { const xs = tests.filter(x => x.type === type && Number.isFinite(x.scores?.score)).map(x => x.scores.score); return xs.length ? { n: xs.length, avg: Math.round(avg(xs)) } : null; };
  const next = gIdx.length ? nextLessonByLevel(gIdx) : null;
  return {
    byLevel, tried: tried.length,
    avgBest: tried.length ? Math.round(avg(tried.map(p => p.best || 0))) : null,
    avgLast: tried.length ? Math.round(avg(tried.map(p => p.last_score ?? p.best ?? 0))) : null,
    low, due, next: next ? { id: next.id, title: next.title, level: next.level } : null,
    lessonTests: sc('lesson'), weeklyTests: sc('weekly'),
  };
}

/** Помилки: типи з трендом (14 днів проти попередніх 14), повторювані, частка виправлених */
export function mistakesPart(now = Date.now()) {
  const ms = store.all('mistakes');
  const born = (m) => t(m.created_at || m.updated_at);
  const types = MISTAKE_TYPES.map(type => {
    const xs = ms.filter(m => (MISTAKE_TYPES.includes(m.type) ? m.type : 'other') === type);
    return {
      type, total: xs.reduce((a, m) => a + (m.count || 1), 0), items: xs.length, open: xs.filter(m => !m.resolved).length,
      openTotal: xs.filter(m => !m.resolved).reduce((a, m) => a + (m.count || 1), 0),
      last14: xs.filter(m => now - born(m) < 14 * DAY).length,
      prev14: xs.filter(m => { const d = now - born(m); return d >= 14 * DAY && d < 28 * DAY; }).length,
    };
  }).filter(x => x.items).sort((a, b) => b.openTotal - a.openTotal || b.last14 - a.last14 || b.total - a.total);
  const recurring = ms.filter(m => (m.count || 1) >= 3).sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 8)
    .map(m => ({ wrong: m.wrong, right: m.right, type: m.type, count: m.count || 1, resolved: !!m.resolved, explanation_uk: m.explanation_uk || '' }));
  const resolved = ms.filter(m => m.resolved).length;
  const examples = ms.filter(m => !m.resolved).sort((a, b) => born(b) - born(a)).slice(0, 15).map(m => ({ wrong: m.wrong, right: m.right, type: m.type }));
  return {
    total: ms.length, open: ms.length - resolved, resolved, resolvedPct: pct(resolved, ms.length),
    fixed14: ms.filter(m => m.resolved && now - t(m.updated_at) < 14 * DAY).length,
    new14: ms.filter(m => now - born(m) < 14 * DAY).length, newPrev14: ms.filter(m => { const d = now - born(m); return d >= 14 * DAY && d < 28 * DAY; }).length,
    types, recurring, examples,
  };
}

/** Звички: хвилини за 8 тижнів (ковзні 7-денні проміжки), активні дні, час доби, стрік, розподіл занять */
export function habitsPart(now = new Date()) {
  const byDay = secondsByDay();
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    let sec = 0, active = 0;
    for (let d = 0; d < 7; d++) { const s = byDay.get(shiftKey(-(w * 7 + d), now)) || 0; sec += s; if (s >= ACTIVE_DAY_SEC) active++; }
    weeks.push({ from: shiftKey(-(w * 7 + 6), now), to: shiftKey(-w * 7, now), min: Math.round(sec / 60), active });
  }
  const sessions = store.all('sessions');
  const parts = { morning: 0, day: 0, evening: 0, night: 0 };
  const cut30 = shiftKey(-29, now);
  const byType = {};
  for (const s of sessions) {
    if (!s.ts || s.day < shiftKey(-55, now)) continue;
    const hr = new Date(s.ts).getHours();
    parts[hr >= 5 && hr < 12 ? 'morning' : hr >= 12 && hr < 17 ? 'day' : hr >= 17 && hr < 23 ? 'evening' : 'night'] += s.seconds || 0;
    if (s.day >= cut30) byType[s.type] = (byType[s.type] || 0) + (s.seconds || 0);
  }
  const totalParts = Object.values(parts).reduce((a, b) => a + b, 0);
  const best = totalParts >= 30 * 60 ? Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0] : null;
  const last4 = weeks.slice(-4);
  const activeDays = [...byDay.entries()].filter(([, s]) => s >= ACTIVE_DAY_SEC).length;
  return {
    weeks, streak: streak(), goal: store.settings().dailyGoal,
    activePerWeek: round(avg(last4.map(w => w.active)), 1), min4w: last4.reduce((a, w) => a + w.min, 0),
    timeOfDay: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v / 60)])), best,
    byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / 60)])),
    activeDays, totalMin: Math.round(sessions.reduce((a, s) => a + (s.seconds || 0), 0) / 60),
  };
}

export function readingPart() {
  const r = store.prof().reading || {};
  const xs = Object.values(r).filter(x => x && typeof x === 'object');
  return { texts: xs.length, avgBest: xs.length ? Math.round(avg(xs.map(x => Number(x.best) || 0))) : null };
}

// ---------- Мовлення в голосових розмовах (summary.speech: темп, довжина реплік, повтори, різноманітність) ----------
const MIN_SPEECH_WORDS = 20;   // коротші сесії — шум (кілька реплік), у динаміку не йдуть
const fin = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
/** Частка (0…1 або 0…100) → відсоток */
const ratioPct = (x) => { const n = fin(x); return n == null || n < 0 ? null : Math.round(n <= 1 ? n * 100 : Math.min(100, n)); };
export const SPEECH_KEYS = ['wpm', 'avgLen', 'rep100', 'fill100', 'unique'];

/** Голосові розмови з виміряним мовленням (у порядку дат); filter — напр. лише за місяць */
export function speechSessions(filter = null) {
  return store.all('tutor_chats')
    .filter(c => c.mode === 'voice' && c.summary?.speech && (fin(c.summary.speech.words) || 0) >= MIN_SPEECH_WORDS && (!filter || filter(c)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(c => {
      const s = c.summary.speech, w = fin(s.words);
      return {
        id: c.id, at: c.created_at, words: w, sec: fin(s.speech_sec), turns: fin(s.turns),
        wpm: fin(s.wpm) != null ? Math.round(s.wpm) : null,
        avgLen: fin(s.avg_len) != null ? round(s.avg_len, 1) : null,
        rep100: fin(s.repeats) != null ? round(s.repeats / w * 100, 1) : null,
        fill100: fin(s.fillers) != null ? round(s.fillers / w * 100, 1) : null,
        unique: ratioPct(s.unique_ratio),
      };
    });
}

/**
 * Динаміка мовлення: середнє перших сесій (до 3, не більше половини) проти останньої сесії.
 * Менше 2 сесій — лише остання (first = null).
 */
export function speechPart(list = speechSessions()) {
  const n = list.length;
  const mean = (xs) => {
    const o = {};
    for (const k of SPEECH_KEYS) { const v = avg(xs.map(x => x[k]).filter(v => v != null)); o[k] = v == null ? null : k === 'wpm' || k === 'unique' ? Math.round(v) : round(v, 1); }
    return o;
  };
  const k = Math.min(3, Math.max(1, Math.floor(n / 2)));
  return {
    n, sessions: list, firstN: k,
    first: n >= 2 ? mean(list.slice(0, k)) : null,
    latest: n ? mean([list[n - 1]]) : null,
    words: list.reduce((a, s) => a + (s.words || 0), 0),
  };
}

const fmtN = (x) => String(x).replace('.', ',');
/** Висновки простими словами: «Темп зріс з 62 до 78 слів/хв». a — було, b — зараз */
export function speechLines(a, b) {
  if (!a || !b) return [];
  const out = [];
  const ch = (k, minAbs, minRel = 0) => {
    if (a[k] == null || b[k] == null) return 0;
    const d = b[k] - a[k];
    if (Math.abs(d) < minAbs || (a[k] && Math.abs(d / a[k]) < minRel)) return 0;
    return Math.sign(d);
  };
  const w = ch('wpm', 3, 0.05);
  if (a.wpm != null && b.wpm != null) out.push(w > 0 ? `Темп зріс з ${a.wpm} до ${b.wpm} слів/хв.` : w < 0 ? `Темп знизився з ${a.wpm} до ${b.wpm} слів/хв — це нормально, коли теми стають складнішими.` : `Темп стабільний — близько ${b.wpm} слів/хв.`);
  const l = ch('avgLen', 0.5, 0.08);
  if (l) out.push(l > 0 ? `Репліки довшають: з ${fmtN(a.avgLen)} до ${fmtN(b.avgLen)} ${pluralF(b.avgLen, 'слова', 'слів', 'слів', 'слова')} в середньому — ви говорите розгорнутіше.`
    : `Репліки коротшають: з ${fmtN(a.avgLen)} до ${fmtN(b.avgLen)} ${pluralF(b.avgLen, 'слова', 'слів', 'слів', 'слова')}. Спробуйте додавати «because…», «for example…».`);
  const r = ch('rep100', 0.5, 0.15);
  if (r) out.push(r < 0 ? `Повторів і самовиправлень менше: ${fmtN(a.rep100)} → ${fmtN(b.rep100)} на 100 слів — мовлення плавніше.`
    : `Повторів більше: ${fmtN(a.rep100)} → ${fmtN(b.rep100)} на 100 слів. Говоріть трохи повільніше, але без зупинок.`);
  const f = ch('fill100', 0.5, 0.15);
  if (f) out.push(f < 0 ? `Заповнювачів пауз (um, uh) менше: ${fmtN(a.fill100)} → ${fmtN(b.fill100)} на 100 слів.` : `Заповнювачів пауз (um, uh) більше: ${fmtN(a.fill100)} → ${fmtN(b.fill100)} на 100 слів.`);
  const u = ch('unique', 3);
  if (u) out.push(u > 0 ? `Словник різноманітніший: ${a.unique}% → ${b.unique}% різних слів.` : `Різних слів менше: ${a.unique}% → ${b.unique}%. Пробуйте синоніми замість повторів того самого слова.`);
  return out;
}

// ---------- Звіт за місяць ----------
export const MONTH_UK = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
/** «у жовтні» */
export const MONTH_IN = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'];
/** «за жовтень» */
export const MONTH_ACC = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
export const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);
export const isMonthKey = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function shiftMonth(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 15, 12); return monthKey(d); }
export const monthTitle = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTH_UK[m - 1]} ${y}`; };
const monthOf = (iso) => (iso ? dayKey(new Date(iso)).slice(0, 7) : '');

/** Місяці з будь-якими даними (час, розмови, помилки, повтори) + поточний; від нових до старих */
export function reportMonths() {
  const set = new Set([monthKey()]);
  for (const s of store.all('sessions')) if (s.day && (s.seconds || 0) > 0) set.add(s.day.slice(0, 7));
  for (const c of store.all('tutor_chats')) if (c.created_at) set.add(monthOf(c.created_at));
  for (const m of store.all('mistakes')) if (m.created_at) set.add(monthOf(m.created_at));
  for (const r of store.all('reviews')) if (r.ts) set.add(monthOf(r.ts));
  return [...set].filter(isMonthKey).sort().reverse();
}

const CRIT_LEVELS = (a) => { const o = {}; for (const x of Array.isArray(a?.criteria) ? a.criteria : []) if (CRIT.includes(x?.name) && LEVELS.includes(x.level)) o[x.name] = x.level; return o; };

/** Усе для звіту за місяць ym ('2026-11'); deckIdx — каталог колод (для «закріплено зараз») */
export function monthPart(ym, deckIdx = [], now = new Date()) {
  const [y, m] = ym.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const cur = ym === monthKey(now), future = ym > monthKey(now);
  const todayK = dayKey(now);
  // час: по днях місяця
  const byDay = new Map();
  for (const s of store.all('sessions')) if (s.day?.startsWith(ym)) byDay.set(s.day, (byDay.get(s.day) || 0) + (s.seconds || 0));
  const days = Array.from({ length: nDays }, (_, i) => { const k = `${ym}-${String(i + 1).padStart(2, '0')}`; return { key: k, day: i + 1, sec: byDay.get(k) || 0, future: k > todayK }; });
  let run = 0, bestRun = 0;
  for (const d of days) { if (d.sec >= ACTIVE_DAY_SEC) { run++; bestRun = Math.max(bestRun, run); } else run = 0; }
  const seconds = days.reduce((a, d) => a + d.sec, 0);
  const prevYm = shiftMonth(ym, -1);
  // поточний місяць порівнюємо з тими самими днями минулого (1…сьогодні), інакше — з усім минулим місяцем
  const cutDay = cur ? `${prevYm}-${String(now.getDate()).padStart(2, '0')}` : `${prevYm}-31`;
  const prevSec = store.all('sessions').filter(s => s.day?.startsWith(prevYm) && s.day <= cutDay).reduce((a, s) => a + (s.seconds || 0), 0);
  const byType = {};
  for (const s of store.all('sessions')) if (s.day?.startsWith(ym)) byType[s.type] = (byType[s.type] || 0) + (s.seconds || 0);
  // розмови
  const chats = store.all('tutor_chats').filter(c => monthOf(c.created_at) === ym).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const voice = chats.filter(c => c.mode === 'voice');
  const text = chats.filter(c => ['chat', 'scenario', 'drill'].includes(c.mode));
  // рівень у розмовах: перша й остання оцінка місяця (лише з достатнім мовленням)
  const assessed = chats.filter(c => !['diary', 'check', 'coach'].includes(c.mode) && LEVELS.includes(c.summary?.level_signal) && c.summary?.level_assessment && c.summary.level_assessment.enough_data !== false)
    .map(c => ({ at: c.created_at, mode: c.mode === 'voice' ? 'voice' : 'text', level: c.summary.level_signal, sublevel: c.summary.level_assessment.sublevel || null, crit: CRIT_LEVELS(c.summary.level_assessment) }));
  // мовлення
  const speech = speechPart(speechSessions(c => monthOf(c.created_at) === ym));
  // помилки
  const ms = store.all('mistakes');
  const born = ms.filter(x => monthOf(x.created_at || x.updated_at) === ym);
  const closed = ms.filter(x => x.resolved && monthOf(x.updated_at) === ym);
  const open = ms.filter(x => !x.resolved && x.wrong && x.right).sort((a, b) => (b.count || 1) - (a.count || 1) || (a.streak || 0) - (b.streak || 0) || t(b.updated_at) - t(a.updated_at));
  // слова: нові (перший показ — повтор зі стану New), усі повтори; «закріплено» — лише станом на зараз
  const revs = store.all('reviews').filter(r => monthOf(r.ts) === ym);
  const started = new Set(revs.filter(r => r.state === 0).map(r => r.card_id)).size;
  const oldReviews = (now - new Date(y, m, 1)) > 110 * DAY;   // повтори старші ~120 днів на пристрої не зберігаються
  return {
    ym, title: monthTitle(ym), monthIdx: m - 1, cur, future, nDays,
    seconds, prevSec, prevYm, days, activeDays: days.filter(d => d.sec >= ACTIVE_DAY_SEC).length, bestRun,
    byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / 60)])),
    voice: voice.length, voiceSec: voice.reduce((a, c) => a + (c.seconds || 0), 0), text: text.length,
    diary: chats.filter(c => c.mode === 'diary').length, checks: chats.filter(c => c.mode === 'check').length,
    level: { n: assessed.length, first: assessed[0] || null, last: assessed.length > 1 ? assessed[assessed.length - 1] : null },
    speech,
    mistakes: { added: born.length, closed: closed.length, open: open.length, top: open.slice(0, 3).map(x => ({ id: x.id, wrong: x.wrong, right: x.right, type: x.type, count: x.count || 1, streak: x.streak || 0 })) },
    words: { reviews: revs.length, started, oldReviews, solidNow: cur ? vocabPart(deckIdx, now.getTime()).solid : null },
  };
}

/** Записи голосу учня (summary.clip) — від найстарішого до найновішого */
export function voiceClips() {
  return store.all('tutor_chats')
    .filter(c => c.summary?.clip && typeof c.summary.clip.path === 'string' && c.summary.clip.path)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(c => ({ id: c.id, at: c.created_at, path: c.summary.clip.path, text: String(c.summary.clip.text || ''), sec: fin(c.summary.clip.sec) }));
}

/** Повний локальний аналіз (вантажить лише каталоги: індекс колод, граматики, сценарії) */
export async function compute() {
  const [deckIdx, gIdx, scen] = await Promise.all([deckIndex().catch(() => []), grammarIndex().catch(() => []), loadScenarios().catch(() => [])]);
  const lp = gIdx.length ? await levelProgress(gIdx).catch(() => null) : null;
  const level = myLevel();
  const prof = store.prof();
  return {
    at: new Date().toISOString(), level, next: nextLevel(level), levelSource: prof.levelSource || null, lp,
    placement: placementPart(), speaking: speakingPart(), writing: writingPart(), vocab: vocabPart(deckIdx),
    grammar: grammarPart(gIdx), mistakes: mistakesPart(), habits: habitsPart(), reading: readingPart(), speech: speechPart(),
    scenarios: byFit(scen.filter(s => s.group !== 'work' || store.settings().workFocus)).slice(0, 6).map(s => ({ id: s.id, title: s.title, level: s.level })),
  };
}

// ---------- Висновки одним рядком (чесні: без даних — що зробити, щоб вони з'явилися) ----------
const TYPE_UK = { articles: 'артиклі', tenses: 'часи', prepositions: 'прийменники', word_order: 'порядок слів', vocabulary: 'лексика', pronunciation: 'вимова', other: 'інше' };
const plural = (n, a, b, c) => { const x = Math.abs(n) % 100, y = x % 10; return x > 10 && x < 20 ? c : y > 1 && y < 5 ? b : y === 1 ? a : c; };
/** Дробове число → родовий однини («2,5 помилки», «1,5 дня»), ціле — звичайні форми */
const pluralF = (n, a, b, c, frac) => (Number.isInteger(n) ? plural(n, a, b, c) : frac);
const lvSpread = (skills) => { const ls = Object.values(skills).map(s => rk(s.level)); return ls.length ? Math.max(...ls) - Math.min(...ls) : 0; };

export function insight(section, A) {
  switch (section) {
    case 'placement': {
      const p = A.placement;
      if (!p) return 'Тесту на рівень ще не було — пройдіть його (~25 хв), щоб побачити рівень кожної навички окремо.';
      const sk = Object.entries(p.skills);
      if (!sk.length) return 'Тест збережено без оцінок навичок — пройдіть його ще раз.';
      const lo = sk.reduce((a, b) => (rk(b[1].level) < rk(a[1].level) ? b : a));
      const hi = sk.reduce((a, b) => (rk(b[1].level) > rk(a[1].level) ? b : a));
      const old = p.days > 60 ? ` Тест був ${p.days} ${plural(p.days, 'день', 'дні', 'днів')} тому — варто перевірити рівень знову.` : '';
      if (lvSpread(p.skills) === 0) return `Усі навички на рівні ${lo[1].level} — профіль рівний.${old}`;
      return `Найсильніша навичка — ${SKILL_UK[hi[0]].toLowerCase()} (${hi[1].level}), найслабша — ${SKILL_UK[lo[0]].toLowerCase()} (${lo[1].level}): саме вона стримує загальний рівень.${old}`;
    }
    case 'speaking': {
      const s = A.speaking;
      if (!s.enough) return s.insufficient
        ? `Розмов із вчителем: ${s.total}, але в жодній не було достатньо мовлення для оцінки. Говоріть довше — хоча б 40–50 слів за розмову.`
        : 'Оцінок говоріння ще немає. Поговоріть із вчителем текстом або голосом 10–15 хвилин — після підсумку з\'явиться оцінка за критеріями CEFR.';
      const tr = Object.entries(s.trend).filter(([, v]) => v.delta != null);
      const up = tr.filter(([, v]) => v.delta >= 0.5).map(([k]) => CRIT_UK[k].toLowerCase());
      const down = tr.filter(([, v]) => v.delta <= -0.5).map(([k]) => CRIT_UK[k].toLowerCase());
      const weakest = Object.entries(s.trend).sort((a, b) => rk(a[1].now) - rk(b[1].now))[0];
      const parts = [`За оцінками ${s.enough} ${plural(s.enough, 'розмови', 'розмов', 'розмов')} ваше говоріння зараз — близько ${s.current}.`];
      if (up.length) parts.push(`Покращилось: ${up.join(', ')}.`);
      if (down.length) parts.push(`Просіло: ${down.join(', ')}.`);
      if (weakest && rk(weakest[1].now) < rk(s.current)) parts.push(`Найслабший критерій — ${CRIT_UK[weakest[0]].toLowerCase()} (${weakest[1].now}).`);
      if (s.enough < 4) parts.push('Оцінка попередня: для тренду потрібно щонайменше 4 розмови.');
      return parts.join(' ');
    }
    case 'writing': {
      const w = A.writing;
      if (!w.checks && !w.diary) return 'Даних про письмо ще немає. Напишіть запис у щоденнику або перевірте текст у вчителя — з\'явиться статистика помилок.';
      const parts = [];
      if (w.errPer100 != null) parts.push(`У щоденнику в середньому ${String(w.errPer100).replace('.', ',')} ${pluralF(w.errPer100, 'помилка', 'помилки', 'помилок', 'помилки')} на 100 слів${w.errPer100Prev != null ? (w.errPer100 < w.errPer100Prev ? ` — менше, ніж раніше (${String(w.errPer100Prev).replace('.', ',')})` : w.errPer100 > w.errPer100Prev ? ` — більше, ніж раніше (${String(w.errPer100Prev).replace('.', ',')})` : '') : ''}.`);
      else if (w.diary) parts.push(`Записів у щоденнику: ${w.diary} — замало тексту, щоб рахувати помилки на 100 слів.`);
      if (w.scores) { const lo = Object.entries(w.scores).sort((a, b) => a[1] - b[1])[0]; parts.push(`У перевірених текстах найнижча оцінка — ${({ grammar: 'граматика', vocabulary: 'лексика', tone: 'тон', structure: 'структура' })[lo[0]]} (${String(lo[1]).replace('.', ',')}/10).`); }
      return parts.join(' ');
    }
    case 'vocabulary': {
      const v = A.vocab;
      if (!v.inWork) return 'Ви ще не вчили карток. Почніть із 10 нових слів на день — за тиждень тут з\'явиться статистика запам\'ятовування.';
      const parts = [`У роботі ${v.inWork} ${plural(v.inWork, 'слово', 'слова', 'слів')}, міцно запам\'ятовано (інтервал ≥ 21 дн.) — ${v.mature}.`];
      if (v.ret.n >= 20) {
        parts.push(`Утримання за 30 днів — ${v.ret.pct}%${v.ret.pct < 80 ? ': забуваєте забагато — менше нових слів і щоденні повтори' : v.ret.pct > 95 ? ': можна додавати більше нових слів' : ' — у нормі'}.`);
      } else parts.push(`Для оцінки утримання замало повторів (${v.ret.n} з потрібних 20).`);
      if (v.due > 30) parts.push(`Накопичилось ${v.due} повторів — почніть із них.`);
      return parts.join(' ');
    }
    case 'grammar': {
      const g = A.grammar;
      const mine = g.byLevel.find(x => x.level === A.level);
      if (!g.tried) return `Уроків граматики ще не пройдено. Почніть з уроку свого рівня${g.next ? ` — «${g.next.title}»` : ''}.`;
      const parts = [];
      if (mine) parts.push(`Рівень ${A.level}: пройдено ${mine.done} з ${mine.total} уроків.`);
      const gaps = g.byLevel.filter(x => rk(x.level) < rk(A.level) && x.done < x.total);
      if (gaps.length) parts.push(`Прогалини нижче: ${gaps.map(x => `${x.level} — ${x.total - x.done}`).join(', ')}.`);
      if (g.low.length) parts.push(`Найслабший урок — «${g.low[0].title}» (${g.low[0].best}%).`);
      if (g.due.length) parts.push(`На повторення: ${g.due.length}.`);
      return parts.join(' ');
    }
    case 'mistakes': {
      const m = A.mistakes;
      if (!m.total) return 'Помилок ще не зібрано. Вони з\'являться з розмов, щоденника і вправ — і тут буде видно, що повторюється.';
      // слабка зона — тип з найбільшою кількістю НЕвиправлених помилок (з повторами)
      const top = m.types[0]?.openTotal ? m.types[0] : null;
      const parts = [];
      if (!top) parts.push('Відкритих помилок немає — усі зібрані помилки виправлено.');
      if (top) {
        const tr = top.last14 > top.prev14 ? 'частіше, ніж два тижні до того' : top.last14 < top.prev14 ? 'рідше, ніж два тижні до того' : top.last14 ? 'так само, як раніше' : '';
        parts.push(`Ваша слабка зона — ${TYPE_UK[top.type]}: ${top.openTotal} ${plural(top.openTotal, 'невиправлена помилка', 'невиправлені помилки', 'невиправлених помилок')} (з повторами), ${top.last14} нових за 2 тижні${tr ? ` — ${tr}` : ''}.`);
      }
      if (m.recurring.length) parts.push(`Повторюються ${m.recurring.length} ${plural(m.recurring.length, 'помилка', 'помилки', 'помилок')} (3+ рази).`);
      parts.push(`Виправлено ${m.resolvedPct}% (${m.resolved} з ${m.total}).`);
      return parts.join(' ');
    }
    case 'speech': {
      const sp = A.speech;
      if (!sp?.n) return 'Поговоріть із вчителем голосом 2–3 рази — тут з\'явиться ваш темп мовлення, довжина реплік і плавність.';
      if (sp.n < 2) return `Є одна виміряна голосова розмова: ${sp.latest.wpm ?? '—'} слів/хв. Поговоріть голосом ще 1–2 рази, щоб побачити динаміку.`;
      const ls = speechLines(sp.first, sp.latest);
      return [`Порівняння: ${sp.firstN === 1 ? 'перша розмова' : `перші ${sp.firstN} розмови`} проти останньої.`, ...ls.slice(0, 2)].join(' ');
    }
    case 'habits': {
      const hb = A.habits;
      if (!hb.totalMin) return 'Занять ще не записано. Навіть 10–15 хвилин щодня дають більше, ніж година раз на тиждень.';
      const w = hb.weeks, cur = w[w.length - 1].min, prev = w[w.length - 2].min;
      const parts = [`Останні 7 днів — ${cur} хв${prev || cur ? (cur > prev ? `, більше ніж тижнем раніше (${prev})` : cur < prev ? `, менше ніж тижнем раніше (${prev})` : '') : ''}; у середньому ${String(hb.activePerWeek).replace('.', ',')} ${pluralF(hb.activePerWeek, 'активний день', 'активні дні', 'активних днів', 'активного дня')} на тиждень.`];
      if (hb.activePerWeek < 4) parts.push('Для стабільного прогресу потрібно 5+ днів на тиждень — регулярність важливіша за тривалість.');
      if (hb.best) parts.push(`Найчастіше ви вчитеся ${({ morning: 'вранці', day: 'вдень', evening: 'ввечері', night: 'вночі' })[hb.best]}.`);
      return parts.join(' ');
    }
    default: return '';
  }
}

// ---------- Компактне зведення для вчителя (≤ 6 КБ, без розмов — лише числа і короткі приклади) ----------
const cutS = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const DIGEST_MAX = 6000;
/** Метрики мовлення для вчителя: зрозумілі назви ключів (сервер пропускає лише [a-z0-9_]) */
const speechDigest = (x) => ({ words_per_min: x.wpm, avg_turn_words: x.avgLen, repeats_per_100_words: x.rep100, fillers_per_100_words: x.fill100, unique_words_pct: x.unique });

export function digest(A, section = 'overview') {
  const d = {
    v: 1, today: dayKey(), section: SECTIONS[section] ? section : 'overview',
    level: { current: A.level, next: A.next, source: A.levelSource, mastery_pct: A.lp?.pct ?? null, lessons_done: A.lp ? `${A.lp.grammar.done}/${A.lp.grammar.total}` : null, words_done: A.lp ? `${A.lp.words.done}/${A.lp.words.total}` : null },
    placement: A.placement ? { days_ago: A.placement.days, overall: A.placement.overall, skills: Object.fromEntries(Object.entries(A.placement.skills).map(([k, s]) => [k, { level: s.level, confidence: s.conf || null }])) } : null,
    speaking: {
      assessed: A.speaking.enough, too_short: A.speaking.insufficient, current: A.speaking.current,
      criteria: Object.fromEntries(Object.entries(A.speaking.trend).map(([k, v]) => [k, { level: v.now, change: v.delta, n: v.n }])),
      recent: A.speaking.sessions.slice(-6).map(s => ({ date: s.at?.slice(0, 10), level: s.level, sublevel: s.sublevel, confidence: s.confidence })),
      reasons: A.speaking.reasons.map(r => cutS(r, 220)), to_next: cutS(A.speaking.toNext, 220),
    },
    speech: A.speech?.n ? {
      voice_sessions: A.speech.n, compare: A.speech.first ? `first ${A.speech.firstN} sessions avg vs latest session` : 'latest session only',
      first_avg: A.speech.first ? speechDigest(A.speech.first) : null, latest: speechDigest(A.speech.latest),
      wpm_by_session: A.speech.sessions.slice(-8).map(s => s.wpm), avg_turn_words_by_session: A.speech.sessions.slice(-8).map(s => s.avgLen),
    } : null,
    writing: { text_checks: A.writing.checks, scores_0_10: A.writing.scores, scores_prev: A.writing.scoresPrev, diary_entries: A.writing.diary, diary_avg_words: A.writing.diaryWords, errors_per_100_words: A.writing.errPer100, errors_per_100_prev: A.writing.errPer100Prev },
    vocabulary: {
      in_work: A.vocab.inWork, learning: A.vocab.learning, review: A.vocab.review, mature_21d: A.vocab.mature, solid_7d: A.vocab.solid, due_now: A.vocab.due,
      retention_30d_pct: A.vocab.ret.pct, retention_reviews: A.vocab.ret.n, retention_prev_30d_pct: A.vocab.retPrev.pct, reviews_30d: A.vocab.reviews30,
      solid_by_level: Object.fromEntries(A.vocab.byLevel.map(x => [x.level, `${x.known}/${x.total}`])), own_words_solid: A.vocab.own,
      weak_words: A.vocab.weak.slice(0, 6).map(w => ({ en: cutS(w.en, 40), lapses: w.lapses })),
    },
    grammar: {
      by_level: Object.fromEntries(A.grammar.byLevel.map(x => [x.level, `${x.done}/${x.total}`])), lessons_tried: A.grammar.tried, avg_best: A.grammar.avgBest, avg_last: A.grammar.avgLast,
      weak_lessons: A.grammar.low.map(x => ({ id: x.id, title: cutS(x.title, 60), level: x.level, best: x.best })), due_review: A.grammar.due.slice(0, 5).map(x => ({ id: x.id, title: cutS(x.title, 60) })),
      next_lesson: A.grammar.next, lesson_tests: A.grammar.lessonTests, weekly_tests: A.grammar.weeklyTests,
    },
    mistakes: {
      total: A.mistakes.total, open: A.mistakes.open, resolved_pct: A.mistakes.resolvedPct, new_14d: A.mistakes.new14, new_prev_14d: A.mistakes.newPrev14, fixed_14d: A.mistakes.fixed14,
      by_type: A.mistakes.types.map(x => ({ type: x.type, total: x.total, open: x.open, open_with_repeats: x.openTotal, last_14d: x.last14, prev_14d: x.prev14 })),
      recurring: A.mistakes.recurring.map(x => ({ wrong: cutS(x.wrong, 80), right: cutS(x.right, 80), type: x.type, count: x.count })),
      examples: A.mistakes.examples.map(x => ({ wrong: cutS(x.wrong, 80), right: cutS(x.right, 80), type: x.type })),
    },
    habits: { minutes_by_week: A.habits.weeks.map(w => w.min), active_days_by_week: A.habits.weeks.map(w => w.active), active_days_per_week_4w: A.habits.activePerWeek, streak_days: A.habits.streak, daily_goal_min: A.habits.goal, best_time: A.habits.best, minutes_by_activity_30d: A.habits.byType, total_minutes: A.habits.totalMin },
    reading: { texts_read: A.reading.texts, avg_score: A.reading.avgBest },
    scenarios: A.scenarios.map(s => ({ id: s.id, title: cutS(s.title, 50), level: s.level })),
  };
  // розмір: спершу скорочуємо приклади, далі — менш важливі списки
  const trims = [() => { d.mistakes.examples = d.mistakes.examples.slice(0, 8); }, () => { d.speaking.reasons = d.speaking.reasons.slice(0, 2); }, () => { d.scenarios = d.scenarios.slice(0, 3); d.vocabulary.weak_words = d.vocabulary.weak_words.slice(0, 3); },
    () => { if (d.speech) { delete d.speech.wpm_by_session; delete d.speech.avg_turn_words_by_session; } },
    () => { d.mistakes.examples = []; d.mistakes.recurring = d.mistakes.recurring.slice(0, 4); }, () => { d.speaking.recent = d.speaking.recent.slice(-3); d.grammar.weak_lessons = d.grammar.weak_lessons.slice(0, 2); d.grammar.due_review = []; }];
  for (const fn of trims) { if (JSON.stringify(d).length <= DIGEST_MAX) break; fn(); }
  return d;
}

/** Хеш зведення (без дати й розділу): чи змінилися дані з минулого глибокого аналізу */
export function digestHash(d) {
  const { today: _t, section: _s, ...rest } = d;
  const s = JSON.stringify(rest);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

// ---------- Посилання плану: лише з білого списку (сервер повертає kind + id) ----------
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const ACTIVITY = {
  cards_review: { href: () => '#/cards/review', label: 'Картки: повторення', icon: 'cards' },
  cards_new: { href: () => '#/cards', label: 'Картки: нові слова', icon: 'cards' },
  grammar_lesson: { href: (id, ctx) => (id && ctx.lessons.has(id) ? `#/grammar/${id}` : '#/grammar'), label: 'Урок граматики', icon: 'puzzle-piece' },
  grammar_practice: { href: () => '#/exercises/grammar', label: 'Вправи з граматики', icon: 'lightning' },
  drill: { href: (id) => (MISTAKE_TYPES.includes(id) ? `#/tutor?mode=drill&type=${id}` : '#/tutor?mode=drill'), label: 'Міні-урок на слабке місце', icon: 'target' },
  mistakes: { href: () => '#/mistakes', label: 'Мої помилки', icon: 'warning-circle' },
  reading: { href: (id, ctx) => (id && ctx.reading?.has(id) ? `#/reading/${id}` : '#/reading'), label: 'Читання', icon: 'book-open' },
  listening: { href: () => '#/listening', label: 'Аудіювання', icon: 'headphones' },
  pronunciation: { href: () => '#/pronunciation', label: 'Вимова', icon: 'waveform' },
  writing: { href: () => '#/writing', label: 'Письмо', icon: 'pencil-line' },
  diary: { href: () => '#/diary', label: 'Щоденник', icon: 'notebook' },
  scenario: { href: (id, ctx) => (id && ctx.scenarios.has(id) ? `#/scenarios/${id}` : '#/scenarios'), label: 'Сценарій', icon: 'users-three' },
  tutor_chat: { href: () => '#/tutor?mode=chat', label: 'Розмова з вчителем', icon: 'chat-circle-dots' },
  voice: { href: () => '#/tutor?mode=voice', label: 'Голосова розмова', icon: 'microphone' },
  placement_test: { href: () => '#/tests/placement', label: 'Тест на рівень', icon: 'exam' },
};
/** Безпечне посилання на дію плану: невідомий kind → null; невідомий id → загальна сторінка розділу */
export function activityHref(kind, id, ctx = { lessons: new Set(), scenarios: new Set() }) {
  const a = Object.prototype.hasOwnProperty.call(ACTIVITY, kind) ? ACTIVITY[kind] : null;
  if (!a) return null;
  const safe = typeof id === 'string' && ID.test(id) ? id : '';
  return a.href(safe, ctx);
}
