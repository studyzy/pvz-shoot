const MASTER = 0.5;

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.03);
    }
  }

  ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  tone(opts) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.15;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), t);
    if (opts.endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t + dur);
    }
    const peak = opts.gain === undefined ? 0.15 : opts.gain;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (opts.attack || 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = gain;
    if (this.ctx.createStereoPanner && opts.pan) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(pan);
      out = pan;
    }
    osc.connect(gain);
    out.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);

    if (opts.vibrato) {
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = opts.vibrato;
      lfoGain.gain.value = opts.vibratoDepth || 12;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.03);
    }
  }

  noise(opts) {
    if (!this.ready() || !this.noiseBuf) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.3;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filter || 'lowpass';
    filter.frequency.setValueAtTime(opts.freq || 1000, t);
    if (opts.endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.endFreq), t + dur);
    const gain = this.ctx.createGain();
    const peak = opts.gain === undefined ? 0.2 : opts.gain;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (opts.attack || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  shootPea() {
    this.tone({ type: 'triangle', freq: 720, endFreq: 250, dur: 0.075, gain: 0.1 });
    this.noise({ dur: 0.05, gain: 0.05, freq: 2400, filter: 'bandpass' });
  }

  shootIce() {
    this.tone({ type: 'sine', freq: 900, endFreq: 1650, dur: 0.14, gain: 0.06 });
    this.tone({ type: 'sine', freq: 1500, endFreq: 2200, dur: 0.09, gain: 0.035, delay: 0.02 });
    this.noise({ dur: 0.12, gain: 0.04, freq: 4200, filter: 'highpass' });
  }

  throwCherry() {
    this.noise({ dur: 0.22, gain: 0.1, freq: 900, endFreq: 2400, filter: 'bandpass' });
    this.tone({ type: 'sine', freq: 300, endFreq: 170, dur: 0.12, gain: 0.05 });
  }

  cannon() {
    this.tone({ type: 'sawtooth', freq: 160, endFreq: 55, dur: 0.35, gain: 0.22 });
    this.noise({ dur: 0.3, gain: 0.24, freq: 1600, endFreq: 200 });
  }

  explosion(big) {
    const k = big ? 1 : 0.7;
    this.noise({ dur: 0.75, gain: 0.48 * k, freq: 1800, endFreq: 90 });
    this.tone({ type: 'sine', freq: 120, endFreq: 36, dur: 0.5, gain: 0.34 * k });
    this.tone({ type: 'triangle', freq: 220, endFreq: 60, dur: 0.22, gain: 0.14 });
  }

  hit() {
    this.tone({ type: 'square', freq: 480, endFreq: 300, dur: 0.05, gain: 0.05 });
  }

  headshot() {
    this.tone({ type: 'sine', freq: 1320, dur: 0.09, gain: 0.07 });
    this.tone({ type: 'sine', freq: 1760, dur: 0.13, gain: 0.05, delay: 0.03 });
  }

  hurt() {
    this.tone({ type: 'sawtooth', freq: 190, endFreq: 70, dur: 0.3, gain: 0.16 });
    this.noise({ dur: 0.2, gain: 0.09, freq: 700 });
  }

  pickup() {
    this.tone({ type: 'sine', freq: 880, dur: 0.09, gain: 0.055 });
    this.tone({ type: 'sine', freq: 1320, dur: 0.12, gain: 0.05, delay: 0.055 });
  }

  deny() {
    this.tone({ type: 'square', freq: 180, endFreq: 120, dur: 0.1, gain: 0.05 });
  }

  click() {
    this.tone({ type: 'sine', freq: 640, endFreq: 520, dur: 0.05, gain: 0.045 });
  }

  groan(vol, pan) {
    const v = (vol || 0.5) * 0.11;
    this.tone({
      type: 'sawtooth',
      freq: 92 + Math.random() * 26,
      dur: 0.75 + Math.random() * 0.3,
      gain: v,
      attack: 0.12,
      pan: pan || 0,
      vibrato: 5.5,
      vibratoDepth: 9,
    });
    this.tone({
      type: 'triangle',
      freq: 140 + Math.random() * 30,
      endFreq: 90,
      dur: 0.6,
      gain: v * 0.4,
      attack: 0.1,
      pan: pan || 0,
    });
  }

  dirt() {
    this.noise({ dur: 0.2, gain: 0.1, freq: 800, endFreq: 220 });
  }

  step() {
    this.noise({ dur: 0.07, gain: 0.045, freq: 900, endFreq: 300, filter: 'lowpass' });
    this.tone({ type: 'sine', freq: 120, endFreq: 70, dur: 0.08, gain: 0.035 });
  }

  waveStart(boss) {
    this.tone({ type: 'sawtooth', freq: 118, dur: 0.55, gain: 0.14, attack: 0.04 });
    this.tone({ type: 'sawtooth', freq: 157, dur: 0.55, gain: 0.1, attack: 0.04, delay: 0.02 });
    this.tone({ type: 'sine', freq: 78, dur: 0.9, gain: 0.14, attack: 0.08, delay: 0.1 });
    if (boss) {
      this.tone({ type: 'sawtooth', freq: 52, endFreq: 34, dur: 1.2, gain: 0.2, attack: 0.2 });
    }
  }

  waveClear() {
    this.tone({ type: 'sine', freq: 523, dur: 0.16, gain: 0.07 });
    this.tone({ type: 'sine', freq: 659, dur: 0.16, gain: 0.07, delay: 0.1 });
    this.tone({ type: 'sine', freq: 784, dur: 0.3, gain: 0.08, delay: 0.2 });
  }

  death() {
    this.tone({ type: 'sawtooth', freq: 220, endFreq: 40, dur: 1.3, gain: 0.22 });
    this.noise({ dur: 0.8, gain: 0.12, freq: 500, endFreq: 80 });
  }
}
