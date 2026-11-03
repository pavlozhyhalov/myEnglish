// Головна: «Сьогодні» (кільце «Мого дня», одна головна кнопка), рівень, також сьогодні, тиждень, слово дня, слабкі місця, остання розмова
import { h, ic, emo, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { user } from '../supa.js';
import * as srs from '../srs.js';
import { withCards, grammarIndex, scenarios as loadScenarios, writingTasks, listening as loadListening, pronunciation as loadPron } from '../data.js';
import { todaySeconds, streak, week, mistakesByType, lessonsToReview, lessonDone, today, dayKey } from '../stats.js';
import { buildPlan, markStarted } from '../daily.js';
import { weeklyFocus, currentFocus, focusProgress, closedEarlier, canAddRule, addFocusRule, daysLeftInWeek } from '../focus.js';
import { planRing, startNext } from './today.js';
import { skel, skelCard, skelRow } from '../ui/skeleton.js';
import { speak } from '../speech.js';
import { toast } from '../ui/toast.js';
import { greetName } from './profile.js';
import { myLevel, LEVEL_NAME, LEVELS, nextLessonByLevel, byFit, diff, levelProgress, nextLevel, setLevel, filterByLevel, pickOfDay } from '../level.js';

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

  // ---- «Сьогодні»: кільце «Мого дня», хвилини й стрік, одна головна кнопка ----
  const hero = h('section.plan-hero.hm-hero', { 'aria-label': 'Сьогодні' }, heroSkeleton());
  blocks.push(hero);
  const fillHero = (plan) => { if (view.__tok === tok) hero.replaceChildren(...heroContent(plan, sec, st)); };
  buildPlan().then(fillHero).catch(e => { console.warn('plan', e); hero.replaceChildren(...heroFallback(sec, st)); });

  if (firstRun) {
    blocks.push(h('section.card.accent.hero',
      emo('target', 'xl'),
      h('h2', 'Визначимо ваш рівень'),
      h('p.dim', 'Адаптивний тест ~25 хвилин: граматика, лексика, читання, аудіювання, письмо і коротка розмова. Можна зробити паузу. Після нього план дня підлаштується під вас.'),
      h('a.btn.primary.block', { href: '#/tests/placement' }, 'Визначити мій рівень'),
      h('button.btn.ghost', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити')));
  }

  // ---- рівень: поточний → наступний, опанування, рівень у розмовах ----
  blocks.push(levelCard(view, gIdx, lvl));

  // ---- правила тижня: 3 правила замість усіх помилок одразу ----
  const wf = weekFocusCard(view);
  if (wf) blocks.push(wf);
  else if (user() && !store.syncedOnce()) {
    // правила нового тижня обираються після першої синхронізації — тоді й показуємо картку
    const slot = document.createComment('week-focus');
    blocks.push(slot);
    // слот вставляється синхронно нижче; сторінку покинули або перемалювали — слухач більше не потрібен
    const off = store.on((t) => {
      if (!slot.isConnected) { off(); return; }
      if (t !== 'synced') return;
      off();
      const c = weekFocusCard(view);
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
        slot.replaceWith(h('a.card.row.rp-link.hm-press', { href: `#/report?m=${pym}` },
          h('span.tile-ico', ic('calendar-blank', { size: 22 })),
          h('div.grow', h('div', { style: { fontWeight: 600 } }, `Ваш звіт за ${MONTH_ACC[pm.getMonth()]} готовий`), h('div.xs.dim', 'Хвилини, рівень у розмовах, закриті помилки й ваш голос — тоді й зараз')),
          ic('caret-right', { size: 18 })));
      }).catch(() => slot.remove());
    }
  }

  // ---- завдання рівня на сьогодні (з уроком дня) (змінюються щодня і зі зміною рівня) ----
  const tasksBox = h('section.stack', { style: { gap: '8px' } }, h('div.section-title', `Завдання рівня ${lvl} на сьогодні`), h('div.list', skelRow(), skelRow(), skelRow()));
  blocks.push(tasksBox);
  fillLevelTasks(tasksBox, lvl, lessonRow(gIdx)).catch(() => tasksBox.remove());

  if (!firstRun) {
    // ---- тиждень ----
    const n = streak();
    blocks.push(h('section.card.stack',
      h('div.row',
        h('div.grow', h('div.hm-card-title', 'Тиждень'), h('div.xs.dim', n ? `${n} ${plural(n, 'день', 'дні', 'днів')} поспіль · мета ${st.dailyGoal} хв на день` : `Мета — ${st.dailyGoal} хв на день`)),
        h('a.btn.ghost.sm', { href: '#/progress' }, S.nav.progress)),
      h('div.week', week().map(d => h('div.d',
        h('span.dot' + (d.goal ? '.on' : '') + (d.today ? '.today' : ''), { style: d.active && !d.goal ? { background: 'var(--accent-soft)' } : null, 'aria-label': `${d.name}: ${d.goal ? 'мету виконано' : d.active ? 'була практика' : 'без практики'}` },
          d.goal ? ic('check', { size: 16 }) : null),
        d.name)))));

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
      wodSlot.replaceWith(h('section.card.stack',
        h('div.row', h('span.eyebrow.grow', 'Слово дня'), h('span.tag', w.deckName)),
        h('div.row',
          h('div.grow', h('div.en', { style: { fontSize: 'var(--fs-xl)' } }, w.card.en), w.card.ipa ? h('div.ipa.small', w.card.ipa) : null),
          h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(w.card.en) }, ic('speaker-high'))),
        h('div', w.card.uk),
        w.card.ex ? h('div.row.small', h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати приклад', onclick: () => speak(w.card.ex) }, ic('speaker-high', { size: 20 })), h('i.dim.grow', w.card.ex)) : null,
        h('div', addBtn)));
    }).catch(e => console.warn('word of day', e));

    // ---- слабкі місця ----
    // поки є «Правила тижня» — ця картка дублювала б їх
    const weak = currentFocus() ? [] : mistakesByType().slice(0, 3);
    if (weak.length) {
      blocks.push(h('section.card.stack',
        h('div.hm-card-title', 'Слабкі місця'),
        weak.map(g => h('div.row',
          h('div.grow', h('div', { style: { fontWeight: 600 } }, S.mistakeTypes[g.type] || g.type), h('div.xs.dim', `${g.total} ${plural(g.total, 'помилка', 'помилки', 'помилок')}`)),
          h('a.btn.soft.sm', { href: `#/tutor?mode=drill&type=${g.type}` }, 'Потренувати')))));
    }

    // ---- остання розмова ----
    const last = store.all('tutor_chats').filter(c => c.mode !== 'diary' && c.mode !== 'coach' && (c.summary || c.messages?.length)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last) {
      const words = (last.summary?.new_words || []).slice(0, 3);
      blocks.push(h('section.card.stack',
        h('div.hm-card-title', 'Остання розмова із вчителем'),
        h('div.row', h('span.tile-ico', emo(last.mode === 'voice' ? 'mic' : 'teacher')),
          h('div.grow', h('div', { style: { fontWeight: 600 } }, last.title || 'Розмова'), h('div.xs.dim', `${new Date(last.created_at).toLocaleDateString('uk-UA')} · ${fmtMin(last.seconds || 0)}`))),
        words.length ? h('div.chips', words.map(w => h('span.tag.accent', w.en))) : null,
        h('a.btn.soft', { href: `#/tutor?chat=${encodeURIComponent(last.id)}` }, 'Продовжити')));
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
      skel({ w: '84px', ht: 84, r: '50%', cls: 'on-hero' })),
    h('div.stack', { style: { gap: '10px' } }, [0, 1, 2].map(() => skel({ ht: 18, cls: 'on-hero' }))),
    skel({ ht: 52, r: 'var(--radius-btn)', cls: 'on-hero' }),
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
    planRing(pct, { size: 84, stroke: 9, label: plan.allDone ? ic('check', { size: 30 }) : h('b.num.hm-pct', `${pct}%`), done: plan.allDone }));
  const steps = h('div.hm-steps', plan.steps.map(s => h('a.check-item' + (s.done ? '.done' : '') + (s.skipped ? '.skipped' : '') + (s === plan.next ? '.next' : ''), { href: s.href, onclick: s.skipped ? null : () => markStarted() },
    h('span.box', s.done ? ic('check', { size: 14 }) : null),
    h('span.t.grow', s.title),
    h('span.hm-min', s.done ? '' : s.skipped ? 'після входу' : `${s.id === 'voice' ? '5–7' : s.minutes} хв`),
    s.done ? null : ic('caret-right', { size: 16 }))));
  let btn;
  if (plan.allDone) btn = h('a.btn.start.block.hm-start', { href: '#/today' }, ic('seal-check', { size: 20, fill: true }), 'Готово на сьогодні');
  else if (plan.next) {
    const fresh = !plan.started && !plan.steps.some(s => !s.skipped && s.progress > 0);
    btn = h('button.btn.start.block.hm-start', { type: 'button', onclick: () => startNext(plan) },
      ic('play', { fill: true, size: 18 }), fresh ? `Почати день · ${Math.round(plan.totalMin)} хв` : `Продовжити: ${plan.next.title}`);
  } else btn = h('a.btn.start.block.hm-start', { href: '#/auth' }, 'Увійти, щоб поговорити з вчителем');
  return [top, steps, btn];
}

/** Запасний вміст (план не вдалося обчислити): хвилини й посилання на «Мій день» */
function heroFallback(sec, st) {
  return [h('div.stack', { style: { gap: '4px' } }, h('span.label', 'Сьогодні'), h('span.big', String(Math.round(sec / 60)), h('small', ` / ${st.dailyGoal} хв`))),
    h('a.btn.start.block.hm-start', { href: '#/today' }, ic('play', { fill: true, size: 18 }), 'Мій день')];
}

/** Картка рівня: поточний → наступний, % опанування, рівень у розмовах, швидка зміна рівня (згорнута) */
function levelCard(view, gIdx, lvl) {
  const nxt = nextLevel();
  const lpInfo = h('div.xs.dim', ' ');
  const lpPct = h('span.num.hm-level-pct', '—');
  const lpFill = h('i', { style: { width: '0%' } });
  const lpBar = h('div.progress', { role: 'progressbar', 'aria-label': 'Опанування рівня', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, lpFill);
  const extra = h('div.stack', { style: { gap: '6px' } });
  levelProgress(gIdx, lvl).then(lp => {
    lpInfo.textContent = `Уроки ${lp.grammar.done}/${lp.grammar.total} · слова ${lp.words.done}/${lp.words.total}`;
    lpPct.textContent = `${lp.pct}%`;
    lpFill.style.width = `${lp.pct}%`;
    lpBar.setAttribute('aria-valuenow', String(lp.pct));
    if (lp.ready) extra.prepend(h('div.small', { style: { color: 'var(--accent-ink)', fontWeight: 600 } }, `Ви майже опанували ${lvl} — час переходити на ${nxt}`));
  }).catch(e => console.warn('level', e));
  // рівень у розмовах — лише коли є ≥2 оцінені розмови (модуль аналізу вантажиться окремо)
  import('../analysis.js').then(({ conversationLevel }) => {
    const cl = conversationLevel();
    if (!cl || cl.sessions < 2) return;
    const sub = cl.sublevel === 'high' ? '+' : cl.sublevel === 'low' ? '−' : '';
    extra.append(h('a.row.hm-conv', { href: '#/analysis' },
      ic('microphone', { size: 18 }),
      h('span.grow', 'У розмовах: ', h('b', `${cl.level}${sub}`), h('span.dim', ` · за ${cl.sessions} ${plural(cl.sessions, 'розмовою', 'розмовами', 'розмовами')}`)),
      ic('caret-right', { size: 16 })));
  }).catch(() => {});
  return h('section.card.stack.hm-level',
    h('a.row.hm-level-head', { href: '#/progress' },
      h('div.level-badge', lvl),
      h('div.grow',
        h('div.hm-card-title.row', { style: { gap: '6px' } }, `Рівень ${lvl}`, lvl !== nxt ? [ic('arrow-right', { size: 14 }), nxt] : null),
        h('div.xs.dim', LEVEL_NAME[lvl])),
      lpPct),
    lpBar, lpInfo, extra,
    // швидка зміна рівня: план, урок дня і завдання нижче одразу перебудовуються
    h('details.hm-levelpick',
      h('summary', 'Змінити рівень'),
      h('div.level-pick', LEVELS.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === lvl), 'aria-label': `Рівень ${l}`, onclick: () => {
        if (l === lvl) return;
        setLevel(l, 'manual'); toast(`Рівень ${l}: план і завдання оновлено`);
        home(view).then(() => {
          const d = view.querySelector('.hm-levelpick'); if (d) d.open = true;
          view.querySelector(`.level-pick [aria-label="Рівень ${l}"]`)?.focus({ preventScroll: true });
        });
      } }, l)))));
}

/** Позначка засвоєння правила: 3 крапки (правильні вживання поспіль) */
const ruleDots = (n) => h('span.wf-dots', { 'aria-hidden': 'true' }, [0, 1, 2].map(i => h('i' + (i < n ? '.on' : ''))));

/** «Правила тижня»: до 3 правил з найбільшою вагою помилок, прогрес кожного, тренування; усе закрито — свято й «Взяти ще правило» */
function weekFocusCard(view) {
  let f = null, pr = [];
  try { f = weeklyFocus(); pr = f ? focusProgress(f) : []; } catch (e) { console.warn('focus', e); return null; }
  if (!f || !pr.length) return null;
  const doneN = pr.filter(p => p.done).length;
  const won = doneN === pr.length;
  const earlier = closedEarlier(f);
  const left = daysLeftInWeek();
  const sub = won ? 'Чудова робота! Усі правила закрито ще до кінця тижня.'
    : `${left === 1 ? 'Останній день тижня' : `Ще ${left} ${plural(left, 'день', 'дні', 'днів')}`} · закрито ${doneN} з ${pr.length}`;
  const rows = h('ol.wf-rows', pr.map((p, i) => h('li.wf-row' + (p.done ? '.done' : ''),
    h('span.wf-mark', p.done ? ic('check', { size: 14 }) : h('b.num', String(i + 1))),
    h('div.grow.wf-body',
      h('div.wf-label', p.label),
      h('div.wf-meta', p.done
        ? h('span.wf-closed', p.closedThisWeek ? `закрито · ${p.closedThisWeek} ${plural(p.closedThisWeek, 'помилка', 'помилки', 'помилок')}` : 'закрито')
        : [ruleDots(p.streakMin), h('span', `${p.openNow} ${plural(p.openNow, 'помилка', 'помилки', 'помилок')}${p.closedThisWeek ? ` · закрито ${p.closedThisWeek}` : ''}`)])),
    h('span.sr-only', p.done ? 'закрито' : `засвоєння ${p.streakMin} з 3`))));
  const more = canAddRule(f);
  const actions = won
    ? h('div.wf-actions',
      more ? h('button.btn.primary.block', { type: 'button', onclick: () => { if (addFocusRule()) { toast('Нове правило тижня — вчитель уже знає'); home(view); } } }, ic('plus', { size: 18 }), 'Взяти ще правило') : null,
      h('a.btn.soft.block', { href: '#/mistakes' }, 'Усі мої помилки'))
    : h('a.btn.primary.block', { href: '#/mistakes?practice=due&focus=1' }, ic('barbell', { size: 18 }), 'Потренувати');
  return h('section.card.stack.wf' + (won ? '.wf-won' : ''), { 'aria-label': 'Правила тижня' },
    h('a.row.wf-head', { href: '#/mistakes' },
      h('span.wf-ico', ic(won ? 'trophy' : 'target', { size: 22, fill: won })),
      h('div.grow', h('div.hm-card-title', won ? 'Правила тижня закрито' : 'Правила тижня'), h('div.xs.dim', sub)),
      ic('caret-right', { size: 16 })),
    rows,
    earlier.length ? h('div.xs.dim.wf-earlier', ic('check-circle', { size: 14 }), `Також закрито: ${earlier.map(x => x.label).join(', ')}`) : null,
    won ? null : h('div.xs.dim.wf-hint', 'Вчитель створюватиме нагоди вжити ці правила в кожній розмові. Решта помилок чекає своєї черги.'),
    actions);
}

/** Урок дня (як у старому плані): зарахований сьогодні — показуємо його з позначкою; інакше наступний за рівнем */
function lessonRow(gIdx) {
  const todayK = today();
  const passedToday = store.all('lessons_progress').filter(p => p.updated_at && dayKey(p.updated_at) === todayK && (p.last_score ?? 0) >= 80)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const passedMeta = passedToday && gIdx.find(l => l.id === passedToday.id);
  if (passedMeta) return { icon: 'puzzle', kind: 'Урок дня · зараховано', title: passedMeta.title, href: `#/grammar/${passedMeta.id}`, done: true };
  const l = pickLesson(gIdx);
  return l ? { icon: 'puzzle', kind: l.review ? 'Повторити урок' : 'Урок дня · граматика', title: l.title, href: `#/grammar/${l.id}` } : null;
}

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
  const task = (icon, kind, title, href, done = false) => h('a.list-row', { href }, h('span.tile-ico', emo(icon)), h('div.grow', h('div.xs.dim', kind), h('div', { style: { fontWeight: 600 } }, title)), done ? h('span.tag.good', 'готово') : ic('caret-right', { size: 18 }));
  const rows = [
    lesson && task(lesson.icon, lesson.kind, lesson.title, lesson.href, lesson.done),
    sc && task('theater', 'Розмова із вчителем', sc.title, `#/scenarios/${sc.id}`),
    dl && task('headphone', 'Аудіювання', dl.title, `#/listening?tab=dialogues&d=${encodeURIComponent(dl.title)}`),
    wt && task('writing', 'Письмо', wt.title, `#/writing/${wt.id}`),
    tp && task('mouth', 'Вимова', tp, `#/pronunciation?topic=${encodeURIComponent(tp)}`),
    rd && task('book-open', 'Читання', rd.title, `#/reading/${rd.id}`),
    // щоденник — поки сьогодні ще немає запису
    !store.all('tutor_chats').some(c => c.mode === 'diary' && !c.deleted && dayKey(new Date(c.created_at)) === today())
      && task('notebook', 'Щоденник · 2–3 хвилини', 'Розкажіть про свій день — вчитель виправить', '#/diary'),
  ].filter(Boolean);
  if (!rows.length) { box.remove(); return; }
  box.replaceChildren(h('div.row', h('div.section-title.grow', `Завдання рівня ${lvl} на сьогодні`), h('span.xs.dim', 'нові щодня')), h('div.list', rows));
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

