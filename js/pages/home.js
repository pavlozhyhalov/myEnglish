// Головна в мові плиток: синя картка «Сьогодні» (кільце «Мого дня», кроки-плитки, одна головна кнопка),
// рівень, правила тижня, чотири завдання дня — лише головне (розвантажено за проханням власника 2026-11-07)
import { h, ic } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import { grammarIndex, scenarios as loadScenarios, listening as loadListening } from '../data.js';
import { todaySeconds, streak, mistakesByType, lessonsToReview, lessonDone, today, dayKey } from '../stats.js';
import { buildPlan, markStarted } from '../daily.js';
import { weeklyFocus, focusProgress, closedEarlier, canAddRule, addFocusRule, daysLeftInWeek } from '../focus.js';
import { planRing, startNext } from './today.js';
import { skel, skelCard, skelRow } from '../ui/skeleton.js';
import { toast } from '../ui/toast.js';
import { greetName } from './profile.js';
import { tx, txGrid, txGroup, txBar, txDots } from '../ui/tiles.js';
import { myLevel, LEVEL_NAME, nextLessonByLevel, byFit, diff, levelProgress, nextLevel, filterByLevel, pickOfDay } from '../level.js';

const nMistakes = (n) => `${n} ${plural(n, 'помилка', 'помилки', 'помилок')}`;

export default async function home(view) {
  // токен рендеру: швидкі перемикання рівня — показується лише останній рендер
  const tok = view.__tok = (view.__tok || 0) + 1;
  const lvl = myLevel();
  const st = store.settings();
  const prof = store.prof();
  const firstRun = !prof.placementDone && !prof.levelSource && store.count('sessions') === 0;
  // перший показ — одразу каркас зі скелетами (дані плану й колод дочитуються)
  if (!view.firstChild) view.replaceChildren(h('div.stack-lg.hm', greeting(), h('section.plan-hero.hm-hero', heroSkeleton()), skelCard({ rows: 1 }), skelCard({ rows: 2 })));
  const gIdx = await grammarIndex();
  if (view.__tok !== tok) return;

  const sec = todaySeconds();
  const blocks = [greeting()];

  // ---- «Сьогодні»: кільце «Мого дня», хвилини й стрік, кроки-плитки, одна головна кнопка ----
  const hero = h('section.plan-hero.hm-hero', { 'aria-label': 'Сьогодні' }, heroSkeleton());
  blocks.push(hero);
  const fillHero = (plan) => { if (view.__tok === tok) hero.replaceChildren(...heroContent(plan, sec, st)); };
  buildPlan().then(fillHero).catch(e => { console.warn('plan', e); hero.replaceChildren(...heroFallback(sec, st)); });

  if (firstRun) {
    blocks.push(h('section.tx-group',
      h('div.tx-label-row', h('h2.tx-label', 'Почніть тут'),
        h('button.tx-more.hm-skip', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити')),
      tx({ wide: true, icon: 'target', href: '#/tests/placement', label: 'Визначити мій рівень',
        sub: '≈ 25 хв · можна з паузою · план підлаштується під вас' })));
  }

  // ---- рівень: поточний → наступний, опанування, рівень у розмовах, швидка зміна ----
  blocks.push(levelGroup(view, gIdx, lvl));

  // ---- правила тижня: 3 правила замість усіх помилок одразу ----
  const wf = weekFocusGroup(view);
  if (wf) blocks.push(wf);
  else if (user() && !store.syncedOnce()) {
    // правила нового тижня обираються після першої синхронізації — тоді й показуємо групу
    const slot = document.createComment('week-focus');
    blocks.push(slot);
    // слот вставляється синхронно нижче; сторінку покинули або перемалювали — слухач більше не потрібен
    const off = store.on((t) => {
      if (!slot.isConnected) { off(); return; }
      if (t !== 'synced') return;
      off();
      const c = weekFocusGroup(view);
      if (c) slot.replaceWith(c);
    });
  }

  // ---- звіт за минулий місяць: перші 7 днів місяця, якщо тоді були заняття (модуль аналізу — лише тоді) ----
  const now = new Date();
  if (now.getDate() <= 7) {
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const pym = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;
    if (store.all('sessions').some(s => s.day?.startsWith(pym) && s.seconds > 0)) {
      const slot = document.createComment('month-report');
      blocks.push(slot);
      import('../analysis.js').then(({ MONTH_ACC }) => {
        if (!slot.parentNode) return;
        slot.replaceWith(tx({ wide: true, icon: 'calendar-blank', href: `#/report?m=${pym}`, cls: 'rp-link',
          label: `Ваш звіт за ${MONTH_ACC[pm.getMonth()]} готовий`, sub: 'Хвилини, рівень у розмовах, закриті помилки й ваш голос — тоді й зараз' }));
      }).catch(() => slot.remove());
    }
  }

  // ---- завдання рівня на сьогодні (з уроком дня) (змінюються щодня і зі зміною рівня) ----
  const tasksBox = h('section.tx-group', tasksHead(lvl), h('div.list', skelRow(), skelRow(), skelRow()));
  blocks.push(tasksBox);
  fillLevelTasks(tasksBox, lvl, lessonRow(gIdx)).catch(() => tasksBox.remove());

  // решта (тиждень, слово дня, останні розмови, швидкий старт) — у «Прогресі», меню й нижній панелі: головна лише про сьогодні

  if (view.__tok !== tok) return;
  view.replaceChildren(h('div.stack-lg.hm', blocks));
}

function greeting() {
  const date = new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  const name = greetName();
  const hour = new Date().getHours();
  return h('div.greet',
    h('span.date', date.charAt(0).toUpperCase() + date.slice(1)),
    h('h1', name ? `${S.greet(hour)}, ${name}` : S.greet(hour)));
}

function heroSkeleton() {
  return [
    h('div.row', h('div.grow.stack', { style: { gap: '8px' } }, skel({ w: '30%', ht: 12, cls: 'on-hero' }), skel({ w: '45%', ht: 28, cls: 'on-hero' }), skel({ w: '55%', ht: 12, cls: 'on-hero' })),
      skel({ w: '72px', ht: 72, r: '50%', cls: 'on-hero' })),
    h('div.hm-steps', [0, 1, 2].map(() => skel({ ht: 64, r: '13px', cls: 'on-hero' }))),
    skel({ ht: 48, r: '14px', cls: 'on-hero' }),
  ];
}

/** Вміст синьої картки «Сьогодні» */
function heroContent(plan, sec, st) {
  const pct = Math.round(plan.progress * 100);
  const mins = Math.round(sec / 60);
  const n = streak();
  // ще нічого не зроблено — показуємо мету дня, а не «0 хв» і «0%» (преміальний порожній стан, 2026-11-08)
  const fresh0 = mins === 0 && pct === 0 && !plan.allDone;
  const top = h('div.row.hm-top',
    h('div.grow.stack', { style: { gap: '4px' } },
      h('a.label.hm-label', { href: '#/today' }, 'Мій день', ic('caret-right', { size: 14 })),
      fresh0
        ? h('span.big', String(Math.round(plan.totalMin) || st.dailyGoal), h('small', ' хв — план на сьогодні'))
        : h('span.big', String(mins), h('small', ` з ${st.dailyGoal} хв`)),
      h('span.sub.hm-streak', ic('fire', { size: 14, fill: n > 0 }), n ? `${n} ${plural(n, 'день', 'дні', 'днів')} поспіль` : 'Перший день серії — сьогодні')),
    planRing(pct, { size: 72, stroke: 6, label: plan.allDone ? ic('check', { size: 26 }) : fresh0 ? ic('sun-horizon', { size: 26 }) : h('b.num.hm-pct', `${pct}%`), done: plan.allDone }));
  // кроки — маленькі плитки в ряд; кроки, недоступні без входу, не показуємо (вхід — одна кнопка нижче)
  const shown = plan.steps.filter(s => !s.skipped);
  const steps = shown.length < 2 ? null : h('div.hm-steps', { style: { gridTemplateColumns: `repeat(${shown.length},minmax(0,1fr))` } }, shown.map(s => {
    const state = s.done ? 'done' : s.skipped ? 'skipped' : s === plan.next ? 'next' : 'later';
    const meta = s.done ? 'готово' : s.skipped ? 'після входу' : `${s.id === 'voice' ? '5–7' : s.minutes} хв`;
    const part = !s.done && !s.skipped && s.progress > 0 ? Math.round(s.progress * 100) : 0;
    return h('a.hm-st.' + state, { href: s.href, onclick: s.skipped ? null : () => markStarted(), 'aria-label': `${s.title}: ${state === 'done' ? 'готово' : state === 'skipped' ? 'після входу' : state === 'next' ? `далі, ${meta}` : meta}`, 'aria-current': state === 'next' ? 'step' : null },
      h('span.hm-st-ico', ic(s.done ? 'check' : s.skipped ? 'user' : (s.icon || 'circle'), { size: 16, fill: state === 'next' && !s.done })),
      h('span.hm-st-t', s.title),
      h('span.hm-st-m', meta),
      part ? h('span.hm-st-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${part}%` } })) : null);
  }));
  let btn;
  if (plan.allDone) btn = h('a.btn.start.block.hm-start', { href: '#/today' }, ic('seal-check', { size: 20, fill: true }), 'Готово на сьогодні');
  else if (plan.next) {
    const fresh = !plan.started && !plan.steps.some(s => !s.skipped && s.progress > 0);
    btn = h('button.btn.start.block.hm-start', { type: 'button', onclick: () => startNext(plan) },
      ic(plan.next.icon === 'microphone' ? 'microphone' : 'play', { fill: true, size: 18 }), fresh ? `Почати день · ${Math.round(plan.totalMin)} хв` : `Продовжити: ${plan.next.title}`);
  } else btn = h('a.btn.start.block.hm-start', { href: '#/auth' }, 'Увійти, щоб поговорити з вчителем');
  const login = !user() && plan.steps.some(s => s.skipped) && !plan.allDone && plan.next
    ? h('a.hm-login', { href: '#/auth' }, ic('key', { size: 14 }), 'Увійдіть — і вчитель додасть розмову голосом') : null;
  return [top, steps, btn, login].filter(Boolean);
}

/** Запасний вміст (план не вдалося обчислити): хвилини й посилання на «Мій день» */
function heroFallback(sec, st) {
  return [h('div.stack', { style: { gap: '4px' } }, h('span.label', 'Сьогодні'), h('span.big', String(Math.round(sec / 60)), h('small', ` / ${st.dailyGoal} хв`))),
    h('a.btn.start.block.hm-start', { href: '#/today' }, ic('play', { fill: true, size: 18 }), 'Мій день')];
}


/** Рівень: плитка «B1 → B2» з опануванням, рівень у розмовах, швидка зміна рівня (згорнута) */
function levelGroup(view, gIdx, lvl) {
  const nxt = nextLevel();
  const lpInfo = h('span.tx-s', ' ');
  const lpPct = h('span.num.hm-level-pct', '—');
  const lpBar = txBar(0, true);
  lpBar.setAttribute('role', 'progressbar');
  lpBar.removeAttribute('aria-label');
  Object.entries({ 'aria-label': 'Опанування рівня', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }).forEach(([k, v]) => lpBar.setAttribute(k, String(v)));
  const ready = h('span.hm-ready', { hidden: true });
  const convInfo = h('span');
  levelProgress(gIdx, lvl).then(lp => {
    lpInfo.textContent = `Уроки ${lp.grammar.done}/${lp.grammar.total} · слова ${lp.words.done}/${lp.words.total}`;
    lpPct.textContent = `${lp.pct}%`;
    lpBar.firstChild.style.width = `${lp.pct}%`;
    lpBar.setAttribute('aria-valuenow', String(lp.pct));
    if (lp.ready) { ready.textContent = `Ви майже опанували ${lvl} — час переходити на ${nxt}`; ready.hidden = false; }
  }).catch(e => console.warn('level', e));
  // рівень у розмовах — лише коли є ≥2 оцінені розмови (модуль аналізу вантажиться окремо)
  import('../analysis.js').then(({ conversationLevel }) => {
    const cl = conversationLevel();
    if (!cl || cl.sessions < 2) return;
    const sub = cl.sublevel === 'high' ? '+' : cl.sublevel === 'low' ? '−' : '';
    convInfo.textContent = ` · у розмовах ${cl.level}${sub}`;
  }).catch(() => {});
  const levelTile = tx({ wide: true, href: '#/progress', cls: 'hm-level',
    icon: null, label: lvl !== nxt ? `Рівень ${lvl} → ${nxt}` : `Рівень ${lvl}`, sub: LEVEL_NAME[lvl],
    extra: h('span.hm-level-extra', lpBar, h('span.tx-s', lpInfo, convInfo), ready), end: lpPct });
  levelTile.prepend(h('span.tx-sq.hm-level-badge', { 'aria-hidden': 'true' }, lvl));
  // зміна рівня — у «Налаштуваннях» і тестом; тут лише поточний стан
  return levelTile;
}

/** Перенос довгих назв правил після «/» (am/is/are/was/were), а не посеред слова */
const soft = (t) => String(t).replace(/\//g, '/\u200b');

/** «Правила тижня»: до 3 правил з найбільшою вагою помилок — рядки з крапками засвоєння; усе закрито — свято й «Взяти ще правило» */
function weekFocusGroup(view) {
  let f = null, pr = [];
  try { f = weeklyFocus(); pr = f ? focusProgress(f) : []; } catch (e) { console.warn('focus', e); return null; }
  if (!f || !pr.length) return null;
  const doneN = pr.filter(p => p.done).length;
  const won = doneN === pr.length;
  const earlier = closedEarlier(f);
  const left = daysLeftInWeek();
  // плитки як у меню: по 3 в ряд — правило, кількість помилок, крапки засвоєння
  const rows = txGrid(pr.map((p, i) => tx(p.done
    ? { icon: 'check', tone: 'good', cls: 'hm-wf-tile', label: soft(p.label), sub: p.closedThisWeek ? `закрито · ${nMistakes(p.closedThisWeek)}` : 'закрито',
      href: '#/mistakes', attrs: { 'aria-label': `Правило ${i + 1}: ${p.label}, закрито` } }
    : { icon: 'target', cls: 'hm-wf-tile', label: soft(p.label), sub: `${nMistakes(p.openNow)}${p.closedThisWeek ? ` · закрито ${p.closedThisWeek}` : ''}`,
      extra: h('span.hm-dots', h('span.sr-only', 'засвоєння '), txDots(p.streakMin, 3)),
      href: '#/mistakes?practice=due&focus=1', attrs: { 'aria-label': `Правило ${i + 1}: ${p.label}, ${nMistakes(p.openNow)}, засвоєння ${p.streakMin} з 3` } })));
  const more = canAddRule(f);
  const content = [
    won
      ? tx({ wide: true, tone: 'good', icon: 'trophy', label: 'Правила тижня закрито', sub: 'Чудова робота! Усі правила закрито ще до кінця тижня.', cls: 'hm-static' })
      : h('p.hm-note', `${left === 1 ? 'Останній день тижня' : `Ще ${left} ${plural(left, 'день', 'дні', 'днів')}`} · закрито ${doneN} з ${pr.length}`),
    rows,
    earlier.length ? h('p.hm-note.hm-earlier', ic('check-circle', { size: 14 }), `Також закрито: ${earlier.map(x => x.label).join(', ')}`) : null,
    won
      ? (more ? tx({ wide: true, icon: 'plus', label: 'Взяти ще правило', onclick: () => { if (addFocusRule()) { toast('Нове правило тижня — вчитель уже знає'); home(view); } } }) : null)
      : null,
  ];
  const g = txGroup(won ? 'Правила тижня · закрито' : 'Правила тижня', content, { label: 'Усі помилки', href: '#/mistakes' });
  g.setAttribute('aria-label', 'Правила тижня');
  g.classList.add('hm-wf');
  return g;
}

/** Урок дня (як у старому плані): зарахований сьогодні — показуємо його з позначкою; інакше наступний за рівнем */
function lessonRow(gIdx) {
  const todayK = today();
  const passedToday = store.all('lessons_progress').filter(p => p.updated_at && dayKey(p.updated_at) === todayK && (p.last_score ?? 0) >= 80)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const passedMeta = passedToday && gIdx.find(l => l.id === passedToday.id);
  if (passedMeta) return { icon: 'puzzle-piece', kind: 'Урок дня · зараховано', title: passedMeta.title, href: `#/grammar/${passedMeta.id}`, done: true };
  const l = pickLesson(gIdx);
  return l ? { icon: 'puzzle-piece', kind: l.review ? 'Повторити урок' : 'Урок дня · граматика', title: l.title, href: `#/grammar/${l.id}` } : null;
}

const tasksHead = (lvl) => h('div.tx-label-row', h('h2.tx-label', `Завдання рівня ${lvl} на сьогодні`), h('span.hm-more-dim', 'нові щодня'));

async function fillLevelTasks(box, lvl, lesson) {
  const [scen, lis, rdMod] = await Promise.all([loadScenarios(), loadListening(), import('./reading.js')]);
  const rd = rdMod.textOfDay(await rdMod.readingTexts());
  const sc = pickOfDay(filterByLevel(scen.filter(x => x.group !== 'work'), 'mine').items, 'scen');
  const dl = pickOfDay(filterByLevel(lis.dialogues, 'mine').items, 'dialogue');
  // плитки як у меню: по дві в ряд, тип завдання — підписом, виконане — зелене
  const task = (icon, kind, title, href, done = false) => tx({ icon: done ? 'check' : icon, label: title, sub: done ? `${kind} · готово` : kind, href, tone: done ? 'good' : null, cls: 'hm-task' });
  const rows = [
    lesson && task(lesson.icon, lesson.kind, lesson.title, lesson.href, lesson.done),
    sc && task('users-three', 'Розмова із вчителем', sc.title, `#/scenarios/${sc.id}`),
    dl && task('headphones', 'Аудіювання', dl.title, `#/listening?tab=dialogues&d=${encodeURIComponent(dl.title)}`),
    rd && task('book-open', 'Читання', rd.title, `#/reading/${rd.id}`),
  ].filter(Boolean).slice(0, 4);   // головна — лише чотири завдання; решта — у розділах
  if (!rows.length) { box.remove(); return; }
  const grid = txGrid(rows, 2);
  if (rows.length % 2) rows[rows.length - 1].classList.add('full', 'wide');
  box.replaceChildren(tasksHead(lvl), grid);
}

function pickLesson(idx) {
  const rev = lessonsToReview()[0];
  if (rev) { const l = idx.find(x => x.id === rev.id); if (l) return { ...l, review: true }; }
  // слабке місце — урок відповідного типу
  const weak = mistakesByType()[0];
  if (weak && weak.total >= 5 && weak.type !== 'other') {
    const l = byFit(idx.filter(x => x.mistakeType === weak.type && !lessonDone(x.id) && diff(x.level) <= 1))[0];
    if (l) return l;
  }
  return nextLessonByLevel(idx);
}


