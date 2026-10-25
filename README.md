# myEnglish

Персональний застосунок (PWA) для вивчення англійської: AI-вчитель на Gemini (текст і голос),
інтервальне повторення карток (FSRS), курс граматики B1 → B2, аудіювання, вимова, письмо,
рольові сценарії, тести й прогрес.

- Фронтенд: статичний HTML/CSS/JS без збірки, GitHub Pages.
- Бекенд: Supabase (Auth, Postgres + RLS, Edge Functions), Gemini API.
- ТЗ — [`SPEC.md`](SPEC.md), правила для розробника — [`CLAUDE.md`](CLAUDE.md).

## Запуск локально

```bash
python3 -m http.server 8080
# відкрити http://localhost:8080
```

## Налаштування (один раз)

1. **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
2. **Gemini API key:** отримати на https://aistudio.google.com/apikey і додати в Supabase →
   Project `myEnglish` → Edge Functions → Secrets → `GEMINI_API_KEY`.
3. **Акаунт:** відкрити застосунок → «Увійти» → «Створити акаунт», підтвердити email.
   Доступ до AI мають лише адреси/ID з секрету `ALLOWED_USERS`.
4. Після створення акаунта вимкнути реєстрацію: Supabase → Authentication → Sign In / Providers →
   *Allow new users to sign up* → off. Там само в URL Configuration вказати Site URL —
   адресу GitHub Pages.

## Версія збірки

Після будь-якої зміни фронтенду: `scripts/bump.sh` — оновлює `BUILD` у `js/config.js`,
`sw.js`, `index.html` і перелік файлів для офлайн-кешу.

## Ліцензії сторонніх ресурсів

Шрифти Unbounded, Onest, Noto Sans — SIL OFL. Іконки Phosphor — MIT. Emoji Microsoft Fluent (Flat) — MIT.
ts-fsrs — MIT. supabase-js — MIT.
