// Слова в плитках не рвуться посередині (власник 2026-11-16: «Знайомств-о», «Телефонни-й» — некрасиво).
// Підписи плиток мають overflow-wrap: normal (css/tiles.css): довге слово, що не вміщається, вилазить за межу —
// тоді тут шрифт зменшується по 0,5 px до 75% (не менше 11 px); якщо й так не вміщається — лише тоді дозволяємо перенос (.fit-break).
const SEL = '.tx-l, .tx-s, .hm-st-t, .wf-label, .gx-res-t';
const MIN_PX = 11;

function fitOne(el) {
  if (!el.isConnected || !el.offsetParent) return;
  el.classList.remove('fit-break');
  el.style.fontSize = '';
  // рядки з навмисним «…» (white-space: nowrap) не чіпаємо
  if (getComputedStyle(el).whiteSpace.startsWith('nowrap') || el.closest('[data-nofit]')) return;
  if (el.scrollWidth <= el.clientWidth + 1) return;
  // «am/is/are/was/were», «a/an»: дозволити перенос після «/» (невидимий пробіл) — тоді слово поруч рватися не мусить
  for (const n of el.childNodes) if (n.nodeType === 3 && /\/(?!\u200B)/.test(n.data)) n.data = n.data.replace(/\/(?!\u200B)/g, '/\u200B');
  if (el.scrollWidth <= el.clientWidth + 1) return;
  const base = parseFloat(getComputedStyle(el).fontSize) || 15;
  const min = Math.max(MIN_PX, base * 0.75);
  for (let px = base - 0.5; px >= min; px -= 0.5) {
    el.style.fontSize = `${px}px`;
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
  el.style.fontSize = '';
  el.classList.add('fit-break');
}

let pending = new Set(), all = false, queued = false;
function flush() {
  queued = false;
  const list = all ? [...document.querySelectorAll(SEL)] : [...pending].flatMap(n => (n.matches?.(SEL) ? [n] : []).concat(n.querySelectorAll ? [...n.querySelectorAll(SEL)] : []));
  pending = new Set(); all = false;
  for (const el of list) fitOne(el);
  // в одній сітці назви плиток — одним кеглем (найменшим, що знадобився): ряд виглядає рівно
  const grids = new Set(list.map(el => el.closest('.tx-grid')).filter(Boolean));
  for (const g of grids) {
    const labels = [...g.querySelectorAll(':scope > .tx .tx-l')].filter(el => !el.classList.contains('fit-break'));
    const sizes = labels.map(el => parseFloat(el.style.fontSize)).filter(Boolean);
    if (!sizes.length) continue;
    const min = Math.min(...sizes);
    for (const el of labels) el.style.fontSize = `${min}px`;
  }
}
function schedule() { if (!queued) { queued = true; requestAnimationFrame(flush); } }

export function initFit() {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
      else if (n.nodeType === 3 && n.parentElement) pending.add(n.parentElement);
    if (pending.size) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  let w = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== w) { w = innerWidth; all = true; schedule(); } });
  // шрифти довантажились — ширина слів змінилась
  document.fonts?.ready?.then(() => { all = true; schedule(); });
  document.fonts?.addEventListener?.('loadingdone', () => { all = true; schedule(); });
  all = true; schedule();
}
