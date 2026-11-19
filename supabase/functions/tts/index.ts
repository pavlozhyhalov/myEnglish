// Edge Function `tts`: озвучення Gemini TTS з кешем у Supabase Storage (за хешем тексту)
import { handler, HttpError, cors } from '../_shared/http.ts';
import { authenticate, charge } from '../_shared/auth.ts';
import { tts, wav } from '../_shared/gemini.ts';
import { TTS_MODELS, LIVE_VOICES } from '../_shared/config.ts';

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  const p = await req.json().catch(() => ({}));
  // Діалог (аудіювання, 2026-11-19, власник: «паршивий голос, нічого не зрозуміло»): одним записом, два голоси Gemini, ясно й природно.
  // dialogue: [{ s: 0|1, t }], speakers: [{ name, voice }] × 2. Кешується для всіх за хешем — кожен діалог генерується один раз.
  const isDlg = Array.isArray(p.dialogue);
  let text = '', voice = '', speakers: { name: string; voice: string }[] | undefined;
  if (isDlg) {
    const lines = (p.dialogue as { s?: number; t?: string }[]).slice(0, 30).map(l => ({ s: l?.s ? 1 : 0, t: String(l?.t || '').replace(/\s+/g, ' ').trim().slice(0, 400) })).filter(l => l.t);
    const sp = Array.isArray(p.speakers) ? p.speakers : [];
    const names = [0, 1].map(i => String(sp[i]?.name || '').replace(/[^A-Za-z]/g, '').slice(0, 20) || ['Alex', 'Sam'][i]);
    if (names[0] === names[1]) names[1] = names[1] + 'B';
    speakers = [0, 1].map(i => ({ name: names[i], voice: LIVE_VOICES.includes(sp[i]?.voice) ? sp[i].voice : ['Kore', 'Puck'][i] }));
    if (speakers[0].voice === speakers[1].voice) speakers[1].voice = speakers[0].voice === 'Puck' ? 'Kore' : 'Puck';
    const body = lines.map(l => `${names[l.s]}: ${l.t}`).join('\n');
    if (!lines.length || body.length > 4000) throw new HttpError(400, 'bad_request', 'Bad dialogue');
    text = `Read this everyday conversation aloud for English learners: clear, natural, friendly, at a calm and steady pace, with a short pause between lines.\n\n${body}`;
    voice = speakers.map(s => s.voice).join('+');
  } else {
    text = String(p.text || '').trim().slice(0, 1500);
    if (!text) throw new HttpError(400, 'bad_request', 'No text');
    voice = LIVE_VOICES.includes(p.voice) ? p.voice : 'Kore';
  }
  const key = `${await sha256(voice + '|' + text)}.wav`;
  const headers = { ...cors, 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=31536000' };

  const cached = await ctx.admin.storage.from('tts').download(key);
  if (cached.data) return new Response(cached.data, { headers });

  await charge(ctx, 'tts');
  const { pcm, rate } = await tts(TTS_MODELS, text, voice, isDlg ? { speakers, timeoutMs: 65_000 } : {});
  const file = wav(pcm, rate);
  const up = ctx.admin.storage.from('tts').upload(key, file, { contentType: 'audio/wav', upsert: true }).then(() => {}, () => {});
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(up);
  return new Response(file.buffer as ArrayBuffer, { headers });
}));
