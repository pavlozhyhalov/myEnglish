import { assertEquals } from 'jsr:@std/assert@1';
import { usageFrom } from './meter.ts';

Deno.test('meter: текст, аудіо, роздуми', () => {
  assertEquals(usageFrom({ promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 50, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 880 }, { modality: 'AUDIO', tokenCount: 320 }] }),
    { inText: 880, inAudio: 320, outText: 300, outAudio: 0, thoughts: 50 });
  assertEquals(usageFrom({ promptTokenCount: 20, candidatesTokenCount: 500, candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: 500 }] }),
    { inText: 20, inAudio: 0, outText: 0, outAudio: 500, thoughts: 0 });
  assertEquals(usageFrom({ promptTokenCount: 100, responseTokenCount: 40, responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 40 }] }),
    { inText: 100, inAudio: 0, outText: 0, outAudio: 40, thoughts: 0 });
  assertEquals(usageFrom(null), null);
  assertEquals(usageFrom({}), null);
});

Deno.test('meter: користувач запиту й вартість', async () => {
  const { withRequest, setRequestUser, currentUser, costMicros } = await import('./meter.ts');
  const run = (id: string) => withRequest(async () => { await new Promise(r => setTimeout(r, 3)); setRequestUser(id); await new Promise(r => setTimeout(r, 5)); return currentUser(); });
  const [a, b] = await Promise.all([run('a'), run('b')]);
  if (a !== 'a' || b !== 'b') throw new Error(`context ${a} ${b}`);
  if (currentUser() !== '') throw new Error('leak');
  // 1000 вхідних і 500 вихідних токенів lite: 1000×0,30 + 500×2,5 = 1550 мільйонних долара
  if (costMicros('gemini-3.5-flash-lite', { inText: 1000, inAudio: 0, outText: 500, outAudio: 0, thoughts: 0 }) !== 1550) throw new Error('cost');
});
