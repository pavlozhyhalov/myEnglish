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
    h('div.brand', h('div.logo', 'En'), S.app), list, profileBox);
  document.body.append(scrim, drawer);
  renderList();
  renderProfile();
  store.on(t => { if (t === 'sessions' || t === 'profile') renderProfile(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });

  // свайп вліво закриває
  let x0 = null, dx = 0;
  drawer.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; dx = 0; drawer.style.transition = 'none'; }, { passive: true });
  drawer.addEventListener('touchmove', e => { if (x0 == null) return; dx = Math.min(0, e.touches[0].clientX - x0); drawer.style.transform = `translateX(${dx}px)`; }, { passive: true });
  drawer.addEventListener('touchend', () => { drawer.style.transition = ''; drawer.style.transform = ''; if (dx < -70) close(); x0 = null; });
  // свайп від лівого краю відкриває
  let ex = null;
  window.addEventListener('touchstart', e => { const t = e.touches[0]; ex = t.clientX < 18 && !document.body.classList.contains('focus-mode') ? t.clientX : null; }, { passive: true });
  window.addEventListener('touchend', e => { if (ex != null && e.changedTouches[0].clientX - ex > 60) open(); ex = null; }, { passive: true });

  if (store.settings().pinDrawer !== false) document.body.classList.add('drawer-pinned');
}

function renderList() {
  clear(list);
  const item = (s) => h('a.item', { href: `#/${s.id}`, dataset: { id: s.id }, 'aria-current': s.id === current ? 'page' : null, onclick: close },
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
  const lvl = store.prof().level || store.settings().level;
  clear(profileBox).append(h('div.profile-card',
    h('div.level-badge', lvl),
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
  drawer.setAttribute('aria-hidden', 'false');
  drawer.querySelector('a.item[aria-current]')?.focus({ preventScroll: true });
}
export function close() {
  if (!drawer?.classList.contains('open')) return;
  drawer.classList.remove('open'); scrim.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.querySelector('.btn-menu')?.focus({ preventScroll: true });
}
export function toggle() { drawer.classList.contains('open') ? close() : open(); }
