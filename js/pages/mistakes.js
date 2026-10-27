// Помилки: мій список, групування за типом, самоперевірка, тренування групи
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { mistakesByType, mistakeHit, activityTimer } from '../stats.js';
import { matches, runExercises, resultView } from '../ui/exercises.js';
import { confirmSheet } from '../ui/sheet.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';

const SRC = { tutor: 'вчитель', test: 'тест', exercise: 'вправа', diary: 'щоденник', voice: 'голос', pronunciation: 'вимова' };

export default function mistakes(view, r) {
  let showResolved = false;
  const body = h('div.stack-lg');
  const draw = () => {
    const groups = mistakesByType({ includeResolved: showResolved });
    const total = store.all('mistakes').filter(m => !m.resolved).length;
    const resolved = store.all('mistakes').filter(m => m.resolved).length;
    body.replaceChildren(
      h('section.card.stack',
        h('div.row', emo('target', 'lg'), h('div.grow', h('div', { style: { fontWeight: 600 } }, `${total} ${plural(total, 'помилка', 'помилки', 'помилок')} у роботі`), h('div.xs.dim', `Виправлено: ${resolved} · помилка вважається виправленою після 3 правильних відповідей поспіль`))),
        total ? h('button.btn.primary.block', { type: 'button', onclick: () => drill(body, draw, timer) }, ic('barbell'), 'Вправи на мої помилки') : null,
        h('button.btn.sm.ghost', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { showResolved = !showResolved; draw(); } }, showResolved ? 'Сховати виправлені' : 'Показати виправлені')),
      groups.length ? '' : h('div.empty', emo('sparkles', 'xl'), h('p', 'Список порожній. Помилки з розмов, вправ і тестів з\'являтимуться тут.')),
      ...groups.map(g => h('section.stack', { style: { gap: '8px' } },
        h('div.row', h('div.section-title.grow', `${S.mistakeTypes[g.type] || g.type} · ${g.total}`),
          h('button.btn.sm.soft', { type: 'button', onclick: () => selfCheck(body, g.items.filter(m => !m.resolved), draw) }, ic('check-circle', { size: 16 }), 'Перевірити себе'),
          h('a.btn.sm.primary', { href: `#/tutor?mode=drill&type=${g.type}` }, 'Потренувати')),
        h('div.list', g.items.sort((a, b) => (b.count || 1) - (a.count || 1)).map(m => h('div.list-row', { style: { alignItems: 'flex-start' } },
          h('div.grow.stack', { style: { gap: '2px' } },
            h('div', h('s.bad', m.wrong), ' → ', h('b.good', m.right)),
            m.explanation_uk ? h('div.xs.dim', m.explanation_uk) : null,
            h('div.xs.dim', `×${m.count || 1} · ${SRC[m.source] || m.source} · ${m.resolved ? 'виправлено' : `прогрес ${m.streak || 0}/3`}`)),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Видалити', onclick: async () => { if (await confirmSheet('Видалити помилку?', `${m.wrong} → ${m.right}`, 'Видалити', { danger: true })) { store.remove('mistakes', m.id); draw(); } } }, ic('trash', { size: 18 }))))))));
  };
  // час самоперевірки рахується як практика (стрік, Resonance)
  const timer = activityTimer('mistakes');
  view.replaceChildren(body);
  draw();
  return () => { drillAbort?.abort(); timer.stop(); };
}

// ---------- Вправи на мої помилки ----------
let drillAbort = null;
/** Найчастіші невиправлені помилки: більше повторів і менший прогрес — першими */
export function topMistakes(n = 10) {
  return store.all('mistakes').filter(m => !m.resolved && m.wrong && m.right)
    .sort((a, b) => (b.count || 1) - (a.count || 1) || (a.streak || 0) - (b.streak || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, n);
}

const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Офлайн / без входу: вправи з самих помилок — вибір правильного варіанта, а для частини — вписати виправлення */
export function localDrill(list, count = 10) {
  const out = [];
  list.forEach((m, i) => out.push({ type: 'choice', instruction: 'Оберіть правильний варіант', prompt: 'Як правильно?', options: shuffle([m.right, m.wrong]), answer: m.right, explanation: m.explanation_uk || '', target: i }));
  for (let i = 0; out.length < count && i < list.length; i++) {
    const m = list[i];
    out.push({ type: 'input', instruction: 'Напишіть правильно', prompt: m.wrong, answer: [m.right], explanation: m.explanation_uk || '', target: i });
  }
  // спершу всі «вибери», потім «впиши» — друга вправа на ту саму помилку не йде одразу після першої
  return out;
}

async function drill(box, onExit, timer) {
  const list = topMistakes(10);
  if (!list.length) return;
  timer?.poke();
  const head = h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Назад', onclick: () => { drillAbort?.abort(); onExit(); } }, ic('arrow-left')), h('div.grow', h('div', { style: { fontWeight: 600 } }, 'Вправи на мої помилки'), h('div.xs.dim', `${list.length} ${plural(list.length, 'помилка', 'помилки', 'помилок')}, що повторюються найчастіше`)));
  const area = h('div.stack');
  box.replaceChildren(h('div.stack', head, area));
  let exercises = null, note = '';
  if (user() && navigator.onLine) {
    area.replaceChildren(h('div.hero', emo('hourglass', 'xl'), h('p.dim', 'Вчитель готує вправи на ваші помилки…')));
    drillAbort = new AbortController();
    try {
      const res = await tutor('mistake_drill', { count: 10, mistakes: list.map(m => ({ wrong: m.wrong, right: m.right, type: m.type, explanation_uk: m.explanation_uk || '' })) }, { signal: drillAbort.signal });
      exercises = (res.exercises || []).filter(e => Number.isInteger(e.target) && list[e.target]);
      if (exercises.length < Math.min(3, list.length)) { exercises = null; note = 'Вчитель не впорався — ось вправи з самих помилок.'; }
    } catch (e) {
      if (e?.name === 'AbortError' || !box.isConnected) return;
      note = `${aiErrorText(e) || 'AI недоступний.'} Ось вправи з самих помилок.`;
    } finally { drillAbort = null; }
  } else note = user() ? 'Немає мережі — вправи з самих помилок.' : 'Без входу — вправи з самих помилок. Після входу вчитель складе нові речення на ці правила.';
  if (!box.isConnected) return;
  if (!exercises) exercises = localDrill(list);
  const exBox = h('div');
  area.replaceChildren(note ? h('div.xs.dim', note) : '', exBox);
  runExercises(exBox, exercises, {
    onDone: (res) => {
      timer?.poke();
      // одна відповідь «зараховано / ні» на помилку за підхід: усі її вправи правильні → +1 до серії, інакше серія з нуля
      const byTarget = new Map();
      for (const r of res.results) { const t = r.ex.target; byTarget.set(t, (byTarget.get(t) ?? true) && r.ok); }
      let fixed = 0, better = 0;
      for (const [t, ok] of byTarget) {
        const m = store.get('mistakes', list[t]?.id);
        if (!m) continue;
        const was = m.resolved;
        mistakeHit(m, ok);
        if (ok) better++;
        if (m.resolved && !was) fixed++;
      }
      exBox.replaceChildren(h('div.stack', resultView(res),
        h('div.card.stack', { style: { gap: '4px' } },
          h('div', { style: { fontWeight: 600 } }, `Зараховано: ${better} з ${byTarget.size} ${plural(byTarget.size, 'помилки', 'помилок', 'помилок')}`),
          h('div.xs.dim', fixed ? `Виправлено остаточно: ${fixed} (3 правильні підходи поспіль).` : 'Помилка вважається виправленою після 3 правильних підходів поспіль.')),
        h('div.row', h('button.btn.soft.grow', { type: 'button', onclick: () => drill(box, onExit, timer) }, ic('arrow-clockwise', { size: 18 }), 'Ще раз'),
          h('button.btn.primary.grow', { type: 'button', onclick: onExit }, 'До списку'))));
      return false;
    },
  });
}

/** Офлайн-самоперевірка: бачу неправильний варіант → пишу правильний */
function selfCheck(box, items, onExit) {
  const list = items.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  if (!list.length) return;
  let i = 0, ok = 0;
  const step = () => {
    if (i >= list.length) {
      box.replaceChildren(h('div.hero', emo(ok === list.length ? 'trophy' : 'muscle', 'xl'), h('h2', `${ok} з ${list.length}`), h('button.btn.primary', { type: 'button', onclick: onExit }, 'До списку')));
      return;
    }
    const m = list[i];
    const inp = h('input.input', { type: 'text', placeholder: 'Як правильно?', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Правильний варіант' });
    const fb = h('div');
    const next = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: () => { i++; step(); } }, 'Далі');
    const check = h('button.btn.primary.block', { type: 'button', onclick: () => {
      if (!inp.value.trim()) return;
      const good = matches(inp.value, m.right);
      if (good) ok++;
      mistakeHit(m, good);
      fb.replaceChildren(h('div.feedback.' + (good ? 'ok' : 'no'), good ? `Правильно! Прогрес ${m.streak}/3${m.resolved ? ' — виправлено!' : ''}` : `Правильно: ${m.right}`, m.explanation_uk ? h('div.dim', m.explanation_uk) : null));
      check.hidden = true; next.hidden = false; next.focus();
    } }, 'Перевірити');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check.hidden ? next.click() : check.click(); } });
    box.replaceChildren(h('div.stack',
      h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Назад', onclick: onExit }, ic('arrow-left')), h('div.grow.xs.dim', `${i + 1}/${list.length} · ${S.mistakeTypes[m.type] || m.type}`)),
      h('div.card.stack', h('div.xs.dim', 'Виправте:'), h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, m.wrong)),
      inp, check, fb, next));
    inp.focus();
  };
  step();
}
