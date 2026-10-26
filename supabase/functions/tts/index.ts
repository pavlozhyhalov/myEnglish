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
  const text = String(p.text || '').trim().slice(0, 1500);
  if (!text) throw new HttpError(400, 'bad_request', 'No text');
  const voice = LIVE_VOICES.includes(p.voice) ? p.voice : 'Kore';
  const key = `${await sha256(voice + '|' + text)}.wav`;
  const headers = { ...cors, 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=31536000' };

  const cached = await ctx.admin.storage.from('tts').download(key);
  if (cached.data) return new Response(cached.data, { headers });

  await charge(ctx, 'tts');
  const { pcm, rate } = await tts(TTS_MODELS, text, voice);
  const file = wav(pcm, rate);
  const up = ctx.admin.storage.from('tts').upload(key, file, { contentType: 'audio/wav', upsert: true }).then(() => {}, () => {});
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(up);
  return new Response(file.buffer as ArrayBuffer, { headers });
}));
