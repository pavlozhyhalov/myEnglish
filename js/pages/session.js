// Кероване заняття ~15 хв: картки → міні-урок граматики → розмова з вчителем
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as srs from '../srs.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { runReview } from './cards.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { md } from '../ui/md.js';
import { activityTimer, addMistake, lessonDone, lessonsToReview, logSession } from '../stats.js';
import { user } from '../supa.js';
import { setFocus } from '../ui/shell.js';
import { go } from '../router.js';

export default async function session(view) {
  const steps = ['Картки', 'Граматика', 'Розмова'];
  const summary = { cards: 0, score: null, talk: 0 };
  let cleanup = null, stopped = false;
  const started = Date.now();

  const idx = await grammarIndex();
  const rev = lessonsToReview()[0];
  const lessonMeta = (rev && idx.find(l => l.id === rev.id)) || idx.find(l => !lessonDone(l.id)) || idx[0];
  const lesson = await loadLesson(lessonMeta.id);
  const counts = await srs.counts();

  const stepsBar = (cur) => h('div.steps', steps.map((_, i) => h('i', { class: i < cur ? 'done' : i === cur ? 'on' : '' })));

  function interstitial(cur, emoji, title, text, onGo, goLabel = 'Далі') {
    setFocus(true);
    view.replaceChildren(h('div.stack-lg',
      h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: exit }, ic('x')), h('div.grow', stepsBar(cur))),
      h('div.hero', emo(emoji, 'xl'), h('div.xs.dim', `Етап ${cur + 1} з ${steps.length}`), h('h1', title), h('p.dim', text),
        h('button.btn.primary.lg', { type: 'button', onclick: onGo }, goLabel),
        h('button.btn.ghost', { type: 'button', onclick: () => next(cur + 1) }, 'Пропустити етап'))));
  }

  function next(stage) {
    if (stopped) return;
    cleanup?.(); cleanup = null;
    if (stage === 0) {
      const n = Math.min(20, counts.due + counts.fresh);
      if (!n) return next(1);
      interstitial(0, 'cards', `Повторимо ${n} ${plural(n, 'картку', 'картки', 'карток')}`, 'Близько 5 хвилин. Оцінюйте чесно — так FSRS точніше планує повтори.', async () => {
        cleanup = await runReview(view, { limit: 20, onDone: (st) => { summary.cards = st.done; next(1); } });
      });
    } else if (stage === 1) {
      interstitial(1, 'puzzle', lesson.title, 'Коротке правило і 5 вправ.', () => grammarStep());
    } else if (stage === 2) {
      if (!user()) return finish();
      interstitial(2, 'mic', `Розмова на тему уроку`, `5–7 хвилин голосом: вчитель вплете «${lesson.title}» у розмову.`, async () => {
        const { voiceSession } = await import('../live/voice.js');
        cleanup = await voiceSession(view, {
          topic: `practise "${lesson.titleEn || lesson.title}" naturally in conversation about his work`,
          maxSeconds: 420,
          onFinish: (row) => { summary.talk = row.seconds; summary.chatId = row.id || null; finish(); },
        });
      }, 'Почати розмову');
    } else finish();
  }

  function grammarStep() {
    setFocus(true);
    const timer = activityTimer('grammar');
    const box = h('div.card');
    const short = lesson.explanation.split('\n\n').slice(0, 2).join('\n\n');
    view.replaceChildren(h('div.stack-lg',
      h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: exit }, ic('x')), h('div.grow', stepsBar(1))),
      h('section.card.stack', h('h2', lesson.title), md(short), ...(lesson.formula || []).slice(0, 2).map(f => h('div.formula', f)),
        h('a.small', { href: `#/grammar/${lesson.id}` }, 'Повне пояснення')),
      box));
    const list = lesson.exercises.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    runExercises(box, list, {
      onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: lesson.mistakeType || 'tenses', explanation_uk: `${lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
      onDone: (res) => {
        summary.score = res.score;
        timer.poke();
        timer.stop();
        box.append(h('button.btn.primary.block', { type: 'button', style: { marginTop: '12px' }, onclick: () => next(2) }, 'Далі', ic('arrow-right')));
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
    const min = Math.max(1, Math.round((Date.now() - started) / 60000));
    view.replaceChildren(h('div.stack-lg',
      h('div.hero', emo('party', 'xl'), h('h1', 'Заняття завершено!'), h('p.dim', `${min} хв практики`)),
      h('section.card.stack',
        h('div.row', emo('cards'), h('div.grow', 'Картки'), h('b', String(summary.cards))),
        h('div.row', emo('puzzle'), h('div.grow', lesson.title), h('b', summary.score == null ? '—' : `${summary.score}%`)),
        h('div.row', emo('mic'), h('div.grow', 'Розмова'), h('b', summary.talk ? `${Math.round(summary.talk / 60)} хв` : '—'))),
      summary.chatId ? h('a.btn.soft.block', { href: `#/tutor?chat=${summary.chatId}` }, 'Підсумок розмови з вчителем') : null,
      h('a.btn.primary.block.lg', { href: '#/' }, 'На головну')));
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

