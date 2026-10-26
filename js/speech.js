// Озвучення (TTS браузера / Gemini TTS) і розпізнавання мови
import * as store from './store.js';
import { ttsAudio, tutor } from './ai.js';
import { user } from './supa.js';

const synth = window.speechSynthesis;
let voicesCache = [];
function loadVoices() { voicesCache = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

export function langCode(accent = store.settings().accent) { return accent === 'UK' ? 'en-GB' : 'en-US'; }

export function englishVoices(accent) {
  const lang = langCode(accent).toLowerCase();
  const vs = voicesCache.filter(v => v.lang.toLowerCase().replace('_', '-') === lang);
  const any = voicesCache.filter(v => v.lang.toLowerCase().startsWith('en'));
  // якісніші голоси (Google/Microsoft Natural/Siri) — першими
  const score = (v) => (/natural|neural|online|google|siri|premium|enhanced/i.test(v.name) ? 0 : 1) + (v.localService ? 0.5 : 0);
  return (vs.length ? vs : any).slice().sort((a, b) => score(a) - score(b));
}

let currentAudio = null;
export function stop() {
  synth?.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

/**
 * Озвучити англійський текст. opts: rate, accent, voiceIndex (для діалогів), engine ('browser'|'gemini')
 * Повертає Promise, що завершується після озвучення.
 */
export async function speak(text, opts = {}) {
  const st = store.settings();
  const rate = opts.rate ?? st.rate ?? 1;
  const engine = opts.engine || st.ttsEngine || 'browser';
  stop();
  if (engine === 'gemini' && user() && navigator.onLine) {
    try { return await playGemini(text, opts.geminiVoice, rate); } catch (e) { console.warn('Gemini TTS → браузер', e); }
  }
  return speakBrowser(text, { rate, accent: opts.accent || st.accent, voiceIndex: opts.voiceIndex || 0 });
}

export function speakBrowser(text, { rate = 1, accent, voiceIndex = 0 } = {}) {
  return new Promise((resolve) => {
    if (!synth) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode(accent);
    const vs = englishVoices(accent);
    if (vs.length) u.voice = vs[voiceIndex % vs.length];
    if (voiceIndex && vs.length < 2) u.pitch = voiceIndex % 2 ? 0.8 : 1.15;   // один голос — розрізняємо висотою
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    synth.speak(u);
    // Chrome інколи «засинає» на довгих текстах
    const keep = setInterval(() => { if (!synth.speaking) clearInterval(keep); else { synth.pause(); synth.resume(); } }, 10000);
  });
}

const audioCache = new Map();
// iOS дозволяє play() лише в жесті: один аудіоелемент «розблоковуємо» першим дотиком і далі використовуємо його
const player = typeof Audio !== 'undefined' ? new Audio() : null;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
if (player) document.addEventListener('pointerdown', () => { player.src = SILENT; player.play().catch(() => {}); }, { once: true, capture: true });

let pendingDone = null;
async function playGemini(text, voice, rate) {
  const key = (voice || '') + '|' + text;
  let url = audioCache.get(key);
  if (!url) { url = URL.createObjectURL(await ttsAudio(text, { voice })); audioCache.set(key, url); }
  pendingDone?.();     // попереднє відтворення перериваємо — його проміс завершуємо
  return new Promise((resolve, reject) => {
    pendingDone = resolve;
    const a = player || new Audio();
    a.onended = () => resolve();
    a.onpause = () => resolve();     // stop() або пауза — проміс завершується, цикли (діалоги) не зависають
    a.onerror = () => reject(new Error('audio'));
    a.src = url;
    a.playbackRate = rate;
    currentAudio = a;
    a.play().catch(reject);
  });
}

// ---------- Розпізнавання ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canRecognize = () => !!SR;

/**
 * Розпізнати одну фразу англійською. onInterim(text) — проміжний результат.
 * Повертає { text, alternatives, confidence }. abort через контролер.
 */
export function recognize({ onInterim, lang, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(Object.assign(new Error('unsupported'), { code: 'unsupported' }));
    const r = new SR();
    r.lang = lang || langCode();
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = false;
    let final = null, interim = '';
    r.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final = { text: res[0].transcript.trim(), confidence: res[0].confidence, alternatives: [...res].map(a => a.transcript.trim()) };
        else interim += res[0].transcript;
      }
      onInterim?.(final?.text || interim);
    };
    r.onerror = (e) => {
      const code = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'mic' : e.error;
      if (code === 'no-speech' || code === 'aborted') resolve(final || { text: interim.trim(), alternatives: [], confidence: 0 });
      else reject(Object.assign(new Error(e.error), { code }));
    };
    r.onend = () => resolve(final || { text: interim.trim(), alternatives: [], confidence: 0 });
    signal?.addEventListener('abort', () => r.stop());
    try { r.start(); } catch (e) { reject(e); }
  });
}

/** Запис аудіо (запасний варіант без Web Speech API) → транскрипція через Gemini */
export async function recordAndTranscribe({ maxMs = 15000, signal } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise(res => { rec.onstop = res; });
  rec.start();
  const t = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs);
  signal?.addEventListener('abort', () => rec.state !== 'inactive' && rec.stop());
  await done; clearTimeout(t);
  stream.getTracks().forEach(tr => tr.stop());
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  const b64 = await blobToBase64(blob);
  const res = await tutor('transcribe', { audio: b64, mime: blob.type.split(';')[0] });
  return { text: (res.text || '').trim(), alternatives: [], confidence: 0 };
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/** Порівняння сказаного з еталоном по словах */
export function compareWords(target, said) {
  const clean = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  const t = clean(target), s = clean(said);
  const pool = new Map();
  s.forEach(w => pool.set(w, (pool.get(w) || 0) + 1));
  const words = target.split(/\s+/).map(raw => {
    const w = clean(raw)[0];
    const ok = w && pool.get(w) > 0;
    if (ok) pool.set(w, pool.get(w) - 1);
    return { raw, ok: !!ok || !w };
  });
  const hit = words.filter(w => w.ok).length;
  return { words, pct: t.length ? Math.round(hit / words.length * 100) : 0 };
}
