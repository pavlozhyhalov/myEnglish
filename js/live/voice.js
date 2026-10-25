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
import { summarize } from '../pages/tutor.js';
import { go } from '../router.js';

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

  const log = (t) => { if (logBox) { logBox.textContent += `[${new Date().toLocaleTimeString()}] ${t}\n`; logBox.scrollTop = 1e9; } };
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
    const recent = row.messages.slice(-6);
    subs.replaceChildren(...recent.map(m => h('div.line' + (m.role === 'user' ? '.me' : ''), m.text.trim())));
    subs.scrollTop = subs.scrollHeight;
  }

  // ---------- аура ----------
  let micLevel = 0, outLevel = 0, raf = 0;
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

  // ---------- старт Live ----------
  try {
    audio = new AudioIO();
    await audio.start();
    audio.addEventListener('mic-level', e => { micLevel = e.detail; });
    audio.addEventListener('out-level', e => { outLevel = e.detail; });
    audio.addEventListener('speaking', () => { if (mode === 'live') setState(`Говорить ${st.tutorName}`); });
    audio.addEventListener('idle', () => { if (mode === 'live' && live?.ready) setState(micMuted ? 'Мікрофон вимкнено' : 'Слухаю…'); });

    const scenData = scenario ? { title: scenario.title, situation: scenario.situation, myRole: scenario.myRole, tutorRole: scenario.tutorRole, goal: scenario.goal, phrases: scenario.phrases } : null;
    live = new LiveClient({ scenario: scenData, topic: opts.topic, voice: st.voice });
    live.addEventListener('log', e => log(e.detail));
    live.addEventListener('audio', e => audio.play(e.detail));
    live.addEventListener('interrupted', () => { audio.clear(); closeTurns(); });
    live.addEventListener('input', e => addText('user', e.detail));
    live.addEventListener('output', e => addText('model', e.detail));
    live.addEventListener('turn', closeTurns);
    live.addEventListener('reconnecting', () => { setState(S.err.network); });
    live.addEventListener('ready', () => { setState('Слухаю…'); notice.textContent = ''; });
    live.addEventListener('error', e => { log('error ' + e.detail?.message); switchToFallback(e.detail); });
    audio.addEventListener('pcm', e => live.sendAudio(e.detail));

    await live.connect();
    started = Date.now();
    setState('Слухаю…');
    // вчитель починає першим
    live.sendText(scenario ? '(Start the role-play now with your first line.)' : '(The student is ready. Greet him briefly and start the conversation.)');
  } catch (e) {
    log('start failed: ' + (e.code || '') + ' ' + e.message);
    if (['mic', 'mic_missing', 'need_login', 'not_allowed', 'offline'].includes(e.code)) { fail(e); return cleanup; }
    switchToFallback(e);
  }

  function fail(e) {
    setState('');
    notice.replaceChildren(h('div.feedback.no', ERR[e.code] || aiErrorText(e) || S.err.generic),
      e.code === 'need_login' ? h('a.btn.primary', { href: '#/auth', style: { marginTop: '12px' } }, 'Увійти') : null);
    controls.replaceChildren(h('button.btn.soft', { type: 'button', onclick: () => go('/tutor', { replace: true }) }, 'Назад'));
  }

  // ---------- запасний режим «рація» ----------
  function switchToFallback(err) {
    if (mode === 'ptt' || ended) return;
    mode = 'ptt';
    if (started) { elapsedBefore = elapsed(); started = Date.now(); } else started = Date.now();
    try { live?.close(); } catch { /* */ }
    audio?.stop(); audio = null; micLevel = outLevel = 0;
    const why = err?.code === 'quota' ? S.err.quota : err?.code === 'no_key' ? S.err.noKey : 'Live недоступний — перемкнулись на режим «рація».';
    notice.replaceChildren(h('div.feedback.no', why), h('div.xs.dim', { style: { marginTop: '6px' } }, 'Утримуйте кнопку, говоріть, відпустіть — вчитель відповість голосом.'));
    if (err?.code === 'quota' || err?.code === 'no_key' || err?.code === 'not_allowed') { fail(err); return; }
    setState('Режим «рація»');
    pttBtn.hidden = false;
    controls.replaceChildren(ctrl('lightbulb', 'Підказка', hint), ctrl('clock', 'Повільніше', slower), ctrl('stop', 'Завершити', () => finish(), '.stop'));
    let ac = null, busy = false;
    const down = async (e) => {
      e.preventDefault();
      if (busy) return;
      stopSpeech();
      pttBtn.classList.add('rec'); setState('Говоріть…');
      ac = new AbortController();
      try {
        const res = canRecognize() ? await recognize({ signal: ac.signal, onInterim: t => { notice.textContent = t; } }) : await recordAndTranscribe({ signal: ac.signal, maxMs: 30000 });
        pttBtn.classList.remove('rec');
        if (!res.text) { setState('Не почув. Спробуйте ще'); return; }
        notice.textContent = '';
        busy = true;
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
        setState(er.code === 'mic' || er.name === 'NotAllowedError' ? S.err.mic : (aiErrorText(er) || 'Не вдалося'));
      } finally { busy = false; }
    };
    const up = () => { pttBtn.classList.remove('rec'); ac?.abort(); };
    pttBtn.addEventListener('pointerdown', down);
    pttBtn.addEventListener('pointerup', up);
    pttBtn.addEventListener('pointerleave', up);
    pttBtn.addEventListener('contextmenu', e => e.preventDefault());
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
    if (mode === 'live' && live?.sendText('(The student asks for a hint: briefly suggest 3 short options for how he could answer, then wait.)')) return;
    try {
      notice.textContent = 'Підказка…';
      const r = await tutor('hint', { messages: row.messages.map(m => ({ role: m.role, text: m.text })) });
      notice.replaceChildren(h('div.card.tight', { style: { textAlign: 'left', whiteSpace: 'pre-wrap' } }, r.text));
    } catch (e) { notice.textContent = aiErrorText(e); }
  }
  function slower() {
    if (mode === 'live') live?.sendText('(Please speak more slowly and use simpler words from now on.)');
    else { store.setSetting('rate', Math.max(0.7, (store.settings().rate || 1) - 0.15)); notice.textContent = 'Озвучка сповільнена'; }
  }

  async function finish() {
    if (ended) return;
    ended = true;
    const seconds = elapsed();
    cleanup();
    row.seconds = seconds;
    row.messages = row.messages.map(({ role, text }) => ({ role, text: text.trim() })).filter(m => m.text);
    if (seconds > 5) {
      logSession('voice', seconds, 0);
      if (mode === 'live') tutor('usage', { voice_seconds: seconds }).catch(() => {});
    }
    if (row.messages.filter(m => m.role === 'user').length) store.put('tutor_chats', row);
    if (opts.onFinish) return opts.onFinish(row);
    if (!row.messages.some(m => m.role === 'user')) { go('/tutor', { replace: true }); return; }
    await summarize(view, row, { voice: true });
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    cancelAnimationFrame(raf);
    try { live?.close(); } catch { /* */ }
    audio?.stop();
    stopSpeech();
    setFocus(false);
    // якщо користувач пішов зі сторінки без «Завершити» — все одно зберігаємо
    if (!ended) {
      ended = true;
      const seconds = elapsed();
      if (seconds > 5) { logSession('voice', seconds, 0); if (mode === 'live') tutor('usage', { voice_seconds: seconds }).catch(() => {}); }
      row.seconds = seconds;
      row.messages = row.messages.map(({ role, text }) => ({ role, text: text.trim() })).filter(m => m.text);
      if (row.messages.some(m => m.role === 'user')) store.put('tutor_chats', row);
    }
  }
  return cleanup;
}

