// Тести: визначення рівня (адаптивний), за уроком, тижневий
import { h, ic, emo, progress } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { placement as loadPlacement, grammarIndex, lesson as loadLesson, allDecks } from '../data.js';
import { render as renderExercise, answerText, mistakeCard, cappedRows } from '../ui/exercises.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { activityTimer, addMistake, dayKey, applyLessonTest, lessonNeedsReview, lessonsToReview } from '../stats.js';
import * as srs from '../srs.js';
import { setLevel, LEVEL_NAME, LEVEL_DESC, LEVELS, nextLessonByLevel, myLevel as myLevelNow } from '../level.js';
import * as CAT from '../placement.js';
import { onLeave } from '../router.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { setTitle, setFocus } from '../ui/shell.js';
import { tx, txPrimary, txGrid, txGroup, txKpis, txRow, txRows, txPill } from '../ui/tiles.js';
import { levelSection, moreRows, nearRows } from './grammar.js';

// Щоб тести не повторювались: що бачили в останніх спробах (зберігається в історії тестів і синхронізується)
const exKey = (ex) => String(ex.id || ex.prompt || ex.sentence || ex.uk || ex.answer || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
function seenRecently(type, ref = null, attempts = 3) {
  const hist = store.all('tests').filter(t => t.type === type && (ref == null || t.ref === ref))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, attempts);
  return new Set(hist.flatMap(t => (Array.isArray(t.details) ? t.details : []).map(d => d?.id || d?.key).filter(Boolean)));
}
/** Спершу те, чого не бачили в останніх спробах (випадково), потім решта */
const freshFirst = (list, seen) => {
  const mix = (a) => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  return [...mix(list.filter(x => !seen.has(exKey(x)))), ...mix(list.filter(x => seen.has(exKey(x))))];
};

const SKILL_IC = { grammar: 'puzzle-piece', vocabulary: 'cards', reading: 'book-open', listening: 'headphones', writing: 'pencil-line', speaking: 'microphone' };
const SKILL_UK = { grammar: 'Граматика', vocabulary: 'Лексика', reading: 'Читання', listening: 'Аудіювання', writing: 'Письмо', speaking: 'Говоріння' };

export default async function tests(view, r) {
  const [kind, ref] = r.parts;
  if (kind === 'placement') return placementTest(view, { quick: r.query.quick === '1', from: r.query.from || '' });
  if (kind === 'lesson' && ref) return lessonTest(view, ref);
  if (kind === 'lesson') return pickLesson(view);
  if (kind === 'weekly') return weeklyTest(view);
  if (kind === 'level') return import('./levelexam.js').then(m => m.default(view));
  return overview(view);
}

async function overview(view) {
  const titles = Object.fromEntries((await grammarIndex().catch(() => [])).map(l => [l.id, l.title]));
  const hist = store.all('tests').sort((a, b) => b.created_at.localeCompare(a.created_at));
  // швидкий тест (знайомство) не замінює повний: повний пропонується далі, у пігулці — рівень швидкого
  const lastPl = hist.find(t => t.type === 'placement' && !t.scores?.quick);
  const lastQuick = !lastPl ? hist.find(t => t.type === 'placement' && t.scores?.quick) : null;
  const plDue = !lastPl || Date.now() - Date.parse(lastPl.created_at) > 30 * 864e5;
  const inRun = !!loadRunOf(RUN_KEY);
  // три тести — плитки; головна (синя) дія — тест рівня, якщо він на паузі чи давно не проходився, інакше тижневий
  const plPill = inRun ? txPill('на паузі', 'accent') : plDue ? (lastQuick ? txPill(`швидкий · ${lastQuick.scores.overall}`, 'accent') : txPill(lastPl ? 'час повторити' : 'не пройдено', 'warn')) : txPill(lastPl.scores.overall, 'good');
  const T = {
    placement: { icon: 'target', label: inRun ? 'Продовжити тест рівня' : 'Визначення рівня', sub: inRun ? 'Тест не завершено' : 'Адаптивний · ~25 хв', href: '#/tests/placement', pill: plPill },
    lesson: { icon: 'exam', label: 'Тест за уроком', sub: 'До 15 питань', href: '#/tests/lesson' },
    weekly: { icon: 'calendar-blank', label: 'Тижневий тест', sub: 'Слова й граматика за 7 днів', href: '#/tests/weekly' },
    level: { icon: 'seal-check', label: `Іспит рівня ${myLevelNow()}`, sub: 'Закрити рівень і перейти вище', href: '#/tests/level' },
  };
  const main = inRun || plDue ? 'placement' : 'weekly';
  const others = Object.keys(T).filter(k => k !== main && k !== 'level');
  view.replaceChildren(h('div.stack-lg.gx',
    txPrimary({ icon: T[main].icon, label: T[main].label, sub: T[main].sub, href: T[main].href, end: main === 'placement' && !inRun ? T[main].pill : undefined }),
    txGrid(others.map(k => tx({ icon: T[k].icon, label: T[k].label, sub: T[k].sub, href: T[k].href, extra: T[k].pill || null })), 2),
    // іспит рівня — широка плитка: закрити свій рівень і перейти вище (#/tests/level)
    tx({ wide: true, icon: T.level.icon, label: T.level.label, sub: T.level.sub, href: T.level.href }),
    // останні 6 результатів на виду, решта (до 30) — «Показати всі»
    txGroup('Результати', hist.length ? moreRows(hist.slice(0, 30).map(t => {
      const lessonRow = t.type === 'lesson' && t.ref;
      const sub = [new Date(t.created_at).toLocaleDateString('uk-UA'),
        t.type === 'placement' ? Object.entries(t.scores).filter(([k]) => SKILL_UK[k]).map(([k, v]) => `${SKILL_UK[k] || k}: ${v}`).join(', ') : '',
        t.details?.length && t.type !== 'placement' ? `${t.details.filter(d => d.ok).length} з ${t.details.length}` : ''].filter(Boolean).join(' · ');
      // тест за уроком — перехід до уроку (повторити правило або пройти тест ще раз)
      return txRow({
        icon: t.type === 'placement' ? 'target' : t.type === 'weekly' ? 'calendar-blank' : t.type === 'level' ? 'seal-check' : 'exam',
        label: t.type === 'placement' ? (t.scores?.quick ? 'Швидкий тест рівня' : 'Визначення рівня') : t.type === 'weekly' ? 'Тижневий тест' : t.type === 'level' ? `Іспит рівня ${t.ref}${t.scores?.passed ? ' · склали' : ''}` : `Урок: ${titles[t.ref] || t.ref}`,
        sub, pill: t.type === 'placement' ? { text: t.scores.overall, tone: 'accent' } : { text: `${t.scores.score}%`, tone: t.type === 'level' ? (t.scores.passed ? 'good' : 'warn') : scoreCls(t.scores.score) },
        href: lessonRow ? `#/grammar/${t.ref}` : null, chevron: !!lessonRow,
      });
    })) : noteTile('exam', 'Тут з\'являться результати ваших тестів'))));
}

// ---------- Загальний раннер тесту ----------
/** Показує питання по одному; next(prevResult) повертає наступне питання або null */
function runner(view, { title, total, next, onFinish }) {
  setFocus(true);
  setTitle(title);
  // шапка: «Вийти», підпис великими літерами з лічильником-пігулкою, під ними смужка прогресу; назва — у шапці застосунку
  const count = txPill('', 'accent'); count.classList.add('num');
  const bar = h('div', progress(0, 'Пройдено питань'));
  const head = runHead(h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: () => { stopSpeech(); setFocus(false); location.hash = '#/tests'; } }, ic('x')), 'Питання', count, bar);
  const body = h('div.stack');
  view.replaceChildren(h('div.stack-lg', head, body));
  const results = [];
  let n = 0;
  const step = (q) => {
    if (!q) { stopSpeech(); setFocus(false); onFinish(results); return; }
    n++;
    bar.replaceChildren(progress((n - 1) / total * 100, 'Пройдено питань'));
    count.textContent = `${n}/${total}`;
    body.replaceChildren(renderExercise(q, (ok, given) => { results.push({ ex: q, ok, given }); }, () => step(next(results[results.length - 1]))));
    if (q.audio) setTimeout(() => speak(q.audio), 300);
  };
  step(next(null));
}

/** Розбір помилок. auto: помилки вже додано в «Мої помилки» (тест — контроль знань, слабкі місця йдуть у практику) */
function resultList(results, { auto = false } = {}) {
  const wrong = results.filter(r => !r.ok);
  return wrong.length ? txGroup(`Розбір помилок · ${wrong.length}`,
    cappedRows(wrong.map(r => {
      const btn = auto ? null : h('button.ex-mis-add', { type: 'button', 'aria-label': 'Додати в «Мої помилки»', onclick: () => {
        addMistake({ wrong: r.given || '—', right: answerText(r.ex), type: r.ex.mistakeType || 'other', explanation_uk: r.ex.explanation || '', source: 'test' });
        btn.disabled = true; btn.replaceChildren(ic('check', { size: 14 }), 'Додано');
      } }, ic('plus', { size: 14 }), 'У помилки');
      return mistakeCard(r, { action: btn, given: r.dk ? 'Не знаю' : null });
    }))) : tx({ wide: true, tone: 'good', icon: 'check-circle', label: 'Без жодної помилки!' });
}
/** Помилки тесту — у «Мої помилки» */
function saveTestMistakes(results, prefix = '') {
  for (const r of results) if (!r.ok) {
    addMistake({ wrong: r.given || '—', right: answerText(r.ex), type: r.ex.mistakeType || 'other', explanation_uk: `${prefix}${r.ex.explanation || ''}`.trim(), source: 'test' });
  }
}
const scoreCls = (v) => v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad';
/** Підсумок тестів за уроками: id → { last, best, n, at } */
function lessonTestStats() {
  const m = new Map();
  for (const t of store.all('tests').filter(t => t.type === 'lesson' && t.ref).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const v = t.scores?.score ?? 0;
    const e = m.get(t.ref) || { best: 0, n: 0 };
    m.set(t.ref, { last: v, best: Math.max(e.best, v), n: e.n + 1, at: t.created_at });
  }
  return m;
}
/** Що тест змінив у навчанні — картка на екрані результату */
function effectCard(lines) {
  const items = lines.filter(Boolean);
  return items.length ? txGroup('Що змінилось у навчанні', h('div.gx-card.gx-effect', items.map(t => h('div.gx-effect-row', ic('info', { size: 18 }), h('span', t))))) : null;
}

/** Шапка результату тесту: значок і підпис, під ними — показники плитками по три */
function resultHead(score, caption, kpis) {
  return h('section.tx-group',
    h('div.gx-res', h('span.gx-res-ic.' + scoreCls(score), ic(score >= 80 ? 'trophy' : score >= 60 ? 'thumbs-up' : 'barbell', { size: 26, fill: true })), h('div.grow', h('div.tx-label', 'Результат'), h('div.gx-res-t', caption))),
    txKpis(kpis));
}

/** Шапка раннера: кнопка ліворуч, підпис і лічильник, смужка прогресу */
function runHead(btn, label, pill, bar) {
  return h('div.gx-run', btn, h('div.grow', h('div.gx-run-t', h('span.tx-label', label), pill), bar));
}
/** Вступ / проміжний екран: значок у квадратику, підпис великими літерами, заголовок, текст */
function introHead({ icon, tone = '', eyebrow, title, text }) {
  return h('div.gx-intro', h('span.gx-res-ic' + (tone ? '.' + tone : ''), ic(icon, { size: 28, fill: true })),
    eyebrow ? h('div.tx-label', eyebrow) : null, title ? h('h2.gx-intro-h', title) : null, text ? h('p.gx-intro-p', text) : null);
}
/** Плитка-примітка (порада, попередження) без дії */
const noteTile = (icon, text, tone = '') => h('div.tx.wide.gx-note' + (tone ? '.' + tone : ''), h('span.tx-sq', ic(icon, { size: 20 })), h('span.tx-body', h('span.tx-l', text)));

// ---------- Визначення рівня ----------
// Адаптивний тест (computer-adaptive) за частинами: граматика → лексика → читання → аудіювання, потім письмо й розмова.
// Алгоритм (оцінка θ, вибір питань, правило зупинки) — js/placement.js. Незавершений тест зберігається в localStorage.
// швидкий тест (знайомство, #/tests/placement?quick=1) зберігає паузу окремо — не змішується з повним
const RUN_KEY = 'me:placement:run', QUICK_KEY = 'me:placement:quick';
const RUN_TTL = 14 * 864e5;
const loadRunOf = (key) => {
  try {
    const r = JSON.parse(localStorage.getItem(key) || 'null');
    if (r && r.v === 1 && Date.now() - r.started < RUN_TTL) return r;
  } catch { /* приватний режим чи зіпсований запис */ }
  return null;
};
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
/** Чи можна озвучити аудіювання: голос браузера або Gemini TTS (після входу). Без звуку частину пропускаємо, а не рахуємо як помилки */
const canListen = () => typeof speechSynthesis !== 'undefined' || (store.settings().ttsEngine === 'gemini' && !!user());

async function placementTest(view, { quick = false, from = '' } = {}) {
  setTitle(quick ? 'Швидкий тест рівня' : 'Визначення рівня');
  // швидкий тест: граматика, лексика, читання з меншою кількістю питань (CAT.QUICK_RULES), без письма й розмови
  const key = quick ? QUICK_KEY : RUN_KEY;
  const RULES = quick ? CAT.QUICK_RULES : CAT.RULES;
  const loadRun = () => loadRunOf(key);
  const saveRun = (r) => { try { localStorage.setItem(key, JSON.stringify(r)); } catch { /* */ } };
  const clearRun = () => { try { localStorage.removeItem(key); } catch { /* */ } };
  // зі «Знайомства» (#/welcome) — після тесту повертаємось до наступного кроку
  const fromWelcome = from === 'welcome';
  const bank = (await loadPlacement()).items.filter(q => CAT.LEVELS.includes(q.level) && Array.isArray(q.options) && q.options.length);
  const byId = new Map(bank.map(q => [q.id, q]));
  const bankSkills = CAT.skillsIn(bank);
  const skills = quick ? CAT.QUICK_SKILLS.filter(s => bankSkills.includes(s)) : bankSkills.filter(s => s !== 'listening' || canListen());
  // питання трьох останніх тестів (і тексти, до яких вони були) — лише якщо свіжих на потрібному рівні вже немає
  const seen = seenRecently('placement');
  for (const id of [...seen]) { const g = byId.get(id)?.group; if (g != null) seen.add(`group:${g}`); }
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); setFocus(false); });
  let run = loadRun();
  // банк питань змінився (зникла частина) — починаємо заново; окремі зниклі питання не заважають (оцінка — за збереженим рівнем)
  if (run && (!Array.isArray(run.skills) || !run.skills.length || run.skills.some(s => !bankSkills.includes(s)))) run = null;

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
    if (quick) return quickIntro();
    const parts = skills.map(s => PART_UK[s]);
    const done = run ? answered() : 0;
    view.replaceChildren(h('div.stack-lg.gx.pl-intro',
      introHead({ icon: 'target', eyebrow: 'Адаптивний тест', title: 'Визначимо ваш рівень',
        text: 'Близько 25 хвилин. Можна зупинитися й продовжити пізніше.' }),
      run ? txPrimary({ icon: 'play', label: 'Продовжити тест', sub: `Пройдено ${done} ${plural(done, 'питання', 'питання', 'питань')}`, onclick: resume })
        : txPrimary({ icon: 'play', label: 'Почати', sub: `${parts.length} ${plural(parts.length, 'частина', 'частини', 'частин')}, письмо й розмова`, onclick: start }),
      txGroup('Як влаштовано', txRows([
        h('div.tx-row.gx-static', h('span.tx-no', '1'), h('span.tx-body', h('span.tx-l', `${skills.length} ${plural(skills.length, 'частина', 'частини', 'частин')} з вибором відповіді`),
          h('span.tx-s', `${parts.join(', ')} · 8–20 питань`))),
        h('div.tx-row.gx-static', h('span.tx-no', '2'), h('span.tx-body', h('span.tx-l', 'Письмо'), h('span.tx-s', '8–12 хвилин, після входу'))),
        h('div.tx-row.gx-static', h('span.tx-no', '3'), h('span.tx-body', h('span.tx-l', 'Розмова'), h('span.tx-s', '3 хвилини голосом, після входу'))),
      ])),
      noteTile('lightbulb', 'Не знаєте — натисніть «Не знаю», не вгадуйте'),
      txRows([
        run ? txRow({ icon: 'arrow-clockwise', label: 'Почати заново', onclick: () => { clearRun(); run = null; start(); } }) : null,
        txRow({ icon: 'arrow-left', label: 'До тестів', href: '#/tests' }),
      ])));
  }

  function quickIntro() {
    const done = run ? answered() : 0;
    view.replaceChildren(h('div.stack-lg.gx.pl-intro',
      introHead({ icon: 'lightning', eyebrow: 'Швидкий тест', title: 'Визначимо ваш рівень',
        text: 'Близько 10 хвилин: граматика, слова й читання.' }),
      run ? txPrimary({ icon: 'play', label: 'Продовжити тест', sub: `Пройдено ${done} ${plural(done, 'питання', 'питання', 'питань')}`, onclick: resume })
        : txPrimary({ icon: 'play', label: 'Почати', sub: `${skills.length} ${plural(skills.length, 'частина', 'частини', 'частин')} · до ${skills.reduce((a, k) => a + (RULES[k]?.max || 0), 0)} питань`, onclick: start }),
      noteTile('lightbulb', 'Не знаєте — натисніть «Не знаю», не вгадуйте'),
      txRows([
        run ? txRow({ icon: 'arrow-clockwise', label: 'Почати заново', onclick: () => { clearRun(); run = null; start(); } }) : null,
        fromWelcome ? txRow({ icon: 'arrow-left', label: 'Назад до знайомства', href: '#/welcome?step=level' }) : txRow({ icon: 'target', label: 'Повний тест · ~25 хв', sub: 'Ще аудіювання, письмо й розмова', href: '#/tests/placement' }),
      ])));
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
    // питання змінили після паузи (інші варіанти) — підбираємо нове
    if (q && !(Array.isArray(run.cur.options) && run.cur.options.length === q.options.length && run.cur.options.every(o => q.options.includes(o)))) { run.cur = null; q = null; }
    if (!q) {
      const last = resp.length ? byId.get(resp[resp.length - 1].id) : null;
      q = CAT.nextItem(bank, { skill: s, est: estFor(s), used: usedIds(), seen, last, rules: RULES });
      if (!q) { run.skill++; run.cur = null; saveRun(run); return ask(); }
      run.cur = { id: q.id, options: shuffle(q.options) };   // позиція правильної відповіді не підказує
      saveRun(run);
    }
    const max = (RULES[s] || { max: 12 }).max;
    const n = resp.length + 1;
    const share = Math.min(1, (resp.length) / max);
    const overall = (run.skill + share) / run.skills.length;
    let choice = null, plays = 0, done = false;
    const shownAt = Date.now();
    const record = (ok, given, dk = false) => {
      // подвійний дотик: друге натискання не має відповісти на наступне питання
      if (done || Date.now() - shownAt < 300) return;
      done = true;
      resp.push({ id: q.id, skill: s, level: q.level, ok, given, ...(dk ? { dk: true } : {}), ...(q.group != null ? { group: q.group } : {}) });
      run.cur = null; saveRun(run); timer.poke();
      stopSpeech();
      ask();
    };
    const opts = run.cur.options.map((o, k) => h('button.opt.ex-opt', { type: 'button', 'aria-pressed': 'false', onclick: () => {
      choice = o;
      opts.forEach((b, j) => { b.classList.toggle('sel', j === k); b.setAttribute('aria-pressed', String(j === k)); });
      nextBtn.disabled = false;
    } }, h('span.ex-key', { 'aria-hidden': 'true' }, String(k + 1)), h('span.grow', { lang: 'en' }, o)));
    // клавіші 1–9 обирають варіант, як в інших вправах (поза полями введення, не під шторкою/меню); слухач знімається з питанням
    const onKey = (e) => {
      if (!opts[0].isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (done || e.ctrlKey || e.metaKey || e.altKey || opts[0].closest('[inert]') || e.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) { e.preventDefault(); opts[n - 1].click(); }
    };
    if (opts.length <= 9) document.addEventListener('keydown', onKey);
    const nextBtn = h('button.btn.primary.grow', { type: 'button', disabled: true, onclick: () => choice != null && record(choice === answerText({ ...q, type: 'choice' }), choice) }, 'Далі');
    const listen = q.audio ? h('button.btn.soft.sm', { type: 'button', onclick: () => {
      if (plays >= 3) return;
      plays++; speak(q.audio);
      if (plays >= 3) { listen.disabled = true; listen.lastChild.textContent = 'Прослухано'; }
      else listen.lastChild.textContent = `Ще раз (${3 - plays})`;
    } }, ic('speaker-high', { size: 18 }), h('span', 'Прослухати')) : null;
    const instr = s === 'listening' ? 'Прослухайте і оберіть відповідь (не більше трьох разів)' : s === 'reading' ? 'Прочитайте текст і оберіть відповідь' : s === 'vocabulary' ? 'Оберіть слово, що підходить' : 'Оберіть правильний варіант';
    const noSound = s === 'listening' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => {
      if (!confirm('Пропустити аудіювання? Ця частина не врахується в рівні.')) return;
      stopSpeech(); run.resp[s] = []; run.noSound = true; run.skill++; run.cur = null; saveRun(run); ask();
    } }, 'Немає звуку — пропустити частину') : null;
    const pairNote = q.group != null && resp.length && resp[resp.length - 1].group === q.group ? txPill('Той самий текст, друге питання') : null;
    view.replaceChildren(h('div.stack.pl-run',
      runHead(h('button.icon-btn', { type: 'button', 'aria-label': 'Пауза — продовжити можна пізніше', title: 'Пауза', onclick: pause }, ic('pause')),
        `${SKILL_UK[s]} · ${run.skill + 1} з ${run.skills.length}`, h('span.tx-pill.accent.num', `${n}/≤${max}`), progress(overall * 100, 'Пройдено тесту')),
      h('div.xs.dim', instr, pairNote ? ' ' : '', pairNote),
      q.passage ? h('div.card.pl-passage', { lang: 'en' }, q.passage) : null,
      h('div.row', h('div.grow.pl-prompt', { lang: 'en' }, q.prompt), listen),
      h('div.ex-opts', { role: 'group', 'aria-label': 'Варіанти відповіді' }, opts),
      h('div.row', h('button.btn.ghost', { type: 'button', onclick: () => record(false, '—', true) }, 'Не знаю'), nextBtn),
      noSound));
    if (listen) setTimeout(() => listen.isConnected && plays === 0 && listen.click(), 300);
  }

  function pause() {
    stopSpeech(); setFocus(false); saveRun(run);
    location.hash = fromWelcome ? '#/welcome?step=level' : '#/tests';
  }

  function afterReceptive() {
    if (run.phase === 'receptive') { run.phase = quick ? 'done' : 'writing'; run.cur = null; saveRun(run); }
    resume();
  }

  // ---------- письмо ----------
  function writingStep() {
    setFocus(false);
    if (!user() || run.writing?.result || run.writing?.skipped) { run.phase = 'speaking'; saveRun(run); return resume(); }
    if (!navigator.onLine) return offlineStep(writingStep);
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
      h('div.gx-run', h('button.icon-btn', { type: 'button', 'aria-label': 'Пауза — продовжити можна пізніше', onclick: pause }, ic('pause')),
        h('div.grow', h('div.gx-run-t', h('h2.tx-label', 'Частина · письмо'), txPill(`≈ ${est}`, 'accent')))),
      h('p.xs.dim.pl-hint', `${lo}–${hi} слів · без перекладача й словника · ≈ ${cfg.min} хв`),
      h('div.tx.wide.gx-note.pl-task', h('span.tx-sq', ic('pencil-line', { size: 20 })), h('span.tx-body', h('span.tx-l', { lang: 'en' }, taskText))),
      ta,
      h('div.row.xs', count, h('span.grow'), ic('clock', { size: 16 }), clock),
      err,
      h('div.row', h('button.btn.ghost', { type: 'button', onclick: () => { clearInterval(tick); run.writing = { ...run.writing, skipped: true }; run.phase = 'speaking'; saveRun(run); resume(); } }, 'Пропустити'), send)));

    async function submit() {
      const text = ta.value.trim();
      if (wordCount(text) < 15) return;
      if (wordCount(text) < lo * 0.6) {
        err.replaceChildren(h('div.feedback.no', `Замало для оцінки: потрібно хоча б ${Math.round(lo * 0.6)} ${plural(Math.round(lo * 0.6), 'слово', 'слова', 'слів')}.`));
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
        if (!res?.level) {
          // не англійською, переписана умова тощо — пояснюємо й даємо переписати (або пропустити)
          send.disabled = false; ta.disabled = false;
          err.replaceChildren(h('div.feedback.no', res?.comment_uk || 'Не вдалося оцінити текст. Спробуйте ще раз або пропустіть письмо.'));
          return;
        }
        clearInterval(tick);
        run.writing = { ...run.writing, words: wordCount(text), result: res };
        run.phase = 'speaking'; saveRun(run); timer.poke();
        resume();
      } catch (e) {
        send.disabled = false; ta.disabled = false;
        err.replaceChildren(h('div.feedback.no', e?.message === 'timeout' ? 'Оцінка триває задовго. Спробуйте ще раз або пропустіть письмо.' : aiErrorText(e)));
      }
    }
  }

  /** Немає мережі: письмо й розмову оцінює вчитель онлайн — спробувати ще раз або завершити без них */
  function offlineStep(retry) {
    setFocus(false);
    view.replaceChildren(h('div.stack-lg.gx',
      introHead({ icon: 'warning', tone: 'warn', eyebrow: 'Немає мережі', title: 'Немає з\'єднання з інтернетом',
        text: 'Письмо й розмову оцінює вчитель онлайн. Під\'єднайтеся до мережі й спробуйте ще раз — або завершіть тест без цих частин.' }),
      txPrimary({ icon: 'arrow-clockwise', label: 'Спробувати ще раз', onclick: retry }),
      tx({ wide: true, icon: 'flag', label: 'Завершити без них', sub: 'Рівень — за частинами з вибором відповіді', onclick: () => {
        if (!run.writing?.result) run.writing = { ...(run.writing || {}), skipped: 'offline' };
        if (!run.speaking) run.speaking = { skipped: 'offline' };
        run.phase = 'done'; saveRun(run); finish();
      } })));
  }

  // ---------- розмова ----------
  function speakingStep() {
    setFocus(false);
    if (!user() || run.speaking) { run.phase = 'done'; saveRun(run); return finish(); }
    if (!navigator.onLine) return offlineStep(speakingStep);
    const est = receptiveOverall()?.level || 'B1';
    const skip = (why) => { run.speaking = { skipped: why || true }; run.phase = 'done'; saveRun(run); finish(); };
    if (!canVoice()) {
      view.replaceChildren(h('div.stack-lg.gx',
        introHead({ icon: 'microphone-slash', eyebrow: 'Частина · розмова', title: 'Розмова недоступна',
          text: 'На цьому пристрої чи в браузері немає доступу до мікрофона. Говоріння можна буде оцінити пізніше в розмові з вчителем.' }),
        txPrimary({ icon: 'flag', label: 'Завершити тест', sub: 'Показати рівень', onclick: () => skip('no_mic') })));
      return;
    }
    view.replaceChildren(h('div.stack-lg.gx',
      introHead({ icon: 'microphone', eyebrow: 'Останній етап', title: '3 хвилини розмови',
        text: 'Від простих питань про вас — до думки з аргументами. Говоріть як вийде.' }),
      noteTile('info', 'Без розмови рівень визначиться лише за письмовими частинами'),
      txPrimary({ icon: 'microphone', label: 'Почати розмову', sub: '3 хвилини голосом', onclick: async (e) => {
        e.currentTarget.disabled = true;
        const { voiceSession } = await import('../live/voice.js');
        voiceSession(view, {
          // ≤ 300 символів (сервер обрізає тему)
          topic: `LEVEL CHECK, 3 min. One question at a time, escalate: A2 self/routine → B1 past event, plans → B2 opinion with reasons → C1 hypothetical/abstract. If they struggle, stay at that level. Don't teach or correct. Short turns. Written test estimate: ${est}.`,
          maxSeconds: 180,
          onFinish: async (row) => {
            view.replaceChildren(h('div.stack-lg.gx', introHead({ icon: 'hourglass', eyebrow: 'Розмова', title: 'Оцінюємо говоріння…' })));
            let level = null;
            try {
              if (!row.messages.some(m => m.role === 'user')) throw new Error('empty');
              const s = await tutor('summary', { mode: 'voice', messages: row.messages.map(m => ({ role: m.role, text: m.text })) });
              // метрики мовлення (summary.speech від voice.js) лишаються — їх рахує «Аналіз» і звіт за місяць
              row.summary = row.summary?.speech ? { ...s, speech: row.summary.speech } : s; row.title = 'Тест на рівень: розмова'; store.put('tutor_chats', row);
              // замало мовлення — говоріння не враховуємо (краще без оцінки, ніж хибне A1)
              level = CAT.LEVELS.includes(s?.level_signal) && s.level_assessment?.enough_data !== false ? s.level_signal : null;
            } catch { level = null; }
            run.speaking = level ? { level } : { skipped: 'failed' };
            run.phase = 'done'; saveRun(run);
            finish();
          },
        });
      } }),
      tx({ wide: true, icon: 'flag', label: 'Пропустити', sub: 'Завершити тест без розмови', onclick: () => skip('user') })));
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
    if (!o) { clearRun(); view.replaceChildren(h('div.empty', emo('memo', 'xl'), h('p', 'Немає відповідей для оцінки.'), h('a.btn.soft', { href: '#/tests' }, 'До тестів'))); return; }
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
      store.put('tests', { type: 'placement', scores: { ...skillsLv, overall: o.display, level: o.level, ...(quick ? { quick: true } : {}) }, details });
      store.setProf({ skills: skillsLv, placementDone: true });
      setLevel(o.level, 'test');
      run.saved = true;
    }
    clearRun();
    timer.poke(); timer.stop();
    const results = items.map(r => ({ ex: { ...(byId.get(r.id) || { prompt: r.id, answer: '' }), type: 'choice' }, ok: r.ok, given: r.given, dk: !!r.dk }));
    const conf = CAT.confidence(o.theta, CAT.overallSE(Object.fromEntries(Object.entries(est).map(([k, v]) => [k, v.se]))));
    // навичка — рядок-плитка: іконка, назва, п'ять сегментів рівня, рівень пігулкою
    const bar = (k, lv, sub) => h('div.tx-row.gx-skill', h('span.tx-sq', ic(SKILL_IC[k] || 'target', { size: 18 })),
      h('span.tx-body', h('span.gx-skill-l', h('span.tx-l', SKILL_UK[k]), sub ? h('span.tx-s', sub) : null),
        h('span.pl-bar', { role: 'img', 'aria-label': `${SKILL_UK[k]}: ${lv}` }, CAT.LEVELS.map((l, i) => h('i', { class: i <= CAT.LEVELS.indexOf(lv) ? 'on' : '' })))),
      txPill(lv, 'accent'));
    const skillRows = [
      ...Object.entries(est).map(([k, v]) => { const c = CAT.confidence(v.theta, v.se); return bar(k, CAT.levelOf(v.theta), c.label); }),
      wr?.level ? bar('writing', wr.level, { low: 'нижня межа', mid: '', high: 'верхня межа' }[wr.sublevel] || '') : null,
      run.speaking?.level ? bar('speaking', run.speaking.level, 'за розмовою') : null,
    ];
    const skipped = [
      run.noSound ? 'аудіювання пропущено (немає звуку)' : null,
      !quick && bankSkills.includes('listening') && !run.skills.includes('listening') ? 'аудіювання — немає озвучення в цьому браузері' : null,
      quick ? null : !wr?.level ? (run.writing?.skipped === 'offline' ? 'письмо — немає з\'єднання' : run.writing?.skipped ? 'письмо пропущено' : wr ? 'письмо не оцінено' : user() ? null : 'письмо й розмова — після входу') : null,
      run.speaking?.skipped ? (run.speaking.skipped === 'offline' ? 'розмова — немає з\'єднання' : run.speaking.skipped === 'no_mic' ? 'розмова недоступна' : run.speaking.skipped === 'failed' ? 'розмову не вдалося оцінити' : 'розмову пропущено') : null,
    ].filter(Boolean);
    const okN = items.filter(r => r.ok).length;
    view.replaceChildren(h('div.stack-lg.gx.pl-result',
      h('section.tx-group',
        h('div.gx-res', h('span.gx-res-ic.good', ic('trophy', { size: 26, fill: true })),
          h('div.grow', h('div.tx-label', quick ? 'Ваш рівень · швидкий тест' : 'Ваш рівень'), h('div.gx-res-t', LEVEL_NAME[o.level] || o.display, conf.sure ? '' : h('span.dim', ` · ${conf.label}`)),
            LEVEL_DESC[o.level] ? h('div.tx-s', LEVEL_DESC[o.level]) : null)),
        txKpis([
          { value: o.display, label: 'загальний рівень', tone: 'accent' },
          { value: okN, unit: `/${items.length}`, label: 'правильних відповідей', ariaLabel: `${okN} з ${items.length} правильних відповідей` },
        ], 2)),
      fromWelcome ? txPrimary({ icon: 'arrow-right', label: 'Далі: перша розмова', sub: `План уже під рівень ${o.level}`, href: '#/welcome?step=talk' })
        : txPrimary({ icon: 'house', label: 'На головну', sub: `План дня вже під рівень ${o.level}`, href: '#/' }),
      txGroup('За навичками', [txRows(skillRows),
        skipped.length ? h('p.xs.dim', { style: { margin: '0 4px' } }, `Не враховано: ${skipped.join(', ')}.`) : null]),
      wr?.level || wr?.comment_uk ? txGroup('Письмо: відгук', h('div.gx-card.stack', { style: { gap: '8px' } },
        wr.comment_uk ? h('p.small', { style: { margin: 0 } }, wr.comment_uk) : null,
        wr.strengths_uk?.length ? h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Що вдалося'), h('ul.small.pl-list', wr.strengths_uk.map(t => h('li', t)))) : null,
        wr.improve_uk?.length ? h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Що покращити'), h('ul.small.pl-list', wr.improve_uk.map(t => h('li', t)))) : null)) : null,
      resultList(results),
      quick ? txRows([txRow({ icon: 'target', label: 'Повний тест · ~25 хв', sub: 'Точніше: ще аудіювання, письмо й розмова', href: '#/tests/placement' })]) : null,
      h('p.xs.dim', { style: { margin: '0 4px' } }, quick ? 'Рівень змінюється в «Налаштуваннях».' : 'Наступний тест — не раніше ніж за 2 тижні. Рівень змінюється в «Налаштуваннях».')));
  }
}

// ---------- Тест за уроком ----------
async function pickLesson(view) {
  const idx = await grammarIndex();
  const st = lessonTestStats();
  const due = new Set(lessonsToReview().map(p => p.id));
  const row = (l) => {
    const t = st.get(l.id);
    const done = !!store.get('lessons_progress', l.id)?.completed_at;
    return txRow({
      no: l.n, label: l.title, href: `#/tests/lesson/${l.id}`,
      sub: t || done ? [due.has(l.id) ? 'На повторенні' : done ? 'Урок зараховано' : null, t ? `тестів: ${t.n} · найкращий ${t.best}%` : null].filter(Boolean).join(' · ') : null,
      end: t ? h('span.tx-pill.' + scoreCls(t.last), { 'aria-label': `Останній результат тесту ${t.last}%` }, `${t.last}%`) : null,
    });
  };
  // головна дія — тест уроку, що на повторенні, інакше — уроку дня
  const target = idx.find(l => due.has(l.id)) || nextLessonByLevel(idx);
  view.replaceChildren(h('div.stack-lg.gx', h('div.gx-lhead', h('a.icon-btn', { href: '#/tests', 'aria-label': 'Назад' }, ic('arrow-left')), h('div.grow', h('h1.tx-label.gx-eyebrow', 'Тест за уроком · оберіть урок'))),
    target ? txPrimary({ icon: 'exam', label: `Тест: ${target.title}`, sub: due.has(target.id) ? 'Урок на повторенні' : 'Урок дня · від 80% — зараховано', href: `#/tests/lesson/${target.id}` }) : null,
    // за рівнями, як у «Граматиці»: свій рівень розгорнутий, решта згорнуті; номер — порядок курсу; на виду — 6 найближчих
    h('div.gx-levels', LEVELS.map(lv => {
      const items = idx.filter(l => l.level === lv).sort((a, b) => a.n - b.n);
      if (!items.length) return null;
      const t = items.filter(l => st.has(l.id)).length;
      const shown = nearRows(items, l => due.has(l.id), l => !!store.get('lessons_progress', l.id)?.completed_at || st.has(l.id));
      return levelSection(lv, { done: t, total: items.length, countLabel: `Протестовано ${t} з ${items.length}`, rows: items.map(row), shown });
    }))));
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
    view.replaceChildren(h('div.empty', { role: 'status' }, emo('sparkles', 'xl'), h('p', 'Готуємо свіжі питання…')));
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
      const prevBest = lessonTestStats().get(id)?.best ?? null;
      store.put('tests', { type: 'lesson', ref: id, scores: { score }, details: results.map(r => ({ ok: r.ok, given: r.given, key: exKey(r.ex) })) });
      const effect = applyLessonTest(id, score);
      saveTestMistakes(results, `${l.title}: `);
      const wrongN = results.filter(r => !r.ok).length;
      timer.poke(); timer.stop();
      view.replaceChildren(h('div.stack-lg',
        resultHead(score, l.title, [
          { value: score, unit: '%', label: 'результат', tone: scoreCls(score) },
          { value: results.length - wrongN, unit: `/${results.length}`, label: 'правильно' },
          prevBest != null ? { value: prevBest, unit: '%', label: score > prevBest ? 'було — новий рекорд' : 'найкраще раніше' } : { value: wrongN, label: plural(wrongN, 'помилка', 'помилки', 'помилок'), tone: wrongN ? 'bad' : 'good' },
        ]),
        effectCard([
          effect === 'passed' ? 'Урок зараховано. Контрольне повторення — через тиждень.'
            : effect === 'confirmed' ? 'Урок підтверджено — знання тримаються.'
            : effect === 'review' ? 'Урок повернуто на повторення — він у «Граматиці» й у плані дня.'
            : effect === 'fail' ? 'Урок ще не засвоєно: повторіть правило й вправи, потім — тест ще раз.'
            : 'Для зарахування потрібно 80% — повторіть правило й спробуйте ще раз.',
          wrongN ? `${wrongN} ${plural(wrongN, 'помилку', 'помилки', 'помилок')} — у «Мої помилки».` : null,
        ]),
        score >= 80 ? txPrimary({ icon: 'exam', label: 'До тестів', href: '#/tests' })
          : txPrimary({ icon: 'puzzle-piece', label: 'До уроку', sub: 'Повторити правило й вправи', href: `#/grammar/${id}` }),
        resultList(results, { auto: true }),
        txRows([score >= 80 ? txRow({ icon: 'puzzle-piece', label: 'До уроку', href: `#/grammar/${id}` }) : txRow({ icon: 'exam', label: 'До тестів', href: '#/tests' })])));
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
    view.replaceChildren(h('div.stack-lg.gx',
      introHead({ icon: 'calendar-blank', eyebrow: 'Тижневий тест', title: 'Поки замало матеріалу',
        text: 'Тест збирається з карток і уроків за останні 7 днів. Позаймайтесь кілька днів — і повертайтесь.' }),
      txPrimary({ icon: 'arrow-left', label: 'До тестів', href: '#/tests' })));
    return;
  }
  const allCards = (await allDecks()).flatMap(d => d.cards);
  const qs = [];
  const seen = seenRecently('weekly', null, 2);
  // спершу картки, яких не було в двох останніх тижневих тестах
  for (const c of freshFirst(cards, seen).slice(0, lessons.length ? 10 : 15)) {
    const distract = allCards.filter(x => x.uk !== c.uk).sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.uk);
    if (Math.random() < 0.5) qs.push({ id: c.id, _card: c.id, type: 'choice', prompt: c.en, audio: c.en, options: [c.uk, ...distract].sort(() => Math.random() - 0.5), answer: c.uk, mistakeType: 'vocabulary', instruction: 'Що це означає?' });
    else qs.push({ id: c.id, _card: c.id, type: 'input', prompt: `${c.uk}`, answer: [c.en], mistakeType: 'vocabulary', instruction: 'Напишіть англійською' });
  }
  for (const p of lessons.slice(0, 5)) {
    try { const l = await loadLesson(p.id); qs.push(...freshFirst(l.exercises, seen).slice(0, 2).map(e => ({ ...e, mistakeType: l.mistakeType, _lesson: p.id }))); } catch { /* */ }
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
      // невгадані слова — оцінка «Знову» (FSRS: повтор найближчим часом); слабкі уроки — на повторення
      const wrongCards = new Set(), wrongLessons = new Set();
      for (const r of results) if (!r.ok) { if (r.ex._card) wrongCards.add(r.ex._card); if (r.ex._lesson) wrongLessons.add(r.ex._lesson); }
      let relearned = 0;
      for (const id of wrongCards) { const c = store.get('cards', id); if (c?.reps) { srs.relearn(c); relearned++; } }
      for (const id of wrongLessons) lessonNeedsReview(id);
      saveTestMistakes(results.filter(r => !r.ex._card));
      const gram = results.filter(r => !r.ok && !r.ex._card).length;
      timer.poke(); timer.stop();
      view.replaceChildren(h('div.stack-lg',
        resultHead(score, 'Тижневий тест', [
          { value: score, unit: '%', label: 'результат', tone: scoreCls(score) },
          { value: results.filter(r => r.ok).length, unit: `/${results.length}`, label: 'правильно' },
          { value: results.filter(r => !r.ok).length, label: plural(results.filter(r => !r.ok).length, 'помилка', 'помилки', 'помилок'), tone: results.some(r => !r.ok) ? 'bad' : 'good' },
        ]),
        effectCard([
          relearned ? `${relearned} ${plural(relearned, 'слово', 'слова', 'слів')} повернуто до вивчення — з'являться в картках сьогодні.` : null,
          wrongLessons.size ? `${wrongLessons.size} ${plural(wrongLessons.size, 'урок', 'уроки', 'уроків')} граматики — на повторення.` : null,
          gram ? `${gram} ${plural(gram, 'помилку', 'помилки', 'помилок')} з граматики додано в «Мої помилки».` : null,
          !relearned && !wrongLessons.size && !gram ? 'Усе на місці — розклад повторень без змін.' : null,
        ]),
        txPrimary({ icon: 'exam', label: 'До тестів', href: '#/tests' }),
        resultList(results, { auto: true })));
    },
  });
}

