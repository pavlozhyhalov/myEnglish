// Заглушки-«скелети» на час завантаження: сірі блоки з м'яким переливом (без переливу при prefers-reduced-motion)
import { h } from './dom.js';

/** Один блок: w — ширина (CSS), ht — висота (px), r — заокруглення (CSS) */
export function skel({ w = '100%', ht = 14, r = '8px', cls = '' } = {}) {
  return h('span.skel' + (cls ? `.${cls}` : ''), { 'aria-hidden': 'true', style: { width: w, height: `${ht}px`, borderRadius: r } });
}

/** Кілька рядків тексту (останній коротший) */
export function skelLines(n = 3, { ht = 12, gap = 10 } = {}) {
  return h('div.skel-lines', { 'aria-hidden': 'true', style: { gap: `${gap}px` } },
    Array.from({ length: n }, (_, i) => skel({ w: i === n - 1 && n > 1 ? '62%' : '100%', ht })));
}

/** Картка-заглушка: заголовок + рядки; role=status — читач екрана чує «Завантаження» */
export function skelCard({ rows = 3, cls = '' } = {}) {
  return h('section.card.skel-card' + (cls ? `.${cls}` : ''), { role: 'status', 'aria-label': 'Завантаження' },
    h('div.row', skel({ w: '40px', ht: 40, r: '12px' }), h('div.grow.stack', { style: { gap: '8px' } }, skel({ w: '55%', ht: 14 }), skel({ w: '35%', ht: 10 }))),
    rows ? skelLines(rows) : null);
}

/** Рядок списку-заглушка (як .list-row) */
export function skelRow() {
  return h('div.list-row.skel-row', { 'aria-hidden': 'true' },
    skel({ w: '40px', ht: 40, r: '12px' }),
    h('div.grow.stack', { style: { gap: '8px' } }, skel({ w: '60%', ht: 13 }), skel({ w: '38%', ht: 10 })));
}
