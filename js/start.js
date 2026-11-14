// Знайомство й перший тиждень (2026-11-14, власник: «Роби все»; дані: нові учні весь перший день проводять у повному тесті,
// з вчителем говорять 3–9 хв, ім'я вказав 1 з 4, нагадування — 2 з 4).
//   • «Знайомство» (#/welcome, js/pages/welcome.js) — коли показувати: welcomeMode(), welcomeRedirect() (з js/app.js перед першим рендером);
//     позначка — profiles.data.onboarded = { at, v: 1, short?, partial? }.
//   • «Старт» — 7 днів по одній дії на день: startPlan() (картка на головній замість «Сьогодні»), profiles.data.start = { from, done: { N: true }, finished? }.
//   • Пігулка «Нове» в меню для розділів, яких ще не відкривали (перші 14 днів після знайомства): markVisited()/newMenuKeys(), localStorage['me:visited'].
//   • Пропозиції за ціллю: goalPicks() — цілі з profiles.data.goalTags (або about.goals).
import * as store from './store.js';
import { today } from './stats.js';
import { myLevel, nextLessonByLevel, filterByLevel, pickOfDay, byFit, LEVELS } from './level.js';
import { grammarIndex, scenarios as loadScenarios, json } from './data.js';

// ---------- Цілі ----------
// tag — машинний список profiles.data.goalTags; about — ключ, який уже читають профіль і сервер (GOALS у js/pages/profile.js, GOALS_EN у _shared/prompts.ts)
export const GOAL_OPTIONS = [
  { tag: 'travel', about: 'travel', label: 'Подорожі', icon: 'airplane-tilt' },
  { tag: 'work', about: 'work', label: 'Робота', icon: 'briefcase' },
  { tag: 'relocation', about: 'moving', label: 'Переїзд за кордон', icon: 'buildings' },
  { tag: 'media', about: 'media', label: 'Фільми й книги', icon: 'books' },
  { tag: 'social', about: 'people', label: 'Спілкування з людьми', icon: 'users' },
  { tag: 'exam', about: 'exam', label: 'Іспит чи сертифікат', icon: 'graduation-cap' },
];
const TAG_OF_ABOUT = Object.fromEntries(GOAL_OPTIONS.map(g => [g.about, g.tag]));

/** Цілі учня (машинні мітки): goalTags зі «Знайомства» або ключі з профілю */
export function goalTags() {
  const p = store.prof();
  if (Array.isArray(p.goalTags) && p.goalTags.length) return p.goalTags.filter(t => GOAL_OPTIONS.some(g => g.tag === t));
  return (Array.isArray(p.about?.goals) ? p.about.goals : []).map(k => TAG_OF_ABOUT[k]).filter(Boolean);
}

/** Зберегти цілі: about.goals (решту ключів профілю — «Допомога дітям», «Саморозвиток» — не чіпаємо) + goalTags; «Робота» вмикає професійний контекст */
export function saveGoals(tags) {
  const p = store.prof();
  const about = { ...(p.about || {}) };
  const ours = new Set(GOAL_OPTIONS.map(g => g.about));
  const keep = (Array.isArray(about.goals) ? about.goals : []).filter(k => !ours.has(k));
  about.goals = [...keep, ...GOAL_OPTIONS.filter(g => tags.includes(g.tag)).map(g => g.about)];
  store.setProf({ about, goalTags: GOAL_OPTIONS.filter(g => tags.includes(g.tag)).map(g => g.tag) });
  if (tags.includes('work') && !store.settings().workFocus) store.setSetting('workFocus', true);
}

// ---------- Знайомство: кому й коли ----------
/** Чи є в учня вже якась історія (тоді — коротке знайомство: лише ім'я й цілі) */
export function hasActivity() {
  const p = store.prof();
  return store.count('sessions') > 0 || store.count('tutor_chats') > 0 || store.count('tests') > 0 || store.count('reviews') > 0
    || !!p.placementDone || !!p.levelSource;
}

/** null — нічого не показувати; 'full' — новий учень; 'short' — є історія, але немає імені чи цілей */
export function welcomeMode() {
  const p = store.prof();
  if (p.onboarded) return null;
  if (!hasActivity()) return 'full';
  const a = p.about || {};
  if (String(a.name || '').trim() && goalTags().length) {
    // усе вже відомо — знайомство не потрібне
    markOnboarded({ short: true, skipped: true });
    return null;
  }
  return 'short';
}

export function markOnboarded(extra = {}) {
  const cur = store.prof().onboarded;
  if (cur && !cur.partial) return;
  store.setProf({ onboarded: { at: cur?.at || new Date().toISOString(), v: 1, ...extra } });
}

/** Перший тиждень починається з дня знайомства (лише для нових учнів) */
export function beginStart() {
  if (!store.prof().start) store.setProf({ start: { from: today(), done: {} } });
}

/**
 * Перенаправлення на «Знайомство» — один раз, лише з головної (глибокі посилання не перебиваємо).
 * Учень увійшов, а локальних даних ще немає (новий пристрій) — вирішуємо після першої синхронізації: профіль може вже мати onboarded.
 */
export function welcomeRedirect(isLoggedIn) {
  const onHome = () => /^#?\/?(home)?(\?.*)?$/.test(location.hash || '');
  const go = () => {
    const mode = welcomeMode();
    if (!mode || !onHome()) return;
    location.hash = mode === 'short' ? '#/welcome?short=1' : '#/welcome';
  };
  const decideLater = () => {
    const off = store.on((t) => { if (t !== 'synced') return; off(); go(); });
  };
  if (store.prof().onboarded) return;
  // після входу — лише після першої синхронізації: профіль на сервері може вже мати onboarded, а запис профілю до синхронізації
  // (markOnboarded у welcomeMode) перезаписав би серверний профіль застарілою локальною копією (профіль синхронізується цілим)
  if (isLoggedIn && !store.syncedOnce()) { decideLater(); return; }
  go();
  // гість увійшов пізніше — на іншому пристрої знайомство могло вже бути; рішення після синхронізації
  if (!isLoggedIn) decideLater();
}

// ---------- «Нове» в меню ----------
const VISITED = 'me:visited';
const readVisited = () => { try { return JSON.parse(localStorage.getItem(VISITED) || '{}') || {}; } catch { return {}; } };
export function visitedAt(key) { return readVisited()[key] || null; }
export function markVisited(key) {
  if (!key) return false;
  const v = readVisited();
  if (v[key]) return false;
  v[key] = new Date().toISOString();
  try { localStorage.setItem(VISITED, JSON.stringify(v)); } catch { /* приватний режим */ }
  return true;
}
// порядок: що найкорисніше відкрити новому учневі; ціль піднімає свої розділи вгору
const NEW_ORDER = ['voice', 'words', 'grammar', 'scenarios', 'listenread', 'phrases', 'games', 'write', 'pron', 'fluency', 'mistakes', 'tests', 'stats'];
const GOAL_MENU = { travel: ['phrases', 'scenarios'], work: ['scenarios', 'write'], relocation: ['scenarios', 'phrases'], media: ['listenread'], social: ['voice', 'fluency'], exam: ['tests', 'grammar'] };
/** Пункти меню з пігулкою «Нове»: перші 14 днів після знайомства, до 3 одночасно (щоб меню не рябіло) */
export function newMenuKeys(max = 3) {
  const ob = store.prof().onboarded;
  if (!ob?.at || ob.short || Date.now() - Date.parse(ob.at) > 14 * 864e5) return new Set();
  const v = readVisited();
  const boost = goalTags().flatMap(t => GOAL_MENU[t] || []);
  const order = [...new Set([...boost, ...NEW_ORDER])];
  return new Set(order.filter(k => !v[k]).slice(0, max));
}

// ---------- «Старт»: 7 днів ----------
const midnight = (key, plus = 0) => { const d = new Date(`${key}T00:00:00`); d.setDate(d.getDate() + plus); return d.toISOString(); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);

/** День «Старту» (1–7) або 0, якщо тиждень скінчився, завершений чи не починався */
export function startDay() {
  const s = store.prof().start;
  if (!s?.from || s.finished) return 0;
  const n = daysBetween(s.from, today()) + 1;
  if (n < 1 || n > 7) return 0;
  if (Object.keys(s.done || {}).length >= 7) return 0;
  return n;
}
function markDay(n) {
  const s = store.prof().start;
  if (!s || s.done?.[n]) return;
  store.setProf({ start: { ...s, done: { ...(s.done || {}), [n]: true } } });
}
export function finishStart() {
  const s = store.prof().start;
  if (!s) return;
  store.setProf({ start: { ...s, done: { ...(s.done || {}), 7: true }, finished: new Date().toISOString() } });
}

const VOICE_TOPIC = 'First lesson, about 3 minutes: get to know the student. Ask them to tell you about themselves — name, where they live, work or study, why they learn English. One short question at a time; warm and encouraging; adapt to their level.';
export const firstTalkHref = () => `#/tutor?mode=voice&topic=${encodeURIComponent(VOICE_TOPIC)}&label=${encodeURIComponent('Розкажіть про себе')}`;

/** Підсумок з дня знайомства: хвилини, нові слова, закриті помилки, розмови */
export function startTotals(from = store.prof().start?.from) {
  if (!from) return { minutes: 0, words: 0, closed: 0, talks: 0 };
  const iso = midnight(from);
  const minutes = Math.round(store.all('sessions').filter(s => (s.day || '') >= from).reduce((a, s) => a + (s.seconds || 0), 0) / 60);
  const words = new Set(store.all('reviews').filter(r => (r.ts || '') >= iso && !r.state).map(r => r.card_id)).size;
  const closed = store.all('mistakes').filter(m => m.resolved && (m.updated_at || '') >= iso).length;
  const talks = store.all('tutor_chats').filter(c => (c.created_at || '') >= iso && ['voice', 'chat', 'scenario'].includes(c.mode) && (c.messages?.some?.(m => m.role === 'user') || c.summary)).length;
  return { minutes, words, closed, talks };
}

/**
 * План дня «Старту»: { day, title, sub, steps: [{ id, title, icon, href, done, minutes }], next, done, days: [bool×7] }.
 * Кроки визначаються за даними (розмова, слова, урок…) з дня знайомства; виконаний день позначається в profiles.data.start.done.
 */
export async function startPlan() {
  const n = startDay();
  if (!n) return null;
  const s = store.prof().start;
  const from = s.from, fromIso = midnight(from), dayIso = midnight(from, n - 1);
  const chats = store.all('tutor_chats').filter(c => (c.created_at || '') >= fromIso);
  const spoke = (c) => c.messages?.some?.(m => m.role === 'user') || !!c.summary || (c.seconds || 0) > 30;
  const secs = (type) => store.all('sessions').filter(x => x.type === type && (x.day || '') >= from).reduce((a, x) => a + (x.seconds || 0), 0);
  const newWords = new Set(store.all('reviews').filter(r => (r.ts || '') >= fromIso && !r.state).map(r => r.card_id)).size;
  const reviewsToday = store.all('reviews').filter(r => (r.ts || '') >= dayIso).length;
  const lvl = myLevel();
  let steps = [], title = '', sub = '';

  if (n === 1) {
    title = 'Знайомство з вчителем';
    sub = '3 хвилини розмови й перші слова';
    steps = [
      { id: 'talk', title: 'Розмова', icon: 'microphone', href: firstTalkHref(), minutes: 3, done: chats.some(c => ['voice', 'chat'].includes(c.mode) && spoke(c)) },
      { id: 'words', title: 'Перші 5 слів', icon: 'cards', href: '#/cards/train?daily=1', minutes: 3, done: newWords >= 5 },
    ];
  } else if (n === 2) {
    title = 'Слова, що запам\'ятаються';
    sub = 'Повторіть учорашні слова — так вони переходять у довгу пам\'ять';
    steps = [{ id: 'cards', title: 'Повторити слова', icon: 'cards', href: '#/cards/train?daily=1', minutes: 5, done: reviewsToday >= 5 }];
    const remind = await reminderStep();
    if (remind) steps.push(remind);
  } else if (n === 3) {
    const idx = await grammarIndex().catch(() => []);
    const l = nextLessonByLevel(idx);
    title = 'Перший урок граматики';
    sub = l ? `${l.title} · ${l.level}` : `Урок рівня ${lvl}`;
    steps = [{ id: 'lesson', title: 'Урок', icon: 'puzzle-piece', href: l ? `#/grammar/${l.id}` : '#/grammar', minutes: 7,
      done: store.all('lessons_progress').some(p => (p.completed_at || '') >= fromIso) }];
  } else if (n === 4) {
    const open = store.all('mistakes').filter(m => !m.resolved).length;
    if (open) {
      title = 'Ваші помилки з розмов';
      sub = 'Вчитель зібрав їх за правилами — закрийте перші';
      const seen = visitedAt('mistakes');
      steps = [{ id: 'mistakes', title: 'Мої помилки', icon: 'warning-circle', href: '#/mistakes?practice=due', minutes: 5, done: !!seen && seen >= dayIso }];
    } else {
      title = 'Кілька речень про ваш день';
      sub = 'Вчитель виправить помилки — з них почнеться ваш список';
      steps = [{ id: 'diary', title: 'Щоденник', icon: 'notebook', href: '#/diary', minutes: 5, done: chats.some(c => c.mode === 'diary') }];
    }
  } else if (n === 5) {
    const pick = await readingPick();
    title = 'Читання для задоволення';
    sub = pick ? `${pick.title} · ${pick.level}` : 'Текст вашого рівня';
    steps = [{ id: 'read', title: 'Читати', icon: 'book-open', href: pick?.href || '#/reading', minutes: 7, done: secs('reading') >= 120 }];
  } else if (n === 6) {
    const sc = await scenarioPick();
    title = 'Гра й живий сценарій';
    sub = sc ? `Сценарій: ${sc.title}` : 'Слова в грі, фрази — у ситуації';
    steps = [
      { id: 'game', title: 'Гра', icon: 'game-controller', href: '#/games', minutes: 3, done: secs('game') >= 60 },
      { id: 'scenario', title: sc ? sc.title : 'Сценарій', icon: 'users-three', href: sc ? `#/scenarios/${sc.id}` : '#/scenarios', minutes: 5, done: chats.some(c => c.scenario && spoke(c)) },
    ];
  } else {
    title = 'Ваш перший тиждень';
    sub = 'Підсумок і що далі';
    steps = [{ id: 'summary', title: 'Підсумок', icon: 'trophy', href: '#/progress', minutes: 1, done: !!s.done?.[7] }];
  }
  // розмова й сценарій — після входу: без акаунта крок веде на вхід, а головною дією стає те, що можна зробити зараз
  const { user } = await import('./supa.js');
  if (!user()) for (const x of steps) if (!x.done && ['talk', 'scenario'].includes(x.id)) Object.assign(x, { login: true, href: '#/auth?tab=up' });
  const allDone = steps.every(x => x.done);
  if (allDone && n < 7) markDay(n);
  const done = { ...(store.prof().start?.done || {}) };
  return {
    day: n, title, sub, steps, done: allDone,
    next: steps.find(x => !x.done && !x.login) || steps.find(x => !x.done) || null,
    days: Array.from({ length: 7 }, (_, i) => !!done[i + 1]),
    totals: n === 7 ? startTotals(from) : null,
  };
}

/** Крок «Нагадування»: лише після входу й де Web Push працює; уже ввімкнено — виконано */
async function reminderStep() {
  const { user } = await import('./supa.js');
  if (!user()) return null;
  try {
    const P = await import('./push.js');
    const st = P.pushSupport();
    if (st === 'unsupported' || st === 'ios-old') return null;
    return { id: 'remind', title: 'Нагадування', icon: 'bell', href: '#/settings', minutes: 0, remind: st, done: await P.remindersOn() };
  } catch { return null; }
}

/** Читання дня 5: «Фільми й книги» — книга з бібліотеки; інакше коротке оповідання класики свого рівня (A1 — текст з «Читання») */
async function readingPick() {
  const lvl = myLevel();
  try {
    if (goalTags().includes('media')) {
      const books = await json('data/books/index.json');
      const b = byFit(books)[0];
      if (b && Math.abs(LEVELS.indexOf(b.level) - LEVELS.indexOf(lvl)) <= 1) return { title: b.titleUk || b.title, level: b.level, href: `#/reading/${b.id}` };
    }
    const stories = await json('data/stories/index.json');
    const mine = filterByLevel(stories, 'mine').items.sort((a, b) => (a.words || 0) - (b.words || 0));
    const st = mine[0];
    if (st && Math.abs(LEVELS.indexOf(st.level) - LEVELS.indexOf(lvl)) <= 1) return { title: st.titleUk || st.title, level: st.level, href: `#/reading/${st.id}` };
    const texts = await json('data/reading.json');
    const t = pickOfDay(filterByLevel(Array.isArray(texts) ? texts : texts.items || [], 'mine').items, 'start');
    return t ? { title: t.title, level: t.level, href: `#/reading/${t.id}` } : null;
  } catch { return null; }
}

// сценарії за ціллю (id з data/scenarios.json)
const GOAL_SCEN = {
  travel: ['airport', 'hotel', 'taxi', 'train-ticket', 'hostel', 'directions', 'ask-way', 'lost-luggage', 'hotel-problem', 'formal-complaint'],
  relocation: ['doctor', 'bank', 'flat', 'pharmacy', 'kindergarten', 'negotiate-rent', 'neighbour', 'phone-call', 'parking-fine'],
  work: ['interview', 'phone-call', 'supplier-delay', 'presentation-qna'],
  social: ['introduce', 'party', 'dinner-invite', 'my-family', 'new-hobby', 'cafe-simple'],
};
async function scenarioPick(goal = null) {
  const all = await loadScenarios().catch(() => []);
  const list = Array.isArray(all) ? all : all.items || [];
  const ids = goal ? GOAL_SCEN[goal] : goalTags().flatMap(t => GOAL_SCEN[t] || []);
  const pool = ids?.length ? list.filter(x => ids.includes(x.id)) : list.filter(x => x.group !== 'work');
  return pickOfDay(filterByLevel(pool.length ? pool : list.filter(x => x.group !== 'work'), 'mine').items, `start${goal || ''}`);
}

// ---------- Пропозиції за ціллю ----------
const SOCIAL_TOPIC = 'Small talk with a new acquaintance: introduce yourselves, ask about hobbies, plans for the weekend, favourite places. Natural, friendly, one question at a time.';
const WORK_TOPIC = 'The student\'s work: their job, tasks, colleagues and a typical working day. Natural conversation.';

/**
 * До 3 пропозицій під цілі учня: { icon, label, sub, href }. По черзі з кожної цілі (щоб не все з однієї), без повторів.
 * Порожньо — цілей немає (тоді група на головній не показується).
 */
export async function goalPicks(max = 3) {
  const tags = goalTags();
  if (!tags.length) return [];
  const lvl = myLevel();
  const by = {};
  for (const t of tags) {
    const out = [];
    if (t === 'travel') {
      const sc = await scenarioPick('travel');
      if (sc) out.push({ icon: 'airplane-tilt', label: sc.title, sub: 'Сценарій для подорожі', href: `#/scenarios/${sc.id}` });
      out.push({ icon: 'quotes', label: 'Фрази для подорожей', sub: 'Фразник · транспорт і готель', href: '#/phrases/travel' });
    } else if (t === 'relocation') {
      const sc = await scenarioPick('relocation');
      if (sc) out.push({ icon: 'buildings', label: sc.title, sub: 'Сценарій: життя за кордоном', href: `#/scenarios/${sc.id}` });
      out.push({ icon: 'quotes', label: 'Банк, пошта, документи', sub: 'Фразник', href: '#/phrases/office' });
    } else if (t === 'work') {
      const sc = await scenarioPick('work');
      if (sc) out.push({ icon: 'briefcase', label: sc.title, sub: 'Робочий сценарій', href: `#/scenarios/${sc.id}` });
      out.push({ icon: 'microphone', label: 'Поговорити про роботу', sub: 'Голосом з вчителем', href: `#/tutor?mode=voice&topic=${encodeURIComponent(WORK_TOPIC)}&label=${encodeURIComponent('Робота')}` });
    } else if (t === 'media') {
      out.push({ icon: 'books', label: 'Бібліотека', sub: 'Книги й оповідання вашого рівня', href: '#/reading/library' });
      out.push({ icon: 'headphones', label: 'Аудіювання', sub: `Діалоги рівня ${lvl}`, href: '#/listening' });
    } else if (t === 'exam') {
      out.push({ icon: 'exam', label: 'Тест за уроком', sub: 'Перевірити граматику', href: '#/tests/lesson' });
      out.push({ icon: 'puzzle-piece', label: 'Граматика', sub: `Уроки рівня ${lvl}`, href: '#/grammar' });
    } else if (t === 'social') {
      out.push({ icon: 'users', label: 'Знайомство й small talk', sub: 'Голосом з вчителем', href: `#/tutor?mode=voice&topic=${encodeURIComponent(SOCIAL_TOPIC)}&label=${encodeURIComponent('Small talk')}` });
      const sc = await scenarioPick('social');
      if (sc) out.push({ icon: 'users-three', label: sc.title, sub: 'Сценарій', href: `#/scenarios/${sc.id}` });
    }
    by[t] = out;
  }
  const picks = [], seen = new Set();
  for (let i = 0; picks.length < max && i < 3; i++) {
    for (const t of tags) {
      const p = by[t]?.[i];
      if (p && !seen.has(p.href) && picks.length < max) { seen.add(p.href); picks.push(p); }
    }
  }
  return picks;
}


