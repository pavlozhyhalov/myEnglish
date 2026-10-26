// Старт застосунку: тема, авторизація, шапка, маршрути, синхронізація, service worker
import { BUILD } from './config.js';
import { S } from './strings.js';
import * as store from './store.js';
import { h, ic, emo } from './ui/dom.js';
import { initDrawer, toggle as toggleDrawer, setActive as drawerActive, renderProfile } from './ui/drawer.js';
import { initQuickbar, setActive as qbActive } from './ui/quickbar.js';
import { toast } from './ui/toast.js';
import { route, fallback, onRoute, start, go } from './router.js';
import { sectionFor } from './nav.js';
import { supa, initAuth, onAuth } from './supa.js';
import { streak } from './stats.js';
import { setTitle, applyTheme, isDark } from './ui/shell.js';

// ---------- Режим клавіатури: рамка фокусу видима лише після Tab/стрілок ----------
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Enter у полі відповіді (вправи, диктант) переводить фокус на «Далі» — рамка має бути видима
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '');
  if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key) || (e.key === 'Enter' && typing)) document.documentElement.classList.add('kbd');
}, true);
addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);

// ---------- Тема ----------
function cycleTheme() {
  // перемикач у шапці: світла ↔ темна (Авто — у налаштуваннях)
  store.setSetting('theme', isDark() ? 'light' : 'dark');
  applyTheme();
}

// ---------- Шапка ----------
function header() {
  const streakBtn = h('a.streak-chip', { href: '#/progress' });
  const updateStreak = () => {
    const n = streak();
    streakBtn.replaceChildren(emo('fire'), h('span.num', String(n)));
    streakBtn.setAttribute('aria-label', S.streak(n));
  };
  updateStreak();
  store.on(t => { if (t === 'sessions') updateStreak(); });
  const el = h('header.app-header',
    h('button.icon-btn.btn-menu', { type: 'button', 'aria-label': S.menu, 'aria-controls': 'drawer', onclick: toggleDrawer }, ic('list')),
    h('div.title#page-title', S.app),
    h('div.right', streakBtn,
      h('button.icon-btn.btn-theme', { type: 'button', 'aria-label': S.themeToggle, onclick: cycleTheme }, ic('sun'))));
  document.body.prepend(el);
}

// ---------- Маршрути ----------
const pages = {
  home: () => import('./pages/home.js'),
  tutor: () => import('./pages/tutor.js'),
  cards: () => import('./pages/cards.js'),
  vocab: () => import('./pages/vocab.js'),
  grammar: () => import('./pages/grammar.js'),
  listening: () => import('./pages/listening.js'),
  pronunciation: () => import('./pages/pronunciation.js'),
  writing: () => import('./pages/writing.js'),
  scenarios: () => import('./pages/scenarios.js'),
  tests: () => import('./pages/tests.js'),
  exercises: () => import('./pages/exercises.js'),
  mistakes: () => import('./pages/mistakes.js'),
  progress: () => import('./pages/progress.js'),
  settings: () => import('./pages/settings.js'),
  session: () => import('./pages/session.js'),
  auth: () => import('./pages/auth.js'),
  lab: () => import('./pages/lab.js'),
};

async function boot() {
  await store.load();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

  header();
  initDrawer();
  initQuickbar();
  applyTheme();

  for (const [name, loader] of Object.entries(pages)) route(name, loader);
  fallback((view) => { view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Сторінку не знайдено'), h('a.btn.soft', { href: '#/' }, S.nav.home))); });
  onRoute((r) => {
    const sec = sectionFor(r.path);
    setTitle(r.name === 'home' ? S.app : sec ? sec.long : (S.nav[r.name] || S.app));
    drawerActive(sec ? sec.id : '');
    qbActive(sec ? sec.id : r.name);
    document.body.classList.remove('focus-mode');
  });

  // Авторизація і синхронізація
  store.attachSupabase(supa);
  try { await initAuth(); } catch (e) { console.warn('auth', e); }
  renderProfile();
  onAuth((s) => {
    renderProfile();
    if (s) { store.sync().then(ok => ok && toast(S.synced)).catch(e => console.warn(e)); }
  });
  store.sync().catch(e => console.warn('sync', e));
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

