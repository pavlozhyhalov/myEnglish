// «Слово дня»: вгадати англійське слово з 5 літер за 6 спроб (зелений — на місці, жовтий — є в слові, сірий — немає).
// Щоденна загадка однакова для дня й рівня; тренування — без обмежень. Після гри — значення, вимова, приклад.
import { h, ic } from '../ui/dom.js';
import { deck } from '../data.js';
import { myLevel } from '../level.js';
import { activityTimer, today, dayKey } from '../stats.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { scoreGuess, keyStates, isWon, shareText, validSet, answersFor, pickBy, bareWord, updateWordleStats } from './logic.js';
import { words5, gameState, saveGameState, beep, buzz, reducedMotion, addWordButton, gameHead, learningCards } from './common.js';

const MAX = 6, LEN = 5;
const ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
const STATE_UK = { g: 'на місці', y: 'є в слові, але не тут', b: 'немає в слові' };

export default async function wordle(view, r) {
  const practice = r.query.mode === 'practice';
  setTitle(practice ? 'Слово дня · тренування' : 'Слово дня');
  const data = await words5();
  const valid = validSet(data.valid);
  const lv = myLevel();
  const answers = answersFor(data, lv).filter(a => valid.has(a.w));
  const key = `${today()}|${lv}`;
  const timer = activityTimer('game');
  let disposed = false;

  // ---------- вибір слова ----------
  let entry, rows = [], hint = false, done = false;
  const st = gameState();
  if (!practice) {
    entry = pickBy(answers, `${key}|wordle`);
    const saved = st.wordleDay?.[key];
    if (saved && saved.answer === entry.w) { rows = saved.rows || []; hint = !!saved.hint; done = !!saved.done; }
  } else {
    const recent = new Set(st.wordleRecent || []);
    // спершу — свої слова, що вчаться (5 літер, є в словнику)
    const own = learningCards().map(c => ({ c, w: bareWord(c.en) })).filter(o => /^[a-z]{5}$/.test(o.w) && valid.has(o.w) && !recent.has(o.w));
    if (own.length && Math.random() < 0.5) {
      const o = own[Math.floor(Math.random() * own.length)];
      entry = { w: o.w, level: lv, uk: o.c.uk, ipa: o.c.ipa, ex: o.c.ex, exUk: o.c.exUk, en: o.c.en };
    } else {
      const fresh = answers.filter(a => !recent.has(a.w));
      const list = fresh.length ? fresh : answers;
      entry = list[Math.floor(Math.random() * list.length)];
    }
    saveGameState({ wordleRecent: [entry.w, ...(st.wordleRecent || [])].slice(0, 40) });
  }
  const answer = entry.w;
  let info = null;   // { en, uk, ipa, ex, exUk }
  const infoP = (async () => {
    if (entry.uk) return { en: entry.en || entry.w, uk: entry.uk, ipa: entry.ipa, ex: entry.ex, exUk: entry.exUk || '' };
    try {
      const d = await deck(entry.deck);
      const c = d.cards.find(x => bareWord(x.en) === answer);
      if (c) return { en: c.en, uk: c.uk, ipa: c.ipa || '', ex: c.ex || '', exUk: c.exUk || '' };
    } catch { /* офлайн без кешу колоди */ }
    return { en: answer, uk: '', ipa: '', ex: '', exUk: '' };
  })().then(x => (info = x));

  // ---------- розмітка ----------
  const live = h('div.sr-only', { 'aria-live': 'polite', role: 'status' });
  const tiles = [];
  const board = h('div.wd-board', { role: 'grid', 'aria-label': 'Поле спроб' },
    Array.from({ length: MAX }, (_, i) => h('div.wd-row', { role: 'row', 'aria-label': `Спроба ${i + 1}` },
      (tiles[i] = Array.from({ length: LEN }, () => h('div.wd-tile', { role: 'gridcell' }))))));
  const keys = {};
  const kb = h('div.wd-kb', { role: 'group', 'aria-label': 'Клавіатура' }, ROWS.map(row => h('div.wd-kb-row', [...row].map(ch => {
    if (ch === '+') return h('button.wd-key.wide', { type: 'button', 'aria-label': 'Перевірити слово', onclick: submit }, 'Ввід');
    if (ch === '-') return h('button.wd-key.wide', { type: 'button', 'aria-label': 'Стерти літеру', onclick: back }, ic('backspace', { size: 22 }));
    return (keys[ch] = h('button.wd-key', { type: 'button', 'aria-label': ch.toUpperCase(), onclick: () => type(ch) }, ch));
  }))));
  const hintBox = h('div.wd-hint');
  const result = h('div.wd-result');
  view.replaceChildren(h('div.stack.games.wd',
    gameHead(h('span.tag', lv)),
    board, hintBox, result, kb, live));
  setFocus(true);

  let cur = '';
  const drawRow = (i, word, score, animate = false) => {
    tiles[i].forEach((t, j) => {
      const ch = word[j] || '';
      t.textContent = ch.toUpperCase();
      t.classList.toggle('filled', !!ch);
      t.classList.remove('g', 'y', 'b');
      if (score) {
        const apply = () => { t.classList.add(score[j]); t.setAttribute('aria-label', `${ch.toUpperCase()} — ${STATE_UK[score[j]]}`); };
        if (animate && !reducedMotion()) { t.style.animationDelay = `${j * 110}ms`; t.classList.add('flip'); setTimeout(apply, j * 110 + 160); }
        else apply();
      } else t.setAttribute('aria-label', ch ? ch.toUpperCase() : 'порожньо');
    });
  };
  const drawKeys = () => {
    const ks = keyStates(rows);
    for (const [ch, b] of Object.entries(keys)) {
      b.classList.remove('g', 'y', 'b');
      if (ks[ch]) b.classList.add(ks[ch]);
      b.setAttribute('aria-label', ch.toUpperCase() + (ks[ch] ? `, ${STATE_UK[ks[ch]]}` : ''));
    }
  };
  rows.forEach((rw, i) => drawRow(i, rw.guess, rw.score));
  for (let i = rows.length; i < MAX; i++) drawRow(i, '', null);
  drawKeys();

  function persist() {
    if (practice) return;
    const all = gameState().wordleDay || {};
    // лише сьогоднішні записи — стан не росте
    const keep = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(today() + '|')));
    keep[key] = { answer, rows, hint, done, won: rows.length > 0 && isWon(rows[rows.length - 1].score) };
    saveGameState({ wordleDay: keep });
  }

  function type(ch) {
    if (done || cur.length >= LEN) return;
    cur += ch; beep('key'); drawRow(rows.length, cur, null);
  }
  function back() {
    if (done || !cur) return;
    cur = cur.slice(0, -1); drawRow(rows.length, cur, null);
  }
  function shake(msg) {
    const row = board.children[rows.length];
    if (!reducedMotion()) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); }
    beep('bad'); buzz(40);
    live.textContent = msg; toast(msg, { ms: 1800 });
  }
  function submit() {
    if (done) return;
    if (cur.length < LEN) return shake('Потрібно 5 літер');
    if (!valid.has(cur) && cur !== answer) return shake('Такого слова немає в словнику');
    const score = scoreGuess(cur, answer);
    rows.push({ guess: cur, score });
    drawRow(rows.length - 1, cur, score, true);
    const said = `${cur.toUpperCase()}: ` + [...cur].map((c, i) => `${c.toUpperCase()} ${STATE_UK[score[i]]}`).join(', ');
    cur = '';
    const won = isWon(score);
    const lost = !won && rows.length >= MAX;
    setTimeout(drawKeys, reducedMotion() ? 0 : 700);
    if (won || lost) {
      done = true;
      live.textContent = said + '. ' + (won ? `Розгадано за ${rows.length} ${rows.length === 1 ? 'спробу' : rows.length < 5 ? 'спроби' : 'спроб'}!` : `Слово було ${answer.toUpperCase()}.`);
      persist();
      if (!practice) {
        const s = updateWordleStats(gameState().wordle, { won, tries: rows.length, day: today(), prevDay: dayKey(new Date(Date.now() - 864e5)) });
        saveGameState({ wordle: s });
      }
      setTimeout(() => { if (!disposed) { won ? (beep('win'), buzz([30, 40, 30])) : (beep('lose'), buzz(80)); finish(won); } }, reducedMotion() ? 0 : 750);
    } else {
      live.textContent = said + `. Спроба ${rows.length + 1} з ${MAX}.`;
      beep(score.some(s => s !== 'b') ? 'tick' : 'key');
      persist();
      showHintOffer();
    }
  }

  function showHintOffer() {
    if (done || rows.length < 3) return;
    const draw = () => hintBox.replaceChildren(hint
      ? h('p.feedback.ok', { style: { margin: 0 } }, ic('lightbulb', { size: 18 }), ' Підказка: ', h('b', info?.uk || '—'))
      : h('button.btn.sm.ghost', { type: 'button', onclick: () => { hint = true; persist(); draw(); } }, ic('lightbulb', { size: 16 }), 'Підказка: переклад'));
    infoP.then(() => { if (!disposed) draw(); });
  }
  showHintOffer();

  async function finish(won) {
    await infoP;
    if (disposed) return;
    hintBox.replaceChildren();
    kb.hidden = true;
    const w = { en: info.en, uk: info.uk, ipa: info.ipa, ex: info.ex, exUk: info.exUk };
    const title = practice ? 'myEnglish · Тренування' : `myEnglish · Слово дня ${new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} · ${lv}`;
    const text = shareText({ title, rows, won, hint });
    const share = async () => {
      try {
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        toast('Результат скопійовано');
      } catch (e) { if (e?.name !== 'AbortError') toast('Не вдалося поширити'); }
    };
    const stats = !practice ? gameState().wordle : null;
    result.replaceChildren(h('div.card.stack.wd-card',
      h('div.row', h('div.grow',
        h('div.xs.dim', won ? (rows.length <= 2 ? 'Блискуче!' : rows.length <= 4 ? 'Чудово!' : 'Вдалося!') : 'Цього разу не вийшло. Слово:'),
        h('div.wd-word.en', { lang: 'en' }, answer.toUpperCase()),
        info.ipa ? h('div.ipa.dim', info.ipa) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': `Прослухати слово ${answer}`, onclick: () => speak(info.en || answer) }, ic('speaker-high'))),
      info.uk ? h('div', { style: { fontWeight: 600 } }, info.uk) : null,
      info.ex ? h('div.example.row', h('div.grow', h('div.en', { lang: 'en' }, info.ex), info.exUk ? h('div.xs.dim', info.exUk) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Прослухати приклад', onclick: () => speak(info.ex) }, ic('speaker-high', { size: 20 }))) : null,
      h('div.row.wrap', addWordButton(w), h('button.btn.sm.outline', { type: 'button', onclick: share }, ic('share-network', { size: 16 }), 'Поширити')),
      stats ? statsView(stats) : null,
      h('div.row.wrap',
        practice ? h('button.btn.primary.grow', { type: 'button', onclick: () => go('/games/wordle?mode=practice', { replace: true }) }, 'Ще слово')
          : h('a.btn.primary.grow', { href: '#/games/wordle?mode=practice' }, 'Тренування без обмежень'),
        h('a.btn.ghost', { href: '#/games' }, 'Інші ігри'))));
    result.querySelector('.btn.primary')?.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  if (done) finish(isWon(rows[rows.length - 1].score));

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || disposed) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    if (e.key === 'Enter') { if (e.target.closest?.('button,a')) return; e.preventDefault(); submit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toLowerCase()); }
  };
  document.addEventListener('keydown', onKey);
  function cleanup() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('keydown', onKey);
    timer.stop();
    stopSpeech();
    setFocus(false);
  }
  return cleanup;
}

function statsView(s) {
  const pct = s.played ? Math.round(s.won / s.played * 100) : 0;
  const max = Math.max(1, ...s.dist);
  return h('div.stack.wd-stats',
    h('div.grid3',
      h('div.stat', h('span.big-num', String(s.played)), h('span.xs.dim', 'Зіграно')),
      h('div.stat', h('span.big-num', `${pct}%`), h('span.xs.dim', 'Перемог')),
      h('div.stat', h('span.big-num', String(s.streak)), h('span.xs.dim', `Серія (макс. ${s.maxStreak})`))),
    h('div.wd-dist', { role: 'list', 'aria-label': 'Перемоги за кількістю спроб' }, s.dist.map((n, i) =>
      h('div.wd-dist-row', { role: 'listitem', 'aria-label': `${i + 1} ${i ? 'спроби' : 'спроба'}: ${n}` }, h('span.num', String(i + 1)),
        h('span.wd-bar', { style: { width: `${Math.max(8, n / max * 100)}%` } }, String(n))))));
}
