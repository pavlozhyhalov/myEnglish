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

/**
 * Зареєструвати прибирання для сторінки, яка ще рендериться (напр. голосова сесія чекає тапу).
 * view — контейнер сторінки; якщо користувач уже пішов (контейнер від'єднано), fn виконується одразу.
 */
export function onLeave(view, fn) {
  if (!view?.isConnected) { try { fn(); } catch (e) { console.error(e); } return; }
  const host = view.closest('[data-page]') || view;
  (host.__leave ||= []).push(fn);
}
function leave(host) {
  for (const fn of host?.__leave || []) { try { fn(); } catch (e) { console.error(e); } }
  if (host) host.__leave = [];
}

// Позиція прокрутки списків: «назад» повертає туди, де користувач був
// Кожен запис історії отримує номер (час створення): менший номер при переході = «назад»
const scrollPos = new Map();
let lastHash = location.hash, curIdx = 0;

let renderSeq = 0;
export async function render() {
  navCount++;
  const r = parse();
  const seq = ++renderSeq;
  scrollPos.set(lastHash, window.scrollY);
  lastHash = location.hash;
  let idx = history.state?.idx;
  // номер = час створення запису: працює й після перезавантаження сторінки
  if (idx == null) { idx = Date.now(); try { history.replaceState({ idx }, ''); } catch { /* */ } }
  const isBack = idx < curIdx;
  curIdx = idx;
  const restoreY = isBack ? scrollPos.get(location.hash) || 0 : 0;
  if (current?.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  leave(current?.host);
  current = null;
  const loader = routes.get(r.name);
  const view = document.getElementById('view');
  // кожна сторінка рендериться у власний контейнер: запізнілий async-рендер попередньої сторінки
  // пише у від'єднаний вузол і не перекриває нову сторінку
  const host = document.createElement('div');
  host.dataset.page = r.name;
  if (!loader) { view.replaceChildren(host); notFound?.(host, r); return; }
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;            // користувач вже пішов далі
    view.replaceChildren(host);
    current = { name: r.name, cleanup: null, host };
    view.className = '';
    void view.offsetWidth;
    view.className = 'page-enter';
    window.scrollTo(0, 0);
    listeners.forEach(fn => fn(r));
    const cleanup = await mod.default(host, r);
    if (seq !== renderSeq) { try { cleanup?.(); } catch (e) { console.error(e); } return; }
    current.cleanup = cleanup;
    if (restoreY) requestAnimationFrame(() => window.scrollTo(0, restoreY));
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) host.textContent = 'Помилка завантаження сторінки: ' + e.message;
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
