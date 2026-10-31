// Спільне для ігор: слова рівня, звуки й вібрація, рекорди (локально + profiles.data.games), «Додати в мої слова».
import * as store from '../store.js';
import * as srs from '../srs.js';
import { deckIndex, withCards, json } from '../data.js';
import { myLevel, LEVELS } from '../level.js';
import { h, ic } from '../ui/dom.js';
import { mergeBest } from './logic.js';

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
export function setMuted(on) { const s = readLocal(); s.mute = !!on; writeLocal(s); }
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
    b.setAttribute('aria-label', m ? 'Увімкнути звуки гри' : 'Вимкнути звуки гри');
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

/** Кнопка «Додати в мої слова» для слова гри */
export function addWordButton(w, { small = true } = {}) {
  const b = h('button.btn' + (small ? '.sm' : '') + '.soft', { type: 'button' });
  const draw = (on) => { b.replaceChildren(ic(on ? 'check' : 'plus', { size: 16 }), on ? 'У ваших словах' : 'Додати в мої слова'); b.disabled = on; b.setAttribute('aria-label', on ? `${w.en}: уже у ваших словах` : `Додати «${w.en}» в мої слова`); };
  b.onclick = () => {
    srs.addCard({ en: w.en, uk: w.uk, ipa: w.ipa || null, examples: w.ex ? [{ en: w.ex, uk: w.exUk || '' }] : [], tags: ['game'], extra: { source: 'games' } });
    draw(true);
  };
  draw(inMyWords(w.en));
  return b;
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
