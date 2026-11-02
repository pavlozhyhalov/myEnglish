// Тренажер плавності (#/fluency): головна тренажера, «4-3-2» (#/fluency/432), фрази «замість uh» (#/fluency/gambits),
// тренування «почни з фрази» (#/fluency/drill). Метрики й запис — js/fluency.js; AI — лише транскрипція й один відгук.
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import { tutor, aiErrorText } from '../ai.js';
import { speak, stop as stopSpeech, blobToBase64 } from '../speech.js';
import { setTitle, setFocus } from '../ui/shell.js';
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
function pageHead(title, sub, back = '#/fluency') {
  return h('div.row.fl-head',
    back ? h('a.icon-btn', { href: back, 'aria-label': 'До тренажера плавності' }, ic('arrow-left')) : h('div.emoji-circle', ic('timer')),
    h('div.grow', h('h1', title), sub ? h('div.small.dim', sub) : null));
}

function loginCard() {
  return h('section.card.stack.fl-login',
    h('div.row', { style: { alignItems: 'flex-start', gap: '12px' } }, h('span.tile-ico', ic('microphone', { size: 22 })),
      h('div.grow.stack', { style: { gap: '4px' } }, h('div.fl-strong', 'Потрібен вхід в акаунт'),
        h('div.small.dim', 'Ваше мовлення дослівно розпізнає AI — з усіма «uh» і повторами, щоб їх порахувати. Це працює після входу.'))),
    h('a.btn.primary.block', { href: '#/auth' }, 'Увійти'),
    h('a.btn.ghost.block', { href: '#/fluency/gambits' }, 'Подивитися фрази «замість uh»'));
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
  return h('section.card.stack.fl-err', { role: 'alert' },
    h('div.row', { style: { alignItems: 'flex-start', gap: '12px' } }, h('span.tile-ico.bad', ic('microphone-slash', { size: 22 })),
      h('div.grow.stack', { style: { gap: '6px' } }, h('div.fl-strong', title), lines.map(l => h('div.small.dim', l)))),
    onRetry ? h('button.btn.primary.block', { type: 'button', onclick: onRetry }, ic('arrow-clockwise', { size: 18 }), 'Спробувати ще раз') : null);
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
  view.replaceChildren(h('div.stack-lg.fl',
    pageHead('Тренажер плавності', 'Говоріть довше — без «uh» і «I I I»', null),
    logged ? null : loginCard(),
    hist.length ? progressCard(hist) : null,
    h('section.fl-hero',
      h('div.label', 'Техніка 4-3-2'),
      h('div.fl-hero-t', 'Одна тема — три раунди'),
      h('div.fl-steps', { 'aria-label': 'Раунди: 60, 45 і 30 секунд' }, ROUNDS.map((x, i) => [i ? h('span.fl-arrow', { 'aria-hidden': 'true' }, ic('arrow-right', { size: 14 })) : null, h('span.fl-step', nSec(x.sec))])),
      h('div.sub', 'Розповідаєте те саме щоразу коротше. Фрази стають звичними, паузи й «uh» зникають — мовлення густішає.'),
      logged ? h('a.btn.start', { href: '#/fluency/432' }, ic('play', { size: 18, fill: true }), 'Почати') : null),
    h('section.card.stack.fl-gcard',
      h('div.row', { style: { gap: '12px', alignItems: 'flex-start' } }, h('span.tile-ico', ic('quotes', { size: 22 })),
        h('div.grow', h('div.fl-strong', 'Замість «uh»'),
          h('div.small.dim', `${GAMBITS.length} фраз, що дають час подумати й зв'язують думки. Тренування: питання — і за ${DRILL_START_SEC} секунди почати з такої фрази.`))),
      last ? h('div.xs.dim', `Останнє тренування: ${last.ok} з ${last.n} відповідей почато з фрази`) : null,
      h('div.fl-two',
        h('a.btn.soft', { href: '#/fluency/gambits' }, ic('book-open-text', { size: 18 }), 'Фрази'),
        logged ? h('a.btn.primary', { href: '#/fluency/drill' }, ic('lightning', { size: 18, fill: true }), 'Тренування') : null)),
    h('section.card.soft.stack.fl-why',
      h('div.fl-strong', 'Як займатися'),
      h('ul.fl-tips',
        h('li', 'Не шукайте ідеальне слово — кажіть простіше й рухайтеся далі.'),
        h('li', 'Замість паузи чи «uh» — фраза: «Well…», «Let me think…», «The thing is…».'),
        h('li', 'Повтор «I I I» — знак, що ви поспішаєте з початком. Почніть із фрази, а не з «I».'),
        h('li', '5–10 хвилин щодня дають більше, ніж година раз на тиждень.')))));
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
  return h('section.card.stack.fl-progress',
    h('div.row.between', h('div.fl-strong', 'Ваш прогрес'), h('span.xs.dim', `${hist.length} ${plural(hist.length, 'сесія', 'сесії', 'сесій')} 4-3-2`)),
    h('div.fl-two',
      tile('Заминки на 100 слів', pts.map(p => p.per100), lastP.per100, first.per100, 'down', ''),
      tile('Слів за хвилину', pts.map(p => p.wpm), lastP.wpm, first.wpm, 'up', '')),
    pts.length < 2 ? h('div.xs.dim', 'Пройдіть ще одну сесію — і тут з\'явиться динаміка.') : null);
}

// ---------- Фрази «замість uh» ----------
function gambitsPage(view) {
  setTitle('Замість «uh»');
  view.replaceChildren(h('div.stack-lg.fl',
    pageHead('Замість «uh»', 'Торкніться фрази, щоб почути'),
    user() ? h('a.btn.primary.lg.block', { href: '#/fluency/drill' }, ic('lightning', { size: 20, fill: true }), `Тренування · ${DRILL_LEN} питань`) : null,
    GAMBIT_GROUPS.map(g => h('section.stack', { style: { gap: '8px' } },
      h('div.section-title', g.uk),
      h('div.list', g.items.map(x => h('button.list-row.fl-say', { type: 'button', 'aria-label': `Прослухати: ${x.en.replace('…', '')}`, onclick: () => speak(x.en.replace(/…/g, '')) },
        h('span.fl-spk', ic('speaker-high', { size: 18 })),
        h('span.grow.fl-say-t', h('span.fl-en', { lang: 'en' }, x.en), h('span.fl-uk', x.uk))))))),
    h('div.xs.dim.center', 'Кажіть їх спокійно, з паузою після коми — це звучить упевнено, а не як заминка.')));
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
  setTitle('4-3-2');
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
    const startBtn = h('button.btn.primary.lg.block', { type: 'button' }, ic('microphone', { size: 20, fill: true }), `Почати · ${nSec(ROUNDS[0].sec)}`);
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
      fill(preview, t ? h('div.card.stack.fl-topic-card',
        t.id === 'custom' ? h('div.field', h('label', 'Про що розповісте?'), custom) : h('div.fl-topic-en', { lang: 'en' }, t.en),
        h('div.fl-hints', { lang: 'en' }, t.hints.map(x => h('span.tag', x)))) : h('div.small.dim.center.fl-pick-hint', 'Оберіть тему — далі три раунди про неї.'));
    };
    custom.addEventListener('input', () => { st.custom = custom.value; if (st.topic?.id === 'custom') { st.topic.en = custom.value.trim(); startBtn.disabled = st.custom.trim().length < 2; } });
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!startBtn.disabled) startBtn.click(); } });
    startBtn.addEventListener('click', () => { st.rounds = []; saved = false; startRound(0); });
    drawChips();
    fill(body,
      pageHead('4-3-2', `Одна тема — три раунди: ${ROUNDS.map(x => x.sec).join(' → ')} секунд`),
      h('section.stack', { style: { gap: '10px' } }, h('div.section-title', 'Тема'), chips),
      preview,
      startBtn,
      h('div.card.soft.fl-howto', h('ol',
        h('li', `Говоріть усі ${ROUNDS[0].sec} секунд, не зупиняючись. Помилки — не страшно.`),
        h('li', `Раунд 2: та сама тема, ${ROUNDS[1].sec} секунд — ті самі думки, швидше.`),
        h('li', `Раунд 3: ${ROUNDS[2].sec} секунд — найщільніше, без пауз і «uh».`))));
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
      fill(body, pageHead('4-3-2', st.topic.en), micErrorCard(e, () => startRound(i)), h('button.btn.ghost.block', { type: 'button', onclick: pickTopic }, 'Змінити тему'));
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
      fill(body, pageHead('4-3-2', st.topic.en), micErrorCard(e, () => startRound(i)));
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

  const tooShort = (i) => fill(body, pageHead('4-3-2', st.topic.en),
    h('section.card.stack.center.fl-short', ic('hourglass', { size: 36 }), h('div.fl-strong', 'Запис надто короткий'),
      h('div.small.dim', `Спробуйте говорити всі ${nSec(ROUNDS[i].sec)} — навіть простими реченнями.`),
      h('button.btn.primary.block', { type: 'button', onclick: () => startRound(i) }, ic('microphone', { size: 18, fill: true }), `Раунд ${i + 1} ще раз`)));

  // --- розпізнавання ---
  const process = async (i, rec) => {
    fill(body, pageHead('4-3-2', st.topic.en),
      h('section.card.stack.fl-wait', { 'aria-busy': 'true' },
        h('div.row', ic('waveform', { size: 22 }), h('div.fl-strong', 'Розпізнаю мовлення…')),
        h('div.small.dim', 'Дослівно, з усіма «uh» і повторами — так ми їх порахуємо.'),
        skelLines(3)));
    ac = new AbortController();
    try {
      const text = await transcribe(rec, `Topic: ${st.topic.en}`, ac.signal);
      if (gone) return;
      if (!/[a-z]/i.test(text)) {
        fill(body, pageHead('4-3-2', st.topic.en), h('section.card.stack.center.fl-short', ic('ear', { size: 36 }), h('div.fl-strong', 'Не вдалося розібрати мовлення'),
          h('div.small.dim', 'Говоріть англійською, ближче до мікрофона, без шуму навколо.'),
          h('button.btn.primary.block', { type: 'button', onclick: () => startRound(i) }, ic('microphone', { size: 18, fill: true }), `Раунд ${i + 1} ще раз`)));
        return;
      }
      st.rounds[i] = { ...analyze(text, rec.spokenSec), text, limit: ROUNDS[i].sec };
      st.rounds.length = i + 1;
      if (i === ROUNDS.length - 1) finish(); else roundResult(i);
    } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(body, pageHead('4-3-2', st.topic.en), h('section.card.stack.fl-err', { role: 'alert' },
        h('div.fl-strong', 'Не вдалося розпізнати'), h('div.small.dim', aiErrorText(e)),
        h('button.btn.primary.block', { type: 'button', onclick: () => process(i, rec) }, ic('arrow-clockwise', { size: 18 }), 'Надіслати ще раз'),
        h('button.btn.ghost.block', { type: 'button', onclick: () => startRound(i) }, 'Записати раунд заново')));
    } finally { ac = null; }
  };

  // --- результат раунду ---
  const roundCard = (i, { compact = false } = {}) => {
    const r = st.rounds[i], p = st.rounds[i - 1];
    return h('section.card.stack.fl-round',
      h('div.row.between', h('div.fl-strong', `Раунд ${i + 1} · ${nSec(r.limit)}`), h('span.xs.dim', `${nWords(r.words)} за ${num(r.sec, 0)} с`)),
      h('div.fl-metrics',
        metric('слів за хвилину', String(r.wpm), { delta: p ? r.wpm - p.wpm : NaN, better: 'up' }),
        metric('заминки', String(r.fillers), { sub: `${num(r.per100)} на 100 слів`, delta: p ? r.per100 - p.per100 : NaN, better: 'down' }),
        metric('повтори', String(r.repeats), { sub: `${num(r.rep100)} на 100 слів`, delta: p ? r.rep100 - p.rep100 : NaN, better: 'down' })),
      compact ? h('details.fl-tx', h('summary', 'Що ви сказали'), legend(), transcriptView(r.text))
        : h('div.stack', { style: { gap: '6px' } }, h('div.fl-txhead', h('div.fl-ml', 'Що ви сказали'), legend()), transcriptView(r.text)));
  };
  const compareCard = () => st.rounds.length < 2 ? null : h('section.card.stack.fl-compare',
    h('div.fl-strong', 'Раунди поруч'),
    h('div.fl-two',
      barChart({ title: 'Слів за хвилину', note: 'вище — краще', values: st.rounds.map(r => r.wpm), labels: st.rounds.map(r => nSec(r.limit)) }),
      barChart({ title: 'Заминки на 100 слів', note: 'нижче — краще', values: st.rounds.map(r => r.per100), labels: st.rounds.map(r => nSec(r.limit)) })));

  const roundResult = (i) => {
    const next = i + 1;
    fill(body,
      pageHead('4-3-2', st.topic.en),
      h('div.fl-rec-top.left', roundDots(next), h('div.fl-rec-label', `Готово ${next} з ${ROUNDS.length}`)),
      roundCard(i),
      compareCard(),
      h('section.fl-hero.fl-next',
        h('div.label', `Раунд ${next + 1} · ${nSec(ROUNDS[next].sec)}`),
        h('div.fl-hero-t', next === 1 ? 'Те саме — але швидше' : 'Найкоротша версія'),
        h('div.sub', next === 1
          ? `Розкажіть ту саму історію за ${ROUNDS[next].sec} секунд. Ті самі думки, менше пауз.`
          : `${ROUNDS[next].sec} секунд — лише головне. Почніть з фрази, а не з «uh».`),
        h('button.btn.start', { type: 'button', onclick: () => startRound(next) }, ic('microphone', { size: 18, fill: true }), `Почати раунд ${next + 1}`)),
      h('button.btn.ghost.block', { type: 'button', onclick: finish }, 'Завершити й отримати відгук'));
  };

  // --- підсумок ---
  const finish = () => {
    mic.close();
    const rounds = st.rounds.filter(Boolean);
    if (!saved) { saveSession({ topic: st.topic.en, rounds }); saved = true; }
    const a = rounds[0], z = rounds[rounds.length - 1];
    const fb = h('section.card.stack.fl-fb', { 'aria-live': 'polite' });
    const head = rounds.length > 1
      ? h('div.fl-hero-nums',
        h('div', h('b', `${z.wpm - a.wpm >= 0 ? '+' : '−'}${Math.abs(z.wpm - a.wpm)}`), h('span', 'слів за хвилину')),
        h('div', h('b', `${num(a.per100)} → ${num(z.per100)}`), h('span', 'заминок на 100 слів')))
      : h('div.fl-hero-nums', h('div', h('b', String(a.wpm)), h('span', 'слів за хвилину')), h('div', h('b', num(a.per100)), h('span', 'заминок на 100 слів')));
    fill(body,
      pageHead('Підсумок', st.topic.en),
      h('section.fl-hero.fl-sum',
        h('div.label', `4-3-2 · ${rounds.length} ${plural(rounds.length, 'раунд', 'раунди', 'раундів')}`),
        h('div.fl-hero-t', verdict(rounds)),
        head),
      compareCard(),
      fb,
      rounds.map((_, i) => roundCard(i, { compact: true })),
      h('div.fl-two',
        h('button.btn.primary', { type: 'button', onclick: () => { st.rounds = []; st.topic = null; pickTopic(); } }, ic('arrow-clockwise', { size: 18 }), 'Нова тема'),
        h('a.btn.soft', { href: '#/fluency/drill' }, ic('lightning', { size: 18 }), 'Замість «uh»')),
      h('a.btn.ghost.block', { href: '#/fluency' }, 'До тренажера'));
    loadFeedback(fb, rounds);
  };

  const loadFeedback = async (fb, rounds) => {
    fill(fb, h('div.row', ic('sparkle', { size: 20 }), h('div.fl-strong', 'Відгук вчителя')), skelLines(3));
    ac = new AbortController();
    try {
      const res = await tutor('fluency_feedback', { topic: st.topic.en, rounds: rounds.map(r => ({ sec: r.sec, text: r.text, wpm: r.wpm, fillers: r.fillers, repeats: r.repeats })) }, { signal: ac.signal });
      if (gone || !fb.isConnected) return;
      renderFeedback(fb, res || {});
    } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(fb, h('div.fl-strong', 'Відгук вчителя'), h('div.small.dim', aiErrorText(e) || 'Не вдалося отримати відгук.'),
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
    h('div.row', ic('sparkle', { size: 20 }), h('div.fl-strong', 'Відгук вчителя')),
    res.summary_uk ? h('p.fl-sumtext', String(res.summary_uk)) : h('p.small.dim', 'Вчитель не дав коментаря — подивіться на цифри вище.'),
    better.length ? h('div.stack', { style: { gap: '8px' } },
      h('div.section-title', 'Як сказати плавніше'),
      better.map(b => h('div.fl-better',
        h('div.fl-from', { lang: 'en' }, String(b.from)),
        h('button.fl-to', { type: 'button', 'aria-label': `Прослухати: ${b.to}`, onclick: () => speak(String(b.to)) },
          ic('speaker-high', { size: 18 }), h('span', { lang: 'en' }, String(b.to)))))) : null,
    gambits.length ? h('div.stack', { style: { gap: '8px' } },
      h('div.section-title', 'Фрази для цієї теми'),
      h('div.chips', gambits.map(g => h('button.chip.fl-gchip', { type: 'button', lang: 'en', onclick: () => speak(String(g).replace(/…/g, '')) }, ic('speaker-high', { size: 16 }), String(g))))) : null);
}

// ---------- Тренування «почни з фрази» ----------
function drill(view) {
  setTitle('Замість «uh»');
  if (!user()) { view.replaceChildren(h('div.stack-lg.fl', pageHead('Тренування', 'Почни відповідь із фрази'), loginCard())); return; }
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
      pageHead('Тренування', 'Почни відповідь із фрази'),
      h('section.fl-hero',
        h('div.label', `${DRILL_LEN} питань · ~3 хвилини`),
        h('div.fl-hero-t', 'Питання — і одразу фраза'),
        h('div.sub', `Питання з'явиться на екрані. За ${DRILL_START_SEC} секунди почніть відповідь фразою — «Well…», «Let me think…» — і говоріть близько 10 секунд.`),
        h('button.btn.start', { type: 'button', onclick: () => { qs = pickQuestions(); idx = 0; results = []; ask(); } }, ic('play', { size: 18, fill: true }), 'Почати')),
      h('section.stack', { style: { gap: '8px' } },
        h('div.section-title', 'Фрази для початку'),
        h('div.chips', cheat.map(g => h('button.chip.fl-gchip', { type: 'button', lang: 'en', onclick: () => speak(g.en.replace(/…/g, '')) }, ic('speaker-high', { size: 16 }), g.en)))),
      h('a.btn.ghost.block', { href: '#/fluency/gambits' }, 'Усі фрази з перекладом'));
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
        h('div.card.stack.center.fl-q', h('div.fl-q-en', { lang: 'en' }, q.en), h('div.small.dim', q.uk)),
        startLbl, startBar,
        h('div.fl-cheat', { lang: 'en', 'aria-label': 'Підказка: фрази' }, cheat.slice(0, 6).map(g => h('span', g.en))),
        h('div.row.fl-ask-mid', ring.el, meter.el),
        doneBtn));
    try { await ensure; } catch (e) {
      setFocus(false);
      if (!gone) fill(body, pageHead('Тренування', 'Почни відповідь із фрази'), micErrorCard(e, ask));
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
      h('section.card.stack.fl-wait', { 'aria-busy': 'true' }, h('div.row', ic('waveform', { size: 22 }), h('div.fl-strong', 'Розпізнаю…')), skelLines(2)));
    ac = new AbortController();
    let text = '';
    try { text = await transcribe(rec, q.en, ac.signal); } catch (e) {
      if (gone || e?.name === 'AbortError') return;
      fill(body, h('section.card.stack.fl-err', { role: 'alert' }, h('div.fl-strong', 'Не вдалося розпізнати'), h('div.small.dim', aiErrorText(e)),
        h('button.btn.primary.block', { type: 'button', onclick: () => check(q, rec) }, ic('arrow-clockwise', { size: 18 }), 'Надіслати ще раз'),
        h('button.btn.ghost.block', { type: 'button', onclick: ask }, 'Відповісти заново')));
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
      h('section.fl-verdict' + (res.ok ? '.good' : '.warn'),
        h('span.fl-vico', ic(res.ok ? 'check-circle' : 'lightbulb', { size: 28, fill: res.ok })),
        h('div.grow', h('div.fl-vt', title), h('div.small', tip))),
      said ? h('div.fl-metrics',
        metric('почали через', res.latency == null ? '—' : res.latency < 300 ? 'одразу' : `${num(res.latency / 1000)} с`, { sub: res.latency != null && res.latency <= DRILL_START_SEC * 1000 ? 'вчасно' : 'повільно' }),
        metric('заминки', String(res.fillers), { sub: res.words ? `на ${nWords(res.words)}` : '' }),
        metric('слів', String(res.words))) : null,
      said ? h('section.card.stack.fl-round', h('div.fl-txhead', h('div.fl-ml', { lang: 'en' }, q.en), legend()), transcriptView(res.text)) : null,
      h('div.stack', { style: { gap: '6px' } },
        last ? h('button.btn.primary.lg.block', { type: 'button', onclick: summary }, ic('flag', { size: 20 }), 'Підсумок')
          : h('button.btn.primary.lg.block', { type: 'button', onclick: () => { idx++; ask(); } }, ic('microphone', { size: 20, fill: true }), 'Наступне питання'),
        h('button.btn.ghost.block', { type: 'button', onclick: ask }, 'Ще раз це питання')));
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
      pageHead('Підсумок', 'Тренування «замість uh»'),
      h('section.fl-hero.fl-sum',
        h('div.label', `${done.length} ${plural(done.length, 'питання', 'питання', 'питань')}`),
        h('div.fl-hero-t', ok === done.length ? 'Кожна відповідь — з фрази. Чудово!' : ok ? `${ok} з ${done.length} відповідей почато з фрази` : 'Поки без фраз — спробуйте ще раз'),
        h('div.fl-hero-nums',
          h('div', h('b', words ? num(fillers / words * 100) : '0'), h('span', 'заминок на 100 слів')),
          h('div', h('b', lat.length ? `${num(lat.reduce((a, b) => a + b, 0) / lat.length / 1000)} с` : '—'), h('span', 'до початку відповіді')))),
      used.length ? h('section.stack', { style: { gap: '8px' } }, h('div.section-title', 'Ви вжили'), h('div.chips', used.map(g => h('span.tag.accent', { lang: 'en' }, g)))) : null,
      h('div.fl-two',
        h('button.btn.primary', { type: 'button', onclick: () => { qs = pickQuestions(); idx = 0; results = []; ask(); } }, ic('arrow-clockwise', { size: 18 }), 'Ще 5 питань'),
        h('a.btn.soft', { href: '#/fluency/432' }, ic('timer', { size: 18 }), '4-3-2')),
      h('a.btn.ghost.block', { href: '#/fluency' }, 'До тренажера'));
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

