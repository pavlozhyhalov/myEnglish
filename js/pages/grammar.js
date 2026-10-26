// Граматика (теорія): правила за темами; у кожному уроці — пояснення, приклади і вправи
import { h, ic, emo } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { md } from '../ui/md.js';
import { speak } from '../speech.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { recordLesson, activityTimer, addMistake, lessonsToReview } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { setTitle } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { LEVELS, LEVEL_NAME, myLevel, diff, levelTag, nextLessonByLevel } from '../level.js';

export default async function grammar(view, r) {
  if (r.parts[0]) return lessonPage(view, r.parts[0], r.query);
  const idx = await grammarIndex();
  const due = new Set(lessonsToReview().map(p => p.id));
  const done = idx.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
  const next = nextLessonByLevel(idx);
  const mine = myLevel();
  const row = (l) => {
    const p = store.get('lessons_progress', l.id);
    const status = due.has(l.id) ? h('span.tag.warn', 'Повторити') : p?.completed_at ? h('span.tag.good', `${p.best}%`) : p ? h('span.tag', `${p.best}%`) : null;
    return h('a.list-row', { href: `#/grammar/${l.id}` },
      h('span.num.dim', { style: { width: '26px' } }, String(l.n)),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, l.title), h('div.sub', l.summary)),
      status, ic('caret-right', { size: 18 }));
  };
  // розділи за рівнями: свій розгорнутий, решта — згорнуті (нижчі — для прогалин, вищі — наперед)
  const levelSection = (lv) => {
    const items = idx.filter(l => l.level === lv);
    if (!items.length) return null;
    const d = items.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
    const units = [];
    for (const l of items) { let u = units.find(x => x.name === l.unit); if (!u) units.push(u = { name: l.unit, items: [] }); u.items.push(l); }
    const body = h('div.stack', { style: { gap: '12px', marginTop: '8px' } }, units.map(u => h('div.stack', { style: { gap: '6px' } },
      h('div.xs.dim', { style: { margin: '0 2px', fontWeight: 600 } }, u.name), h('div.list', u.items.map(row)))));
    return h('details.level-sec', { open: lv === mine ? true : null },
      h('summary.row', levelTag(lv), h('div.grow', h('b', LEVEL_NAME[lv]), lv === mine ? h('span.xs.dim', ' · ваш рівень') : diff(lv) > 0 ? h('span.xs.dim', ' · наступні') : null),
        h('span.small.dim.num', `${d}/${items.length}`)),
      body);
  };

  view.replaceChildren(h('div.stack-lg',
    h('section.card.stack',
      h('div.row', emo('puzzle', 'lg'), h('div.grow', h('h1', { style: { margin: 0 } }, 'Граматика'), h('div.small.dim', `Пройдено ${done} з ${idx.length} · урок зараховано від 80%`))),
      h('div.progress', h('i', { style: { width: `${done / idx.length * 100}%` } })),
      next ? h('a.btn.primary.block', { href: `#/grammar/${next.id}` }, ic('play', { fill: true }), `Продовжити: ${next.title}`) : h('div.feedback.ok', 'Курс пройдено! Повторюйте уроки за графіком.')),
    h('p.xs.dim', { style: { margin: '0 2px' } }, `Уроки підібрано під рівень ${mine}. Змінити рівень — у «Налаштуваннях» або тестом.`),
    ...LEVELS.map(levelSection)));
}

async function lessonPage(view, id, query = {}) {
  const [idx, l] = await Promise.all([grammarIndex(), loadLesson(id)]);
  setTitle(l.title);
  const timer = activityTimer('grammar');
  const pos = idx.findIndex(x => x.id === id);
  const nextL = idx[pos + 1];
  const p = store.get('lessons_progress', id);

  const exBox = h('div');
  const startEx = (list, label) => {
    exBox.replaceChildren(h('div.card', { id: 'ex' }));
    exBox.firstChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
    runExercises(exBox.firstChild, list, {
      title: label,
      onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: l.mistakeType || 'tenses', explanation_uk: `${l.title}: ${ex.explanation || ''}`.trim(), source: 'exercise' }),
      onDone: (res) => {
        const pr = recordLesson(id, res.score);
        timer.poke();
        if (res.score >= 80) toast(pr.review_stage ? 'Повтор зараховано' : 'Урок пройдено!');
        setTimeout(() => {
          exBox.firstChild.append(h('div.stack', { style: { marginTop: '12px' } },
            res.score < 80 ? h('button.btn.soft.block', { type: 'button', onclick: () => startEx(shuffle(l.exercises), 'Вправи') }, ic('arrow-clockwise'), 'Пройти ще раз') : null,
            moreBtn(),
            nextL ? h('a.btn.primary.block', { href: `#/grammar/${nextL.id}` }, `Далі: ${nextL.title}`, ic('arrow-right')) : null));
        });
      },
    });
  };
  const moreBtn = () => h('button.btn.soft.block', { type: 'button', onclick: async (e) => {
    if (!user()) { toast(S.err.needLogin); return; }
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Генерую вправи…';
    try {
      const res = await tutor('exercises', { topic: `${l.titleEn || l.title} (${l.title})`, count: 10 });
      if (!res.exercises?.length) throw new Error('empty');
      startEx(res.exercises, 'Ще 10 вправ (AI)');
    } catch (err) { toast(aiErrorText(err) || 'Не вдалося згенерувати', { kind: 'bad' }); b.disabled = false; b.textContent = 'Ще 10 вправ (AI)'; }
  } }, ic('sparkle', { fill: true }), 'Ще 10 вправ (AI)');

  view.replaceChildren(h('div.stack-lg',
    h('div.row', h('a.icon-btn', { href: '#/grammar', 'aria-label': 'До курсу' }, ic('arrow-left')),
      h('div.grow', h('div.xs.dim', `${l.unit} · урок ${pos + 1}`), h('h1', { style: { margin: 0 } }, l.title)),
      p?.completed_at ? h('span.tag.good', `${p.best}%`) : null),
    h('section.card', md(l.explanation)),
    l.formula?.length ? h('section.stack', { style: { gap: '8px' } }, l.formula.map(f => h('div.formula', f))) : null,
    l.table ? h('section.card', { style: { overflowX: 'auto' } }, h('table.gtable',
      h('thead', h('tr', l.table.head.map(c => h('th', c)))),
      h('tbody', l.table.rows.map(rw => h('tr', rw.map(c => h('td', c))))))) : null,
    h('section.card', h('div.section-title', 'Приклади'),
      l.examples.map(e => h('div.example',
        h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(e.en) }, ic('speaker-high', { size: 20 })),
        h('div.grow', h('div', e.en), h('div.xs.dim', e.uk))))),
    l.tip ? h('section.card.accent.row', emo('bulb'), h('div.small.grow', md(l.tip))) : null,
    exBox,
    h('div.stack',
      h('button.btn.primary.lg.block', { type: 'button', onclick: () => startEx(shuffle(l.exercises).slice(0, 10), 'Вправи') }, ic('lightning', { fill: true }), `Вправи (${Math.min(10, l.exercises.length)})`),
      h('a.btn.soft.block', { href: `#/tests/lesson/${id}` }, ic('exam'), 'Тест за уроком (15 питань)'),
      h('a.btn.ghost.block', { href: `#/tutor?mode=explain&topic=${encodeURIComponent(l.titleEn || l.title)}` }, ic('chat-circle-dots'), 'Запитати вчителя'))));

  if (query.ex) startEx(shuffle(l.exercises).slice(0, 10), 'Вправи');
  return () => timer.stop();
}

export function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
