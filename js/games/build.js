// «Збери речення»: на швидкість складати речення з перемішаних слів (приклади з колод і уроків граматики мого рівня).
// Український переклад — підказка; за кожне речення +4 с до таймера; після правильної відповіді речення звучить.
import { h, ic } from '../ui/dom.js';
import { grammarIndex, lesson } from '../data.js';
import { myLevel } from '../level.js';
import { activityTimer } from '../stats.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { norm, sameSentence, tilesOf } from '../wordlogic.js';
import { BUILD_SECONDS, BUILD_BONUS, goodSentence, shuffledTiles, firstMismatch, buildPoints, bestUpdate, shuffleArr } from './logic.js';
import { plural } from '../strings.js';
import { tx, txGroup, txRows } from '../ui/tiles.js';
import { wordPool, gameState, saveGameState, beep, buzz, reducedMotion, gameHead, statPill, autoSpeak, gameIntro, startTile, gameResult, wordRow } from './common.js';

/** Речення рівня: приклади з карток, які зараз вчаться, першими; далі колоди й уроки граматики мого рівня */
async function sentences(lv) {
  const { pool, priority } = await wordPool({ neighbours: false });
  let lessons = [];
  try {
    const idx = (await grammarIndex()).filter(l => l.level === lv);
    lessons = (await Promise.all(idx.map(l => lesson(l.id).catch(() => null)))).filter(Boolean);
  } catch { /* офлайн без кешу — лише колоди */ }
  const seen = new Set();
  const take = (en, uk) => {
    const s = String(en || '').trim(), k = norm(s);
    if (!uk || !goodSentence(s) || seen.has(k)) return null;
    seen.add(k);
    return { en: s, uk: String(uk).trim() };
  };
  const own = shuffleArr(priority.map(c => take(c.ex, c.exUk)).filter(Boolean));
  const rest = shuffleArr([
    ...pool.map(c => take(c.ex, c.exUk)),
    ...lessons.flatMap(l => (l.examples || []).map(e => take(e.en, e.uk))),
  ].filter(Boolean));
  // кожне третє речення — зі своїх карток, поки вони є
  const out = [];
  while (own.length || rest.length) out.push((own.length && (out.length % 3 === 0 || !rest.length)) ? own.shift() : rest.shift());
  return out;
}

export default async function build(view) {
  setTitle('Збери речення');
  const lv = myLevel();
  const all = await sentences(lv);
  const timer = activityTimer('game');
  let disposed = false, round = null;
  const live = h('div.sr-only', { 'aria-live': 'polite', role: 'status' });
  const body = h('div.stack');
  view.replaceChildren(h('div.stack.games.bld', gameHead(h('span.tag', lv)), body, live));

  function intro() {
    setFocus(false);
    const best = gameState().best?.build?.[lv] || 0;
    const start = startTile({ label: 'Почати', sub: `${BUILD_SECONDS} секунд · речення рівня ${lv}`, onclick: play, disabled: !all.length });
    body.replaceChildren(gameIntro({
      icon: 'puzzle-piece',
      text: 'Перед вами переклад і перемішані англійські слова. Торкайтеся слів у правильному порядку — щойно речення складено, воно перевіряється саме.',
      rules: [`${BUILD_SECONDS} секунд, за кожне речення +${BUILD_BONUS} с`, 'Серія без помилок дає бонусні очки', 'Слово з речення можна повернути дотиком'],
      extra: [all.length ? null : h('p.feedback.no', { style: { margin: 0 } }, 'Не вдалося завантажити речення. Перевірте з\'єднання.')],
      best: best ? { label: `Рекорд рівня ${lv}`, value: best } : null,
      start,
    }));
    start.focus({ preventScroll: true });
  }

  function play() {
    setFocus(true);
    const queue = shuffleArr(all);
    let qi = 0, score = 0, streak = 0, bestStreak = 0, done = 0, left = BUILD_SECONDS * 1000, last = performance.now(), raf = 0, locked = false, ended = false;
    let cur = null, bank = [], built = [];
    const missed = [];
    const tPill = statPill('timer', 'Залишилось секунд'), sPill = statPill('star', 'Очки'), kPill = statPill('fire', 'Серія');
    const hint = h('p.bld-hint');
    const line = h('div.bld-line', { role: 'group', 'aria-label': 'Ваше речення' });
    const bankEl = h('div.bld-bank', { role: 'group', 'aria-label': 'Слова' });
    const skip = h('button.btn.sm.ghost', { type: 'button', onclick: () => skipIt() }, 'Пропустити');
    const clearBtn = h('button.btn.sm.ghost', { type: 'button', onclick: () => { if (locked) return; built.forEach(t => bank.push(t)); built = []; draw(); } }, ic('arrow-clockwise', { size: 16 }), 'Почати заново');
    const stage = h('div.stack.bld-stage', hint, line, bankEl, h('div.row', clearBtn, h('div.grow'), skip));
    body.replaceChildren(h('div.row.g-hud', tPill.el, sPill.el, kPill.el), stage);
    const hud = () => { tPill.set(String(Math.ceil(left / 1000))); sPill.set(String(score)); kPill.set(String(streak), `${streak} поспіль`); };

    const draw = (bad = -1) => {
      line.replaceChildren(...(built.length ? built.map((t, i) => h('button.chip.bld-tile' + (i === bad ? '.no' : '') + (locked && bad < 0 ? '.ok' : ''), { type: 'button', lang: 'en', 'aria-label': `${t.t}, повернути`, onclick: () => { if (locked) return; built.splice(i, 1); bank.push(t); draw(); } }, t.t))
        : [h('span.xs.dim.bld-ph', 'Торкайтеся слів нижче')]));
      bankEl.replaceChildren(...bank.map((t, i) => h('button.chip.bld-tile', { type: 'button', lang: 'en', onclick: () => pick(i) }, t.t)));
    };
    const pick = (i) => {
      if (locked) return;
      built.push(bank.splice(i, 1)[0]);
      beep('key');
      draw();
      if (!bank.length) check();
      else if (document.documentElement.classList.contains('kbd')) bankEl.children[Math.min(i, bank.length - 1)]?.focus();
    };
    const next = () => {
      if (ended || disposed) return;
      if (qi >= queue.length) qi = 0;
      cur = queue[qi++];
      bank = shuffledTiles(cur.en); built = []; locked = false;
      hint.textContent = cur.uk;
      draw();
      live.textContent = `Перекладіть: ${cur.uk}. Слова: ${bank.map(t => t.t).join(', ')}`;
      if (document.documentElement.classList.contains('kbd')) bankEl.firstChild?.focus();
    };
    function check() {
      const text = built.map(t => t.t).join(' ');
      if (sameSentence(text, cur.en)) {
        locked = true; done++; streak++; bestStreak = Math.max(bestStreak, streak);
        score += buildPoints(tilesOf(cur.en).length, streak - 1);
        left += BUILD_BONUS * 1000;
        draw(); beep('ok'); buzz(15);
        live.textContent = `Правильно! ${cur.en}`;
        autoSpeak(cur.en);
        hud();
        setTimeout(next, 1100);
      } else {
        const bad = firstMismatch(built.map(t => t.t), cur.en);
        streak = 0; hud();
        if (!missed.includes(cur)) missed.push(cur);
        beep('bad'); buzz(50);
        draw(bad);
        if (!reducedMotion()) { line.classList.remove('shake'); void line.offsetWidth; line.classList.add('shake'); }
        live.textContent = `Не зовсім: помилка у слові ${bad + 1}. Поверніть слова й спробуйте ще.`;
      }
    }
    function skipIt() {
      if (locked) return;
      locked = true; streak = 0; hud();
      if (!missed.includes(cur)) missed.push(cur);
      line.replaceChildren(h('div.feedback.no.en', { lang: 'en', style: { width: '100%' } }, cur.en));
      bankEl.replaceChildren();
      live.textContent = `Правильно: ${cur.en}`;
      autoSpeak(cur.en);
      setTimeout(next, 1800);
    }
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || locked || ended) return;
      if (e.key === 'Backspace' && built.length) { e.preventDefault(); bank.push(built.pop()); draw(); }
    };
    document.addEventListener('keydown', onKey);
    const loop = (now) => {
      if (disposed || ended) return;
      const dt = Math.min(250, now - last); last = now;
      if (!document.hidden) {
        const before = Math.ceil(left / 1000);
        left -= dt;
        const s = Math.ceil(left / 1000);
        if (s !== before) { hud(); if (s <= 5 && s > 0) beep('tick'); }
        tPill.el.classList.toggle('hurry', left < 10000);
        if (left <= 0) { left = 0; hud(); return end(); }
      }
      raf = requestAnimationFrame(loop);
    };
    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      setFocus(false);
      const st = gameState();
      const upd = bestUpdate(st.best?.build, lv, score);
      saveGameState({ best: { ...(st.best || {}), build: upd.best } });
      upd.record ? (beep('win'), buzz([30, 40, 30])) : beep('lose');
      body.replaceChildren(gameResult({
        icon: 'timer', record: upd.record, score: String(score), unit: plural(score, 'очко', 'очки', 'очок'), sub: 'Час вийшов',
        kpis: [{ value: done, label: plural(done, 'речення', 'речення', 'речень') + ' складено', tone: 'good' }, { value: bestStreak, label: 'найдовша серія' }, { value: missed.length, label: 'з помилками', tone: missed.length ? 'warn' : '' }],
        note: upd.prev && !upd.record ? `Рекорд рівня ${lv}: ${upd.prev}` : null,
        sections: [missed.length
          ? txGroup('Варто повторити', txRows(missed.map(m => wordRow({ en: m.en, uk: m.uk, cls: 'g-sent' }))))
          : (done ? tx({ icon: 'check-circle', label: 'Жодної помилки!', wide: true, tone: 'good' }) : null)],
        primary: { icon: 'arrow-clockwise', label: 'Ще раз', sub: `${BUILD_SECONDS} секунд`, onclick: play },
        more: [{ icon: 'game-controller', label: 'Інші ігри', href: '#/games' }],
      }));
      live.textContent = `Час вийшов. Речень: ${done}, очки: ${score}.` + (upd.record ? ' Новий рекорд!' : '');
      body.querySelector('.g-again')?.focus({ preventScroll: true });
    }
    round = { stop() { ended = true; cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); } };
    hud(); next();
    raf = requestAnimationFrame((t) => { last = t; loop(t); });
  }

  intro();
  return () => { disposed = true; round?.stop(); timer.stop(); stopSpeech(); setFocus(false); };
}
