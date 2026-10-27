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

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const SKIP = 'code,pre,a,button,input,textarea,select,summary,svg,.w,[data-notap]';
const norm = (s) => String(s || '').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
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
  if (root.__wordtap) return root;
  root.__wordtap = true;
  root.classList.add('wordtap');
  const focusWord = (el) => { if (!el) return; words().forEach(x => { x.tabIndex = -1; }); el.tabIndex = 0; el.focus(); };
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('span.w');
    if (!el || !root.contains(el)) return;
    if (window.getSelection?.()?.toString()) return;   // виділення тексту — не дотик
    words().forEach(x => { x.tabIndex = -1; }); el.tabIndex = 0;
    open(el, gl, onAsk);
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('span.w');
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el, gl, onAsk); return; }
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const all = words(), i = all.indexOf(el);
    focusWord(e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[i + (e.key === 'ArrowRight' ? 1 : -1)]);
  });
  return root;
}

/** Речення, в якому стоїть слово (для прикладу в картці) */
function sentenceOf(el) {
  const block = el.closest('p,li,div') || el.parentElement;
  const full = block.textContent;
  const pre = document.createRange();
  pre.setStart(block, 0); pre.setEndBefore(el);
  const at = pre.toString().length;
  const start = Math.max(full.lastIndexOf('. ', at), full.lastIndexOf('! ', at), full.lastIndexOf('? ', at));
  const endM = full.slice(at).search(/[.!?](\s|$)/);
  const s = full.slice(start < 0 ? 0 : start + 2, endM < 0 ? full.length : at + endM + 1).trim();
  return s.length > 220 ? '' : s;
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

/**
 * Додати слово в «Мої слова»: слово ввімкненої вбудованої колоди — та сама картка (без дубля),
 * інакше (власне слово або колода вимкнена — її картки в чергу не потрапляють) — власна картка
 */
async function addToMine(entry, example) {
  if (entry.deckId && entry.card) {
    const id = srs.starterId(entry.deckId, entry.card.en);
    if (store.get('cards', id)) return 'exists';
    const deck = (await srs.decks()).find(d => d.id === entry.deckId);
    if (deck?.enabled) { store.put('cards', srs.rowFromStarter(entry.deckId, entry.card)); return 'starter'; }
  }
  const examples = entry.card?.ex ? [{ en: entry.card.ex, uk: entry.card.exUk || '' }] : example ? [{ en: example, uk: '' }] : [];
  const r = srs.addCard({ en: entry.en, uk: entry.uk, ipa: entry.ipa || null, examples, tags: [], extra: { source: 'reading' } });
  return r.created ? 'created' : 'exists';
}

function entryBlock(entry, example, sourceLabel) {
  const exists = () => !!knownCard(entry.en) || (entry.deckId && entry.card && !!store.get('cards', srs.starterId(entry.deckId, entry.card.en)));
  const addBtn = h('button.btn.soft', { type: 'button' });
  const paint = () => {
    const on = exists();
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
  const ex = entry.ex && norm(entry.ex) !== norm(example) ? entry.ex : null;
  return h('div.stack.wt-entry', { style: { gap: '8px' } },
    h('div.row', h('div.grow', h('div.wt-head', entry.en), entry.ipa ? h('div.ipa', entry.ipa) : null),
      h('button.icon-btn.soft', { type: 'button', 'aria-label': `Прослухати: ${entry.en}`, onclick: () => speak(entry.en) }, ic('speaker-high'))),
    h('div.wt-uk', entry.uk),
    sourceLabel ? h('div', h('span.tag', sourceLabel)) : null,
    ex ? h('div.example', h('div.grow', h('div.small', ex), entry.exUk ? h('div.xs.dim', entry.exUk) : null)) : null,
    h('div.row.wrap', addBtn));
}

async function open(el, gl, onAsk) {
  const surface = el.textContent.replace(/\s+/g, ' ').trim();
  const example = sentenceOf(el);
  const body = h('div.stack');
  const s = sheet(null, body);
  const ctx = example ? h('p.small.dim.wt-ctx', { lang: 'en' }, example) : null;
  const ask = (word) => h('button.btn.ghost', { type: 'button', onclick: () => {
    s.close();
    if (onAsk) onAsk(word); else location.hash = `#/tutor?ask=${encodeURIComponent(word)}`;
  } }, ic('chat-circle-dots'), 'Запитати вчителя');

  const g = el.dataset.g && gl.get(el.dataset.g);
  if (g) {
    body.replaceChildren(entryBlock({ en: g.en || g.w, uk: g.uk, ipa: g.ipa || null }, example, 'Словничок тексту'), ctx || '');
    // IPA зі словника колод, якщо в словничку її немає
    if (!g.ipa) lookupDeck(g.en || g.w).then(({ hit }) => {
      if (hit?.ipa && norm(hit.en).replace(/^to /, '') === norm(g.en || g.w).replace(/^to /, '') && body.isConnected) {
        body.querySelector('.wt-head')?.after(h('div.ipa', hit.ipa));
      }
    }).catch(() => {});
    return;
  }
  body.replaceChildren(h('div.wt-head', surface), h('p.dim', 'Шукаю…'));
  let res;
  try { res = await lookupDeck(surface, nextWords(el)); }
  catch { res = { hit: null, phrase: null }; }
  if (!body.isConnected) return;
  const { hit, phrase } = res;
  if (!hit && !phrase) {
    body.replaceChildren(
      h('div.row', h('div.grow.wt-head', surface), h('button.icon-btn.soft', { type: 'button', 'aria-label': `Прослухати: ${surface}`, onclick: () => speak(surface) }, ic('speaker-high'))),
      h('p.dim', 'Немає в словнику'), ctx || '', h('div.row.wrap', ask(surface)));
    return;
  }
  const parts = [];
  if (hit) parts.push(entryBlock(hit, example, `Колода «${hit.deckName}»`));
  if (phrase && phrase !== hit) parts.push(h('div.section-title', 'Можливо, це фраза'), entryBlock(phrase, example, `Колода «${phrase.deckName}»`));
  body.replaceChildren(...parts, ctx || '', h('div.row.wrap', ask(hit ? surface : phrase.en)));
}
