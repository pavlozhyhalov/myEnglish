// Edge Function `tts-ingest` (2026-11-19, власник: «Так, роби»): приймає записи Kokoro для власних слів учнів від нічного завдання.
// Секрет — заголовок x-ingest-secret, значення у Vault (`tts_ingest_secret`, міграція 0037), читається через service role.
//   GET  → { words: [текст…] } — власні слова (колода «my») без запису в кеші `tts`
//   POST { items: [{ text, wav: base64 }] } → { ok, skipped } — кладе WAV під ключем Gemini: sha256('Kore|' + text) + '.wav'
// Ключ рахує сервер із тексту: довільну назву файлу записати не можна. Лише WAV (RIFF/WAVE), ≤ 800 КБ, ≤ 40 записів за раз.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64bytes(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: secret, error: se } = await db.rpc('tts_ingest_secret');
  if (se || !secret || !safeEqual(req.headers.get('x-ingest-secret') || '', String(secret))) return json({ error: 'forbidden' }, 403);

  if (req.method === 'GET') {
    const { data, error } = await db.rpc('tts_pending_words', { p_limit: 500 });
    if (error) return json({ error: 'db' }, 500);
    return json({ words: (data || []).map((r: { text: string }) => r.text) });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items.slice(0, 40) : [];
  let ok = 0, skipped = 0;
  for (const it of items) {
    const text = String(it?.text || '').trim();
    if (!text || text.length > 300 || typeof it?.wav !== 'string' || it.wav.length > 1_100_000) { skipped++; continue; }
    let bytes: Uint8Array;
    try { bytes = b64bytes(it.wav); } catch { skipped++; continue; }
    const head = new TextDecoder().decode(bytes.slice(0, 12));
    if (!head.startsWith('RIFF') || head.slice(8, 12) !== 'WAVE') { skipped++; continue; }
    const key = `${await sha256('Kore|' + text)}.wav`;
    const { error } = await db.storage.from('tts').upload(key, bytes, { contentType: 'audio/wav', upsert: true });
    if (error) skipped++; else ok++;
  }
  console.info('tts-ingest', { ok, skipped });
  return json({ ok, skipped });
});
