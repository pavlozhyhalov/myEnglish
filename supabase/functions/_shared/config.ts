// ID моделей Gemini — дзеркало js/config.js. Можна перевизначити секретами.
const env = (k: string) => Deno.env.get(k) || '';
const list = (...xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Базовий ланцюжок для текстових завдань (JSON, вправи, переклад, транскрипція) */
export const TEXT_MODELS = list(env('GEMINI_TEXT_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest');
/** Чат із вчителем (стрімінг): за замовчуванням той самий ланцюжок; GEMINI_CHAT_MODEL — сильніша модель першою, решта — запасні на 429/перевантаження */
export const CHAT_MODELS = list(env('GEMINI_CHAT_MODEL'), ...TEXT_MODELS);
/** Аналітика сесії (підсумок, перевірка текстів, щоденник): GEMINI_SMART_MODEL — напр. gemini-pro-latest, з відкатом на flash */
export const SMART_MODELS = list(env('GEMINI_SMART_MODEL'), ...TEXT_MODELS);
/** Швидкі службові виклики після відповіді (підказки, слова, пам'ять): окрема квота flash-lite, без «роздумів» */
// кожна модель має власну квоту: після 429 модель охолоджується (gemini.ts), і черга йде далі
export const FAST_MODELS = list(env('GEMINI_FAST_MODEL'), 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest');
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
