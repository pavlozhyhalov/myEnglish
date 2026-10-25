// Версія збірки: той самий рядок у sw.js (назва кешу) і в ?v= у index.html.
// Піднімати скриптом scripts/bump.sh після будь-якої зміни фронтенду.
export const BUILD = '202610252128';

// Supabase (окремий проєкт myEnglish). Publishable-ключ публічний за задумом:
// доступ до даних обмежує RLS, до AI — allowlist в edge-функціях.
export const SUPABASE_URL = 'https://uxqdklwnxdtyifksphoz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_whFEQwtTif6542v-nDGEdg_nPPEqbpc';
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Моделі Gemini часто оновлюються — ID лише тут і в supabase/functions/_shared/config.ts
export const MODELS = {
  live: 'gemini-3.8-live',
  liveFallbacks: ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'],
};
export const LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

// Голоси Gemini Live (prebuilt)
export const LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];

export const LIMITS = {
  textCallsPerDay: 200,
  voiceMinutesPerDay: 60,
  sessionResumeMs: 9 * 60 * 1000,   // перепідключення Live приблизно кожні 10 хв
  chatRetentionDays: 30,
};

export const DEFAULTS = {
  theme: 'auto',
  dailyGoal: 20,
  newPerDay: 15,
  accent: 'US',
  rate: 1,
  voice: 'Puck',
  tutorName: 'Alex',
  tutorTone: 'friendly but demanding',
  explainLang: 'uk',          // uk | en | mix
  strictness: 'important',    // important | all
  quickbar: ['home', 'cards', 'tutor', 'grammar', 'progress'],
  level: 'B1',
  retention: 0.9,
  ttsEngine: 'browser',
  autoSpeak: true,
  pinDrawer: true,
  voiceSubs: true,
  workFocus: false,          // професійний (виробничий) контекст у вчителя — за вибором
};
