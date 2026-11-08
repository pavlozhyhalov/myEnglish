// Старт застосунку: тема, авторизація, шапка, маршрути, синхронізація, service worker
import { BUILD } from './config.js';
import { S, plural } from './strings.js';
import * as store from './store.js';
import { h, ic, emo } from './ui/dom.js';
import { initDrawer, toggle as toggleDrawer, setActive as drawerActive, renderProfile } from './ui/drawer.js';
import { initQuickbar, setActive as qbActive } from './ui/quickbar.js';
import { toast } from './ui/toast.js';
import { route, fallback, onRoute, start, go } from './router.js';
import { sectionFor, menuItemOf, tabsetOf } from './nav.js';
import { initAuth, onAuth, onClient, recoveryPending, user as authUser } from './supa.js';
import { initErrlog } from './errlog.js';
import { streak, backfillLessonTests } from './stats.js';
import { setTitle, applyTheme } from './ui/shell.js';
import { keepAwake } from './ui/wakelock.js';
import { initSelectLookup } from './ui/selectlookup.js';
import { initDailyBar } from './ui/dailybar.js';
import { initSubnav, updateSubnav } from './ui/subnav.js';

// ---------- Режим клавіатури: рамка фокусу видима лише після Tab/стрілок ----------
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Enter у полі відповіді (вправи, диктант) переводить фокус на «Далі» — рамка має бути видима
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '');
  if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key) || (e.key === 'Enter' && typing)) document.documentElement.classList.add('kbd');
}, true);
addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);

// Тема — лише в «Налаштуваннях» (2026-11-08: шапка без дублів)

// ---------- Шапка ----------
function header() {
  const streakBtn = h('a.streak-chip', { href: '#/progress' });
  const updateStreak = () => {
    const n = streak();
    streakBtn.replaceChildren(ic('fire', { size: 20, fill: true }), h('span.num', String(n)));
    streakBtn.setAttribute('aria-label', S.streak(n));
    // нульовий стрік не показуємо — шапка без «0»
    streakBtn.hidden = n < 1;
  };
  updateStreak();
  store.on(t => { if (t === 'sessions') updateStreak(); if (t === 'synced') { try { backfillLessonTests(); } catch (e) { console.warn('tests backfill', e); } usedWordsLater(); } });
  // слова, які учень уживає в розмовах, — «вивчено» (раз на 6 год; після синхронізації розмов з інших пристроїв)
  function usedWordsLater() {
    const run = () => import('./usage.js').then(m => m.backgroundMarkUsed()).then(list => {
      if (list?.length) toast(`Вчитель позначив вивченими ${list.length} ${plural(list.length, 'слово', 'слова', 'слів')}, які ви вже вживаєте в розмовах: ${list.slice(0, 3).map(u => u.en).join(', ')}${list.length > 3 ? '…' : ''}`, { ms: 6000, action: 'Переглянути', onAction: () => { location.hash = '#/vocab'; } });
    }).catch(e => console.warn('used words', e));
    ('requestIdleCallback' in window) ? requestIdleCallback(run, { timeout: 8000 }) : setTimeout(run, 3000);
  }
  try { backfillLessonTests(); } catch (e) { console.warn('tests backfill', e); }
  const el = h('header.app-header',
    h('button.icon-btn.btn-menu', { type: 'button', 'aria-label': S.menu, 'aria-controls': 'drawer', onclick: toggleDrawer }, ic('list')),
    h('div.title#page-title', S.app),
    h('div.right', streakBtn));
  // посилання «Перейти до змісту» лишається першим у Tab-порядку
  const skip = document.querySelector('body > .sr-only');
  if (skip) skip.after(el); else document.body.prepend(el);
}

// ---------- Маршрути ----------
const pages = {
  home: () => import('./pages/home.js'),
  today: () => import('./pages/today.js'),
  phrases: () => import('./pages/phrases.js'),
  tutor: () => import('./pages/tutor.js'),
  cards: () => import('./pages/cards.js'),
  vocab: () => import('./pages/vocab.js'),
  grammar: () => import('./pages/grammar.js'),
  listening: () => import('./pages/listening.js'),
  reading: () => import('./pages/reading.js'),
  pronunciation: () => import('./pages/pronunciation.js'),
  writing: () => import('./pages/writing.js'),
  scenarios: () => import('./pages/scenarios.js'),
  diary: () => import('./pages/diary.js'),
  tests: () => import('./pages/tests.js'),
  exercises: () => import('./pages/exercises.js'),
  mistakes: () => import('./pages/mistakes.js'),
  progress: () => import('./pages/progress.js'),
  analysis: () => import('./pages/analysis.js'),
  report: () => import('./pages/report.js'),
  settings: () => import('./pages/settings.js'),
  profile: () => import('./pages/profile.js'),
  friends: () => import('./pages/friends.js'),
  session: () => import('./pages/session.js'),
  auth: () => import('./pages/auth.js'),
  lab: () => import('./pages/lab.js'),
  admin: () => import('./pages/admin.js'),
  games: () => import('./pages/games.js'),
  fluency: () => import('./pages/fluency.js'),
};

// Сторінки з завданнями: картки, уроки, вправи, тести, заняття, вчитель, аудіювання, вимова, письмо, сценарії, помилки
const PRACTICE = new Set(['today', 'cards', 'exercises', 'tests', 'session', 'tutor', 'listening', 'pronunciation', 'mistakes', 'lab', 'diary', 'games', 'fluency']);
function isPracticeRoute(r) {
  if (PRACTICE.has(r.name)) return true;
  // урок граматики, конкретне завдання з письма чи сценарій (але не списки)
  return ['grammar', 'writing', 'scenarios', 'reading'].includes(r.name) && r.parts.length > 0;
}

initErrlog();

async function boot() {
  await store.load();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

  header();
  initDrawer();
  initQuickbar();
  initSelectLookup();   // виділення англійських слів → «Що це?»
  initDailyBar();       // плашка «Далі за планом» (Мій день)
  initSubnav();         // вкладки розділів, об'єднаних в один пункт меню
  applyTheme();

  for (const [name, loader] of Object.entries(pages)) route(name, loader);
  fallback((view) => { view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Сторінку не знайдено'), h('a.btn.soft', { href: '#/' }, S.nav.home))); });
  onRoute((r) => {
    const sec = sectionFor(r.path);
    // розділ із вкладками (Картки · Словник…) — у шапці назва пункту меню («Слова»), вкладки під нею
    const grouped = sec && tabsetOf(sec.id) && r.path === (sec.href.replace(/^#/, '').split('?')[0] || '/') ? menuItemOf(sec.id) : null;
    setTitle(r.name === 'home' ? S.app : grouped ? grouped.label : sec ? sec.long : (S.nav[r.name] || S.app));
    drawerActive(sec ? sec.id : '');
    qbActive(sec ? sec.id : r.name);
    document.body.classList.remove('focus-mode');
    updateSubnav(r);
    // екран не гасне на сторінках із завданнями (налаштування «Не вимикати екран під час завдань»)
    keepAwake(store.settings().keepAwake !== false && isPracticeRoute(r));
  });

  // Авторизація і синхронізація
  // клієнт Supabase вантажиться ліниво (js/supa.js); синхронізація — щойно він готовий
  onClient((c) => { store.attachSupabase(c); store.sync().catch(e => console.warn('sync', e)); });
  try { await initAuth(); } catch (e) { console.warn('auth', e); }
  // перейшли за посиланням «змінити пароль» з листа — одразу форма нового пароля
  if (recoveryPending() && authUser() && !location.hash.startsWith('#/auth/reset')) location.hash = '#/auth/reset';
  renderProfile();
  onAuth((s) => {
    renderProfile();
    if (s) { store.sync().then(ok => ok && toast(S.synced)).catch(e => console.warn(e)); }
    else if ('serviceWorker' in navigator) import('./push.js').then(m => m.forgetDevice()).catch(() => {});   // нагадування — лише для акаунта, що увійшов
  });
  window.addEventListener('online', () => { toast(S.online); store.queueSync(300); });
  window.addEventListener('offline', () => toast(S.offline, { ms: 4500 }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) store.queueSync(500); });
  setInterval(() => store.queueSync(0), 5 * 60 * 1000);

  start();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // коли активується нова версія — перезавантажуємо сторінку один раз, щоб показати її
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register(`sw.js?v=${BUILD}`, { updateViaCache: 'none' }).then(reg => {
      // перевіряємо оновлення при кожному поверненні в застосунок
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(e => console.warn('sw', e));
  }
}

boot().catch(e => {
  console.error(e);
  document.getElementById('view').textContent = 'Не вдалося запустити застосунок: ' + e.message;
});

