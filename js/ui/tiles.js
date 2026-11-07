// Плитки сторінок — мова бокового меню (рішення власника 2026-11-05). Стилі — css/tiles.css.
// Правила: дія чи розділ — плитка з іконкою в квадратику; групи — txGroup з підписом великими літерами;
// одна головна синя дія на екран (txPrimary); цифри — txKpis (по 3 в ряд); списки — txRows з txRow.
import { h, ic } from './dom.js';

const clsOf = (o) => [o.on && 'on', o.wide && 'wide', o.primary && 'primary', o.tone, o.full && 'full', o.cls].filter(Boolean).map(c => '.' + c).join('');

/** Елемент дії: посилання (href), кнопка (onclick) або div */
function actionEl(base, o, kids) {
  const attrs = { ...(o.attrs || {}) };
  if (o.label && !attrs['aria-label'] && o.ariaLabel) attrs['aria-label'] = o.ariaLabel;
  if (o.href) return h(`a${base}`, { href: o.href, onclick: o.onclick || null, ...attrs }, ...kids);
  if (o.onclick) return h(`button${base}`, { type: 'button', onclick: o.onclick, disabled: o.disabled || null, ...attrs }, ...kids);
  return h(`div${base}`, attrs, ...kids);
}

/**
 * Плитка. o: { icon, label, sub, href | onclick, on, wide, primary, tone: 'good'|'warn'|'bad', full, end (вузол праворуч), extra (вузол під текстом), cls, attrs }
 * Без wide — іконка зверху, текст під нею (для сіток по 2–3); wide — іконка ліворуч, текст праворуч (рядок на всю ширину).
 */
export function tx(o) {
  const kids = [];
  if (o.icon) kids.push(h('span.tx-sq', ic(o.icon, { size: 20, fill: !!(o.on || o.primary) })));
  kids.push(h('span.tx-body', h('span.tx-l', o.label), o.sub ? h('span.tx-s', o.sub) : null, o.extra || null));
  if (o.end !== undefined) kids.push(h('span.tx-end', o.end));
  else if (o.wide && (o.href || o.onclick)) kids.push(h('span.tx-end', ic('caret-right', { size: 18 })));
  return actionEl('.tx' + clsOf(o), o, kids);
}

/** Головна дія екрана: широка синя плитка зі стрілкою (одна на сторінку) */
export const txPrimary = (o) => tx({ ...o, wide: true, on: true, primary: true });

/** Показник: велика цифра + підпис. o: { value, unit, label, tone: 'good'|'warn'|'bad'|'accent', href | onclick, ariaLabel } */
export function txKpi(o) {
  const n = h('span.tx-n' + (o.tone ? '.' + o.tone : ''), String(o.value), o.unit ? h('small', o.unit) : null);
  const attrs = { ...(o.attrs || {}), 'aria-label': o.ariaLabel || `${o.label}: ${o.value}${o.unit ? ' ' + o.unit : ''}` };
  return actionEl('.tx.tx-kpi' + (o.cls ? '.' + o.cls : ''), { ...o, attrs }, [n, h('span.tx-s', o.label)]);
}
/** Ряд показників (3, або 2/4 — cols) */
export const txKpis = (items, cols = 3) => h('div.tx-grid' + (cols === 2 ? '.c2' : cols === 4 ? '.c4' : ''), items.filter(Boolean).map(txKpi));

/** Сітка плиток (за замовчуванням 3 в ряд; неповний останній ряд — розтягується, як у меню) */
export function txGrid(items, cols = 3) {
  const list = items.filter(Boolean);
  const grid = h('div.tx-grid' + (cols === 2 ? '.c2' : cols === 4 ? '.c4' : ''), list);
  if (cols === 3 && list.length % 3) {
    // 6-колонкова сітка: звичайна плитка займає 2, остання неповного ряду — розтягнута
    grid.style.gridTemplateColumns = 'repeat(6,minmax(0,1fr))';
    const rest = list.length % 3;
    list.forEach((el, i) => {
      const stretched = i >= list.length - rest;
      el.style.gridColumn = stretched ? (rest === 1 ? '1 / -1' : 'span 3') : 'span 2';
      if (stretched && el.classList.contains('tx') && !el.classList.contains('tx-kpi')) el.classList.add('wide');
    });
  }
  return grid;
}

/** Група з підписом великими літерами. more: { label, href } — посилання праворуч від підпису */
export function txGroup(label, content, more = null) {
  const head = more
    ? h('div.tx-label-row', h('h2.tx-label', label), h('a.tx-more', { href: more.href }, more.label))
    : (label ? h('h2.tx-label', label) : null);
  return h('section.tx-group', head, ...[].concat(content).filter(Boolean));
}

/**
 * Рядок-плитка списку. o: { no (номер) | icon, label, sub, pill: { text, tone }, end (вузол), href | onclick, on, chevron (стрілка праворуч, за замовчуванням для посилань), cls, attrs }
 */
export function txRow(o) {
  const kids = [];
  if (o.no != null) kids.push(h('span.tx-no', String(o.no)));
  else if (o.icon) kids.push(h('span.tx-sq', ic(o.icon, { size: 18, fill: !!o.on })));
  kids.push(h('span.tx-body', h('span.tx-l', o.label), o.sub ? h('span.tx-s', o.sub) : null));
  if (o.pill) kids.push(txPill(o.pill.text, o.pill.tone));
  if (o.end) kids.push(o.end);
  if (o.chevron ?? !!(o.href || o.onclick)) kids.push(ic('caret-right', { size: 16 }));
  return actionEl('.tx-row' + (o.on ? '.on' : '') + (o.cls ? '.' + o.cls : ''), o, kids);
}
export const txRows = (items) => h('div.tx-rows', items.filter(Boolean));

/** Пігулка стану: tone — good | warn | bad | accent */
export const txPill = (text, tone = '') => h('span.tx-pill' + (tone ? '.' + tone : ''), text);

/** Смужка прогресу 0–1 */
export const txBar = (frac, accent = false) => h('span.tx-bar' + (accent ? '.accent' : ''), { role: 'img', 'aria-label': `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` },
  h('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` } }));

/** «Крапки» серії 0..max (засвоєння помилки) */
export const txDots = (n, max = 3) => h('span.tx-dots', { role: 'img', 'aria-label': `${n} з ${max}` }, Array.from({ length: max }, (_, i) => h('i' + (i < n ? '.on' : ''))));

/**
 * Шапка екрана результату / стану (одна для всього сайту): квадратик-значок 48 px, підпис великими літерами, заголовок, рядок пояснення.
 * o: { icon, tone: 'good'|'warn'|'bad'|'accent', label, title, sub }
 */
export function txResult(o) {
  return h('div.gx-res', { role: o.role || null },
    h('span.gx-res-ic' + (o.tone ? '.' + o.tone : ''), { 'aria-hidden': 'true' }, ic(o.icon || 'check-circle', { size: 24, fill: o.tone === 'good' })),
    h('div.gx-res-b', o.label ? h('div.tx-label', o.label) : null, h('div.gx-res-t', o.title), o.sub ? h('div.tx-s', o.sub) : null));
}

/** «Увійдіть, щоб…» — один вигляд для всього сайту: широка плитка з ключем і пігулкою «Увійти» */
export function txLogin(label = 'Потрібен вхід', sub = 'AI-вчитель і синхронізація працюють після входу в акаунт') {
  return tx({ wide: true, icon: 'key', label, sub, href: '#/auth', cls: 'tx-login', end: txPill('Увійти', 'accent') });
}
