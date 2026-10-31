const MASTER = 0.5;

// 采样音效：Third-party CC0 素材（来源与裁剪参数见 public/audio/LICENSE-audio.txt）解码成 AudioBuffer 后
// 走 WebAudio 播放。解码用的是自带的 WAV 解析器，不走 fetch + decodeAudioData —— 音效必须在解锁的那一下
// 就能播，而 decodeAudioData 是异步的，第一枪常常会因为缓冲还没回来而静音。
// 素材按 22.05kHz 单声道 PCM 被构建插件内嵌进包里（见 src/fx/audio.js）。
import { gun1, gun2, boom, blackpowder, z1, z2, z3, z4, z5, z6, pop1, slime, slime2, splash5, bubble, freeze } from '../fx/audio.js';

// 每个方法对应一组可选的采样：[['文件键', 相对音量], ...], 最低音高, 最高音高, 'pan' | 'mono'。
// 音量是相对量，在 master 下面再乘一次；调手感只改这张表。
const SAMPLES = {
  shootPea:    [['gun1', 0.2], ['gun2', 0.16], 0.92, 1.08, 'mono'],
  shootFire:   [['gun2', 0.69], 0.9, 1.1, 'mono'],
  shootIce:    [['freeze', 0.42], 0.95, 1.05, 'pan'],
  throwCherry: [['bubble', 0.6], 0.9, 1.15, 'pan'],
  cannon:      [['gun1', 0.95], 0.78, 0.86, 'pan'],
  explosion:   [['boom', 0.9], 0.9, 1.12, 'pan'],
  hit:         [['pop1', 0.3], 0.85, 1.2, 'pan'],
  hurt:        [['z4', 0.5], 0.85, 1.0, 'mono'],
  step:        [['splash5', 0.1], 0.7, 0.85, 'mono'],
  creatureSlime: [['slime', 0.45], ['bubble', 0.35], 0.7, 0.9, 'pan'],
  creatureUndead: [['blackpowder', 0.18], ['freeze', 0.2], 0.55, 0.7, 'pan'],
  creatureBeast: [['z4', 0.35], ['splash5', 0.4], 1.2, 1.4, 'pan'],
  creatureGoblin: [['z2', 0.45], ['z5', 0.4], 1.3, 1.55, 'pan'],
  groan:       [['z1', 1], ['z2', 1], ['z3', 1], ['z5', 1], ['z6', 1], 0.82, 1.05, 'pan'],
  waveStart:   [['blackpowder', 0.5], 0.95, 1, 'mono'],
  dirt:        [['splash5', 0.45], 0.5, 0.62, 'mono'],
  death:       [['z4', 0.8], 0.6, 0.7, 'mono'],
  shieldUp:    [['slime', 0.6], 0.9, 1.1, 'mono'],
  shieldBreak: [['slime2', 0.8], 0.85, 1, 'mono'],
  balloonPop:  [['pop1', 0.6], 1.05, 1.2, 'mono'],
};

const BUFFERS = { gun1, gun2, boom, blackpowder, z1, z2, z3, z4, z5, z6, pop1, slime, slime2, splash5, bubble, freeze };

// 最简 WAV（PCM 16bit）解析：只认 PCM 16 位，别的直接当坏素材、不播。
// 入参可以是 Uint8Array、ArrayBuffer，或者内嵌模块给的 latin-1 字符串（一个字符一个字节）。
export function decodeWav(src) {
  const bytes = src instanceof Uint8Array ? src : typeof src === 'string'
    ? Uint8Array.from(src, (c) => c.charCodeAt(0) & 0xff)
    : new Uint8Array(src);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null;
  let dataAt = -1;
  let dataLen = 0;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(o + 8, true),
        channels: dv.getUint16(o + 10, true),
        rate: dv.getUint32(o + 12, true),
        bits: dv.getUint16(o + 22, true),
      };
    } else if (id === 'data') {
      dataAt = o + 8;
      dataLen = Math.min(size, bytes.length - dataAt);
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || dataAt < 0 || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1) return null;
  const frames = Math.floor(dataLen / 2 / fmt.channels);
  return { data: new Int16Array(bytes.buffer, bytes.byteOffset + dataAt, frames * fmt.channels), channels: fmt.channels, frames, rate: fmt.rate };
}

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

  // ---- 采样音效 ----

  // 解码好的缓冲挂在实例上（每个 AudioContext 一份），第一次播放时懒解码。
  sample(name) {
    if (!this.buffers) this.buffers = {};
    if (name in this.buffers) return this.buffers[name];
    let out = null;
    const src = BUFFERS[name];
    if (src && this.ctx) {
      const wav = decodeWav(src);
      if (wav) {
        const buf = this.ctx.createBuffer(wav.channels, wav.frames, wav.rate);
        const scale = 1 / 32768;
        for (let ch = 0; ch < wav.channels; ch++) {
          const dst = buf.getChannelData(ch);
          for (let i = 0; i < wav.frames; i++) dst[i] = wav.data[i * wav.channels + ch] * scale;
        }
        out = buf;
      }
    }
    this.buffers[name] = out;
    return out;
  }

  // entries: [[键, 音量], ...]；随机挑一条，随机音高，按 pan 摆位（'mono' 不摆位、压在正前方）。
  sampleAt(entries, opts) {
    if (!this.ready()) return;
    const [bufferKey, vol] = entries[(Math.random() * entries.length) | 0];
    this.playSample(bufferKey, vol, opts);
  }

  // 单条采样：随机音高 + 包络增益 + 左右摆位。最终音量低于万分之一直接不播（听不见）。
  playSample(name, gain, opts) {
    if (!this.ready() || gain < 1e-4) return;
    // opts.gain 是调用方按场景给的倍率（0 = 静音，例如离得太远），乘以素材本身的 gain
    const outGain = Math.max(0, Math.min(1, (opts.gain === undefined ? 1 : opts.gain) * gain));
    if (outGain < 1e-4) return;
    const buf = this.sample(name);
    if (!buf) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lo = opts.rateMin || 1;
    const hi = opts.rateMax || lo;
    src.playbackRate.value = lo + Math.random() * (hi - lo);
    const g = this.ctx.createGain();
    g.gain.value = outGain;
    src.connect(g);
    let out = g;
    if (this.ctx.createStereoPanner && opts.mode !== 'mono' && opts.pan) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(pan);
      out = pan;
    }
    out.connect(this.master);
    src.start(t);
    // 一次性音效不循环；播完自动断开，避免长时间游戏里节点越积越多
    src.onended = () => { src.disconnect(); g.disconnect(); };
  }

  // 按 SAMPLES 表播一个命名音效：随机挑一条采样、随机音高，立体声宽的按 pan 摆位。
  play(name, opts = {}) {
    const spec = SAMPLES[name];
    if (!spec) return;
    const entries = spec.filter((e) => Array.isArray(e));
    this.sampleAt(entries, {
      rateMin: spec[spec.length - 3],
      rateMax: spec[spec.length - 2],
      mode: spec[spec.length - 1],
      pan: opts.pan || 0,
      gain: opts.gain === undefined ? 1 : opts.gain,
    });
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
    this.play('shootPea');
    // 一小段气声，让每次开火都不完全一样
    this.noise({ dur: 0.04, gain: 0.018, freq: 2600, filter: 'highpass' });
  }

  shootIce() {
    this.play('shootIce');
  }

  shootFire() {
    this.play('shootFire');
  }

  throwCherry() {
    this.play('throwCherry');
  }

  cannon() {
    this.play('cannon');
    this.noise({ dur: 0.22, gain: 0.1, freq: 1400, endFreq: 160 });
  }

  explosion(big) {
    this.play('explosion', { gain: big ? 1 : 0.62 });
    if (big) this.noise({ dur: 0.5, gain: 0.12, freq: 900, endFreq: 80 });
  }

  hit() {
    this.play('hit');
  }

  headshot() {
    this.play('hit', { gain: 1.4 });
    this.tone({ type: 'sine', freq: 1320, dur: 0.09, gain: 0.05 });
    this.tone({ type: 'sine', freq: 1760, dur: 0.13, gain: 0.035, delay: 0.03 });
  }

  hurt() {
    this.play('hurt');
    this.noise({ dur: 0.16, gain: 0.06, freq: 600 });
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

  // 僵尸低吼：随机挑一条真人喉咙声，按距离给音量、按左右给 pan。
  groan(vol, pan) {
    // 只有不传 vol 时才用默认值；显式传 0 表示「太远了听不见」，不能当成没传
    const v = vol === undefined ? 0.5 : vol;
    this.play('groan', { gain: Math.max(0, Math.min(1, v)) * 0.9, pan: pan || 0 });
  }

  creature(family, vol, pan) {
    if (!(vol > 0)) return;
    const names = { slime: 'creatureSlime', undead: 'creatureUndead', beast: 'creatureBeast', goblin: 'creatureGoblin' };
    this.play(names[family] || 'groan', { gain: vol, pan });
  }

  forestAmbience() {
    this.noise({ dur: 1.2, freq: 340, endFreq: 180, gain: 0.008, attack: 0.3 });
  }

  dirt() {
    this.play('dirt');
  }

  step() {
    this.play('step');
  }

  waveStart(boss) {
    this.play('waveStart', { gain: boss ? 1 : 0.7 });
    this.tone({ type: 'sawtooth', freq: 118, dur: 0.55, gain: 0.1, attack: 0.04 });
    this.tone({ type: 'sawtooth', freq: 157, dur: 0.55, gain: 0.07, attack: 0.04, delay: 0.02 });
    if (boss) this.tone({ type: 'sawtooth', freq: 52, endFreq: 34, dur: 1.2, gain: 0.16, attack: 0.2 });
  }

  waveClear() {
    this.tone({ type: 'sine', freq: 523, dur: 0.16, gain: 0.07 });
    this.tone({ type: 'sine', freq: 659, dur: 0.16, gain: 0.07, delay: 0.1 });
    this.tone({ type: 'sine', freq: 784, dur: 0.3, gain: 0.08, delay: 0.2 });
  }

  death() {
    this.play('death');
  }

  // 护甲打穿：命中声 + 金属/塑料碎裂的「啪」
  armorBreak() {
    this.play('hit', { gain: 1.2 });
    this.noise({ dur: 0.14, gain: 0.1, freq: 3200, endFreq: 700, filter: 'highpass' });
    this.tone({ type: 'square', freq: 900, endFreq: 240, dur: 0.09, gain: 0.06 });
  }

  // 坚果套上 / 碎了
  shieldUp() {
    this.play('shieldUp');
  }

  shieldBreak() {
    this.play('shieldBreak');
    this.tone({ type: 'triangle', freq: 140, endFreq: 52, dur: 0.26, gain: 0.1 });
  }

  balloonPop() {
    this.play('balloonPop');
  }
}
