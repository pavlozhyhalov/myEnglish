// Hash-роутер: #/cards, #/tutor?mode=voice, #/grammar/present-perfect
const routes = new Map();
let current = null;     // { name, cleanup }
let notFound = null;
const listeners = new Set();

export function route(name, loader) { routes.set(name, loader); }
export function fallback(fn) { notFound = fn; }
export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const name = parts[0] || 'home';
  return { name, parts: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs || '')), path: '/' + parts.join('/') };
}

export function go(path, { replace = false } = {}) {
  const h = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === h) { render(); return; }
  if (replace) { history.replaceState(null, '', h); render(); }
  else location.hash = h;
}

let navCount = 0;
export function back(fallbackPath = '/') {
  if (navCount > 1) history.back();
  else go(fallbackPath, { replace: true });
}

let renderSeq = 0;
export async function render() {
  navCount++;
  const r = parse();
  const seq = ++renderSeq;
  if (current?.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  current = null;
  const loader = routes.get(r.name);
  const view = document.getElementById('view');
  if (!loader) { notFound?.(view, r); return; }
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;            // користувач вже пішов далі
    view.className = '';
    void view.offsetWidth;
    view.className = 'page-enter';
    window.scrollTo(0, 0);
    listeners.forEach(fn => fn(r));
    const cleanup = await mod.default(view, r);
    if (seq !== renderSeq) { cleanup?.(); return; }
    current = { name: r.name, cleanup };
  } catch (e) {
    console.error(e);
    view.textContent = 'Помилка завантаження сторінки: ' + e.message;
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
