// Резервна копія бази (міграція 0040): знімок → шифрування → бакет `backups`. Викликають функції `backup` (pg_cron) і `admin` («Зробити копію зараз»).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { encryptBackup, expired } from './backupcrypto.ts';

export async function names(db: SupabaseClient, dir: string) {
  const { data } = await db.storage.from('backups').list(dir, { limit: 1000 });
  return (data || []).filter(f => f.id).map(f => `${dir}/${f.name}`);
}

export async function runBackup(db: SupabaseClient) {
  const [{ data: snap, error: e1 }, { data: key, error: e2 }] = await Promise.all([db.rpc('backup_snapshot'), db.rpc('backup_key')]);
  if (e1 || !snap) throw new Error('snapshot: ' + (e1?.message || 'empty'));
  if (e2 || typeof key !== 'string') throw new Error('key: ' + (e2?.message || 'missing'));
  const file = await encryptBackup(JSON.stringify(snap), key);
  const day = new Date().toISOString().slice(0, 10);
  const put = (path: string) => db.storage.from('backups').upload(path, file, { contentType: 'application/octet-stream', upsert: true });
  const paths = [`daily/${day}.meb`];
  if (new Date().getUTCDay() === 1) paths.push(`weekly/${day}.meb`);
  for (const p of paths) { const { error } = await put(p); if (error) throw new Error('upload: ' + error.message); }
  const old = expired([...await names(db, 'daily'), ...await names(db, 'weekly')], day);
  if (old.length) await db.storage.from('backups').remove(old);
  const tables = Object.fromEntries(Object.entries((snap as { tables: Record<string, unknown[]> }).tables).map(([k, v]) => [k, v.length]));
  return { paths, bytes: file.length, removed: old, tables };
}

