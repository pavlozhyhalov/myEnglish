// Головна в мові плиток: синя картка «Сьогодні» (кільце «Мого дня», кроки-плитки, одна головна кнопка),
// показники, рівень, правила тижня, завдання рівня, швидкий старт, тиждень, слово дня, слабкі місця, остання розмова
import { h, ic, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import * as srs from '../srs.js';
import { withCards, grammarIndex, scenarios as loadScenarios, writingTasks, listening as loadListening, pronunciation as loadPron } from '../data.js';
import { todaySeconds, streak, week, mistakesByType, lessonsToReview, lessonDone, today, dayKey, dueRuleCount } from '../stats.js';
import { buildPlan, markStarted } from '../daily.js';
import { weeklyFocus, currentFocus, focusProgress, closedEarlier, canAddRule, addFocusRule, daysLeftInWeek } from '../focus.js';
import { planRing, startNext } from './today.js';
import { skel, skelCard, skelRow } from '../ui/skeleton.js';
import { speak } from '../speech.js';
import { toast } from '../ui/toast.js';
import { greetName } from './profile.js';
import { tx, txKpis, txGrid, txGroup, txRow, txRows, txBar, txDots } from '../ui/tiles.js';
import { myLevel, LEVEL_NAME, LEVELS, nextLessonByLevel, byFit, diff, levelProgress, nextLevel, setLevel, filterByLevel, pickOfDay } from '../level.js';

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
  const [gIdx, deckState] = await Promise.all([grammarIndex(), srs.decks()]);
  // увімкнені вбудовані колоди (метадані з каталогу, без карток)
  const decks = deckState.filter(d => d.builtin && d.enabled);
  if (view.__tok !== tok) return;

  const sec = todaySeconds();
  const blocks = [greeting()];

  // ---- «Сьогодні»: кільце «Мого дня», хвилини й стрік, кроки-плитки, одна головна кнопка ----
  const hero = h('section.plan-hero.hm-hero', { 'aria-label': 'Сьогодні' }, heroSkeleton());
  blocks.push(hero);
  const fillHero = (plan) => { if (view.__tok === tok) hero.replaceChildren(...heroContent(plan, sec, st)); };
  buildPlan().then(fillHero).catch(e => { console.warn('plan', e); hero.replaceChildren(...heroFallback(sec, st)); });

  if (firstRun) {
    blocks.push(txGroup('Почніть тут', [
      tx({ wide: true, icon: 'target', href: '#/tests/placement', label: 'Визначити мій рівень',
        sub: 'Адаптивний тест ~25 хвилин: граматика, лексика, читання, аудіювання, письмо і коротка розмова. Можна зробити паузу. Після нього план дня підлаштується під вас.' }),
      h('button.btn.ghost.sm.hm-skip', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити'),
    ]));
  } else {
    // ---- показники: вивчені слова, зараховані уроки, правила на повтор ----
    blocks.push(kpiGroup());
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
        slot.replaceWith(txRow({ icon: 'calendar-blank', href: `#/report?m=${pym}`, cls: 'rp-link',
          label: `Ваш звіт за ${MONTH_ACC[pm.getMonth()]} готовий`, sub: 'Хвилини, рівень у розмовах, закриті помилки й ваш голос — тоді й зараз' }));
      }).catch(() => slot.remove());
    }
  }

  // ---- завдання рівня на сьогодні (з уроком дня) (змінюються щодня і зі зміною рівня) ----
  const tasksBox = h('section.tx-group', tasksHead(lvl), h('div.list', skelRow(), skelRow(), skelRow()));
  blocks.push(tasksBox);
  fillLevelTasks(tasksBox, lvl, lessonRow(gIdx)).catch(() => tasksBox.remove());

  if (!firstRun) {
    // ---- швидкий старт: три найчастіші дії ----
    blocks.push(txGroup('Швидкий старт', txGrid([
      tx({ icon: 'lightning', label: 'Слова', sub: 'тренування', href: '#/cards/train', attrs: { 'aria-label': 'Тренування слів' } }),
      tx({ icon: 'microphone', label: 'Розмова голосом', sub: 'з вчителем', href: '#/tutor?mode=voice' }),
      tx({ icon: 'chat-circle-dots', label: 'Чат', sub: 'текстом', href: '#/tutor?mode=chat' }),
    ])));

    // ---- тиждень ----
    const n = streak();
    blocks.push(txGroup('Тиждень', h('div.tx.hm-static.hm-week',
      h('span.tx-s', n ? `${n} ${plural(n, 'день', 'дні', 'днів')} поспіль · мета ${st.dailyGoal} хв на день` : `Мета — ${st.dailyGoal} хв на день`),
      h('div.week', week().map(d => h('div.d',
        h('span.dot' + (d.goal ? '.on' : '') + (d.today ? '.today' : ''), { style: d.active && !d.goal ? { background: 'var(--accent-soft)' } : null, 'aria-label': `${d.name}: ${d.goal ? 'мету виконано' : d.active ? 'була практика' : 'без практики'}` },
          d.goal ? ic('check', { size: 16 }) : null),
        d.name)))), { label: S.nav.progress, href: '#/progress' }));

    // ---- слово дня (вантажиться одна колода; блок з'являється на своєму місці) ----
    const wodSlot = document.createComment('word-of-day');
    blocks.push(wodSlot);
    wordOfDay(decks.filter(d => diff(d.level) <= 1 && diff(d.level) >= -1)).then(w => {
      if (!w || !wodSlot.parentNode) return;
      const inCards = store.get('cards', w.id) || store.all('cards').find(c => c.en.toLowerCase() === w.en.toLowerCase());
      const addBtn = h('button.btn.soft.sm', {
        type: 'button', disabled: !!inCards,
        onclick: () => {
          store.put('cards', srs.rowFromStarter(w.deck, w.card));
          addBtn.disabled = true; addBtn.textContent = 'Уже в картках';
          toast('Додано — з\'явиться першим серед нових');
        },
      }, inCards ? 'Уже в картках' : 'Додати в картки');
      wodSlot.replaceWith(txGroup('Слово дня', h('div.tx.hm-static.hm-wod',
        h('div.hm-wod-top',
          h('div.grow', h('div.en.hm-wod-en', w.card.en), w.card.ipa ? h('div.ipa.small', w.card.ipa) : null),
          h('button.tx-sq.hm-sq-btn', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(w.card.en) }, ic('speaker-high', { size: 20 }))),
        h('div.hm-wod-uk', w.card.uk),
        w.card.ex ? h('div.hm-wod-ex', h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати приклад', onclick: () => speak(w.card.ex) }, ic('speaker-high', { size: 18 })), h('i.dim.grow', w.card.ex)) : null,
        h('div.hm-wod-foot', h('span.tx-pill', w.deckName), addBtn))));
    }).catch(e => console.warn('word of day', e));

    // ---- слабкі місця ----
    // поки є «Правила тижня» — ця група дублювала б їх
    const weak = currentFocus() ? [] : mistakesByType().slice(0, 3);
    if (weak.length) {
      blocks.push(txGroup('Слабкі місця', txRows(weak.map(g => txRow({
        icon: 'target', label: S.mistakeTypes[g.type] || g.type, sub: nMistakes(g.total),
        pill: { text: 'Потренувати', tone: 'accent' }, href: `#/tutor?mode=drill&type=${g.type}`,
      })))));
    }

    // ---- остання розмова ----
    const last = store.all('tutor_chats').filter(c => c.mode !== 'diary' && c.mode !== 'coach' && (c.summary || c.messages?.length)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last) {
      const words = (last.summary?.new_words || []).slice(0, 3);
      blocks.push(txGroup('Остання розмова із вчителем', [
        txRow({ icon: last.mode === 'voice' ? 'microphone' : 'chalkboard-teacher', href: `#/tutor?chat=${encodeURIComponent(last.id)}`,
          label: last.title || 'Розмова', sub: `Продовжити · ${new Date(last.created_at).toLocaleDateString('uk-UA')} · ${fmtMin(last.seconds || 0)}`,
          attrs: { 'aria-label': `Продовжити розмову: ${last.title || 'Розмова'}` } }),
        words.length ? h('div.chips.hm-chips', { 'aria-label': 'Нові слова з розмови' }, words.map(w => h('span.tag.accent', w.en))) : null,
      ]));
    }
  }

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
  const top = h('div.row.hm-top',
    h('div.grow.stack', { style: { gap: '4px' } },
      h('a.label.hm-label', { href: '#/today' }, 'Мій день', ic('caret-right', { size: 14 })),
      h('span.big', String(mins), h('small', ` хв сьогодні`)),
      h('span.sub.hm-streak', ic('fire', { size: 14, fill: n > 0 }), n ? `${n} ${plural(n, 'день', 'дні', 'днів')} поспіль` : 'Стрік почнеться сьогодні', h('span.hm-goal', ` · мета ${st.dailyGoal} хв`))),
    planRing(pct, { size: 72, stroke: 8, label: plan.allDone ? ic('check', { size: 26 }) : h('b.num.hm-pct', `${pct}%`), done: plan.allDone }));
  // кроки — маленькі плитки в ряд (як у прототипі)
  const steps = h('div.hm-steps', { style: { gridTemplateColumns: `repeat(${Math.max(1, plan.steps.length)},minmax(0,1fr))` } }, plan.steps.map(s => {
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
  return [top, steps, btn];
}

/** Запасний вміст (план не вдалося обчислити): хвилини й посилання на «Мій день» */
function heroFallback(sec, st) {
  return [h('div.stack', { style: { gap: '4px' } }, h('span.label', 'Сьогодні'), h('span.big', String(Math.round(sec / 60)), h('small', ` / ${st.dailyGoal} хв`))),
    h('a.btn.start.block.hm-start', { href: '#/today' }, ic('play', { fill: true, size: 18 }), 'Мій день')];
}

/** Показники: вивчені слова, зараховані уроки, правила, що чекають на повтор */
function kpiGroup() {
  const learned = store.all('cards').filter(srs.isLearned).length;
  const lessons = store.all('lessons_progress').filter(p => p.completed_at).length;
  let due = 0; try { due = dueRuleCount(); } catch (e) { console.warn('rules', e); }
  return txGroup('Показники', txKpis([
    { value: learned, label: plural(learned, 'слово вивчено', 'слова вивчено', 'слів вивчено'), href: '#/vocab' },
    { value: lessons, label: plural(lessons, 'урок зараховано', 'уроки зараховано', 'уроків зараховано'), href: '#/grammar' },
    { value: due, label: 'правил на повтор', tone: due ? 'warn' : '', href: due ? '#/mistakes?practice=due' : '#/mistakes' },
  ]));
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
  const rows = h('div.tx-rows');
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
    rows.append(txRow({ icon: 'microphone', href: '#/analysis', cls: 'hm-conv',
      label: `У розмовах: ${cl.level}${sub}`, sub: `за ${cl.sessions} ${plural(cl.sessions, 'розмовою', 'розмовами', 'розмовами')}` }));
  }).catch(() => {});
  const levelTile = tx({ wide: true, href: '#/progress', cls: 'hm-level',
    icon: null, label: lvl !== nxt ? `Рівень ${lvl} → ${nxt}` : `Рівень ${lvl}`, sub: LEVEL_NAME[lvl],
    extra: h('span.hm-level-extra', lpBar, lpInfo, ready), end: lpPct });
  levelTile.prepend(h('span.tx-sq.hm-level-badge', { 'aria-hidden': 'true' }, lvl));
  return txGroup('Рівень', [levelTile, rows,
    // швидка зміна рівня: план, урок дня і завдання нижче одразу перебудовуються
    h('details.hm-levelpick',
      h('summary', h('span.tx-sq', ic('swap', { size: 18 })), h('span.grow', 'Змінити рівень'), ic('caret-down', { size: 16 })),
      h('div.level-pick', LEVELS.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === lvl), 'aria-label': `Рівень ${l}`, onclick: () => {
        if (l === lvl) return;
        setLevel(l, 'manual'); toast(`Рівень ${l}: план і завдання оновлено`);
        home(view).then(() => {
          const d = view.querySelector('.hm-levelpick'); if (d) d.open = true;
          view.querySelector(`.level-pick [aria-label="Рівень ${l}"]`)?.focus({ preventScroll: true });
        });
      } }, l))))]);
}

/** «Правила тижня»: до 3 правил з найбільшою вагою помилок — рядки з крапками засвоєння; усе закрито — свято й «Взяти ще правило» */
function weekFocusGroup(view) {
  let f = null, pr = [];
  try { f = weeklyFocus(); pr = f ? focusProgress(f) : []; } catch (e) { console.warn('focus', e); return null; }
  if (!f || !pr.length) return null;
  const doneN = pr.filter(p => p.done).length;
  const won = doneN === pr.length;
  const earlier = closedEarlier(f);
  const left = daysLeftInWeek();
  const rows = h('ol.tx-rows.hm-wf-rows', pr.map((p, i) => h('li', txRow(p.done
    ? { icon: 'check', cls: 'done', label: p.label, sub: p.closedThisWeek ? `закрито · ${nMistakes(p.closedThisWeek)}` : 'закрито', pill: { text: 'закрито', tone: 'good' } }
    : { no: i + 1, label: p.label, sub: `${nMistakes(p.openNow)}${p.closedThisWeek ? ` · закрито ${p.closedThisWeek}` : ''}`,
      end: h('span.hm-dots', h('span.sr-only', 'засвоєння '), txDots(p.streakMin, 3)) }))));
  const more = canAddRule(f);
  const content = [
    won
      ? tx({ wide: true, tone: 'good', icon: 'trophy', label: 'Правила тижня закрито', sub: 'Чудова робота! Усі правила закрито ще до кінця тижня.', cls: 'hm-static' })
      : h('p.hm-note', `${left === 1 ? 'Останній день тижня' : `Ще ${left} ${plural(left, 'день', 'дні', 'днів')}`} · закрито ${doneN} з ${pr.length}`),
    rows,
    earlier.length ? h('p.hm-note.hm-earlier', ic('check-circle', { size: 14 }), `Також закрито: ${earlier.map(x => x.label).join(', ')}`) : null,
    won ? null : h('p.hm-note', 'Вчитель створюватиме нагоди вжити ці правила в кожній розмові. Решта помилок чекає своєї черги.'),
    won
      ? (more ? tx({ wide: true, icon: 'plus', label: 'Взяти ще правило', onclick: () => { if (addFocusRule()) { toast('Нове правило тижня — вчитель уже знає'); home(view); } } }) : null)
      : tx({ wide: true, icon: 'barbell', label: 'Потренувати', sub: 'правила тижня · кілька хвилин', href: '#/mistakes?practice=due&focus=1' }),
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
  const [scen, wtasks, lis, pron, rdMod] = await Promise.all([loadScenarios(), writingTasks(), loadListening(), loadPron(), import('./reading.js')]);
  const rd = rdMod.textOfDay(await rdMod.readingTexts());
  const sc = pickOfDay(filterByLevel(scen.filter(x => x.group !== 'work'), 'mine').items, 'scen');
  const wt = pickOfDay(filterByLevel(wtasks.filter(x => x.group !== 'work'), 'mine').items, 'writing');
  const dl = pickOfDay(filterByLevel(lis.dialogues, 'mine').items, 'dialogue');
  // тема вимови — за рівнем самої теми (як на сторінці вимови)
  const topicLevel = new Map();
  for (const s of pron.shadowing) if (!topicLevel.has(s.topic)) topicLevel.set(s.topic, s.level);
  const tp = pickOfDay(filterByLevel([...topicLevel.keys()], 'mine', t => topicLevel.get(t)).items, 'shadow');
  const task = (icon, kind, title, href, done = false) => txRow({ icon, label: title, sub: kind, href, pill: done ? { text: 'готово', tone: 'good' } : null, chevron: !done });
  const rows = [
    lesson && task(lesson.icon, lesson.kind, lesson.title, lesson.href, lesson.done),
    sc && task('users-three', 'Розмова із вчителем', sc.title, `#/scenarios/${sc.id}`),
    dl && task('headphones', 'Аудіювання', dl.title, `#/listening?tab=dialogues&d=${encodeURIComponent(dl.title)}`),
    wt && task('pencil-line', 'Письмо', wt.title, `#/writing/${wt.id}`),
    tp && task('waveform', 'Вимова', tp, `#/pronunciation?topic=${encodeURIComponent(tp)}`),
    rd && task('book-open', 'Читання', rd.title, `#/reading/${rd.id}`),
    // щоденник — поки сьогодні ще немає запису
    !store.all('tutor_chats').some(c => c.mode === 'diary' && !c.deleted && dayKey(new Date(c.created_at)) === today())
      && task('notebook', 'Щоденник · 2–3 хвилини', 'Розкажіть про свій день — вчитель виправить', '#/diary'),
  ].filter(Boolean);
  if (!rows.length) { box.remove(); return; }
  box.replaceChildren(tasksHead(lvl), txRows(rows));
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

/**
 * Слово дня: детермінований вибір з усіх карток із прикладом у переданих колодах (у порядку каталогу).
 * Каталог знає, скільки в колоді карток із прикладом (withEx) — вантажиться лише колода з обраним словом.
 */
async function wordOfDay(metas) {
  const k = today();
  let hsh = 0; for (const ch of k) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const item = (d, c) => ({ deck: d.id, deckName: d.name, card: c, id: srs.starterId(d.id, c.en), en: c.en });
  if (metas.every(d => Number.isInteger(d.withEx))) {
    const total = metas.reduce((a, d) => a + d.withEx, 0);
    if (!total) return null;
    let n = hsh % total, d = null;
    for (const m of metas) { if (n < m.withEx) { d = m; break; } n -= m.withEx; }
    const [full] = await withCards([d]);
    const withEx = full.cards.filter(c => c.ex);
    // каталог збігається з колодою — готово; інакше (застарілий index.json) рахуємо по всіх колодах
    if (withEx.length === d.withEx) return item(d, withEx[n]);
  }
  const pool = [];
  for (const d of await withCards(metas)) for (const c of d.cards) if (c.ex) pool.push(item(d, c));
  if (!pool.length) return null;
  return pool[hsh % pool.length];
}

