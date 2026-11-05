// Аналіз: чесна картина навчання з локальних даних (без AI) + глибокий аналіз від вчителя (дія tutor 'analysis')
// і вхід у «Консультацію» (режим вчителя 'coach') з кожного розділу.
import { h, ic } from '../ui/dom.js';
import { tx, txPrimary, txKpis, txRow, txRows } from '../ui/tiles.js';
import { S, plural } from '../strings.js';
import * as store from '../store.js';
import { md, mdInline } from '../ui/md.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { grammarIndex, json, scenarios as loadScenarios } from '../data.js';
import { LEVELS, LEVEL_NAME } from '../level.js';
import { compute, insight, digest, digestHash, activityHref, ACTIVITY, CRIT, CRIT_UK, SKILL_UK, speechLines } from '../analysis.js';

const DAY = 864e5;
const rk = (l) => LEVELS.indexOf(l);
const num = (x) => String(x).replace('.', ',');
const coachHref = (sec) => `#/tutor?mode=coach&section=${encodeURIComponent(sec)}`;
/** Показник-плитка: значення, підпис, тон (лише для стану) */
const stat = (value, label, tone = '') => ({ value, label, tone });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

export default async function analysisPage(view) {
  const A = await compute();

  // одна синя дія: глибокий аналіз, поки його немає; інакше — розмова про прогрес
  const deepPrimary = !!user() && !store.prof().analysis?.data;
  // назва розділу — у шапці й вкладках (Прогрес · Аналіз · Звіт)
  view.replaceChildren(h('div.stack-lg.analysis',
    h('p.small.dim.an-lead', 'Чесна картина за вашими даними: що виходить, що стримує, що робити далі'),
    overviewCard(A, !deepPrimary),
    deepCard(A),
    section('placement', 'Рівень за навичками', 'target', A, placementBody(A)),
    section('speaking', 'Говоріння', 'chat-circle-dots', A, speakingBody(A)),
    section('speech', 'Мовлення', 'waveform', A, speechBody(A), 'speaking'),
    section('writing', 'Письмо', 'pencil-line', A, writingBody(A)),
    section('vocabulary', 'Слова', 'cards', A, vocabBody(A)),
    section('grammar', 'Граматика', 'puzzle-piece', A, grammarBody(A)),
    section('mistakes', 'Помилки', 'warning-circle', A, mistakesBody(A)),
    section('habits', 'Звички й час', 'clock', A, habitsBody(A)),
    h('p.xs.dim.center', 'Аналіз рахується на цьому пристрої з ваших карток, уроків, помилок, розмов і часу занять. Після входу дані синхронізуються між пристроями.')));
}

// ---------- Каркас розділу: заголовок, висновок одним рядком, вміст, «Запитати про це» ----------
function section(id, title, icon, A, body, coach = id) {
  const text = insight(id, A);
  return h('section.tx-group.an-sec', { 'aria-labelledby': `an-${id}` },
    h('h2.tx-label', { id: `an-${id}` }, title),
    h('div.card.stack.tx-card',
      text ? h('p.an-insight', ic(icon, { size: 18 }), h('span', text)) : null,
      body),
    askRow(coachHref(coach), `Запитати вчителя про розділ «${title}»`));
}

/** «Запитати про це» — рядок-плитка до консультації */
function askRow(href, aria, label = 'Запитати про це') {
  return h('a.tx-row.tx-ask', { href, 'aria-label': aria }, h('span.tx-sq', ic('chat-circle-dots', { size: 18 })), h('span.tx-body', h('span.tx-l', label)), ic('caret-right', { size: 16 }));
}

function overviewCard(A, primary = true) {
  const pl = A.placement, sp = A.speaking;
  const mastery = A.lp?.pct ?? null;
  const talk = { icon: 'chat-circle-dots', label: 'Поговорити про мій прогрес', sub: 'консультація з вчителем українською', href: coachHref('overview') };
  return h('section.tx-group.an-over', { 'aria-label': 'Огляд' },
    h('div.tx-row.an-lvl', h('span.level-badge', A.level), h('span.tx-body',
      h('span.tx-l', `Рівень у застосунку: ${A.level} · ${LEVEL_NAME[A.level]}`),
      h('span.tx-s', A.levelSource === 'test' ? 'визначено тестом' : A.levelSource ? 'обрано вручну або змінено' : 'рівень за замовчуванням — пройдіть тест'))),
    txKpis([
      stat(mastery != null ? `${mastery}%` : '—', `опановано ${A.level}`),
      stat(pl?.overall || '—', pl ? (pl.days > 0 ? `тест, ${pl.days} ${plural(pl.days, 'день', 'дні', 'днів')} тому` : 'тест, сьогодні') : 'тест не пройдено', pl ? 'accent' : ''),
      stat(sp.current || '—', sp.enough ? `говоріння, ${sp.enough} ${plural(sp.enough, 'оцінка', 'оцінки', 'оцінок')}` : 'говоріння: немає оцінок', sp.current ? 'accent' : '')]),
    primary ? txPrimary(talk) : tx({ ...talk, wide: true }));
}

// ---------- Глибокий аналіз від вчителя ----------
const AN_TRIED = 'me:analysis-tried';
function deepCard(A) {
  const box = h('div.card.stack.tx-card.an-deep');
  let busy = false, err = '';
  const cached = () => { const a = store.prof().analysis; return a && a.data && a.at ? a : null; };
  const ageDays = (a) => Math.floor((Date.now() - Date.parse(a.at)) / DAY);
  const sameDay = (a) => new Date(a.at).toDateString() === new Date().toDateString();
  const ctxP = Promise.all([grammarIndex().catch(() => []), json('data/reading.json').catch(() => []), loadScenarios().catch(() => [])]).then(([g, rd, sc]) => ({
    lessons: new Set(g.map(x => x.id)), scenarios: new Set(sc.map(s => s.id)), reading: new Set((Array.isArray(rd) ? rd : rd?.texts || []).map(x => x.id)),
  }));
  let ctx = { lessons: new Set(), scenarios: new Set(A.scenarios.map(s => s.id)), reading: new Set() };

  function draw() {
    const c = cached();
    if (busy) { box.replaceChildren(h('div.small.dim', { role: 'status' }, 'Вчитель вивчає ваші дані… Це займає до хвилини.')); return; }
    const bits = [];
    if (!c) bits.push(h('div.small.dim', 'Вчитель отримає стисле зведення ваших результатів (числа, тренди й до 15 прикладів помилок — без текстів розмов) і поверне чесний розбір: сильні й слабкі сторони з доказами та план на 14 днів.'));
    if (err) bits.push(h('div.small.bad', { role: 'alert' }, err));
    if (!user()) bits.push(h('div.small.dim', 'Глибокий аналіз працює після входу.'), tx({ icon: 'user', label: 'Увійти', href: '#/auth', wide: true }));
    else if (!c) bits.push(txPrimary({ icon: 'sparkle', label: 'Глибокий аналіз від вчителя', sub: 'сильні й слабкі сторони, план на 14 днів', onclick: run }));
    if (c) {
      bits.push(...result(c.data));
      const d = ageDays(c);
      const changed = c.digestHash && c.digestHash !== digestHash(digest(A));
      bits.push(h('div.row.wrap.an-meta',
        h('span.xs.dim.grow', `${d === 0 ? 'Оновлено сьогодні' : `Оновлено ${d} ${plural(d, 'день', 'дні', 'днів')} тому`}${changed && d > 0 ? ' · відтоді дані змінилися' : ''}`),
        user() ? (sameDay(c)
          ? h('span.xs.dim', 'Оновити можна завтра')
          : h('button.btn.sm.ghost', { type: 'button', onclick: run }, ic('arrow-clockwise', { size: 16 }), 'Оновити')) : null));
    }
    box.replaceChildren(...bits);
  }
  function result(d) {
    const out = [];
    const ov = d.overall || {};
    if (ov.level || ov.summary_uk) out.push(h('div.stack', { style: { gap: '6px' } },
      ov.level ? h('div.row', h('span.tag.accent', `Оцінка вчителя: ${ov.level}${ov.sublevel === 'high' ? '+' : ov.sublevel === 'low' ? '−' : ''}`), h('span.xs.dim', { low: 'нижня межа рівня', mid: 'середина рівня', high: 'верхня межа рівня' }[ov.sublevel] || '')) : null,
      ov.summary_uk ? md(ov.summary_uk) : null));
    if (d.strengths?.length) out.push(h('div.stack.an-list', h('h3.an-sub', 'Сильні сторони'),
      h('ul', d.strengths.map(s => h('li', h('b', s.point_uk), s.evidence_uk ? h('div.xs.dim', mdInline(s.evidence_uk)) : null)))));
    if (d.weaknesses?.length) out.push(h('div.stack.an-list', h('h3.an-sub', 'Що стримує'),
      d.weaknesses.map(w => h('details.an-weak', h('summary', h('b', w.area), w.evidence_uk ? h('span.xs.dim', ' · ', mdInline(w.evidence_uk)) : null),
        w.why_it_matters_uk ? h('div.small', h('span.dim', 'Чому це важливо: '), mdInline(w.why_it_matters_uk)) : null,
        w.how_to_fix_uk ? h('div.small', h('span.dim', 'Як виправити: '), mdInline(w.how_to_fix_uk)) : null))));
    if (d.plan_14_days?.length) out.push(h('div.stack.an-list', h('h3.an-sub', 'План на 14 днів'),
      h('ol.an-plan', d.plan_14_days.map(b => h('li',
        h('div', h('b', b.day_range), b.day_range && b.focus ? ' — ' : '', b.focus),
        h('div.an-acts', b.activities.map(a => {
          const href = activityHref(a.kind, a.id, ctx);
          const meta = ACTIVITY[a.kind];
          return href ? h('a.tx-row.an-act', { href }, h('span.tx-sq', ic(meta.icon, { size: 18 })), h('span.tx-body', h('span.tx-s', meta.label), h('span.tx-l.an-act-t', a.text_uk)), ic('caret-right', { size: 16 })) : null;
        })))))));
    if (d.next_level_gap_uk) out.push(h('div.feedback.ok', h('b', 'До наступного рівня: '), mdInline(d.next_level_gap_uk)));
    if (d.data_gaps_uk?.length) out.push(h('div.stack.an-list', h('h3.an-sub', 'Бракує даних'), h('ul.small', d.data_gaps_uk.map(g => h('li', g)))));
    return out;
  }
  async function run() {
    if (busy) return;
    const c = cached();
    if (c && sameDay(c)) { draw(); return; }
    busy = true; err = ''; draw();
    try {
      try { localStorage.setItem(AN_TRIED, String(Date.now())); } catch { /* недоступно */ }
      const dg = digest(A);
      const data = await tutor('analysis', { digest: dg });
      store.setProf({ analysis: { at: new Date().toISOString(), data, digestHash: digestHash(dg) } });
    } catch (e) { err = aiErrorText(e) || S.err.generic; }
    busy = false;
    if (box.isConnected) draw();
  }
  ctxP.then(x => { ctx = x; if (box.isConnected && cached()) draw(); });
  draw();
  return h('section.tx-group', { 'aria-labelledby': 'an-deep' }, h('h2.tx-label#an-deep', 'Глибокий аналіз від вчителя'), box);
}

// ---------- Розділи ----------
function emptyNote(text, href, label, icon = 'arrow-right') {
  return h('div.stack.an-empty', h('span.small.dim', text), href ? txRow({ icon, label, href }) : null);
}

function placementBody(A) {
  const p = A.placement;
  const skills = Object.entries(SKILL_UK);
  if (!p) return emptyNote('Тест покаже рівень кожної навички окремо: граматика, лексика, читання, аудіювання, письмо й говоріння.', '#/tests/placement', 'Пройти тест', 'exam');
  return h('div.stack', { style: { gap: '10px' } },
    skills.map(([k, label]) => {
      const s = p.skills[k];
      if (!s) return h('div.an-skill', h('div.row.small', h('span.grow', label), h('span.dim', 'не оцінено')));
      return h('div.an-skill',
        h('div.row.small', h('span.grow', label), h('b', s.level), s.conf ? h('span.xs.dim', s.conf) : null),
        h('div.pl-bar', { role: 'img', 'aria-label': `${label}: ${s.level}${s.conf ? `, ${s.conf}` : ''}` }, LEVELS.map((l, i) => h('i', { class: i <= rk(s.level) ? 'on' : '' }))));
    }),
    h('div.xs.dim', `Тест від ${fmtDate(p.at).replace(/\.$/, '')}. Говоріння в тесті — з короткої розмови; оцінку з довших розмов дивіться в розділі «Говоріння».`));
}

/** Лінія рівня говоріння по сесіях (A1…C1 по вертикалі), з точками й підказками */
function sparkline(sessions) {
  const W = 320, H = 96, pad = { l: 26, r: 8, t: 8, b: 8 };
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'an-spark', role: 'img', 'aria-label': `Рівень у розмовах: ${sessions.map(s => s.level).join(', ')}` });
  const y = (i) => pad.t + (H - pad.t - pad.b) * (1 - i / (LEVELS.length - 1));
  const x = (i) => pad.l + (sessions.length === 1 ? (W - pad.l - pad.r) / 2 : (W - pad.l - pad.r) * i / (sessions.length - 1));
  LEVELS.forEach((l, i) => {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(i), y2: y(i), class: 'grid' }));
    const tx = el('text', { x: 0, y: y(i) + 4, class: 'lbl' }); tx.textContent = l; svg.append(tx);
  });
  const val = (s) => rk(s.level) + (s.sublevel === 'high' ? 0.33 : s.sublevel === 'low' ? -0.33 : 0);
  if (sessions.length > 1) svg.append(el('polyline', { points: sessions.map((s, i) => `${x(i)},${y(val(s))}`).join(' '), class: 'line' }));
  sessions.forEach((s, i) => {
    const c = el('circle', { cx: x(i), cy: y(val(s)), r: 4.5, class: 'dot' });
    const tt = el('title', {}); tt.textContent = `${fmtDate(s.at)}: ${s.level}${s.sublevel === 'high' ? '+' : ''} (${s.mode === 'voice' ? 'голос' : 'текст'})`;
    c.append(tt); svg.append(c);
  });
  return svg;
}

function trendTag(delta) {
  if (delta == null) return h('span.xs.dim', 'мало даних');
  if (delta >= 0.5) return h('span.tag.good', { 'aria-label': 'покращення' }, '↑ краще');
  if (delta <= -0.5) return h('span.tag.bad', { 'aria-label': 'погіршення' }, '↓ гірше');
  return h('span.tag', '= стабільно');
}

function speakingBody(A) {
  const s = A.speaking;
  if (!s.enough) return emptyNote(s.insufficient ? 'Розмови були закороткі: для оцінки потрібно 40+ ваших слів.' : 'Після кожної розмови з вчителем зʼявляється оцінка за критеріями CEFR.', '#/tutor?mode=chat', 'Поговорити', 'chat-circle-dots');
  return h('div.stack', { style: { gap: '10px' } },
    sparkline(s.sessions),
    h('div.an-table', { role: 'table', 'aria-label': 'Критерії говоріння' },
      CRIT.filter(k => s.trend[k]).map(k => h('div.an-tr', { role: 'row' },
        h('span.grow', { role: 'cell' }, CRIT_UK[k]),
        h('b', { role: 'cell' }, s.trend[k].now),
        h('span', { role: 'cell' }, trendTag(s.trend[k].delta))))),
    s.reasons.length ? h('details.an-more', h('summary.small', 'Чому така оцінка (з останніх розмов)'), h('ul.small', s.reasons.map(r => h('li', mdInline(r))))) : null,
    s.toNext ? h('div.small', h('b', 'До наступного рівня: '), mdInline(s.toNext)) : null,
    s.insufficient ? h('div.xs.dim', `Ще ${s.insufficient} ${plural(s.insufficient, 'розмова', 'розмови', 'розмов')} без оцінки — замало мовлення.`) : null);
}

// ---------- Мовлення: темп, довжина реплік, повтори, різноманітність (голосові розмови) ----------
/** Підписи й формат метрик мовлення; better: 1 — більше краще, -1 — менше краще */
export const SPEECH_META = {
  wpm: { label: 'Темп', unit: 'слів/хв', better: 1, fmt: (v) => String(v) },
  avgLen: { label: 'Довжина репліки', unit: 'слів', better: 1, fmt: (v) => num(v) },
  rep100: { label: 'Повтори й самовиправлення', unit: 'на 100 слів', better: -1, fmt: (v) => num(v) },
  fill100: { label: 'Заповнювачі пауз (um, uh)', unit: 'на 100 слів', better: -1, fmt: (v) => num(v) },
  unique: { label: 'Різні слова', unit: '% від усіх', better: 1, fmt: (v) => `${v}%` },
};

/** Рядок «було → зараз» для метрики: значення, стрілка, підсвітка напрямку (краще / гірше) */
export function speechRow(k, a, b) {
  const M = SPEECH_META[k];
  if (b?.[k] == null) return null;
  const was = a?.[k];
  let tone = '';
  if (was != null && b[k] !== was) {
    const rel = was ? Math.abs((b[k] - was) / was) : 1;
    if (rel >= 0.05) tone = Math.sign(b[k] - was) === M.better ? 'good' : 'bad';
  }
  return h('div.an-tr.sp-row', { role: 'row' },
    h('span.grow', { role: 'cell' }, M.label, h('span.xs.dim', ` · ${M.unit}`)),
    was != null ? h('span.xs.dim', { role: 'cell' }, M.fmt(was), ' →') : null,
    h('b' + (tone ? `.${tone}` : ''), { role: 'cell' }, M.fmt(b[k])));
}

/**
 * Невеликий лінійний графік метрики по сесіях (у порядку дат): лінія, точки з підказками, мін./макс. зліва.
 * points: [{ at, v }]
 */
export function metricChart(points, { label = '', fmt = String, unit = '' } = {}) {
  const ps = points.filter(p => p.v != null);
  if (ps.length < 2) return null;
  const W = 320, H = 84, pad = { l: 34, r: 10, t: 10, b: 10 };
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const vs = ps.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const m = (hi - lo) * 0.12; lo -= m; hi += m;
  const x = (i) => pad.l + (W - pad.l - pad.r) * i / (ps.length - 1);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'an-spark sp-chart', role: 'img', 'aria-label': `${label}: ${ps.map(p => fmt(p.v)).join(', ')} ${unit}`.trim() });
  const vmax = Math.max(...vs), vmin = Math.min(...vs);
  for (const v of vmax === vmin ? [vmax] : [vmax, vmin]) {
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    const tx = el('text', { x: 0, y: y(v) + 4, class: 'lbl' }); tx.textContent = fmt(v); svg.append(tx);
  }
  // м'яка заливка під лінією
  svg.append(el('polygon', { points: `${x(0)},${H - pad.b} ${ps.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} ${x(ps.length - 1)},${H - pad.b}`, class: 'area' }));
  svg.append(el('polyline', { points: ps.map((p, i) => `${x(i)},${y(p.v)}`).join(' '), class: 'line' }));
  ps.forEach((p, i) => {
    const last = i === ps.length - 1;
    const c = el('circle', { cx: x(i), cy: y(p.v), r: last ? 5 : 3.5, class: last ? 'dot last' : 'dot' });
    const tt = el('title', {}); tt.textContent = `${fmtDate(p.at)}: ${fmt(p.v)} ${unit}`.trim();
    c.append(tt); svg.append(c);
  });
  return h('figure.sp-fig',
    h('figcaption.row.xs', h('span.grow', label), h('b', `${fmt(ps[ps.length - 1].v)} ${unit}`.trim())),
    svg,
    h('div.bars-labels', h('span', fmtDate(ps[0].at)), h('span', `${ps.length} ${plural(ps.length, 'розмова', 'розмови', 'розмов')}`), h('span', fmtDate(ps[ps.length - 1].at))));
}

function speechBody(A) {
  const sp = A.speech;
  if (!sp?.n) return emptyNote('Поговоріть голосом 2–3 рази, щоб побачити динаміку: темп, довжину реплік і плавність.', '#/tutor?mode=voice', 'Поговорити', 'microphone');
  const list = sp.sessions.slice(-20);
  const lines = speechLines(sp.first, sp.latest);
  return h('div.stack', { style: { gap: '12px' } },
    txKpis([
      stat(sp.latest.wpm ?? '—', 'слів/хв, остання'),
      stat(sp.latest.avgLen != null ? num(sp.latest.avgLen) : '—', 'слів у репліці'),
      stat(sp.n, plural(sp.n, 'голосова розмова', 'голосові розмови', 'голосових розмов'))]),
    sp.first ? h('div.stack', { style: { gap: '2px' } },
      h('div.xs.dim', `${sp.firstN === 1 ? 'Перша розмова' : `Середнє перших ${sp.firstN}`} → остання`),
      h('div.an-table', { role: 'table', 'aria-label': 'Мовлення: було і зараз' }, Object.keys(SPEECH_META).map(k => speechRow(k, sp.first, sp.latest)))) : null,
    // перші два висновки — уже в рядку зверху; решта — тут
    lines.length > 2 ? h('ul.small.sp-lines', lines.slice(2).map(l => h('li', l))) : null,
    metricChart(list.map(s => ({ at: s.at, v: s.wpm })), { label: 'Темп', unit: 'слів/хв' }),
    metricChart(list.map(s => ({ at: s.at, v: s.avgLen })), { label: 'Середня довжина репліки', fmt: num, unit: 'слів' }),
    sp.n < 2 ? h('div.small.dim', 'Поговоріть голосом 2–3 рази, щоб побачити динаміку.') : null,
    h('div.xs.dim', 'Рахуються голосові розмови, де ви сказали щонайменше 20 слів. Повтори — коли ви кажете слово двічі або починаєте фразу заново.'));
}

function writingBody(A) {
  const w = A.writing;
  if (!w.checks && !w.diary) return emptyNote('Пишіть щоденник або перевіряйте листи у вчителя.', '#/diary', 'Щоденник', 'notebook');
  const L = { grammar: 'Граматика', vocabulary: 'Лексика', tone: 'Тон', structure: 'Структура' };
  return h('div.stack', { style: { gap: '10px' } },
    w.scores ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', `Перевірені тексти (останні ${Math.min(5, w.checks)}), бали з 10`),
      Object.entries(w.scores).map(([k, v]) => hbar(L[k], v, 10, `${num(v)}/10`, w.scoresPrev?.[k] != null ? `раніше ${num(w.scoresPrev[k])}` : ''))) : null,
    txKpis([stat(w.diary, plural(w.diary, 'запис у щоденнику', 'записи в щоденнику', 'записів у щоденнику')),
      stat(w.diaryWords ?? '—', 'слів у записі в середньому'), stat(w.errPer100 != null ? num(w.errPer100) : '—', 'помилок на 100 слів')]));
}

/** Горизонтальна смужка: підпис, значення, частка від max */
function hbar(label, value, max, valueText, sub = '') {
  const p = max ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  return h('div.an-hbar', { title: `${label}: ${valueText}` },
    h('div.row.small', h('span.grow', label), h('b', valueText), sub ? h('span.xs.dim', sub) : null),
    h('div.progress', { role: 'img', 'aria-label': `${label}: ${valueText}` }, h('i', { style: { width: `${p}%` } })));
}

function vocabBody(A) {
  const v = A.vocab;
  if (!v.inWork) return emptyNote('Почніть з 10 нових слів на день.', '#/cards', 'До карток', 'cards');
  return h('div.stack', { style: { gap: '12px' } },
    txKpis([
      stat(v.inWork, 'у роботі'), stat(v.learning, 'вивчаються зараз'),
      stat(v.mature, 'міцно (інтервал ≥ 21 дн.)', v.mature ? 'good' : ''),
      stat(v.ret.n >= 20 ? `${v.ret.pct}%` : '—', v.ret.n >= 20 ? `утримання за 30 дн.${v.retPrev.pct != null && v.retPrev.n >= 20 ? ` (було ${v.retPrev.pct}%)` : ''}` : `утримання: ${v.ret.n}/20 повторів`)], 2),
    v.byLevel.length ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', 'Закріплені слова (інтервал ≥ 7 дн.) з колод кожного рівня'),
      v.byLevel.map(x => hbar(x.level, x.known, x.total, `${x.known} з ${x.total}`)),
      v.own || v.work ? h('div.xs.dim', [v.own ? `ще ${v.own} з «Моїх слів»` : '', v.work ? `${v.work} з робочих колод` : ''].filter(Boolean).join(' · ')) : null) : null,
    v.weak.length ? h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Слова, які забуваються найчастіше'),
      h('div.chips', v.weak.map(w => h('span.tag', { title: w.uk || '' }, h('span', { lang: 'en' }, w.en), ` · ${w.lapses}×`)))) : null,
    v.due ? txRow({ icon: 'cards', label: `Повторити ${v.due}`, href: '#/cards/review' }) : null);
}

function grammarBody(A) {
  const g = A.grammar;
  return h('div.stack', { style: { gap: '10px' } },
    h('div.stack', { style: { gap: '6px' } }, g.byLevel.map(x => hbar(x.level === A.level ? `${x.level} · ваш рівень` : x.level, x.done, x.total, `${x.done} з ${x.total}`))),
    g.tried ? txKpis([stat(g.tried, plural(g.tried, 'урок спробувано', 'уроки спробувано', 'уроків спробувано')), stat(`${g.avgBest}%`, 'найкращий бал, сер.'), stat(g.lessonTests ? `${g.lessonTests.avg}%` : '—', 'тести за уроками')]) : null,
    g.low.length ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', 'Уроки нижче 80%'),
      txRows(g.low.map(x => txRow({ icon: 'puzzle-piece', label: x.title, sub: `${x.level} · спроб: ${x.attempts}`, pill: { text: `${x.best}%`, tone: x.best < 60 ? 'bad' : 'warn' }, href: `#/grammar/${encodeURIComponent(x.id)}` })))) : null,
    g.due.length ? h('div.small', h('b', 'На повторення: '), g.due.slice(0, 4).map((x, i) => [i ? ', ' : '', h('a', { href: `#/grammar/${encodeURIComponent(x.id)}` }, x.title)])) : null,
    g.next ? txRow({ icon: 'puzzle-piece', label: `Наступний урок: ${g.next.title}`, href: `#/grammar/${encodeURIComponent(g.next.id)}` }) : null);
}

function mistakesBody(A) {
  const m = A.mistakes;
  if (!m.total) return emptyNote('Помилки збираються з розмов, щоденника й вправ.', '#/diary', 'Написати запис', 'pencil-line');
  const max = Math.max(1, ...m.types.map(x => x.total));
  return h('div.stack', { style: { gap: '12px' } },
    txKpis([stat(m.open, 'відкритих', m.open ? 'bad' : ''), stat(`${m.resolvedPct}%`, 'виправлено', m.resolvedPct ? 'good' : ''), stat(m.new14, `нових за 14 дн.${m.newPrev14 || m.new14 ? ` (було ${m.newPrev14})` : ''}`)]),
    h('div.stack', { style: { gap: '8px' } }, m.types.map(x => h('div.an-type',
      hbar(S.mistakeTypes[x.type] || x.type, x.total, max, String(x.total)),
      h('div.row.xs.dim', h('span.grow', `14 днів: ${x.last14} · попередні 14: ${x.prev14} · відкритих: ${x.open}`),
        x.last14 > x.prev14 ? h('span.tag.bad', '↑ частіше') : x.last14 < x.prev14 ? h('span.tag.good', '↓ рідше') : null,
        x.open && x.type !== 'other' && x.type !== 'pronunciation' ? h('a', { href: `#/tutor?mode=drill&type=${encodeURIComponent(x.type)}`, 'aria-label': `Міні-урок: ${S.mistakeTypes[x.type]}` }, 'Потренувати') : null)))),
    m.recurring.length ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', 'Повторюються (3+ рази)'),
      m.recurring.map(x => h('div.an-rec',
        h('div.fix-line', h('s.bad', x.wrong), h('span.arrow', { 'aria-label': 'правильно:' }, ' → '), h('b.good', x.right), h('span.xs.dim', ` · ${x.count}×${x.resolved ? ' · виправлено' : ''}`)),
        x.explanation_uk ? h('div.xs.dim', mdInline(x.explanation_uk)) : null))) : null,
    txRow({ icon: 'warning-circle', label: 'Мої помилки', href: '#/mistakes' }));
}

function habitsBody(A) {
  const hb = A.habits;
  const max = Math.max(30, ...hb.weeks.map(w => w.min));
  const lbl = (w) => new Date(w.to + 'T12:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  const TOD = { morning: 'Ранок', day: 'День', evening: 'Вечір', night: 'Ніч' };
  const todMax = Math.max(1, ...Object.values(hb.timeOfDay));
  return h('div.stack', { style: { gap: '12px' } },
    txKpis([stat(hb.streak, `${plural(hb.streak, 'день', 'дні', 'днів')} поспіль`, hb.streak ? 'accent' : ''), stat(num(hb.activePerWeek), 'активних днів/тижд.'), stat(`${hb.min4w} хв`, 'за 4 тижні')]),
    h('div.stack', { style: { gap: '4px' } }, h('div.xs.dim', 'Хвилини за тиждень (останні 8 тижнів)'),
      h('div.bars', { style: { height: '90px' }, role: 'img', 'aria-label': `Хвилини по тижнях: ${hb.weeks.map(w => w.min).join(', ')}` },
        hb.weeks.map(w => h('i' + (w.min ? '' : '.zero'), { style: { height: `${Math.max(2, w.min / max * 100)}%` }, title: `${lbl(w)}: ${w.min} хв, активних днів ${w.active}` }))),
      h('div.bars-labels', h('span', lbl(hb.weeks[0])), h('span', lbl(hb.weeks[4])), h('span', 'останні 7 дн.')),
      h('div.an-days', { 'aria-label': `Активні дні по тижнях: ${hb.weeks.map(w => w.active).join(', ')}` }, hb.weeks.map(w => h('span', { title: `${lbl(w)}: ${w.active} з 7` }, `${w.active}/7`)))),
    Object.values(hb.timeOfDay).some(Boolean) ? h('div.stack', { style: { gap: '6px' } }, h('div.xs.dim', 'Коли ви вчитеся (8 тижнів)'),
      Object.entries(TOD).map(([k, t]) => hbar(t, hb.timeOfDay[k], todMax, `${hb.timeOfDay[k]} хв`))) : null,
    Object.keys(hb.byType).length ? h('div.chips', Object.entries(hb.byType).map(([k, v]) => h('span.tag', `${S.sessionTypes[k] || k}: ${v} хв`))) : null);
}

