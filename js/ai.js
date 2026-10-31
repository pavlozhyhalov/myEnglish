// Виклики edge-функцій (Gemini). Ключ API лише на сервері.
import { FUNCTIONS_URL, SUPABASE_KEY } from './config.js';
import { accessToken } from './supa.js';
import { S } from './strings.js';

export class AiError extends Error {
  constructor(code, message) { super(message || S.err.generic); this.code = code; }
}

const MSG = {
  need_login: S.err.needLogin, not_allowed: S.err.notAllowed, no_key: S.err.noKey,
  quota: S.err.quota, rate_limited: S.err.rate, overloaded: S.err.busy, offline: S.err.offline,
  gemini: S.err.aiFailed, empty: S.err.aiFailed, bad_model_request: S.err.aiFailed, model_not_found: S.err.busy, server: S.err.generic,
};

async function headers() {
  const token = await accessToken();
  if (!token) throw new AiError('need_login', S.err.needLogin);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY };
}

async function errorFrom(res) {
  let body = null;
  try { body = await res.json(); } catch { /* не JSON */ }
  const code = body?.error?.code || (res.status === 401 ? 'need_login' : res.status === 429 ? 'rate_limited' : 'server');
  return new AiError(code, MSG[code] || body?.error?.message || `${S.err.generic} (${res.status})`);
}

/** Виклик з JSON-відповіддю */
export async function ai(fn, action, payload = {}, { signal } = {}) {
  if (!navigator.onLine) throw new AiError('offline', S.err.offline);
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ action, ...payload }), signal,
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}
export const tutor = (action, payload, opts) => ai('tutor', action, payload, opts);
/** AI-оцінка вимови (edge-функція pron): pron('assess', { audio, mime, text, accent }) */
export const pron = (action, payload, opts) => ai('pron', action, payload, opts);

/**
 * Стрімінг тексту (SSE: data: {"t":"..."}). Повертає весь текст.
 * Новий сервер після тексту шле data: {"end":true} → onEnd(full) (відповідь уже повна, можна показувати),
 * далі необов'язкову data: {"meta":{suggestions,words,memory,plan}} → onMeta(meta). Старий сервер не шле жодної з них.
 */
export async function tutorStream(payload, onText, { signal, onMeta, onEnd } = {}) {
  if (!navigator.onLine) throw new AiError('offline', S.err.offline);
  const res = await fetch(`${FUNCTIONS_URL}/tutor`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ action: 'chat', stream: true, ...payload }), signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  const handle = (ev) => {
    for (const line of ev.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (!d) continue;
      let j;
      try { j = JSON.parse(d); } catch { continue; }
      if (j.error) throw new AiError(j.error.code, MSG[j.error.code] || j.error.message);
      if (typeof j.t === 'string' && j.t) { full += j.t; onText(full, j.t); }
      if (j.end) { try { onEnd?.(full); } catch (e) { console.warn('end', e); } }
      if (j.meta && typeof j.meta === 'object') { try { onMeta?.(j.meta); } catch (e) { console.warn('meta', e); } }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      handle(ev);
    }
  }
  // остання подія без завершального порожнього рядка
  buf += dec.decode();
  if (buf.trim()) handle(buf);
  return full;
}

/** TTS Gemini → Blob (audio/wav) */
export async function ttsAudio(text, { voice, signal } = {}) {
  if (!navigator.onLine) throw new AiError('offline', S.err.offline);
  const res = await fetch(`${FUNCTIONS_URL}/tts`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ text, voice }), signal,
  });
  if (!res.ok) throw await errorFrom(res);
  return res.blob();
}

/** Ефемерний токен Gemini Live */
export async function liveToken(opts) {
  if (!navigator.onLine) throw new AiError('offline', S.err.offline);
  const res = await fetch(`${FUNCTIONS_URL}/live-token`, { method: 'POST', headers: await headers(), body: JSON.stringify(opts || {}) });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export function aiErrorText(e) {
  if (e?.name === 'AbortError') return '';
  return e instanceof AiError ? e.message : (navigator.onLine ? S.err.generic : S.err.offline);
}
