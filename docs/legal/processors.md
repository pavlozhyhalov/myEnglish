# Процесори й договори обробки (GDPR ст. 28)

Кожен сервіс, якому передаються персональні дані учнів, — «процесор». З кожним має бути договір обробки (DPA). У великих сервісів DPA — частина умов; його треба **прийняти в панелі** (⏳ — дія власника, раз).

| Процесор | Що обробляє | Де | DPA | Передача за межі ЄС | Дія |
|---|---|---|---|---|---|
| **Supabase Inc.** | база, файли, функції | AWS eu-central-1 (Франкфурт) | supabase.com/legal/dpa — підписується в Dashboard → Organization → Legal Documents (PandaDoc) | субпроцесори в США (DPF/SCC) | ⏳ підписати DPA |
| **Google LLC** (Gemini API) | тексти, мовлення, озвучення | глобально | «Gemini API Additional Terms» + Google Cloud Data Processing Addendum (діє для платного тарифу) | так (DPF, SCC) | ⏳ **увімкнути оплату** (на безкоштовному тарифі Google — не процесор, а сам використовує дані; для ЄС дозволено лише платне) і прийняти Data Processing Addendum у Google Cloud Console → Account settings → Privacy & Security |
| **Cloudflare Inc.** (R2) | зашифровані резервні копії, файли | R2 з юрисдикцією ЄС | cloudflare.com/cloudflare-customer-dpa — входить в умови самообслуговування автоматично | DPF, SCC | ⏳ створити бакет з «EU jurisdiction» |
| **GitHub Inc.** (Microsoft) | Pages (IP у журналах), Actions (транзит зашифрованих копій) | США | GitHub Data Protection Agreement — входить у умови для організацій / Customer Terms | DPF, SCC | ✅ (після домену — переглянути хостинг) |
| **Apple Inc.** | APNs (адреса пристрою), App Store | США/ЄС | Apple Developer Program License Agreement (Schedule 2/3, Apple як агент продажу) | DPF | ⏳ при реєстрації Apple Developer |
| Сервіси web push (Google FCM, Mozilla, Apple Web Push, Microsoft) | лише адреса підписки й зашифрований вміст сповіщення | різні | вміст шифрується end-to-end (RFC 8291) — сервіс не бачить тексту | — | ✅ |
| ⏳ Провайдер пошти (Resend / Brevo / Amazon SES) | email, текст листів | обрати з серверами в ЄС | DPA провайдера | — | при запуску розсилок |

Перевірка сертифікації DPF: dataprivacyframework.gov → List (Supabase, Google, Cloudflare, GitHub, Apple — усі мають чинну участь станом на 2026 рік; звіряти раз на рік).

Субпроцесори в Політиці перелічені поіменно; при додаванні нового сервісу — оновити Політику (`js/pages/about.js`, «Хто ще обробляє дані»), `ropa.md` і цей файл.
