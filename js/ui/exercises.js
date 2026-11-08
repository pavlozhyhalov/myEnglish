// Движок вправ: choice | input | order | error | transform | translate
import { h, ic, progress } from './dom.js';
import { speak } from '../speech.js';
import { plural } from '../strings.js';
import { txKpis, txGroup, txPill, txRow, txRows } from './tiles.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';

const CONTR = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "don't": 'do not', "doesn't": 'does not',
  "didn't": 'did not', "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not', "won't": 'will not', "wouldn't": 'would not',
  "can't": 'cannot', "couldn't": 'could not', "shouldn't": 'should not', "mustn't": 'must not', "i've": 'i have', "you've": 'you have',
  "we've": 'we have', "they've": 'they have', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will',
  "he'll": 'he will', "she'll": 'she will', "it'll": 'it will', "i'd": 'i would', "you'd": 'you would', "we'd": 'we would', "they'd": 'they would',
  "he'd": 'he would', "she'd": 'she would', "let's": 'let us', "there's": 'there is', "that's": 'that is', "what's": 'what is', 'can not': 'cannot',
  // окремі скорочення (у вправі «знайдіть помилку» виправляють одне слово: «'ll stay»)
  "'ll": 'will', "'re": 'are', "'ve": 'have', "'m": 'am', "'d": 'would',
};
export function normalize(s) {
  let t = String(s ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  t = t.replace(/[.!?,;:"]+/g, '').trim();
  t = t.split(' ').map(w => CONTR[w] || w).join(' ');
  return t.replace(/\s+/g, ' ');
}
export function matches(answer, accepted) {
  const list = Array.isArray(accepted) ? accepted : [accepted];
  const a = normalize(answer);
  return list.some(x => normalize(x) === a);
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
  if (ex.type === 'error') return `${ex.sentence.split(/\s+/)[ex.wrongIndex]} → ${ex.correction}`;
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
        extraText ? h('div', extraText) : null,
        ex.explanation ? h('div.dim', ex.explanation) : null)));
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    // «Далі» має бути видно (не під нижньою панеллю): відступ задає scroll-padding-bottom
    requestAnimationFrame(() => nextBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const instr = (t) => h('div.xs.dim.ex-instr', t);
  const speakIt = (t) => h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(t) }, ic('speaker-high', { size: 20 }));

  if (ex.type === 'choice') {
    // варіанти — плитки з номером клавіші ліворуч; правильний — зелений (галочка), хибний — червоний (хрестик)
    const mark = (b, ok) => { b.classList.add(ok ? 'right' : 'wrong'); b.firstChild.replaceChildren(ic(ok ? 'check' : 'x', { size: 16 })); };
    let onKey = null;
    const opts = ex.options.map((o, k) => {
      const b = h('button.opt.ex-opt', { type: 'button', onclick: () => {
        if (reported) return;
        const ansIdx = typeof ex.answer === 'number' ? ex.answer : ex.options.indexOf(ex.answer);
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
    const inp = h('input.input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Відповідь', placeholder: 'Ваша відповідь' });
    const check = () => { if (!reported && inp.value.trim()) { done(matches(inp.value, ex.answer), inp.value.trim()); inp.disabled = true; checkBtn.hidden = true; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : check(); } });
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: check }, 'Перевірити');
    return h('div.stack', instr(ex.instruction || (ex.type === 'transform' ? 'Перетворіть речення' : 'Впишіть правильну форму')),
      h('div.ex-prompt', ex.prompt),
      ex.hint ? h('div.small.dim', `Підказка: ${ex.hint}`) : null, inp, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'order') {
    const target = Array.isArray(ex.answer) ? ex.answer[0] : ex.answer;
    const words = ex.words || target.replace(/[.?!]$/, '').split(/\s+/);
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
    let picked = null;
    const fix = h('input.input', { type: 'text', placeholder: 'Як правильно?', 'aria-label': 'Виправлення', hidden: true, autocomplete: 'off', autocapitalize: 'off' });
    const wrap = h('div.chips.ex-words', words.map((w, k) => h('button.chip', { type: 'button', onclick: (e) => {
      if (reported) return;
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      e.currentTarget.classList.add('on'); picked = k; fix.hidden = false; fix.focus();
    } }, w)));
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
      if (reported || picked == null) return;
      if (!fix.value.trim()) { fix.focus(); fix.placeholder = 'Напишіть, як правильно'; return; }
      const okIdx = picked === ex.wrongIndex;
      const fixes = [ex.correction, ...(ex.alt || [])];
      // приймаємо й виправлення разом із сусіднім словом: «we'll stay», «I'll tell»
      const prev = words[ex.wrongIndex - 1] || '';
      const okFix = matches(fix.value, fixes) || (!!prev && matches(fix.value, fixes.map(f => `${prev} ${f}`)));
      done(okIdx && okFix, `${words[picked]} → ${fix.value.trim()}`);
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      if (!okIdx) wrap.children[picked]?.classList.add('wrong');
      wrap.children[ex.wrongIndex]?.classList.add('right');
      checkBtn.hidden = true;
    } }, 'Перевірити');
    fix.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : checkBtn.click(); } });
    return h('div.stack', instr('Торкніться слова з помилкою й напишіть, як правильно'), wrap, fix, checkBtn, fb, nextBtn);
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
