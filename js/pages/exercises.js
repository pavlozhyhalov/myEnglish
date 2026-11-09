// Вправи: #/exercises — усі категорії практики; #/exercises/grammar — граматичні вправи за темами
import { h } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import { MENU } from '../nav.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { activityTimer, addMistake, recordLesson, lessonNeedsReview, lessonDone } from '../stats.js';
import { reviewSet, dueCount } from '../review.js';
import { setTitle } from '../ui/shell.js';
import { go } from '../router.js';
import { myLevel, LEVELS, levelChips, levelCounts, levelPick } from '../level.js';
import { tx, txPrimary, txGrid, txGroup, txRow, txResult } from '../ui/tiles.js';
import { moreRows } from './grammar.js';


export default async function exercises(view, r) {
  if (r.parts[0] === 'grammar') return grammarPractice(view, r.parts[1], r.query.lv);
  setTitle(S.nav.exercises);
  // ті самі групи й плитки, що в боковому меню (розділи, об'єднані в одну плитку, — одна плитка); без «Статистики»
  view.replaceChildren(h('div.stack-lg.gx', MENU.map(g => txGroup(g.label,
    txGrid(g.items.filter(it => it.id !== 'stats').map(it => tx({ icon: it.icon, label: it.label, href: it.href })))))));
}

async function grammarPractice(view, unitSlug, lv) {
  const idx = await grammarIndex();
  const units = [];
  for (const l of idx) { let u = units.find(x => x.name === l.unit); if (!u) units.push(u = { name: l.unit, slug: String(units.length + 1), items: [] }); u.items.push(l); }

  if (!unitSlug) {
    // теми з уроками вибраного рівня (за замовчуванням — мого); вправи беруться лише з цих уроків
    const primBox = h('div'), listBox = h('div.stack-lg');
    const draw = () => {
      const sel = levelPick('exgrammar');
      const lvSel = sel === 'mine' ? myLevel() : sel;
      const rows = units.map(u => ({ u, items: sel === 'all' ? u.items : u.items.filter(l => l.level === lvSel) })).filter(x => x.items.length);
      // «Повторення» (пройдене + слабкі місця) — головна дія, коли щось чекає повтору; інакше — звичайна плитка під «Вперемішку»
      const due = dueCount();
      const rev = (primary) => (primary ? txPrimary : (o) => tx({ ...o, wide: true }))({ icon: 'arrow-clockwise', label: 'Повторення',
        sub: due ? `${due} ${plural(due, 'урок чекає', 'уроки чекають', 'уроків чекають')} повтору · слабкі місця й пройдені рівні` : 'слабкі місця й пройдені рівні · 10 вправ', href: '#/exercises/grammar/review' });
      const mix = (primary) => (primary ? txPrimary : (o) => tx({ ...o, wide: true }))({ icon: 'lightning', label: sel === 'all' ? 'Усі теми вперемішку' : `Вперемішку · ${lvSel}`, sub: sel === 'all' ? '10 вправ з усіх тем' : '10 вправ з тем цього рівня', href: sel === 'all' ? '#/exercises/grammar/all' : `#/exercises/grammar/lvl?lv=${lvSel}` });
      primBox.replaceChildren(h('div.stack', due ? rev(true) : mix(true), due ? mix(false) : rev(false)));
      listBox.replaceChildren(
        rows.length ? txGroup('Теми', moreRows(rows.map(({ u, items }, k) => txRow({
          // кількість уроків — на початку підпису, а не пігулкою: на 320 px назва теми не ламається на два рядки
          no: k + 1, label: u.name, sub: `${items.length} ${plural(items.length, 'урок', 'уроки', 'уроків')} · ${items.map(l => l.title).join(', ')}`, cls: 'gx-clamp',
          href: `#/exercises/grammar/${u.slug}${sel === 'all' ? '' : `?lv=${lvSel}`}`,
        })))) : null);
    };
    view.replaceChildren(h('div.stack-lg.gx', primBox, levelChips('exgrammar', levelCounts(idx), draw), listBox));
    draw();
    return;
  }

  if (unitSlug === 'review') return reviewPractice(view);
  const lvl = LEVELS.includes(lv) ? lv : null;
  const unitItems = (units.find(u => u.slug === unitSlug)?.items || []).filter(l => !lvl || l.level === lvl);
  const chosen = unitSlug === 'all' ? idx : unitSlug === 'mine' ? idx.filter(l => l.level === myLevel()) : unitSlug === 'lvl' ? idx.filter(l => l.level === (lvl || myLevel())) : unitItems;
  const title = unitSlug === 'all' ? 'Усі теми' : unitSlug === 'mine' ? `Рівень ${myLevel()}` : unitSlug === 'lvl' ? `Рівень ${lvl || myLevel()}` : lvl ? `${units.find(u => u.slug === unitSlug)?.name || 'Граматика'} · ${lvl}` : units.find(u => u.slug === unitSlug)?.name || 'Граматика';
  setTitle(title);
  const lessons = await Promise.all(chosen.map(l => loadLesson(l.id)));
  const pool = lessons.flatMap(l => l.exercises.map(e => ({ ...e, _lesson: l })));
  const list = pool.sort(() => Math.random() - 0.5).slice(0, 10);
  const timer = activityTimer('grammar');
  const box = h('div.gx-exbox');
  view.replaceChildren(h('div.stack-lg.gx', box,
    tx({ wide: true, icon: 'arrow-left', label: 'Інша тема', sub: 'Усі теми граматичних вправ', href: '#/exercises/grammar' })));
  runExercises(box, list, {
    title: 'Вправи',
    onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: ex._lesson.mistakeType || 'tenses', explanation_uk: `${ex._lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
    onDone: (res) => {
      timer.poke();
      setTimeout(() => box.append(txPrimary({ icon: 'arrow-clockwise', label: 'Ще 10 вправ', sub: 'Нові завдання з цієї теми', href: `#/exercises/grammar/${unitSlug}${lvl ? `?lv=${lvl}` : ''}`, onclick: (e) => { e.preventDefault(); go(`/exercises/grammar/${unitSlug}${lvl ? `?lv=${lvl}` : ''}`); } })));
    },
  });
  return () => timer.stop();
}

/**
 * «Повторення»: 10 вправ з уроків, що чекають повтору, уроків слабких правил і випадкових пройдених уроків нижчих рівнів (по 2 з уроку).
 * Урок без помилок — повтор зараховано (наступний через довший інтервал); з помилкою — урок знову на повторенні.
 */
async function reviewPractice(view) {
  setTitle('Повторення');
  const set = await reviewSet(5);
  if (!set.length) {
    view.replaceChildren(h('div.stack-lg.gx', txResult({ icon: 'check-circle', tone: 'good', label: 'Повторення', title: 'Повторювати поки нічого', sub: 'Пройдені уроки з\'являться тут у свій час' }),
      tx({ wide: true, icon: 'arrow-left', label: 'До вправ', href: '#/exercises/grammar' })));
    return;
  }
  const lessons = await Promise.all(set.map(l => loadLesson(l.id).catch(() => null)));
  const list = lessons.filter(Boolean).flatMap(l => l.exercises.filter(e => e.type !== 'translate').sort(() => Math.random() - 0.5).slice(0, 2).map(e => ({ ...e, _lesson: l })))
    .sort(() => Math.random() - 0.5).slice(0, 10);
  const timer = activityTimer('grammar');
  const box = h('div.gx-exbox');
  const why = { due: 'час повторити', weak: 'слабке місце', old: 'пройдений рівень' };
  view.replaceChildren(h('div.stack-lg.gx', box,
    txGroup('У цьому повторенні', set.map(l => txRow({ icon: 'puzzle-piece', label: l.title, sub: `${l.level} · ${l.ruleLabel ? `слабке місце: ${l.ruleLabel}` : why[l.why]}`, href: `#/grammar/${l.id}` })))));
  runExercises(box, list, {
    title: 'Повторення',
    onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: ex._lesson.mistakeType || 'tenses', explanation_uk: `${ex._lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
    onDone: (res) => {
      timer.poke();
      // по уроках: без помилок — повтор зараховано; з помилкою — знову на повторення
      const by = new Map();
      for (const r of res.results) { const id = r.ex._lesson.id; const e = by.get(id) || { ok: 0, n: 0 }; e.n++; if (r.ok) e.ok++; by.set(id, e); }
      for (const [id, e] of by) {
        // зараховуємо повтор лише вже пройденим урокам (2 вправи не заміняють проходження уроку)
        if (e.ok === e.n) { if (lessonDone(id)) recordLesson(id, 100); }
        else lessonNeedsReview(id);
      }
      setTimeout(() => box.append(txPrimary({ icon: 'arrow-clockwise', label: 'Ще повторення', sub: 'наступні уроки й слабкі місця', href: '#/exercises/grammar/review',
        onclick: (e) => { e.preventDefault(); reviewPractice(view); } })));
    },
  });
  return () => timer.stop();
}
