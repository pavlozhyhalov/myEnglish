// «Те саме слово?»: 15 речень з пропуском і 2–3 словами, які плутають (make / do, borrow / lend, кальки на зразок «актуальний»).
// Після відповіді — коротка різниця українською. Комбо: ×2 від 3 поспіль, ×3 від 6; бонус за швидкість. Рекорди: очки й найкращий час.
// Набори, що збігаються з власними помилками учня (word-choice / collocations: у wrong одне слово набору, у right — інше), ідуть першими.
// Гра серій помилок не змінює.
import * as store from '../store.js';
import { h, ic } from '../ui/dom.js';
import { json } from '../data.js';
import { myLevel } from '../level.js';
import { activityTimer, isDisputed } from '../stats.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { bestUpdate, shuffleArr } from './logic.js';
import { plural } from '../strings.js';
import { tx, txGroup } from '../ui/tiles.js';
import { gameState, saveGameState, beep, buzz, reducedMotion, gameHead, statPill, gameIntro, startTile, gameResult, moreRows, bankLevels, seenStore, gapSentence, fastBest, saveFast, clock } from './common.js';

export const ROUNDS = 15;
const OWN_MAX = 8;           // раундів з наборів «з ваших помилок»
const FAST_MIN_HITS = 12;    // рекорд часу — лише за гру з ≥ 12 правильними з 15
const OWN_RULES = new Set(['word-choice', 'collocations']);
const seen = seenStore('me:same-seen', 120);

// ---------- Логіка (без DOM) ----------

export const comboMult = (combo) => (combo >= 6 ? 3 : combo >= 3 ? 2 : 1);
/** Очки за раунд: 10 × множник + до 5 за швидкість (повний бонус — до 2 с, нуль — від 10 с) */
export const roundPoints = (combo, ms) => 10 * comboMult(combo) + Math.round(5 * Math.max(0, Math.min(1, (10000 - ms) / 8000)));

const IRREGULAR = {
  make: ['made'], do: ['did', 'done', 'does'], say: ['said', 'says'], tell: ['told'], speak: ['spoke', 'spoken'],
  lend: ['lent'], steal: ['stole', 'stolen'], win: ['won', 'winning'], beat: ['beaten'], bring: ['brought'], take: ['took', 'taken'],
  see: ['saw', 'seen'], lose: ['lost'], teach: ['taught'], learn: ['learnt'], think: ['thought'], mean: ['meant'],
  rise: ['rose', 'risen'], sell: ['sold'], hear: ['heard'], fit: ['fitted', 'fitting'], rob: ['robbed', 'robbing'],
  little: ['less', 'least'], few: ['fewer', 'fewest'], much: ['more', 'most'], many: ['more', 'most'],
};
/** Форми слова для пошуку в тексті помилки: основа, -s/-es, -ed/-d, -ing (з урахуванням німої -e) і неправильні форми */
export function formsOf(word) {
  const w = word.toLowerCase();
  if (/[\s-]/.test(w)) return [w];
  const stem = w.replace(/e$/, '');
  return [...new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', stem + 'ing', w + 'ing', w.replace(/y$/, 'ies'), ...(IRREGULAR[w] || [])])];
}
const hasWord = (text, word) => {
  const t = ' ' + String(text || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z'-]+/g, ' ') + ' ';
  return formsOf(word).some(f => t.includes(' ' + f + ' '));
};

/**
 * Набори, що збігаються з власними помилками: у wrong є одне слово набору (і немає в right), у right — інше (і немає в wrong).
 * Повертає Map(setId → кількість помилок).
 */
export function ownMatches(sets, mistakes) {
  const out = new Map();
  for (const m of mistakes) {
    if (!m || m.deleted || !OWN_RULES.has(m.rule) || !m.wrong || !m.right) continue;
    if (safe(() => isDisputed(m.wrong, m.right), false)) continue;
    for (const s of sets) {
      const inW = s.set.filter(w => hasWord(m.wrong, w)), inR = s.set.filter(w => hasWord(m.right, w));
      const a = inW.find(w => !inR.includes(w)), b = inR.find(w => !inW.includes(w));
      if (a && b) out.set(s.id, (out.get(s.id) || 0) + (m.resolved ? 0.5 : 1));
    }
  }
  return out;
}

/**
 * 15 раундів: спершу набори з ваших помилок (до 2 речень з набору, до 8 раундів; другі речення — після перших),
 * далі — по одному реченню з інших наборів; речення мого рівня й сусідніх, недавно бачені — в кінці черги.
 */
export function buildRounds(sets, { level = myLevel(), matched = new Map(), rng = Math.random, seenIds = new Set(), n = ROUNDS } = {}) {
  const levels = bankLevels(level);
  const itemsOf = (s) => {
    const fit = s.items.map((it, i) => ({ ...it, key: `${s.id}:${i}` })).filter(it => levels.includes(it.level));
    const list = fit.length ? fit : s.items.map((it, i) => ({ ...it, key: `${s.id}:${i}` }));
    return list.map(it => ({ it, k: rng() + (seenIds.has(it.key) ? 2 : 0) + (it.level === levels[0] ? 0 : 0.3) })).sort((a, b) => a.k - b.k).map(x => x.it);
  };
  const round = (s, it, own) => ({ id: it.key, set: s.set, why_uk: s.why_uk, setId: s.id, en: it.en, answer: it.answer, options: shuffleArr(s.set, rng), own });
  const ownSets = sets.filter(s => matched.has(s.id)).sort((a, b) => matched.get(b.id) - matched.get(a.id) || rng() - 0.5);
  const first = [], second = [];
  for (const s of ownSets) {
    const its = itemsOf(s);
    if (first.length + second.length >= OWN_MAX) break;
    first.push(round(s, its[0], true));
    if (its[1] && first.length + second.length < OWN_MAX && ownSets.length < OWN_MAX) second.push(round(s, its[1], true));
  }
  const rounds = [...first, ...second].slice(0, Math.min(OWN_MAX, n));
  const used = new Set(rounds.map(r => r.setId));
  const rest = sets.filter(s => !used.has(s.id))
    .map(s => ({ s, its: itemsOf(s) }))
    .map(x => ({ ...x, k: rng() + (seenIds.has(x.its[0]?.key) ? 2 : 0) })).sort((a, b) => a.k - b.k);
  for (const { s, its } of rest) { if (rounds.length >= n) break; if (its[0]) rounds.push(round(s, its[0], false)); }
  // наборів забракло — другі речення з уже взятих
  for (const s of sets) { if (rounds.length >= n) break; const it = itemsOf(s).find(x => !rounds.some(r => r.id === x.key)); if (it) rounds.push(round(s, it, matched.has(s.id))); }
  // власні — першими, решта перемішана (без двох однакових наборів поспіль)
  const own = rounds.filter(r => r.own), other = shuffleArr(rounds.filter(r => !r.own), rng);
  const out = [...own, ...other];
  for (let i = 1; i < out.length; i++) if (out[i].setId === out[i - 1].setId) {
    const j = out.findIndex((r, k) => k > i && r.setId !== out[i].setId && r.own === out[i].own);
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- Гра ----------

export default async function samewords(view) {
  setTitle('Те саме слово?');
  const lv = myLevel();
  let sets = [];
  try { sets = await json('data/samewords.json'); } catch { sets = []; }
  const timer = activityTimer('game');
  let disposed = false, game = null;
  const timeouts = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timeouts.delete(t); if (!disposed) fn(); }, ms); timeouts.add(t); return t; };
  const live = h('div.sr-only', { 'aria-live': 'assertive', role: 'status' });
  const body = h('div.stack');
  view.replaceChildren(h('div.stack.games.sw', gameHead(h('span.tag', lv)), body, live));
  const matched = () => ownMatches(sets, store.all('mistakes'));

  function intro() {
    setFocus(false);
    const best = gameState().best?.same?.[lv] || 0;
    const fast = fastBest('same', lv);
    const m = matched();
    const ownN = Math.min(m.size, OWN_MAX);
    const start = startTile({ label: 'Почати', sub: `${ROUNDS} речень · на час`, onclick: play, disabled: !sets.length });
    body.replaceChildren(gameIntro({
      icon: 'swap',
      text: 'Оберіть слово, яке пасує в речення, — і запам\'ятайте різницю.',
      rules: [`${ROUNDS} речень, час іде, поки ви обираєте`, 'Три влучні поспіль — очки ×2, шість — ×3; швидше — більше очок', `Рекорд часу — за гру з ${FAST_MIN_HITS}+ правильними`],
      extra: [
        ownN ? tx({ icon: 'target', label: `${ownN} ${plural(ownN, 'набір', 'набори', 'наборів')} — з ваших помилок`, sub: 'Ідуть першими', wide: true, cls: 'sw-note' }) : null,
        fast ? tx({ icon: 'timer', label: 'Найкращий час', wide: true, cls: 'g-best sw-fast', end: h('b.num.g-best-n', clock(fast)) }) : null,
        !sets.length ? h('p.feedback.no', { style: { margin: 0 } }, 'Не вдалося завантажити речення. Перевірте з\'єднання.') : null],
      best: best ? { label: `Рекорд рівня ${lv}`, value: best } : null,
      start,
    }));
    start.focus({ preventScroll: true });
  }

  function play() {
    setFocus(true);
    const rounds = buildRounds(sets, { level: lv, matched: matched(), seenIds: seen.read() });
    if (!rounds.length) return intro();
    let ri = -1, score = 0, combo = 0, maxCombo = 0, hits = 0, cur = null, gap = null, locked = true;
    let elapsed = 0, roundMs = 0, last = performance.now(), raf = 0, paused = false;
    const misses = [];
    const rPill = statPill('swap', 'Речення'), tPill = statPill('timer', 'Час'), sPill = statPill('star', 'Очки'), cPill = statPill('fire', 'Комбо');
    const dots = h('div.sw-dots', { 'aria-hidden': 'true' }, rounds.map(() => h('i')));
    const stage = h('div.sw-stage');
    body.replaceChildren(h('div.row.g-hud', rPill.el, tPill.el, sPill.el, h('div.grow'), cPill.el), dots, stage);
    const drawHud = () => {
      const k = Math.min(ri + 1, rounds.length);
      rPill.set(`${k}/${rounds.length}`, `${k} з ${rounds.length}`);
      tPill.set(clock(elapsed));
      sPill.set(String(score));
      const mult = comboMult(combo);
      cPill.set(`×${mult}`, `${combo} поспіль, множник ${mult}`);
      cPill.el.classList.toggle('g-hot', mult > 1);
    };

    function next() {
      if (disposed) return;
      ri++;
      if (ri >= rounds.length) return end();
      cur = rounds[ri];
      roundMs = 0;
      dots.children[ri]?.classList.add('cur');
      gap = gapSentence(cur.en);
      const opts = cur.options.map((w, i) => h('button.sw-opt', { type: 'button', lang: 'en', dataset: { w }, onclick: () => answer(w) },
        h('span.g-num', { 'aria-hidden': 'true' }, String(i + 1)), h('span.sw-opt-w', w)));
      stage.replaceChildren(
        h('div.card.sw-card',
          h('div.row.sw-ask', h('span.xs.dim.grow', 'Яке слово?'), cur.own ? h('span.tag.accent.sw-src', ic('target', { size: 14 }), 'з ваших помилок') : null),
          gap.el,
          h('div.sw-why', { 'aria-hidden': 'true' })),
        h('div.sw-opts' + (opts.length === 2 ? '.two' : ''), { role: 'group', 'aria-label': 'Варіанти' }, opts));
      stage.classList.remove('sw-in');
      if (!reducedMotion()) { void stage.offsetWidth; stage.classList.add('sw-in'); }
      live.textContent = `${cur.en.replace('___', 'пропуск')} Варіанти: ${cur.options.join(', ')}`;
      locked = false;
      drawHud();
      if (document.documentElement.classList.contains('kbd')) opts[0].focus({ preventScroll: true });
    }

    function answer(w) {
      if (locked || disposed) return;
      locked = true;
      const ok = w === cur.answer;
      stage.querySelectorAll('.sw-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.w === cur.answer) b.classList.add('ok');
        else if (b.dataset.w === w) b.classList.add('no');
      });
      gap.fill(cur.answer, { tone: ok ? 'ok' : 'no', yours: ok ? null : w });
      const why = stage.querySelector('.sw-why');
      why.replaceChildren(h('span.sw-why-set', { lang: 'en' }, cur.set.join(' / ')), h('span', cur.why_uk));
      why.className = 'sw-why ' + (ok ? 'ok' : 'no');
      why.removeAttribute('aria-hidden');
      const card = stage.querySelector('.sw-card');
      card.classList.add(ok ? 'hit' : 'miss');
      dots.children[ri]?.classList.replace('cur', ok ? 'hit' : 'miss');
      if (ok) {
        combo++; hits++; maxCombo = Math.max(maxCombo, combo);
        const gained = roundPoints(combo, roundMs);
        score += gained;
        const up = comboMult(combo) > comboMult(combo - 1);
        beep(up ? 'win' : 'ok'); buzz(12);
        pop(up ? `×${comboMult(combo)}!` : `+${gained}`, up);
        live.textContent = `Так, ${cur.answer}. ${cur.why_uk}` + (up ? ` Множник ×${comboMult(combo)}` : '');
      } else {
        combo = 0;
        misses.push({ ...cur, picked: w });
        beep('bad'); buzz(60);
        if (!reducedMotion()) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
        live.textContent = `Ні. Правильно: ${cur.answer}. ${cur.why_uk}`;
      }
      drawHud();
      const go = h('button.btn.primary.sw-next', { type: 'button' }, ri + 1 >= rounds.length ? 'Підсумок' : 'Далі', ic('arrow-right', { size: 18 }));
      stage.querySelector('.sw-opts').replaceWith(go);
      const t = later(next, ok ? 1500 : Math.min(4200, 1800 + cur.why_uk.length * 16));
      go.onclick = card.onclick = () => { clearTimeout(t); timeouts.delete(t); next(); };
      if (document.documentElement.classList.contains('kbd')) go.focus({ preventScroll: true });
    }

    function pop(text, big) {
      if (reducedMotion()) return;
      const p = h('span.g-pop' + (big ? '.big' : ''), { 'aria-hidden': 'true' }, text);
      stage.append(p);
      later(() => p.remove(), 900);
    }

    // час іде лише поки учень обирає (пояснення читаються «безкоштовно»)
    const loop = (now) => {
      if (disposed) return;
      const dt = Math.min(250, now - last); last = now;
      if (!paused && !document.hidden && !locked) {
        const before = Math.floor(elapsed / 1000);
        elapsed += dt; roundMs += dt;
        if (Math.floor(elapsed / 1000) !== before) tPill.set(clock(elapsed));
      }
      raf = requestAnimationFrame(loop);
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || locked) return;
      const i = +e.key - 1;
      if (/^[1-3]$/.test(e.key) && cur.options[i]) { e.preventDefault(); answer(cur.options[i]); }
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
      seen.add(rounds.map(r => r.id));
      const st = gameState();
      const upd = bestUpdate(st.best?.same, lv, score);
      saveGameState({ best: { ...(st.best || {}), same: upd.best } });
      const fastPrev = fastBest('same', lv);
      const fast = hits >= FAST_MIN_HITS && rounds.length === ROUNDS ? saveFast('same', lv, elapsed) : { record: false, prev: fastPrev };
      const record = upd.record || fast.record;
      record ? (beep('win'), buzz([30, 40, 30])) : beep(hits >= rounds.length * 0.7 ? 'ok' : 'lose');
      const bySet = new Map();
      for (const r of misses) { const e = bySet.get(r.setId) || { r, n: 0 }; e.n++; bySet.set(r.setId, e); }
      const rows = [...bySet.values()].sort((a, b) => b.n - a.n || (b.r.own - a.r.own)).map(({ r, n }) => missRow(r, n));
      const fastNote = fast.record ? (fast.prev ? `Новий рекорд часу! Попередній — ${clock(fast.prev)}` : 'Перший рекорд часу')
        : hits < FAST_MIN_HITS ? `Рекорд часу — за ${FAST_MIN_HITS}+ правильних` : fastPrev ? `Рекорд часу: ${clock(fastPrev)}` : null;
      body.replaceChildren(gameResult({
        icon: 'swap', record, score: String(score), unit: plural(score, 'очко', 'очки', 'очок'), sub: verdict(hits, rounds.length),
        kpis: [{ value: `${hits}/${rounds.length}`, label: 'правильно', tone: 'good' }, { value: clock(elapsed), label: fast.record ? 'рекорд часу' : 'час', tone: fast.record ? 'good' : '' }, { value: maxCombo, label: 'найдовше комбо' }],
        note: [upd.prev && !upd.record ? `Рекорд рівня ${lv}: ${upd.prev}` : null, fastNote].filter(Boolean).join(' · ') || null,
        sections: [rows.length
          ? txGroup('Варто запам\'ятати', moreRows(rows))
          : tx({ icon: 'seal-check', label: 'Жодної помилки — ви розрізняєте ці слова!', wide: true, tone: 'good' })],
        primary: { icon: 'arrow-clockwise', label: 'Ще раз', sub: `${ROUNDS} нових речень`, onclick: play },
        more: [{ icon: 'game-controller', label: 'Усі ігри', href: '#/games' }],
      }));
      live.textContent = `Гру завершено. Очки: ${score}. Правильно ${hits} з ${rounds.length}. Час ${clock(elapsed)}.` + (record ? ' Новий рекорд!' : '');
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

/** Рядок розбору: набір слів, речення з правильним словом, різниця; праворуч — скільки разів схибили */
function missRow(r, n) {
  const g = gapSentence(r.en, { tag: 'span' });
  g.fill(r.answer, { tone: 'ok' });
  return h('div.tx-row.sw-miss',
    h('span.tx-sq', ic(r.own ? 'target' : 'swap', { size: 18 })),
    h('span.tx-body',
      h('span.tx-l', { lang: 'en' }, r.set.join(' / ')),
      h('span.tx-s.sw-miss-en', g.el),
      h('span.tx-s', r.why_uk)),
    n > 1 ? h('span.tx-pill.bad.num', { 'aria-label': `Промахів: ${n}` }, `×${n}`) : null);
}

function verdict(hits, n) {
  const p = n ? hits / n : 0;
  if (p === 1) return 'Бездоганно — жодної плутанини';
  if (p >= 0.8) return 'Чудово розрізняєте слова';
  if (p >= 0.5) return 'Добре — кілька пар варто повторити';
  return 'Ці слова підступні — спробуйте ще раз';
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
