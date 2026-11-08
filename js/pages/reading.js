// Читання: адаптовані тексти A1–C1, переклад слова дотиком, питання на розуміння
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import { json } from '../data.js';
import * as store from '../store.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import { activityTimer } from '../stats.js';
import { runExercises, answerText } from '../ui/exercises.js';
import { tappable } from '../ui/wordtap.js';
import { byFit, levelTag, myLevel, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote, pickOfDay } from '../level.js';
import { tx, txPrimary, txGroup, txRow, txRows, txGrid, txKpis, txPill, txResult } from '../ui/tiles.js';

/** Іконка теми (назва з мапи emo()) у квадратику плитки */
const sqEmo = (el, name) => { const e = emo(name); e.setAttribute('width', 18); e.setAttribute('height', 18); el.querySelector('.tx-sq')?.replaceChildren(e); return el; };

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

  const row = (t, tag) => {
    const p = progressOf(t.id);
    return sqEmo(txRow({ icon: 'book-open', label: t.title, sub: `${t.titleUk} · ~${minutes(t)} хв`, href: `#/reading/${t.id}`,
      pill: p ? { text: `${p.best}%`, tone: 'good' } : null, end: tag ? levelTag(t.level) : null,
      attrs: { title: `${topicLabel(t)} · ${words(t)} ${plural(words(t), 'слово', 'слова', 'слів')}${p ? ` · прочитано, найкращий результат ${p.best}%` : ''}` } }), TOPICS[t.topic]?.[1] || 'book-open');
  };

  const day = textOfDay(list);
  const dayCard = day ? sqEmo(txPrimary({ icon: 'book-open', label: day.title,
    sub: `Текст дня · ${day.titleUk} · ~${minutes(day)} хв${progressOf(day.id) ? ' · прочитано' : ''}`,
    href: `#/reading/${day.id}` }), TOPICS[day.topic]?.[1] || 'book-open') : null;

  // тексти вибраного рівня: до 6 (спершу непрочитані), решта — «Показати всі»
  const box = h('div.stack');
  const label = h('h2.tx-label', 'Тексти');
  let open = false;
  const draw = () => {
    const sel = levelPick('reading');
    const { items, fallback } = filterByLevel(list, sel);
    const read = items.filter(t => progressOf(t.id)).length;
    label.textContent = items.length ? `Тексти · прочитано ${read} з ${items.length}` : 'Тексти';
    const tag = sel === 'all' || !!fallback;
    const sorted = byFit(items);
    const rest = sorted.filter(t => t !== day);   // текст дня — головна дія вгорі
    const shown = open ? sorted : [...rest.filter(t => !progressOf(t.id)), ...rest.filter(t => progressOf(t.id))].slice(0, 6);
    box.replaceChildren(fallbackNote(fallback), txRows([...shown.map(t => row(t, tag)),
      !open && rest.length > 6 ? txRow({ icon: 'caret-down', label: `Показати всі · ${sorted.length}`, chevron: false, cls: 'tx-showall', onclick: () => { open = true; draw(); } }) : null]));
  };
  view.replaceChildren(h('div.stack-lg',
    dayCard,
    h('section.tx-group', label, levelChips('reading', levelCounts(list), () => { open = false; draw(); }), box)));
  draw();
}

/** Питання на розуміння → вправи типу choice (правильний варіант у даних перший, тут перемішуємо) */
function toExercises(t) {
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return t.questions.map(q => ({ type: 'choice', instruction: 'Питання до тексту', prompt: q.q, options: shuffle(q.options), answer: q.options[0], explanation: q.why || null }));
}

function reader(view, t, list) {
  setTitle('Читання');   // назва тексту — один раз, у шапці сторінки нижче
  const timer = activityTimer('reading');
  let playing = false;
  const paras = t.text.map(p => h('p', p));
  const article = h('article.reading-text', { lang: 'en', 'aria-label': `Текст: ${t.title}. Торкніться слова, щоб побачити переклад; стрілки — перехід між словами.` }, paras);
  tappable(article, { glossary: t.glossary, mark: true });

  // «Слухати» — тиха пігулка в шапці тексту (головна дія екрана — «Перевірити розуміння»)
  const playBtn = h('button.rd-listen', { type: 'button', 'aria-pressed': 'false', onclick: togglePlay });
  const paintPlay = () => {
    playBtn.replaceChildren(ic(playing ? 'stop' : 'play', { size: 16, fill: true }), h('span', playing ? 'Зупинити' : 'Слухати'));
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.setAttribute('aria-label', playing ? 'Зупинити читання' : 'Прослухати текст: абзац, що звучить, підсвічується');
  };
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

  const quiz = h('section.tx-group.rd-quiz');
  const p = progressOf(t.id);
  const nQ = t.questions.length;
  const startTile = () => txPrimary({ icon: 'check-circle', label: p ? 'Пройти питання ще раз' : 'Перевірити розуміння',
    sub: `${nQ} ${plural(nQ, 'питання', 'питання', 'питань')} до тексту${progressOf(t.id) ? ` · найкраще: ${progressOf(t.id).best}%` : ''}`, onclick: startQuiz });
  quiz.append(h('h2.tx-label', 'Розуміння'), startTile());

  function startQuiz() {
    timer.poke();
    const box = h('div');
    quiz.replaceChildren(h('h2.tx-label', 'Розуміння'), box);
    runExercises(box, toExercises(t), {
      onDone: (res) => {
        const prev = progressOf(t.id);
        saveProgress(t.id, res.score);
        const idx = list.findIndex(x => x.id === t.id);
        // наступний текст — непрочитаний того самого рівня, інакше наступний у списку
        const next = list.slice(idx + 1).concat(list.slice(0, idx)).find(x => x.level === t.level && !progressOf(x.id)) || list[idx + 1];
        quiz.replaceChildren(resultBlock(res, prev),
          h('section.tx-group',
            next ? sqEmo(txPrimary({ icon: 'book-open', label: 'Наступний текст', sub: `${next.title} · ${next.level} · ${topicLabel(next)}`, href: `#/reading/${next.id}` }), TOPICS[next.topic]?.[1] || 'book-open')
              : txPrimary({ icon: 'book-open', label: 'До текстів', sub: 'Усі тексти вашого рівня', href: '#/reading' }),
            txGrid([
              tx({ icon: 'arrow-clockwise', label: 'Ще раз', sub: 'Ті самі питання', onclick: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); startQuiz(); } }),
              tx({ icon: 'books', label: 'Усі тексти', sub: 'Список за рівнями', href: '#/reading' }),
            ], 2)));
        quiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return false;
      },
    });
    quiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Результат: значок у квадратику + підпис, показники плитками, розбір помилок */
  function resultBlock(res, prev) {
    const tone = res.score >= 80 ? 'good' : res.score >= 50 ? 'warn' : 'bad';
    const caption = res.score === 100 ? 'Усе зрозуміло — чудово!' : res.score >= 80 ? 'Текст зрозуміло добре' : res.score >= 50 ? 'Основне зрозуміло' : 'Варто перечитати текст';
    const wrong = res.results.filter(r => !r.ok);
    return h('div.stack-lg',
      h('section.tx-group',
        txResult({ icon: res.score >= 80 ? 'trophy' : res.score >= 50 ? 'thumbs-up' : 'barbell', tone, label: 'Розуміння тексту', title: caption }),
        txKpis([
          { value: res.score, unit: '%', label: 'розуміння', tone },
          { value: `${res.correct}/${res.total}`, label: 'правильно' },
          { value: Math.max(prev?.best || 0, res.score), unit: '%', label: prev ? 'найкраще' : 'перша спроба', tone: prev && res.score > (prev.best || 0) ? 'good' : null },
        ])),
      wrong.length ? txGroup(`Розбір помилок · ${wrong.length}`, wrong.map(r => h('div.gx-card.rd-miss',
        h('div.rd-miss-q', { lang: 'en' }, r.ex.prompt),
        h('div.rd-miss-a', { lang: 'en' }, h('s.bad', r.given || '—'), ic('arrow-right', { size: 14 }), h('b.good', answerText(r.ex))),
        r.ex.explanation ? h('div.xs.dim', r.ex.explanation) : null)))
        : tx({ wide: true, tone: 'good', icon: 'check-circle', label: 'Без жодної помилки' }));
  }

  const nG = t.glossary.length;
  const glossary = h('details.rd-gloss',
    h('summary.rd-gloss-head', h('span.tx-sq', ic('translate', { size: 18 })),
      h('span.tx-body', h('span.tx-l', 'Словничок'), h('span.tx-s', `${nG} ${plural(nG, 'вираз', 'вирази', 'виразів')} з тексту · торкніться, щоб почути`)),
      ic('caret-down', { size: 18 })),
    h('div.tx-rows.rd-gloss-rows', t.glossary.map(g => txRow({ icon: 'speaker-high', chevron: false, onclick: () => speak(g.en || g.w),
      attrs: { 'aria-label': `Прослухати: ${g.en || g.w} — ${g.uk}` },
      label: h('span', { lang: 'en' }, g.en || g.w, g.ipa ? h('span.ipa.xs', ` ${g.ipa}`) : null), sub: g.uk }))));

  const n = words(t);
  view.replaceChildren(h('div.stack-lg.rd',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/reading', 'aria-label': 'До текстів' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', `${t.level} · ${topicLabel(t)}`), h('h2.gx-lh1', { lang: 'en' }, t.title),
        h('div.small.dim.rd-sub', `${t.titleUk} · ${n} ${plural(n, 'слово', 'слова', 'слів')} · ~${minutes(t)} хв`)),
      p ? txPill(`${p.best}%`, 'good') : null),
    h('section.rd-paper',
      h('div.rd-paper-head', playBtn, h('span.rd-hint', ic('translate', { size: 15 }), 'Торкніться слова — переклад')),
      article),
    glossary,
    quiz));
  return () => { playing = false; stopSpeech(); timer.stop(); };
}
