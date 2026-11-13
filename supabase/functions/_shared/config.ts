// ID моделей Gemini — дзеркало js/config.js. Можна перевизначити секретами.
const env = (k: string) => Deno.env.get(k) || '';
const list = (...xs: string[]) => [...new Set(xs.filter(Boolean))];

// БЕЗКОШТОВНИЙ ТАРИФ (замір 2026-11-01): у кожної моделі свій ліміт. Сильні flash (3.5, 3.6, 3-flash-preview, flash-latest) —
// лише 20 запитів на день кожна; lite-моделі — значно більше; Pro/Omni — недоступні; 3.7/3.8-flash зависають; 2.5-* зникли.
// Тому навантаження розподілене: рідкісні важливі оцінки — найточніша модель першою; чат — інша сильна модель;
// масові дії (кожна репліка в голосі, слова, переклад, службові дані) — lite. Вичерпана модель пропускається до скидання ліміту (gemini.ts).
//
// 10 КОРИСТУВАЧІВ (2026-11-13, власник: «щоб Gemini вистачало на 10 людей»). Сильних викликів на всіх ~60–80 на день, тож:
// — чат і генерація вправ/діалогів/місій — lite першими (щоденний автотест: 3.5-flash-lite ловить помилки не гірше, recall 0,87 проти 0,78),
//   сильні — лише запасні; різні дії починають з різних lite-моделей, щоб денні ліміти витрачались рівномірно;
// — сильні першими лише для найважливіших оцінок (PRO, SMART), і кожен користувач має денну частку LIMITS.strongCalls (charge_strong, міграція 0019);
//   понад частку — ті самі дії на lite (liteOnly), без відмови.
const LITE = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const STRONG = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-flash-latest'];
/** Генерація (вправи, діалоги, місії, історії, тижнева порада, вимова) — lite, починаючи з 3.1 */
export const TEXT_MODELS = list(env('GEMINI_TEXT_MODEL'), 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-flash-lite-latest', ...STRONG);
/** Чат із вчителем (стрімінг) — найкраща lite першою, далі інші lite, сильні — запасні */
export const CHAT_MODELS = list(env('GEMINI_CHAT_MODEL'), 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite-preview', ...STRONG);
/** Лише lite з переліку (понад денну частку сильних викликів) */
export const liteOnly = (models: string[]) => { const l = models.filter(m => m.includes('lite')); return l.length ? l : LITE; };
/** Перевірка текстів і щоденник */
export const SMART_MODELS = list(env('GEMINI_SMART_MODEL'), 'gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-3.5-flash', ...LITE, 'gemini-flash-latest');
/** Найважливіші оцінки (підсумок розмови з рівнем, глибокий аналіз, письмо тесту рівня): найточніша безкоштовна (9/9 помилок у замірі) з глибокими роздумами */
export const PRO_MODELS = list(env('GEMINI_PRO_MODEL'), ...SMART_MODELS);
/** Масові короткі дії: перевірка кожної репліки в голосі, транскрипція, переклад слова/тексту, підказки, перевірка перекладу */
export const LIGHT_MODELS = list(env('GEMINI_LIGHT_MODEL'), ...LITE, 'gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.6-flash');
/** Службові виклики після відповіді (варіанти відповіді, слова, пам'ять), нагадування — без «роздумів» */
export const FAST_MODELS = list(env('GEMINI_FAST_MODEL'), 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview');
/** TUTOR_META=off вимикає додаткову подію meta в чаті (економія квоти) */
export const META_ENABLED = env('TUTOR_META').toLowerCase() !== 'off';
export const TTS_MODELS = list(env('GEMINI_TTS_MODEL'), 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts');
export const LIVE_MODELS = list(env('GEMINI_LIVE_MODEL'), 'gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest');

export const LIMITS = {
  // на одного користувача за день (2026-11-13, розрахунок на 10 людей; найбільше в найактивнішого за 2 тижні: 91 текстовий виклик, 38 хв голосу, 17 озвучень, 5 токенів)
  textCalls: Number(env('LIMIT_TEXT_CALLS')) || 150,
  voiceSeconds: (Number(env('LIMIT_VOICE_MINUTES')) || 45) * 60,
  ttsCalls: Number(env('LIMIT_TTS_CALLS')) || 60,
  liveTokens: Number(env('LIMIT_LIVE_TOKENS')) || 30,   // попереднє з'єднання голосу бере токен і на відкриття панелі
  strongCalls: Number(env('LIMIT_STRONG_CALLS')) || 8,  // частка сильних моделей: ~8 × 10 людей ≈ 80 — денний запас трьох-чотирьох сильних моделей
};
export const LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
