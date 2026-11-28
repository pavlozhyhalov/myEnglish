import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { decryptBackup, encryptBackup, expired } from './backupcrypto.ts';

const KEY = 'ab'.repeat(32);
Deno.test('backup: шифрування туди й назад', async () => {
  const data = JSON.stringify({ a: 'Привіт', n: [1, 2, 3] });
  const f = await encryptBackup(data, KEY);
  assertEquals(String.fromCharCode(...f.slice(0, 4)), 'MEB1');
  assertEquals(await decryptBackup(f, KEY), data);
  await assertRejects(() => decryptBackup(f, 'cd'.repeat(32)));
});
Deno.test('backup: термін зберігання', () => {
  const n = ['daily/2026-11-20.meb', 'daily/2026-11-21.meb', 'daily/2026-11-28.meb', 'weekly/2026-10-26.meb', 'weekly/2026-10-31.meb', 'weekly/x.meb'];
  assertEquals(expired(n, '2026-11-28'), ['daily/2026-11-20.meb', 'weekly/2026-10-26.meb']);
});

Deno.test('offsite: звіт, статус і застарілість', async () => {
  const { cleanReport, mergeStatus, staleOffsite } = await import('./backup.ts');
  if (cleanReport({ kind: 'evil' })) throw new Error('kind');
  const r = cleanReport({ kind: 'db', ok: true, file: 'db/backup-2026-11-28.sql.gz.gpg', bytes: '1234', counts: { profiles: 7, 'bad key': 1 } })!;
  if (r.entry.bytes !== 1234 || r.entry.counts?.profiles !== 7 || 'bad key' in (r.entry.counts || {})) throw new Error('clean');
  const now = Date.parse(r.entry.at);
  let s = mergeStatus(null, 'db', r.entry);
  if (staleOffsite(s, now).join() !== 'перевірка відновлення') throw new Error('restore stale ' + staleOffsite(s, now));
  s = mergeStatus(s, 'restore', { at: r.entry.at, ok: true });
  if (staleOffsite(s, now).length) throw new Error('fresh');
  s = mergeStatus(s, 'db', { at: new Date(now + 60e3).toISOString(), ok: false, detail: 'x' });
  if (s.lastOk?.db !== r.entry.at) throw new Error('lastOk kept');
  if (staleOffsite(s, now + 51 * 3600e3)[0] !== 'копія бази поза Supabase') throw new Error('db stale');
  if (staleOffsite(null).length) throw new Error('not configured');
});
