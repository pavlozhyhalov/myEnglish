// Помилки: мій список, групування за правилом граматики (без правила — за типом), самоперевірка, тренування групи
import { h, ic } from '../ui/dom.js';
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
import { tx, txPrimary, txKpis, txGrid, txGroup, txRows, txRow, txDots, txPill, txResult } from '../ui/tiles.js';

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
    h('span.tx-dots', { 'aria-hidden': 'true' }, [0, 1, 2].map(i => h('i' + (i < n ? '.on' : '')))));
}

const nMist = (n) => `${n} ${plural(n, 'помилка', 'помилки', 'помилок')}`;

export default function mistakes(view, r) {
  let tab = r?.query?.tab === 'closed' ? 'closed' : 'open';
  const body = h('div.stack-lg.mk-page');
  const draw = () => {
    const all = store.all('mistakes');
    const openN = all.filter(m => !m.resolved).length;
    const closedList = all.filter(m => m.resolved).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const closed30 = closedList.filter(m => Date.now() - Date.parse(m.updated_at || 0) < 30 * DAY).length;
    const due = dueRuleCount(), doneToday = rulePracticeToday();
    // правила тижня (створюються, якщо їх ще немає) — головна дія сторінки; решта дій тоді вторинні
    let focus = null;
    try { focus = weeklyFocus(); } catch (e) { console.warn('focus', e); }
    const fp = focus && tab === 'open' ? focusProgress(focus) : [];
    const won = fp.length > 0 && fp.every(p => p.done);

    // показники: у роботі · закрито за 30 днів · на повтор сьогодні
    const kpis = txKpis([
      { value: openN, label: 'у роботі', tone: openN ? 'bad' : '', ariaLabel: `${nMist(openN)} у роботі` },
      { value: closed30, label: 'закрито за 30 днів', tone: closed30 ? 'good' : '', ariaLabel: `Закрито за 30 днів: ${closed30}` },
      { value: due, label: due ? 'на повтор сьогодні' : doneToday ? `повторено сьогодні: ${doneToday}` : 'на повтор сьогодні', tone: due ? 'warn' : '', ariaLabel: `Правил на повтор сьогодні: ${due}` },
    ]);

    // дії: одна головна (синя) — правила тижня → повтор за розкладом → вправи; решта — звичайні плитки
    const acts = {
      drill: openN ? { icon: 'barbell', label: 'Вправи на мої помилки', sub: `${Math.min(10, openN)} найчастіших`, onclick: () => drill(body, draw, timer) } : null,
      talk: openN ? { icon: 'microphone', label: 'Потренувати в розмові', sub: 'з вчителем голосом', href: TALK_HREF } : null,
      due: due ? { icon: 'clock', label: 'Повторити правила', sub: `${due} на повтор сьогодні`, href: '#/mistakes?practice=due', attrs: { 'aria-label': `Повтор правил за розкладом: ${due} сьогодні` } }
        : doneToday ? { icon: 'check-circle', tone: 'good', label: 'Правила повторено', sub: `наступні — ${fmtWhen(nextRulePracticeAt() || Date.now() + DAY)}`, attrs: { 'aria-label': `Правила на сьогодні повторено: ${doneToday}` } } : null,
    };
    let primary = null;
    if (fp.length && !won) primary = txPrimary({ icon: 'target', label: 'Потренувати правила тижня', sub: `${fp.filter(p => !p.done).length} ${plural(fp.filter(p => !p.done).length, 'правило', 'правила', 'правил')} · вправи на ваші помилки`, href: '#/mistakes?practice=due&focus=1' });
    else if (won && canAddRule(focus)) primary = txPrimary({ icon: 'plus', label: 'Взяти ще правило', sub: 'усі правила тижня закрито', onclick: () => { if (addFocusRule()) { toast('Нове правило тижня — вчитель уже знає'); draw(); } } });
    else if (acts.due?.href) { primary = txPrimary({ ...acts.due, label: 'Повторити правила зараз' }); acts.due = null; }
    else if (acts.drill) { primary = txPrimary(acts.drill); acts.drill = null; }
    const secondary = [acts.drill, acts.talk, acts.due].filter(Boolean).map(o => tx(o));
    // непарна остання плитка — на всю ширину, горизонтально (як неповний ряд у меню)
    if (secondary.length % 2) secondary[secondary.length - 1].classList.add('full', 'wide');

    const tabBtn = (id, label, n) => h('button.chip', { type: 'button', 'aria-pressed': String(tab === id), onclick: () => { if (tab !== id) { tab = id; draw(); } } }, `${label} · ${n}`);
    const head = [kpis, primary,
      secondary.length ? txGrid(secondary, 2) : null,
      h('p.mk-how', ic('info', { size: 18 }), h('span', 'Скажіть правильну форму в розмові з вчителем або у вправах 3 рази поспіль — помилку буде закрито.',
        due || doneToday ? ' Правила повертаються на повтор через 1, 3 і 7 днів — так вони запам\'ятовуються надовго.' : '')),
      h('div.chips', { role: 'group', 'aria-label': 'Показати' }, tabBtn('open', 'Відкриті', openN), tabBtn('closed', 'Закриті', closedList.length))].filter(Boolean);

    if (tab === 'closed') {
      body.replaceChildren(...head, closedList.length
        ? txGroup('Закриті — від нових', txRows(closedList.map(m => h('div.tx-row.mk-item',
          h('span.tx-sq.mk-ok', ic('check-circle', { size: 18 })),
          h('div.tx-body.mk-body',
            h('div.mk-fix', h('s.dim', m.wrong), ' → ', h('b.good', m.right)),
            h('div.tx-s', `${S.mistakeTypes[m.type] || m.type} · ×${m.count || 1} · закрито ${m.updated_at ? fmtDay(m.updated_at) : ''}`)),
          delBtn(m)))))
        : txResult({ icon: 'seal-check', label: 'Закриті', title: 'Закритих помилок поки немає', sub: 'Коли ви 3 рази поспіль скажете правильно, помилка з\'явиться тут.' }));
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
        h('summary', h('span.tx-sq', ic('books', { size: 18 })), h('span.grow', h('span.mk-others-t', `Інші правила · ${otherGroups.length}`), h('span.xs.dim', `${nMist(otherN)} чекають своєї черги`))),
        h('div.stack-lg.mk-others-body', otherGroups.map(g => groupView(g))))
      : null;
    body.replaceChildren(...head, focus ? focusView(focus, fp, won) : '',
      groups.length ? '' : (openN || !closedList.length
        ? txResult({ icon: 'warning-circle', label: 'Мої помилки', title: 'Список порожній', sub: 'Помилки з розмов, вправ і тестів з\'являтимуться тут.' })
        : txResult({ icon: 'seal-check', tone: 'good', label: 'Мої помилки', title: 'Відкритих помилок немає — усе закрито!' })),
      ...(others ? [...focusGroups.map(g => groupView(g, true)), others] : groups.map(g => groupView(g))));
  };
  let othersOpen = false;
  /** «Правила тижня»: плитка на правило — помилки, «крапки» засвоєння, «Замінити» (до 2 разів на тиждень) */
  const focusView = (f, pr, won) => {
    if (!pr.length) return '';
    const swappable = canSwap(f);
    const earlier = closedEarlier(f);
    const swap = async (p) => {
      const nx = nextCandidate(f);
      if (!nx) return;
      const left = swapsLeft(f) - 1;
      if (!await confirmSheet('Замінити правило?', `«${p.label}» почекає наступного тижня, натомість — «${ruleLabel(nx.rule)}». ${left ? `Після цього лишиться ще ${left} ${plural(left, 'заміна', 'заміни', 'замін')}.` : 'Це остання заміна цього тижня.'}`, 'Замінити')) return;
      if (swapRule(p.rule)) { toast(`Нове правило тижня: ${ruleLabel(nx.rule)}`); draw(); }
    };
    const tiles = pr.map(p => {
      const t = tx({ icon: p.done ? 'check-circle' : 'brain', tone: p.done ? 'good' : '', cls: 'mk-rule-t', label: p.label,
        sub: p.done ? 'закрито' : `${nMist(p.openNow)}${p.closedThisWeek ? ` · закрито ${p.closedThisWeek}` : ''}`,
        extra: p.done ? null : txDots(p.streakMin) });
      if (!p.done && swappable) t.append(h('button.icon-btn.mk-swap', { type: 'button', title: 'Замінити', 'aria-label': `Замінити правило: ${p.label}`, onclick: () => swap(p) }, ic('swap', { size: 16 })));
      return t;
    });
    if (tiles.length % 2) tiles[tiles.length - 1].classList.add('full');
    const g = txGroup(won ? 'Правила тижня · усе закрито' : `Правила тижня · ${pr.length}`, [
      won ? h('p.mk-won', ic('trophy', { size: 18 }), h('span', 'Усі правила тижня закрито! Можна взяти ще одне правило — або відпочити до понеділка.')) : null,
      txGrid(tiles, 2),
      earlier.length ? h('div.xs.dim.wf-earlier', ic('check-circle', { size: 14 }), `Також закрито: ${earlier.map(x => x.label).join(', ')}`) : null,
      !won && (swappable || swapsLeft(f) < SWAPS_MAX) ? h('div.xs.dim.mk-note', swapsLeft(f) ? `Правило можна замінити ще ${swapsLeft(f)} ${plural(swapsLeft(f), 'раз', 'рази', 'разів')} цього тижня.` : 'Замін цього тижня більше немає — нові правила в понеділок.') : null]);
    g.classList.add('mk-focus');
    g.setAttribute('aria-label', 'Правила тижня');
    return g;
  };
  /** Група помилок одного правила: плитка правила (засвоєння), дії, рядки помилок */
  const groupView = (g, inFocus = false) => { const sec = txGroup(`${g.label || S.mistakeTypes[g.type] || g.type} · ${g.total}`, [
    g.rule && g.items.length > 1 ? h('div.xs.dim.mk-rule', masteryDots(g.streak, false), h('span', `правило засвоєно на ${Math.min(3, g.streak)}/3`)) : null,
    h('div.mk-gacts',
      h('button.tx-row.mk-gact', { type: 'button', onclick: () => selfCheck(body, g.items.filter(m => !m.resolved), draw) }, h('span.tx-sq', ic('check-circle', { size: 18 })), h('span.tx-l', 'Перевірити себе')),
      h('a.tx-row.mk-gact', { href: `#/tutor?mode=drill&type=${g.type}` }, h('span.tx-sq', ic('barbell', { size: 18 })), h('span.tx-l', 'Потренувати'))),
    txRows(g.items.sort((a, b) => (b.count || 1) - (a.count || 1)).map(m => h('div.tx-row.mk-item',
      h('span.tx-no', `×${m.count || 1}`),
      h('div.tx-body.mk-body',
        h('div.mk-fix', h('s.bad', m.wrong), ' → ', h('b.good', m.right)),
        m.explanation_uk ? h('div.tx-s', m.explanation_uk) : null,
        h('div.row.xs.dim.mk-meta', h('span.grow', SRC[m.source] || m.source || 'вчитель'), masteryDots(m.streak)),
        ['tutor', 'diary'].includes(m.source || 'tutor') ? h('button.btn.sm.ghost.disagree', { type: 'button', title: 'Вчитель помилився — більше так не виправлятиме', onclick: () => { disputeFix(m); draw(); } }, ic('x-circle', { size: 14 }), 'Не згоден') : null),
      delBtn(m))))]);
    sec.classList.add('mk-group'); if (inFocus) sec.classList.add('mk-fgroup');
    return sec; };
  const delBtn = (m) => h('button.icon-btn.mk-del', { type: 'button', 'aria-label': 'Видалити', onclick: async () => { if (await confirmSheet('Видалити помилку?', `${m.wrong} → ${m.right}`, 'Видалити', { danger: true })) { store.remove('mistakes', m.id); draw(); } } }, ic('trash', { size: 18 }));
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
  const title = opts.title === 'Повтор правил' ? 'Правила за розкладом' : (opts.title || 'Вправи на мої помилки');
  const head = h('div.gx-lhead.mk-dhead', h('button.icon-btn', { type: 'button', 'aria-label': 'Назад', onclick: () => { drillAbort?.abort(); onExit(); } }, ic('arrow-left')),
    h('div.grow', h('div.tx-label.gx-eyebrow', 'Повтор правил'), h('h2.gx-lh1', title),
      h('div.tx-s', opts.sub || `${list.length} ${plural(list.length, 'помилка', 'помилки', 'помилок')}, що повторюються найчастіше`)));
  const area = h('div.stack');
  box.replaceChildren(h('div.stack', head, area));
  let exercises = null, note = '';
  if (user() && navigator.onLine) {
    area.replaceChildren(txResult({ icon: 'hourglass', tone: 'accent', role: 'status', label: 'Вчитель', title: 'Готую вправи на ваші помилки…', sub: 'Нові речення на ці правила — до пів хвилини.' }));
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
      const size = byTarget.size;
      const again = () => (opts.again ? opts.again() : drill(box, onExit, timer));
      exBox.replaceChildren(h('div.stack-lg', resultView(res),
        txGroup('Мої помилки', [
          txKpis([
            { value: better, unit: `/${size}`, label: 'зараховано', tone: better === size ? 'good' : better ? '' : 'warn', ariaLabel: `Зараховано: ${better} з ${size} ${plural(size, 'помилки', 'помилок', 'помилок')}` },
            { value: fixed, label: 'виправлено остаточно', tone: fixed ? 'good' : '' },
          ], 2),
          h('p.mk-note.tx-s', fixed ? `Виправлено остаточно: ${fixed} (3 правильні підходи поспіль).` : 'Помилка вважається виправленою після 3 правильних підходів поспіль.',
            opts.due ? ' ' + nextNote(size, better) : '')]),
        opts.focus ? focusResult() : null,
        opts.due
          ? h('div.stack', txPrimary({ icon: 'arrow-right', label: 'Далі за планом', sub: 'наступний крок «Мого дня»', href: '#/today' }),
            txRows([txRow({ icon: 'list', label: 'До списку помилок', onclick: onExit })]))
          : h('div.stack', txPrimary({ icon: 'list', label: 'До списку помилок', onclick: onExit }),
            txRows([txRow({ icon: 'arrow-clockwise', label: 'Ще раз', sub: 'нові вправи на ці помилки', onclick: again })]))));
      return false;
    },
  });
}

/** Офлайн-самоперевірка: бачу неправильний варіант → пишу правильний */
function selfCheck(box, items, onExit) {
  const list = items.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  if (!list.length) return;
  let i = 0, ok = 0, fixed = 0;
  const step = () => {
    if (i >= list.length) {
      const n = list.length, all = ok === n, tone = all ? 'good' : ok * 2 >= n ? 'warn' : 'bad';
      box.replaceChildren(h('div.stack-lg.mk-selfres',
        txResult({ icon: all ? 'trophy' : ok * 2 >= n ? 'thumbs-up' : 'barbell', tone, label: 'Перевірити себе', title: `${ok} з ${n}`,
          sub: all ? 'Усе правильно — серії цих помилок зросли.' : 'Помилки з неправильною відповіддю повернуться на повтор завтра.' }),
        txKpis([
          { value: ok, unit: `/${n}`, label: 'правильно', tone: all ? 'good' : '', ariaLabel: `${ok} з ${n} правильно` },
          { value: n - ok, label: plural(n - ok, 'помилка', 'помилки', 'помилок'), tone: n - ok ? 'bad' : 'good' },
          { value: fixed, label: 'виправлено остаточно', tone: fixed ? 'good' : '' },
        ]),
        txPrimary({ icon: 'list', label: 'До списку помилок', onclick: onExit }),
        txRows([txRow({ icon: 'arrow-clockwise', label: 'Ще раз', sub: 'інші помилки в іншому порядку', onclick: () => selfCheck(box, items, onExit) })])));
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
      const was = m.resolved;
      logRulePractice(m, good);
      if (m.resolved && !was) fixed++;
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

/** Повтор правил: набір із 8 помилок, яким настав час; порожньо — дружній екран */
function dueDrill(box, onExit, timer) {
  const list = dueRuleMistakes(8);
  if (!list.length) {
    const next = nextRulePracticeAt();
    const done = rulePracticeToday();
    const open = store.all('mistakes').filter(m => !m.deleted && !m.resolved).length;
    box.replaceChildren(h('div.stack-lg.mk-due-empty',
      txResult({ icon: 'check-circle', tone: 'good', label: 'Повтор правил', title: 'На сьогодні правила повторено',
        sub: done ? `Сьогодні ви повторили ${done} ${plural(done, 'помилку', 'помилки', 'помилок')}.${next ? ` Наступний повтор — ${fmtWhen(next)}.` : ''}`
          : next ? `Наступний повтор — ${fmtWhen(next)}. Нові помилки з розмов і вправ потраплять сюди самі.` : 'Відкритих помилок немає. Нові помилки з розмов і вправ потраплять сюди самі.' }),
      txKpis([
        { value: done, label: 'повторено сьогодні', tone: done ? 'good' : '' },
        { value: open, label: plural(open, 'відкрита помилка', 'відкриті помилки', 'відкритих помилок') },
      ], 2),
      txPrimary({ icon: 'arrow-right', label: 'Далі за планом', sub: 'наступний крок «Мого дня»', href: '#/today' }),
      txRows([txRow({ icon: 'list', label: 'До списку помилок', onclick: onExit })])));
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
    box.replaceChildren(h('div.stack-lg.mk-due-empty',
      txResult({ icon: won ? 'trophy' : 'check-circle', tone: 'good', label: 'Правила тижня',
        title: won ? 'Правила тижня закрито' : 'На сьогодні правила тижня відпрацьовано',
        sub: won ? 'Усі помилки цих правил закрито. Можна взяти ще одне правило на сторінці «Мої помилки».'
          : 'Решту закріпите в розмові: вчитель створюватиме нагоди вжити ці правила. Повернімося до вправ завтра.' }),
      focusResult(),
      txPrimary({ icon: 'microphone', label: 'Потренувати в розмові', sub: 'вчитель створить нагоди вжити ці правила', href: TALK_HREF }),
      txRows([txRow({ icon: 'list', label: 'До списку помилок', onclick: onExit })])));
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
  return txGroup('Правила тижня зараз', txRows(pr.map((p, i) => txRow({
    no: p.done ? null : i + 1, icon: p.done ? 'check' : null, on: p.done, label: p.label, cls: 'mk-wf',
    sub: p.done ? null : `${p.openNow} ${plural(p.openNow, 'помилка', 'помилки', 'помилок')} · засвоєння ${p.streakMin}/3`,
    end: p.done ? txPill('закрито', 'good') : txDots(p.streakMin),
  }))));
}
