// Прогалини перекладу по мовах (js/i18n.js). Спершу node scripts/i18n-extract.js.
//   node scripts/check-i18n.js            — підсумок по всіх мовах
//   node scripts/check-i18n.js es --list  — список відсутніх рядків мови es
// Перевіряє й якість: переклад не порожній, не лишився українським (кирилиця в не-ru мовах), у ru немає «на Украине».
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LANGS = ['es', 'pt', 'tr', 'pl', 'ru', 'en'];
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const UKR_ONLY = /[ІіЇїЄєҐґ]/;   // українські літери, яких немає в російській
const args = process.argv.slice(2);
const only = args.find(a => LANGS.includes(a));
const list = args.includes('--list');

const keys = read('i18n/_keys.json', []);
const pats = read('i18n/_patterns.json', []);
const contentFiles = [];
(function walk(d) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.json')) contentFiles.push(p);
  }
})('data/l10n/_keys');

let bad = 0;
for (const lang of only ? [only] : LANGS) {
  const ui = read(`i18n/${lang}.json`, {});
  const up = new Set(read(`i18n/${lang}.patterns.json`, []).map(p => p[0]));
  // en: кирилиця дозволена в лапках (цитоване українське слово: «How do you say 'ложка'…») і в назві мови «Русский»
  const unq = (v) => lang === 'en' ? String(v).replace(/['‘’“”«»"][^'‘’“”«»"]*['‘’“”«»"]/g, '').replace(/^Русский$/, '') : v;
  const quality = (v) => !v ? 'порожньо' : (lang !== 'ru' && /[А-Яа-яЁё]/.test(unq(v))) ? 'кирилиця' : (lang === 'ru' && UKR_ONLY.test(v)) ? 'українські літери' : (lang === 'ru' && /на Украин/.test(v)) ? '«на Украине»' : null;
  const missUi = keys.filter(k => !ui[k]);
  const badUi = keys.filter(k => ui[k] && quality(ui[k])).map(k => `${k} → ${ui[k]} (${quality(ui[k])})`);
  const missPat = pats.filter(p => !up.has(p.re));
  let missC = 0, totalC = 0; const missList = [], badC = [];
  for (const kf of contentFiles) {
    const ks = read(kf, []);
    const tr = read(kf.replace('data/l10n/_keys', `data/l10n/${lang}`), {});
    totalC += ks.length;
    for (const k of ks) {
      if (!tr[k]) { missC++; if (list) missList.push(`${kf.replace('data/l10n/_keys/', '')}: ${k.slice(0, 80)}`); }
      else if (quality(tr[k])) badC.push(`${kf}: ${k.slice(0, 40)} → ${String(tr[k]).slice(0, 40)} (${quality(tr[k])})`);
    }
  }
  const ok = !missUi.length && !missPat.length && !missC && !badUi.length && !badC.length;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${lang}: інтерфейс ${keys.length - missUi.length}/${keys.length} · шаблони ${pats.length - missPat.length}/${pats.length} · зміст ${totalC - missC}/${totalC}${badUi.length + badC.length ? ` · сумнівних ${badUi.length + badC.length}` : ''}`);
  if (list) {
    for (const k of missUi.slice(0, 200)) console.log('  UI  ', k);
    for (const p of missPat.slice(0, 100)) console.log('  PAT ', p.re);
    for (const k of missList.slice(0, 200)) console.log('  DATA', k);
    for (const k of [...badUi, ...badC].slice(0, 100)) console.log('  ?   ', k);
  }
}
process.exit(bad ? 1 : 0);
