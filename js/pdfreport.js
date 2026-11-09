// Звіт про прогрес у PDF (2026-11-09, власник: «щоб звіти про прогрес можна було вивантажити в PDF»).
// Справжній PDF формується на пристрої (vendor/pdf/jspdf.js — ESM-збірка jsPDF 4.2.1, MIT; шрифти Onest і Days One, OFL,
// обрізані до латиниці й кирилиці — vendor/pdf/*.ttf). Усе вантажиться лише при натисканні «Завантажити PDF».
// Далі — системне меню «Поділитися» (iPhone: «Зберегти у Файли», месенджери, пошта) або звичайне завантаження файлу.
import * as store from './store.js';
import { S, plural } from './strings.js';
import { deckIndex, grammarIndex } from './data.js';
import { monthPart, speechLines, conversationLevel, MONTH_IN } from './analysis.js';
import { myLevel, nextLevel, levelProgress, levelPlan, LEVEL_NAME } from './level.js';
import { mistakeCounts, mistakesByRule, streak } from './stats.js';

const A4 = { w: 210, h: 297 };
const M = 16;                       // поля, мм
const C = {
  accent: [30, 58, 138], accentSoft: [229, 235, 250], ink: [11, 21, 48], dim: [91, 102, 128],
  line: [227, 231, 239], tile: [246, 248, 252], good: [19, 117, 56], warn: [161, 92, 7],
};
const lvTxt = (x) => (x ? `${x.level}${x.sublevel === 'high' ? '+' : x.sublevel === 'low' ? '−' : ''}` : '—');

async function b64(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  let s = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function newDoc() {
  const [{ jsPDF }, r400, r600, head] = await Promise.all([
    import('../vendor/pdf/jspdf.js'), b64('vendor/pdf/onest-400.ttf'), b64('vendor/pdf/onest-600.ttf'), b64('vendor/pdf/daysone-400.ttf')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Onest-400.ttf', r400); doc.addFont('Onest-400.ttf', 'Onest', 'normal');
  doc.addFileToVFS('Onest-600.ttf', r600); doc.addFont('Onest-600.ttf', 'Onest', 'bold');
  doc.addFileToVFS('DaysOne.ttf', head); doc.addFont('DaysOne.ttf', 'DaysOne', 'normal');
  return doc;
}

/** Невеликий «верстальник»: курсор по вертикалі, нова сторінка за потреби, однакові відступи */
function layout(doc) {
  let y = M;
  const L = {
    get y() { return y; }, set y(v) { y = v; },
    need(hgt) { if (y + hgt > A4.h - M - 8) { doc.addPage(); y = M; } },
    font(kind = 'body', size = 10, color = C.ink) {
      if (kind === 'head') doc.setFont('DaysOne', 'normal'); else doc.setFont('Onest', kind === 'bold' ? 'bold' : 'normal');
      doc.setFontSize(size); doc.setTextColor(...color);
    },
    text(str, x, opts = {}) { doc.text(String(str), x, y, opts); },
    para(str, { size = 10, color = C.ink, kind = 'body', width = A4.w - 2 * M, x = M, gap = 1.6 } = {}) {
      L.font(kind, size, color);
      const lines = doc.splitTextToSize(String(str), width);
      const lh = size * 0.42;
      L.need(lines.length * lh + gap);
      doc.text(lines, x, y + lh * 0.8); y += lines.length * lh + gap;
    },
    section(title) {
      L.need(16); y += 4;
      L.font('head', 11, C.accent); doc.text(title.toUpperCase(), M, y + 4);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, y + 6.5, A4.w - M, y + 6.5);
      y += 10;
    },
    // плитки з великою цифрою (до 3 в ряд)
    kpis(items) {
      const list = items.filter(Boolean); if (!list.length) return;
      const gap = 4, w = (A4.w - 2 * M - gap * (list.length - 1)) / list.length, hgt = 22;
      L.need(hgt + 3);
      list.forEach((it, i) => {
        const x = M + i * (w + gap);
        doc.setFillColor(...C.tile); doc.setDrawColor(...C.line); doc.roundedRect(x, y, w, hgt, 3, 3, 'FD');
        L.font('head', 17, it.tone === 'good' ? C.good : it.tone === 'accent' ? C.accent : C.ink); doc.text(String(it.value), x + 4, y + 10);
        L.font('body', 8.5, C.dim); doc.text(doc.splitTextToSize(it.label, w - 8), x + 4, y + 15.5);
      });
      y += hgt + 3;
    },
    // рядок «назва — значення»
    row(label, value, tone) {
      L.need(6.5);
      L.font('body', 10, C.ink); doc.text(label, M, y + 4);
      L.font('bold', 10, tone === 'good' ? C.good : tone === 'warn' ? C.warn : C.ink); doc.text(String(value), A4.w - M, y + 4, { align: 'right' });
      doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, y + 6, A4.w - M, y + 6);
      y += 6.8;
    },
  };
  return L;
}

/** Хвилини по днях — стовпчики */
function dayBars(doc, L, days) {
  const hgt = 30, w = A4.w - 2 * M;
  L.need(hgt + 10);
  const max = Math.max(30 * 60, ...days.map(d => d.sec));
  const bw = w / days.length;
  doc.setFillColor(...C.tile); doc.roundedRect(M, L.y, w, hgt + 8, 3, 3, 'F');
  days.forEach((d, i) => {
    const bh = d.sec ? Math.max(1.2, (d.sec / max) * hgt) : 0.6;
    doc.setFillColor(...(d.sec ? C.accent : C.line));
    doc.roundedRect(M + i * bw + bw * 0.18, L.y + 2 + hgt - bh, bw * 0.64, bh, 0.6, 0.6, 'F');
  });
  L.font('body', 7.5, C.dim);
  doc.text('1', M + bw * 0.5, L.y + hgt + 6, { align: 'center' });
  doc.text(String(Math.ceil(days.length / 2)), M + bw * (Math.ceil(days.length / 2) - 0.5), L.y + hgt + 6, { align: 'center' });
  doc.text(String(days.length), M + bw * (days.length - 0.5), L.y + hgt + 6, { align: 'center' });
  L.y += hgt + 11;
}

/** Зібрати PDF-звіт за місяць ym (YYYY-MM). Повертає { blob, name } */
export async function buildMonthPdf(ym) {
  const [deckIdx, gIdx] = await Promise.all([deckIndex().catch(() => []), grammarIndex().catch(() => [])]);
  const R = monthPart(ym, deckIdx);
  const lvl = myLevel();
  const lp = gIdx.length ? await levelProgress(gIdx, lvl).catch(() => null) : null;
  const plan = lp ? levelPlan(lp) : null;
  const conv = conversationLevel();
  const mk = mistakeCounts ? mistakeCounts() : null;
  const name = (store.prof().about?.name || '').trim();
  const doc = await newDoc();
  const L = layout(doc);
  const today = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

  // ---- шапка: синя смуга ----
  doc.setFillColor(...C.accent); doc.rect(0, 0, A4.w, 44, 'F');
  doc.setFillColor(42, 77, 174); doc.circle(A4.w - 10, -6, 42, 'F');   // м'яке світло, як у синій картці
  L.font('head', 12, [199, 211, 245]); doc.text('myEnglish', M, 15);
  L.font('head', 22, [255, 255, 255]); doc.text(`Звіт · ${R.title}`, M, 29);
  L.font('body', 10, [199, 211, 245]); doc.text([name || null, R.cur ? 'місяць триває' : null, `сформовано ${today}`].filter(Boolean).join(' · '), M, 37);
  L.y = 52;

  // ---- головні цифри ----
  const min = Math.round(R.seconds / 60);
  L.kpis([
    { value: min, label: plural(min, 'хвилина практики', 'хвилини практики', 'хвилин практики'), tone: 'accent' },
    { value: R.activeDays, label: plural(R.activeDays, 'активний день', 'активні дні', 'активних днів') },
    { value: R.bestRun, label: `${plural(R.bestRun, 'день', 'дні', 'днів')} — найдовша серія` },
  ]);
  if (R.prevSec && min) {
    const prev = Math.round(R.prevSec / 60), d = Math.round((min - prev) / prev * 100);
    L.para(d >= 5 ? `На ${d}% більше, ніж ${R.cur ? 'за ті самі дні минулого місяця' : 'минулого місяця'}.` : d <= -5 ? `На ${-d}% менше, ніж ${R.cur ? 'за ті самі дні минулого місяця' : 'минулого місяця'}.` : 'Приблизно як минулого місяця.', { size: 9.5, color: C.dim });
  }
  L.section('Хвилини по днях');
  dayBars(doc, L, R.days);

  // ---- рівень ----
  L.section('Рівень');
  L.row('Поточний рівень', `${lvl} · ${LEVEL_NAME[lvl] || ''}`);
  if (lp) L.row(`Опанування ${lvl}`, `${lp.pct}% · уроки ${lp.grammar.done}/${lp.grammar.total} · слова ${lp.words.done}/${lp.words.total}`);
  if (plan && lvl !== nextLevel()) L.row(`План до іспиту ${lvl}`, `≈ ${plan.weeks} ${plural(plan.weeks, 'тиждень', 'тижні', 'тижнів')} · ~${plan.dateText}`);
  if (R.level.n) L.row('Рівень у розмовах за місяць', R.level.last ? `${lvTxt(R.level.first)} → ${lvTxt(R.level.last)}` : lvTxt(R.level.first), 'good');
  else if (conv) L.row('Рівень у розмовах', lvTxt(conv));
  const st = streak(); if (st) L.row('Серія зараз', `${st} ${plural(st, 'день', 'дні', 'днів')} поспіль`);

  // ---- розмови й мовлення ----
  if (R.voice || R.text || R.diary) {
    L.section('Розмови з вчителем');
    if (R.voice) L.row('Голосом', `${R.voice} · ${Math.round(R.voiceSec / 60)} хв`);
    if (R.text) L.row('Текстом і сценарії', String(R.text));
    if (R.diary) L.row('Записи в щоденнику', String(R.diary));
    const lines = speechLines(R.speech.first, R.speech.latest).slice(0, 3);
    if (lines.length) { L.y += 2; lines.forEach(t => L.para(`• ${t}`, { size: 9.5 })); }
  }

  // ---- помилки ----
  L.section('Помилки');
  L.kpis([
    { value: R.mistakes.closed, label: plural(R.mistakes.closed, 'закрито за місяць', 'закрито за місяць', 'закрито за місяць'), tone: R.mistakes.closed ? 'good' : '' },
    { value: R.mistakes.added, label: 'нових за місяць' },
    mk ? { value: mk.active, label: 'активних зараз' } : { value: R.mistakes.open, label: 'відкритих зараз' },
  ]);
  const rules = (mistakesByRule ? mistakesByRule() : []).filter(g => g.label).slice(0, 4);
  if (rules.length) {
    L.para('Над чим працюємо:', { size: 9.5, kind: 'bold', color: C.dim });
    rules.forEach(g => L.row(g.label, `${g.total} ${plural(g.total, 'випадок', 'випадки', 'випадків')}`, 'warn'));
  }
  if (R.mistakes.top.length) {
    L.y += 2; L.para('Найчастіші:', { size: 9.5, kind: 'bold', color: C.dim });
    R.mistakes.top.forEach(x => L.para(`${x.wrong}  →  ${x.right}`, { size: 9.5 }));
  }

  // ---- слова ----
  if (R.words.reviews || R.words.started) {
    L.section('Слова');
    if (R.words.started) L.row('Нових слів почато', String(R.words.started));
    if (R.words.reviews) L.row('Повторень карток', String(R.words.reviews));
    if (R.words.solidNow != null) L.row('Закріплено зараз', String(R.words.solidNow), 'good');
  }

  // ---- час за видами ----
  const types = Object.entries(R.byType).filter(([, v]) => v > 0).slice(0, 8);
  if (types.length) {
    L.section('Час за видами занять');
    types.forEach(([k, v]) => L.row(S.sessionTypes?.[k] || k, `${v} хв`));
  }

  // ---- порада вчителя (якщо є свіжа) ----
  const tip = store.prof().weeklyTip?.data;
  if (tip?.summary_uk || tip?.goal_uk) {
    L.section('Порада вчителя');
    if (tip.summary_uk) L.para(String(tip.summary_uk).replace(/\*+/g, ''), { size: 9.5 });
    if (tip.goal_uk) L.para(`Мета: ${String(tip.goal_uk).replace(/\*+/g, '')}`, { size: 9.5, kind: 'bold' });
  }

  // ---- нижній колонтитул на кожній сторінці ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('Onest', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.dim);
    doc.text(`myEnglish · звіт за ${R.title.toLowerCase()}`, M, A4.h - 8);
    doc.text(`${p} / ${pages}`, A4.w - M, A4.h - 8, { align: 'right' });
  }
  doc.setProperties({ title: `myEnglish — звіт за ${R.title}`, subject: 'Прогрес в англійській', creator: 'myEnglish' });
  return { blob: doc.output('blob'), name: `myEnglish-${ym}.pdf`, title: `Звіт за ${R.title}` };
}

/** Сформувати й віддати користувачу: «Поділитися» (iPhone — «Зберегти у Файли») або завантаження */
export async function exportMonthPdf(ym) {
  const { blob, name, title } = await buildMonthPdf(ym);
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export const monthInText = (i) => MONTH_IN[i];
