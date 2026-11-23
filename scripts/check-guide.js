// Перевірка поля guide в уроках граматики (scripts/grammar-guide.md).
// node scripts/check-guide.js            — усі уроки з data/grammar/index.json
// node scripts/check-guide.js <файл.json> — один файл
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const files = args.length ? args : JSON.parse(fs.readFileSync(path.join(root, 'data/grammar/index.json'), 'utf8')).map(x => path.join(root, `data/grammar/${x.id}.json`));
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const CYR_RU = /[ыэъё]/i;   // російські літери в українському тексті
let bad = 0, missing = 0;
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const id = d.id || path.basename(f);
  const err = [];
  const g = d.guide;
  if (!g) { missing++; console.log(`· ${id}: немає guide`); continue; }
  const a0 = d.level === 'A0';
  if (!str(g.idea)) err.push('idea порожнє');
  else if (g.idea.length > (a0 ? 220 : 380)) err.push(`idea задовге (${g.idea.length})`);
  if (!Array.isArray(g.use) || g.use.length < 2 || g.use.length > 6) err.push('use: потрібно 2–6');
  for (const [i, u] of (g.use || []).entries()) {
    for (const k of ['when', 'note', 'en', 'uk']) if (!str(u?.[k])) err.push(`use[${i}].${k} порожнє`);
    if (str(u?.when) && (u.when.length > 60 || /\.$/.test(u.when))) err.push(`use[${i}].when: коротко й без крапки`);
  }
  if (!Array.isArray(g.vs) || g.vs.length > 3) err.push('vs: масив 0–3');
  for (const [i, v] of (g.vs || []).entries()) {
    if (!str(v?.title)) err.push(`vs[${i}].title`);
    for (const s of ['a', 'b']) for (const k of ['en', 'uk', 'note']) if (!str(v?.[s]?.[k])) err.push(`vs[${i}].${s}.${k}`);
  }
  if (!Array.isArray(g.signals) || g.signals.length > 12) err.push('signals: масив 0–12');
  if (!Array.isArray(g.mistakes) || g.mistakes.length < 2 || g.mistakes.length > 5) err.push('mistakes: потрібно 2–5');
  for (const [i, m] of (g.mistakes || []).entries()) {
    for (const k of ['wrong', 'right', 'why']) if (!str(m?.[k])) err.push(`mistakes[${i}].${k}`);
    if (str(m?.wrong) && m.wrong.trim() === String(m.right || '').trim()) err.push(`mistakes[${i}]: wrong = right`);
  }
  const uk = [g.idea, ...(g.use || []).flatMap(u => [u.when, u.note, u.uk]), ...(g.vs || []).flatMap(v => [v.title, v.a?.uk, v.a?.note, v.b?.uk, v.b?.note]), ...(g.mistakes || []).map(m => m.why), d.explanation].join(' ');
  if (CYR_RU.test(uk)) err.push('російські літери (ы/э/ъ/ё) в українському тексті');
  if (/<[a-z]/i.test(JSON.stringify(g))) err.push('HTML у guide');
  if (!str(d.explanation)) err.push('explanation порожнє');
  if (err.length) { bad++; console.log(`✗ ${id}: ${err.join('; ')}`); }
}
console.log(`\n${files.length} файлів · без guide: ${missing} · з помилками: ${bad}`);
process.exit(bad ? 1 : 0);
