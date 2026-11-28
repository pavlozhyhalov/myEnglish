# myEnglish

Персональний застосунок (PWA) для вивчення англійської: AI-вчитель на Gemini (текст і голос),
інтервальне повторення карток (FSRS), граматика від Pre-A1 до C1, аудіювання, читання й книги, вимова,
письмо, рольові сценарії, ігри, чати з друзями й групи, тести й прогрес. Сім мов інтерфейсу.

- Фронтенд: статичний HTML/CSS/JS без збірки, GitHub Pages.
- Бекенд: Supabase (Auth, Postgres + RLS, Edge Functions), Gemini API.
- ТЗ — [`SPEC.md`](SPEC.md), правила для розробника — [`CLAUDE.md`](CLAUDE.md).

## ⚠️ Головне правило: усі мови — завжди

Інтерфейс і зміст — 7 мовами: українська (база в коді), English, Español, Português, Türkçe, Polski, Русский.
**Будь-який новий чи змінений текст на сайті** (кнопка, підпис, повідомлення, урок, вправа, колода, push-текст) —
одразу перекладається на всі мови в тому ж коміті:

```bash
node scripts/i18n-extract.js && node scripts/check-i18n.js   # показує прогалини по кожній мові
node scripts/l10n-pages-check.js <lang>                       # сторінки мовою <lang>
```

Переклади — `i18n/<lang>.json`, `i18n/<lang>.patterns.json`, зміст — `data/l10n/<lang>/`; правила й брифи —
`scripts/i18n-guide.md`, `scripts/i18n-*-brief.txt`, англійська — `i18n/en.glossary.md`. Тексти сервера
(вчитель, push, домашнє) — теж для всіх мов (`supabase/functions/_shared/prompts.ts`, `push/i18n.ts`).
Дати — `loc()` з `js/i18n.js`. GitHub Actions «Checks» на кожен push червоніє, якщо якась мова має прогалини.

## Запуск локально

```bash
python3 -m http.server 8080
# відкрити http://localhost:8080
```

## Налаштування (один раз)

1. **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
2. **Gemini API key:** отримати на https://aistudio.google.com/apikey і додати в Supabase →
   Project `myEnglish` → Edge Functions → Secrets → `GEMINI_API_KEY`.
3. **Акаунт:** реєстрація відкрита (≤ 10 нових акаунтів на добу); `ALLOWED_USERS` — адміністратори.
   Supabase → Authentication → URL Configuration: Site URL — адреса GitHub Pages.
4. Листи відновлення пароля для всіх — власний SMTP у Supabase (вбудована пошта шле лише команді проєкту).

## Версія збірки

Після будь-якої зміни фронтенду: `scripts/bump.sh` — оновлює `BUILD` у `js/config.js`,
`sw.js`, `index.html` і перелік файлів для офлайн-кешу.

## Ліцензії сторонніх ресурсів

Шрифти Unbounded, Onest, Noto Sans — SIL OFL. Іконки Phosphor — MIT. ts-fsrs — MIT. supabase-js — MIT. jsPDF — MIT. Days One — OFL. Голоси Kokoro — Apache-2.0.
Книги й оповідання — суспільне надбання (Standard Ebooks, CC0). Повний перелік — у застосунку: «Про застосунок» → «Ліцензії».
