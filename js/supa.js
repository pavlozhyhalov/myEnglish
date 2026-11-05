// Supabase-клієнт завантажується ліниво (vendor/supabase.js ≈ 222 КБ): лише коли є збережена сесія,
// на сторінці входу, у посиланні з токеном (підтвердження пошти) або коли потрібні вхід, AI чи синхронізація.
// user() синхронний: до завантаження клієнта сесію читаємо з localStorage (той самий storageKey), потім клієнт її підтверджує.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const STORAGE_KEY = 'me-auth';

/** Живе посилання: null, доки клієнт не завантажено */
export let supa = null;

let session = readStored();
// Перехід за посиланням «скинути пароль» з листа: позначка в адресі (?recovery=1) або type=recovery у токені.
// Запам'ятовуємо до завантаження клієнта (він прибирає токен з адреси) — сторінка входу покаже форму нового пароля.
const RECOVERY_KEY = 'me:recovery';
try {
  if (/[?&]recovery=1/.test(location.search) || /[#&]type=recovery/.test(location.hash)) sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
} catch { /* приватний режим */ }
/** Чи відкрито застосунок за посиланням відновлення пароля (дійсне 1 год) */
export function recoveryPending() {
  try { const t = Number(sessionStorage.getItem(RECOVERY_KEY) || 0); return !!t && Date.now() - t < 3600e3; } catch { return false; }
}
export function clearRecovery() {
  try { sessionStorage.removeItem(RECOVERY_KEY); } catch { /* */ }
  if (/[?&]recovery=1/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
}
let clientP = null;
const listeners = new Set();
const clientListeners = new Set();

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // формат supabase-js v2: { access_token, refresh_token, expires_at, user, ... }
    return s && s.user && s.user.id && s.access_token ? s : null;
  } catch { return null; }
}
const urlHasAuth = () => /(^|[#&?])(access_token|error_description)=/.test(location.hash) || /[?&](code|recovery)=/.test(location.search);
const onAuthPage = () => location.hash.startsWith('#/auth');

function setSession(s) {
  const changed = (s?.user?.id || null) !== (session?.user?.id || null);
  session = s || null;
  if (changed) listeners.forEach(fn => { try { fn(session); } catch (e) { console.warn(e); } });
}

export function currentSession() { return session; }
export function user() { return session?.user || null; }
export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Виклик, коли клієнт готовий (одразу, якщо вже завантажено) */
export function onClient(fn) { clientListeners.add(fn); if (supa) fn(supa); return () => clientListeners.delete(fn); }
export function clientLoaded() { return !!supa; }

/** Завантажити й ініціалізувати клієнт (один раз; після збою — повторна спроба при наступному виклику) */
export function getSupa() {
  if (clientP) return clientP;
  clientP = (async () => {
    const { createClient } = await import('../vendor/supabase.js');
    const c = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: STORAGE_KEY },
    });
    supa = c;
    clientListeners.forEach(fn => { try { fn(c); } catch (e) { console.warn(e); } });
    const { data, error } = await c.auth.getSession();
    // мережева помилка оновлення токена (офлайн) — сесія лишається в сховищі: тримаємо її з кешу, клієнт оновить її пізніше;
    // відкликаний токен клієнт зі сховища прибирає — тоді це справжній вихід
    if (!error || !readStored()) setSession(data.session);
    c.auth.onAuthStateChange((ev, s) => {
      if (ev === 'PASSWORD_RECOVERY') { try { sessionStorage.setItem(RECOVERY_KEY, String(Date.now())); } catch { /* */ } }
      // INITIAL_SESSION приходить з null і при мережевій помилці — не «виходимо», поки сесія є в сховищі
      if (ev === 'INITIAL_SESSION' && !s && readStored()) return;
      setSession(s);
    });
    return c;
  })();
  // повторна спроба — лише якщо клієнт не створено (інакше вийшли б два GoTrueClient на одному сховищі)
  clientP.catch(() => { clientP = supa ? Promise.resolve(supa) : null; });
  return clientP;
}

const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 400));

/**
 * Старт авторизації. Не блокує першу сторінку: повертає сесію з кешу одразу.
 * Клієнт вантажиться відразу, якщо в адресі токен (вхід за посиланням) або відкрито #/auth,
 * у фоні — коли є збережена сесія; інакше — лише на вимогу (вхід, AI, синхронізація).
 */
export async function initAuth() {
  if (urlHasAuth() || onAuthPage()) await getSupa();
  else if (session) idle(() => getSupa().catch(e => console.warn('auth', e)));
  window.addEventListener('hashchange', () => { if (onAuthPage()) getSupa().catch(e => console.warn('auth', e)); });
  // вхід/вихід в іншій вкладці
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (supa) return;   // клієнт сам стежить за сховищем
    const s = readStored();
    if (s) getSupa().catch(() => setSession(s)); else setSession(null);
  });
  return session;
}

export async function signIn(email, password) {
  const c = await getSupa();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp(email, password) {
  const c = await getSupa();
  const { data, error } = await c.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return data;
}
/** Лист зі посиланням для зміни пароля (Supabase Auth). Посилання веде назад у застосунок з позначкою відновлення */
export async function resetPassword(email) {
  const c = await getSupa();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '?recovery=1' });
  if (error) throw error;
}
/** Новий пароль для поточного акаунта (після входу або переходу з листа) */
export async function updatePassword(password) {
  const c = await getSupa();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() {
  if (!session && !readStored() && !supa) return;
  const c = await getSupa();
  const { error } = await c.auth.signOut();
  // офлайн сервер недоступний — виходимо хоча б локально
  if (error) await c.auth.signOut({ scope: 'local' });
}

/** Токен доступу; без збереженої сесії клієнт не завантажується */
export async function accessToken() {
  if (!session && !readStored()) return null;
  const c = await getSupa();
  const { data } = await c.auth.getSession();
  return data.session?.access_token || null;
}
