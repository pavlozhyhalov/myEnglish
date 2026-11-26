// Мови інтерфейсу й змісту (2026-11-24, власник: «вибір мови, щоб могли користуватися люди з інших країн»).
// Підхід як у Резонансі: база — українська прямо в коді; для інших мов — словник «український рядок → переклад».
//   i18n/<lang>.json          — рядки інтерфейсу { "Головна": "Inicio", … }
//   i18n/<lang>.patterns.json — рядки з числами/змінними [[ "^Стрік: (\\d+) (?:день|дні|днів) поспіль$", "Racha: {$1|día|días} seguidos" ], …]
//   data/l10n/<lang>/<шлях>.json — зміст (колоди, уроки…) тим самим способом; підставляється в json() (js/data.js) і в DOM.
// Переклад DOM на льоту: текстові вузли й атрибути (aria-label, placeholder, title, alt), що точно збігаються з ключем або шаблоном.
// Не перекладаються: [lang="en"] (англійський зміст), [data-noi18n], поля вводу, текст, що ввів учень.

export const LANGS = [
  // region — культурний контекст прикладів і вчителя (власник 2026-11-24: «вчитель і вправи адаптуються під регіон; російська — під Україну»)
  { id: 'uk', name: 'Українська', en: 'Ukrainian', region: 'Ukraine' },
  { id: 'es', name: 'Español', en: 'Spanish', region: 'Spain and Latin America' },
  { id: 'pt', name: 'Português (Brasil)', en: 'Portuguese (Brazil)', region: 'Brazil' },
  { id: 'tr', name: 'Türkçe', en: 'Turkish', region: 'Turkey' },
  { id: 'pl', name: 'Polski', en: 'Polish', region: 'Poland' },
  { id: 'ru', name: 'Русский', en: 'Russian', region: 'Ukraine' },
  // англійська (2026-11-26): для учнів, чиєї мови немає, і перевірки App Store — пояснення простою англійською, реалії не адаптуються
  { id: 'en', name: 'English', en: 'English', region: 'international' },
];
// мова з'являється у виборі, коли її переклад готовий (scripts/check-i18n.js без прогалин) — до того її не видно нікому
const READY = new Set(['uk', 'es', 'pt', 'tr', 'pl', 'ru']);
// перегляд неготових мов (перевірка перекладу до запуску): localStorage['me:lang-preview'] = '1' або адреса з ?langpreview=1
try {
  if (typeof location !== 'undefined' && /[?&]langpreview=1/.test(location.search)) localStorage.setItem('me:lang-preview', '1');
  if (localStorage.getItem('me:lang-preview') === '1') LANGS.forEach(l => READY.add(l.id));
} catch { /* */ }
export const readyLangs = () => LANGS.filter(l => READY.has(l.id));
const IDS = new Set(LANGS.filter(l => READY.has(l.id)).map(l => l.id));
const KEY = 'me:lang';

/** Мова за налаштуваннями браузера (перший запуск) */
function detect() {
  // учні, що вже займалися на цьому пристрої (до появи мов), лишаються з українською — мову змінюють самі
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('me:') && k !== KEY && k !== 'me:lang-preview') return 'uk';
    }
  } catch { /* */ }
  const list = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  for (const raw of list) {
    const l = String(raw || '').toLowerCase().split('-')[0];
    if (l === 'uk') return 'uk';
    if (IDS.has(l)) return l;
    // російськомовні з Казахстану, Центральної Азії, Кавказу, Білорусі — російський інтерфейс (власник: «для всіх, крім Росії» — мову обирають самі)
    if (['be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'ka'].includes(l)) return 'ru';
  }
  return 'uk';
}

let current = 'uk';
try { const s = localStorage.getItem(KEY); current = IDS.has(s) ? s : detect(); } catch { current = detect(); }

export const lang = () => current;
export const langName = (id = current) => LANGS.find(l => l.id === id)?.name || id;
export const langEn = (id = current) => LANGS.find(l => l.id === id)?.en || 'Ukrainian';
export const isBase = () => current === 'uk';
/** Локаль дат і чисел мови інтерфейсу (ru — Україна) */
const LOCALES = { uk: 'uk-UA', es: 'es', pt: 'pt-BR', tr: 'tr-TR', pl: 'pl-PL', ru: 'ru-UA', en: 'en-GB' };
export const loc = () => LOCALES[current] || 'uk-UA';
export const regionOf = (id = current) => LANGS.find(l => l.id === id)?.region || 'Ukraine';

/** Змінити мову: запам'ятати й перезавантажити застосунок (словники, дані й DOM — з нуля) */
export function setLang(id, { reload = true } = {}) {
  if (!IDS.has(id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  const was = current;
  current = id;
  if (reload && was !== id && typeof location !== 'undefined') location.reload();
}

// ---------- словники ----------
const dict = new Map();          // інтерфейс + завантажений зміст
let patterns = [];               // [RegExp, replacement]
let plural = null;

async function getJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Завантажити словники інтерфейсу поточної мови (до першого рендера) */
export async function initI18n(build = '') {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  if (current === 'uk') return;
  plural = new Intl.PluralRules(current);
  const v = build ? `?v=${build}` : '';
  const [ui, pats] = await Promise.all([getJson(`i18n/${current}.json${v}`), getJson(`i18n/${current}.patterns.json${v}`)]);
  if (ui) for (const [k, val] of Object.entries(ui)) if (val) dict.set(k, val);
  // від конкретних до загальних: більше буквального тексту — раніше (інакше ^(.+?)$ перехоплював би все)
  // форма множини (?:урок|уроки|уроків) — теж буквальний текст (найкоротша форма), інакше «${n} уроків» відкидався б
  const literal = (re) => re.replace(/\(\?:([^)]*)\)/g, (_, a) => a.split('|').sort((x, y) => x.length - y.length)[0].replace(/\\./g, 'x'))
    .replace(/\(\.\+\?\)|\\./g, '').replace(/[\^$]/g, '').length;
  if (Array.isArray(pats)) patterns = pats.filter(p => Array.isArray(p) && p[0] && p[1] && literal(p[0]) >= 2)
    .sort((x, y) => literal(y[0]) - literal(x[0]))
    .map(([re, rep]) => { try { return [new RegExp(re.replace(/\(\.\+\?\)\$$/, '(.*?)$'), 'u'), rep]; } catch { return null; } }).filter(Boolean);
  // ↑ хвіст `${cond ? ' · прочитано' : ''}` буває порожнім — остання група може бути порожньою
  observe();
}

/** Додати переклади змісту (з data/l10n) у спільний словник DOM */
export function addDict(obj) { if (obj && current !== 'uk') for (const [k, v] of Object.entries(obj)) if (v && !dict.has(k)) dict.set(k, v); }

/** Підстановка у шаблон: $1… і {$1|one|few|many|other} — форма множини за правилами мови */
function fill(rep, m) {
  return rep.replace(/\{\$(\d)\|([^}]*)\}/g, (_, i, forms) => {
    // «7,5» / «7.5» — дробове (форма «other»/«few» за CLDR), пробіли тисяч прибираємо
    const n = Number(String(m[i] || '').replace(/[\s\u00a0]/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
    const f = forms.split('|');
    const cat = plural ? plural.select(n) : 'other';
    const byCat = { one: f[0], few: f[1] ?? f[f.length - 1], many: f[2] ?? f[f.length - 1], other: f[3] ?? f[f.length - 1] };
    const word = byCat[cat] ?? f[f.length - 1];
    return `${m[i]} ${word}`;
  }).replace(/\$(\d)/g, (_, i) => sub(m[i]));
}
/** Значення групи шаблону: український текст усередині теж перекладаємо («$1: …» з назвою розділу) */
function sub(v) {
  if (v == null) return '';
  const c = String(v).trim();
  if (!c || !CYR.test(c)) return v;
  const o = tr(c);
  return o == null ? v : String(v).replace(c, o);
}

/** Переклад рядка: точний збіг → шаблон → як є. Пробіли по краях зберігаються. */
export function t(s) {
  if (current === 'uk' || s == null) return s;
  const str = String(s);
  const core = str.trim();
  if (!core || !/[А-ЯІЇЄҐа-яіїєґ]/.test(core)) return str;
  const out = tr(core);
  if (out == null) return str;
  return str.replace(core, out);
}
function tr(core) {
  let out = one(core);
  // рядок, складений у коді з частин (`${a} · ${b}`, `${S.x}: ${n}`) — перекладаємо частини окремо
  if (out == null && /( · |: |, | — )/.test(core)) {
    const parts = core.split(/( · |: |, | — )/);
    let hit = false;
    const res = parts.map((p, i) => {
      if (i % 2) return p;
      const lead = p.match(/^\s*/)[0], c = p.trim();
      if (!c || !CYR.test(c)) return p;
      const v = tr(c);
      if (v != null) { hit = true; return lead + v; }
      return p;
    });
    if (hit) out = res.join('');
  }
  // «7 рядків», «~5 год» — число окремим виразом, слово — plural(n, …) у коді
  if (out == null) {
    const m = core.match(/^([~≈+−-]?\d[\d\s\u00a0.,–-]*)\s*(\S.*)$/u);
    if (m && CYR.test(m[2])) { const v = tr(m[2]); if (v != null) out = `${m[1].trimEnd()}${/\s/.test(core.slice(m[1].trimEnd().length, m[1].trimEnd().length + 1)) ? ' ' : ''}${v}`; }
  }
  // «Листопад 2026» — слово й число в кінці
  if (out == null) {
    const m = core.match(/^(.*\S)\s+(\d[\d\s\u00a0.,–-]*)$/u);
    if (m && CYR.test(m[1])) { const v = tr(m[1]); if (v != null) out = `${v} ${m[2]}`; }
  }
  return out;
}
function one(core) {
  let out = dict.get(core);
  // «Середній.» — ключ без кінцевої крапки
  if (out == null && /[.!?:]$/.test(core) && core.length > 2) { const v = dict.get(core.slice(0, -1)); if (v != null) return v + core.slice(-1); }
  if (out == null) {
    for (const [re, rep] of patterns) { const m = core.match(re); if (m) { out = fill(rep, m); break; } }
  }
  return out;
}

/** Багаторядковий текст поза DOM (поділитися, буфер обміну) — кожен рядок окремо */
export function tLines(text) { return current === 'uk' || text == null ? text : String(text).split('\n').map(l => t(l)).join('\n'); }

// ---------- переклад DOM на льоту ----------
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
const skip = (el) => !el || el.closest?.('[lang="en"],[data-noi18n],textarea,[contenteditable="true"],script,style') != null;

function doText(node) {
  const p = node.parentElement;
  if (!p || skip(p)) return;
  const v = node.nodeValue;
  const out = t(v);
  if (out !== v) node.nodeValue = out;
}
function doEl(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) { const out = t(v); if (out !== v) el.setAttribute(a, out); }
  }
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doEl(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? doText(n) : doEl(n);
}
let observer = null;
function observe() {
  if (observer || typeof MutationObserver === 'undefined') return;
  const run = () => walk(document.body);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doEl(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  });
  const start = () => { run(); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  // заголовок вкладки
  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(() => { const v = document.title, o = t(v); if (o !== v) document.title = o; }).observe(titleEl, { childList: true });
}

// ---------- зміст (data/l10n) ----------
const CYR = /[А-ЯІЇЄҐа-яіїєґ]/;
/** Замінити в об'єкті всі українські рядки, для яких є переклад (глибоко, на місці копії) */
export function localize(obj, map) {
  if (!map || current === 'uk') return obj;
  const get = (s) => {
    const core = s.trim();
    const v = map[core] ?? dict.get(core);
    return v ? s.replace(core, v) : s;
  };
  // англійські рядки (реалії прикладів, 2026-11-24, власник: «вчитель і вправи адаптуються під регіон мови») — лише точний збіг у словнику змісту
  const rec = (x) => {
    if (typeof x === 'string') return CYR.test(x) ? get(x) : (map[x.trim()] ? x.replace(x.trim(), map[x.trim()]) : x);
    if (Array.isArray(x)) return x.map(rec);
    if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = rec(v); return o; }
    return x;
  };
  return rec(obj);
}
