/** Tiny WebAudio synth for paper-ish SFX — no audio files to download. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    void this.ctx?.resume();
  }
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, delay = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  private rustle(dur = 0.25, vol = 0.12) {
    if (this.muted || !this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2400; g.gain.value = vol;
    s.connect(f).connect(g).connect(this.ctx.destination); s.start();
  }
  jump() { this.tone(420, 0.16, 'triangle', 0.12, 260); }
  star() { [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.12, 0, i * 0.07)); }
  fold() { this.rustle(0.35, 0.18); this.tone(180, 0.3, 'triangle', 0.12, -80, 0.25); }
  talk() { this.tone(660 + Math.random() * 120, 0.05, 'square', 0.03); }
  splash() { this.rustle(0.5, 0.2); }
  /** maraca shaker: short filtered noise ticks */
  shaker(delay = 0) {
    if (this.muted || !this.ctx) return;
    const c = this.ctx, n = Math.floor(c.sampleRate * 0.09), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = 'highpass'; f.frequency.value = 5200; g.gain.value = 0.22;
    s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + delay);
  }
  /** original little tune for かい's maracas (note = semitones from C5, beat length in s) */
  melody(full = false) {
    const A = [[7, 1], [9, 1], [12, 2], [9, 1], [7, 1], [4, 2]];
    const B = [[4, 1], [7, 1], [9, 1], [12, 1], [14, 1], [16, 1], [19, 3]];
    const notes = full ? [...A, ...B] : A;
    const beat = 0.16;
    let t = 0;
    for (const [st, len] of notes) {
      const f = 523.25 * Math.pow(2, st / 12);
      this.tone(f, beat * len * 0.95, 'triangle', 0.13, 0, t);
      this.tone(f * 2, beat * len * 0.5, 'sine', 0.03, 0, t);
      this.shaker(t); if (len > 1) this.shaker(t + beat);
      t += beat * len;
    }
    return t;
  }
  clear() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14, 0, i * 0.13)); }
}
