// Edge Function `admin`: агреговані показники для адмін-сторінки (#/admin).
// Доступ — лише адміністраторам (ALLOWED_USERS, isAdmin); решті — 403 (клієнт за цим ховає посилання).
// Дані — RPC admin_stats (міграція 0013) через service role; лише агрегати, без вмісту розмов і навчальних даних.
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate, isAdmin } from '../_shared/auth.ts';
import { LIMITS } from '../_shared/config.ts';

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'not_admin');
  const p = await req.json().catch(() => ({})) as { action?: string; days?: number };
  if (p.action === 'ping') return json({ admin: true });
  if (p.action && p.action !== 'stats') throw new HttpError(400, 'bad_action');
  const days = Math.max(1, Math.min(60, Number(p.days) || 14));
  const { data, error } = await ctx.admin.rpc('admin_stats', { p_days: days });
  if (error) { console.error('admin_stats', error.message); throw new HttpError(503, 'server', 'Stats unavailable'); }
  return json({ admin: true, limits: LIMITS, stats: data }, 200, { 'Cache-Control': 'no-store' });
}));
