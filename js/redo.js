// «Скажи ще раз» (рішення власника 2026-11-09): після розмови з вчителем — 1–2 хвилини на власні речення з помилками цієї розмови.
// Учень бачить пояснення й неправильний варіант (закреслений) і вимовляє правильне речення; запис → tutor 'transcribe' (hint 'learner'),
// порівняння з еталоном — на пристрої (без AI): нормалізація регістру, розділових знаків і скорочень (I'm = I am), схожість по словах ≥ 85 %
// і обов'язкові «ключові» слова виправлення. Правильно — logRulePractice(m, true) для відповідної помилки; дві невдачі — далі без штрафу.
// «Не можу говорити» — те саме письмово; без входу (немає AI) — лише письмово. Маршрут: #/tutor/redo?chat=<id> (js/pages/tutor.js).
import { h, ic } from './ui/dom.js';
import * as store from './store.js';
import { plural } from './strings.js';
import { mdInline } from './ui/md.js';
import { tutor, aiErrorText } from './ai.js';
import { user } from './supa.js';
import { speak, stop as stopSpeech, recordAudio, canRecord } from './speech.js';
import { activityTimer, logRulePractice, isDisputed } from './stats.js';
import { focusRules } from './focus.js';
import { ruleLabel } from './rules.js';
import { tx, txPrimary, txGroup, txKpis, txResult, txRows, txPill, txBar } from './ui/tiles.js';
import { setTitle } from './ui/shell.js';
import { onLeave, back } from './router.js';

const MAX_ITEMS = 5;
/** replaceChildren без порожніх місць (сам replaceChildren перетворив би null на текст «null») */
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));
const PASS = 0.85;
const plain = (t) => String(t || '').replace(/\*\*|__|[*`~]/g, '').replace(/\s+/g, ' ').trim().replace(/^["“„«]+|["”»]+$/g, '').trim();

// ---------- порівняння ----------
const NUM = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
const CONTR = [
  [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'], [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'], [/'m\b/g, ' am'], [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'], [/'d\b/g, ' would'],
  [/\blet's\b/g, 'let us'], [/\b(he|she|it|that|there|here|what|where|who|how|when|why|this)'s\b/g, '$1 is'],
  [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'], [/\bgotta\b/g, 'got to'],
];
const FILLERS = new Set(['uh', 'um', 'umm', 'uhm', 'er', 'erm', 'ah', 'eh', 'hmm', 'mm']);
/** Слова речення: нижній регістр, без розділових знаків, скорочення розгорнуто, числа 0–12 — словами */
export function words(s, { said = false } = {}) {
  let t = ' ' + String(s || '').toLowerCase().replace(/[’‘`´]/g, "'") + ' ';
  for (const [re, to] of CONTR) t = t.replace(re, to);
  t = t.replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '');
  return t.split(/\s+/).filter(Boolean).map(w => NUM[w] || w).filter(w => !(said && FILLERS.has(w)));
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// дрібна описка в довгому слові (не ключовому) не провалює відповідь: «tomorow» = «tomorrow»
const near = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);
function lcs(a, b) {
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = near(a[i - 1], b[j - 1]) ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
  return d[a.length][b.length];
}
const counts = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
/** Слова, яких немає в іншому списку (з урахуванням повторів) */
function minus(a, b) {
  const pool = counts(b), out = [];
  for (const w of a) { const n = pool.get(w) || 0; if (n) pool.set(w, n - 1); else out.push(w); }
  return out;
}
/**
 * Чи сказано правильне речення. target — правильний варіант, wrong — помилковий (щоб знайти ключові слова виправлення).
 * Повертає { ok, score (0–1), missing: [ключові слова, яких бракує], extra: [слова помилки, що лишились] }.
 */
export function judge(target, said, wrong = '') {
  const t = words(target), s = words(said, { said: true }), w = words(wrong);
  if (!t.length || !s.length) return { ok: false, score: 0, missing: [], extra: [] };
  const score = (2 * lcs(t, s)) / (t.length + s.length);
  const sc = counts(s), tc = counts(t);
  const missing = [...new Set(minus(t, w))].filter(k => (sc.get(k) || 0) < (tc.get(k) || 0) || !sc.has(k));
  // слова лише з помилкового варіанта («I am agree») не мають з'являтися частіше, ніж у правильному
  const extra = [...new Set(minus(w, t))].filter(k => (sc.get(k) || 0) > (tc.get(k) || 0));
  return { ok: score >= PASS && !missing.length && !extra.length, score, missing, extra };
}

// ---------- набір речень ----------
const nkey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim();
/** Речення для «Скажи ще раз» з підсумку розмови: до 5, правила тижня першими, справжні речення — перед короткими фрагментами */
export function redoItems(row) {
  const s = row?.summary;
  if (!s || s.partial || !Array.isArray(s.mistakes)) return [];
  let focus = [];
  try { focus = focusRules(); } catch { /* профіль ще не завантажено */ }
  const seen = new Set();
  const list = [];
  s.mistakes.forEach((m, i) => {
    if (!m || typeof m.wrong !== 'string' || typeof m.right !== 'string' || m.type === 'pronunciation') return;
    const wrong = plain(m.wrong), target = plain(m.right);
    if (!wrong || /^[—–\-…. ]+$/.test(wrong) || /^[—–\-…. ]+$/.test(target)) return;
    const n = words(target).length;
    if (n < 3 || n > 25 || nkey(wrong) === nkey(target)) return;
    if (isDisputed(m.wrong, m.right)) return;
    const k = nkey(target);
    if (seen.has(k)) return;
    seen.add(k);
    const fi = focus.indexOf(m.rule);
    const frag = /\.\.\.|…/.test(target) || n < 4;
    list.push({ m, wrong, target, focus: fi >= 0, rank: [fi < 0 ? focus.length : fi, frag ? 1 : 0, i] });
  });
  list.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  return list.slice(0, MAX_ITEMS);
}
/** Підпис плитки на екрані підсумку: «3 речення · ~2 хв» */
export function redoSub(n) { return `${n} ${plural(n, 'речення', 'речення', 'речень')} · ~${n <= 2 ? 1 : 2} хв`; }

/** Помилка з «Моїх помилок», що відповідає пункту підсумку */
function mistakeRow(m) {
  const all = store.all('mistakes').filter(x => !x.deleted);
  const w = nkey(m.wrong), r = nkey(m.right);
  return all.find(x => nkey(x.wrong) === w && nkey(x.right) === r) || all.find(x => nkey(x.right) === r && !x.resolved) || null;
}

// ---------- екран ----------
/** #/tutor/redo?chat=<id> */
export function redoPage(view, chatId) {
  setTitle('Скажи ще раз');
  const row = chatId ? store.get('tutor_chats', chatId) : null;
  const backTo = () => back(row ? `/tutor?chat=${encodeURIComponent(row.id)}&view=summary` : '/tutor');
  const items = row ? redoItems(row) : [];
  if (!items.length) {
    view.replaceChildren(h('div.stack-lg.redo',
      txResult({ icon: row ? 'check-circle' : 'magnifying-glass', tone: row ? 'good' : null, label: 'Скажи ще раз',
        title: row ? 'Немає речень для повтору' : 'Розмову не знайдено', sub: row ? 'У цій розмові немає речень з помилками.' : 'Можливо, її видалено на іншому пристрої.' }),
      txPrimary({ icon: 'arrow-left', label: row ? 'До підсумку' : 'До вчителя', onclick: backTo })));
    return;
  }

  const voiceOk = () => !!user() && canRecord();
  let typed = !voiceOk();
  let idx = 0, tries = 0, done = false, disposed = false;
  let recAc = null;          // запис, що йде (abort — зупинити)
  let reqAc = null;          // розпізнавання, що йде
  let state = 'idle';        // idle | rec | wait | answered
  const results = [];        // { item, ok, tries, said }
  const practised = new Set();
  const timer = activityTimer('mistakes');
  const t0 = Date.now();

  onLeave(view, () => {
    disposed = true;
    recAc?.abort(); reqAc?.abort();
    stopSpeech();
    timer.stop();
  });

  const root = h('div.stack-lg.redo');
  view.replaceChildren(root);

  function drawItem() {
    const it = items[idx];
    tries = 0; state = 'idle';
    const m = it.m;
    const rl = ruleLabel(m.rule);
    const card = h('div.tx.wide.redo-card',
      h('div.redo-tags', it.focus ? txPill('Правило тижня', 'accent') : null, rl && m.rule !== 'other' ? txPill(rl) : null),
      m.explanation_uk ? h('p.redo-ex', mdInline(m.explanation_uk)) : null,
      h('p.redo-wrong', h('span.sr-only', 'Неправильно: '), h('s', { lang: 'en' }, it.wrong)),
      h('p.redo-ask'));
    const ask = () => card.querySelector('.redo-ask').replaceChildren(ic(typed ? 'pencil-simple' : 'microphone', { size: 16 }), typed ? 'Напишіть правильно' : 'Скажіть правильно');
    const fb = h('div.redo-fb', { 'aria-live': 'polite' });
    const act = h('div.redo-act');
    const foot = h('div.redo-foot');
    root.replaceChildren(
      h('div.redo-head',
        h('div.redo-head-row', h('span.tx-label', 'Речення з розмови'), h('span.redo-count', `${idx + 1} з ${items.length}`)),
        txBar(idx / items.length, true)),
      card, fb, act, foot);

    const answered = (ok, said) => {
      state = 'answered';
      results.push({ item: it, ok, tries, said });
      const last = idx >= items.length - 1;
      act.replaceChildren(txPrimary({ icon: last ? 'flag' : 'arrow-right', label: last ? 'Завершити' : 'Далі', onclick: next }));
      foot.replaceChildren();
      act.querySelector('.tx')?.focus({ preventScroll: true });
    };
    const targetLine = () => h('div.redo-target', h('button.tx-sq.tu-say', { type: 'button', 'aria-label': `Прослухати: ${it.target}`, onclick: () => speak(it.target) }, ic('speaker-high', { size: 18 })),
      h('span', { lang: 'en' }, it.target));
    const saidLine = (said) => h('p.redo-said', h('span.redo-k', typed ? 'Ви написали' : 'Ви сказали'), h('span', { lang: 'en' }, said));

    function check(said) {
      said = String(said || '').trim();
      if (!said) {
        fb.replaceChildren(h('div.tx.wide.redo-msg', h('span.tx-sq', ic('ear', { size: 18 })),
          h('span.tx-body', h('span.tx-l', typed ? 'Напишіть речення' : 'Не вдалося розчути'), h('span.tx-s', typed ? 'Поле порожнє.' : 'Говоріть трохи гучніше й ближче до телефона.'))));
        state = 'idle'; paintAct();
        return;
      }
      tries++;
      const r = judge(it.target, said, it.wrong);
      if (r.ok) {
        fb.replaceChildren(h('div.tx.wide.redo-res.good', h('span.tx-sq', ic('check', { size: 20 })),
          h('span.tx-body', h('span.tx-l', tries > 1 ? 'Правильно — з другої спроби' : 'Правильно!'), targetLine())));
        if (!practised.has(it)) { practised.add(it); const mr = mistakeRow(it.m); if (mr) logRulePractice(mr, true); }
        speak(it.target).catch(() => {});
        answered(true, said);
        return;
      }
      if (tries < 2) {
        fb.replaceChildren(h('div.tx.wide.redo-res.bad', h('span.tx-sq', ic('x', { size: 20 })),
          h('span.tx-body', h('span.tx-l', 'Майже. Правильно так:'), targetLine(), saidLine(said))));
        state = 'idle'; paintAct('Спробуйте ще раз');
        return;
      }
      fb.replaceChildren(h('div.tx.wide.redo-res.quiet', h('span.tx-sq', ic('arrow-right', { size: 20 })),
        h('span.tx-body', h('span.tx-l', 'Нічого — повторимо іншим разом'), targetLine(), saidLine(said))));
      answered(false, said);
    }

    async function record() {
      if (state === 'rec') { recAc?.abort(); return; }
      if (state !== 'idle') return;
      stopSpeech();
      state = 'rec'; recAc = new AbortController(); paintAct();
      let rec;
      try {
        rec = await recordAudio({ maxMs: 12000, signal: recAc.signal });
      } catch (e) {
        if (disposed) return;
        state = 'idle'; paintAct();
        const n = e?.name || '';
        if (n === 'AbortError' && typed) return;   // «Не можу говорити» під час запуску мікрофона
        const denied = n === 'NotAllowedError' || n === 'SecurityError';
        fb.replaceChildren(h('div.tx.wide.redo-res.bad', { role: 'alert' }, h('span.tx-sq', ic('microphone-slash', { size: 20 })),
          h('span.tx-body', h('span.tx-l', denied ? 'Немає доступу до мікрофона' : 'Мікрофон недоступний'),
            h('span.tx-s', denied ? 'Дозвольте мікрофон у налаштуваннях браузера або напишіть речення.' : 'Спробуйте ще раз або напишіть речення.'))));
        return;
      } finally { recAc = null; }
      if (disposed) return;
      if (rec.ms < 500) { state = 'idle'; check(''); return; }
      state = 'wait'; paintAct();
      reqAc = new AbortController();
      try {
        const res = await tutor('transcribe', { audio: rec.audio, mime: rec.mime, hint: 'learner', context: { tutor: it.target } }, { signal: reqAc.signal });
        if (disposed) return;
        check(res?.text || '');
      } catch (e) {
        if (disposed || e?.name === 'AbortError') return;
        state = 'idle'; paintAct();
        fb.replaceChildren(h('div.tx.wide.redo-res.bad', { role: 'alert' }, h('span.tx-sq', ic('warning', { size: 20 })),
          h('span.tx-body', h('span.tx-l', 'Не вдалося розпізнати'), h('span.tx-s', aiErrorText(e) || 'Спробуйте ще раз або напишіть речення.'))));
      } finally { reqAc = null; }
    }

    function paintAct(again = null) {
      if (state === 'answered') return;
      ask();
      if (typed) {
        const inp = h('textarea.input.redo-input', { rows: 2, lang: 'en', placeholder: 'Правильне речення англійською', 'aria-label': 'Правильне речення', autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'done' });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(inp.value); } });
        act.replaceChildren(inp, txPrimary({ icon: 'check', label: again || 'Перевірити', onclick: () => check(inp.value) }));
        // фокус лише з клавіатурою: на телефоні клавіатура не має відкриватися сама
        if (!matchMedia('(pointer: coarse)').matches) inp.focus({ preventScroll: true });
      } else {
        const label = state === 'rec' ? 'Говоріть… дотик — завершити' : state === 'wait' ? 'Розпізнаю…' : (again || 'Торкніться й скажіть речення');
        const mic = h('button.redo-mic' + (state === 'rec' ? '.rec' : '') + (state === 'wait' ? '.wait' : ''),
          { type: 'button', disabled: state === 'wait' || null, 'aria-label': state === 'rec' ? 'Завершити запис' : 'Записати відповідь', 'aria-pressed': state === 'rec' ? 'true' : 'false', onclick: record },
          ic(state === 'rec' ? 'stop' : state === 'wait' ? 'hourglass' : 'microphone', { size: 34, fill: true }));
        act.replaceChildren(mic, h('p.redo-cap', { 'aria-live': 'polite' }, label));
      }
      const quiet = (label, icon, onclick) => h('button.redo-link', { type: 'button', onclick }, ic(icon, { size: 16 }), label);
      fill(foot,
        typed
          ? (voiceOk() ? quiet('Сказати голосом', 'microphone', () => { typed = false; paintAct(); })
            : !user() ? h('a.redo-link', { href: '#/auth' }, ic('key', { size: 16 }), 'Голосом — після входу') : null)
          : quiet('Не можу говорити', 'keyboard', () => { recAc?.abort(); reqAc?.abort(); state = 'idle'; typed = true; paintAct(); }),
        quiet('Пропустити', 'arrow-right', () => { if (state === 'rec' || state === 'wait') return; recAc?.abort(); reqAc?.abort(); answered(false, ''); next(); }));
    }
    paintAct();
  }

  function next() {
    stopSpeech();
    if (idx < items.length - 1) { idx++; drawItem(); window.scrollTo(0, 0); return; }
    finish();
  }

  function finish() {
    if (done) return; done = true;
    stopSpeech();
    const t = timer.stop();
    const sec = t?.seconds ?? Math.round((Date.now() - t0) / 1000);
    const ok = results.filter(r => r.ok).length;
    const first = results.filter(r => r.ok && r.tries === 1).length;
    const total = items.length;
    const missed = results.filter(r => !r.ok);
    const all = ok === total;
    const min = Math.round(sec / 60);
    fill(root,
      txResult({ icon: all ? 'check-circle' : ok ? 'microphone' : 'arrow-clockwise', tone: all ? 'good' : ok ? 'accent' : 'warn', label: 'Результат',
        title: all ? 'Усі речення правильно' : `Правильно ${ok} з ${total}`,
        sub: practised.size ? 'Зараховано в повтор правил' : 'Ці речення ще трапляться в повторі правил' }),
      txKpis([
        { value: ok, unit: `з ${total}`, label: 'правильно', tone: all ? 'good' : ok ? 'accent' : 'warn', ariaLabel: `Правильно: ${ok} з ${total}` },
        { value: first, label: 'з першої спроби' },
        { value: min || '<1', unit: 'хв', label: 'тривалість' },
      ]),
      missed.length ? txGroup('Ще потренувати', txRows(missed.map((r, i) => h('div.tx-row.redo-miss',
        h('span.tx-no', String(i + 1)),
        h('div.tx-body', h('div.fix-line', h('s.bad', { lang: 'en' }, r.item.wrong), h('span.arrow', { 'aria-label': 'правильно:' }, ' → '), h('b.good', { lang: 'en' }, r.item.target))),
        h('button.tx-sq.tu-say', { type: 'button', 'aria-label': `Прослухати: ${r.item.target}`, onclick: () => speak(r.item.target) }, ic('speaker-high', { size: 18 })))))) : null,
      txPrimary({ icon: 'check', label: 'Готово', onclick: backTo }),
      tx({ icon: 'arrow-clockwise', label: 'Пройти ще раз', wide: true, onclick: () => redoPage(view, chatId) }),
      !user() ? h('div.redo-foot', h('a.redo-link', { href: '#/auth' }, ic('key', { size: 16 }), 'Вимовляти вголос — після входу')) : null);
    window.scrollTo(0, 0);
  }

  drawItem();
}
