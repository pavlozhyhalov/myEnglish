import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.118.0';
import { HttpError } from './http.ts';
import { LIMITS } from './config.ts';

export type Ctx = { user: User; db: SupabaseClient; admin: SupabaseClient };

/** JWT Supabase + allowlist (ALLOWED_USERS: uuid або email через кому) */
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
  const allowed = (Deno.env.get('ALLOWED_USERS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.id.toLowerCase()) && !(user.email && allowed.includes(user.email.toLowerCase()))) {
    throw new HttpError(403, 'not_allowed');
  }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { user, db, admin };
}

function warsawDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

export async function usage(ctx: Ctx) {
  const { data } = await ctx.admin.from('ai_usage').select('*').eq('user_id', ctx.user.id).eq('day', warsawDay()).maybeSingle();
  return data || { text_calls: 0, voice_seconds: 0, tts_calls: 0 };
}

/** Перевірити ліміт і зарахувати виклик */
export async function charge(ctx: Ctx, kind: 'text' | 'tts' | 'voice', amount = 1) {
  const u = await usage(ctx);
  if (kind === 'text' && u.text_calls >= LIMITS.textCalls) throw new HttpError(429, 'quota');
  if (kind === 'tts' && u.tts_calls >= LIMITS.ttsCalls) throw new HttpError(429, 'quota');
  if (kind === 'voice' && u.voice_seconds >= LIMITS.voiceSeconds) throw new HttpError(429, 'quota');
  const { error } = await ctx.admin.rpc('bump_ai_usage', {
    p_user: ctx.user.id, p_text: kind === 'text' ? amount : 0, p_voice: kind === 'voice' ? amount : 0, p_tts: kind === 'tts' ? amount : 0,
  });
  if (error) console.error('usage', error.message);
  return u;
}
