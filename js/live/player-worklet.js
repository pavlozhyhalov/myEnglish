// Відтворення PCM з черги (Float32 у sampleRate контексту), з миттєвим очищенням при перериванні
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.off = 0;
    this.playing = false;
    this.frames = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'push') this.queue.push(e.data.data);
      else if (e.data.type === 'clear') { this.queue = []; this.cur = null; this.off = 0; }
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
    const playing = wrote > 0;
    if (playing !== this.playing) { this.playing = playing; this.port.postMessage({ type: playing ? 'start' : 'idle' }); }
    if (++this.frames % 4 === 0) this.port.postMessage({ type: 'level', rms: wrote ? Math.sqrt(sum / wrote) : 0 });
    return true;
  }
}
registerProcessor('player', Player);
