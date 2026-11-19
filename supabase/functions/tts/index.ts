// Edge Function `tts`: озвучення Gemini TTS з кешем у Supabase Storage (за хешем тексту)
import { handler, HttpError, cors } from '../_shared/http.ts';
import { authenticate, charge } from '../_shared/auth.ts';
import { tts, wav } from '../_shared/gemini.ts';
import { TTS_MODELS, LIVE_VOICES } from '../_shared/config.ts';
import { buildDialogue, renderDialogue, type Dialogue } from '../_shared/ttsdlg.ts';

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
  let text = '', voice = '', dlg: Dialogue | null = null;
  if (isDlg) {
    dlg = await buildDialogue(p.dialogue, (Array.isArray(p.speakers) ? p.speakers : []).map((x: { name?: string } | string) => typeof x === 'string' ? x : String(x?.name || '')));
    if (!dlg) throw new HttpError(400, 'bad_request', 'Bad dialogue');
    text = dlg.text; voice = dlg.voice;
  } else {
    text = String(p.text || '').trim().slice(0, 1500);
    if (!text) throw new HttpError(400, 'bad_request', 'No text');
    voice = LIVE_VOICES.includes(p.voice) ? p.voice : 'Kore';
  }
  const key = dlg ? dlg.key : `${await sha256(voice + '|' + text)}.wav`;
  const headers = { ...cors, 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=31536000' };

  const cached = await ctx.admin.storage.from('tts').download(key);
  if (cached.data) return new Response(cached.data, { headers });
  // клієнт під паузою Gemini (ліміт вичерпано) питає лише готовий запис — без генерації (19.11: власні слова озвучено Kokoro в цей кеш)
  if (p.cacheOnly) throw new HttpError(404, 'not_cached', 'Not cached');

  await charge(ctx, 'tts');
  const file = dlg ? await renderDialogue(dlg) : await (async () => { const { pcm, rate } = await tts(TTS_MODELS, text, voice); return wav(pcm, rate); })();
  const up = ctx.admin.storage.from('tts').upload(key, file, { contentType: 'audio/wav', upsert: true }).then(() => {}, () => {});
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(up);
  return new Response(file.buffer as ArrayBuffer, { headers });
}));
