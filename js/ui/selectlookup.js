// Пошук за виділенням: виділіть англійське слово чи фразу будь-де в застосунку (довге натискання на телефоні, мишею — протягнути
// чи подвійний клік) → біля виділення кругла кнопка «?» → бульбашка з перекладом прямо біля слова
// (словничок тексту → колоди → AI-переклад у контексті; js/ui/wordtap.js). «Детальніше» — повна шторка (додати в мої слова, запитати вчителя).
// Понад 5 слів — переклад фрагмента. Поля вводу, українські фрагменти, шапка, меню й нижня панель — без кнопки.
// Розміщення: мишею — над виділенням. На дотикових пристроях над виділенням з'являється системне меню («Копіювати», «Перекласти»),
// яке перекрило б кнопку, тож «?» стає під виділенням (а якщо виділення біля верху екрана й меню йде вниз — над ним).
// Код wordtap вантажиться лише після натискання «?».
import { h, ic } from './dom.js';

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const MAX_WORDS = 5, MAX_FRAGMENT = 1500;
const SKIP = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],.sel-q,.sel-pop,[data-nolookup],.app-header,.quickbar-wrap,.drawer';
const ZONE = '#view,.sheet,.voice';
const GAP = 10;

let btn = null, pop = null, current = null, timer = 0, pressing = false, lastPointer = '', popToken = 0;
const coarse = () => lastPointer ? lastPointer !== 'mouse' : matchMedia('(pointer: coarse)').matches;

function hide() {
  clearTimeout(timer);
  if (btn && !btn.hidden) btn.hidden = true;
  if (!pressing) current = null;
}
function closePop() {
  popToken++;
  if (pop && !pop.hidden) { pop.hidden = true; pop.replaceChildren(); }
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
  // для багаторядкового виділення — перший рядок (над ним) і останній (під ним)
  const rs = [...range.getClientRects()].filter(r => r.width || r.height);
  const all = range.getBoundingClientRect();
  return { all, first: rs[0] || all, last: rs[rs.length - 1] || all };
}

/** Межі видимої області: під шапкою, над нижньою панеллю */
function bounds() {
  const vv = window.visualViewport;
  const vTop = vv ? vv.offsetTop : 0, vLeft = vv ? vv.offsetLeft : 0;
  const vh = vv ? vv.height : innerHeight, vw = vv ? vv.width : innerWidth;
  const qb = document.querySelector('.quickbar');
  const sheetOpen = !!document.querySelector('.sheet.open');
  const qbTop = qb && !sheetOpen ? qb.getBoundingClientRect().top : Infinity;
  return {
    left: vLeft + 8, right: vLeft + vw - 8,
    top: Math.max(vTop, document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0) + 8,
    bottom: Math.min(vTop + vh, qbTop) - 8,
  };
}

/** Поставити елемент над (або під) виділенням; above=null — вирішити самому */
function placeNear(el, rect, preferAbove) {
  el.hidden = false;
  const b = bounds(), w = el.offsetWidth, ht = el.offsetHeight;
  const anchor = preferAbove ? rect.first : rect.last;
  const cx = anchor.left + anchor.width / 2;
  let top = preferAbove ? rect.first.top - ht - GAP : rect.last.bottom + GAP;
  // не вміщається — на інший бік
  if (preferAbove && top < b.top) top = rect.last.bottom + GAP;
  if (!preferAbove && top + ht > b.bottom) top = rect.first.top - ht - GAP;
  top = Math.max(b.top, Math.min(top, b.bottom - ht));
  const left = Math.max(b.left, Math.min(cx - w / 2, b.right - w));
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  // хвостик бульбашки — над словом
  el.style.setProperty('--tail', `${Math.round(Math.max(14, Math.min(w - 14, cx - left)))}px`);
  el.classList.toggle('below', top > anchor.top);
}

/** Мишею — над словом; дотиком — під словом (над ним системне меню), якщо слово не біля самого верху */
const wantAbove = (rect) => !coarse() || rect.first.top - bounds().top < 72;

function evaluate() {
  if (pressing) return;
  const c = readSelection();
  if (!c) { hide(); return; }
  const rect = selectionRect(c.range);
  if (rect.all.bottom < 0 || rect.all.top > innerHeight) { hide(); return; }
  current = c;
  closePop();
  const short = c.text.length > 40 ? c.text.slice(0, 40) + '…' : c.text;
  btn.setAttribute('aria-label', c.mode === 'word' ? `Переклад: ${short}` : `Перекласти фрагмент: ${short}`);
  btn.title = c.mode === 'word' ? 'Переклад' : 'Перекласти фрагмент';
  placeNear(btn, rect, wantAbove(rect));
}
const schedule = (ms = 180) => { clearTimeout(timer); timer = setTimeout(evaluate, ms); };

/** Контекст виділення для точного перекладу: речення і наступні слова (фразові дієслова) */
async function contextOf(c) {
  const wt = await import('./wordtap.js');
  let sentence = '', next = [];
  const block = wt.blockOf(c.range.startContainer);
  if (block) {
    const at = wt.offsetIn(block, c.range.startContainer, c.range.startOffset);
    sentence = wt.sentenceAround(block, at, c.rawLen);
    next = (block.textContent.slice(at + c.rawLen, at + c.rawLen + 60).match(WORD) || []).slice(0, 3);
  }
  return { wt, sentence, next, cfg: c.root?.__wt || {} };
}

async function activate() {
  const c = current;
  pressing = false;
  if (!c) { hide(); return; }
  const rect = selectionRect(c.range);
  // бульбашка — над словом: виділення вже знято, системного меню над ним більше немає
  const above = true;
  hide();
  // виділення знімаємо (інакше системне меню лишається й закриває бульбашку); позиція — за збереженим діапазоном
  try { window.getSelection()?.removeAllRanges(); } catch { /* */ }
  const token = ++popToken;
  const head = h('div.sel-pop-head', h('b', { lang: 'en' }, c.mode === 'word' ? c.text.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '') : (c.text.length > 80 ? c.text.slice(0, 80) + '…' : c.text)));
  const body = h('div.sel-pop-uk', { role: 'status' }, h('span.dim', 'Перекладаю…'));
  pop.replaceChildren(head, body);
  placeNear(pop, rect, above);
  const { wt, sentence, next, cfg } = await contextOf(c);
  if (token !== popToken) return;
  const { speak } = await import('../speech.js');
  const speakBtn = (t) => h('button.icon-btn.soft.sm', { type: 'button', 'aria-label': `Прослухати: ${t}`, onclick: () => speak(t) }, ic('speaker-high', { size: 18 }));
  const more = h('button.sel-pop-more', { type: 'button', onclick: () => {
    closePop();
    if (c.mode === 'word') wt.lookupText({ text: c.text, sentence, next, gl: cfg.gl, onAsk: cfg.onAsk });
    else wt.translateFragment({ text: c.text, onAsk: cfg.onAsk });
  } }, 'Детальніше', ic('caret-right', { size: 14 }));
  const done = (...parts) => {
    if (token !== popToken) return;
    pop.replaceChildren(...parts.filter(Boolean));
    placeNear(pop, selectionRect(c.range), above);
  };
  try {
    if (c.mode === 'word') {
      const r = await wt.quickLookup({ text: c.text, sentence, next, gl: cfg.gl });
      if (r.none) {
        done(h('div.sel-pop-head', h('b', { lang: 'en' }, c.text), speakBtn(c.text)),
          h('div.sel-pop-uk.dim', r.reason === 'login' ? 'Немає в словнику. AI-переклад — після входу.' : r.reason === 'offline' ? 'Немає в словнику. AI-переклад — з інтернетом.' : 'Не вдалося перекласти'), more);
        return;
      }
      done(h('div.sel-pop-head', h('b', { lang: 'en' }, r.en), speakBtn(r.en)),
        r.ipa ? h('div.sel-pop-ipa', r.ipa) : null,
        h('div.sel-pop-uk', r.uk), more);
    } else {
      const frag = c.text.slice(0, MAX_FRAGMENT);
      const { tutor } = await import('../ai.js');
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { code: 'offline' });
      const r = await tutor('translate', { text: frag, to: 'uk' });
      const uk = String(r?.uk || r?.text || '').trim();
      if (!uk) throw new Error('empty');
      done(h('div.sel-pop-uk.long', uk), more);
    }
  } catch (e) {
    const { aiErrorText } = await import('../ai.js');
    done(head, h('div.sel-pop-uk.dim', aiErrorText(e) || 'Не вдалося перекласти'), more);
  }
}

export function initSelectLookup() {
  if (btn || !window.getSelection) return;
  btn = h('button.sel-q', { type: 'button', hidden: true, 'aria-label': 'Переклад' }, h('span', { 'aria-hidden': 'true' }, '?'));
  // мишею — не знімати виділення і не забирати фокус; дотиком — нічого не блокуємо (інакше не прийде click)
  btn.addEventListener('pointerdown', (e) => { pressing = true; if (e.pointerType === 'mouse') e.preventDefault(); });
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('pointercancel', () => { pressing = false; schedule(); });
  btn.addEventListener('click', activate);
  pop = h('div.sel-pop', { hidden: true, role: 'dialog', 'aria-label': 'Переклад' });
  pop.addEventListener('mousedown', (e) => { if (!e.target.closest('button')) e.preventDefault(); });
  document.body.append(btn, pop);

  document.addEventListener('selectionchange', () => schedule(coarse() ? 260 : 160));
  addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType || 'mouse';
    if (!btn.contains(e.target)) pressing = false;
    if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) closePop();
  }, true);
  addEventListener('pointerup', () => schedule(60), true);
  addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') { lastPointer = 'mouse'; schedule(60); } }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (btn && !btn.hidden) hide(); closePop(); }
    // клавіатура: виділили Shift+стрілками → Alt+↓ (або Alt+L) показує переклад
    if (e.altKey && (e.key === 'ArrowDown' || e.code === 'KeyL') && current && !btn.hidden) { e.preventDefault(); activate(); }
  }, true);
  // прокрутка — сховати; коли зупиниться і виділення лишилось — показати на новому місці
  addEventListener('scroll', (e) => {
    if (pop && !pop.hidden && !pop.contains(e.target)) closePop();
    if (!btn.hidden) btn.hidden = true;
    if (current || window.getSelection()?.toString()) schedule(250);
  }, { capture: true, passive: true });
  addEventListener('resize', () => { closePop(); schedule(120); });
  window.visualViewport?.addEventListener('resize', () => schedule(120));
  window.visualViewport?.addEventListener('scroll', () => { if (!btn.hidden) schedule(120); });
  addEventListener('hashchange', () => { pressing = false; hide(); closePop(); });
}
