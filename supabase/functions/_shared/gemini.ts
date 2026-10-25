import { HttpError } from './http.ts';

const BASE = 'https://generativelanguage.googleapis.com';

export function apiKey() {
  const k = Deno.env.get('GEMINI_API_KEY');
  if (!k) throw new HttpError(503, 'no_key', 'GEMINI_API_KEY is not set');
  return k;
}

export type Content = { role: 'user' | 'model'; parts: Array<Record<string, unknown>> };
export type GenOpts = {
  system?: string;
  contents: Content[];
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
};

function body(o: GenOpts) {
  const generationConfig: Record<string, unknown> = { temperature: o.temperature ?? 0.7 };
  if (o.maxTokens) generationConfig.maxOutputTokens = o.maxTokens;
  if (o.schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = o.schema; }
  const b: Record<string, unknown> = { contents: o.contents, generationConfig };
  if (o.system) b.systemInstruction = { parts: [{ text: o.system }] };
  return b;
}

async function mapError(res: Response): Promise<HttpError> {
  let msg = '';
  try { const j = await res.json(); msg = j?.error?.message || ''; } catch { /* */ }
  if (res.status === 429) return new HttpError(429, 'rate_limited', msg);
  if (res.status === 400 && /api key/i.test(msg)) return new HttpError(503, 'no_key', msg);
  if (res.status === 403) return new HttpError(503, 'no_key', msg);
  if (res.status === 404) return new HttpError(404, 'model_not_found', msg);
  return new HttpError(502, 'gemini', `Gemini ${res.status}: ${msg.slice(0, 200)}`);
}

/** Пробує моделі по черзі, якщо попередня не знайдена */
async function withModels<T>(models: string[], fn: (m: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const m of models) {
    try { return await fn(m); } catch (e) {
      last = e;
      if (e instanceof HttpError && e.code === 'model_not_found') continue;
      throw e;
    }
  }
  throw last;
}

export async function generate(models: string[], o: GenOpts): Promise<string> {
  return withModels(models, async (model) => {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() }, body: JSON.stringify(body(o)),
    });
    if (!res.ok) throw await mapError(res);
    const j = await res.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    return parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('');
  });
}

export async function generateJson<T = unknown>(models: string[], o: GenOpts): Promise<T> {
  const text = await generate(models, { temperature: 0.4, ...o });
  try { return JSON.parse(text) as T; } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new HttpError(502, 'gemini', 'Bad JSON from model');
  }
}

/** Стрімінг: повертає ReadableStream SSE для клієнта (data: {"t": "..."}) */
export async function streamSSE(models: string[], o: GenOpts): Promise<ReadableStream<Uint8Array>> {
  const res = await withModels(models, async (model) => {
    const r = await fetch(`${BASE}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() }, body: JSON.stringify(body(o)),
    });
    if (!r.ok) throw await mapError(r);
    return r;
  });
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  let buf = '';
  return new ReadableStream({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) { ctrl.enqueue(enc.encode('data: {"done":true}\n\n')); ctrl.close(); return; }
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const parts = j?.candidates?.[0]?.content?.parts || [];
          const t = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('');
          if (t) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ t })}\n\n`));
        } catch { /* неповний рядок */ }
      }
    },
    cancel() { reader.cancel(); },
  });
}

/** TTS: повертає PCM 16-bit 24 kHz */
export async function tts(models: string[], text: string, voice: string): Promise<{ pcm: Uint8Array; rate: number }> {
  return withModels(models, async (model) => {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (!res.ok) throw await mapError(res);
    const j = await res.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).find((p: { inlineData?: unknown }) => p.inlineData);
    if (!part) throw new HttpError(502, 'gemini', 'No audio');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
    const bin = atob(part.inlineData.data);
    const pcm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
    return { pcm, rate };
  });
}

/** Ефемерний токен для Gemini Live (v1alpha) з заблокованою конфігурацією */
export async function createLiveToken(setup: Record<string, unknown>, { uses = 10, minutes = 30 } = {}) {
  const now = Date.now();
  const res = await fetch(`${BASE}/v1alpha/auth_tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify({
      uses,
      expireTime: new Date(now + minutes * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      bidiGenerateContentSetup: setup,
    }),
  });
  if (!res.ok) throw await mapError(res);
  const j = await res.json();
  return { token: j.name as string, expireTime: new Date(now + minutes * 60_000).toISOString() };
}

export function wav(pcm: Uint8Array, rate = 24000, channels = 1, bits = 16): Uint8Array<ArrayBuffer> {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bits / 8, true);
  v.setUint16(32, channels * bits / 8, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0); out.set(pcm, 44);
  return out;
}
