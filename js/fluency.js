// Тренажер плавності (#/fluency): техніка 4-3-2, фрази «замість uh», метрики мовлення, запис із мікрофона, історія.
// Метрики рахуються на пристрої з дослівної транскрипції (tutor 'transcribe' з hint 'fluency' зберігає um/uh і повтори).
import * as store from './store.js';

// ---------- Раунди 4-3-2 (класика: 4 → 3 → 2 хв; для B1 — 60 → 45 → 30 с) ----------
export const ROUNDS = [{ sec: 60 }, { sec: 45 }, { sec: 30 }];

// ---------- Теми ----------
/** Побутові теми рівня B1: en — тема (йде у відгук AI), uk — підпис, hints — про що можна розповісти */
export const TOPICS = [
  { id: 'weekend', icon: 'sun', en: 'My last weekend', uk: 'Мої вихідні', hints: ['Where were you?', 'Who were you with?', 'What was the best moment?'] },
  { id: 'hometown', icon: 'buildings', en: 'My hometown', uk: 'Моє місто', hints: ['What is it like?', 'What do you love there?', 'What would you change?'] },
  { id: 'dayoff', icon: 'coffee', en: 'A perfect day off', uk: 'Ідеальний вихідний', hints: ['Morning, afternoon, evening', 'Who is with you?', 'Why is it perfect?'] },
  { id: 'food', icon: 'fork-knife', en: 'Food I love', uk: 'Улюблена їжа', hints: ['What and why?', 'Who cooks it?', 'A memory with this food'] },
  { id: 'trip', icon: 'airplane-tilt', en: 'A trip I remember', uk: 'Подорож, яку пам\'ятаю', hints: ['Where and when?', 'What happened?', 'Would you go back?'] },
  { id: 'routine', icon: 'clock', en: 'My daily routine', uk: 'Мій звичайний день', hints: ['Morning to evening', 'What do you enjoy?', 'What would you change?'] },
  { id: 'film', icon: 'play', en: 'A film or series I like', uk: 'Фільм чи серіал', hints: ['What is it about?', 'Your favourite character', 'Why should I watch it?'] },
  { id: 'plans', icon: 'flag', en: 'My plans for next year', uk: 'Плани на наступний рік', hints: ['What do you want to do?', 'Why is it important?', 'What could stop you?'] },
  { id: 'friend', icon: 'users', en: 'A good friend of mine', uk: 'Мій добрий друг', hints: ['How did you meet?', 'What is he or she like?', 'A story about you two'] },
  { id: 'phone', icon: 'phone', en: 'Apps I use every day', uk: 'Застосунки на щодень', hints: ['Which apps?', 'What for?', 'Could you live without them?'] },
  { id: 'seasons', icon: 'plant', en: 'My favourite season', uk: 'Улюблена пора року', hints: ['Which one and why?', 'What do you do then?', 'A memory from that season'] },
  { id: 'shopping', icon: 'shopping-cart', en: 'Shopping: online or in shops?', uk: 'Покупки: онлайн чи в магазині', hints: ['What do you buy where?', 'Pros and cons', 'A good or bad experience'] },
];

/** До трьох тем з інтересів учня (профіль: вільний текст «Гори, кіно, готування…») */
export function interestTopics(about = store.prof().about) {
  const raw = typeof about?.interests === 'string' ? about.interests : Array.isArray(about?.interests) ? about.interests.join(', ') : '';
  const seen = new Set();
  return raw.split(/[,;\n·•]+|\s+(?:і|та|й|and)\s+/i).map(s => s.replace(/[.…!?]+$/, '').trim())
    .filter(s => s.length >= 2 && s.length <= 40)
    .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 3)
    .map((s, i) => ({ id: 'int' + i, icon: 'heart', en: s, uk: s[0].toUpperCase() + s.slice(1), hints: ['Why do you like it?', 'How did it start?', 'A recent story about it'], interest: true }));
}

// ---------- Фрази «замість uh» ----------
/** Природні фрази, що дають час подумати й зв'язують думки. alt — інші варіанти, які теж зараховуємо на початку відповіді */
export const GAMBIT_GROUPS = [
  { id: 'start', uk: 'Почати відповідь', items: [
    { en: 'Well, …', uk: 'Ну, …' },
    { en: 'Actually, …', uk: 'Насправді, …' },
    { en: 'To be honest, …', uk: 'Чесно кажучи, …', alt: ['honestly'] },
    { en: 'That\'s a good question.', uk: 'Гарне питання.', alt: ['good question', 'that is a good question', 'that\'s an interesting question', 'interesting question'] },
    { en: 'I\'d say …', uk: 'Я б сказав(-ла), …', alt: ['i would say'] },
  ] },
  { id: 'think', uk: 'Подумати', items: [
    { en: 'Let me think…', uk: 'Дайте подумати…', alt: ['let me think about it', 'let me think about that'] },
    { en: 'Let me see…', uk: 'Зараз, хвилинку…' },
    { en: 'How can I put it…', uk: 'Як би це сказати…', alt: ['how shall i put it', 'how do i put it', 'how should i put it'] },
    { en: 'The thing is, …', uk: 'Справа в тому, що…' },
  ] },
  { id: 'rephrase', uk: 'Перефразувати', items: [
    { en: 'What I mean is …', uk: 'Я маю на увазі, …', alt: ['what i mean'] },
    { en: 'In other words, …', uk: 'Іншими словами, …' },
    { en: 'Let me put it another way.', uk: 'Скажу інакше.', alt: ['let me put it differently', 'to put it another way'] },
  ] },
  { id: 'add', uk: 'Додати', items: [
    { en: 'On top of that, …', uk: 'До того ж, …' },
    { en: 'Another thing is …', uk: 'Ще одне: …' },
    { en: 'What\'s more, …', uk: 'Ба більше, …', alt: ['and what\'s more', 'what is more'] },
    { en: 'Plus, …', uk: 'Плюс, …' },
  ] },
];
export const GAMBITS = GAMBIT_GROUPS.flatMap(g => g.items.map(x => ({ ...x, group: g.id })));

// ---------- Питання для тренування (B1, побут) ----------
export const QUESTIONS = [
  { en: 'What did you do last weekend?', uk: 'Що ви робили минулих вихідних?' },
  { en: 'What\'s your favourite way to relax?', uk: 'Як ви найбільше любите відпочивати?' },
  { en: 'Tell me about your hometown.', uk: 'Розкажіть про своє місто.' },
  { en: 'What\'s the best trip you\'ve ever had?', uk: 'Яка ваша найкраща подорож?' },
  { en: 'What do you usually have for breakfast?', uk: 'Що ви зазвичай їсте на сніданок?' },
  { en: 'Would you rather live in a city or in the countryside?', uk: 'Де б ви хотіли жити — у місті чи за містом?' },
  { en: 'What film or series would you recommend?', uk: 'Який фільм чи серіал ви б порадили?' },
  { en: 'How do you usually spend your evenings?', uk: 'Як ви зазвичай проводите вечори?' },
  { en: 'What would you do with a free day tomorrow?', uk: 'Що б ви робили завтра, якби мали вільний день?' },
  { en: 'What would you like to learn this year?', uk: 'Чого б ви хотіли навчитися цього року?' },
  { en: 'Do you prefer cooking at home or eating out?', uk: 'Що вам більше до душі — готувати вдома чи їсти в кафе?' },
  { en: 'What\'s your favourite season, and why?', uk: 'Яка ваша улюблена пора року і чому?' },
  { en: 'Tell me about a good friend of yours.', uk: 'Розкажіть про свого доброго друга.' },
  { en: 'Which app do you use most, and what for?', uk: 'Яким застосунком ви користуєтеся найбільше і для чого?' },
  { en: 'How has your town changed in recent years?', uk: 'Як змінилося ваше місто за останні роки?' },
  { en: 'What\'s the most useful thing you own?', uk: 'Яка найкорисніша річ у вас є?' },
  { en: 'Describe a typical Monday for you.', uk: 'Опишіть свій звичайний понеділок.' },
  { en: 'What kind of music do you listen to?', uk: 'Яку музику ви слухаєте?' },
  { en: 'Where would you like to travel next?', uk: 'Куди б ви хотіли поїхати наступного разу?' },
  { en: 'What makes a good neighbour?', uk: 'Яким має бути добрий сусід?' },
  { en: 'What was the last thing that made you laugh?', uk: 'Що востаннє вас розсмішило?' },
  { en: 'Is it better to have a few close friends or many friends?', uk: 'Що краще — кілька близьких друзів чи багато друзів?' },
];
export const DRILL_LEN = 5;          // питань за одне тренування
export const DRILL_START_SEC = 3;    // встигнути почати відповідь
export const DRILL_SPEAK_SEC = 12;   // тривалість відповіді (≈10 с + запас)

/** Випадкові n питань; ті, що були в останньому тренуванні, — у кінці черги */
export function pickQuestions(n = DRILL_LEN, recent = store.prof().fluency?.recentQ || []) {
  const shuffled = QUESTIONS.map((q, i) => ({ q, i, r: Math.random() + (recent.includes(i) ? 1 : 0) })).sort((a, b) => a.r - b.r);
  return shuffled.slice(0, n).map(x => ({ ...x.q, idx: x.i }));
}

// ---------- Метрики ----------
const FILLER_RE = /^(?:u+h+|u+m+|uhm+|e+r+|e+r+m+|h+m+|a+h+|m{2,})$/;
/** Нормалізація одного «слова» транскрипції: нижній регістр, без пунктуації по краях */
export function normWord(raw) {
  return String(raw).toLowerCase().replace(/[’‘`ʼ]/g, '\'').replace(/[^a-z0-9'Ѐ-ӿ-]+/g, '').replace(/^[-']+|[-']+$/g, '');
}
export const isFiller = (w) => FILLER_RE.test(w);

/**
 * Розмітка транскрипції: [{ text, kind: 'word'|'filler'|'repeat'|'space' }] — для підсвічування й підрахунку.
 * Повтор — слово, що дослівно повторює попереднє (заминки між ними не рахуються: «I uh I» — теж повтор).
 * «I-I» / «I- I» (обрив слова) розбиваємо на окремі частини.
 */
export function markup(text) {
  const out = [];
  let prev = null;
  for (const part of String(text || '').split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { out.push({ text: part, kind: 'space' }); continue; }
    // «I-I-I», «we- we» — обрив і повтор усередині одного токена
    const pieces = /^([a-z']+)(?:-\1)+[,.!?…]*$/i.test(part) ? part.split('-').map((p, i, a) => i < a.length - 1 ? p + '-' : p) : [part];
    for (const piece of pieces) {
      const w = normWord(piece);
      if (!w) { out.push({ text: piece, kind: 'punct' }); continue; }
      let kind = 'word';
      if (isFiller(w)) kind = 'filler';
      else if (prev && w === prev) kind = 'repeat';
      if (kind !== 'filler') prev = w;
      out.push({ text: piece, kind });
    }
  }
  return out;
}

/** Метрики раунду: words (без заминок), fillers, repeats, wpm, per100 (заминок на 100 слів), sec */
export function analyze(text, sec) {
  const m = markup(text);
  const words = m.filter(x => x.kind === 'word' || x.kind === 'repeat').length;
  const fillers = m.filter(x => x.kind === 'filler').length;
  const repeats = m.filter(x => x.kind === 'repeat').length;
  const s = Math.max(1, Number(sec) || 0);
  return {
    sec: Math.round(s * 10) / 10, words, fillers, repeats,
    wpm: Math.round(words / s * 60),
    per100: words ? Math.round(fillers / words * 1000) / 10 : 0,
    rep100: words ? Math.round(repeats / words * 1000) / 10 : 0,
  };
}

/** Підсумок сесії: загальний темп і заминки на 100 слів по всіх раундах */
export function sessionTotals(rounds) {
  const words = rounds.reduce((a, r) => a + (r.words || 0), 0);
  const sec = rounds.reduce((a, r) => a + (r.sec || 0), 0);
  const fillers = rounds.reduce((a, r) => a + (r.fillers || 0), 0);
  const repeats = rounds.reduce((a, r) => a + (r.repeats || 0), 0);
  return { words, sec, fillers, repeats, wpm: sec ? Math.round(words / sec * 60) : 0, per100: words ? Math.round(fillers / words * 1000) / 10 : 0 };
}

const normPhrase = (s) => String(s).toLowerCase().replace(/[’‘`ʼ]/g, '\'').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const GAMBIT_KEYS = GAMBITS.flatMap(g => [normPhrase(g.en), ...(g.alt || []).map(normPhrase)].map(key => ({ key, en: g.en }))).sort((a, b) => b.key.length - a.key.length);

/**
 * Чи почалась відповідь із фрази «замість uh». Заминки на самому початку не ховаємо — їх повертаємо окремо.
 * → { gambit: 'Well, …' | null, leadFillers: число заминок до першого слова, firstWords: перші слова }
 */
export function gambitStart(text) {
  const toks = markup(text).filter(x => x.kind !== 'space' && x.kind !== 'punct');
  let i = 0;
  while (i < toks.length && toks[i].kind === 'filler') i++;
  const rest = toks.slice(i).filter(x => x.kind !== 'filler').map(x => normWord(x.text)).slice(0, 8);
  const head = rest.join(' ');
  const hit = GAMBIT_KEYS.find(g => head === g.key || head.startsWith(g.key + ' '));
  return { gambit: hit ? hit.en : null, leadFillers: i, firstWords: toks.slice(i, i + 6).map(x => x.text).join(' ') };
}

// ---------- Історія (profiles.data.fluency) ----------
const HISTORY_MAX = 30;
export function fluencyData() { const f = store.prof().fluency; return f && typeof f === 'object' ? f : {}; }
export function history() { return (Array.isArray(fluencyData().history) ? fluencyData().history : []).filter(x => x && Array.isArray(x.rounds) && x.rounds.length); }
export function drills() { return Array.isArray(fluencyData().drills) ? fluencyData().drills : []; }

/** Зберегти сесію 4-3-2 (без текстів — профіль синхронізується між пристроями, лишаємо його легким) */
export function saveSession({ topic, rounds }) {
  const entry = {
    at: new Date().toISOString(), topic: String(topic || '').slice(0, 80),
    rounds: rounds.map(r => ({ sec: r.sec, words: r.words, wpm: r.wpm, fillers: r.fillers, repeats: r.repeats })),
  };
  store.setProf({ fluency: { ...fluencyData(), history: [...history(), entry].slice(-HISTORY_MAX) } });
  return entry;
}
export function saveDrill({ n, ok, fillers, words, qs }) {
  const entry = { at: new Date().toISOString(), n, ok, fillers, words };
  store.setProf({ fluency: { ...fluencyData(), drills: [...drills(), entry].slice(-HISTORY_MAX), recentQ: (qs || []).slice(0, 10) } });
  return entry;
}

// ---------- Запис із мікрофона ----------
export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Формат запису: Chrome/Android — webm/opus, Safari (iOS) — mp4/aac */
export function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* старий Safari */ }
  }
  return '';
}

/** Код помилки мікрофона → 'denied' | 'missing' | 'busy' | 'unsupported' | 'other' */
export function micErrorKind(e) {
  const n = e?.name || '';
  if (e?.code === 'unsupported') return 'unsupported';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'missing';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  return 'other';
}

/**
 * Мікрофон на всю вправу: потік і AudioContext створюються в першому тапі й живуть між раундами
 * (iOS не питає дозволу щоразу), close() — на виході зі сторінки чи після останнього раунду.
 */
export function createMic() {
  let stream = null, ctx = null, analyser = null, source = null, buf = null;
  const live = () => stream && stream.getAudioTracks().some(t => t.readyState === 'live');
  return {
    /** Викликати синхронно на початку обробника тапу (iOS: звук і мікрофон — лише в жесті) */
    async ensure() {
      if (!canRecord()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctx) { try { ctx = new AC(); } catch { ctx = null; } }
      const resumed = ctx?.state === 'suspended' ? ctx.resume().catch(() => {}) : null;
      if (!live()) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        try { source?.disconnect(); } catch { /* */ }
        source = null; analyser = null;
      }
      await resumed;
      if (ctx && !analyser) {
        try {
          source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          buf = new Float32Array(analyser.fftSize);
          source.connect(analyser);
        } catch { analyser = null; }
      }
    },
    /** Гучність зараз: RMS 0…1 (або -1, якщо аналізатор недоступний) */
    level() {
      if (!analyser) return -1;
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    },
    get stream() { return stream; },
    close() {
      try { source?.disconnect(); } catch { /* */ }
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close?.().catch(() => {});
      stream = null; ctx = null; analyser = null; source = null;
    },
  };
}

/**
 * Записати раунд. maxMs — ліміт; onTick({ left, level, voiced, silentMs }) ~10 разів за секунду.
 * Повертає контролер { stop(), cancel(), done: Promise<{ blob, mime, ms, spokenSec, firstVoiceMs } | null> } (null — скасовано).
 * spokenSec — час від першого до останнього звуку голосу (тиша на початку й у кінці, до 5 с, не рахується в темп).
 */
export function recordRound(mic, { maxMs, onTick }) {
  const mime = pickMime();
  const rec = new MediaRecorder(mic.stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  let cancelled = false, firstVoice = -1, lastVoice = -1, floor = 0.01, raf = 0, iv = 0;
  const t0 = performance.now();
  const stopped = new Promise(res => { rec.onstop = res; rec.onerror = res; });
  rec.start();   // без timeslice: iOS Safari (mp4) надійніше віддає один цілий фрагмент
  const halt = () => { if (rec.state !== 'inactive') rec.stop(); };
  const tick = () => {
    const t = performance.now() - t0;
    const lv = mic.level();
    let voiced = false;
    if (lv >= 0) {
      // поріг голосу — над рівнем фонового шуму (адаптивно), але не нижче 0,02
      floor = lv < floor ? lv * 0.5 + floor * 0.5 : floor * 0.998 + lv * 0.002;
      voiced = lv > Math.max(0.02, floor * 3);
      if (voiced) { if (firstVoice < 0) firstVoice = t; lastVoice = t; }
    }
    onTick?.({ left: Math.max(0, maxMs - t), elapsed: t, level: lv < 0 ? -1 : Math.min(1, Math.pow(lv * 8, 0.7)), voiced, silentMs: firstVoice < 0 ? t : t - lastVoice, started: firstVoice >= 0 });
    if (t >= maxMs) halt();
  };
  // rAF — для плавного індикатора; інтервал — запасний (схована вкладка, rAF стоїть)
  const loop = () => { tick(); if (rec.state !== 'inactive') raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  iv = setInterval(tick, 250);
  const done = stopped.then(() => {
    cancelAnimationFrame(raf); clearInterval(iv);
    if (cancelled) return null;
    const ms = Math.min(maxMs + 500, performance.now() - t0);
    const type = (rec.mimeType || mime || 'audio/webm');
    const blob = new Blob(chunks, { type });
    let spoken = ms;
    if (firstVoice >= 0) {
      const lead = Math.min(5000, Math.max(0, firstVoice - 300));
      const tail = Math.min(5000, Math.max(0, ms - lastVoice - 600));
      spoken = Math.max(1000, ms - lead - tail);
    }
    return { blob, mime: type.split(';')[0] || 'audio/webm', ms, spokenSec: Math.round(spoken / 100) / 10, firstVoiceMs: firstVoice >= 0 ? Math.round(firstVoice) : null };
  });
  return {
    stop: halt,
    cancel() { cancelled = true; halt(); },
    get elapsed() { return performance.now() - t0; },
    done,
  };
}
