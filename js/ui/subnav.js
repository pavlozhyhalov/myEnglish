// Вкладки вгорі сторінки для розділів, об'єднаних в один пункт меню (TABSETS у js/nav.js):
// «Картки · Словник», «Правила · Вправи», «Звуки · Вправи», «Аудіювання · Читання», «Письмо · Щоденник», «Прогрес · Аналіз · Звіт».
// Показуються лише на головній сторінці такого розділу (не в уроці, не під час тренування), липнуть під шапкою.
import { h } from './dom.js';
import { byId, tabsetOf, sectionFor } from '../nav.js';

let bar = null;

export function initSubnav() {
  bar = h('nav.subnav', { 'aria-label': 'Розділи', hidden: true });
  const main = document.getElementById('view');
  main.before(bar);
  // сторінка перейшла в режим заняття (повноекранне тренування, тест) — вкладки ховаються
  new MutationObserver(() => {
    const focus = document.body.classList.contains('focus-mode');
    if (focus && !bar.hidden) { bar.hidden = true; document.body.classList.remove('has-subnav'); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

const pathOf = (href) => href.replace(/^#/, '').split('?')[0] || '/';

/** Оновити вкладки для маршруту r (router.parse) */
export function updateSubnav(r) {
  if (!bar) return;
  const sec = sectionFor(r.path);
  const set = sec && tabsetOf(sec.id);
  // лише головна сторінка розділу: #/grammar — так, #/grammar/present-perfect — ні
  if (!set || r.path !== pathOf(sec.href) || document.body.classList.contains('focus-mode')) { bar.hidden = true; bar.replaceChildren(); document.body.classList.remove('has-subnav'); return; }
  bar.hidden = false;
  document.body.classList.add('has-subnav');
  bar.replaceChildren(h('div.seg.subnav-seg', { role: 'tablist' }, set.map(([id, label]) => {
    const on = id === sec.id;
    return h('a', { href: byId[id].href, role: 'tab', 'aria-selected': String(on), 'aria-current': on ? 'page' : null, tabindex: on ? 0 : -1, dataset: { id } }, label);
  })));
}
