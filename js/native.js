// Нативна оболонка iOS (Capacitor, native/) — 2026-11-26, підготовка до App Store.
// Сайт і застосунок — один код; у застосунку: файли сайту лежать у пакеті, записи озвучення (audio/*.m4a, ~140 МБ) — з сайту,
// Service Worker і Web Push не працюють (WKWebView), службові сторінки сховано.
export const isNative = () => !!(globalThis.Capacitor?.isNativePlatform?.());
export const platform = () => globalThis.Capacitor?.getPlatform?.() || 'web';
// звідки брати великі файли, яких немає в пакеті застосунку
export const SITE = 'https://pavlozhyhalov.github.io/myEnglish/';
export const remote = (path) => (isNative() ? SITE + path : path);

// Плагіни Capacitor — через глобальний міст (без окремих JS-пакетів у сайті): у браузері їх немає, виклики тихо нічого не роблять
const plugin = (name) => (isNative() ? globalThis.Capacitor?.Plugins?.[name] : null);

/** Тактильний відгук на відповідь (App Store 4.2 — нативна поведінка): правильно — легкий успіх, помилка — подвійний сигнал */
export function haptic(kind = 'ok') {
  const H = plugin('Haptics');
  if (!H) return;
  try {
    if (kind === 'ok') H.notification({ type: 'SUCCESS' });
    else if (kind === 'bad') H.notification({ type: 'ERROR' });
    else H.impact({ style: 'LIGHT' });
  } catch { /* плагіна немає в цій збірці */ }
}

/** Старт у застосунку: дотик по локальному нагадуванню відкриває його сторінку (extra.url, лише «#/…») */
export function initNative() {
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  try {
    plugin('LocalNotifications')?.addListener('localNotificationActionPerformed', (e) => {
      const url = e?.notification?.extra?.url;
      if (typeof url === 'string' && url.startsWith('#/')) location.hash = url.slice(1);
    });
  } catch { /* плагіна немає */ }
}

/** Адреса сайту для посилань назовні (запрошення, листи відновлення пароля): у застосунку location — capacitor://localhost */
export const siteBase = () => (isNative() ? SITE : `${location.origin}${location.pathname}`);
