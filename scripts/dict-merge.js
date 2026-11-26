// Офлайн-словник: data/dict/<lang>.part1.json + part2 → data/dict/<lang>.json (у порядку частоти зі scripts/dict-words.txt).
//   node scripts/dict-merge.js        — усі мови, для яких є частини
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'data/dict');
const words = fs.readFileSync(path.join(ROOT, 'scripts/dict-words.txt'), 'utf8').split('\n').filter(Boolean);
for (const lang of ['uk', 'es', 'pt', 'tr', 'pl', 'ru']) {
  const parts = fs.readdirSync(D).filter(f => f.startsWith(`${lang}.part`) && f.endsWith('.json'));
  if (!parts.length) continue;
  const all = {};
  for (const f of parts) Object.assign(all, JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')));
  const out = {};
  for (const w of words) { const v = all[w]; if (typeof v === 'string' && v.trim()) out[w] = v.trim(); }
  fs.writeFileSync(path.join(D, `${lang}.json`), JSON.stringify(out) + '\n');
  console.log(lang, Object.keys(out).length, 'слів,', Math.round(fs.statSync(path.join(D, `${lang}.json`)).size / 1024), 'КБ');
}
