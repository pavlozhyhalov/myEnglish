// Головна: план дня, стрік, слово дня, слабкі місця, остання розмова, плитки
import { h, ic, emo, ring, fmtMin } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { allDecks, grammarIndex } from '../data.js';
import { todaySeconds, streak, week, mistakesByType, lessonsToReview, lessonDone, today, dayKey } from '../stats.js';
import { SECTIONS } from '../nav.js';
import { speak } from '../speech.js';
import { toast } from '../ui/toast.js';

export default async function home(view) {
  const st = store.settings();
  const prof = store.prof();
  const [counts, gIdx, allD, deckState] = await Promise.all([srs.counts(), grammarIndex(), allDecks(), srs.decks()]);
  const on = new Set(deckState.filter(d => d.enabled).map(d => d.id));
  const decks = allD.filter(d => on.has(d.id));
  const firstRun = !prof.placementDone && store.count('sessions') === 0;

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

  const greet = h('section.card.stack',
    h('div.row',
      h('div.grow',
        h('h1', `${S.greet(hour)}, ${S.name}`),
        h('p.dim.small', sec >= goal ? 'Денну мету виконано. Чудово!' : `Сьогодні ${fmtMin(sec)} з ${st.dailyGoal} хв`)),
      ring(Math.round(sec / 60), st.dailyGoal, { size: 84, stroke: 9, label: h('div', h('b', String(Math.round(sec / 60))), h('div.xs.dim', `/${st.dailyGoal} хв`)) })),
    h('div', plan.map(p => h('a.check-item' + (p.done ? '.done' : ''), { href: p.href },
      h('span.box', p.done ? ic('check', { size: 16 }) : null), emo(p.emoji), h('span.t.grow', p.text), ic('caret-right', { size: 18 })))));

  const startBtn = h('a.btn.primary.lg.block', { href: '#/session' }, ic('play', { fill: true }), 'Почати заняття · ~15 хв');

  const blocks = [greet, startBtn];

  if (firstRun) {
    blocks.push(h('section.card.accent.hero',
      emo('target', 'xl'),
      h('h2', 'Визначимо ваш рівень'),
      h('p.dim', 'Тест на 10–12 хвилин: граматика, лексика, аудіювання. Після нього план дня підлаштується під вас.'),
      h('a.btn.primary.block', { href: '#/tests/placement' }, 'Визначити мій рівень'),
      h('button.btn.ghost', { type: 'button', onclick: () => { store.setProf({ placementDone: 'skipped' }); home(view); } }, 'Пропустити, почну з B1')));
  } else {
    // ---- стрік і тиждень ----
    const n = streak();
    blocks.push(h('section.card.stack',
      h('div.row', emo('fire', 'lg'), h('div.grow', h('div.num', { style: { fontSize: 'var(--fs-xl)' } }, String(n)), h('div.xs.dim', `${plural(n, 'день', 'дні', 'днів')} поспіль`))),
      h('div.week', week().map(d => h('div.d',
        h('span.dot' + (d.goal ? '.on' : '') + (d.today ? '.today' : ''), { style: d.active && !d.goal ? { background: 'var(--accent-soft)' } : null, 'aria-label': `${d.name}: ${d.goal ? 'мету виконано' : d.active ? 'була практика' : 'ні'}` },
          d.goal ? ic('check', { size: 16 }) : null),
        d.name)))));

    // ---- слово дня ----
    const w = wordOfDay(decks);
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
        h('div.row', h('div.section-title.grow', 'Слово дня'), h('span.tag', w.deckName)),
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

  // ---- плитки ----
  const status = tileStatus(counts, gIdx);
  blocks.push(h('div.section-title', 'Розділи'));
  blocks.push(h('div.grid2', SECTIONS.filter(s => s.id !== 'home').map(s =>
    h('a.tile', { href: `#/${s.id}` }, h('div.emoji-circle', emo(s.emoji)), h('div', h('div.name', s.label), h('div.status', status[s.id] || ''))))));

  view.replaceChildren(h('div.stack-lg', blocks));
}

function pickLesson(idx) {
  const rev = lessonsToReview()[0];
  if (rev) { const l = idx.find(x => x.id === rev.id); if (l) return { ...l, review: true }; }
  // слабке місце — урок відповідного типу
  const weak = mistakesByType()[0];
  if (weak && weak.total >= 5) {
    const l = idx.find(x => x.mistakeType === weak.type && !lessonDone(x.id));
    if (l) return l;
  }
  return idx.find(x => !lessonDone(x.id));
}

function wordOfDay(decks) {
  const pool = [];
  for (const d of decks) for (const c of d.cards) if (c.ex) pool.push({ deck: d.id, deckName: d.name, card: c, id: srs.starterId(d.id, c.en), en: c.en });
  if (!pool.length) return null;
  const k = today();
  let hsh = 0; for (const ch of k) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hsh % pool.length];
}

function tileStatus(counts, gIdx) {
  const done = gIdx.filter(l => lessonDone(l.id)).length;
  const mist = store.all('mistakes').filter(m => !m.resolved).length;
  const chats = store.all('tutor_chats').length;
  return {
    cards: counts.due ? `${counts.due} до повтору` : counts.fresh ? `${counts.fresh} нових сьогодні` : 'На сьогодні все',
    tutor: chats ? `${chats} ${plural(chats, 'розмова', 'розмови', 'розмов')}` : 'Текст і голос',
    vocab: `${store.all('cards').filter(c => c.deck_id === 'my').length} моїх слів`,
    grammar: `Пройдено ${done} з ${gIdx.length}`,
    listening: 'Диктант і діалоги',
    pronunciation: 'Shadowing, пари звуків',
    writing: 'Листи й повідомлення',
    scenarios: '12 рольових ігор',
    tests: store.prof().placementDone ? 'Рівень, тема, тиждень' : 'Визначте рівень',
    mistakes: mist ? `${mist} не виправлено` : 'Поки чисто',
    progress: `${counts.learned} слів вивчено`,
    settings: 'Тема, меню, мета',
  };
}
