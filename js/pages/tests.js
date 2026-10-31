// Тести: визначення рівня (адаптивний), за уроком, тижневий
import { h, ic, emo, progress } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { placement as loadPlacement, grammarIndex, lesson as loadLesson, allDecks } from '../data.js';
import { render as renderExercise, answerText } from '../ui/exercises.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { activityTimer, addMistake, dayKey } from '../stats.js';
import { setLevel, LEVEL_NAME, LEVEL_DESC } from '../level.js';
import * as CAT from '../placement.js';
import { onLeave } from '../router.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { setTitle, setFocus } from '../ui/shell.js';

// Щоб тести не повторювались: що бачили в останніх спробах (зберігається в історії тестів і синхронізується)
const exKey = (ex) => String(ex.id || ex.prompt || ex.sentence || ex.uk || ex.answer || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
function seenRecently(type, ref = null, attempts = 3) {
  const hist = store.all('tests').filter(t => t.type === type && (ref == null || t.ref === ref))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, attempts);
  return new Set(hist.flatMap(t => (t.details || []).map(d => d.id || d.key).filter(Boolean)));
}
/** Спершу те, чого не бачили в останніх спробах (випадково), потім решта */
const freshFirst = (list, seen) => {
  const mix = (a) => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  return [...mix(list.filter(x => !seen.has(exKey(x)))), ...mix(list.filter(x => seen.has(exKey(x))))];
};

const SKILL_UK = { grammar: 'Граматика', vocabulary: 'Лексика', reading: 'Читання', listening: 'Аудіювання', writing: 'Письмо', speaking: 'Говоріння' };

export default async function tests(view, r) {
  const [kind, ref] = r.parts;
  if (kind === 'placement') return placementTest(view);
  if (kind === 'lesson' && ref) return lessonTest(view, ref);
  if (kind === 'lesson') return pickLesson(view);
  if (kind === 'weekly') return weeklyTest(view);
  return overview(view);
}

function overview(view) {
  const hist = store.all('tests').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lastPl = hist.find(t => t.type === 'placement');
  const plDue = !lastPl || Date.now() - Date.parse(lastPl.created_at) > 30 * 864e5;
  const inRun = !!loadRun();
  const card = (emoji, title, desc, href, extra) => h('a.card.row', { href, style: { textDecoration: 'none', color: 'inherit' } },
    h('div.emoji-circle', emo(emoji)), h('div.grow', h('div', { style: { fontWeight: 600 } }, title), h('div.xs.dim', desc)), extra || null, ic('caret-right', { size: 18 }));
  view.replaceChildren(h('div.stack-lg',
    card('target', 'Визначення рівня', inRun ? 'Тест не завершено — можна продовжити' : 'Адаптивний: 4 частини, письмо й розмова · ~25 хв', '#/tests/placement', inRun ? h('span.tag.accent', 'на паузі') : plDue ? h('span.tag.warn', lastPl ? 'час повторити' : 'не пройдено') : h('span.tag.good', lastPl.scores.overall)),
    card('memo', 'Тест за уроком', 'До 15 питань з уроку і його теми', '#/tests/lesson'),
    card('calendar', 'Тижневий тест', 'Картки й граматика за останні 7 днів', '#/tests/weekly'),
    h('div.section-title', 'Результати'),
    hist.length ? h('div.list', hist.slice(0, 30).map(t => h('div.list-row',
      h('div.grow', h('div', { style: { fontWeight: 600 } }, t.type === 'placement' ? 'Визначення рівня' : t.type === 'weekly' ? 'Тижневий тест' : `Урок: ${t.ref}`),
        h('div.sub', new Date(t.created_at).toLocaleDateString('uk-UA'), t.type === 'placement' ? ` · ${Object.entries(t.scores).filter(([k]) => SKILL_UK[k]).map(([k, v]) => `${SKILL_UK[k] || k}: ${v}`).join(', ')}` : '')),
      h('span.tag.accent', t.type === 'placement' ? t.scores.overall : `${t.scores.score}%`))))
      : h('div.empty', emo('memo', 'xl'), h('p', 'Ще немає результатів'))));
}

// ---------- Загальний раннер тесту ----------
/** Показує питання по одному; next(prevResult) повертає наступне питання або null */
function runner(view, { title, total, next, onFinish }) {
  setFocus(true);
  const head = h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: () => { stopSpeech(); setFocus(false); location.hash = '#/tests'; } }, ic('x')), h('div.grow', progress(0, 'Пройдено питань')), h('span.xs.dim.num'));
  const body = h('div.stack');
  view.replaceChildren(h('div.stack', h('h2', title), head, body));
  const results = [];
  let n = 0;
  const step = (q) => {
    if (!q) { stopSpeech(); setFocus(false); onFinish(results); return; }
    n++;
    head.children[1].replaceChildren(progress((n - 1) / total * 100, 'Пройдено питань'));
    head.lastChild.textContent = `${n}/${total}`;
    body.replaceChildren(renderExercise(q, (ok, given) => { results.push({ ex: q, ok, given }); }, () => step(next(results[results.length - 1]))));
    if (q.audio) setTimeout(() => speak(q.audio), 300);
  };
  step(next(null));
}

function resultList(results) {
  const wrong = results.filter(r => !r.ok);
  return wrong.length ? h('section.stack', { style: { gap: '8px' } }, h('div.section-title', `Розбір помилок (${wrong.length})`),
    wrong.map(r => {
      const btn = h('button.btn.sm.soft', { type: 'button', onclick: () => {
        addMistake({ wrong: r.given || '—', right: answerText(r.ex), type: r.ex.mistakeType || 'other', explanation_uk: r.ex.explanation || '', source: 'test' });
        btn.disabled = true; btn.textContent = 'Додано';
      } }, 'Додати в помилки');
      return h('div.card.tight.stack', { style: { gap: '4px' } },
        h('div.small', r.ex.prompt || r.ex.uk || r.ex.sentence || ''),
        h('div.small', h('span.bad', r.given || '—'), ' → ', h('b.good', answerText(r.ex))),
        r.ex.explanation ? h('div.xs.dim', r.ex.explanation) : null, h('div', btn));
    })) : h('div.feedback.ok', 'Без жодної помилки!');
}

// ---------- Визначення рівня ----------
// Адаптивний тест (computer-adaptive) за частинами: граматика → лексика → читання → аудіювання, потім письмо й розмова.
// Алгоритм (оцінка θ, вибір питань, правило зупинки) — js/placement.js. Незавершений тест зберігається в localStorage.
const RUN_KEY = 'me:placement:run';
const RUN_TTL = 14 * 864e5;
const loadRun = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null');
    if (r && r.v === 1 && Date.now() - r.started < RUN_TTL) return r;
  } catch { /* приватний режим чи зіпсований запис */ }
  return null;
};
const saveRun = (r) => { try { localStorage.setItem(RUN_KEY, JSON.stringify(r)); } catch { /* */ } };
const clearRun = () => { try { localStorage.removeItem(RUN_KEY); } catch { /* */ } };
const shuffle = (a) => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
const PART_UK = { grammar: 'граматика', vocabulary: 'лексика', reading: 'читання', listening: 'аудіювання' };

/** Завдання письма: A1–A2 — повідомлення другові, B1 — лист чи історія, B2 — думка, C1 — аргументований абзац */
const WRITING_TASKS = [
  { id: 'w-weekend', band: 'A', en: 'Write a message to a friend about your last weekend. Where did you go? Who were you with? What did you enjoy?' },
  { id: 'w-home', band: 'A', en: 'Write a message to a new friend about your home. Where is it? What is it like? What do you like about it?' },
  { id: 'w-day', band: 'A', en: 'Write a message to a friend about a normal day in your life: what you do in the morning, in the afternoon and in the evening.' },
  { id: 'w-food', band: 'A', en: 'Write a message to a friend about your favourite food. What is it? When do you eat it? Who cooks it?' },
  { id: 'w-trip', band: 'B1', en: 'Write an email to a friend about a trip or holiday you remember well. What happened, and how did you feel about it?' },
  { id: 'w-story', band: 'B1', en: 'Write a short story that begins with this sentence: "When I opened the door, I couldn\'t believe my eyes."' },
  { id: 'w-hobby', band: 'B1', en: 'A friend wants to start a new hobby but cannot decide which one. Write an email: suggest a hobby, explain why it is a good idea and how to start.' },
  { id: 'w-phones', band: 'B2', en: '"People spend too much time on their phones." Write a paragraph giving your opinion. Support it with reasons and examples.' },
  { id: 'w-city', band: 'B2', en: 'Is it better to live in a big city or in a small town? Write a paragraph comparing the two and say which you prefer and why.' },
  { id: 'w-abroad', band: 'B2', en: '"Travelling abroad is the best way to learn about other cultures." Do you agree? Write a paragraph with reasons and examples.' },
  { id: 'w-remote', band: 'C1', en: '"Working from home will soon make offices unnecessary." To what extent do you agree? Write an argued paragraph considering both sides.' },
  { id: 'w-ai', band: 'C1', en: 'Should schools teach children how to use artificial intelligence tools, or limit their use? Write an argued paragraph and reach a clear conclusion.' },
  { id: 'w-tourism', band: 'C1', en: '"Mass tourism does more harm than good to popular destinations." Discuss, weighing up the arguments, and give your own view.' },
];
const WRITING_BAND = {
  A1: { band: 'A', words: [40, 70], min: 8 }, A2: { band: 'A', words: [40, 70], min: 8 },
  B1: { band: 'B1', words: [80, 120], min: 10 }, B2: { band: 'B2', words: [120, 160], min: 12 }, C1: { band: 'C1', words: [150, 200], min: 12 },
};
const wordCount = (t) => (String(t).match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
const canVoice = () => !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));

async function placementTest(view) {
  setTitle('Визначення рівня');
  const bank = (await loadPlacement()).items.filter(q => CAT.LEVELS.includes(q.level) && Array.isArray(q.options) && q.options.length);
  const byId = new Map(bank.map(q => [q.id, q]));
  const skills = CAT.skillsIn(bank);
  // питання трьох останніх тестів (і тексти, до яких вони були) — лише якщо свіжих на потрібному рівні вже немає
  const seen = seenRecently('placement');
  for (const id of [...seen]) { const g = byId.get(id)?.group; if (g != null) seen.add(`group:${g}`); }
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); setFocus(false); });
  let run = loadRun();
  if (run && (run.skills || []).join() !== skills.join()) run = null;   // банк питань змінився — починаємо заново

  // ---------- оцінки ----------
  const estimates = () => {
    const out = {};
    for (const s of run.skills) {
      const resp = run.resp[s] || [];
      if (!resp.length) continue;
      out[s] = CAT.estimateTheta(resp, CAT.priorFrom(run.skills.slice(0, run.skills.indexOf(s)).map(k => out[k]?.theta)));
    }
    return out;
  };
  const estFor = (s) => CAT.estimateTheta(run.resp[s] || [], CAT.priorFrom(run.skills.slice(0, run.skills.indexOf(s)).map(k => estimates()[k]?.theta)));
  const receptiveOverall = () => CAT.overall(Object.fromEntries(Object.entries(estimates()).map(([k, v]) => [k, v.theta])));
  const usedIds = () => new Set([...Object.values(run.resp).flat().map(r => r.id), ...(run.cur ? [run.cur.id] : [])]);
  const answered = () => Object.values(run.resp).reduce((a, r) => a + r.length, 0);

  intro();

  function intro() {
    setFocus(false);
    const parts = skills.map(s => PART_UK[s]);
    const done = run ? answered() : 0;
    view.replaceChildren(h('div.stack-lg.pl-intro',
      h('div.hero', emo('target', 'xl'), h('h1', 'Визначимо ваш рівень'),
        h('p.dim', 'Адаптивний тест, як у міжнародних іспитах: кожне наступне питання підбирається за вашими відповідями, тому рівень визначається точно, а не «приблизно».')),
      h('section.card.stack', { style: { gap: '10px' } },
        h('div.section-title', 'Як влаштовано'),
        h('ol.pl-steps',
          h('li', h('b', `${skills.length} ${plural(skills.length, 'частина', 'частини', 'частин')}`), ` — ${parts.join(', ')}. У кожній 8–20 питань: коли рівень зрозумілий, частина завершується сама.`),
          h('li', h('b', 'Письмо'), ' — короткий текст на 8–12 хвилин (після входу).'),
          h('li', h('b', 'Розмова'), ' — 3 хвилини голосом із вчителем (після входу, якщо є мікрофон).')),
        h('p.small.dim', 'Разом ~25 хвилин. Можна зупинитися будь-коли й продовжити пізніше з того самого місця.')),
      h('div.feedback.ok', 'Не вгадуйте навмання: якщо не знаєте відповіді, натисніть «Не знаю». Випадкові вгадування лише збивають оцінку.'),
      run ? h('div.stack', { style: { gap: '8px' } },
        h('button.btn.primary.lg.block', { type: 'button', onclick: resume }, ic('play', { fill: true }), 'Продовжити тест'),
        h('p.xs.dim.center', `Пройдено ${done} ${plural(done, 'питання', 'питання', 'питань')}`),
        h('button.btn.ghost.block', { type: 'button', onclick: () => { clearRun(); run = null; start(); } }, 'Почати заново'))
        : h('button.btn.primary.lg.block', { type: 'button', onclick: start }, 'Почати'),
      h('a.btn.ghost.block', { href: '#/tests' }, 'Назад')));
  }

  function start() {
    run = { v: 1, started: Date.now(), phase: 'receptive', skills, skill: 0, resp: Object.fromEntries(skills.map(s => [s, []])), cur: null, writing: null, speaking: null };
    saveRun(run);
    resume();
  }

  function resume() {
    if (run.phase === 'receptive') return ask();
    if (run.phase === 'writing') return writingStep();
    if (run.phase === 'speaking') return speakingStep();
    return finish();
  }

  // ---------- частини з вибором відповіді ----------
  function ask() {
    setFocus(true);
    const s = run.skills[run.skill];
    if (!s) return afterReceptive();
    const resp = run.resp[s];
    let q = run.cur ? byId.get(run.cur.id) : null;
    if (!q) {
      const last = resp.length ? byId.get(resp[resp.length - 1].id) : null;
      q = CAT.nextItem(bank, { skill: s, est: estFor(s), used: usedIds(), seen, last });
      if (!q) { run.skill++; run.cur = null; saveRun(run); return ask(); }
      run.cur = { id: q.id, options: shuffle(q.options) };   // позиція правильної відповіді не підказує
      saveRun(run);
    }
    const max = (CAT.RULES[s] || { max: 12 }).max;
    const n = resp.length + 1;
    const share = Math.min(1, (resp.length) / max);
    const overall = (run.skill + share) / run.skills.length;
    let choice = null, plays = 0;
    const record = (ok, given) => {
      resp.push({ id: q.id, skill: s, level: q.level, ok, given, ...(q.group != null ? { group: q.group } : {}) });
      run.cur = null; saveRun(run); timer.poke();
      stopSpeech();
      ask();
    };
    const opts = run.cur.options.map((o, k) => h('button.opt', { type: 'button', 'aria-pressed': 'false', onclick: () => {
      choice = o;
      opts.forEach((b, j) => { b.classList.toggle('sel', j === k); b.setAttribute('aria-pressed', String(j === k)); });
      nextBtn.disabled = false;
    } }, h('span.pl-key', String.fromCharCode(65 + k)), h('span.grow', { lang: 'en' }, o)));
    const nextBtn = h('button.btn.primary.grow', { type: 'button', disabled: true, onclick: () => choice != null && record(choice === answerText({ ...q, type: 'choice' }), choice) }, 'Далі');
    const listen = q.audio ? h('button.btn.soft.sm', { type: 'button', onclick: () => {
      if (plays >= 3) return;
      plays++; speak(q.audio);
      if (plays >= 3) { listen.disabled = true; listen.lastChild.textContent = 'Прослухано'; }
      else listen.lastChild.textContent = `Ще раз (${3 - plays})`;
    } }, ic('speaker-high', { size: 18 }), h('span', 'Прослухати')) : null;
    const instr = s === 'listening' ? 'Прослухайте і оберіть відповідь (не більше трьох разів)' : s === 'reading' ? 'Прочитайте текст і оберіть відповідь' : s === 'vocabulary' ? 'Оберіть слово, що підходить' : 'Оберіть правильний варіант';
    const pairNote = q.group != null && resp.length && resp[resp.length - 1].group === q.group ? h('span.tag', 'Той самий текст, друге питання') : null;
    view.replaceChildren(h('div.stack.pl-run',
      h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Пауза — продовжити можна пізніше', title: 'Пауза', onclick: pause }, ic('pause')),
        h('div.grow.stack', { style: { gap: '4px' } },
          h('div.row.xs', h('b.grow', `Частина ${run.skill + 1} з ${run.skills.length} · ${SKILL_UK[s]}`), h('span.dim.num', `${n}/≤${max}`)),
          progress(overall * 100, 'Пройдено тесту'))),
      h('div.xs.dim', instr, pairNote ? ' ' : '', pairNote),
      q.passage ? h('div.card.pl-passage', { lang: 'en' }, q.passage) : null,
      h('div.row', h('div.grow.pl-prompt', { lang: 'en' }, q.prompt), listen),
      h('div.stack', { role: 'group', 'aria-label': 'Варіанти відповіді' }, opts),
      h('div.row', h('button.btn.ghost', { type: 'button', onclick: () => record(false, '—') }, 'Не знаю'), nextBtn)));
    if (listen) setTimeout(() => listen.isConnected && plays === 0 && listen.click(), 300);
  }

  function pause() {
    stopSpeech(); setFocus(false); saveRun(run);
    location.hash = '#/tests';
  }

  function afterReceptive() {
    if (run.phase === 'receptive') { run.phase = 'writing'; run.cur = null; saveRun(run); }
    resume();
  }

  // ---------- письмо ----------
  function writingStep() {
    setFocus(false);
    if (!user() || !navigator.onLine || run.writing?.result || run.writing?.skipped) { run.phase = 'speaking'; saveRun(run); return resume(); }
    const est = receptiveOverall()?.level || 'B1';
    const cfg = WRITING_BAND[est];
    if (!run.writing?.task) {
      const list = WRITING_TASKS.filter(t => t.band === cfg.band);
      const fresh = list.filter(t => !seen.has(t.id));
      const t = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
      run.writing = { task: t.id, target: est, draft: '', startedAt: Date.now() };
      saveRun(run);
    }
    const task = WRITING_TASKS.find(t => t.id === run.writing.task) || WRITING_TASKS[0];
    const [lo, hi] = cfg.words;
    const taskText = `${task.en} Write ${lo}–${hi} words.`;
    const ta = h('textarea.input', { rows: 9, lang: 'en', spellcheck: 'false', autocapitalize: 'sentences', autocomplete: 'off', 'aria-label': 'Ваш текст англійською', placeholder: 'Пишіть англійською…' });
    ta.value = run.writing.draft || '';
    const count = h('span.num');
    const clock = h('span.num');
    const send = h('button.btn.primary.grow', { type: 'button', onclick: submit }, 'Надіслати на оцінку');
    const err = h('div', { role: 'status', 'aria-live': 'polite' });
    let saveT = 0;
    const upd = () => {
      const n = wordCount(ta.value);
      count.textContent = `${n} ${plural(n, 'слово', 'слова', 'слів')}`;
      count.className = 'num ' + (n >= lo && n <= hi + 20 ? 'good' : n > hi + 20 ? 'warn' : 'dim');
      send.disabled = n < 15;
    };
    ta.addEventListener('input', () => { upd(); clearTimeout(saveT); saveT = setTimeout(() => { run.writing.draft = ta.value; saveRun(run); }, 400); });
    upd();
    // м'який таймер: після закінчення часу можна дописати думку
    const limit = cfg.min * 60;
    const tick = setInterval(() => {
      if (!clock.isConnected) { clearInterval(tick); return; }
      const left = limit - Math.floor((Date.now() - run.writing.startedAt) / 1000);
      clock.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'час минув — завершіть думку й надсилайте';
      clock.className = left > 0 ? 'num' : 'num warn';
      if (left % 30 === 0) timer.poke();
    }, 1000);
    view.replaceChildren(h('div.stack.pl-write',
      h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Пауза — продовжити можна пізніше', onclick: pause }, ic('pause')), h('h2.grow', { style: { margin: 0 } }, 'Письмо'), h('span.tag.accent', `≈ ${est}`)),
      h('p.small.dim', `Напишіть ${lo}–${hi} слів англійською, як зможете. Без перекладача й словника: оцінюється ваш власний текст. Орієнтовно ${cfg.min} хв.`),
      h('div.card.pl-task', { lang: 'en' }, taskText),
      ta,
      h('div.row.xs', count, h('span.grow'), ic('clock', { size: 16 }), clock),
      err,
      h('div.row', h('button.btn.ghost', { type: 'button', onclick: () => { clearInterval(tick); run.writing = { ...run.writing, skipped: true }; run.phase = 'speaking'; saveRun(run); resume(); } }, 'Пропустити'), send)));

    async function submit() {
      const text = ta.value.trim();
      if (wordCount(text) < 15) return;
      if (wordCount(text) < lo * 0.6) {
        err.replaceChildren(h('div.feedback.no', `Замало для оцінки: потрібно хоча б ${Math.round(lo * 0.6)} слів.`));
        return;
      }
      send.disabled = true; ta.disabled = true;
      err.replaceChildren(h('div.small.dim', 'Оцінюємо письмо… (до хвилини)'));
      run.writing.draft = text; saveRun(run);
      try {
        const res = await Promise.race([
          tutor('level_writing', { text, task: taskText, target: run.writing.target }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
        ]);
        clearInterval(tick);
        run.writing = { ...run.writing, words: wordCount(text), result: res && typeof res === 'object' ? res : { level: null } };
        run.phase = 'speaking'; saveRun(run); timer.poke();
        resume();
      } catch (e) {
        send.disabled = false; ta.disabled = false;
        err.replaceChildren(h('div.feedback.no', e?.message === 'timeout' ? 'Оцінка триває задовго. Спробуйте ще раз або пропустіть письмо.' : aiErrorText(e)));
      }
    }
  }

  // ---------- розмова ----------
  function speakingStep() {
    setFocus(false);
    if (!user() || !navigator.onLine || run.speaking) { run.phase = 'done'; saveRun(run); return finish(); }
    const est = receptiveOverall()?.level || 'B1';
    const skip = (why) => { run.speaking = { skipped: why || true }; run.phase = 'done'; saveRun(run); finish(); };
    if (!canVoice()) {
      view.replaceChildren(h('div.hero', emo('mic', 'xl'), h('h2', 'Розмова недоступна'),
        h('p.dim', 'На цьому пристрої чи в браузері немає доступу до мікрофона. Говоріння можна буде оцінити пізніше в розмові з вчителем.'),
        h('button.btn.primary', { type: 'button', onclick: () => skip('no_mic') }, 'Завершити тест')));
      return;
    }
    view.replaceChildren(h('div.hero', emo('mic', 'xl'), h('h2', 'Останній етап: 3 хвилини розмови'),
      h('p.dim', 'Вчитель почне з простих питань про вас, а далі поступово ускладнюватиме: розповідь про подію, думка з аргументами, гіпотетичні питання. Говоріть як вийде — це оцінка говоріння.'),
      h('p.small.dim', 'Рекомендуємо не пропускати: без розмови рівень визначиться лише за письмовими частинами.'),
      h('div.row', h('button.btn.soft', { type: 'button', onclick: () => skip('user') }, 'Пропустити'),
        h('button.btn.primary', { type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const { voiceSession } = await import('../live/voice.js');
          voiceSession(view, {
            // ≤ 300 символів (сервер обрізає тему)
            topic: `LEVEL CHECK, 3 min. One question at a time, escalate: A2 self/routine → B1 past event, plans → B2 opinion with reasons → C1 hypothetical/abstract. If they struggle, stay at that level. Don't teach or correct. Short turns. Written test estimate: ${est}.`,
            maxSeconds: 180,
            onFinish: async (row) => {
              view.replaceChildren(h('div.hero', emo('hourglass', 'xl'), h('p', 'Оцінюємо говоріння…')));
              let level = null;
              try {
                if (!row.messages.some(m => m.role === 'user')) throw new Error('empty');
                const s = await tutor('summary', { mode: 'voice', messages: row.messages });
                row.summary = s; row.title = 'Тест на рівень: розмова'; store.put('tutor_chats', row);
                // замало мовлення — говоріння не враховуємо (краще без оцінки, ніж хибне A1)
                level = CAT.LEVELS.includes(s?.level_signal) && s.level_assessment?.enough_data !== false ? s.level_signal : null;
              } catch { level = null; }
              run.speaking = level ? { level } : { skipped: 'failed' };
              run.phase = 'done'; saveRun(run);
              finish();
            },
          });
        } }, ic('microphone', { fill: true }), 'Почати розмову'))));
  }

  // ---------- результат ----------
  function finish() {
    setFocus(false);
    const est = estimates();
    const thetas = Object.fromEntries(Object.entries(est).map(([k, v]) => [k, v.theta]));
    const wr = run.writing?.result;
    if (wr?.level) thetas.writing = CAT.productiveTheta(wr.level, wr.sublevel);
    if (run.speaking?.level) thetas.speaking = CAT.productiveTheta(run.speaking.level, 'mid');
    const o = CAT.overall(thetas);
    if (!o) { clearRun(); view.replaceChildren(h('div.empty', h('p', 'Немає відповідей для оцінки.'), h('a.btn.soft', { href: '#/tests' }, 'До тестів'))); return; }
    const skillsLv = {};
    for (const [k, v] of Object.entries(est)) skillsLv[k] = CAT.levelOf(v.theta);
    if (wr?.level) skillsLv.writing = wr.level;
    if (run.speaking?.level) skillsLv.speaking = run.speaking.level;
    const items = Object.values(run.resp).flat();
    const details = [
      ...items.map(r => ({ id: r.id, skill: r.skill, level: r.level, ok: r.ok, ...(r.group != null ? { group: r.group } : {}) })),
      ...Object.entries(est).map(([k, v]) => ({ key: `est:${k}`, skill: k, theta: +v.theta.toFixed(3), se: +v.se.toFixed(3), n: v.n })),
      ...(run.writing?.task ? [{ id: run.writing.task, skill: 'writing', level: wr?.level || null, sublevel: wr?.sublevel || null, words: run.writing.words || 0, skipped: !!run.writing.skipped }] : []),
      { key: 'est:overall', theta: +o.theta.toFixed(3) },
    ];
    // один і той самий тест не записуємо двічі (повторний finish після перезавантаження)
    if (!run.saved) {
      store.put('tests', { type: 'placement', scores: { ...skillsLv, overall: o.display, level: o.level }, details });
      store.setProf({ skills: skillsLv, placementDone: true });
      setLevel(o.level, 'test');
      run.saved = true;
    }
    clearRun();
    timer.poke(); timer.stop();
    const results = items.map(r => ({ ex: { ...(byId.get(r.id) || { prompt: r.id, answer: '' }), type: 'choice' }, ok: r.ok, given: r.given }));
    const conf = CAT.confidence(o.theta, CAT.overallSE(Object.fromEntries(Object.entries(est).map(([k, v]) => [k, v.se]))));
    const bar = (k, lv, sub) => h('div.pl-skill',
      h('div.row.small', h('span.grow', SKILL_UK[k]), h('b', lv), sub ? h('span.xs.dim', sub) : null),
      h('div.pl-bar', { role: 'img', 'aria-label': `${SKILL_UK[k]}: ${lv}` }, CAT.LEVELS.map((l, i) => h('i', { class: i <= CAT.LEVELS.indexOf(lv) ? 'on' : '' }))));
    const skillRows = [
      ...Object.entries(est).map(([k, v]) => { const c = CAT.confidence(v.theta, v.se); return bar(k, CAT.levelOf(v.theta), c.label); }),
      wr?.level ? bar('writing', wr.level, { low: 'нижня межа', mid: '', high: 'верхня межа' }[wr.sublevel] || '') : null,
      run.speaking?.level ? bar('speaking', run.speaking.level, 'за розмовою') : null,
    ];
    const skipped = [
      !wr?.level ? (run.writing?.skipped ? 'письмо пропущено' : wr ? 'письмо не оцінено' : user() ? null : 'письмо й розмова — після входу') : null,
      run.speaking?.skipped ? (run.speaking.skipped === 'no_mic' ? 'розмова недоступна' : run.speaking.skipped === 'failed' ? 'розмову не вдалося оцінити' : 'розмову пропущено') : null,
    ].filter(Boolean);
    view.replaceChildren(h('div.stack-lg.pl-result',
      h('div.hero', emo('trophy', 'xl'), h('div.xs.dim', 'Ваш рівень'), h('div.num.pl-big', o.display),
        h('p', h('b', LEVEL_NAME[o.level] || ''), conf.sure ? '' : h('span.dim', ` · ${conf.label}`)),
        h('p.dim', LEVEL_DESC[o.level] || '')),
      h('section.card.stack', { style: { gap: '12px' } }, h('div.section-title', 'За навичками'), skillRows,
        skipped.length ? h('p.xs.dim', `Не враховано: ${skipped.join(', ')}.`) : null),
      wr?.level || wr?.comment_uk ? h('section.card.stack', { style: { gap: '8px' } },
        h('div.section-title', 'Письмо: відгук'),
        wr.comment_uk ? h('p.small', wr.comment_uk) : null,
        wr.strengths_uk?.length ? h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Що вдалося'), h('ul.small.pl-list', wr.strengths_uk.map(t => h('li', t)))) : null,
        wr.improve_uk?.length ? h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Що покращити'), h('ul.small.pl-list', wr.improve_uk.map(t => h('li', t)))) : null) : null,
      h('p.small.dim.center', `Під рівень ${o.level} підлаштовано урок дня, нові слова, диктанти, сценарії й вчителя. Змінити можна в «Налаштуваннях».`),
      resultList(results),
      h('p.xs.dim.center', 'Пройти тест ще раз варто не раніше ніж через 2 тижні — тоді буде видно реальний прогрес. Питання щоразу нові.'),
      h('a.btn.primary.block.lg', { href: '#/' }, 'На головну')));
  }
}

// ---------- Тест за уроком ----------
async function pickLesson(view) {
  const idx = await grammarIndex();
  view.replaceChildren(h('div.stack', h('div.row', h('a.icon-btn', { href: '#/tests', 'aria-label': 'Назад' }, ic('arrow-left')), h('h1', { style: { margin: 0 } }, 'Оберіть урок')),
    h('div.list', idx.map(l => h('a.list-row', { href: `#/tests/lesson/${l.id}` }, h('span.num.dim', { style: { width: '26px' } }, String(l.n)), h('div.grow', l.title), ic('caret-right', { size: 18 }))))));
}

async function lessonTest(view, id) {
  const idx = await grammarIndex();
  const pos = idx.findIndex(l => l.id === id);
  if (pos < 0) {
    view.replaceChildren(h('div.empty', emo('magnifier', 'xl'), h('p', 'Урок не знайдено.'), h('a.btn.soft', { href: '#/tests/lesson' }, 'Обрати урок')));
    return;
  }
  const l = await loadLesson(id);
  setTitle(`Тест: ${l.title}`);
  let pool = l.exercises.map(e => ({ ...e, mistakeType: l.mistakeType }));
  // доповнюємо лише уроками тієї ж теми й рівня (не випадковим попереднім уроком)
  const meta = idx[pos];
  for (const other of idx.filter(x => x.id !== id && meta && x.unit === meta.unit && x.level === meta.level)) {
    if (pool.length >= 15) break;
    const ol = await loadLesson(other.id);
    pool = pool.concat(ol.exercises.map(e => ({ ...e, mistakeType: ol.mistakeType })).sort(() => Math.random() - 0.5).slice(0, 15 - pool.length));
  }
  const seen = seenRecently('lesson', id, 2);
  // свіжі вправи від вчителя (після входу й онлайн): 5 нових щоразу; не вийшло — лише вправи уроку
  let ai = [];
  if (user() && navigator.onLine) {
    view.replaceChildren(h('div.empty', h('p', 'Готуємо свіжі питання…')));
    try {
      const res = await Promise.race([
        tutor('exercises', { topic: `${l.titleEn || l.title} (${l.title})`, count: 5 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);
      ai = (res?.exercises || []).map(e => ({ ...e, mistakeType: l.mistakeType }));
    } catch { ai = []; }
  }
  const local = freshFirst(pool, seen).slice(0, 15 - ai.length);
  const qs = [...local, ...ai].sort(() => Math.random() - 0.5);
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); });
  let i = 0;
  runner(view, {
    title: `Тест: ${l.title}`, total: qs.length,
    next: () => qs[i++] || null,
    onFinish: (results) => {
      const score = Math.round(results.filter(r => r.ok).length / results.length * 100);
      store.put('tests', { type: 'lesson', ref: id, scores: { score }, details: results.map(r => ({ ok: r.ok, given: r.given, key: exKey(r.ex) })) });
      timer.poke(); timer.stop();
      view.replaceChildren(h('div.stack-lg',
        h('div.hero', emo(score >= 80 ? 'trophy' : 'muscle', 'xl'), h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${score}%`), h('p.dim', l.title)),
        resultList(results),
        h('div.row', h('a.btn.soft.grow', { href: `#/grammar/${id}` }, 'До уроку'), h('a.btn.primary.grow', { href: '#/tests' }, 'До тестів'))));
    },
  });
}

// ---------- Тижневий тест ----------
async function weeklyTest(view) {
  const since = Date.now() - 7 * 864e5;
  const cardIds = new Set(store.all('reviews').filter(r => Date.parse(r.ts) >= since).map(r => r.card_id));
  const cards = store.all('cards').filter(c => cardIds.has(c.id) && c.uk);
  const lessons = store.all('lessons_progress').filter(p => Date.parse(p.updated_at) >= since);
  if (cards.length < 4 && !lessons.length) {
    view.replaceChildren(h('div.hero', emo('calendar', 'xl'), h('h2', 'Поки замало матеріалу'), h('p.dim', 'Тижневий тест складається з карток і уроків, які ви проходили за останні 7 днів. Позаймайтесь кілька днів — і повертайтесь.'), h('a.btn.soft', { href: '#/tests' }, 'Назад')));
    return;
  }
  const allCards = (await allDecks()).flatMap(d => d.cards);
  const qs = [];
  const seen = seenRecently('weekly', null, 2);
  // спершу картки, яких не було в двох останніх тижневих тестах
  for (const c of freshFirst(cards, seen).slice(0, lessons.length ? 10 : 15)) {
    const distract = allCards.filter(x => x.uk !== c.uk).sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.uk);
    if (Math.random() < 0.5) qs.push({ id: c.id, type: 'choice', prompt: c.en, audio: c.en, options: [c.uk, ...distract].sort(() => Math.random() - 0.5), answer: c.uk, mistakeType: 'vocabulary', instruction: 'Що це означає?' });
    else qs.push({ id: c.id, type: 'input', prompt: `${c.uk}`, answer: [c.en], mistakeType: 'vocabulary', instruction: 'Напишіть англійською' });
  }
  for (const p of lessons.slice(0, 5)) {
    try { const l = await loadLesson(p.id); qs.push(...freshFirst(l.exercises, seen).slice(0, 2).map(e => ({ ...e, mistakeType: l.mistakeType }))); } catch { /* */ }
  }
  const list = qs.sort(() => Math.random() - 0.5).slice(0, 20);
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); });
  let i = 0;
  runner(view, {
    title: 'Тижневий тест', total: list.length,
    next: () => list[i++] || null,
    onFinish: (results) => {
      const score = Math.round(results.filter(r => r.ok).length / results.length * 100);
      store.put('tests', { type: 'weekly', ref: dayKey(), scores: { score }, details: results.map(r => ({ ok: r.ok, key: exKey(r.ex) })) });
      timer.poke(); timer.stop();
      view.replaceChildren(h('div.stack-lg',
        h('div.hero', emo(score >= 80 ? 'trophy' : 'thumbsup', 'xl'), h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${score}%`), h('p.dim', 'Тижневий тест')),
        resultList(results), h('a.btn.primary.block', { href: '#/tests' }, 'До тестів')));
    },
  });
}

