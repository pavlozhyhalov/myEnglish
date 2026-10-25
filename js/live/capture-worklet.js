// Мікрофон → PCM16 mono 16 kHz, пакети ~100 мс + рівень гучності
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.buf = new Int16Array(1600);
    this.n = 0;
    this.pos = 0;           // дробова позиція для ресемплінгу
    this.muted = false;
    this.port.onmessage = (e) => { if (e.data?.type === 'mute') this.muted = e.data.value; };
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);
    // простий ресемплінг (лінійна вибірка) до 16 кГц
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const s = i + 1 < ch.length ? ch[i] * (1 - f) + ch[i + 1] * f : ch[i];
      const v = this.muted ? 0 : Math.max(-1, Math.min(1, s));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) {
        this.port.postMessage({ type: 'pcm', data: this.buf.buffer, rms: this.muted ? 0 : rms }, [this.buf.buffer]);
        this.buf = new Int16Array(1600);
        this.n = 0;
      }
    }
    this.pos -= ch.length;
    this.port.postMessage({ type: 'level', rms: this.muted ? 0 : rms });
    return true;
  }
}
registerProcessor('capture', Capture);
