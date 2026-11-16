import { assertEquals, assert } from 'jsr:@std/assert@1';
import { pickLesson, baseTasks, cleanHw, RULE_LESSONS } from './homework.ts';

const L = [
  { id: 'past-simple-basics', title: 'Past Simple', level: 'A2', n: 30 },
  { id: 'present-perfect', title: 'Present Perfect', level: 'B1', n: 50 },
  { id: 'to-be', title: 'to be', level: 'A1', n: 16 },
  { id: 'have-got', title: 'have got', level: 'A1', n: 17 },
  { id: 'conditional-3', title: 'Third conditional', level: 'B2', n: 70 },
];
const M = (o: Record<string, unknown> = {}) => ({ user_id: 'u', name: 'Емма', level: 'B1', interests: '', weak: [], done: new Set<string>(), words: [], ...o }) as any;

Deno.test('pickLesson: weak rule lesson of my level or lower, not above', () => {
  assertEquals(pickLesson(M({ weak: [{ rule: 'past-simple', n: 5 }] }), L).lesson?.id, 'past-simple-basics');
  // conditional-3 (B2) — вище за B1: не дається; запасний — наступний урок свого рівня
  assertEquals(pickLesson(M({ weak: [{ rule: 'conditionals', n: 5 }] }), L).lesson?.id, 'present-perfect');
  // уже пройдений урок слабкого правила — все одно краще, ніж нічого
  assertEquals(pickLesson(M({ level: 'A1', weak: [{ rule: 'be-auxiliary', n: 3 }], done: new Set(['to-be']) }), L).lesson?.id, 'to-be');
  assertEquals(pickLesson(M({ level: 'A1', done: new Set(['to-be']) }), L).lesson?.id, 'have-got');
});

Deno.test('baseTasks: targets by level, speak alternative', () => {
  const a = baseTasks(M({ level: 'A1' }), L);
  assertEquals(a.tasks.map(t => [t.kind, t.target]), [['write', 25], ['lesson', 1], ['words', 30]]);
  const b = baseTasks(M({ level: 'C1' }), L, { speak: true });
  assertEquals(b.tasks[0].kind, 'speak');
  assertEquals(b.tasks[0].target, 75);
  assert(Object.keys(RULE_LESSONS).length >= 29);
});

Deno.test('cleanHw: rejects wrong scripts', () => {
  assertEquals(cleanHw({ note_uk: 'Hello', prompt_en: 'Write', prompt_uk: '', focus_uk: '' }), null);
  assertEquals(cleanHw({ note_uk: 'Цього тижня — Past Simple.', prompt_en: 'Напишіть', prompt_uk: '', focus_uk: '' }), null);
  const ok = cleanHw({ note_uk: 'Цього тижня — Past Simple.', prompt_en: 'Write 60 words about your weekend. Use 3 verbs in the Past Simple.', prompt_uk: 'Напишіть 60 слів.', focus_uk: 'Past Simple: went, saw' });
  assertEquals(ok?.focus_uk, 'Past Simple: went, saw');
});
