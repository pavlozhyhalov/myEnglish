// Картки: огляд колод і повторення FSRS
import { h, ic, emo, fmtInterval, toggle } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { speak, stop as stopSpeech, recognize, canRecognize, compareWords, recordAndTranscribe } from '../speech.js';
import { activityTimer } from '../stats.js';
import { setFocus, setTitle } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { myLevel, diff, levelTag, byFit } from '../level.js';

export default async function cards(view, r) {
  if (r.parts[0] === 'review') {
    setTitle('Повторення');
    return runReview(view, { onExit: () => go('/cards', { replace: true }) });
  }
  const c = await srs.counts();
  const decks = await srs.decks();
  const total = c.due + c.fresh;
  view.replaceChildren(h('div.stack-lg',
    h('section.card.stack.center',
      h('div.counters',
        h('div', h('b.good', String(c.fresh)), h('div.xs.dim', 'нові')),
        h('div', h('b.warn', String(c.due)), h('div.xs.dim', 'до повтору')),
        h('div', h('b', String(c.learned)), h('div.xs.dim', 'вивчені'))),
      total
        ? h('a.btn.primary.lg.block', { href: '#/cards/review' }, ic('play', { fill: true }), `Почати · ${total} ${plural(total, 'картка', 'картки', 'карток')}`)
        : h('div.stack', emo('party', 'xl'), h('p', 'На сьогодні все повторено.'), h('p.dim.small', 'Нові картки з\'являться завтра. Ліміт нових — у налаштуваннях.'))),
    ...[['general', 'Колоди: загальна англійська'], ['work', 'Робота (за вибором)'], ['my', 'Власні']].map(([g, title]) => {
      const list = g === 'general' ? byFit(decks.filter(d => d.group === g)) : decks.filter(d => (d.group || 'my') === g);
      if (!list.length) return null;
      return h('section.stack', { style: { gap: '8px' } }, h('div.section-title', title),
        g === 'general' ? h('p.xs.dim', { style: { margin: '0 2px' } }, `Нові слова беруться з колод рівня ${myLevel()}, далі — наступного. Колоди вищих рівнів чекають, поки ви до них дійдете.`) : null,
        h('div.list', list.map(d => h('div.list-row',
          emo(d.emoji || 'cards'),
          h('div.grow', h('div.row', { style: { gap: '6px' } }, h('span', { style: { fontWeight: 600 } }, d.name), levelTag(d.level)), h('div.sub', `${d.count ?? 0} ${plural(d.count ?? 0, 'картка', 'картки', 'карток')}${d.desc ? ' · ' + d.desc : ''}${d.level && diff(d.level) > 1 ? ' · поки без нових слів' : ''}`)),
          toggle(d.enabled, (v) => srs.setDeckEnabled(d, v), `Колода ${d.name}`)))));
    }),
    h('a.btn.soft.block', { href: '#/vocab' }, ic('plus'), 'Додати свої слова'),
    h('p.xs.dim.center', 'Клавіатура: Space — показати, 1–4 — оцінка. Свайп вліво — «Знову», вправо — «Добре».')));
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
  const bar = h('div.progress', h('i', { style: { width: '0%' } }));
  const stage = h('div.flash-wrap');
  const actions = h('div');
  const root = h('div.stack',
    h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Завершити', onclick: () => finish(true) }, ic('x')), h('div.grow', bar), counters),
    stage, actions);
  view.replaceChildren(root);

  function updateCounters() {
    const n = queue.filter(c => !c.reps).length, d = queue.length - n;
    counters.replaceChildren(h('span', h('b.good', String(n))), h('span', h('b.warn', String(d))));
    bar.firstChild.style.width = `${startCount ? Math.min(100, done / startCount * 100) : 100}%`;
  }

  function next() {
    stopSpeech();
    if (!queue.length) return finish(false);
    // картки «Знову» з коротким інтервалом чекають свого часу, якщо є інші
    const now = Date.now();
    let idx = queue.findIndex(c => !c._waitUntil || c._waitUntil <= now);
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
    const kindLabel = { 'en-uk': 'EN → UK', 'uk-en': 'UK → EN', audio: 'Аудіо', cloze: 'Пропуск' }[kind];
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
          } catch (err) { said.textContent = err.code === 'mic' ? 'Немає доступу до мікрофона' : 'Не вдалося розпізнати'; }
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
      h('a.small', { href: `#/tutor?ask=${encodeURIComponent(cur.en)}`, onclick: (e) => e.stopPropagation() }, 'Запитати вчителя про це слово'));

    const flash = h('div.flash', { role: 'button', tabindex: '0', 'aria-label': 'Картка. Натисніть, щоб перевернути' }, front, back);
    flash.addEventListener('click', () => { if (!flipped) flip(); });
    attachSwipe(flash);
    stage.replaceChildren(flash);
    actions.replaceChildren(h('button.btn.primary.lg.block', { type: 'button', onclick: flip }, 'Показати'));
  }

  function flip() {
    if (flipped) return;
    flipped = true;
    stage.firstChild.classList.add('flipped');
    if (srs.cardKind(cur) !== 'en-uk' && store.settings().autoSpeak !== false) speak(cur.en);
    const iv = srs.preview(cur);
    const labels = [[1, 'again', 'Знову'], [2, 'hard', 'Важко'], [3, 'good', 'Добре'], [4, 'easy', 'Легко']];
    actions.replaceChildren(h('div.grades', labels.map(([g, cls, t]) =>
      h('button.grade.' + cls, { type: 'button', onclick: () => rate(g) }, t, h('small', fmtInterval(iv[g]))))));
  }

  function rate(g) {
    if (!flipped) return;
    timer.poke();
    const row = srs.grade(cur, g, Date.now() - shownAt);
    done++;
    if (g === 1) again++;
    const dueIn = new Date(row.due) - Date.now();
    if (dueIn < 20 * 60 * 1000) { row._waitUntil = Date.now() + Math.max(0, dueIn); queue.push(row); }
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
    if (e.target.matches('input, textarea')) return;
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
    view.replaceChildren(h('div.hero',
      emo(done ? 'party' : 'cards', 'xl'),
      h('h1', done ? 'Повторення завершено' : 'Немає карток'),
      done ? h('p.dim', `${done} ${plural(done, 'картка', 'картки', 'карток')} · «Знову»: ${again} · ${Math.max(1, Math.round((sess?.seconds || 0) / 60))} хв`) : null,
      h('div.row', h('a.btn.soft', { href: '#/' }, 'На головну'), h('button.btn.primary', { type: 'button', onclick: () => onExit?.() }, 'До колод'))));
  }

  next();
  return () => { if (!finished) { finished = true; document.removeEventListener('keydown', onKey); stopSpeech(); timer.stop(); } setFocus(false); };
}

function speakBtn(text, size = 24) {
  return h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: (e) => { e.stopPropagation(); speak(text); } }, ic('speaker-high', { size }));
}

/** Кнопка «Сказати» з оцінкою вимови */
export function sayBlock(target) {
  const out = h('div.small');
  const btn = h('button.btn.soft.sm', {
    type: 'button', onclick: async (e) => {
      e.stopPropagation();
      out.textContent = 'Слухаю…';
      try {
        const res = canRecognize() ? await recognize({ onInterim: t => { out.textContent = t; } }) : await recordAndTranscribe({ maxMs: 6000 });
        const cmp = compareWords(target, res.text);
        out.replaceChildren(
          h('div', cmp.words.map(w => [h('span', { class: w.ok ? 'word-ok' : 'word-no' }, w.raw), ' '])),
          h('div', h('b', { class: cmp.pct >= 80 ? 'good' : cmp.pct >= 50 ? 'warn' : 'bad' }, `${cmp.pct}%`), h('span.dim', ` · почуто: «${res.text || '—'}»`)));
      } catch (err) {
        out.textContent = err.code === 'mic' || err.name === 'NotAllowedError' ? 'Немає доступу до мікрофона' : (err.message === 'unsupported' ? 'Браузер не підтримує розпізнавання' : 'Не вдалося розпізнати');
      }
    },
  }, ic('microphone', { size: 18 }), 'Сказати');
  return h('div.stack', { style: { alignItems: 'center', gap: '6px' } }, btn, out);
}
