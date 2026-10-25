// Движок вправ: choice | input | order | error | transform | translate
import { h, ic, emo, progress } from './dom.js';
import { speak } from '../speech.js';
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
  const head = h('div.row', h('div.grow', progress(0)), h('span.xs.dim.num'));
  const body = h('div.stack');
  container.replaceChildren(h('div.stack', title ? h('h2', title) : null, head, body));

  function show() {
    head.firstChild.replaceChildren(progress(i / exercises.length * 100));
    head.lastChild.textContent = `${i + 1}/${exercises.length}`;
    const ex = exercises[i];
    body.replaceChildren(render(ex, (ok, given, extra) => {
      results.push({ ex, ok, given });
      if (ok) correct++; else onMistake?.(ex, given, extra);
    }, () => { i++; i < exercises.length ? show() : finish(); }));
    body.querySelector('input,textarea')?.focus({ preventScroll: true });
  }

  function finish() {
    const score = Math.round(correct / exercises.length * 100);
    head.firstChild.replaceChildren(progress(100));
    const res = { score, correct, total: exercises.length, results };
    if (onDone?.(res) === false) return;
    body.replaceChildren(resultView(res));
  }
  if (exercises.length) show(); else finish();
}

export function resultView({ score, correct, total, results }) {
  const wrong = results.filter(r => !r.ok);
  return h('div.stack',
    h('div.hero', emo(score >= 80 ? 'trophy' : score >= 50 ? 'thumbsup' : 'muscle', 'xl'),
      h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${score}%`),
      h('p.dim', `${correct} з ${total} правильно`)),
    wrong.length ? h('div.section-title', 'Розбір помилок') : null,
    wrong.map(r => h('div.card.tight.stack',
      h('div.small', promptText(r.ex)),
      h('div.small', h('span.bad', `Ваша відповідь: ${r.given || '—'}`)),
      h('div.small', h('span.good', `Правильно: ${answerText(r.ex)}`)),
      r.ex.explanation ? h('div.xs.dim', r.ex.explanation) : null)));
}

function promptText(ex) {
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
  const fb = h('div');
  const nextBtn = h('button.btn.primary.block', { type: 'button', hidden: true, onclick: next }, 'Далі');
  let reported = false;
  const done = (ok, given, extraText) => {
    if (reported) return; reported = true;
    report(ok, given);
    fb.replaceChildren(h('div.feedback.' + (ok ? 'ok' : 'no'),
      h('div', { style: { fontWeight: 600 } }, ok ? 'Правильно!' : `Правильно: ${answerText(ex)}`),
      extraText ? h('div', extraText) : null,
      ex.explanation ? h('div.dim', ex.explanation) : null));
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
  };
  const instr = (t) => h('div.xs.dim', t);
  const speakIt = (t) => h('button.icon-btn.soft', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(t) }, ic('speaker-high', { size: 20 }));

  if (ex.type === 'choice') {
    const opts = ex.options.map((o, k) => {
      const b = h('button.opt', { type: 'button', onclick: () => {
        if (reported) return;
        const ansIdx = typeof ex.answer === 'number' ? ex.answer : ex.options.indexOf(ex.answer);
        const ok = k === ansIdx;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) wrap.children[ansIdx]?.classList.add('right');
        done(ok, o);
      } }, h('span.grow', o));
      return b;
    });
    const wrap = h('div.stack', opts);
    return h('div.stack', instr(ex.instruction || 'Оберіть правильний варіант'),
      h('div.row', h('div.grow', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, ex.prompt), ex.audio ? speakIt(ex.audio) : null), wrap, fb, nextBtn);
  }

  if (ex.type === 'input' || ex.type === 'transform') {
    const inp = h('input.input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Відповідь', placeholder: 'Ваша відповідь' });
    const check = () => { if (!reported && inp.value.trim()) { done(matches(inp.value, ex.answer), inp.value.trim()); inp.disabled = true; checkBtn.hidden = true; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : check(); } });
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: check }, 'Перевірити');
    return h('div.stack', instr(ex.instruction || (ex.type === 'transform' ? 'Перетворіть речення' : 'Впишіть правильну форму')),
      h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, ex.prompt),
      ex.hint ? h('div.small.dim', `Підказка: ${ex.hint}`) : null, inp, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'order') {
    const target = Array.isArray(ex.answer) ? ex.answer[0] : ex.answer;
    const words = ex.words || target.replace(/[.?!]$/, '').split(/\s+/);
    const line = h('div.answer-line');
    const bank = h('div.word-bank');
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
    } }, 'Перевірити');
    return h('div.stack', instr('Складіть речення зі слів'), ex.prompt ? h('div.dim', ex.prompt) : null, line, bank, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'error') {
    const words = ex.sentence.split(/\s+/);
    let picked = null;
    const fix = h('input.input', { type: 'text', placeholder: 'Як правильно?', 'aria-label': 'Виправлення', hidden: true, autocomplete: 'off', autocapitalize: 'off' });
    const wrap = h('div.chips', words.map((w, k) => h('button.chip', { type: 'button', onclick: (e) => {
      if (reported) return;
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      e.currentTarget.classList.add('on'); picked = k; fix.hidden = false; fix.focus();
    } }, w)));
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: () => {
      if (reported || picked == null) return;
      const okIdx = picked === ex.wrongIndex;
      const okFix = !fix.value.trim() || matches(fix.value, [ex.correction, ...(ex.alt || [])]);
      done(okIdx && okFix, `${words[picked]}${fix.value ? ' → ' + fix.value : ''}`);
      wrap.children[ex.wrongIndex]?.classList.add('on');
      checkBtn.hidden = true;
    } }, 'Перевірити');
    fix.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reported ? next() : checkBtn.click(); } });
    return h('div.stack', instr('Знайдіть помилку: торкніться неправильного слова і напишіть, як правильно'), wrap, fix, checkBtn, fb, nextBtn);
  }

  if (ex.type === 'translate') {
    const inp = h('textarea.input', { rows: 2, 'aria-label': 'Переклад', placeholder: 'Переклад англійською', autocapitalize: 'sentences', style: { minHeight: '80px' } });
    const checkBtn = h('button.btn.primary.block', { type: 'button', onclick: async () => {
      const given = inp.value.trim();
      if (reported || !given) return;
      if (matches(given, ex.answer)) { done(true, given); checkBtn.hidden = true; return; }
      if (!user() || !navigator.onLine) { done(false, given, 'Офлайн: порівняно з еталоном. Близькі варіанти може зарахувати вчитель онлайн.'); checkBtn.hidden = true; return; }
      checkBtn.disabled = true; checkBtn.textContent = 'Перевіряє вчитель…';
      try {
        const r = await tutor('check_translation', { uk: ex.uk, reference: ex.answer, answer: given });
        done(!!r.correct, given, [r.better && !r.correct ? `Краще: ${r.better}` : '', r.explanation_uk || ''].filter(Boolean).join(' · '));
      } catch (e) { done(false, given, aiErrorText(e)); }
      checkBtn.hidden = true;
    } }, 'Перевірити');
    return h('div.stack', instr('Перекладіть англійською'), h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 600 } }, ex.uk), inp, checkBtn, fb, nextBtn);
  }

  return h('div', 'Невідомий тип вправи');
}
