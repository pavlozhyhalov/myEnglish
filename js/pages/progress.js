// Прогрес: стрік, час, графіки, слова, уроки, рівні, помилки
import { h, ic, emo, fmtMin, progress as bar } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { grammarIndex } from '../data.js';
import { LEVEL_NAME, myLevel, nextLevel, levelProgress, setLevel, READY_PCT } from '../level.js';
import { toast } from '../ui/toast.js';
import { md } from '../ui/md.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { streak, lastNDays, totalSeconds, weekSeconds, todaySeconds, skillLevels, MISTAKE_TYPES, week as weekDays, secondsByDay, dayKey } from '../stats.js';

export default async function progressPage(view) {
  // лічильники карток і опанування рівня вантажать лише колоди потрібних рівнів (спільний кеш data.js)
  const gP = grammarIndex();
  const [c, gIdx, lp] = await Promise.all([srs.counts(), gP, gP.then(g => levelProgress(g))]);
  const lvl = myLevel();
  const days = lastNDays(30);
  const maxSec = Math.max(60, ...days.map(d => d.seconds));
  const fc = srs.forecast(7);
  const maxFc = Math.max(1, ...fc);
  const done = gIdx.filter(l => store.get('lessons_progress', l.id)?.completed_at).length;
  const skills = skillLevels();
  const tests = store.all('tests').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  // динаміка помилок: цей тиждень vs попередній
  const now = Date.now();
  const dyn = MISTAKE_TYPES.map(t => {
    const ms = store.all('mistakes').filter(m => m.type === t);
    // нові помилки за тиждень (за датою появи, а не останньої зміни — правильна відповідь не «погіршує» тренд)
    const born = (m) => Date.parse(m.created_at || m.updated_at);
    const w1 = ms.filter(m => now - born(m) < 7 * 864e5).length;
    const w2 = ms.filter(m => { const d = now - born(m); return d >= 7 * 864e5 && d < 14 * 864e5; }).length;
    return { t, total: ms.reduce((a, m) => a + (m.count || 1), 0), open: ms.filter(m => !m.resolved).length, w1, w2 };
  }).filter(x => x.total).sort((a, b) => b.total - a.total);
  const byType = {};
  for (const s of store.all('sessions')) byType[s.type] = (byType[s.type] || 0) + s.seconds;

  const stat = (v, label) => h('div.stat', h('b', String(v)), h('span', label));
  const dayLbl = (d) => d.date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

  view.replaceChildren(h('div.stack-lg',
    h('section.card.row', emo('fire', 'xl'),
      h('div.grow', h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, String(streak())), h('div.small.dim', `${plural(streak(), 'день', 'дні', 'днів')} поспіль`)),
      h('div.stat', { style: { textAlign: 'right' } }, h('b', fmtMin(totalSeconds())), h('span', 'всього практики'))),

    weeklyCard(),

    h('section.card.stack',
      h('div.row', h('div.section-title.grow', 'Хвилини за 30 днів'), h('span.xs.dim', `мета ${store.settings().dailyGoal} хв`)),
      h('div.bars', { role: 'img', 'aria-label': 'Хвилини практики по днях' }, days.map(d => h('i' + (d.seconds ? '' : '.zero'), { style: { height: `${Math.max(2, d.seconds / maxSec * 100)}%` }, title: `${dayLbl(d)}: ${fmtMin(d.seconds)}` }))),
      h('div.bars-labels', h('span', dayLbl(days[0])), h('span', dayLbl(days[15])), h('span', 'сьогодні')),
      days.some(d => d.seconds) ? null : h('div.xs.dim', 'Ще немає даних — графік заповниться після перших занять.'),
      h('div.chips', Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, s]) => h('span.tag', `${S.sessionTypes[t] || t}: ${fmtMin(s)}`)))),

    h('section.card.stack',
      h('div.section-title', 'Час навчання'),
      h('div.grid3', stat(fmtMin(todaySeconds()), 'сьогодні'), stat(fmtMin(weekSeconds()), 'за 7 днів'), stat(fmtMin(Math.round(days.reduce((a, d) => a + d.seconds, 0) / Math.max(1, days.filter(d => d.seconds).length))), 'у середньому за активний день')),
      store.prof().resonance ? h('div.xs.dim', 'Час автоматично додається в Resonance (Мови → English)') : null),

    h('section.card.stack',
      h('div.section-title', 'Слова'),
      h('div.grid3', stat(c.learned, 'вивчено (інтервал ≥ 21 дн.)'), stat(c.total, 'у роботі'), stat(c.due, 'до повтору зараз')),
      h('div.section-title', 'Прогноз повторів на 7 днів'),
      h('div.bars', { style: { height: '80px' }, role: 'img', 'aria-label': `Прогноз повторів на 7 днів: ${fc.join(', ')}` }, fc.map(n => h('i' + (n ? '' : '.zero'), { style: { height: `${Math.max(2, n / maxFc * 100)}%` }, title: String(n) }))),
      h('div.bars-labels', fc.map((n, i) => h('span', i === 0 ? `сьог. ${n}` : String(n)))),
      fc.some(n => n) ? null : h('div.xs.dim', 'Повторів поки не заплановано — почніть вчити картки.')),

    h('section.card.stack',
      h('div.row', h('div.level-badge', lvl), h('div.grow', h('div.section-title', `Рівень ${lvl} · ${LEVEL_NAME[lvl]}`), h('div.xs.dim', `Опановано ${lp.pct}% · перехід від ${READY_PCT}%`))),
      bar(lp.pct, 'Опанування рівня'),
      h('div.grid2', stat(`${lp.grammar.done}/${lp.grammar.total}`, `уроків граматики ${lvl}`), stat(`${lp.words.done}/${lp.words.total}`, `слів ${lvl} закріплено`)),
      h('div.xs.dim', 'Слово вважається закріпленим для рівня, коли інтервал повтору сягає 7 днів. Рахуються уроки й колоди саме цього рівня.'),
      lp.ready ? h('button.btn.primary.block', { type: 'button', onclick: () => { const n = nextLevel(); setLevel(n, 'progress'); toast(`Рівень ${n}: план і завдання оновлено`); progressPage(view); } }, `Перейти на ${nextLevel()}`) : null,
      h('a.btn.soft.block', { href: '#/tests/placement' }, 'Перевірити рівень тестом')),

    h('section.card.stack',
      h('div.section-title', 'Рівень за навичками'),
      h('div.grid2', Object.entries({ grammar: 'Граматика', vocabulary: 'Лексика', listening: 'Аудіювання', speaking: 'Говоріння' }).map(([k, t]) => stat(skills[k] || '—', t))),
      h('div.xs.dim', 'За останнім тестом на рівень і розмовами із вчителем')),

    h('section.card.stack',
      h('div.section-title', 'Граматика'),
      h('div.row', h('div.grow', bar(done / gIdx.length * 100, 'Пройдено уроків граматики')), h('span.small', `${done}/${gIdx.length}`)),
      tests.length ? h('div.stack', { style: { gap: '4px' } }, h('div.section-title', 'Останні тести'), tests.map(t => h('div.row.small', h('span.grow', t.type === 'placement' ? 'Рівень' : t.type === 'weekly' ? 'Тижневий' : `Урок: ${t.ref}`), h('span.dim', new Date(t.created_at).toLocaleDateString('uk-UA')), h('b', t.type === 'placement' ? t.scores.overall : `${t.scores.score}%`)))) : null),

    h('section.card.stack',
      h('div.section-title', 'Типи помилок і динаміка'),
      dyn.length ? dyn.map(d => h('div.row',
        h('div.grow', h('div', S.mistakeTypes[d.t]), h('div.xs.dim', `усього: ${d.total} · відкритих: ${d.open}`)),
        h('span.tag' + (d.w1 < d.w2 ? '.good' : d.w1 > d.w2 ? '.bad' : ''), `тиждень: ${d.w1} ${d.w1 < d.w2 ? '↓' : d.w1 > d.w2 ? '↑' : '='}`))) : h('div.small.dim', 'Даних поки немає')),
    h('p.xs.dim.center', `${store.count('reviews')} ${plural(store.count('reviews'), 'оцінка', 'оцінки', 'оцінок')} карток у журналі на пристрої`)));
}

// ---------- Тиждень: локальна статистика + порада вчителя (раз на ISO-тиждень) ----------
/** ISO-тиждень: «2026-W44» (тиждень з четвергом визначає рік) */
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

/** Статистика за проміжок днів [fromKey, toKey] (ключі YYYY-MM-DD, локальний час) */
export function periodStats(fromKey, toKey) {
  const inDay = (iso) => { if (!iso) return false; const k = dayKey(new Date(iso)); return k >= fromKey && k <= toKey; };
  const byDay = secondsByDay();
  const sessions = store.all('sessions').filter(x => x.day >= fromKey && x.day <= toKey);
  const byType = {};
  for (const x of sessions) byType[x.type] = (byType[x.type] || 0) + (x.seconds || 0);
  const ms = store.all('mistakes');
  const chats = store.all('tutor_chats').filter(c => inDay(c.created_at));
  return {
    seconds: sessions.reduce((a, x) => a + (x.seconds || 0), 0),
    byDay, byType,
    reviews: store.all('reviews').filter(r => inDay(r.ts)).length,
    lessonsDone: store.all('lessons_progress').filter(l => inDay(l.completed_at)).length,
    lessonsPractised: store.all('lessons_progress').filter(l => inDay(l.updated_at)).length,
    mistakesAdded: ms.filter(m => inDay(m.created_at)).length,
    mistakesFixed: ms.filter(m => m.resolved && inDay(m.updated_at)).length,
    openMistakes: ms.filter(m => !m.resolved).length,
    diary: chats.filter(c => c.mode === 'diary').length,
    chats: chats.filter(c => c.mode !== 'diary').length,
  };
}

const keyShift = (days) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return dayKey(d); };

/** Компактне зведення останніх 7 днів для поради вчителя (сервер обрізає й перевіряє поля) */
function adviceStats() {
  const from = keyShift(-6), to = keyShift(0);
  const p = periodStats(from, to), prev = periodStats(keyShift(-13), keyShift(-7));
  const days = Array.from({ length: 7 }, (_, i) => Math.round((p.byDay.get(keyShift(i - 6)) || 0) / 60));
  const top = store.all('mistakes').filter(m => !m.resolved).sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 6)
    .map(m => ({ wrong: m.wrong, right: m.right, type: m.type, count: m.count || 1 }));
  return {
    minutes_by_day: days, total_minutes: Math.round(p.seconds / 60), prev_week_minutes: Math.round(prev.seconds / 60), daily_goal_minutes: store.settings().dailyGoal,
    cards_reviewed: p.reviews, lessons_completed: p.lessonsDone, lessons_practised: p.lessonsPractised,
    mistakes_added: p.mistakesAdded, mistakes_fixed: p.mistakesFixed, open_mistakes: p.openMistakes,
    streak_days: streak(), diary_entries: p.diary, tutor_chats: p.chats,
    time_by_activity: Object.fromEntries(Object.entries(p.byType).map(([k, v]) => [k, Math.round(v / 60)])),
    top_mistakes: top,
  };
}

function weeklyCard() {
  const days = weekDays();
  const p = periodStats(days[0].key, days[6].key);
  // для порівняння — ті самі дні минулого тижня (Пн … той самий день)
  const prev = periodStats(keyShift(-7 - days.findIndex(d => d.today)), keyShift(-7));
  const sec = days.map(d => p.byDay.get(d.key) || 0);
  const max = Math.max(60, ...sec);
  const min = Math.round(p.seconds / 60), prevMin = Math.round(prev.seconds / 60);
  const range = `${new Date(days[0].key + 'T12:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} – ${new Date(days[6].key + 'T12:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`;
  const stat = (v, label) => h('div.stat', h('b', String(v)), h('span', label));
  const trend = prevMin || min ? (min > prevMin ? `↑ на ${min - prevMin} хв` : min < prevMin ? `↓ на ${prevMin - min} хв` : 'як минулого тижня') : '';
  const advice = h('div.stack', { style: { gap: '8px' } });

  const card = h('section.card.stack',
    h('div.row', h('div.section-title.grow', 'Тиждень'), h('span.xs.dim', range)),
    h('div.bars', { style: { height: '80px' }, role: 'img', 'aria-label': `Хвилини по днях цього тижня: ${days.map((d, i) => `${d.name} ${Math.round(sec[i] / 60)}`).join(', ')}` },
      days.map((d, i) => h('i' + (sec[i] ? '' : '.zero'), { style: { height: `${Math.max(2, sec[i] / max * 100)}%`, opacity: d.future ? 0.35 : null }, title: `${d.name}: ${fmtMin(sec[i])}` }))),
    h('div.bars-labels', days.map((d, i) => h('span', { style: d.today ? { fontWeight: 700, color: 'var(--ink)' } : null }, sec[i] ? `${d.name} ${Math.round(sec[i] / 60)}` : d.name))),
    h('div.grid3', stat(`${min} хв`, trend ? `практики · ${trend}` : 'практики'), stat(p.reviews, 'карток повторено'), stat(p.lessonsDone, plural(p.lessonsDone, 'урок пройдено', 'уроки пройдено', 'уроків пройдено'))),
    h('div.grid3', stat(p.mistakesAdded, 'нових помилок'), stat(p.mistakesFixed, 'помилок виправлено'), stat(streak(), `${plural(streak(), 'день', 'дні', 'днів')} поспіль`)),
    p.diary || p.chats ? h('div.xs.dim', [p.diary ? `Записів у щоденнику: ${p.diary}` : '', p.chats ? `розмов із вчителем: ${p.chats}` : ''].filter(Boolean).join(' · ')) : null,
    advice);

  const cached = () => { const w = store.prof().weeklyTip; return w && w.week === isoWeek() && w.data ? w : null; };
  let busy = false;
  const drawAdvice = (state = '') => {
    const c = cached();
    const head = h('div.row', emo('teacher'), h('div.section-title.grow', 'Порада вчителя на тиждень'));
    if (!user()) { advice.replaceChildren(head, h('div.small.dim', 'Порада з\'явиться після входу: вчитель подивиться на ваш тиждень і помилки.')); return; }
    if (busy) { advice.replaceChildren(head, h('div.small.dim', { role: 'status' }, 'Вчитель дивиться на ваш тиждень…')); return; }
    if (!c) {
      advice.replaceChildren(head, state ? h('div.small.bad', state) : h('div.small.dim', 'Коротка порада за останні 7 днів: що вийшло і на чому зосередитися.'),
        h('button.btn.soft.block', { type: 'button', onclick: () => generate() }, ic('sparkle', { fill: true }), 'Отримати пораду'));
      return;
    }
    const d = c.data;
    advice.replaceChildren(head,
      d.summary_uk ? md(d.summary_uk) : null,
      d.tips?.length ? h('ol.small', { style: { margin: 0, paddingLeft: '20px' } }, d.tips.map(t => h('li', { style: { marginBottom: '4px' } }, t))) : null,
      d.goal_uk ? h('div.feedback.ok', h('b', 'Мета: '), d.goal_uk) : null,
      d.focus_en ? h('div.small', h('span.dim', 'Приклад: '), h('i', { lang: 'en' }, d.focus_en)) : null,
      state ? h('div.xs.bad', state) : null,
      h('div.row', h('span.xs.dim.grow', `Згенеровано ${new Date(c.at).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })}`),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => generate() }, ic('arrow-clockwise', { size: 16 }), 'Оновити')));
  };
  async function generate() {
    if (busy) return;
    busy = true; drawAdvice();
    try {
      const data = await tutor('weekly', { stats: adviceStats() });
      store.setProf({ weeklyTip: { week: isoWeek(), at: new Date().toISOString(), data } });
      busy = false; if (card.isConnected) drawAdvice();
    } catch (e) {
      busy = false; if (card.isConnected) drawAdvice(aiErrorText(e) || '');
    }
  }
  drawAdvice();
  // раз на тиждень — автоматично, якщо є що аналізувати (і є вхід та мережа)
  const last7 = () => { const q = periodStats(keyShift(-6), keyShift(0)); return q.seconds || q.reviews || q.mistakesAdded || q.lessonsPractised || q.diary || q.chats; };
  // автоспроба — не частіше раз на день: якщо генерація впала, кожне відкриття сторінки не має знову витрачати ліміт
  const TRIED = 'me:weekly-tried', todayKey = new Date().toDateString();
  let tried = null; try { tried = localStorage.getItem(TRIED); } catch { /* недоступно */ }
  if (user() && navigator.onLine && !cached() && last7() && tried !== todayKey) {
    try { localStorage.setItem(TRIED, todayKey); } catch { /* недоступно */ }
    setTimeout(() => { if (card.isConnected) generate(); }, 0);
  }
  return card;
}
