// Виклики edge-функцій (Gemini). Ключ API лише на сервері.
import { FUNCTIONS_URL, SUPABASE_KEY } from './config.js';
import { accessToken } from './supa.js';
import { S } from './strings.js';

export class AiError extends Error {
  constructor(code, message) { super(message || S.err.generic); this.code = code; }
}

const MSG = {
  need_login: S.err.needLogin, not_allowed: S.err.notAllowed, no_key: S.err.noKey,
  quota: S.err.quota, rate_limited: S.err.rate, offline: S.err.offline,
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

/** Стрімінг тексту (SSE: data: {"t":"..."}) */
export async function tutorStream(payload, onText, { signal } = {}) {
  if (!navigator.onLine) throw new AiError('offline', S.err.offline);
  const res = await fetch(`${FUNCTIONS_URL}/tutor`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ action: 'chat', stream: true, ...payload }), signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of ev.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (!d) continue;
        try {
          const j = JSON.parse(d);
          if (j.error) throw new AiError(j.error.code, MSG[j.error.code] || j.error.message);
          if (j.t) { full += j.t; onText(full, j.t); }
        } catch (e) { if (e instanceof AiError) throw e; }
      }
    }
  }
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
