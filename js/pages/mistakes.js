// Помилки: мій список, групування за типом, самоперевірка, тренування групи
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { mistakesByType, mistakeHit, activityTimer } from '../stats.js';
import { matches } from '../ui/exercises.js';
import { confirmSheet } from '../ui/sheet.js';

const SRC = { tutor: 'вчитель', test: 'тест', exercise: 'вправа' };

export default function mistakes(view, r) {
  let showResolved = false;
  const body = h('div.stack-lg');
  const draw = () => {
    const groups = mistakesByType({ includeResolved: showResolved });
    const total = store.all('mistakes').filter(m => !m.resolved).length;
    const resolved = store.all('mistakes').filter(m => m.resolved).length;
    body.replaceChildren(
      h('section.card.stack',
        h('div.row', emo('target', 'lg'), h('div.grow', h('div', { style: { fontWeight: 600 } }, `${total} ${plural(total, 'помилка', 'помилки', 'помилок')} у роботі`), h('div.xs.dim', `Виправлено: ${resolved} · «виправлено» = 3 правильні застосування поспіль`))),
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
  view.replaceChildren(body);
  draw();
  // час самоперевірки рахується як практика (стрік, Resonance)
  const timer = activityTimer('mistakes');
  return () => timer.stop();
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
