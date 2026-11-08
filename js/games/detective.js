// «Детектив помилок»: речення з'являється словами-фішками — за 5 секунд торкніться слова з помилкою
// або «Без помилок», якщо речення правильне (~25% раундів). Комбо: ×2 від 3 поспіль, ×3 від 6.
// Речення — з власних помилок учня (відкриті й правила тижня першими) і з банку data/detective.json (мій рівень і сусідні).
// Гра лише тренує впізнавання: серії помилок (mistakeHit / logRulePractice) не змінюються.
import * as store from '../store.js';
import { h, ic } from '../ui/dom.js';
import { json } from '../data.js';
import { myLevel } from '../level.js';
import { activityTimer, isDisputed } from '../stats.js';
import { ruleLabel } from '../rules.js';
import { focusRules } from '../focus.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { bestUpdate, shuffleArr } from './logic.js';
import { plural } from '../strings.js';
import { tx, txGroup, txRows, txPill } from '../ui/tiles.js';
import { gameState, saveGameState, beep, buzz, reducedMotion, gameHead, statPill, gameIntro, startTile, gameResult } from './common.js';

export const ROUNDS = 15;
export const OWN_SHARE = 0.6;
const BASE_MS = 5000;
const SEEN_KEY = 'me:detective-seen';
const BANK_LEVELS = { A1: ['A2'], A2: ['A2', 'B1'], B1: ['B1', 'A2', 'B2'], B2: ['B2', 'B1'], C1: ['B2', 'B1'] };

// ---------- Логіка (чиста, без DOM) ----------

/** Слова речення як фішки: розділові знаки лишаються при слові; «—» тощо приклеюються до попереднього */
export function tokensOf(s) {
  const out = [];
  for (const t of String(s || '').trim().split(/\s+/)) {
    if (!t) continue;
    if (!normTok(t) && out.length) out[out.length - 1] += ' ' + t;
    else out.push(t);
  }
  return out;
}
/** Нормалізація слова для порівняння: регістр, типографські апострофи й розділові знаки не важать */
export const normTok = (t) => String(t || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');

/**
 * Порівняння неправильного й правильного речення за найдовшою спільною підпослідовністю слів.
 * Повертає ops [{ op: 'eq'|'del'|'ins', i?, j? }] (i — індекс у wrong, j — у right),
 * target — індекс слова з помилкою в wrong (або -1, якщо різниці немає), alt — інші індекси, які теж зараховуються,
 * missing — у wrong бракує слова (target — слово перед пропуском), blocks — скільки окремих місць відрізняються.
 */
export function tokenDiff(wrong, right) {
  const a = tokensOf(wrong), b = tokensOf(right);
  const A = a.map(normTok), B = b.map(normTok);
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) ops.push({ op: 'eq', i: i++, j: j++ });
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) ops.push({ op: 'del', i: i++ });
    else ops.push({ op: 'ins', j: j++ });
  }
  let blocks = 0;
  ops.forEach((o, k) => { if (o.op !== 'eq' && (k === 0 || ops[k - 1].op === 'eq')) blocks++; });
  const k0 = ops.findIndex(o => o.op !== 'eq');
  const res = { a, b, ops, blocks, target: -1, alt: [], missing: false };
  if (k0 < 0) return res;
  const block = [];
  for (let k = k0; k < ops.length && ops[k].op !== 'eq'; k++) block.push(ops[k]);
  const del = block.find(o => o.op === 'del');
  if (del) { res.target = del.i; return res; }
  // бракує слова: позиція пропуску — перше слово wrong після блоку
  const after = ops.slice(k0).find(o => o.op !== 'ins');
  const gap = after ? after.i : n;
  res.missing = true;
  res.target = Math.max(0, gap - 1);
  if (gap > 0 && gap < n) res.alt = [gap];
  return res;
}

/** Комбо-множник за кількістю правильних поспіль (з урахуванням поточної відповіді) */
export const comboMult = (combo) => (combo >= 6 ? 3 : combo >= 3 ? 2 : 1);
/** Очки: 10 × множник + бонус за швидкість до 5 */
export const roundPoints = (combo, msLeft, msTotal) => 10 * comboMult(combo) + Math.round(5 * Math.max(0, Math.min(1, msTotal ? msLeft / msTotal : 0)));
/** Час на раунд: 5 с; довгим реченням (понад 8 слів) — +0,3 с за слово, до 8 с */
export const roundMs = (words) => Math.min(8000, BASE_MS + Math.max(0, words - 8) * 300);

const LATIN = /^[A-Za-z0-9'’‘,.!?:;"“”()\- —–]+$/;
/** Чи придатна власна помилка для гри: обидва речення латиницею, wrong ≥ 3 слів, різниця знаходиться */
export function ownCandidate(m) {
  if (!m || m.deleted || !m.wrong || !m.right || m.wrong === '—' || m.type === 'pronunciation') return null;
  const w = String(m.wrong).trim(), r = String(m.right).trim();
  if (!LATIN.test(w) || !LATIN.test(r)) return null;
  const n = tokensOf(w).length;
  if (n < 3 || n > 18) return null;
  const d = tokenDiff(w, r);
  if (d.target < 0) return null;
  return { m, w, r, d };
}

/** Одна підказка з пояснення: перше речення без розмітки, до 120 знаків */
export function shortTip(text) {
  let t = String(text || '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const end = t.search(/[.!?](\s|$)/);
  if (end > 0 && end < 140) t = t.slice(0, end + 1);
  if (t.length > 120) t = t.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  return t;
}

// ---------- Набір раундів ----------

function readSeen() { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } }
function writeSeen(ids) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-70))); } catch { /* приватний режим */ } }

function ownPool(focus) {
  const fr = (rule) => { const i = focus.indexOf(rule); return i < 0 ? focus.length : i; };
  let disputed = () => false;
  try { disputed = (w, r) => isDisputed(w, r); } catch { /* */ }
  const seen = new Set();
  return store.all('mistakes')
    .map(ownCandidate).filter(Boolean)
    .filter(c => { const k = normTok(c.w) + '|' + c.d.a.map(normTok).join(' '); if (seen.has(k) || disputed(c.w, c.r)) return false; seen.add(k); return true; })
    .map(c => ({ ...c, key: (c.m.resolved ? 100 : 0) + fr(c.m.rule) * 10 + Math.random() * 4 - Math.min(3, (c.m.count || 1) - 1) }))
    .sort((x, y) => x.key - y.key);
}

function roundFromOwn(c, asCorrect) {
  const rule = c.m.rule || null;
  if (asCorrect) {
    const toks = tokensOf(c.r);
    return { src: 'own', correct: true, tokens: toks, target: -1, alt: [], missing: false, ops: toks.map((_, i) => ({ op: 'eq', i })), a: toks, b: toks,
      fix: c.r, rule, tip: 'Це ваше виправлене речення — тут усе правильно.', id: c.m.id };
  }
  return { src: 'own', correct: false, tokens: c.d.a, target: c.d.target, alt: c.d.alt, missing: c.d.missing, ops: c.d.ops, a: c.d.a, b: c.d.b,
    fix: c.r, rule, tip: shortTip(c.m.explanation_uk), id: c.m.id };
}

function roundFromBank(it) {
  if (it.wrong < 0) {
    const toks = tokensOf(it.s);
    return { src: 'bank', correct: true, tokens: toks, target: -1, alt: [], missing: false, ops: toks.map((_, i) => ({ op: 'eq', i })), a: toks, b: toks, fix: it.s, rule: it.rule, tip: it.tip, id: it.id };
  }
  const d = tokenDiff(it.s, it.fix);
  return { src: 'bank', correct: false, tokens: d.a, target: d.target, alt: d.alt, missing: d.missing, ops: d.ops, a: d.a, b: d.b, fix: it.fix, rule: it.rule, tip: it.tip, id: it.id };
}

/**
 * 15 раундів: власні помилки — до 60% (деякі як правильні речення з right), решта — банк мого рівня й сусідніх;
 * ~25% правильних речень; без повторів у грі; недавно бачені з банку — в кінці черги.
 */
export function buildRounds(bank, { level = myLevel(), focus = [], own = [], rng = Math.random, n = ROUNDS } = {}) {
  const wantCorrect = Math.round(n * 0.25) + (rng() < 0.3 ? -1 : 0);
  const ownTake = own.slice(0, Math.round(n * OWN_SHARE));
  const rounds = [];
  const used = new Set();
  // з власних: кожна четверта (з правильним right ≥ 3 слів) — як правильне речення
  let ownCorrect = 0;
  ownTake.forEach((c, k) => {
    const asCorrect = k % 4 === 3 && ownCorrect < wantCorrect && tokensOf(c.r).length >= 3 && !used.has(tokensOf(c.r).map(normTok).join(' '));
    if (asCorrect) ownCorrect++;
    const r = roundFromOwn(c, asCorrect);
    used.add(r.tokens.map(normTok).join(' '));
    rounds.push(r);
  });
  const levels = BANK_LEVELS[level] || BANK_LEVELS.B1;
  const seen = new Set(readSeen());
  const score = (it) => rng() * 1.4 + (seen.has(it.id) ? 3 : 0) - (focus.includes(it.rule) ? 0.6 : 0);
  // схожі речення (банк «It depends of the weather.» і власне «It depends on the weather tomorrow») в одній грі не зустрічаються
  const ownText = own.flatMap(c => [c.w, c.r]).map(t => ' ' + tokensOf(t).map(normTok).join(' ') + ' ');
  const similar = (it) => [it.s, it.fix].some(t => { const k = ' ' + tokensOf(t).map(normTok).join(' ') + ' '; return ownText.some(o => o.includes(k) || k.includes(o)); });
  const sorted = bank.filter(it => levels.includes(it.level) && !used.has(tokensOf(it.s).map(normTok).join(' ')) && !similar(it))
    .map(it => ({ it, k: score(it) })).sort((x, y) => x.k - y.k).map(x => x.it);
  // ~70% — мій рівень, ~30% — сусідні (для A1 і C1 — найближчі рівні банку)
  const mine = sorted.filter(it => it.level === levels[0]), near = sorted.filter(it => it.level !== levels[0]);
  const cand = [];
  while (mine.length || near.length) cand.push((near.length && (!mine.length || rng() < 0.3)) ? near.shift() : mine.shift());
  const needCorrect = Math.max(0, wantCorrect - ownCorrect);
  const needErr = Math.max(0, n - rounds.length - needCorrect);
  const perRule = new Map();
  const pick = (list, count) => {
    const out = [];
    for (const pass of [2, 99]) for (const it of list) {
      if (out.length >= count) break;
      if (out.includes(it) || (perRule.get(it.rule) || 0) >= pass) continue;
      perRule.set(it.rule, (perRule.get(it.rule) || 0) + 1);
      out.push(it);
    }
    return out;
  };
  const bankPicked = [...pick(cand.filter(it => it.wrong < 0), needCorrect), ...pick(cand.filter(it => it.wrong >= 0), needErr)];
  // якщо правильних у банку забракло — добрати помилковими (і навпаки)
  if (rounds.length + bankPicked.length < n) bankPicked.push(...pick(cand.filter(it => !bankPicked.includes(it)), n - rounds.length - bankPicked.length));
  rounds.push(...bankPicked.map(roundFromBank));
  return arrange(rounds.slice(0, n), rng);
}

/** Перемішати: перший раунд — з помилкою, не більше двох правильних поспіль */
function arrange(list, rng) {
  let best = shuffleArr(list, rng);
  const ok = (l) => (!l.length || !l[0].correct) && !l.some((r, i) => i >= 2 && r.correct && l[i - 1].correct && l[i - 2].correct);
  for (let k = 0; k < 20 && !ok(best); k++) best = shuffleArr(list, rng);
  return best;
}

// ---------- Гра ----------

export default async function detective(view) {
  setTitle('Детектив помилок');
  const lv = myLevel();
  let bank = [];
  try { bank = await json('data/detective.json'); } catch { bank = []; }
  const timer = activityTimer('game');
  let disposed = false, game = null;
  const timeouts = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timeouts.delete(t); if (!disposed) fn(); }, ms); timeouts.add(t); return t; };
  const live = h('div.sr-only', { 'aria-live': 'assertive', role: 'status' });
  const body = h('div.stack');
  view.replaceChildren(h('div.stack.games.dt', gameHead(h('span.tag', lv)), body, live));

  function intro() {
    setFocus(false);
    const focus = safe(focusRules, []);
    const own = ownPool(focus);
    const best = gameState().best?.detective?.[lv] || 0;
    const ownN = Math.min(own.length, Math.round(ROUNDS * OWN_SHARE));
    const start = startTile({ label: 'Почати', sub: `${ROUNDS} речень · по 5 секунд`, onclick: play, disabled: !bank.length && !own.length });
    body.replaceChildren(gameIntro({
      icon: 'magnifying-glass',
      text: 'Торкніться слова з помилкою — або «Без помилок».',
      rules: [`${ROUNDS} речень, на кожне — 5 секунд`, 'Три влучні поспіль — очки ×2, шість — ×3', 'Якщо бракує слова — торкніться слова перед пропуском'],
      extra: [
        ownN ? tx({ icon: 'target', label: `${ownN} ${plural(ownN, 'речення', 'речення', 'речень')} — з ваших помилок`, sub: focus.length ? 'Правила тижня — першими' : 'Решта — з банку речень вашого рівня', wide: true, cls: 'dt-note' }) : null,
        !bank.length && !own.length ? h('p.feedback.no', { style: { margin: 0 } }, 'Не вдалося завантажити речення. Перевірте з\'єднання.') : null],
      best: best ? { label: `Рекорд рівня ${lv}`, value: best } : null,
      start,
    }));
    start.focus({ preventScroll: true });
  }

  function play() {
    setFocus(true);
    const focus = safe(focusRules, []);
    const rounds = buildRounds(bank, { level: lv, focus, own: ownPool(focus) });
    if (!rounds.length) return intro();
    writeSeen([...readSeen().filter(id => !rounds.some(r => r.id === id)), ...rounds.filter(r => r.src === 'bank').map(r => r.id)]);
    let ri = -1, score = 0, combo = 0, maxCombo = 0, hits = 0, cur = null, locked = true, left = 0, total = 0, raf = 0, last = performance.now(), paused = false;
    const misses = [];
    const rPill = statPill('magnifying-glass', 'Речення'), sPill = statPill('star', 'Очки'), cPill = statPill('fire', 'Комбо');
    const bar = h('div.dt-bar', { 'aria-hidden': 'true' }, h('span'));
    const stage = h('div.dt-stage');
    body.replaceChildren(h('div.row.g-hud', rPill.el, sPill.el, h('div.grow'), cPill.el), bar, stage);
    const drawHud = () => {
      rPill.set(`${Math.min(ri + 1, rounds.length)}/${rounds.length}`, `${Math.min(ri + 1, rounds.length)} з ${rounds.length}`);
      sPill.set(String(score));
      const mult = comboMult(combo);
      cPill.set(`×${mult}`, `${combo} поспіль, множник ${mult}`);
      cPill.el.classList.toggle('dt-hot', mult > 1);
    };

    function next() {
      if (disposed) return;
      ri++;
      if (ri >= rounds.length) return end();
      cur = rounds[ri];
      total = left = roundMs(cur.tokens.length);
      locked = false;
      const chips = cur.tokens.map((t, i) => h('button.dt-chip', { type: 'button', lang: 'en', dataset: { i }, onclick: () => answer(i) }, t));
      const none = h('button.btn.dt-none', { type: 'button', onclick: () => answer(-1) }, ic('seal-check', { size: 20 }), 'Без помилок');
      const src = cur.src === 'own' ? h('span.tag.accent.dt-src', ic('target', { size: 14 }), 'Ваша помилка') : null;
      stage.replaceChildren(
        h('div.card.dt-card',
          h('div.row.dt-ask', h('span.xs.dim.grow', 'Де помилка?'), src),
          h('div.dt-sent', { role: 'group', 'aria-label': 'Слова речення' }, chips)),
        none);
      stage.classList.remove('dt-in');
      if (!reducedMotion()) { void stage.offsetWidth; stage.classList.add('dt-in'); }
      live.textContent = `Речення ${ri + 1}: ${cur.tokens.join(' ')}`;
      drawHud();
      if (document.documentElement.classList.contains('kbd')) chips[0]?.focus({ preventScroll: true });
    }

    function answer(idx, timeout = false) {
      if (locked || disposed) return;
      locked = true;
      const ok = cur.correct ? idx === -1 : (idx === cur.target || cur.alt.includes(idx));
      const chips = [...stage.querySelectorAll('.dt-chip')];
      const none = stage.querySelector('.dt-none');
      chips.forEach(b => { b.disabled = true; });
      if (none) none.disabled = true;
      if (ok) {
        combo++; hits++; maxCombo = Math.max(maxCombo, combo);
        const gained = roundPoints(combo, left, total);
        score += gained;
        const up = comboMult(combo) > comboMult(combo - 1);
        beep(up ? 'win' : 'ok'); buzz(12);
        if (cur.correct) { none?.classList.add('ok'); chips.forEach(b => b.classList.add('clean')); }
        else chips[idx]?.classList.add('ok');
        pop(up ? `×${comboMult(combo)}!` : `+${gained}`, up);
        flash('ok');
        live.textContent = (cur.correct ? 'Так, без помилок.' : 'Влучно!') + (up ? ` Множник ×${comboMult(combo)}` : '') + (cur.correct ? '' : ` Правильно: ${cur.fix}`);
        drawHud();
        if (cur.correct) return later(next, 520);
        later(() => { showFix(false); later(next, 900); }, 260);
      } else {
        combo = 0;
        misses.push(cur);
        beep('bad'); buzz(60);
        if (idx >= 0) chips[idx]?.classList.add('no');
        else if (!timeout) none?.classList.add('no');
        if (!cur.correct) { chips[cur.target]?.classList.add('was'); cur.alt.forEach(i => chips[i]?.classList.add('was')); }
        else none?.classList.add('was');
        flash('no');
        drawHud();
        const msg = timeout ? 'Час вийшов.' : cur.correct ? 'Тут усе правильно.' : 'Не те слово.';
        live.textContent = `${msg} ${cur.correct ? '' : `Правильно: ${cur.fix}.`} ${cur.tip || ''}`;
        later(() => showFix(true, timeout), 280);
      }
    }

    /** Показати правильну версію: закреслене слово → правильне, правило й порада */
    function showFix(miss, timeout = false) {
      const line = h('div.dt-sent.dt-diff', { lang: 'en' });
      if (cur.correct) line.append(...cur.tokens.map(t => h('span.dt-w', t)));
      else {
        for (const o of cur.ops) {
          if (o.op === 'eq') line.append(h('span.dt-w', cur.a[o.i]));
          else if (o.op === 'del') line.append(h('del.dt-w.dt-del', cur.a[o.i]));
          else line.append(h('ins.dt-w.dt-ins', cur.b[o.j]));
        }
      }
      const label = cur.rule ? ruleLabel(cur.rule) : null;
      const head = miss
        ? h('div.row.dt-verdict.no', ic(timeout ? 'timer' : 'x-circle', { size: 18 }), h('b', timeout ? 'Час вийшов' : cur.correct ? 'Тут не було помилки' : 'Помилка була тут'))
        : h('div.row.dt-verdict.ok', ic('check-circle', { size: 18 }), h('b', 'Влучно'));
      const kids = [head, line];
      if (cur.missing && !cur.correct) kids.push(h('div.xs.dt-gap', ic('plus', { size: 14 }), 'Тут бракує слова'));
      if (miss) {
        if (label) kids.push(h('div.row.dt-rule', h('span.tag.warn', label), focusOf(cur.rule) ? h('span.tag.accent', ic('target', { size: 14 }), 'Правило тижня') : null));
        if (cur.tip) kids.push(h('p.dt-tip', cur.tip));
      }
      const card = h('div.card.dt-reveal' + (miss ? '.miss' : '.hit'), kids);
      stage.querySelector('.dt-card')?.replaceWith(card);
      if (!miss) return;
      const none = stage.querySelector('.dt-none');
      const go = h('button.btn.primary.dt-next', { type: 'button' }, 'Далі', ic('arrow-right', { size: 18 }));
      none?.replaceWith(go);
      const readMs = Math.min(3200, 1300 + (cur.tip || '').length * 14);
      const t = later(next, readMs);
      go.onclick = () => { clearTimeout(t); timeouts.delete(t); next(); };
      card.onclick = go.onclick;
      if (document.documentElement.classList.contains('kbd')) go.focus({ preventScroll: true });
    }
    const focusOf = (rule) => !!rule && focus.includes(rule);

    function pop(text, big) {
      if (reducedMotion()) return;
      const p = h('span.dt-pop' + (big ? '.big' : ''), { 'aria-hidden': 'true' }, text);
      stage.append(p);
      later(() => p.remove(), 900);
    }
    function flash(kind) {
      stage.classList.remove('flash-ok', 'flash-no', 'shake');
      void stage.offsetWidth;
      stage.classList.add('flash-' + kind);
      if (kind === 'no' && !reducedMotion()) stage.classList.add('shake');
      later(() => stage.classList.remove('flash-ok', 'flash-no', 'shake'), 420);
    }

    const loop = (now) => {
      if (disposed) return;
      const dt = Math.min(250, now - last); last = now;
      if (!paused && !document.hidden && !locked) {
        const before = left;
        left -= dt;
        if (Math.ceil(left / 1000) !== Math.ceil(before / 1000) && left > 0 && left <= 2000) beep('tick');
        if (left <= 0) { left = 0; answer(-2, true); }
      }
      const pct = total ? Math.max(0, left / total) : 0;
      bar.firstChild.style.transform = `scaleX(${locked && !left ? 0 : pct})`;
      bar.classList.toggle('hurry', pct < 0.3);
      raf = requestAnimationFrame(loop);
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || locked) return;
      if (e.key === '0') { e.preventDefault(); answer(-1); }
    };
    const onVis = () => { paused = document.hidden; last = performance.now(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    const stop = () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); };

    function end() {
      if (game?.ended) return;
      game.ended = true;
      stop();
      setFocus(false);
      const st = gameState();
      const upd = bestUpdate(st.best?.detective, lv, score);
      saveGameState({ best: { ...(st.best || {}), detective: upd.best } });
      upd.record ? (beep('win'), buzz([30, 40, 30])) : beep(hits >= rounds.length / 2 ? 'ok' : 'lose');
      const byRule = new Map();
      for (const r of misses) {
        const k = r.rule && ruleLabel(r.rule) ? r.rule : 'other';
        const e = byRule.get(k) || { rule: k, n: 0, ex: r };
        e.n++; byRule.set(k, e);
      }
      const list = [...byRule.values()].sort((a, b) => b.n - a.n || (focusOf(b.rule) - focusOf(a.rule)));
      const anyFocus = list.some(e => focusOf(e.rule));
      const ruleRows = list.map(e => h('div.tx-row.dt-miss',
        h('span.tx-sq', ic(focusOf(e.rule) ? 'target' : 'warning-circle', { size: 18 })),
        h('span.tx-body',
          h('span.tx-l', ruleLabel(e.rule) || 'Інше'),
          focusOf(e.rule) ? h('span.tx-s.dt-focus', 'Правило тижня') : null,
          h('span.tx-s.dt-ex', { lang: 'en' }, e.ex.fix),
          e.ex.tip && !e.ex.correct ? h('span.tx-s.dt-ex-tip', e.ex.tip) : null),
        h('span.tx-pill.bad.num', { 'aria-label': `Промахів: ${e.n}` }, `×${e.n}`)));
      body.replaceChildren(gameResult({
        icon: 'magnifying-glass', record: upd.record, score: String(score), unit: plural(score, 'очко', 'очки', 'очок'), sub: verdict(hits, rounds.length),
        kpis: [{ value: `${hits}/${rounds.length}`, label: 'знайдено', tone: 'good' }, { value: maxCombo, label: 'найдовше комбо' }, { value: Math.max(upd.prev, score), label: `рекорд ${lv}` }],
        sections: [list.length
          ? txGroup('Правила, на яких ви спіткнулися', [txRows(ruleRows),
            anyFocus ? tx({ icon: 'target', label: 'Потренувати правила тижня', sub: 'Мої помилки · за розкладом', href: '#/mistakes?practice=due&focus=1', wide: true }) : null])
          : tx({ icon: 'seal-check', label: 'Жодного промаху — справжній детектив!', wide: true, tone: 'good' })],
        primary: { icon: 'arrow-clockwise', label: 'Ще раз', sub: `${ROUNDS} нових речень`, onclick: play },
        more: [{ icon: 'game-controller', label: 'Усі ігри', href: '#/games' }],
      }));
      live.textContent = `Гру завершено. Очки: ${score}. Знайдено ${hits} з ${rounds.length}.` + (upd.record ? ' Новий рекорд!' : '');
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

function verdict(hits, n) {
  const p = n ? hits / n : 0;
  if (p === 1) return 'Бездоганне розслідування';
  if (p >= 0.8) return 'Гострий погляд';
  if (p >= 0.5) return 'Добрий результат — є над чим попрацювати';
  return 'Помилки хитрі — спробуйте ще раз';
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
