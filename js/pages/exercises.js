// Вправи: #/exercises — усі категорії практики; #/exercises/grammar — граматичні вправи за темами
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import { SECTIONS } from '../nav.js';
import { grammarIndex, lesson as loadLesson } from '../data.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { activityTimer, addMistake } from '../stats.js';
import { setTitle } from '../ui/shell.js';
import { go } from '../router.js';
import { myLevel, LEVELS } from '../level.js';

export default async function exercises(view, r) {
  if (r.parts[0] === 'grammar') return grammarPractice(view, r.parts[1]);
  setTitle(S.nav.exercises);
  view.replaceChildren(h('div.list', SECTIONS.filter(s => s.group === 'practice').map(s =>
    h('a.list-row', { href: s.href }, h('span.tile-ico', emo(s.icon)), h('div.grow', h('div', { style: { fontWeight: 600 } }, s.long)), ic('caret-right', { size: 18 })))));
}

async function grammarPractice(view, unitSlug) {
  const idx = await grammarIndex();
  const units = [];
  for (const l of idx) { let u = units.find(x => x.name === l.unit); if (!u) units.push(u = { name: l.unit, slug: String(units.length + 1), items: [] }); u.items.push(l); }

  if (!unitSlug) {
    view.replaceChildren(h('div.stack-lg',
      h('p.small.dim', { style: { margin: '0 2px' } }, 'Оберіть тему — 10 змішаних вправ з усіх її уроків. Правила — у розділі «Теорія → Граматика».'),
      h('a.btn.primary.block.lg', { href: '#/exercises/grammar/mine' }, ic('lightning', { fill: true }), `Впереміш · рівень ${myLevel()}`),
      h('a.btn.soft.block', { href: '#/exercises/grammar/all' }, 'Усі теми всіх рівнів'),
      h('div.list', units.map(u => h('a.list-row', { href: `#/exercises/grammar/${u.slug}` },
        h('div.grow', h('div', { style: { fontWeight: 600 } }, u.name), h('div.sub', `${LEVELS.filter(lv => u.items.some(l => l.level === lv)).join('–').replace(/–.*–/, '–')} · ${u.items.length} ${plural(u.items.length, 'урок', 'уроки', 'уроків')}: ${u.items.map(l => l.title).join(', ')}`)),
        ic('caret-right', { size: 18 }))))));
    return;
  }

  const chosen = unitSlug === 'all' ? idx : unitSlug === 'mine' ? idx.filter(l => l.level === myLevel()) : (units.find(u => u.slug === unitSlug)?.items || []);
  const title = unitSlug === 'all' ? 'Усі теми' : unitSlug === 'mine' ? `Рівень ${myLevel()}` : units.find(u => u.slug === unitSlug)?.name || 'Граматика';
  setTitle(title);
  const lessons = await Promise.all(chosen.map(l => loadLesson(l.id)));
  const pool = lessons.flatMap(l => l.exercises.map(e => ({ ...e, _lesson: l })));
  const list = pool.sort(() => Math.random() - 0.5).slice(0, 10);
  const timer = activityTimer('grammar');
  const box = h('div.card');
  view.replaceChildren(h('div.stack', box,
    h('a.btn.ghost.block', { href: '#/exercises/grammar' }, ic('arrow-left'), 'Інша тема')));
  runExercises(box, list, {
    title,
    onMistake: (ex, given) => addMistake({ wrong: given || '—', right: answerText(ex), type: ex._lesson.mistakeType || 'tenses', explanation_uk: `${ex._lesson.title}: ${ex.explanation || ''}`, source: 'exercise' }),
    onDone: (res) => {
      timer.poke();
      setTimeout(() => box.append(h('div.stack', { style: { marginTop: '12px' } },
        h('a.btn.primary.block', { href: `#/exercises/grammar/${unitSlug}`, onclick: (e) => { e.preventDefault(); go(`/exercises/grammar/${unitSlug}`); } }, ic('arrow-clockwise'), 'Ще 10 вправ'))));
    },
  });
  return () => timer.stop();
}
