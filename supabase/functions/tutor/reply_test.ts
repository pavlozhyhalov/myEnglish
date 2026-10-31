import { assertEquals, assert } from 'jsr:@std/assert@1';
import { FixSplitter, splitReply, cleanFixes, formatFixes, cleanMeta, cleanMemory, spellingVariant, foundIn, lastStudentText } from './reply.ts';

function stream(chunks: string[]) {
  const sp = new FixSplitter();
  let shown = '';
  for (const c of chunks) shown += sp.push(c);
  const e = sp.end();
  shown += e.tail;
  return { shown, fixRaw: e.fixRaw, body: sp.body };
}

Deno.test('splitter: marker split across chunks never reaches the client', () => {
  const r = stream(['Nice! What did you do', ' then?\n\n--', '-FI', 'X---\n- I go → I went — минулий час']);
  assertEquals(r.shown.trimEnd(), 'Nice! What did you do then?');
  assertEquals(r.fixRaw?.trim(), '- I go → I went — минулий час');
  assert(!r.shown.includes('-'));
});

Deno.test('splitter: char-by-char stream', () => {
  const text = 'Great.\n**---FIX---**\n- a car → the car — why';
  const r = stream([...text]);
  assertEquals(r.shown.trim(), 'Great.');
  assertEquals(r.fixRaw?.trim(), '- a car → the car — why');
});

Deno.test('splitter: malformed and inline markers', () => {
  for (const m of ['--- FIX ---', '---FIXES---', '—— FIX ——', '–––fix–––']) {
    const r = splitReply(`Hello there. ${m}\n- x y → x z — w`);
    assertEquals(r.body, 'Hello there.', m);
    assertEquals(r.fixRaw?.trim(), '- x y → x z — w', m);
  }
});

Deno.test('splitter: no marker keeps hyphens, lists and bold intact', () => {
  const text = 'A well-known place:\n- first item\n- **second** item -\nEnd --';
  const chunks = text.match(/.{1,3}/gs)!;
  const r = stream(chunks);
  assertEquals(r.shown, text);
  assertEquals(r.fixRaw, null);
});

Deno.test('cleanFixes: keeps real fixes, drops false/broken ones', () => {
  const msg = 'Yesterday I go to the shop and I am agree with you. My favourite color is blue.';
  const raw = [
    '- I go → I went — минулий час',
    '* "I am agree" -> I agree — agree — дієслово',
    '- color → colour — британське написання',
    '- she have → she has — не з повідомлення',
    'None',
    '- Yesterday → yesterday — регістр',
    'Some chatter after the block',
    '- I go → I went — дубль',
  ].join('\n');
  const f = cleanFixes(raw, msg, 'important');
  assertEquals(f.map(x => `${x.wrong}|${x.right}`), ['I go|I went', 'I am agree|I agree']);
  assertEquals(f[1].why, 'agree — дієслово');
});

Deno.test('cleanFixes: strictness all keeps punctuation fixes; max 5', () => {
  const msg = 'hello how are you';
  assertEquals(cleanFixes('- hello how → Hello, how — кома', msg, 'all').length, 1);
  assertEquals(cleanFixes('- hello how → Hello, how — кома', msg, 'important').length, 0);
  const many = Array.from({ length: 8 }, (_, i) => `- w${i} x → w${i} y — z`).join('\n');
  assertEquals(cleanFixes(many, Array.from({ length: 8 }, (_, i) => `w${i} x`).join(' '), 'all').length, 5);
});

Deno.test('cleanFixes: Cyrillic and none lines dropped', () => {
  assertEquals(cleanFixes('- я пішов → I went — переклад\n- ok → none', 'я пішов ok'), []);
});

Deno.test('formatFixes matches client parser format', () => {
  assertEquals(formatFixes([{ wrong: 'I go', right: 'I went', why: 'past' }]), '\n\n---FIX---\n- I go → I went — past');
  assertEquals(formatFixes([]), '');
});

Deno.test('spellingVariant and foundIn', () => {
  assert(spellingVariant('color', 'colour'));
  assert(spellingVariant('realize', 'realise'));
  assert(spellingVariant('center', 'centre'));
  assert(spellingVariant('traveled', 'travelled'));
  assert(!spellingVariant('I go', 'I went'));
  assert(foundIn('i am agree', 'Well, I am agree.'));
  assert(foundIn('I go to shop', 'I go to the shop'));
  assert(!foundIn('she have', 'I have a dog'));
});

Deno.test('cleanMeta: filters suggestions, words and memory', () => {
  const reply = 'That sounds exhausting! Did you manage to unwind at the weekend?';
  const m = cleanMeta({
    suggestions: ['1. Yes, I relaxed at home.', 'Not really, I was busy.', 'Так, відпочив', 'Not really, I was busy.', 'I went for a long walk.'],
    words: [{ en: 'unwind', uk: 'розслабитися' }, { en: 'exhausting', uk: 'виснажливий' }, { en: 'serendipity', uk: 'щаслива випадковість' }, { en: 'weekend', uk: 'weekend' }],
    memory: ['Works as a nurse', 'Has a daughter called Mia', 'Takes medication for depression'],
  }, { reply, learning: ['exhausting'], memory: ['Works as a nurse in Lviv'] })!;
  assertEquals(m.suggestions, ['Yes, I relaxed at home.', 'Not really, I was busy.', 'I went for a long walk.']);
  assertEquals(m.words, [{ en: 'unwind', uk: 'розслабитися' }]);
  assertEquals(m.memory, ['Has a daughter called Mia']);
});

Deno.test('cleanMeta: nothing useful → null; bad input safe', () => {
  assertEquals(cleanMeta(null, { reply: 'Hi' }), null);
  assertEquals(cleanMeta({ suggestions: ['only one'] , words: 'x', memory: 5 }, { reply: 'Hi' }), null);
});

Deno.test('cleanMemory: dedupe, length, objects', () => {
  assertEquals(cleanMemory([{ text: 'Likes hiking' }, 'likes hiking', 'x'.repeat(200), 'Plays the guitar'], ['Has a cat']), ['Likes hiking', 'Plays the guitar']);
  assertEquals(cleanMemory(['Has a cat called Tom'], ['Has a cat called Tom.']), []);
});

Deno.test('lastStudentText skips app cues', () => {
  assertEquals(lastStudentText([{ role: 'user', text: 'I go home' }, { role: 'model', text: 'ok' }]), 'I go home');
  assertEquals(lastStudentText([{ role: 'user', text: '(The student has opened the session.)' }]), '');
});

import { cleanSummary } from './reply.ts';
Deno.test('cleanSummary: keeps old fields, cleans new ones', () => {
  const r = cleanSummary({
    summary: 'Добре', mistakes: [{ wrong: 'I go', right: 'I went', type: 'tenses', explanation_uk: 'x' }, { wrong: 'color', right: 'colour', type: 'other' }, { wrong: 'a', right: 'a' }],
    new_words: [{ en: 'unwind', uk: 'розслабитися', example: 'I unwind.' }, { en: '', uk: 'x' }], level_signal: 'B3', next_focus: 'Past Simple',
    focus_review: 'ok', practised_words: ['Commute', 'banana'], memory: ['Has a cat', 'Has a cat called Tom'],
  }, { words: ['commute', 'reliable'], memory: ['Has a cat'], level: 'A2' });
  assertEquals(r.mistakes.length, 1);
  assertEquals(r.new_words.length, 1);
  assertEquals(r.level_signal, 'A2');
  assertEquals(r.practised_words, ['commute']);
  assertEquals(r.memory, ['Has a cat called Tom']);
  assertEquals(cleanSummary(null, { words: [], memory: [], level: 'B1' }).summary, '');
});

import { replyStream } from './reply.ts';
async function readSSE(rs: ReadableStream<Uint8Array>) {
  const txt = await new Response(rs).text();
  return txt.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
}
async function* gen(chunks: string[], fail = false) { for (const c of chunks) yield c; if (fail) throw new Error('broken'); }

Deno.test('replyStream: text, cleaned fix block, end, meta, done', async () => {
  const ev = await readSSE(replyStream(gen(['Oh, you went', ' there? Nice.\n---F', 'IX---\n- I go there → I went there — past\n- bogus → thing — x']),
    (raw) => formatFixes(cleanFixes(raw || '', 'Yesterday I go there.')), async (body) => ({ suggestions: ['a', 'b'], words: [{ en: body.slice(0, 3), uk: 'о' }] })));
  const text = ev.filter(e => e.t).map(e => e.t).join('');
  assertEquals(text.trim(), 'Oh, you went there? Nice.\n\n---FIX---\n- I go there → I went there — past');
  assertEquals(ev.slice(-3).map(e => Object.keys(e)[0]), ['end', 'meta', 'done']);
  assertEquals(ev.at(-2).meta.words[0].en, 'Oh,');
});

Deno.test('replyStream: model stream breaks → error event; meta failure → no meta', async () => {
  const ev = await readSSE(replyStream(gen(['Hi'], true), () => '', null));
  assertEquals(ev.at(-1), { error: { code: 'overloaded' } });
  const ev2 = await readSSE(replyStream(gen(['Hi']), () => '', () => Promise.reject(new Error('x'))));
  assertEquals(ev2.map(e => Object.keys(e)[0]), ['t', 'end', 'done']);
});

import { cueText, translateInput } from './reply.ts';
Deno.test('cleanFixes: explanation in brackets / after colon is split off, not dropped', () => {
  const msg = 'Yesterday I go to the shop. Hello how are you';
  const f = cleanFixes('- I go → I went (минулий час)\n- I go to → I went to: минулий час\n- Hello how → Hello, how (кома)', msg, 'all');
  assertEquals(f.map(x => `${x.wrong}|${x.right}|${x.why}`), ['I go|I went|минулий час', 'I go to|I went to|минулий час', 'Hello how|Hello, how|кома']);
  // українська в самому «right» без роздільника — як і раніше відкидаємо
  assertEquals(cleanFixes('- I go → я пішов', msg), []);
});

Deno.test('lastStudentText / cueText: cue messages are app instructions', () => {
  assertEquals(lastStudentText([{ role: 'user', text: 'I go home' }, { role: 'model', text: 'ok' }, { role: 'user', cue: true, text: 'Translate this: hi' }]), '');
  assertEquals(cueText({ role: 'user', cue: true, text: 'Say it simpler' }).startsWith('(App cue'), true);
  assertEquals(cueText({ role: 'user', cue: true, text: '(App cue — simpler)' }), '(App cue — simpler)');
  assertEquals(cueText({ role: 'user', text: 'Say it simpler' }), 'Say it simpler');
  assertEquals(cueText({ role: 'model', cue: true, text: 'x' }), 'x');
});

Deno.test('translateInput: validation and cap', () => {
  assertEquals(translateInput('   '), '');
  assertEquals(translateInput(undefined), '');
  assertEquals(translateInput({ a: 1 }), '');
  assertEquals(translateInput('  Hi\r\n\n\n\nthere  '), 'Hi\n\nthere');
  assertEquals(translateInput('x'.repeat(9000)).length, 4000);
});

Deno.test('cleanMemory: phone numbers are not stored', () => {
  assertEquals(cleanMemory(['Phone +48 600 100 200', 'Call 600-100-200', 'Has a dog, Rex', 'Moved here in 2021']), ['Has a dog, Rex', 'Moved here in 2021']);
});

import { joinContinuation } from './reply.ts';
function genInfo(chunks: string[], finishReason: string) {
  const g = gen(chunks) as AsyncGenerator<string> & { info: { finishReason: string } };
  g.info = { finishReason };
  return g;
}

Deno.test('replyStream: truncated reply is continued once, overlap removed', async () => {
  let asked = '';
  const ev = await readSSE(replyStream(genInfo(['Here is your first practice sentence to'], 'MAX_TOKENS'), () => '', null,
    async (partial) => { asked = partial; return 'sentence to complete: She ___ (go) home.\n---FIX---\n- a b → a c — x'; }));
  assertEquals(asked, 'Here is your first practice sentence to');
  const text = ev.filter(e => e.t).map(e => e.t).join('');
  assertEquals(text, 'Here is your first practice sentence to complete: She ___ (go) home.');
});

Deno.test('replyStream: empty reply → recover; recover fails → error empty', async () => {
  const ev = await readSSE(replyStream(genInfo([], 'STOP'), () => '', null, async () => 'Hello!'));
  assertEquals(ev.filter(e => e.t).map(e => e.t).join(''), 'Hello!');
  const ev2 = await readSSE(replyStream(genInfo([], 'STOP'), () => '', null, () => Promise.reject(new Error('x'))));
  assertEquals(ev2.at(-1), { error: { code: 'empty' } });
});

Deno.test('replyStream: truncated inside FIX block → no continuation, partial line dropped', async () => {
  let called = false;
  const ev = await readSSE(replyStream(genInfo(['Nice!\n---FIX---\n- I go → I went — past\n- the hi'], 'MAX_TOKENS'),
    (raw) => formatFixes(cleanFixes(raw || '', 'I go to the hike', 'important')), null, async () => { called = true; return 'x'; }));
  assertEquals(called, false);
  assertEquals(ev.filter(e => e.t).map(e => e.t).join('').trim(), 'Nice!\n\n---FIX---\n- I go → I went — past');
});

Deno.test('joinContinuation', () => {
  assertEquals(joinContinuation('Hello wor', 'ld!'), 'ld!');
  assertEquals(joinContinuation('Hello there, my friend', 'Hello there, my friend. How are you?'), '. How are you?');
  assertEquals(joinContinuation('It is a long sentence that stops', 'sentence that stops here.'), ' here.');
  assertEquals(joinContinuation('abc', ''), '');
});

Deno.test('cleanMeta: grammar terms / praise not words; relative-time memory dropped; plan placeholders dropped', () => {
  const reply = 'Spot on! A countable noun needs an article. The view must have been breathtaking; did it pay off?';
  const m = cleanMeta({
    suggestions: [],
    words: [{ en: 'spot on', uk: 'влучно' }, { en: 'countable noun', uk: 'злічуваний іменник' }, { en: 'pay off', uk: 'окупитися' }],
    memory: ['Went to the Carpathians last weekend', 'Ran a half-marathon on 25 Oct 2026 in 2:05'],
    plan: ['Розмова про похід', 'Фокус на [accuracy]', 'Підсумок і виправлення'],
  }, { reply, plan: true })!;
  assertEquals(m.words, [{ en: 'pay off', uk: 'окупитися' }]);
  assertEquals(m.memory, ['Ran a half-marathon on 25 Oct 2026 in 2:05']);
  assertEquals(m.plan, ['Розмова про похід', 'Підсумок і виправлення']);
});
