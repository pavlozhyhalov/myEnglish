// Читання: адаптовані тексти A1–C1, переклад слова дотиком, питання на розуміння
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import { json } from '../data.js';
import * as store from '../store.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import { activityTimer } from '../stats.js';
import { runExercises, resultView } from '../ui/exercises.js';
import { tappable } from '../ui/wordtap.js';
import { byFit, levelTag, myLevel, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote, pickOfDay } from '../level.js';

export const readingTexts = () => json('data/reading.json');

const TOPICS = {
  life: ['Повсякдення', 'house'], travel: ['Подорожі', 'plane'], food: ['Їжа', 'food'], family: ['Родина', 'users-three'],
  city: ['Місто', 'city'], health: ['Здоров\'я', 'hospital'], culture: ['Культура', 'books'], money: ['Гроші', 'bank'],
  technology: ['Технології', 'phone'], nature: ['Природа', 'seedling'], relationships: ['Стосунки', 'handshake'],
  news: ['Новини', 'chat-centered-text'], opinion: ['Думка', 'bulb'], work: ['Робота', 'briefcase'],
};
const topicLabel = (t) => TOPICS[t.topic]?.[0] || t.topic;

const words = (t) => t.text.join(' ').split(/\s+/).filter(Boolean).length;
const minutes = (t) => Math.max(1, Math.round(words(t) / 130));

// Прогрес — у профілі (profiles.data.reading: { id: { best, last, n, at } }): синхронізується разом із профілем,
// не потребує нової таблиці й не змішується з тестами та уроками граматики (історія тестів, тижневий тест).
const progressOf = (id) => store.prof().reading?.[id] || null;
function saveProgress(id, score) {
  const all = { ...(store.prof().reading || {}) };
  const p = all[id] || { best: 0, n: 0 };
  all[id] = { best: Math.max(p.best || 0, score), last: score, n: (p.n || 0) + 1, at: new Date().toISOString() };
  store.setProf({ reading: all });
}

/** Тексти для показу: робочі — лише з «Професійним контекстом» */
async function visibleTexts() {
  const all = await readingTexts();
  return { all, list: store.settings().workFocus ? all : all.filter(t => t.group !== 'work') };
}

/**
 * «Текст дня»: свого рівня, непрочитаний (якщо такі ще є); змінюється щодня і зі зміною рівня.
 * Приймає всі тексти (робочі відкидає сама, якщо вимкнено «Професійний контекст») — для головної.
 */
export function textOfDay(texts) {
  const list = store.settings().workFocus ? texts : texts.filter(t => t.group !== 'work');
  const mine = list.filter(t => t.level === myLevel());
  const pool = mine.filter(t => !progressOf(t.id));
  return pickOfDay(pool.length ? pool : mine.length ? mine : list, 'reading');
}

export default async function reading(view, r) {
  const { all, list } = await visibleTexts();
  if (r.parts[0]) {
    const t = all.find(x => x.id === r.parts[0]);
    if (t) return reader(view, t, list);
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Текст не знайдено'), h('a.btn.soft', { href: '#/reading' }, 'До текстів')));
    return;
  }

  const row = (t) => {
    const p = progressOf(t.id);
    return h('a.list-row', { href: `#/reading/${t.id}` },
      emo(TOPICS[t.topic]?.[1] || 'book-open'),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, t.title), h('div.sub', `${t.titleUk} · ${topicLabel(t)} · ${words(t)} слів`)),
      p ? h('span.tag.good', { title: 'Прочитано, найкращий результат' }, `${p.best}%`) : null,
      levelTag(t.level), ic('caret-right', { size: 18 }));
  };

  const day = textOfDay(list);
  const dayCard = day ? h('a.card.accent.stack.reading-day', { href: `#/reading/${day.id}`, style: { gap: '6px' } },
    h('div.row', h('div.section-title.grow', { style: { margin: 0 } }, 'Текст дня'), levelTag(day.level)),
    h('div', { style: { fontWeight: 600, fontSize: 'var(--fs-lg)' } }, day.title),
    h('div.small.dim', `${day.titleUk} · ${topicLabel(day)} · ~${minutes(day)} хв`),
    progressOf(day.id) ? h('div.xs.dim', 'Уже прочитано — можна повторити') : null) : null;

  const box = h('div.stack');
  const draw = () => {
    const { items, fallback } = filterByLevel(list, levelPick('reading'));
    const read = items.filter(t => progressOf(t.id)).length;
    box.replaceChildren(fallbackNote(fallback),
      items.length ? h('div.xs.dim', { style: { margin: '0 2px' } }, `Прочитано ${read} з ${items.length}`) : '',
      h('div.list', byFit(items).map(row)));
  };
  view.replaceChildren(h('div.stack-lg',
    h('section.row', h('div.emoji-circle', emo('book-open')), h('div.grow', h('h1', { style: { margin: 0 } }, 'Читання'),
      h('div.small.dim', `Тексти з перекладом слова дотиком · ваш рівень ${myLevel()}`))),
    dayCard, levelChips('reading', levelCounts(list), draw), box));
  draw();
}

/** Питання на розуміння → вправи типу choice (правильний варіант у даних перший, тут перемішуємо) */
function toExercises(t) {
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return t.questions.map(q => ({ type: 'choice', instruction: 'Питання до тексту', prompt: q.q, options: shuffle(q.options), answer: q.options[0], explanation: q.why || null }));
}

function reader(view, t, list) {
  setTitle(t.title);
  const timer = activityTimer('reading');
  let playing = false;
  const paras = t.text.map(p => h('p', p));
  const article = h('article.reading-text', { lang: 'en', 'aria-label': `Текст: ${t.title}. Торкніться слова, щоб побачити переклад; стрілки — перехід між словами.` }, paras);
  tappable(article, { glossary: t.glossary, mark: true });

  const playBtn = h('button.btn.soft', { type: 'button', onclick: togglePlay });
  const paintPlay = () => playBtn.replaceChildren(ic(playing ? 'stop' : 'speaker-high'), playing ? 'Зупинити' : 'Прослухати текст');
  paintPlay();
  async function togglePlay() {
    if (playing) { playing = false; stopSpeech(); paras.forEach(p => p.classList.remove('speaking')); paintPlay(); return; }
    playing = true; paintPlay();
    // абзацами: браузерний TTS обриває довгі фрагменти, і видно, що саме звучить
    for (const p of paras) {
      if (!playing) break;
      paras.forEach(x => x.classList.toggle('speaking', x === p));
      try { await speak(p.textContent); } catch { break; }
    }
    paras.forEach(p => p.classList.remove('speaking'));
    playing = false; if (playBtn.isConnected) paintPlay();
  }

  const quiz = h('section.stack');
  const p = progressOf(t.id);
  const startBtn = h('button.btn.primary.lg.block', { type: 'button', onclick: startQuiz }, ic('check-circle'), p ? `Пройти питання ще раз (найкраще: ${p.best}%)` : 'Перевірити розуміння');
  quiz.append(startBtn);

  function startQuiz() {
    timer.poke();
    const box = h('div');
    quiz.replaceChildren(box);
    runExercises(box, toExercises(t), {
      title: 'Питання до тексту',
      onDone: (res) => {
        saveProgress(t.id, res.score);
        const idx = list.findIndex(x => x.id === t.id);
        // наступний текст — непрочитаний того самого рівня, інакше наступний у списку
        const next = list.slice(idx + 1).concat(list.slice(0, idx)).find(x => x.level === t.level && !progressOf(x.id)) || list[idx + 1];
        box.replaceChildren(h('div.stack', resultView(res),
          h('div.row.wrap',
            h('button.btn.soft.grow', { type: 'button', onclick: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); startQuiz(); } }, ic('arrow-clockwise'), 'Ще раз'),
            next ? h('a.btn.primary.grow', { href: `#/reading/${next.id}` }, 'Наступний текст', ic('arrow-right')) : h('a.btn.primary.grow', { href: '#/reading' }, 'До текстів'))));
        return false;
      },
    });
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const glossary = h('details.card.reading-gloss',
    h('summary.small', `Словничок · ${t.glossary.length} ${plural(t.glossary.length, 'вираз', 'вирази', 'виразів')}`),
    h('div', { style: { marginTop: '8px' } }, t.glossary.map(g => h('div.example',
      h('button.icon-btn', { type: 'button', 'aria-label': `Прослухати: ${g.en || g.w}`, onclick: () => speak(g.en || g.w) }, ic('speaker-high', { size: 20 })),
      h('div.grow', h('div', { lang: 'en' }, h('b', g.en || g.w), g.ipa ? h('span.ipa.xs', ` ${g.ipa}`) : null), h('div.xs.dim', g.uk))))));

  view.replaceChildren(h('div.stack-lg',
    h('div.row', h('a.icon-btn', { href: '#/reading', 'aria-label': 'Назад' }, ic('arrow-left')),
      h('div.grow', h('h1', { style: { margin: 0 } }, t.title), h('div.small.dim', t.titleUk))),
    h('div.chips', levelTag(t.level), h('span.tag', topicLabel(t)), h('span.tag', `${words(t)} слів · ~${minutes(t)} хв`), p ? h('span.tag.good', 'прочитано') : null),
    h('div.row.wrap', playBtn, h('span.xs.dim.grow', 'Торкніться слова або виділіть фразу — побачите переклад')),
    h('section.card', article),
    glossary,
    quiz));
  return () => { playing = false; stopSpeech(); timer.stop(); };
}
