// Edge Function `live-token`: ефемерний токен Gemini Live.
// Модель, модальність, системний промпт, голос і транскрипція заблоковані в токені.
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate, usage, charge, isAdmin } from '../_shared/auth.ts';
import { createLiveToken } from '../_shared/gemini.ts';
import { LIVE_MODELS, LIVE_VOICES, LIMITS } from '../_shared/config.ts';
import { loadStudent, modePrompt, type Scenario } from '../_shared/prompts.ts';

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  const p = await req.json().catch(() => ({}));
  // паралельно (2026-11-17, рецензія: послідовні запити додавали ~0,2–0,4 с до старту голосу)
  const [u, st] = await Promise.all([usage(ctx), loadStudent(ctx)]);
  const left = LIMITS.voiceSeconds - (u.voice_seconds || 0);
  if (left <= 30) throw new HttpError(429, 'quota');
  // кожен токен рахується (денний ліміт токенів) — голосовий ліміт не тримається лише на чесності клієнта
  await charge(ctx, 'live');
  // резерв часу (2026-11-28, міграція 0042): токен відкриває сесії не довше LIMITS.liveTokenMinutes, і за день видається
  // не більше ніж на liveIssueFactor × денного ліміту голосу + 30 хв — навіть змінений клієнт, що не звітує час, не говорить безкінечно
  const minutes = Math.max(3, Math.min(LIMITS.liveTokenMinutes, Math.ceil(left / 60) + 2));
  const { data: issued, error: issueErr } = await ctx.admin.rpc('charge_live_issue', { p_user: ctx.user.id, p_sec: minutes * 60, p_cap: LIMITS.voiceSeconds * LIMITS.liveIssueFactor + 1800 });
  if (issueErr) console.error('live issue', issueErr.message);
  else if (issued !== true) throw new HttpError(429, 'quota');

  const idx = Math.max(0, Math.min(LIVE_MODELS.length - 1, Number(p.fallback) || 0));
  const model = LIVE_MODELS[idx];
  const voice = LIVE_VOICES.includes(p.voice) ? p.voice : (LIVE_VOICES.includes(st.voice) ? st.voice : 'Puck');
  const mode = p.scenario ? 'scenario' : 'chat';
  const s = p.scenario && typeof p.scenario === 'object' ? p.scenario as Record<string, unknown> : null;
  const cut = (v: unknown, n: number) => (v == null ? '' : String(v)).slice(0, n);
  const scenario: Scenario | null = s ? { title: cut(s.title, 200), situation: cut(s.situation, 1000), myRole: cut(s.myRole, 300), tutorRole: cut(s.tutorRole, 300), goal: cut(s.goal, 600), phrases: Array.isArray(s.phrases) ? s.phrases.slice(0, 12).map(x => cut(x, 200)) : [] } : null;
  const system = modePrompt(mode, st, { scenario, topic: cut(p.topic, 600) || null, voice: true });

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
    // учень підбирає слова з паузами: не обриваємо його (низька чутливість кінця мовлення, пауза за рівнем).
    // Початок мовлення — висока чутливість, 300 мс мовлення для старту. LOW (17.11 ввечері) не вмикав «хід» на iPhone: Live розпізнавав слова,
    // а вчитель мовчав («can you hear me?» тричі за 18.11). Відлуння вчителя глушить клієнт (gate у js/live/voice.js), фантоми — промпт і фільтр.
    // Якщо хід усе ж не закрився — клієнт надсилає почуте текстом (checkStall у js/live/client.js). basic — відкат.
    ...(p.basic ? {} : {
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          prefixPaddingMs: 300,
          silenceDurationMs: st.voicePauseMs,
        },
      },
    }),
  };
  let basic = !!p.basic;
  let tok;
  try { tok = await createLiveToken(setup, { uses: 20, minutes }); } catch (e) {
    // Google не прийняв налаштування паузи — токен без них (голос працює зі стандартною паузою)
    // лише якщо помилка справді про налаштування паузи/слухання (2026-11-17, рецензія: будь-яка помилка вимикала їх — паузу за замовчуванням, обриви на півслові)
    if (basic || (e as HttpError).code !== 'bad_model_request' || !/realtime|activity|sensitivity|silence|prefix|padding/i.test(String((e as Error).message))) throw e;
    console.error('live-token: VAD config rejected', String((e as Error).message).slice(0, 200));
    delete (setup as Record<string, unknown>).realtimeInputConfig;
    basic = true;
    tok = await createLiveToken(setup, { uses: 20, minutes });
  }
  return json({ ...tok, model, voice, pauseMs: basic ? 0 : st.voicePauseMs, ...(isAdmin(ctx.user) ? { voiceSecondsLeft: left } : {}), hasMoreModels: idx < LIVE_MODELS.length - 1 });
}));
