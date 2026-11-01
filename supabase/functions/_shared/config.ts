// ID моделей Gemini — дзеркало js/config.js. Можна перевизначити секретами.
const env = (k: string) => Deno.env.get(k) || '';
const list = (...xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Базовий ланцюжок для текстових завдань (JSON, вправи, переклад, транскрипція) */
// Замір 2026-11-01 (безкоштовний тариф ключа): 3.5-flash / 3-flash-preview / 3.6-flash відповідають за 1–9 с;
// gemini-flash-latest, 3.7/3.8-flash зависають (тайм-аут) — лише в кінці черги; 2.5-* більше не існують; Pro — лише з оплатою.
export const TEXT_MODELS = list(env('GEMINI_TEXT_MODEL'), 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest');
/** Чат із вчителем (стрімінг): за замовчуванням той самий ланцюжок; GEMINI_CHAT_MODEL — сильніша модель першою, решта — запасні на 429/перевантаження */
export const CHAT_MODELS = list(env('GEMINI_CHAT_MODEL'), ...TEXT_MODELS);
/** Аналітика сесії (підсумок, перевірка текстів, щоденник): GEMINI_SMART_MODEL — напр. gemini-pro-latest, з відкатом на flash */
export const SMART_MODELS = list(env('GEMINI_SMART_MODEL'), 'gemini-3.6-flash', ...TEXT_MODELS);
/** Найважливіші оцінки (підсумок розмови з рівнем, глибокий аналіз, письмо тесту рівня): Pro першою, на 429/перевантаження — flash */
export const PRO_MODELS = list(env('GEMINI_PRO_MODEL'), 'gemini-pro-latest', 'gemini-3.1-pro-preview', ...SMART_MODELS);
/** Швидкі службові виклики після відповіді (підказки, слова, пам'ять): окрема квота flash-lite, без «роздумів» */
// кожна модель має власну квоту: після 429 модель охолоджується (gemini.ts), і черга йде далі
export const FAST_MODELS = list(env('GEMINI_FAST_MODEL'), 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview');
/** TUTOR_META=off вимикає додаткову подію meta в чаті (економія квоти) */
export const META_ENABLED = env('TUTOR_META').toLowerCase() !== 'off';
export const TTS_MODELS = list(env('GEMINI_TTS_MODEL'), 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts');
export const LIVE_MODELS = list(env('GEMINI_LIVE_MODEL'), 'gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest');

export const LIMITS = {
  textCalls: Number(env('LIMIT_TEXT_CALLS')) || 200,
  voiceSeconds: (Number(env('LIMIT_VOICE_MINUTES')) || 60) * 60,
  ttsCalls: Number(env('LIMIT_TTS_CALLS')) || 300,
  liveTokens: Number(env('LIMIT_LIVE_TOKENS')) || 40,
};
export const LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
