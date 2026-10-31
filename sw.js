// Service worker: офлайн-кеш оболонки й контенту. AI і Supabase — завжди мережа.
const BUILD = '20261031110147';
const CACHE = `myenglish-${BUILD}`;
importScripts(`precache-list.js?v=${BUILD}`);

// self.PRECACHE: { './шлях': 'хеш вмісту' } (scripts/bump.sh). Старий формат — масив шляхів без хешів.
const LIST = Array.isArray(self.PRECACHE) ? Object.fromEntries(self.PRECACHE.map(u => [u, ''])) : (self.PRECACHE || {});
const HASH = 'x-me-hash';          // заголовок кешованої відповіді: хеш вмісту, з яким її збережено
const NAV_TIMEOUT = 3000;          // повільна мережа «онлайн» не тримає холодний старт: далі — index.html з кешу
// оболонка: без цих файлів застосунок не запуститься — встановлення без них не завершується (лишається стара версія)
const critical = (u) => u === './' || u === './index.html' || /^\.\/(js|css|vendor)\//.test(u);
// не потрібні для оболонки: шрифти для рідкісних символів (unicode-range) — кешуються під час першого використання
const lazy = (u) => /^\.\/fonts\/.*(latin-ext|greek)/.test(u);
const keyOf = (url) => { const p = new URL(url, self.registration.scope); return './' + p.pathname.slice(new URL(self.registration.scope).pathname.length); };

async function sha12(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Відповідь із позначкою хешу фактичного вмісту */
async function stamped(res) {
  const buf = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  headers.set(HASH, await sha12(buf));
  return new Response(buf, { status: res.status, statusText: res.statusText, headers });
}
async function download(u, mode) {
  const res = await fetch(new Request(u, { cache: mode }));
  if (!res.ok || res.type !== 'basic') throw new Error(`${u}: ${res.status}`);
  return stamped(res);
}
/** Наші кеші: поточний першим, далі старіші версії (новіші першими) */
async function ourCaches() {
  const keys = (await caches.keys()).filter(k => k.startsWith('myenglish-'));
  return [CACHE, ...keys.filter(k => k !== CACHE).reverse()];
}
async function matchOurs(req, opts) {
  for (const k of await ourCaches()) {
    const hit = await (await caches.open(k)).match(req, opts);
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener('install', (e) => {
  // нова версія активується одразу, не чекаючи закриття всіх вкладок
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const olds = await Promise.all((await ourCaches()).slice(1).map(k => caches.open(k)));
    const fromOld = async (u, hash) => {
      for (const o of olds) { const r = await o.match(u); if (r && (hash == null || r.headers.get(HASH) === hash)) return r; }
      return null;
    };
    const stats = { copied: 0, fetched: 0, lazy: 0, stale: 0 };
    const one = async (u, hash) => {
      // уже є (повторне встановлення тієї ж збірки) або незмінений файл зі старого кешу — без мережі
      const have = await c.match(u);
      if (have && hash && have.headers.get(HASH) === hash) return;
      const old = hash ? await fromOld(u, hash) : null;
      if (old) { await c.put(u, old); stats.copied++; return; }
      if (lazy(u)) { stats.lazy++; return; }
      try {
        // no-cache: умовний запит (304, якщо HTTP-кеш актуальний); вміст не той, що у списку (CDN ще не оновився) — ще раз повз HTTP-кеш
        let res = await download(u, 'no-cache').catch(() => download(u, 'reload'));
        if (hash && res.headers.get(HASH) !== hash) res = await download(u, 'reload').catch(() => res);
        await c.put(u, res); stats.fetched++;
      } catch (err) {
        if (critical(u)) throw err;
        // необов'язковий файл: лишаємо попередню версію (з іншим хешем — наступне оновлення спробує знову)
        const stale = await fromOld(u, null);
        if (stale) { await c.put(u, stale); stats.stale++; }
      }
    };
    // невеликими партіями: не забиваємо повільний канал сотнею паралельних запитів
    const queue = Object.entries(LIST);
    const worker = async () => { while (queue.length) { const [u, hash] = queue.shift(); await one(u, hash); } };
    await Promise.all(Array.from({ length: 6 }, worker));
    console.info('sw install', BUILD, stats);
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('myenglish-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const shell = async () => (await matchOurs('./index.html')) || (await matchOurs('./'));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase, Gemini — мимо кешу
  e.respondWith((async () => {
    // сторінка (index.html) — спершу мережа, щоб одразу бачити нову збірку; офлайн або мережа повільніша за 3 с — з кешу
    if (req.mode === 'navigate') {
      const net = fetch(req, { cache: 'no-store' }).then(async (res) => {
        // з хешем фактичного вмісту: встановлення SW не качатиме index.html вдруге, якщо він той самий
        if (res.ok && res.type === 'basic') e.waitUntil(stamped(res.clone()).then(async r => (await caches.open(CACHE)).put('./index.html', r)).catch(() => {}));
        return res;
      });
      net.catch(() => {});
      let timer;
      const slow = new Promise(r => { timer = setTimeout(r, NAV_TIMEOUT); }).then(async () => (await shell()) || net);
      try { return await Promise.race([net, slow]); }
      catch { return (await shell()) || Response.error(); }
      finally { clearTimeout(timer); }
    }
    // решта — з кешу (поточна збірка, інакше попередні), інакше з мережі
    const hit = await matchOurs(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    const k = keyOf(req.url);
    if (res.ok && res.type === 'basic') {
      // файли зі списку (зокрема «ліниві» шрифти) — з хешем, щоб наступна збірка взяла їх зі старого кешу
      const put = (k in LIST ? stamped(res.clone()) : Promise.resolve(res.clone())).then(async r => (await caches.open(CACHE)).put(k in LIST ? k : req, r));
      e.waitUntil(put.catch(() => {}));
    }
    return res;
  })());
});

// ---------- Web Push: нагадування (функція push, міграція 0011) ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const url = typeof d.url === 'string' && d.url.startsWith('#/') ? d.url : '#/';
  e.waitUntil(self.registration.showNotification(d.title || 'myEnglish', {
    body: d.body || '',
    tag: d.tag || 'myenglish-reminder',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    lang: 'uk',
    data: { url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = e.notification.data?.url || '#/';
  const target = new URL(hash, self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope));
    if (win) {
      // відкритий застосунок: переходимо за адресою (лише зміна #) і показуємо вікно
      const c = await win.navigate(target).catch(() => null);
      return (c || win).focus();
    }
    return self.clients.openWindow(target);
  })());
});
