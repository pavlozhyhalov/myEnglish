// «Артиклі на швидкість»: 60 секунд, речення з одним пропуском — a / an / the / — (без артикля).
// Миттєвий відгук з поясненням в один рядок; комбо: ×2 від 3 поспіль, ×3 від 6, ×4 від 10. Поки видно пояснення, годинник стоїть.
// Речення — банк data/articles.json (мій рівень і сусідні) + власні помилки учня на артиклі (вчитель, щоденник),
// якщо вони однозначно зводяться до одного пропуску. Гра серій помилок не змінює.
import * as store from '../store.js';
import { h, ic } from '../ui/dom.js';
import { json } from '../data.js';
import { myLevel } from '../level.js';
import { activityTimer, isDisputed } from '../stats.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { bestUpdate, shuffleArr } from './logic.js';
import { tokenDiff, normTok, shortTip } from './detective.js';
import { plural } from '../strings.js';
import { tx, txGroup, txPill } from '../ui/tiles.js';
import { gameState, saveGameState, beep, buzz, reducedMotion, gameHead, statPill, gameIntro, startTile, gameResult, moreRows, bankLevels, seenStore, gapSentence } from './common.js';

export const SECONDS = 60;
export const OPTIONS = [['a', 'a'], ['an', 'an'], ['the', 'the'], ['', '—']];
const OWN_MAX = 8;
const OWN_AT = [1, 3, 6, 9, 12, 15, 18, 21];
const ART = new Set(['a', 'an', 'the']);
const ART_RULES = new Set(['articles-a', 'articles-the', 'articles-extra']);
const OWN_SOURCES = new Set(['tutor', 'diary']);
const LATIN = /^[A-Za-z0-9'’‘,.!?:;"“”()\- —–]+$/;
const DEFAULT_WHY = {
  a: 'Лічильний іменник в однині, згадується вперше або «один із» — a.',
  an: 'Наступне слово починається з голосного звука — an.',
  the: 'Відомо, про що саме йдеться, — the.',
  '': 'Тут артикль не потрібен.',
};
const seen = seenStore('me:articles-seen', 120);

// ---------- Логіка (без DOM) ----------

/** Комбо-множник за кількістю правильних поспіль */
export const comboMult = (combo) => (combo >= 10 ? 4 : combo >= 6 ? 3 : combo >= 3 ? 2 : 1);

const isArt = (t) => /^[A-Za-z]+$/.test(t || '') && ART.has(t.toLowerCase());

/**
 * Власна помилка → речення з одним пропуском, лише якщо різниця між wrong і right — рівно один артикль
 * (зайвий, пропущений або замінений). Інакше null.
 */
export function ownArticleItem(m) {
  if (!m || m.deleted || !ART_RULES.has(m.rule) || !OWN_SOURCES.has(m.source || 'tutor')) return null;
  const w = String(m.wrong || '').trim(), r = String(m.right || '').trim();
  if (!w || !r || !LATIN.test(w) || !LATIN.test(r)) return null;
  const d = tokenDiff(w, r);
  if (d.blocks !== 1 || d.b.length < 3 || d.b.length > 20) return null;
  const diff = d.ops.filter(o => o.op !== 'eq');
  const dels = diff.filter(o => o.op === 'del'), ins = diff.filter(o => o.op === 'ins');
  if (dels.length > 1 || ins.length > 1 || (dels.length && !isArt(d.a[dels[0].i]))) return null;
  const toks = d.b.slice();
  let answer;
  if (ins.length) {
    const t = d.b[ins[0].j];
    if (!isArt(t)) return null;
    answer = t.toLowerCase();
    toks[ins[0].j] = '___';
  } else {
    // зайвий артикль: пропуск — перед словом, яке в правильному реченні стоїть на його місці
    const k = d.ops.indexOf(dels[0]);
    const nextEq = d.ops.slice(k).find(o => o.op === 'eq');
    if (!nextEq) return null;
    answer = '';
    toks.splice(nextEq.j, 0, '___');
  }
  const yours = dels.length ? d.a[dels[0].i].toLowerCase() : '';
  if (yours === answer) return null;
  return { id: 'own:' + m.id, en: toks.join(' '), answer, yours, why_uk: shortTip(m.explanation_uk) || DEFAULT_WHY[answer], level: null, own: true };
}

/** Придатні власні помилки: відкриті першими, частіші вище, без оскаржених і повторів */
export function ownItems(mistakes) {
  const keys = new Set();
  let disputed = () => false;
  try { disputed = isDisputed; } catch { /* */ }
  return mistakes
    .filter(m => !m.deleted && !safe(() => disputed(m.wrong, m.right), false))
    .map(m => ({ m, it: ownArticleItem(m) })).filter(x => x.it)
    .filter(({ it }) => { const k = it.en.split(/\s+/).map(normTok).join(' '); if (keys.has(k)) return false; keys.add(k); return true; })
    .sort((x, y) => (!!x.m.resolved - !!y.m.resolved) || ((y.m.count || 1) - (x.m.count || 1)))
    .map(x => x.it);
}

/**
 * Черга речень на гру: банк мого рівня (~70%) і сусідніх, недавно бачені — в кінці;
 * власні помилки (до 8) — на позиціях 2, 4, 7, 10…; не більше трьох однакових відповідей поспіль.
 */
export function buildQueue(bank, { level = myLevel(), own = [], rng = Math.random, seenIds = new Set(), n = 60 } = {}) {
  const levels = bankLevels(level);
  const sorted = bank.filter(it => levels.includes(it.level))
    .map(it => ({ it, k: rng() + (seenIds.has(it.id) ? 2 : 0) })).sort((a, b) => a.k - b.k).map(x => x.it);
  const mine = sorted.filter(it => it.level === levels[0]), near = sorted.filter(it => it.level !== levels[0]);
  const list = [];
  while ((mine.length || near.length) && list.length < n) list.push(near.length && (!mine.length || rng() < 0.3) ? near.shift() : mine.shift());
  // не більше трьох однакових відповідей поспіль — переставити з дальшої частини черги
  for (let i = 3; i < list.length; i++) {
    const a = list[i].answer;
    if (list[i - 1].answer === a && list[i - 2].answer === a && list[i - 3].answer === a) {
      const j = list.findIndex((x, k) => k > i && x.answer !== a);
      if (j > 0) [list[i], list[j]] = [list[j], list[i]];
    }
  }
  own.slice(0, OWN_MAX).forEach((it, k) => list.splice(Math.min(OWN_AT[k], list.length), 0, it));
  return list;
}

// ---------- Гра ----------

export default async function articles(view) {
  setTitle('Артиклі на швидкість');
  const lv = myLevel();
  let bank = [];
  try { bank = await json('data/articles.json'); } catch { bank = []; }
  const timer = activityTimer('game');
  let disposed = false, game = null;
  const timeouts = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timeouts.delete(t); if (!disposed) fn(); }, ms); timeouts.add(t); return t; };
  const live = h('div.sr-only', { 'aria-live': 'assertive', role: 'status' });
  const body = h('div.stack');
  view.replaceChildren(h('div.stack.games.ar', gameHead(h('span.tag', lv)), body, live));

  const own = () => ownItems(store.all('mistakes'));

  function intro() {
    setFocus(false);
    const best = gameState().best?.articles?.[lv] || 0;
    const ownN = Math.min(own().length, OWN_MAX);
    const start = startTile({ label: 'Почати', sub: `${SECONDS} секунд · a, an, the чи —`, onclick: play, disabled: !bank.length && !ownN });
    body.replaceChildren(gameIntro({
      icon: 'hourglass',
      text: 'Вставте артикль у пропуск — або «—», якщо він не потрібен.',
      rules: [`${SECONDS} секунд — поки читаєте пояснення, час стоїть`, 'Три влучні поспіль — очки ×2, шість — ×3, десять — ×4', 'Клавіші 1–4 обирають варіант'],
      extra: [
        ownN ? tx({ icon: 'target', label: `${ownN} ${plural(ownN, 'речення', 'речення', 'речень')} — з ваших помилок`, sub: 'Трапляться серед перших', wide: true, cls: 'ar-note' }) : null,
        !bank.length && !ownN ? h('p.feedback.no', { style: { margin: 0 } }, 'Не вдалося завантажити речення. Перевірте з\'єднання.') : null],
      best: best ? { label: `Рекорд рівня ${lv}`, value: best } : null,
      start,
    }));
    start.focus({ preventScroll: true });
  }

  function play() {
    setFocus(true);
    const queue = buildQueue(bank, { level: lv, own: own(), seenIds: seen.read() });
    if (!queue.length) return intro();
    let qi = -1, score = 0, combo = 0, maxCombo = 0, hits = 0, answered = 0, cur = null, gap = null, locked = true;
    let left = SECONDS * 1000, last = performance.now(), raf = 0, paused = false;
    const shown = [], misses = [];
    const tPill = statPill('timer', 'Залишилось секунд'), sPill = statPill('star', 'Очки'), cPill = statPill('fire', 'Комбо');
    const bar = h('div.g-wordbar', { 'aria-hidden': 'true' }, h('span'));
    const stage = h('div.ar-stage');
    body.replaceChildren(h('div.row.g-hud', tPill.el, sPill.el, h('div.grow'), cPill.el), bar, stage);
    const drawHud = () => {
      const s = Math.ceil(left / 1000);
      tPill.set(String(s));
      tPill.el.classList.toggle('hurry', s <= 10);
      sPill.set(String(score));
      const mult = comboMult(combo);
      cPill.set(`×${mult}`, `${combo} поспіль, множник ${mult}`);
      cPill.el.classList.toggle('g-hot', mult > 1);
    };

    function next() {
      if (disposed) return;
      if (left <= 0) return end();
      qi++;
      if (qi >= queue.length) { qi = 0; queue.splice(0, queue.length, ...shuffleArr(queue)); }
      cur = queue[qi];
      shown.push(cur);
      gap = gapSentence(cur.en);
      const opts = OPTIONS.map(([v, label], i) => h('button.ar-opt', { type: 'button', dataset: { v }, 'aria-label': v ? `${i + 1}: ${v}` : `${i + 1}: без артикля`, onclick: () => answer(v) },
        h('span.ar-opt-n', { 'aria-hidden': 'true' }, String(i + 1)), h('span.ar-opt-w', label)));
      stage.replaceChildren(
        h('div.card.ar-card',
          h('div.row.ar-ask', h('span.xs.dim.grow', 'Який артикль?'), cur.own ? h('span.tag.accent.ar-src', ic('target', { size: 14 }), 'Ваша помилка') : null),
          gap.el,
          h('div.ar-why', { 'aria-hidden': 'true' })),
        h('div.ar-opts', { role: 'group', 'aria-label': 'Варіанти' }, opts));
      stage.classList.remove('ar-in');
      if (!reducedMotion()) { void stage.offsetWidth; stage.classList.add('ar-in'); }
      live.textContent = cur.en.replace('___', 'пропуск');
      locked = false;
      drawHud();
      if (document.documentElement.classList.contains('kbd')) opts[0].focus({ preventScroll: true });
    }

    function answer(v) {
      if (locked || disposed) return;
      locked = true; answered++;
      const ok = v === cur.answer;
      const opts = [...stage.querySelectorAll('.ar-opt')];
      opts.forEach(b => {
        b.disabled = true;
        if (b.dataset.v === cur.answer) b.classList.add('ok');
        else if (b.dataset.v === v) b.classList.add('no');
      });
      gap.fill(cur.answer, { tone: ok ? 'ok' : 'no', yours: ok ? null : v });
      const why = stage.querySelector('.ar-why');
      why.replaceChildren(ic(ok ? 'check-circle' : 'x-circle', { size: 18 }), h('span', cur.why_uk));
      why.className = 'ar-why ' + (ok ? 'ok' : 'no');
      why.removeAttribute('aria-hidden');
      const card = stage.querySelector('.ar-card');
      card.classList.add(ok ? 'hit' : 'miss');
      if (ok) {
        combo++; hits++; maxCombo = Math.max(maxCombo, combo);
        const gained = 10 * comboMult(combo);
        score += gained;
        const up = comboMult(combo) > comboMult(combo - 1);
        beep(up ? 'win' : 'ok'); buzz(12);
        pop(up ? `×${comboMult(combo)}!` : `+${gained}`, up);
        live.textContent = `Так. ${cur.why_uk}` + (up ? ` Множник ×${comboMult(combo)}` : '');
        drawHud();
        const t = later(next, 1100);
        card.onclick = () => { clearTimeout(t); timeouts.delete(t); next(); };
      } else {
        combo = 0;
        misses.push({ ...cur, picked: v });
        beep('bad'); buzz(60);
        if (!reducedMotion()) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
        live.textContent = `Ні. Правильно: ${cur.answer || 'без артикля'}. ${cur.why_uk}`;
        drawHud();
        const go = h('button.btn.primary.ar-next', { type: 'button' }, 'Далі', ic('arrow-right', { size: 18 }));
        stage.querySelector('.ar-opts').replaceWith(go);
        const t = later(next, Math.min(3600, 1600 + cur.why_uk.length * 16));
        go.onclick = card.onclick = () => { clearTimeout(t); timeouts.delete(t); next(); };
        if (document.documentElement.classList.contains('kbd')) go.focus({ preventScroll: true });
      }
    }

    function pop(text, big) {
      if (reducedMotion()) return;
      const p = h('span.g-pop' + (big ? '.big' : ''), { 'aria-hidden': 'true' }, text);
      stage.append(p);
      later(() => p.remove(), 900);
    }

    const loop = (now) => {
      if (disposed) return;
      const dt = Math.min(250, now - last); last = now;
      // годинник іде лише тоді, коли учень обирає (не під час пояснення)
      if (!paused && !document.hidden && !locked) {
        const before = Math.ceil(left / 1000);
        left -= dt;
        const s = Math.ceil(left / 1000);
        if (s !== before) { drawHud(); if (s <= 5 && s > 0) beep('tick'); }
        if (left <= 0) { left = 0; drawHud(); return end(); }
      }
      bar.firstChild.style.transform = `scaleX(${Math.max(0, left / (SECONDS * 1000))})`;
      bar.classList.toggle('hurry', left < 10000);
      raf = requestAnimationFrame(loop);
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || locked) return;
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); answer(OPTIONS[+e.key - 1][0]); }
    };
    const onVis = () => { paused = document.hidden; last = performance.now(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    const stop = () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); };

    function end() {
      if (game?.ended) return;
      game.ended = true;
      stop();
      locked = true;
      setFocus(false);
      seen.add(shown.filter(it => !it.own).map(it => it.id));
      const st = gameState();
      const upd = bestUpdate(st.best?.articles, lv, score);
      saveGameState({ best: { ...(st.best || {}), articles: upd.best } });
      upd.record ? (beep('win'), buzz([30, 40, 30])) : beep(answered && hits / answered >= 0.7 ? 'ok' : 'lose');
      const acc = answered ? Math.round(hits / answered * 100) : 0;
      body.replaceChildren(gameResult({
        icon: 'hourglass', record: upd.record, score: String(score), unit: plural(score, 'очко', 'очки', 'очок'), sub: verdict(hits, answered),
        kpis: [{ value: `${hits}/${answered}`, label: 'правильно', tone: 'good' }, { value: `${acc}%`, label: 'точність' }, { value: maxCombo, label: 'найдовше комбо' }],
        note: upd.prev && !upd.record ? `Рекорд рівня ${lv}: ${upd.prev}` : null,
        sections: [misses.length
          ? txGroup('Варто повторити', moreRows(dedupe(misses).map(missRow)))
          : answered ? tx({ icon: 'seal-check', label: 'Жодної помилки — артиклі під контролем!', wide: true, tone: 'good' }) : null],
        primary: { icon: 'arrow-clockwise', label: 'Ще раз', sub: `${SECONDS} секунд, нові речення`, onclick: play },
        more: [{ icon: 'game-controller', label: 'Усі ігри', href: '#/games' }],
      }));
      live.textContent = `Час вийшов. Очки: ${score}. Правильно ${hits} з ${answered}.` + (upd.record ? ' Новий рекорд!' : '');
      body.querySelector('.g-again')?.focus({ preventScroll: true });
    }

    game = { ended: false, stop };
    next();
    raf = requestAnimationFrame((t) => { last = t; loop(t); });
  }

  intro();
  return () => {
    disposed = true;
    game?.stop();
    for (const t of timeouts) clearTimeout(t);
    timeouts.clear();
    timer.stop();
    setFocus(false);
  };
}

/** Рядок розбору: речення з правильним артиклем, пояснення, праворуч — ваш варіант */
function missRow(it) {
  const g = gapSentence(it.en, { tag: 'span' });
  g.fill(it.answer, { tone: 'ok' });
  const pill = txPill(it.picked || '—', 'bad');
  pill.setAttribute('aria-label', `Ваш варіант: ${it.picked || 'без артикля'}`);
  return h('div.tx-row.ar-miss',
    h('span.tx-sq', ic(it.own ? 'target' : 'x-circle', { size: 18 })),
    h('span.tx-body', h('span.tx-l', g.el), h('span.tx-s', it.why_uk)),
    pill);
}

const dedupe = (list) => { const s = new Set(); return list.filter(it => (s.has(it.id) ? false : s.add(it.id))); };

function verdict(hits, n) {
  if (!n) return 'Час вийшов';
  const p = hits / n;
  if (p === 1) return 'Бездоганно';
  if (p >= 0.8) return 'Чудове чуття артиклів';
  if (p >= 0.5) return 'Добре — є над чим попрацювати';
  return 'Артиклі хитрі — спробуйте ще раз';
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
