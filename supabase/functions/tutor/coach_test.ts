import { assertEquals, assert } from 'jsr:@std/assert@1';
import { recognitionContext, clampRounds, cleanFluency, calibrateLevel, mergeTurnFixes, scoreEval, GOLDEN, cleanClassify, cleanVoiceCheck, clampSpeech, cleanMastered, cleanMissions, summaryExtra } from './coach.ts';

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

Deno.test('mergeTurnFixes: adds missing turn fixes, skips covered and disputed', () => {
  const m = mergeTurnFixes([{ wrong: 'I have been in the forest', right: 'I was in the forest' }], [
    { wrong: 'I have been', right: 'I was', why: '' }, { wrong: 'make photos', right: 'take photos', why: 'collocation' }, { wrong: 'depend of', right: 'depend on', why: '' }],
    [{ wrong: 'depend of', right: 'depend on' }]);
  assertEquals(m.map(x => x.wrong), ['I have been in the forest', 'make photos']);
});

Deno.test('scoreEval: recall over known mistakes, fp on correct sentences', () => {
  const items = GOLDEN.map((g, i) => ({ i, fixes: g.key ? [{ wrong: 'x', right: g.key.split('|')[0] }] : [] }));
  assertEquals(scoreEval({ items }), { recall: 1, fp: 0, answered: GOLDEN.length });
  items[GOLDEN.length - 1].fixes = [{ wrong: 'a', right: 'b' }];
  items[0].fixes = [];
  const r = scoreEval({ items });
  assert(r.recall < 1 && r.fp === 1);
  assertEquals(cleanClassify({ items: [{ i: 0, rule: 'prep-dependent' }, { i: 9, rule: 'x' }] }, 2), [{ i: 0, rule: 'prep-dependent', type: 'prepositions' }]);
});

Deno.test('calibrateLevel: long connected turns cannot be A1; far below usual level → low confidence', () => {
  const mk = () => ({ level_signal: 'A1', level_assessment: { confidence: 'high', sublevel: 'mid', criteria: [{ name: 'fluency', level: 'A1' }], reasons_uk: ['x'] } });
  const a = calibrateLevel(mk(), { words: 497, avg_len: 20.7, turns: 24 }, 'B1');
  assertEquals(a.level_signal, 'A2');
  assertEquals(a.level_assessment.confidence, 'high');
  const b = calibrateLevel(mk(), { words: 60, avg_len: 4, turns: 10 }, 'B1');
  assertEquals([b.level_signal, b.level_assessment.confidence], ['A1', 'low']);
  const c = calibrateLevel({ level_signal: 'B1', level_assessment: { confidence: 'medium', criteria: [], reasons_uk: [] } }, null, 'B1');
  assertEquals(c.level_assessment.confidence, 'medium');
});

Deno.test('recognitionContext: tutor line + profile/memory names, nothing when empty', () => {
  const st: any = { about: { location: 'Kraków', occupation: 'engineer', interests: 'cycling, PlayStation games', otherLangs: '' }, memory: ['Went skiing in Zakopane in Jan 2026', 'Plays Warships Legends'], words: ['commute'] };
  const c = recognitionContext(st, 'Did you get sick on Saturday or Sunday?');
  assert(c.includes('the tutor just said') && c.includes('Zakopane') && c.includes('Warships Legends') && c.includes('Kraków'));
  assertEquals(recognitionContext({ about: {} as any, memory: [], words: [] } as any, ''), '');
});

Deno.test('fluency: rounds clamped, feedback cleaned', () => {
  assertEquals(clampRounds([{ sec: 999, text: 'uh I I go', wpm: 80, fillers: 3, repeats: 1 }, { text: '' }]), [{ sec: 180, text: 'uh I I go', wpm: 80, fillers: 3, repeats: 1 }]);
  const f = cleanFluency({ summary_uk: 'Добре', better: [{ from: 'I I I go', to: 'Well, I go' }, { from: 'x', to: 'x' }], gambits: ['Let me think…', 'дай подумати'] });
  assertEquals([f.better.length, f.gambits], [1, ['Let me think…']]);
});
