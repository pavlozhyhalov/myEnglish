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
