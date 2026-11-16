import { assertEquals } from 'jsr:@std/assert@1';
import { worthChecking, cleanFriendFixes } from './friends.ts';

Deno.test('worthChecking: English sentences only', () => {
  assertEquals(worthChecking('ok'), false);
  assertEquals(worthChecking('Привіт, як справи?'), false);
  assertEquals(worthChecking('lol 😂'), false);
  assertEquals(worthChecking('I go to cinema yesterday'), true);
});

Deno.test('cleanFriendFixes: only real fragments, no casing/apostrophe, no names, max 3', () => {
  const text = 'yesterday i go to cinema with Olena and we was happy, dont worry';
  const r = cleanFriendFixes([
    { wrong: 'i go to cinema', right: 'I went to the cinema', why_uk: 'минулий час', rule: 'past-simple' },
    { wrong: 'dont', right: "don't", why_uk: 'апостроф', rule: 'other' },
    { wrong: 'with Olena', right: 'with Alena', why_uk: 'імені', rule: 'other' },
    { wrong: 'not in text', right: 'x y', why_uk: '', rule: 'other' },
    { wrong: 'we was', right: 'we were', why_uk: 'узгодження', rule: 'nope' },
  ], text);
  assertEquals(r.map(f => f.right), ['I went to the cinema', 'we were']);
  assertEquals(r[1].rule, 'other');
});
