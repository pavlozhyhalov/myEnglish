// Голосовий режим: Gemini Live у реальному часі + запасний режим «рація»
import { h, ic, emo } from '../ui/dom.js';
import { S } from '../strings.js';
import * as store from '../store.js';
import { LiveClient, AudioIO } from './client.js';
import { tutor, aiErrorText } from '../ai.js';
import { user } from '../supa.js';
import { speak, stop as stopSpeech, recognize, canRecognize, recordAndTranscribe } from '../speech.js';
import { logSession } from '../stats.js';
import { scenarios as loadScenarios } from '../data.js';
import { setFocus } from '../ui/shell.js';
import { summarize, parseHint } from '../pages/tutor.js';
import { go, onLeave } from '../router.js';

const ERR = {
  mic: S.err.mic, mic_missing: S.err.micMissing, quota: S.err.quota, need_login: S.err.needLogin,
  not_allowed: S.err.notAllowed, no_key: S.err.noKey, offline: S.err.offline,
};

/**
 * opts: scenario (id), topic, maxSeconds (для керованої сесії), onFinish(row) — замість підсумку, debug (лог)
 */
export async function voiceSession(view, opts = {}) {
  setFocus(true);
  const st = store.settings();

  let scenario = null;
  if (opts.scenario) scenario = (await loadScenarios()).find(s => s.id === opts.scenario) || null;

  const row = { mode: 'voice', scenario: scenario?.id || null, title: scenario ? `Голос: ${scenario.title}` : (opts.topic ? `Голос: ${opts.topic}` : 'Голосова розмова'), messages: [], summary: null, seconds: 0 };
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
  const subsBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Субтитри', 'aria-pressed': String(subsOn), onclick: () => { subsOn = !subsOn; subs.hidden = !subsOn; subsBtn.setAttribute('aria-pressed', String(subsOn)); store.setSetting('voiceSubs', subsOn); } }, ic('translate'));
  const ui = h('div.voice', { role: 'dialog', 'aria-label': 'Голосова розмова' },
    h('div.top', h('button.icon-btn', { type: 'button', 'aria-label': 'Завершити', onclick: () => finish() }, ic('x')), timerEl, subsBtn),
    h('div.stage', aura, stateEl, notice, scenario ? h('div.xs.dim.center', `${scenario.title} · ваша роль: ${scenario.myRole}`) : null, subs, logBox),
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
    const recent = row.messages.slice(-6).filter(m => m.text.trim());
    subs.replaceChildren(...recent.map(m => h('div.line' + (m.role === 'user' ? '.me' : '') + (m.pending ? '.pending' : ''),
      m.text.trim(), m.pending ? h('span.xs.dim', ' · уточнюю…') : null)));
    subs.scrollTop = subs.scrollHeight;
  }

  // ---------- точне розпізнавання реплік учня ----------
  // Live визначає мову автоматично й часто записує англійську з акцентом іншою мовою/алфавітом.
  // Тому кожну репліку учня (аудіо з мікрофона між репліками вчителя) повторно розпізнаємо як англійську
  // мову учня-українця — це бачить учень у субтитрах, і саме цей текст іде в підсумок та оцінку рівня.
  let seg = [], segSpeech = 0, tutorTalking = false, cutIdx = 0;
  const fixes = new Set();
  const MAX_SEG = 300;   // ~30 с (пакети по 100 мс)
  function onPcm(buf, rms) {
    if (tutorTalking || micMuted) return;
    seg.push(buf); if (rms > 0.02) segSpeech++;
    if (seg.length > MAX_SEG) seg.shift();
  }
  function cutSegment() {
    const chunks = seg, speech = segSpeech;
    seg = []; segSpeech = 0;
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
    const job = tutor('transcribe', { audio: wavBase64(chunks), mime: 'audio/wav', hint: 'learner' })
      .then(r => { if (r?.text && r.text.trim() && !/^\[?unclear\]?$/i.test(r.text.trim())) target.text = r.text.trim(); })
      .catch(e => log('transcribe failed ' + (e.code || e.message)))
      .finally(() => { target.pending = false; renderSubs(); fixes.delete(job); });
    fixes.add(job);
  }
  function wavBase64(chunks) {
    const n = chunks.reduce((a, c) => a + c.byteLength, 0);
    const out = new Uint8Array(44 + n), dv = new DataView(out.buffer);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) out[o + i] = str.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n, true);
    let o = 44; for (const c of chunks) { out.set(new Uint8Array(c), o); o += c.byteLength; }
    let bin = ''; for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
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

  // ---------- старт Live: лише по тапу — iOS вмикає звук і мікрофон тільки в момент жесту ----------
  setState('Усе готово до розмови');
  const savedControls = [...controls.childNodes];
  await new Promise((resolve) => {
    const startBtn = h('button.btn.primary.lg', { type: 'button', style: { minWidth: '240px' }, onclick: () => {
      audio = new AudioIO().prepare();     // синхронно, в жесті
      controls.replaceChildren(...savedControls);
      resolve();
    } }, ic('microphone', { fill: true }), 'Почати розмову');
    controls.replaceChildren(startBtn, h('button.btn.ghost', { type: 'button', onclick: () => {
      ended = true; cleanup(); resolve();
      if (opts.onFinish) opts.onFinish(row); else go('/tutor', { replace: true });
    } }, 'Назад'));
    notice.textContent = 'Порада: у навушниках вчитель чує вас краще.';
  });
  if (ended) return cleanup;
  setState('Підключення…'); notice.textContent = '';
  try {
    const info = await audio.start();
    log(`audio ok · in ${info.inRate} Hz (${info.inState}) · out ${info.outRate} Hz (${info.outState})`);
    audio.addEventListener('mic-level', e => { micLevel = e.detail; });
    audio.addEventListener('out-level', e => { outLevel = e.detail; });
    audio.addEventListener('speaking', () => { tutorTalking = true; cutSegment(); if (mode === 'live') setState(`Говорить ${st.tutorName}`); });
    audio.addEventListener('idle', () => { tutorTalking = false; if (mode === 'live' && live?.ready) setState(micMuted ? 'Мікрофон вимкнено' : 'Слухаю…'); });

    const scenData = scenario ? { title: scenario.title, situation: scenario.situation, myRole: scenario.myRole, tutorRole: scenario.tutorRole, goal: scenario.goal, phrases: scenario.phrases } : null;
    live = new LiveClient({ scenario: scenData, topic: opts.topic, voice: st.voice });
    live.addEventListener('log', e => log(e.detail));
    live.addEventListener('audio', e => audio?.play(e.detail));
    live.addEventListener('interrupted', () => { audio.clear(); closeTurns(); });
    live.addEventListener('input', e => addText('user', e.detail));
    live.addEventListener('output', e => addText('model', e.detail));
    live.addEventListener('turn', closeTurns);
    live.addEventListener('reconnecting', () => { setState(S.err.network); });
    live.addEventListener('ready', () => { setState('Слухаю…'); notice.textContent = ''; });
    live.addEventListener('error', e => { log('error ' + e.detail?.message); switchToFallback(e.detail); });
    audio.addEventListener('pcm', e => { live.sendAudio(e.detail); onPcm(e.detail, lastRms); });
    audio.addEventListener('mic-level', e => { lastRms = e.detail; });

    await live.connect();
    started = Date.now();
    setState('Слухаю…');
    // вчитель починає першим
    live.sendText(scenario ? '(Start the role-play now with your first line.)' : '(The student is ready. Greet them briefly and start the conversation.)');
  } catch (e) {
    log('start failed: ' + (e.code || '') + ' ' + e.message);
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
    audio?.stop(); audio = null; micLevel = outLevel = 0;
    const why = err?.code === 'quota' ? S.err.quota : err?.code === 'no_key' ? S.err.noKey : `Live недоступний${err?.message ? ` (${String(err.message).slice(0, 80)})` : ''} — перемкнулись на режим «рація».`;
    // перехід на «рацію» — інформація, а не помилка (помилки квоти/ключа нижче йдуть у fail)
    notice.replaceChildren(h('div.notice', why), h('div.xs.dim', { style: { marginTop: '6px' } }, 'Утримуйте кнопку, говоріть, відпустіть — вчитель відповість голосом.'));
    if (err?.code === 'quota' || err?.code === 'no_key' || err?.code === 'not_allowed') { fail(err); return; }
    setState('Режим «рація»');
    pttBtn.hidden = false;
    controls.replaceChildren(ctrl('lightbulb', 'Підказка', hint), ctrl('clock', 'Повільніше', slower), ctrl('stop', 'Завершити', () => finish(), '.stop'));
    let ac = null, busy = false;
    const down = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;     // друге натискання під час розпізнавання не запускає ще одне
      stopSpeech();
      pttBtn.classList.add('rec'); setState('Говоріть…');
      ac = new AbortController();
      try {
        const res = canRecognize() ? await recognize({ signal: ac.signal, onInterim: t => { notice.textContent = t; } }) : await recordAndTranscribe({ signal: ac.signal, maxMs: 30000 });
        pttBtn.classList.remove('rec');
        if (!res.text) { setState('Нічого не почуто. Спробуйте ще раз'); return; }
        notice.textContent = '';
        addText('user', res.text); closeTurns();
        setState(`${st.tutorName} думає…`);
        const scenData = scenario ? { title: scenario.title, situation: scenario.situation, myRole: scenario.myRole, tutorRole: scenario.tutorRole, goal: scenario.goal, phrases: scenario.phrases } : null;
        const reply = await tutor('chat', { stream: false, voice: true, mode: scenario ? 'scenario' : 'chat', scenarioData: scenData, topic: opts.topic, messages: row.messages.map(m => ({ role: m.role, text: m.text })) });
        addText('model', reply.text); closeTurns();
        setState(`Говорить ${st.tutorName}`);
        aura.classList.remove('me');
        await speak(reply.text.replace(/[*_#]/g, ''), { engine: st.ttsEngine, geminiVoice: st.voice });
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
          const scenData = scenario ? { title: scenario.title, situation: scenario.situation, myRole: scenario.myRole, tutorRole: scenario.tutorRole, goal: scenario.goal, phrases: scenario.phrases } : null;
          const reply = await tutor('chat', { stream: false, voice: true, mode: scenario ? 'scenario' : 'chat', scenarioData: scenData, topic: opts.topic, messages: [] });
          addText('model', reply.text); closeTurns();
          await speak(reply.text.replace(/[*_#]/g, ''), { engine: st.ttsEngine, geminiVoice: st.voice });
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

  /** Зберегти розмову і час (час прив'язаний до розмови — видалиш її, зникне і зі статистики) */
  function save() {
    if (saved) return;
    saved = true;
    const seconds = elapsed();
    row.seconds = seconds;
    row.messages = row.messages.map(({ role, text }) => ({ role, text: (text || '').trim() })).filter(m => m.text);
    if (row.messages.length) store.put('tutor_chats', row);
    if (seconds > 5) {
      logSession('voice', seconds, row.id || null);
      if (mode === 'live') tutor('usage', { voice_seconds: seconds }).catch(() => {});
    }
    log(`end · ${seconds}s · msgs ${row.messages.length} (user ${row.messages.filter(m => m.role === 'user').length})`);
  }

  async function finish() {
    if (ended) return;
    ended = true;
    // остання репліка учня ще не уточнена — уточнюємо й чекаємо (до 12 с), щоб підсумок і оцінка рахувались з правильного тексту
    if (mode === 'live' && !tutorTalking) cutSegment();
    if (fixes.size) {
      setState('Уточнюю ваші репліки…');
      await Promise.race([Promise.allSettled([...fixes]), new Promise(r => setTimeout(r, 12000))]);
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
    await summarize(view, row, { voice: true });
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    cancelAnimationFrame(raf);
    try { live?.close(); } catch { /* */ }
    try { audio?.stop(); } catch { /* */ }
    stopSpeech();
    setFocus(false);
    // пішли зі сторінки без «Завершити» — все одно зберігаємо
    if (!ended) { ended = true; save(); }
  }
  return cleanup;
}

