// «Поясни слово»: учень пояснює англійською слово зі своїх карток, не називаючи його; AI слухає й вгадує (3 спроби).
// Один виклик AI на раунд: tutor 'explain_guess' { audio, mime, target } → { transcript, guesses, correct, said }.
// Модель слова не бачить — target потрібен серверу лише для перевірки. Очки: 1-ша здогадка 3, 2-га 2, 3-тя 1; фол — 0.
import * as store from '../store.js';
import { h, ic } from '../ui/dom.js';
import { myLevel } from '../level.js';
import { activityTimer } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { speak, stop as stopSpeech, blobToBase64 } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { user } from '../supa.js';
import { onLeave } from '../router.js';
import { plural } from '../strings.js';
import { canRecord, createMic, recordRound, micErrorKind } from '../fluency.js';
import { bestUpdate } from './logic.js';
import {
  wordPool, gameState, saveGameState, beep, buzz, reducedMotion, gameHead, statPill, addWordButton, inMyWords,
  gameLoginCard, micErrorCard, countdownRing, levelMeter, gameIntro, startTile, gameResult, wordRow,
} from './common.js';
import { tx, txGroup, txRows, txPrimary, txGrid } from '../ui/tiles.js';

/** Налаштування гри (об'єкт, щоб тести могли скоротити тривалість) */
export const EXPLAIN = { words: 5, maxSec: 30, minMs: 1500, revealMs: 420 };
export const POINTS = [3, 2, 1];
const RECENT_MAX = 30;

/** Рамки-підказки, з яких зручно почати пояснення */
export const FRAMES = ['It\'s a thing that…', 'It\'s a person who…', 'You use it to…', 'It\'s the opposite of…', 'It\'s similar to…', 'You do it when…'];

// ---------- Логіка (чиста) ----------
/** Нормалізація слова — так само, як на сервері (coach.ts normWord): артиклі, -s/-ed/-ing у довгих словах */
export function normGuess(s) {
  let w = String(s || '').toLowerCase().replace(/[’']/g, '\'').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
  w = w.replace(/^(to|a|an|the) /, '');
  return w.split(' ').map(t => t.length > 4 ? t.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') : t).join(' ');
}

/** Результат раунду з відповіді сервера → { kind: 'hit'|'miss'|'foul', pts, idx } */
export function roundResult(res, target) {
  const guesses = Array.isArray(res?.guesses) ? res.guesses.map(String).slice(0, 3) : [];
  if (res?.said) return { kind: 'foul', pts: 0, idx: -1, guesses };
  if (!res?.correct) return { kind: 'miss', pts: 0, idx: -1, guesses };
  const t = normGuess(target);
  let idx = guesses.findIndex(g => normGuess(g) === t);
  if (idx < 0) idx = 0;   // сервер зарахував — довіряємо йому
  return { kind: 'hit', pts: POINTS[idx] ?? 1, idx, guesses };
}

/** Чи годиться картка для гри: слово або коротка фраза до 3 слів, без речень */
export function okTarget(en) {
  const s = String(en || '').trim();
  return s.length >= 2 && s.length <= 28 && /[a-z]/i.test(s) && s.split(/\s+/).length <= 3 && !/[?!,;:…()/]/.test(s) && !/\.\s*\S/.test(s);
}

/** Вага картки: ті, що чекають повтору, «забуті» й слабкі — частіше; фрази — трохи частіше; нещодавні — рідко */
export function cardWeight(c, now = Date.now(), recent = new Set()) {
  let w = 1;
  if (c.due && Date.parse(c.due) <= now) w += 3;
  if (c.state === 3) w += 2; else if (c.state === 1) w += 1;
  w += Math.min(3, c.lapses || 0);
  if ((c.stability || 0) < 5) w += 1;
  if ((c.tags || []).includes('phrase')) w += 1.5;
  if (recent.has(String(c.en).trim().toLowerCase())) w *= 0.12;
  return w;
}

function weightedPick(items, weights, n, rng = Math.random) {
  const out = [], it = items.slice(), ws = weights.slice();
  while (out.length < n && it.length) {
    const sum = ws.reduce((a, b) => a + b, 0);
    let r = rng() * sum, i = 0;
    while (i < ws.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
    out.push(it[i]); it.splice(i, 1); ws.splice(i, 1);
  }
  return out;
}

/** 5 слів для гри: спершу мої картки (reps > 0), далі — слова колод мого рівня */
export async function pickWords(n = EXPLAIN.words) {
  const recent = new Set(gameState().explainRecent || []);
  const seen = new Set();
  const mine = store.all('cards').filter(c => c.reps > 0 && okTarget(c.en)).filter(c => {
    const k = c.en.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const now = Date.now();
  const picked = weightedPick(mine, mine.map(c => cardWeight(c, now, recent)), n)
    .map(c => ({ id: c.id, en: c.en.trim(), uk: String(c.uk || '').trim(), ipa: c.ipa || '', own: true, phrase: (c.tags || []).includes('phrase') }));
  if (picked.length < n) {
    try {
      const { pool } = await wordPool({ neighbours: false });
      const have = new Set(picked.map(w => w.en.toLowerCase()));
      const rest = pool.filter(w => w.mine !== false && okTarget(w.en) && !have.has(w.en.toLowerCase()));
      const fresh = rest.filter(w => !recent.has(w.en.toLowerCase()));
      const src = fresh.length >= n - picked.length ? fresh : rest;
      for (const w of weightedPick(src, src.map(() => 1), n - picked.length)) picked.push({ ...w, own: inMyWords(w.en) });
    } catch (e) { console.warn('explain: колоди недоступні', e); }
  }
  return picked;
}

// ---------- Сторінка ----------
export default function explain(view) {
  setTitle('Поясни слово');
  const lv = myLevel();
  const live = h('div.sr-only', { 'aria-live': 'polite', role: 'status' });
  const body = h('div.stack');
  const fill = (...kids) => body.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  view.replaceChildren(h('div.stack.games.gx-game', gameHead(h('span.tag', lv)), body, live));
  if (!user()) { fill(gameLoginCard('Ваше пояснення слухає й розпізнає AI — і пробує вгадати слово. Це працює після входу.')); return; }

  const timer = activityTimer('game');
  const mic = createMic();
  const timers = new Set();
  let disposed = false, ctrl = null, ac = null, busy = false;
  let words = [], results = [], i = 0, score = 0;
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); return t; };
  const clearLater = () => { timers.forEach(clearTimeout); timers.clear(); };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearLater();
    ctrl?.cancel(); ctrl = null;
    ac?.abort(); ac = null;
    mic.close();
    stopSpeech();
    setFocus(false);
    timer.stop();
  };
  onLeave(view, cleanup);

  async function intro() {
    setFocus(false);
    clearLater();
    const best = gameState().best?.explain?.[lv] || 0;
    const start = startTile({ label: 'Почати', sub: `${EXPLAIN.words} слів · до ${EXPLAIN.maxSec} с на кожне`, onclick: newGame });
    fill(gameIntro({
      icon: 'chat-circle-dots',
      text: 'Поясніть слово англійською, не називаючи його, — AI вгадує.',
      rules: [`До ${EXPLAIN.maxSec} секунд на пояснення`, 'AI вгадав з першої спроби — 3 очки, з другої — 2, з третьої — 1', 'Назвали саме слово — фол, 0 очок'],
      top: [canRecord() ? null : micErrorCard('unsupported')],
      best: best ? { label: `Рекорд рівня ${lv}`, value: `${best} з ${EXPLAIN.words * POINTS[0]}` } : null,
      start: canRecord() ? start : null,
    }));
    if (canRecord()) start.focus({ preventScroll: true });
  }

  async function newGame() {
    if (busy) return;
    busy = true;
    words = await pickWords();
    busy = false;
    if (disposed) return;
    if (!words.length) {
      fill(tx({ icon: 'warning', label: 'Не вдалося підібрати слова', sub: 'Перевірте з\'єднання і спробуйте ще раз.', wide: true, tone: 'warn' }),
        txPrimary({ icon: 'arrow-clockwise', label: 'Спробувати ще раз', onclick: newGame }));
      return;
    }
    const recent = gameState().explainRecent || [];
    saveGameState({ explainRecent: [...words.map(w => w.en.toLowerCase()), ...recent.filter(x => !words.some(w => w.en.toLowerCase() === x))].slice(0, RECENT_MAX) });
    results = []; i = 0; score = 0;
    showWord();
  }

  // ---------- HUD і картка слова ----------
  function hud() {
    const n = statPill('cards', 'Слово');
    n.set(`${i + 1}/${words.length}`, `${i + 1} з ${words.length}`);
    const s = statPill('star', 'Очки');
    s.set(String(score));
    const dots = h('div.gx-dots', { 'aria-hidden': 'true' }, words.map((_, k) => h('i' + (results[k] ? '.' + results[k].kind : k === i ? '.cur' : ''))));
    return h('div.row.g-hud', n.el, s.el, h('div.grow'), dots);
  }
  function wordCard(w, { compact = false } = {}) {
    return h('div.card.gx-word' + (compact ? '.compact' : ''),
      h('div.xs.dim.gx-label', w.phrase ? 'Поясніть фразу' : 'Поясніть слово'),
      h('div.gx-target', { lang: 'en' }, w.en),
      w.uk ? h('div.gx-uk', w.uk) : null,
      compact ? null : h('div.gx-rule', ic('warning', { size: 16 }), 'Не називайте саме слово — це фол'));
  }
  const framesEl = (tap) => txGroup(tap ? 'Як почати · торкніться, щоб почути' : 'Як почати',
    h('div.chips.gx-frames', FRAMES.slice(0, 4).map(f => tap
      ? h('button.chip', { type: 'button', lang: 'en', onclick: () => speak(f.replace(/…/g, '')) }, f)
      : h('span.chip.static', { lang: 'en' }, f))));

  function showWord(note) {
    setFocus(true);
    clearLater();
    const w = words[i];
    const go = txPrimary({ icon: 'microphone', label: 'Пояснити', sub: `до ${EXPLAIN.maxSec} с, англійською`, onclick: startRec });
    fill(hud(), wordCard(w), note || null, framesEl(true), go,
      tx({ icon: 'arrow-right', label: 'Пропустити слово', wide: true, onclick: skip, cls: 'g-quiet' }));
    live.textContent = `Слово ${i + 1} з ${words.length}: ${w.en}${w.uk ? ' — ' + w.uk : ''}. Поясніть його, не називаючи.`;
    go.focus({ preventScroll: true });
  }

  function skip() {
    if (busy) return;   // мікрофон ще вмикається — запис піде вже для цього слова
    results[i] = { w: words[i], kind: 'skip', pts: 0 };
    next();
  }
  function next() {
    i++;
    if (i >= words.length) end(); else showWord();
  }

  // ---------- Запис ----------
  function startRec() {
    if (busy) return;
    busy = true;
    stopSpeech();
    // iOS: мікрофон — синхронно в обробнику тапу, до будь-якого await (getUserMedia викликається всередині ensure одразу)
    mic.ensure().then(() => { busy = false; if (!disposed) recording(); }, (e) => {
      busy = false;
      if (disposed) return;
      setFocus(false);
      fill(hud(), wordCard(words[i], { compact: true }), micErrorCard(micErrorKind(e), startRec),
        tx({ icon: 'arrow-left', label: 'До правил гри', wide: true, onclick: intro, cls: 'g-quiet' }));
    });
  }

  function recording() {
    const total = EXPLAIN.maxSec * 1000;
    const ring = countdownRing(148, 10);
    const meter = levelMeter();
    ring.set(total, total);
    const done = txPrimary({ icon: 'check', label: 'Готово', sub: 'надіслати пояснення AI', onclick: () => ctrl?.stop() });
    const cancel = tx({ icon: 'x', label: 'Скасувати', wide: true, onclick: () => { ctrl?.cancel(); ctrl = null; showWord(); }, cls: 'g-quiet' });
    fill(hud(), wordCard(words[i], { compact: true }),
      h('div.gx-rec', ring.el, h('div.stack.gx-rec-side', h('div.gx-live', h('span.gx-dot'), 'Запис'), meter.el)),
      framesEl(false), done, cancel);
    live.textContent = 'Запис почався. Поясніть слово англійською.';
    done.focus({ preventScroll: true });
    try {
      ctrl = recordRound(mic, { maxMs: total, onTick: ({ left, level, voiced }) => { ring.set(left, total); meter.push(level, voiced); } });
    } catch (e) {
      fill(hud(), micErrorCard(micErrorKind(e), startRec));
      return;
    }
    const c = ctrl;
    c.done.then((rec) => {
      if (ctrl === c) ctrl = null;
      if (!rec || disposed) return;
      if (rec.ms < EXPLAIN.minMs) return showWord(h('p.feedback.no.gx-note', { role: 'alert' }, 'Запис закороткий — розкажіть про слово хоча б кількома реченнями.'));
      judge(rec);
    });
  }

  // ---------- Оцінка ----------
  async function judge(rec) {
    const w = words[i];
    setFocus(true);
    fill(hud(), wordCard(w, { compact: true }),
      h('div.card.gx-think', { 'aria-busy': 'true' }, h('span.gx-thinkdots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', 'AI слухає і вгадує…')));
    live.textContent = 'AI слухає і вгадує';
    ac = new AbortController();
    const my = ac;
    let res;
    try {
      const audio = await blobToBase64(rec.blob);
      if (disposed || my.signal.aborted) return;
      res = await tutor('explain_guess', { audio, mime: rec.mime, target: w.en }, { signal: my.signal });
    } catch (e) {
      if (disposed || e?.name === 'AbortError') return;
      setFocus(false);
      fill(hud(), wordCard(w, { compact: true }),
        tx({ icon: 'warning', label: 'Не вдалося отримати відповідь', sub: aiErrorText(e) || 'Спробуйте ще раз.', wide: true, tone: 'bad', attrs: { role: 'alert' } }),
        txPrimary({ icon: 'arrow-clockwise', label: 'Надіслати ще раз', onclick: () => judge(rec) }),
        txGrid([tx({ icon: 'microphone', label: 'Записати знову', onclick: () => showWord() }), tx({ icon: 'arrow-right', label: 'Пропустити слово', onclick: skip })], 2));
      return;
    } finally { if (ac === my) ac = null; }
    if (disposed) return;
    const r = roundResult(res, w.en);
    results[i] = { w, ...r, transcript: String(res?.transcript || '') };
    score += r.pts;
    reveal(results[i]);
  }

  const ORD = ['першої', 'другої', 'третьої'];
  function verdictOf(r) {
    if (r.kind === 'hit') return { cls: 'hit', icon: 'check-circle', title: `Вгадано з ${ORD[r.idx]} спроби!`, sub: `+${r.pts} ${plural(r.pts, 'очко', 'очки', 'очок')}` };
    if (r.kind === 'foul') return { cls: 'foul', icon: 'warning', title: 'Фол — ви сказали слово', sub: '0 очок. Спробуйте описати його іншими словами.' };
    return { cls: 'miss', icon: 'x-circle', title: 'AI не вгадав', sub: '0 очок. Додайте приклад або протилежність — так легше.' };
  }

  /** Здогадки з'являються по одній, потім — вердикт (зменшений рух: одразу все) */
  function reveal(r) {
    const w = r.w;
    const v = verdictOf(r);
    const guessEls = (r.guesses.length ? r.guesses : ['—']).map((g, k) => h('li.gx-guess' + (k === r.idx ? '.hit' : r.kind === 'hit' && k > r.idx ? '.after' : '.wrong'),
      h('span.gx-gnum', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', { lang: 'en' }, g),
      ic(k === r.idx ? 'check' : r.kind === 'hit' && k > r.idx ? 'circle' : 'x', { size: 18 })));
    const list = h('ol.gx-guesses', { 'aria-label': 'Здогадки AI' }, guessEls);
    const verdict = h('div.gx-verdict.' + v.cls, { role: 'status' }, ic(v.icon, { size: 28, fill: true }),
      h('div.grow', h('div.gx-vt', v.title), h('div.xs', v.sub)));
    const heard = txGroup('AI почув', transcriptEl(r.transcript, r.kind === 'foul' ? w.en : null));
    const answer = wordRow({ en: w.en, uk: w.uk, cls: 'gx-answer' });
    const last = i >= words.length - 1;
    const nextBtn = txPrimary({ icon: last ? 'flag' : 'arrow-right', label: last ? 'Підсумок' : 'Наступне слово', sub: last ? 'очки й слова гри' : `слово ${i + 2} з ${words.length}`, onclick: next });
    const after = h('div.stack.gx-after', heard, answer, nextBtn);
    const sec = txGroup('Здогадки AI', list);
    fill(hud(), sec, verdict, after);
    setFocus(false);
    const finish = () => {
      verdict.classList.add('in'); after.classList.add('in');
      r.kind === 'hit' ? (beep('ok'), buzz(15)) : (beep('bad'), buzz(60));
      live.textContent = `${v.title} ${v.sub}`;
      nextBtn.focus({ preventScroll: true });
    };
    if (reducedMotion() || EXPLAIN.revealMs <= 0) { guessEls.forEach(el => el.classList.add('in')); finish(); return; }
    verdict.classList.add('wait'); after.classList.add('wait');
    const stop = r.kind === 'hit' ? r.idx : guessEls.length - 1;
    guessEls.forEach((el, k) => later(() => { el.classList.add('in'); if (k <= stop) beep('key'); }, EXPLAIN.revealMs * k));
    later(finish, EXPLAIN.revealMs * (stop + 1) + 120);
  }

  /** Транскрипт (текст — лише текстовими вузлами); при фолі підсвічуємо назване слово */
  function transcriptEl(text, foulWord) {
    const p = h('p.gx-transcript', { lang: 'en' });
    if (!text.trim()) { p.classList.add('empty'); p.textContent = 'Нічого не розібрав — говоріть ближче до мікрофона.'; p.removeAttribute('lang'); return p; }
    const t = foulWord ? normGuess(foulWord) : null;
    const multi = t && t.includes(' ');
    for (const part of text.split(/(\s+)/)) {
      if (t && !multi && /\S/.test(part) && normGuess(part) === t) p.append(h('mark.gx-foul', part));
      else p.append(document.createTextNode(part));
    }
    return p;
  }

  // ---------- Підсумок ----------
  function end() {
    setFocus(false);
    clearLater();
    mic.close();
    const st = gameState();
    const upd = bestUpdate(st.best?.explain, lv, score);
    saveGameState({ best: { ...(st.best || {}), explain: upd.best } });
    upd.record ? (beep('win'), buzz([30, 40, 30])) : beep('lose');
    const hits = results.filter(r => r?.kind === 'hit');
    const first = hits.filter(r => r.idx === 0).length;
    const fouls = results.filter(r => r?.kind === 'foul').length;
    const max = words.length * POINTS[0];
    const ICON = { hit: 'check-circle', miss: 'x-circle', foul: 'warning', skip: 'arrow-right' };
    const LABEL = { hit: 'вгадано', miss: 'не вгадано', foul: 'фол', skip: 'пропущено' };
    fill(gameResult({
      icon: 'chat-circle-dots', record: upd.record, score: String(score), unit: ` / ${max}`,
      sub: score >= max * 0.8 ? 'Блискуче пояснення!' : score >= max / 2 ? 'Добра гра!' : 'Пояснювати — найкраще тренування говоріння',
      kpis: [{ value: `${hits.length}/${words.length}`, label: 'вгадано', tone: 'good' }, { value: first, label: 'з першої спроби' }, { value: fouls, label: plural(fouls, 'фол', 'фоли', 'фолів'), tone: fouls ? 'warn' : '' }],
      note: upd.prev && !upd.record ? `Рекорд рівня ${lv}: ${upd.prev}` : null,
      sections: [txGroup('Слова гри', txRows(results.map((r) => wordRow({
        en: r.w.en, uk: r.w.uk, cls: 'gx-res.' + r.kind,
        end: [r.w.own || inMyWords(r.w.en) ? null : addWordButton(r.w, { compact: true }),
          h('span.tx-pill.gx-pts' + (r.kind === 'hit' ? '.good' : r.kind === 'foul' ? '.warn' : ''), { 'aria-label': `${LABEL[r.kind]}, ${r.pts} ${plural(r.pts, 'очко', 'очки', 'очок')}` }, ic(ICON[r.kind], { size: 14 }), r.kind === 'hit' ? `+${r.pts}` : '0')],
      }))))],
      primary: { icon: 'arrow-clockwise', label: 'Ще гра', sub: `${EXPLAIN.words} нових слів`, onclick: newGame },
      more: [{ icon: 'game-controller', label: 'Усі ігри', href: '#/games' }],
    }));
    live.textContent = `Гру завершено. Очки: ${score} з ${max}.` + (upd.record ? ' Новий рекорд!' : '');
    body.querySelector('.g-again')?.focus({ preventScroll: true });
  }

  intro();
}
