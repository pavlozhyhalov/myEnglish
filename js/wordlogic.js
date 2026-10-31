// Логіка тренування слів: перевірка відповідей, дистрактори, етапи слова, автоматична оцінка FSRS.
// Чисті функції без DOM і сховища (покриті node-тестами); сторінка — js/pages/wordtrain.js.

// ---------- Нормалізація ----------
const CONTR = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "don't": 'do not', "doesn't": 'does not',
  "didn't": 'did not', "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not', "won't": 'will not', "wouldn't": 'would not',
  "can't": 'cannot', "couldn't": 'could not', "shouldn't": 'should not', "mustn't": 'must not', "i've": 'i have', "you've": 'you have',
  "we've": 'we have', "they've": 'they have', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will',
  "i'd": 'i would', "you'd": 'you would', "let's": 'let us', "there's": 'there is', "that's": 'that is', "what's": 'what is',
  // без апострофа (iOS-клавіатура без автозаміни): лише однозначні
  im: 'i am', dont: 'do not', doesnt: 'does not', didnt: 'did not', cant: 'cannot', isnt: 'is not', arent: 'are not',
  wasnt: 'was not', werent: 'were not', havent: 'have not', hasnt: 'has not', couldnt: 'could not', shouldnt: 'should not',
  wouldnt: 'would not', ive: 'i have', youre: 'you are', theyre: 'they are', thats: 'that is', whats: 'what is', theres: 'there is',
  'can not': 'cannot',
};
const ARTICLES = new Set(['a', 'an', 'the']);
// «to look after sb»: місця для доповнення — у відповіді учня не обов'язкові
const PLACEHOLDER = new Set(['sb', 'sth', 'smb', 'smth', 'somebody', 'something', 'someone', "one's", "sb's", "someone's"]);

/** Нижній регістр, єдині апострофи, без розділових знаків і «…», скорочення розгорнуті */
export function norm(s) {
  // «café» → «cafe»: діакритика не важить (і не обрізає слово)
  let t = String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`ʼ´]/g, "'").replace(/…|\.\.\./g, ' ').replace(/[–—-]/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.split(' ').map(w => CONTR[w] || w).join(' ');
  return t.replace(/(^| )'+|'+( |$)/g, '$1$2').replace(/\s+/g, ' ').trim();
}

/** Ключ для порівняння тексту будь-якою мовою (дублікати варіантів) */
export const textKey = (s) => String(s ?? '').toLowerCase().replace(/[’‘`ʼ]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Ядро для порівняння: без «to»/артикля на початку і без «sb/sth» (якщо щось лишається) */
export function core(s) {
  const words = norm(s).split(' ').filter(Boolean);
  while (words.length > 1 && (words[0] === 'to' || ARTICLES.has(words[0]))) words.shift();
  const kept = words.filter(w => !PLACEHOLDER.has(w));
  return (kept.length ? kept : words).join(' ');
}

/** Картка-речення («The flight is delayed.», «How are you?») */
export const isSentence = (en) => /[.?!…]$/.test(String(en || '').trim()) && String(en).trim().split(/\s+/).length >= 2;

/** Кількість слів у ядрі */
export const wordCount = (en) => core(en).split(' ').filter(Boolean).length;

/**
 * Варіанти запису картки: «to miss a flight / train» → «to miss a flight», «to miss a train»;
 * «(to) look» → «to look», «look»; «colour (color)» → «colour», «color».
 */
export function variants(en) {
  const src = String(en || '').trim();
  const out = new Set();
  const parts = src.split(/\s*\/\s*/).filter(Boolean);
  const first = (parts[0] || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
  parts.forEach((p, i) => {
    let base = p.trim();
    // одиночне слово після «/» замінює останнє слово першого варіанта, якщо той — фраза
    if (i > 0 && !/\s/.test(base) && first.length - (/^(to|a|an|the)$/i.test(first[0]) ? 1 : 0) > 1 && !/\(/.test(base)) base = [...first.slice(0, -1), base].join(' ');
    const paren = base.match(/\(([^)]*)\)/);
    const without = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (without) out.add(without);
    if (paren) {
      const inner = paren[1].trim();
      const withIt = base.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
      // «colour (color)» — у дужках альтернатива; «(to) look», «look (at)» — необов'язкова частина;
      // «(formal: to start)», «(advice, argument)» — пояснення, не частина відповіді
      if (/[:,]/.test(inner)) { /* пояснення */ }
      else if (/^\w+$/.test(without) && /^\w+$/.test(inner) && inner.length > 3) out.add(inner);
      else if (withIt) out.add(withIt);
    }
  });
  // «one-way / return ticket», «to be on maternity / paternity leave»: спільне останнє слово стоїть лише після другого варіанта
  if (parts.length === 2) {
    const strip = (ws) => (/^(to|a|an|the)$/i.test(ws[0]) && ws.length > 1 ? ws.slice(1) : ws);
    const a = parts[0].replace(/\([^)]*\)/g, ' ').trim().split(/\s+/), b = parts[1].replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
    const bc = strip(b);
    if (bc.length === 2 && a[0].toLowerCase() !== b[0].toLowerCase() && strip(a)[0]?.toLowerCase() !== bc[0].toLowerCase() && a[a.length - 1].toLowerCase() !== bc[1].toLowerCase()) {
      out.add([...a, bc[1]].join(' '));
      if (strip(a).length > 1) out.add([...a.slice(0, -1), ...bc].join(' '));
    }
  }
  return [...out];
}

/**
 * Як показати картку у варіантах відповіді, плитках і як еталон для друку: цілком, без пояснень у дужках.
 * («aunt / uncle» — обидва слова, бо й переклад «тітка / дядько»; «to be on maternity / paternity leave» — не обрізаємо)
 */
export function shown(en) {
  return String(en || '').replace(/\s*\([^)]*[:,][^)]*\)/g, '').replace(/\s+/g, ' ').trim() || String(en || '');
}

/** Відстань Левенштейна з перестановкою сусідніх літер (recieve → receive — одна описка) */
export function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Скільки описок допускаємо: слово від 5 літер — одна, довга фраза (від 14 літер) — дві */
export function typoAllowance(expectedCore) {
  const letters = expectedCore.replace(/[^a-z]/g, '').length;
  return letters >= 14 && expectedCore.includes(' ') ? 2 : letters >= 5 ? 1 : 0;
}

// Британський і американський правопис — та сама відповідь (обидва боки зводяться до одного ключа)
const SPELL = {
  grey: 'gray', tyre: 'tire', tyres: 'tires', programme: 'program', programmes: 'programs', cheque: 'check', mum: 'mom', mummy: 'mommy',
  pyjamas: 'pajamas', jewellery: 'jewelry', aluminium: 'aluminum', kerb: 'curb', storey: 'story', draught: 'draft', sceptical: 'skeptical',
  enrol: 'enroll', fulfil: 'fulfill', practise: 'practice', practised: 'practiced', practising: 'practicing', licence: 'license',
  defence: 'defense', offence: 'offense', pretence: 'pretense', judgement: 'judgment', ageing: 'aging', mould: 'mold', moustache: 'mustache',
  cosy: 'cozy', doughnut: 'donut', axe: 'ax', plough: 'plow', manoeuvre: 'maneuver', oestrogen: 'estrogen', paediatrician: 'pediatrician',
};
function spellWord(w) {
  if (SPELL[w]) return SPELL[w];
  return w.replace(/^([a-z]{2,})our(s|ed|ing|ite|ites|able|ful|less|er|ers)?$/, '$1or$2')       // colour, favourite, neighbour
    .replace(/^([a-z]{2,})is(e|es|ed|ing|ation|ations|er|ers)$/, '$1iz$2')                       // organise, realise, apologise
    .replace(/yse(s|d)?$/, 'yze$1')                                                               // analyse
    .replace(/^([a-z]{3,}[^aeiou])re(s)?$/, '$1er$2')                                             // centre, theatre, metre
    .replace(/^([a-z]{2,}[ea])ll(ed|ing|er|ers)$/, '$1l$2')                                       // travelled, cancelled
    .replace(/^([a-z]{2,})ogue(s)?$/, '$1og$2');                                                  // catalogue, dialogue
}
const spellKey = (t) => t.split(' ').map(spellWord).join(' ');

// Справжні слова, які легко сплутати: описка в одну літеру тут — інше слово, а не помилка друку
const CONFUSABLE = new Set(('quite quiet lose loose three there their affect effect desert dessert dairy diary angel angle then than form from '
  + 'were where accept except advice advise though through thought tough later latter cloth clothes breath breathe horse house hose whole hole '
  + 'weather whether price prize alone along bored board steal steel sweat sweet pray prey cook cooker wonder wander chicken kitchen sheep ship '
  + 'sleep slip feel fill full fool fell live life leave lend land personal personnel career carrier device devise county country casual causal '
  + 'dinner diner super supper latest lately lighting lightning').split(' '));

/** Слова фрази для зіставлення з «sb/sth» на місці (без «to» і артикля на початку) */
function slotWords(v) {
  const w = norm(v).split(' ').filter(Boolean);
  while (w.length > 1 && (w[0] === 'to' || ARTICLES.has(w[0]))) w.shift();
  return w;
}
/** «put it off» ~ «put sth off», «look after my mum» ~ «look after sb»: місце доповнення — 1–3 слова */
function slotMatch(inp, pat, i = 0, j = 0) {
  if (j === pat.length) return i === inp.length;
  if (PLACEHOLDER.has(pat[j])) {
    for (let k = 1; k <= 3 && i + k <= inp.length; k++) if (slotMatch(inp, pat, i + k, j + 1)) return true;
    return false;
  }
  return i < inp.length && spellWord(inp[i]) === spellWord(pat[j]) && slotMatch(inp, pat, i + 1, j + 1);
}

/**
 * Перевірити введене слово.
 * → { ok, almost, expected, empty } — almost: зараховано з опискою (показати виправлення, оцінка «Важко»)
 * known — ядра інших слів (core): якщо учень написав інше відоме слово, це не описка
 */
export function checkTyped(input, en, { known = null } = {}) {
  const i = core(input);
  const vars = variants(en);
  // пара «aunt / uncle» цілком — теж правильно
  const whole = String(en || '').replace(/\([^)]*\)/g, ' ').trim();
  if (whole && whole.includes('/') && !vars.includes(whole)) vars.push(whole);
  const expected = vars[0] || String(en || '');
  if (!i) return { ok: false, almost: false, expected, empty: true };
  const iKey = spellKey(i), iWords = slotWords(input);
  for (const v of vars) {
    const c = core(v);
    if (i === c || iKey === spellKey(c)) return { ok: true, almost: false, expected: v };
    const pat = slotWords(v);
    if (pat.some(w => PLACEHOLDER.has(w)) && slotMatch(iWords, pat)) return { ok: true, almost: false, expected: v };
  }
  const realWord = !i.includes(' ') && (CONFUSABLE.has(i) || known?.has(i));
  let best = Infinity, bestVar = expected;
  for (const v of vars) {
    const c = core(v);
    if (realWord && !c.includes(' ')) continue;
    // без пробілів: «every day» / «everyday», «ice cream» / «ice-cream» — описка, не помилка
    // «T-shirt» / «tshirt» — те саме слово
    if (/-/.test(v) && i.replace(/ /g, '') === c.replace(/ /g, '')) return { ok: true, almost: false, expected: v };
    const d = i.replace(/ /g, '') === c.replace(/ /g, '') ? 1 : Math.min(levenshtein(i, c), levenshtein(iKey, spellKey(c)));
    if (d <= typoAllowance(c) && d < best) { best = d; bestVar = v; }
  }
  if (best < Infinity) return { ok: true, almost: true, expected: bestVar };
  return { ok: false, almost: false, expected };
}

// ---------- Форми слова ----------
// Неправильні дієслова: основа → форми (для пропуску в реченні й пошуку слів в історії)
const IRR = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'], do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone'], make: ['made'], take: ['took', 'taken'], get: ['got', 'gotten', 'getting'], come: ['came'], see: ['saw', 'seen'],
  know: ['knew', 'known'], think: ['thought'], tell: ['told'], say: ['said'], find: ['found'], give: ['gave', 'given'], leave: ['left'],
  feel: ['felt'], keep: ['kept'], buy: ['bought'], bring: ['brought'], begin: ['began', 'begun'], run: ['ran', 'running'], write: ['wrote', 'written'],
  speak: ['spoke', 'spoken'], eat: ['ate', 'eaten'], drink: ['drank', 'drunk'], sleep: ['slept'], meet: ['met'], pay: ['paid'], sell: ['sold'],
  send: ['sent'], spend: ['spent'], build: ['built'], teach: ['taught'], catch: ['caught'], fight: ['fought'], choose: ['chose', 'chosen'],
  fall: ['fell', 'fallen'], grow: ['grew', 'grown'], drive: ['drove', 'driven'], ride: ['rode', 'ridden'], fly: ['flew', 'flown', 'flies'],
  forget: ['forgot', 'forgotten'], understand: ['understood'], stand: ['stood'], sit: ['sat', 'sitting'], win: ['won', 'winning'], lose: ['lost'],
  hear: ['heard'], hold: ['held'], lead: ['led'], mean: ['meant'], become: ['became'], break: ['broke', 'broken'], wear: ['wore', 'worn'],
  wake: ['woke', 'woken'], lend: ['lent'], hide: ['hid', 'hidden'], shake: ['shook', 'shaken'], steal: ['stole', 'stolen'], swim: ['swam', 'swum', 'swimming'],
  sing: ['sang', 'sung'], ring: ['rang', 'rung'], throw: ['threw', 'thrown'], draw: ['drew', 'drawn'], freeze: ['froze', 'frozen'], bite: ['bit', 'bitten'],
  feed: ['fed'], deal: ['dealt'], dig: ['dug'], hang: ['hung'], lay: ['laid'], lie: ['lay', 'lain', 'lying', 'lied'], rise: ['rose', 'risen'],
  seek: ['sought'], shoot: ['shot'], spread: ['spread'], strike: ['struck'], tear: ['tore', 'torn'], wind: ['wound'], put: ['putting'], cut: ['cutting'],
  set: ['setting'], let: ['letting'], shut: ['shutting'], hit: ['hitting'], read: ['read'], light: ['lit'], bear: ['bore', 'born', 'borne'],
  forgive: ['forgave', 'forgiven'], overcome: ['overcame'], withdraw: ['withdrew', 'withdrawn'], undertake: ['undertook', 'undertaken'],
  child: ['children'], man: ['men'], woman: ['women'], person: ['people'], foot: ['feet'], tooth: ['teeth'], mouse: ['mice'],
  life: ['lives'], wife: ['wives'], knife: ['knives'], leaf: ['leaves'], half: ['halves'], shelf: ['shelves'],
  good: ['better', 'best'], bad: ['worse', 'worst'], far: ['further', 'farther'],
};
const VOWEL = /[aeiou]/;

/** Можливі форми слова: множина/3-тя особа, минулий час, -ing, ступені порівняння, неправильні форми */
export function inflections(word) {
  const w = String(word || '').toLowerCase();
  const out = new Set([w]);
  if (!/^[a-z']+$/.test(w) || w.length < 2) return out;
  for (const f of IRR[w] || []) out.add(f);
  const add = (x) => out.add(x);
  add(w + 's'); add(w + "'s");
  if (/(s|x|z|ch|sh|o)$/.test(w)) add(w + 'es');
  if (/[^aeiou]y$/.test(w)) { const b = w.slice(0, -1); add(b + 'ies'); add(b + 'ied'); add(b + 'ier'); add(b + 'iest'); add(b + 'ily'); }
  if (w.endsWith('e')) { add(w + 'd'); add(w.slice(0, -1) + 'ing'); add(w + 'r'); add(w + 'st'); }
  else { add(w + 'ed'); add(w + 'ing'); add(w + 'er'); add(w + 'est'); }
  // stop → stopped, plan → planning (CVC наприкінці)
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w) && w.length <= 6) { const d = w + w.slice(-1); add(d + 'ed'); add(d + 'ing'); add(d + 'er'); add(d + 'est'); }
  if (w.endsWith('ie')) add(w.slice(0, -2) + 'ying');
  if (w.endsWith('ic')) add(w + 'ally');
  if (!w.endsWith('ly') && VOWEL.test(w)) add(w.endsWith('le') ? w.slice(0, -1) + 'y' : w + 'ly');
  return out;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Регулярний вираз для пошуку фрази картки в реченні з урахуванням форм слова (null — нема що шукати) */
export function phraseRegex(en) {
  const words = norm(String(en || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean);
  while (words.length > 1 && words[0] === 'to') words.shift();
  while (words.length > 1 && PLACEHOLDER.has(words[words.length - 1])) words.pop();
  const parts = [];
  let content = 0;
  for (const w of words) {
    if (ARTICLES.has(w)) { parts.push({ opt: '(?:(?:a|an|the)\\s+)?' }); continue; }
    if (PLACEHOLDER.has(w)) { parts.push({ re: "(?:[A-Za-z'’]+\\s+){0,3}?", ph: true }); continue; }
    if (w === 'your' || w === 'my') { parts.push({ re: '(?:my|your|his|her|its|our|their)' }); continue; }
    if (w === 'oneself' || w === 'yourself') { parts.push({ re: '(?:myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)' }); continue; }
    content++;
    const forms = [...inflections(w)].sort((a, b) => b.length - a.length).map(f => escRe(f).replace(/'/g, "['’]"));
    parts.push({ re: `(?:${forms.join('|')})` });
  }
  if (!content) return null;
  let src = '';
  parts.forEach((p, i) => {
    // артикль і місце доповнення несуть власний пробіл; між словами — пробіл, якщо далі ще є слово
    if (p.opt || p.ph) { src += p.opt || p.re; return; }
    src += p.re;
    if (parts.slice(i + 1).some(x => !x.opt && !x.ph)) src += '[\\s-]+';   // «T-shirt», «check-up»
  });
  return new RegExp(`(^|[^A-Za-z'’])(${src})(?![A-Za-z'’])`, 'i');
}

/** Знайти фразу в тексті: { start, end, text } або null */
export function findInText(text, en) {
  const s = String(text || '');
  // «café» ~ «cafe»: шукаємо в копії без діакритики тієї самої довжини, текст — з оригіналу
  const flat = s.replace(/[\u00C0-\u024F]/g, ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0) || ch);
  for (const v of variants(en).concat([String(en || '')])) {
    const re = phraseRegex(v);
    if (!re) continue;
    const m = flat.match(re);
    if (m) { const start = m.index + m[1].length; return { start, end: start + m[2].length, text: s.slice(start, start + m[2].length) }; }
  }
  return null;
}

/** Пропуск у прикладі: { before, answer, after, uk } або null (немає прикладу, фраза задовга або займає майже все речення) */
export function clozeOf(card) {
  const ex = card?.examples?.[0];
  if (!ex?.en || wordCount(card.en) > 4) return null;
  const hit = findInText(ex.en, card.en);
  if (!hit) return null;
  // артикль лишається перед пропуском: «The _____ is closed.» → «shop», а не «The shop»
  const art = hit.text.match(/^(?:a|an|the)\s+/i);
  if (art && hit.text.length > art[0].length) { hit.start += art[0].length; hit.text = hit.text.slice(art[0].length); }
  const letters = (x) => x.replace(/[^A-Za-z]/g, '').length;
  if (letters(hit.text) > letters(ex.en) * 0.6) return null;
  return { before: ex.en.slice(0, hit.start), answer: hit.text, after: ex.en.slice(hit.end), uk: ex.uk || '' };
}

/** Перевірка пропуску: точна форма — так; інша форма того самого слова або описка — «майже» */
export function checkCloze(input, cl, en) {
  const i = norm(input), a = norm(cl.answer);
  if (!i) return { ok: false, almost: false, expected: cl.answer, empty: true };
  if (i === a || spellKey(i) === spellKey(a) || i.replace(/^(a|an|the) /, '') === a) return { ok: true, almost: false, expected: cl.answer };
  const re = phraseRegex(en);
  const m = re && String(input).trim().match(re);
  if (m && norm(m[2]) === i) return { ok: true, almost: true, expected: cl.answer };
  if (levenshtein(i, a) <= typoAllowance(a)) return { ok: true, almost: true, expected: cl.answer };
  const t = checkTyped(input, en);
  if (t.ok) return { ok: true, almost: true, expected: cl.answer };
  return { ok: false, almost: false, expected: cl.answer };
}

// ---------- Дистрактори ----------
/** Значення українського перекладу: «кинути, здатися (з ліжка)» → ['кинути', 'здатися'] */
export function senses(uk) {
  return String(uk || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\([^)]*\)/g, ' ')
    .split(/[,;/]|\s+або\s+|\s+чи\s+/).map(s => s.replace(/[.!?…«»"]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const UK_STOP = new Set(['щось', 'когось', 'комусь', 'чомусь', 'кимось', 'себе', 'собі', 'дуже', 'який', 'яка', 'яке', 'такий', 'бути', 'мати', 'свій', 'своє', 'свою']);
const stem = (w) => w.length >= 6 ? w.slice(0, 5) : w;
const contentWords = (s) => s.split(/[\s'-]+/).filter(w => w.length >= 4 && !UK_STOP.has(w));

/** Чи можуть два переклади бути синонімами (тоді обидва варіанти «правильні» — дистрактор не годиться) */
export function ukConflict(a, b) {
  const A = senses(a), B = senses(b);
  if (!A.length || !B.length) return false;
  for (const x of A) for (const y of B) {
    if (x === y) return true;
    const xs = contentWords(x).map(stem), ys = new Set(contentWords(y).map(stem));
    if (xs.some(w => ys.has(w))) return true;
  }
  return false;
}

/** Чи конфліктують англійські слова: однакові, варіант одного є в іншому, або форми того самого слова */
export function enConflict(a, b) {
  const va = variants(a).map(core), vb = new Set(variants(b).map(core));
  if (va.some(x => vb.has(x))) return true;
  const ca = core(a), cb = core(b);
  if (ca === cb) return true;
  if (!ca.includes(' ') && !cb.includes(' ') && (inflections(ca).has(cb) || inflections(cb).has(ca))) return true;
  return false;
}

/**
 * Дистрактори для вибору з варіантів: схожі за формою (слово/фраза, довжина), з тієї самої колоди й рівня,
 * без синонімів і дублікатів. pool: [{ id, en, uk, deck_id?, level? }]
 */
export function pickDistractors(target, pool, { n = 3, rng = Math.random, field = 'uk' } = {}) {
  const tw = wordCount(target.en), tl = String(target[field] || '').length;
  const seenText = new Set([textKey(target[field])]);
  const scored = [];
  for (const c of pool) {
    if (!c || c.id === target.id || !c.en || !c.uk) continue;
    if (enConflict(c.en, target.en) || ukConflict(c.uk, target.uk)) continue;
    const s = (c.deck_id && c.deck_id === target.deck_id ? 3 : 0)
      + (c.level && c.level === target.level ? 1 : 0)
      + (Math.abs(wordCount(c.en) - tw) === 0 ? 2 : Math.abs(wordCount(c.en) - tw) === 1 ? 1 : 0)
      + (Math.abs(String(c[field] || '').length - tl) <= Math.max(3, tl * 0.3) ? 1 : 0)
      + (c.pos && c.pos === target.pos ? 1 : 0)
      - (isSentence(c.en) !== isSentence(target.en) ? 6 : 0)
      + rng() * 2.5;
    scored.push([s, c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = [];
  for (const [, c] of scored) {
    if (out.length >= n) break;
    const t = textKey(c[field]);
    if (!t || seenText.has(t)) continue;
    // дистрактори не мають бути синонімами й між собою
    if (out.some(o => ukConflict(o.uk, c.uk) || enConflict(o.en, c.en))) continue;
    seenText.add(t);
    out.push(c);
  }
  return out;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Етапи слова і типи вправ ----------
/** new — ще не вчили; learning — щойно введене чи забуте; young — до 3 тижнів стабільності; mature — міцне */
export function stageOf(card) {
  if (!card?.reps) return 'new';
  if (card.state === 1 || card.state === 3 || (card.stability || 0) < 3) return 'learning';
  if ((card.stability || 0) < 21) return 'young';
  return 'mature';
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
/** Збирання речення з плиток — для фраз і колокацій від B1, коли приклад має 4–12 слів */
export function canBuild(card, level = 'B1') {
  const ex = card?.examples?.[0]?.en;
  if (!ex) return false;
  const n = ex.trim().split(/\s+/).length;
  if (n < 4 || n > 12) return false;
  const phrase = wordCount(card.en) > 1 || (card.tags || []).some(t => /colloc|phrasal|idiom/.test(t));
  const lv = Math.max(LEVELS.indexOf(card.level || ''), LEVELS.indexOf(level));
  return phrase && lv >= 2;
}

/**
 * Тип оцінюваної вправи для слова (перша зустріч у сесії). Чергується за кількістю повторів.
 * opts: { hasCloze, build, prev, audio } — prev: тип попередньої вправи (не повторюємо поспіль)
 */
export function chooseKind(card, { hasCloze = false, build = false, prev = null, audio = true } = {}) {
  const st = stageOf(card);
  if (st === 'new') return 'intro';
  const long = wordCount(card.en) > 4;            // речення-фраза: друкувати цілком — не тренування слова
  let pool;
  if (st === 'learning') pool = ['recognize', 'reverse', 'listen'];
  else if (st === 'young') pool = ['reverse', hasCloze && 'cloze', 'listen', 'recall'];
  else pool = ['recall', hasCloze && 'cloze', build && 'builder', 'listen-type', 'reverse'];
  pool = pool.filter(Boolean).filter(k => audio || !k.startsWith('listen'));
  if (long) pool = pool.map(k => (k === 'recall' || k === 'listen-type' ? (build ? 'builder' : 'reverse') : k === 'cloze' ? 'listen' : k));
  pool = [...new Set(pool)];
  if (!pool.length) pool = ['recognize'];
  let k = pool[(card.reps + (card.lapses || 0)) % pool.length];
  if (k === prev && pool.length > 1) k = pool[(pool.indexOf(k) + 1) % pool.length];
  return k;
}

/** Легша вправа для повторення в сесії після помилки (практика, без оцінки) */
export function retryKind(kind, attempt = 1) {
  const easy = ['recognize', 'reverse', 'listen'];
  if (kind === 'recognize') return attempt % 2 ? 'reverse' : 'recognize';
  if (kind === 'builder') return 'builder';
  return easy[attempt % easy.length];
}

/** Вправи, де учень друкує */
export const TYPED = new Set(['recall', 'listen-type', 'cloze']);

/** Маска з підказками: «m_ _ _ a mistake» — відкрито revealed літер, пробіли й розділові знаки видно одразу */
export function maskOf(answer, revealed = 0) {
  let left = revealed;
  return [...String(answer)].map(ch => {
    if (!/[A-Za-z]/.test(ch)) return ch;
    if (left > 0) { left--; return ch; }
    return '_';
  }).join('');
}
export const letterCount = (s) => String(s).replace(/[^A-Za-z]/g, '').length;

/** Плитки речення (розділові знаки лишаються при словах) */
export function tilesOf(sentence) { return String(sentence || '').trim().split(/\s+/).filter(Boolean); }
/** Чи збігається складене речення з прикладом (регістр і розділові знаки не важать) */
export function sameSentence(a, b) { return norm(a) === norm(b); }

// ---------- Оцінка FSRS за відповіддю ----------
// межа «повільно» для кожного типу, мс
const SLOW = { recognize: 9000, reverse: 9000, listen: 10000, cloze: 14000, 'cloze-choice': 11000, recall: 12000, 'listen-type': 14000, builder: 30000 };

/**
 * Оцінка FSRS (1 Again, 2 Hard, 3 Good, 4 Easy) за першою відповіддю в сесії.
 * Помилка → Again (у збиранні речення — Hard: там важить порядок слів, а не саме слово);
 * підказки, описка чи довга пауза → Hard; швидко й без підказок → Good; швидко надруковане знайоме слово → Easy.
 * Нове слово отримує щонайбільше Good.
 */
export function ratingFor({ kind, correct, almost = false, hints = 0, ms = 0, answer = '', isNew = false }) {
  const letters = letterCount(answer);
  if (!correct) return kind === 'builder' ? 2 : 1;
  if (hints && letters && hints >= Math.ceil(letters / 2)) return 1;   // більшу частину слова підказано
  const slow = (SLOW[kind] || 10000) + (TYPED.has(kind) ? letters * 350 : 0);
  if (hints || almost || ms > slow) return 2;
  if (isNew) return 3;
  if (TYPED.has(kind) && ms > 0 && ms < slow * 0.45) return 4;
  return 3;
}

// ---------- Черга сесії ----------
/** Нові слова вкраплюються після кожних every повторів (перше нове — після першого ж повтору) */
export function interleave(due, fresh, every = 3) {
  const out = [], seen = new Set();
  const push = (c) => { if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } };
  let di = 0, ni = 0, first = true;
  while (di < due.length || ni < fresh.length) {
    const k = first ? 1 : every;
    first = false;
    for (let j = 0; j < k && di < due.length; j++) push(due[di++]);
    if (ni < fresh.length) push(fresh[ni++]);
  }
  return out;
}

/** 5 пар для міні-гри: різні слова з різними перекладами */
export function pickPairs(words, n = 5, rng = Math.random) {
  const out = [];
  for (const w of shuffle(words, rng)) {
    if (out.length >= n) break;
    if (!w?.en || !w?.uk) continue;
    if (out.some(o => enConflict(o.en, w.en) || ukConflict(o.uk, w.uk) || textKey(o.uk) === textKey(w.uk))) continue;
    out.push(w);
  }
  return out;
}

/** Підсумок сесії. results: [{ id, en, uk, isNew, rating, wrong }] */
export function summarize(results) {
  const graded = results.filter(r => r.rating);
  const firstOk = graded.filter(r => r.rating >= 2 && !r.firstWrong).length;
  return {
    learned: graded.filter(r => r.isNew && r.rating >= 2).length,
    strengthened: graded.filter(r => !r.isNew && r.rating >= 2).length,
    graded: graded.length,
    accuracy: graded.length ? Math.round(firstOk / graded.length * 100) : 0,
    hardest: graded.filter(r => r.rating <= 2 || r.wrong > 0)
      .sort((a, b) => (b.wrong - a.wrong) || (a.rating - b.rating)).slice(0, 5),
  };
}
