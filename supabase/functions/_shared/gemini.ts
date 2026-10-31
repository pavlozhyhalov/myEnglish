import { HttpError } from './http.ts';

const BASE = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS = 30_000;

/**
 * fetch з тайм-аутом: зависла модель вважається перевантаженою — пробуємо наступну.
 * firstByteOnly: тайм-аут лише до заголовків відповіді (для стрімінгу — довгий потік не обривається).
 */
async function gfetch(url: string, init: RequestInit, ms = TIMEOUT_MS, firstByteOnly = false): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    if (firstByteOnly) clearTimeout(timer);
    else { const done = () => clearTimeout(timer); res.clone().arrayBuffer().then(done, done); }
    return res;
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw new HttpError(503, 'overloaded', 'Gemini timeout');
    throw e;
  }
}

export function apiKey() {
  const k = Deno.env.get('GEMINI_API_KEY');
  if (!k) throw new HttpError(503, 'no_key', 'GEMINI_API_KEY is not set');
  return k;
}

export type Content = { role: 'user' | 'model'; parts: Array<Record<string, unknown>> };
export type Thinking = 'off' | 'low' | 'medium' | 'high';
export type GenOpts = {
  system?: string;
  contents: Content[];
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  /** Скільки «думати»: off — найшвидше (службові виклики), low — чат, medium — аналітика. Не задано — типова поведінка моделі. */
  thinking?: Thinking;
  /** Тайм-аут одного виклику моделі, мс (типово 30 с) */
  timeoutMs?: number;
};

/** Моделі, що не прийняли thinkingConfig (кеш теплого екземпляра) — далі без нього */
const noThinking = new Set<string>();

/** thinkingConfig для сімейства моделі: 2.5 — бюджет токенів, новіші — рівень */
export function thinkingConfig(model: string, t?: Thinking): Record<string, unknown> | null {
  if (!t || noThinking.has(model)) return null;
  const pro = /pro/.test(model);
  if (/gemini-2\.5/.test(model)) {
    const budget = { off: pro ? 128 : 0, low: 512, medium: 2048, high: -1 }[t];
    return { thinkingBudget: budget };
  }
  const level = { off: pro ? 'low' : 'minimal', low: 'low', medium: pro ? 'high' : 'medium', high: 'high' }[t];
  return { thinkingLevel: level };
}

function body(o: GenOpts, model = '') {
  const generationConfig: Record<string, unknown> = { temperature: o.temperature ?? 0.7 };
  if (o.maxTokens) generationConfig.maxOutputTokens = o.maxTokens;
  if (o.schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = o.schema; }
  const th = thinkingConfig(model, o.thinking);
  if (th) generationConfig.thinkingConfig = th;
  const b: Record<string, unknown> = { contents: o.contents, generationConfig };
  if (o.system) b.systemInstruction = { parts: [{ text: o.system }] };
  return b;
}

/** Запит до моделі; якщо модель не прийняла thinkingConfig (400) — один повтор без нього */
async function call(model: string, method: string, o: GenOpts, ms: number, firstByteOnly = false): Promise<Response> {
  const go = () => gfetch(`${BASE}/v1beta/models/${model}:${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() }, body: JSON.stringify(body(o, model)),
  }, ms, firstByteOnly);
  let res = await go();
  if (!res.ok && res.status === 400 && thinkingConfig(model, o.thinking)) {
    const err = await mapError(res);
    // лише якщо помилка справді про «роздуми»; інакше (схема, розмір запиту…) — звичайна помилка, кеш не псуємо
    if (err.code !== 'bad_model_request' || !/think/i.test(err.message)) throw err;
    noThinking.add(model);
    res = await go();
  }
  if (!res.ok) throw await mapError(res);
  return res;
}

async function mapError(res: Response): Promise<HttpError> {
  let msg = '';
  try { const j = await res.json(); msg = j?.error?.message || ''; } catch { /* */ }
  if (res.status === 429) return new HttpError(429, 'rate_limited', msg);
  if (res.status === 400 && /api key/i.test(msg)) return new HttpError(503, 'no_key', msg);
  if (res.status === 403) return new HttpError(503, 'no_key', msg);
  if (res.status === 404) return new HttpError(404, 'model_not_found', msg);
  if (res.status === 503 || res.status === 500) return new HttpError(503, 'overloaded', msg);
  if (res.status === 400) return new HttpError(502, 'bad_model_request', msg.slice(0, 200));
  return new HttpError(502, 'gemini', `Gemini ${res.status}: ${msg.slice(0, 200)}`);
}

/**
 * Текст першого кандидата. Порожня/заблокована відповідь — 'empty'; обрізана лімітом токенів (MAX_TOKENS) — 'truncated'
 * (зазвичай токени з'їли «роздуми»): обидві — повтор без роздумів або наступна модель.
 */
export function candidateText(j: any): string {
  const c = j?.candidates?.[0];
  const parts = c?.content?.parts || [];
  const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('');
  if (!text.trim()) throw new HttpError(502, 'empty', `Empty reply (${c?.finishReason || j?.promptFeedback?.blockReason || 'no candidates'})`);
  if (c?.finishReason === 'MAX_TOKENS') {
    console.error('truncated', text.length, j?.usageMetadata?.thoughtsTokenCount ?? '');
    throw new HttpError(502, 'truncated', `Truncated reply (${text.length} chars)`);
  }
  return text;
}

/** Модель, що відповіла 429 (квота/частота), пропускається на COOLDOWN_MS у теплому екземплярі — без зайвих запитів і затримок */
const COOLDOWN_MS = 120_000;
const cooled = new Map<string, number>();
export function coolDown(model: string, ms = COOLDOWN_MS) { cooled.set(model, Date.now() + ms); }
export function isCooled(model: string) { return (cooled.get(model) || 0) > Date.now(); }

const RETRYABLE = ['model_not_found', 'overloaded', 'rate_limited', 'bad_model_request', 'empty', 'truncated'];

/** Пробує моделі по черзі (охолоджені — в кінці черги); перевантажена/без квоти/порожня — наступна */
async function withModels<T>(models: string[], fn: (m: string) => Promise<T>): Promise<T> {
  let last: unknown;
  const order = [...models.filter(m => !isCooled(m)), ...models.filter(m => isCooled(m))];
  for (const m of order) {
    try { return await fn(m); } catch (e) {
      last = e;
      if (e instanceof HttpError && e.code === 'rate_limited') coolDown(m);
      if (e instanceof HttpError && RETRYABLE.includes(e.code)) continue;
      throw e;
    }
  }
  // клієнт знає код 'empty' («не вдалося отримати відповідь»), а не внутрішній 'truncated'
  if (last instanceof HttpError && last.code === 'truncated') throw new HttpError(502, 'empty', last.message);
  throw last;
}

export async function generate(models: string[], o: GenOpts): Promise<string> {
  return withModels(models, async (model) => {
    const once = async (oo: GenOpts) => candidateText(await (await call(model, 'generateContent', oo, oo.timeoutMs || TIMEOUT_MS)).json());
    try { return await once(o); } catch (e) {
      // порожньо чи обрізано через «роздуми» — один повтор тієї ж моделі без них
      if (e instanceof HttpError && (e.code === 'empty' || e.code === 'truncated') && o.thinking && o.thinking !== 'off') return await once({ ...o, thinking: 'off' });
      throw e;
    }
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

/**
 * Стрімінг тексту: модель обирається до повернення (помилка моделі — звичайний HttpError, а не обірваний потік),
 * далі — шматки тексту без «роздумів». Обрив потоку від Gemini — HttpError('overloaded').
 */
export type TextStream = AsyncGenerator<string> & { info: { finishReason: string; chars: number } };
export async function streamText(models: string[], o: GenOpts): Promise<TextStream> {
  const res = await withModels(models, (model) => call(model, 'streamGenerateContent?alt=sse', o, o.timeoutMs || 45_000, true));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  // причина завершення (MAX_TOKENS — обрізано) і довжина тексту — для відновлення в викликача
  const info = { finishReason: '', chars: 0 };
  const gen = (async function* () {
    let buf = '';
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { throw new HttpError(503, 'overloaded', 'Gemini stream broken'); }
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let j: any;
          try { j = JSON.parse(line.slice(5)); } catch { continue; }
          const c = j?.candidates?.[0];
          if (c?.finishReason) info.finishReason = String(c.finishReason);
          const parts = c?.content?.parts || [];
          const t = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('');
          if (t) { info.chars += t.length; yield t; }
        }
      }
      if (info.finishReason === 'MAX_TOKENS') console.error('truncated stream', info.chars);
    } finally { reader.cancel().catch(() => {}); }
  })();
  return Object.assign(gen, { info });
}

/** Стрімінг: повертає ReadableStream SSE для клієнта (data: {"t": "..."}) */
export async function streamSSE(models: string[], o: GenOpts): Promise<ReadableStream<Uint8Array>> {
  const it = await streamText(models, o);
  const enc = new TextEncoder();
  return new ReadableStream({
    async pull(ctrl) {
      try {
        const { value, done } = await it.next();
        if (done) { ctrl.enqueue(enc.encode('data: {"done":true}\n\n')); ctrl.close(); return; }
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ t: value })}\n\n`));
      } catch {
        // обрив потоку від Gemini — клієнт отримує зрозумілу помилку, а не TypeError
        ctrl.enqueue(enc.encode('data: {"error":{"code":"overloaded"}}\n\n')); ctrl.close();
      }
    },
    cancel() { it.return(undefined); },
  });
}

/** TTS: повертає PCM 16-bit 24 kHz */
export async function tts(models: string[], text: string, voice: string): Promise<{ pcm: Uint8Array; rate: number }> {
  return withModels(models, async (model) => {
    const res = await gfetch(`${BASE}/v1beta/models/${model}:generateContent`, {
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
  const res = await gfetch(`${BASE}/v1alpha/auth_tokens`, {
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
