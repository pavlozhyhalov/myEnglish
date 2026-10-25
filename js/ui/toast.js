import { h } from './dom.js';

let box = null;
export function toast(text, { action, onAction, kind = '', ms = 3200 } = {}) {
  if (!box) { box = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div.toast' + (kind ? '.' + kind : ''), h('span', text));
  if (action) el.append(h('button.btn', { type: 'button', onclick: () => { onAction?.(); el.remove(); } }, action));
  box.append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
