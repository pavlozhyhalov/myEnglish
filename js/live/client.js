// Клієнт Gemini Live (WebSocket, ефемерний токен), аудіо через AudioWorklet
import { LIVE_WS_URL, LIMITS, BUILD } from '../config.js';
import { liveToken, AiError } from '../ai.js';

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
  constructor({ scenario = null, topic = null, voice } = {}) {
    super();
    this.opts = { scenario, topic, voice };
    this.ws = null;
    this.token = null;
    this.handle = null;
    this.fallback = 0;
    this.closedByUser = false;
    this.ready = false;
    this.retries = 0;
    this.resumeTimer = null;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  log(t) { this.emit('log', t); }

  async getToken() {
    const t = await liveToken({ fallback: this.fallback, scenario: this.opts.scenario, topic: this.opts.topic, voice: this.opts.voice });
    this.token = t;
    this.log(`token ok · model ${t.model} · voice ${t.voice} · ${Math.round(t.voiceSecondsLeft / 60)} хв ліміту`);
    return t;
  }

  async connect() {
    if (!this.token || Date.parse(this.token.expireTime) - Date.now() < 60000) await this.getToken();
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(this.token.token)}`);
      this.ws = ws;
      this.ready = false;
      ws.onopen = () => {
        this.log('ws open');
        const setup = { model: `models/${this.token.model}` };
        setup.sessionResumption = this.handle ? { handle: this.handle } : {};
        ws.send(JSON.stringify({ setup }));
      };
      ws.onmessage = async (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : await ev.data.text();
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (msg.setupComplete) {
          this.ready = true; this.retries = 0;
          this.log('setup complete');
          this.scheduleResume();
          if (!settled) { settled = true; resolve(); }
          this.emit('ready');
          return;
        }
        this.onServer(msg);
      };
      ws.onerror = () => this.log('ws error');
      ws.onclose = async (ev) => {
        this.log(`ws close ${ev.code} ${ev.reason || ''}`);
        clearTimeout(this.resumeTimer);
        const wasReady = this.ready;
        this.ready = false;
        if (this.ws !== ws) return;               // вже перепідключились
        if (this.closedByUser) { this.emit('closed'); return; }
        if (!settled) {
          settled = true;
          // модель недоступна → пробуємо запасну
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
    if (this.retries >= 4) { this.emit('error', new AiError('live_failed', ev?.reason || 'Зв\'язок втрачено')); return; }
    this.retries++;
    this.emit('reconnecting');
    await new Promise(r => setTimeout(r, Math.min(8000, 600 * 2 ** (this.retries - 1))));
    if (!navigator.onLine) await new Promise(r => window.addEventListener('online', r, { once: true }));
    try {
      if (Date.parse(this.token?.expireTime || 0) - Date.now() < 60000) this.token = null;
      await this.connect();
    } catch (e) {
      if (e?.code === 'quota') { this.emit('error', e); return; }
      if (this.handle) { this.log('resume failed, new session'); this.handle = null; }
      this.reconnect(ev);
    }
  }

  /** Проактивне відновлення сесії приблизно кожні 10 хв */
  scheduleResume() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      if (!this.ready || !this.handle) return;
      this.log('planned session resumption');
      const old = this.ws;
      this.ws = null;
      old.onclose = null; old.close();
      this.emit('reconnecting');
      this.connect().catch(() => this.reconnect());
    }, LIMITS.sessionResumeMs);
  }

  onServer(msg) {
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) this.handle = u.newHandle;
    }
    if (msg.goAway) {
      this.log(`goAway ${msg.goAway.timeLeft || ''}`);
      if (this.handle) { const old = this.ws; this.ws = null; old.onclose = null; old.close(); this.emit('reconnecting'); this.connect().catch(() => this.reconnect()); }
    }
    const sc = msg.serverContent;
    if (!sc) return;
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
    if (sc.turnComplete) this.emit('turn');
  }

  sendAudio(buf) {
    if (!this.ready || this.ws?.readyState !== 1) return;
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
    try { this.ws?.close(1000, 'bye'); } catch { /* */ }
  }
}

/** Аудіо: мікрофон (16 kHz PCM) і програвач (24 kHz) */
export class AudioIO extends EventTarget {
  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      throw new AiError(e.name === 'NotFoundError' ? 'mic_missing' : 'mic', e.name);
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.inCtx = new AC({ sampleRate: 16000 }); } catch { this.inCtx = new AC(); }
    try { this.outCtx = new AC({ sampleRate: 24000 }); } catch { this.outCtx = new AC(); }
    await this.inCtx.audioWorklet.addModule(`js/live/capture-worklet.js?v=${BUILD}`);
    await this.outCtx.audioWorklet.addModule(`js/live/player-worklet.js?v=${BUILD}`);
    this.src = this.inCtx.createMediaStreamSource(this.stream);
    this.cap = new AudioWorkletNode(this.inCtx, 'capture');
    this.src.connect(this.cap);
    this.cap.port.onmessage = (e) => {
      if (e.data.type === 'pcm') this.dispatchEvent(new CustomEvent('pcm', { detail: e.data.data }));
      else this.dispatchEvent(new CustomEvent('mic-level', { detail: e.data.rms }));
    };
    this.player = new AudioWorkletNode(this.outCtx, 'player', { outputChannelCount: [1] });
    this.player.connect(this.outCtx.destination);
    this.player.port.onmessage = (e) => {
      if (e.data.type === 'level') this.dispatchEvent(new CustomEvent('out-level', { detail: e.data.rms }));
      else this.dispatchEvent(new CustomEvent(e.data.type === 'start' ? 'speaking' : 'idle'));
    };
    await this.inCtx.resume(); await this.outCtx.resume();
  }
  play(f32) {
    // якщо контекст не 24 кГц — простий ресемплінг
    const rate = this.outCtx.sampleRate;
    let data = f32;
    if (rate !== 24000) {
      const ratio = 24000 / rate, n = Math.floor(f32.length / ratio);
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = f32[Math.floor(i * ratio)];
    }
    this.player?.port.postMessage({ type: 'push', data }, [data.buffer]);
  }
  clear() { this.player?.port.postMessage({ type: 'clear' }); }
  mute(v) { this.muted = v; this.cap?.port.postMessage({ type: 'mute', value: v }); }
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    try { this.inCtx?.close(); this.outCtx?.close(); } catch { /* */ }
  }
}
