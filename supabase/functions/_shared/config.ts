// ID моделей Gemini — дзеркало js/config.js. Можна перевизначити секретами.
const env = (k: string) => Deno.env.get(k) || '';
const list = (...xs: string[]) => [...new Set(xs.filter(Boolean))];

export const TEXT_MODELS = list(env('GEMINI_TEXT_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest');
export const TTS_MODELS = list(env('GEMINI_TTS_MODEL'), 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts');
export const LIVE_MODELS = list(env('GEMINI_LIVE_MODEL'), 'gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest');

export const LIMITS = {
  textCalls: Number(env('LIMIT_TEXT_CALLS')) || 200,
  voiceSeconds: (Number(env('LIMIT_VOICE_MINUTES')) || 60) * 60,
  ttsCalls: Number(env('LIMIT_TTS_CALLS')) || 300,
  liveTokens: Number(env('LIMIT_LIVE_TOKENS')) || 40,
};
export const LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
