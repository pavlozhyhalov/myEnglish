// Нижня панель швидкого доступу (пункти й порядок обирає користувач)
import { h, ic, clear } from './dom.js';
import { byId } from '../nav.js';
import * as store from '../store.js';
import { go } from '../router.js';

let bar, current = 'home';

export function initQuickbar() {
  bar = h('nav.quickbar', { 'aria-label': 'Швидкий доступ' });
  document.body.append(h('div.quickbar-wrap', bar));
  render();
  store.on(t => { if (t === 'profile') render(); });
}

export function arrange(ids) {
  const list = ids.filter(id => byId[id]).slice(0, 5);
  const i = list.indexOf('tutor');
  if (i >= 0) { list.splice(i, 1); list.splice(Math.floor(list.length / 2), 0, 'tutor'); }
  return list;
}

function render() {
  clear(bar);
  for (const id of arrange(store.settings().quickbar)) {
    const s = byId[id];
    const on = id === current;
    if (id === 'tutor') {
      const a = h('a.qb-item.tutor', { href: '#/tutor', 'aria-label': `${s.label}. Утримайте для голосового режиму`, 'aria-current': on ? 'page' : null },
        h('span.bubble', ic('chat-circle-dots', { fill: true, size: 28 })), h('span', s.label));
      // довге натискання — одразу голос
      let t = null, long = false;
      const startPress = () => { long = false; t = setTimeout(() => { long = true; navigator.vibrate?.(15); go('/tutor?mode=voice'); }, 550); };
      const cancel = () => clearTimeout(t);
      a.addEventListener('pointerdown', startPress);
      a.addEventListener('pointerup', cancel);
      a.addEventListener('pointerleave', cancel);
      a.addEventListener('pointercancel', cancel);
      a.addEventListener('contextmenu', e => e.preventDefault());
      a.addEventListener('click', e => { if (long) e.preventDefault(); });
      bar.append(a);
    } else {
      bar.append(h('a.qb-item', { href: `#/${id}`, 'aria-current': on ? 'page' : null }, ic(s.icon, { fill: on, size: 26 }), h('span', s.label)));
    }
  }
}

export function setActive(id) { current = id; if (bar) render(); }
