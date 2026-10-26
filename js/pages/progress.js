// Прогрес: стрік, час, графіки, слова, уроки, рівні, помилки
import { h, emo, fmtMin, progress as bar } from '../ui/dom.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { grammarIndex } from '../data.js';
import { LEVEL_NAME, myLevel, nextLevel, levelProgress, setLevel, READY_PCT } from '../level.js';
import { toast } from '../ui/toast.js';
import { streak, lastNDays, totalSeconds, weekSeconds, todaySeconds, skillLevels, MISTAKE_TYPES } from '../stats.js';

export default async function progressPage(view) {
  const [c, gIdx] = await Promise.all([srs.counts(), grammarIndex()]);
  const lp = await levelProgress(gIdx);
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
    const w1 = ms.filter(m => now - Date.parse(m.updated_at) < 7 * 864e5).length;
    const w2 = ms.filter(m => { const d = now - Date.parse(m.updated_at); return d >= 7 * 864e5 && d < 14 * 864e5; }).length;
    return { t, total: ms.reduce((a, m) => a + (m.count || 1), 0), open: ms.filter(m => !m.resolved).length, w1, w2 };
  }).filter(x => x.total).sort((a, b) => b.total - a.total);
  const byType = {};
  for (const s of store.all('sessions')) byType[s.type] = (byType[s.type] || 0) + s.seconds;

  const stat = (v, label) => h('div.stat', h('b', String(v)), h('span', label));
  const dayLbl = (d) => d.date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

  view.replaceChildren(h('div.stack-lg',
    h('section.card.row', emo('fire', 'xl'),
      h('div.grow', h('div.num', { style: { fontSize: 'var(--fs-2xl)' } }, String(streak())), h('div.small.dim', 'днів поспіль')),
      h('div.stat', { style: { textAlign: 'right' } }, h('b', fmtMin(totalSeconds())), h('span', 'всього практики'))),

    h('section.card.stack',
      h('div.row', h('div.section-title.grow', 'Хвилини за 30 днів'), h('span.xs.dim', `мета ${store.settings().dailyGoal} хв`)),
      h('div.bars', { role: 'img', 'aria-label': 'Хвилини практики по днях' }, days.map(d => h('i' + (d.seconds ? '' : '.zero'), { style: { height: `${Math.max(2, d.seconds / maxSec * 100)}%` }, title: `${dayLbl(d)}: ${fmtMin(d.seconds)}` }))),
      h('div.bars-labels', h('span', dayLbl(days[0])), h('span', dayLbl(days[15])), h('span', 'сьогодні')),
      days.some(d => d.seconds) ? null : h('div.xs.dim', 'Ще немає даних — графік заповниться після перших занять.'),
      h('div.chips', Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, s]) => h('span.tag', `${S.sessionTypes[t] || t}: ${fmtMin(s)}`)))),

    h('section.card.stack',
      h('div.section-title', 'Час навчання'),
      h('div.grid3', stat(fmtMin(todaySeconds()), 'сьогодні'), stat(fmtMin(weekSeconds()), 'за 7 днів'), stat(fmtMin(Math.round(days.reduce((a, d) => a + d.seconds, 0) / Math.max(1, days.filter(d => d.seconds).length))), 'у середньому за активний день')),
      h('div.xs.dim', 'Час автоматично додається в Resonance (Мови → English)')),

    h('section.card.stack',
      h('div.section-title', 'Слова'),
      h('div.grid3', stat(c.learned, 'вивчено (стабільність ≥ 21 дн)'), stat(c.total, 'карток у роботі'), stat(c.due, 'до повтору зараз')),
      h('div.section-title', 'Прогноз повторів на 7 днів'),
      h('div.bars', { style: { height: '80px' } }, fc.map(n => h('i' + (n ? '' : '.zero'), { style: { height: `${Math.max(2, n / maxFc * 100)}%` }, title: String(n) }))),
      h('div.bars-labels', fc.map((n, i) => h('span', i === 0 ? `сьог. ${n}` : String(n)))),
      fc.some(n => n) ? null : h('div.xs.dim', 'Повторів поки не заплановано — почніть вчити картки.')),

    h('section.card.stack',
      h('div.row', h('div.level-badge', lvl), h('div.grow', h('div.section-title', `Рівень ${lvl} · ${LEVEL_NAME[lvl]}`), h('div.xs.dim', `Опановано ${lp.pct}% · перехід від ${READY_PCT}%`))),
      bar(lp.pct),
      h('div.grid2', stat(`${lp.grammar.done}/${lp.grammar.total}`, `уроків граматики ${lvl}`), stat(`${lp.words.done}/${lp.words.total}`, `слів ${lvl} закріплено`)),
      h('div.xs.dim', 'Слово закріплене, коли його інтервал повтору досяг 7 днів. Рахуються уроки й колоди саме цього рівня.'),
      lp.ready ? h('button.btn.primary.block', { type: 'button', onclick: () => { const n = nextLevel(); setLevel(n, 'progress'); toast(`Рівень ${n}: план і контент оновлено`); progressPage(view); } }, `Перейти на ${nextLevel()}`) : null,
      h('a.btn.soft.block', { href: '#/tests/placement' }, 'Перевірити рівень тестом')),

    h('section.card.stack',
      h('div.section-title', 'Рівень за навичками'),
      h('div.grid2', Object.entries({ grammar: 'Граматика', vocabulary: 'Лексика', listening: 'Аудіювання', speaking: 'Говоріння' }).map(([k, t]) => stat(skills[k] || '—', t))),
      h('div.xs.dim', 'За останнім тестом на рівень і сигналами з розмов з вчителем')),

    h('section.card.stack',
      h('div.section-title', 'Граматика'),
      h('div.row', h('div.grow', bar(done / gIdx.length * 100)), h('span.small', `${done}/${gIdx.length}`)),
      tests.length ? h('div.stack', { style: { gap: '4px' } }, h('div.section-title', 'Останні тести'), tests.map(t => h('div.row.small', h('span.grow', t.type === 'placement' ? 'Рівень' : t.type === 'weekly' ? 'Тижневий' : `Урок: ${t.ref}`), h('span.dim', new Date(t.created_at).toLocaleDateString('uk-UA')), h('b', t.type === 'placement' ? t.scores.overall : `${t.scores.score}%`)))) : null),

    h('section.card.stack',
      h('div.section-title', 'Типи помилок і динаміка'),
      dyn.length ? dyn.map(d => h('div.row',
        h('div.grow', h('div', S.mistakeTypes[d.t]), h('div.xs.dim', `${d.total} всього · ${d.open} відкритих`)),
        h('span.tag' + (d.w1 < d.w2 ? '.good' : d.w1 > d.w2 ? '.bad' : ''), `тиждень: ${d.w1} ${d.w1 < d.w2 ? '↓' : d.w1 > d.w2 ? '↑' : '='}`))) : h('div.small.dim', 'Даних поки немає')),
    h('p.xs.dim.center', `${store.count('reviews')} ${plural(store.count('reviews'), 'оцінка', 'оцінки', 'оцінок')} карток у журналі на пристрої`)));
}
