// Клієнт Gemini Live (WebSocket, ефемерний токен), аудіо через AudioWorklet
import { LIVE_WS_URL, LIMITS, BUILD } from '../config.js';
import { sessionRecord, trackMic } from '../audiosession.js';
import { liveToken, AiError } from '../ai.js';

// Токен відкриває нові сесії весь свій час (live-token: newSessionExpireTime = expireTime) — новий токен лише перед закінченням строку.
const CONNECT_TIMEOUT_MS = 10_000;   // від відкриття сокета до setupComplete — далі вважаємо спробу невдалою
const RECONNECT_BUDGET_MS = 45_000;  // скільки пробуємо відновити зв'язок, перш ніж здатися
const STALL_MS = 20_000;             // учень говорив, а від сервера ні слова стільки часу — з'єднання «мертве», відновлюємо (з запасом: довгий монолог без проміжних субтитрів — не збій)
const dec = new TextDecoder();

const b64 = {
  enc(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

/** Події: ready, audio(Float32Array), interrupted, input(text), output(text), turn, reconnecting, error(AiError|Error), closed, log(text) */
export class LiveClient extends EventTarget {
  constructor({ scenario = null, topic = null, voice, history = null } = {}) {
    super();
    this.opts = { scenario, topic, voice, history };
    this.everReady = false;      // сесія вже була — нова без handle означає втрату контексту, його треба відновити
    this.ws = null;
    this.token = null;
    this.handle = null;
    this.fallback = 0;
    this.closedByUser = false;
    this.ready = false;
    this.retries = 0;
    this.resumeTimer = null;
    this.basic = false;          // true — токен без налаштувань VAD (модель їх не прийняла)
    this.resumeWanted = false;   // планове перепідключення чекає кінця репліки вчителя
    this.pending = [];           // аудіо учня, поки триває перепідключення (до ~4 с) — щоб не губити слова
    this.tokenAt = 0;
    this.lastServerAt = 0;       // остання будь-яка відповідь сервера
    this.lastSpeechAt = 0;       // коли учень востаннє говорив (noteSpeech з voice.js)
    this.lastReplyAt = 0;        // остання відповідь вчителя (звук, кінець репліки, перебивання)
    this.streamEndFor = 0;       // для якого мовлення вже надіслано audioStreamEnd
    this.failStart = 0;          // початок поточної серії невдалих перепідключень
    this.handleFails = 0;        // невдалі спроби з handle поспіль
    this.watch = setInterval(() => this.checkStall(), 2000);
  }
  /** Учень щойно говорив (пакет з голосом) — для сторожа «мертвого» з'єднання */
  noteSpeech() { this.lastSpeechAt = Date.now(); }
  /** Сокет живий на вигляд, але сервер мовчить на мовлення учня (NAT, Wi-Fi ↔ LTE) або черга відправки росте — відновлюємо сесію */
  checkStall() {
    if (!this.open || this.closedByUser) return;
    const now = Date.now();
    // учень договорив, а вчитель мовчить (шум тримає «мовлення» відкритим, VAD не закрив репліку): закриваємо репліку самі — audioStreamEnd
    const quiet = now - this.lastSpeechAt;
    if (this.lastSpeechAt > this.lastReplyAt && this.streamEndFor !== this.lastSpeechAt && quiet > (this.token?.pauseMs || 1600) + 2500 && quiet < 15000) {
      this.streamEndFor = this.lastSpeechAt;
      this.log(`no reply ${Math.round(quiet / 100) / 10}s after speech → audioStreamEnd`);
      try { this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { /* */ }
    }
    const deaf = this.lastSpeechAt > this.lastServerAt + 2000 && now - this.lastServerAt > STALL_MS && now - this.lastSpeechAt < 4000;
    const clogged = (this.ws?.bufferedAmount || 0) > 256 * 1024;
    if (!deaf && !clogged) return;
    this.log(`stall · ${clogged ? 'send buffer ' + this.ws.bufferedAmount : 'no server reply ' + Math.round((now - this.lastServerAt) / 1000) + 's'}`);
    this.lastServerAt = now;   // не частіше одного разу на STALL_MS
    if (this.handle) this.resumeNow('stall', true);
    else { const old = this.ws; this.ws = null; this.ready = false; try { old.onclose = null; old.close(); } catch { /* */ } this.reconnect(); }
  }
  /** З'єднання відкрите й сесія налаштована (можна слати аудіо й текст) */
  get open() { return this.ready && this.ws?.readyState === 1 && !this.closedByUser; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  log(t) { this.emit('log', t); }

  async getToken() {
    const t = await liveToken({ fallback: this.fallback, basic: this.basic, scenario: this.opts.scenario, topic: this.opts.topic, voice: this.opts.voice });
    this.token = t;
    this.tokenAt = Date.now();
    this.log(`token ok · model ${t.model} · voice ${t.voice} · pause ${t.pauseMs || 'auto'} ms · ${Math.round(t.voiceSecondsLeft / 60)} хв ліміту`);
    return t;
  }

  async connect() {
    if (this.closedByUser) throw new AiError('closed', 'closed');
    // нову сесію ефемерний токен відкриває лише ~60 с після створення (newSessionExpireTime); відновлення за handle — довше
    if (!this.token || Date.parse(this.token.expireTime) - Date.now() < 60000) await this.getToken();
    return new Promise((resolve, reject) => {
      let settled = false;
      const restoring = !this.handle && this.everReady;
      const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(this.token.token)}`);
      ws.binaryType = 'arraybuffer';   // синхронне декодування: повідомлення обробляються строго по черзі (Blob.text() — асинхронно, міг міняти порядок)
      this.ws = ws;
      this.ready = false;
      // з'єднання «зависло» на рукостисканні (мобільна мережа) — не чекаємо хвилину: закриваємо, далі звичайне перепідключення
      const connTimer = setTimeout(() => { if (!this.ready && this.ws === ws) { this.log('connect timeout'); try { ws.close(4000, 'connect timeout'); } catch { /* */ } } }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        if (this.closedByUser) { try { ws.close(1000, 'bye'); } catch { /* */ } return; }
        this.log('ws open');
        const setup = { model: `models/${this.token.model}` };
        setup.sessionResumption = this.handle ? { handle: this.handle } : {};
        ws.send(JSON.stringify({ setup }));
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        this.lastServerAt = Date.now();
        const text = typeof ev.data === 'string' ? ev.data : dec.decode(ev.data);
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (msg.setupComplete) {
          clearTimeout(connTimer);
          this.ready = true; this.retries = 0; this.failStart = 0; this.handleFails = 0;
          this.log('setup complete' + (restoring ? ' · new session, restoring context' : ''));
          // нова сесія замість втраченої — стенограма; відновлення за handle пам'ятає розмову саме (2026-11-17: токен більше не ігнорує handle —
          // fieldMask у live-token), тож тихе «нагадування» прибрано: воно залишало відкриту репліку й могло глушити наступну відповідь
          if (restoring) this.restoreContext();
          this.everReady = true;
          this.flushPending();
          this.scheduleResume();
          if (!settled) { settled = true; resolve(); }
          this.emit('ready');
          return;
        }
        this.onServer(msg);
      };
      ws.onerror = () => this.log('ws error');
      ws.onclose = async (ev) => {
        clearTimeout(connTimer);
        this.log(`ws close ${ev.code} ${ev.reason || ''}`);
        clearTimeout(this.resumeTimer);
        const wasReady = this.ready;
        this.ready = false;
        if (this.ws !== ws) return;               // вже перепідключились
        if (this.closedByUser) { this.emit('closed'); return; }
        if (!settled) {
          settled = true;
          // модель недоступна → пробуємо запасну
          // налаштування паузи не прийнято (невідоме поле / недопустиме значення) → той самий токен без них
          // лише якщо причина справді про паузу/слухання (будь-яке 1007 чи «invalid» раніше вимикало їх на всю розмову — обриви на півслові)
          if (!wasReady && !this.basic && /realtime|activity|sensitivity|silence|prefix|padding/i.test(ev.reason || '')) {
            this.basic = true; this.token = null; this.handle = null;
            this.log('VAD config rejected, basic setup');
            try { await this.connect(); resolve(); } catch (e) { reject(e); }
            return;
          }
          if (!wasReady && /model|not found|not supported|unsupported/i.test(ev.reason || '') && this.token?.hasMoreModels) {
            this.fallback++; this.token = null; this.handle = null;
            this.log('fallback model');
            try { await this.connect(); resolve(); } catch (e) { reject(e); }
            return;
          }
          reject(new AiError(ev.code === 1008 ? 'live_denied' : 'live_failed', ev.reason || 'Live недоступний'));
          return;
        }
        this.reconnect(ev);
      };
    });
  }

  async reconnect(ev) {
    if (this.closedByUser) return;
    // 2026-11-17 (рецензія): замість 4 спроб (~9 с) — до 45 с спроб; короткий обрив мобільного зв'язку більше не перемикає на «рацію»
    if (!this.failStart) this.failStart = Date.now();
    if (Date.now() - this.failStart > RECONNECT_BUDGET_MS) { this.failStart = 0; this.emit('error', new AiError('live_failed', ev?.reason || 'Зв\'язок втрачено')); return; }
    this.retries++;
    this.emit('reconnecting');
    await new Promise(r => setTimeout(r, Math.min(5000, 500 * 2 ** (this.retries - 1))));
    if (!navigator.onLine) await new Promise(r => window.addEventListener('online', r, { once: true }));
    if (this.closedByUser) return;      // сесію закрили під час паузи
    try {
      if (Date.parse(this.token?.expireTime || 0) - Date.now() < 60000) this.token = null;
      await this.connect();
    } catch (e) {
      if (this.closedByUser) return;
      if (e?.code === 'quota') { this.emit('error', e); return; }
      // handle тримаємо кілька спроб: обрив мережі — не причина втрачати пам'ять розмови; токен — оновити
      if (e?.code === 'live_denied') this.token = null;
      if (this.handle && ++this.handleFails >= 3) { this.log('resume failed 3×, new session'); this.handle = null; }
      this.reconnect(ev);
    }
  }

  /** Проактивне відновлення сесії приблизно кожні 10 хв — у паузі між репліками, а не посеред фрази */
  scheduleResume() {
    clearTimeout(this.resumeTimer);
    this.resumeWanted = false;
    this.resumeTimer = setTimeout(() => {
      this.resumeWanted = true;
      // якщо вчитель так і не закінчить репліку (учень довго говорить) — все одно через 60 с
      this.resumeTimer = setTimeout(() => this.resumeNow('planned (timeout)'), 60_000);
    }, LIMITS.sessionResumeMs);
  }
  resumeNow(why, failure = false) {
    clearTimeout(this.resumeTimer);
    // планове оновлення не обриває учня посеред фрази (раніше довгий монолог губився): чекаємо паузу, але не довше дедлайну (goAway)
    if (!failure && this.ready && Date.now() - this.lastSpeechAt < 1500 && Date.now() < (this.resumeDeadline || Date.now() + 20_000)) {
      if (!this.resumeDeadline) this.resumeDeadline = Date.now() + 20_000;
      this.resumeTimer = setTimeout(() => this.resumeNow(why), 500);
      return;
    }
    this.resumeDeadline = 0;
    this.resumeWanted = false; this.resumeAfterUpdate = false;
    if (!this.handle || this.closedByUser || (!this.ready && !failure)) return;
    this.log(`session resumption · ${why}`);
    const old = this.ws;
    this.ws = null; this.ready = false;
    if (old) { old.onclose = null; try { old.close(); } catch { /* */ } }
    // планове відновлення — тихо (без «Зв'язок перервано»), збій — з повідомленням
    this.emit(failure ? 'reconnecting' : 'resuming');
    this.connect().catch(() => { if (!this.closedByUser) this.reconnect(); });
  }
  /**
   * Нова сесія замість втраченої (відновлення за handle не вдалося): передаємо вчителю стенограму розмови,
   * щоб він продовжив з того самого місця, а не вітався й не починав тему заново.
   */
  restoreContext(silent = false) {
    const msgs = (this.opts.history?.() || []).filter(m => m.text?.trim() && !m.hidden);
    if (!msgs.length) return;
    let lines = msgs.map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text.replace(/\s+/g, ' ').trim()}`);
    // найсвіжіше важливіше: обрізаємо з початку до ~8000 символів (тихе нагадування — до ~4000)
    const max = silent ? 4000 : 8000;
    while (lines.length > 2 && lines.join('\n').length > max) lines = lines.slice(1);
    if (silent) {
      const note = '(Context note — the connection was refreshed; this is the SAME lesson continuing. Do NOT greet, do NOT restart, do NOT change the topic or the role-play. '
        + 'Recent transcript:\n' + lines.join('\n') + '\nWait for the student and continue from exactly this point.)';
      this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: false } }));
      return;
    }
    const text = '(The connection dropped and was restored. This is the SAME lesson continuing — do NOT greet the student, do NOT restart, '
      + 'do NOT go back to the opening topic. Keep the topic, role-play and agreements below. Transcript so far:\n'
      + lines.join('\n')
      + '\nContinue naturally from the last point in one or two short sentences: answer the student\'s last line or invite them to go on.)';
    this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
  }
  flushPending() {
    const q = this.pending; this.pending = [];
    for (const b of q) this.sendAudio(b);
    // учень уже договорив, поки відновлювались, — закриваємо його репліку, щоб вчитель відповів, а не чекав
    if (q.length && Date.now() - this.lastSpeechAt > 1500 && this.lastSpeechAt > this.lastReplyAt) {
      this.streamEndFor = this.lastSpeechAt;
      try { this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { /* */ }
    }
  }

  onServer(msg) {
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) {
        this.handle = u.newHandle;
        // планове відновлення чекало свіжого handle після кінця репліки — тепер сесія відновиться з останнім обміном
        if (this.resumeAfterUpdate) this.resumeNow('turn end');
      }
    }
    if (msg.goAway) {
      this.log(`goAway ${msg.goAway.timeLeft || ''}`);
      // сервер скоро закриє з'єднання: якщо часу досить — чекаємо кінця репліки вчителя, інакше — одразу
      const left = parseFloat(String(msg.goAway.timeLeft || '0')) || 0;
      if (this.handle && !this.closedByUser) {
        this.resumeDeadline = Date.now() + Math.max(0, left - 2) * 1000;
        if (left > 8) { this.resumeWanted = true; clearTimeout(this.resumeTimer); this.resumeTimer = setTimeout(() => this.resumeNow('goAway'), (left - 5) * 1000); }
        else this.resumeNow('goAway');
      }
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.modelTurn || sc.turnComplete || sc.interrupted) this.lastReplyAt = Date.now();
    if (sc.interrupted) this.emit('interrupted');
    if (sc.inputTranscription?.text) this.emit('input', sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.emit('output', sc.outputTranscription.text);
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data && /audio/.test(part.inlineData.mimeType || 'audio')) {
        const bytes = b64.dec(part.inlineData.data);
        const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
        const f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
        this.emit('audio', f32);
      }
    }
    if (sc.turnComplete) {
      this.emit('turn');
      // handle, що охоплює щойно завершений обмін, приходить окремим повідомленням слідом — чекаємо його (до 1 с)
      if (this.resumeWanted) { this.resumeAfterUpdate = true; clearTimeout(this.resumeTimer); this.resumeTimer = setTimeout(() => this.resumeNow('turn end (no update)'), 1000); }
    }
  }

  sendAudio(buf) {
    if (!this.ready || this.ws?.readyState !== 1) {
      // перепідключення: зберігаємо останні ~4 с мовлення і відправляємо після setupComplete
      // до ~30 с: репліка учня під час перепідключення не губиться (було ~4 с)
      if (this.handle && !this.closedByUser) { this.pending.push(buf); if (this.pending.length > 300) this.pending.shift(); }
      return;
    }
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64.enc(buf), mimeType: 'audio/pcm;rate=16000' } } }));
  }
  sendText(text) {
    if (!this.ready || this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
    return true;
  }
  close() {
    this.closedByUser = true;
    clearTimeout(this.resumeTimer);
    clearInterval(this.watch);
    try { this.ws?.close(1000, 'bye'); } catch { /* */ }
  }
}

/** Аудіо: мікрофон (16 kHz PCM) і програвач (24 kHz) */
export class AudioIO extends EventTarget {
  /**
   * Викликати синхронно в обробнику тапу: iOS дозволяє звук і мікрофон лише в момент жесту.
   * Контексти — з рідною частотою пристрою (iOS «глушить» мікрофон у контексті 16 кГц);
   * до 16 кГц ресемплить capture-worklet, з 24 кГц — play().
   */
  prepare() {
    const AC = window.AudioContext || window.webkitAudioContext;
    // вбудований браузер месенджера / незахищена сторінка: без getUserMedia чи AudioContext — зрозуміла помилка замість «кнопка нічого не робить»
    const noMic = () => Promise.reject(Object.assign(new Error('mic unavailable'), { name: 'NotAllowedError' }));
    if (!AC || !navigator.mediaDevices?.getUserMedia) { this.streamPromise = noMic(); this.streamPromise.catch(() => {}); return this; }
    this.inCtx = new AC();
    this.outCtx = new AC();
    this.inCtx.resume().catch(() => {});
    this.outCtx.resume().catch(() => {});
    // мікрофон теж запитуємо одразу в жесті
    sessionRecord();
    this.streamPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(trackMic);
    this.streamPromise.catch(() => {});   // помилку обробляє start(); без цього — «unhandled rejection», якщо start() не встигне
    return this;
  }
  async start() {
    if (!this.inCtx && !this.streamPromise) this.prepare();
    try {
      this.stream = await this.streamPromise;
    } catch (e) {
      throw new AiError(e.name === 'NotFoundError' ? 'mic_missing' : 'mic', e.name);
    }
    // сесію закрили, поки чекали дозволу на мікрофон, — мікрофон одразу вимикаємо (інакше лишався увімкненим і iOS тримала «режим дзвінка»)
    if (this.stopped) { this.stream.getTracks().forEach(t => t.stop()); throw new AiError('closed', 'closed'); }
    // iOS: дзвінок, Siri, блокування екрана «присипляють» звук — повідомляємо, щоб показати «Торкніться, щоб продовжити»
    const watchCtx = () => this.dispatchEvent(new CustomEvent('audio-state', { detail: this.healthy() }));
    this.inCtx.addEventListener('statechange', watchCtx);
    this.outCtx.addEventListener('statechange', watchCtx);
    this.stream.getAudioTracks().forEach(t => { t.addEventListener('ended', watchCtx); t.addEventListener('mute', watchCtx); t.addEventListener('unmute', watchCtx); });
    await this.inCtx.audioWorklet.addModule(`js/live/capture-worklet.js?v=${BUILD}`);
    await this.outCtx.audioWorklet.addModule(`js/live/player-worklet.js?v=${BUILD}`);
    this.src = this.inCtx.createMediaStreamSource(this.stream);
    this.cap = new AudioWorkletNode(this.inCtx, 'capture');
    this.src.connect(this.cap);
    this.cap.port.onmessage = (e) => {
      if (e.data.type === 'pcm') {
        // rms — середня гучність усього пакета 100 мс (для обліку часу мовлення)
        const ev = new CustomEvent('pcm', { detail: e.data.data });
        ev.rms = typeof e.data.rms === 'number' ? e.data.rms : undefined;
        this.dispatchEvent(ev);
      }
      else this.dispatchEvent(new CustomEvent('mic-level', { detail: e.data.rms }));
    };
    this.player = new AudioWorkletNode(this.outCtx, 'player', { outputChannelCount: [1] });
    this.player.connect(this.outCtx.destination);
    this.player.port.onmessage = (e) => {
      if (e.data.type === 'level') this.dispatchEvent(new CustomEvent('out-level', { detail: e.data.rms }));
      else this.dispatchEvent(new CustomEvent(e.data.type === 'start' ? 'speaking' : 'idle'));
    };
    // без await: на iOS resume() поза жестом може не завершитись ніколи
    this.inCtx.resume().catch(() => {}); this.outCtx.resume().catch(() => {});
    return { inRate: this.inCtx.sampleRate, outRate: this.outCtx.sampleRate, inState: this.inCtx.state, outState: this.outCtx.state };
  }
  play(f32) {
    // Gemini віддає 24 кГц; контекст — рідна частота пристрою (зазвичай 48 кГц): лінійна інтерполяція
    const rate = this.outCtx.sampleRate;
    let data = f32;
    if (rate !== 24000) {
      const ratio = 24000 / rate, n = Math.floor(f32.length / ratio);
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i * ratio, j = Math.floor(x), f = x - j;
        data[i] = j + 1 < f32.length ? f32[j] * (1 - f) + f32[j + 1] * f : f32[j];
      }
    }
    this.player?.port.postMessage({ type: 'push', data }, [data.buffer]);
  }
  clear() { this.player?.port.postMessage({ type: 'clear' }); }
  /** Звук і мікрофон працюють (контексти «running», доріжка мікрофона жива) */
  healthy() {
    const tr = this.stream?.getAudioTracks?.()[0];
    return this.inCtx?.state === 'running' && this.outCtx?.state === 'running' && (!tr || (tr.readyState === 'live' && !tr.muted));
  }
  /** Повернути звук після блокування екрана / дзвінка (викликати з дотику): контексти й, якщо треба, мікрофон заново */
  async revive() {
    try { await this.inCtx?.resume(); } catch { /* */ }
    try { await this.outCtx?.resume(); } catch { /* */ }
    const tr = this.stream?.getAudioTracks?.()[0];
    if (tr && tr.readyState !== 'live' && this.inCtx && this.cap) {
      sessionRecord();
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(trackMic);
      try { this.src?.disconnect(); } catch { /* */ }
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = s;
      this.src = this.inCtx.createMediaStreamSource(s);
      this.src.connect(this.cap);
      const watchCtx = () => this.dispatchEvent(new CustomEvent('audio-state', { detail: this.healthy() }));
      s.getAudioTracks().forEach(t => { t.addEventListener('ended', watchCtx); t.addEventListener('mute', watchCtx); t.addEventListener('unmute', watchCtx); });
    }
    return this.healthy();
  }
  mute(v) { this.muted = v; this.cap?.port.postMessage({ type: 'mute', value: v }); }
  stop() {
    this.stopped = true;
    this.stream?.getTracks().forEach(t => t.stop());
    this.streamPromise?.then(s => s?.getTracks?.().forEach(t => t.stop()), () => {});
    try { this.inCtx?.close(); this.outCtx?.close(); } catch { /* */ }
  }
}
