// Головна: план дня, стрік, слово дня, слабкі місця, остання розмова
import { h, ic, emo, ring, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { allDecks, grammarIndex } from '../data.js';
import { todaySeconds, streak, week, mistakesByType, lessonsToReview, lessonDone, today, dayKey } from '../stats.js';
import { speak } from '../speech.js';
import { toast } from '../ui/toast.js';
import { myLevel, LEVEL_NAME, nextLessonByLevel, byFit, diff, levelProgress, nextLevel } from '../level.js';

export default async function home(view) {
  const st = store.settings();
  const prof = store.prof();
  const [counts, gIdx, allD, deckState] = await Promise.all([srs.counts(), grammarIndex(), allDecks(), srs.decks()]);
  const on = new Set(deckState.filter(d => d.enabled).map(d => d.id));
  const decks = allD.filter(d => on.has(d.id));
  const firstRun = !prof.placementDone && !prof.levelSource && store.count('sessions') === 0;
  const lp = await levelProgress(gIdx);

  const hour = new Date().getHours();
  const sec = todaySeconds();
  const goal = st.dailyGoal * 60;

  // ---- план дня ----
  const nextLesson = pickLesson(gIdx);
  const todayK = today();
  const reviewedToday = store.all('reviews').some(r => dayKey(r.ts) === todayK);
  const lessonToday = store.all('lessons_progress').some(p => p.updated_at && dayKey(p.updated_at) === todayK);
  const tutorSecToday = store.all('sessions').filter(s => s.day === todayK && (s.type === 'tutor' || s.type === 'voice')).reduce((a, s) => a + s.seconds, 0);
  const toReview = counts.due + counts.fresh;

  const plan = [];
  if (toReview > 0 || reviewedToday) plan.push({
    emoji: 'cards', href: '#/cards', done: toReview === 0,
    text: toReview ? `Повторити ${toReview} ${plural(toReview, 'картку', 'картки', 'карток')}` : 'Картки на сьогодні повторено',
  });
  if (nextLesson) plan.push({
    emoji: 'puzzle', href: `#/grammar/${nextLesson.id}`, done: lessonToday,
    text: `${nextLesson.review ? 'Повторити урок' : 'Урок дня'}: ${nextLesson.title}`,
  });
  plan.push({ emoji: 'mic', href: '#/tutor?mode=voice', done: tutorSecToday >= 600, text: `10 хвилин розмови з ${st.tutorName}` });

  const date = new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  const greet = h('div.greet',
    h('span.date', date.charAt(0).toUpperCase() + date.slice(1)),
    h('h1', `${S.greet(hour)}, ${S.name}`));

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
      h('p.dim', 'Тест на 10–12 хвилин: граматика, лексика, аудіювання. Після нього план дня підлаштується під вас.'),
      h('a.btn.primary.block', { href: '#/tests/placement' }, 'Визначити мій рівень'),
      h('button.btn.ghost', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити')));
  } else {
    // ---- рівень: що зараз вивчаємо і скільки до наступного ----
    const lvl = myLevel();
    blocks.push(h('a.card.stack', { href: '#/progress', style: { color: 'inherit', textDecoration: 'none' } },
      h('div.row',
        h('div.level-badge', lvl),
        h('div.grow', h('div', { style: { fontWeight: 600 } }, `Рівень ${lvl} · ${LEVEL_NAME[lvl]}`),
          h('div.xs.dim', `Уроки ${lp.grammar.done}/${lp.grammar.total} · слова ${lp.words.done}/${lp.words.total}`)),
        h('span.num.small', `${lp.pct}%`)),
      h('div.progress', h('i', { style: { width: `${lp.pct}%` } })),
      lp.ready ? h('div.small', { style: { color: 'var(--accent-ink)', fontWeight: 600 } }, `Ви майже опанували ${lvl} — час переходити на ${nextLevel()}`) : null));

    // ---- стрік і тиждень ----
    const n = streak();
    blocks.push(h('section.card.stack',
      h('div.row',
        h('span.tile-ico', emo('fire')),
        h('div.grow', h('div.big-num', `${n} ${plural(n, 'день', 'дні', 'днів')}`), h('div.xs.dim', 'поспіль без пропусків')),
        h('a.btn.ghost.sm', { href: '#/progress' }, S.nav.progress)),
      h('div.week', week().map(d => h('div.d',
        h('span.dot' + (d.goal ? '.on' : '') + (d.today ? '.today' : ''), { style: d.active && !d.goal ? { background: 'var(--accent-soft)' } : null, 'aria-label': `${d.name}: ${d.goal ? 'мету виконано' : d.active ? 'була практика' : 'ні'}` },
          d.goal ? ic('check', { size: 16 }) : null),
        d.name)))));

    // ---- слово дня ----
    const w = wordOfDay(decks.filter(d => diff(d.level) <= 1 && diff(d.level) >= -1));
    if (w) {
      const inCards = store.get('cards', w.id) || store.all('cards').find(c => c.en.toLowerCase() === w.en.toLowerCase());
      const addBtn = h('button.btn.soft.sm', {
        type: 'button', disabled: !!inCards,
        onclick: () => {
          store.put('cards', srs.rowFromStarter(w.deck, w.card));
          addBtn.disabled = true; addBtn.textContent = 'Уже в картках';
          toast('Додано: піде першим серед нових');
        },
      }, inCards ? 'Уже в картках' : 'В картки');
      blocks.push(h('section.card.stack',
        h('div.row', h('span.eyebrow.grow', 'Слово дня'), h('span.tag', w.deckName)),
        h('div.row',
          h('div.grow', h('div.en', { style: { fontSize: 'var(--fs-xl)' } }, w.card.en), w.card.ipa ? h('div.ipa.small', w.card.ipa) : null),
          h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(w.card.en) }, ic('speaker-high'))),
        h('div', w.card.uk),
        w.card.ex ? h('div.row.small', h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати приклад', onclick: () => speak(w.card.ex) }, ic('speaker-high', { size: 20 })), h('i.dim.grow', w.card.ex)) : null,
        h('div', addBtn)));
    }

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
    const last = store.all('tutor_chats').filter(c => c.summary || c.messages?.length).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (last) {
      const words = (last.summary?.new_words || []).slice(0, 3);
      blocks.push(h('section.card.stack',
        h('div.section-title', 'Остання розмова з вчителем'),
        h('div.row', emo(last.mode === 'voice' ? 'mic' : 'teacher'),
          h('div.grow', h('div', { style: { fontWeight: 600 } }, last.title || 'Розмова'), h('div.xs.dim', `${new Date(last.created_at).toLocaleDateString('uk-UA')} · ${fmtMin(last.seconds || 0)}`))),
        words.length ? h('div.chips', words.map(w => h('span.tag.accent', w.en))) : null,
        h('a.btn.soft', { href: `#/tutor?chat=${encodeURIComponent(last.id)}` }, 'Продовжити')));
    }
  }

  view.replaceChildren(h('div.stack-lg', blocks));
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

function wordOfDay(decks) {
  const pool = [];
  for (const d of decks) for (const c of d.cards) if (c.ex) pool.push({ deck: d.id, deckName: d.name, card: c, id: srs.starterId(d.id, c.en), en: c.en });
  if (!pool.length) return null;
  const k = today();
  let hsh = 0; for (const ch of k) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hsh % pool.length];
}

