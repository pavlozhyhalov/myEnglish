// Прогрес: стрік, час, графіки, слова, уроки, рівні, помилки
import { h, ic, fmtMin, progress as bar } from '../ui/dom.js';
import { tx, txPrimary, txKpis, txGroup, txRow, txRows, txLogin, txBar, txResult } from '../ui/tiles.js';
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

  // «Запитати вчителя про це» → консультація (режим coach) про відповідний розділ
  const ask = (sec) => h('a.tx-row.tx-ask', { href: `#/tutor?mode=coach&section=${sec}` }, h('span.tx-sq', ic('chat-circle-dots', { size: 18 })), h('span.tx-body', h('span.tx-l', 'Запитати вчителя про це')), ic('caret-right', { size: 16 }));
  const dayLbl = (d) => d.date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  const card = (...kids) => h('section.card.stack.tx-card', ...kids);
  const st = streak();
  const avg = Math.round(days.reduce((a, d) => a + d.seconds, 0) / Math.max(1, days.filter(d => d.seconds).length));
  const SKILLS = { grammar: 'Граматика', vocabulary: 'Лексика', reading: 'Читання', listening: 'Аудіювання', writing: 'Письмо', speaking: 'Говоріння' };
  const testLabel = (t) => t.type === 'placement' ? 'Тест рівня' : t.type === 'weekly' ? 'Тижневий тест' : `Урок: ${gIdx.find(l => l.id === t.ref)?.title || t.ref}`;
  const testTone = (t) => { if (t.type === 'placement') return 'accent'; const v = t.scores.score; return v >= 80 ? 'good' : v < 60 ? 'bad' : 'warn'; };
  const openMk = dyn.reduce((a, d) => a + d.open, 0);
  const nReviews = store.count('reviews');
  const LV = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const weakest = Object.keys(SKILLS).filter(k => LV.includes(skills[k])).sort((a, b) => LV.indexOf(skills[a]) - LV.indexOf(skills[b]))[0];

  // ще не було жодного заняття — замість рядів нулів один спокійний порожній стан (2026-11-08)
  const fresh = totalSeconds() === 0 && !store.count('reviews');
  view.replaceChildren(h('div.stack-lg.pg-page',
    fresh ? h('div.stack.pg-fresh',
      txResultFresh(),
      txPrimary({ icon: 'play', label: 'Почати мій день', sub: 'слова → правила → розмова', href: '#/today' })) : null,
    fresh ? null : txKpis([
      { value: st, label: `${plural(st, 'день', 'дні', 'днів')} поспіль`, tone: st ? 'accent' : '', ariaLabel: `Стрік: ${st} ${plural(st, 'день', 'дні', 'днів')} поспіль` },
      { value: fmtMin(weekSeconds()), label: 'за 7 днів' },
      { value: fmtMin(totalSeconds()), label: 'всього практики' },
    ]),

    // «Аналіз» і «Звіт» — вкладки над сторінкою (js/ui/subnav.js)
    fresh ? null : weeklyCard(),

    txGroup(`Рівень ${lvl} · ${LEVEL_NAME[lvl]}`, [
      card(
        h('div.row', h('div.level-badge', lvl), h('div.grow', h('div.pg-strong', `Опановано ${lp.pct}%`), h('div.xs.dim', `перехід від ${READY_PCT}% · уроки й слова рівня ${lvl}`))),
        bar(lp.pct, 'Опанування рівня')),
      txKpis([{ value: `${lp.grammar.done}/${lp.grammar.total}`, label: `уроків граматики ${lvl}` }, { value: `${lp.words.done}/${lp.words.total}`, label: `слів ${lvl} закріплено` }], 2),
      lp.ready ? txPrimary({ icon: 'rocket-launch', label: `Перейти на ${nextLevel()}`, sub: 'план і завдання оновляться', onclick: () => { const n = nextLevel(); setLevel(n, 'progress'); toast(`Рівень ${n}: план і завдання оновлено`); progressPage(view); } }) : null]),

    txGroup('Слова й граматика', [
      fresh ? null : txKpis([{ value: c.learned, label: 'слів вивчено', tone: c.learned ? 'good' : '' }, { value: c.total, label: 'у роботі' }, { value: c.due, label: 'до повтору зараз', tone: c.due ? 'warn' : '', href: c.due ? '#/cards/review' : null }]),
      tx({ wide: true, icon: 'puzzle-piece', label: 'Уроки граматики', sub: `пройдено ${done} з ${gIdx.length}`, href: '#/grammar', cls: 'pg-gram', extra: txBar(gIdx.length ? done / gIdx.length : 0) })]),

    txGroup('Детальніше', h('div.pg-folds',
      fold({ icon: 'clock', label: 'Хвилини за 30 днів', sub: `у середньому ${fmtMin(avg)} за активний день · мета ${store.settings().dailyGoal} хв` },
        days.some(d => d.seconds) ? card(
          h('div.bars', { role: 'img', 'aria-label': 'Хвилини практики по днях' }, days.map(d => h('i' + (d.seconds ? '' : '.zero'), { style: { height: `${Math.max(2, d.seconds / maxSec * 100)}%` }, title: `${dayLbl(d)}: ${fmtMin(d.seconds)}` }))),
          h('div.bars-labels', h('span', dayLbl(days[0])), h('span', dayLbl(days[15])), h('span', 'сьогодні')))
          : h('div.small.dim', 'Графік заповниться після перших занять'),
        txKpis([{ value: fmtMin(todaySeconds()), label: 'сьогодні' }, { value: fmtMin(avg), label: 'за активний день' }, { value: days.filter(d => d.seconds).length, label: 'активних днів з 30' }]),
        Object.keys(byType).length ? h('div.chips', Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, s]) => h('span.tag', `${S.sessionTypes[t] || t}: ${fmtMin(s)}`))) : null,
        store.prof().resonance ? h('div.xs.dim', 'Час автоматично додається в Resonance (Мови → English)') : null),
      fold({ icon: 'calendar-blank', label: 'Прогноз повторів', sub: `на 7 днів: ${fc.reduce((a, n) => a + n, 0)} ${plural(fc.reduce((a, n) => a + n, 0), 'картка', 'картки', 'карток')}` },
        card(
          h('div.bars', { style: { height: '80px' }, role: 'img', 'aria-label': `Прогноз повторів на 7 днів: ${fc.join(', ')}` }, fc.map(n => h('i' + (n ? '' : '.zero'), { style: { height: `${Math.max(2, n / maxFc * 100)}%` }, title: String(n) }))),
          h('div.bars-labels', fc.map((n, i) => h('span', i === 0 ? `сьог. ${n}` : String(n))))),
        h('div.xs.dim', `Вивчене слово — інтервал повтору ≥ 21 дн. · ${nReviews} ${plural(nReviews, 'оцінка', 'оцінки', 'оцінок')} карток на пристрої`),
        ask('vocabulary')),
      fold({ icon: 'target', label: 'Рівень за навичками', sub: weakest ? `найслабша — ${SKILLS[weakest].toLowerCase()} ${skills[weakest]}` : 'за тестом рівня й розмовами' },
        txKpis(Object.entries(SKILLS).map(([k, t]) => ({ value: skills[k] || '—', label: t, tone: skills[k] ? 'accent' : '' }))),
        tx({ icon: 'exam', label: 'Перевірити рівень тестом', sub: 'граматика, лексика, читання, аудіювання, письмо', href: '#/tests/placement', wide: true }),
        ask('placement')),
      tests.length ? fold({ icon: 'exam', label: 'Останні тести', sub: `${testLabel(tests[0])} · ${tests[0].type === 'placement' ? tests[0].scores.overall : `${tests[0].scores.score}%`}` },
        txRows(tests.map(t => txRow({ icon: t.type === 'placement' ? 'target' : t.type === 'weekly' ? 'calendar-blank' : 'exam', label: testLabel(t), sub: new Date(t.created_at).toLocaleDateString('uk-UA'),
          pill: { text: t.type === 'placement' ? t.scores.overall : `${t.scores.score}%`, tone: testTone(t) } }))),
        ask('grammar')) : null,
      dyn.length ? fold({ icon: 'warning-circle', label: 'Помилки за типами', sub: `відкритих: ${openMk} · динаміка за тиждень` },
        txRows(dyn.map(d => txRow({ icon: 'warning-circle', label: S.mistakeTypes[d.t], sub: `разом із повторами: ${d.total} · відкритих: ${d.open}`,
          pill: { text: `тиждень: ${d.w1} ${d.w1 < d.w2 ? '↓' : d.w1 > d.w2 ? '↑' : '='}`, tone: d.w1 < d.w2 ? 'good' : d.w1 > d.w2 ? 'bad' : '' } }))),
        ask('mistakes')) : null))));
}

const txResultFresh = () => txResult({ icon: 'chart-line-up', tone: 'accent', label: 'Прогрес', title: 'Тут з\'явиться ваш прогрес', sub: 'Хвилини, стрік, слова й рівень — після першого заняття' });

/** Згорнута плитка-розділ: рядок з іконкою, підписом і стрілкою; вміст — під ним */
export function fold(o, ...content) {
  return h('details.pg-fold', o.open ? { open: true } : null,
    h('summary', h('span.tx-sq', ic(o.icon, { size: 18 })), h('span.tx-body', h('span.tx-l', o.label), o.sub ? h('span.tx-s', o.sub) : null), o.pill || null),
    h('div.pg-fold-b', ...content.flat().filter(Boolean)));
}

/** Група з підписом і вузлом праворуч (діапазон дат, мета) */
function labelRow(label, right, ...content) {
  return h('section.tx-group', h('div.tx-label-row', h('h2.tx-label', label), right), ...content);
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
    chats: chats.filter(c => c.mode !== 'diary' && c.mode !== 'coach').length,
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
  const trend = prevMin || min ? (min > prevMin ? `↑ на ${min - prevMin} хв` : min < prevMin ? `↓ на ${prevMin - min} хв` : 'як минулого тижня') : '';
  const advice = h('div.stack.pg-adv');
  const empty = !sec.some(Boolean);

  const card = labelRow('Тиждень', h('span.xs.dim', trend ? `${min} хв · ${trend}` : range),
    empty ? tx({ wide: true, icon: 'chart-line-up', label: 'Цього тижня ще немає занять', sub: 'Хвилини по днях з\'являться тут після першого заняття', cls: 'pg-empty' }) : h('div.card.stack.tx-card',
      h('div.bars', { style: { height: '80px' }, role: 'img', 'aria-label': `Хвилини по днях цього тижня: ${days.map((d, i) => `${d.name} ${Math.round(sec[i] / 60)}`).join(', ')}` },
        days.map((d, i) => h('i' + (sec[i] ? '' : '.zero'), { style: { height: `${Math.max(2, sec[i] / max * 100)}%`, opacity: d.future ? 0.35 : null }, title: `${d.name}: ${fmtMin(sec[i])}` }))),
      h('div.bars-labels', days.map((d, i) => h('span', { style: d.today ? { fontWeight: 700, color: 'var(--ink)' } : null }, sec[i] ? `${d.name} ${Math.round(sec[i] / 60)}` : d.name)))),
    empty ? null : txKpis([
      { value: p.reviews, label: 'карток повторено' },
      { value: p.lessonsDone, label: plural(p.lessonsDone, 'урок пройдено', 'уроки пройдено', 'уроків пройдено') },
      { value: p.mistakesFixed, label: 'помилок виправлено', tone: p.mistakesFixed ? 'good' : '' }]),
    advice);

  const cached = () => { const w = store.prof().weeklyTip; return w && w.week === isoWeek() && w.data ? w : null; };
  let busy = false;
  const drawAdvice = (state = '') => {
    const c = cached();
    if (!user()) { advice.replaceChildren(empty ? '' : txLogin('Порада на тиждень — після входу', 'Вчитель подивиться на ваш тиждень і помилки')); return; }
    if (busy) { advice.replaceChildren(tx({ wide: true, icon: 'hourglass', label: 'Вчитель дивиться на ваш тиждень…', attrs: { role: 'status' } })); return; }
    if (!c) {
      advice.replaceChildren(tx({ icon: 'sparkle', label: 'Отримати пораду', sub: 'Що вийшло за 7 днів і на чому зосередитися', onclick: () => generate(), wide: true }),
        state ? txRow({ icon: 'warning-circle', label: 'Не вдалося отримати пораду', sub: state, pill: { text: 'Помилка', tone: 'warn' } }) : null);
      return;
    }
    const d = c.data;
    advice.replaceChildren(h('div.gx-card.stack.pg-adv-c',
      d.summary_uk ? md(d.summary_uk) : null,
      d.tips?.length ? h('ol.small', { style: { margin: 0, paddingLeft: '20px' } }, d.tips.map(t => h('li', { style: { marginBottom: '4px' } }, t))) : null,
      d.goal_uk ? h('div.feedback.ok', h('b', 'Мета: '), d.goal_uk) : null,
      d.focus_en ? h('div.small', h('span.dim', 'Приклад: '), h('i', { lang: 'en' }, d.focus_en)) : null,
      state ? h('div.xs.bad', state) : null,
      h('div.row', h('span.xs.dim.grow', `Згенеровано ${new Date(c.at).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })}`),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => generate() }, ic('arrow-clockwise', { size: 16 }), 'Оновити'))));
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
