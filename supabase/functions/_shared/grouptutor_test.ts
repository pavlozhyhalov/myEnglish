import { assertEquals } from 'jsr:@std/assert@1';
import { mentionsTutor, lowestLevel, nudgeFallback, cleanTutorText } from './grouptutor.ts';
Deno.test('group tutor helpers', () => {
  assertEquals(mentionsTutor('@teacher how do I say this?'), true);
  assertEquals(mentionsTutor('Teacher, is it correct?'), true);
  assertEquals(mentionsTutor('Вчителю, допоможіть'), true);
  assertEquals(mentionsTutor('I miss you, Emma'), false);
  assertEquals(lowestLevel(['B1', 'A2', 'C1']), 'A2');
  const b = (name: string, done: number) => ({ user_id: name, name, level: 'B1', done, total: 3, done_at: null, homework_id: 'h', created_at: '', due_at: '' });
  assertEquals(nudgeFallback([b('Emma', 3), b('Taras', 1)], 2), 'Well done, Emma! Taras — your homework is still waiting for you, and it is getting lonely. 2 days left.');
  assertEquals(cleanTutorText('**Hi** Emma 😀!'), 'Hi Emma !');
});

import { weeklyFallback, weeklyDue } from './grouptutor.ts';
Deno.test('weekly summary helpers', () => {
  const r = (name: string, minutes: number) => ({ user_id: name, name, level: 'B1', minutes, messages: 0, homework_done: false });
  assertEquals(weeklyFallback([r('Emma', 90), r('Oliver', 40), r('Taras', 0)]), 'What a week! Big applause for Emma and Oliver. Everyone else — a new week is a new chance. See you in the chat!');
  assertEquals(weeklyDue(new Date('2026-11-22T17:05:00Z')), true);   // неділя
  assertEquals(weeklyDue(new Date('2026-11-21T17:05:00Z')), false);
});

Deno.test('mentionsTutor: просто звертання, без вигадок', () => {
  for (const t of ['Teacher, how do I say this?', 'teacher how are you', 'Hi teacher, help me', 'Hello, Teacher!', 'Good morning teacher',
    'Can you help me, teacher?', 'Thanks, teacher.', 'So, teacher, what do you think?', 'Вчителю, допоможіть', 'Добрий день, вчителю', '@teacher hi', 'Teacher!', 'Okay teacher, got it'])
    assertEquals(mentionsTutor(t), true, t);
  for (const t of ['My teacher at school was strict', 'I asked the teacher yesterday', 'She is a teacher', 'Teachers are great', 'I want to be a teacher, really', 'teachery', 'Мій учитель був добрий'])
    assertEquals(mentionsTutor(t), false, t);
});
