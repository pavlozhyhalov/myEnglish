// Помилки: мій список, групування за правилом граматики (без правила — за типом), самоперевірка, тренування групи
import { h, ic, emo } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { mistakesByRule, activityTimer, classifyPending, disputeFix, dueRuleMistakes, dueRuleCount, rulePracticeToday, logRulePractice, nextRulePracticeAt, focusPracticeMistakes } from '../stats.js';
import { weeklyFocus, focusProgress, canSwap, swapRule, swapsLeft, nextCandidate, canAddRule, addFocusRule, closedEarlier, SWAPS_MAX } from '../focus.js';
import { ruleLabel } from '../rules.js';
import { matches, runExercises, resultView } from '../ui/exercises.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';

const SRC = { tutor: 'вчитель', test: 'тест', exercise: 'вправа', diary: 'щоденник', voice: 'голос', pronunciation: 'вимова' };

const DAY = 864e5;
/** Голосова розмова на власні помилки учня (тема для вчителя — англійською) */
export const TALK_HREF = '#/tutor?mode=voice&topic=' + encodeURIComponent('Work on the student\'s own mistakes: name 2 of their most frequent recent mistakes (wrong → right), then keep a natural conversation that makes them use the correct forms; notice when they get it right.');
const fmtDay = (iso) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** Засвоєння помилки: 3 крапки (правильні вживання поспіль) */
export function masteryDots(streakN, label = true) {
  const n = Math.max(0, Math.min(3, streakN || 0));
  return h('span.mk-dots', { role: 'img', 'aria-label': `Засвоєння: ${n} з 3` },
    label ? h('span', `Засвоєння: ${n}/3`) : null,
    h('span.mk-dots-row', { 'aria-hidden': 'true' }, [0, 1, 2].map(i => h('i' + (i < n ? '.on' : '')))));
}

export default function mistakes(view, r) {
  let tab = r?.query?.tab === 'closed' ? 'closed' : 'open';
  const body = h('div.stack-lg');
  const draw = () => {
    const all = store.all('mistakes');
    const openN = all.filter(m => !m.resolved).length;
    const closedList = all.filter(m => m.resolved).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const closed30 = closedList.filter(m => Date.now() - Date.parse(m.updated_at || 0) < 30 * DAY).length;
    // правила тижня (створюються, якщо їх ще немає) — головна дія сторінки; решта кнопок тоді вторинні
    let focus = null;
    try { focus = weeklyFocus(); } catch (e) { console.warn('focus', e); }
    const hasFocus = !!focus && tab === 'open';
    const tabBtn = (id, label, n) => h('button.chip', { type: 'button', 'aria-pressed': String(tab === id), onclick: () => { if (tab !== id) { tab = id; draw(); } } }, `${label} · ${n}`);
    const head = h('section.card.stack',
      h('div.row', emo('target', 'lg'),
        h('div.grow', h('div', { style: { fontWeight: 600 } }, `${openN} ${plural(openN, 'помилка', 'помилки', 'помилок')} у роботі`),
          h('div.xs.dim', `Усього закрито: ${closedList.length}`)),
        h('div.stat.mk-closed', { 'aria-label': `Закрито за 30 днів: ${closed30}` }, h('b', String(closed30)), h('span', 'закрито за 30 днів'))),
      h('p.mk-how', ic('info', { size: 18 }), h('span', 'Скажіть правильну форму в розмові з вчителем або у вправах 3 рази поспіль — помилку буде закрито.')),
      openN ? h('div.mk-actions',
        h(hasFocus ? 'button.btn.soft' : 'button.btn.primary', { type: 'button', onclick: () => drill(body, draw, timer) }, ic('barbell', { size: 18 }), 'Вправи на мої помилки'),
        h('a.btn.soft', { href: TALK_HREF }, ic('microphone', { size: 18 }), 'Потренувати в розмові')) : null,
      h('div.chips', { role: 'group', 'aria-label': 'Показати' }, tabBtn('open', 'Відкриті', openN), tabBtn('closed', 'Закриті', closedList.length)));
    const dueCard = tab === 'open' ? ruleDueCard() : null;

    if (tab === 'closed') {
      body.replaceChildren(head, closedList.length
        ? h('section.stack', { style: { gap: '8px' } },
          h('div.section-title', 'Закриті — від нових'),
          h('div.list', closedList.map(m => h('div.list-row', { style: { alignItems: 'flex-start' } },
            h('span.mk-done', ic('check-circle', { size: 20 })),
            h('div.grow.stack', { style: { gap: '2px' } },
              h('div', h('s.dim', m.wrong), ' → ', h('b.good', m.right)),
              h('div.xs.dim', `${S.mistakeTypes[m.type] || m.type} · ×${m.count || 1} · закрито ${m.updated_at ? fmtDay(m.updated_at) : ''}`)),
            delBtn(m)))))
        : h('div.empty', emo('sparkles', 'xl'), h('p', 'Закритих помилок поки немає. Коли ви 3 рази поспіль скажете правильно, помилка з\'явиться тут.')));
      return;
    }
    // групи — за правилом граматики (помилки без правила — за типом); засвоєння правила = найменша серія серед його помилок
    const groups = mistakesByRule();
    // правила тижня — першими й розгорнуто; решта — у згорнутому розділі «Інші правила»
    const fRules = focus?.rules || [];
    const focusGroups = groups.filter(g => g.rule && fRules.includes(g.rule)).sort((a, b) => fRules.indexOf(a.rule) - fRules.indexOf(b.rule));
    const otherGroups = groups.filter(g => !focusGroups.includes(g));
    const otherN = otherGroups.reduce((a, g) => a + g.items.length, 0);
    const others = focusGroups.length && otherGroups.length
      ? h('details.mk-others', { open: othersOpen, ontoggle: (e) => { othersOpen = e.currentTarget.open; } },
        h('summary', h('span.grow', h('span.mk-others-t', `Інші правила · ${otherGroups.length}`), h('span.xs.dim', `${otherN} ${plural(otherN, 'помилка', 'помилки', 'помилок')} чекають своєї черги`))),
        h('div.stack-lg.mk-others-body', otherGroups.map(g => groupView(g))))
      : null;
    body.replaceChildren(focus ? focusCard(focus) : '', head, dueCard || '',
      groups.length ? '' : h('div.empty', emo('sparkles', 'xl'), h('p', openN || !closedList.length ? 'Список порожній. Помилки з розмов, вправ і тестів з\'являтимуться тут.' : 'Відкритих помилок немає — усе закрито!')),
      ...(others ? [...focusGroups.map(g => groupView(g, true)), others] : groups.map(g => groupView(g))));
  };
  let othersOpen = false;
  /** Картка «Цього тижня — 3 правила»: прогрес, «Замінити» (до 2 разів на тиждень), тренування; усе закрито — «Взяти ще правило» */
  const focusCard = (f) => {
    const pr = focusProgress(f);
    if (!pr.length) return '';
    const won = pr.every(p => p.done);
    const swappable = canSwap(f);
    const earlier = closedEarlier(f);
    const swap = async (p) => {
      const nx = nextCandidate(f);
      if (!nx) return;
      const left = swapsLeft(f) - 1;
      if (!await confirmSheet('Замінити правило?', `«${p.label}» почекає наступного тижня, натомість — «${ruleLabel(nx.rule)}». ${left ? `Після цього лишиться ще ${left} ${plural(left, 'заміна', 'заміни', 'замін')}.` : 'Це остання заміна цього тижня.'}`, 'Замінити')) return;
      if (swapRule(p.rule)) { toast(`Нове правило тижня: ${ruleLabel(nx.rule)}`); draw(); }
    };
    return h('section.card.stack.wf.mk-focus' + (won ? '.wf-won' : ''), { 'aria-label': 'Правила тижня' },
      h('div.row', { style: { gap: '12px' } },
        h('span.wf-ico', ic(won ? 'trophy' : 'target', { size: 22, fill: won })),
        h('div.grow', h('div.mk-focus-t', won ? 'Усі правила тижня закрито!' : `Цього тижня — ${pr.length} ${plural(pr.length, 'правило', 'правила', 'правил')}`),
          h('div.xs.dim', won ? 'Чудова робота. Можна взяти ще одне правило — або відпочити до понеділка.' : 'Решта помилок чекає своєї черги.'))),
      h('ol.wf-rows', pr.map((p, i) => h('li.wf-row' + (p.done ? '.done' : ''),
        h('span.wf-mark', p.done ? ic('check', { size: 14 }) : h('b.num', String(i + 1))),
        h('div.grow.wf-body',
          h('div.wf-label', p.label),
          h('div.wf-meta', p.done ? h('span.wf-closed', 'закрито')
            : [h('span.wf-dots', { 'aria-hidden': 'true' }, [0, 1, 2].map(k => h('i' + (k < p.streakMin ? '.on' : '')))),
              h('span', `${p.openNow} ${plural(p.openNow, 'помилка', 'помилки', 'помилок')}${p.closedThisWeek ? ` · закрито ${p.closedThisWeek}` : ''}`)])),
        !p.done && swappable ? h('button.btn.sm.ghost.mk-swap', { type: 'button', 'aria-label': `Замінити правило: ${p.label}`, onclick: () => swap(p) }, ic('swap', { size: 16 }), 'Замінити') : null))),
      earlier.length ? h('div.xs.dim.wf-earlier', ic('check-circle', { size: 14 }), `Також закрито: ${earlier.map(x => x.label).join(', ')}`) : null,
      !won && (swappable || swapsLeft(f) < SWAPS_MAX) ? h('div.xs.dim', swapsLeft(f) ? `Правило можна замінити ще ${swapsLeft(f)} ${plural(swapsLeft(f), 'раз', 'рази', 'разів')} цього тижня.` : 'Замін цього тижня більше немає — нові правила в понеділок.') : null,
      won
        ? (canAddRule(f) ? h('button.btn.primary.block', { type: 'button', onclick: () => { if (addFocusRule()) { toast('Нове правило тижня — вчитель уже знає'); draw(); } } }, ic('plus', { size: 18 }), 'Взяти ще правило') : null)
        : h('a.btn.primary.block', { href: '#/mistakes?practice=due&focus=1' }, ic('barbell', { size: 18 }), 'Потренувати правила тижня'));
  };
  const groupView = (g, inFocus = false) => h('section.stack' + (inFocus ? '.mk-fgroup' : ''), { style: { gap: '8px' } },
        h('div.row.mk-ghead', h('div.grow.stack', { style: { gap: '2px' } },
            h('div.section-title', `${g.label || S.mistakeTypes[g.type] || g.type} · ${g.total}`),
            g.rule && g.items.length > 1 ? h('div.xs.dim.mk-rule', masteryDots(g.streak, false), h('span', `правило засвоєно на ${Math.min(3, g.streak)}/3`)) : null),
          h('button.btn.sm.soft', { type: 'button', onclick: () => selfCheck(body, g.items.filter(m => !m.resolved), draw) }, ic('check-circle', { size: 16 }), 'Перевірити себе'),
          h('a.btn.sm.primary', { href: `#/tutor?mode=drill&type=${g.type}` }, 'Потренувати')),
        h('div.list', g.items.sort((a, b) => (b.count || 1) - (a.count || 1)).map(m => h('div.list-row', { style: { alignItems: 'flex-start' } },
          h('div.grow.stack', { style: { gap: '2px' } },
            h('div', h('s.bad', m.wrong), ' → ', h('b.good', m.right)),
            m.explanation_uk ? h('div.xs.dim', m.explanation_uk) : null,
            h('div.row.xs.dim.mk-meta', h('span.grow', `×${m.count || 1} · ${SRC[m.source] || m.source || 'вчитель'}`), masteryDots(m.streak)),
            ['tutor', 'diary'].includes(m.source || 'tutor') ? h('button.btn.sm.ghost.disagree', { type: 'button', title: 'Вчитель помилився — більше так не виправлятиме', onclick: () => { disputeFix(m); draw(); } }, ic('x-circle', { size: 14 }), 'Не згоден') : null),
          delBtn(m)))));
  const delBtn = (m) => h('button.icon-btn', { type: 'button', 'aria-label': 'Видалити', onclick: async () => { if (await confirmSheet('Видалити помилку?', `${m.wrong} → ${m.right}`, 'Видалити', { danger: true })) { store.remove('mistakes', m.id); draw(); } } }, ic('trash', { size: 18 }));
  // час самоперевірки рахується як практика (стрік, Resonance)
  const timer = activityTimer('mistakes');
  view.replaceChildren(body);
  if (r?.query?.practice === 'due') {
    // повтор правил за розкладом (#/mistakes?practice=due): одразу вправи; «назад» — до списку без повторного запуску
    const toList = () => { try { history.replaceState(history.state, '', '#/mistakes'); } catch { /* */ } draw(); };
    if (r?.query?.focus === '1') focusDrill(body, toList, timer);
    else dueDrill(body, toList, timer);
  } else draw();
  // старі помилки без правила — розкласти за правилами (раз на сесію, після входу)
  if (user() && navigator.onLine) classifyPending().then(n => { if (n && body.isConnected) draw(); });
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

/**
 * Вправи на помилки. opts.list — свій набір (за замовчуванням найчастіші), opts.title/sub — заголовок,
 * opts.due — повтор правил за розкладом: результат веде далі за планом дня.
 */
async function drill(box, onExit, timer, opts = {}) {
  const list = opts.list || topMistakes(10);
  if (!list.length) return;
  timer?.poke();
  const head = h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Назад', onclick: () => { drillAbort?.abort(); onExit(); } }, ic('arrow-left')),
    h('div.grow', h('div', { style: { fontWeight: 600 } }, opts.title || 'Вправи на мої помилки'),
      h('div.xs.dim', opts.sub || `${list.length} ${plural(list.length, 'помилка', 'помилки', 'помилок')}, що повторюються найчастіше`)));
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
        logRulePractice(m, ok);
        if (ok) better++;
        if (m.resolved && !was) fixed++;
      }
      exBox.replaceChildren(h('div.stack', resultView(res),
        h('div.card.stack', { style: { gap: '4px' } },
          h('div', { style: { fontWeight: 600 } }, `Зараховано: ${better} з ${byTarget.size} ${plural(byTarget.size, 'помилки', 'помилок', 'помилок')}`),
          h('div.xs.dim', fixed ? `Виправлено остаточно: ${fixed} (3 правильні підходи поспіль).` : 'Помилка вважається виправленою після 3 правильних підходів поспіль.'),
          opts.due ? h('div.xs.dim', nextNote(byTarget.size, better)) : null),
        opts.focus ? focusResult() : null,
        opts.due
          ? h('div.stack', { style: { gap: '8px' } },
            h('a.btn.primary.lg.block', { href: '#/today' }, 'Далі за планом', ic('arrow-right', { size: 18 })),
            h('button.btn.soft.block', { type: 'button', onclick: onExit }, 'До списку помилок'))
          : h('div.row', h('button.btn.soft.grow', { type: 'button', onclick: () => (opts.again ? opts.again() : drill(box, onExit, timer)) }, ic('arrow-clockwise', { size: 18 }), 'Ще раз'),
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
      logRulePractice(m, good);
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

// ---------- Правила за розкладом ----------
/** Коли правило повернеться: помилка з правильною відповіддю — за 3–7 днів, з неправильною — завтра */
function nextNote(total, ok) {
  if (ok === total) return 'Ці правила повернуться на повтор через кілька днів — так вони закріпляться надовго.';
  if (!ok) return 'Ці правила повернуться вже завтра — повторення через день найкраще закріплює.';
  return 'Правила з помилками повернуться завтра, решта — через кілька днів.';
}
const fmtWhen = (t) => {
  const d = new Date(t), now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const hm = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `сьогодні о ${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return 'завтра';
  return d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
};

/** Картка на сторінці помилок: скільки правил чекає на повтор сьогодні */
function ruleDueCard() {
  const due = dueRuleCount(), done = rulePracticeToday();
  if (!due && !done) return null;
  return h('section.card.stack.mk-due', { 'aria-label': 'Повтор правил за розкладом' },
    h('div.row', h('span.tile-ico', ic('clock', { size: 22 })),
      h('div.grow', h('div.mk-due-t', due ? `Правила на повтор сьогодні: ${due}` : 'Правила на сьогодні повторено'),
        h('div.xs.dim', due ? 'Повертаємося до помилок через 1, 3 і 7 днів — так правило запам\'ятовується надовго.'
          : `Повторено сьогодні: ${done}. Наступні — ${fmtWhen(nextRulePracticeAt() || Date.now() + 864e5)}.`))),
    due ? h('a.btn.primary.block', { href: '#/mistakes?practice=due' }, ic('play', { size: 18, fill: true }), 'Повторити зараз') : null);
}

/** Повтор правил: набір із 8 помилок, яким настав час; порожньо — дружній екран */
function dueDrill(box, onExit, timer) {
  const list = dueRuleMistakes(8);
  if (!list.length) {
    const next = nextRulePracticeAt();
    const done = rulePracticeToday();
    box.replaceChildren(h('div.hero.mk-due-empty', emo('check', 'xl'), h('h2', 'На сьогодні правила повторено'),
      h('p.dim', done ? `Сьогодні ви повторили ${done} ${plural(done, 'помилку', 'помилки', 'помилок')}. ${next ? `Наступний повтор — ${fmtWhen(next)}.` : ''}`
        : next ? `Наступний повтор — ${fmtWhen(next)}. Нові помилки з розмов і вправ потраплять сюди самі.` : 'Відкритих помилок немає. Нові помилки з розмов і вправ потраплять сюди самі.'),
      h('div.stack', { style: { gap: '8px', width: '100%', maxWidth: '360px' } },
        h('a.btn.primary.block', { href: '#/today' }, 'Далі за планом', ic('arrow-right', { size: 18 })),
        h('button.btn.soft.block', { type: 'button', onclick: onExit }, 'До списку помилок'))));
    return;
  }
  const rules = new Set(list.map(m => m.rule && m.rule !== 'other' ? m.rule : `type:${m.type}`)).size;
  drill(box, onExit, timer, { list, due: true, title: 'Повтор правил',
    sub: `${list.length} ${plural(list.length, 'помилка', 'помилки', 'помилок')} · ${rules} ${plural(rules, 'правило', 'правила', 'правил')} за розкладом` });
}

// ---------- Правила тижня ----------
/** Тренування лише правил тижня (#/mistakes?practice=due&focus=1) */
function focusDrill(box, onExit, timer) {
  let f = null;
  try { f = weeklyFocus(); } catch { /* */ }
  if (!f) { dueDrill(box, onExit, timer); return; }
  const list = focusPracticeMistakes(8);
  if (!list.length) {
    const pr = focusProgress(f);
    const won = pr.length && pr.every(p => p.done);
    box.replaceChildren(h('div.hero.mk-due-empty', emo(won ? 'trophy' : 'check', 'xl'),
      h('h2', won ? 'Правила тижня закрито' : 'На сьогодні правила тижня відпрацьовано'),
      h('p.dim', won ? 'Усі помилки цих правил закрито. Можна взяти ще одне правило на сторінці «Мої помилки».'
        : 'Решту закріпите в розмові: вчитель створюватиме нагоди вжити ці правила. Повернімося до вправ завтра.'),
      h('div.stack', { style: { gap: '8px', width: '100%', maxWidth: '360px' } },
        h('a.btn.primary.block', { href: TALK_HREF }, ic('microphone', { size: 18 }), 'Потренувати в розмові'),
        h('button.btn.soft.block', { type: 'button', onclick: onExit }, 'До списку помилок'))));
    return;
  }
  const n = new Set(list.map(m => m.rule)).size;
  drill(box, onExit, timer, { list, focus: true, again: () => focusDrill(box, onExit, timer), title: 'Правила тижня',
    sub: `${list.length} ${plural(list.length, 'помилка', 'помилки', 'помилок')} · ${n} ${plural(n, 'правило', 'правила', 'правил')} тижня` });
}

/** Після вправ: де тепер кожне правило тижня (крапки засвоєння, закрито) */
function focusResult() {
  let pr = [];
  try { pr = focusProgress(weeklyFocus()); } catch { return null; }
  if (!pr.length) return null;
  return h('div.card.stack.wf', { style: { gap: '4px' } },
    h('div', { style: { fontWeight: 600 } }, 'Правила тижня зараз'),
    h('ol.wf-rows', pr.map((p, i) => h('li.wf-row' + (p.done ? '.done' : ''),
      h('span.wf-mark', p.done ? ic('check', { size: 14 }) : h('b.num', String(i + 1))),
      h('div.grow.wf-body', h('div.wf-label', p.label),
        h('div.wf-meta', p.done ? h('span.wf-closed', 'закрито')
          : [h('span.wf-dots', { 'aria-hidden': 'true' }, [0, 1, 2].map(k => h('i' + (k < p.streakMin ? '.on' : '')))),
            h('span', `${p.openNow} ${plural(p.openNow, 'помилка', 'помилки', 'помилок')} · засвоєння ${p.streakMin}/3`)]))))));
}
