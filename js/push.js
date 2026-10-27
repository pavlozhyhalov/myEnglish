// Нагадування Web Push: підписка PushManager цього пристрою + рядок у push_subscriptions (Supabase, лише свої рядки).
// Час і види нагадувань — у налаштуваннях (settings.reminders, синхронізуються); чи ввімкнено на пристрої — наявність підписки.
// Дозвіл на сповіщення запитується лише після натискання користувача (enable()).
import { FUNCTIONS_URL } from './config.js';
import { getSupa, user } from './supa.js';
import * as store from './store.js';

export const REMINDER_DEFAULTS = { time: '19:00', cards: true, streak: true };

export function reminderPrefs() {
  const r = store.settings().reminders || {};
  return {
    time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : REMINDER_DEFAULTS.time,
    cards: r.cards !== false,
    streak: r.streak !== false,
  };
}
export function setReminderPrefs(patch) {
  store.setSetting('reminders', { ...reminderPrefs(), ...patch });
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function iosVersion() {
  const m = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent) || /Version\/(\d+)\.(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) + Number(m[2]) / 100 : 0;
}
// Публічний ключ VAPID видає функція push (ключі вона створює сама); кеш — на випадок збою мережі
const KEY_CACHE = 'me:vapid';
async function vapidKey() {
  try {
    const r = await fetch(`${FUNCTIONS_URL}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'vapid' }) });
    const k = r.ok ? (await r.json()).publicKey : null;
    if (/^[A-Za-z0-9_-]{80,}$/.test(k || '')) { try { localStorage.setItem(KEY_CACHE, k); } catch { /* */ } return k; }
  } catch { /* офлайн */ }
  let k = null; try { k = localStorage.getItem(KEY_CACHE); } catch { /* */ }
  if (k) return k;
  throw Object.assign(new Error('no-key'), { code: 'no-key' });
}

/**
 * Чи можна ввімкнути нагадування на цьому пристрої:
 * ok | ios-install (iPhone: спершу додати на екран «Додому») | ios-old | unsupported | denied | no-key
 */
export function pushSupport() {
  if (isIOS() && !isStandalone()) return iosVersion() && iosVersion() < 16.04 ? 'ios-old' : 'ios-install';
  if (isIOS() && iosVersion() && iosVersion() < 16.04) return 'ios-old';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !window.isSecureContext) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const sameKey = (buf, bytes) => {
  if (!buf) return true;   // браузер не повідомляє ключ — вважаємо, що той самий
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((x, i) => x === bytes[i]);
};

async function registration() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Service worker не готовий'), { code: 'no_sw' })), 8000)),
  ]);
  return reg;
}

/** Поточна підписка цього пристрою (або null) */
export async function currentSubscription() {
  if (pushSupport() !== 'ok' && pushSupport() !== 'denied') return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** Чи ввімкнено нагадування на цьому пристрої (є підписка й дозвіл) */
export async function remindersOn() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  return !!(await currentSubscription());
}

function row(sub, uid) {
  const j = sub.toJSON();
  const p = reminderPrefs();
  let tz = 'Europe/Kyiv';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch { /* лишаємо типовий */ }
  return {
    user_id: uid, endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth },
    tz, remind_at: p.time, kinds: { cards: p.cards, streak: p.streak }, enabled: true,
  };
}

async function save(sub) {
  const uid = user()?.id;
  if (!uid) throw Object.assign(new Error('need_login'), { code: 'need_login' });
  const c = await getSupa();
  const { error } = await c.from('push_subscriptions').upsert(row(sub, uid), { onConflict: 'endpoint', defaultToNull: false });
  if (error) throw Object.assign(new Error(error.message), { code: error.code || 'db' });
}

/** Увімкнути: дозвіл (лише по натисканню) → підписка → збереження на сервері */
export async function enable() {
  const st = pushSupport();
  if (st !== 'ok') throw Object.assign(new Error(st), { code: st });
  if (!user()) throw Object.assign(new Error('need_login'), { code: 'need_login' });
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw Object.assign(new Error('denied'), { code: perm === 'denied' ? 'denied' : 'dismissed' });
  const reg = await registration();
  const key = b64uToBytes(await vapidKey());
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await save(sub);
  } catch (e) {
    // кінцева точка записана за іншим акаунтом (вхід під іншим користувачем на цьому пристрої) — нова підписка
    if (e.code !== '42501') throw e;
    await sub.unsubscribe().catch(() => {});
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await save(sub);
  }
  return true;
}

/** Вимкнути на цьому пристрої: прибрати рядок на сервері й скасувати підписку */
export async function disable() {
  const sub = await currentSubscription();
  if (!sub) return;
  if (user()) {
    try {
      const c = await getSupa();
      await c.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    } catch (e) { console.warn('push delete', e); }
  }
  await sub.unsubscribe().catch(() => {});
}

/** Після виходу з акаунта: скасувати підписку пристрою локально (рядок на сервері вже не видалити — RLS;
 *  функція push отримає 410 і прибере його сама). Інакше нагадування попереднього акаунта приходили б далі. */
export async function forgetDevice() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
}

/** Оновити час/види на сервері, якщо пристрій підписаний */
export async function syncPrefs() {
  const sub = await currentSubscription();
  if (!sub || !user()) return false;
  await save(sub);
  return true;
}

/** Зрозумілий текст помилки */
export function pushErrorText(e) {
  const code = e?.code || e?.message;
  return ({
    need_login: 'Нагадування надсилає сервер — спершу увійдіть в акаунт.',
    denied: 'Сповіщення заборонено в налаштуваннях браузера. Дозвольте їх для цього сайту й спробуйте ще раз.',
    dismissed: 'Дозвіл не надано. Натисніть ще раз і оберіть «Дозволити».',
    'ios-install': 'На iPhone нагадування працюють лише в застосунку, доданому на екран «Додому».',
    'ios-old': 'Потрібна iOS 16.4 або новіша.',
    unsupported: 'Цей браузер не підтримує push-сповіщення.',
    'no-key': 'Нагадування ще не налаштовано на сервері.',
    no_sw: 'Застосунок ще завантажується. Спробуйте за кілька секунд.',
  })[code] || 'Не вдалося ввімкнути нагадування. Спробуйте ще раз.';
}
