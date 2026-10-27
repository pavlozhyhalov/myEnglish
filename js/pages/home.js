// Головна: план дня, стрік, слово дня, слабкі місця, остання розмова
import { h, ic, emo, ring, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { withCards, grammarIndex, scenarios as loadScenarios, writingTasks, listening as loadListening, pronunciation as loadPron } from '../data.js';
import { todaySeconds, streak, week, mistakesByType, lessonsToReview, lessonDone, today, dayKey } from '../stats.js';
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
  // для плану дня потрібні лише лічильники карток (колоди свого рівня); опанування рівня і слово дня — дозавантажуються
  const [counts, gIdx, deckState] = await Promise.all([srs.counts(), grammarIndex(), srs.decks()]);
  // увімкнені вбудовані колоди (метадані з каталогу, без карток)
  const decks = deckState.filter(d => d.builtin && d.enabled);
  const firstRun = !prof.placementDone && !prof.levelSource && store.count('sessions') === 0;
  if (view.__tok !== tok) return;

  const hour = new Date().getHours();
  const sec = todaySeconds();
  const goal = st.dailyGoal * 60;

  // ---- план дня ----
  const nextLesson = pickLesson(gIdx);
  const todayK = today();
  const reviewedToday = store.all('reviews').some(r => dayKey(r.ts) === todayK);
  // урок дня виконано, якщо сьогодні якийсь урок зараховано (≥ 80%) — тоді в плані показуємо саме його
  const passedToday = store.all('lessons_progress').filter(p => p.updated_at && dayKey(p.updated_at) === todayK && (p.last_score ?? 0) >= 80)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const passedMeta = passedToday && gIdx.find(l => l.id === passedToday.id);
  const tutorSecToday = store.all('sessions').filter(s => s.day === todayK && (s.type === 'tutor' || s.type === 'voice')).reduce((a, s) => a + s.seconds, 0);
  const toReview = counts.due + counts.fresh;

  const plan = [];
  if (toReview > 0 || reviewedToday) plan.push({
    emoji: 'cards', href: '#/cards', done: toReview === 0,
    text: toReview ? `Повторити ${toReview} ${plural(toReview, 'картку', 'картки', 'карток')}` : 'Картки на сьогодні повторено',
  });
  if (passedMeta) plan.push({ emoji: 'puzzle', href: `#/grammar/${passedMeta.id}`, done: true, text: `Урок дня: ${passedMeta.title}` });
  else if (nextLesson) plan.push({
    emoji: 'puzzle', href: `#/grammar/${nextLesson.id}`, done: false,
    text: `${nextLesson.review ? 'Повторити урок' : 'Урок дня'}: ${nextLesson.title}`,
  });
  plan.push({ emoji: 'mic', href: '#/tutor?mode=voice', done: tutorSecToday >= 600, text: `10 хвилин розмови з ${st.tutorName}` });

  const date = new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  const greet = h('div.greet',
    h('span.date', date.charAt(0).toUpperCase() + date.slice(1)),
    h('h1', greetName() ? `${S.greet(hour)}, ${greetName()}` : S.greet(hour)));

  // ---- синя картка: хвилини, кільце мети, план, старт ----
  const mins = Math.round(sec / 60);
  const left = Math.max(1, Math.ceil((goal - sec) / 60));
  const hero = h('section.plan-hero',
    h('div.row',
      h('div.grow.stack', { style: { gap: '4px' } },
        h('span.label', 'План на сьогодні'),
        h('span.big', String(mins), h('small', ` / ${st.dailyGoal} хв`)),
        h('span.sub', sec >= goal ? 'Денну мету виконано. Чудово!' : `Ще ${left} ${plural(left, 'хвилина', 'хвилини', 'хвилин')} до денної мети`)),
      ring(mins, st.dailyGoal, { size: 72, stroke: 9, label: h('span') })),
    h('div', plan.map(p => h('a.check-item' + (p.done ? '.done' : ''), { href: p.href },
      h('span.box', p.done ? ic('check', { size: 14 }) : null), h('span.t.grow', p.text), p.done ? null : ic('caret-right', { size: 18 })))),
    h('a.btn.start.block', { href: '#/session' }, ic('play', { fill: true, size: 18 }), 'Почати заняття · ~15 хв'));

  const blocks = [greet, hero];
  if (firstRun) {
    blocks.push(h('section.card.accent.hero',
      emo('target', 'xl'),
      h('h2', 'Визначимо ваш рівень'),
      h('p.dim', 'Тест на 10–15 хвилин: граматика, лексика, аудіювання і коротка розмова. Після нього план дня підлаштується під вас.'),
      h('a.btn.primary.block', { href: '#/tests/placement' }, 'Визначити мій рівень'),
      h('button.btn.ghost', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити')));
  }

  // ---- рівень: що зараз вивчаємо і скільки до наступного (числа — після завантаження колод рівня) ----
  const lpInfo = h('div.xs.dim', '\u00a0');
  const lpPct = h('span.num.small');
  const lpFill = h('i', { style: { width: '0%' } });
  const lpBar = h('div.progress', { role: 'progressbar', 'aria-label': 'Опанування рівня', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, lpFill);
  levelProgress(gIdx, lvl).then(lp => {
    lpInfo.textContent = `Уроки ${lp.grammar.done}/${lp.grammar.total} · слова ${lp.words.done}/${lp.words.total}`;
    lpPct.textContent = `${lp.pct}%`;
    lpFill.style.width = `${lp.pct}%`;
    lpBar.setAttribute('aria-valuenow', String(lp.pct));
    if (lp.ready) lpBar.after(h('div.small', { style: { color: 'var(--accent-ink)', fontWeight: 600 } }, `Ви майже опанували ${lvl} — час переходити на ${nextLevel()}`));
  }).catch(e => console.warn('level', e));
  blocks.push(h('section.card.stack',
    h('a.row', { href: '#/progress', style: { color: 'inherit', textDecoration: 'none' } },
      h('div.level-badge', lvl),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, `Рівень ${lvl} · ${LEVEL_NAME[lvl]}`), lpInfo),
      lpPct),
    lpBar,
    // швидка зміна рівня: план, урок дня і завдання нижче одразу перебудовуються
    h('div.level-pick', LEVELS.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === lvl), 'aria-label': `Рівень ${l}`, onclick: () => {
      if (l === lvl) return;
      setLevel(l, 'manual'); toast(`Рівень ${l}: план і завдання оновлено`);
      home(view).then(() => view.querySelector(`.level-pick [aria-label="Рівень ${l}"]`)?.focus({ preventScroll: true }));
    } }, l)))));

  // ---- завдання рівня на сьогодні: змінюються щодня і зі зміною рівня (дані вантажаться після першого показу) ----
  const tasksBox = h('section.stack', { style: { gap: '8px' } });
  blocks.push(tasksBox);
  fillLevelTasks(tasksBox, lvl).catch(() => tasksBox.remove());

  if (firstRun) {
    // картка тесту рівня — одразу під планом дня
  } else {
    // ---- стрік і тиждень ----
    const n = streak();
    blocks.push(h('section.card.stack',
      h('div.row',
        h('span.tile-ico', emo('fire')),
        h('div.grow', h('div.big-num', `${n} ${plural(n, 'день', 'дні', 'днів')}`), h('div.xs.dim', 'поспіль')),
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
    const weak = mistakesByType().slice(0, 3);
    if (weak.length) {
      blocks.push(h('section.card.stack',
        h('div.section-title', 'Слабкі місця'),
        weak.map(g => h('div.row',
          h('div.grow', h('div', { style: { fontWeight: 600 } }, S.mistakeTypes[g.type] || g.type), h('div.xs.dim', `${g.total} ${plural(g.total, 'помилка', 'помилки', 'помилок')}`)),
          h('a.btn.soft.sm', { href: `#/tutor?mode=drill&type=${g.type}` }, 'Потренувати')))));
    }

    // ---- остання розмова ----
    const last = store.all('tutor_chats').filter(c => c.mode !== 'diary' && (c.summary || c.messages?.length)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last) {
      const words = (last.summary?.new_words || []).slice(0, 3);
      blocks.push(h('section.card.stack',
        h('div.section-title', 'Остання розмова із вчителем'),
        h('div.row', emo(last.mode === 'voice' ? 'mic' : 'teacher'),
          h('div.grow', h('div', { style: { fontWeight: 600 } }, last.title || 'Розмова'), h('div.xs.dim', `${new Date(last.created_at).toLocaleDateString('uk-UA')} · ${fmtMin(last.seconds || 0)}`))),
        words.length ? h('div.chips', words.map(w => h('span.tag.accent', w.en))) : null,
        h('a.btn.soft', { href: `#/tutor?chat=${encodeURIComponent(last.id)}` }, 'Продовжити')));
    }
  }

  if (view.__tok !== tok) return;
  view.replaceChildren(h('div.stack-lg', blocks));
}

async function fillLevelTasks(box, lvl) {
  const [scen, wtasks, lis, pron, rdMod] = await Promise.all([loadScenarios(), writingTasks(), loadListening(), loadPron(), import('./reading.js')]);
  const rd = rdMod.textOfDay(await rdMod.readingTexts());
  const sc = pickOfDay(filterByLevel(scen.filter(x => x.group !== 'work'), 'mine').items, 'scen');
  const wt = pickOfDay(filterByLevel(wtasks.filter(x => x.group !== 'work'), 'mine').items, 'writing');
  const dl = pickOfDay(filterByLevel(lis.dialogues, 'mine').items, 'dialogue');
  // тема вимови — за рівнем самої теми (як на сторінці вимови)
  const topicLevel = new Map();
  for (const s of pron.shadowing) if (!topicLevel.has(s.topic)) topicLevel.set(s.topic, s.level);
  const tp = pickOfDay(filterByLevel([...topicLevel.keys()], 'mine', t => topicLevel.get(t)).items, 'shadow');
  const task = (icon, kind, title, href) => h('a.list-row', { href }, h('span.tile-ico', emo(icon)), h('div.grow', h('div.xs.dim', kind), h('div', { style: { fontWeight: 600 } }, title)), ic('caret-right', { size: 18 }));
  const rows = [
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
  if (weak && weak.total >= 5) {
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

