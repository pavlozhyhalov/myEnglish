// Граматика (теорія): правила за темами; у кожному уроці — пояснення, приклади і вправи
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
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
import { tx, txPrimary, txRow, txRows, txBar, txGrid, txGroup, txPill } from '../ui/tiles.js';

export default async function grammar(view, r) {
  if (r.parts[0]) return lessonPage(view, r.parts[0], r.query);
  const idx = await grammarIndex();
  const due = new Set(lessonsToReview().map(p => p.id));
  const next = nextLessonByLevel(idx);
  // рядок уроку: номер курсу ліворуч, тема — підписом, стан — пігулкою праворуч
  const row = (l) => {
    const p = store.get('lessons_progress', l.id);
    const pill = due.has(l.id) ? { text: 'Повторити', tone: 'warn' } : p?.completed_at ? { text: `${p.best}%`, tone: 'good' } : p ? { text: `${p.best}%` } : null;
    return txRow({ no: l.n, label: l.title, sub: l.unit || l.summary || null, pill, href: `#/grammar/${l.id}`, attrs: l.summary ? { title: l.summary } : {} });
  };
  // розділи за рівнями: свій розгорнутий, решта — згорнуті (нижчі — для прогалин, вищі — наперед)
  const section = (lv) => {
    const items = idx.filter(l => l.level === lv).sort((a, b) => a.n - b.n);
    if (!items.length) return null;
    const d = items.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
    // у порядку курсу (номер = порядок проходження, як «Продовжити» й тести); на виду — 6 найближчих, решта — «Показати всі»
    const shown = nearRows(items, l => due.has(l.id), l => !!store.get('lessons_progress', l.id)?.completed_at);
    return levelSection(lv, { done: d, total: items.length, countLabel: `Пройдено ${d} з ${items.length}`, rows: items.map(row), shown });
  };

  view.replaceChildren(h('div.stack-lg.gx',
    next ? txPrimary({ icon: 'play', label: 'Продовжити', sub: `${next.n} · ${next.title}`, href: `#/grammar/${next.id}`, })
      : tx({ wide: true, tone: 'good', icon: 'check-circle', label: 'Курс пройдено!', sub: 'Повторюйте уроки за графіком' }),
    h('div.gx-levels', LEVELS.map(section))));
}

/**
 * Які рядки списку показати одразу (до max): спершу «на повторення», далі — від першого незавершеного за порядком курсу.
 * Повертає Set індексів.
 */
export function nearRows(items, isDue, isDone, max = 6) {
  const out = new Set();
  items.forEach((x, i) => { if (out.size < Math.min(2, max) && isDue(x)) out.add(i); });
  let start = items.findIndex(x => !isDone(x));
  if (start < 0) start = 0;
  start = Math.max(0, Math.min(start, items.length - (max - out.size)));
  for (let i = start; i < items.length && out.size < max; i++) out.add(i);
  for (let i = start - 1; i >= 0 && out.size < max; i--) out.add(i);
  return out;
}

/**
 * Список рядків-плиток: на виду — shown (Set індексів, за замовчуванням перші 6), решта прихована за рядком «Показати всі · N».
 */
export function moreRows(rows, shown = null, label = 'Показати всі') {
  const list = rows.filter(Boolean);
  const vis = shown || new Set(list.map((_, i) => i).slice(0, 6));
  if (list.length <= Math.max(vis.size, 6)) return txRows(list);
  list.forEach((r, i) => { if (!vis.has(i)) r.hidden = true; });
  const box = txRows(list);
  const more = txRow({ icon: 'caret-down', label: `${label} · ${list.length}`, cls: 'gx-more', chevron: false,
    attrs: { 'aria-expanded': 'false' },
    onclick: () => { list.forEach(r => { r.hidden = false; }); more.remove(); } });
  box.append(more);
  return box;
}

/**
 * Розгортний розділ рівня (Граматика, «Оберіть урок» у тестах): заголовок — плитка з рівнем у квадратику,
 * назвою, лічильником і смужкою; усередині — рядки-плитки. Свій рівень розгорнутий.
 */
export function levelSection(lv, { done, total, countLabel, rows, shown = null }) {
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
    moreRows(rows, shown));
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
  // дія «Вправи»: до початку — головна (синя) плитка; коли вправи вже йдуть — звичайна «почати заново»,
  // щоб синьою лишалась дія всередині вправи («Перевірити»/«Далі») або «Далі: наступний урок»
  const exTile = (running) => (running ? tx : txPrimary)({
    wide: true, icon: running ? 'arrow-clockwise' : 'lightning',
    label: running ? 'Вправи заново' : `Вправи (${Math.min(10, l.exercises.length)})`,
    sub: running ? '10 нових змішаних завдань з уроку' : 'Змішані завдання з уроку',
    onclick: () => startEx(shuffle(l.exercises).slice(0, 10), 'Вправи'),
  });
  const exSlot = h('div', exTile(false));
  const startEx = (list, label) => {
    exSlot.hidden = false;
    exSlot.replaceChildren(exTile(true));
    exBox.replaceChildren(h('div.gx-exbox', { id: 'ex' }));
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
        // після результату «Вправи заново» внизу дублювала б «Пройти ще раз» — ховаємо до нового запуску
        exSlot.hidden = true;
        setTimeout(() => {
          const again = tx({ icon: 'arrow-clockwise', label: 'Пройти ще раз', sub: res.score < 80 ? 'Усі вправи уроку' : '10 нових змішаних завдань',
            onclick: () => startEx(res.score < 80 ? shuffle(l.exercises) : shuffle(l.exercises).slice(0, 10), 'Вправи') });
          exBox.firstChild.append(h('section.tx-group.gx-exnext',
            h('h2.tx-label', 'Що далі'),
            nextL ? txPrimary({ icon: 'arrow-right', label: `Далі: ${nextL.title}`, sub: 'Наступний урок курсу', href: `#/grammar/${nextL.id}` }) : null,
            txGrid([again, moreTile()], 2)));
        });
      },
    });
  };
  // «Ще 10 вправ (AI)»: плитка; під час генерації — вимкнена з підписом «Генерую вправи…»
  const moreTile = () => tx({ icon: 'sparkle', label: 'Ще 10 вправ (AI)', sub: 'Нові завдання від вчителя', onclick: async (e) => {
    if (!user()) { toast(S.err.needLogin); return; }
    const b = e.currentTarget, lab = b.querySelector('.tx-l');
    b.disabled = true; lab.textContent = 'Генерую вправи…';
    try {
      const res = await tutor('exercises', { topic: `${l.titleEn || l.title} (${l.title})`, count: 10 });
      if (!res.exercises?.length) throw new Error('empty');
      startEx(res.exercises, 'Ще 10 вправ (AI)');
    } catch (err) { toast(aiErrorText(err) || 'Не вдалося згенерувати', { kind: 'bad' }); b.disabled = false; lab.textContent = 'Ще 10 вправ (AI)'; }
  } });

  const isDue = lessonsToReview().some(x => x.id === id);
  // назва уроку — у шапці застосунку; тут — лише підпис розділу й номер уроку
  view.replaceChildren(h('div.stack-lg.gx.gx-lesson',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/grammar', 'aria-label': 'До курсу' }, ic('arrow-left')),
      h('div.grow', h('h1.tx-label.gx-eyebrow', { 'aria-label': `${l.title}. ${l.unit}, урок ${idx[pos]?.n ?? pos + 1}` }, `${l.unit} · урок ${idx[pos]?.n ?? pos + 1}`)),
      isDue ? txPill('Повторити', 'warn') : p?.completed_at ? txPill(`${p.best}%`, 'good') : null),
    // правило, формули й порада — одна група; таблиця — згорнута плитка; приклади — 6 на виду, решта — «Показати всі»
    txGroup('Правило', [h('section.card.gx-expl', md(l.explanation)),
      l.formula?.length ? txRows(l.formula.map((f, k) =>
        h('div.tx-row.gx-formula', { 'aria-label': `Формула${l.formula.length > 1 ? ' ' + (k + 1) : ''}` }, l.formula.length > 1 ? h('span.tx-no', String(k + 1)) : h('span.tx-sq', ic('lightning', { size: 18 })), h('span.tx-body', h('span.tx-l', mdInline(f)))))) : null,
      l.tip ? h('div.tx.wide.gx-tip', h('span.tx-sq', ic('lightbulb', { size: 20 })), h('div.tx-body.small', md(l.tip))) : null,
      l.table ? h('details.gx-sound.gx-tbl',
        h('summary.gx-sound-head', h('span.tx-sq', ic('list', { size: 18 })),
          h('span.tx-body', h('span.tx-l', 'Таблиця'), h('span.tx-s', `${l.table.rows.length} ${plural(l.table.rows.length, 'рядок', 'рядки', 'рядків')}`)),
          ic('caret-down', { size: 16 })),
        h('div.gx-sound-body.gx-table', h('table.gtable',
          h('thead', h('tr', l.table.head.map(c => h('th', c)))),
          h('tbody', l.table.rows.map(rw => h('tr', rw.map(c => h('td', c)))))))) : null]),
    txGroup('Приклади', moreRows(l.examples.map(e => h('div.tx-row.gx-ex',
      h('button.tx-sq.gx-say', { type: 'button', 'aria-label': `Прослухати: ${e.en}`, onclick: () => speak(e.en) }, ic('speaker-high', { size: 18 })),
      h('span.tx-body', h('span.tx-l', { lang: 'en' }, e.en), h('span.tx-s', e.uk)))))),
    exBox,
    txGroup('Практика', [exSlot,
      txGrid([
        tx({ icon: 'exam', label: 'Тест за уроком', sub: 'До 15 питань', href: `#/tests/lesson/${id}` }),
        tx({ icon: 'chat-circle-dots', label: 'Запитати вчителя', sub: 'Пояснить по-іншому', href: `#/tutor?mode=explain&topic=${encodeURIComponent(l.titleEn || l.title)}` }),
      ], 2)])));

  if (query.ex) startEx(shuffle(l.exercises).slice(0, 10), 'Вправи');
  return () => timer.stop();
}

export function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
