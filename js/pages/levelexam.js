// Іспит рівня (#/tests/level): закрити свій рівень одним тестом замість тижнів очікування інтервалів FSRS
// (ідея власника 2026-11-09: «здав тест — готовий перейти»).
// Частина 1 — граматика: по 2 вправи з кожного уроку рівня (локальні вправи уроків, без AI).
// Частина 2 — слова: усі ще не закріплені слова колод рівня (до 60, решта — вибірково):
//   правильно — слово зараховано як вивчене (srs.markKnown, source 'exam'); помилка або «Не знаю» — перше в черзі на вивчення.
// Пройдено (граматика ≥ 80% і слова ≥ 80%) — рівень закрито, кнопка переходу на наступний (setLevel(next, 'exam')).
// Не пройдено — уроки з помилками на повторення, список того, що доробити. Запис — tests { type: 'level', ref: рівень }.
import { h, ic } from '../ui/dom.js';
import { plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { grammarIndex, lesson as loadLesson, deckIndex, withCards } from '../data.js';
import { runExercises, cappedRows } from '../ui/exercises.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { activityTimer, lessonNeedsReview, addMistake } from '../stats.js';
import { myLevel, nextLevel, setLevel, LEVEL_NAME, LEVELS } from '../level.js';
import { onLeave } from '../router.js';
import { setFocus } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { tx, txPrimary, txGroup, txKpis, txRow, txRows, txResult, txPill } from '../ui/tiles.js';

export const PASS = 80;
const PER_LESSON = 2;
const MAX_WORDS = 60;
const EX_TYPES = new Set(['choice', 'input', 'error', 'order']);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const pct = (ok, n) => n ? Math.round(ok / n * 100) : 100;

/** Слова рівня: усі унікальні слова колод рівня (увімкнених; як у levelProgress) і ті, що ще не закріплені (інтервал < 7 дн.) */
export async function levelWords(level) {
  const general = (await deckIndex()).filter(d => d.level === level && d.group !== 'work');
  const isOn = (d) => { const r = store.get('decks', d.id); return r ? r.enabled !== false : d.default !== false; };
  const decks = await withCards(general.some(isOn) ? general.filter(isOn) : general);
  const mastered = new Set();
  for (const c of store.all('cards')) if (!c.deleted && c.reps > 0 && (c.scheduled_days || 0) >= 7) { mastered.add(c.id); mastered.add(String(c.en || '').toLowerCase()); }
  const seen = new Set(), all = [], open = [];
  for (const d of decks) for (const c of d.cards) {
    const k = String(c.en).toLowerCase();
    if (seen.has(k) || !c.uk) continue;
    seen.add(k);
    const id = srs.starterId(d.id, c.en);
    const item = { id, deck: d.id, c };
    all.push(item);
    if (!mastered.has(id) && !mastered.has(k)) open.push(item);
  }
  return { all, open };
}

export default async function levelExam(view) {
  const level = myLevel();
  const next = nextLevel(level);
  const last = level === LEVELS[LEVELS.length - 1];
  const idx = await grammarIndex();
  const lessons = idx.filter(l => l.level === level);
  const words = await levelWords(level);
  const prev = store.all('tests').filter(t => t.type === 'level' && t.ref === level).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const wordN = Math.min(MAX_WORDS, words.open.length);

  view.replaceChildren(h('div.stack-lg.gx.lx',
    txResult({ icon: 'exam', tone: 'accent', label: `Іспит рівня ${level}`, title: last ? `Підтвердити рівень ${level}` : `Закрити ${level} і перейти на ${next}`,
      sub: `≈ ${Math.max(5, Math.round((lessons.length * PER_LESSON * 20 + wordN * 6) / 60))} хв · прохідний бал — ${PASS}% у кожній частині` }),
    txPrimary({ icon: 'play', label: 'Почати іспит', sub: `граматика ${lessons.length * PER_LESSON} · слова ${wordN}`, onclick: () => start(view, { level, next, last, lessons, words }) }),
    txGroup('Що перевіряємо', txRows([
      txRow({ icon: 'puzzle-piece', label: 'Граматика', sub: `${lessons.length} ${plural(lessons.length, 'урок', 'уроки', 'уроків')} рівня ${level} · по ${PER_LESSON} питання` }),
      txRow({ icon: 'cards', label: 'Слова', sub: words.open.length
        ? `${words.open.length} ${plural(words.open.length, 'слово', 'слова', 'слів')} ще не закріплено${words.open.length > MAX_WORDS ? ` · у тесті ${MAX_WORDS}` : ''} · правильні — одразу вивчені`
        : 'усі слова рівня вже закріплено' }),
    ])),
    prev ? txGroup('Минулого разу', txRows([txRow({ icon: prev.scores?.passed ? 'seal-check' : 'exam', label: prev.scores?.passed ? 'Склали' : 'Не склали',
      sub: `${new Date(prev.created_at).toLocaleDateString('uk-UA')} · граматика ${prev.scores?.grammar ?? '—'}% · слова ${prev.scores?.words ?? '—'}%`,
      pill: { text: `${prev.scores?.score ?? 0}%`, tone: prev.scores?.passed ? 'good' : 'warn' } })])) : null));
}

async function start(view, ctx) {
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); setFocus(false); });
  setFocus(true);
  // граматика: по 2 локальні вправи з кожного уроку рівня
  const lessonData = await Promise.all(ctx.lessons.map(l => loadLesson(l.id).catch(() => null)));
  const gq = shuffle(lessonData.filter(Boolean).flatMap(l => shuffle((l.exercises || []).filter(e => EX_TYPES.has(e.type)))
    .slice(0, PER_LESSON).map(e => ({ ...e, mistakeType: e.mistakeType || l.mistakeType, _lesson: l.id, _title: l.title }))));
  const wq = shuffle(ctx.words.open).slice(0, MAX_WORDS);
  const box = h('div');
  view.replaceChildren(h('div.stack-lg.lx', box));
  const grammarDone = (res) => {
    timer.poke();
    wordsPart(box, wq, ctx.words.all, (wres) => { timer.poke(); timer.stop(); setFocus(false); finish(view, ctx, gq, res, wq, wres); });
    return false;
  };
  if (gq.length) runExercises(box, gq, { title: `Іспит ${ctx.level} · граматика`, onDone: grammarDone });
  else grammarDone({ score: 100, correct: 0, total: 0, results: [] });
}

/** Слова: англійське слово → вибрати переклад з 4 або «Не знаю» */
function wordsPart(box, list, pool, done) {
  if (!list.length) { done([]); return; }
  const results = [];
  let i = 0;
  const count = txPill('', 'accent');
  count.classList.add('num');
  const bar = h('span.tx-bar.accent.lx-bar', h('i'));
  const head = h('div.ex-head', h('div.ex-head-t', h('h2.tx-label', 'Слова'), count), bar);
  const body = h('div.stack');
  box.replaceChildren(h('div.stack.ex-run', head, body));
  const show = () => {
    const it = list[i];
    count.textContent = `${i + 1}/${list.length}`;
    bar.firstChild.style.width = `${Math.round(i / list.length * 100)}%`;
    const wrong = shuffle(pool.filter(p => p.c.uk !== it.c.uk && p.id !== it.id)).slice(0, 3).map(p => p.c.uk);
    const opts = shuffle([it.c.uk, ...wrong]);
    let answered = false;
    const pick = (given) => {
      if (answered) return; answered = true;
      const ok = given === it.c.uk;
      results.push({ it, ok, given });
      body.querySelectorAll('.lx-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.v === it.c.uk) b.classList.add('ok');
        else if (b.dataset.v === given) b.classList.add('no');
      });
      setTimeout(() => { i++; i < list.length ? show() : done(results); }, ok ? 450 : 1100);
    };
    body.replaceChildren(
      h('div.card.lx-word',
        h('div.lx-en', it.c.en),
        it.c.ipa ? h('div.ipa.small', it.c.ipa) : null,
        h('button.icon-btn.lx-say', { type: 'button', 'aria-label': 'Прослухати', onclick: () => speak(it.c.en) }, ic('speaker-high', { size: 22 }))),
      h('div.tx-rows.lx-opts', opts.map((o, k) => h('button.tx-row.lx-opt', { type: 'button', dataset: { v: o }, onclick: () => pick(o) },
        h('span.tx-no', String(k + 1)), h('span.tx-body', h('span.tx-l', o))))),
      h('button.btn.ghost.lx-idk', { type: 'button', onclick: () => pick(null) }, 'Не знаю'));
  };
  show();
}

function finish(view, ctx, gq, gres, wq, wres) {
  const gOk = gres.results.filter(r => r.ok).length;
  const wOk = wres.filter(r => r.ok).length;
  const g = pct(gOk, gres.results.length), w = pct(wOk, wres.length);
  const passed = g >= PASS && w >= PASS;
  const score = pct(gOk + wOk, gres.results.length + wres.length);

  // слова: правильні — вивчені одразу; помилки — першими в черзі на вивчення
  let known = 0;
  for (const r of wres) {
    const row = store.get('cards', r.it.id) || srs.rowFromStarter(r.it.deck, r.it.c);
    if (r.ok) { srs.markKnown(row, { source: 'exam' }); known++; }
    else srs.relearn(row);
  }
  // граматика: уроки з помилками — на повторення, помилки — у «Мої помилки»
  const weak = new Map();
  for (const r of gres.results) if (!r.ok) {
    weak.set(r.ex._lesson, { id: r.ex._lesson, title: r.ex._title, n: (weak.get(r.ex._lesson)?.n || 0) + 1 });
    const right = Array.isArray(r.ex.answer) ? r.ex.answer[0] : r.ex.answer;
    if (right && r.given) addMistake({ wrong: String(r.given), right: String(right), type: r.ex.mistakeType || 'other', explanation_uk: r.ex.explanation || '', source: 'test' });
  }
  // на повторення — лише уроки, де помилкові обидва питання (одна помилка з двох — випадковість, лише в списку «Варто повторити»)
  for (const l of weak.values()) if (l.n >= PER_LESSON) lessonNeedsReview(l.id);
  store.put('tests', { type: 'level', ref: ctx.level, scores: { score, grammar: g, words: w, passed },
    details: [...gres.results.map(r => ({ ok: r.ok, lesson: r.ex._lesson })), ...wres.map(r => ({ ok: r.ok, card: r.it.id }))] });
  if (passed) store.setProf({ levelExam: { ...(store.prof().levelExam || {}), [ctx.level]: new Date().toISOString() } });

  const missed = wres.filter(r => !r.ok);
  view.replaceChildren(h('div.stack-lg.lx',
    txResult({ icon: passed ? 'seal-check' : 'exam', tone: passed ? 'good' : score >= 60 ? 'warn' : 'bad', label: `Іспит рівня ${ctx.level}`,
      title: passed ? (ctx.last ? `Рівень ${ctx.level} підтверджено` : `Рівень ${ctx.level} закрито`) : score >= 65 ? 'Ще трохи — і рівень закрито' : `Рівень ${ctx.level} ще не закрито`,
      sub: passed ? (ctx.last ? 'Найвищий рівень курсу' : `Можна переходити на ${ctx.next} · ${LEVEL_NAME[ctx.next]}`) : `Прохідний бал — ${PASS}% у кожній частині` }),
    txKpis([
      { value: g, unit: '%', label: 'граматика', tone: g >= PASS ? 'good' : 'warn' },
      { value: w, unit: '%', label: 'слова', tone: w >= PASS ? 'good' : 'warn' },
      { value: known, label: plural(known, 'слово вивчено', 'слова вивчено', 'слів вивчено'), tone: known ? 'good' : '' },
    ]),
    passed && !ctx.last
      ? txPrimary({ icon: 'rocket-launch', label: `Перейти на ${ctx.next}`, sub: 'уроки дня, нові слова й мова вчителя — під новий рівень',
        onclick: () => { setLevel(ctx.next, 'exam'); toast(`Рівень ${ctx.next}: план і завдання оновлено`); location.hash = '#/'; } })
      : !passed ? txPrimary({ icon: weak.size && g < PASS ? 'puzzle-piece' : 'cards', label: weak.size && g < PASS ? 'Повторити слабкі уроки' : 'Тренувати слова',
        sub: weak.size && g < PASS ? 'почніть з найслабшого уроку' : `${missed.length} ${plural(missed.length, 'слово', 'слова', 'слів')} — першими в тренуванні`,
        href: weak.size && g < PASS ? `#/grammar/${[...weak.values()].sort((a, b) => b.n - a.n)[0].id}` : '#/cards/train' }) : null,
    weak.size ? txGroup(`Варто повторити · ${weak.size}`, cappedRows([...weak.values()].sort((a, b) => b.n - a.n).map(l => txRow({ icon: 'puzzle-piece', label: l.title, sub: l.n >= PER_LESSON ? 'обидва питання з помилкою — урок на повторенні' : `1 з ${PER_LESSON} — з помилкою`, href: `#/grammar/${l.id}` })))) : null,
    missed.length ? txGroup(`Слова до вивчення · ${missed.length}`, cappedRows(missed.map(r => txRow({ icon: 'cards', label: r.it.c.en, sub: r.it.c.uk, chevron: false })))) : null,
    !passed ? tx({ wide: true, icon: 'arrow-clockwise', label: 'Скласти ще раз', sub: 'будь-коли — нові питання', onclick: () => levelExam(view) }) : null,
    txRow({ icon: 'arrow-left', label: 'До тестів', href: '#/tests' })));
}
