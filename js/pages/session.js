// Кероване заняття ~15 хв: картки → міні-урок граматики → розмова із вчителем
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { runTrain } from './wordtrain.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { md, mdInline } from '../ui/md.js';
import { activityTimer, addMistake, lessonsToReview, recordLesson } from '../stats.js';
import { user } from '../supa.js';
import { setFocus } from '../ui/shell.js';
import { go } from '../router.js';
import { nextLessonByLevel } from '../level.js';
import { tx, txPrimary, txGroup, txRow, txRows, txResult } from '../ui/tiles.js';

const STEP_IC = ['cards', 'puzzle-piece', 'microphone'];
const EMO_IC = { cards: 'cards', puzzle: 'puzzle-piece', mic: 'microphone' };
const scoreTone = (v) => v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad';

export default async function session(view) {
  const steps = ['Картки', 'Граматика', 'Розмова'];
  const summary = { cards: 0, score: null, talk: 0 };
  let cleanup = null, stopped = false;
  const started = Date.now();

  const idx = await grammarIndex();
  const rev = lessonsToReview()[0];
  const lessonMeta = (rev && idx.find(l => l.id === rev.id)) || nextLessonByLevel(idx) || idx[0];
  const lesson = await loadLesson(lessonMeta.id);
  const counts = await srs.counts();

  // шапка етапу: «Вийти», номер етапу, під ним — три міні-плитки етапів (пройдено — галочка, поточний — акцент)
  const sesHead = (cur) => h('div.stack', { style: { gap: '10px' } },
    h('div.gx-run', h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: exit }, ic('x')),
      h('div.grow', h('span.tx-label', `Етап ${cur + 1} з ${steps.length}`))),
    h('ol.ses-steps', { 'aria-label': 'Етапи заняття', style: { listStyle: 'none', margin: 0, padding: 0 } }, steps.map((name, i) =>
      h('li.ses-step' + (i < cur ? '.done' : i === cur ? '.on' : ''), { 'aria-current': i === cur ? 'step' : null },
        ic(i < cur ? 'check-circle' : STEP_IC[i], { size: 16, fill: i <= cur }), h('span', name),
        i < cur ? h('span.sr-only', ' — пройдено') : null))));

  const lockBtns = (e) => e.currentTarget.parentNode.querySelectorAll('button').forEach(b => { b.disabled = true; });
  function interstitial(cur, emoji, title, text, onGo, goLabel = 'Далі') {
    setFocus(true);
    view.replaceChildren(h('div.stack-lg.gx',
      sesHead(cur),
      h('div.gx-intro', h('span.gx-res-ic', ic(EMO_IC[emoji] || 'play', { size: 28, fill: true })),
        h('div.tx-label', steps[cur]), h('h1.gx-intro-h', title), h('p.gx-intro-p', text)),
      // після першого тапу обидві кнопки вимикаються: інакше «Пропустити» під час асинхронного старту накладав етапи
      h('div.stack', { style: { gap: '8px' } },
        txPrimary({ icon: 'play', label: goLabel, onclick: (e) => { lockBtns(e); onGo(); } }),
        tx({ wide: true, icon: 'arrow-right', label: 'Пропустити етап', onclick: (e) => { lockBtns(e); next(cur + 1); } }))));
  }

  function next(stage) {
    if (stopped) return;
    cleanup?.(); cleanup = null;
    if (stage === 0) {
      const n = Math.min(20, counts.due + counts.fresh);
      if (!n) return next(1);
      interstitial(0, 'cards', `Тренування: ${n} ${plural(n, 'слово', 'слова', 'слів')}`, 'Близько 5 хвилин: впізнати, почути, написати.', async () => {
        cleanup = await runTrain(view, { limit: 20, onDone: (st) => { summary.cards = st.done; next(1); } });
      });
    } else if (stage === 1) {
      interstitial(1, 'puzzle', lesson.title, 'Коротке правило і 5 вправ.', () => grammarStep());
    } else if (stage === 2) {
      if (!user()) return finish();
      interstitial(2, 'mic', `Розмова на тему уроку`, `5–7 хвилин голосом: вчитель вплете «${lesson.title}» у розмову.`, async () => {
        const { voiceSession } = await import('../live/voice.js');
        cleanup = await voiceSession(view, {
          topic: `practise "${lesson.titleEn || lesson.title}" naturally in an everyday conversation`,
          maxSeconds: 420,
          onFinish: (row) => { summary.talk = row.seconds; summary.chatId = row.id || null; finish(); },
        });
      }, 'Почати розмову');
    } else finish();
  }

  function grammarStep() {
    setFocus(true);
    const timer = activityTimer('grammar');
    const box = h('div.gx-exbox');
    const short = lesson.explanation.split('\n\n').slice(0, 2).join('\n\n');
    const fs = (lesson.formula || []).slice(0, 2);
    view.replaceChildren(h('div.stack-lg.gx',
      sesHead(1),
      txGroup('Коротке правило', [h('section.card.gx-expl', h('h2.ses-h2', lesson.title), md(short)),
        fs.length ? txRows(fs.map((f, k) => h('div.tx-row.gx-formula', fs.length > 1 ? h('span.tx-no', String(k + 1)) : h('span.tx-sq', ic('lightning', { size: 18 })), h('span.tx-body', h('span.tx-l', mdInline(f)))))) : null,
        txRow({ icon: 'book-open-text', label: 'Повне пояснення', sub: 'Урок з прикладами й таблицею', href: `#/grammar/${lesson.id}` })]),
      box));
    const list = lesson.exercises.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    runExercises(box, list, {
      title: 'Вправи',
      onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: lesson.mistakeType || 'tenses', explanation_uk: `${lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
      onDone: (res) => {
        summary.score = res.score;
        // кожна спроба зберігається так само, як у розділі «Граматика» (зараховується від 80%)
        recordLesson(lesson.id, res.score);
        timer.poke();
        timer.stop();
        box.append(txPrimary({ icon: 'arrow-right', label: 'Далі', sub: user() ? 'Етап 3 — розмова із вчителем' : 'Підсумок заняття', onclick: () => next(2) }));
        return true;
      },
    });
    cleanup = () => timer.stop();
  }

  function finish() {
    if (stopped) return;
    stopped = true;
    cleanup?.(); cleanup = null;
    setFocus(false);
    // показуємо саме зарахований час (той, що піде в статистику й Resonance)
    const logged = store.all('sessions').filter(s => Date.parse(s.ts) >= started).reduce((a, s) => a + (s.seconds || 0), 0);
    const min = Math.round(logged / 60);
    const talkMin = summary.talk ? Math.max(1, Math.round(summary.talk / 60)) : 0;
    view.replaceChildren(h('div.stack-lg.gx',
      // цифри етапів — пігулками в рядках «Що пройдено» (без окремого ряду показників)
      txResult({ icon: 'confetti', tone: 'good', label: 'Заняття завершено!', title: min ? `${min} хв практики` : 'Менше хвилини практики' }),
      txPrimary({ icon: 'house', label: 'На головну', href: '#/' }),
      txGroup('Що пройдено', txRows([
        txRow({ icon: 'cards', label: 'Слова', sub: summary.cards ? 'Тренування карток' : 'Етап пропущено', pill: summary.cards ? { text: String(summary.cards), tone: 'good' } : null }),
        txRow({ icon: 'puzzle-piece', label: lesson.title, sub: 'Урок граматики', pill: summary.score == null ? null : { text: `${summary.score}%`, tone: scoreTone(summary.score) }, href: `#/grammar/${lesson.id}` }),
        summary.chatId ? txRow({ icon: 'microphone', label: 'Підсумок розмови із вчителем', sub: `${talkMin} хв голосом`, href: `#/tutor?chat=${summary.chatId}` })
          : txRow({ icon: 'microphone', label: 'Розмова', sub: talkMin ? `${talkMin} хв голосом` : 'Етап пропущено' }),
      ]))));
  }

  function exit() {
    // час уже зарахований модулями етапів
    stopped = true;
    cleanup?.(); cleanup = null;
    setFocus(false);
    go('/', { replace: true });
  }

  next(0);
  return () => { stopped = true; cleanup?.(); setFocus(false); };
}

