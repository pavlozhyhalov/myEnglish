// Граматика (теорія): правила за темами; у кожному уроці — пояснення, приклади і вправи
import { h, ic, emo } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { md, mdInline } from '../ui/md.js';
import { speak } from '../speech.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { recordLesson, activityTimer, addMistake, lessonsToReview } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { setTitle } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { LEVELS, LEVEL_NAME, myLevel, diff, nextLessonByLevel } from '../level.js';
import { tx, txPrimary, txRow, txRows, txBar, txGrid, txPill } from '../ui/tiles.js';

export default async function grammar(view, r) {
  if (r.parts[0]) return lessonPage(view, r.parts[0], r.query);
  const idx = await grammarIndex();
  const due = new Set(lessonsToReview().map(p => p.id));
  const done = idx.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
  const next = nextLessonByLevel(idx);
  const mine = myLevel();
  // рядок уроку: номер курсу ліворуч, тема — підписом, стан — пігулкою праворуч
  const row = (l) => {
    const p = store.get('lessons_progress', l.id);
    const pill = due.has(l.id) ? { text: 'Повторити', tone: 'warn' } : p?.completed_at ? { text: `${p.best}%`, tone: 'good' } : p ? { text: `${p.best}%` } : null;
    return txRow({ no: l.n, label: l.title, sub: l.unit || l.summary || null, pill, href: `#/grammar/${l.id}`, attrs: l.summary ? { title: l.summary } : {} });
  };
  // розділи за рівнями: свій розгорнутий, решта — згорнуті (нижчі — для прогалин, вищі — наперед)
  const section = (lv) => {
    const items = idx.filter(l => l.level === lv);
    if (!items.length) return null;
    const d = items.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
    // у порядку курсу (номер = порядок проходження, як «Продовжити» й тести)
    return levelSection(lv, { done: d, total: items.length, countLabel: `Пройдено ${d} з ${items.length}`, rows: [...items].sort((a, b) => a.n - b.n).map(row) });
  };

  view.replaceChildren(h('div.stack-lg.gx',
    next ? txPrimary({ icon: 'play', label: 'Продовжити', sub: `${next.n} · ${next.title}`, href: `#/grammar/${next.id}`, attrs: { 'aria-label': `Продовжити: ${next.title}` } })
      : tx({ wide: true, tone: 'good', icon: 'check-circle', label: 'Курс пройдено!', sub: 'Повторюйте уроки за графіком.' }),
    h('div.gx-overall',
      h('div.gx-overall-t', h('span', `Пройдено ${done} з ${idx.length}`), h('span.dim', 'урок зараховується від 80%')),
      h('div.progress', { role: 'progressbar', 'aria-label': 'Пройдено уроків', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(done / idx.length * 100) }, h('i', { style: { width: `${done / idx.length * 100}%` } }))),
    h('div.gx-levels', LEVELS.map(section)),
    h('p.xs.dim', { style: { margin: '0 4px' } }, `Уроки підібрано під рівень ${mine}. Змінити рівень — у «Налаштуваннях» або тестом.`)));
}

/**
 * Розгортний розділ рівня (Граматика, «Оберіть урок» у тестах): заголовок — плитка з рівнем у квадратику,
 * назвою, лічильником і смужкою; усередині — рядки-плитки. Свій рівень розгорнутий.
 */
export function levelSection(lv, { done, total, countLabel, rows }) {
  const mine = myLevel();
  const rel = lv === mine ? 'ваш рівень' : diff(lv) > 0 ? 'вище вашого' : null;
  return h('details.gx-lv' + (lv === mine ? '.mine' : ''), { open: lv === mine ? true : null },
    h('summary.gx-lv-head',
      h('span.gx-lv-sq', lv),
      h('span.gx-lv-body',
        h('span.gx-lv-name', h('b', LEVEL_NAME[lv]), rel ? h('span.gx-lv-rel', rel) : null),
        txBar(total ? done / total : 0, lv === mine)),
      h('span.gx-lv-n', { 'aria-label': countLabel }, `${done}/${total}`),
      ic('caret-down', { size: 16 })),
    txRows(rows));
}

async function lessonPage(view, id, query = {}) {
  let idx, l;
  try { [idx, l] = await Promise.all([grammarIndex(), loadLesson(id)]); } catch {
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Урок не знайдено.'), h('a.btn.soft', { href: '#/grammar' }, 'До списку уроків')));
    return;
  }
  setTitle(l.title);
  const timer = activityTimer('grammar');
  const pos = idx.findIndex(x => x.id === id);
  // «Далі» — наступний незарахований урок курсу (а не просто сусідній)
  const nextL = idx.slice(pos + 1).find(x => !store.get('lessons_progress', x.id)?.completed_at) || idx[pos + 1];
  const p = store.get('lessons_progress', id);

  const exBox = h('div');
  const startEx = (list, label) => {
    exBox.replaceChildren(h('div.card', { id: 'ex' }));
    exBox.firstChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
    runExercises(exBox.firstChild, list, {
      title: label,
      onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: l.mistakeType || 'tenses', explanation_uk: `${l.title}: ${ex.explanation || ''}`.trim(), source: 'exercise' }),
      onDone: (res) => {
        const before = store.get('lessons_progress', id);
        const wasDone = !!before?.completed_at, stage0 = before?.review_stage || 0;
        const pr = recordLesson(id, res.score);
        timer.poke();
        if (res.score >= 80) toast(!wasDone ? 'Урок пройдено!' : (pr.review_stage || 0) > stage0 ? 'Повтор зараховано' : 'Чудово — знання тримаються');
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

  const isDue = lessonsToReview().some(x => x.id === id);
  view.replaceChildren(h('div.stack-lg.gx',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/grammar', 'aria-label': 'До курсу' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', `${l.unit} · урок ${idx[pos]?.n ?? pos + 1}`), h('h1.gx-lh1', l.title)),
      isDue ? txPill('Повторити', 'warn') : p?.completed_at ? txPill(`${p.best}%`, 'good') : null),
    h('section.card', md(l.explanation)),
    l.formula?.length ? h('section.stack', { style: { gap: '8px' } }, l.formula.map(f => h('div.formula', mdInline(f)))) : null,
    l.table ? h('section.card', { style: { overflowX: 'auto' } }, h('table.gtable',
      h('thead', h('tr', l.table.head.map(c => h('th', c)))),
      h('tbody', l.table.rows.map(rw => h('tr', rw.map(c => h('td', c))))))) : null,
    h('section.card', h('div.section-title', 'Приклади'),
      l.examples.map(e => h('div.example',
        h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(e.en) }, ic('speaker-high', { size: 20 })),
        h('div.grow', h('div', e.en), h('div.xs.dim', e.uk))))),
    l.tip ? h('section.card.accent.row', emo('bulb'), h('div.small.grow', md(l.tip))) : null,
    exBox,
    h('section.tx-group',
      txPrimary({ icon: 'lightning', label: `Вправи (${Math.min(10, l.exercises.length)})`, sub: 'Змішані завдання з уроку', onclick: () => startEx(shuffle(l.exercises).slice(0, 10), 'Вправи') }),
      txGrid([
        tx({ icon: 'exam', label: 'Тест за уроком', sub: 'До 15 питань', href: `#/tests/lesson/${id}` }),
        tx({ icon: 'chat-circle-dots', label: 'Запитати вчителя', sub: 'Пояснить по-іншому', href: `#/tutor?mode=explain&topic=${encodeURIComponent(l.titleEn || l.title)}` }),
      ], 2))));

  if (query.ex) startEx(shuffle(l.exercises).slice(0, 10), 'Вправи');
  return () => timer.stop();
}

export function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
