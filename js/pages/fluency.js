// Тренажер плавності (#/fluency): головна тренажера, «4-3-2» (#/fluency/432), фрази «замість uh» (#/fluency/gambits),
// тренування «почни з фрази» (#/fluency/drill). Метрики й запис — js/fluency.js; AI — лише транскрипція й один відгук.
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import { tutor, aiErrorText } from '../ai.js';
import { speak, stop as stopSpeech, blobToBase64 } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { tx, txPrimary, txGrid, txGroup, txKpis, txRow, txRows, txLogin } from '../ui/tiles.js';
import { skelLines } from '../ui/skeleton.js';
import { activityTimer } from '../stats.js';
import { user } from '../supa.js';
import { onLeave } from '../router.js';
import {
  ROUNDS, TOPICS, interestTopics, GAMBIT_GROUPS, GAMBITS, pickQuestions, DRILL_LEN, DRILL_START_SEC, DRILL_SPEAK_SEC,
  markup, analyze, sessionTotals, gambitStart, history, drills, saveSession, saveDrill,
  canRecord, createMic, recordRound, micErrorKind, isFiller, normWord,
} from '../fluency.js';

const NS = 'http://www.w3.org/2000/svg';
/** replaceChildren без null/false/'' */
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== '')); return el; };
const num = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('uk-UA');
const nWords = (n) => `${n} ${plural(n, 'слово', 'слова', 'слів')}`;
const nSec = (s) => `${Math.round(s)} с`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

export default function fluency(view, r) {
  const sub = r.parts[0];
  if (sub === '432') return fourThreeTwo(view);
  if (sub === 'drill') return drill(view);
  if (sub === 'gambits') return gambitsPage(view);
  return overview(view);
}

// ---------- Спільне ----------
/** Компактна шапка: «Назад», підпис великими літерами (eyebrow), назва — один раз (у шапці застосунку — «Тренажер плавності») */
function pageHead(title, eyebrow, back = '#/fluency') {
  return h('div.gx-lhead.fl-head',
    h('a.icon-btn', { href: back, 'aria-label': 'До тренажера плавності' }, ic('arrow-left')),
    h('div.grow', eyebrow ? h('div.tx-label.gx-eyebrow', eyebrow) : null, h('h2.gx-lh1', { lang: /[a-z]/i.test(title) && !/[а-яіїєґ]/i.test(title) ? 'en' : null }, title)));
}
/** Шапка результату: значок у квадратику, підпис і висновок; під ними — показники плитками */
function resultHead({ icon, tone, label, caption, kpis }) {
  return h('section.tx-group',
    h('div.gx-res', h('span.gx-res-ic.' + tone, ic(icon, { size: 26, fill: true })), h('div.grow', h('div.tx-label', label), h('div.gx-res-t', caption))),
    txKpis(kpis));
}
/** Текстова плитка стану: значок у квадратику + заголовок + пояснення (очікування, помилки, «надто коротко») */
function stateCard({ icon, tone = '', title, lines = [], extra = [], cls = '', attrs = {} }) {
  return h('section.gx-card.stack.fl-state' + cls, attrs,
    h('div.fl-state-h', h('span.tx-sq' + (tone ? '.' + tone : ''), ic(icon, { size: 20 })),
      h('div.grow.stack', { style: { gap: '4px' } }, h('div.fl-strong', title), lines.map(l => h('div.small.dim', l)))),
    extra);
}

function loginCard() {
  return txGroup('Потрібен вхід в акаунт', [
    txLogin('Запис і розбір мовлення — після входу', 'Мовлення дослівно розпізнає AI — з усіма «uh» і повторами, щоб їх порахувати'),
    tx({ icon: 'quotes', wide: true, label: 'Фрази «замість uh»', sub: 'Можна вчити й без входу', href: '#/fluency/gambits' })]);
}

const MIC_ERR = {
  denied: ['Немає дозволу на мікрофон', [
    'На iPhone: Параметри → Програми → Safari → Мікрофон → «Дозволити» (в iOS 17 і раніше — Параметри → Safari → Мікрофон).',
    'Або в Safari: «аА» в адресному рядку → Параметри вебсайту → Мікрофон → «Дозволити».',
    'У Chrome: значок замка біля адреси → Мікрофон → «Дозволити».']],
  missing: ['Мікрофон не знайдено', ['Під\'єднайте навушники з мікрофоном або перевірте, чи мікрофон не вимкнено в системі.']],
  busy: ['Мікрофон зайнятий', ['Його використовує інша програма — дзвінок, диктофон, інша вкладка. Закрийте її і спробуйте ще раз.']],
  unsupported: ['Запис звуку недоступний', ['Цей браузер не вміє записувати звук. Оновіть iOS або відкрийте застосунок у Safari чи Chrome.']],
  other: ['Не вдалося ввімкнути мікрофон', ['Спробуйте ще раз. Якщо не допоможе — перезапустіть застосунок.']],
};
function micErrorCard(e, onRetry) {
  const [title, lines] = MIC_ERR[micErrorKind(e)] || MIC_ERR.other;
  return h('div.stack-lg',
    stateCard({ icon: 'microphone-slash', tone: 'bad', title, lines, cls: '.fl-err', attrs: { role: 'alert' } }),
    onRetry ? txPrimary({ icon: 'arrow-clockwise', label: 'Спробувати ще раз', sub: 'Увімкнути мікрофон', onclick: onRetry }) : null);
}

/** Транскрипція з підсвіченими заминками й повторами (текст — лише через textContent) */
function transcriptView(text) {
  const box = h('p.fl-transcript', { lang: 'en' });
  for (const m of markup(text)) {
    if (m.kind === 'filler') box.append(h('mark.fl-f', { title: 'заминка' }, m.text));
    else if (m.kind === 'repeat') box.append(h('mark.fl-r', { title: 'повтор' }, m.text));
    else box.append(document.createTextNode(m.text));
  }
  return box;
}
const legend = () => h('div.fl-legend', h('span', h('i.fl-f'), 'заминка'), h('span', h('i.fl-r'), 'повтор'));

/** Плитка метрики: значення, підпис, зміна відносно попереднього раунду (better: 'up' | 'down') */
function metric(label, value, { sub, delta, better = 'up', unit = '' } = {}) {
  let d = null;
  if (Number.isFinite(delta) && Math.abs(delta) >= 0.05) {
    const good = better === 'up' ? delta > 0 : delta < 0;
    d = h('span.fl-delta' + (good ? '.good' : '.bad'), { 'aria-label': `${good ? 'краще' : 'гірше'} на ${num(Math.abs(delta))}${unit}` },
      (delta > 0 ? '+' : '−') + num(Math.abs(delta)) + unit);
  }
  return h('div.fl-metric', h('div.fl-mv', h('b', value), d), h('div.fl-ml', label), sub ? h('div.fl-ms', sub) : null);
}

/** Стовпчики по раундах (одна величина — одна вісь). values — числа; labels — підписи під стовпчиками */
function barChart({ title, values, labels, unit = '', note }) {
  const W = 168, H = 112, top = 18, base = 88, bw = 30;
  const max = Math.max(1, ...values) * 1.08;
  const step = W / values.length;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fl-chart', role: 'img', 'aria-label': `${title}: ${values.map((v, i) => `${labels[i]} — ${num(v)}${unit}`).join(', ')}` });
  s.append(svg('line', { x1: 4, x2: W - 4, y1: base + 0.5, y2: base + 0.5, class: 'fl-axis' }));
  values.forEach((v, i) => {
    const x = step * i + (step - bw) / 2;
    const hgt = Math.max(v > 0 ? 4 : 0, (base - top) * v / max);
    const y = base - hgt, rr = Math.min(4, hgt);
    const g = svg('g', { class: 'fl-barg' + (i === values.length - 1 ? ' last' : '') });
    const t = svg('title'); t.textContent = `${labels[i]}: ${num(v)}${unit}`;
    g.append(t);
    if (hgt > 0) g.append(svg('path', { class: 'fl-bar', d: `M${x},${base} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${base} Z` }));
    const val = svg('text', { x: x + bw / 2, y: y - 6, class: 'fl-val', 'text-anchor': 'middle' }); val.textContent = num(v);
    const lab = svg('text', { x: x + bw / 2, y: base + 16, class: 'fl-lab', 'text-anchor': 'middle' }); lab.textContent = labels[i];
    g.append(val, lab);
    s.append(g);
  });
  return h('figure.fl-fig', h('figcaption', h('span', title), note ? h('span.fl-note', note) : null), s);
}

/** Міні-тренд (лінія) для «Ваш прогрес» */
function sparkline(values, label) {
  const W = 120, H = 36, p = 4;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [p + (W - 2 * p) * (values.length === 1 ? 1 : i / (values.length - 1)), H - p - (H - 2 * p) * (v - min) / span]);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fl-spark', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  s.append(svg('polyline', { points: pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' '), class: 'fl-sline', fill: 'none' }));
  const [lx, ly] = pts[pts.length - 1];
  s.append(svg('circle', { cx: lx, cy: ly, r: 3.5, class: 'fl-sdot' }));
  return s;
}

// ---------- Головна тренажера ----------
function overview(view) {
  setTitle('Тренажер плавності');
  const logged = !!user();
  const hist = history();
  const last = drills().slice(-1)[0];
  const steps = ROUNDS.map(x => nSec(x.sec)).join(' → ');
  // одна головна дія (4-3-2) → прогрес → «Замість uh» → поради згорнуті
  const tips = h('ul.fl-tips', { id: 'fl-tips', hidden: true },
    h('li', 'Не шукайте ідеальне слово — кажіть простіше й рухайтеся далі.'),
    h('li', 'Замість паузи чи «uh» — фраза: «Well…», «Let me think…», «The thing is…».'),
    h('li', 'Повтор «I I I» — знак, що ви поспішаєте з початком. Почніть із фрази, а не з «I».'),
    h('li', '5–10 хвилин щодня дають більше, ніж година раз на тиждень.'));
  const tipsRow = txRow({ icon: 'lightbulb', label: 'Як займатися', sub: '4 поради', chevron: false, cls: 'fl-tips-row',
    end: ic('caret-down', { size: 16 }), attrs: { 'aria-expanded': 'false', 'aria-controls': 'fl-tips' },
    onclick: () => { tips.hidden = !tips.hidden; tipsRow.setAttribute('aria-expanded', String(!tips.hidden)); } });
  view.replaceChildren(h('div.stack-lg.fl',
    logged
      ? txPrimary({ icon: 'timer', label: 'Почати 4-3-2', sub: `Одна тема · ${steps}`, href: '#/fluency/432', attrs: { 'aria-label': `Почати 4-3-2. Одна тема — три раунди: ${ROUNDS.map(x => nSec(x.sec)).join(', ')}` } })
      : txLogin('Запис мовлення — після входу', 'AI порахує «uh» і повтори'),
    hist.length ? progressCard(hist) : null,
    txGroup('Замість «uh»', [
      logged ? txGrid([
        tx({ icon: 'quotes', label: 'Фрази', sub: `${GAMBITS.length} фраз`, href: '#/fluency/gambits' }),
        tx({ icon: 'lightning', label: 'Тренування', sub: last ? `Минулого разу ${last.ok} з ${last.n}` : `${DRILL_LEN} питань`, href: '#/fluency/drill' }),
      ], 2) : tx({ icon: 'quotes', wide: true, label: 'Фрази', sub: `${GAMBITS.length} фраз · можна вчити й без входу`, href: '#/fluency/gambits' })]),
    h('div.stack', tipsRow, tips)));
}

function progressCard(hist) {
  const pts = hist.slice(-12).map(x => sessionTotals(x.rounds));
  const lastP = pts[pts.length - 1], first = pts[0];
  const tile = (label, vals, cur, was, better, unit) => {
    const delta = pts.length > 1 ? cur - was : NaN;
    return h('div.fl-ptile',
      h('div.fl-ml', label),
      h('div.fl-mv', h('b', num(cur)), Number.isFinite(delta) && Math.abs(delta) >= 0.05
        ? h('span.fl-delta' + ((better === 'up' ? delta > 0 : delta < 0) ? '.good' : '.bad'), `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))}${unit}`) : null),
      vals.length > 1 ? sparkline(vals, `${label}: ${vals.map(v => num(v)).join(', ')}`) : null,
      vals.length > 1 ? h('div.fl-ms', `було ${num(was)} на початку`) : null);
  };
  return txGroup(`Ваш прогрес · ${hist.length} ${plural(hist.length, 'сесія', 'сесії', 'сесій')}`, [
    h('div.fl-two.fl-progress',
      tile('Заминки на 100 слів', pts.map(p => p.per100), lastP.per100, first.per100, 'down', ''),
      tile('Слів за хвилину', pts.map(p => p.wpm), lastP.wpm, first.wpm, 'up', '')),
    pts.length < 2 ? h('p.xs.dim.fl-note', 'Пройдіть ще одну сесію — і тут з\'явиться динаміка.') : null]);
}

// ---------- Фрази «замість uh» ----------
function gambitsPage(view) {
  setTitle('Тренажер плавності');
  view.replaceChildren(h('div.stack-lg.fl',
    pageHead('Замість «uh»', `${GAMBITS.length} фраз · торкніться, щоб почути`),
    user() ? txPrimary({ icon: 'lightning', label: `Тренування · ${DRILL_LEN} питань`, sub: `Питання — і за ${DRILL_START_SEC} с почати з фрази`, href: '#/fluency/drill' }) : null,
    GAMBIT_GROUPS.map(g => txGroup(g.uk, txRows(g.items.map(x => txRow({ icon: 'speaker-high', chevron: false, cls: 'fl-say',
      label: h('span', { lang: 'en' }, x.en), sub: x.uk, onclick: () => speak(x.en.replace(/…/g, '')),
      attrs: { 'aria-label': `Прослухати: ${x.en.replace('…', '')} — ${x.uk}` } }))))),
    h('p.xs.dim.fl-note', 'Кажіть їх спокійно, з паузою після коми — це звучить упевнено, а не як заминка.')));
}

// ---------- Ведення раунду запису (спільне для 4-3-2 і тренування) ----------
/** Кільце відліку: повертає { el, set(leftMs, totalMs) } */
function countdownRing(size = 220, stroke = 12) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const s = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  const mk = (cls) => svg('circle', { class: cls, cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': 0, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const bar = mk('fl-ring-bar');
  s.append(mk('fl-ring-track'), bar);
  const secEl = h('b.fl-sec', '0');
  const el = h('div.fl-ring', { style: { width: size + 'px', height: size + 'px' } }, s, h('div.fl-ring-in', secEl, h('span.fl-ring-sub', 'секунд')));
  let lastSec = -1;
  return {
    el,
    set(left, total) {
      bar.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, left / total)))));
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) { lastSec = sec; secEl.textContent = String(sec); el.classList.toggle('low', sec <= 5); }
    },
  };
}

/** Індикатор гучності: 16 стовпчиків, що біжать праворуч наліво */
function levelMeter() {
  const N = 16, bars = Array.from({ length: N }, () => h('i'));
  const el = h('div.fl-meter', { 'aria-hidden': 'true' }, bars);
  const hist = new Array(N).fill(0);
  let t = 0;
  return {
    el,
    push(level, voiced) {
      const now = performance.now();
      if (now - t < (reduceMotion() ? 250 : 90)) return;
      t = now;
      hist.shift(); hist.push(level < 0 ? 0 : level);
      bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.15, hist[i]).toFixed(3)})`; });
      el.classList.toggle('on', !!voiced);
      el.classList.toggle('none', level < 0);
    },
  };
}

/** Аудіо → дослівний текст (hint 'fluency' — зберігає um/uh і повтори) */
async function transcribe(rec, topicText, signal) {
  const audio = await blobToBase64(rec.blob);
  const payload = { audio, mime: rec.mime, hint: 'fluency' };
  if (topicText) payload.context = { tutor: topicText };
  const res = await tutor('transcribe', payload, { signal });
  // службові позначки моделі («[unclear]», «(laughs)») — не слова учня: не рахуємо їх у темп
  // заминка в дужках («(um)») лишається заминкою
  return String(res?.text || '').replace(/\[[^\]]*\]|\(([^)]*)\)/g, (all, inner) => (inner != null && isFiller(normWord(inner)) ? ` ${inner} ` : ' '))
    .replace(/^\s*unclear\s*$/i, '').replace(/\s+/g, ' ').trim();
}

// ---------- 4-3-2 ----------
function fourThreeTwo(view) {
  setTitle('Тренажер плавності');
  if (!user()) { view.replaceChildren(h('div.stack-lg.fl', pageHead('4-3-2', 'Одна тема — три раунди'), loginCard())); return; }
  const timer = activityTimer('fluency');
  const mic = createMic();
  const body = h('div.stack-lg.fl.fl-432');
  view.replaceChildren(body);
  let live = null, ac = null, gone = false, saved = false;
  const st = { topic: null, rounds: [], custom: '' };
  const interests = interestTopics();
  const interestN = interests.length;
  const topics = [...interests, ...TOPICS];

  const cleanup = () => {
    gone = true;
    live?.cancel(); live = null;
    ac?.abort();
    mic.close();
    stopSpeech();
    setFocus(false);
    timer.stop();
  };
  onLeave(view, cleanup);

  // --- вибір теми ---
  const pickTopic = () => {
    setFocus(false);
    mic.close();   // вибір теми може тривати довго — мікрофон (і червоний індикатор iOS) не тримаємо
    const custom = h('input.input', { type: 'text', lang: 'en', maxlength: 80, placeholder: 'My job, my dog, a book I read…', value: st.custom, 'aria-label': 'Своя тема англійською або українською', autocomplete: 'off' });
    const chips = h('div.chips.fl-topics', { role: 'group', 'aria-label': 'Теми' });
    const preview = h('div.fl-preview');
    const startBtn = txPrimary({ icon: 'microphone', label: `Почати · ${nSec(ROUNDS[0].sec)}`, sub: 'Три раунди про вибрану тему', onclick: () => {} });
    const sel = () => st.topic;
    let moreOpen = false;
    const drawChips = () => {
      // коротко: інтереси + 5 тем; решта — за «Ще теми» (або якщо вибрана тема серед них)
      const short = interestN + 5;
      const hiddenSel = topics.findIndex(t => t.id === sel()?.id) >= short;
      const shown = moreOpen || hiddenSel ? topics : topics.slice(0, short);
      fill(chips, shown.map(t => h('button.chip', { type: 'button', 'aria-pressed': String(sel()?.id === t.id), onclick: () => { st.topic = t; drawChips(); } }, ic(t.icon, { size: 16 }), t.uk)),
        h('button.chip', { type: 'button', 'aria-pressed': String(sel()?.id === 'custom'), onclick: () => { st.topic = { id: 'custom', icon: 'pencil-simple', en: st.custom, uk: 'Моя тема', hints: ['What is it?', 'Why does it matter to you?', 'A story about it'] }; drawChips(); setTimeout(() => custom.focus(), 50); } }, ic('pencil-simple', { size: 16 }), 'Моя тема'),
        shown.length < topics.length ? h('button.chip.fl-more', { type: 'button', 'aria-expanded': 'false', onclick: () => { moreOpen = true; drawChips(); } }, ic('plus', { size: 16 }), `Ще теми · ${topics.length - shown.length}`) : null);
      const t = sel();
      const ok = t && (t.id !== 'custom' || st.custom.trim().length >= 2);
      startBtn.disabled = !ok;
      fill(preview, t ? h('div.gx-card.stack.fl-topic-card',
        t.id === 'custom' ? h('div.field', h('label', 'Про що розповісте?'), custom) : h('div.fl-topic-en', { lang: 'en' }, t.en),
        h('div.fl-hints', { lang: 'en' }, t.hints.map(x => h('span.tag', x)))) : h('div.small.dim.center.fl-pick-hint', 'Оберіть тему — далі три раунди про неї.'));
    };
    custom.addEventListener('input', () => { st.custom = custom.value; if (st.topic?.id === 'custom') { st.topic.en = custom.value.trim(); startBtn.disabled = st.custom.trim().length < 2; } });
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!startBtn.disabled) startBtn.click(); } });
    startBtn.addEventListener('click', () => { st.rounds = []; saved = false; startRound(0); });
    drawChips();
    fill(body,
      pageHead('4-3-2', `Одна тема — три раунди: ${ROUNDS.map(x => x.sec).join(' → ')} с`),
      txGroup('Тема', [chips, preview]),
      startBtn,
      txGroup('Як проходить', h('div.fl-why.fl-howto', h('ol',
        h('li', `Говоріть усі ${ROUNDS[0].sec} секунд, не зупиняючись. Помилки — не страшно.`),
        h('li', `Раунд 2: та сама тема, ${ROUNDS[1].sec} секунд — ті самі думки, швидше.`),
        h('li', `Раунд 3: ${ROUNDS[2].sec} секунд — найщільніше, без пауз і «uh».`)))));
  };

  // --- запис раунду ---
  const startRound = async (i) => {
    // викликається з тапу: мікрофон і звук — синхронно в жесті (iOS)
    stopSpeech();
    const ensure = mic.ensure();
    const total = ROUNDS[i].sec * 1000;
    const ring = countdownRing();
    const meter = levelMeter();
    const nudge = h('div.fl-nudge', { 'aria-live': 'polite' });
    const doneBtn = h('button.btn.primary.lg.block', { type: 'button', disabled: true }, ic('stop', { size: 20, fill: true }), 'Готово раніше');
    const cancelBtn = h('button.btn.ghost.block', { type: 'button' }, 'Скасувати раунд');
    ring.set(total, total);
    setFocus(true);
    fill(body,
      h('div.fl-rec', { role: 'region', 'aria-label': `Раунд ${i + 1} з ${ROUNDS.length}` },
        h('div.fl-rec-top', roundDots(i), h('div.fl-rec-label', `Раунд ${i + 1} з ${ROUNDS.length} · ${nSec(ROUNDS[i].sec)}`)),
        h('div.fl-rec-topic', { lang: 'en' }, st.topic.en),
        i ? h('div.small.dim.center', i === 1 ? 'Те саме — швидше. Можна пропускати дрібниці.' : 'Найкоротша версія: головне й без пауз.') : h('div.fl-hints.center', { lang: 'en' }, st.topic.hints.map(x => h('span.tag', x))),
        ring.el, meter.el, nudge,
        h('div.stack.fl-rec-acts', { style: { gap: '6px' } }, doneBtn, cancelBtn)));
    let nudgeAt = 0;
    try { await ensure; } catch (e) {
      setFocus(false);
      if (gone) return;
      fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`), micErrorCard(e, () => startRound(i)), tx({ icon: 'swap', wide: true, label: 'Змінити тему', onclick: pickTopic }));
      return;
    }
    if (gone) { mic.close(); return; }
    timer.poke();
    try {
      live = recordRound(mic, { maxMs: total, onTick: ({ left, level, voiced, silentMs, started }) => {
        ring.set(left, total);
        meter.push(level, voiced);
        // довга пауза — підказка фрази замість мовчання чи «uh»
        if (started && silentMs > 2600 && left > 3000) {
          if (!nudgeAt) { nudgeAt = performance.now(); const g = GAMBITS[Math.floor(Math.random() * GAMBITS.length)]; fill(nudge, h('span', 'Пауза? Скажіть: '), h('b', { lang: 'en' }, g.en)); nudge.classList.add('on'); }
        } else if (nudgeAt && performance.now() - nudgeAt > 1500) { nudgeAt = 0; nudge.classList.remove('on'); }
      } });
    } catch (e) {
      setFocus(false);
      fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`), micErrorCard(e, () => startRound(i)));
      return;
    }
    const ctl = live;
    doneBtn.disabled = false;
    doneBtn.addEventListener('click', () => ctl.stop());
    cancelBtn.addEventListener('click', () => { ctl.cancel(); });
    const rec = await ctl.done;
    if (live === ctl) live = null;
    setFocus(false);
    timer.poke();
    if (gone) return;
    if (!rec) { st.rounds.length ? roundResult(i - 1) : pickTopic(); return; }
    if (rec.ms < 3000 || rec.firstVoiceMs == null && rec.ms < 6000) { tooShort(i); return; }
    process(i, rec);
  };

  const tooShort = (i) => fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`),
    stateCard({ icon: 'hourglass', tone: 'warn', title: 'Запис надто короткий', lines: [`Спробуйте говорити всі ${nSec(ROUNDS[i].sec)} — навіть простими реченнями.`] }),
    txPrimary({ icon: 'microphone', label: `Раунд ${i + 1} ще раз`, sub: nSec(ROUNDS[i].sec), onclick: () => startRound(i) }));

  // --- розпізнавання ---
  const process = async (i, rec) => {
    fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`),
      stateCard({ icon: 'waveform', title: 'Розпізнаю мовлення…', lines: ['Дослівно, з усіма «uh» і повторами — так ми їх порахуємо.'], extra: [skelLines(3)], cls: '.fl-wait', attrs: { 'aria-busy': 'true' } }));
    ac = new AbortController();
    try {
      const text = await transcribe(rec, `Topic: ${st.topic.en}`, ac.signal);
      if (gone) return;
      if (!/[a-z]/i.test(text)) {
        fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`),
          stateCard({ icon: 'ear', tone: 'warn', title: 'Не вдалося розібрати мовлення', lines: ['Говоріть англійською, ближче до мікрофона, без шуму навколо.'] }),
          txPrimary({ icon: 'microphone', label: `Раунд ${i + 1} ще раз`, sub: nSec(ROUNDS[i].sec), onclick: () => startRound(i) }));
        return;
      }
      st.rounds[i] = { ...analyze(text, rec.spokenSec), text, limit: ROUNDS[i].sec };
      st.rounds.length = i + 1;
      if (i === ROUNDS.length - 1) finish(); else roundResult(i);
    } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(body, pageHead(st.topic.en, `4-3-2 · раунд ${i + 1}`),
        stateCard({ icon: 'warning-circle', tone: 'bad', title: 'Не вдалося розпізнати', lines: [aiErrorText(e)], cls: '.fl-err', attrs: { role: 'alert' } }),
        txPrimary({ icon: 'arrow-clockwise', label: 'Надіслати ще раз', sub: 'Запис збережено — повторимо розпізнавання', onclick: () => process(i, rec) }),
        tx({ icon: 'microphone', wide: true, label: 'Записати раунд заново', onclick: () => startRound(i) }));
    } finally { ac = null; }
  };

  // --- результат раунду ---
  const roundCard = (i, { compact = false } = {}) => {
    const r = st.rounds[i], p = st.rounds[i - 1];
    return txGroup(`Раунд ${i + 1} · ${nSec(r.limit)} · ${nWords(r.words)} за ${num(r.sec, 0)} с`, [
      h('div.fl-metrics',
        metric('слів за хвилину', String(r.wpm), { delta: p ? r.wpm - p.wpm : NaN, better: 'up' }),
        metric('заминки', String(r.fillers), { sub: `${num(r.per100)} на 100 слів`, delta: p ? r.per100 - p.per100 : NaN, better: 'down' }),
        metric('повтори', String(r.repeats), { sub: `${num(r.rep100)} на 100 слів`, delta: p ? r.rep100 - p.rep100 : NaN, better: 'down' })),
      compact ? h('details.fl-tx.gx-card', h('summary', 'Що ви сказали'), legend(), transcriptView(r.text))
        : h('div.gx-card.stack.fl-round', { style: { gap: '6px' } }, h('div.fl-txhead', h('div.fl-ml', 'Що ви сказали'), legend()), transcriptView(r.text))]);
  };
  const compareCard = () => st.rounds.length < 2 ? null : txGroup('Раунди поруч',
    h('div.fl-two.fl-compare',
      barChart({ title: 'Слів за хвилину', note: 'вище — краще', values: st.rounds.map(r => r.wpm), labels: st.rounds.map(r => nSec(r.limit)) }),
      barChart({ title: 'Заминки на 100 слів', note: 'нижче — краще', values: st.rounds.map(r => r.per100), labels: st.rounds.map(r => nSec(r.limit)) })));

  const roundResult = (i) => {
    const next = i + 1;
    fill(body,
      pageHead(st.topic.en, `4-3-2 · готово ${next} з ${ROUNDS.length}`),
      h('div.fl-rec-top.left', roundDots(next), h('div.fl-rec-label', `Готово ${next} з ${ROUNDS.length}`)),
      roundCard(i),
      compareCard(),
      txGroup(`Далі · раунд ${next + 1} · ${nSec(ROUNDS[next].sec)}`, [
        txPrimary({ icon: 'microphone', label: `Почати раунд ${next + 1}${next === 1 ? ' — те саме, але швидше' : ' — найкоротша версія'}`,
          sub: next === 1
            ? `Ту саму історію за ${ROUNDS[next].sec} секунд. Ті самі думки, менше пауз.`
            : `${ROUNDS[next].sec} секунд — лише головне. Почніть з фрази, а не з «uh».`,
          onclick: () => startRound(next) }),
        tx({ icon: 'flag', wide: true, label: 'Завершити й отримати відгук', sub: 'Підсумок за записаними раундами', onclick: finish })]));
  };

  // --- підсумок ---
  const finish = () => {
    mic.close();
    const rounds = st.rounds.filter(Boolean);
    if (!saved) { saveSession({ topic: st.topic.en, rounds }); saved = true; }
    const a = rounds[0], z = rounds[rounds.length - 1];
    const fb = h('section.gx-card.stack.fl-fb', { 'aria-live': 'polite' });
    const dW = z.wpm - a.wpm, dF = z.per100 - a.per100;
    const multi = rounds.length > 1;
    const good = multi && dW >= 5 && dF <= -0.5;
    fill(body,
      pageHead(st.topic.en, 'Підсумок 4-3-2'),
      resultHead({ icon: good ? 'trophy' : multi && (dW >= 5 || dF <= -0.5) ? 'thumbs-up' : 'timer', tone: good ? 'good' : multi && (dW >= 5 || dF <= -0.5) ? 'warn' : '',
        label: `4-3-2 · ${rounds.length} ${plural(rounds.length, 'раунд', 'раунди', 'раундів')}`, caption: verdict(rounds),
        kpis: multi ? [
          { value: `${dW >= 0 ? '+' : '−'}${Math.abs(dW)}`, label: 'слів за хвилину', tone: dW >= 5 ? 'good' : dW < 0 ? 'bad' : null },
          { value: num(z.per100), label: `заминок на 100 слів (було ${num(a.per100)})`, tone: dF <= -0.5 ? 'good' : dF > 0.5 ? 'bad' : null },
          { value: z.wpm, label: 'темп в останньому раунді' },
        ] : [
          { value: a.wpm, label: 'слів за хвилину' },
          { value: num(a.per100), label: 'заминок на 100 слів' },
          { value: a.words, label: plural(a.words, 'слово', 'слова', 'слів') },
        ] }),
      compareCard(),
      txGroup('Відгук вчителя', fb),
      rounds.map((_, i) => roundCard(i, { compact: true })),
      h('section.tx-group',
        txPrimary({ icon: 'arrow-clockwise', label: 'Нова тема', sub: 'Ще одна сесія 4-3-2', onclick: () => { st.rounds = []; st.topic = null; pickTopic(); } }),
        txGrid([
          tx({ icon: 'lightning', label: 'Замість «uh»', sub: 'Тренування фраз', href: '#/fluency/drill' }),
          tx({ icon: 'timer', label: 'До тренажера', sub: 'Прогрес і поради', href: '#/fluency' }),
        ], 2)));
    loadFeedback(fb, rounds);
  };

  const loadFeedback = async (fb, rounds) => {
    fill(fb, skelLines(3));
    ac = new AbortController();
    try {
      const res = await tutor('fluency_feedback', { topic: st.topic.en, rounds: rounds.map(r => ({ sec: r.sec, text: r.text, wpm: r.wpm, fillers: r.fillers, repeats: r.repeats })) }, { signal: ac.signal });
      if (gone || !fb.isConnected) return;
      renderFeedback(fb, res || {});
    } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(fb, h('div.small.dim', aiErrorText(e) || 'Не вдалося отримати відгук.'),
        h('button.btn.soft.block', { type: 'button', onclick: () => loadFeedback(fb, rounds) }, ic('arrow-clockwise', { size: 18 }), 'Спробувати ще раз'));
    } finally { ac = null; }
  };

  pickTopic();
  return cleanup;
}

function roundDots(doneCount) {
  return h('div.fl-dots', { 'aria-hidden': 'true' }, ROUNDS.map((_, k) => h('i' + (k < doneCount ? '.done' : k === doneCount ? '.cur' : ''))));
}

/** Короткий висновок для синьої картки */
function verdict(rounds) {
  if (rounds.length < 2) return 'Перший раунд записано';
  const a = rounds[0], z = rounds[rounds.length - 1];
  const faster = z.wpm - a.wpm >= 5, cleaner = z.per100 <= a.per100 - 0.5;
  if (faster && cleaner) return 'Швидше й чистіше — так і працює 4-3-2';
  if (faster) return 'Темп виріс — тепер приберіть заминки';
  if (cleaner) return 'Заминок поменшало — далі темп';
  return 'Добра розминка — завтра ще раз';
}

function renderFeedback(fb, res) {
  const better = Array.isArray(res.better) ? res.better.filter(b => b?.from && b?.to) : [];
  const gambits = Array.isArray(res.gambits) ? res.gambits.filter(g => typeof g === 'string' && g.trim()) : [];
  fill(fb,
    res.summary_uk ? h('p.fl-sumtext', String(res.summary_uk)) : h('p.small.dim', 'Вчитель не дав коментаря — подивіться на цифри вище.'),
    better.length ? h('div.stack', { style: { gap: '8px' } },
      h('h3.tx-label.fl-sublbl', 'Як сказати плавніше'),
      better.map(b => h('div.fl-better',
        h('div.fl-from', { lang: 'en' }, String(b.from)),
        h('button.fl-to', { type: 'button', 'aria-label': `Прослухати: ${b.to}`, onclick: () => speak(String(b.to)) },
          ic('speaker-high', { size: 18 }), h('span', { lang: 'en' }, String(b.to)))))) : null,
    gambits.length ? h('div.stack', { style: { gap: '8px' } },
      h('h3.tx-label.fl-sublbl', 'Фрази для цієї теми'),
      h('div.chips', gambits.map(g => h('button.chip.fl-gchip', { type: 'button', lang: 'en', onclick: () => speak(String(g).replace(/…/g, '')) }, ic('speaker-high', { size: 16 }), String(g))))) : null);
}

// ---------- Тренування «почни з фрази» ----------
function drill(view) {
  setTitle('Тренажер плавності');
  if (!user()) { view.replaceChildren(h('div.stack-lg.fl', pageHead('Почни з фрази', 'Тренування · замість «uh»'), loginCard())); return; }
  const timer = activityTimer('fluency');
  const mic = createMic();
  const body = h('div.stack-lg.fl.fl-drill');
  view.replaceChildren(body);
  let live = null, ac = null, gone = false;
  let qs = [], idx = 0, results = [];
  const cheat = GAMBITS.filter(g => g.group === 'start' || g.group === 'think');

  const cleanup = () => {
    gone = true;
    live?.cancel(); live = null;
    ac?.abort();
    mic.close(); stopSpeech(); setFocus(false); timer.stop();
  };
  onLeave(view, cleanup);

  const intro = () => {
    fill(body,
      pageHead('Почни з фрази', `Тренування · ${DRILL_LEN} питань · ~3 хв`),
      txGroup('Питання — і одразу фраза', [
        h('p.xs.dim.fl-note', `Питання з'явиться на екрані. За ${DRILL_START_SEC} секунди почніть відповідь фразою — «Well…», «Let me think…» — і говоріть близько 10 секунд.`),
        txPrimary({ icon: 'play', label: 'Почати', sub: `${DRILL_LEN} питань · мікрофон увімкнеться одразу`, onclick: () => { qs = pickQuestions(); idx = 0; results = []; ask(); } })]),
      txGroup('Фрази для початку · торкніться, щоб почути',
        h('div.chips', cheat.map(g => h('button.chip.fl-gchip', { type: 'button', lang: 'en', onclick: () => speak(g.en.replace(/…/g, '')) }, ic('speaker-high', { size: 16 }), g.en)))),
      tx({ icon: 'quotes', wide: true, label: 'Усі фрази з перекладом', sub: `${GAMBITS.length} фраз за групами`, href: '#/fluency/gambits' }));
  };

  // з тапу: питання з'являється й одразу йде запис
  const ask = async () => {
    stopSpeech();
    const ensure = mic.ensure();
    const q = qs[idx];
    const total = DRILL_SPEAK_SEC * 1000;
    const startBar = h('div.fl-startbar', h('i'));
    const startLbl = h('div.fl-startlbl', { 'aria-live': 'polite' }, `Почніть з фрази · ${DRILL_START_SEC} с`);
    const ring = countdownRing(132, 9);
    const meter = levelMeter();
    const doneBtn = h('button.btn.primary.lg.block', { type: 'button', disabled: true }, ic('stop', { size: 20, fill: true }), 'Готово');
    ring.set(total, total);
    setFocus(true);
    fill(body,
      h('div.fl-rec.fl-ask',
        h('div.fl-rec-top', h('div.fl-rec-label', `Питання ${idx + 1} з ${qs.length}`)),
        h('div.gx-card.stack.center.fl-q', h('div.fl-q-en', { lang: 'en' }, q.en), h('div.small.dim', q.uk)),
        startLbl, startBar,
        h('div.fl-cheat', { lang: 'en', 'aria-label': 'Підказка: фрази' }, cheat.slice(0, 6).map(g => h('span', g.en))),
        h('div.row.fl-ask-mid', ring.el, meter.el),
        doneBtn));
    try { await ensure; } catch (e) {
      setFocus(false);
      if (!gone) fill(body, pageHead('Почни з фрази', `Питання ${idx + 1} з ${qs.length}`), micErrorCard(e, ask));
      return;
    }
    if (gone) { mic.close(); return; }
    timer.poke();
    let startedFlag = false;
    try {
      live = recordRound(mic, { maxMs: total, onTick: ({ left, elapsed, level, voiced, started }) => {
        ring.set(left, total);
        meter.push(level, voiced);
        const frac = Math.min(1, elapsed / (DRILL_START_SEC * 1000));
        startBar.firstChild.style.transform = `scaleX(${(1 - frac).toFixed(3)})`;
        if (started && !startedFlag) { startedFlag = true; startBar.classList.add('ok'); startLbl.textContent = 'Почали — говоріть далі'; }
        else if (!started && frac >= 1 && !startBar.classList.contains('late')) { startBar.classList.add('late'); startLbl.textContent = 'Скажіть хоч щось: «Well, let me think…»'; }
      } });
    } catch (e) { setFocus(false); fill(body, micErrorCard(e, ask)); return; }
    const ctl = live;
    doneBtn.disabled = false;
    doneBtn.addEventListener('click', () => ctl.stop());
    const rec = await ctl.done;
    if (live === ctl) live = null;
    setFocus(false);
    timer.poke();
    if (gone || !rec) return;
    check(q, rec);
  };

  const check = async (q, rec) => {
    fill(body, h('div.fl-rec-top', h('div.fl-rec-label', `Питання ${idx + 1} з ${qs.length}`)),
      stateCard({ icon: 'waveform', title: 'Розпізнаю…', extra: [skelLines(2)], cls: '.fl-wait', attrs: { 'aria-busy': 'true' } }));
    ac = new AbortController();
    let text = '';
    try { text = await transcribe(rec, q.en, ac.signal); } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(body, stateCard({ icon: 'warning-circle', tone: 'bad', title: 'Не вдалося розпізнати', lines: [aiErrorText(e)], cls: '.fl-err', attrs: { role: 'alert' } }),
        txPrimary({ icon: 'arrow-clockwise', label: 'Надіслати ще раз', sub: 'Запис збережено — повторимо розпізнавання', onclick: () => check(q, rec) }),
        tx({ icon: 'microphone', wide: true, label: 'Відповісти заново', onclick: ask }));
      return;
    } finally { ac = null; }
    if (gone) return;
    const m = analyze(text, rec.spokenSec);
    const gs = gambitStart(text);
    const latency = rec.firstVoiceMs;
    const res = { q: q.idx, ok: !!gs.gambit && gs.leadFillers === 0, gambit: gs.gambit, leadFillers: gs.leadFillers, latency, fillers: m.fillers, words: m.words, text };
    results[idx] = res;
    feedback(q, res);
  };

  const feedback = (q, res) => {
    const last = idx >= qs.length - 1;
    const said = res.text && /[a-z]/i.test(res.text);
    const title = !said ? 'Відповіді не чути'
      : res.ok ? `Почали з «${res.gambit}»`
        : res.gambit ? `«${res.gambit}» — але після «uh»` : 'Без фрази на початку';
    const tip = !said ? 'Говоріть англійською, ближче до мікрофона.'
      : res.ok ? 'Саме так: фраза дала час подумати, а слухач чує впевнену відповідь.'
        : res.gambit ? 'Почніть одразу з фрази — без «uh» перед нею.'
          : `Ви почали з «${res.text.split(/\s+/).slice(0, 4).join(' ')}…». Спробуйте: «${pickTip(q)}»`;
    fill(body,
      h('div.fl-rec-top', h('div.fl-rec-label', `Питання ${idx + 1} з ${qs.length}`)),
      h('section.fl-verdict' + (res.ok ? '.good' : '.warn'), { role: 'status' },
        h('span.tx-sq.fl-vico', ic(res.ok ? 'check-circle' : 'lightbulb', { size: 22, fill: true })),
        h('div.grow', h('div.fl-vt', title), h('div.small', tip))),
      said ? h('div.fl-metrics',
        metric('почали через', res.latency == null ? '—' : res.latency < 300 ? 'одразу' : `${num(res.latency / 1000)} с`, { sub: res.latency != null && res.latency <= DRILL_START_SEC * 1000 ? 'вчасно' : 'повільно' }),
        metric('заминки', String(res.fillers), { sub: res.words ? `на ${nWords(res.words)}` : '' }),
        metric('слів', String(res.words))) : null,
      said ? h('section.gx-card.stack.fl-round', h('div.fl-txhead', h('div.fl-ml', { lang: 'en' }, q.en), legend()), transcriptView(res.text)) : null,
      h('section.tx-group',
        last ? txPrimary({ icon: 'flag', label: 'Підсумок', sub: `${qs.length} ${plural(qs.length, 'питання', 'питання', 'питань')} пройдено`, onclick: summary })
          : txPrimary({ icon: 'microphone', label: 'Наступне питання', sub: `${idx + 2} з ${qs.length} · запис почнеться одразу`, onclick: () => { idx++; ask(); } }),
        tx({ icon: 'arrow-clockwise', wide: true, label: 'Ще раз це питання', onclick: ask })));
  };

  const summary = () => {
    mic.close();
    const done = results.filter(Boolean);
    const ok = done.filter(r => r.ok).length;
    const fillers = done.reduce((a, r) => a + r.fillers, 0), words = done.reduce((a, r) => a + r.words, 0);
    const lat = done.filter(r => r.latency != null).map(r => r.latency);
    saveDrill({ n: done.length, ok, fillers, words, qs: qs.map(q => q.idx) });
    const used = [...new Set(done.map(r => r.gambit).filter(Boolean))];
    fill(body,
      pageHead('Почни з фрази', 'Підсумок тренування'),
      resultHead({ icon: ok === done.length ? 'trophy' : ok ? 'thumbs-up' : 'barbell', tone: ok === done.length ? 'good' : ok ? 'warn' : 'bad',
        label: `${done.length} ${plural(done.length, 'питання', 'питання', 'питань')}`,
        caption: ok === done.length ? 'Кожна відповідь — з фрази. Чудово!' : ok ? `${ok} з ${done.length} відповідей почато з фрази` : 'Поки без фраз — спробуйте ще раз',
        kpis: [
          { value: `${ok}/${done.length}`, label: 'почато з фрази', tone: ok === done.length ? 'good' : ok ? null : 'bad' },
          { value: words ? num(fillers / words * 100) : '0', label: 'заминок на 100 слів' },
          { value: lat.length ? num(lat.reduce((a, b) => a + b, 0) / lat.length / 1000) : '—', unit: lat.length ? 'с' : '', label: 'до початку відповіді' },
        ] }),
      used.length ? txGroup('Ви вжили', h('div.chips', used.map(g => h('span.tag.accent', { lang: 'en' }, g)))) : null,
      h('section.tx-group',
        txPrimary({ icon: 'arrow-clockwise', label: `Ще ${DRILL_LEN} питань`, sub: 'Нові питання, ті самі фрази', onclick: () => { qs = pickQuestions(); idx = 0; results = []; ask(); } }),
        txGrid([
          tx({ icon: 'timer', label: '4-3-2', sub: 'Одна тема — три раунди', href: '#/fluency/432' }),
          tx({ icon: 'chart-line-up', label: 'До тренажера', sub: 'Прогрес і поради', href: '#/fluency' }),
        ], 2)));
  };

  intro();
  return cleanup;
}

/** Підказка-фраза, що пасує до питання */
function pickTip(q) {
  const s = q.en.toLowerCase();
  if (/would you rather|prefer|better/.test(s)) return 'Well, to be honest, I\'d say…';
  if (/tell me|describe/.test(s)) return 'Well, let me think…';
  if (/why|what makes/.test(s)) return 'That\'s a good question. I\'d say…';
  return 'Well, actually…';
}

