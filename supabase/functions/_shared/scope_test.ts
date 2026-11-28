import { assertEquals } from 'jsr:@std/assert@1';
import { offTopic, scopeGuard } from './scope.ts';

Deno.test('offTopic: прохання не про англійську', () => {
  assertEquals(offTopic('Write me a Python script that parses CSV files'), 'make');
  assertEquals(offTopic('```js\nconst a = 1;\n```'), 'code');
  assertEquals(offTopic('def main():\n  print(1)'), 'code');
  assertEquals(offTopic('Напиши мені есе про екологію на 500 слів'), 'make');
  assertEquals(offTopic('Сделай мне резюме для работы'), 'make');
  assertEquals(offTopic('Розв\'яжи задачу з фізики'), 'solve');
  assertEquals(offTopic('solve 2x + 3 = 7'), 'solve');
  assertEquals(offTopic('a'.repeat(2000)), 'paste');
});

Deno.test('offTopic: звичайні репліки учня — ні', () => {
  for (const t of ['I went to the cinema yesterday with my friends.', 'What is the difference between make and do?',
    'Can you explain Present Perfect?', 'I wrote a long email to my boss today.', 'My daughter likes to draw pictures.',
    'How do I say «зробити домашнє завдання» in English?', 'Let\'s talk about my mistakes.', 'I think the function of art is to make people feel.'])
    assertEquals(offTopic(t), '', t);
});

Deno.test('scopeGuard: суворий режим і вставлений текст', () => {
  const g = scopeGuard('paste', true);
  assertEquals(g.includes('long pasted text') && g.includes('at most 3 short sentences') && g.includes('never translate'), true);
  assertEquals(scopeGuard('make', false).includes('at most 3'), false);
});
