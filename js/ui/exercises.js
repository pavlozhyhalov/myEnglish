// Движок вправ: choice | input | order | error | transform | translate
import { h, ic, progress } from './dom.js';
import { speak } from '../speech.js';
import { plural } from '../strings.js';
import { txKpis, txGroup, txPill, txRow, txRows } from './tiles.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { checkTyped } from '../wordlogic.js';

/*
 * Порівняння відповідей (аудит 2026-11-15, власник: «правильні відповіді не мають відхилятися, а хибні — зараховуватися»).
 * Рядок → слова: регістр, розділові знаки, лапки, діакритика, апострофи (’ ʼ ´ ` — укр. розкладка iPhone дає ʼ), кирилиця-двійник
 * у латинському слові (а/с/о…), британський = американський правопис (colour = color), числа словами = цифрами (seven = 7).
 * Скорочення розгортаються за контекстом: 's після займенника — is або has, 'd — would або had (had/has — лише перед
 * дієприкметником чи прислівником: «He's gone» = has, «She's green eyes» ≠ «She has green eyes»); «She is got», «would better» — ні.
 * Присвійне «brother's» у ЕТАЛОНІ ніколи не розгортається (brother is car ≠ brother's car); у відповіді учня іменник+'s
 * може бути is/has (My brother's a doctor = My brother is a doctor).
 */
const CYR = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i' };
// кирилиця-двійник лише в слові, де є латиниця, або в слові лише з таких літер (а замість a в пропуску)
const fixCyr = (w) => (/[a-z]/i.test(w) || /^[АВЕКМНОРСТХІаеорсухі']+$/.test(w)) ? w.replace(/[АВЕКМНОРСТХІаеорсухі]/g, c => CYR[c]) : w;
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90' };
// британський і американський правопис — одне слово (зводимо до американського)
const SPELL = { grey: 'gray', programme: 'program', programmes: 'programs', catalogue: 'catalog', dialogue: 'dialog', dialogues: 'dialogs',
  defence: 'defense', offence: 'offense', licence: 'license', pretence: 'pretense', jewellery: 'jewelry', aluminium: 'aluminum',
  enrol: 'enroll', enrolment: 'enrollment', fulfil: 'fulfill', skilful: 'skillful', wilful: 'willful', instalment: 'installment',
  judgement: 'judgment', ageing: 'aging', pyjamas: 'pajamas', plough: 'plow', sceptical: 'skeptical', mould: 'mold', moustache: 'mustache',
  cosy: 'cozy', doughnut: 'donut', tyre: 'tire', tyres: 'tires', maths: 'math', mum: 'mom', okay: 'ok', towards: 'toward',
  learnt: 'learned', dreamt: 'dreamed', spelt: 'spelled', burnt: 'burned', spoilt: 'spoiled', smelt: 'smelled', spilt: 'spilled',
  leapt: 'leaped', leant: 'leaned', knelt: 'kneeled', practise: 'practice', practised: 'practiced', practises: 'practices', practising: 'practicing' };
const ISE = 'organ|real|recogn|apolog|critic|emphas|memor|summar|special|priorit|final|minim|maxim|social|sympath|categor|character|civil|custom|familiar|global|harmon|legal|mobil|modern|normal|optim|personal|popular|standard|util|visual|author|colon|energ|fertil|hospital|industrial|jeopard|local|neutral|public|stabil|steril|symbol|terror|theor|vandal|general|ideal|immun|scrutin|agon|patron|sanit|computer|digit|monet|motor|natural|central|capital|apolog|item|subsid|synchron|tranquil';
const RE_ISE = new RegExp(`^(${ISE})is(e|es|ed|ing|ation|ations|er|ers)$`);
const RE_YSE = /^(anal|paral|catal)ys(e|es|ed|ing)$/;
const RE_OUR = /^(col|fav|flav|hon|hum|lab|neighb|behavi|harb|rum|vap|sav|arm|od|endeav|parl|splend|vig|rig|tum|ard)our(s|ed|ing|ite|ites|able|ably|less|ful|hood|hoods|er|ers|y|ful)?$/;
const RE_TRE = /^(cent|theat|met|lit|fib|calib|kilomet|centimet|millimet|spect|somb|lust|meag)re(s|d)?$/;
const RE_LL = /^(travel|cancel|model|label|fuel|level|signal|dial|quarrel|marvel|counsel|equal|total|channel|tunnel|shovel|snorkel|pedal|rival|duel|grovel|panel|refuel|unravel|jewel)l(ed|ing|er|ers)$/;
function spell(w) {
  if (SPELL[w]) return SPELL[w];
  if (NUM[w]) return NUM[w];
  return w.replace(RE_ISE, '$1iz$2').replace(RE_YSE, '$1yz$2').replace(RE_OUR, '$1or$2').replace(RE_TRE, '$1er$2').replace(RE_LL, '$1$2');
}
/** Рядок → слова: без розділових знаків і регістру; скорочення ще не розгорнуті */
function rawToks(s) {
  // «—» / «-» як відповідь («артикль не потрібен») — окремий знак, а не порожній рядок
  if (/^\s*[-–—]+\s*$/.test(String(s ?? ''))) return ['—'];
  let t = String(s ?? '').split(/(\s+)/).map(fixCyr).join('');
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’‘`´ʼ′]/g, "'").replace(/[“”«»„"]/g, ' ')
    .replace(/\.{2,}|…/g, ' ')                         // «have...been»
    .replace(/[/\\|()[\]{}]/g, ' ')                   // «do / have», підказки в дужках
    .replace(/(\p{L})-(?=\p{L})/gu, '$1 ')             // well-known = well known, twenty-one
    .replace(/(^|\s)[-–—]+(?=\s|$)/g, ' ')             // окреме тире
    .replace(/[.!?,;:]+/g, '');
  const out = [];
  for (let w of t.split(/\s+/)) {
    // лапки-апострофи довкола слова ('hello'); «'ll», «parents'» лишаються
    w = w.replace(/^'+(?!(s|d|ll|re|ve|m|em)$)/, '').replace(/([^s'])'+$/, '$1');
    if (!w) continue;
    w = spell(w);
    // двадцять один: 20 1 → 21
    const prev = out[out.length - 1];
    if (/^[2-9]0$/.test(prev || '') && /^[1-9]$/.test(w)) { out[out.length - 1] = String(+prev + +w); continue; }
    out.push(w);
  }
  return out;
}
const PRON_S = new Set(['he', 'she', 'it', 'that', 'there', 'what', 'where', 'who', 'here', 'how', 'this', 'when', 'why', 'which',
  'everyone', 'everybody', 'someone', 'somebody', 'nobody', 'nothing', 'everything', 'something', 'anyone', 'anybody']);
// дієприкметники (V3) неправильних дієслів; ті, що збігаються з V1 (come, put…), — окремо: перед ними 'd = would теж можливе
const V3 = new Set(('been gone done seen had made taken given written eaten driven ridden broken spoken chosen forgotten gotten got known shown grown thrown flown drawn worn torn born sworn fallen stolen woken frozen hidden bitten beaten risen shaken mistaken begun drunk sung swum rung bought brought thought taught caught fought sought sold told held felt left kept slept swept met lost sent spent built lent bent meant heard paid said laid found won sat stood understood fed led fled slid spun stuck struck hung dug shot lit learned burned dreamed spelled spoiled smelled spilled leaped leaned kneeled forgiven proven swollen withdrawn overtaken undertaken').split(' '));
const V13 = new Set('come become overcome run put cut set let hit hurt cost shut quit read spread burst'.split(' '));
const BASE_ED = new Set('need feed speed proceed succeed exceed bleed breed shed wed seed weed heed plead embed bed red bred'.split(' '));
const ADV = new Set('just already never ever not always recently finally still also only probably definitely certainly really since'.split(' '));
const isV3 = (w) => V3.has(w) || V13.has(w) || (/ed$/.test(w) && !BASE_ED.has(w));
const v3only = (w) => V3.has(w) || (/ed$/.test(w) && !BASE_ED.has(w));
/**
 * Варіанти прочитання слів зі скороченнями. student = відповідь учня (іменник+'s теж може бути is/has).
 * Повертає масив масивів слів (не більше 64 варіантів).
 */
function readings(s, student) {
  const toks = rawToks(s);
  let vars = [[]];
  const add = (opts) => {
    const next = [];
    for (const v of vars) for (const o of opts) { if (next.length < 64) next.push(v.concat(o)); }
    vars = next;
  };
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i], nx = toks[i + 1] || '';
    let m;
    if (w === "can't" || w === 'cannot') add([['can', 'not']]);
    else if (w === "won't") add([['will', 'not']]);
    else if (w === "shan't") add([['shall', 'not']]);
    else if (w === "ain't") add([[w]]);
    else if ((m = w.match(/^(\w+)n't$/))) add([[m[1], 'not']]);
    else if (w === "i'm" || w === "'m") add([w === "'m" ? ['am'] : ['i', 'am']]);
    else if (w === "let's") add([['let', 'us']]);
    else if ((m = w.match(/^(\w*)'(re|ve|ll)$/))) add([[m[1], { re: 'are', ve: 'have', ll: 'will' }[m[2]]].filter(Boolean)]);
    else if ((m = w.match(/^(\w*)'d$/))) {
      // 'd = would (крім «would better/been/gone…») або had (перед V3, прислівником, better)
      const o = [];
      if (!(v3only(nx) || nx === 'better')) o.push([m[1], 'would'].filter(Boolean));
      if (isV3(nx) || ADV.has(nx) || nx === 'better') o.push([m[1], 'had'].filter(Boolean));
      // «Oliver'd» в еталоні лишаємо як є
      if (m[1] && !PRON_S.has(m[1]) && !/^(i|you|we|they)$/.test(m[1]) && !student) { add([[w]]); continue; }
      add(o.length ? o : [[w]]);
    } else if ((m = w.match(/^(\w*)'s$/))) {
      const pron = PRON_S.has(m[1]);
      // іменник+'s у еталоні — присвійний, не розгортаємо
      if (!pron && !student) { add([[w]]); continue; }
      const o = pron ? [] : [[w]];
      if (!['got', 'gotten', 'been'].includes(nx)) o.push([m[1], 'is'].filter(Boolean));
      if (isV3(nx) || ADV.has(nx)) o.push([m[1], 'has'].filter(Boolean));
      add(o.length ? o : [[w]]);
    } else add([[w]]);
  }
  // can not = cannot
  return vars.map(v => v.join(' ').replace(/\bcan not\b/g, 'cannot').split(' ').filter(Boolean));
}
export function normalize(s) {
  return readings(s, false)[0].join(' ');
}
export function matches(answer, accepted) {
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(x => x != null);
  const mine = new Set(readings(answer, true).map(v => v.join(' ')));
  if (mine.has('')) return false;   // лише розділові знаки («?», «...») — не відповідь
  return list.some(x => readings(x, false).some(v => mine.has(v.join(' '))));
}

/**
 * Пропуск у реченні: учень міг вписати не лише пропущені слова, а й сусідні або все речення
 * («How long have you been waiting?» на «How long ___ you ___ (wait)?»). Зараховуємо, якщо написане —
 * суцільний шматок правильно заповненого речення, що містить усі пропуски.
 */
export function fitsBlanks(given, prompt, accepted) {
  const p = String(prompt || '').replace(/\([^)]*\)/g, ' ');
  const parts = p.split(/_{2,}/);
  const k = parts.length - 1;
  if (k < 1) return false;
  const mine = readings(given, true);
  const pre = readings(parts[0], false)[0].length, post = readings(parts[k], false)[0].length;
  for (const a of (Array.isArray(accepted) ? accepted : [accepted])) {
    const words = String(a ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length < k) continue;
    // розподіл слів відповіді між пропусками: кожному — хоча б одне, по порядку
    const fills = [];
    const split = (from, left, acc) => {
      if (fills.length > 40) return;
      if (left === 1) { fills.push([...acc, words.slice(from).join(' ')]); return; }
      for (let e = from + 1; e <= words.length - left + 1; e++) split(e, left - 1, [...acc, words.slice(from, e).join(' ')]);
    };
    split(0, k, []);
    for (const f of fills) {
      const full = parts.map((x, i) => x + (i < k ? ` ${f[i]} ` : '')).join('');
      for (const v of readings(full, false)) {
        for (const g of mine) {
          if (!g.length || g.length > v.length) continue;
          for (let s = 0; s <= pre && s + g.length <= v.length; s++) {
            if (s + g.length < v.length - post) continue;
            if (g.every((w, j) => w === v[s + j])) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Порівняння відповіді з найближчим правильним варіантом по словах (2026-11-14, власник: «це аргументоване виправлення?»):
 * зайві/хибні слова учня — закреслені, потрібні — зелені; так видно, ЩО саме не так, а не лише еталон.
 */
const wtoks = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const wkey = (w) => normalize(w);
function lcsPairs(a, b) {
  const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = wkey(a[i]) === wkey(b[j]) ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  return d;
}
export function closestAnswer(given, accepted) {
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(Boolean);
  const g = wtoks(given);
  let best = list[0], score = -1;
  for (const x of list) { const t = wtoks(x); const sc = lcsPairs(g, t)[0][0] * 2 - t.length; if (sc > score) { score = sc; best = x; } }
  return best;
}
export function wordDiff(given, target) {
  const a = wtoks(given), b = wtoks(target), d = lcsPairs(a, b);
  const out = []; let i = 0, j = 0;
  const push = (cls, w) => { out.push(h('span.ex-dw' + cls, w), ' '); };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && wkey(a[i]) === wkey(b[j])) { push('', b[j]); i++; j++; }
    // спершу закреслене слово учня, потім правильне: «history → story»
    else if (i < a.length && (j >= b.length || d[i + 1][j] >= d[i][j + 1])) { push('.del', a[i]); i++; }
    else { push('.add', b[j]); j++; }
  }
  if (!out.some(x => x?.classList?.contains('del') || x?.classList?.contains('add'))) return null;
  return h('div.ex-diff', { lang: 'en' }, h('span.xs.dim', 'Що змінити: '), ...out);
}

const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * Запустити набір вправ у контейнері.
 * opts.onDone({score, correct, total, results}) — results: [{ex, ok, given}]
 * opts.onMistake(ex, given) — для запису в «Помилки»
 */
export function runExercises(container, exercises, { onDone, onMistake, title } = {}) {
  let i = 0, correct = 0;
  const results = [];
  // шапка набору: підпис великими літерами, лічильник пігулкою, під ними — смужка прогресу
  const count = txPill('', 'accent');
  count.classList.add('num');
  const bar = h('div.ex-bar', progress(0, 'Пройдено вправ'));
  const head = h('div.ex-head', h('div.ex-head-t', title ? h('h2.tx-label', title) : h('span.tx-label', 'Вправа'), count), bar);
  const body = h('div.stack');
  // подвійний тап по «Далі» не має одразу відповісти на наступну вправу
  let shownAt = 0;
  body.addEventListener('click', (e) => { if (Date.now() - shownAt < 350) { e.preventDefault(); e.stopPropagation(); } }, true);
  container.replaceChildren(h('div.stack.ex-run', head, body));

  function show() {
    shownAt = Date.now();
    bar.replaceChildren(progress(i / exercises.length * 100, 'Пройдено вправ'));
    count.textContent = `${i + 1}/${exercises.length}`;
    const ex = exercises[i];
    body.replaceChildren(render(ex, (ok, given, extra) => {
      results.push({ ex, ok, given });
      if (ok) correct++; else onMistake?.(ex, given, extra);
    }, () => { i++; i < exercises.length ? show() : finish(); }));
    body.querySelector('input,textarea')?.focus({ preventScroll: true });
  }

  function finish() {
    const score = Math.round(correct / exercises.length * 100);
    bar.replaceChildren(progress(100, 'Пройдено вправ'));
    count.textContent = `${exercises.length}/${exercises.length}`;
    const res = { score, correct, total: exercises.length, results };
    if (onDone?.(res) === false) return;
    body.replaceChildren(resultView(res));
  }
  if (exercises.length) show(); else body.replaceChildren(h('div.empty', h('p', 'Вправ не знайдено.')));
}

/** Екран результату: значок у квадратику й підсумок, показники плитками, розбір помилок — плитками */
export function resultView({ score, correct, total, results }) {
  const wrong = results.filter(r => !r.ok);
  const tone = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const caption = score >= 80 ? 'Чудово — правило засвоєно' : score >= 50 ? 'Непогано — є що підтягнути' : 'Варто повторити правило';
  return h('div.stack-lg.ex-result',
    h('section.tx-group',
      h('div.gx-res', h('span.gx-res-ic.' + tone, ic(score >= 80 ? 'trophy' : score >= 50 ? 'thumbs-up' : 'barbell', { size: 26, fill: true })),
        h('div.grow', h('div.tx-label', 'Результат'), h('div.gx-res-t', caption))),
      txKpis([
        { value: score, unit: '%', label: 'результат', tone },
        { value: correct, unit: `/${total}`, label: 'правильно', ariaLabel: `${correct} з ${total} правильно` },
        { value: wrong.length, label: plural(wrong.length, 'помилка', 'помилки', 'помилок'), tone: wrong.length ? 'bad' : 'good' },
      ])),
    wrong.length ? txGroup(`Розбір помилок · ${wrong.length}`, cappedRows(wrong.map(r => mistakeCard(r)))) : null);
}

/**
 * Розбір однієї помилки — плитка: завдання, ваша відповідь (хрестик), правильна (галочка), коротке пояснення.
 * Спільна для вправ і тестів. action — необов'язковий вузол (кнопка) праворуч від завдання.
 */
export function mistakeCard(r, { action = null, given = null } = {}) {
  const g = given ?? (r.given || '—');
  return h('div.gx-card.ex-mis',
    h('div.ex-mis-q', h('span.grow', promptText(r.ex)), action),
    h('div.ex-mis-a.bad', ic('x', { size: 14 }), h('span' + (given != null ? '.ex-mis-dk' : ''), g)),
    h('div.ex-mis-a.good', ic('check', { size: 14 }), h('span', answerText(r.ex))),
    r.ex.explanation ? h('div.ex-mis-why', r.ex.explanation) : null);
}

/** Список плиток: на виду — max, решта за рядком «Показати всі · N» (правило «по полочках») */
export function cappedRows(items, max = 6) {
  const list = items.filter(Boolean);
  if (list.length <= max) return txRows(list);
  list.slice(max).forEach(el => { el.hidden = true; });
  const box = txRows(list);
  const more = txRow({ icon: 'caret-down', label: `Показати всі · ${list.length}`, cls: 'gx-more', chevron: false,
    attrs: { 'aria-expanded': 'false' }, onclick: () => { list.forEach(el => { el.hidden = false; }); more.remove(); } });
  box.append(more);
  return box;
}

export function promptText(ex) {
  if (ex.type === 'translate') return ex.uk;
  if (ex.type === 'order') return ex.prompt || 'Складіть речення';
  if (ex.type === 'error') return ex.sentence;
  return ex.prompt || ex.sentence || '';
}
export function answerText(ex) {
  if (ex.type === 'choice') return typeof ex.answer === 'number' ? ex.options[ex.answer] : ex.answer;
  if (ex.type === 'error') return `${ex.sentence.split(/\s+/)[ex.wrongIndex]} → ${ex.correction ? ex.correction : 'прибрати (зайве слово)'}`;
  if (ex._closest) return ex._closest;   // правильний варіант, найближчий до відповіді учня
  const a = ex.answer;
  return Array.isArray(a) ? a[0] : a;
}

/** Рендер однієї вправи; report(ok, given) викликається один раз; next() — далі */
export function render(ex, report, next) {
  // результат озвучують читачі екрана
  const fb = h('div', { role: 'status', 'aria-live': 'polite' });
  const nextBtn = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: next }, 'Далі', ic('arrow-right', { size: 18 }));
  let reported = false;
  const done = (ok, given, extraText) => {
    if (reported) return; reported = true;
    report(ok, given);
    fb.replaceChildren(h('div.feedback.ex-fb.' + (ok ? 'ok' : 'no'),
      h('span.ex-fb-ic', ic(ok ? 'check-circle' : 'x-circle', { size: 20, fill: true })),
      h('div.ex-fb-t',
        h('div', { style: { fontWeight: 600 } }, ok ? 'Правильно!' : `Правильно: ${answerText(ex)}`),
        extraText ? (typeof extraText === 'string' ? h('div', extraText) : extraText) : null,
        ex.explanation ? h('div.dim', ex.explanation) : null)));
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    // «Далі» має бути видно (не під нижньою панеллю): відступ задає scroll-padding-bottom
    requestAnimationFrame(() => nextBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const instr = (t) => h('div.ex-instr', t);
  const speakIt = (t) => h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(t) }, ic('speaker-high', { size: 20 }));

  if (ex.type === 'choice') {
    // варіанти — плитки з номером клавіші ліворуч; правильний — зелений (галочка), хибний — червоний (хрестик)
    const mark = (b, ok) => { b.classList.add(ok ? 'right' : 'wrong'); b.firstChild.replaceChildren(ic(ok ? 'check' : 'x', { size: 16 })); };
    let onKey = null;
    const opts = ex.options.map((o, k) => {
      const b = h('button.opt.ex-opt', { type: 'button', onclick: () => {
        if (reported) return;
        // відповідь — індекс або текст варіанта (з іншим регістром чи пробілами теж: інакше жоден варіант не зараховувався б)
        let ansIdx = typeof ex.answer === 'number' ? ex.answer : ex.options.indexOf(ex.answer);
        if (ansIdx < 0) ansIdx = ex.options.findIndex(x => String(x).trim().toLowerCase() === String(ex.answer ?? '').trim().toLowerCase());
        if (ansIdx < 0) ansIdx = ex.options.findIndex(x => normalize(x) === normalize(ex.answer));
        const ok = k === ansIdx;
        mark(b, ok);
        if (!ok && wrap.children[ansIdx]) mark(wrap.children[ansIdx], true);
        wrap.querySelectorAll('.ex-opt').forEach(x => { x.setAttribute('aria-disabled', 'true'); });
        if (onKey) document.removeEventListener('keydown', onKey);
        done(ok, o);
      } }, h('span.ex-key', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', o));
      return b;
    });
    const wrap = h('div.ex-opts', opts);
    // клавіші 1–9 обирають варіант (поза полями введення); слухач знімається, щойно вправа зникла з екрана
    if (opts.length <= 9) {
      onKey = (e) => {
        if (!wrap.isConnected) { document.removeEventListener('keydown', onKey); return; }
        // поверх вправи відкрита шторка/меню або сторінка вже йде (inert) — клавіші не для вправи
        if (reported || e.ctrlKey || e.metaKey || e.altKey || wrap.closest('[inert]') || e.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= opts.length) { e.preventDefault(); opts[n - 1].click(); }
      };
      document.addEventListener('keydown', onKey);
    }
    return h('div.stack', instr(ex.instruction || 'Оберіть правильний варіант'),
      h('div.row', h('div.grow.ex-prompt', ex.prompt), ex.audio ? speakIt(ex.audio) : null), wrap, fb, nextBtn);
  }

  if (ex.type === 'input' || ex.type === 'transform') {
    const inp = h('input.input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Відповідь', placeholder: ex.type === 'transform' ? 'Напишіть усе речення' : 'Ваша відповідь' });
    const check = () => {
      if (reported || !inp.value.trim()) return;
      // у пропуск можна вписати й сусідні слова чи все речення
      const given = inp.value.trim(), ok = matches(given, ex.answer) || (ex.type === 'input' && fitsBlanks(given, ex.prompt, ex.answer))
        // переклад слова картки: як у тренуванні слів — однина/множина, артикль, «to», варіанти через «/» (ex.word — англ. картки)
        || (ex.word ? checkTyped(given, ex.word).ok : false);
      // речення (перетворення) — показати, які слова відрізняються від найближчого правильного варіанта
      if (!ok && Array.isArray(ex.answer) && ex.answer.length > 1) ex._closest = closestAnswer(given, ex.answer);
      const diff = !ok && wtoks(given).length > 2 ? wordDiff(given, closestAnswer(given, ex.answer)) : null;
      done(ok, given, diff); inp.disabled = true; checkBtn.hidden = true;
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : check(); } });
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: check }, 'Перевірити');
    // перетворення: завдання з дужок у кінці («He plays. (зробіть заперечення)») — окремим рядком над реченням;
    // без завдання (2026-11-16: «не зрозуміло, що перетворювати») — це виправлення помилки
    let prompt = ex.prompt, task = ex.instruction;
    if (ex.type === 'transform') {
      const m = String(prompt || '').match(/^(.*\S)\s*\(([^()]*[А-Яа-яІіЇїЄєҐґ][^()]*)\)\s*$/s);
      if (m && !task) { prompt = m[1]; task = m[2]; }
      if (!task || /^перетвор/i.test(task)) task = 'Знайдіть помилку й напишіть усе речення правильно';
      task = task.charAt(0).toUpperCase() + task.slice(1);
    }
    return h('div.stack', instr(task || 'Впишіть правильну форму'),
      h('div.ex-prompt', prompt),
      ex.hint ? h('div.small.dim', `Підказка: ${ex.hint}`) : null, inp, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'order') {
    const target = Array.isArray(ex.answer) ? ex.answer[0] : ex.answer;
    // фішки без розділових знаків («cold,» → «cold»), окремі тире не фішки: порядок перевіряється без пунктуації
    const words = ex.words || target.split(/\s+/).map(w => w.replace(/^[«"“(]+|[.,;:!?»"”)]+$/g, '')).filter(w => /[\p{L}\p{N}]/u.test(w));
    const line = h('div.answer-line.ex-line', { 'data-ph': 'Торкайтесь слів унизу по черзі' });
    const bank = h('div.word-bank.ex-bank');
    const used = [];
    const draw = () => {
      line.replaceChildren(...used.map((w, k) => h('button.chip', { type: 'button', onclick: () => { if (reported) return; used.splice(k, 1); pool.push(w); draw(); } }, w.t)));
      bank.replaceChildren(...pool.map((w, k) => h('button.chip', { type: 'button', onclick: () => { if (reported) return; pool.splice(k, 1); used.push(w); draw(); } }, w.t)));
    };
    let pool = shuffle(words.map((t, k) => ({ t, k })));
    draw();
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
      if (reported || !used.length) return;
      const given = used.map(w => w.t).join(' ');
      done(matches(given, ex.answer), given); checkBtn.hidden = true;
      bank.classList.add('done'); line.classList.add('done');
    } }, 'Перевірити');
    return h('div.stack', instr('Складіть речення зі слів'), ex.prompt ? h('div.ex-prompt.uk', ex.prompt) : null, line, bank, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'error') {
    const words = ex.sentence.split(/\s+/);
    // старі вправи, де зайве слово записане як «the → work» (сусіднє слово): це видалення
    const wclean = (w) => normalize(w).replace(/[^\p{L}\p{N}']/gu, '');
    if (ex.correction && [words[ex.wrongIndex - 1], words[ex.wrongIndex + 1]].filter(Boolean).map(wclean).includes(wclean(ex.correction))) { ex.correction = ''; ex.alt = []; }
    let picked = null;
    const fix = h('input.input', { type: 'text', placeholder: 'Як правильно?', 'aria-label': 'Виправлення', hidden: true, autocomplete: 'off', autocapitalize: 'off' });
    const wrap = h('div.chips.ex-words', words.map((w, k) => h('button.chip', { type: 'button', onclick: (e) => {
      if (reported) return;
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      e.currentTarget.classList.add('on'); picked = k; fix.hidden = false; removeBtn.hidden = false; fix.focus();
    } }, w)));
    // «Слово зайве»: виправлення — прибрати слово (2026-11-15, «go to the work» → «go to work» не зараховувалось)
    let removing = false;
    const removeBtn = h('button.btn.ghost.sm.ex-remove', { type: 'button', hidden: true, onclick: () => {
      if (reported || picked == null) return;
      removing = true; fix.value = ''; checkBtn.click();
    } }, ic('trash', { size: 16 }), 'Це слово зайве');
    const replaced = (k, f) => (String(f).trim() ? words.map((w, i) => (i === k ? String(f).trim() : w)) : words.filter((_, i) => i !== k)).join(' ');
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
      if (reported || picked == null) return;
      const val = removing ? '' : fix.value.trim();
      if (!removing && !val) { fix.focus(); fix.placeholder = 'Напишіть, як правильно (або «Це слово зайве»)'; return; }
      const okIdx = picked === ex.wrongIndex;
      // варіант, що збігається з самим хибним словом, — не виправлення (биті дані не мають зараховувати «go → go»)
      const fixes = [ex.correction ?? '', ...(ex.alt || [])].filter((f, i) => i === 0 || normalize(f) !== normalize(words[ex.wrongIndex]));
      // правильні речення: заміна слова або (порожнє виправлення) його видалення
      const goodSentences = fixes.map(f => replaced(ex.wrongIndex, f));
      // учень міг написати все виправлене речення замість одного слова
      const wholeSentence = val && val.split(/\s+/).length >= Math.max(3, words.length - 2);
      const mine = wholeSentence ? val : replaced(picked, val);
      // написане разом із сусіднім словом («She goes» на слові She чи go) замінює обидва слова
      const span = (a, b) => [...words.slice(0, a), val, ...words.slice(b + 1)].join(' ');
      const minePairs = !wholeSentence && val ? [span(picked - 1, picked), span(picked, picked + 1)].filter((_, k) => (k ? picked + 1 < words.length : picked > 0)) : [];
      // приймаємо й виправлення разом із сусіднім словом: «we'll stay», «I'll tell»
      const prev = words[ex.wrongIndex - 1] || '';
      const okFix = removing ? !String(ex.correction ?? '').trim() : (matches(val, fixes.filter(f => String(f).trim())) || (!!prev && matches(val, fixes.filter(f => String(f).trim()).map(f => `${prev} ${f}`))));
      // інше слово чи ціле речення, але виправлене речення те саме: порівнюємо цілі речення (скорочення, правопис, розділові — як у matches)
      const sameSentence = [mine, ...minePairs].some(x => matches(x, goodSentences));
      const ok = (okIdx && okFix) || sameSentence;
      done(ok, wholeSentence ? val : `${words[picked]} → ${removing ? 'прибрати' : val}`,
        ok ? null : wordDiff(mine, replaced(ex.wrongIndex, ex.correction ?? '')));
      removeBtn.hidden = true;
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      if (!ok) wrap.children[picked]?.classList.add('wrong');
      wrap.children[ex.wrongIndex]?.classList.add('right');
      checkBtn.hidden = true;
    } }, 'Перевірити');
    fix.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : checkBtn.click(); } });
    return h('div.stack', instr('Торкніться слова з помилкою й напишіть, як правильно (або позначте його як зайве)'), wrap, fix, removeBtn, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'translate') {
    const inp = h('textarea.input', { rows: 2, 'aria-label': 'Переклад', placeholder: 'Переклад англійською', autocapitalize: 'sentences', style: { minHeight: '80px' } });
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: async () => {
      const given = inp.value.trim();
      if (reported || !given) return;
      inp.disabled = true;
      if (matches(given, ex.answer)) { done(true, given); checkBtn.hidden = true; return; }
      if (!user() || !navigator.onLine) { done(false, given, 'Порівняно з еталоном без AI. Близькі варіанти вчитель може зарахувати, коли ви онлайн і ввійшли в акаунт.'); checkBtn.hidden = true; return; }
      checkBtn.disabled = true; checkBtn.textContent = 'Перевіряє вчитель…';
      try {
        const r = await tutor('check_translation', { uk: ex.uk, reference: ex.answer, answer: given });
        done(!!r.correct, given, [r.better && !r.correct ? `Краще: ${r.better}` : '', r.explanation_uk || ''].filter(Boolean).join(' · '));
      } catch (e) { done(false, given, aiErrorText(e)); }
      checkBtn.hidden = true;
    } }, 'Перевірити');
    return h('div.stack', instr('Перекладіть англійською'), h('div.ex-prompt', ex.uk), inp, checkBtn, fb, nextBtn);
  }

  return h('div', 'Невідомий тип вправи');
}

/** Ключ речення для порівняння (сумісність): те саме, що normalize — регістр, розділові, скорочення, правопис */
export const sentKey = (s) => normalize(s);
