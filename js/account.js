// Акаунт: «Завантажити мої дані» (GDPR ст. 15/20) і «Видалити акаунт» (App Store 5.1.1(v), GDPR ст. 17) — 2026-11-26.
// Серверна частина — edge-функція `account` (supabase/functions/account): файли в бакетах + auth.users (таблиці — каскадом).
import { ai } from './ai.js';
import * as store from './store.js';
import { signOut } from './supa.js';

/** Файл JSON: усе з пристрою (синхронізоване) + мої повідомлення в чатах і звернення з сервера */
export async function exportMyData() {
  const local = store.exportJson();
  let server = null;
  try { server = await ai('account', 'export', {}, { noConsent: true }); } catch { /* офлайн — лише локальне */ }
  const out = { ...local, server };
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const name = `myenglish-data-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Видалити акаунт назавжди: сервер → вихід → очищення пристрою */
export async function deleteAccount() {
  await ai('account', 'delete', { confirm: 'DELETE' }, { noConsent: true });
  try { await signOut(); } catch { /* сесії вже немає */ }
  await store.wipeLocal();
}
