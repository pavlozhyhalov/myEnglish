import { assertEquals, assert } from 'jsr:@std/assert@1';
import { precheck, cleanWordStory, formsIn, variants, core, wordStoryPrompt, WORD_STORY_SCHEMA, countWords } from './words.ts';

const WORDS = [
  { en: 'to make a mistake', uk: 'помилитися' }, { en: 'to give up', uk: 'здатися' }, { en: 'to look after sb', uk: 'доглядати' },
  { en: 'cheerful', uk: 'життєрадісний' }, { en: 'to borrow', uk: 'позичати (у когось)' }, { en: 'a neighbour', uk: 'сусід' },
];
const TEXT = `Tom lives next door to a cheerful old lady. Every Saturday he looks after her garden while she visits her sister.
Last week Tom made a big mistake: he cut down her favourite roses instead of the weeds. He wanted to give up gardening for ever.

But his neighbour only laughed. "Everyone makes mistakes," she said. "Next time, just borrow my book about flowers first." Now Tom borrows a new book every month, and the garden looks better than ever. They often drink tea together on the bench.`;
const GOOD = {
  title: 'The Roses',
  text: TEXT,
  used: ['to make a mistake', 'to give up', 'cheerful'],
  questions: [
    { q: 'What did Tom cut down?', options: ['The roses', 'A tree', 'The fence'], answer: 0 },
    { q: 'How did the neighbour react?', options: ['She was angry', 'She laughed', 'She cried'], answer: 1 },
    { q: 'What does Tom borrow now?', options: ['Tools', 'Tea', 'Books about flowers'], answer: 2 },
  ],
};

Deno.test('precheck: dedupe, limits, level', () => {
  const r = precheck({ words: [...WORDS, { en: 'make a mistake', uk: 'x' }, { en: '', uk: 'y' }, { en: 'привіт', uk: 'hi' }], level: 'B1' });
  assert('words' in r);
  if ('words' in r) { assertEquals(r.words.length, 6); assertEquals(r.level, 'B1'); }
  const r2 = precheck({ words: WORDS, level: 'C2' });
  assert('words' in r2 && r2.level === null);
  assert('error' in precheck({ words: WORDS.slice(0, 3) }));
  assert('error' in precheck({ words: 'cat' }));
  const many = Array.from({ length: 30 }, (_, i) => ({ en: `word${String.fromCharCode(97 + i % 26)}${i}`, uk: 'x' }));
  const r3 = precheck({ words: many });
  assert('words' in r3 && r3.words.length === 12);
});

Deno.test('formsIn: inflections, phrases, placeholders', () => {
  assertEquals(formsIn(TEXT, 'to make a mistake').sort(), ['made a big mistake', 'makes mistakes']);
  assertEquals(formsIn(TEXT, 'to give up'), ['give up']);
  assertEquals(formsIn(TEXT, 'to look after sb'), ['looks after']);
  assertEquals(formsIn(TEXT, 'to borrow').sort(), ['borrow', 'borrows']);
  assertEquals(formsIn(TEXT, 'a neighbour'), ['neighbour']);
  assertEquals(formsIn('He gave up early.', 'to give up'), ['gave up']);
  assertEquals(formsIn('She studied hard.', 'to study'), ['studied']);
  assertEquals(formsIn('Be careful.', 'car'), []);
  assertEquals(formsIn('I love colour.', 'color (colour)').length + formsIn('I love colour.', 'colour (color)').length > 0, true);
});

Deno.test('variants / core', () => {
  assertEquals(variants('to miss a flight / train'), ['to miss a flight', 'to miss a train']);
  assertEquals(core('To look after sb'), 'look after');
});

Deno.test('cleanWordStory: used recomputed from text', () => {
  const s = cleanWordStory(GOOD, WORDS, 'B1');
  assert(s);
  if (!s) return;
  // модель вказала 3, у тексті є 6 — сервер додає пропущені
  assertEquals(s.used.sort(), WORDS.map(w => w.en).sort());
  assert(s.forms['to look after sb'].includes('looks after'));
  assertEquals(s.questions.length, 3);
  assertEquals(s.title, 'The Roses');
});

Deno.test('cleanWordStory: claimed but absent words are dropped; too few → null', () => {
  const text = 'Anna is a cheerful girl. She likes her neighbour. ' + 'They walk in the park and talk about films, books and music every single day after school. '.repeat(5);
  const r = cleanWordStory({ ...GOOD, text, used: WORDS.map(w => w.en) }, WORDS, 'B1');
  assertEquals(r, null);
});

Deno.test('cleanWordStory: bad questions filtered, length checked, markdown stripped', () => {
  const bad = { ...GOOD, text: TEXT.replace('cheerful', '**cheerful**'), questions: [
    GOOD.questions[0],
    { q: 'Dup?', options: ['A', 'a', 'B'], answer: 0 },
    { q: 'Out of range', options: ['A', 'B', 'C'], answer: 3 },
    { q: '', options: ['A', 'B'], answer: 0 },
    GOOD.questions[1],
  ] };
  const s = cleanWordStory(bad, WORDS, 'B1');
  assert(s);
  if (s) { assertEquals(s.questions.length, 2); assert(!s.text.includes('**')); }
  assertEquals(cleanWordStory({ ...GOOD, questions: [GOOD.questions[0]] }, WORDS, 'B1'), null);
  assertEquals(cleanWordStory({ ...GOOD, text: 'Too short. cheerful neighbour borrow.' }, WORDS, 'B1'), null);
  assertEquals(cleanWordStory({ ...GOOD, text: TEXT + (' extra words here').repeat(80) }, WORDS, 'B1'), null);
  assertEquals(cleanWordStory(null, WORDS, 'B1'), null);
});

Deno.test('prompt and schema', () => {
  const p = wordStoryPrompt(WORDS, 'A2', 'CONTEXT');
  assert(p.startsWith('CONTEXT'));
  assert(p.includes('to make a mistake (помилитися)'));
  assert(p.includes('BRITISH'));
  assert(p.includes('70–110'));
  assertEquals(WORD_STORY_SCHEMA.required, ['title', 'text', 'used', 'questions']);
  assert(countWords(TEXT) >= 60);
});
