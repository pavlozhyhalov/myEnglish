// Голосовий режим: Gemini Live у реальному часі + запасний режим «рація»
import { h, ic, emo } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { LiveClient, AudioIO } from './client.js';
import { tutor, aiErrorText } from '../ai.js';
import { user, getSupa } from '../supa.js';
import { speak, stop as stopSpeech, recognize, canRecognize, recordAndTranscribe } from '../speech.js';
import { logSession } from '../stats.js';
import { scenarios as loadScenarios } from '../data.js';
import { setFocus } from '../ui/shell.js';
import { summarize, parseHint, topicIdeas, MISTAKES_TOPIC, focusTopic } from '../pages/tutor.js';
import { go, onLeave } from '../router.js';

const ERR = {
  mic: S.err.mic, mic_missing: S.err.micMissing, quota: S.err.quota, need_login: S.err.needLogin,
  not_allowed: S.err.notAllowed, no_key: S.err.noKey, offline: S.err.offline,
};

const SPEECH_RMS = 0.02;     // поріг «учень говорить» для пакета 100 мс
const PAD = 5;               // запас тиші навколо репліки для запису (пакети по 100 мс)
const CLIP_MAX = 200;        // запис для звіту «до/після» — до 20 с (16 кГц моно 16 біт ≈ 640 КБ)
const CLIP_MIN_SPEECH = 30;  // ≥ 3 с мовлення
const PRON_MIN = 30, PRON_MAX = 150, PRON_KEEP = 3;   // репліки для оцінки вимови: 3–15 с, до трьох найдовших
const PREWARM_WAIT = 8000;   // скільки на тапі чекати незавершене попереднє підключення

/**
 * opts: scenario (id), mission (об'єкт місії — сценарій без id), topic, maxSeconds (для керованої сесії),
 * onFinish(row) — замість підсумку, debug (лог)
 */
export async function voiceSession(view, opts = {}) {
  setFocus(true);
  const st = store.settings();

  let scenario = null;
  if (opts.mission && typeof opts.mission === 'object') scenario = { ...opts.mission, id: null };
  else if (opts.scenario) scenario = (await loadScenarios()).find(s => s.id === opts.scenario) || null;
  const isMission = !!(scenario && opts.mission);

  const row = { mode: 'voice', scenario: scenario?.id || null, title: isMission ? `Місія: ${scenario.title}` : scenario ? `Голос: ${scenario.title}` : (opts.topic ? `Голос: ${opts.topic}` : 'Голосова розмова'), messages: [], summary: null, seconds: 0 };
  if (isMission) row.meta = { mission: opts.mission, topicLabel: `Місія · ${scenario.title}` };
  let started = 0, elapsedBefore = 0, live = null, audio = null, ended = false, micMuted = false, mode = 'live';
  let saved = false, cleaned = false;
  let subsOn = st.voiceSubs !== false;

  // ---------- розмітка ----------
  const timerEl = h('div.num', '00:00');
  const stateEl = h('div.state', 'Підключення…');
  const halo1 = h('div.halo'), halo2 = h('div.halo.h2');
  const aura = h('div.aura', halo1, halo2, h('div.core', emo('teacher')));
  const subs = h('div.subs', { 'aria-live': 'polite', hidden: !subsOn });
  const logBox = opts.debug ? h('pre.xs', { style: { maxHeight: '20dvh', overflow: 'auto', background: 'var(--surface)', padding: '8px', borderRadius: '12px', whiteSpace: 'pre-wrap' } }) : null;
  const notice = h('div.small.center', { style: { maxWidth: '520px' } });
  const ctrl = (icon, label, onclick, cls = '') => h('button.ctrl' + cls, { type: 'button', onclick, 'aria-label': label }, h('span.c', ic(icon, { size: 26, fill: cls.includes('stop') })), h('span', label));
  const micBtn = ctrl('microphone', 'Мікрофон', toggleMic);
  const controls = h('div.controls',
    micBtn,
    ctrl('lightbulb', 'Підказка', hint),
    ctrl('clock', 'Повільніше', slower),
    ctrl('stop', 'Завершити', () => finish(), '.stop'));
  const pttBtn = h('button.ptt', { type: 'button', hidden: true, 'aria-label': 'Утримуйте і говоріть' }, ic('microphone', { size: 40, fill: true }));
  const setSubs = (on) => { subsOn = on; subs.hidden = !subsOn; subsBtn.setAttribute('aria-pressed', String(subsOn)); store.setSetting('voiceSubs', subsOn); renderSubs(); if (fixTotal) paintBadge(); };
  const subsBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Субтитри', 'aria-pressed': String(subsOn), onclick: () => setSubs(!subsOn) }, ic('translate'));
  // лічильник виправлень видно завжди (і коли субтитри сховані); дотик вмикає субтитри
  let fixTotal = 0;
  const fixBadge = h('button.vfix-count', { type: 'button', hidden: true, onclick: () => { if (!subsOn) setSubs(true); } });
  const paintBadge = () => {
    fixBadge.hidden = !fixTotal;
    fixBadge.setAttribute('aria-label', subsOn ? `Виправлень: ${fixTotal}` : `Виправлень: ${fixTotal}. Показати субтитри`);
    fixBadge.replaceChildren(ic('pencil-simple', { size: 14 }), `виправлень: ${fixTotal}`);
  };
  const ui = h('div.voice', { role: 'dialog', 'aria-label': 'Голосова розмова' },
    h('div.top', h('button.icon-btn', { type: 'button', 'aria-label': 'Завершити', onclick: () => finish() }, ic('x')), timerEl, subsBtn),
    h('div.stage', aura, stateEl, fixBadge, notice, scenario ? h('div.xs.dim.center', `${scenario.title} · ваша роль: ${scenario.myRole}`) : null, subs, logBox),
    pttBtn, controls);
  view.replaceChildren(ui);
  // прибирання реєструється одразу: сесія ще чекає тапу «Почати розмову», а користувач може піти
  onLeave(view, cleanup);

  const logLines = [`${new Date().toISOString()} start · ${navigator.userAgent}`];
  const log = (t) => {
    const line = `[${new Date().toLocaleTimeString()}] ${t}`;
    logLines.push(line);
    try { localStorage.setItem('me:voice-log', logLines.slice(-200).join('\n')); } catch { /* */ }
    if (logBox) { logBox.textContent += line + '\n'; logBox.scrollTop = 1e9; }
  };
  const setState = (t) => { stateEl.textContent = t; };

  // ---------- субтитри / транскрипт ----------
  function addText(role, text) {
    const last = row.messages[row.messages.length - 1];
    if (last && last.role === role && !last.closed) last.text += text;
    else row.messages.push({ role, text });
    renderSubs();
  }
  function closeTurns() { const last = row.messages[row.messages.length - 1]; if (last) last.closed = true; }
  function renderSubs() {
    if (!subsOn) return;
    const recent = row.messages.slice(-6).filter(m => m.text.trim());
    // виправлення — під двома останніми репліками учня (старіші й так прокручуються вгору; загальна кількість — на лічильнику)
    const withFix = new Set(recent.filter(m => m.role === 'user').slice(-2));
    subs.replaceChildren(...recent.flatMap(m => {
      const line = h('div.line' + (m.role === 'user' ? '.me' : '') + (m.pending ? '.pending' : ''),
        m.text.trim(), m.pending ? h('span.xs.dim', ' · уточнюю…') : null);
      return m.fixes?.length && withFix.has(m) ? [line, h('div.vfixes', m.fixes.map(fixChip))] : [line];
    }));
    subs.scrollTop = subs.scrollHeight;
  }

  // ---------- миттєві виправлення: дотик озвучує правильний варіант ----------
  let fixPlaying = false, pttTalking = false;
  function fixChip(f) {
    const b = h('button.vfix', { type: 'button', 'aria-label': `${f.wrong} — правильно: ${f.right}${f.why_uk ? `. ${f.why_uk}` : ''}. Прослухати` },
      h('span.vfix-line', { lang: 'en' }, h('s', f.wrong), h('span.vfix-arrow', { 'aria-hidden': 'true' }, ' → '), h('b', f.right)),
      f.why_uk ? h('span.vfix-why', f.why_uk) : null);
    b.addEventListener('click', () => sayFix(f, b));
    return b;
  }
  async function sayFix(f, el) {
    if (fixPlaying) return;
    // не перебиваємо вчителя: поки він говорить, дотик лише підсвічує, що треба зачекати
    if (tutorTalking || pttTalking) { el.classList.remove('wait'); void el.offsetWidth; el.classList.add('wait'); return; }
    fixPlaying = true; el.classList.add('playing');
    // мікрофон на час озвучення приглушено — інакше Live почує підказку як репліку учня
    audio?.mute(true);
    try { await speak(f.right, { engine: st.ttsEngine, geminiVoice: st.voice }); } catch (e) { log('fix speak failed ' + (e?.message || e)); }
    finally { fixPlaying = false; audio?.mute(micMuted); el.classList.remove('playing'); }
  }
  // порівняння як на сервері (coach.ts norm): без розділових знаків — інакше «went, there» відкидає вже перевірене виправлення
  const normT = (s) => ` ${String(s).toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  const cleanFixes = (arr, text) => (Array.isArray(arr) ? arr : [])
    .map(f => ({ wrong: String(f?.wrong ?? '').trim().slice(0, 120), right: String(f?.right ?? '').trim().slice(0, 160), why_uk: String(f?.why_uk ?? '').trim().slice(0, 200) }))
    .filter(f => f.wrong && f.right && normT(f.wrong) !== normT(f.right) && normT(text).includes(normT(f.wrong)))
    .slice(0, 2);

  // ---------- точне розпізнавання реплік учня ----------
  // Live визначає мову автоматично й часто записує англійську з акцентом іншою мовою/алфавітом.
  // Тому кожну репліку учня (аудіо з мікрофона між репліками вчителя) повторно розпізнаємо як англійську
  // мову учня-українця — це бачить учень у субтитрах, і саме цей текст іде в підсумок та оцінку рівня.
  // Заодно сервер повертає до 2 миттєвих виправлень (check: true).
  let seg = [], segFlags = [], segSpeech = 0, tutorTalking = false, cutIdx = 0;
  let speechPackets = 0;           // скільки пакетів по 100 мс учень справді говорив (для темпу)
  let clipTurn = null;             // найдовша репліка ≤ 20 с — для звіту «до/після»
  const pronCands = [];            // до трьох найдовших реплік 3–15 с — для оцінки вимови (лише в пам'яті)
  const jobs = new Set();
  const MAX_SEG = 300;   // ~30 с (пакети по 100 мс)
  function onPcm(buf, rms) {
    if (tutorTalking || micMuted || fixPlaying) return;
    const sp = rms > SPEECH_RMS;
    seg.push(buf); segFlags.push(sp);
    if (sp) { segSpeech++; speechPackets++; }
    if (seg.length > MAX_SEG) { seg.shift(); if (segFlags.shift()) segSpeech--; }
  }
  function trimTurn(chunks, flags) {
    const a = flags.indexOf(true), b = flags.lastIndexOf(true);
    if (a < 0) return null;
    const part = chunks.slice(Math.max(0, a - PAD), Math.min(chunks.length, b + PAD + 1));
    return { chunks: part, sec: part.length / 10 };
  }
  function keepTurn(t) {
    if (t.speech >= CLIP_MIN_SPEECH && t.chunks.length <= CLIP_MAX && (!clipTurn || t.speech > clipTurn.speech)) clipTurn = t;
    if (t.chunks.length >= PRON_MIN && t.chunks.length <= PRON_MAX) {
      pronCands.push(t);
      pronCands.sort((x, y) => y.speech - x.speech);
      pronCands.length = Math.min(PRON_KEEP, pronCands.length);
    }
  }
  function cutSegment() {
    const chunks = seg, flags = segFlags, speech = segSpeech;
    seg = []; segFlags = []; segSpeech = 0;
    const from = cutIdx; cutIdx = row.messages.length;
    const users = row.messages.slice(from).filter(m => m.role === 'user');
    if (speech < 5 || mode !== 'live') return;   // < ~0,5 с мовлення — нічого уточнювати
    let target = users[users.length - 1];
    if (!target) {   // Live не розпізнав нічого — додаємо репліку перед відповіддю вчителя
      target = { role: 'user', text: '', closed: true };
      const mi = row.messages.findIndex((m, i) => i >= from && m.role === 'model');
      row.messages.splice(mi < 0 ? row.messages.length : mi, 0, target);
    }
    for (const u of users) if (u !== target) u.text = '';   // кілька шматків однієї репліки зливаються в один
    target.pending = true; renderSubs();
    const turn = trimTurn(chunks, flags);
    const job = tutor('transcribe', { audio: b64(wavBytes(chunks)), mime: 'audio/wav', hint: 'learner', check: true })
      .then(r => {
        const text = String(r?.text || '').trim();
        if (!text || /^\[?unclear\]?$/i.test(text)) return;
        target.text = text;
        const fx = cleanFixes(r.fixes, text);
        if (fx.length) { target.fixes = fx; fixTotal += fx.length; paintBadge(); log(`fixes ${fx.length}`); }
        if (turn) keepTurn({ msg: target, chunks: turn.chunks, sec: turn.sec, speech });
      })
      .catch(e => log('transcribe failed ' + (e.code || e.message)))
      .finally(() => { target.pending = false; renderSubs(); jobs.delete(job); });
    jobs.add(job);
  }
  function wavBytes(chunks) {
    const n = chunks.reduce((a, c) => a + c.byteLength, 0);
    const out = new Uint8Array(44 + n), dv = new DataView(out.buffer);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) out[o + i] = str.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n, true);
    let o = 44; for (const c of chunks) { out.set(new Uint8Array(c), o); o += c.byteLength; }
    return out;
  }
  function b64(bytes) {
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // ---------- аура ----------
  let micLevel = 0, outLevel = 0, raf = 0, lastRms = 0;
  function animate() {
    const lv = Math.max(micLevel * 3, outLevel * 3);
    const me = micLevel * 3 > outLevel * 3 && micLevel > 0.02;
    aura.classList.toggle('me', me);
    halo1.style.transform = `scale(${1 + Math.min(0.5, lv)})`;
    halo2.style.transform = `scale(${1 + Math.min(0.35, lv * 0.7)})`;
    aura.querySelector('.core').style.transform = `scale(${1 + Math.min(0.12, lv * 0.2)})`;
    if (started) {
      const s = elapsed();
      timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      if (opts.maxSeconds && s >= opts.maxSeconds && !ended) finish();
    }
    raf = requestAnimationFrame(animate);
  }
  const elapsed = () => Math.floor(elapsedBefore + (started ? (Date.now() - started) / 1000 : 0));
  raf = requestAnimationFrame(animate);

  if (!user()) { fail({ code: 'need_login' }); return cleanup; }
  if (!navigator.onLine) { fail({ code: 'offline' }); return cleanup; }

  // ---------- попереднє підключення: токен і WebSocket готуються, поки учень дивиться на панель старту ----------
  // Тема з чипів у токен не потрапляє (її ще не обрано) — вона йде в першу репліку-сигнал. Сценарій/місія і тема
  // з посилання відомі заздалегідь — вони в токені. Мікрофон і таймер вмикаються лише після тапу.
  const scenData = scenario ? { title: scenario.title, situation: scenario.situation, myRole: scenario.myRole, tutorRole: scenario.tutorRole, goal: scenario.goal, phrases: scenario.phrases } : null;
  let tapped = false, warm = null, warmClient = null, warmTries = 0;
  const makeLive = () => {
    // до тапу topic = opts.topic; після тапу — і тема з чипа (тоді вона в системному промпті нового токена)
    const lc = new LiveClient({ scenario: scenData, topic: topic || null, voice: st.voice });
    lc.addEventListener('log', e => log((tapped ? '' : 'prewarm · ') + e.detail));
    return lc;
  };
  function prewarm() {
    if (tapped || ended || warmTries >= 2 || !navigator.onLine) return;
    warmTries++;
    const lc = makeLive(), t0 = Date.now();
    warmClient = lc;
    // з'єднання обірвалось до тапу (простій, мережа, фон на iPhone) — закриваємо й готуємо нове зі свіжим токеном
    const dropped = () => {
      if (tapped || warmClient !== lc) return;
      log('prewarm: socket dropped before tap');
      try { lc.close(); } catch { /* */ }
      warmClient = null; warm = null;
      prewarm();
    };
    lc.addEventListener('reconnecting', dropped);
    lc.addEventListener('error', dropped);
    warm = lc.connect().then(() => { log(`prewarm ready · ${Date.now() - t0} ms`); return lc; }, (e) => {
      log('prewarm failed: ' + (e?.code || '') + ' ' + (e?.message || ''));
      if (warmClient === lc) warmClient = null;
      try { lc.close(); } catch { /* */ }
      return null;
    });
  }
  /** На тапі: готовий попередній клієнт або null (тоді підключаємось як раніше) */
  async function takeWarm() {
    if (!warm) return null;
    const lc = await Promise.race([warm, new Promise(r => setTimeout(() => r('slow'), PREWARM_WAIT))]);
    if (lc === 'slow') { log('prewarm too slow — connecting anew'); try { warmClient?.close(); } catch { /* */ } warmClient = null; return null; }
    if (!lc) return null;
    if (!lc.open) { log('prewarm socket not open — connecting anew'); try { lc.close(); } catch { /* */ } return null; }
    return lc;
  }

  // ---------- старт Live: лише по тапу — iOS вмикає звук і мікрофон тільки в момент жесту ----------
  setState('Усе готово до розмови');
  const savedControls = [...controls.childNodes];
  let topic = opts.topic || null, chipTopic = null;
  prewarm();
  await new Promise((resolve) => {
    const begin = (t) => {
      tapped = true;
      audio = new AudioIO().prepare();     // синхронно, в жесті
      if (t) { topic = chipTopic = t.topic; row.title = `Голос: ${t.label}`; }
      controls.replaceChildren(...savedControls);
      notice.replaceChildren();
      resolve();
    };
    const startBtn = h('button.btn.primary.lg', { type: 'button', style: { minWidth: '240px' }, onclick: () => begin(null) }, ic('microphone', { fill: true }), 'Почати розмову');
    controls.replaceChildren(startBtn, h('button.btn.ghost', { type: 'button', onclick: () => {
      ended = true; cleanup(); resolve();
      if (opts.onFinish) opts.onFinish(row); else go('/tutor', { replace: true });
    } }, 'Назад'));
    const tip = 'Порада: у навушниках вчитель чує вас краще.';
    // вільна розмова: можна одразу обрати, про що говорити (тап по темі теж стартує сесію)
    if (!scenario && !topic && !opts.onFinish) {
      const focus = store.prof()?.lastFocus;
      const picks = [MISTAKES_TOPIC, ...(focus ? [focusTopic(focus)] : []), ...topicIdeas().slice(0, 5)];
      notice.replaceChildren(h('div.stack.voice-topics', { style: { gap: '8px' } },
        h('div.xs.dim', 'Тема (необов\'язково) — або просто почніть, і вчитель запропонує сам:'),
        h('div.chips', { style: { justifyContent: 'center' } }, picks.map(t => h('button.chip', { type: 'button', onclick: () => begin(t) }, t.label))),
        h('div.xs.dim', tip)));
    } else notice.textContent = tip;
  });
  if (ended) return cleanup;
  setState('Підключення…'); notice.textContent = '';
  try {
    const liveP = takeWarm();
    const info = await audio.start();
    log(`audio ok · in ${info.inRate} Hz (${info.inState}) · out ${info.outRate} Hz (${info.outState})`);
    audio.addEventListener('mic-level', e => { micLevel = e.detail; lastRms = e.detail; });
    audio.addEventListener('out-level', e => { outLevel = e.detail; });
    audio.addEventListener('speaking', () => { tutorTalking = true; cutSegment(); if (mode === 'live') setState(`Говорить ${st.tutorName}`); });
    audio.addEventListener('idle', () => { tutorTalking = false; if (mode === 'live' && live?.ready) setState(micMuted ? 'Мікрофон вимкнено' : 'Слухаю…'); });

    const pre = await liveP;
    if (ended) { try { pre?.close(); } catch { /* */ } return cleanup; }
    live = pre || makeLive();
    // тема з чипа — і для нових токенів (перепідключення без handle відкриває нову сесію з промптом токена)
    if (chipTopic) live.opts.topic = chipTopic;
    warmClient = null;
    log(pre ? 'using prewarmed session' : 'connecting on tap');
    live.addEventListener('audio', e => audio?.play(e.detail));
    live.addEventListener('interrupted', () => { audio?.clear(); closeTurns(); });
    live.addEventListener('input', e => addText('user', e.detail));
    live.addEventListener('output', e => addText('model', e.detail));
    live.addEventListener('turn', closeTurns);
    live.addEventListener('reconnecting', () => { if (!ended) setState(S.err.network); });
    live.addEventListener('ready', () => { setState('Слухаю…'); notice.textContent = ''; });
    live.addEventListener('error', e => { log('error ' + e.detail?.message); switchToFallback(e.detail); });

    if (!pre) await live.connect();
    if (ended) return cleanup;
    started = Date.now();
    setState('Слухаю…');
    // вчитель починає першим; тему з чипа передаємо тут (у токені її немає)
    const safeTopic = chipTopic ? chipTopic.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300).replace(/[.!?;,\s]+$/, '') : '';
    live.sendText(scenario ? '(Start the role-play now with your first line.)'
      : safeTopic ? `(The student is ready. Session topic from the app: ${safeTopic}. Greet them briefly and start on this topic.)`
        : '(The student is ready. Greet them briefly and start the conversation.)');
    // мікрофон іде в Live лише тепер — після тапу і готового з'єднання
    audio.addEventListener('pcm', e => { live?.sendAudio(e.detail); onPcm(e.detail, e.rms ?? lastRms); });
  } catch (e) {
    log('start failed: ' + (e.code || '') + ' ' + e.message);
    try { warmClient?.close(); } catch { /* */ }
    warmClient = null;
    if (ended) return cleanup;
    if (['mic', 'mic_missing', 'need_login', 'not_allowed', 'offline'].includes(e.code)) { fail(e); return cleanup; }
    switchToFallback(e);
  }

  function fail(e) {
    setState('');
    notice.replaceChildren(h(e.code === 'need_login' ? 'div.notice' : 'div.feedback.no', ERR[e.code] || aiErrorText(e) || S.err.generic),
      e.code === 'need_login' ? h('a.btn.primary', { href: '#/auth', style: { marginTop: '12px' } }, 'Увійти') : null);
    // у тесті рівня — повертаємось у тест (він зарахує «розмову не вдалося оцінити»), інакше — до вчителя
    controls.replaceChildren(h('button.btn.soft', { type: 'button', onclick: () => { if (opts.onFinish) { ended = true; cleanup(); opts.onFinish(row); } else go('/tutor', { replace: true }); } }, 'Назад'));
  }

  // ---------- запасний режим «рація» ----------
  function switchToFallback(err) {
    if (mode === 'ptt' || ended) return;
    mode = 'ptt';
    if (started) { elapsedBefore = elapsed(); started = Date.now(); } else started = Date.now();
    try { live?.close(); } catch { /* */ }
    audio?.stop(); audio = null; micLevel = outLevel = 0; tutorTalking = false;
    const why = err?.code === 'quota' ? S.err.quota : err?.code === 'no_key' ? S.err.noKey : `Live недоступний${err?.message ? ` (${String(err.message).slice(0, 80)})` : ''} — перемкнулись на режим «рація».`;
    // перехід на «рацію» — інформація, а не помилка (помилки квоти/ключа нижче йдуть у fail)
    notice.replaceChildren(h('div.notice', why), h('div.xs.dim', { style: { marginTop: '6px' } }, 'Утримуйте кнопку, говоріть, відпустіть — вчитель відповість голосом.'));
    if (err?.code === 'quota' || err?.code === 'no_key' || err?.code === 'not_allowed') { fail(err); return; }
    setState('Режим «рація»');
    pttBtn.hidden = false;
    controls.replaceChildren(ctrl('lightbulb', 'Підказка', hint), ctrl('clock', 'Повільніше', slower), ctrl('stop', 'Завершити', () => finish(), '.stop'));
    let ac = null, busy = false;
    const say = async (text) => {
      pttTalking = true;
      try { await speak(text.replace(/[*_#]/g, ''), { engine: st.ttsEngine, geminiVoice: st.voice }); } finally { pttTalking = false; }
    };
    const down = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;     // друге натискання під час розпізнавання не запускає ще одне
      stopSpeech(); pttTalking = false;
      pttBtn.classList.add('rec'); setState('Говоріть…');
      ac = new AbortController();
      try {
        const res = canRecognize() ? await recognize({ signal: ac.signal, onInterim: t => { notice.textContent = t; } }) : await recordAndTranscribe({ signal: ac.signal, maxMs: 30000 });
        pttBtn.classList.remove('rec');
        if (!res.text) { setState('Нічого не почуто. Спробуйте ще раз'); return; }
        notice.textContent = '';
        addText('user', res.text); closeTurns();
        setState(`${st.tutorName} думає…`);
        const reply = await tutor('chat', { stream: false, voice: true, mode: scenario ? 'scenario' : 'chat', scenarioData: scenData, topic, messages: row.messages.map(m => ({ role: m.role, text: m.text })) });
        addText('model', reply.text); closeTurns();
        setState(`Говорить ${st.tutorName}`);
        aura.classList.remove('me');
        await say(reply.text);
        setState('Утримуйте кнопку і говоріть');
      } catch (er) {
        pttBtn.classList.remove('rec');
        setState(er.code === 'mic' || er.name === 'NotAllowedError' ? S.err.mic : (aiErrorText(er) || S.err.generic));
      } finally { busy = false; }
    };
    const up = () => { pttBtn.classList.remove('rec'); ac?.abort(); };
    pttBtn.addEventListener('pointerdown', down);
    pttBtn.addEventListener('pointerup', up);
    pttBtn.addEventListener('pointerleave', up);
    pttBtn.addEventListener('contextmenu', e => e.preventDefault());
    // клавіатура: утримуйте пробіл або Enter на кнопці
    pttBtn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
    pttBtn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });
    // перше повідомлення від вчителя
    if (!row.messages.length) {
      (async () => {
        try {
          setState(`${st.tutorName} думає…`);
          const reply = await tutor('chat', { stream: false, voice: true, mode: scenario ? 'scenario' : 'chat', scenarioData: scenData, topic, messages: [] });
          addText('model', reply.text); closeTurns();
          await say(reply.text);
          setState('Утримуйте кнопку і говоріть');
        } catch (er) { fail(er); }
      })();
    }
  }

  // ---------- кнопки ----------
  function toggleMic() {
    micMuted = !micMuted;
    audio?.mute(micMuted);
    micBtn.classList.toggle('on', micMuted);
    micBtn.querySelector('.c').replaceChildren(ic(micMuted ? 'microphone-slash' : 'microphone', { size: 26 }));
    setState(micMuted ? 'Мікрофон вимкнено' : 'Слухаю…');
  }
  async function hint() {
    if (mode === 'live' && live?.sendText('(The student asks for a hint: briefly suggest 3 short options for how they could answer, then wait.)')) return;
    try {
      notice.textContent = 'Підказка…';
      const r = await tutor('hint', { messages: row.messages.map(m => ({ role: m.role, text: m.text })) });
      const opts = parseHint(r.text);
      notice.replaceChildren(opts.length
        ? h('div.card.tight.voice-hint', h('div.xs.dim', 'Можна відповісти так:'), h('ol', { lang: 'en' }, opts.map(o => h('li', o))))
        : h('div.card.tight', { style: { textAlign: 'left', whiteSpace: 'pre-wrap' } }, r.text));
    } catch (e) { notice.textContent = aiErrorText(e); }
  }
  function slower() {
    if (mode === 'live') live?.sendText('(Please speak more slowly and use simpler words from now on.)');
    else { store.setSetting('rate', Math.max(0.7, (store.settings().rate || 1) - 0.15)); notice.textContent = 'Озвучення сповільнено'; }
  }

  // ---------- метрики мовлення ----------
  const FILLER = /^(?:u+m+|u+h+|e+r+|e+r+m+|h+m+)$/;
  /** Слова, темп, довжина реплік, повтори, «е-е», різноманітність — з остаточних (уточнених) реплік учня */
  function speechMetrics() {
    const turns = row.messages.filter(m => m.role === 'user' && m.text);
    let words = 0, repeats = 0, fillers = 0;
    const uniq = new Set();
    for (const m of turns) {
      const toks = m.text.toLowerCase().replace(/[’`]/g, "'").match(/[a-z]+(?:'[a-z]+)*/g) || [];
      let prev = null;
      for (const w of toks) {
        if (FILLER.test(w)) { fillers++; continue; }
        words++; uniq.add(w);
        if (w === prev) repeats++;
        prev = w;
      }
    }
    if (!words) return null;
    const speechSec = Math.round(speechPackets) / 10;
    return {
      words, speech_sec: speechSec,
      wpm: speechSec >= 10 ? Math.round(words / (speechSec / 60)) : 0,   // замало виміряного мовлення (напр. «рація») — темп не рахуємо
      avg_len: Math.round(words / turns.length * 10) / 10,
      repeats, fillers,
      unique_ratio: Math.round(uniq.size / words * 100) / 100,
      turns: turns.length,
    };
  }

  /** Запис найдовшої репліки → приватне сховище (для звіту «до/після»). Ніколи не блокує завершення. */
  async function uploadClip(t, sec) {
    const u = user();
    if (!u || !row.id) return;
    const text = String(t.msg.text || '').trim();
    const path = `${u.id}/${new Date().toISOString().slice(0, 7)}/${row.id}.wav`;
    const sb = await getSupa();
    // без upsert: перезапис вимагає ще політики update, якої в бакета немає (міграція 0015) — шлях і так унікальний (id розмови)
    const { error } = await sb.storage.from('voice-clips').upload(path, new Blob([wavBytes(t.chunks)], { type: 'audio/wav' }), { upsert: false, contentType: 'audio/wav' });
    if (error) throw error;
    // підсумок міг уже прийти й замінити row.summary — дописуємо в поточний
    row.summary = row.summary || { partial: true };
    row.summary.clip = { path, text, sec };
    store.put('tutor_chats', row);
    log(`clip uploaded · ${sec}s`);
  }

  /** Зберегти розмову і час (час прив'язаний до розмови — видалиш її, зникне і зі статистики) */
  function save() {
    if (saved) return;
    saved = true;
    const seconds = elapsed();
    row.seconds = seconds;
    row.messages = row.messages.map(({ role, text, fixes }) => {
      const m = { role, text: (text || '').trim() };
      if (role === 'user' && fixes?.length) m.fixes = fixes;
      return m;
    }).filter(m => m.text);
    const speech = speechMetrics();
    // у tutor_chats немає окремої колонки для метрик — тримаємо їх у summary (синхронізується), підсумок їх збереже
    if (speech) { if (!row.summary) row.summary = { partial: true, speech }; else row.summary.speech = speech; }
    if (row.messages.length) store.put('tutor_chats', row);
    if (seconds > 5) {
      logSession('voice', seconds, row.id || null);
      if (mode === 'live') tutor('usage', { voice_seconds: seconds }).catch(() => {});
    }
    // у керованих сесіях (тест, заняття) підсумок перезаписує їхній код — запис туди не кладемо
    if (clipTurn && row.id && row.messages.length && seconds >= 60 && !opts.onFinish && clipTurn.msg.text?.trim()) {
      const t = clipTurn, sec = Math.round(t.chunks.length) / 10;
      uploadClip(t, sec).catch(e => log('clip upload failed ' + (e?.message || e)));
    }
    log(`end · ${seconds}s · msgs ${row.messages.length} (user ${row.messages.filter(m => m.role === 'user').length}) · speech ${speech ? `${speech.words}w/${speech.speech_sec}s` : '—'}`);
  }

  async function finish() {
    if (ended) return;
    ended = true;
    // остання репліка учня ще не уточнена — уточнюємо й чекаємо (до 12 с), щоб підсумок і оцінка рахувались з правильного тексту
    if (mode === 'live' && !tutorTalking) cutSegment();
    if (jobs.size) {
      setState('Уточнюю ваші репліки…');
      await Promise.race([Promise.allSettled([...jobs]), new Promise(r => setTimeout(r, 12000))]);
    }
    try { cleanup(); } catch (e) { log('cleanup error ' + e.message); }
    try { save(); } catch (e) { log('save error ' + e.message); }
    if (opts.onFinish) return opts.onFinish(row);
    if (!row.messages.some(m => m.role === 'user')) {
      // голос учня не розпізнано — пояснюємо, а не мовчки виходимо
      setFocus(false);
      view.replaceChildren(h('div.hero', emo('mic', 'xl'), h('h2', 'Розмову завершено'),
        h('p.dim', row.messages.length ? 'Вашої відповіді не було чути. Перевірте, що браузеру дозволено мікрофон (на iPhone: Налаштування → Safari → Мікрофон), і спробуйте ще раз — краще в навушниках.' : 'Розмова не почалася: не вдалося з\'єднатися із вчителем.'),
        h('div.row', h('a.btn.soft', { href: '#/tutor' }, 'До вчителя'), h('a.btn.primary', { href: '#/tutor?mode=voice', onclick: (e) => { e.preventDefault(); const nv = h('div'); view.replaceChildren(nv); voiceSession(nv, opts); } }, 'Спробувати ще раз')),
        h('a.small', { href: '#/lab/live' }, 'Діагностика голосу')));
      return;
    }
    // репліки для оцінки вимови на екрані підсумку: лише в пам'яті, текст — уточнений, до 200 символів
    const pronTurns = [];
    for (const t of pronCands) {
      const text = String(t.msg.text || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 200 || !/[a-z]/i.test(text)) continue;
      try { pronTurns.push({ text, sec: t.sec, audio: b64(wavBytes(t.chunks)) }); } catch { /* */ }
    }
    await summarize(view, row, { voice: true, pronTurns });
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    cancelAnimationFrame(raf);
    try { warmClient?.close(); } catch { /* */ }
    try { live?.close(); } catch { /* */ }
    try { audio?.stop(); } catch { /* */ }
    stopSpeech();
    setFocus(false);
    // пішли зі сторінки без «Завершити» — все одно зберігаємо
    if (!ended) { ended = true; save(); }
  }
  return cleanup;
}
