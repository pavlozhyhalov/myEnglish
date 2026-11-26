// Нативна оболонка iOS (Capacitor, native/) — 2026-11-26, підготовка до App Store.
// Сайт і застосунок — один код; у застосунку: файли сайту лежать у пакеті, записи озвучення (audio/*.m4a, ~140 МБ) — з сайту,
// Service Worker і Web Push не працюють (WKWebView), службові сторінки сховано.
export const isNative = () => !!(globalThis.Capacitor?.isNativePlatform?.());
export const platform = () => globalThis.Capacitor?.getPlatform?.() || 'web';
// звідки брати великі файли, яких немає в пакеті застосунку
export const SITE = 'https://pavlozhyhalov.github.io/myEnglish/';
export const remote = (path) => (isNative() ? SITE + path : path);
