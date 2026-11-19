// Озвучення (TTS браузера / Gemini TTS) і розпізнавання мови
import * as store from './store.js';
import { ttsAudio, tutor } from './ai.js';
import { user } from './supa.js';
import { trackMic, sessionRecord, sessionPlayback } from './audiosession.js';

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
// Номер поточного озвучення: озвучення, що ще вантажиться (Gemini TTS, 1–2 с), після stop() чи нового speak() вже не грає —
// інакше на наступній картці звучало попереднє слово (2026-11-14)
let seq = 0;
function halt() {
  synth?.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}
export function stop() { seq++; halt(); }

/**
 * Озвучити англійський текст. opts: rate, accent, voiceIndex (для діалогів), engine ('browser'|'gemini')
 * Повертає Promise, що завершується після озвучення.
 */
export async function speak(text, opts = {}) {
  const st = store.settings();
  const rate = opts.rate ?? st.rate ?? 1;
  const engine = opts.engine || st.ttsEngine || 'gemini';
  const my = ++seq;
  halt();
  sessionPlayback();   // iPhone: звичайна гучність медіа — кнопки гучності діють (js/audiosession.js)
  if (engine === 'gemini' && user() && navigator.onLine && !geminiPaused()) {
    try { return await playGemini(text, opts.geminiVoice, rate, my); } catch (e) { console.warn('Gemini TTS → браузер', e); pauseGemini(e); }
    if (my !== seq) return;   // поки чекали Gemini, вже озвучується інше — запасна озвучка браузером не потрібна
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

// Gemini — основна озвучка (власник 2026-11-16: «альтернативна звучить дуже погано»). Після вичерпаного денного ліміту чи збою —
// голос браузера на 10 хв (без зайвих секунд очікування на кожному слові), потім знову Gemini
const PAUSE_KEY = 'me:tts-pause';
const geminiPaused = () => { try { return Date.now() < Number(sessionStorage.getItem(PAUSE_KEY) || 0); } catch { return false; } };
function pauseGemini(e) {
  if (!['quota', 'rate_limited', 'overloaded', 'timeout', 'busy', 'need_login'].includes(e?.code)) return;
  try { sessionStorage.setItem(PAUSE_KEY, String(Date.now() + 10 * 60_000)); } catch { /* */ }
}
// Постійний кеш озвучок на пристрої (Cache Storage): слово, озвучене раз, більше не завантажується й не витрачає ліміт
const TTS_CACHE = 'me-tts-v1';
const cacheReq = (key) => new Request(`/__tts/${encodeURIComponent(key)}`);
async function cachedBlob(key) {
  try { const r = await (await caches.open(TTS_CACHE)).match(cacheReq(key)); return r ? await r.blob() : null; } catch { return null; }
}
function storeBlob(key, blob) {
  caches.open(TTS_CACHE).then(async (c) => {
    await c.put(cacheReq(key), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/wav' } }));
    const keys = await c.keys();
    if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1500)) c.delete(k);
  }).catch(() => {});
}

const audioCache = new Map();
// iOS дозволяє play() лише в жесті: один аудіоелемент «розблоковуємо» першим дотиком і далі використовуємо його
const player = typeof Audio !== 'undefined' ? new Audio() : null;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
if (player) document.addEventListener('pointerdown', () => { player.src = SILENT; player.play().catch(() => {}); }, { once: true, capture: true });

let pendingDone = null;
const geminiUrl = async (text, voice) => {
  const key = (voice || '') + '|' + text;
  let url = audioCache.get(key);
  if (!url) {
    const p = (async () => {
      let blob = await cachedBlob(key);
      if (!blob) { blob = await ttsAudio(text, { voice }); storeBlob(key, blob); }
      return URL.createObjectURL(blob);
    })();
    audioCache.set(key, p);           // паралельні запити того самого слова (попереднє завантаження + показ) — один виклик
    try { url = await p; } catch (e) { audioCache.delete(key); throw e; }
    audioCache.set(key, url);
  }
  return url;
};
/** Завантажити озвучку заздалегідь (наступна картка), якщо обрано Gemini; без помилок назовні */
export function prefetch(text, opts = {}) {
  const st = store.settings();
  if ((opts.engine || st.ttsEngine || 'gemini') !== 'gemini' || !user() || !navigator.onLine || !text || geminiPaused()) return;
  geminiUrl(text, opts.geminiVoice).catch(() => {});
}
async function playGemini(text, voice, rate, my) {
  const url = await geminiUrl(text, voice);
  if (my !== seq) return;             // поки вантажилось, перейшли далі — не граємо застаріле слово
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

// ---------- Діалоги аудіювання: один запис Gemini двома голосами (2026-11-19, власник: «паршивий голос, нічого не зрозуміло») ----------
const FEMALE = /^(mrs|ms|miss|woman|girl|anna|emma|ewa|kasia|kate|sophie|olga|maria|marta|julia|lucy|sarah|alice|vita|tetiana|natalia|ola|zosia)\b/i;
const MALE = /^(mr|man|boy|oliver|tom|marek|john|james|jack|david|peter|piotr|adam|max|sam|paul|mark|taras|ivan)\b/i;
/** Голоси для двох мовців за іменами: жінка — Kore/Aoede, чоловік — Puck/Charon; ролі без статі — протилежна до співрозмовника */
export function dialogueVoices(names = []) {
  let g = [0, 1].map(i => FEMALE.test(names[i] || '') ? 'f' : MALE.test(names[i] || '') ? 'm' : '');
  if (!g[0] && !g[1]) g = ['f', 'm'];
  else if (!g[0]) g[0] = g[1] === 'm' ? 'f' : 'm';
  else if (!g[1]) g[1] = g[0] === 'm' ? 'f' : 'm';
  const v = g[0] === g[1] ? (g[0] === 'f' ? ['Kore', 'Aoede'] : ['Puck', 'Charon']) : g.map(x => (x === 'f' ? 'Kore' : 'Puck'));
  return [0, 1].map(i => ({ name: names[i] || '', voice: v[i] }));
}
const dlgBody = (d) => ({ dialogue: d.lines.map(l => ({ s: l.speaker ? 1 : 0, t: l.text })), speakers: dialogueVoices(d.speakers) });
const dlgUrls = new Map();
function dialogueUrl(d) {
  const body = dlgBody(d);
  const key = 'dlg|' + JSON.stringify(body);
  if (!dlgUrls.has(key)) {
    const p = (async () => {
      let blob = await cachedBlob(key);
      if (!blob) { blob = await ttsAudio('', body); storeBlob(key, blob); }
      return URL.createObjectURL(blob);
    })();
    dlgUrls.set(key, p);
    p.catch(() => dlgUrls.delete(key));
  }
  return dlgUrls.get(key);
}
/** Підготувати запис діалогу заздалегідь (відкрили діалог — поки читають питання, запис готується) */
export function prefetchDialogue(d) {
  if (!user() || !navigator.onLine || !d?.lines?.length) return;
  dialogueUrl(d).catch(() => {});
}
/** Програти діалог одним записом Gemini. onProgress(частка 0..1). Кидає помилку, якщо запису немає (тоді — по репліках) */
export async function playDialogue(d, { rate, onProgress } = {}) {
  if (!user() || !navigator.onLine) throw Object.assign(new Error('offline'), { code: 'offline' });
  const my = ++seq;
  halt();
  sessionPlayback();
  const url = await dialogueUrl(d);
  if (my !== seq) return;
  pendingDone?.();
  return new Promise((resolve, reject) => {
    pendingDone = resolve;
    const a = player || new Audio();
    a.onended = () => resolve();
    a.onpause = () => resolve();
    a.onerror = () => reject(new Error('audio'));
    a.ontimeupdate = () => { if (a.duration) onProgress?.(a.currentTime / a.duration); };
    a.src = url;
    a.playbackRate = rate ?? store.settings().rate ?? 1;
    currentAudio = a;
    a.play().catch(reject);
  }).finally(() => { if (player) player.ontimeupdate = null; });
}

// ---------- Розпізнавання ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// Розпізнавання браузера є, але не працює (Samsung Internet, Brave, деякі Android без служби Google): після першого такого збою —
// на цьому пристрої до перезапуску використовується запис + розпізнавання вчителем (Gemini)
let srBroken = false;
try { srBroken = sessionStorage.getItem('me:sr-broken') === '1'; } catch { /* */ }
export const canRecognize = () => !!SR && !srBroken;
const SR_BROKEN = ['network', 'service-not-allowed', 'language-not-supported', 'bad-grammar'];
/** Чи може сторінка взагалі отримати мікрофон (безпечний контекст + getUserMedia; у вбудованих браузерах месенджерів часто немає) */
export const micAvailable = () => !!(window.isSecureContext !== false && navigator.mediaDevices?.getUserMedia);
const micError = () => Object.assign(new Error('mic unsupported'), { code: 'mic', name: 'NotAllowedError' });   // S.err.mic сам пояснює, що робити (вбудований браузер, Android, iPhone)
export async function getMic(constraints = { audio: true }) {
  if (!micAvailable()) throw micError();
  sessionRecord();
  try { return trackMic(await navigator.mediaDevices.getUserMedia(constraints)); }
  catch (e) { throw Object.assign(e, { code: e?.name === 'NotFoundError' ? 'mic_missing' : e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'mic' : e?.code }); }
}

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
    let settled = false;
    r.onerror = (e) => {
      const code = e.error === 'not-allowed' ? 'mic' : e.error;
      if (code === 'no-speech' || code === 'aborted') return resolve(final || { text: interim.trim(), alternatives: [], confidence: 0 });
      // служба розпізнавання браузера недоступна (не мікрофон) → запам'ятати й записати фразу для розпізнавання вчителем
      if (SR_BROKEN.includes(e.error) && navigator.onLine !== false) {
        srBroken = true;
        try { sessionStorage.setItem('me:sr-broken', '1'); } catch { /* */ }
        if (canRecord() && user() && !signal?.aborted) {
          settled = true;
          onInterim?.('Слухаю…');
          return recordAndTranscribe({ maxMs: 12000, signal }).then(resolve, reject);
        }
        return reject(Object.assign(new Error('unsupported'), { code: 'unsupported' }));
      }
      reject(Object.assign(new Error(e.error), { code }));
    };
    r.onend = () => { if (!settled) setTimeout(() => { if (!settled) resolve(final || { text: interim.trim(), alternatives: [], confidence: 0 }); }, 0); };
    signal?.addEventListener('abort', () => r.stop());
    try { r.start(); } catch (e) { reject(e); }
  });
}

/**
 * Запис аудіо (запасний варіант без Web Speech API) → транскрипція через Gemini.
 * context — необов'язково: { tutor: остання репліка вчителя } — допомагає точніше розпізнати відповідь учня.
 */
export async function recordAndTranscribe({ maxMs = 15000, signal, context = null } = {}) {
  const stream = await getMic();
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
  // учень говорить англійською з акцентом — підказуємо моделі, щоб не «вгадувала» іншу мову
  const payload = { audio: b64, mime: blob.type.split(';')[0], hint: 'learner' };
  const ctx = tutorContext(context?.tutor);
  if (ctx) payload.context = { tutor: ctx };
  const res = await tutor('transcribe', payload);
  return { text: (res.text || '').trim(), alternatives: [], confidence: 0 };
}

/** Остання репліка вчителя для контексту розпізнавання: без розмітки, один рядок, до 300 символів (обрізано з початку — кінець репліки найважливіший) */
export function tutorContext(text) {
  const t = String(text || '').replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= 300) return t;
  const cut = t.slice(-300);
  return /\s/.test(t[t.length - 301]) ? cut : cut.replace(/^\S*\s+/, '');
}

/** Чи можна записати аудіо (MediaRecorder + мікрофон) — для AI-оцінки вимови */
export const canRecord = () => typeof MediaRecorder !== 'undefined' && micAvailable();

/**
 * Записати аудіо без розпізнавання: до maxMs або до abort через signal.
 * onStart() — мікрофон увімкнено. Повертає { audio (base64), mime, ms }.
 */
export async function recordAudio({ maxMs = 12000, signal, onStart } = {}) {
  const stream = await getMic();
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
  const release = () => stream.getTracks().forEach(tr => tr.stop());
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    rec.start();
  } catch (e) { release(); throw e; }   // мікрофон не лишається увімкненим після збою
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise(res => { rec.onstop = res; });
  const t0 = Date.now();
  const halt = () => rec.state !== 'inactive' && rec.stop();
  onStart?.();
  const t = setTimeout(halt, maxMs);
  signal?.addEventListener('abort', halt);
  await done; clearTimeout(t);
  release();
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  return { audio: await blobToBase64(blob), mime: blob.type.split(';')[0] || 'audio/webm', ms: Date.now() - t0 };
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
