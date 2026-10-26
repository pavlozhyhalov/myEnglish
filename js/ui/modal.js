// Модальні шари (шторки, відкрите меню): поки шар відкритий, усе інше на сторінці — inert
// (Tab не виходить за межі шару), а Escape закриває лише верхній шар і не доходить до сторінки
// (інакше, напр., повтор карток завершувався разом із закриттям меню).
const stack = [];
const ours = new Set();   // елементи, яким inert поставили саме ми (меню керує своїм inert саме)

function apply() {
  const top = stack[stack.length - 1];
  for (const c of document.body.children) {
    // живі області (тости) лишаються доступними для читачів екрана
    const want = !!top && !c.matches('[aria-live], script') && !top.keep.some(k => k === c || c.contains(k));
    if (want && !c.inert) { c.inert = true; ours.add(c); }
    else if (!want && ours.has(c)) { c.inert = false; ours.delete(c); }
  }
}

/** Відкрити шар: keep — елементи шару (лишаються активними), onEscape — закрити. Повертає функцію зняття. */
export function pushModal(keep, onEscape) {
  const layer = { keep, onEscape };
  stack.push(layer);
  apply();
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return;
    stack.splice(i, 1);
    apply();
  };
}

export const modalOpen = () => stack.length > 0;

// фаза перехоплення на window — спрацьовує раніше за обробники сторінок на document
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  stack[stack.length - 1].onEscape?.();
}, true);
