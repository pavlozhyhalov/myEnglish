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
// рядок-джерело регулярного виразу (new RegExp('…')) — не текст інтерфейсу
const REGEXY = /\(\?[:!=]|\[\^|\\\\[sbdw]|\\[sbdw]|\[[^\]]*[a-zа-я]-[a-zа-я]|^a-z/;

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
function unescapeJs(s) { return s.replace(/\\u\{?([0-9a-fA-F]{4,5})\}?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\'); }

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

/** Вирази ${…} шаблонного рядка (з урахуванням вкладених дужок) */
function exprs(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw.startsWith('${', i)) {
      let depth = 1, j = i + 2;
      while (j < raw.length && depth) { if (raw[j] === '{') depth++; else if (raw[j] === '}') depth--; j++; }
      out.push(raw.slice(i + 2, j - 1)); i = j - 1;
    }
  }
  return out;
}
const jsFiles = walk(path.join(ROOT, 'js'), '.js');
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // коментарі не беремо
  scan(src, f);   // коментарі й /regex/ пропускає сам токенізатор
}
/** Рядки в коді — токенізатор: '…', "…", `…${…}…` з вкладеними шаблонами; вирази ${…} скануються теж
 *  (plural(n, 'урок', …), умовні підписи). Регулярні вирази /…/ пропускаються грубо — у них кирилиці немає. */
function scan(code, f) {
  let i = 0;
  const n = code.length;
  function skipRe(at) {                  // at — на «/» регулярного виразу; повертає індекс після прапорців
    let j = at + 1, cls = false;
    while (j < n && code[j] !== '\n') { const d = code[j]; if (d === '\\') { j += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; j++; }
    j++; while (j < n && /[a-z]/.test(code[j])) j++;
    return j;
  }
  function readQuoted(q) {               // i — на відкривній лапці
    let j = i + 1, out = '';
    while (j < n && code[j] !== q && code[j] !== '\n') { if (code[j] === '\\') { out += code[j] + code[j + 1]; j += 2; } else out += code[j++]; }
    i = j + 1; return out;
  }
  function readTemplate() {              // i — на `; повертає { raw, exprs }
    let j = i + 1, raw = '';
    const ex = [];
    while (j < n && code[j] !== '`') {
      if (code[j] === '\\') { raw += code[j] + code[j + 1]; j += 2; continue; }
      if (code[j] === '$' && code[j + 1] === '{') {
        let depth = 1, k = j + 2, pv = '{';
        while (k < n && depth) {
          const c = code[k];
          if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(pv)) { k = skipRe(k); pv = 'x'; continue; }
          if (!/\s/.test(c)) pv = c;
          if (c === "'" || c === '"') { const save = i; i = k; readQuoted(c); k = i; i = save; continue; }
          if (c === '`') { const save = i; i = k; readTemplate(); k = i; i = save; continue; }
          if (c === '{') depth++; else if (c === '}') depth--;
          k++;
        }
        const e = code.slice(j + 2, k - 1);
        ex.push(e); raw += '${' + e + '}'; j = k; continue;
      }
      raw += code[j++];
    }
    i = j + 1; return { raw, ex };
  }
  let prev = '';                         // останній значущий символ — щоб відрізнити /regex/ від ділення
  while (i < n) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|case|of|in)$/.test(code.slice(Math.max(0, i - 8), i).trimEnd()))) {
      i = skipRe(i); prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    if (c === "'" || c === '"') {
      const raw = readQuoted(c);
      if (CYR.test(raw) && !REGEXY.test(raw)) { const s = unescapeJs(raw).trim(); if (s) keys.add(s); }
    } else if (c === '`') {
      const { raw, ex } = readTemplate();
      if (!CYR.test(raw)) continue;
      if (!ex.length) { if (!REGEXY.test(raw)) { const s = unescapeJs(raw).trim(); if (s) keys.add(s); } continue; }
      const body = unescapeJs(raw).trim();
      const textOnly = body.replace(/\$\{[\s\S]*?\}/g, '');
      // `Історія${n ? ` · ${n}` : ''}` — без умовної частини лишається сам текст до першого ${
      const head = body.split('${')[0].trim();
      if (head && CYR.test(head) && !REGEXY.test(head) && body.trimEnd().endsWith("}")) keys.add(head);
      const isRegex = /\(\?[:!=]|\[\^|\\[sbdw]/.test(textOnly);    // new RegExp(`…${x}…`) — не текст інтерфейсу
      if (CYR.test(textOnly) && !isRegex) { const { re: rx } = templateToRe(body); if (!pats.has(rx)) pats.set(rx, { re: rx, src: body, file: path.relative(ROOT, f) }); }
      for (const e of ex) scan(e, f);
    } else i++;
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
// книги й оповідання — англійський текст; з них беремо лише каталоги (назви й автори українською)
const dataFiles = walk(path.join(ROOT, 'data'), '.json', [path.join('data', 'books'), path.join('data', 'stories'), path.join('data', 'l10n')])
  .concat(['data/books/index.json'].map(p => path.join(ROOT, p)))
  .concat(walk(path.join(ROOT, 'data', 'stories'), '.json'))                                    // словнички й питання оповідань
  .concat(fs.readdirSync(path.join(ROOT, 'data', 'books'), { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => path.join(ROOT, 'data', 'books', e.name, 'glossary.json')).filter(p => fs.existsSync(p)));   // словнички книг (розділи — англійською)
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
