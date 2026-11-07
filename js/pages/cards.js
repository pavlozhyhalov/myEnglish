// Картки: огляд колод і повторення FSRS
import { h, ic, emo, fmtInterval, toggle } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { speak, stop as stopSpeech, recognize, canRecognize, compareWords, recordAndTranscribe } from '../speech.js';
import { activityTimer } from '../stats.js';
import { setFocus, setTitle } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { modalOpen } from '../ui/modal.js';
import { go } from '../router.js';
import { myLevel, diff, levelTag, byFit } from '../level.js';
import { aiErrorText } from '../ai.js';
import { tx, txPrimary, txKpis, txGrid, txGroup, txRows, txBar, txResult } from '../ui/tiles.js';

/** Шапка підсумку сесії — спільна txResult (js/ui/tiles.js); лишено для phrases.js і wordtrain.js */
export function resHead({ icon, eyebrow, title, sub = null, tone = '' }) {
  return txResult({ icon, tone, label: eyebrow, title, sub });
}

export default async function cards(view, r) {
  if (r.parts[0] === 'review') {
    setTitle('Повторення');
    return runReview(view, { onExit: () => go('/cards', { replace: true }) });
  }
  if (r.parts[0] === 'train') {
    setTitle('Тренування слів');
    const { runTrain } = await import('./wordtrain.js');
    return runTrain(view, { onExit: () => go('/cards', { replace: true }) });
  }
  const c = await srs.counts();
  const decks = await srs.decks();
  const total = c.due + c.fresh;
  const session = Math.min(c.due, 30) + Math.min(c.fresh, 20);   // одна сесія тренування (MAX_DUE/MAX_NEW у wordtrain.js)
  // прогрес колоди: вивчені слова (стабільність ≥ 21 дн) серед її карток
  const learnedBy = new Map();
  for (const row of store.all('cards')) if (srs.isLearned(row)) learnedBy.set(row.deck_id, (learnedBy.get(row.deck_id) || 0) + 1);
  const lv = myLevel();
  const deckRow = (d) => {
    const n = d.count ?? 0, got = Math.min(n, learnedBy.get(d.id) || 0);
    const sub = `${n} ${plural(n, 'картка', 'картки', 'карток')}${got ? ` · вивчено ${got}` : ''}${d.level && diff(d.level) > 1 ? ' · поки без нових слів' : ''}`;
    const el = h('div.tx-row.cd-deck' + (d.enabled ? '' : '.off'), { title: d.desc || null },
      h('span.tx-sq', emo(d.emoji || 'cards')),
      h('span.tx-body',
        h('span.tx-l', d.name, ' ', levelTag(d.level)),
        h('span.tx-s', sub),
        n ? txBar(got / n) : null),
      toggle(d.enabled, (v) => { srs.setDeckEnabled(d, v); d.enabled = v; el.classList.toggle('off', !v); }, `Колода ${d.name}`));
    return el;
  };
  const kpis = txKpis([
    { value: c.fresh, label: 'нові', tone: 'good' },
    { value: c.due, label: 'до повтору', tone: c.due ? 'warn' : '' },
    { value: c.learned, label: 'вивчені' },
  ]);
  // колоди: на виду — мого рівня (до 6) і «Мої слова»; решта — під «Усі колоди»
  const general = byFit(decks.filter(d => d.group === 'general'));
  const mine = general.filter(d => d.level === lv).slice(0, 6);
  const shown = new Set(mine.map(d => d.id));
  const myDeck = decks.find(d => (d.group || 'my') === 'my');
  const rest = [
    ['Інші рівні', general.filter(d => !shown.has(d.id))],
    ['Робота · за вибором', decks.filter(d => d.group === 'work')],
  ].filter(([, l]) => l.length);
  const restN = rest.reduce((n, [, l]) => n + l.length, 0);
  const restBox = h('div.stack-lg.cd-rest', { id: 'cd-rest', hidden: true }, rest.map(([t, l]) => txGroup(t, txRows(l.map(deckRow)))));
  const moreBtn = restN ? tx({ icon: 'books', label: 'Усі колоди', sub: `ще ${restN} · інші рівні й «Робота»`, wide: true, end: ic('caret-down', { size: 18 }), cls: 'cd-more',
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'cd-rest' },
    onclick: (e) => { const open = restBox.hidden; restBox.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); e.currentTarget.classList.toggle('open', open); } }) : null;
  view.replaceChildren(h('div.stack-lg.cd-over',
    total
      ? h('div.stack.cd-top', kpis,
        txPrimary({ icon: 'lightning', label: 'Тренування слів', sub: `${session} ${plural(session, 'слово', 'слова', 'слів')} · оцінку ставить застосунок`, href: '#/cards/train' }),
        txGrid([
          tx({ icon: 'cards', label: 'Швидкий повтор', sub: 'класичні картки', href: '#/cards/review', attrs: { title: 'Пробіл — показати, 1–4 — оцінка, свайп уліво — «Знову», управо — «Добре»' } }),
          tx({ icon: 'plus', label: 'Додати свої слова', sub: 'у «Мої слова»', href: '#/vocab' }),
        ], 2))
      : h('div.stack.cd-top', kpis,
        tx({ icon: 'confetti', label: 'На сьогодні все повторено', sub: 'Нові картки — завтра', wide: true, tone: 'good' }),
        tx({ icon: 'plus', label: 'Додати свої слова', sub: 'у «Мої слова»', href: '#/vocab', wide: true })),
    txGroup(`Колоди рівня ${lv}`, [txRows([...mine.map(deckRow), myDeck ? deckRow(myDeck) : null]), moreBtn]),
    restBox));
}

/**
 * Сесія повторення. Використовується і в «Почати заняття».
 * opts: limit (макс. карток), onExit(), onDone(stats), embedded (не вмикати фокус-режим заголовка)
 */
export async function runReview(view, { limit = Infinity, onExit, onDone, embedded = false } = {}) {
  setFocus(true);
  const timer = activityTimer('cards');
  const due = await srs.dueCards();
  const fresh = await srs.newCards();
  // нові вкраплюємо після кожних 4 повторів
  const queue = [];
  let di = 0, ni = 0;
  while (di < due.length || ni < fresh.length) {
    for (let k = 0; k < 4 && di < due.length; k++) queue.push(due[di++]);
    if (ni < fresh.length) queue.push(fresh[ni++]);
  }
  if (Number.isFinite(limit)) queue.splice(limit);
  const startCount = queue.length;
  let done = 0, again = 0, cur = null, shownAt = 0, flipped = false;

  const counters = h('div.counters');
  const bar = h('div.progress', { role: 'progressbar', 'aria-label': 'Пройдено карток', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: '0%' } }));
  const stage = h('div.flash-wrap');
  const actions = h('div');
  const root = h('div.stack.cd-rev',
    h('div.row.cd-rev-top', h('button.icon-btn', { type: 'button', 'aria-label': 'Завершити', onclick: () => finish(true) }, ic('x')), h('div.grow', bar), counters),
    stage, actions);
  view.replaceChildren(root);

  function updateCounters() {
    const n = queue.filter(c => !c.reps).length, d = queue.length - n;
    counters.replaceChildren(h('span.tx-pill.good', { title: 'Нові', 'aria-label': `Нових: ${n}` }, String(n)), h('span.tx-pill.warn', { title: 'До повтору', 'aria-label': `До повтору: ${d}` }, String(d)));
    const pct = startCount ? Math.min(100, done / startCount * 100) : 100;
    bar.firstChild.style.width = `${pct}%`; bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  const waitUntil = new WeakMap();
  function next() {
    stopSpeech();
    if (!queue.length) return finish(false);
    // картки «Знову» з коротким інтервалом чекають свого часу, якщо є інші
    const now = Date.now();
    let idx = queue.findIndex(c => !waitUntil.has(c) || waitUntil.get(c) <= now);
    if (idx < 0) idx = 0;
    cur = queue.splice(idx, 1)[0];
    flipped = false; shownAt = Date.now();
    renderCard();
    updateCounters();
  }

  function renderCard() {
    const kind = srs.cardKind(cur);
    const ex = cur.examples?.[0];
    const cloze = kind === 'cloze' ? srs.clozeOf(cur) : null;
    const front = h('div.face.front');
    const kindLabel = { 'en-uk': 'EN → UA', 'uk-en': 'UA → EN', audio: 'Аудіо', cloze: 'Пропуск' }[kind];
    front.append(h('span.kind', kindLabel + (cur.reps ? '' : ' · нова')));
    if (kind === 'en-uk') {
      front.append(h('div.big', cur.en), speakBtn(cur.en));
      if (store.settings().autoSpeak !== false) setTimeout(() => speak(cur.en), 250);
    } else if (kind === 'uk-en') {
      const said = h('div.small.dim');
      front.append(h('div.big', cur.uk || '—'), h('p.dim.small', 'Як це англійською?'), said);
      if (canRecognize()) front.append(h('button.btn.soft.sm', {
        type: 'button', onclick: async (e) => {
          e.stopPropagation();
          said.textContent = 'Слухаю…';
          try {
            const res = await recognize({ onInterim: t => { said.textContent = t; } });
            const cmp = compareWords(cur.en, res.text);
            said.replaceChildren(h('span', res.text || '—'), ' ', h('b', { class: cmp.pct >= 80 ? 'good' : 'bad' }, `${cmp.pct}%`));
          } catch (err) { said.textContent = err.code === 'mic' ? S.err.mic : (err.message === 'unsupported' ? S.err.speechUnsupported : 'Не вдалося розпізнати'); }
        },
      }, ic('microphone', { size: 18 }), 'Відповісти голосом'));
    } else if (kind === 'audio') {
      front.append(h('button.icon-btn.soft', { type: 'button', style: { width: '96px', height: '96px', borderRadius: '50%' }, 'aria-label': 'Прослухати ще раз', onclick: (e) => { e.stopPropagation(); speak(cur.en); } }, ic('speaker-high', { size: 44 })),
        h('p.dim.small', 'Що означає почуте?'));
      setTimeout(() => speak(cur.en), 250);
    } else {
      front.append(h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, cloze.text), ex?.uk ? h('p.dim.small', ex.uk) : h('p.dim.small', cur.uk));
    }

    const back = h('div.face.back',
      h('span.kind', kindLabel),
      h('div.big', cur.en), cur.ipa ? h('div.ipa', cur.ipa) : null,
      h('div.answer', cur.uk),
      speakBtn(cur.en),
      ex ? h('div.card.soft.tight', { style: { width: '100%', textAlign: 'left' } },
        h('div.row', h('div.grow', h('div', ex.en), ex.uk ? h('div.xs.dim', ex.uk) : null), speakBtn(ex.en, 20))) : null,
      sayBlock(cur.en),
      h('a.small.cd-ask', { href: `#/tutor?ask=${encodeURIComponent(cur.en)}`, onclick: (e) => e.stopPropagation() }, ic('chalkboard-teacher', { size: 16 }), 'Запитати вчителя про це слово'));

    back.inert = true;
    const flash = h('div.flash', { role: 'group', 'aria-label': 'Картка' }, front, back);
    flash.addEventListener('click', () => { if (!flipped) flip(); });
    attachSwipe(flash);
    stage.replaceChildren(flash);
    actions.replaceChildren(...[h('button.btn.primary.lg.block', { type: 'button', onclick: flip }, 'Показати'),
      // нове слово, яке учень уже знає: одразу «вивчено» (довгий контрольний повтор), без оцінки FSRS
      !cur.reps ? h('button.btn.ghost.block.sm', { type: 'button', style: { marginTop: '6px' }, onclick: knowIt }, ic('check-circle'), 'Я вже знаю це слово') : null].filter(Boolean));
  }

  let flippedAt = 0;
  function flip() {
    if (flipped) return;
    flipped = true;
    flippedAt = Date.now();
    // зворотний бік — у Tab-порядку лише після перевертання
    stage.firstChild.querySelector('.face.back').inert = false;
    stage.firstChild.querySelector('.face.front').inert = true;
    stage.firstChild.classList.add('flipped');
    if (srs.cardKind(cur) !== 'en-uk' && store.settings().autoSpeak !== false) speak(cur.en);
    const iv = srs.preview(cur);
    const labels = [[1, 'again', 'Знову'], [2, 'hard', 'Важко'], [3, 'good', 'Добре'], [4, 'easy', 'Легко']];
    actions.replaceChildren(h('div.grades', labels.map(([g, cls, t]) =>
      // подвійний тап по «Показати» не має одразу оцінити картку: кнопки оцінки з'являються на тому самому місці
      h('button.grade.' + cls, { type: 'button', onclick: () => { if (Date.now() - flippedAt > 400) rate(g); } }, t, h('small', fmtInterval(iv[g]))))));
  }

  function knowIt() {
    if (flipped) return;
    timer.poke();
    const row = cur;
    srs.markKnown(row);
    done++;
    toast(`«${row.en}» — вивчено`, { action: 'Скасувати', ms: 4000, onAction: () => { srs.undoKnown(row); queue.unshift(row); } });
    next();
  }

  function rate(g) {
    if (!flipped) return;
    timer.poke();
    const row = srs.grade(cur, g, Date.now() - shownAt);
    done++;
    if (g === 1) again++;
    const dueIn = new Date(row.due) - Date.now();
    // час очікування — лише в пам'яті сесії (не потрапляє в IndexedDB/хмару)
    if (dueIn < 20 * 60 * 1000) { waitUntil.set(row, Date.now() + Math.max(0, dueIn)); queue.push(row); }
    next();
  }

  function attachSwipe(el) {
    let x0 = null, dx = 0;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; dx = 0; }, { passive: true });
    el.addEventListener('touchmove', e => { if (x0 == null || !flipped) return; dx = e.touches[0].clientX - x0; el.style.transform = `rotateY(180deg) translateX(${-dx * 0.6}px) rotate(${-dx / 40}deg)`; }, { passive: true });
    el.addEventListener('touchend', () => {
      if (x0 == null) return; x0 = null;
      el.style.transform = '';
      if (!flipped) return;
      if (dx < -80) rate(1); else if (dx > 80) rate(3);
    });
  }

  function onKey(e) {
    if (e.target.matches('input, textarea') || modalOpen()) return;
    // Enter/пробіл на кнопці чи посиланні — їхня власна дія (напр., «Знову»), а не «Добре»
    if ((e.code === 'Space' || e.key === 'Enter') && e.target.closest('button, a, [role=button]')) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (!flipped) flip(); else rate(3); }
    else if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
    else if (e.key === 'Escape') finish(true);
  }
  document.addEventListener('keydown', onKey);

  let finished = false;
  function finish(early) {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKey);
    stopSpeech();
    const sess = timer.stop();
    const stats = { done, again, seconds: sess?.seconds || 0, early };
    if (onDone) return onDone(stats);
    setFocus(false);
    const secs = sess?.seconds || 0;
    view.replaceChildren(h('div.stack-lg.cd-done',
      resHead({ icon: done ? 'confetti' : 'cards', tone: done ? 'good' : '', eyebrow: 'Підсумок', title: done ? 'Повторення завершено' : 'Немає карток для повторення',
        sub: done ? 'Оцінки збережено — картки повернуться за розкладом FSRS.' : 'Нові картки з\'являться завтра.' }),
      done ? txKpis([
        { value: done, label: plural(done, 'картка', 'картки', 'карток'), tone: 'good' },
        { value: again, label: '«Знову»', tone: again ? 'warn' : '' },
        secs < 60 ? { value: '<1', unit: 'хв', label: 'час', ariaLabel: 'Час: менше хвилини' } : { value: Math.round(secs / 60), unit: 'хв', label: 'час' },
      ]) : null,
      h('div.stack.cd-next',
        txPrimary({ icon: 'cards', label: 'До колод', sub: 'тренування, колоди, свої слова', onclick: () => onExit?.() }),
        tx({ icon: 'house', label: 'На головну', href: '#/', wide: true }))));
  }

  next();
  return () => { if (!finished) { finished = true; document.removeEventListener('keydown', onKey); stopSpeech(); timer.stop(); } setFocus(false); };
}

function speakBtn(text, size = 24) {
  return h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: (e) => { e.stopPropagation(); speak(text); } }, ic('speaker-high', { size }));
}

/** Кнопка «Сказати» з оцінкою вимови: після входу — AI-оцінка (функція pron), інакше — розпізнавання браузера */
export function sayBlock(target) {
  const out = h('div.small', { 'aria-live': 'polite' });
  let ctrl = null;
  const label = () => btn.replaceChildren(ic('microphone', { size: 18 }), 'Сказати');
  const btn = h('button.btn.soft.sm', {
    type: 'button', onclick: async (e) => {
      e.stopPropagation();
      if (ctrl) { btn.disabled = true; ctrl.abort(); return; }   // «Готово»
      btn.disabled = true;   // подвійний тап під час завантаження модуля
      const P = await import('./pronunciation.js');
      btn.disabled = false;
      if (P.aiReady()) {
        const c = ctrl = new AbortController();
        btn.disabled = true; out.textContent = 'Вмикаю мікрофон…';
        // картку змінено або сторінку покинуто під час запису — вимкнути мікрофон одразу, без відправлення
        const watch = setInterval(() => { if (!btn.isConnected) c.abort(); }, 300);
        try {
          const res = await P.assessPhrase(target, {
            signal: c.signal, cancelled: () => !btn.isConnected,
            onRecording: () => { btn.disabled = false; btn.replaceChildren(ic('stop', { size: 18 }), 'Готово'); out.textContent = 'Запис… скажіть і натисніть «Готово»'; },
            onRecorded: () => { btn.disabled = true; out.textContent = 'Оцінюю вимову…'; },
          });
          out.replaceChildren(P.renderAssessment(res, { compact: true }));
        } catch (err) {
          out.textContent = err.code === 'mic' || err.name === 'NotAllowedError' ? S.err.mic : err.code === 'short' ? 'Запис надто короткий' : (aiErrorText(err) || 'Не вдалося оцінити');
        } finally { clearInterval(watch); ctrl = null; btn.disabled = false; label(); }
        return;
      }
      out.textContent = 'Слухаю…';
      try {
        const res = canRecognize() ? await recognize({ onInterim: t => { out.textContent = t; } }) : await recordAndTranscribe({ maxMs: 6000 });
        const cmp = compareWords(target, res.text);
        out.replaceChildren(
          h('div', cmp.words.map(w => [h('span', { class: w.ok ? 'word-ok' : 'word-no' }, w.raw), ' '])),
          h('div', h('b', { class: cmp.pct >= 80 ? 'good' : cmp.pct >= 50 ? 'warn' : 'bad' }, `${cmp.pct}%`), h('span.dim', ` · почуто: «${res.text || '—'}»`)));
      } catch (err) {
        out.textContent = err.code === 'mic' || err.name === 'NotAllowedError' ? S.err.mic : (err.message === 'unsupported' ? S.err.speechUnsupported : 'Не вдалося розпізнати');
      }
    },
  }, ic('microphone', { size: 18 }), 'Сказати');
  return h('div.stack', { style: { alignItems: 'center', gap: '6px' } }, btn, out);
}
