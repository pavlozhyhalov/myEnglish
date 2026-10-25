// Bottom sheet замість модалок на мобільному
import { h } from './dom.js';

export function sheet(title, content, { onClose } = {}) {
  const scrim = h('div.sheet-scrim');
  const body = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Діалог', tabindex: '-1' },
    h('div.grab', { 'aria-hidden': 'true' }), title ? h('h2', title) : null, content);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    scrim.classList.remove('open'); body.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { scrim.remove(); body.remove(); }, 260);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  // свайп вниз за «ручку»
  let y0 = null;
  body.addEventListener('touchstart', (e) => { if (body.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = e.touches[0].clientY - y0; if (dy > 0) body.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null; body.style.transform = '';
    if (dy > 90) close();
  });
  document.body.append(scrim, body);
  requestAnimationFrame(() => { scrim.classList.add('open'); body.classList.add('open'); body.focus({ preventScroll: true }); });
  return { close, el: body };
}

export function confirmSheet(title, text, okLabel = 'Так', { danger = false } = {}) {
  return new Promise(resolve => {
    let s;
    const done = (v) => { resolve(v); s.close(); };
    s = sheet(title, h('div.stack', h('p.dim', text), h('div.row',
      h('button.btn.grow', { type: 'button', onclick: () => done(false) }, 'Скасувати'),
      h('button.btn.grow' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => done(true) }, okLabel))),
    { onClose: () => resolve(false) });
  });
}
