// Екран не гасне під час завдань (Screen Wake Lock API). Блокування знімається системою, коли вкладка
// ховається, тому при поверненні в застосунок запит повторюється. Браузери без API — просто без ефекту.
let lock = null, wanted = false;

async function acquire() {
  if (!wanted || lock || document.hidden || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    if (!wanted) release();   // поки чекали — користувач уже пішов зі сторінки завдань
  } catch { lock = null; }    // напр., режим енергозбереження — не критично
}
function release() { const l = lock; lock = null; l?.release().catch(() => {}); }

/** Увімкнути/вимкнути утримання екрана (викликає роутер для сторінок із завданнями) */
export function keepAwake(on) {
  wanted = !!on;
  if (wanted) acquire(); else release();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
