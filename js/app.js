// Старт застосунку: тема, авторизація, шапка, маршрути, синхронізація, service worker
import { BUILD } from './config.js';
import { S, plural } from './strings.js';
import * as store from './store.js';
import { h, ic, emo } from './ui/dom.js';
import { initDrawer, toggle as toggleDrawer, setActive as drawerActive, renderProfile } from './ui/drawer.js';
import { initQuickbar, setActive as qbActive } from './ui/quickbar.js';
import { toast } from './ui/toast.js';
import { route, fallback, onRoute, start, go, parse } from './router.js';
import { sectionFor, menuItemOf, tabsetOf } from './nav.js';
import { initAuth, onAuth, onClient, recoveryPending, user as authUser } from './supa.js';
import { initErrlog } from './errlog.js';
import { streak, backfillLessonTests, tidyMistakes } from './stats.js';
import { setTitle, applyTheme, isDark } from './ui/shell.js';
import { keepAwake } from './ui/wakelock.js';
import { initSelectLookup } from './ui/selectlookup.js';
import { initDailyBar } from './ui/dailybar.js';
import { initSubnav, updateSubnav } from './ui/subnav.js';
import { deckIndex, grammarIndex, scenarios, listening, json } from './data.js';
import * as srs from './srs.js';

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
  store.on(t => { if (t === 'sessions') updateStreak(); if (t === 'synced') { try { backfillLessonTests(); } catch (e) { console.warn('tests backfill', e); } try { tidyMistakes(); } catch (e) { console.warn('tidy mistakes', e); } reviewLater(); usedWordsLater(); } });
  // повторення пройденого й слабких місць — раз на добу (js/review.js)
  function reviewLater() { import('./review.js').then(m => m.reviewUpkeep()).catch(e => console.warn('review upkeep', e)); }
  // на старті — коли перша сторінка вже показана (не забирає мережу й процесор у першого екрана)
  idle(reviewLater, 3000);
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
    h('div.right',
      // тема одним дотиком (власник 2026-11-13): світла ↔ темна; «Авто» — у «Налаштуваннях»
      h('button.icon-btn.btn-theme', { type: 'button', 'aria-label': 'Змінити тему: світла або темна', onclick: () => {
        const next = isDark() ? 'light' : 'dark';
        store.setSetting('theme', next); applyTheme(next);
        document.querySelectorAll('.set-theme-seg [data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === next)));
      } }, ic(isDark() ? 'sun' : 'moon')),
      streakBtn));
  // посилання «Перейти до змісту» лишається першим у Tab-порядку
  const skip = document.querySelector('body > .sr-only');
  if (skip) skip.after(el); else document.body.prepend(el);
}

// ---------- Маршрути ----------
// назва маршруту → файл js/pages/<файл>.js
const PAGE_FILES = {
  home: 'home',
  today: 'today',
  phrases: 'phrases',
  tutor: 'tutor',
  cards: 'cards',
  vocab: 'vocab',
  grammar: 'grammar',
  listening: 'listening',
  reading: 'reading',
  pronunciation: 'pronunciation',
  writing: 'writing',
  scenarios: 'scenarios',
  diary: 'diary',
  tests: 'tests',
  exercises: 'exercises',
  mistakes: 'mistakes',
  progress: 'progress',
  analysis: 'analysis',
  report: 'report',
  settings: 'settings',
  profile: 'profile',
  friends: 'friends',
  session: 'session',
  auth: 'auth',
  lab: 'lab',
  admin: 'admin',
  games: 'games',
  fluency: 'fluency',
  'listen-go': 'listengo',
};
const pageUrl = (name) => `./pages/${PAGE_FILES[name]}.js`;
const pages = Object.fromEntries(Object.keys(PAGE_FILES).map(n => [n, () => import(pageUrl(n))]));

// Сторінки з завданнями: картки, уроки, вправи, тести, заняття, вчитель, аудіювання, вимова, письмо, сценарії, помилки
const PRACTICE = new Set(['today', 'cards', 'exercises', 'tests', 'session', 'tutor', 'listening', 'pronunciation', 'mistakes', 'lab', 'diary', 'games', 'fluency', 'listen-go']);
function isPracticeRoute(r) {
  if (PRACTICE.has(r.name)) return true;
  // урок граматики, конкретне завдання з письма чи сценарій (але не списки)
  return ['grammar', 'writing', 'scenarios', 'reading'].includes(r.name) && r.parts.length > 0;
}

const idle = (fn, timeout = 2000) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, Math.min(timeout, 1200)));

/**
 * Перша сторінка — без зайвих хвиль запитів: модуль сторінки (і його залежності) качається паралельно з читанням IndexedDB
 * (modulepreload: лише завантаження, без виконання), а дані, які їй потрібні, — до того, як сторінка про них попросить.
 * data.js кешує проміси — сторінка отримає ті самі запити, без повторного завантаження.
 */
function preloadModule(path) {
  const href = new URL(path, import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="modulepreload"]')].some(l => l.href === href)) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', href }));
  }
}
function warmRoute(name) {
  if (PAGE_FILES[name]) preloadModule(pageUrl(name));
  const quiet = (p) => { p?.catch?.(() => {}); };
  quiet(grammarIndex()); quiet(deckIndex());
}
/** Після читання сховища: колоди рівня для плану дня (картка «Сьогодні»), для головної — дані «Завдань дня» */
function warmData(name) {
  if (!['home', 'today', 'cards'].includes(name)) return;
  const quiet = (p) => { p?.catch?.(() => {}); };
  const words = srs.newCards();
  quiet(words);
  if (name !== 'home') return;
  // головна вантажить «Завдання дня» (js/pages/reading.js + дані) і рівень у розмовах (js/analysis.js) — ті самі модулі, лише раніше;
  // дані — після запитів колод (вони потрібні картці «Сьогодні» першими)
  quiet(import('./pages/reading.js')); quiet(import('./analysis.js'));
  deckIndex().catch(() => {}).finally(() => setTimeout(() => { quiet(scenarios()); quiet(listening()); quiet(json('data/reading.json')); }, 0));
}

initErrlog();

async function boot() {
  const first = parse().name;
  warmRoute(first);
  await store.load();
  try { warmData(first); } catch (e) { console.warn('warm', e); }
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
    // реєстрація (і встановлення: ~280 файлів у кеш) — після першого екрана, щоб не забирати в нього канал
    const afterFirstScreen = (fn) => {
      const run = () => idle(fn, 4000);
      if (document.readyState === 'complete') setTimeout(run, 1500); else addEventListener('load', () => setTimeout(run, 1500), { once: true });
    };
    let reloaded = false;
    // нова версія: на «спокійних» сторінках — перезавантаження одразу; посеред заняття (голос, тест, вправи, письмо…) —
    // при наступному переході на іншу сторінку, щоб не перервати урок (2026-11-14)
    const QUIET = /^#?\/?(home|today|progress|analysis|report|settings|profile|friends|reading\/?$|reading\/library|games\/?$|tutor\/?$|cards\/?$|vocab|grammar\/?$|mistakes\/?$|tests\/?$|admin)?(\?.*)?$/;
    const reloadNow = () => { if (reloaded) return; reloaded = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      if (QUIET.test(location.hash || '#/home')) return reloadNow();
      addEventListener('hashchange', reloadNow, { once: true });
    });
    afterFirstScreen(() => navigator.serviceWorker.register(`sw.js?v=${BUILD}`, { updateViaCache: 'none' }).then(reg => {
      // перевіряємо оновлення при кожному поверненні в застосунок
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(e => console.warn('sw', e)));
  }
}

boot().catch(e => {
  console.error(e);
  document.getElementById('view').textContent = 'Не вдалося запустити застосунок: ' + e.message;
});

