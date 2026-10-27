// Журнал помилок клієнта: window.onerror і unhandledrejection.
// Без персональних даних (email, токени, ключі, довгі ідентифікатори вирізаються), не більше 20 за сесію, з дедуплікацією.
// Черга — у localStorage; на сервер (таблиця client_errors) — лише після входу. Анонімні помилки лишаються на пристрої
// і відправляються, коли користувач увійде (записи, старші за 7 днів, відкидаються).
import { BUILD } from './config.js';
import { user, onClient, onAuth } from './supa.js';

const KEY = 'me:errlog';
const MAX_SESSION = 20, MAX_QUEUE = 50, MAX_AGE = 7 * 864e5;
const seen = new Set();
let count = 0, client = null, flushing = false, timer = null;

/** Прибрати персональні дані й секрети з рядка */
export function scrub(s, max = 1000) {
  return String(s ?? '')
    .replace(/[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[jwt]')
    // API-ключі (Gemini тощо) — це довгі рядки з цифрами: їх прибирає правило [token] нижче
    .replace(/\bsb_(?:publishable|secret)_[\w-]+/g, '[key]')
    .replace(/([?&#](?:access_token|refresh_token|token|code|key|apikey|password)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(Bearer)\s+[\w.-]+/gi, '$1 [redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .slice(0, max);
}

/** Коротко: браузер і ОС (без повного рядка User-Agent) */
export function shortUA(ua = navigator.userAgent) {
  const b = /Edg\/(\d+)/.exec(ua) ? 'Edge ' + RegExp.$1
    : /OPR\/(\d+)/.exec(ua) ? 'Opera ' + RegExp.$1
    : /Firefox\/(\d+)/.exec(ua) ? 'Firefox ' + RegExp.$1
    : /(?:Chrome|CriOS)\/(\d+)/.exec(ua) ? 'Chrome ' + RegExp.$1
    : /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua) ? 'Safari ' + RegExp.$1
    : 'other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? ' PWA' : '';
  return `${b} · ${os}${standalone}`;
}

/** Поточний маршрут без параметрів запиту */
const route = () => scrub((location.hash || '#/').split('?')[0], 200);

function load() {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(q) ? q.filter(e => e && Date.now() - e.t < MAX_AGE) : [];
  } catch { return []; }
}
function save(q) { try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* сховище недоступне */ } }

/** Записати помилку (також для ручного виклику з try/catch) */
export function report(err, extra = '') {
  try {
    if (count >= MAX_SESSION) return;
    const message = scrub((extra ? extra + ': ' : '') + (err?.message || err?.reason || String(err ?? 'unknown')), 500);
    const stack = scrub(String(err?.stack || '').split(location.origin).join('').split('\n').slice(0, 6).map(l => l.trim()).join('\n'), 1500);
    if (/ResizeObserver loop|^Script error\.?$/i.test(message)) return;
    if (/chrome-extension:|moz-extension:|safari-web-extension:/.test(stack)) return;
    const sig = message + '|' + (stack.split('\n').find(l => l.startsWith('at ') || l.includes('@')) || '');
    if (seen.has(sig)) return;
    seen.add(sig); count++;
    const q = load();
    q.push({ t: Date.now(), build: BUILD, route: route(), message, stack, ua: shortUA() });
    save(q);
    schedule();
  } catch { /* журнал помилок ніколи не кидає сам */ }
}

function schedule(ms = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => { flush().catch(() => {}); }, ms);
}

/** Відправити чергу (лише після входу і коли клієнт Supabase уже завантажено — заради журналу його не вантажимо) */
export async function flush() {
  if (flushing || !client || !user() || !navigator.onLine) return false;
  const q = load();
  if (!q.length) return true;
  flushing = true;
  try {
    const batch = q.slice(0, 20);
    const { error } = await client.from('client_errors').insert(batch.map(e => ({
      build: String(e.build || '').slice(0, 40), route: String(e.route || '').slice(0, 200),
      message: String(e.message || '').slice(0, 1000), stack: String(e.stack || '').slice(0, 4000),
      ua: String(e.ua || '').slice(0, 120),
    })));
    if (error) return false;
    const sent = new Set(batch.map(e => e.t + e.message));
    save(load().filter(e => !sent.has(e.t + e.message)));
    if (q.length > batch.length) schedule(1000);
    return true;
  } finally { flushing = false; }
}

export function initErrlog() {
  window.addEventListener('error', (e) => {
    // помилки завантаження ресурсів (img/script) не мають error — пропускаємо, щоб не шуміти
    if (!e.error && !e.message) return;
    report(e.error || { message: e.message, stack: `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r instanceof Error) return report(r);
    let text;
    try { text = typeof r === 'string' ? r : (r?.message || JSON.stringify(r)?.slice(0, 300)); } catch { text = Object.prototype.toString.call(r); }   // циклічний об'єкт
    report({ message: 'Unhandled rejection: ' + text });
  });
  onClient((c) => { client = c; schedule(5000); });
  onAuth((s) => { if (s) schedule(5000); });
  window.addEventListener('online', () => schedule(5000));
}
