// Дзеркало файлів Supabase Storage у Cloudflare R2 (2026-11-28; запускає .github/workflows/db-backup.yml, завдання files).
// Бакети з даними учнів: chat-voice (голосові в чатах), voice-clips («тоді й зараз»), feedback (скріншоти звернень).
// Нові файли докачуються, файли, яких у Supabase вже немає (видалено акаунт чи повідомлення), видаляються й з R2 — так виконується Політика.
// Не друкує шляхів і вмісту (логи репозиторію публічні) — лише кількості; підсумок — storage-summary.json для звіту.
// Потрібні: SUPABASE_URL, SERVICE_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY; утиліта aws (є на ubuntu-latest).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BUCKETS = ['chat-voice', 'voice-clips', 'feedback'];
const { SUPABASE_URL, SERVICE_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME } = process.env;
const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const TMP = 'storage-tmp';

async function list(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${bucket}: ${r.status}`);
    const items = await r.json();
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id == null) out.push(...await list(bucket, path));   // тека
      else out.push({ path, size: Number(it.metadata?.size) || 0 });
    }
    if (items.length < 1000) break;
  }
  return out;
}

function aws(args, input) {
  return execFileSync('aws', [...args, '--endpoint-url', ENDPOINT], { encoding: 'utf8', input, maxBuffer: 256 << 20 });
}

function remoteKeys(prefix) {
  const keys = new Map();
  let token = '';
  for (;;) {
    const res = JSON.parse(aws(['s3api', 'list-objects-v2', '--bucket', R2_BUCKET_NAME, '--prefix', prefix, '--output', 'json', ...(token ? ['--continuation-token', token] : [])]) || '{}');
    for (const o of res.Contents || []) keys.set(o.Key, Number(o.Size) || 0);
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  return keys;
}

const summary = {};
for (const bucket of BUCKETS) {
  const prefix = `files/${bucket}/`;
  const local = await list(bucket);
  const remote = remoteKeys(prefix);
  const want = new Set(local.map(f => prefix + f.path));
  let added = 0, removed = 0;
  rmSync(TMP, { recursive: true, force: true });
  for (const f of local) {
    const key = prefix + f.path;
    if (remote.has(key) && (!f.size || remote.get(key) === f.size)) continue;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { headers: H });
    if (!r.ok) throw new Error(`download ${bucket}: ${r.status}`);
    const file = join(TMP, f.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    aws(['s3', 'cp', file, `s3://${R2_BUCKET_NAME}/${key}`, '--only-show-errors']);
    rmSync(file);
    added++;
  }
  const gone = [...remote.keys()].filter(k => !want.has(k));
  for (let i = 0; i < gone.length; i += 1000) {
    const batch = { Objects: gone.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true };
    aws(['s3api', 'delete-objects', '--bucket', R2_BUCKET_NAME, '--delete', 'file:///dev/stdin'], JSON.stringify(batch));
    removed += batch.Objects.length;
  }
  summary[bucket.replace('-', '_')] = local.length;
  console.log(`${bucket}: ${local.length} files, +${added} new, -${removed} removed`);
}
rmSync(TMP, { recursive: true, force: true });
writeFileSync('storage-summary.json', JSON.stringify(summary));
