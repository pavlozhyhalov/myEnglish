// Аудіювання: диктант і діалоги
import { h, ic, emo, seg, progress } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import { listening as loadListening } from '../data.js';
import { go } from '../router.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { normalize } from '../ui/exercises.js';
import { activityTimer, addMistake } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { toast } from '../ui/toast.js';
import { LEVELS, myLevel, byFit, levelTag, rank, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote, pickOfDay } from '../level.js';
import { tx, txPrimary, txGroup, txRow, txRows, txGrid, txKpis, txPill, txResult } from '../ui/tiles.js';

/** Іконка з мапи emo() у квадратику плитки */
const sqEmo = (el, name) => { const e = emo(name); e.setAttribute('width', 18); e.setAttribute('height', 18); el.querySelector('.tx-sq')?.replaceChildren(e); return el; };

// Діалог і диктант — власні адреси (#/listening/dialogue/<номер>, #/listening/dictation?level=B1): вкладки розділу
// й перемикачі «Диктант · Діалоги», «US · UK» показуються лише на головній сторінці аудіювання.
let aiDialogue = null;      // діалог від AI (адреси не має — #/listening/dialogue/ai)
let fromList = false;       // відкрито зі списку — «Назад» повертає туди ж історією

/** Повернутися до списку розділу: історією, якщо прийшли з нього, інакше — заміною адреси */
function backTo(path) {
  if (fromList) { fromList = false; history.back(); } else go(path, { replace: true });
}
/** Адреса готового діалогу: номер у data/listening.json */
const dialogueHref = (data, d) => `/listening/dialogue/${data.dialogues.indexOf(d) + 1}`;
/** Відкрити підсторінку розділу з головної сторінки аудіювання */
function openSub(path) { fromList = true; go(path); }

export default async function listening(view, r) {
  const data = await loadListening();
  const timer = activityTimer('listening');
  const cleanup = () => { stopSpeech(); timer.stop(); };
  const [sub, id] = r.parts;
  if (sub === 'dialogue') {
    const d = id === 'ai' ? aiDialogue : data.dialogues[Number(id) - 1];
    if (!d) { go('/listening?tab=dialogues', { replace: true }); return cleanup; }
    playDialogue(view, d, timer, () => backTo('/listening?tab=dialogues'));
    return cleanup;
  }
  if (sub === 'dictation') {
    runDictation(view, data, timer, r.query.level);
    return cleanup;
  }
  fromList = false;
  let tab = r.query.tab === 'dialogues' ? 'dialogues' : 'dictation';
  // посилання з головної «Завдання рівня» відкриває конкретний діалог
  if (tab === 'dialogues' && r.query.d) {
    const d = data.dialogues.find(x => x.title === r.query.d);
    if (d) { go(dialogueHref(data, d), { replace: true }); return cleanup; }
  }
  const body = h('div');
  // вкладка — в адресі (без нового запису історії): «Назад» з діалогу повертає на ту саму вкладку
  const tabs = seg([['dictation', 'Диктант'], ['dialogues', 'Діалоги']], tab, v => { tab = v; history.replaceState(history.state, '', v === 'dialogues' ? '#/listening?tab=dialogues' : '#/listening'); draw(); });
  // акцент US/UK — у «Налаштуваннях» (не дублюємо тут)
  view.replaceChildren(h('div.stack-lg', tabs, body));
  function draw() { body.__gen = (body.__gen || 0) + 1; stopSpeech(); tab === 'dictation' ? dictation(body, data) : dialogues(body, data); }
  draw();
  return cleanup;
}

// ---------- Диктант ----------
const dictLevels = (data) => LEVELS.filter(l => data.dictation.some(d => d.level === l));
/** Рівень диктанту за замовчуванням — найближчий до мого */
const defaultDictLevel = (levels) => levels.slice().sort((a, b) => Math.abs(rank(a) - rank(myLevel())) - Math.abs(rank(b) - rank(myLevel())))[0];

function dictation(box, data) {
  const levels = dictLevels(data);
  let level = defaultDictLevel(levels);
  const start = () => openSub(`/listening/dictation?level=${level}`);
  const startTile = txPrimary({ icon: 'headphones', label: 'Почати диктант', sub: `8 речень · рівень ${level}`, onclick: start });
  box.replaceChildren(h('div.stack-lg',
    startTile,
    txGroup('Рівень', h('div.chips', levels.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === level), onclick: (e) => {
      level = l; e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
      startTile.querySelector('.tx-s').textContent = `8 речень · рівень ${level}`;
    } }, l === myLevel() ? `Мій · ${l}` : l))))));
}

/** Диктант (#/listening/dictation?level=B1): 8 речень, далі — підсумок на тій самій адресі */
function runDictation(box, data, timer, wanted) {
  const levels = dictLevels(data);
  const level = levels.includes(wanted) ? wanted : defaultDictLevel(levels);
  const fresh = () => data.dictation.filter(d => d.level === level).sort(() => Math.random() - 0.5).slice(0, 8);
  run(fresh());

  function run(items) {
    let i = 0, totalPct = 0;
    const scores = [];
    const tone = (pct) => pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad';
    const step = () => {
      if (i >= items.length) {
        const avg = Math.round(totalPct / items.length);
        const perfect = scores.filter(x => x >= 100).length;
        timer.poke();
        box.replaceChildren(h('div.stack-lg',
          h('section.tx-group',
            txResult({ icon: avg >= 80 ? 'trophy' : avg >= 60 ? 'thumbs-up' : 'barbell', tone: tone(avg), label: `Диктант · рівень ${level}`,
              title: avg >= 90 ? 'Чуєте майже все — чудово' : avg >= 70 ? 'Добре чуєте — ще трохи практики' : 'Слухайте повільніше й частіше' }),
            txKpis([
              { value: avg, unit: '%', label: 'середня точність', tone: tone(avg) },
              { value: perfect, label: `з ${items.length} без помилок`, tone: perfect === items.length ? 'good' : null },
              { value: items.length, label: plural(items.length, 'речення', 'речення', 'речень') },
            ])),
          txGroup('Речення', txRows(items.map((it, k) => txRow({ no: k + 1, label: h('span', { lang: 'en' }, it.text), sub: it.uk || null,
            pill: { text: `${scores[k]}%`, tone: tone(scores[k]) }, chevron: false, onclick: () => speak(it.text),
            attrs: { 'aria-label': `Прослухати: ${it.text}. Точність ${scores[k]}%` } })))),
          h('section.tx-group',
            txPrimary({ icon: 'arrow-clockwise', label: 'Ще один диктант', sub: `8 нових речень · рівень ${level}`, onclick: () => { window.scrollTo(0, 0); run(fresh()); } }),
            tx({ icon: 'target', wide: true, label: 'Змінити рівень', sub: 'Рівні диктанту A1–C1', onclick: () => backTo('/listening') }))));
        return;
      }
      const it = items[i];
      const inp = h('textarea.input.ls-inp', { rows: 2, placeholder: 'Напишіть почуте…', autocapitalize: 'sentences', spellcheck: 'false', 'aria-label': 'Почуте речення' });
      const result = h('div');
      const play = (rate) => speak(it.text, { rate });
      const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
        if (!inp.value.trim()) return;
        const d = charDiff(it.text, inp.value.trim());
        totalPct += d.pct; scores[i] = d.pct;
        if (d.pct < 100) {
          const wrongWords = wordMismatch(it.text, inp.value);
          if (wrongWords) addMistake({ wrong: wrongWords.given, right: wrongWords.right, type: 'vocabulary', explanation_uk: 'Диктант: слово почуто або написано неправильно', source: 'exercise' });
        }
        result.replaceChildren(h('div.gx-card.stack.ls-check',
          h('div.row', h('div.tx-label.grow.ls-lbl', 'Ваш варіант'), txPill(`${d.pct}%`, tone(d.pct))),
          h('div.diff', d.nodes),
          h('div.tx-label.ls-lbl', 'Оригінал'),
          h('div', { lang: 'en' }, it.text),
          it.uk ? h('div.xs.dim', it.uk) : null));
        checkBtn.hidden = true; nextBtn.hidden = false; nextBtn.focus();
      } }, 'Перевірити');
      const nextBtn = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: () => { i++; step(); } }, i + 1 < items.length ? 'Далі' : 'Результат', ic('arrow-right', { size: 18 }));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkBtn.hidden ? nextBtn.click() : checkBtn.click(); } });
      const speed = (rate, label, sub) => tx({ icon: 'speaker-high', label, sub, onclick: () => play(rate), attrs: { 'aria-label': `Прослухати, швидкість ${label}` } });
      box.replaceChildren(h('div.stack-lg',
        h('div.row', h('div.grow', progress(i / items.length * 100, 'Пройдено завдань')), h('span.xs.dim.num', `${i + 1}/${items.length}`)),
        txGroup(`Речення ${i + 1} · рівень ${level}`, txGrid([speed(1, '1×', 'звичайно'), speed(0.8, '0,8×', 'повільніше'), speed(0.6, '0,6×', 'повільно')])),
        txGroup('Що ви почули', [inp, checkBtn, result, nextBtn])));
      setTimeout(() => play(1), 300);
      inp.focus({ preventScroll: true });
    };
    step();
  }
}

/** Посимвольне порівняння (LCS) з підсвіткою: збіг / пропущене / зайве */
export function charDiff(target, given) {
  const a = target, b = given;
  const na = a.toLowerCase().replace(/[’]/g, "'"), nb = b.toLowerCase().replace(/[’]/g, "'");
  const n = na.length, m = nb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const nodes = [];
  let i = 0, j = 0, buf = '', kind = null, ok = 0;
  const push = (k, ch) => { if (k !== kind && buf) { nodes.push(h('span', { class: kind }, buf)); buf = ''; } kind = k; buf += ch; };
  while (i < n && j < m) {
    if (na[i] === nb[j]) { push('ok', b[j]); i++; j++; ok++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('miss', a[i]); i++; }
    else { push('extra', b[j]); j++; }
  }
  while (i < n) { push('miss', a[i]); i++; }
  while (j < m) { push('extra', b[j]); j++; }
  if (buf) nodes.push(h('span', { class: kind }, buf));
  // відсоток рахуємо без урахування пунктуації та регістру
  const pa = normalize(a), pb = normalize(b);
  const pct = pa === pb ? 100 : Math.round(lcs(pa, pb) / Math.max(pa.length, pb.length) * 100);
  return { nodes, pct };
}
function lcs(a, b) {
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
/**
 * Перша розбіжність після вирівнювання слів (LCS): пропущене/зайве слово не зсуває решту.
 * Повертає { right, given } — given '—', якщо слово пропущено; null, якщо розбіжностей немає.
 */
function wordMismatch(target, given) {
  const t = normalize(target).split(' ').filter(Boolean), g = normalize(given).split(' ').filter(Boolean);
  const n = t.length, m = g.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = t[i] === g[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (t[i] === g[j]) { i++; j++; continue; }
    const skipT = dp[i + 1][j], skipG = dp[i][j + 1];
    // заміна слова (обидва не збігаються) — пара «правильне → написане»
    if (skipT === skipG && dp[i + 1][j + 1] === skipT) return { right: t[i], given: g[j] };
    if (skipT >= skipG) return { right: t[i], given: '—' };   // пропущене слово
    j++;                                                          // зайве слово — пропускаємо
  }
  if (i < n) return { right: t[i], given: '—' };
  return null;
}

// ---------- Діалоги ----------
function dialogues(box, data) {
  const topics = ['У кафе', 'Плани на вихідні', 'В аеропорту', 'Оренда квартири', 'У лікаря', 'Знайомство на вечірці', 'Покупки й повернення', 'Подорож потягом', 'Обговорення фільму', 'Співбесіда'];
  // діалоги вибраного рівня (за замовчуванням — мого)
  // діалог дня — той самий, що в «Завданнях рівня» на головній
  const day = pickOfDay(filterByLevel(data.dialogues, 'mine').items, 'dialogue');
  const listBox = h('div.stack');
  const open = (d) => openSub(dialogueHref(data, d));
  let all = false;
  const drawList = () => {
    const sel = levelPick('dialogues');
    const { items, fallback } = filterByLevel(data.dialogues, sel);
    const rows = byFit(items).filter(d => all || d !== day);
    const shown = all ? rows : rows.slice(0, 6);
    listBox.replaceChildren(fallbackNote(fallback), txRows([...shown.map(d => sqEmo(txRow({ icon: 'headphones', label: d.title, onclick: () => open(d),
      sub: `${d.lines.length} ${plural(d.lines.length, 'репліка', 'репліки', 'реплік')} · ${d.questions.length} ${plural(d.questions.length, 'питання', 'питання', 'питань')}`,
      end: sel === 'all' || fallback ? levelTag(d.level) : null }), d.emoji || 'headphone')),
      shown.length < rows.length ? txRow({ icon: 'caret-down', label: `Показати всі · ${items.length}`, chevron: false, cls: 'tx-showall', onclick: () => { all = true; drawList(); } }) : null]));
  };
  drawList();
  box.replaceChildren(h('div.stack-lg',
    day ? sqEmo(txPrimary({ icon: 'headphones', label: day.title, sub: `Діалог дня · ${day.level} · ${day.lines.length} ${plural(day.lines.length, 'репліка', 'репліки', 'реплік')}`, onclick: () => open(day) }), day.emoji || 'headphone') : null,
    txGroup('Готові діалоги', [levelChips('dialogues', levelCounts(data.dialogues), () => { all = false; drawList(); }), listBox]),
    txGroup('Новий діалог від AI', h('div.chips.scroll', { role: 'group', 'aria-label': 'Тема нового діалогу' }, topics.map(t => h('button.chip', { type: 'button', onclick: async (e) => {
      if (!user()) { toast(S.err.needLogin); return; }
      const chip = e.currentTarget; chip.disabled = true; chip.textContent = 'Генерую…';
      try {
        const g = box.__gen;
        const d = await tutor('dialogue', { topic: t });
        if (box.__gen !== g || !box.isConnected) return;   // користувач перейшов на іншу вкладку
        aiDialogue = { ...d, level: 'AI', speakers: d.speakers };
        openSub('/listening/dialogue/ai');
      } catch (err) { toast(aiErrorText(err), { kind: 'bad' }); chip.disabled = false; chip.textContent = t; }
    } }, t))))));
}

function playDialogue(box, d, timer, onBack) {
  let showText = false, stopFlag = false;
  const myGen = (box.__gen = (box.__gen || 0) + 1);   // зміна вкладки збільшує лічильник — програвання зупиняється
  const transcript = h('div.gx-card.stack.ls-tr', { hidden: true });
  const lines = d.lines.map((l) => h('div.ls-line', h('b.ls-who' + (l.speaker ? '.b' : ''), d.speakers?.[l.speaker] || (l.speaker ? 'B' : 'A')), h('div.grow', { lang: 'en' }, l.text)));
  transcript.append(...lines);
  const playBtn = txPrimary({ icon: 'play', label: 'Слухати діалог', sub: `${d.lines.length} ${plural(d.lines.length, 'репліка', 'репліки', 'реплік')} · два голоси`, onclick: playAll });
  const setPlay = (icon, label) => { playBtn.querySelector('.tx-sq').replaceChildren(ic(icon, { size: 20, fill: true })); playBtn.querySelector('.tx-l').textContent = label; };
  async function playAll() {
    stopFlag = false;
    playBtn.disabled = true;
    setPlay('waveform', 'Звучить діалог…');
    // box.isConnected: користувач пішов зі сторінки або на іншу вкладку — не дочитуємо діалог
    for (let k = 0; k < d.lines.length && !stopFlag && box.isConnected && box.__gen === myGen; k++) {
      lines.forEach((el, j) => el.classList.toggle('on', j === k && showText));
      await speak(d.lines[k].text, { voiceIndex: d.lines[k].speaker ? 1 : 0, engine: 'browser' });
      if (!box.isConnected || stopFlag || box.__gen !== myGen) break;
      timer.poke();
    }
    lines.forEach(el => el.classList.remove('on'));
    playBtn.disabled = false;
    setPlay('arrow-clockwise', 'Слухати ще раз');
  }
  const textBtn = tx({ icon: 'eye', wide: true, label: 'Показати текст', sub: 'Спершу спробуйте зрозуміти на слух', end: null, cls: 'ls-tbtn', attrs: { 'aria-expanded': 'false' },
    onclick: () => {
      showText = !showText; transcript.hidden = !showText;
      textBtn.setAttribute('aria-expanded', String(showText));
      textBtn.querySelector('.tx-l').textContent = showText ? 'Сховати текст' : 'Показати текст';
      textBtn.querySelector('.tx-sq').replaceChildren(ic(showText ? 'eye-slash' : 'eye', { size: 20 }));
    } });
  const qBox = h('div.stack');
  const total = h('div', { role: 'status', 'aria-live': 'polite' });
  let answered = 0, right = 0;
  d.questions.forEach((q, qi) => {
    const mark = (b, ok) => { b.classList.add(ok ? 'right' : 'wrong'); b.firstChild.replaceChildren(ic(ok ? 'check' : 'x', { size: 16 })); };
    const opts = q.options.map((o, k) => h('button.opt.ex-opt', { type: 'button', onclick: () => {
      if (opts.some(b => b.classList.contains('right') || b.classList.contains('wrong'))) return;
      const ok = k === q.answer;
      mark(opts[k], ok);
      if (!ok) mark(opts[q.answer], true);
      opts.forEach(b => b.setAttribute('aria-disabled', 'true'));
      answered++; if (ok) right++;
      if (q.explanation_uk) opts[q.answer].after(h('div.xs.dim.ls-why', q.explanation_uk));
      if (answered === d.questions.length) {
        timer.poke();
        const good = right >= Math.ceil(d.questions.length * 0.8);
        total.replaceChildren(tx({ wide: true, tone: good ? 'good' : 'warn', icon: good ? 'check-circle' : 'lightbulb',
          label: `Розуміння: ${right} з ${d.questions.length}`, sub: good ? 'Діалог зрозуміло добре' : 'Прослухайте ще раз — з текстом або без' }));
      }
    } }, h('span.ex-key', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', { lang: 'en' }, o)));
    qBox.append(h('div.gx-card.stack.ls-q', h('div.ls-qt', { lang: 'en' }, h('span.tx-no', String(qi + 1)), h('b', q.q)), h('div.ex-opts', opts)));
  });
  box.replaceChildren(h('div.stack-lg',
    h('div.gx-lhead', h('button.icon-btn', { type: 'button', 'aria-label': 'До діалогів', onclick: () => { stopFlag = true; stopSpeech(); onBack(); } }, ic('arrow-left')),
      h('div.grow', h('div.tx-label.gx-eyebrow', `${d.level === 'AI' ? 'Новий від AI' : d.level} · Діалог`), h('h2.gx-lh1', d.title))),
    h('section.tx-group', playBtn, textBtn, transcript),
    txGroup(`Питання на розуміння · ${d.questions.length}`, [qBox, total])));
}
