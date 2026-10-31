// Слова, що перекладаються дотиком: обгортає англійські слова відрендереного тексту в <span class="w">
// і відкриває шторку з перекладом. Порядок пошуку: словничок тексту → слова вбудованих колод (за словом і його
// початковою формою) → «Немає в словнику» з кнопкою «Запитати вчителя».
// Працює поверх готового DOM (зокрема виводу md.js): змінює лише текстові вузли, код, посилання й кнопки пропускає.
import { h, ic } from './dom.js';
import { sheet } from './sheet.js';
import { toast } from './toast.js';
import { speak } from '../speech.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import { allDecks } from '../data.js';
import { user } from '../supa.js';

export const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const SKIP = 'code,pre,a,button,input,textarea,select,summary,svg,.w,[data-notap]';
const norm = (s) => String(s || '').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const hasSelection = () => !!window.getSelection?.()?.toString().trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Пошук у колодах (вантажиться лише після першого дотику) ----------
let deckMap = null;
function deckIndexMap() {
  if (!deckMap) deckMap = allDecks().then(decks => {
    const m = new Map();
    const add = (k, v) => { k = norm(k); if (k && !m.has(k)) m.set(k, v); };
    for (const d of decks) for (const c of d.cards) {
      const v = { en: c.en, uk: c.uk, ipa: c.ipa || null, ex: c.ex || null, exUk: c.exUk || null, deckId: d.id, deckName: d.name, card: c };
      const vars = String(c.en).split(/\s*\/\s*/);
      vars.forEach((variant, i) => {
        let base = variant.replace(/\([^)]*\)/g, '').trim();
        // «to miss a flight / train»: одиночне слово замінює останнє слово першого варіанта → «to miss a train», а не «train»
        const first = vars[0].replace(/\([^)]*\)/g, '').trim().split(/\s+/);
        if (i > 0 && !/\s/.test(base) && first.length - (/^(to|a|an|the)$/i.test(first[0]) ? 1 : 0) > 2) base = [...first.slice(0, -1), base].join(' ');
        add(base, v);
        add(base.replace(/^(to|a|an|the)\s+/i, ''), v);
      });
    }
    return m;
  }).catch(e => { deckMap = null; throw e; });
  return deckMap;
}

const IRR = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
  went: 'go', gone: 'go', made: 'make', took: 'take', taken: 'take', got: 'get', gotten: 'get', came: 'come', saw: 'see', seen: 'see',
  knew: 'know', known: 'know', thought: 'think', told: 'tell', said: 'say', found: 'find', gave: 'give', given: 'give', left: 'leave',
  felt: 'feel', kept: 'keep', bought: 'buy', brought: 'bring', began: 'begin', begun: 'begin', ran: 'run', wrote: 'write', written: 'write',
  spoke: 'speak', spoken: 'speak', ate: 'eat', eaten: 'eat', drank: 'drink', drunk: 'drink', slept: 'sleep', met: 'meet', paid: 'pay',
  sold: 'sell', sent: 'send', spent: 'spend', built: 'build', taught: 'teach', caught: 'catch', fought: 'fight', chose: 'choose',
  chosen: 'choose', fell: 'fall', fallen: 'fall', grew: 'grow', grown: 'grow', drove: 'drive', driven: 'drive', rode: 'ride', ridden: 'ride',
  flew: 'fly', flown: 'fly', forgot: 'forget', forgotten: 'forget', understood: 'understand', stood: 'stand', sat: 'sit', won: 'win',
  lost: 'lose', heard: 'hear', held: 'hold', led: 'lead', meant: 'mean', became: 'become', broke: 'break', broken: 'break', wore: 'wear',
  worn: 'wear', woke: 'wake', woken: 'wake', lent: 'lend', lit: 'light', hid: 'hide', hidden: 'hide', shook: 'shake', stole: 'steal',
  stolen: 'steal', swam: 'swim', sang: 'sing', sung: 'sing', rang: 'ring', threw: 'throw', thrown: 'throw', drew: 'draw', drawn: 'draw',
  froze: 'freeze', frozen: 'freeze', bit: 'bite', bitten: 'bite', fed: 'feed', fled: 'flee', dealt: 'deal', dug: 'dig', hung: 'hang',
  laid: 'lay', lay: 'lie', lain: 'lie', rose: 'rise', risen: 'rise', sought: 'seek', shot: 'shoot', shut: 'shut', spread: 'spread',
  struck: 'strike', swore: 'swear', tore: 'tear', torn: 'tear', wept: 'weep', wound: 'wind', withdrew: 'withdraw', overcame: 'overcome',
  children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse', lives: 'life',
  wives: 'wife', knives: 'knife', leaves: 'leaf', halves: 'half', shelves: 'shelf', better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  further: 'far', farther: 'far', less: 'little', least: 'little', more: 'much', most: 'much',
};

// Слова, які не можна «обрізати» за суфіксом (news ≠ new, always ≠ alway)
const KEEP = new Set(['news', 'series', 'species', 'means', 'always', 'perhaps', 'towards', 'afterwards', 'sometimes', 'whereas', 'thus',
  'this', 'his', 'its', 'us', 'yes', 'bus', 'gas', 'plus', 'lens', 'politics', 'economics', 'physics', 'maths', 'thing', 'nothing',
  'something', 'anything', 'everything', 'morning', 'evening', 'during', 'ceiling', 'early', 'only', 'family', 'holy', 'ugly']);
const CVC3 = /^[^aeiou][aeiou][bcdfgklmnprstvz]$/;   // hat, pin: від них було б hatted, pinned — тож «hated» ≠ hat

/** Можливі словникові форми слова (від найімовірнішої); adj — форми від -er/-est/-ly, що можуть бути лише прикметником/іменником */
function lemmaForms(word) {
  const w = norm(word).replace(/'s$|s'$/, (m) => m === "s'" ? 's' : '');
  const out = [{ f: norm(word) }, { f: w }];
  const add = (x, adj = false) => { if (x && x.length > 1) out.push({ f: x, adj }); };
  if (IRR[w]) add(IRR[w]);
  if (KEEP.has(w)) return out;
  const dbl = (s) => /([bcdfgklmnprstvz])\1$/.test(s) ? s.slice(0, -1) : null;
  if (w.endsWith("n't")) add(w.slice(0, -3));
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2));
  if (/[^s]s$/.test(w)) add(w.slice(0, -1));
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ed$/.test(w) && !(/eed$/.test(w) && w.length <= 5)) {
    const s = w.slice(0, -2);
    add(w.slice(0, -1)); if (s.length >= 3 && !CVC3.test(s)) add(s); add(dbl(s));
  }
  if (/ing$/.test(w)) { const s = w.slice(0, -3); add(s); add(s + 'e'); add(dbl(s)); if (/y$/.test(s)) add(s.slice(0, -1) + 'ie'); }
  if (/ier$|iest$/.test(w)) add(w.replace(/i(er|est)$/, 'y'), true);
  if (/er$/.test(w)) { const s = w.slice(0, -2); if (s.length >= 3) { add(s, true); add(s + 'e', true); add(dbl(s), true); } }
  if (/est$/.test(w)) { const s = w.slice(0, -3); if (s.length >= 3) { add(s, true); add(s + 'e', true); add(dbl(s), true); } }
  if (/ily$/.test(w)) add(w.slice(0, -3) + 'y', true);
  if (/ly$/.test(w)) add(w.slice(0, -2), true);
  if (/ves$/.test(w)) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe'); }
  const seen = new Set();
  return out.filter(o => !seen.has(o.f) && seen.add(o.f));
}
/** Можливі словникові форми слова (від найімовірнішої) */
export const lemmas = (word) => lemmaForms(word).map(o => o.f);
// shower ≠ to show, likely ≠ to like: форми від -er/-est/-ly не ведуть до дієслова
const isVerb = (v) => /^to\s/i.test(v.en);

/** Знайти слово в колодах; next — наступні слова тексту (для фразових дієслів: «came across» → «come across») */
export async function lookupDeck(word, next = []) {
  const m = await deckIndexMap();
  const forms = lemmaForms(word);
  let phrase = null;
  for (let n = Math.min(3, next.length); n >= 1 && !phrase; n--) {
    const tail = next.slice(0, n).map(norm).join(' ');
    for (const { f, adj } of forms) { if (adj) continue; const v = m.get(`${f} ${tail}`); if (v) { phrase = v; break; } }
  }
  let hit = null;
  for (const { f, adj } of forms) { const v = m.get(f); if (v && !(adj && isVerb(v))) { hit = v; break; } }
  return { hit, phrase };
}

// ---------- Обгортання слів ----------
/**
 * Зробити англійські слова в root клікабельними.
 * opts.glossary — [{ w: форма в тексті, en?: словникова форма, uk, ipa? }]: фрази зі словничка обгортаються цілком;
 * opts.onAsk(word) — дія «Запитати вчителя» (за замовчуванням — новий чат #/tutor?ask=…);
 * opts.mark — підкреслити слова зі словничка.
 */
export function tappable(root, { glossary = [], onAsk = null, mark = false } = {}) {
  const gl = new Map();
  for (const g of glossary) if (g?.w && g.uk) gl.set(norm(g.w), g);
  // довші фрази — першими, щоб «look forward to» не розпалась на «look»; межа слова зліва — групою (без lookbehind: старі iOS Safari)
  const phrases = [...gl.keys()].sort((a, b) => b.length - a.length);
  const phraseRe = phrases.length ? new RegExp(`(^|[^A-Za-z'’])(${phrases.map(p => escRe(p).replace(/'/g, "['’]").replace(/ /g, '\\s+')).join('|')})(?![A-Za-z'’])`, 'gi') : null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => !n.nodeValue.trim() || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const mk = (text, key, isGloss) => h('span.w' + (isGloss && mark ? '.gl' : ''), { role: 'button', tabindex: '-1', dataset: key ? { g: key } : {} }, text);
  for (const node of nodes) {
    const s = node.nodeValue;
    if (!/[A-Za-z]/.test(s)) continue;
    const frag = document.createDocumentFragment();
    // спершу — фрази словничка, між ними — окремі слова
    const parts = [];
    let last = 0;
    if (phraseRe) for (const m of s.matchAll(phraseRe)) {
      const at = m.index + m[1].length;
      if (at > last) parts.push([s.slice(last, at), false]);
      parts.push([m[2], true]); last = at + m[2].length;
    }
    parts.push([s.slice(last), false]);
    for (const [chunk, isPhrase] of parts) {
      if (isPhrase) { frag.append(mk(chunk, norm(chunk), true)); continue; }
      let p = 0;
      for (const m of chunk.matchAll(WORD)) {
        if (m.index > p) frag.append(chunk.slice(p, m.index));
        const k = norm(m[0]);
        frag.append(mk(m[0], gl.has(k) ? k : null, gl.has(k)));
        p = m.index + m[0].length;
      }
      if (p < chunk.length) frag.append(chunk.slice(p));
    }
    node.replaceWith(frag);
  }

  const words = () => [...root.querySelectorAll('span.w')];
  const first = root.querySelector('span.w');
  if (first) first.tabIndex = 0;   // «блукаючий» tabindex: одна зупинка Tab на весь текст, далі — стрілки
  root.__wt = { gl, onAsk };       // для пошуку за виділенням (js/ui/selectlookup.js): словничок і «Запитати вчителя» цього тексту
  if (root.__wordtap) return root;
  root.__wordtap = true;
  root.classList.add('wordtap');
  const focusWord = (el) => { if (!el) return; words().forEach(x => { x.tabIndex = -1; }); el.tabIndex = 0; el.focus(); };
  // Мишею: подвійний клік виділяє слово (→ «Що це?»), тож одиночний відкриває шторку з невеликою затримкою.
  // Дотиком: довге натискання виділяє (click не приходить), короткий дотик — одразу шторка.
  let pending = null, lastPointer = 'mouse';
  root.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('span.w');
    clearTimeout(pending); pending = null;
    if (!el || !root.contains(el)) return;
    if (e.detail > 1) return;                            // другий клік подвійного — це виділення
    if (hasSelection()) return;                          // виділення тексту — не дотик
    words().forEach(x => { x.tabIndex = -1; }); el.tabIndex = 0;
    const go = () => { pending = null; if (!hasSelection() && el.isConnected) open(el, root.__wt.gl, root.__wt.onAsk); };
    if (lastPointer === 'mouse' && e.detail === 1) pending = setTimeout(go, 260); else go();
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('span.w');
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el, root.__wt.gl, root.__wt.onAsk); return; }
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const all = words(), i = all.indexOf(el);
    focusWord(e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[i + (e.key === 'ArrowRight' ? 1 : -1)]);
  });
  return root;
}


// ---------- Контекст: речення навколо слова чи виділення ----------
const BLOCK = 'p,li,dd,dt,td,th,blockquote,figcaption,h1,h2,h3,h4,.msg-body,div';
/** Блок тексту, в якому стоїть вузол */
export const blockOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest(BLOCK) || null;
/** Речення з тексту block, що містить фрагмент [at, at + len) (довше 220 символів — порожньо) */
export function sentenceAround(block, at, len = 0) {
  const full = String(block?.textContent || '');
  if (!full) return '';
  const start = Math.max(full.lastIndexOf('. ', at), full.lastIndexOf('! ', at), full.lastIndexOf('? ', at), full.lastIndexOf('\n', at));
  const endM = full.slice(at + len).search(/[.!?](\s|$)|\n/);
  const s = full.slice(start < 0 ? 0 : start + 1, endM < 0 ? full.length : at + len + endM + 1).replace(/\s+/g, ' ').trim();
  return s.length > 220 ? '' : s;
}
/** Зміщення початку вузла/діапазону від початку блоку */
export function offsetIn(block, node, offset = 0) {
  const r = document.createRange();
  r.setStart(block, 0);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
}

/** Речення, в якому стоїть слово (для прикладу в картці) */
function sentenceOf(el) {
  const block = el.closest('p,li,div') || el.parentElement;
  const r = document.createRange();
  r.setStart(block, 0); r.setEndBefore(el);
  return sentenceAround(block, r.toString().length, el.textContent.length);
}

/** Наступні слова після el у тому самому блоці */
function nextWords(el, n = 3) {
  const out = [];
  const block = el.closest('p,li,div') || el.parentElement;
  const all = [...block.querySelectorAll('span.w')];
  for (const x of all.slice(all.indexOf(el) + 1, all.indexOf(el) + 1 + n)) out.push(x.textContent);
  return out;
}

const knownCard = (en) => {
  const k = norm(en);
  return store.all('cards').find(c => norm(c.en) === k || norm(String(c.en).replace(/^to\s+/i, '')) === k);
};

// Звідки слово (для пам'яті вчителя й поля extra.source картки)
const SRC = {
  reading: 'reading', tutor: 'a chat with the tutor', grammar: 'a grammar lesson', scenarios: 'a role-play scenario', writing: 'writing practice',
  listening: 'listening practice', cards: 'flashcards', diary: 'the diary', exercises: 'exercises', mistakes: 'the mistakes review',
  pronunciation: 'pronunciation practice', vocab: 'the word list', tests: 'a test', session: 'a lesson', home: 'the home screen',
};
const routeKey = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home';
export const sourceOfRoute = () => SRC[routeKey()] || 'the app';

/**
 * Додати слово в «Мої слова»: слово ввімкненої вбудованої колоди — та сама картка (без дубля),
 * інакше (власне слово, AI-переклад або колода вимкнена — її картки в чергу не потрапляють) — власна картка.
 * Приклад — речення, де слово трапилось; далі — приклади з колоди чи від AI.
 */
async function addToMine(entry, example) {
  if (entry.deckId && entry.card) {
    const id = srs.starterId(entry.deckId, entry.card.en);
    if (store.get('cards', id)) return 'exists';
    const deck = (await srs.decks()).find(d => d.id === entry.deckId);
    if (deck?.enabled) { store.put('cards', srs.rowFromStarter(entry.deckId, entry.card)); return 'starter'; }
  }
  const examples = [];
  const push = (en, uk = '') => { if (en && !examples.some(x => norm(x.en) === norm(en))) examples.push({ en, uk }); };
  if (entry.card?.ex) push(entry.card.ex, entry.card.exUk || '');
  else if (example) push(example);
  for (const x of entry.examples || []) push(x.en, x.uk || '');
  const r = srs.addCard({ en: entry.en, uk: entry.uk, ipa: entry.ipa || null, pos: entry.pos || null, examples: examples.slice(0, 3), tags: [], extra: { source: routeKey() } });
  return r.created ? 'created' : 'exists';
}
const inCards = (entry) => !!knownCard(entry.en) || (entry.deckId && entry.card && !!store.get('cards', srs.starterId(entry.deckId, entry.card.en)));

// ---------- «Не знаю — сказати вчителю»: картка + факт у пам'яті вчителя (profiles.data.memory) ----------
const UNKNOWN_RE = /^Didn't know the (word|phrase) /;
const UNKNOWN_CAP = 12;   // такі факти не витісняють решту пам'яті (MEM_CAP): старіші за 12-м прибираються — слово лишається в картках
const factKey = (w) => `"${norm(w)}"`;
async function knowsUnknown(word) {
  const { memoryFacts } = await import('../pages/profile.js');
  return memoryFacts().some(f => UNKNOWN_RE.test(f.text) && norm(f.text).includes(factKey(word)));
}
async function markUnknown(word, entry, example, source) {
  let card = null;
  if (entry?.uk) card = await addToMine(entry, example).catch(() => 'error');
  const { rememberFacts, memoryFacts, forgetFacts } = await import('../pages/profile.js');
  const w = word.replace(/["“”]/g, '').slice(0, 60);
  if (!(await knowsUnknown(w))) {
    rememberFacts([`Didn't know the ${/\s/.test(w) ? 'phrase' : 'word'} "${w}" (seen in: ${source})`]);
    const old = memoryFacts().filter(f => UNKNOWN_RE.test(f.text)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(UNKNOWN_CAP);
    if (old.length) forgetFacts(old.map(f => f.id));
  }
  toast(card === 'starter' || card === 'created' ? 'Вчитель знатиме, що це слово для вас нове. Його додано в «Мої слова»' : 'Вчитель знатиме, що це слово для вас нове');
}

function entryBlock(entry, example, sourceLabel, refresh) {
  const addBtn = h('button.btn.soft', { type: 'button' });
  const paint = () => {
    const on = inCards(entry);
    addBtn.disabled = on;
    addBtn.replaceChildren(ic(on ? 'check' : 'plus'), on ? 'Уже у ваших словах' : 'Додати в мої слова');
  };
  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    const r = await addToMine(entry, example).catch(() => 'error');
    if (r === 'error') { toast('Не вдалося додати слово'); paint(); return; }
    toast(r === 'starter' ? `Слово є в колоді «${entry.deckName}» — додано першим серед нових` : r === 'created' ? 'Додано в «Мої слова»' : 'Таке слово вже є в картках');
    paint();
  });
  paint();
  refresh?.add(paint);
  const ex = entry.ex && norm(entry.ex) !== norm(example) ? entry.ex : null;
  return h('div.stack.wt-entry', { style: { gap: '8px' } },
    h('div.row', h('div.grow', h('div.wt-head', { lang: 'en' }, entry.en), entry.ipa ? h('div.ipa', entry.ipa) : null),
      h('button.icon-btn.soft', { type: 'button', 'aria-label': `Прослухати: ${entry.en}`, onclick: () => speak(entry.en) }, ic('speaker-high'))),
    h('div.wt-uk', entry.uk),
    sourceLabel ? h('div', h('span.tag', sourceLabel)) : null,
    ex ? h('div.example', h('div.grow', h('div.small', { lang: 'en' }, ex), entry.exUk ? h('div.xs.dim', entry.exUk) : null)) : null,
    h('div.row.wrap', addBtn));
}

// ---------- AI-переклад слова чи фрази в контексті (дія tutor `fill_word`; context — речення, де трапилось) ----------
const aiCache = new Map();
const canAi = () => !!user() && navigator.onLine;
function aiLookup(text, sentence) {
  const k = norm(text);
  if (!aiCache.has(k)) {
    aiCache.set(k, import('../ai.js')
      .then(({ tutor }) => tutor('fill_word', { words: [text], context: String(sentence || '').slice(0, 300) }))
      .then(r => {
        const w = r?.words?.[0];
        if (!w?.uk) return null;
        const examples = (Array.isArray(w.examples) ? w.examples : []).filter(x => x?.en).slice(0, 2);
        return { en: String(w.en || text), uk: String(w.uk), ipa: w.ipa || null, pos: w.pos || null, examples, ex: examples[0]?.en || null, exUk: examples[0]?.uk || null };
      })
      .catch(e => { aiCache.delete(k); throw e; }));
  }
  return aiCache.get(k);
}

/** Фраза з кількох слів у колодах: ціла, з початковою формою першого або останнього слова */
async function lookupPhrase(words) {
  const m = await deckIndexMap();
  const rest = words.slice(1).map(norm).join(' '), head = words.slice(0, -1).map(norm).join(' ');
  for (const { f, adj } of lemmaForms(words[0])) { if (adj) continue; const v = m.get(`${f} ${rest}`); if (v) return v; }
  for (const { f } of lemmaForms(words[words.length - 1])) { const v = m.get(`${head} ${f}`); if (v) return v; }
  return null;
}

/** Кнопка «Прослухати» */
const speakBtn = (text) => h('button.icon-btn.soft', { type: 'button', 'aria-label': `Прослухати: ${text}`, onclick: () => speak(text) }, ic('speaker-high'));

/**
 * Шторка зі значенням слова чи фрази (1–5 слів).
 * text — слово/фраза; sentence — речення, де трапилось; next — наступні слова (фразові дієслова для одного слова);
 * gl — словничок тексту (Map); onAsk(word) — «Запитати вчителя»; auto — одразу питати AI, якщо в словнику немає
 * (для виділення — так; для дотику — кнопкою, щоб випадковий дотик не витрачав ліміт).
 */
export async function lookupText({ text, sentence = '', next = [], gl = null, onAsk = null, source = sourceOfRoute(), auto = true } = {}) {
  const surface = String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').trim();
  if (!surface) return null;
  const words = surface.match(WORD) || [surface];
  const body = h('div.stack');
  const s = sheet(null, body);
  const refresh = new Set();
  const ctx = sentence && norm(sentence) !== norm(surface) ? h('p.small.dim.wt-ctx', { lang: 'en' }, sentence) : null;

  const askBtn = (word) => h('button.btn.ghost', { type: 'button', onclick: () => {
    s.close();
    if (onAsk) onAsk(word); else location.hash = `#/tutor?ask=${encodeURIComponent(word)}`;
  } }, ic('chat-circle-dots'), onAsk ? 'Запитати вчителя' : 'Пояснити з вчителем');
  const unknownBtn = (word, entry) => {
    const b = h('button.btn.soft', { type: 'button' }, ic('question'), 'Не знаю — сказати вчителю');
    const done = () => { b.disabled = true; b.replaceChildren(ic('check'), 'Вчитель знає, що слово нове'); };
    knowsUnknown(word).then(k => { if (k) done(); }).catch(() => {});
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await markUnknown(word, entry, sentence, source); done(); refresh.forEach(f => f()); }
      catch (e) { console.warn('unknown word', e); toast('Не вдалося зберегти'); b.disabled = false; }
    });
    return b;
  };
  const actions = (word, entry) => h('div.row.wrap.wt-actions', unknownBtn(word, entry), askBtn(word));
  const show = (...parts) => { if (body.isConnected) body.replaceChildren(...parts.filter(Boolean)); };

  // 1) словничок тексту
  const g = gl?.get?.(norm(surface));
  if (g) {
    const entry = { en: g.en || g.w, uk: g.uk, ipa: g.ipa || null };
    show(entryBlock(entry, sentence, 'Словничок тексту', refresh), ctx, actions(surface, entry));
    // IPA зі словника колод, якщо в словничку її немає
    if (!g.ipa) lookupDeck(entry.en).then(({ hit }) => {
      if (hit?.ipa && norm(hit.en).replace(/^to /, '') === norm(entry.en).replace(/^to /, '') && body.isConnected) {
        body.querySelector('.wt-head')?.after(h('div.ipa', hit.ipa));
      }
    }).catch(() => {});
    return s;
  }

  // 2) колоди
  show(h('div.row', h('div.grow.wt-head', { lang: 'en' }, surface), speakBtn(surface)), h('p.dim', { role: 'status' }, 'Шукаю…'));
  let hit = null, phrase = null;
  try {
    if (words.length === 1) ({ hit, phrase } = await lookupDeck(words[0], next));
    else hit = await lookupPhrase(words);
  } catch { /* колоди не завантажились — далі AI або «Немає в словнику» */ }
  if (!body.isConnected) return s;
  if (hit || phrase) {
    const main = hit || phrase;
    const parts = [];
    if (hit) parts.push(entryBlock(hit, sentence, `Колода «${hit.deckName}»`, refresh));
    if (phrase && phrase !== hit) parts.push(h('div.section-title', 'Можливо, це фраза'), entryBlock(phrase, sentence, `Колода «${phrase.deckName}»`, refresh));
    show(...parts, ctx, actions(hit ? surface : phrase.en, main));
    return s;
  }

  // 3) AI-переклад у контексті
  const head = h('div.row', h('div.grow.wt-head', { lang: 'en' }, surface), speakBtn(surface));
  const runAi = async () => {
    show(head, h('p.dim', { role: 'status' }, 'Перекладаю з урахуванням речення…'), ctx);
    try {
      const entry = await aiLookup(surface, sentence);
      if (!entry) throw new Error('empty');
      show(entryBlock(entry, sentence, 'Переклад AI', refresh), ctx, actions(surface, entry));
    } catch (e) {
      const { aiErrorText } = await import('../ai.js');
      show(head, h('p.dim', 'Немає в словнику'), h('p.small.dim', aiErrorText(e) || 'Не вдалося перекласти'), ctx, actions(surface, null));
    }
  };
  if (canAi() && auto) { runAi(); return s; }
  show(head, h('p.dim', 'Немає в словнику'), ctx,
    canAi() ? h('div.row.wrap', h('button.btn.soft', { type: 'button', onclick: runAi }, ic('translate'), 'Перекласти з AI')) : h('p.small.dim', 'Переклад від AI — після входу і з інтернетом.'),
    actions(surface, null));
  return s;
}

/** Шторка з перекладом довшого фрагмента (понад 5 слів) — дія tutor `translate` */
export async function translateFragment({ text, onAsk = null } = {}) {
  const frag = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (!frag) return null;
  const out = h('div.wt-uk', { role: 'status' });
  const body = h('div.stack',
    h('div.row', h('p.grow.wt-frag', { lang: 'en' }, frag), speakBtn(frag)), out);
  const s = sheet('Переклад', body);
  const ask = h('button.btn.ghost', { type: 'button', onclick: () => {
    s.close();
    const q = frag.length > 300 ? frag.slice(0, 300) + '…' : frag;
    if (onAsk) onAsk(q); else location.hash = `#/tutor?ask=${encodeURIComponent(q)}`;
  } }, ic('chat-circle-dots'), onAsk ? 'Запитати вчителя' : 'Пояснити з вчителем');
  body.append(h('div.row.wrap.wt-actions', ask));
  if (!canAi()) { out.replaceChildren(h('span.dim', 'Переклад від AI — після входу і з інтернетом.')); return s; }
  out.replaceChildren(h('span.dim', 'Перекладаю…'));
  try {
    const { tutor } = await import('../ai.js');
    const r = await tutor('translate', { text: frag, to: 'uk' });
    const uk = String(r?.uk || r?.text || '').trim();
    if (!uk) throw new Error('empty');
    out.textContent = uk;
  } catch (e) {
    const { aiErrorText } = await import('../ai.js');
    out.replaceChildren(h('span.dim', aiErrorText(e) || 'Не вдалося перекласти'));
  }
  return s;
}

function open(el, gl, onAsk) {
  return lookupText({ text: el.textContent, sentence: sentenceOf(el), next: nextWords(el), gl, onAsk, auto: false });
}
