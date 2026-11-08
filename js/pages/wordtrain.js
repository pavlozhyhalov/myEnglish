// Тренування слів: активні вправи замість «перевернути й оцінити себе».
// Розклад — той самий FSRS (js/srs.js): одна оцінка на слово за сесію, виводиться з першої відповіді
// (правильно й швидко → Добре/Легко, з підказкою/опискою/повільно → Важко, помилка → Знову).
// Далі в сесії слово повторюється лише як практика — доки не буде правильної відповіді.
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { withCards } from '../data.js';
import { speak, stop as stopSpeech, recognize, canRecognize, compareWords } from '../speech.js';
import { activityTimer, dayKey, today } from '../stats.js';
import { setFocus } from '../ui/shell.js';
import { modalOpen } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { myLevel, fitOrder } from '../level.js';
import { user } from '../supa.js';
import { tutor, aiErrorText } from '../ai.js';
import * as L from '../wordlogic.js';
import { onLeave, parse } from '../router.js';
import { tx, txPrimary, txKpis, txGroup, txRows, txPill } from '../ui/tiles.js';
import { resHead } from './cards.js';

const MAX_DUE = 30;            // повторів за сесію (решта — наступного разу)
const MAX_NEW = 20;            // нових слів за сесію (у межах денного ліміту з налаштувань; довшу сесію обмежує TIME_CAP)
const TIME_CAP = 15 * 60e3;    // після 15 хв нові слова вже не починаємо
const MATCH_EVERY = 8;         // міні-гра «пари» — після кожних 8 оцінених слів
const SPEAK_EVERY = 5;         // «скажіть уголос» — приблизно для кожного 5-го слова
const CHOICE = new Set(['recognize', 'reverse', 'listen', 'cloze-choice']);
const KIND_LABEL = {
  intro: 'Нове слово', recognize: 'Що це означає?', reverse: 'Як це англійською?', listen: 'Що ви почули?', 'listen-type': 'Напишіть, що почули',
  cloze: 'Вставте слово', 'cloze-choice': 'Вставте слово', recall: 'Напишіть англійською', builder: 'Складіть речення', speak: 'Скажіть уголос', match: 'Знайдіть пари',
};

// ---------- Звук і вібрація (тихо, лише після дії користувача) ----------
const soundOn = () => localStorage.getItem('me:wt-sound') !== '0';
let actx = null;
function beep(kind) {
  if (!soundOn()) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = { good: [660, 880], combo: [660, 880, 1175], done: [523, 659, 784, 1047], bad: [247, 208] }[kind] || [660];
    let t = actx.currentTime;
    for (const f of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'bad' ? 'triangle' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.18);
      t += 0.085;
    }
  } catch { /* без звуку */ }
}
function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* */ } }
const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Пул для дистракторів: колоди слів сесії + «Мої слова»; замало — додаємо колоди мого рівня */
async function buildPool(words, decks) {
  const items = [], seen = new Set();
  const add = (c, d) => {
    const id = d ? srs.starterId(d.id, c.en) : c.id;
    if (!c.en || !c.uk || seen.has(id)) return;
    seen.add(id);
    items.push({ id, en: c.en, uk: c.uk, deck_id: d ? d.id : c.deck_id, level: d?.level || null, pos: c.pos || null });
  };
  const ids = new Set(words.map(w => w.deck_id).filter(id => id && id !== 'my'));
  try {
    for (const d of await withCards(decks.filter(d => d.builtin && ids.has(d.id)))) for (const c of d.cards) add(c, d);
  } catch (e) { console.warn('pool', e); }
  for (const c of store.all('cards')) add(c, null);
  for (const w of words) add(w, null);
  if (items.length < 60) {
    try {
      const extra = decks.filter(d => d.builtin && d.enabled && fitOrder(d.level) === 0 && !ids.has(d.id)).slice(0, 3);
      for (const d of await withCards(extra)) for (const c of d.cards) add(c, d);
    } catch (e) { console.warn('pool+', e); }
  }
  return items;
}

/**
 * Сесія тренування. Використовується на #/cards/train і в «Почати заняття».
 * opts: limit — макс. слів; onExit(); onDone(stats) — замість підсумкового екрана;
 * practice — масив карток для повторення без оцінок FSRS (наприклад, найважчі слова після сесії)
 */
export async function runTrain(view, { limit = Infinity, onExit, onDone, practice = null } = {}) {
  setFocus(true);
  const timer = activityTimer('cards');
  const started = Date.now();
  // «Мій день» (#/cards/train?daily=1): сесія обмежена ціллю плану, наприкінці — «Далі за планом»
  const daily = !practice && !onDone && parse().query.daily === '1';
  if (daily) {
    try {
      const D = await import('../daily.js');
      const target = D.wordsTarget(), left = target - D.reviewedToday();
      limit = Math.min(limit, left > 0 ? left : target);
    } catch (e) { console.warn('daily', e); limit = Math.min(limit, 12); }
  }
  const decks = await srs.decks();
  const deckMeta = new Map(decks.map(d => [d.id, d]));
  let words;
  if (practice) words = practice.slice();
  else {
    const due = (await srs.dueCards()).slice(0, MAX_DUE);
    const fresh = (await srs.newCards()).slice(0, MAX_NEW);
    words = L.interleave(due, fresh);
    if (Number.isFinite(limit)) words = words.slice(0, limit);
  }
  const level = myLevel();

  let finished = false;
  const cleanupFns = [];
  const stopAll = () => { document.removeEventListener('keydown', onKey); clearTimeout(autoNext); cleanupFns.forEach(f => f()); cleanupFns.length = 0; stopSpeech(); };

  if (!words.length) {
    const sess = timer.stop();
    if (onDone) { onDone({ done: 0, again: 0, seconds: sess?.seconds || 0, early: false }); return () => setFocus(false); }
    setFocus(false);
    view.replaceChildren(h('div.stack-lg.wt-end',
      resHead({ icon: 'confetti', tone: 'good', eyebrow: 'Підсумок', title: 'На сьогодні все', sub: 'Нові слова — завтра' }),
      h('div.stack.lr-next',
        daily ? txPrimary({ icon: 'arrow-right', label: 'Далі за планом', sub: 'наступний крок «Мого дня»', href: '#/today', cls: 'wt-daily-next' }) : null,
        daily ? tx({ icon: 'plus', label: 'Додати свої слова', sub: 'у «Мої слова»', href: '#/vocab', wide: true })
          : txPrimary({ icon: 'plus', label: 'Додати свої слова', sub: 'у «Мої слова»', href: '#/vocab' }))));
    return () => {};
  }

  const pool = await buildPool(words, decks);
  const items = words.map(card => ({
    card, isNew: !card.reps, level: deckMeta.get(card.deck_id)?.level || null,
    rating: 0, graded: false, wrong: 0, firstWrong: false, answered: 0, spoke: false,
  }));
  const queue = [];
  for (const it of items) {
    if (it.isNew && !practice) queue.push({ it, kind: 'intro' }, { it, kind: 'recognize', graded: true });
    else queue.push({ it, kind: null, graded: !practice });
  }

  let cur = null, shownAt = 0, prevKind = null, combo = 0, maxCombo = 0, gradedCount = 0, sinceMatch = 0, capped = false, autoNext = 0;
  let speakOff = !canRecognize();
  // вправи на слух — лише коли є чим озвучити (і учень не сказав «не можу зараз слухати»)
  let audioOff = false;
  const canAudio = () => !audioOff && (typeof speechSynthesis !== 'undefined' || (store.settings().ttsEngine === 'gemini' && !!user()));
  // інше відоме слово з описка-відстанню (desert ↔ dessert) — не описка
  const known = new Set(pool.map(p => L.core(p.en)));

  // ---------- Каркас ----------
  const fill = h('i', { style: { width: '0%' } });
  const bar = h('div.progress.wt-bar', { role: 'progressbar', 'aria-label': 'Пройдено слів', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, fill);
  const comboEl = h('span.wt-combo', { hidden: true, 'aria-live': 'polite' });
  const soundBtn = h('button.icon-btn.wt-sound', {
    type: 'button', 'aria-label': 'Звуки', 'aria-pressed': String(soundOn()),
    onclick: () => { localStorage.setItem('me:wt-sound', soundOn() ? '0' : '1'); soundBtn.setAttribute('aria-pressed', String(soundOn())); },
  }, ic('speaker-high', { size: 20 }));
  const stage = h('div.wt-stage');
  const foot = h('div.wt-foot', { role: 'status', 'aria-live': 'polite' });
  const root = h('div.wt',
    h('div.row.wt-top', h('button.icon-btn', { type: 'button', 'aria-label': 'Завершити', onclick: () => finish(true) }, ic('x')), h('div.grow', bar), comboEl, soundBtn),
    stage, foot);
  view.replaceChildren(root);

  function updateBar() {
    const done = items.filter(it => (it.graded || (practice && it.answered)) && !queue.some(s => s.it === it) && cur?.it !== it).length;
    const pct = Math.round(done / items.length * 100);
    fill.style.width = `${Math.max(pct, 2)}%`;
    bar.setAttribute('aria-valuenow', String(pct));
  }
  function showCombo() {
    if (combo < 3) { comboEl.hidden = true; return; }
    comboEl.hidden = false;
    comboEl.replaceChildren(ic('lightning', { size: 16, fill: true }), `×${combo}`);
    comboEl.setAttribute('aria-label', `Комбо: ${combo} поспіль`);
    if (!reducedMotion()) { comboEl.classList.remove('pop'); void comboEl.offsetWidth; comboEl.classList.add('pop'); }
  }
  /** Вставити крок через n кроків (або в кінець) */
  function later(step, n) { queue.splice(Math.min(n, queue.length), 0, step); }

  // ---------- Перехід між кроками ----------
  function next() {
    clearTimeout(autoNext);
    stopSpeech();
    cleanupFns.forEach(f => f()); cleanupFns.length = 0;
    if (finished) return;
    if (!capped && !practice && Date.now() - started > TIME_CAP) {
      capped = true;
      // слова, яких ще не торкались, лишаються до наступної сесії (FSRS їх не втратить)
      const untouched = new Set(items.filter(it => !it.answered && !it.graded));
      const before = queue.length;
      for (let i = queue.length - 1; i >= 0; i--) if (untouched.has(queue[i].it)) queue.splice(i, 1);
      if (queue.length < before) toast('15 хвилин минуло — решта слів чекатиме наступного разу');
    }
    if (!queue.length) return finish(false);
    cur = queue.shift();
    if (!cur.kind) cur.kind = pickKind(cur.it);
    shownAt = Date.now();
    foot.replaceChildren();
    updateBar();
    render();
  }

  function pickKind(it) {
    const hasCloze = !!L.clozeOf(it.card);
    let k = L.chooseKind(it.card, { hasCloze, build: L.canBuild({ ...it.card, level: it.level }, level), prev: prevKind, audio: canAudio() });
    if (k === 'intro') k = 'recognize';    // практика вже введеного слова
    if (k === 'cloze' && L.stageOf(it.card) !== 'mature' && (it.card.stability || 0) < 7) k = 'cloze-choice';
    return k;
  }

  function render() {
    if (cur.kind.startsWith('listen') && !canAudio()) cur.kind = cur.kind === 'listen' ? (prevKind === 'reverse' ? 'recognize' : 'reverse') : 'recall';
    const { it, kind } = cur;
    let el;
    if (kind === 'intro') el = introEx(it);
    else if (kind === 'match') el = matchEx();
    else if (kind === 'speak') el = speakEx(it);
    else if (kind === 'builder') el = builderEx(it);
    else if (CHOICE.has(kind)) el = choiceEx(it, kind);
    else el = typedEx(it, kind);
    if (!el && kind === 'match') { cur.answeredNow = true; return next(); }
    if (!el) { cur.kind = kind === 'recognize' ? 'recall' : 'recognize'; return render(); }
    prevKind = cur.kind;
    stage.replaceChildren(h('div.wt-card' + (reducedMotion() ? '' : '.enter'), h('span.wt-kind', KIND_LABEL[cur.kind] || ''), el));
    const focusEl = stage.querySelector('input:not([disabled])') || stage.querySelector('[data-autofocus]');
    focusEl?.focus({ preventScroll: true });
  }

  // ---------- Відповідь ----------
  /** res: { correct, almost, hints, given, expected } */
  function onAnswer(res) {
    if (cur.answeredNow) return;
    cur.answeredNow = true;
    const { it, kind } = cur;
    const ms = Date.now() - shownAt;
    timer.poke();
    it.answered++;
    if (cur.graded && !it.graded && !practice) {
      const rating = L.ratingFor({ kind, correct: res.correct, almost: res.almost, hints: res.hints || 0, ms, answer: res.expected || it.card.en, isNew: it.isNew });
      srs.grade(it.card, rating, ms);
      it.graded = true; it.rating = rating;
      if (!res.correct) it.firstWrong = true;
      gradedCount++; sinceMatch++;
    }
    if (res.correct) {
      combo++; maxCombo = Math.max(maxCombo, combo);
      beep(combo > 0 && combo % 5 === 0 ? 'combo' : 'good'); buzz(12);
      if (it.isNew && kind === 'recognize' && cur.graded) later({ it, kind: 'reverse' }, 4);
      else if (!speakOff && !it.spoke && !it.isNew && gradedCount % SPEAK_EVERY === 0 && cur.graded) { it.spoke = true; later({ it, kind: 'speak' }, 0); }
    } else {
      it.wrong++;
      combo = 0;
      beep('bad'); buzz([30, 40, 30]);
      later({ it, kind: L.retryKind(kind, it.wrong) }, 3);
    }
    showCombo();
    if (sinceMatch >= MATCH_EVERY && seenCards().length >= 5 && !queue.some(s => s.kind === 'match')) { sinceMatch = 0; later({ kind: 'match' }, res.correct ? 0 : 1); }
    feedback(res);
    updateBar();
  }

  const seenCards = () => items.filter(it => it.answered).map(it => ({ id: it.card.id, en: it.card.en, uk: it.card.uk }));

  function feedback(res) {
    const { it, kind } = cur;
    const c = it.card;
    const ex = c.examples?.[0];
    const title = res.correct ? (res.almost ? 'Майже! Зараховано' : pickPraise()) : 'Правильна відповідь';
    const nextBtn = h('button.btn.primary.lg.block', { type: 'button', 'data-next': '', onclick: next }, 'Далі', ic('arrow-right'));
    foot.replaceChildren(h('div.wt-fb.' + (res.correct ? (res.almost ? 'almost' : 'ok') : 'no'),
      h('div.row', ic(res.correct ? 'check-circle' : 'x-circle', { size: 24, fill: true }), h('b.grow', title),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(c.en) }, ic('speaker-high', { size: 20 }))),
      h('div.wt-fb-word', h('span.en', kind === 'builder' && ex ? ex.en : (res.expected && kind.startsWith('cloze') ? res.expected : c.en)), c.ipa && kind !== 'builder' ? h('span.ipa', ` ${c.ipa}`) : null, h('span.dim', ` — ${kind === 'builder' && ex?.uk ? ex.uk : c.uk}`)),
      res.given && (!res.correct || res.almost) ? h('div.small', 'Ваша відповідь: ', h('s', res.given)) : null,
      !res.correct && ex && kind !== 'builder' ? h('div.small.dim', ex.en) : null),
    nextBtn);
    nextBtn.focus({ preventScroll: true });
    requestAnimationFrame(() => nextBtn.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }));
    if (store.settings().autoSpeak !== false && !kind.startsWith('listen')) setTimeout(() => { if (cur?.answeredNow && cur.it === it) speak(c.en); }, 280);
    // правильний вибір з варіантів — далі автоматично (кнопка «Далі» — щоб не чекати)
    if (res.correct && !res.almost && CHOICE.has(kind)) autoNext = setTimeout(() => { if (nextBtn.isConnected) next(); }, 1300);
  }
  const PRAISE = ['Правильно!', 'Чудово!', 'Так тримати!', 'Саме так!', 'Влучно!'];
  const pickPraise = () => combo >= 5 ? `Чудово! ${combo} поспіль` : PRAISE[Math.floor(Math.random() * PRAISE.length)];

  // ---------- Вправи ----------
  const speakBtn = (text, label = 'Прослухати', size = 22) => h('button.icon-btn.soft', { type: 'button', 'aria-label': label, onclick: () => speak(text) }, ic('speaker-high', { size }));
  const autoSay = (text) => { if (store.settings().autoSpeak !== false) setTimeout(() => { if (stage.isConnected) speak(text); }, 250); };
  const targetOf = (it) => ({ id: it.card.id, en: it.card.en, uk: it.card.uk, deck_id: it.card.deck_id, level: it.level, pos: it.card.pos });
  const display = (en) => L.shown(en);

  function introEx(it) {
    const c = it.card;
    autoSay(c.en);
    const exs = (c.examples || []).filter(e => e?.en).slice(0, 2);
    return h('div.stack.wt-intro',
      h('div.row', { style: { justifyContent: 'center', gap: '12px' } }, h('div.wt-big', { lang: 'en' }, c.en), speakBtn(c.en)),
      c.ipa ? h('div.ipa.center', c.ipa) : null,
      h('div.wt-uk', c.uk),
      exs.map(e => h('div.wt-example', h('div.grow', h('div', { lang: 'en' }, e.en), e.uk ? h('div.xs.dim', e.uk) : null), speakBtn(e.en, 'Прослухати приклад', 20))),
      h('button.btn.primary.lg.block', { type: 'button', 'data-autofocus': '', onclick: () => { timer.poke(); cur.answeredNow = true; it.answered++; next(); } }, 'Запам\'ятав — перевірити'),
      // слово вже знайоме: одразу «вивчено» (довгий контрольний повтор), без вправ на нього в цій сесії
      h('button.btn.ghost.block.sm', { type: 'button', onclick: () => {
        if (cur.answeredNow) return;
        timer.poke(); cur.answeredNow = true; it.answered++; it.graded = true; it.rating = 4;
        srs.markKnown(c);
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].it === it) queue.splice(i, 1);
        toast(`«${c.en}» — вивчено`, { action: 'Скасувати', ms: 4000, onAction: () => { srs.undoKnown(c); } });
        next();
      } }, ic('check-circle'), 'Я вже знаю це слово'));
  }

  function choiceEx(it, kind) {
    const t = targetOf(it);
    const field = kind === 'recognize' ? 'uk' : 'en';
    const ds = L.pickDistractors(t, pool, { n: 3, field });
    if (!ds.length) return null;
    const cl = kind === 'cloze-choice' ? L.clozeOf(it.card) : null;
    if (kind === 'cloze-choice' && !cl) return null;
    const label = (o) => field === 'uk' ? o.uk : kind === 'cloze-choice' ? display(o.en).replace(/^to\s+/i, '') : display(o.en);
    const opts = L.shuffle([t, ...ds]);
    const right = opts.indexOf(t);
    const btns = opts.map((o, k) => h('button.opt.wt-opt', {
      type: 'button', lang: field === 'en' ? 'en' : 'uk', 'data-key': String(k + 1),
      onclick: () => {
        if (cur.answeredNow) return;
        const ok = k === right;
        btns.forEach(b => { b.disabled = true; });
        btns[k].classList.add(ok ? 'right' : 'wrong');
        btns[right].classList.add('right');
        onAnswer({ correct: ok, given: ok ? '' : label(o), expected: label(t) });
      },
    }, h('span.wt-key', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', label(o))));
    let prompt;
    if (kind === 'recognize') { prompt = h('div.row', { style: { justifyContent: 'center', gap: '12px' } }, h('div.wt-big', { lang: 'en' }, it.card.en), speakBtn(it.card.en)); autoSay(it.card.en); }
    else if (kind === 'reverse') prompt = h('div.wt-big.uk', it.card.uk);
    else if (kind === 'listen') prompt = listenPrompt(it.card.en);
    else prompt = h('div.stack', { style: { gap: '6px' } }, h('div.wt-sentence', { lang: 'en' }, cl.before, h('span.wt-blank', '_____'), cl.after), cl.uk ? h('div.small.dim', cl.uk) : null,
      h('div.xs.dim', 'Слово в реченні може змінити форму'));
    return h('div.stack', prompt, h('div.stack.wt-opts', { role: 'group', 'aria-label': 'Варіанти відповіді' }, btns));
  }

  function listenPrompt(text) {
    setTimeout(() => { if (stage.isConnected) speak(text); }, 250);
    // велика кнопка по центру, під нею — «Повільніше» і «Не можу слухати» в один рядок
    return h('div.wt-listen-box',
      h('button.wt-listen', { type: 'button', 'aria-label': 'Прослухати ще раз', onclick: () => speak(text) }, ic('speaker-high', { size: 44 })),
      h('div.wt-listen-acts',
        h('button.btn.soft.sm', { type: 'button', onclick: () => speak(text, { rate: 0.7 }) }, ic('timer', { size: 16 }), 'Повільніше'),
        // без звуку (транспорт, тиша): вправи на слух вимикаються до кінця сесії, слово — в іншій вправі
        h('button.btn.ghost.sm', { type: 'button', onclick: () => { if (cur.answeredNow) return; audioOff = true; stopSpeech(); shownAt = Date.now(); render(); } }, 'Не можу слухати')));
  }

  function typedEx(it, kind) {
    const cl = kind === 'cloze' ? L.clozeOf(it.card) : null;
    if (kind === 'cloze' && !cl) return null;
    const expected = cl ? cl.answer : display(it.card.en).replace(/^to\s+/i, '');
    let hints = 0;
    const letters = L.letterCount(expected);
    const mask = h('div.wt-mask', { lang: 'en', 'aria-label': `Літер: ${letters}` }, L.maskOf(expected, 0));
    const inp = h('input.input.wt-input', {
      type: 'text', lang: 'en', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
      'aria-label': 'Ваша відповідь англійською', placeholder: 'Напишіть англійською',
    });
    const check = () => {
      if (cur.answeredNow) return;
      const val = inp.value.trim();
      const r = cl ? L.checkCloze(val, cl, it.card.en) : L.checkTyped(val, it.card.en, { known });
      if (r.empty) { inp.classList.remove('shake'); void inp.offsetWidth; if (!reducedMotion()) inp.classList.add('shake'); inp.focus(); return; }
      inp.disabled = true; hintBtn.disabled = true; checkBtn.hidden = true; giveUp.hidden = true;
      mask.textContent = expected;
      onAnswer({ correct: r.ok, almost: r.almost, hints, given: val, expected: cl ? cl.answer : display(it.card.en) });
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); } });
    const hintBtn = h('button.btn.soft', { type: 'button', onclick: () => {
      if (hints >= letters) return;
      hints++;
      mask.textContent = L.maskOf(expected, hints);
      // відкриті літери — у полі, щоб не передруковувати
      const shown = L.maskOf(expected, hints).replace(/_[\s\S]*$/, '');
      if (!inp.value || shown.toLowerCase().startsWith(inp.value.toLowerCase())) inp.value = shown;
      inp.focus();
    } }, ic('lightbulb', { size: 18 }), 'Підказка');
    const checkBtn = h('button.btn.primary.grow', { type: 'button', onclick: check }, 'Перевірити');
    const giveUp = h('button.btn.ghost.sm', { type: 'button', onclick: () => {
      if (cur.answeredNow) return;
      inp.disabled = true; hintBtn.disabled = true; checkBtn.hidden = true; giveUp.hidden = true; mask.textContent = expected;
      onAnswer({ correct: false, given: inp.value.trim(), expected });
    } }, 'Не знаю');
    let prompt;
    if (kind === 'recall') prompt = h('div.stack', { style: { gap: '6px', alignItems: 'center' } }, h('div.wt-big.uk', it.card.uk), it.card.pos ? h('div.xs.dim', it.card.pos) : null);
    else if (kind === 'listen-type') prompt = listenPrompt(it.card.en);
    else prompt = h('div.stack', { style: { gap: '6px' } }, h('div.wt-sentence', { lang: 'en' }, cl.before, h('span.wt-blank', '_____'), cl.after),
      h('div.small', h('span.tag.accent', it.card.uk)), cl.uk ? h('div.small.dim', cl.uk) : null);
    return h('div.stack', prompt, mask, inp, h('div.row', hintBtn, checkBtn), h('div.center', giveUp));
  }

  function builderEx(it) {
    const ex = it.card.examples?.[0];
    if (!ex?.en) return null;
    const tiles = L.tilesOf(ex.en).map((w, i) => ({ w, i }));
    let order = L.shuffle(tiles);
    for (let k = 0; k < 5 && order.every((t, i) => t.i === i); k++) order = L.shuffle(tiles);
    const placed = [];
    const line = h('div.answer-line.ex-line', { 'aria-label': 'Ваше речення', 'data-ph': 'Торкайтесь слів унизу по черзі' });
    const bank = h('div.word-bank.ex-bank', { 'aria-label': 'Слова' });
    const checkBtn = h('button.btn.primary.grow', { type: 'button', disabled: true, onclick: () => check() }, 'Перевірити');
    const draw = () => {
      line.replaceChildren(...placed.map((t, k) => h('button.chip', { type: 'button', lang: 'en', onclick: () => { if (cur.answeredNow) return; placed.splice(k, 1); draw(); } }, t.w)));
      bank.replaceChildren(...order.filter(t => !placed.includes(t)).map(t => h('button.chip', { type: 'button', lang: 'en', onclick: () => { if (cur.answeredNow) return; placed.push(t); draw(); bank.querySelector('button')?.focus({ preventScroll: true }); } }, t.w)));
      checkBtn.disabled = placed.length !== tiles.length;
    };
    const check = () => {
      if (cur.answeredNow) return;
      const given = placed.map(t => t.w).join(' ');
      line.classList.add('done'); bank.classList.add('done'); checkBtn.hidden = true; giveUp.hidden = true;
      onAnswer({ correct: L.sameSentence(given, ex.en), given, expected: ex.en });
    };
    const giveUp = h('button.btn.ghost.sm', { type: 'button', onclick: () => { if (cur.answeredNow) return; line.classList.add('done'); bank.classList.add('done'); checkBtn.hidden = true; giveUp.hidden = true; onAnswer({ correct: false, given: placed.map(t => t.w).join(' '), expected: ex.en }); } }, 'Не знаю');
    draw();
    return h('div.stack',
      ex.uk ? h('div.wt-sentence.uk', ex.uk) : null,
      h('div.small', 'Зі словом ', h('span.tag.accent', { lang: 'en' }, display(it.card.en))),
      line, bank, h('div.row', checkBtn), h('div.center', giveUp));
  }

  function speakEx(it) {
    const c = it.card;
    const out = h('div.small.center', { 'aria-live': 'polite' });
    let ctrl = null;
    cleanupFns.push(() => ctrl?.abort());
    const mic = h('button.wt-listen.mic', { type: 'button', 'aria-label': 'Сказати', 'data-autofocus': '', onclick: async () => {
      if (cur.answeredNow) return;
      if (ctrl) { ctrl.abort(); return; }
      ctrl = new AbortController();
      mic.classList.add('rec'); out.textContent = 'Слухаю…';
      try {
        const res = await recognize({ onInterim: t => { out.textContent = t; }, signal: ctrl.signal });
        if (!mic.isConnected) return;
        const cmp = compareWords(c.en, res.text || '');
        if (!res.text) { out.textContent = 'Нічого не почуто — спробуйте ще раз'; return; }
        out.replaceChildren(h('div', cmp.words.map(w => [h('span', { class: w.ok ? 'word-ok' : 'word-no' }, w.raw), ' '])), h('div.dim', `почуто: «${res.text}»`));
        if (cmp.pct >= 70) { skip.hidden = true; onAnswer({ correct: true, given: '', expected: c.en }); }
        else out.append(h('div', 'Ще раз? Або пропустіть.'));
      } catch (err) {
        out.textContent = err.code === 'mic' ? 'Немає доступу до мікрофона — вправу «скажіть уголос» вимкнено на цю сесію.' : 'Не вдалося розпізнати.';
        if (err.code === 'mic' || err.code === 'unsupported') speakOff = true;
      } finally { ctrl = null; mic.classList.remove('rec'); }
    } }, ic('microphone', { size: 40 }));
    const skip = h('button.btn.ghost', { type: 'button', onclick: () => { cur.answeredNow = true; next(); } }, 'Пропустити');
    return h('div.stack', { style: { alignItems: 'center' } },
      h('div.row', { style: { justifyContent: 'center', gap: '12px' } }, h('div.wt-big', { lang: 'en' }, c.en), speakBtn(c.en)),
      h('div.wt-uk', c.uk), mic, out, skip);
  }

  function matchEx() {
    const pairs = L.pickPairs(seenCards(), 5);
    if (pairs.length < 3) return null;
    const t0 = Date.now();
    let sel = null, left = pairs.length, mistakes = 0, gameCombo = 0;
    const clock = h('span.num.wt-clock', '0,0 с');
    const iv = setInterval(() => { clock.textContent = `${((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')} с`; }, 200);
    cleanupFns.push(() => clearInterval(iv));
    const mk = (p, side) => h('button.wt-tile', { type: 'button', lang: side === 'en' ? 'en' : 'uk', dataset: { id: p.id, side }, onclick: (e) => pick(e.currentTarget) }, side === 'en' ? display(p.en) : p.uk);
    const colEn = h('div.wt-col', L.shuffle(pairs).map(p => mk(p, 'en')));
    const colUk = h('div.wt-col', L.shuffle(pairs).map(p => mk(p, 'uk')));
    const status = h('div.small.center.dim', 'Торкніться слова, а потім його перекладу');
    function pick(b) {
      if (b.disabled) return;
      timer.poke();
      if (!sel || sel.dataset.side === b.dataset.side) { sel?.classList.remove('sel'); sel = b; b.classList.add('sel'); return; }
      const a = sel; sel = null; a.classList.remove('sel');
      if (a.dataset.id === b.dataset.id) {
        [a, b].forEach(x => { x.classList.add('done'); x.disabled = true; });
        gameCombo++; combo++; maxCombo = Math.max(maxCombo, combo); showCombo();
        beep(gameCombo >= 3 ? 'combo' : 'good'); buzz(10);
        if (--left === 0) done();
      } else {
        mistakes++; gameCombo = 0; combo = 0; showCombo();
        beep('bad'); buzz([25, 30, 25]);
        [a, b].forEach(x => { x.classList.add('miss'); setTimeout(() => x.classList.remove('miss'), 450); });
      }
    }
    function done() {
      clearInterval(iv);
      const sec = (Date.now() - t0) / 1000;
      const best = Number(localStorage.getItem('me:wt-best') || 0);
      const record = !mistakes && (!best || sec < best);
      if (record) localStorage.setItem('me:wt-best', String(sec.toFixed(1)));
      cur.answeredNow = true;
      const nextBtn = h('button.btn.primary.lg.block', { type: 'button', 'data-next': '', onclick: next }, 'Далі', ic('arrow-right'));
      foot.replaceChildren(h('div.wt-fb.ok', h('div.row', ic('trophy', { size: 24, fill: true }),
        h('b.grow', `${pairs.length} ${plural(pairs.length, 'пара', 'пари', 'пар')} за ${sec.toFixed(1).replace('.', ',')} с`)),
        h('div.small', mistakes ? `Помилок: ${mistakes}` : (record ? 'Без помилок — новий рекорд!' : 'Без помилок!'))), nextBtn);
      nextBtn.focus({ preventScroll: true });
      beep('done');
    }
    return h('div.stack', h('div.row', h('div.grow.small', 'Швидкий раунд'), ic('clock', { size: 18 }), clock), h('div.wt-match', colEn, colUk), status);
  }

  // ---------- Клавіатура ----------
  function onKey(e) {
    if (modalOpen() || finished) return;
    if (e.key === 'Escape') { finish(true); return; }
    const inField = e.target.matches?.('input, textarea');
    if (cur?.answeredNow) {
      if ((e.key === 'Enter' || e.code === 'Space') && !e.target.closest?.('button, a, [role=button]') && !inField) { e.preventDefault(); next(); }
      return;
    }
    if (inField) return;
    if (/^[1-4]$/.test(e.key)) {
      const b = stage.querySelector(`.wt-opt[data-key="${e.key}"]:not([disabled])`);
      if (b) { e.preventDefault(); b.click(); }
    }
  }
  document.addEventListener('keydown', onKey);

  // ---------- Завершення ----------
  function finish(early) {
    if (finished) return;
    finished = true;
    stopAll();
    const sess = timer.stop();
    const seconds = Math.round(sess?.seconds || (Date.now() - started) / 1000);
    const results = items.map(it => ({ id: it.card.id, en: it.card.en, uk: it.card.uk, card: it.card, isNew: it.isNew, rating: it.rating, wrong: it.wrong, firstWrong: it.firstWrong }));
    const stats = { done: results.filter(r => r.rating).length, again: results.filter(r => r.rating === 1).length, seconds, early };
    if (onDone) return onDone(stats);
    setFocus(false);
    endScreen(view, { results, seconds, maxCombo, practice: !!practice, early, onExit, items, daily });
  }

  next();
  return () => { if (!finished) { finished = true; stopAll(); timer.stop(); } setFocus(false); };
}

// ---------- Підсумок ----------
function endScreen(view, { results, seconds, maxCombo, practice, early, onExit, items, daily = false }) {
  const sum = L.summarize(results);
  const practised = items.filter(it => it.answered).length;
  const min = Math.round(seconds / 60);
  const time = seconds < 60 ? `${Math.max(1, seconds)} с` : `${min} хв`;
  if (sum.graded || practised) beep('done');
  const hardest = sum.hardest.length ? sum.hardest : [];
  const storyBox = h('div');
  const words = storyWords(results);
  const toDecks = { icon: 'cards', label: 'До колод', sub: 'тренування, колоди, свої слова', onclick: () => onExit?.() };
  view.replaceChildren(h('div.stack-lg.wt-end',
    resHead({
      icon: sum.accuracy >= 80 && sum.graded ? 'trophy' : 'confetti', tone: sum.graded || practised ? 'good' : '', eyebrow: 'Підсумок',
      title: practice ? 'Повторення завершено' : early && !sum.graded ? 'Тренування перервано' : 'Тренування завершено',
      sub: practice ? `${practised} ${plural(practised, 'слово', 'слова', 'слів')} без оцінок — розклад не змінено` : sum.graded ? `${sum.graded} ${plural(sum.graded, 'слово', 'слова', 'слів')} · ${time}${maxCombo >= 3 ? ` · комбо ×${maxCombo}` : ''}` : 'Жодне слово ще не оцінено',
    }),
    practice || !sum.graded ? null : txKpis([
      { value: sum.learned, label: plural(sum.learned, 'нове слово', 'нові слова', 'нових слів'), tone: 'good' },
      { value: sum.strengthened, label: 'закріплено' },
      { value: `${sum.accuracy}%`, label: 'з першої спроби', tone: sum.accuracy >= 80 ? 'good' : '' },
    ]),
    hardest.length ? txGroup('Найважчі слова', [
      txRows(hardest.map(r => h('div.tx-row.lr-word',
        h('button.tx-sq.lr-spk', { type: 'button', 'aria-label': `Прослухати ${r.en}`, onclick: () => speak(r.en) }, ic('speaker-high', { size: 18 })),
        h('span.tx-body', h('span.tx-l', { lang: 'en' }, r.en), h('span.tx-s', r.uk)),
        r.wrong ? txPill(`${r.wrong} ${plural(r.wrong, 'помилка', 'помилки', 'помилок')}`, 'bad') : txPill('важко', 'warn')))),
      tx({ icon: 'arrow-clockwise', label: 'Потренувати їх ще раз', sub: 'без оцінок — розклад не зміниться', wide: true, onclick: () => runTrain(view, { practice: hardest.map(r => r.card), onExit }).then(fn => onLeave(view, fn)) })]) : null,
    !practice && words.length >= 4 ? storyBox : null,
    h('div.stack.lr-next',
      daily && !practice ? txPrimary({ icon: 'arrow-right', label: 'Далі за планом', sub: 'наступний крок «Мого дня»', href: '#/today', cls: 'wt-daily-next' }) : null,
      daily && !practice ? tx({ ...toDecks, wide: true }) : txPrimary(toDecks))));
  if (!practice && words.length >= 4) storyOffer(storyBox, words);
}

/** Слова для історії: найважчі й нові першими, далі решта сесії, далі — повторені сьогодні */
function storyWords(results) {
  const out = [], seen = new Set();
  const add = (w) => { const k = L.core(w?.en || ''); if (k && w.uk && !seen.has(k) && L.wordCount(w.en) <= 4 && !L.isSentence(w.en)) { seen.add(k); out.push({ en: w.en, uk: w.uk }); } };
  const graded = results.filter(r => r.rating);
  graded.filter(r => r.wrong || r.rating <= 2).forEach(add);
  graded.filter(r => r.isNew).forEach(add);
  graded.forEach(add);
  if (out.length < 6) {
    const d = today();
    for (const r of store.all('reviews')) { if (out.length >= 10) break; if (r.ts && dayKey(r.ts) === d) add(store.get('cards', r.card_id)); }
  }
  return out.slice(0, 10);
}

function storyOffer(box, words) {
  if (!user()) {
    box.replaceChildren(txGroup('Історія з моїх слів', tx({ icon: 'sparkle', label: 'Увійти', sub: 'вчитель складе історію з цих слів', href: '#/auth', wide: true })));
    return;
  }
  box.replaceChildren(txGroup('Історія з моїх слів', tx({ icon: 'sparkle', label: 'Створити історію', wide: true, onclick: () => storyView(box, words),
    sub: `рівень ${myLevel()} · ${words.length} ${plural(words.length, 'слово', 'слова', 'слів')} · 3 запитання` })));
}

/** Історія з AI: слова підсвічені й перекладаються дотиком, 3 запитання на розуміння */
export async function storyView(box, words) {
  const ctrl = new AbortController();
  const watch = setInterval(() => { if (!box.isConnected) { ctrl.abort(); clearInterval(watch); } }, 500);
  box.replaceChildren(h('section.card.stack.center', { 'aria-busy': 'true' }, h('div.wt-spinner', { 'aria-hidden': 'true' }), h('p.dim', 'Складаю історію з ваших слів…')));
  let res;
  try {
    res = await tutor('word_story', { words: words.map(w => ({ en: w.en, uk: w.uk })), level: myLevel() }, { signal: ctrl.signal });
  } catch (e) {
    clearInterval(watch);
    const msg = aiErrorText(e);
    if (!msg || !box.isConnected) return;
    box.replaceChildren(h('section.card.stack', h('p', msg), h('button.btn.soft', { type: 'button', onclick: () => storyView(box, words) }, ic('arrow-clockwise'), 'Спробувати ще раз')));
    return;
  }
  clearInterval(watch);
  if (!box.isConnected) return;
  const used = new Set((res.used || []).map(s => String(s).toLowerCase()));
  const glossary = [];
  for (const w of words) {
    if (!used.has(w.en.toLowerCase())) continue;
    const forms = new Set((res.forms?.[w.en] || []).map(String));
    const hit = L.findInText(res.text, w.en);
    if (hit) forms.add(hit.text);
    for (const f of forms) if (f) glossary.push({ w: f, en: w.en, uk: w.uk });
  }
  const textBox = h('div.wt-story-text', { lang: 'en' }, String(res.text || '').split(/\n+/).filter(Boolean).map(p => h('p', p)));
  const { tappable } = await import('../ui/wordtap.js');
  tappable(textBox, { glossary, mark: true });
  // варіанти перемішуються: модель часто ставить правильну відповідь першою
  const qs = (Array.isArray(res.questions) ? res.questions : []).filter(q => q?.q && Array.isArray(q.options) && Number.isInteger(q.answer) && q.options[q.answer] != null).slice(0, 3)
    .map(q => { const opts = L.shuffle(q.options.map((o, k) => ({ o: String(o), ok: k === q.answer }))); return { q: q.q, options: opts.map(x => x.o), answer: opts.findIndex(x => x.ok) }; });
  let answered = 0, right = 0;
  const score = h('div.small', { 'aria-live': 'polite' });
  const qEls = qs.map((q, qi) => {
    const btns = q.options.map((o, k) => h('button.opt.ex-opt', { type: 'button', lang: 'en', onclick: () => {
      if (btns.some(b => b.disabled)) return;
      btns.forEach(b => { b.disabled = true; });
      const ok = k === q.answer;
      btns[k].classList.add(ok ? 'right' : 'wrong'); btns[q.answer]?.classList.add('right');
      answered++; if (ok) right++;
      beep(ok ? 'good' : 'bad');
      if (answered === qs.length) score.textContent = `Правильних відповідей: ${right} з ${qs.length}`;
    } }, h('span.ex-key', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', o)));
    return h('div.stack', { style: { gap: '8px' } }, h('div', { lang: 'en', style: { fontWeight: 600 } }, `${qi + 1}. ${q.q}`), btns);
  });
  box.replaceChildren(h('section.card.stack.wt-story',
    h('span.eyebrow', 'Історія з моїх слів'),
    h('h2', { lang: 'en' }, res.title || 'A short story'),
    textBox,
    h('div.xs.dim', 'Підкреслені — сьогоднішні слова. Торкніться будь-якого слова, щоб побачити переклад.'),
    qEls.length ? h('div.section-title', 'Запитання') : null,
    qEls, score));
}

/** Сторінка #/cards/train */
export default async function wordtrain(view, { onExit } = {}) {
  return runTrain(view, { onExit });
}
