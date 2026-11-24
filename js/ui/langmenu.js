// Мова в шапці (2026-11-24, власник: «у шапку випадаючий список для вибору мови, як у Резонансі»).
// Кнопка з кодом мови (монохромно — без кольорових прапорців, рішення 2026-10-25 про іконки) → меню під нею: код + назва мови її ж мовою.
// Видно лише коли готових мов більше однієї (readyLangs у js/i18n.js).
import { h, ic } from './dom.js';
import * as store from '../store.js';
import { readyLangs, lang, setLang } from '../i18n.js';

const CODE = { uk: 'UA', es: 'ES', pt: 'PT', tr: 'TR', pl: 'PL', ru: 'RU' };

export function langMenu() {
  if (readyLangs().length < 2) return null;
  const cur = lang();
  const menu = h('div.lang-menu', { role: 'menu', 'aria-label': 'Мова', 'data-noi18n': '' },
    readyLangs().map(l => h('button.lang-opt' + (l.id === cur ? '.on' : ''), { type: 'button', role: 'menuitemradio', 'aria-checked': String(l.id === cur), lang: l.id,
      onclick: (e) => { e.stopPropagation(); close(); if (l.id !== cur) { store.setSetting('lang', l.id); setLang(l.id); } } },
      h('span.lang-code', CODE[l.id] || l.id.toUpperCase()), h('span.lang-name', l.name), l.id === cur ? ic('check', { size: 16 }) : null)));
  const btn = h('button.icon-btn.lang-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Мова застосунку',
    onclick: (e) => { e.stopPropagation(); menu.classList.contains('open') ? close() : open(); } },
    h('span.lang-cur', CODE[cur] || cur.toUpperCase()), ic('caret-down', { size: 11 }));
  const wrap = h('div.lang-wrap', btn, menu);
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
  function open() { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }
  function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); }
  return wrap;
}
