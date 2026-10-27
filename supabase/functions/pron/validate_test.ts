import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { normalizeResult, targetWords } from './validate.ts';

Deno.test('targetWords skips pure punctuation', () => {
  assertEquals(targetWords('Hi , there — ok?'), ['Hi', 'there', 'ok?']);
});

Deno.test('aligns words to target, keeps punctuation, clamps score', () => {
  const r = normalizeResult({
    heard: 'I sink so', no_speech: false, score: 140,
    words: [{ word: 'I', ok: true, status: 'ok' }, { word: 'think', ok: false, status: 'wrong', issue_uk: '/θ/ як /s/', tip_uk: 'Язик між зубами' }, { word: 'so.', ok: true }],
    tips: ['Порада 1', 'Порада 1', 'Порада 2', 'Порада 3', 'Порада 4'],
  }, 'I think so.');
  assertEquals(r.score, 100);
  assertEquals(r.words.map(w => w.word), ['I', 'think', 'so.']);
  assertEquals(r.words.map(w => w.status), ['ok', 'wrong', 'ok']);
  assertEquals(r.words[1].issue_uk, '/θ/ як /s/');
  assertEquals(r.tips, ['Порада 1', 'Порада 2', 'Порада 3']);
  assertEquals(r.no_speech, false);
});

Deno.test('missing words from model default to ok; ok-words drop issue text', () => {
  const r = normalizeResult({ heard: 'hello world', score: 88, words: [{ word: 'hello', ok: true, status: 'ok', issue_uk: 'x' }], tips: [] }, 'Hello world');
  assertEquals(r.words.length, 2);
  assert(r.words.every(w => w.ok));
  assertEquals(r.words[0].issue_uk, undefined);
  assertEquals(r.tips.length, 1);
});

Deno.test('no speech → score 0, all missed', () => {
  const r = normalizeResult({ heard: '', no_speech: false, score: 70, words: [], tips: [] }, 'Good morning');
  assertEquals(r.score, 0);
  assertEquals(r.no_speech, true);
  assert(r.words.every(w => w.status === 'missed' && !w.ok));
});

Deno.test('mostly wrong caps score at 50; ok:false without status → wrong', () => {
  const r = normalizeResult({ heard: 'x', score: 95, words: [{ word: 'red', ok: false }, { word: 'lorry', ok: false }, { word: 'now', ok: true }], tips: ['t'] }, 'red lorry now');
  assertEquals(r.words.map(w => w.status), ['wrong', 'wrong', 'ok']);
  assertEquals(r.score, 50);
});

Deno.test('position fallback for slightly different spelling; strings are trimmed and capped', () => {
  const r = normalizeResult({ heard: 'im here', score: '77.6', words: [{ word: 'Im', ok: false, status: 'minor', issue_uk: '  a  '.repeat(100) }, { word: 'here', ok: true, status: 'ok' }], tips: ['  tip  '] }, "I'm here");
  assertEquals(r.score, 78);
  assertEquals(r.words[0].status, 'minor');
  assert(r.words[0].issue_uk!.length <= 160);
  assertEquals(r.tips, ['tip']);
});

Deno.test('rejects non-objects and missing score', () => {
  assertThrows(() => normalizeResult(null, 'a'));
  assertThrows(() => normalizeResult([1], 'a'));
  assertThrows(() => normalizeResult({ heard: 'a', words: [] }, 'a'));
  assertThrows(() => normalizeResult('{"score":1}', 'a'));
});

Deno.test('ignores unknown status and junk word entries', () => {
  const r = normalizeResult({ heard: 'cat', score: 60, words: [null, 5, { word: 'cat', ok: true, status: 'great' }], tips: [7, ''] }, 'cat');
  assertEquals(r.words[0].status, 'ok');
  assertEquals(r.tips, ['7']);
});
