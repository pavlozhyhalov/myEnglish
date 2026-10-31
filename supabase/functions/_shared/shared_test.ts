import { assertEquals, assert, assertRejects } from 'jsr:@std/assert@1';
import { thinkingConfig, generate, streamText, candidateText, isCooled } from './gemini.ts';
import { readMemory, sessionFocus, basePrompt, modePrompt, metaPrompt, wordsForLevel, todayLabel, memoryRule, UK_STYLE, type Student } from './prompts.ts';

const st = (over: Partial<Student> = {}): Student => ({
  level: 'B1', tutorName: 'Alex', tutorTone: 'friendly', explainLang: 'uk', strictness: 'important', voice: 'Puck', workFocus: false,
  weak: [{ type: 'articles', count: 5, examples: ['"I have car" → "I have a car"'] }], words: ['commute', 'reliable', 'afford'], lastFocus: null,
  about: { name: '', pronoun: 'they', nativeLang: 'Ukrainian', otherLangs: '', location: '', age: '', occupation: '', family: '', interests: '', goals: [], avoid: '', notes: '' },
  memory: [], recent: [], ...over,
});

Deno.test('thinkingConfig per model family', () => {
  assertEquals(thinkingConfig('gemini-2.5-flash', 'off'), { thinkingBudget: 0 });
  assertEquals(thinkingConfig('gemini-2.5-pro', 'off'), { thinkingBudget: 128 });
  assertEquals(thinkingConfig('gemini-flash-latest', 'low'), { thinkingLevel: 'low' });
  assertEquals(thinkingConfig('gemini-pro-latest', 'medium'), { thinkingLevel: 'high' });
  assertEquals(thinkingConfig('gemini-flash-lite-latest', 'off'), { thinkingLevel: 'minimal' });
  assertEquals(thinkingConfig('gemini-flash-latest'), null);
});

Deno.test('readMemory: newest first, capped, tolerant', () => {
  const facts = Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: `fact ${i}`, at: `2026-10-${String(1 + (i % 27)).padStart(2, '0')}` }));
  const m = readMemory({ facts: [...facts, { text: '' }, null, 'plain string', { text: 'x'.repeat(300) }] });
  assertEquals(m.length, 40);
  assert(m.every(t => t.length <= 120));
  assertEquals(readMemory(undefined), []);
  assertEquals(readMemory({ facts: 'bad' }), []);
});

Deno.test('sessionFocus: recommended > rotation weak/words; modes', () => {
  assertEquals(sessionFocus(st({ lastFocus: 'Past Simple у розповідях' }))?.kind, 'recommended');
  assertEquals(sessionFocus(st(), 'chat', 0)?.kind, 'weak');
  assertEquals(sessionFocus(st(), 'chat', 1)?.kind, 'words');
  assertEquals(sessionFocus(st({ weak: [], words: [] })), null);
  assertEquals(sessionFocus(st(), 'explain'), null);
  assertEquals(sessionFocus(st(), 'scenario')?.kind, 'scenario');
});

Deno.test('prompts include memory, focus, language rules; voice has no FIX', () => {
  const s = st({ memory: ['Has a daughter, Mia (7)'], recent: ['"I go" → "I went"'], lastFocus: 'Past Simple' });
  const p = modePrompt('chat', s, {});
  assert(p.includes('WHAT YOU REMEMBER ABOUT THE STUDENT'));
  assert(p.includes('Has a daughter, Mia (7)'));
  assert(p.includes("TODAY'S FOCUS"));
  assert(p.includes('RECENT MISTAKES'));
  assert(p.includes('---FIX---'));
  assert(p.includes('Never write Russian'));
  const v = modePrompt('chat', s, { voice: true });
  assert(!v.includes('---FIX---'));
  assert(!basePrompt(st()).includes('WHAT YOU REMEMBER'));
  assert(metaPrompt(s, 'chat', null, { kind: 'weak', text: 'articles' }).includes('plan:'));
  assert(!metaPrompt(s, 'chat').includes('plan:'));
  const a1 = modePrompt('chat', st({ level: 'A1' }), {});
  assert(a1.includes('Ukrainian hint'));
});

// ---------- виклики Gemini з підміненим fetch ----------
function withFetch(handler: (url: string, body: any) => Response, fn: () => Promise<void>) {
  return async () => {
    const orig = globalThis.fetch;
    Deno.env.set('GEMINI_API_KEY', 'test');
    globalThis.fetch = ((url: string, init: RequestInit) => Promise.resolve(handler(String(url), JSON.parse(String(init.body))))) as typeof fetch;
    try { await fn(); } finally { globalThis.fetch = orig; }
  };
}
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }] }), { status: 200 });

Deno.test('generate: 400 on thinkingConfig → retry same model without it', withFetch((url, body) => {
  if (body.generationConfig.thinkingConfig) return new Response(JSON.stringify({ error: { message: 'Unknown name "thinkingLevel"' } }), { status: 400 });
  return ok('hi');
}, async () => {
  assertEquals(await generate(['gemini-x-flash'], { contents: [], thinking: 'low' }), 'hi');
}));

Deno.test('generate: 429 → next model', withFetch((url) => (url.includes('/a:') ? new Response('{}', { status: 429 }) : ok('from b')), async () => {
  assertEquals(await generate(['a', 'b'], { contents: [] }), 'from b');
}));

Deno.test('streamText: yields text without thoughts; all models fail → error', withFetch((url) => {
  if (url.includes('bad')) return new Response('{}', { status: 503 });
  const sse = ['data: {"candidates":[{"content":{"parts":[{"text":"x","thought":true}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}', ''].join('\n\n');
  return new Response(sse, { status: 200 });
}, async () => {
  const it = await streamText(['good'], { contents: [] });
  let out = '';
  for await (const t of it) out += t;
  assertEquals(out, 'Hello');
  await assertRejects(() => streamText(['bad'], { contents: [] }));
}));

Deno.test('generate: 400 not about thinking → next model, model keeps thinking', withFetch((url, body) => {
  if (url.includes('/m1:')) return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload: responseSchema' } }), { status: 400 });
  return ok(body.generationConfig.thinkingConfig ? 'm2 thinks' : 'm2 plain');
}, async () => {
  assertEquals(await generate(['m1', 'm2'], { contents: [], thinking: 'low' }), 'm2 thinks');
  assert(thinkingConfig('m1', 'low'), 'm1 must not be marked as no-thinking');
}));

Deno.test('metaPrompt: plan only on the first message (false / Focus / null)', () => {
  assert(!/- plan:/.test(metaPrompt(st(), 'chat', null, false)));
  assert(!/- plan:/.test(metaPrompt(st(), 'chat', null)));
  assert(/- plan:/.test(metaPrompt(st(), 'chat', null, null)));
  assert(/- plan:.*commute/s.test(metaPrompt(st(), 'chat', null, sessionFocus(st({ weak: [] }), 'chat'))));
});

Deno.test('candidateText: MAX_TOKENS → truncated, empty → empty', () => {
  let code = '';
  try { candidateText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Here is your first' }] } }] }); } catch (e) { code = (e as { code: string }).code; }
  assertEquals(code, 'truncated');
  try { candidateText({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }); } catch (e) { code = (e as { code: string }).code; }
  assertEquals(code, 'empty');
});

const trunc = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text }] } }] }), { status: 200 });

Deno.test('generate: truncated with thinking → same model retried without thinking', withFetch((_url, body) =>
  (body.generationConfig.thinkingConfig?.thinkingLevel === 'low' ? trunc('Here is') : ok('Full answer.')), async () => {
  assertEquals(await generate(['gemini-x-flash'], { contents: [], thinking: 'low' }), 'Full answer.');
}));

Deno.test('generate: truncated everywhere → empty (code known to the client)', withFetch(() => trunc('cut'), async () => {
  const e = await assertRejects(() => generate(['m1', 'm2'], { contents: [] }));
  assertEquals((e as { code: string }).code, 'empty');
}));

Deno.test('429 model is cooled down and tried last next time', withFetch((url) => (url.includes('/cool-a:') ? new Response('{}', { status: 429 }) : ok(url.includes('/cool-b:') ? 'b' : 'a')), async () => {
  assertEquals(await generate(['cool-a', 'cool-b'], { contents: [] }), 'b');
  assert(isCooled('cool-a'));
  assertEquals(await generate(['cool-a', 'cool-b'], { contents: [] }), 'b');
}));

Deno.test('streamText exposes finishReason', withFetch(() => new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"MAX_TOKENS"}]}\n\n', { status: 200 }), async () => {
  const it = await streamText(['s-model'], { contents: [] });
  let out = ''; for await (const t of it) out += t;
  assertEquals(out, 'Hi');
  assertEquals(it.info.finishReason, 'MAX_TOKENS');
}));

Deno.test('wordsForLevel: deck level, work decks, own cards', () => {
  const cards = [{ en: 'idiom', deck_id: 'idioms-c1' }, { en: 'steep', deck_id: 'weather-nature' }, { en: 'tolerance', deck_id: 'cnc' }, { en: 'my word', deck_id: 'my' }, { en: 'chat', deck_id: 'smalltalk' }];
  assertEquals(wordsForLevel(cards, 'A2', false), ['steep', 'my word', 'chat']);
  assertEquals(wordsForLevel(cards, 'C1', true), ['idiom', 'steep', 'tolerance', 'my word', 'chat']);
});

Deno.test('sessionFocus: drill names the type; no words focus at C1 or with app topic', () => {
  assertEquals(sessionFocus(st(), 'drill', 0, { drillType: 'prepositions' })?.text, 'prepositions');
  assert(!sessionFocus(st(), 'drill', 0, {})?.text.includes('['));
  assertEquals(sessionFocus(st({ level: 'C1', weak: [] }), 'chat', 1), null);
  assertEquals(sessionFocus(st({ weak: [] }), 'chat', 1, { topic: 'Weekends' }), null);
});

Deno.test('prompt rules from eval: one question, one word, explain without FIX, UK grammar gender, absolute dates', () => {
  const p = modePrompt('chat', st({ memory: ['Has a beagle, Rocky'] }), {});
  assert(p.includes('exactly ONE question'));
  assert(p.includes('at most ONE of them per message'));
  assert(p.includes('at most ONE remembered item'));
  assert(p.includes("I've never seen"));
  assert(p.includes('Never invent rules'));
  const ex = modePrompt('explain', st(), {});
  assert(!ex.includes('---FIX---'));
  assert(ex.includes('No corrections block'));
  assert(UK_STYLE.includes('допоміжне дієслово') && UK_STYLE.includes('never nest brackets'));
  assert(memoryRule(st(), 3, '2026-10-27, Tuesday').includes('Today is 2026-10-27, Tuesday'));
  assert(/^\d{4}-\d{2}-\d{2}, \w+day$/.test(todayLabel()));
  assert(metaPrompt(st(), 'chat').includes('British English'));
});
