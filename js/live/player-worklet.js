// Відтворення PCM з черги (Float32 у sampleRate контексту), з миттєвим очищенням при перериванні
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.off = 0;
    this.playing = false;
    this.frames = 0;
    this.empty = 0;         // скільки квантів поспіль черга порожня: «вчитель замовк» — лише після ~250 мс (розрив між шматками звуку — не кінець репліки)
    this.idleAfter = Math.ceil(0.25 * sampleRate / 128);
    this.port.onmessage = (e) => {
      if (e.data.type === 'push') this.queue.push(e.data.data);
      else if (e.data.type === 'clear') { this.queue = []; this.cur = null; this.off = 0; this.empty = this.idleAfter; }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let sum = 0, wrote = 0;
    for (let i = 0; i < out.length; i++) {
      if (!this.cur || this.off >= this.cur.length) { this.cur = this.queue.shift() || null; this.off = 0; }
      if (!this.cur) { out[i] = 0; continue; }
      const v = this.cur[this.off++];
      out[i] = v; sum += v * v; wrote++;
    }
    this.empty = wrote > 0 ? 0 : this.empty + 1;
    const playing = wrote > 0 || (this.playing && this.empty < this.idleAfter);
    if (playing !== this.playing) { this.playing = playing; this.port.postMessage({ type: playing ? 'start' : 'idle' }); }
    if (++this.frames % 4 === 0) this.port.postMessage({ type: 'level', rms: wrote ? Math.sqrt(sum / wrote) : 0 });
    return true;
  }
}
registerProcessor('player', Player);
