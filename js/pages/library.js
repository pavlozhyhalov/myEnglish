// Бібліотека (2026-11-11, власник: «роби повні книжки… нормальний фільтр — по автору, по алфавіту, по рівню»).
// Книги й оповідання — суспільне надбання, текст без змін (видання Standard Ebooks). Маршрути:
//   #/reading/library — полиця з фільтром (книги · оповідання, автор, рівень, сортування);
//   #/reading/book-<id> — зміст книги; #/reading/book-<id>/<n> — розділ (читалка з reading.js).
// Дані: data/books/index.json (каталог + розділи), data/books/<id>/<n>.json (розділ), data/books/<id>/glossary.json (словничок книги).
// Прогрес книги — profiles.data.books { 'book-<id>': { read: [n…], cur, at } }; місце в розділі — readingPos (як в оповіданнях).
import { h, ic, emo } from '../ui/dom.js';
import { plural } from '../strings.js';
import { json } from '../data.js';
import * as store from '../store.js';
import { setTitle } from '../ui/shell.js';
import { sheet } from '../ui/sheet.js';
import { levelTag, myLevel } from '../level.js';
import { tx, txPrimary, txRow, txRows, txGroup, txBar, txPill } from '../ui/tiles.js';
import { reader, classicIndex } from './reading.js';

export const bookIndex = () => json('data/books/index.json');
const chapterOf = (bid, n) => json(`data/books/${bid}/${n}.json`);
const glossaryOf = (bid) => json(`data/books/${bid}/glossary.json`).catch(() => []);
const short = (id) => id.replace(/^book-/, '');

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const mins = (w) => Math.max(1, Math.round(w / 130));
const dur = (w) => { const m = mins(w); return m >= 60 ? `${Math.round(m / 60)} год` : `${m} хв`; };

// ---------- прогрес ----------
export const bookProg = (id) => store.prof().books?.[id] || null;
function markRead(id, n, total) {
  const all = { ...(store.prof().books || {}) };
  const p = all[id] || { read: [] };
  const read = new Set(p.read || []);
  if (read.has(n) && p.cur === Math.min(n + 1, total)) return;
  read.add(n);
  all[id] = { read: [...read].sort((a, b) => a - b), cur: Math.min(n + 1, total), at: new Date().toISOString() };
  store.setProf({ books: all });
}
function markOpen(id, n) {
  const all = { ...(store.prof().books || {}) };
  const p = all[id] || { read: [] };
  if (p.cur === n && p.at && Date.now() - Date.parse(p.at) < 60000) return;
  all[id] = { ...p, read: p.read || [], cur: n, at: new Date().toISOString() };
  store.setProf({ books: all });
}
const readCount = (b) => (bookProg(b.id)?.read || []).filter(n => n <= b.chapters.length).length;
const storyDone = (id) => store.prof().reading?.[id] || null;
const storyPos = (id) => store.prof().readingPos?.[id] || null;

// ---------- фільтр (запам'ятовується на пристрої) ----------
const LKEY = 'me:lib';
const DEF = { kind: 'books', author: 'all', level: 'all', sort: 'level' };
const loadF = () => { try { return { ...DEF, ...(JSON.parse(localStorage.getItem(LKEY)) || {}) }; } catch { return { ...DEF }; } };
const saveF = (f) => { try { localStorage.setItem(LKEY, JSON.stringify(f)); } catch {} };

/** Кнопка-вибір зі шторкою (як у «Налаштуваннях») */
function picker(title, options, value, onChange) {
  const label = () => (options.find(([v]) => v === value) || options[0])[1];
  const btn = h('button.set-pick.lib-pick', { type: 'button', 'aria-haspopup': 'dialog' });
  const paint = () => { btn.replaceChildren(h('span.lib-pick-t', title), h('span.set-pick-v', label()), ic('caret-down', { size: 14 })); btn.setAttribute('aria-label', `${title}: ${label()}`); };
  paint();
  btn.onclick = () => {
    const s = sheet(title, h('div.tx-rows.set-pick-list', { role: 'radiogroup', 'aria-label': title }, options.map(([v, t, sub]) => {
      const on = v === value;
      return h('button.tx-row.set-pick-opt' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(on),
        onclick: () => { value = v; paint(); onChange(v); s.close(); } },
        h('span.tx-body', h('span.tx-l', t), sub ? h('span.tx-s', sub) : null), on ? ic('check', { size: 18 }) : null);
    })));
  };
  return btn;
}

// ---------- рядки ----------
function bookRow(b) {
  const p = bookProg(b.id), n = b.chapters.length, done = readCount(b);
  const pill = done >= n ? { text: 'Прочитано', tone: 'good' } : done || p?.cur > 1 ? { text: `${done}/${n}` } : null;
  return txRow({ icon: 'books', label: h('span', { lang: 'en' }, b.title), sub: `${b.authorUk} · ${b.titleUk} · ${n} ${plural(n, 'розділ', 'розділи', 'розділів')} · ~${dur(b.words)}`,
    href: `#/reading/${b.id}`, pill, end: levelTag(b.level),
    attrs: { title: `${b.author}, ${b.year} · ${b.words} слів${done ? ` · прочитано ${done} з ${n} розділів` : ''}` } });
}
function storyRow(t) {
  const p = storyDone(t.id), pos = storyPos(t.id);
  const pill = p ? { text: `${p.best}%`, tone: 'good' } : pos && pos.i > 0 && pos.n ? { text: `${Math.min(100, Math.round((pos.i + 1) / pos.n * 100))}%` } : null;
  return txRow({ icon: 'book-open', label: h('span', { lang: 'en' }, t.title), sub: `${t.authorUk} · ${t.titleUk} · ~${dur(t.words)}`,
    href: `#/reading/${t.id}`, pill, end: levelTag(t.level), attrs: { title: `${t.author}, ${t.year} · ${t.words} слів` } });
}
const surname = (a) => String(a).replace(/^(.*\s)?([^\s]+)$/, '$2');

// ---------- полиця ----------
async function library(view) {
  setTitle('Бібліотека');
  const [books, stories] = await Promise.all([bookIndex().catch(() => []), classicIndex().catch(() => [])]);
  const f = loadF();
  const listBox = h('div.stack-lg');
  const controls = h('div.lib-controls');

  const draw = () => {
    saveF(f);
    const items = f.kind === 'books' ? books : stories;
    const authors = [...new Map(items.map(x => [x.author, x.authorUk])).entries()].sort((a, b) => surname(a[1]).localeCompare(surname(b[1]), 'uk'));
    if (f.author !== 'all' && !authors.some(([a]) => a === f.author)) f.author = 'all';
    const levels = LEVELS.filter(l => items.some(x => x.level === l));
    if (f.level !== 'all' && !levels.includes(f.level)) f.level = 'all';

    controls.replaceChildren(
      h('div.seg.lib-kind', { role: 'group', 'aria-label': 'Що показати' }, [['books', `Книги · ${books.length}`], ['stories', `Оповідання · ${stories.length}`]].map(([v, t]) =>
        h('button', { type: 'button', 'aria-pressed': String(f.kind === v), onclick: () => { f.kind = v; draw(); } }, t))),
      h('div.chips.scroll.lib-levels', { role: 'group', 'aria-label': 'Рівень' }, [['all', 'Усі рівні'], ...levels.map(l => [l, l === myLevel() ? `${l} · мій` : l])].map(([v, t]) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(f.level === v), onclick: () => { f.level = v; draw(); } }, t))),
      h('div.lib-row',
        picker('Автор', [['all', 'Усі автори'], ...authors.map(([a, uk]) => [a, uk, `${items.filter(x => x.author === a).length} · ${a}`])], f.author, (v) => { f.author = v; draw(); }),
        picker('Порядок', [['level', 'За рівнем', 'від легких до складних'], ['author', 'За автором', 'за прізвищем, А–Я'], ['title', 'За назвою', 'англійська назва, A–Z']], f.sort, (v) => { f.sort = v; draw(); })));

    let list = items.filter(x => (f.author === 'all' || x.author === f.author) && (f.level === 'all' || x.level === f.level));
    const byTitle = (a, b) => a.title.replace(/^(The|A|An)\s+/i, '').localeCompare(b.title.replace(/^(The|A|An)\s+/i, ''), 'en');
    const row = f.kind === 'books' ? bookRow : storyRow;
    const groups = [];
    if (!list.length) groups.push(h('p.small.dim.lib-empty', 'Нічого не знайдено — змініть фільтр.'));
    else if (f.sort === 'title') groups.push(txGroup(`${list.length} · A–Z`, txRows(list.sort(byTitle).map(row))));
    else if (f.sort === 'author') {
      for (const [a, uk] of authors) {
        const xs = list.filter(x => x.author === a).sort((p, q) => LEVELS.indexOf(p.level) - LEVELS.indexOf(q.level) || byTitle(p, q));
        if (xs.length) groups.push(txGroup(`${uk} · ${xs.length}`, txRows(xs.map(row))));
      }
    } else {
      for (const l of LEVELS) {
        const xs = list.filter(x => x.level === l).sort(byTitle);
        if (xs.length) groups.push(txGroup(`${l}${l === myLevel() ? ' · ваш рівень' : ''} · ${xs.length}`, txRows(xs.map(row))));
      }
    }
    // «Читаю зараз» — над полицею, лише без фільтра автора
    const now = f.kind === 'books'
      ? books.filter(b => bookProg(b.id) && readCount(b) < b.chapters.length).sort((a, b) => String(bookProg(b.id).at).localeCompare(String(bookProg(a.id).at)))
      : stories.filter(t => !storyDone(t.id) && storyPos(t.id)?.i > 0).sort((a, b) => String(storyPos(b.id).at).localeCompare(String(storyPos(a.id).at)));
    listBox.replaceChildren(
      now.length && f.author === 'all' && f.level === 'all' ? txGroup('Читаю зараз', txRows(now.slice(0, 3).map(row))) : '',
      ...groups);
  };

  view.replaceChildren(h('div.stack-lg.lib',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/reading', 'aria-label': 'До читання' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', 'Читання'), h('h2.gx-lh1', 'Бібліотека'),
        h('div.small.dim.rd-sub', `${books.length} ${plural(books.length, 'книга', 'книги', 'книг')} і ${stories.length} ${plural(stories.length, 'оповідання', 'оповідання', 'оповідань')} — оригінали, суспільне надбання`))),
    controls, listBox));
  draw();
}

// ---------- зміст книги ----------
async function bookPage(view, b) {
  setTitle('Бібліотека');
  const p = bookProg(b.id), n = b.chapters.length, done = readCount(b);
  const cur = Math.min(Math.max(1, p?.cur || 1), n);
  const started = !!p;
  const read = new Set(p?.read || []);
  const curCh = b.chapters[cur - 1];
  const primary = done >= n
    ? txPrimary({ icon: 'arrow-clockwise', label: 'Читати знову', sub: `Розділ 1 · ${b.chapters[0].t}`, href: `#/reading/${b.id}/1` })
    : txPrimary({ icon: 'book-open', label: started ? `Продовжити · розділ ${cur}` : 'Почати читати', sub: `${curCh.t} · ~${dur(curCh.w)}`, href: `#/reading/${b.id}/${cur}` });
  const rows = b.chapters.map((c, i) => {
    const k = i + 1;
    return txRow({ no: k, label: h('span', { lang: 'en' }, c.t), sub: `~${dur(c.w)}`, href: `#/reading/${b.id}/${k}`, on: k === cur && done < n,
      pill: read.has(k) ? { text: '✓', tone: 'good' } : null });
  });
  view.replaceChildren(h('div.stack-lg.lib',
    h('div.gx-lhead', h('a.icon-btn', { href: '#/reading/library', 'aria-label': 'До бібліотеки' }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', `${b.level} · ${b.authorUk}`), h('h2.gx-lh1', { lang: 'en' }, b.title),
        h('div.small.dim.rd-sub', `${b.titleUk} · ${b.year} · ${n} ${plural(n, 'розділ', 'розділи', 'розділів')} · ~${dur(b.words)}`))),
    primary,
    done ? h('div.lib-prog', h('span.small', `Прочитано ${done} з ${n}`), txBar(done / n, true)) : null,
    txGroup('Зміст', txRows(rows)),
    h('p.rd-src', `${b.author}, ${b.year}${b.note ? ` · ${b.note}` : ''}. Текст — суспільне надбання; видання Standard Ebooks.`)));
}

// ---------- розділ ----------
async function chapterPage(view, b, k) {
  const bid = short(b.id);
  const n = b.chapters.length;
  const [c, gl] = await Promise.all([chapterOf(bid, k), glossaryOf(bid)]);
  const low = c.text.join(' ').toLowerCase();
  // словничок — лише слова, що є в цьому розділі (так регулярка в wordtap лишається малою)
  const glossary = gl.filter(g => g.w && low.includes(g.w.toLowerCase()) && new RegExp(`(^|[^a-z])${g.w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(low));
  markOpen(b.id, k);
  const t = { id: `${b.id}/${k}`, level: b.level, title: c.t, text: c.text, glossary, questions: [] };
  return reader(view, t, [], {
    chapter: {
      book: b, k, total: n, back: `#/reading/${b.id}`,
      prev: k > 1 ? { t: b.chapters[k - 2].t, href: `#/reading/${b.id}/${k - 1}` } : null,
      next: k < n ? { t: b.chapters[k].t, href: `#/reading/${b.id}/${k + 1}` } : null,
      onEnd: () => markRead(b.id, k, n),
    },
  });
}

export default async function libraryRoute(view, r) {
  if (r.parts[0] === 'library') return library(view);
  const books = await bookIndex().catch(() => []);
  const b = books.find(x => x.id === r.parts[0]);
  if (!b) {
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Книгу не знайдено'), h('a.btn.soft', { href: '#/reading/library' }, 'До бібліотеки')));
    return;
  }
  const k = Number(r.parts[1]);
  if (k >= 1 && k <= b.chapters.length) return chapterPage(view, b, k);
  return bookPage(view, b);
}
