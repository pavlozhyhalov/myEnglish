// Резервні копії (2026-11-28, міграція 0040): формат файлу .meb = «MEB1» + IV 12 байт + AES-256-GCM(gzip(JSON)).
// Той самий формат розшифровує scripts/backup-decrypt.js (Node). Ключ — 64 hex-символи (Vault `backup_key`).
const MAGIC = new TextEncoder().encode('MEB1');

const hexBytes = (hex: string) => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('bad backup key');
  return Uint8Array.from(hex.match(/../g)!.map(b => parseInt(b, 16)));
};
const aesKey = (hex: string, use: KeyUsage) => crypto.subtle.importKey('raw', hexBytes(hex), 'AES-GCM', false, [use]);

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BufferSource]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encryptBackup(json: string, keyHex: string): Promise<Uint8Array> {
  const gz = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyHex, 'encrypt'), gz));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0); out.set(iv, MAGIC.length); out.set(ct, MAGIC.length + iv.length);
  return out;
}

export async function decryptBackup(file: Uint8Array, keyHex: string): Promise<string> {
  if (String.fromCharCode(...file.slice(0, 4)) !== 'MEB1') throw new Error('not a myEnglish backup');
  const iv = file.slice(4, 16);
  const gz = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(keyHex, 'decrypt'), file.slice(16) as BufferSource));
  return new TextDecoder().decode(await pipe(gz, new DecompressionStream('gzip')));
}

export const DAILY_KEEP = 7;     // днів
export const WEEKLY_KEEP = 28;   // днів (разом — до 35 днів, як у Політиці приватності)

/** Що видалити: імена файлів «<тека>/<YYYY-MM-DD>.meb», старші за термін своєї теки */
export function expired(names: string[], today: string): string[] {
  const t = Date.parse(today + 'T00:00:00Z');
  return names.filter(n => {
    const m = n.match(/^(daily|weekly)\/(\d{4}-\d{2}-\d{2})\.meb$/);
    if (!m) return false;
    const age = (t - Date.parse(m[2] + 'T00:00:00Z')) / 86400000;
    return age > (m[1] === 'daily' ? DAILY_KEEP : WEEKLY_KEEP);
  });
}
