# App Store Connect — що й куди вписати (myEnglish)

Покроково для власника. Тексти сторінки — `docs/appstore-listing.md`, скріншоти — `docs/screens/`.

## 1. Створити застосунок (My Apps → «+» → New App)
| Поле | Значення |
|---|---|
| Platforms | iOS |
| Name | `myEnglish: AI English Tutor` (якщо зайнято — `myEnglish – Speak with AI`) |
| Primary Language | English (U.S.) |
| Bundle ID | `app.myenglish.tutor` (зареєструвати в Certificates, Identifiers & Profiles → Identifiers, або Xcode-збірка з ключем API зробить сама) |
| SKU | `myenglish-ios` |
| User Access | Full Access |

## 2. App Information
| Поле | Значення |
|---|---|
| Category | Education; Secondary: Reference |
| Content Rights | «Contains, shows, or accesses third-party content» → **Yes**, «I have the necessary rights» (книги й оповідання — суспільне надбання, Standard Ebooks CC0; шрифти OFL; голоси Kokoro Apache-2.0; AI — умови Gemini API) |
| Age Rating | див. розділ 5 |
| Privacy Policy URL | `https://pavlozhyhalov.github.io/myEnglish/#/about/privacy` |
| Support URL | `https://pavlozhyhalov.github.io/myEnglish/support.html` |
| Marketing URL | (порожньо або `https://pavlozhyhalov.github.io/myEnglish/`) |
| Copyright | `2026 <ім'я розробника або компанії, на яку зареєстровано акаунт Apple Developer>` |
| Localizations | English (U.S.), Ukrainian, Spanish (Spain) + Spanish (Mexico) — той самий текст, Portuguese (Brazil), Turkish, Polish, Russian |

## 3. Pricing and Availability
- Price: **Free** (поки без підписки).
- Availability: усі країни, **крім Russia, Belarus, China mainland** (для AI-застосунків у Китаї потрібна ліцензія).
- **DSA (ЄС) — Trader status:** безкоштовний застосунок без доходу → «I'm not a trader». Якщо з'явиться підписка — змінити на «trader» (адреса, телефон і email будуть публічно на сторінці).

## 4. App Privacy (анкета «Data Collection»)
Do you or your third-party partners collect data from this app? → **Yes**.
Для КОЖНОГО типу нижче: Linked to the user’s identity — **Yes**; Used for tracking — **No**; Purpose — **App Functionality** (і ніщо інше).

| Категорія Apple | Тип | Що це в myEnglish |
|---|---|---|
| Contact Info | Email Address | вхід в акаунт |
| Contact Info | Name | ім'я/звертання в профілі (необов'язково) |
| User Content | Audio Data | голос у розмові з вчителем, голосові в чатах, запис «тоді й зараз» |
| User Content | Photos or Videos | скріншот у «Написати розробнику» (лише за бажанням) |
| User Content | Customer Support | звернення й скарги |
| User Content | Other User Content | розмови з вчителем, повідомлення в чатах, щоденник, тексти на перевірку |
| Identifiers | User ID | ідентифікатор акаунта |
| Usage Data | Product Interaction | час занять, прогрес, картки, помилки |
| Diagnostics | Crash Data / Other Diagnostic Data | журнал помилок застосунку |

Не збираємо: геолокацію, контакти, фінанси, здоров'я, історію браузера, рекламні ідентифікатори. **Tracking — No** (ATT не потрібен).

## 5. Age Rating (анкета)
| Питання | Відповідь |
|---|---|
| Violence / horror / sexual content / nudity / gambling / drugs / alcohol / medical | None |
| Profanity or crude humor | **Infrequent/Mild** (офлайн-словник має грубі слова з позначкою «(груб.)»; у чатах грубі слова блокуються) |
| Mature/suggestive themes | None |
| User-Generated Content | **Yes** (переписка з людьми; є скарги, блокування, фільтр, модерація ≤ 24 год) |
| Messaging and Chat | **Yes** |
| Unrestricted Web Access | No |
| Advertising | No |
| Age assurance / parental controls | у застосунку: вік 16+ підтверджується при реєстрації |
Очікувана категорія — **13+**; Умови застосунку вимагають 16+ (це дозволено: застосунок може мати суворіший вік).

## 6. App Review Information
- Sign-in required: **Yes** → демо-акаунт (email і пароль — у повідомленні від Claude, не в репозиторії).
- Notes — англійський текст з `docs/appstore-listing.md` → «Нотатки для перевірки Apple».
- Contact: ваше ім'я, телефон, email (бачить лише Apple).

## 7. Build
- Export Compliance: «Uses non-exempt encryption?» → **No** (уже прописано в Info.plist — питання не з'явиться).
- Збірку робить GitHub Actions автоматично після секретів `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` (Settings → Secrets and variables → Actions у репозиторії). Ключ: App Store Connect → Users and Access → Integrations → App Store Connect API → «+» → роль **App Manager** → завантажити `.p8` (один раз!).
- `APPLE_TEAM_ID` — developer.apple.com → Account → Membership details → Team ID.

## 7a. Сповіщення про чати в застосунку (APNs)
developer.apple.com → Certificates, Identifiers & Profiles → **Keys** → «+» → назва «myEnglish push», галочка **Apple Push Notifications service (APNs)** → Continue → Register → **Download** `.p8` (один раз!). Запишіть Key ID.
Потім скажіть Claude «ключ APNs готовий» і передайте файл — Claude додасть секрети функції `push`: `APNS_KEY_P8` (вміст файлу), `APNS_KEY_ID`, `APNS_TEAM_ID` (той самий Team ID). Без них у застосунку працюють лише локальні щоденні нагадування.

## 8. Перед натисканням «Submit for Review»
1. TestFlight: встановити на свій iPhone, пройти: вхід, згода на AI, голосовий вчитель, картки, чат, скарга, видалення тестового акаунта.
2. Розробник (людина чи компанія, що публікує застосунок) вписує свої назву й контакт у Політику приватності (`js/pages/about.js`, «Хто відповідає за ваші дані»), Copyright і сторінку підтримки — у репозиторії власних даних власника немає й не має бути.
3. Перевірити, що SMTP налаштовано (листи відновлення пароля).
4. Вирішити питання платного Gemini (умови для користувачів з ЄС).
