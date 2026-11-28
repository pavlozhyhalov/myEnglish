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


// ---------- Копії поза Supabase (міграція 0043): звіти GitHub Actions ----------
export type OffsiteKind = 'db' | 'restore' | 'files';
export type OffsiteEntry = { at: string; ok: boolean; file?: string; bytes?: number; detail?: string; counts?: Record<string, number> };
export type OffsiteStatus = Partial<Record<OffsiteKind, OffsiteEntry>> & { lastOk?: Partial<Record<OffsiteKind, string>> };
const KINDS: OffsiteKind[] = ['db', 'restore', 'files'];

/** Перевірити й нормалізувати звіт (усе, що прийшло ззовні, обрізається) */
export function cleanReport(b: any): { kind: OffsiteKind; entry: OffsiteEntry } | null {
  const kind = String(b?.kind || '') as OffsiteKind;
  if (!KINDS.includes(kind)) return null;
  const counts: Record<string, number> = {};
  if (b?.counts && typeof b.counts === 'object') for (const [k, v] of Object.entries(b.counts).slice(0, 20)) if (/^[a-z_]{1,40}$/.test(k) && Number.isFinite(Number(v))) counts[k] = Math.max(0, Math.round(Number(v)));
  return { kind, entry: {
    at: new Date().toISOString(), ok: b?.ok === true,
    ...(b?.file ? { file: String(b.file).slice(0, 120) } : {}),
    ...(Number.isFinite(Number(b?.bytes)) ? { bytes: Math.max(0, Math.round(Number(b.bytes))) } : {}),
    ...(b?.detail ? { detail: String(b.detail).slice(0, 300) } : {}),
    ...(Object.keys(counts).length ? { counts } : {}),
  } };
}

export function mergeStatus(old: OffsiteStatus | null, kind: OffsiteKind, e: OffsiteEntry): OffsiteStatus {
  const s: OffsiteStatus = { ...(old || {}), [kind]: e, lastOk: { ...(old?.lastOk || {}) } };
  if (e.ok) s.lastOk![kind] = e.at;
  return s;
}

/** Що застаріло: копія бази й файлів — понад 50 год без успіху, перевірка відновлення — понад 9 днів (лише якщо поза Supabase налаштовано) */
export function staleOffsite(s: OffsiteStatus | null, now = Date.now()): string[] {
  if (!s || !s.db) return [];
  const age = (k: OffsiteKind) => (s.lastOk?.[k] ? now - Date.parse(s.lastOk[k]!) : Infinity);
  const out: string[] = [];
  if (age('db') > 50 * 3600e3) out.push('копія бази поза Supabase');
  if (s.files && age('files') > 50 * 3600e3) out.push('копія файлів поза Supabase');
  if (age('restore') > 9 * 864e5) out.push('перевірка відновлення');
  return out;
}

export async function readOffsite(db: SupabaseClient): Promise<OffsiteStatus | null> {
  const { data } = await db.from('app_keys').select('value').eq('id', 'offsite_backup').maybeSingle();
  return (data?.value as OffsiteStatus) || null;
}
export async function saveOffsite(db: SupabaseClient, s: OffsiteStatus) {
  const { error } = await db.from('app_keys').upsert({ id: 'offsite_backup', value: s });
  if (error) throw new Error('offsite status: ' + error.message);
}

/** Остання копія в Supabase (daily/) — для автомонітора */
export async function lastInternal(db: SupabaseClient) {
  const list = (await names(db, 'daily')).sort();
  return list.length ? list[list.length - 1].slice(6, 16) : null;
}
