export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message || code); }
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    // текст помилок Gemini (квоти, ідентифікатори проєкту) — лише в лог, клієнту — код
    const upstream = ['gemini', 'rate_limited', 'overloaded', 'no_key', 'model_not_found', 'empty', 'bad_model_request'].includes(e.code);
    if (upstream) console.error('upstream', e.code, e.message.slice(0, 300));
    return json({ error: { code: e.code, message: upstream ? e.code : e.message } }, e.status);
  }
  // логуємо без вмісту розмов
  console.error('internal', (e as Error)?.name, (e as Error)?.message?.slice(0, 200));
  return json({ error: { code: 'server', message: 'Internal error' } }, 500);
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: { code: 'method' } }, 405);
    try { return await fn(req); } catch (e) { return errorResponse(e); }
  };
}
