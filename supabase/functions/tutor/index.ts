// Edge Function `tutor`: чат зі стрімінгом, підсумок сесії, перевірка тексту,
// генерація вправ, автозаповнення слів, перевірка перекладу, діалоги, транскрипція.
import { handler, json, HttpError, cors } from '../_shared/http.ts';
import { authenticate, charge, usage } from '../_shared/auth.ts';
import { generate, generateJson, streamSSE, tts, createLiveToken, type Content } from '../_shared/gemini.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { TEXT_MODELS, TTS_MODELS, LIVE_MODELS, LIMITS } from '../_shared/config.ts';
import { loadStudent, modePrompt, basePrompt, type Scenario } from '../_shared/prompts.ts';

type Msg = { role: 'user' | 'model'; text: string };
const MISTAKE_TYPES = ['articles', 'tenses', 'prepositions', 'word_order', 'vocabulary', 'pronunciation', 'other'];

function toContents(messages: Msg[], start = '(The student has opened the session. Begin now.)'): Content[] {
  const out: Content[] = [];
  for (const m of (messages || []).slice(-40)) {
    const text = String(m.text || '').slice(0, 6000);
    if (!text) continue;
    const role = m.role === 'user' ? 'user' : 'model';
    const last = out[out.length - 1];
    if (last && last.role === role) (last.parts[0] as { text: string }).text += '\n\n' + text;
    else out.push({ role, parts: [{ text }] });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', parts: [{ text: start }] });
  return out;
}

function transcript(messages: Msg[]) {
  return (messages || []).slice(-80).map(m => `${m.role === 'user' ? 'STUDENT' : 'TUTOR'}: ${String(m.text || '').slice(0, 3000)}`).join('\n');
}

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const ARR = (items: unknown) => ({ type: 'ARRAY', items });
const OBJ = (properties: Record<string, unknown>, required?: string[]) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });

const SUMMARY_SCHEMA = OBJ({
  summary: S('STRING'),
  mistakes: ARR(OBJ({ wrong: S('STRING'), right: S('STRING'), type: S('STRING', { enum: MISTAKE_TYPES }), explanation_uk: S('STRING') }, ['wrong', 'right', 'type', 'explanation_uk'])),
  new_words: ARR(OBJ({ en: S('STRING'), uk: S('STRING'), example: S('STRING') }, ['en', 'uk', 'example'])),
  level_signal: S('STRING', { enum: ['A2', 'B1', 'B2', 'C1'] }),
  next_focus: S('STRING'),
}, ['summary', 'mistakes', 'new_words', 'level_signal', 'next_focus']);

const CHECK_SCHEMA = OBJ({
  scores: OBJ({ grammar: S('INTEGER'), vocabulary: S('INTEGER'), tone: S('INTEGER'), structure: S('INTEGER') }, ['grammar', 'vocabulary', 'tone', 'structure']),
  corrections: ARR(OBJ({ wrong: S('STRING'), right: S('STRING'), type: S('STRING', { enum: MISTAKE_TYPES }), explanation_uk: S('STRING') }, ['wrong', 'right', 'type', 'explanation_uk'])),
  improved: S('STRING'),
  comment_uk: S('STRING'),
}, ['scores', 'corrections', 'improved', 'comment_uk']);

const EX_SCHEMA = OBJ({
  exercises: ARR(OBJ({
    type: S('STRING', { enum: ['choice', 'input', 'order', 'error', 'transform', 'translate'] }),
    instruction: S('STRING'),
    prompt: S('STRING'),
    options: ARR(S('STRING')),
    answer: S('STRING'),
    alternatives: ARR(S('STRING')),
    sentence: S('STRING'),
    wrong_word: S('STRING'),
    uk: S('STRING'),
    explanation: S('STRING'),
  }, ['type', 'answer', 'explanation'])),
}, ['exercises']);

const WORD_SCHEMA = OBJ({
  words: ARR(OBJ({
    en: S('STRING'), uk: S('STRING'), pos: S('STRING'), ipa: S('STRING'),
    examples: ARR(OBJ({ en: S('STRING'), uk: S('STRING') }, ['en', 'uk'])),
    collocations: ARR(S('STRING')), synonyms: ARR(S('STRING')),
    cefr: S('STRING', { enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] }),
    topic: S('STRING'),
    kind: S('STRING', { enum: ['word', 'phrase', 'phrasal_verb', 'collocation', 'idiom'] }),
  }, ['en', 'uk', 'pos', 'ipa', 'examples', 'cefr', 'kind'])),
}, ['words']);

const TRANSLATION_SCHEMA = OBJ({ correct: S('BOOLEAN'), better: S('STRING'), explanation_uk: S('STRING') }, ['correct', 'better', 'explanation_uk']);

const DIALOGUE_SCHEMA = OBJ({
  title: S('STRING'),
  speakers: ARR(S('STRING')),
  lines: ARR(OBJ({ speaker: S('INTEGER'), text: S('STRING') }, ['speaker', 'text'])),
  questions: ARR(OBJ({ q: S('STRING'), options: ARR(S('STRING')), answer: S('INTEGER'), explanation_uk: S('STRING') }, ['q', 'options', 'answer'])),
}, ['title', 'speakers', 'lines', 'questions']);

/** Нормалізація вправ від моделі у формат клієнта; биті — відкидаємо */
function cleanExercises(list: any[]) {
  const out = [];
  for (const e of list || []) {
    const base = { type: e.type, instruction: e.instruction || undefined, explanation: e.explanation || '' };
    const alts = [e.answer, ...(e.alternatives || [])].filter(Boolean);
    if (e.type === 'choice') {
      const options = (e.options || []).filter(Boolean);
      if (options.length < 2 || !options.includes(e.answer) || !e.prompt) continue;
      out.push({ ...base, prompt: e.prompt, options, answer: e.answer });
    } else if (e.type === 'input' || e.type === 'transform') {
      if (!e.prompt || !alts.length) continue;
      out.push({ ...base, prompt: e.prompt, answer: alts });
    } else if (e.type === 'order') {
      if (!e.answer) continue;
      out.push({ ...base, prompt: e.prompt || '', answer: alts });
    } else if (e.type === 'error') {
      const sentence = e.sentence || e.prompt || '';
      const words = sentence.split(/\s+/);
      const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
      const idx = words.findIndex((w: string) => clean(w) === clean(e.wrong_word || ''));
      if (idx < 0 || !e.answer) continue;
      out.push({ ...base, sentence, wrongIndex: idx, correction: e.answer, alt: e.alternatives || [] });
    } else if (e.type === 'translate') {
      const uk = e.uk || e.prompt;
      if (!uk || !alts.length) continue;
      out.push({ ...base, uk, answer: alts });
    }
  }
  return out;
}

/** Діагностика без авторизації: лише факт наявності секретів і доступність моделей (без значень). */
async function health() {
  const key = Deno.env.get('GEMINI_API_KEY') || '';
  const out: Record<string, unknown> = {
    gemini_key_set: !!key,
    allowed_users_set: !!(Deno.env.get('ALLOWED_USERS') || '').trim(),
  };
  if (key) {
    const names = new Set<string>();
    let url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
    let status = 0;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { headers: { 'x-goog-api-key': key } });
      status = res.status;
      if (!res.ok) break;
      const j = await res.json();
      for (const m of j.models || []) names.add(String(m.name).replace(/^models\//, ''));
      if (!j.nextPageToken) break;
      url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=${j.nextPageToken}`;
    }
    out.gemini_status = status;
    const pick = (list: string[]) => Object.fromEntries(list.map(m => [m, names.has(m)]));
    out.text_models = pick(TEXT_MODELS);
    out.tts_models = pick(TTS_MODELS);
    out.live_models = pick(LIVE_MODELS);
    out.live_candidates = [...names].filter(n => /live|native-audio/.test(n)).slice(0, 20);
    out.tts_candidates = [...names].filter(n => /tts/.test(n)).slice(0, 20);
  }
  return out;
}

/** Справжня сесія Gemini Live (як у браузері): токен → WebSocket → setup → фраза → голос і субтитри */
async function liveProbe() {
  const model = LIVE_MODELS[0];
  const tok = await createLiveToken({
    model: `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } },
    systemInstruction: { parts: [{ text: 'You are a friendly English tutor. Answer in one short sentence.' }] },
    inputAudioTranscription: {}, outputAudioTranscription: {}, sessionResumption: {},
  }, { uses: 2, minutes: 2 });
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tok.token)}`;
  return await new Promise((resolve) => {
    const res: Record<string, unknown> = { model, setup: false, audio_bytes: 0, transcript: '', turn: false, resumption_handle: false };
    const ws = new WebSocket(url);
    const done = (extra: Record<string, unknown> = {}) => { clearTimeout(t); try { ws.close(); } catch { /* */ } resolve({ ...res, ...extra }); };
    const t = setTimeout(() => done({ timeout: true }), 25_000);
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${model}`, sessionResumption: {} } }));
    ws.onerror = () => { res.ws_error = true; };
    ws.onclose = (e) => done({ close_code: e.code, close_reason: String(e.reason || '').slice(0, 200) });
    ws.onmessage = async (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : await new Response(ev.data as Blob).text();
      let m: any; try { m = JSON.parse(text); } catch { return; }
      if (m.setupComplete) {
        res.setup = true;
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Say hello to Pavlo.' }] }], turnComplete: true } }));
      }
      if (m.sessionResumptionUpdate?.newHandle) res.resumption_handle = true;
      const sc = m.serverContent;
      if (sc?.outputTranscription?.text) res.transcript = String(res.transcript) + sc.outputTranscription.text;
      for (const part of sc?.modelTurn?.parts || []) if (part.inlineData?.data) res.audio_bytes = (res.audio_bytes as number) + part.inlineData.data.length;
      if (sc?.turnComplete) { res.turn = true; done(); }
    };
  });
}

/** Глибока перевірка: реальні виклики Gemini (текст, JSON, TTS, токен Live). Не частіше разу на 10 хв. */
async function deepHealth(only?: string) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: last } = await admin.from('health_checks').select('ts').order('ts', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.ts) < 10 * 60_000) throw new HttpError(429, 'rate_limited', 'Deep health check: once per 10 minutes');
  const r: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try { r[name] = { ok: true, ms: Date.now() - t, info: await fn() }; (r[name] as any).ms = Date.now() - t; }
    catch (e) { r[name] = { ok: false, error: `${(e as HttpError).code || ''} ${(e as Error).message}`.slice(0, 300) }; }
  };
  if (only !== 'live') await step('text', async () => (await generate(TEXT_MODELS, { contents: [{ role: 'user', parts: [{ text: 'Reply with exactly one word: OK' }] }], temperature: 0 })).trim().slice(0, 20));
  if (only !== 'live') await step('json', async () => generateJson(TEXT_MODELS, { contents: [{ role: 'user', parts: [{ text: 'Translate "cat" to Ukrainian.' }] }], schema: { type: 'OBJECT', properties: { uk: { type: 'STRING' } }, required: ['uk'] } }));
  if (only !== 'live') await step('tts', async () => { const a = await tts(TTS_MODELS, 'Hello!', 'Kore'); return { bytes: a.pcm.length, rate: a.rate }; });
  if (only !== 'live') await step('live_token', async () => {
    const t = await createLiveToken({ model: `models/${LIVE_MODELS[0]}`, generationConfig: { responseModalities: ['AUDIO'] }, sessionResumption: {} }, { uses: 1, minutes: 2 });
    return { token_prefix: t.token.split('/')[0], model: LIVE_MODELS[0] };
  });
  await step('live_ws', () => liveProbe());
  await admin.from('health_checks').insert({ result: r });
  return r;
}

Deno.serve(handler(async (req) => {
  const p = await req.json().catch(() => ({}));
  if (p.action === 'health') return json(p.deep ? await deepHealth(p.only) : await health());
  const ctx = await authenticate(req);
  const action = String(p.action || '');

  if (action === 'usage') {
    // клієнт звітує тривалість голосової сесії
    const sec = Math.max(0, Math.min(3600, Math.round(Number(p.voice_seconds) || 0)));
    if (sec) await ctx.admin.rpc('bump_ai_usage', { p_user: ctx.user.id, p_text: 0, p_voice: sec, p_tts: 0 });
    const u = await usage(ctx);
    return json({ ...u, limits: LIMITS });
  }

  await charge(ctx, 'text');
  const st = await loadStudent(ctx);

  switch (action) {
    case 'chat': {
      const system = modePrompt(String(p.mode || 'chat'), st, { scenario: p.scenarioData as Scenario, drillType: p.drillType, topic: p.topic, voice: !!p.voice });
      const contents = toContents(p.messages || []);
      if (p.stream === false) {
        const text = await generate(TEXT_MODELS, { system, contents, temperature: 0.8, maxTokens: 1500 });
        return json({ text });
      }
      const stream = await streamSSE(TEXT_MODELS, { system, contents, temperature: 0.8, maxTokens: 1500 });
      // заодно чистимо старі розмови (30 днів)
      ctx.admin.rpc('purge_old_chats').then(() => {}, () => {});
      return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    case 'summary': {
      const system = `${basePrompt(st)}

TASK: Analyse the finished ${p.mode === 'voice' ? 'VOICE (transcribed speech — ignore punctuation and capitalisation, transcription glitches are not mistakes)' : 'text'} session below and return JSON.
- summary: 2–4 sentences in Ukrainian: what was discussed and how the student did.
- mistakes: up to 10 real mistakes made by the STUDENT (not the tutor), each with the exact wrong fragment, the corrected fragment, a type, and a short explanation in Ukrainian. Merge duplicates.
- new_words: 3–8 useful words or phrases from the session (preferably ones the tutor introduced or the student lacked), with Ukrainian translation and an English example sentence.
- level_signal: the CEFR level the student demonstrated in this session.
- next_focus: one concrete recommendation in Ukrainian for the next session.`;
      const res = await generateJson(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: transcript(p.messages || []) || '(empty session)' }] }], schema: SUMMARY_SCHEMA, temperature: 0.3 });
      return json(res);
    }

    case 'check_text': {
      const kind = { email: 'an email', teams: 'a Microsoft Teams message', report: 'a work report', other: 'a text' }[String(p.kind)] || 'a text';
      const system = `${basePrompt(st)}

TASK: The student wrote ${kind}${p.task ? ` for this task: "${p.task}"` : ''}. Review it like a demanding but kind English teacher and return JSON:
- scores (0–10 each): grammar, vocabulary, tone (appropriate for the situation and reader), structure.
- corrections: every important mistake: exact wrong fragment, corrected fragment, type, explanation in Ukrainian.
- improved: the full improved version in natural English with the right register for the reader, keeping the student's meaning and approximate length.
- comment_uk: 2–4 sentences in Ukrainian: strengths and the 1–2 most important things to improve.`;
      const res = await generateJson(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: String(p.text || '').slice(0, 8000) }] }], schema: CHECK_SCHEMA, temperature: 0.3 });
      return json(res);
    }

    case 'exercises': {
      const count = Math.max(3, Math.min(15, Number(p.count) || 10));
      const ex = (p.examples || []).slice(0, 10).map((m: Msg & { wrong: string; right: string }) => `"${m.wrong}" → "${m.right}"`).join('; ');
      const system = `${basePrompt(st)}

TASK: Create ${count} varied exercises on: ${String(p.topic || 'general B1–B2 grammar').slice(0, 300)}.
${ex ? `Base several items on the student's real mistakes: ${ex}.` : ''}
Mix types: choice (prompt with "___", 3–4 options, answer = exact option text), input (prompt with "___" and the base form in brackets, answer = the missing words only), order (answer = the full correct sentence; prompt = short Ukrainian hint), error (sentence with exactly ONE wrong word; wrong_word = that word exactly as written; answer = the correct replacement word(s)), transform (prompt = sentence + instruction, answer = full new sentence), translate (uk = Ukrainian sentence, answer = natural English translation, alternatives = other correct variants).
Use varied everyday contexts (daily life, travel, people, hobbies, home, shopping, life in Poland)${st.workFocus ? ', sometimes the workplace' : ''}. Level ${st.level}→B2. explanation = 1 short sentence in Ukrainian. Provide alternatives for any answer that can be phrased differently (contractions are handled automatically).`;
      const res = await generateJson<{ exercises: unknown[] }>(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: 'Generate the exercises.' }] }], schema: EX_SCHEMA, temperature: 0.7 });
      return json({ exercises: cleanExercises(res.exercises as any[]) });
    }

    case 'fill_word': {
      const words = (Array.isArray(p.words) ? p.words : [p.word]).map((w: string) => String(w || '').trim()).filter(Boolean).slice(0, 40);
      if (!words.length) throw new HttpError(400, 'bad_request', 'No words');
      const system = `You are a precise English–Ukrainian lexicographer helping a Ukrainian learner of English who lives in Poland.
For each English word or phrase return: uk (natural Ukrainian translation, 1–3 variants separated by ", "), pos, ipa (General American IPA in slashes), 2 natural examples (everyday contexts; if the word is technical or work-related, one example from that context) each with Ukrainian translation, 2–4 common collocations, 1–3 synonyms, CEFR level, topic (one of: everyday, smalltalk, food, travel, city, opinions, home, phrasal, collocations, work, general) and kind. Keep input order, keep the student's spelling of en unless it is clearly a typo (then fix it).`;
      const res = await generateJson(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: words.join('\n') }] }], schema: WORD_SCHEMA, temperature: 0.2 });
      return json(res);
    }

    case 'check_translation': {
      const system = `You check a Ukrainian → English translation by a ${st.level} learner. Accept any natural, grammatically correct translation that keeps the meaning, even if it differs from the reference. Minor punctuation or capitalisation issues are fine. Return JSON: correct, better (the best natural version), explanation_uk (one short sentence in Ukrainian about what was wrong or why it is fine).`;
      const text = `Ukrainian: ${p.uk}\nReference: ${(Array.isArray(p.reference) ? p.reference : [p.reference]).join(' | ')}\nStudent: ${p.answer}`;
      const res = await generateJson(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text }] }], schema: TRANSLATION_SCHEMA, temperature: 0.1 });
      return json(res);
    }

    case 'dialogue': {
      const system = `Write a natural English dialogue for listening practice for a ${st.level} learner (target B2), about 1–2 minutes when read aloud (14–20 lines), between two named people. Topic: ${String(p.topic || 'an everyday situation').slice(0, 200)}. Use a realistic everyday situation, natural spoken English (contractions, fillers sparingly). speaker = index in speakers (0 or 1). Then 5 comprehension questions in English with 3–4 options each, answer = index of correct option, explanation_uk = short Ukrainian explanation.`;
      const res = await generateJson(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: 'Create the dialogue.' }] }], schema: DIALOGUE_SCHEMA, temperature: 0.9 });
      return json(res);
    }

    case 'transcribe': {
      const audio = String(p.audio || '');
      if (!audio || audio.length > 8_000_000) throw new HttpError(400, 'bad_request', 'Audio missing or too large');
      const text = await generate(TEXT_MODELS, {
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: String(p.mime || 'audio/webm'), data: audio } }, { text: 'Transcribe this English speech exactly as spoken (do not correct mistakes). Return only the transcript text.' }] }],
        temperature: 0,
      });
      return json({ text: text.trim() });
    }

    case 'hint': {
      const system = `${basePrompt(st)}\n\nTASK: The student is in a spoken conversation and does not know what to say. Based on the conversation, give exactly 3 short possible replies in English (one line each, numbered), at ${st.level}–B2 level. No other text.`;
      const text = await generate(TEXT_MODELS, { system, contents: [{ role: 'user', parts: [{ text: transcript(p.messages || []) }] }], temperature: 0.8 });
      return json({ text });
    }

    default:
      throw new HttpError(400, 'bad_request', `Unknown action: ${action}`);
  }
}));
