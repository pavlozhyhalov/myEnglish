// Бокове меню (сендвіч)
import { h, ic, clear } from './dom.js';
import { SECTIONS, GROUPS } from '../nav.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { xpWeek } from '../stats.js';
import { user, signOut } from '../supa.js';
import { go } from '../router.js';

let drawer, scrim, list, profileBox, current = 'home';

export function initDrawer() {
  scrim = h('div.scrim', { onclick: close });
  list = h('nav', { 'aria-label': S.menu });
  profileBox = h('div.profile');
  drawer = h('aside.drawer#drawer', { 'aria-label': S.menu, 'aria-hidden': 'true' },
    h('div.brand', h('div.logo', 'En'), h('span.wordmark', h('b', 'my'), 'English')), list, profileBox);
  document.body.append(scrim, drawer);
  renderList();
  renderProfile();
  store.on(t => { if (t === 'sessions' || t === 'profile') renderProfile(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });

  // свайп вліво закриває; напрямок фіксуємо на старті, щоб вертикальна прокрутка не зсувала меню
  let x0 = null, y0 = 0, dx = 0, axis = null;
  drawer.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; axis = null; }, { passive: true });
  drawer.addEventListener('touchmove', e => {
    if (x0 == null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!axis && Math.abs(mx) + Math.abs(my) > 10) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis !== 'x') return;
    dx = Math.min(0, mx);
    drawer.style.transition = 'none';
    drawer.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  drawer.addEventListener('touchend', () => {
    drawer.style.transition = ''; drawer.style.transform = '';
    if (axis === 'x' && dx < -70) close();
    x0 = null; axis = null;
  });
  // фон під відкритим меню не прокручується
  scrim.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  // свайп від лівого краю відкриває
  let ex = null;
  window.addEventListener('touchstart', e => { const t = e.touches[0]; ex = t.clientX < 18 && !document.body.classList.contains('focus-mode') ? t.clientX : null; }, { passive: true });
  window.addEventListener('touchend', e => { if (ex != null && e.changedTouches[0].clientX - ex > 60) open(); ex = null; }, { passive: true });

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
      h('div.xs.dim', `${S.xpWeek}: ${xpWeek()}`)),
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

export function open() {
  drawer.classList.add('open'); scrim.classList.add('open');
  document.body.classList.add('drawer-open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.querySelector('a.item[aria-current]')?.focus({ preventScroll: true });
}
export function close() {
  if (!drawer?.classList.contains('open')) return;
  drawer.classList.remove('open'); scrim.classList.remove('open');
  document.body.classList.remove('drawer-open');
  drawer.setAttribute('aria-hidden', 'true');
  document.querySelector('.btn-menu')?.focus({ preventScroll: true });
}
export function toggle() { drawer.classList.contains('open') ? close() : open(); }
