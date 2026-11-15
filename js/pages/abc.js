// Алфавіт і звуки (#/abc) — для тих, хто починає з нуля (рівень A0):
// #/abc — чотири розділи; /letters — 26 літер з назвою (МФА) і словом; /sounds — ключові звуки й написання для українців;
// /read — 20 вправ на читання за правилами; /spell — спелінг: слово на слух, слово по літерах, своє ім'я.
// Вимова й МФА — британські (озвучення з accent 'UK'). Прогрес — profiles.data.abc { seen: { розділ: дата }, read: [id], spell: { best } }.
import { h, ic } from '../ui/dom.js';
import { json } from '../data.js';
import * as store from '../store.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle } from '../ui/shell.js';
import { tx, txPrimary, txRow, txRows, txGroup, txPill, txKpis, txGrid } from '../ui/tiles.js';
import { moreRows } from './grammar.js';
import { activityTimer } from '../stats.js';

const SECTIONS = [
  { id: 'letters', label: 'Алфавіт', sub: '26 літер: назва і слово', icon: 'text-aa' },
  { id: 'sounds', label: 'Звуки', sub: 'Що звучить не так, як в українській', icon: 'ear' },
  { id: 'read', label: 'Читаємо', sub: '20 вправ від простого до складного', icon: 'book-open' },
  { id: 'spell', label: 'Спелінг', sub: 'Слово на слух, по літерах, своє ім\'я', icon: 'keyboard' },
];
const TITLES = { letters: 'Алфавіт', sounds: 'Звуки', read: 'Читаємо', spell: 'Спелінг' };

const UK = { accent: 'UK' };
const say = (t, o = {}) => speak(t, { ...UK, ...o });

// ---------- прогрес ----------
const abc = () => store.prof().abc || {};
function saveAbc(patch) { store.setProf({ abc: { ...abc(), ...patch } }); }
function markSeen(id) {
  const seen = abc().seen || {};
  if (!seen[id]) saveAbc({ seen: { ...seen, [id]: new Date().toISOString() } });
}
function markRead(id) {
  const read = abc().read || [];
  if (!read.includes(id)) saveAbc({ read: [...read, id] });
}

export default async function abcPage(view, r) {
  const data = await json('data/abc.json');
  const timer = activityTimer('pronunciation');
  const sec = SECTIONS.find(s => s.id === r.parts[0]);
  let cleanup = null;
  if (!sec) hub(view);
  else {
    setTitle(TITLES[sec.id]);
    markSeen(sec.id);
    const body = h('div.stack-lg');
    view.replaceChildren(h('div.stack-lg.abc',
      h('div.gx-lhead', h('a.icon-btn', { href: '#/abc', 'aria-label': 'Алфавіт і звуки' }, ic('arrow-left')),
        h('div.grow', h('h1.tx-label.gx-eyebrow', `Алфавіт і звуки · ${sec.label}`))),
      body));
    cleanup = ({ letters, sounds, read, spell })[sec.id](body, data, timer);
  }
  return () => { stopSpeech(); timer.stop(); cleanup?.(); };
}

// ---------- головна розділу ----------
function hub(view) {
  setTitle('Алфавіт і звуки');
  const seen = abc().seen || {};
  const next = SECTIONS.find(s => !seen[s.id]);
  const done = SECTIONS.filter(s => seen[s.id]).length;
  view.replaceChildren(h('div.stack-lg.abc',
    next ? txPrimary({ icon: 'play', label: done ? `Далі: ${next.label}` : 'Почати з алфавіту', sub: next.sub, href: `#/abc/${next.id}` })
      : txPrimary({ icon: 'keyboard', label: 'Потренувати спелінг', sub: 'Слово на слух і по літерах', href: '#/abc/spell' }),
    txGroup('Розділи', txRows(SECTIONS.map((s, k) => txRow({
      no: k + 1, label: s.label, sub: s.sub, href: `#/abc/${s.id}`,
      pill: seen[s.id] ? { text: s.id === 'read' ? readPill() : 'Переглянуто', tone: 'good' } : null,
    })))),
    txGroup('Далі', txRows([txRow({ icon: 'puzzle-piece', label: 'Граматика з нуля', sub: 'Привіт! Я… — перші уроки', href: '#/grammar' })]))));
}
const readPill = () => { const n = (abc().read || []).length; return n ? `${n} з 20` : 'Переглянуто'; };

// ---------- Алфавіт ----------
function letters(box, data) {
  let playing = 0;
  const allTile = tx({ wide: true, icon: 'speaker-high', label: 'Слухати весь алфавіт', sub: 'A, B, C… по черзі', onclick: () => playAll() });
  const lab = () => allTile.querySelector('.tx-l');
  async function playAll() {
    if (playing) { playing = 0; stopSpeech(); lab().textContent = 'Слухати весь алфавіт'; mark(null); return; }
    const my = playing = Date.now();
    lab().textContent = 'Зупинити';
    for (const L of data.letters) {
      if (playing !== my || !box.isConnected) break;
      mark(L.l);
      await say(L.say, { rate: 0.85 });
      await new Promise(res => setTimeout(res, 250));
    }
    if (playing === my) { playing = 0; lab().textContent = 'Слухати весь алфавіт'; mark(null); }
  }
  const tiles = new Map();
  const mark = (l) => tiles.forEach((el, k) => el.classList.toggle('playing', k === l));
  const vowels = new Set(data.vowels.split(''));
  const grid = h('div.abc-grid', data.letters.map(L => {
    const el = h('button.tx.abc-l' + (vowels.has(L.l) ? '.vowel' : ''), { type: 'button', lang: 'en',
      'aria-label': `${L.l}, ${L.ipa}, ${L.word} — ${L.uk}`,
      onclick: async () => { playing = 0; lab().textContent = 'Слухати весь алфавіт'; mark(L.l); await say(L.say, { rate: 0.85 }); await say(L.word); mark(null); } },
      h('span.abc-big', L.l, h('small', L.l.toLowerCase())),
      h('span.abc-ipa', L.ipa),
      h('span.abc-w', L.word));
    tiles.set(L.l, el);
    return el;
  }));
  box.replaceChildren(
    allTile,
    txGroup('26 літер', [grid, h('div.xs.dim.abc-note', 'Голосні — A, E, I, O, U (виділені). Торкніться літери: назва, потім слово.')]),
    h('div.tx.wide.gx-tip', h('span.tx-sq', ic('lightbulb', { size: 20 })), h('div.tx-body.small', data.tip)));
  return () => { playing = 0; };
}

// ---------- Звуки ----------
function sounds(box, data) {
  box.replaceChildren(txGroup(`Звуки · ${data.sounds.length}`, moreRows(data.sounds.map(s => h('details.gx-sound.abc-sound',
    h('summary.gx-sound-head',
      h('span.gx-ipa', { style: { fontSize: s.ipa.length > 4 ? '12px' : '18px' } }, s.ipa),
      h('span.tx-body', h('span.tx-l', s.title), h('span.tx-s', { lang: 'en' }, s.spell)),
      ic('caret-down', { size: 16 })),
    h('div.stack.gx-sound-body',
      h('div.small', s.tip),
      h('div.chips', s.words.map(w => h('button.chip', { type: 'button', lang: 'en', onclick: () => say(w) }, ic('speaker-high', { size: 16 }), w)))))))));
}

// ---------- Читаємо ----------
function read(box, data) {
  const done = new Set(abc().read || []);
  const first = Math.max(0, data.read.findIndex(d => !done.has(d.id)));
  const shown = new Set(data.read.map((_, i) => i).slice(Math.min(first, data.read.length - 6), Math.min(first, data.read.length - 6) + 6));
  const items = data.read.map((d, k) => {
    const pill = h('span.abc-pill', done.has(d.id) ? txPill('✓', 'good') : null);
    const el = h('details.gx-sound.abc-drill', {
      ontoggle: (e) => { if (e.currentTarget.open && !done.has(d.id)) { done.add(d.id); markRead(d.id); pill.replaceChildren(txPill('✓', 'good')); } } },
      h('summary.gx-sound-head',
        h('span.tx-no', String(k + 1)),
        h('span.tx-body', h('span.tx-l', d.title), h('span.tx-s', d.rule)),
        pill,
        ic('caret-down', { size: 16 })),
      h('div.stack.gx-sound-body',
        h('div.xs.dim', 'Прочитайте самі, потім торкніться — перевірте.'),
        h('div.abc-words', d.words.map(w => h('button.abc-word', { type: 'button', lang: 'en', onclick: () => say(w) }, w))),
        h('button.tx-row.abc-sent', { type: 'button', lang: 'en', onclick: () => say(d.sentence, { rate: 0.85 }) },
          h('span.tx-sq', ic('speaker-high', { size: 18 })), h('span.tx-body', h('span.tx-l', d.sentence), h('span.tx-s', 'Речення — прочитайте й прослухайте')))));
    return el;
  });
  box.replaceChildren(txGroup(`Вправи · ${done.size} з ${data.read.length}`, moreRows(items, shown)));
}

// ---------- Спелінг ----------
function spell(box, data) {
  let alive = true;
  const menu = () => {
    const best = abc().spell || {};
    box.replaceChildren(
      txGroup('Тренування', txGrid([
        tx({ icon: 'speaker-high', label: 'Слово на слух', sub: best.ear != null ? `Найкраще: ${best.ear} з 10` : 'Почуйте й напишіть', onclick: () => game('ear') }),
        tx({ icon: 'text-aa', label: 'По літерах', sub: best.letters != null ? `Найкраще: ${best.letters} з 10` : 'D-O-G → dog', onclick: () => game('letters') }),
      ], 2)),
      txGroup('Ваше ім\'я', nameBlock()));
  };

  // «How do you spell your name?» — ім'я латиницею по літерах (кирилицю транслітеруємо)
  function nameBlock() {
    const prof = store.prof().about || {};
    const inp = h('input.input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': 'Ваше ім\'я', placeholder: 'Ваше ім\'я', value: translit(prof.name || '') });
    const out = h('div.abc-name', { lang: 'en', 'aria-live': 'polite' });
    const draw = () => {
      const L = latin(inp.value);
      out.replaceChildren(...L.split('').map(ch => {
        const x = data.letters.find(l => l.l === ch.toUpperCase());
        return h('button.abc-chip', { type: 'button', onclick: () => say(x.say, { rate: 0.85 }) }, h('b', ch.toUpperCase()), h('small', x.ipa));
      }));
    };
    inp.addEventListener('input', draw);
    draw();
    const play = async () => {
      const L = latin(inp.value);
      if (!L) { inp.focus(); return; }
      for (const ch of L) {
        if (!alive) return;
        await say(data.letters.find(l => l.l === ch.toUpperCase()).say, { rate: 0.85 });
        await new Promise(res => setTimeout(res, 200));
      }
    };
    return h('div.gx-card.stack.abc-namecard',
      h('div.small', h('span', { lang: 'en' }, '— How do you spell your name?'), h('br'), h('span.dim', 'Назвіть ім\'я по літерах.')),
      inp, out,
      h('button.btn.primary.block', { type: 'button', onclick: play }, ic('speaker-high', { size: 18 }), 'Прослухати по літерах'));
  }

  // гра: 10 слів; ear — слово цілком, letters — по літерах
  function game(mode) {
    const words = shuffle(data.spell).slice(0, 10);
    let i = 0, ok = 0;
    const count = txPill('', 'accent');
    count.classList.add('num');
    const stage = h('div.stack');
    box.replaceChildren(h('div.stack-lg',
      h('div.ex-head', h('div.ex-head-t', h('h2.tx-label', mode === 'ear' ? 'Слово на слух' : 'По літерах'), count)),
      stage));
    const playWord = async (w, slow) => {
      if (mode === 'ear') return say(w, { rate: slow ? 0.6 : 0.9 });
      for (const ch of w) {
        if (!alive) return;
        await say(data.letters.find(l => l.l === ch.toUpperCase()).say, { rate: slow ? 0.7 : 0.9 });
        await new Promise(res => setTimeout(res, slow ? 400 : 200));
      }
    };
    const round = () => {
      if (i >= words.length) return finish();
      const w = words[i];
      count.textContent = `${i + 1}/${words.length}`;
      const inp = h('input.input.abc-input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Слово', placeholder: 'Напишіть слово', lang: 'en' });
      const fb = h('div', { role: 'status', 'aria-live': 'polite' });
      const nextBtn = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: () => { i++; round(); } }, 'Далі', ic('arrow-right', { size: 18 }));
      let answered = false;
      const check = () => {
        if (answered || !inp.value.trim()) return;
        answered = true;
        const right = inp.value.trim().toLowerCase().replace(/[^a-z]/g, '') === w;
        if (right) ok++;
        inp.disabled = true; checkBtn.hidden = true; nextBtn.hidden = false; nextBtn.focus({ preventScroll: true });
        fb.replaceChildren(h('div.feedback.ex-fb.' + (right ? 'ok' : 'no'),
          h('span.ex-fb-ic', ic(right ? 'check-circle' : 'x-circle', { size: 20, fill: true })),
          h('div.ex-fb-t', h('div', { style: { fontWeight: 600 } }, right ? 'Правильно!' : 'Правильно: ', right ? null : h('span', { lang: 'en' }, w)),
            h('div.dim', { lang: 'en' }, w.toUpperCase().split('').join(' – ')))));
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); answered ? (i++, round()) : check(); } });
      const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: check }, 'Перевірити');
      stage.replaceChildren(
        h('div.pr-acts.abc-acts',
          h('button.pr-act', { type: 'button', onclick: () => playWord(w) }, ic('speaker-high', { size: 18 }), h('span', 'Прослухати')),
          h('button.pr-act', { type: 'button', onclick: () => playWord(w, true) }, ic('hourglass', { size: 18 }), h('span', 'Повільно'))),
        inp, checkBtn, fb, nextBtn);
      inp.focus({ preventScroll: true });
      playWord(w);
    };
    const finish = () => {
      const best = abc().spell || {};
      if (ok > (best[mode] ?? -1)) saveAbc({ spell: { ...best, [mode]: ok } });
      const tone = ok >= 8 ? 'good' : ok >= 5 ? 'warn' : 'bad';
      stage.replaceChildren(h('div.stack-lg',
        txKpis([{ value: ok, unit: '/10', label: 'правильно', tone }, { value: 10 - ok, label: 'помилки', tone: ok === 10 ? 'good' : 'bad' }], 2),
        txPrimary({ icon: 'arrow-clockwise', label: 'Ще 10 слів', sub: mode === 'ear' ? 'Слово на слух' : 'По літерах', onclick: () => game(mode) }),
        tx({ wide: true, icon: 'arrow-left', label: 'До спелінгу', onclick: menu })));
    };
    round();
  }
  menu();
  return () => { alive = false; };
}

const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const latin = (s) => translit(s).replace(/[^a-z]/gi, '').slice(0, 20);
// офіційна транслітерація (КМУ 2010), спрощено: на початку слова є/ї/й/ю/я — ye/yi/y/yu/ya
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', 'ʼ': '', '’': '' };
const START = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
function translit(s) {
  return String(s || '').split(/(\s+)/).map(w => [...w].map((c, k) => {
    const lc = c.toLowerCase();
    const t = (k === 0 && START[lc]) || TR[lc];
    if (t == null) return c;
    return c !== lc && t ? t[0].toUpperCase() + t.slice(1) : t;
  }).join('')).join('');
}
