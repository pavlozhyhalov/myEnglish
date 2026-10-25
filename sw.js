// Service worker: офлайн-кеш оболонки й контенту. AI і Supabase — завжди мережа.
const BUILD = '202610252252';
const CACHE = `myenglish-${BUILD}`;
importScripts(`precache-list.js?v=${BUILD}`);

self.addEventListener('install', (e) => {
  // нова версія активується одразу, не чекаючи закриття всіх вкладок
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // по одному, щоб одна помилка не зламала все встановлення
    await Promise.all((self.PRECACHE || []).map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('myenglish-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase, Gemini — мимо кешу
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // сторінка (index.html) — спершу мережа, щоб одразу бачити нову збірку; офлайн — з кешу
    if (req.mode === 'navigate') {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) c.put('./index.html', res.clone());
        return res;
      } catch {
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    }
    // решта — з кешу поточної збірки, інакше з мережі
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  })());
});
