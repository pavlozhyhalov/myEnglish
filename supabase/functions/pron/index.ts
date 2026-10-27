// Edge Function `pron`: AI-оцінка вимови записаної фрази (Gemini, аудіо → строгий JSON).
// Розгортання: як і інші функції — однорядковий index.ts, що імпортує
//   https://raw.githubusercontent.com/pavlozhyhalov/myEnglish/<commit-sha>/supabase/functions/pron/index.ts
// (відносні імпорти ./validate.ts, ./prompt.ts, ../_shared/* розв'язуються від цього URL).
// Ліміт: кожна оцінка списує 1 виклик із денного ліміту текстових викликів (LIMIT_TEXT_CALLS, спільний з tutor).
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate, charge } from '../_shared/auth.ts';
import { generateJson } from '../_shared/gemini.ts';
import { TEXT_MODELS } from '../_shared/config.ts';
import { PRON_SCHEMA, pronPrompt } from './prompt.ts';
import { normalizeResult, targetWords } from './validate.ts';

const AUDIO_MIME = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|m4a)(;.*)?$/;
const MAX_AUDIO_B64 = 3_000_000;   // ~2.2 МБ аудіо: фраза до ~20 с з великим запасом
const MAX_TEXT = 200;

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);   // вхід перевіряється до читання тіла й до будь-якого виклику Gemini
  if (Number(req.headers.get('content-length') || 0) > MAX_AUDIO_B64 + 50_000) throw new HttpError(413, 'bad_request', 'Request too large');
  const p = await req.json().catch(() => ({}));
  if (String(p.action || '') !== 'assess') throw new HttpError(400, 'bad_request', 'Unknown action');

  // перевірка вводу до списання ліміту
  const text = String(p.text || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_TEXT || !targetWords(text).length) throw new HttpError(400, 'bad_request', 'Target text missing or too long');
  const audio = String(p.audio || '');
  if (!audio || audio.length > MAX_AUDIO_B64 || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 200))) throw new HttpError(400, 'bad_request', 'Audio missing or too large');
  const mime = String(p.mime || 'audio/webm');
  if (!AUDIO_MIME.test(mime)) throw new HttpError(400, 'bad_request', 'Unsupported audio type');
  const accent = p.accent === 'US' ? 'US' : 'UK';

  await charge(ctx, 'text');
  const raw = await generateJson(TEXT_MODELS, {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime.split(';')[0], data: audio } }, { text: pronPrompt(text, accent) }] }],
    schema: PRON_SCHEMA,
    temperature: 0.1,
  });
  let res;
  try { res = normalizeResult(raw, text); } catch { throw new HttpError(502, 'gemini', 'Bad pronunciation JSON from model'); }
  return json(res);
}));
