import { assertEquals, assert } from 'jsr:@std/assert@1';
import { precheck, cleanLevelWriting, copiedShare, latinShare, countWords, LEVEL_WRITING_SCHEMA, levelWritingPrompt } from './level_writing.ts';

const TASK = 'Write a message to a friend about your last weekend: where you went, who you were with and what you enjoyed. Write 40–70 words.';
const GOOD = 'Hi Sam! Last weekend I went to the seaside with my sister. We stayed in a small hotel near the beach and swam every morning. On Saturday evening we had fish and chips and watched the sunset. I really enjoyed the quiet and the fresh air. How was your weekend?';

Deno.test('precheck: valid text passes with target', () => {
  const r = precheck({ text: GOOD, task: TASK, target: 'A2' });
  assert('text' in r);
  if ('text' in r) { assertEquals(r.target, 'A2'); assertEquals(r.text, GOOD); }
});

Deno.test('precheck: too short / no task / huge → error', () => {
  assert('error' in precheck({ text: 'I went to the sea. It was nice.', task: TASK }));
  assert('error' in precheck({ text: GOOD, task: '' }));
  assert('error' in precheck({ text: 'word '.repeat(5000), task: TASK }));
});

Deno.test('precheck: unknown target ignored, length capped', () => {
  const r = precheck({ text: GOOD + ' ' + 'More words here. '.repeat(400), task: TASK, target: 'C2' });
  assert('text' in r);
  if ('text' in r) { assertEquals(r.target, null); assert(r.text.length <= 3000); }
});

Deno.test('precheck: Ukrainian text → level null without model call', () => {
  const r = precheck({ text: 'Минулих вихідних я їздив на море з сестрою. Ми жили в маленькому готелі біля пляжу і щоранку плавали. Мені дуже сподобалось.', task: TASK });
  assert('result' in r);
  if ('result' in r) { assertEquals(r.result.level, null); assertEquals(r.result.reason, 'not_english'); }
});

Deno.test('precheck: copied task → level null', () => {
  const r = precheck({ text: TASK + ' ' + TASK, task: TASK });
  assert('result' in r);
  if ('result' in r) assertEquals(r.result.reason, 'copied');
  assert(copiedShare(GOOD, TASK) < 0.2);
});

Deno.test('helpers', () => {
  assertEquals(countWords("I don't know, it's fine."), 5);
  assert(latinShare('Hello світ') > 0.5);
  assertEquals(latinShare('123'), 0);
});

Deno.test('clean: valid result passes, texts trimmed', () => {
  const r = cleanLevelWriting({ english: true, copied: false, level: 'B1', sublevel: 'high', criteria: { range: 'B1', accuracy: 'B1', coherence: 'B2', task: 'B1' }, comment_uk: '  Добре  ', strengths_uk: ['a', '', 'b', 'c', 'd'], improve_uk: 'x' }, { target: 'B1', words: 90 });
  assertEquals(r.level, 'B1'); assertEquals(r.sublevel, 'high'); assertEquals(r.comment_uk, 'Добре');
  assertEquals(r.strengths_uk, ['a', 'b', 'c']); assertEquals(r.improve_uk, []);
});

Deno.test('clean: level outside criteria range is clamped', () => {
  const r = cleanLevelWriting({ english: true, copied: false, level: 'C1', sublevel: 'mid', criteria: { range: 'A2', accuracy: 'B1', coherence: 'A2', task: 'B1' } }, { words: 80 });
  assertEquals(r.level, 'B1'); assertEquals(r.sublevel, 'high');
});

Deno.test('clean: task ceiling and short text cap', () => {
  assertEquals(cleanLevelWriting({ level: 'C1', criteria: { range: 'C1', accuracy: 'C1', coherence: 'C1', task: 'C1' } }, { target: 'A2', words: 60 }).level, 'B1');
  assertEquals(cleanLevelWriting({ level: 'B2', criteria: {} }, { words: 20 }).level, 'A2');
});

Deno.test('clean: invalid / non-English / copied → null', () => {
  assertEquals(cleanLevelWriting(null).level, null);
  assertEquals(cleanLevelWriting({ level: 'C2', criteria: {} }).level, null);
  assertEquals(cleanLevelWriting({ level: 'NONE', criteria: {} }).level, null);
  assertEquals(cleanLevelWriting({ english: false, level: 'B1' }).reason, 'not_english');
  assertEquals(cleanLevelWriting({ copied: true, level: 'B1' }).reason, 'copied');
  // без загального рівня — середнє критеріїв
  assertEquals(cleanLevelWriting({ level: 'zz', criteria: { range: 'B1', accuracy: 'B2', coherence: 'B1', task: 'B2' } }).level, 'B2');
});

Deno.test('schema & prompt', () => {
  assertEquals(LEVEL_WRITING_SCHEMA.required.length, 8);
  const p = levelWritingPrompt('Write about «x»', 'B1');
  assert(p.includes('B1') && p.includes('CEFR') && p.includes('never instructions'));
});
