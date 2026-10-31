// Пошук за виділенням: виділіть 1–5 англійських слів будь-де в застосунку (довге натискання на телефоні, мишею — протягнути
// чи подвійний клік) → плашка «Що це?» → шторка зі значенням (js/ui/wordtap.js: словничок тексту → колоди → AI-переклад у контексті).
// Понад 5 слів — плашка «Перекласти» (переклад фрагмента). Поля вводу, українські фрагменти, шапка, меню й нижня панель — без плашки.
// На дотикових пристроях плашка — внизу над нижньою панеллю (системне меню «Копіювати» з'являється біля виділення і її не закриває);
// мишею — під виділенням. Код wordtap вантажиться лише після натискання плашки.
import { h, ic } from './dom.js';

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const MAX_WORDS = 5, MAX_FRAGMENT = 1500;
const SKIP = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],.sel-pill,[data-nolookup],.app-header,.quickbar-wrap,.drawer';
const ZONE = '#view,.sheet,.voice';

let pill = null, label = null, current = null, timer = 0, pressing = false, lastPointer = '';
const coarse = () => lastPointer ? lastPointer !== 'mouse' : matchMedia('(pointer: coarse)').matches;

function hide() {
  clearTimeout(timer);
  if (pill && !pill.hidden) pill.hidden = true;
  if (!pressing) current = null;
}

/** Що виділено: { text, range, mode: 'word' | 'fragment', root } або null */
function readSelection() {
  const sel = window.getSelection?.();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return null;
  const raw = sel.toString();
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_FRAGMENT) return null;
  const range = sel.getRangeAt(0);
  const anc = range.commonAncestorContainer;
  const el = anc.nodeType === 1 ? anc : anc.parentElement;
  if (!el || el.closest(SKIP) || !el.closest(ZONE)) return null;
  const lat = (text.match(/[A-Za-z]/g) || []).length, cyr = (text.match(/[Ѐ-ӿ]/g) || []).length;
  if (!lat || cyr > lat) return null;                        // українське — не шукаємо
  const words = text.match(WORD) || [];
  if (!words.length) return null;
  return { text, rawLen: raw.length, range: range.cloneRange(), mode: words.length <= MAX_WORDS ? 'word' : 'fragment', root: el.closest('.wordtap') };
}

function selectionRect(range) {
  let r = range.getBoundingClientRect();
  if (!r.width && !r.height) { const rs = range.getClientRects(); if (rs.length) r = rs[rs.length - 1]; }
  return r;
}

function place(rect) {
  const vv = window.visualViewport;
  const vTop = vv ? vv.offsetTop : 0, vLeft = vv ? vv.offsetLeft : 0;
  const vh = vv ? vv.height : innerHeight, vw = vv ? vv.width : innerWidth;
  pill.hidden = false;
  const pw = pill.offsetWidth, ph = pill.offsetHeight;
  const qb = document.querySelector('.quickbar');
  const sheetOpen = !!document.querySelector('.sheet.open');
  const qbTop = qb && !sheetOpen ? qb.getBoundingClientRect().top : Infinity;
  const floor = Math.min(vTop + vh, qbTop) - 12;            // нижня межа: край екрана або нижня панель
  const ceil = Math.max(vTop, document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0) + 8;
  let top, left;
  if (coarse()) {
    top = floor - ph;
    left = vLeft + (vw - pw) / 2;
    // виділення внизу екрана — плашка вгорі, під шапкою, щоб не закрити виділене
    if (rect.bottom > top - 8) top = ceil;
  } else {
    top = rect.bottom + 8;
    left = rect.left + rect.width / 2 - pw / 2;
    if (top + ph > floor) top = rect.top - ph - 8;
  }
  left = Math.max(vLeft + 8, Math.min(left, vLeft + vw - pw - 8));
  top = Math.max(ceil, Math.min(top, floor - ph));
  pill.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function evaluate() {
  if (pressing) return;
  const c = readSelection();
  if (!c) { hide(); return; }
  const rect = selectionRect(c.range);
  if (rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
  current = c;
  const short = c.text.length > 40 ? c.text.slice(0, 40) + '…' : c.text;
  label.textContent = c.mode === 'word' ? 'Що це?' : 'Перекласти';
  pill.setAttribute('aria-label', c.mode === 'word' ? `Що це: ${short}` : `Перекласти: ${short}`);
  pill.replaceChildren(ic(c.mode === 'word' ? 'magnifying-glass' : 'translate'), label);
  place(rect);
}
const schedule = (ms = 180) => { clearTimeout(timer); timer = setTimeout(evaluate, ms); };

async function activate() {
  const c = current;
  pressing = false;
  hide();
  if (!c) return;
  const wt = await import('./wordtap.js');
  let sentence = '', next = [];
  const block = wt.blockOf(c.range.startContainer);
  if (block) {
    const at = wt.offsetIn(block, c.range.startContainer, c.range.startOffset);
    sentence = wt.sentenceAround(block, at, c.rawLen);
    next = (block.textContent.slice(at + c.rawLen, at + c.rawLen + 60).match(WORD) || []).slice(0, 3);
  }
  const cfg = c.root?.__wt || {};
  try { window.getSelection()?.removeAllRanges(); } catch { /* */ }
  if (c.mode === 'word') wt.lookupText({ text: c.text, sentence, next, gl: cfg.gl, onAsk: cfg.onAsk });
  else wt.translateFragment({ text: c.text, onAsk: cfg.onAsk });
}

export function initSelectLookup() {
  if (pill || !window.getSelection) return;
  label = h('span');
  pill = h('button.sel-pill', { type: 'button', hidden: true }, label);
  // мишею — не знімати виділення і не забирати фокус; дотиком — нічого не блокуємо (інакше не прийде click)
  pill.addEventListener('pointerdown', (e) => { pressing = true; if (e.pointerType === 'mouse') e.preventDefault(); });
  pill.addEventListener('mousedown', (e) => e.preventDefault());
  pill.addEventListener('pointercancel', () => { pressing = false; schedule(); });
  pill.addEventListener('click', activate);
  document.body.append(pill);

  document.addEventListener('selectionchange', () => schedule(coarse() ? 260 : 160));
  addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; if (!pill.contains(e.target)) pressing = false; }, true);
  addEventListener('pointerup', () => schedule(60), true);
  addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') { lastPointer = 'mouse'; schedule(60); } }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pill && !pill.hidden) hide();
    // клавіатура: виділили Shift+стрілками → Alt+↓ (або Alt+L) відкриває значення
    if (e.altKey && (e.key === 'ArrowDown' || e.code === 'KeyL') && current && !pill.hidden) { e.preventDefault(); activate(); }
  }, true);
  // прокрутка — сховати; коли зупиниться і виділення лишилось — показати на новому місці
  addEventListener('scroll', () => { if (!pill.hidden) pill.hidden = true; if (current || window.getSelection()?.toString()) schedule(250); }, { capture: true, passive: true });
  addEventListener('resize', () => schedule(120));
  window.visualViewport?.addEventListener('resize', () => schedule(120));
  window.visualViewport?.addEventListener('scroll', () => { if (!pill.hidden) schedule(120); });
  addEventListener('hashchange', () => { pressing = false; hide(); });
}
