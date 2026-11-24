// Збирає всі українські рядки, які треба перекласти (js/i18n.js — словник «укр. рядок → переклад»).
//   node scripts/i18n-extract.js
// Пише:
//   i18n/_keys.json      — рядки інтерфейсу з js/**/*.js та index.html (без ${…})
//   i18n/_patterns.json  — шаблони з ${…}: { re, src } — re = регулярний вираз для i18n/<lang>.patterns.json
//   data/l10n/_keys/<шлях>.json — рядки змісту по файлах data/** (книги й оповідання — англійські, не беруться)
// Перекладачі пишуть i18n/<lang>.json, i18n/<lang>.patterns.json, data/l10n/<lang>/<шлях>.json. Перевірка — scripts/check-i18n.js.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CYR = /[А-ЯІЇЄҐа-яіїєґ]/;

function walk(dir, ext, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some(s => p.includes(s))) continue;
    if (e.isDirectory()) out.push(...walk(p, ext, skip));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// ---------- інтерфейс ----------
const keys = new Set();
const pats = new Map();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function unescapeJs(s) { return s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\'); }

/** Шаблонний рядок → регулярний вираз: plural(n,'a','b','c') → (?:a|b|c), інше ${…} → (.+?) */
function templateToRe(body) {
  let re = '', i = 0, groups = 0;
  while (i < body.length) {
    if (body.startsWith('${', i)) {
      let depth = 1, j = i + 2;
      while (j < body.length && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++; }
      const expr = body.slice(i + 2, j - 1);
      const pl = expr.match(/^\s*plural\([^,]+,\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\)\s*$/);
      if (pl) re += `(?:${[pl[1], pl[2], pl[3]].map(esc).join('|')})`;
      else { re += '(.+?)'; groups++; }
      i = j;
    } else { re += esc(body[i]); i++; }
  }
  return { re: `^${re.trim()}$`, groups };
}

const jsFiles = walk(path.join(ROOT, 'js'), '.js');
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // коментарі не беремо
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(code))) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!raw || !CYR.test(raw)) continue;
    if (m[3] != null && raw.includes('${')) {
      const body = unescapeJs(raw).trim();
      // шаблон, весь вміст якого — вирази, без власного тексту — не шаблон
      const textOnly = body.replace(/\$\{[\s\S]*?\}/g, '');
      if (!CYR.test(textOnly)) continue;
      const { re: rx } = templateToRe(body);
      if (!pats.has(rx)) pats.set(rx, { re: rx, src: body, file: path.relative(ROOT, f) });
      continue;
    }
    const s = unescapeJs(raw).trim();
    if (s) keys.add(s);
  }
}
// index.html — видимий текст
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/>([^<>]*[А-ЯІЇЄҐа-яіїєґ][^<>]*)</g)) keys.add(m[1].trim());
for (const m of html.matchAll(/(?:aria-label|title|placeholder|content)="([^"]*[А-ЯІЇЄҐа-яіїєґ][^"]*)"/g)) keys.add(m[1].trim());

fs.mkdirSync(path.join(ROOT, 'i18n'), { recursive: true });
const sortedKeys = [...keys].sort();
fs.writeFileSync(path.join(ROOT, 'i18n/_keys.json'), JSON.stringify(sortedKeys, null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'i18n/_patterns.json'), JSON.stringify([...pats.values()], null, 1) + '\n');

// ---------- зміст ----------
const dataFiles = walk(path.join(ROOT, 'data'), '.json', [path.join('data', 'books'), path.join('data', 'stories'), path.join('data', 'l10n')]);
let total = 0;
for (const f of dataFiles) {
  const set = new Set();
  const rec = (x) => {
    if (typeof x === 'string') { if (CYR.test(x)) set.add(x.trim()); }
    else if (Array.isArray(x)) x.forEach(rec);
    else if (x && typeof x === 'object') Object.values(x).forEach(rec);
  };
  rec(JSON.parse(fs.readFileSync(f, 'utf8')));
  if (!set.size) continue;
  const rel = path.relative(path.join(ROOT, 'data'), f);
  const out = path.join(ROOT, 'data/l10n/_keys', rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify([...set].sort(), null, 1) + '\n');
  total += set.size;
}
console.log(`UI: ${sortedKeys.length} рядків, ${pats.size} шаблонів · зміст: ${total} рядків у ${dataFiles.length} файлах`);
