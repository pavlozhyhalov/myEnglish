// Облік фактичних токенів Gemini (2026-11-28, власник: «маю розуміти умови, щоб закладати в ціну»; міграція 0041).
// Кожна відповідь Gemini містить usageMetadata — складаємо за днем, моделлю й видом (text/stream/tts/live) у public.ai_tokens
// (без ідентифікатора людини: лише сума для розрахунку собівартості). Збій обліку ніколи не ламає відповідь учню.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { AsyncLocalStorage } from 'node:async_hooks';

// Хто зараз робить запит (2026-11-28, місячний бюджет на людину): handler (http.ts) відкриває контекст, authenticate (auth.ts) пише в нього id.
// Потокові відповіді беруть id на старті (контекст у колбеках потоку не гарантований).
const reqCtx = new AsyncLocalStorage<{ uid: string }>();
export const withRequest = <T>(fn: () => T): T => reqCtx.run({ uid: '' }, fn);
export function setRequestUser(uid: string) { const s = reqCtx.getStore(); if (s) s.uid = uid; }
export const currentUser = () => reqCtx.getStore()?.uid || '';

// Ціни $ за 1 млн токенів [вхід текст, вхід аудіо, вихід текст (і «роздуми»), вихід аудіо] — попередні, як у js/pages/admin.js (docs/gemini-cost.md)
const PRICES: [RegExp, number[]][] = [
  [/tts/, [1.0, 1.0, 18, 18]],
  [/live|native-audio/, [0.75, 3.0, 4.5, 12]],
  [/flash-lite/, [0.30, 0.60, 2.5, 2.5]],
  [/./, [1.5, 3.0, 7.5, 7.5]],
];
/** Вартість у мільйонних долара: токени × ціна за 1 млн */
export function costMicros(model: string, u: Usage) {
  const p = (PRICES.find(([re]) => re.test(model)) || PRICES[PRICES.length - 1])[1];
  return Math.round(u.inText * p[0] + u.inAudio * p[1] + (u.outText + u.thoughts) * p[2] + u.outAudio * p[3]);
}
/** Голос: оцінка вартості секунди розмови (≈ $0,035/хв, docs/gemini-cost.md) — для місячного бюджету */
export const VOICE_MICROS_PER_SEC = 583;

export type Usage = { inText: number; inAudio: number; outText: number; outAudio: number; thoughts: number };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const byModality = (list: unknown, mod: string) =>
  (Array.isArray(list) ? list : []).filter((d: any) => String(d?.modality || '').toUpperCase() === mod).reduce((s: number, d: any) => s + n(d?.tokenCount), 0);

/** usageMetadata (generateContent — candidates…, Live — response…) → вхід/вихід за модальністю + «роздуми» */
export function usageFrom(um: any): Usage | null {
  if (!um || typeof um !== 'object') return null;
  const inAll = n(um.promptTokenCount);
  const outAll = n(um.candidatesTokenCount ?? um.responseTokenCount);
  const inAudio = byModality(um.promptTokensDetails, 'AUDIO');
  const outAudio = byModality(um.candidatesTokensDetails ?? um.responseTokensDetails, 'AUDIO');
  const u = { inText: Math.max(0, inAll - inAudio), inAudio, outText: Math.max(0, outAll - outAudio), outAudio, thoughts: n(um.thoughtsTokenCount) };
  return u.inText + u.inAudio + u.outText + u.outAudio + u.thoughts ? u : null;
}

let db: SupabaseClient | null = null;
function client() {
  if (db) return db;
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return (db = createClient(url, key, { auth: { persistSession: false } }));
}

export function meter(model: string, kind: string, um: unknown, who = currentUser()) {
  try {
    const u = usageFrom(um);
    const c = u && client();
    if (!u || !c) return;
    const job = c.rpc('add_ai_tokens', { p_model: model.slice(0, 80), p_kind: kind, p_calls: 1, p_in_text: u.inText, p_in_audio: u.inAudio, p_out_text: u.outText, p_out_audio: u.outAudio, p_thoughts: u.thoughts })
      .then(({ error }) => { if (error) console.error('meter', error.message); }, () => {});
    // вартість — і на людину (місячний бюджет, add_user_cost, міграція 0042)
    const mine = who ? c.rpc('add_user_cost', { p_user: who, p_micros: costMicros(model, u) }).then(({ error }) => { if (error) console.error('user cost', error.message); }, () => {}) : null;
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) { rt.waitUntil(job); if (mine) rt.waitUntil(mine); }
  } catch { /* облік не важливіший за відповідь */ }
}
