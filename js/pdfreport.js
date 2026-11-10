// Звіт про прогрес у PDF — «звіт вчителя» (2026-11-09; детальний — 2026-11-10, власник: «детальніше, з діаграмами…
// наче вчитель для батьків робить звід, щоб чітко розуміли ситуацію»).
// Справжній PDF формується на пристрої (vendor/pdf/jspdf.js — ESM-збірка jsPDF 4.2.1, MIT; шрифти Onest і Days One, OFL,
// обрізані до латиниці й кирилиці — vendor/pdf/*.ttf; у шрифтах немає ≈ ≥ ● ✗ — у тексті їх не вживати). Без AI: лише дані з пристрою
// (+ збережений глибокий аналіз вчителя, якщо він свіжий). Усе вантажиться лише при натисканні «Завантажити PDF».
// Будова: 1 — підсумок (оцінки за напрямами, висновок, сильне/увага); 2 — регулярність (календар, тижні, види занять, час доби);
// 3 — рівень і говоріння; 4 — граматика й слова; 5 — помилки; 6 — письмо, читання, мовлення; 7 — план і як читати звіт.
import * as store from './store.js';
import { S, plural } from './strings.js';
import { deckIndex, grammarIndex } from './data.js';
import {
  monthPart, speechLines, conversationLevel, placementPart, speakingPart, writingPart, vocabPart, grammarPart, mistakesPart, habitsPart,
  readingPart, speechSessions, speechPart, CRIT, CRIT_UK, SKILL_UK, MONTH_IN,
} from './analysis.js';
import { LEVELS, myLevel, nextLevel, levelProgress, levelPlan, LEVEL_NAME } from './level.js';
import { mistakeCounts, mistakesByRule, streak } from './stats.js';

const A4 = { w: 210, h: 297 };
const M = 16;                       // поля, мм
const W = A4.w - 2 * M;             // ширина вмісту
const C = {
  accent: [30, 58, 138], accent2: [59, 104, 214], accentSoft: [229, 235, 250], ink: [11, 21, 48], dim: [91, 102, 128],
  line: [227, 231, 239], tile: [246, 248, 252], good: [19, 117, 56], goodSoft: [222, 243, 230], warn: [161, 92, 7], warnSoft: [252, 238, 214],
  bad: [176, 42, 42], badSoft: [250, 225, 225], white: [255, 255, 255],
};
// категорії діаграм (види занять) — від акценту до нейтральних
const CAT = [[30, 58, 138], [59, 130, 246], [14, 165, 233], [16, 160, 120], [234, 160, 40], [220, 90, 80], [140, 100, 220], [130, 140, 160]];
const mix = (c, k) => c.map(v => Math.round(v + (255 - v) * k));   // k=0 — колір, 1 — білий
const DAY = 864e5;
const t = (iso) => (iso ? Date.parse(iso) || 0 : 0);
const rk = (l) => LEVELS.indexOf(l);
const SUB = { low: -0.3, mid: 0, high: 0.3 };
const lvTxt = (x) => (x ? `${x.level}${x.sublevel === 'high' ? '+' : x.sublevel === 'low' ? '−' : ''}` : '—');
const clean = (s) => String(s ?? '').replace(/\*+|~~|`/g, '').replace(/\s+/g, ' ').trim();
const fmt = (x) => String(x).replace('.', ',');
const dShort = (iso) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }).replace('.', '');
const mins = (n) => `${n} хв`;

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

// ======================= верстка =======================
function layout(doc) {
  let y = M;
  const L = {
    get y() { return y; }, set y(v) { y = v; },
    page() { doc.addPage(); y = M; },
    need(hgt) { if (y + hgt > A4.h - M - 8) L.page(); },
    font(kind = 'body', size = 10, color = C.ink) {
      if (kind === 'head') doc.setFont('DaysOne', 'normal'); else doc.setFont('Onest', kind === 'bold' ? 'bold' : 'normal');
      doc.setFontSize(size); doc.setTextColor(...color);
    },
    /** висота абзацу без малювання */
    measure(str, { size = 10, kind = 'body', width = W } = {}) { L.font(kind, size); return doc.splitTextToSize(String(str), width).length * size * 0.42; },
    para(str, { size = 10, color = C.ink, kind = 'body', width = W, x = M, gap = 1.6 } = {}) {
      if (!str) return;
      L.font(kind, size, color);
      const lines = doc.splitTextToSize(String(str), width);
      const lh = size * 0.42;
      L.need(lines.length * lh + gap);
      doc.text(lines, x, y + lh * 0.8); y += lines.length * lh + gap;
    },
    bullet(str, { color = C.accent, size = 9.5, x = M, width = W, kind = 'body' } = {}) {
      if (!str) return;
      L.font(kind, size);
      const lines = doc.splitTextToSize(String(str), width - 5);
      const lh = size * 0.42;
      L.need(lines.length * lh + 1.6);
      doc.setFillColor(...color); doc.circle(x + 1.2, y + lh * 0.55, 0.9, 'F');
      L.font(kind, size, C.ink); doc.text(lines, x + 5, y + lh * 0.8);
      y += lines.length * lh + 1.6;
    },
    /** Розділ: великими літерами + пояснення для читача («що це означає») */
    section(title, hint, keep = 0) {
      L.need((hint ? 26 : 18) + keep); y += 5;
      L.font('head', 11, C.accent); doc.text(title.toUpperCase(), M, y + 4);
      doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, y + 6.5, A4.w - M, y + 6.5);
      y += 10;
      if (hint) L.para(hint, { size: 8.5, color: C.dim, gap: 2.4 });
    },
    /** Початок глави — з нової сторінки, номер у квадратику */
    chapter(n, title, sub) {
      if (y > A4.h * 0.5) L.page(); else y += 10;
      doc.setFillColor(...C.accent); doc.roundedRect(M, y, 11, 11, 2.5, 2.5, 'F');
      L.font('head', 12, C.white); doc.text(String(n), M + 5.5, y + 7.6, { align: 'center' });
      L.font('head', 17, C.ink); doc.text(title, M + 15, y + 6.4);
      L.font('body', 9, C.dim); doc.text(sub, M + 15, y + 11.4);
      y += 17;
    },
    kpis(items) {
      const list = items.filter(Boolean); if (!list.length) return;
      const gap = 4, w = (W - gap * (list.length - 1)) / list.length, hgt = 22;
      L.need(hgt + 3);
      list.forEach((it, i) => {
        const x = M + i * (w + gap);
        doc.setFillColor(...C.tile); doc.setDrawColor(...C.line); doc.roundedRect(x, y, w, hgt, 3, 3, 'FD');
        L.font('head', list.length > 3 ? 14 : 17, it.tone === 'good' ? C.good : it.tone === 'warn' ? C.warn : it.tone === 'accent' ? C.accent : C.ink);
        doc.text(String(it.value), x + 4, y + 10);
        L.font('body', 8, C.dim); doc.text(doc.splitTextToSize(it.label, w - 8).slice(0, 2), x + 4, y + 15.3);
      });
      y += hgt + 3;
    },
    row(label, value, tone) {
      L.need(6.8);
      L.font('body', 9.5, C.ink); doc.text(doc.splitTextToSize(String(label), W * 0.55)[0], M, y + 4);
      L.font('bold', 9.5, tone === 'good' ? C.good : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : C.ink);
      doc.text(String(value), A4.w - M, y + 4, { align: 'right' });
      doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, y + 6, A4.w - M, y + 6);
      y += 6.8;
    },
    /** Порожній стан — одна тиха плашка */
    empty(str) {
      L.need(12);
      doc.setFillColor(...C.tile); doc.roundedRect(M, y, W, 10, 2.5, 2.5, 'F');
      L.font('body', 9, C.dim); doc.text(str, M + 4, y + 6.3);
      y += 13;
    },
    /** Блок поруч: кожна функція малює в (x, y, w) і повертає висоту */
    cols(fns, hgt, gap = 6) {
      L.need(hgt);
      const w = (W - gap * (fns.length - 1)) / fns.length;
      const hs = fns.map((fn, i) => fn(M + i * (w + gap), y, w) || 0);
      y += Math.max(hgt, ...hs) + 3;
    },
  };
  return L;
}

// ======================= діаграми =======================
const TONE = { good: [C.good, C.goodSoft], ok: [C.accent, C.accentSoft], warn: [C.warn, C.warnSoft], bad: [C.bad, C.badSoft], none: [C.dim, C.tile] };

/** Горизонтальні смужки: [{ label, value, max, text, color }] → висота */
function hbars(doc, x, y, w, items, { labelW = 0.42, size = 8.5, rowH = 7 } = {}) {
  const lw = w * labelW, bw = w - lw - 16;
  items.forEach((it, i) => {
    const yy = y + i * rowH;
    doc.setFont('Onest', 'normal'); doc.setFontSize(size); doc.setTextColor(...C.ink);
    doc.text(doc.splitTextToSize(String(it.label), lw - 2)[0], x, yy + 4);
    doc.setFillColor(...C.line); doc.roundedRect(x + lw, yy + 1.4, bw, 3.6, 1.8, 1.8, 'F');
    const k = it.max ? Math.max(0, Math.min(1, it.value / it.max)) : 0;
    if (k > 0) { doc.setFillColor(...(it.color || C.accent)); doc.roundedRect(x + lw, yy + 1.4, Math.max(3.6, bw * k), 3.6, 1.8, 1.8, 'F'); }
    if (it.mark != null) { doc.setDrawColor(...C.ink); doc.setLineWidth(0.4); const mx = x + lw + bw * it.mark; doc.line(mx, yy + 0.4, mx, yy + 6); }
    doc.setFont('Onest', 'bold'); doc.setTextColor(...C.ink); doc.text(String(it.text ?? it.value), x + w, yy + 4, { align: 'right' });
  });
  return items.length * rowH;
}

/** Вертикальні стовпчики з підписами й лінією мети */
function vbars(doc, x, y, w, h, items, { goal = null, goalLabel = '', color = C.accent, valueLabels = true } = {}) {
  const max = Math.max(goal || 0, ...items.map(i => i.value), 1) * 1.12;
  const bw = w / items.length;
  doc.setFillColor(...C.tile); doc.roundedRect(x, y, w, h + 9, 3, 3, 'F');
  const base = y + h;
  items.forEach((it, i) => {
    const bh = it.value ? Math.max(1.2, (it.value / max) * (h - 6)) : 0.6;
    doc.setFillColor(...(it.value ? (it.color || color) : C.line));
    doc.roundedRect(x + i * bw + bw * 0.2, base - bh, bw * 0.6, bh, 0.8, 0.8, 'F');
    doc.setFont('Onest', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.dim);
    doc.text(String(it.label), x + i * bw + bw / 2, base + 5, { align: 'center' });
    if (valueLabels && it.value) { doc.setTextColor(...C.ink); doc.text(String(it.value), x + i * bw + bw / 2, base - bh - 1.2, { align: 'center' }); }
  });
  if (goal) {
    const gy = base - (goal / max) * (h - 6);
    doc.setDrawColor(...C.warn); doc.setLineWidth(0.3); doc.setLineDashPattern([1.2, 1], 0); doc.line(x + 2, gy, x + w - 2, gy); doc.setLineDashPattern([], 0);
    doc.setFont('Onest', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...C.warn); doc.text(goalLabel, x + w - 2, gy - 1, { align: 'right' });
  }
  return h + 12;
}

/** Сектор кола (кільцева діаграма) — многокутником */
function wedge(doc, cx, cy, r, a0, a1, color) {
  const pts = [[cx, cy]];
  const n = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 48)));
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  const rel = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.setFillColor(...color); doc.lines(rel, cx, cy, [1, 1], 'F', true);
}
function donut(doc, x, y, w, items, centerTop, centerSub) {
  const r = 19, cx = x + r + 1, cy = y + r + 1;
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  let a = -Math.PI / 2;
  items.forEach((it, i) => { const da = it.value / total * Math.PI * 2; if (da > 0.001) wedge(doc, cx, cy, r, a, a + da, it.color || CAT[i % CAT.length]); a += da; });
  doc.setFillColor(...C.white); doc.circle(cx, cy, r * 0.6, 'F');
  doc.setFont('DaysOne', 'normal'); doc.setFontSize(12); doc.setTextColor(...C.ink); doc.text(centerTop, cx, cy + 1, { align: 'center' });
  doc.setFont('Onest', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.dim); doc.text(centerSub, cx, cy + 5, { align: 'center' });
  // легенда
  const lx = x + 2 * r + 7;
  items.forEach((it, i) => {
    const yy = y + 2 + i * 5.4;
    doc.setFillColor(...(it.color || CAT[i % CAT.length])); doc.roundedRect(lx, yy, 3, 3, 0.8, 0.8, 'F');
    doc.setFont('Onest', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.ink); doc.text(String(it.label), lx + 5, yy + 2.6);
    doc.setFont('Onest', 'bold'); doc.text(`${Math.round(it.value / total * 100)}%`, x + w, yy + 2.6, { align: 'right' });
  });
  return Math.max(2 * r + 3, items.length * 5.4 + 3);
}

/** Лінія за точками (values — числа або null), шкала min..max, підписи осі Y */
function lineChart(doc, x, y, w, h, values, { min, max, yLabels = [], xLabels = [], color = C.accent, title = '', fmtV = (v) => v } = {}) {
  const pad = yLabels.length ? 9 : 2;
  doc.setFillColor(...C.tile); doc.roundedRect(x, y, w, h, 3, 3, 'F');
  if (title) { doc.setFont('Onest', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.ink); doc.text(title, x + 3, y + 5); }
  const top = y + (title ? 9 : 4), bot = y + h - (xLabels.length ? 7 : 4), left = x + pad, right = x + w - 4;
  const Y = (v) => bot - (v - min) / (max - min || 1) * (bot - top);
  doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
  yLabels.forEach(([v, lab]) => {
    doc.line(left, Y(v), right, Y(v));
    doc.setFont('Onest', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...C.dim); doc.text(String(lab), x + 2, Y(v) + 1);
  });
  const n = values.length;
  const X = (i) => (n === 1 ? (left + right) / 2 : left + (right - left) * i / (n - 1));
  const pts = values.map((v, i) => (v == null ? null : [X(i), Y(v)]));
  doc.setDrawColor(...color); doc.setLineWidth(0.7);
  let prev = null;
  for (const p of pts) { if (p && prev) doc.line(prev[0], prev[1], p[0], p[1]); if (p) prev = p; }
  pts.forEach((p, i) => { if (!p) return; doc.setFillColor(...C.white); doc.circle(p[0], p[1], 1.2, 'F'); doc.setFillColor(...color); doc.circle(p[0], p[1], 0.8, 'F'); if (i === n - 1 || i === 0) { doc.setFont('Onest', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.ink); doc.text(String(fmtV(values[i])), p[0], p[1] - 2.2, { align: 'center' }); } });
  if (xLabels.length) {
    doc.setFont('Onest', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...C.dim);
    xLabels.forEach((lab, i) => { if (lab) doc.text(String(lab), X(i), y + h - 2.5, { align: 'center' }); });
  }
  return h + 3;
}

/** Шкала рівнів A1–C1 з точкою для кожного рядка: [{ label, level, sub, note }] */
function levelScale(doc, x, y, w, rows, mine) {
  const lw = w * 0.34, sw = w - lw - 4, step = sw / (LEVELS.length - 1), rowH = 8;
  // підписи рівнів
  doc.setFont('DaysOne', 'normal'); doc.setFontSize(8);
  LEVELS.forEach((l, i) => {
    doc.setTextColor(...(l === mine ? C.accent : C.dim));
    doc.text(l, x + lw + i * step, y + 3, { align: 'center' });
  });
  rows.forEach((r, j) => {
    const yy = y + 6 + j * rowH;
    doc.setFont('Onest', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink); doc.text(doc.splitTextToSize(r.label, lw - 2)[0], x, yy + 3.6);
    doc.setDrawColor(...C.line); doc.setLineWidth(1.2); doc.line(x + lw, yy + 2.6, x + lw + sw, yy + 2.6);
    LEVELS.forEach((l, i) => { doc.setFillColor(...C.line); doc.circle(x + lw + i * step, yy + 2.6, 0.9, 'F'); });
    if (r.level && rk(r.level) >= 0) {
      const v = Math.max(0, Math.min(LEVELS.length - 1, rk(r.level) + (SUB[r.sub] || 0)));
      const px = x + lw + v * step;
      doc.setDrawColor(...C.accent); doc.setLineWidth(1.2); doc.line(x + lw, yy + 2.6, px, yy + 2.6);
      doc.setFillColor(...C.accent); doc.circle(px, yy + 2.6, 2, 'F');
      doc.setFillColor(...C.white); doc.circle(px, yy + 2.6, 0.8, 'F');
    }
    if (r.note) { doc.setFont('Onest', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...C.dim); doc.text(r.note, x + lw, yy + 7.2); }
  });
  return 6 + rows.length * rowH;
}

/** Смуга прогресу з порогом (опанування рівня, 80% — іспит) */
function gauge(doc, x, y, w, pct, { mark = 0.8, label = '', markLabel = '' } = {}) {
  doc.setFillColor(...C.line); doc.roundedRect(x, y + 6, w, 5, 2.5, 2.5, 'F');
  const k = Math.max(0, Math.min(1, pct / 100));
  if (k > 0) { doc.setFillColor(...(pct >= mark * 100 ? C.good : C.accent)); doc.roundedRect(x, y + 6, Math.max(5, w * k), 5, 2.5, 2.5, 'F'); }
  if (mark < 1) { doc.setDrawColor(...C.ink); doc.setLineWidth(0.4); doc.line(x + w * mark, y + 4.6, x + w * mark, y + 12.4); }
  doc.setFont('Onest', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.dim); doc.text(markLabel, x + w * mark, y + 15.6, { align: 'center' });
  doc.setFont('Onest', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.ink); doc.text(label, x, y + 3.6);
  doc.setFont('DaysOne', 'normal'); doc.setFontSize(10); doc.text(`${pct}%`, x + w, y + 3.8, { align: 'right' });
  return 17;
}

/** Календар місяця: тижні рядками, Пн…Нд, насиченість — хвилини проти денної мети */
function calendar(doc, x, y, w, R, goalMin) {
  const cell = Math.min(11, (w - 6 * 1.6) / 7), gap = 1.6;
  const [yy, mm] = R.ym.split('-').map(Number);
  const first = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;   // Пн = 0
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].forEach((d, i) => {
    doc.setFont('Onest', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.dim); doc.text(d, x + i * (cell + gap) + cell / 2, y + 3, { align: 'center' });
  });
  let maxRow = 0;
  R.days.forEach((d, i) => {
    const pos = first + i, row = Math.floor(pos / 7), col = pos % 7; maxRow = row;
    const cx = x + col * (cell + gap), cy = y + 5 + row * (cell + gap);
    const m = d.sec / 60;
    const fill = d.future ? C.white : !m ? C.tile : m >= goalMin ? C.accent : m >= goalMin / 2 ? mix(C.accent, 0.45) : mix(C.accent, 0.78);
    doc.setFillColor(...fill); doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
    doc.roundedRect(cx, cy, cell, cell, 1.6, 1.6, d.future ? 'D' : 'F');
    doc.setFont('Onest', m >= goalMin ? 'bold' : 'normal'); doc.setFontSize(7.2);
    doc.setTextColor(...(m >= goalMin && !d.future ? C.white : d.future ? C.line : C.ink));
    doc.text(String(d.day), cx + 1.4, cy + 3.2);
    if (m >= 1 && !d.future) { doc.setFontSize(6.2); doc.setFont('Onest', 'normal'); doc.text(String(Math.round(m)), cx + cell - 1.2, cy + cell - 1.3, { align: 'right' }); }
  });
  const h = 5 + (maxRow + 1) * (cell + gap);
  // легенда
  const ly = y + h + 2;
  [[C.tile, 'без занять'], [mix(C.accent, 0.78), `до ${Math.round(goalMin / 2)} хв`], [mix(C.accent, 0.45), `до ${goalMin} хв`], [C.accent, `мета ${goalMin} хв і більше`]].forEach(([c, lab], i) => {
    const lx = x + i * (w / 4);
    doc.setFillColor(...c); doc.roundedRect(lx, ly, 3, 3, 0.7, 0.7, 'F');
    doc.setFont('Onest', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...C.dim); doc.text(lab, lx + 4, ly + 2.5);
  });
  return h + 7;
}

/** Плитка-оцінка напряму: кольорова пігулка + назва + пояснення */
function gradeCard(doc, L, g) {
  const [fg, bg] = TONE[g.tone] || TONE.none;
  L.font('body', 8.8);
  const lines = doc.splitTextToSize(g.text, W - 58);
  const h = Math.max(12, 6 + lines.length * 3.8);
  L.need(h + 2);
  const y = L.y;
  doc.setFillColor(...C.tile); doc.roundedRect(M, y, W, h, 2.5, 2.5, 'F');
  doc.setFillColor(...fg); doc.roundedRect(M, y, 1.6, h, 0.8, 0.8, 'F');
  L.font('bold', 10, C.ink); doc.text(g.area, M + 5, y + 6);
  doc.setFillColor(...bg); doc.roundedRect(M + 5, y + h - 6.2 > y + 7.5 ? y + 7.6 : y + 7.6, 30, 4.6, 2.3, 2.3, 'F');
  L.font('bold', 7.4, fg); doc.text(g.grade, M + 20, y + 10.9, { align: 'center' });
  L.font('body', 8.8, C.ink); doc.text(lines, M + 42, y + 5.6);
  L.y = y + h + 2;
}

// ======================= оцінки й висновки (без AI) =======================
function grades(D) {
  const { R, H, V, G, MK, SP, lp, elapsed } = D;
  const out = [];
  // регулярність
  const ratio = elapsed ? R.activeDays / elapsed : 0;
  const perWeek = Math.round(R.activeDays / Math.max(1, elapsed / 7) * 10) / 10;
  out.push(!R.seconds ? { area: 'Регулярність', grade: 'Немає занять', tone: 'bad', text: `За ${R.cur ? 'цей місяць' : 'місяць'} занять не було. Найважливіше зараз — повернути звичку: 10–15 хвилин щодня.` }
    : {
      area: 'Регулярність', grade: ratio >= 0.7 ? 'Відмінно' : ratio >= 0.45 ? 'Добре' : ratio >= 0.2 ? 'Нерівно' : 'Рідко',
      tone: ratio >= 0.7 ? 'good' : ratio >= 0.45 ? 'ok' : ratio >= 0.2 ? 'warn' : 'bad',
      text: `${R.activeDays} ${plural(R.activeDays, 'активний день', 'активні дні', 'активних днів')} із ${elapsed} (у середньому ${fmt(perWeek)} на тиждень), найдовша серія — ${R.bestRun} ${plural(R.bestRun, 'день', 'дні', 'днів')}. ${ratio >= 0.7 ? 'Заняття стали звичкою — це головний чинник прогресу.' : ratio >= 0.45 ? 'Добрий ритм; ще 1–2 дні на тиждень дадуть помітно швидший результат.' : 'Заняття уривчасті: між ними слова й правила встигають забуватися.'}`,
    });
  // говоріння
  const conv = conversationLevel();
  if (R.voice + R.text === 0 && !conv) out.push({ area: 'Говоріння', grade: 'Мало даних', tone: 'none', text: 'Розмов із вчителем цього місяця не було — рівень мовлення поки не оцінено.' });
  else {
    const diff = conv ? rk(conv.level) - rk(D.lvl) : 0;
    const tone = !R.voice && !R.text ? 'warn' : diff >= 0 ? 'good' : 'ok';
    out.push({
      area: 'Говоріння', grade: !R.voice && !R.text ? 'Мало практики' : diff > 0 ? 'Вище рівня' : diff === 0 ? 'На рівні' : 'Росте',
      tone,
      text: `${R.voice} ${plural(R.voice, 'голосова розмова', 'голосові розмови', 'голосових розмов')} і ${R.text} текстових за місяць. ${conv ? `Вчитель оцінює мовлення на ${lvTxt(conv)}${conv.confidence === 'low' ? ' (оцінка поки непевна — замало мовлення)' : ''}.` : ''} ${SP.n >= 2 && SP.latest?.wpm ? `Темп — близько ${SP.latest.wpm} слів за хвилину.` : ''}`.trim(),
    });
  }
  // слова
  const ret = V.ret.pct;
  out.push(!V.inWork ? { area: 'Слова', grade: 'Мало даних', tone: 'none', text: 'Картки зі словами ще не вивчались.' } : {
    area: 'Слова', grade: ret == null ? 'Початок' : ret >= 85 ? 'Відмінно' : ret >= 75 ? 'Добре' : 'Забуває',
    tone: ret == null ? 'ok' : ret >= 85 ? 'good' : ret >= 75 ? 'ok' : 'warn',
    text: `У роботі ${V.inWork} ${plural(V.inWork, 'слово', 'слова', 'слів')}, закріплено ${V.solid}. ${R.words.started ? `За місяць почато ${R.words.started} нових. ` : ''}${ret != null ? `Під час повторення згадує ${ret}% вивчених слів${ret < 75 ? ' — варто брати менше нових і частіше повторювати' : ''}.` : ''}`,
  });
  // граматика
  const doneMonth = store.all('lessons_progress').filter(p => p.completed_at?.startsWith(R.ym)).length;
  out.push(!G.tried ? { area: 'Граматика', grade: 'Мало даних', tone: 'none', text: 'Уроки граматики ще не проходились.' } : {
    area: 'Граматика', grade: G.avgBest >= 85 ? 'Відмінно' : G.avgBest >= 70 ? 'Добре' : 'Потребує уваги',
    tone: G.avgBest >= 85 ? 'good' : G.avgBest >= 70 ? 'ok' : 'warn',
    text: `За місяць зараховано ${doneMonth} ${plural(doneMonth, 'урок', 'уроки', 'уроків')}${lp ? `; рівень ${lp.level}: ${lp.grammar.done} з ${lp.grammar.total}` : ''}. Середній найкращий бал у вправах — ${G.avgBest}%.${G.low.length ? ` Слабкі уроки: ${G.low.slice(0, 2).map(x => `«${x.title}»`).join(', ')}.` : ''}`,
  });
  // помилки
  const a = R.mistakes.added, c = R.mistakes.closed;
  out.push(!MK.total ? { area: 'Помилки', grade: 'Мало даних', tone: 'none', text: 'Помилок ще не зафіксовано: вони з\'являються після розмов, вправ і перевірки текстів.' } : {
    area: 'Помилки', grade: c >= a && c > 0 ? 'Виправляє' : c > 0 ? 'Повільно' : a ? 'Накопичуються' : 'Стабільно',
    tone: c >= a && c > 0 ? 'good' : c > 0 ? 'ok' : a ? 'warn' : 'ok',
    text: `За місяць нових — ${a}, закрито — ${c} (закрита помилка — правильне вживання кілька разів у різні дні). ${MK.recurring.length ? `Найстійкіша: «${clean(MK.recurring[0].wrong)}» → «${clean(MK.recurring[0].right)}».` : ''}`.trim(),
  });
  return out;
}

function verdict(D, gs) {
  const { R, lp, lvl, plan } = D;
  const good = gs.filter(g => g.tone === 'good').map(g => g.area.toLowerCase());
  const weak = gs.filter(g => g.tone === 'warn' || g.tone === 'bad').map(g => g.area.toLowerCase());
  const min = Math.round(R.seconds / 60);
  const parts = [];
  if (!R.seconds) parts.push(`${R.cur ? 'Цього місяця' : `У ${MONTH_IN[R.monthIdx]}`} занять не було.`);
  else parts.push(`${R.cur ? 'Цього місяця' : `У ${MONTH_IN[R.monthIdx]}`} — ${min} ${plural(min, 'хвилина', 'хвилини', 'хвилин')} англійської за ${R.activeDays} ${plural(R.activeDays, 'день', 'дні', 'днів')}.`);
  if (R.prevSec && R.seconds) {
    const prev = Math.round(R.prevSec / 60), d = Math.round((min - prev) / Math.max(1, prev) * 100);
    parts.push(d >= 10 ? `Це на ${d}% більше, ніж ${R.cur ? 'за ті самі дні минулого місяця' : 'минулого місяця'}.` : d <= -10 ? `Це на ${-d}% менше, ніж ${R.cur ? 'за ті самі дні минулого місяця' : 'минулого місяця'}.` : 'Обсяг — приблизно як минулого місяця.');
  }
  if (lp) parts.push(`Рівень ${lvl} («${LEVEL_NAME[lvl]}») опановано на ${lp.pct}%${lp.pct >= 80 ? ' — можна складати іспит рівня' : plan ? `; у теперішньому темпі до іспиту — близько ${plan.weeks} ${plural(plan.weeks, 'тижня', 'тижнів', 'тижнів')}` : ''}.`);
  if (good.length) parts.push(`Найкраще йде: ${good.join(', ')}.`);
  if (weak.length) parts.push(`Потребує уваги: ${weak.join(', ')}.`);
  return parts.join(' ');
}

function recommendations(D, gs) {
  const { R, V, G, MK, lp, plan, lvl } = D;
  const rec = [];
  const by = Object.fromEntries(gs.map(g => [g.area, g]));
  const goal = Math.max(1, Number(store.settings().dailyGoal) || 20);
  if (['warn', 'bad'].includes(by['Регулярність']?.tone)) rec.push(`Займатися щодня по ${Math.min(goal, 15)} хвилин замість рідких довгих занять — «Мій день» на головній складає готовий план на 15 хвилин.`);
  else if (R.seconds) rec.push(`Тримати теперішній ритм: ${goal} хвилин на день, щонайменше 5 днів на тиждень.`);
  if (by['Говоріння']?.tone === 'warn' || R.voice < 4) rec.push('Щонайменше 2 голосові розмови з вчителем на тиждень (по 5–10 хвилин) — це єдиний спосіб, яким рівень мовлення росте й оцінюється.');
  if (V.ret.pct != null && V.ret.pct < 80) rec.push('Зменшити кількість нових слів на день (налаштування «Нових карток на день») і щодня закривати повторення — так слова менше забуваються.');
  else if (V.due > 20) rec.push(`Закрити чергу повторень (зараз ${V.due} ${plural(V.due, 'слово', 'слова', 'слів')} чекають) до того, як брати нові.`);
  if (G.low.length) rec.push(`Повторити уроки граматики з балом нижче 80%: ${G.low.slice(0, 3).map(x => `«${x.title}»`).join(', ')}.`);
  if (G.due.length) rec.push(`${G.due.length} ${plural(G.due.length, 'урок чекає', 'уроки чекають', 'уроків чекають')} на планове повторення — набір «Повторення» у вправах.`);
  const rules = mistakesByRule().filter(g => g.label).slice(0, 2);
  if (rules.length) rec.push(`Відпрацювати правила з найбільшою кількістю помилок: ${rules.map(g => `«${g.label}»`).join(' і ')} (у «Моїх помилках» — кнопка практики).`);
  if (lp && lp.pct >= 80) rec.push(`Скласти іспит рівня ${lvl} (Тести → «Іспит рівня») і перейти на ${nextLevel(lvl)}.`);
  else if (plan) rec.push(`До іспиту ${lvl}: лишилось ${plan.lessonsLeft} ${plural(plan.lessonsLeft, 'урок', 'уроки', 'уроків')} і ${plan.wordsLeft} ${plural(plan.wordsLeft, 'слово', 'слова', 'слів')}; темп ${plan.lessonsPerWeek} ${plural(plan.lessonsPerWeek, 'урок', 'уроки', 'уроків')} на тиждень і ${plan.perDay} нових слів на день.`);
  if (!MK.total && R.seconds) rec.push('Писати короткі записи в щоденник (3–5 речень) — вчитель перевірить і помилки потраплять у план повторення.');
  return rec.slice(0, 7);
}

// ======================= сам звіт =======================
/** Зібрати PDF-звіт за місяць ym (YYYY-MM). Повертає { blob, name, title } */
export async function buildMonthPdf(ym) {
  const [deckIdx, gIdx] = await Promise.all([deckIndex().catch(() => []), grammarIndex().catch(() => [])]);
  const now = new Date();
  const R = monthPart(ym, deckIdx);
  const lvl = myLevel();
  const lp = gIdx.length ? await levelProgress(gIdx, lvl).catch(() => null) : null;
  const plan = lp ? levelPlan(lp) : null;
  const H = habitsPart(), V = vocabPart(deckIdx), G = grammarPart(gIdx), MK = mistakesPart(), SP = speechSessions().slice(-12);
  const SPP = { n: R.speech.n, latest: R.speech.latest, first: R.speech.first };
  const PL = placementPart(), SK = speakingPart(), WR = writingPart(), RD = readingPart();
  const elapsed = R.cur ? now.getDate() : R.nDays;
  const D = { R, H, V, G, MK, SP: SPP, lp, plan, lvl, elapsed };
  const goalMin = Math.max(1, Number(store.settings().dailyGoal) || 20);
  const about = store.prof().about || {};
  const name = clean(about.name || '');
  const doc = await newDoc();
  const L = layout(doc);
  const today = now.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  const gs = grades(D);

  // ================= 1. Підсумок =================
  doc.setFillColor(...C.accent); doc.rect(0, 0, A4.w, 50, 'F');
  L.font('head', 11, [199, 211, 245]); doc.text('myEnglish · звіт вчителя', M, 14);
  L.font('head', 24, C.white); doc.text(`Прогрес за ${R.title.toLowerCase()}`, M, 29);
  L.font('body', 10, [199, 211, 245]);
  doc.text([name ? `Учень: ${name}` : null, `рівень ${lvl} · ${LEVEL_NAME[lvl] || ''}`].filter(Boolean).join(' · '), M, 38);
  doc.text([R.cur ? `місяць триває (${elapsed} з ${R.nDays} днів)` : null, `сформовано ${today}`].filter(Boolean).join(' · '), M, 44);
  L.y = 58;

  const min = Math.round(R.seconds / 60);
  L.kpis([
    { value: min, label: `${plural(min, 'хвилина', 'хвилини', 'хвилин')} практики`, tone: 'accent' },
    { value: `${R.activeDays}/${elapsed}`, label: 'активних днів (від 5 хв)' },
    { value: lp ? `${lp.pct}%` : lvl, label: lp ? `опановано рівень ${lvl}` : 'поточний рівень', tone: lp && lp.pct >= 80 ? 'good' : '' },
    { value: R.mistakes.closed, label: 'помилок закрито', tone: R.mistakes.closed ? 'good' : '' },
  ]);

  L.section('Висновок вчителя');
  L.para(verdict(D, gs), { size: 10.5, gap: 2.5 });

  L.section('Оцінка за напрямами', 'Кожен напрям оцінено за даними місяця. Зелений — усе добре, синій — нормальний хід, жовтий і червоний — тут потрібна увага.');
  gs.forEach(g => gradeCard(doc, L, g));

  // свіжий глибокий аналіз вчителя (AI, збережений раніше) — лише цитуємо
  const AN = store.prof().analysis;
  const anFresh = AN?.data && AN.at && now - t(AN.at) < 35 * DAY ? AN.data : null;
  if (anFresh) {
    L.section(`Глибокий аналіз вчителя · ${dShort(AN.at)}`, 'Розбір усіх даних навчання, який вчитель зробив на сторінці «Аналіз».');
    if (anFresh.overall?.summary_uk) L.para(clean(anFresh.overall.summary_uk), { size: 9.5, gap: 2.4 });
    const st = (anFresh.strengths || []).slice(0, 3), wk = (anFresh.weaknesses || []).slice(0, 3);
    if (st.length) { L.para('Сильні сторони', { size: 9.5, kind: 'bold', color: C.good }); st.forEach(s => L.bullet(`${clean(s.point_uk)} — ${clean(s.evidence_uk)}`, { color: C.good, size: 9 })); }
    if (wk.length) { L.y += 1; L.para('Що стримує', { size: 9.5, kind: 'bold', color: C.warn }); wk.forEach(s => L.bullet(`${clean(s.area)}: ${clean(s.evidence_uk)} Як виправити: ${clean(s.how_to_fix_uk)}`, { color: C.warn, size: 9 })); }
  }

  // ================= 2. Регулярність =================
  L.chapter(2, 'Регулярність і час', 'Скільки, коли і чим займався учень');
  L.section('Календар місяця', `Кожна клітинка — день; цифра в кутку — хвилини занять. Денна мета — ${goalMin} хв.`, 62);
  L.cols([
    (x, y, w) => calendar(doc, x, y, w, R, goalMin),
    (x, y, w) => {
      const rows = [
        ['Усього за місяць', mins(min)],
        ['У середньому за активний день', R.activeDays ? mins(Math.round(min / R.activeDays)) : '—'],
        ['Днів з виконаною метою', String(R.days.filter(d => d.sec / 60 >= goalMin).length)],
        ['Найдовша серія', `${R.bestRun} ${plural(R.bestRun, 'день', 'дні', 'днів')}`],
        ['Серія зараз', `${streak()} ${plural(streak(), 'день', 'дні', 'днів')}`],
        ['Минулий місяць (ті самі дні)', R.prevSec ? mins(Math.round(R.prevSec / 60)) : '—'],
      ];
      rows.forEach(([a, b], i) => {
        const yy = y + 4 + i * 8.2;
        L.font('body', 8.8, C.dim); doc.text(a, x, yy + 3.5);
        L.font('head', 11, C.ink); doc.text(b, x + w, yy + 3.8, { align: 'right' });
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(x, yy + 6, x + w, yy + 6);
      });
      return 4 + rows.length * 8.2;
    },
  ], 60);

  L.section('Хвилини за 8 тижнів', 'Кожен стовпчик — 7 днів, останній — цей тиждень. Пунктир — тижнева мета.', 46);
  L.need(46);
  L.y += vbars(doc, M, L.y, W, 34, H.weeks.map(w => ({ value: w.min, label: dShort(w.to) })), { goal: goalMin * 7, goalLabel: `мета ${goalMin * 7} хв` });

  const types = Object.entries(R.byType).filter(([, v]) => v > 0);
  const top = types.slice(0, 6); const rest = types.slice(6).reduce((a, [, v]) => a + v, 0);
  const tod = H.timeOfDay; const todSum = Object.values(tod).reduce((a, b) => a + b, 0);
  L.section('Чим займався й коли', 'Ліворуч — частка часу за видами занять цього місяця, праворуч — у який час доби учень займається (за 8 тижнів).', 44);
  if (types.length || todSum) {
    L.cols([
      (x, y, w) => (types.length ? donut(doc, x, y, w, [...top.map(([k, v]) => ({ label: S.sessionTypes?.[k] || k, value: v })), ...(rest ? [{ label: 'Інше', value: rest }] : [])], mins(min), 'за місяць') : 0),
      (x, y, w) => (todSum ? hbars(doc, x, y + 2, w, [['morning', 'Ранок (5–12)'], ['day', 'День (12–17)'], ['evening', 'Вечір (17–23)'], ['night', 'Ніч']].map(([k, l]) => ({ label: l, value: tod[k], max: Math.max(...Object.values(tod), 1), text: mins(tod[k]) })), { labelW: 0.36, rowH: 9 }) + 2 : 0),
    ], 44);
  } else L.empty('Занять цього місяця ще не було.');

  // ================= 3. Рівень і говоріння =================
  L.chapter(3, 'Рівень і говоріння', 'Де учень зараз за шкалою CEFR і як він говорить');
  L.section(`Опанування рівня ${lvl}`, 'Рівень вважається опанованим на 80%: 60% ваги — пройдені уроки граматики рівня, 40% — закріплені слова його колод. Після 80% можна складати іспит рівня.');
  if (lp) {
    L.need(40);
    L.y += gauge(doc, M, L.y, W, lp.pct, { label: `Рівень ${lvl} · ${LEVEL_NAME[lvl]}`, markLabel: 'іспит — від 80%' });
    L.y += 2;
    L.cols([
      (x, y, w) => gauge(doc, x, y, w, lp.grammar.total ? Math.round(lp.grammar.done / lp.grammar.total * 100) : 0, { label: `Уроки: ${lp.grammar.done} з ${lp.grammar.total}`, mark: 1, markLabel: '' }),
      (x, y, w) => gauge(doc, x, y, w, lp.words.total ? Math.round(lp.words.done / lp.words.total * 100) : 0, { label: `Слова: ${lp.words.done} з ${lp.words.total}`, mark: 1, markLabel: '' }),
    ], 16);
    if (plan && lp.pct < 80) L.row('Прогноз іспиту в теперішньому темпі', `близько ${plan.weeks} ${plural(plan.weeks, 'тижня', 'тижнів', 'тижнів')} · ${plan.dateText}`);
  } else L.empty('Дані рівня ще завантажуються — спробуйте сформувати звіт ще раз.');
  const exams = store.all('tests').filter(x => x.type === 'level' && x.scores).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
  exams.forEach(e => L.row(`Іспит рівня ${e.ref} · ${dShort(e.created_at)}`, `${e.scores.score}% · граматика ${e.scores.grammar}% · слова ${e.scores.words}% · ${e.scores.passed ? 'складено' : 'не складено'}`, e.scores.passed ? 'good' : 'warn'));

  const sRows = [];
  if (PL) Object.entries(PL.skills).forEach(([k, s]) => sRows.push({ label: SKILL_UK[k] || k, level: s.level, note: `тест рівня, ${dShort(PL.at)}${s.conf ? ` · ${s.conf}` : ''}` }));
  const conv = conversationLevel();
  if (conv) sRows.push({ label: 'Говоріння в розмовах', level: conv.level, sub: conv.sublevel, note: `останні розмови з вчителем${conv.confidence === 'low' ? ' · оцінка непевна' : ''}` });
  CRIT.forEach(k => { const tr = SK.trend[k]; if (tr?.now) sRows.push({ label: `· ${CRIT_UK[k]}`, level: tr.now, note: tr.delta ? (tr.delta > 0 ? `росте (+${fmt(tr.delta)})` : `знизилось (${fmt(tr.delta)})`) : '' }); });
  L.section('Навички за шкалою рівнів', 'A1 — початковий, A2 — базовий, B1 — середній (вільно в побуті), B2 — вище середнього, C1 — просунутий. «+» і «−» — верхня й нижня частина рівня.', sRows.length ? Math.min(90, 8 + sRows.length * 8) : 12);
  if (sRows.length) { L.need(8 + sRows.length * 8); L.y += levelScale(doc, M, L.y, W, sRows, lvl) + 3; }
  else L.empty('Тест рівня й оцінки розмов ще не проводились.');

  if (SK.sessions.length >= 2) {
    L.section('Рівень у розмовах з часом', 'Оцінка вчителя після кожної розмови з достатнім обсягом мовлення.', 44);
    L.need(44);
    L.y += lineChart(doc, M, L.y, W, 40, SK.sessions.map(s => rk(s.level) + (SUB[s.sublevel] || 0)), {
      min: 0, max: LEVELS.length - 1, yLabels: LEVELS.map((l, i) => [i, l]), xLabels: SK.sessions.map(s => dShort(s.at)),
      fmtV: (v) => LEVELS[Math.round(v)] || '',
    });
  }
  if (SK.reasons.length || SK.toNext) {
    L.section('Що каже вчитель про мовлення');
    [...new Set(SK.reasons.map(clean))].slice(0, 3).forEach(r => L.bullet(clean(r), { size: 9 }));
    if (SK.toNext) L.bullet(`До наступного рівня: ${clean(SK.toNext)}`, { size: 9, color: C.good });
  }

  // ================= 4. Граматика й слова =================
  L.chapter(4, 'Граматика й слова', 'Пройдені уроки, бали у вправах, словниковий запас');
  L.section('Уроки граматики за рівнями', 'Скільки уроків кожного рівня зараховано (бал від 80% у вправах або в тесті за уроком).');
  if (G.byLevel.length) {
    L.need(G.byLevel.length * 7 + 4);
    L.y += hbars(doc, M, L.y, W, G.byLevel.map(b => ({ label: `${b.level} · ${LEVEL_NAME[b.level]}`, value: b.done, max: b.total, text: `${b.done} з ${b.total}`, color: b.level === lvl ? C.accent : mix(C.accent, 0.4) })), { labelW: 0.3 }) + 3;
  }
  L.kpis([
    G.tried ? { value: `${G.avgBest}%`, label: 'середній найкращий бал у вправах', tone: G.avgBest >= 80 ? 'good' : 'warn' } : null,
    G.lessonTests ? { value: `${G.lessonTests.avg}%`, label: `тести за уроками (${G.lessonTests.n})` } : null,
    G.weeklyTests ? { value: `${G.weeklyTests.avg}%`, label: `тижневі тести (${G.weeklyTests.n})` } : null,
  ]);
  if (G.low.length) {
    L.para('Уроки, які варто повторити (бал нижче 80%):', { size: 9, kind: 'bold', color: C.dim });
    G.low.forEach(x => L.row(`${x.level} · ${x.title}`, `${x.best}% · ${x.attempts} ${plural(x.attempts, 'спроба', 'спроби', 'спроб')}`, 'warn'));
  }
  if (G.due.length) L.row('Уроків на плановому повторенні', String(G.due.length));
  if (!G.tried) L.empty('Уроків граматики ще не проходили.');

  L.section('Словниковий запас', 'Слово «закріплене», коли наступне повторення — не раніше ніж через 7 днів; «міцно» — пам\'ять тримається 3 тижні й довше.');
  if (V.inWork) {
    const young = Math.max(0, V.review - V.mature);
    L.kpis([
      { value: V.inWork, label: 'слів у роботі', tone: 'accent' },
      { value: V.solid, label: 'закріплено', tone: 'good' },
      { value: V.ret.pct != null ? `${V.ret.pct}%` : '—', label: `згадує при повторенні${V.retPrev.pct != null ? ` (було ${V.retPrev.pct}%)` : ''}`, tone: V.ret.pct == null ? '' : V.ret.pct >= 80 ? 'good' : 'warn' },
    ]);
    // стан слів — одна смуга 100%
    const parts = [[V.learning, 'Вчить зараз', mix(C.accent, 0.55)], [young, 'Повторює', C.accent2], [V.mature, 'Знає міцно', C.good]].filter(p => p[0] > 0);
    const tot = parts.reduce((a, p) => a + p[0], 0);
    if (tot) {
      L.need(16);
      let x = M;
      parts.forEach(([v, , c]) => { const w = W * v / tot; doc.setFillColor(...c); doc.rect(x, L.y, w, 6, 'F'); x += w; });
      L.y += 9;
      x = M;
      parts.forEach(([v, lab, c]) => { doc.setFillColor(...c); doc.roundedRect(x, L.y, 3, 3, 0.7, 0.7, 'F'); L.font('body', 8, C.ink); doc.text(`${lab} — ${v}`, x + 4.5, L.y + 2.6); x += W / 3; });
      L.y += 7;
    }
    if (V.byLevel.length) {
      L.para('Закріплені слова стартових колод за рівнями:', { size: 9, kind: 'bold', color: C.dim });
      L.need(V.byLevel.length * 7 + 3);
      L.y += hbars(doc, M, L.y, W, V.byLevel.map(b => ({ label: `${b.level} · ${LEVEL_NAME[b.level]}`, value: b.known, max: b.total, text: `${b.known} з ${b.total}`, color: b.level === lvl ? C.good : mix(C.good, 0.4) })), { labelW: 0.3 }) + 3;
    }
    if (V.own) L.row('Власні слова й фрази (додані учнем)', String(V.own));
    if (V.weak.length) {
      L.need(8 + Math.min(5, V.weak.length) * 6.8);
      L.para('Слова, які найчастіше забуваються:', { size: 9, kind: 'bold', color: C.dim });
      V.weak.slice(0, 5).forEach(w => L.row(`${w.en} — ${w.uk || ''}`, `забув ${w.lapses} ${plural(w.lapses, 'раз', 'рази', 'разів')}`, 'warn'));
    }
  } else L.empty('Слова ще не вивчались.');

  // ================= 5. Помилки =================
  L.chapter(5, 'Помилки', 'Що учень повторює неправильно і чи виправляє це');
  L.section('Помилки за місяць', 'Помилка «закрита», коли учень правильно вжив цю форму кілька разів у різні дні (лексичні — 2 рази, граматичні — 3).');
  const mk = mistakeCounts();
  L.kpis([
    { value: R.mistakes.added, label: 'нових за місяць' },
    { value: R.mistakes.closed, label: 'закрито за місяць', tone: R.mistakes.closed ? 'good' : '' },
    { value: mk.active, label: 'у роботі зараз' },
    { value: mk.closedTotal, label: 'закрито за весь час', tone: 'good' },
  ]);
  const rules = mistakesByRule().slice(0, 7);
  if (rules.length) {
    L.section('Над якими правилами працюємо', 'Відкриті помилки, згруповані за правилом; число — скільки разів помилка траплялась.', rules.length * 7);
    const mx = Math.max(...rules.map(g => g.total), 1);
    L.need(rules.length * 7 + 3);
    L.y += hbars(doc, M, L.y, W, rules.map(g => ({ label: g.label || ({ articles: 'Артиклі', tenses: 'Часи', prepositions: 'Прийменники', word_order: 'Порядок слів', vocabulary: 'Лексика', pronunciation: 'Вимова' }[g.type] || 'Інше'), value: g.total, max: mx, text: `${g.total}`, color: C.warn })), { labelW: 0.5 }) + 3;
  }
  if (MK.types.length) {
    L.section('Тенденція за 2 тижні', 'Нові помилки за останні 14 днів проти попередніх 14. Менше — добре.');
    MK.types.slice(0, 6).forEach(x => {
      const d = x.last14 - x.prev14;
      L.row(({ articles: 'Артиклі', tenses: 'Часи', prepositions: 'Прийменники', word_order: 'Порядок слів', vocabulary: 'Лексика', pronunciation: 'Вимова', other: 'Інше' })[x.type] || x.type,
        `${x.prev14} → ${x.last14}  ${d < 0 ? '↓ менше' : d > 0 ? '↑ більше' : '— без змін'}`, d < 0 ? 'good' : d > 0 ? 'warn' : '');
    });
  }
  const recur = MK.recurring.filter(m => !m.resolved).slice(0, 6);
  const topList = recur.length ? recur : R.mistakes.top;
  if (topList.length) {
    L.section('Найчастіші помилки', 'Як учень каже — як правильно.', Math.min(3, topList.length) * 12);
    topList.forEach(m => {
      L.need(12);
      const y = L.y;
      doc.setFillColor(...C.tile); doc.roundedRect(M, y, W, 10, 2.2, 2.2, 'F');
      L.font('body', 9, C.bad); doc.text(doc.splitTextToSize(clean(m.wrong), W * 0.4)[0], M + 3, y + 6.3);
      L.font('body', 9, C.dim); doc.text('→', M + W * 0.45, y + 6.3);
      L.font('bold', 9, C.good); doc.text(doc.splitTextToSize(clean(m.right), W * 0.4)[0], M + W * 0.5, y + 6.3);
      L.font('body', 7.5, C.dim); doc.text(`×${m.count}`, M + W - 3, y + 6.3, { align: 'right' });
      L.y = y + 12;
    });
  }
  if (!MK.total) L.empty('Помилок ще немає — вони з\'являються після розмов, вправ і перевірки текстів.');

  // ================= 6. Письмо, читання, мовлення =================
  L.chapter(6, 'Письмо, читання, мовлення', 'Якість текстів, прочитане, як змінюється мовлення в голосових розмовах');
  L.section('Письмо', 'Перевірка текстів вчителем (оцінки 0–10) і щоденник — скільки помилок припадає на 100 слів.', 30);
  if (WR.checks || WR.diary) {
    if (WR.scores) {
      const lab = { grammar: 'Граматика', vocabulary: 'Лексика', tone: 'Стиль', structure: 'Побудова' };
      L.need(32);
      L.y += hbars(doc, M, L.y, W, Object.entries(WR.scores).map(([k, v]) => ({ label: lab[k] || k, value: v, max: 10, text: `${fmt(v)} / 10${WR.scoresPrev?.[k] != null ? `  (було ${fmt(WR.scoresPrev[k])})` : ''}`, color: v >= 7 ? C.good : v >= 5 ? C.accent : C.warn })), { labelW: 0.25 }) + 3;
    }
    if (WR.checks) L.row('Перевірених текстів', String(WR.checks));
    if (WR.diary) L.row('Записів у щоденнику', `${WR.diary}${WR.diaryWords ? ` · у середньому ${WR.diaryWords} слів` : ''}`);
    if (WR.errPer100 != null) L.row('Помилок на 100 слів у щоденнику', `${fmt(WR.errPer100)}${WR.errPer100Prev != null ? ` (було ${fmt(WR.errPer100Prev)})` : ''}`, WR.errPer100Prev != null && WR.errPer100 < WR.errPer100Prev ? 'good' : '');
  } else L.empty('Текстів і записів щоденника ще не було.');

  L.section('Читання');
  if (RD.texts) { L.row('Прочитано текстів', String(RD.texts)); if (RD.avgBest != null) L.row('Розуміння прочитаного (питання після тексту)', `${RD.avgBest}%`, RD.avgBest >= 80 ? 'good' : ''); }
  else L.empty('Тексти для читання ще не відкривались.');

  L.section('Мовлення в голосових розмовах', 'Темп — слів за хвилину; довжина репліки — скільки слів учень каже за раз; заповнювачі пауз (um, uh) — на 100 слів, чим менше, тим плавніше.', 40);
  if (SP.length >= 2) {
    const xl = SP.map((s, i) => (i === 0 || i === SP.length - 1 ? dShort(s.at) : ''));
    const mini = (key, title, f = (v) => v) => (x, y, w) => {
      const vs = SP.map(s => s[key]);
      const ok = vs.filter(v => v != null);
      if (!ok.length) return 0;
      const lo = Math.min(...ok), hi = Math.max(...ok), pad = Math.max(1, (hi - lo) * 0.25);
      return lineChart(doc, x, y, w, 36, vs, { min: Math.max(0, lo - pad), max: hi + pad, xLabels: xl, title, fmtV: f });
    };
    L.cols([mini('wpm', 'Темп, слів/хв'), mini('avgLen', 'Слів у репліці', fmt), mini('fill100', 'Заповнювачі на 100 слів', fmt)], 38, 4);
    speechLines(speechPart(SP).first, speechPart(SP).latest).slice(0, 4).forEach(s => L.bullet(s, { size: 9 }));
  } else if (SP.length === 1) {
    const s = SP[0];
    L.row('Темп', s.wpm != null ? `${s.wpm} слів/хв` : '—'); L.row('Слів у репліці', s.avgLen != null ? fmt(s.avgLen) : '—');
    L.para('Динаміка з\'явиться після другої голосової розмови.', { size: 8.5, color: C.dim });
  } else L.empty('Голосових розмов з достатнім обсягом мовлення ще не було.');

  // ================= 7. План =================
  L.chapter(7, 'План на наступний місяць', 'Що робити, щоб прогрес був швидшим');
  L.section('Рекомендації вчителя');
  const rec = recommendations(D, gs);
  rec.forEach((r, i) => {
    L.font('body', 9.8);
    const lines = doc.splitTextToSize(r, W - 10);
    const h = lines.length * 4.2 + 3;
    L.need(h + 1);
    doc.setFillColor(...C.accentSoft); doc.circle(M + 3, L.y + 3.3, 3, 'F');
    L.font('head', 8.5, C.accent); doc.text(String(i + 1), M + 3, L.y + 4.5, { align: 'center' });
    L.font('body', 9.8, C.ink); doc.text(lines, M + 9, L.y + 4.3);
    L.y += h + 1;
  });
  if (anFresh?.plan_14_days?.length) {
    L.section('План на 14 днів від вчителя');
    anFresh.plan_14_days.slice(0, 4).forEach(b => {
      L.para(`${clean(b.day_range)} — ${clean(b.focus)}`, { size: 9.5, kind: 'bold', gap: 1 });
      (b.activities || []).slice(0, 4).forEach(a => L.bullet(clean(a.text_uk), { size: 9 }));
    });
  }
  const tip = store.prof().weeklyTip?.data;
  if (tip?.summary_uk || tip?.goal_uk) {
    L.section('Порада тижня');
    if (tip.summary_uk) L.para(clean(tip.summary_uk), { size: 9.5 });
    if (tip.goal_uk) L.para(`Мета: ${clean(tip.goal_uk)}`, { size: 9.5, kind: 'bold' });
  }

  L.section('Як читати цей звіт');
  [
    ['Рівні CEFR', 'Європейська шкала знання мови: A1 — початковий, A2 — базовий, B1 — середній (вільно в побуті й подорожах), B2 — вище середнього (робота й навчання англійською), C1 — просунутий.'],
    ['Опанування рівня', 'Частка пройдених уроків граматики (60%) і закріплених слів (40%) рівня. Від 80% можна складати іспит рівня й переходити далі.'],
    ['Активний день', 'День, коли учень займався щонайменше 5 хвилин. Рахується лише час реальної активності, без простою.'],
    ['Закріплене слово', 'Слово, яке учень згадав настільки впевнено, що наступне повторення — не раніше ніж через 7 днів.'],
    ['Закрита помилка', 'Помилка, яку учень потім кілька разів ужив правильно в різні дні.'],
    ['Рівень у розмовах', 'Оцінка вчителя за кількома останніми розмовами з урахуванням обсягу мовлення; при малому обсязі вона позначена як непевна.'],
  ].forEach(([a, b]) => { L.need(10); L.para(a, { size: 9, kind: 'bold', gap: 0.6 }); L.para(b, { size: 8.6, color: C.dim, gap: 2 }); });

  // ---- колонтитули ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('Onest', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.dim);
    doc.text(`myEnglish · звіт вчителя за ${R.title.toLowerCase()}${name ? ` · ${name}` : ''}`, M, A4.h - 8);
    doc.text(`${p} / ${pages}`, A4.w - M, A4.h - 8, { align: 'right' });
  }
  doc.setProperties({ title: `myEnglish — звіт вчителя за ${R.title}`, subject: 'Прогрес в англійській', creator: 'myEnglish' });
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
