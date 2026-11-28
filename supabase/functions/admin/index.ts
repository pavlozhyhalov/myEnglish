// Edge Function `admin`: агреговані показники для адмін-сторінки (#/admin).
// Доступ — лише адміністраторам (ALLOWED_USERS, isAdmin); решті — 403 (клієнт за цим ховає посилання).
// Дані — RPC admin_stats (міграція 0013) і admin_users (0020, дія `users`: активність кожного користувача — ім'я або частина email до «@»,
// хвилини, рівень, лічильники) через service role; лише агрегати, без вмісту розмов. Переписка друзів — лише кількість (admin_chat_stats, 0023).
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate, isAdmin } from '../_shared/auth.ts';
import { runBackup, names, readOffsite } from '../_shared/backup.ts';
import { LIMITS } from '../_shared/config.ts';

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'not_admin');
  const p = await req.json().catch(() => ({})) as { action?: string; days?: number };
  if (p.action === 'ping') return json({ admin: true });
  if (p.action === 'users') {
    const [{ data, error }, chats] = await Promise.all([ctx.admin.rpc('admin_users'), ctx.admin.rpc('admin_chat_stats')]);
    if (error) { console.error('admin_users', error.message); throw new HttpError(503, 'server', 'Users unavailable'); }
    // Спільний денний запас сильних моделей: частка на людину × 10 людей (розрахунок 2026-11-13) ≈ 80
    return json({ admin: true, limits: LIMITS, budget: { strongCalls: LIMITS.strongCalls * 10 }, users: data, chats: chats.data || null }, 200, { 'Cache-Control': 'no-store' });
  }
  // «Написати розробнику» (міграція 0036): звернення зі скріншотом (підписане посилання на 1 год), відповідь і стан
  if (p.action === 'feedback') {
    const { data: rows, error } = await ctx.admin.from('feedback').select('id, user_id, kind, body, route, build, ua, image_path, status, reply, replied_at, created_at')
      .order('created_at', { ascending: false }).limit(60);
    if (error) throw new HttpError(503, 'server', 'Feedback unavailable');
    const ids = [...new Set((rows || []).map(r => r.user_id))];
    const [{ data: fps }, { data: profs }] = await Promise.all([
      ids.length ? ctx.admin.from('friend_profiles').select('user_id, display_name').in('user_id', ids) : { data: [] },
      ids.length ? ctx.admin.from('profiles').select('user_id, data').in('user_id', ids) : { data: [] }]);
    const name = (id: string) => String((fps || []).find(f => f.user_id === id)?.display_name || ((profs || []).find(x => x.user_id === id)?.data as any)?.about?.name || 'Учень').slice(0, 40);
    const out = [];
    for (const r of rows || []) {
      let image = null;
      if (r.image_path) { const { data: u } = await ctx.admin.storage.from('feedback').createSignedUrl(r.image_path, 3600); image = u?.signedUrl || null; }
      out.push({ ...r, image_path: undefined, image, name: name(r.user_id) });
    }
    return json({ admin: true, feedback: out }, 200, { 'Cache-Control': 'no-store' });
  }
  if (p.action === 'feedback_update') {
    const q = p as { id?: string; status?: string; reply?: string };
    if (!/^[0-9a-f-]{36}$/.test(String(q.id))) throw new HttpError(400, 'bad_request');
    const patch: Record<string, unknown> = {};
    if (['new', 'seen', 'done'].includes(String(q.status))) patch.status = q.status;
    if (typeof q.reply === 'string' && q.reply.trim()) { patch.reply = q.reply.trim().slice(0, 2000); patch.replied_at = new Date().toISOString(); patch.status = q.status && patch.status ? patch.status : 'done'; }
    if (!Object.keys(patch).length) throw new HttpError(400, 'bad_request');
    const { error } = await ctx.admin.from('feedback').update(patch).eq('id', String(q.id));
    if (error) throw new HttpError(503, 'server', 'Update failed');
    return json({ ok: true });
  }
  if (p.action === 'costs') {
    // фактичні токени Gemini за 30 днів (міграція 0041) + скільки людей користувались AI — ціну рахує клієнт за таблицею цін
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [{ data: rows, error }, { data: users }] = await Promise.all([
      ctx.admin.from('ai_tokens').select('day, model, kind, calls, in_text, in_audio, out_text, out_audio, thoughts').gte('day', since).order('day'),
      ctx.admin.from('ai_usage').select('user_id, day, voice_seconds').gte('day', since)]);
    if (error) throw new HttpError(500, 'server', error.message);
    const people = new Set((users || []).map(u => u.user_id)).size;
    const voiceMin = Math.round((users || []).reduce((s, u) => s + (Number(u.voice_seconds) || 0), 0) / 60);
    return json({ admin: true, rows: rows || [], people, voiceMin, since }, 200, { 'Cache-Control': 'no-store' });
  }
  if (p.action === 'backups' || p.action === 'backup_now') {
    // резервні копії (міграція 0040): перелік із посиланнями на 10 хв + ключ розшифрування; «зараз» — позачергова копія
    const made = p.action === 'backup_now' ? await runBackup(ctx.admin) : null;
    const files = [...await names(ctx.admin, 'daily'), ...await names(ctx.admin, 'weekly')].sort((a, b) => b.slice(-14).localeCompare(a.slice(-14)) || a.localeCompare(b));
    const list = [];
    for (const f of files) { const { data: u } = await ctx.admin.storage.from('backups').createSignedUrl(f, 600, { download: f.replace('/', '-') }); list.push({ path: f, url: u?.signedUrl || null }); }
    const [{ data: key }, { data: osec }, offsite] = await Promise.all([ctx.admin.rpc('backup_key'), ctx.admin.rpc('offsite_secret'), readOffsite(ctx.admin)]);
    return json({ admin: true, files: list, key: typeof key === 'string' ? key : null, offsiteSecret: typeof osec === 'string' ? osec : null, offsite, made: made && { paths: made.paths, bytes: made.bytes, tables: made.tables } }, 200, { 'Cache-Control': 'no-store' });
  }
  if (p.action && p.action !== 'stats') throw new HttpError(400, 'bad_action');
  const days = Math.max(1, Math.min(60, Number(p.days) || 14));
  const { data, error } = await ctx.admin.rpc('admin_stats', { p_days: days });
  if (error) { console.error('admin_stats', error.message); throw new HttpError(503, 'server', 'Stats unavailable'); }
  return json({ admin: true, limits: LIMITS, stats: data }, 200, { 'Cache-Control': 'no-store' });
}));
