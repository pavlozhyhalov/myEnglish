import { assertEquals, assert } from 'jsr:@std/assert@1';
import { cleanVoiceCheck, clampSpeech, cleanMastered, cleanMissions, summaryExtra } from './coach.ts';

const ST = { open: [{ id: 'm1', wrong: 'I feeling tired', right: "I'm feeling tired" }] } as any;

Deno.test('cleanVoiceCheck: keeps only fixes found in text, max 2, drops unclear', () => {
  const r = cleanVoiceCheck({ text: 'Yesterday I go to the forest and I feeling tired', fixes: [
    { wrong: 'I go', right: 'I went', why_uk: 'минулий час' }, { wrong: 'not here', right: 'x', why_uk: '' },
    { wrong: 'I feeling', right: "I'm feeling", why_uk: '' }, { wrong: 'the forest', right: 'the forest', why_uk: '' }] });
  assertEquals(r.fixes.map(f => f.right), ['I went', "I'm feeling"]);
  assertEquals(cleanVoiceCheck({ text: '[unclear]', fixes: [] }).text, '');
});

Deno.test('clampSpeech and mastered', () => {
  assertEquals(clampSpeech({ words: 0 }), null);
  const s = clampSpeech({ words: 120, speech_sec: 90, wpm: 9999, avg_len: 7.456, repeats: 4, fillers: 2, unique_ratio: 0.534, turns: 12 })!;
  assertEquals([s.wpm, s.avg_len, s.unique_ratio], [400, 7.5, 0.53]);
  assertEquals(cleanMastered(['m1', 'zz', 'm1'], ST), ['m1']);
  assert(summaryExtra(ST, s).includes('m1: "I feeling tired"'));
});

Deno.test('cleanMissions: requires core fields, filters non-English phrases', () => {
  const r = cleanMissions({ missions: [{ title: 'Дзвінок', why_uk: 'w', situation: 's', myRole: 'a', tutorRole: 'b', goal: 'g', phrases: ['Could I book…', 'привіт'] }, { title: '' }] });
  assertEquals(r.missions.length, 1);
  assertEquals(r.missions[0].phrases, ['Could I book…']);
});
