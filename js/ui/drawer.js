// Бокове меню (сендвіч)
import { h, ic, clear } from './dom.js';
import { SECTIONS, GROUPS } from '../nav.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { weekSeconds } from '../stats.js';
import { user, signOut } from '../supa.js';
import { go } from '../router.js';

let drawer, scrim, list, profileBox, current = 'home';

export function initDrawer() {
  scrim = h('div.scrim', { onclick: close });
  list = h('nav', { 'aria-label': S.menu });
  profileBox = h('div.profile');
  drawer = h('aside.drawer#drawer', { 'aria-label': S.menu, 'aria-hidden': 'true', tabindex: '-1' },
    h('div.brand', h('div.logo', 'En'), h('span.wordmark', h('b', 'my'), 'English')), list, profileBox);
  document.body.append(scrim, drawer);
  renderList();
  renderProfile();
  store.on(t => { if (t === 'sessions' || t === 'profile') renderProfile(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });

  // відкривається кнопкою; закривається тапом по фону, пунктом, Esc або свайпом уліво (лише вліво — вправо не тягнеться)
  scrim.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  swipeToClose(drawer);
  swipeToClose(scrim);

  if (store.settings().pinDrawer !== false) document.body.classList.add('drawer-pinned');
}

function renderList() {
  clear(list);
  const item = (s) => h('a.item', { href: s.href, dataset: { id: s.id }, 'aria-current': s.id === current ? 'page' : null, onclick: close },
    ic(s.icon, { fill: s.id === current }), h('span', s.long));
  for (const s of SECTIONS.filter(s => !s.group)) list.append(item(s));
  for (const g of GROUPS) {
    list.append(h('div.group', S.groups[g]));
    for (const s of SECTIONS.filter(s => s.group === g)) list.append(item(s));
  }
}

export function renderProfile() {
  if (!profileBox) return;
  const u = user();
  clear(profileBox).append(h('div.profile-card',
    h('div.level-badge', ic('user', { size: 22 })),
    h('div.grow',
      h('div', { style: { fontWeight: 600 } }, u ? (u.email || '').split('@')[0] : S.guest),
      h('div.xs.dim', `${S.weekTime}: ${Math.round(weekSeconds() / 60)} хв`)),
    u ? h('button.btn.sm', { type: 'button', onclick: async () => { await signOut(); close(); } }, S.logout)
      : h('button.btn.sm.soft', { type: 'button', onclick: () => { close(); go('/auth'); } }, S.login)));
}

export function setActive(id) {
  current = id;
  if (!list) return;
  list.querySelectorAll('a.item').forEach(a => {
    const on = a.dataset.id === id;
    a.toggleAttribute('aria-current', on);
    if (on) a.setAttribute('aria-current', 'page');
    const s = SECTIONS.find(x => x.id === a.dataset.id);
    a.firstChild.replaceWith(ic(s.icon, { fill: on }));
  });
}

// iOS ігнорує overflow:hidden на body — фіксуємо сторінку і повертаємо прокрутку після закриття
let savedY = 0;
function lockScroll(on) {
  const b = document.body;
  if (on) {
    if (b.classList.contains('drawer-open') || matchMedia('(min-width:1100px)').matches && b.classList.contains('drawer-pinned')) return;
    savedY = window.scrollY;
    b.style.top = `-${savedY}px`;
    b.classList.add('drawer-open');
  } else if (b.classList.contains('drawer-open')) {
    b.classList.remove('drawer-open');
    b.style.top = '';
    window.scrollTo(0, savedY);
  }
}

export function open() {
  drawer.classList.add('open'); scrim.classList.add('open');
  lockScroll(true);
  drawer.setAttribute('aria-hidden', 'false');
  // фокус на саму панель (без видимої рамки), щоб не обводити пункт меню
  drawer.focus({ preventScroll: true });
}
export function close() {
  if (!drawer?.classList.contains('open')) return;
  drawer.classList.remove('open'); scrim.classList.remove('open');
  lockScroll(false);
  drawer.setAttribute('aria-hidden', 'true');
  document.querySelector('.btn-menu')?.focus({ preventScroll: true });
}
/** Свайп уліво по відкритому меню: панель їде за пальцем, відпускання далі 30% ширини або швидкий змах — закриває */
function swipeToClose(el) {
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, mode = null;
  const reset = () => { drawer.style.transition = drawer.style.transform = scrim.style.transition = scrim.style.opacity = ''; };
  el.addEventListener('touchstart', (e) => {
    if (!drawer.classList.contains('open') || e.touches.length > 1) { mode = 'none'; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); dx = 0; mode = null;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (mode === 'none' || mode === 'v') return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';  // фіксуємо напрямок: вертикальний — прокрутка списку
      if (mode === 'v') return;
      drawer.style.transition = scrim.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    dx = Math.min(0, mx);
    const w = drawer.offsetWidth;
    drawer.style.transform = `translateX(${dx}px)`;
    scrim.style.opacity = String(1 + dx / w);
  }, { passive: false });
  const end = () => {
    if (mode !== 'h') { mode = null; return; }
    mode = null;
    const w = drawer.offsetWidth, v = dx / Math.max(1, Date.now() - t0);
    reset();
    if (dx < -w * 0.3 || (dx < -20 && v < -0.4)) close();
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', () => { mode = null; reset(); });
}

export function toggle() { drawer.classList.contains('open') ? close() : open(); }
