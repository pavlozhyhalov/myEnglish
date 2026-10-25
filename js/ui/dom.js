import { icon } from './icons.js';

/**
 * h('div.card.tight', {onclick}, 'text', child) — створює DOM без innerHTML.
 * Атрибути: class, style (рядок/об'єкт), on* — обробники, html — ЛИШЕ для
 * довірених статичних рядків (іконки), dataset, інші — setAttribute.
 */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) kids.unshift(attrs);
    attrs = {};
  }
  const idm = sel.match(/#([\w-]+)/);
  const id = idm?.[1];
  const [tag, ...cls] = sel.replace(/#[\w-]+/, '').split('.');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

/** Іконка Phosphor як елемент */
export function ic(name, opts) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, opts);
  return t.content.firstChild;
}

/** Ілюстративне емодзі Fluent (локальний SVG) */
export function emo(name, cls = '') {
  return h('img.emoji' + (cls ? '.' + cls : ''), { src: `assets/emoji/${name}.svg`, alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async' });
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function mount(root, ...kids) { clear(root); append(root, kids); return root; }

/** Кільце прогресу */
export function ring(value, max, { size = 96, stroke = 10, label } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls, off) => {
    const ci = document.createElementNS(ns, 'circle');
    ci.setAttribute('class', cls); ci.setAttribute('cx', size / 2); ci.setAttribute('cy', size / 2); ci.setAttribute('r', r);
    ci.setAttribute('fill', 'none'); ci.setAttribute('stroke-width', stroke); ci.setAttribute('stroke-linecap', 'round');
    ci.setAttribute('stroke-dasharray', c); ci.setAttribute('stroke-dashoffset', off);
    return ci;
  };
  svg.append(mk('track', 0), mk('bar', c * (1 - pct)));
  return h('div.ring', { style: { width: size + 'px', height: size + 'px' }, role: 'img', 'aria-label': `${value} з ${max}` },
    svg, h('div.label', label ?? h('b', String(value))));
}

export function progress(pct) {
  return h('div.progress', { role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));
}

export function seg(options, value, onChange) {
  const wrap = h('div.seg', { role: 'group' });
  for (const [v, label] of options) {
    wrap.append(h('button', {
      type: 'button', 'aria-pressed': String(v === value),
      onclick: () => { [...wrap.children].forEach(b => b.setAttribute('aria-pressed', 'false')); wrap.querySelector(`[data-v="${CSS.escape(String(v))}"]`).setAttribute('aria-pressed', 'true'); onChange(v); },
      dataset: { v: String(v) },
    }, label));
  }
  return wrap;
}

export function toggle(checked, onChange, label) {
  return h('label.switch', h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label, onchange: (e) => onChange(e.target.checked) }));
}

export function fmtMin(sec) { const m = Math.round(sec / 60); return `${m} хв`; }
export function fmtInterval(days) {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} хв`;
  if (days < 1) return `${Math.round(days * 24)} год`;
  if (days < 30) return `${Math.round(days)} дн`;
  if (days < 365) return `${Math.round(days / 30)} міс`;
  return `${(days / 365).toFixed(1)} р`;
}
export function esc(s) { return String(s ?? ''); }
