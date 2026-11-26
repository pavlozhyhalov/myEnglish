// Edge Function `account` (2026-11-26, App Store 5.1.1(v), GDPR ст. 15/17/20):
//  - `delete` — видалити акаунт назавжди: файли користувача в бакетах (voice-clips/<uid>/…, chat-voice/<room>/<uid>/…, feedback/<uid>/…),
//    потім auth.users — усі таблиці чистяться каскадом (FK on delete cascade / set null). Пароль клієнт перевіряє сам перед викликом.
//  - `export` — серверна частина «Завантажити мої дані»: мої повідомлення в чатах і звернення (решта — з пристрою, вона синхронізована).
import { handler, json, HttpError } from '../_shared/http.ts';
import { authenticate } from '../_shared/auth.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

async function listAll(sb: SupabaseClient, bucket: string, prefix: string, depth = 2): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error || !data?.length) break;
    for (const it of data) {
      const p = `${prefix}/${it.name}`;
      if (it.id) out.push(p);                                   // файл
      else if (depth > 0) out.push(...await listAll(sb, bucket, p, depth - 1));   // тека
    }
    if (data.length < 1000) break;
  }
  return out;
}

async function removeAll(sb: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) console.error('remove', bucket, error.message);
  }
}

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  const uid = ctx.user.id;
  const p = await req.json().catch(() => ({})) as { action?: string; confirm?: string };

  if (p.action === 'export') {
    const [msgs, fb] = await Promise.all([
      ctx.admin.from('chat_messages').select('id, room_id, kind, body, created_at, deleted_at').eq('user_id', uid).order('created_at').limit(20000),
      ctx.admin.from('feedback').select('kind, body, route, created_at, reply, replied_at').eq('user_id', uid).order('created_at'),
    ]);
    return json({ chat_messages: msgs.data || [], feedback: fb.data || [] }, 200, { 'Cache-Control': 'no-store' });
  }

  if (p.action === 'delete') {
    if (p.confirm !== 'DELETE') throw new HttpError(400, 'bad_request');
    // 1) файли: голос «тоді й зараз», голосові в чатах (шляхи — з повідомлень), скріншоти звернень
    const clips = await listAll(ctx.admin, 'voice-clips', uid, 2);
    const { data: voice } = await ctx.admin.from('chat_messages').select('audio_path').eq('user_id', uid).not('audio_path', 'is', null).limit(20000);
    const { data: fbs } = await ctx.admin.from('feedback').select('image_path').eq('user_id', uid).not('image_path', 'is', null);
    await Promise.all([
      removeAll(ctx.admin, 'voice-clips', clips),
      removeAll(ctx.admin, 'chat-voice', (voice || []).map(r => r.audio_path as string).filter(Boolean)),
      removeAll(ctx.admin, 'feedback', [...(fbs || []).map(r => r.image_path as string).filter(Boolean), ...await listAll(ctx.admin, 'feedback', uid, 0)]),
    ]);
    // 2) користувач — каскадом усі його рядки
    const { error } = await ctx.admin.auth.admin.deleteUser(uid);
    if (error) { console.error('deleteUser', error.message); throw new HttpError(503, 'server', 'Delete failed'); }
    return json({ ok: true });
  }
  throw new HttpError(400, 'bad_action');
}));
