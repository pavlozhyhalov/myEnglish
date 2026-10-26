// Edge Function `live-token`: ефемерний токен Gemini Live.
// Модель, модальність, системний промпт, голос і транскрипція заблоковані в токені.
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate, usage, charge } from '../_shared/auth.ts';
import { createLiveToken } from '../_shared/gemini.ts';
import { LIVE_MODELS, LIVE_VOICES, LIMITS } from '../_shared/config.ts';
import { loadStudent, modePrompt, type Scenario } from '../_shared/prompts.ts';

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  const p = await req.json().catch(() => ({}));
  const u = await usage(ctx);
  const left = LIMITS.voiceSeconds - (u.voice_seconds || 0);
  if (left <= 30) throw new HttpError(429, 'quota');
  // кожен токен рахується (денний ліміт токенів) — голосовий ліміт не тримається лише на чесності клієнта
  await charge(ctx, 'live');

  const idx = Math.max(0, Math.min(LIVE_MODELS.length - 1, Number(p.fallback) || 0));
  const model = LIVE_MODELS[idx];
  const st = await loadStudent(ctx);
  const voice = LIVE_VOICES.includes(p.voice) ? p.voice : (LIVE_VOICES.includes(st.voice) ? st.voice : 'Puck');
  const mode = p.scenario ? 'scenario' : 'chat';
  const s = p.scenario && typeof p.scenario === 'object' ? p.scenario as Record<string, unknown> : null;
  const cut = (v: unknown, n: number) => (v == null ? '' : String(v)).slice(0, n);
  const scenario: Scenario | null = s ? { title: cut(s.title, 200), situation: cut(s.situation, 1000), myRole: cut(s.myRole, 300), tutorRole: cut(s.tutorRole, 300), goal: cut(s.goal, 600), phrases: Array.isArray(s.phrases) ? s.phrases.slice(0, 12).map(x => cut(x, 200)) : [] } : null;
  const system = modePrompt(mode, st, { scenario, topic: cut(p.topic, 300) || null, voice: true });

  const setup = {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: system }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
  };
  const tok = await createLiveToken(setup, { uses: 5, minutes: 30 });
  return json({ ...tok, model, voice, voiceSecondsLeft: left, hasMoreModels: idx < LIVE_MODELS.length - 1 });
}));
