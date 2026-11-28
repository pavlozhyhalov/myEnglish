// Розшифрувати резервну копію myEnglish (.meb, міграція 0040; формат — supabase/functions/_shared/backupcrypto.ts):
//   node scripts/backup-decrypt.js <файл.meb> <ключ 64 hex> [вихід.json]
// Ключ — «Ключ розшифрування» в #/admin → «Резервні копії» (тримайте в менеджері паролів окремо від файлів).
// Результат — JSON { format, at, tables: { 'public.cards': [...], 'auth.users': [...], ... } }. Відновлення — docs/backup.md.
const fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const [file, key, out] = process.argv.slice(2);
if (!file || !/^[0-9a-f]{64}$/i.test(key || '')) { console.error('node scripts/backup-decrypt.js <файл.meb> <ключ 64 hex> [вихід.json]'); process.exit(2); }
const buf = fs.readFileSync(file);
if (buf.subarray(0, 4).toString() !== 'MEB1') { console.error('Це не резервна копія myEnglish'); process.exit(1); }
const iv = buf.subarray(4, 16), body = buf.subarray(16, buf.length - 16), tag = buf.subarray(buf.length - 16);
const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv); d.setAuthTag(tag);
let gz; try { gz = Buffer.concat([d.update(body), d.final()]); } catch { console.error('Неправильний ключ або пошкоджений файл'); process.exit(1); }
const text = zlib.gunzipSync(gz).toString('utf8');
const data = JSON.parse(text);
fs.writeFileSync(out || file.replace(/\.meb$/, '') + '.json', text);
console.log(`Копія від ${data.at}:`);
for (const [t, rows] of Object.entries(data.tables)) console.log(`  ${t}: ${rows.length}`);
