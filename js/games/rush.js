// «Швидкий переклад»: 60 секунд, слово за словом — оберіть переклад із чотирьох (або «так / ні»).
// Темп зростає, комбо множить очки, три життя. Рекорд — для кожного рівня й варіанта гри.
import { h, ic, seg } from '../ui/dom.js';
import { myLevel } from '../level.js';
import { activityTimer } from '../stats.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { pickDistractors, shuffle } from '../wordlogic.js';
import { RUSH_SECONDS, RUSH_LIVES, comboMult, rushTimeFor, rushPoints, buildQueue, truthPair, bestUpdate } from './logic.js';
import { wordPool, gameState, saveGameState, beep, buzz, reducedMotion, addWordButton, gameHead, statPill } from './common.js';

const MODE_KEY = { choice: 'rush4', truth: 'rushtf' };

export default async function rush(view) {
  setTitle('Швидкий переклад');
  const lv = myLevel();
  const { pool, priority } = await wordPool();
  const timer = activityTimer('game');
  let disposed = false, mode = gameState().rushMode === 'truth' ? 'truth' : 'choice';
  let game = null;   // поточний раунд: { stop() }
  const live = h('div.sr-only', { 'aria-live': 'assertive', role: 'status' });
  const body = h('div.stack');
  view.replaceChildren(h('div.stack.games.rush', gameHead('Швидкий переклад', h('span.tag', lv)), body, live));

  function intro() {
    setFocus(false);
    const best = gameState().best?.[MODE_KEY[mode]]?.[lv] || 0;
    const start = h('button.btn.primary.lg.block', { type: 'button', onclick: play }, ic('play', { size: 20 }), 'Почати');
    body.replaceChildren(
      h('div.card.stack.g-intro',
        h('div.tile-ico.g-big', ic('lightning', { size: 32 })),
        h('p', { style: { margin: 0 } }, mode === 'choice'
          ? 'З\'являється англійське слово — оберіть правильний переклад. Що швидше відповідаєте, то більше очок.'
          : 'Слово і переклад: правильно чи ні? Свайп праворуч — «так», ліворуч — «ні» (або стрілки на клавіатурі).'),
        h('ul.xs.dim.g-rules', h('li', `${RUSH_SECONDS} секунд і ${RUSH_LIVES} життя`), h('li', 'Кожні 5 правильних поспіль — множник очок до ×4'), h('li', 'Темп поступово зростає')),
        seg([['choice', 'Чотири варіанти'], ['truth', 'Так чи ні']], mode, (v) => { mode = v; saveGameState({ rushMode: v }); intro(); }),
        best ? h('div.row', ic('trophy', { size: 18 }), h('span', `Рекорд рівня ${lv}: `, h('b.num', String(best)))) : null,
        start));
    start.focus({ preventScroll: true });
  }

  function play() {
    setFocus(true);
    const queue = buildQueue(priority, pool);
    let qi = 0, score = 0, combo = 0, maxCombo = 0, lives = RUSH_LIVES, correct = 0, answered = 0;
    let left = RUSH_SECONDS * 1000, wordLeft = 0, wordTotal = 0, cur = null, locked = false, last = performance.now(), raf = 0, paused = false;
    const missed = [];
    const tPill = statPill('timer', 'Залишилось секунд'), sPill = statPill('star', 'Очки'), cPill = statPill('fire', 'Комбо');
    const hearts = h('div.g-hearts', { role: 'img' });
    const bar = h('div.g-wordbar', h('span'));
    const stage = h('div.g-stage');
    body.replaceChildren(h('div.row.g-hud', tPill.el, sPill.el, cPill.el, h('div.grow'), hearts), bar, stage);
    const drawHud = () => {
      tPill.set(String(Math.ceil(left / 1000)));
      sPill.set(String(score));
      cPill.set(`×${comboMult(combo)}`, `${combo} поспіль, множник ${comboMult(combo)}`);
      hearts.replaceChildren(...Array.from({ length: RUSH_LIVES }, (_, i) => ic('heart', { size: 20, fill: i < lives })));
      hearts.setAttribute('aria-label', `Життя: ${lives} з ${RUSH_LIVES}`);
      hearts.classList.toggle('low', lives === 1);
    };

    const next = () => {
      if (disposed) return;
      let card, ds = [];
      for (let k = 0; k < queue.length; k++) {
        if (qi >= queue.length) qi = 0;
        card = queue[qi++];
        ds = pickDistractors(card, pool, { n: 3 });
        if (ds.length >= (mode === 'choice' ? 3 : 1)) break;
      }
      wordTotal = wordLeft = rushTimeFor(correct);
      locked = false;
      if (mode === 'choice') {
        const opts = shuffle([card, ...ds]);
        cur = { card, opts };
        stage.replaceChildren(
          h('div.g-word', h('span.en', { lang: 'en' }, card.en)),
          h('div.g-opts', opts.map((o, i) => h('button.btn.g-opt', { type: 'button', dataset: { i }, onclick: () => answer(o === card, i) },
            h('span.g-num', { 'aria-hidden': 'true' }, String(i + 1)), h('span.grow', o.uk)))));
        live.textContent = `${card.en}. Варіанти: ${opts.map((o, i) => `${i + 1} — ${o.uk}`).join('; ')}`;
      } else {
        const p = truthPair(card, ds);
        cur = { card, truth: p.truth };
        const cardEl = h('div.g-tf', { tabindex: '-1' },
          h('div.g-word', h('span.en', { lang: 'en' }, card.en)),
          h('div.g-eq', { 'aria-hidden': 'true' }, '='),
          h('div.g-tr', p.shown));
        swipe(cardEl, (yes) => answer(yes === p.truth, yes ? 1 : 0));
        stage.replaceChildren(cardEl, h('div.g-tf-btns',
          h('button.btn.lg.g-no', { type: 'button', onclick: () => answer(!p.truth, 0) }, ic('x', { size: 20 }), 'Ні'),
          h('button.btn.lg.g-yes', { type: 'button', onclick: () => answer(p.truth, 1) }, ic('check', { size: 20 }), 'Так')));
        live.textContent = `${card.en} — ${p.shown}. Правильно?`;
      }
      if (document.documentElement.classList.contains('kbd')) stage.querySelector('button')?.focus({ preventScroll: true });
    };

    function answer(ok, idx, timeout = false) {
      if (locked || disposed) return;
      locked = true; answered++;
      const card = cur.card;
      if (ok) {
        combo++; correct++; maxCombo = Math.max(maxCombo, combo);
        score += rushPoints(combo - 1, wordLeft, wordTotal);
        beep('ok'); buzz(12);
        live.textContent = comboMult(combo) > comboMult(combo - 1) ? `Правильно! Множник ×${comboMult(combo)}` : 'Правильно';
      } else {
        combo = 0; lives--;
        if (!missed.some(m => m.en === card.en)) missed.push(card);
        beep('bad'); buzz(60);
        live.textContent = (timeout ? 'Час вийшов. ' : 'Ні. ') + `${card.en} — ${card.uk}`;
      }
      // підсвітити відповідь
      if (mode === 'choice') {
        stage.querySelectorAll('.g-opt').forEach((b, i) => {
          b.disabled = true;
          if (cur.opts[i] === card) b.classList.add('ok');
          else if (i === idx && !ok) b.classList.add('no');
        });
      } else {
        stage.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const tf = stage.querySelector('.g-tf');
        tf.classList.add(ok ? 'ok' : 'no');
        if (!ok && !cur.truth) tf.append(h('div.xs.g-right', 'Правильно: ', h('b', card.uk)));
      }
      if (!reducedMotion() && !ok) stage.classList.add('shake');
      drawHud();
      if (lives <= 0) return setTimeout(end, 650);
      setTimeout(() => { stage.classList.remove('shake'); next(); }, ok ? 260 : 900);
    }

    const loop = (now) => {
      if (disposed) return;
      const dt = Math.min(250, now - last); last = now;
      if (!paused && !document.hidden) {
        left -= dt;
        if (!locked) {
          wordLeft -= dt;
          if (wordLeft <= 0) { wordLeft = 0; answer(false, -1, true); }
        }
        const pctW = wordTotal ? Math.max(0, wordLeft / wordTotal) : 0;
        bar.firstChild.style.transform = `scaleX(${pctW})`;
        bar.classList.toggle('hurry', pctW < 0.3);
        const s = Math.ceil(left / 1000);
        if (s !== Math.ceil((left + dt) / 1000)) { drawHud(); if (s <= 5 && s > 0) beep('tick'); }
        if (left <= 0) { left = 0; drawHud(); return end(); }
      }
      raf = requestAnimationFrame(loop);
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || locked) return;
      if (mode === 'choice' && /^[1-4]$/.test(e.key)) { e.preventDefault(); const i = +e.key - 1; answer(cur.opts[i] === cur.card, i); }
      if (mode === 'truth' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); const yes = e.key === 'ArrowRight'; answer(yes === cur.truth, yes ? 1 : 0); }
    };
    document.addEventListener('keydown', onKey);

    function end() {
      if (game?.ended) return;
      game.ended = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('keydown', onKey);
      setFocus(false);
      const k = MODE_KEY[mode];
      const st = gameState();
      const upd = bestUpdate(st.best?.[k], lv, score);
      saveGameState({ best: { ...(st.best || {}), [k]: upd.best } });
      upd.record ? (beep('win'), buzz([30, 40, 30])) : beep('lose');
      const acc = answered ? Math.round(correct / answered * 100) : 0;
      body.replaceChildren(h('div.card.stack.g-end',
        h('div.center.stack', { style: { gap: '4px' } },
          upd.record ? h('span.tag.good.g-record', ic('trophy', { size: 16 }), 'Новий рекорд!') : null,
          h('div.g-score.num', String(score)), h('div.xs.dim', lives <= 0 ? 'Життя скінчились' : 'Час вийшов'),
        ),
        h('div.grid3',
          h('div.stat', h('span.big-num', String(correct)), h('span.xs.dim', 'Правильно')),
          h('div.stat', h('span.big-num', `${acc}%`), h('span.xs.dim', 'Точність')),
          h('div.stat', h('span.big-num', String(maxCombo)), h('span.xs.dim', 'Найдовше комбо'))),
        upd.prev && !upd.record ? h('p.xs.dim', { style: { margin: 0 } }, `Рекорд рівня ${lv}: ${upd.prev}`) : null,
        missed.length ? missedList(missed) : h('p.feedback.ok', { style: { margin: 0 } }, 'Жодної помилки!'),
        h('div.row.wrap', h('button.btn.primary.grow', { type: 'button', onclick: play }, ic('arrow-clockwise', { size: 18 }), 'Ще раз'),
          h('button.btn.ghost', { type: 'button', onclick: intro }, 'Змінити варіант'))));
      live.textContent = `Гру завершено. Очки: ${score}.` + (upd.record ? ' Новий рекорд!' : '') + (missed.length ? ` Помилок: ${missed.length}.` : '');
      body.querySelector('.btn.primary')?.focus({ preventScroll: true });
    }

    const onVis = () => { paused = document.hidden; last = performance.now(); };
    document.addEventListener('visibilitychange', onVis);
    game = { ended: false, stop() { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); } };
    drawHud(); next();
    raf = requestAnimationFrame((t) => { last = t; loop(t); });
  }

  intro();
  return () => {
    disposed = true;
    game?.stop();
    timer.stop();
    stopSpeech();
    setFocus(false);
  };
}

/** Слова з помилками: прослухати й додати в мої слова */
export function missedList(list) {
  const addAll = h('button.btn.sm.ghost', { type: 'button', onclick: () => { listEl.querySelectorAll('button.soft:not([disabled])').forEach(b => b.click()); addAll.disabled = true; } }, ic('plus', { size: 16 }), 'Додати всі');
  const listEl = h('div.list', list.map(w => h('div.list-row.g-missed',
    h('button.icon-btn', { type: 'button', 'aria-label': `Прослухати ${w.en}`, onclick: () => speak(w.en) }, ic('speaker-high', { size: 20 })),
    h('div.grow', h('div.en', { lang: 'en', style: { fontWeight: 600 } }, w.en), h('div.xs.dim', w.uk)),
    addWordButton(w))));
  return h('div.stack', { style: { gap: '8px' } }, h('div.row', h('div.section-title.grow', { style: { margin: 0 } }, 'Варто повторити'), addAll), listEl);
}

/** Свайп картки: праворуч — «так», ліворуч — «ні» (лише горизонтальний жест) */
function swipe(el, onSwipe) {
  let x0 = null, y0 = 0, dx = 0, id = null;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; dx = 0; id = e.pointerId; });
  el.addEventListener('pointermove', (e) => {
    if (x0 == null || e.pointerId !== id) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) < Math.abs(e.clientY - y0)) return;
    if (!reducedMotion()) el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
    el.classList.toggle('lean-yes', dx > 40); el.classList.toggle('lean-no', dx < -40);
  });
  const up = () => {
    if (x0 == null) return;
    x0 = null; el.style.transform = ''; el.classList.remove('lean-yes', 'lean-no');
    if (Math.abs(dx) > 70) onSwipe(dx > 0);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => { x0 = null; el.style.transform = ''; el.classList.remove('lean-yes', 'lean-no'); });
}
