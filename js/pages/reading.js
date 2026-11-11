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
// «Класика» (2026-11-11): оригінальні оповідання — суспільне надбання (видання Standard Ebooks), текст без змін.
// Каталог — data/stories/index.json (без текстів), кожна історія — data/stories/<id>.json.
export const classicIndex = () => json('data/stories/index.json');
const classicText = (id) => json(`data/stories/${id}.json`);
const isClassic = (id) => String(id).startsWith('classic-');

const TOPICS = {
  life: ['Повсякдення', 'house'], travel: ['Подорожі', 'plane'], food: ['Їжа', 'food'], family: ['Родина', 'users-three'],
  city: ['Місто', 'city'], health: ['Здоров\'я', 'hospital'], culture: ['Культура', 'books'], money: ['Гроші', 'bank'],
  technology: ['Технології', 'phone'], nature: ['Природа', 'seedling'], relationships: ['Стосунки', 'handshake'],
  news: ['Новини', 'chat-centered-text'], opinion: ['Думка', 'bulb'], work: ['Робота', 'briefcase'],
};
const topicLabel = (t) => TOPICS[t.topic]?.[0] || t.topic;

const words = (t) => t.words || t.text.filter(p => !p.startsWith('## ')).join(' ').split(/\s+/).filter(Boolean).length;
const minutes = (t) => Math.max(1, Math.round(words(t) / 130));
const minText = (m) => (m >= 60 ? `${Math.floor(m / 60)} год ${m % 60 ? `${m % 60} хв` : ''}`.trim() : `${m} хв`);

// Де зупинився в довгому тексті: profiles.data.readingPos { id: { i, n, at } } — синхронізується з профілем
const posOf = (id) => store.prof().readingPos?.[id] || null;
function savePos(id, i, n) {
  const all = { ...(store.prof().readingPos || {}) };
  if (all[id]?.i === i) return;
  all[id] = { i, n, at: new Date().toISOString() };
  // не більше 40 записів — найсвіжіші
  const keep = Object.entries(all).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 40);
  store.setProf({ readingPos: Object.fromEntries(keep) });
}
const posPct = (p) => (p && p.n ? Math.min(100, Math.round((p.i + 1) / p.n * 100)) : 0);

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
  if (r.parts[0] === 'library' || String(r.parts[0] || '').startsWith('book-')) {
    const lib = await import('./library.js');
    return lib.default(view, r);
  }
  if (r.parts[0] && isClassic(r.parts[0])) {
    const [idx, t] = await Promise.all([classicIndex().catch(() => []), classicText(r.parts[0]).catch(() => null)]);
    if (t) return reader(view, t, idx);
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Текст не знайдено'), h('a.btn.soft', { href: '#/reading' }, 'До текстів')));
    return;
  }
  const [{ all, list }, classics, books] = await Promise.all([visibleTexts(), classicIndex().catch(() => []), json('data/books/index.json').catch(() => [])]);
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
  // Бібліотека: що читаю зараз (книги й оповідання) + вхід на полицю з фільтром (#/reading/library)
  const bp = (id) => store.prof().books?.[id] || null;
  const nowBooks = books.filter(b => bp(b.id) && (bp(b.id).read || []).length < b.chapters.length)
    .sort((a, b) => String(bp(b.id).at).localeCompare(String(bp(a.id).at))).slice(0, 2);
  const nowStories = classics.filter(t => !progressOf(t.id) && posOf(t.id)?.i > 0)
    .sort((a, b) => String(posOf(b.id).at).localeCompare(String(posOf(a.id).at))).slice(0, nowBooks.length ? 1 : 2);
  const libGroup = books.length || classics.length ? h('section.tx-group', h('h2.tx-label', 'Бібліотека · книги й класика'), txRows([
    ...nowBooks.map(b => { const p = bp(b.id), n = b.chapters.length, cur = Math.min(Math.max(1, p.cur || 1), n);
      return sqEmo(txRow({ icon: 'books', label: h('span', { lang: 'en' }, b.title), sub: `${b.authorUk} · розділ ${cur} з ${n}`, href: `#/reading/${b.id}/${cur}`,
        pill: { text: `${(p.read || []).length}/${n}` }, end: levelTag(b.level) }), 'books'); }),
    ...nowStories.map(t => sqEmo(txRow({ icon: 'book-open', label: h('span', { lang: 'en' }, t.title), sub: `${t.authorUk} · ${t.titleUk}`, href: `#/reading/${t.id}`,
      pill: { text: `${posPct(posOf(t.id))}%` }, end: levelTag(t.level) }), 'books')),
    sqEmo(txRow({ icon: 'books', label: 'Відкрити бібліотеку', sub: `${books.length} ${plural(books.length, 'книга', 'книги', 'книг')} · ${classics.length} ${plural(classics.length, 'оповідання', 'оповідання', 'оповідань')} · фільтр за автором і рівнем`, href: '#/reading/library' }), 'books'),
  ])) : null;
  view.replaceChildren(h('div.stack-lg',
    dayCard,
    libGroup,
    h('section.tx-group', label, levelChips('reading', levelCounts(list), () => { open = false; draw(); }), box)));
  draw();
}

/** Питання на розуміння → вправи типу choice (правильний варіант у даних перший, тут перемішуємо) */
function toExercises(t) {
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return t.questions.map(q => ({ type: 'choice', instruction: 'Питання до тексту', prompt: q.q, options: shuffle(q.options), answer: q.options[0], explanation: q.why || null }));
}

/**
 * Читалка. opts.chapter — розділ книги: { book, k, total, back, prev, next, onEnd } — замість питань унизу навігація між розділами.
 */
export function reader(view, t, list, opts = {}) {
  const ch = opts.chapter || null;
  setTitle('Читання');   // назва тексту — один раз, у шапці сторінки нижче
  const timer = activityTimer('reading');
  let playing = false;
  const classic = isClassic(t.id) && !ch;
  const blocks = t.text.map(p => (p.startsWith('## ') ? h('h3.rd-ch', p.slice(3)) : h('p', p)));
  const paras = blocks.filter(b => b.tagName === 'P');
  const article = h('article.reading-text', { lang: 'en', 'aria-label': `Текст: ${t.title}. Торкніться слова, щоб побачити переклад; стрілки — перехід між словами.` }, blocks);
  tappable(article, { glossary: t.glossary, mark: true });

  // «Слухати» — тиха пігулка в шапці тексту (головна дія екрана — «Перевірити розуміння»)
  const playBtn = h('button.rd-listen', { type: 'button', onclick: togglePlay });
  const paintPlay = () => {
    playBtn.replaceChildren(ic(playing ? 'stop' : 'play', { size: 16, fill: true }), h('span', playing ? 'Зупинити' : 'Слухати'));
    playBtn.classList.toggle('on', playing);
    playBtn.setAttribute('aria-label', playing ? 'Зупинити читання' : 'Прослухати текст: абзац, що звучить, підсвічується');
  };
  paintPlay();
  async function togglePlay() {
    if (playing) { playing = false; stopSpeech(); paras.forEach(p => p.classList.remove('speaking')); paintPlay(); return; }
    playing = true; paintPlay();
    // абзацами: браузерний TTS обриває довгі фрагменти, і видно, що саме звучить
    const from = Math.max(0, topPara());   // довгий текст — з місця, яке зараз на екрані
    for (const p of paras.slice(from)) {
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
  if (t.questions?.length) quiz.append(h('h2.tx-label', 'Розуміння'), startTile());
  else if (ch) {
    quiz.append(
      ch.next ? txPrimary({ icon: 'arrow-right', label: 'Наступний розділ', sub: ch.next.t, href: ch.next.href, onclick: () => ch.onEnd?.() })
        : txPrimary({ icon: 'trophy', label: 'Книгу прочитано', sub: 'Повернутися до змісту', href: ch.back, onclick: () => ch.onEnd?.() }),
      ch.prev ? txGrid([
        tx({ icon: 'arrow-left', label: 'Попередній', sub: ch.prev.t, href: ch.prev.href }),
        tx({ icon: 'list', label: 'Зміст', sub: `${ch.k} з ${ch.total}`, href: ch.back }),
      ], 2) : tx({ wide: true, icon: 'list', label: 'Зміст', sub: `Розділ ${ch.k} з ${ch.total}`, href: ch.back }));
  }

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
        if (classic) savePos(t.id, paras.length - 1, paras.length);
        quiz.replaceChildren(resultBlock(res, prev),
          h('section.tx-group',
            next ? sqEmo(txPrimary({ icon: 'book-open', label: classic ? 'Наступне оповідання' : 'Наступний текст', sub: `${next.title} · ${next.level} · ${classic ? next.authorUk : topicLabel(next)}`, href: `#/reading/${next.id}` }), classic ? 'books' : TOPICS[next.topic]?.[1] || 'book-open')
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

  const nG = (t.glossary || []).length;
  const glossary = h('details.rd-gloss',
    h('summary.rd-gloss-head', h('span.tx-sq', ic('translate', { size: 18 })),
      h('span.tx-body', h('span.tx-l', 'Словничок'), h('span.tx-s', `${nG} ${plural(nG, 'вираз', 'вирази', 'виразів')} з тексту · торкніться, щоб почути`)),
      ic('caret-down', { size: 18 })),
    h('div.tx-rows.rd-gloss-rows', (t.glossary || []).map(g => txRow({ icon: 'speaker-high', chevron: false, onclick: () => speak(g.en || g.w),
      attrs: { 'aria-label': `Прослухати: ${g.en || g.w} — ${g.uk}` },
      label: h('span', { lang: 'en' }, g.en || g.w, g.ipa ? h('span.ipa.xs', ` ${g.ipa}`) : null), sub: g.uk }))));

  // ---- закладка: перший абзац, видимий під шапкою; «Продовжити» — якщо зупинились не на початку ----
  const HEAD = 80;
  function topPara() {
    let lo = 0, hi = paras.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (paras[mid].getBoundingClientRect().bottom > HEAD) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    return ans;
  }
  const goTo = (i) => { const el = paras[Math.min(i, paras.length - 1)]; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - HEAD - 8, behavior: 'smooth' }); };
  const long = paras.length > 12;
  const saved = long ? posOf(t.id) : null;
  const resume = saved && saved.i > 1 && saved.i < paras.length - 1
    ? h('button.rd-resume', { type: 'button', onclick: () => { goTo(saved.i); resume.remove(); } }, ic('book-open', { size: 16 }), h('span', `Продовжити · ${posPct(saved)}%`))
    : null;
  let posTimer = 0, lastI = -1;
  const onScroll = () => {
    if (!long || posTimer) return;
    posTimer = setTimeout(() => {
      posTimer = 0;
      if (!article.isConnected) return;
      const i = topPara();
      if (i !== lastI && (i > 0 || lastI > 0)) { lastI = i; timer.poke?.(); }
    }, 400);
  };
  const flushPos = () => { if (long && lastI > 0) savePos(t.id, lastI, paras.length); };
  const posSaver = long ? setInterval(flushPos, 20000) : 0;
  if (long) window.addEventListener('scroll', onScroll, { passive: true });

  const n = words(t);
  view.replaceChildren(h('div.stack-lg.rd',
    h('div.gx-lhead', h('a.icon-btn', { href: ch ? ch.back : classic ? '#/reading/library' : '#/reading', 'aria-label': ch ? 'До змісту' : 'До текстів' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', ch ? `${ch.book.title} · ${ch.k} з ${ch.total}` : classic ? `${t.level} · ${t.authorUk}` : `${t.level} · ${topicLabel(t)}`), h('h2.gx-lh1', { lang: 'en' }, t.title),
        h('div.small.dim.rd-sub', ch ? `${ch.book.authorUk} · ${n} ${plural(n, 'слово', 'слова', 'слів')} · ~${minText(minutes(t))}`
          : `${t.titleUk} · ${classic ? `${t.year} · ` : ''}${n} ${plural(n, 'слово', 'слова', 'слів')} · ~${minText(minutes(t))}`)),
      p ? txPill(`${p.best}%`, 'good') : null),
    h('section.rd-paper',
      h('div.rd-paper-head', playBtn, resume || h('span.rd-hint', ic('translate', { size: 15 }), 'Торкніться слова — переклад')),
      article,
      classic || ch ? h('p.rd-src', `${(ch ? ch.book : t).author}, ${(ch ? ch.book : t).year}${(ch ? ch.book : t).note ? ` · ${(ch ? ch.book : t).note}` : ''}. Текст — суспільне надбання; видання Standard Ebooks.`) : null),
    nG ? glossary : null,
    quiz));
  // розділ книги вважається прочитаним, коли кінець тексту з'явився на екрані
  if (ch?.onEnd) {
    const end = article.lastElementChild;
    if (end && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); ch.onEnd(); } }, { threshold: 0.6 });
      io.observe(end);
    }
  }
  return () => { playing = false; stopSpeech(); timer.stop(); window.removeEventListener('scroll', onScroll); clearTimeout(posTimer); clearInterval(posSaver); flushPos(); };
}
