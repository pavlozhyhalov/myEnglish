// Аудіювання: диктант і діалоги
import { h, ic, emo, seg, progress } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { listening as loadListening } from '../data.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { normalize } from '../ui/exercises.js';
import { activityTimer, addMistake } from '../stats.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { toast } from '../ui/toast.js';
import { LEVELS, myLevel, byFit, levelTag, rank, levelChips, levelCounts, levelPick, filterByLevel, fallbackNote } from '../level.js';

let openTitle = null;

export default async function listening(view, r) {
  const data = await loadListening();
  const timer = activityTimer('listening');
  let tab = r.query.tab || 'dictation';
  openTitle = tab === 'dialogues' ? r.query.d || null : null;   // посилання з головної «Завдання рівня» відкриває конкретний діалог
  if (openTitle) history.replaceState(null, '', '#/listening?tab=dialogues');   // «Назад» і перезавантаження — до списку
  const body = h('div');
  const accent = seg([['US', 'US'], ['UK', 'UK']], store.settings().accent, v => store.setSetting('accent', v));
  const tabs = seg([['dictation', 'Диктант'], ['dialogues', 'Діалоги']], tab, v => { tab = v; draw(); });
  view.replaceChildren(h('div.stack-lg', h('div.row', h('div.grow', tabs), h('div', { style: { width: '120px' } }, accent)), body));
  function draw() { body.__gen = (body.__gen || 0) + 1; stopSpeech(); tab === 'dictation' ? dictation(body, data, timer) : dialogues(body, data, timer); }
  draw();
  return () => { stopSpeech(); timer.stop(); };
}

// ---------- Диктант ----------
function dictation(box, data, timer) {
  const levels = LEVELS.filter(l => data.dictation.some(d => d.level === l));
  // за замовчуванням — найближчий до мого рівня
  let level = levels.slice().sort((a, b) => Math.abs(rank(a) - rank(myLevel())) - Math.abs(rank(b) - rank(myLevel())))[0];
  const start = () => {
    const pool = data.dictation.filter(d => d.level === level);
    const items = pool.sort(() => Math.random() - 0.5).slice(0, 8);
    run(items);
  };
  box.replaceChildren(h('div.stack',
    h('section.card.stack', h('div.row', emo('headphone', 'lg'), h('div.grow', h('h2', { style: { margin: 0 } }, 'Диктант'), h('div.small.dim', '8 речень: слухайте й набирайте. За замовчуванням — ваш рівень, його можна змінити.'))),
      h('div.chips', levels.map(l => h('button.chip', { type: 'button', 'aria-pressed': String(l === level), onclick: (e) => { level = l; e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); } }, l === myLevel() ? `Мій · ${l}` : l))),
      h('button.btn.primary.block.lg', { type: 'button', onclick: start }, ic('play', { fill: true }), 'Почати'))));

  function run(items) {
    let i = 0, totalPct = 0;
    const step = () => {
      if (i >= items.length) {
        const avg = Math.round(totalPct / items.length);
        timer.poke();
        box.replaceChildren(h('div.hero', emo(avg >= 80 ? 'trophy' : 'thumbsup', 'xl'), h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${avg}%`), h('p.dim', 'Середня точність'),
          h('button.btn.primary', { type: 'button', onclick: () => dictation(box, data, timer) }, 'Ще раз')));
        return;
      }
      const it = items[i];
      const inp = h('textarea.input', { rows: 2, placeholder: 'Напишіть почуте…', autocapitalize: 'sentences', spellcheck: 'false', 'aria-label': 'Почуте речення', style: { minHeight: '80px' } });
      const result = h('div');
      const play = (rate) => speak(it.text, { rate });
      const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
        if (!inp.value.trim()) return;
        const d = charDiff(it.text, inp.value.trim());
        totalPct += d.pct;
        if (d.pct < 100) {
          const wrongWords = wordMismatch(it.text, inp.value);
          if (wrongWords) addMistake({ wrong: wrongWords.given, right: wrongWords.right, type: 'vocabulary', explanation_uk: 'Диктант: слово почуто або написано неправильно', source: 'exercise' });
        }
        result.replaceChildren(h('div.card.soft.stack',
          h('div.diff', d.nodes),
          h('div.small', h('b', 'Оригінал: '), it.text),
          it.uk ? h('div.xs.dim', it.uk) : null,
          h('div', h('b', { class: d.pct >= 90 ? 'good' : d.pct >= 70 ? 'warn' : 'bad' }, `${d.pct}%`))));
        checkBtn.hidden = true; nextBtn.hidden = false; nextBtn.focus();
      } }, 'Перевірити');
      const nextBtn = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: () => { i++; step(); } }, 'Далі');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkBtn.hidden ? nextBtn.click() : checkBtn.click(); } });
      box.replaceChildren(h('div.stack',
        h('div.row', h('div.grow', progress(i / items.length * 100, 'Пройдено завдань')), h('span.xs.dim', `${i + 1}/${items.length}`)),
        h('div.row', { style: { justifyContent: 'center', gap: '12px' } },
          h('button.btn.soft.lg', { type: 'button', onclick: () => play(1) }, ic('speaker-high'), '1×'),
          h('button.btn.soft.lg', { type: 'button', onclick: () => play(0.8) }, ic('speaker-high'), '0,8×'),
          h('button.btn.soft.lg', { type: 'button', onclick: () => play(0.6) }, ic('speaker-high'), '0,6×')),
        inp, checkBtn, result, nextBtn));
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
function dialogues(box, data, timer) {
  const topics = ['У кафе', 'Плани на вихідні', 'В аеропорту', 'Оренда квартири', 'У лікаря', 'Знайомство на вечірці', 'Покупки й повернення', 'Подорож потягом', 'Обговорення фільму', 'Співбесіда'];
  // діалоги вибраного рівня (за замовчуванням — мого)
  const listBox = h('div.stack');
  const drawList = () => {
    const { items, fallback } = filterByLevel(data.dialogues, levelPick('dialogues'));
    listBox.replaceChildren(fallbackNote(fallback), h('div.list', byFit(items).map(d => h('button.list-row', { type: 'button', onclick: () => playDialogue(box, d, timer, () => dialogues(box, data, timer)) },
      emo(d.emoji || 'headphone'), h('div.grow', h('div', { style: { fontWeight: 600 } }, d.title), h('div.sub', `${d.lines.length} ${plural(d.lines.length, 'репліка', 'репліки', 'реплік')} · ${d.questions.length} ${plural(d.questions.length, 'питання', 'питання', 'питань')}`)), levelTag(d.level), ic('caret-right', { size: 18 })))));
  };
  drawList();
  if (openTitle) {
    const d = data.dialogues.find(x => x.title === openTitle);
    openTitle = null;
    if (d) { playDialogue(box, d, timer, () => dialogues(box, data, timer)); return; }
  }
  box.replaceChildren(h('div.stack',
    h('div.section-title', 'Готові діалоги (офлайн)'),
    levelChips('dialogues', levelCounts(data.dialogues), drawList), listBox,
    h('div.section-title', 'Новий діалог від AI'),
    h('div.chips', topics.map(t => h('button.chip', { type: 'button', onclick: async (e) => {
      if (!user()) { toast(S.err.needLogin); return; }
      const chip = e.currentTarget; chip.disabled = true; chip.textContent = 'Генерую…';
      try {
        const g = box.__gen;
        const d = await tutor('dialogue', { topic: t });
        if (box.__gen !== g || !box.isConnected) return;   // користувач перейшов на іншу вкладку
        playDialogue(box, { ...d, level: 'AI', speakers: d.speakers }, timer, () => dialogues(box, data, timer));
      } catch (err) { toast(aiErrorText(err), { kind: 'bad' }); chip.disabled = false; chip.textContent = t; }
    } }, t)))));
}

function playDialogue(box, d, timer, onBack) {
  let showText = false, stopFlag = false;
  const myGen = (box.__gen = (box.__gen || 0) + 1);   // зміна вкладки збільшує лічильник — програвання зупиняється
  const transcript = h('div.stack', { hidden: true });
  const lines = d.lines.map((l, k) => h('div.example', h('b.small', { style: { minWidth: '70px', color: l.speaker ? 'var(--accent-ink)' : 'var(--good)' } }, d.speakers?.[l.speaker] || (l.speaker ? 'B' : 'A')), h('div.grow', l.text)));
  transcript.append(...lines);
  const playBtn = h('button.btn.primary.lg.block', { type: 'button', onclick: playAll }, ic('play', { fill: true }), 'Слухати діалог');
  async function playAll() {
    stopFlag = false;
    playBtn.disabled = true;
    // box.isConnected: користувач пішов зі сторінки або на іншу вкладку — не дочитуємо діалог
    for (let k = 0; k < d.lines.length && !stopFlag && box.isConnected && box.__gen === myGen; k++) {
      lines.forEach((el, j) => el.style.background = j === k && showText ? 'var(--accent-soft)' : '');
      await speak(d.lines[k].text, { voiceIndex: d.lines[k].speaker ? 1 : 0, engine: 'browser' });
      if (!box.isConnected || stopFlag || box.__gen !== myGen) break;
      timer.poke();
    }
    lines.forEach(el => el.style.background = '');
    playBtn.disabled = false;
    playBtn.replaceChildren(ic('arrow-clockwise'), 'Слухати ще раз');
  }
  const qBox = h('div.stack');
  let answered = 0, right = 0;
  d.questions.forEach((q, qi) => {
    const opts = q.options.map((o, k) => h('button.opt', { type: 'button', onclick: () => {
      if (opts.some(b => b.classList.contains('right') || b.classList.contains('wrong'))) return;
      const ok = k === q.answer;
      opts[k].classList.add(ok ? 'right' : 'wrong');
      opts[q.answer].classList.add('right');
      answered++; if (ok) right++;
      if (q.explanation_uk) opts[q.answer].after(h('div.xs.dim', q.explanation_uk));
      if (answered === d.questions.length) { timer.poke(); qBox.append(h('div.feedback.' + (right >= 4 ? 'ok' : 'no'), `Розуміння: ${right} з ${d.questions.length}`)); }
    } }, o));
    qBox.append(h('div.card.stack', h('b', `${qi + 1}. ${q.q}`), ...opts));
  });
  box.replaceChildren(h('div.stack',
    h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Назад', onclick: () => { stopFlag = true; stopSpeech(); onBack(); } }, ic('arrow-left')), h('h2.grow', { style: { margin: 0 } }, d.title)),
    playBtn,
    h('button.btn.ghost', { type: 'button', onclick: (e) => { showText = !showText; transcript.hidden = !showText; e.currentTarget.textContent = showText ? 'Сховати текст' : 'Показати текст'; } }, 'Показати текст'),
    h('section.card', transcript),
    h('div.section-title', 'Питання на розуміння'), qBox));
}
