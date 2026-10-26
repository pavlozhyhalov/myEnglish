// Вправи: #/exercises — усі категорії практики; #/exercises/grammar — граматичні вправи за темами
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import { SECTIONS } from '../nav.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { activityTimer, addMistake } from '../stats.js';
import { setTitle } from '../ui/shell.js';
import { go } from '../router.js';
import { myLevel, LEVELS, levelChips, levelCounts, levelPick } from '../level.js';

export default async function exercises(view, r) {
  if (r.parts[0] === 'grammar') return grammarPractice(view, r.parts[1], r.query.lv);
  setTitle(S.nav.exercises);
  view.replaceChildren(h('div.list', SECTIONS.filter(s => s.group === 'practice').map(s =>
    h('a.list-row', { href: s.href }, h('span.tile-ico', emo(s.icon)), h('div.grow', h('div', { style: { fontWeight: 600 } }, s.long)), ic('caret-right', { size: 18 })))));
}

async function grammarPractice(view, unitSlug, lv) {
  const idx = await grammarIndex();
  const units = [];
  for (const l of idx) { let u = units.find(x => x.name === l.unit); if (!u) units.push(u = { name: l.unit, slug: String(units.length + 1), items: [] }); u.items.push(l); }

  if (!unitSlug) {
    // теми з уроками вибраного рівня (за замовчуванням — мого); вправи беруться лише з цих уроків
    const listBox = h('div.stack');
    const draw = () => {
      const sel = levelPick('exgrammar');
      const lvSel = sel === 'mine' ? myLevel() : sel;
      const rows = units.map(u => ({ u, items: sel === 'all' ? u.items : u.items.filter(l => l.level === lvSel) })).filter(x => x.items.length);
      listBox.replaceChildren(
        h('a.btn.primary.block.lg', { href: sel === 'all' ? '#/exercises/grammar/all' : `#/exercises/grammar/lvl?lv=${lvSel}` }, ic('lightning', { fill: true }), sel === 'all' ? 'Усі теми вперемішку' : `Вперемішку · рівень ${lvSel}`),
        h('div.list', rows.map(({ u, items }) => h('a.list-row', { href: `#/exercises/grammar/${u.slug}${sel === 'all' ? '' : `?lv=${lvSel}`}` },
          h('div.grow', h('div', { style: { fontWeight: 600 } }, u.name), h('div.sub', `${items.length} ${plural(items.length, 'урок', 'уроки', 'уроків')}: ${items.map(l => l.title).join(', ')}`)),
          ic('caret-right', { size: 18 })))));
    };
    view.replaceChildren(h('div.stack-lg',
      h('p.small.dim', { style: { margin: '0 2px' } }, 'Оберіть тему — 10 змішаних вправ з її уроків. Правила — у розділі «Теорія → Граматика».'),
      levelChips('exgrammar', levelCounts(idx), draw), listBox));
    draw();
    return;
  }

  const lvl = LEVELS.includes(lv) ? lv : null;
  const unitItems = (units.find(u => u.slug === unitSlug)?.items || []).filter(l => !lvl || l.level === lvl);
  const chosen = unitSlug === 'all' ? idx : unitSlug === 'mine' ? idx.filter(l => l.level === myLevel()) : unitSlug === 'lvl' ? idx.filter(l => l.level === (lvl || myLevel())) : unitItems;
  const title = unitSlug === 'all' ? 'Усі теми' : unitSlug === 'mine' ? `Рівень ${myLevel()}` : unitSlug === 'lvl' ? `Рівень ${lvl || myLevel()}` : lvl ? `${units.find(u => u.slug === unitSlug)?.name || 'Граматика'} · ${lvl}` : units.find(u => u.slug === unitSlug)?.name || 'Граматика';
  setTitle(title);
  const lessons = await Promise.all(chosen.map(l => loadLesson(l.id)));
  const pool = lessons.flatMap(l => l.exercises.map(e => ({ ...e, _lesson: l })));
  const list = pool.sort(() => Math.random() - 0.5).slice(0, 10);
  const timer = activityTimer('grammar');
  const box = h('div.card');
  view.replaceChildren(h('div.stack', box,
    h('a.btn.ghost.block', { href: '#/exercises/grammar' }, ic('arrow-left'), 'Інша тема')));
  runExercises(box, list, {
    onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: ex._lesson.mistakeType || 'tenses', explanation_uk: `${ex._lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
    onDone: (res) => {
      timer.poke();
      setTimeout(() => box.append(h('div.stack', { style: { marginTop: '12px' } },
        h('a.btn.primary.block', { href: `#/exercises/grammar/${unitSlug}${lvl ? `?lv=${lvl}` : ''}`, onclick: (e) => { e.preventDefault(); go(`/exercises/grammar/${unitSlug}${lvl ? `?lv=${lvl}` : ''}`); } }, ic('arrow-clockwise'), 'Ще 10 вправ'))));
    },
  });
  return () => timer.stop();
}
