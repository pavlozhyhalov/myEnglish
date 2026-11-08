// Спільне для ігор: слова рівня, звуки й вібрація, рекорди (локально + profiles.data.games), «Додати в мої слова».
import * as store from '../store.js';
import * as srs from '../srs.js';
import { deckIndex, withCards, json } from '../data.js';
import { myLevel, LEVELS } from '../level.js';
import { h, ic } from '../ui/dom.js';
import { tx, txPrimary, txKpis, txGroup, txRows, txRow, txGrid, txResult, txLogin } from '../ui/tiles.js';
import { mergeBest } from './logic.js';
import { speak, stop as stopSpeech } from '../speech.js';

const LS = 'me:games';

// ---------- Стан ігор ----------
function readLocal() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function writeLocal(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* приватний режим */ } }

/** Рекорди й статистика: локальні, об'єднані з профілем (інший пристрій) */
export function gameState() {
  const local = readLocal();
  const prof = store.prof().games || {};
  return { ...local, best: mergeBest(local.best || {}, prof.best || {}), wordle: pickWordle(local.wordle, prof.wordle) };
}
const pickWordle = (a, b) => (!a ? b : !b ? a : ((b.played || 0) > (a.played || 0) ? b : a)) || null;

/** Зберегти частину стану: рекорди й статистика «Слова дня» синхронізуються з профілем */
export function saveGameState(patch) {
  const s = { ...readLocal(), ...patch };
  writeLocal(s);
  const synced = {};
  if (patch.best) synced.best = mergeBest(store.prof().games?.best || {}, patch.best);
  if (patch.wordle) synced.wordle = patch.wordle;
  if (Object.keys(synced).length) store.setProf({ games: { ...(store.prof().games || {}), ...synced } });
}

// ---------- Звук і вібрація ----------
export const muted = () => !!readLocal().mute;
export function setMuted(on) { const s = readLocal(); s.mute = !!on; writeLocal(s); if (on) { try { stopSpeech(); } catch { /* */ } } }
/** Автоматична озвучка в грі (після відповіді) — мовчить, якщо звук гри вимкнено. Кнопки «Прослухати» працюють завжди. */
export function autoSpeak(text) { if (muted() || !text) return Promise.resolve(); return speak(text).catch(() => {}); }
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let ctx = null;
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}
const TONES = {
  ok: [[660, 0, 0.08], [880, 0.07, 0.1]],
  bad: [[220, 0, 0.16]],
  key: [[1200, 0, 0.02]],
  tick: [[900, 0, 0.03]],
  win: [[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.1], [1047, 0.27, 0.18]],
  lose: [[392, 0, 0.14], [311, 0.13, 0.22]],
};
/** Тихий сигнал (WebAudio); вимикається кнопкою звуку в грі */
export function beep(kind) {
  if (muted()) return;
  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  const t0 = ac.currentTime + 0.01;
  for (const [f, at, dur] of TONES[kind] || []) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = kind === 'bad' || kind === 'lose' ? 'triangle' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(kind === 'key' || kind === 'tick' ? 0.025 : 0.06, t0 + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
  }
}
export function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* */ } }

/** Кнопка «звук увімк./вимк.» */
export function muteButton() {
  const b = h('button.icon-btn', { type: 'button' });
  const draw = () => {
    const m = muted();
    b.replaceChildren(ic(m ? 'speaker-slash' : 'speaker-high'));
    b.setAttribute('aria-label', m ? 'Увімкнути звуки й озвучку гри' : 'Вимкнути звуки й озвучку гри');
    b.setAttribute('aria-pressed', String(m));
  };
  b.onclick = () => { setMuted(!muted()); draw(); if (!muted()) beep('tick'); };
  draw();
  return b;
}

// ---------- Слова ----------
const isGeneral = (d) => d.group !== 'work' || store.settings().workFocus;

/**
 * Слова для гри: колоди мого рівня (і сусіднього, щоб вистачило на дистрактори) + картки, які зараз вчаться
 * або чекають повтору (priority). Вантажаться лише потрібні колоди.
 * Повертає { pool: [{ id, en, uk, ex, exUk, ipa, level, deck_id }], priority: [...], level }
 */
export async function wordPool({ level = myLevel(), neighbours = true } = {}) {
  const idx = (await deckIndex()).filter(isGeneral);
  const r = LEVELS.indexOf(level);
  const near = neighbours ? new Set([level, LEVELS[r - 1] || LEVELS[r + 1]]) : new Set([level]);
  let metas = idx.filter(d => near.has(d.level));
  if (!metas.length) metas = idx.filter(d => d.level === level);
  const decks = await withCards(metas);
  const pool = [];
  for (const d of decks) for (const c of d.cards) {
    if (!c.en || !c.uk) continue;
    pool.push({ id: srs.starterId(d.id, c.en), en: c.en, uk: c.uk, ex: c.ex || '', exUk: c.exUk || '', ipa: c.ipa || '', level: d.level, deck_id: d.id, mine: d.level === level });
  }
  return { pool, priority: learningCards(), level };
}

/** Картки, що вчаться (state 1/3) або чекають повтору сьогодні */
export function learningCards(now = Date.now()) {
  return store.all('cards').filter(c => c.en && c.uk && c.reps > 0 && (c.state === 1 || c.state === 3 || (c.due && Date.parse(c.due) <= now)))
    .map(c => ({ id: c.id, en: c.en, uk: c.uk, ex: c.examples?.[0]?.en || '', exUk: c.examples?.[0]?.uk || '', ipa: c.ipa || '', level: null, deck_id: c.deck_id, own: true }));
}

export const words5 = () => json('data/words5.json');

/** Чи слово вже серед карток користувача */
export function inMyWords(en) {
  const k = String(en || '').trim().toLowerCase();
  return store.all('cards').some(c => String(c.en).trim().toLowerCase() === k);
}

/** Кнопка «Додати в мої слова» для слова гри; compact — квадратна кнопка-іконка для рядка-плитки */
export function addWordButton(w, { small = true, compact = false } = {}) {
  const b = h('button.btn' + (small ? '.sm' : '') + '.soft' + (compact ? '.g-add' : ''), { type: 'button' });
  const draw = (on) => {
    b.replaceChildren(ic(on ? 'check' : 'plus', { size: compact ? 18 : 16 }), compact ? '' : (on ? 'У ваших словах' : 'Додати в мої слова'));
    b.disabled = on;
    b.setAttribute('aria-label', on ? `${w.en}: уже у ваших словах` : `Додати «${w.en}» в мої слова`);
    if (compact) b.title = on ? 'У ваших словах' : 'Додати в мої слова';
  };
  b.onclick = () => {
    srs.addCard({ en: w.en, uk: w.uk, ipa: w.ipa || null, examples: w.ex ? [{ en: w.ex, uk: w.exUk || '' }] : [], tags: ['game'], extra: { source: 'games' } });
    draw(true);
  };
  draw(inMyWords(w.en));
  return b;
}

/** Плитка «Додати в мої слова» (для сітки дій) */
export function addWordTile(w) {
  let el;
  const draw = (on) => {
    const next = tx({ icon: on ? 'check' : 'plus', label: on ? 'У ваших словах' : 'Додати в мої слова', sub: on ? 'картка вже є' : 'картка для повторів', onclick: add, disabled: on, tone: on ? 'good' : '',
      attrs: { 'aria-label': on ? `${w.en}: уже у ваших словах` : `Додати «${w.en}» в мої слова` } });
    if (el) { next.style.cssText = el.style.cssText; next.className = next.className + (el.classList.contains('wide') ? ' wide' : ''); el.replaceWith(next); }
    el = next;
  };
  function add() {
    srs.addCard({ en: w.en, uk: w.uk, ipa: w.ipa || null, examples: w.ex ? [{ en: w.ex, uk: w.exUk || '' }] : [], tags: ['game'], extra: { source: 'games' } });
    draw(true);
    el.focus({ preventScroll: true });
  }
  draw(inMyWords(w.en));
  return el;
}

// ---------- Екрани гри в мові плиток: вступ, підсумок, рядки слів ----------
/**
 * Вступ гри (по полочках): коротка суть з іконкою й рекордом праворуч → одна синя дія «Почати» вгорі → правила рядками з номерами.
 * o: { icon, text (один рядок; можна null), rules: [], top: [вузли над стартом], extra: [вузли під стартом], best: { label, value } | null, start (вузол) }
 */
export function gameIntro({ icon, text, rules = [], top = [], extra = [], best = null, start = null }) {
  const bestEl = best ? h('span.g-lead-best', { 'aria-label': `${best.label}: ${best.value}` },
    h('span.g-lead-best-n.num', String(best.value)), h('span.g-lead-best-l', 'рекорд')) : null;
  return h('div.stack-lg.g-intro',
    text ? h('div.g-lead', h('span.tx-sq.g-lead-sq', ic(icon, { size: 22 })), h('p.g-lead-t', text), bestEl) : null,
    ...[].concat(top).filter(Boolean),
    start,
    ...[].concat(extra).filter(Boolean),
    !text && best ? tx({ icon: 'trophy', label: best.label, wide: true, cls: 'g-best', end: h('b.num.g-best-n', String(best.value)) }) : null,
    rules.length ? txGroup('Правила', txRows(rules.map((r, i) => txRow({ no: i + 1, label: r })))) : null);
}

/** Головна дія вступу: синя плитка «Почати» (кнопка) */
export const startTile = ({ label = 'Почати', sub = null, icon = 'play', onclick, disabled = false }) =>
  txPrimary({ icon, label, sub, onclick, disabled, cls: 'g-start' });

/**
 * Підсумок гри: спільна шапка txResult (очки — у заголовку), цифри плитками, далі секції, одна синя дія і плитки «що далі».
 * o: { icon, record, score (рядок або вузол), unit, sub, kpis: [{value,label,tone}], note, sections: [], primary: {icon,label,onclick|href}, more: [{icon,label,sub,onclick|href}] }
 */
export function gameResult({ icon = 'flag', record = false, score, unit = null, sub = '', kpis = [], note = null, sections = [], primary, more = [] }) {
  const list = more.filter(Boolean);
  // по полочках: квадратик + рахунок → цифри → одна синя дія «Ще раз» → розбір → інші дії внизу
  return h('div.stack-lg.g-end',
    txResult({
      icon: record ? 'trophy' : icon, tone: record ? 'good' : 'accent', label: record ? 'Новий рекорд!' : 'Результат',
      title: h('span', h('span.num', score), unit ? (/^\s/.test(unit) ? unit : ' ' + unit) : null), sub }),
    // нуль — без зеленого «успіху»
    kpis.length ? txKpis(kpis.map(k => (k.tone === 'good' && /^0(\/|%|$)/.test(String(k.value)) ? { ...k, tone: '' } : k))) : null,
    note ? h('p.xs.dim.g-note', note) : null,
    primary ? txPrimary({ ...primary, cls: 'g-again' }) : null,
    ...sections.filter(Boolean),
    list.length ? h('div.stack.g-next', list.length === 1 ? tx({ ...list[0], wide: true }) : txGrid(list.map(tx), 2)) : null);
}

/** Довгий список рядків: перші 6, решта — за рядком «Показати всі · N» */
export function moreRows(rows, n = 6) {
  const list = rows.filter(Boolean);
  if (list.length <= n) return txRows(list);
  list.forEach((r, i) => { if (i >= n) r.hidden = true; });
  const box = txRows(list);
  const more = txRow({ icon: 'caret-down', label: `Показати всі · ${list.length}`, cls: 'gx-more', chevron: false,
    attrs: { 'aria-expanded': 'false' }, onclick: () => { list.forEach(r => { r.hidden = false; }); more.remove(); } });
  box.append(more);
  return box;
}

/** Рядок-плитка зі словом: квадратик «прослухати», слово й переклад, праворуч — довільний вузол */
export function wordRow({ en, uk, end = null, cls = '' }) {
  return h('div.tx-row.g-wrow' + (cls ? '.' + cls : ''),
    h('button.tx-sq.g-spk', { type: 'button', 'aria-label': `Прослухати ${en}`, onclick: () => speak(en) }, ic('speaker-high', { size: 18 })),
    h('span.tx-body', h('span.tx-l', { lang: 'en' }, en), uk ? h('span.tx-s', uk) : null),
    end);
}

/** Лічильник очок/таймер у шапці гри */
export function statPill(icon, label) {
  const val = h('span.num');
  const el = h('div.g-pill', { 'aria-label': label, role: 'img' }, ic(icon, { size: 18 }), val);
  return { el, set(v, aria) { val.textContent = v; el.setAttribute('aria-label', `${label}: ${aria ?? v}`); } };
}

/** Рядок над грою: «до ігор», рівень, вимикач звуку (назва гри — у шапці застосунку) */
export function gameHead(extra) {
  return h('div.g-head',
    h('a.btn.ghost.sm.g-back', { href: '#/games' }, ic('arrow-left', { size: 18 }), 'Усі ігри'),
    h('div.grow'), extra || null, muteButton());
}

// ---------- Мовні ігри: вхід, мікрофон, кільце відліку, індикатор гучності ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/** «Потрібен вхід» для ігор, де мовлення розпізнає AI */
export function gameLoginCard(text) {
  return h('div.stack.g-login',
    txLogin('Потрібен вхід в акаунт', text),
    tx({ icon: 'game-controller', label: 'Інші ігри', href: '#/games', wide: true }));
}

const MIC_ERR = {
  denied: ['Немає дозволу на мікрофон', [
    'На iPhone: Параметри → Програми → Safari → Мікрофон → «Дозволити» (в iOS 17 і раніше — Параметри → Safari → Мікрофон).',
    'Або в Safari: «аА» в адресному рядку → Параметри вебсайту → Мікрофон → «Дозволити».',
    'У Chrome: значок замка біля адреси → Мікрофон → «Дозволити».']],
  missing: ['Мікрофон не знайдено', ['Під\'єднайте навушники з мікрофоном або перевірте, чи мікрофон не вимкнено в системі.']],
  busy: ['Мікрофон зайнятий', ['Його використовує інша програма — дзвінок, диктофон, інша вкладка. Закрийте її і спробуйте ще раз.']],
  unsupported: ['Запис звуку недоступний', ['Цей браузер не вміє записувати звук. Оновіть iOS або відкрийте застосунок у Safari чи Chrome.']],
  other: ['Не вдалося ввімкнути мікрофон', ['Спробуйте ще раз. Якщо не допоможе — перезапустіть застосунок.']],
};
/** Картка помилки мікрофона; kind — з micErrorKind() (js/fluency.js) */
export function micErrorCard(kind, onRetry) {
  const [title, lines] = MIC_ERR[kind] || MIC_ERR.other;
  return h('section.stack.g-err', { role: 'alert' },
    h('div.tx.wide.bad.g-err-tile',
      h('span.tx-sq', ic('microphone-slash', { size: 20 })),
      h('span.tx-body', h('span.tx-l', title), lines.map(l => h('span.tx-s', l)))),
    onRetry && kind !== 'unsupported' ? txPrimary({ icon: 'arrow-clockwise', label: 'Спробувати ще раз', onclick: onRetry }) : null);
}

/** Кільце відліку: { el, set(leftMs, totalMs) } — секунди в центрі, останні 5 с — попереджувальний колір */
export function countdownRing(size = 168, stroke = 10, sub = 'секунд') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const s = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  const mk = (cls) => svgEl('circle', { class: cls, cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': 0, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const bar = mk('g-ring-bar');
  s.append(mk('g-ring-track'), bar);
  const secEl = h('b.g-ring-sec.num', '0');
  const el = h('div.g-ring', { style: { width: size + 'px', height: size + 'px' } }, s, h('div.g-ring-in', secEl, h('span.g-ring-sub', sub)));
  let lastSec = -1;
  return {
    el,
    set(left, total) {
      bar.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, left / total)))));
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) { lastSec = sec; secEl.textContent = String(sec); el.classList.toggle('low', sec <= 5); }
    },
  };
}

/** Індикатор гучності мікрофона: стовпчики, що біжать праворуч наліво */
export function levelMeter(n = 14) {
  const bars = Array.from({ length: n }, () => h('i'));
  const el = h('div.g-meter', { 'aria-hidden': 'true' }, bars);
  const hist = new Array(n).fill(0);
  let t = 0;
  return {
    el,
    push(level, voiced) {
      const now = performance.now();
      if (now - t < (reducedMotion() ? 250 : 90)) return;
      t = now;
      hist.shift(); hist.push(level < 0 ? 0 : level);
      bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.15, hist[i]).toFixed(3)})`; });
      el.classList.toggle('on', !!voiced);
      el.classList.toggle('none', level < 0);
    },
  };
}
