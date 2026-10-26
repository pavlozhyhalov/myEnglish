// Тести: визначення рівня (адаптивний), за уроком, тижневий
import { h, ic, emo, progress } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { placement as loadPlacement, grammarIndex, lesson as loadLesson, allDecks } from '../data.js';
import { render as renderExercise, answerText } from '../ui/exercises.js';
import { speak, stop as stopSpeech } from '../speech.js';
import { activityTimer, addMistake, dayKey } from '../stats.js';
import { setLevel, LEVELS as ALL_LEVELS } from '../level.js';
import { onLeave } from '../router.js';
import { tutor } from '../ai.js';
import { user } from '../supa.js';
import { setTitle, setFocus } from '../ui/shell.js';

const LEVELS = ['A2', 'B1', 'B2', 'C1'];
const SKILL_UK = { grammar: 'Граматика', vocabulary: 'Лексика', listening: 'Аудіювання', speaking: 'Говоріння' };

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
  const card = (emoji, title, desc, href, extra) => h('a.card.row', { href, style: { textDecoration: 'none', color: 'inherit' } },
    h('div.emoji-circle', emo(emoji)), h('div.grow', h('div', { style: { fontWeight: 600 } }, title), h('div.xs.dim', desc)), extra || null, ic('caret-right', { size: 18 }));
  view.replaceChildren(h('div.stack-lg',
    card('target', 'Визначення рівня', '~40 питань + 3 хв розмови · 10–15 хв', '#/tests/placement', plDue ? h('span.tag.warn', lastPl ? 'час повторити' : 'не пройдено') : h('span.tag.good', lastPl.scores.overall)),
    card('memo', 'Тест за уроком', 'До 15 питань з уроку і його теми', '#/tests/lesson'),
    card('calendar', 'Тижневий тест', 'Картки й граматика за останні 7 днів', '#/tests/weekly'),
    h('div.section-title', 'Результати'),
    hist.length ? h('div.list', hist.slice(0, 30).map(t => h('div.list-row',
      h('div.grow', h('div', { style: { fontWeight: 600 } }, t.type === 'placement' ? 'Визначення рівня' : t.type === 'weekly' ? 'Тижневий тест' : `Урок: ${t.ref}`),
        h('div.sub', new Date(t.created_at).toLocaleDateString('uk-UA'), t.type === 'placement' ? ` · ${Object.entries(t.scores).filter(([k]) => k !== 'overall').map(([k, v]) => `${SKILL_UK[k] || k}: ${v}`).join(', ')}` : '')),
      h('span.tag.accent', t.type === 'placement' ? t.scores.overall : `${t.scores.score}%`))))
      : h('div.empty', emo('memo', 'xl'), h('p', 'Ще немає результатів'))));
}

// ---------- Загальний раннер тесту ----------
/** Показує питання по одному; next(prevResult) повертає наступне питання або null */
function runner(view, { title, total, next, onFinish }) {
  setFocus(true);
  const head = h('div.row', h('button.icon-btn', { type: 'button', 'aria-label': 'Вийти', onclick: () => { stopSpeech(); setFocus(false); location.hash = '#/tests'; } }, ic('x')), h('div.grow', progress(0)), h('span.xs.dim.num'));
  const body = h('div.stack');
  view.replaceChildren(h('div.stack', h('h2', title), head, body));
  const results = [];
  let n = 0;
  const step = (q) => {
    if (!q) { stopSpeech(); setFocus(false); onFinish(results); return; }
    n++;
    head.children[1].replaceChildren(progress((n - 1) / total * 100));
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
      } }, 'В помилки');
      return h('div.card.tight.stack', { style: { gap: '4px' } },
        h('div.small', r.ex.prompt || r.ex.uk || r.ex.sentence || ''),
        h('div.small', h('span.bad', r.given || '—'), ' → ', h('b.good', answerText(r.ex))),
        r.ex.explanation ? h('div.xs.dim', r.ex.explanation) : null, h('div', btn));
    })) : h('div.feedback.ok', 'Без жодної помилки!');
}

// ---------- Визначення рівня ----------
async function placementTest(view) {
  setTitle('Визначення рівня');
  const bank = (await loadPlacement()).items;
  const plan = [['grammar', 16], ['vocabulary', 14], ['listening', 10]];
  const total = plan.reduce((a, [, n]) => a + n, 0);
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); });
  const used = new Set();
  const state = Object.fromEntries(plan.map(([s]) => [s, { lvl: 1, asked: 0, hist: [] }]));
  let block = 0, cur = null;

  view.replaceChildren(h('div.hero', emo('target', 'xl'), h('h1', 'Визначимо ваш рівень'),
    h('p.dim', `${total} питань: граматика, лексика, аудіювання. Тест адаптивний — питання підлаштовуються під відповіді. Потім 3 хвилини розмови з вчителем.`),
    h('p.small.dim', 'Не вгадуйте: якщо не знаєте — оберіть будь-що й рухайтесь далі.'),
    h('button.btn.primary.lg', { type: 'button', onclick: start }, 'Почати')));

  function pick(skill, lvl) {
    const pool = bank.filter(q => q.skill === skill && !used.has(q.id));
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const l = LEVELS[lvl + d];
      const c = pool.filter(q => q.level === l);
      if (c.length) return c[Math.floor(Math.random() * c.length)];
    }
    return null;
  }

  function start() {
    runner(view, {
      title: 'Визначення рівня', total,
      next: (prev) => {
        if (prev && cur) {
          const st = state[cur.skill];
          st.hist.push({ lvl: LEVELS.indexOf(cur.level), ok: prev.ok });
          st.lvl = Math.max(0, Math.min(3, LEVELS.indexOf(cur.level) + (prev.ok ? 1 : -1)));
          st.asked++;
          if (st.asked >= plan[block][1]) block++;
        }
        if (block >= plan.length) return null;
        const skill = plan[block][0];
        let q = pick(skill, state[skill].lvl);
        // питання цієї навички скінчились — переходимо до наступної
        while (!q && ++block < plan.length) q = pick(plan[block][0], state[plan[block][0]].lvl);
        if (!q) return null;
        used.add(q.id); cur = q;
        return { ...q, type: 'choice', instruction: q.skill === 'listening' ? 'Прослухайте і оберіть відповідь (кнопка з динаміком — ще раз)' : undefined };
      },
      onFinish: (results) => finishPlacement(results),
    });
  }

  function estimate(hist) {
    if (!hist.length) return null;
    // точність на кожному рівні; рівень = найвищий, де ≥ 60% правильних (знизу вгору, без пропусків)
    const acc = [0, 1, 2, 3].map(l => { const xs = hist.filter(x => x.lvl === l); return xs.length ? xs.filter(x => x.ok).length / xs.length : null; });
    if (acc[0] != null && acc[0] < 0.4) return 'A1';   // не впорався навіть з A2
    let best = 0;
    for (let l = 0; l < 4; l++) {
      if (acc[l] == null) continue;
      if (acc[l] >= 0.6) best = l; else break;
    }
    return LEVELS[best];
  }

  function finishPlacement(results) {
    const scores = {};
    for (const [s] of plan) scores[s] = estimate(state[s].hist) || 'B1';
    const finalize = (speaking) => {
      if (speaking) scores.speaking = speaking;
      const vals = Object.values(scores).map(l => Math.max(0, ALL_LEVELS.indexOf(l)));
      const overall = ALL_LEVELS[Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)];
      const res = { ...scores, overall };
      store.put('tests', { type: 'placement', scores: res, details: results.map(r => ({ id: r.ex.id, skill: r.ex.skill, level: r.ex.level, ok: r.ok })) });
      store.setProf({ skills: scores, placementDone: true });
      setLevel(overall, 'test');
      timer.poke();
      timer.stop();
      view.replaceChildren(h('div.stack-lg',
        h('div.hero', emo('trophy', 'xl'), h('div.xs.dim', 'Ваш рівень'), h('div.num', { style: { fontSize: '48px' } }, overall), h('p.dim', S.level[overall] || '')),
        h('section.card.grid2', Object.entries(scores).map(([k, v]) => h('div.stat', h('b', v), h('span', SKILL_UK[k])))),
        h('p.small.dim.center', 'Під цей рівень підлаштовано урок дня, нові слова, диктанти, сценарії й вчителя. Змінити можна в «Налаштуваннях».'),
        resultList(results),
        h('a.btn.primary.block.lg', { href: '#/' }, 'На головну')));
    };
    // 3 хвилини голосу
    if (!user()) { finalize(null); return; }
    view.replaceChildren(h('div.hero', emo('mic', 'xl'), h('h2', 'Останній етап: 3 хвилини розмови'),
      h('p.dim', 'Вчитель поставить кілька питань про вас і ваші плани. Говоріть як вийде — це для оцінки говоріння.'),
      h('div.row', h('button.btn.soft', { type: 'button', onclick: () => finalize(null) }, 'Пропустити'),
        h('button.btn.primary', { type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const { voiceSession } = await import('../live/voice.js');
          voiceSession(view, {
            topic: 'LEVEL CHECK INTERVIEW: ask him about himself, his daily life, a recent trip or event, and his plans; start simple and gradually ask more complex questions. Keep it to about 3 minutes.',
            maxSeconds: 180,
            onFinish: async (row) => {
              view.replaceChildren(h('div.hero', emo('hourglass', 'xl'), h('p', 'Оцінюю говоріння…')));
              try {
                if (!row.messages.some(m => m.role === 'user')) throw new Error('empty');
                const s = await tutor('summary', { mode: 'voice', messages: row.messages });
                row.summary = s; store.put('tutor_chats', row);
                finalize(s.level_signal);
              } catch { finalize(null); }
            },
          });
        } }, ic('microphone', { fill: true }), 'Почати розмову'))));
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
  const qs = pool.sort(() => Math.random() - 0.5).slice(0, 15);
  const timer = activityTimer('test');
  onLeave(view, () => { timer.stop(); stopSpeech(); });
  let i = 0;
  runner(view, {
    title: `Тест: ${l.title}`, total: qs.length,
    next: () => qs[i++] || null,
    onFinish: (results) => {
      const score = Math.round(results.filter(r => r.ok).length / results.length * 100);
      store.put('tests', { type: 'lesson', ref: id, scores: { score }, details: results.map(r => ({ ok: r.ok, given: r.given })) });
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
  for (const c of cards.sort(() => Math.random() - 0.5).slice(0, lessons.length ? 10 : 15)) {
    const distract = allCards.filter(x => x.uk !== c.uk).sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.uk);
    if (Math.random() < 0.5) qs.push({ type: 'choice', prompt: c.en, audio: c.en, options: [c.uk, ...distract].sort(() => Math.random() - 0.5), answer: c.uk, mistakeType: 'vocabulary', instruction: 'Що означає?' });
    else qs.push({ type: 'input', prompt: `${c.uk}`, answer: [c.en], mistakeType: 'vocabulary', instruction: 'Напишіть англійською' });
  }
  for (const p of lessons.slice(0, 5)) {
    try { const l = await loadLesson(p.id); qs.push(...l.exercises.sort(() => Math.random() - 0.5).slice(0, 2).map(e => ({ ...e, mistakeType: l.mistakeType }))); } catch { /* */ }
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
      store.put('tests', { type: 'weekly', ref: dayKey(), scores: { score }, details: results.map(r => ({ ok: r.ok })) });
      timer.poke(); timer.stop();
      view.replaceChildren(h('div.stack-lg',
        h('div.hero', emo(score >= 80 ? 'trophy' : 'thumbsup', 'xl'), h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, `${score}%`), h('p.dim', 'Тижневий тест')),
        resultList(results), h('a.btn.primary.block', { href: '#/tests' }, 'До тестів')));
    },
  });
}

