# myEnglish — інструкції для Claude Code

Персональна PWA для вивчення англійської. Повне ТЗ — `SPEC.md`. Якщо вимога ТЗ
суперечить твоїй ідеї — спершу перепитай власника (Павло), не змінюй мовчки.
Рішення, ухвалені власником, — у розділі «Рішення» нижче; нова сесія їх не переглядає.

## Стек і правила
- Статика без build-кроку: HTML + CSS + vanilla JS (ES modules). Хостинг — GitHub Pages (`main`, `.nojekyll`).
- Сторонні бібліотеки лише вендорені в `/vendor` (`supabase.js`, `ts-fsrs.js` — ESM-збірки esbuild). Без CDN у рантаймі.
- Бекенд — окремий Supabase-проєкт **myEnglish** (`uxqdklwnxdtyifksphoz`, eu-central-1). Не Resonance.
- Gemini API key — лише в секретах Supabase (`GEMINI_API_KEY`). Перед комітом: `git grep -nE "AIza|sk-|service_role"` має бути порожнім.
- Усі рядки інтерфейсу — українською; спільні — у `js/strings.js`.
- AI-відповіді в DOM — лише через `textContent` або `js/ui/md.js` (без innerHTML сирого тексту).
- **Будь-яка зміна фронтенду → `scripts/bump.sh`** (піднімає BUILD у `js/config.js`, `sw.js`, `?v=` в `index.html`, оновлює `precache-list.js`).

## Структура
- `js/app.js` — старт, шапка, маршрути, синхронізація, SW. `js/router.js` — hash-роутер.
- `js/store.js` — локальний стан (IndexedDB) + синхронізація з Supabase (LWW за `updated_at`, черга `dirty`).
- `js/srs.js` — FSRS (ts-fsrs) і черга карток. Стартові картки з `data/decks/*.json` потрапляють у БД лише після першого показу (id = `deck:slug(en)`).
- `js/stats.js` — сесії, стрік, XP, помилки, прогрес уроків.
- `js/ai.js` — виклики edge-функцій; `js/speech.js` — TTS/розпізнавання; `js/live/*` — Gemini Live (WebSocket + AudioWorklet) і режим «рація».
- `js/ui/*` — компоненти (drawer, quickbar, sheet, toast, exercises, md, icons). `js/pages/*` — по файлу на розділ.
- `supabase/migrations/*` — SQL; `supabase/functions/{tutor,live-token,tts,_shared}` — edge-функції (Deno).
- Контент: `data/decks`, `data/grammar` (34 уроки), `data/scenarios.json`, `writing.json`, `listening.json`, `pronunciation.json`, `placement.json`.

## Деплой
- Фронтенд: push у `main` → GitHub Pages.
- Edge-функції: деплой через Supabase MCP (`deploy_edge_function`) з файлами `<fn>/index.ts` + `_shared/*.ts`.
- Міграції: `apply_migration`, файли зберігати в `supabase/migrations`.
- Секрети функцій: `GEMINI_API_KEY` (обов'язково), `ALLOWED_USERS` (uuid або email через кому), опційно `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_LIVE_MODEL`, `LIMIT_*`.

## Рішення
- **2026-10-25 · Фокус курсу — загальна англійська для спілкування скрізь** (поправка власника до ТЗ §1, §6.3, §9).
  Робоча/виробнича тематика — лише окрема категорія за вибором:
  - колоди групи «Робота» (CNC, CAD, якість, Lean, ділове листування) вимкнені за замовчуванням (`default: false` в `data/decks/index.json`);
  - вчитель за замовчуванням говорить на загальні теми; професійний контекст вмикається налаштуванням «Професійний контекст» (`settings.workFocus`);
  - граматика, сценарії, письмо, аудіювання — побутові контексти; робочі сценарії/завдання — окрема група.
- 2026-10-25 · Локальний кеш — IndexedDB (key-value по таблицях), без окремої черги в IndexedDB: черга брудних записів зберігається там само.
- 2026-10-25 · Застосунок працює і без входу (локальний режим); AI і синхронізація — після входу.
- 2026-10-25 · Одна FSRS-картка на слово; напрямок показу (EN→UK, UK→EN, аудіо, cloze) чергується за кількістю повторів.
- Відкрите: рішення по голосу після Фази 0 (Gemini Live / «рація» / інший провайдер) — власник фіксує в `#/lab/live`, переноситься сюди.
