import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.118.0';
import { HttpError } from './http.ts';
import { LIMITS } from './config.ts';

export type Ctx = { user: User; db: SupabaseClient; admin: SupabaseClient };

/**
 * JWT Supabase. Доступ — будь-якому користувачу, що увійшов (реєстрація відкрита, ліміти — на кожного окремо).
 * Обмежити колом людей: секрет ACCESS_MODE=allowlist + ALLOWED_USERS (uuid або email через кому).
 */
export async function authenticate(req: Request): Promise<Ctx> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'need_login');
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'need_login');
  const user = data.user;
  if ((Deno.env.get('ACCESS_MODE') || '').toLowerCase() === 'allowlist') {
    const allowed = (Deno.env.get('ALLOWED_USERS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(user.id.toLowerCase()) && !(user.email && allowed.includes(user.email.toLowerCase()))) {
      throw new HttpError(403, 'not_allowed');
    }
  }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { user, db, admin };
}

/** Адміністратори (ALLOWED_USERS): глибока діагностика та інші службові дії */
export function isAdmin(user: User) {
  const list = (Deno.env.get('ALLOWED_USERS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.id.toLowerCase()) || (!!user.email && list.includes(user.email.toLowerCase()));
}

function warsawDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

export async function usage(ctx: Ctx) {
  const { data } = await ctx.admin.from('ai_usage').select('*').eq('user_id', ctx.user.id).eq('day', warsawDay()).maybeSingle();
  return data || { text_calls: 0, voice_seconds: 0, tts_calls: 0 };
}

/** Перевірити ліміт і зарахувати виклик атомарно (charge_ai_usage); збій обліку — відмова, а не безкоштовний виклик */
export async function charge(ctx: Ctx, kind: 'text' | 'tts' | 'live', amount = 1) {
  const { data, error } = await ctx.admin.rpc('charge_ai_usage', {
    p_user: ctx.user.id, p_text: kind === 'text' ? amount : 0, p_voice: 0, p_tts: kind === 'tts' ? amount : 0, p_live: kind === 'live' ? amount : 0,
    p_lim_text: LIMITS.textCalls, p_lim_voice: LIMITS.voiceSeconds, p_lim_tts: LIMITS.ttsCalls, p_lim_live: LIMITS.liveTokens,
  });
  if (error) { console.error('usage', error.message); throw new HttpError(503, 'server', 'Usage accounting failed'); }
  if (data !== true) throw new HttpError(429, 'quota');
}
