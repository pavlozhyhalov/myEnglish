// Service worker: кеш оболонки й контенту. AI і Supabase — завжди мережа.
const BUILD = '202610252128';
const CACHE = `myenglish-${BUILD}`;
importScripts(`precache-list.js?v=${BUILD}`);

self.addEventListener('install', (e) => {
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

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase, Gemini — мимо кешу
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await c.match('./index.html')) || (await c.match('./'));
      throw err;
    }
  })());
});
