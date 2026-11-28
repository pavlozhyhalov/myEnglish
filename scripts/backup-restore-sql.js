// SQL для відновлення з розшифрованої копії (scripts/backup-decrypt.js → .json):
//   node scripts/backup-restore-sql.js <копія.json> [--user <uuid>] [--table public.cards,public.mistakes] > restore.sql
// --user — лише рядки однієї людини (user_id; у auth.users — id): повернути випадково втрачене одному учню.
// Вставка «on conflict do nothing» — наявні рядки не перезаписуються; виконувати в SQL Editor Supabase (роль postgres). Порядок — docs/backup.md.
const fs = require('fs');
const args = process.argv.slice(2);
const file = args[0];
const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const uid = opt('--user');
const only = (opt('--table') || '').split(',').filter(Boolean);
if (!file) { console.error('node scripts/backup-restore-sql.js <копія.json> [--user <uuid>] [--table a,b]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// спершу акаунти й профілі, далі решта за абеткою (зовнішні ключі здебільшого на auth.users)
const first = ['auth.users', 'auth.identities', 'public.profiles', 'public.decks', 'public.chat_rooms', 'public.chat_members', 'public.chat_messages'];
// перелік файлів і службові таблиці (ключі, паузи моделей, перевірки) — не відновлюються, створюються самі
const skip = new Set(['storage.objects', 'public.app_keys', 'public.health_checks']);
const names = Object.keys(data.tables).filter(t => !skip.has(t) && (!only.length || only.includes(t)));
// генеровані колонки (обчислює сама база) — не вставляються; id з identity ALWAYS — через overriding system value
const GENERATED = { 'auth.users': ['confirmed_at'], 'auth.identities': ['email'] };
const rank = (t) => (first.indexOf(t) + 1) || 99;
names.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));
const out = [`-- myEnglish: відновлення з копії від ${data.at}${uid ? ` · лише користувач ${uid}` : ''}`, 'begin;',
  // без тригерів перевірок (ліміти повідомлень, sync_guard тощо) і перевірок зовнішніх ключів — лише на час цієї транзакції
  'set local session_replication_role = replica;'];
for (const t of names) {
  let rows = data.tables[t];
  if (uid) rows = rows.filter(r => (t === 'auth.users' ? r.id : r.user_id) === uid);
  if (!rows.length) continue;
  const [schema, table] = t.split('.');
  const q = `"${schema}"."${table}"`;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = JSON.stringify(rows.slice(i, i + 500)).split('$meb$').join('$ meb$');
    const cols = Object.keys(rows[0]).filter(c => !(GENERATED[t] || []).includes(c)).map(c => `"${c}"`).join(', ');
    out.push(`insert into ${q} (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::${q}, $meb$${chunk}$meb$::jsonb) on conflict do nothing;`);
  }
  out.push(`-- ${t}: ${rows.length}`);
}
out.push('commit;');
process.stdout.write(out.join('\n') + '\n');
