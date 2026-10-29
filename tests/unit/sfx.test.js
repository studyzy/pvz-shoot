import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installFakeAudio } from '../helpers/env.js';
import { Sfx, decodeWav } from '../../src/audio/Sfx.js';
import { gun1 } from '../../src/fx/audio.js';

// 第 0 个 createGain 是 unlock 时的 master，之后的才是单次音效的包络。
const effectGains = (ctx) => ctx.createGain.mock.results.slice(1).map((r) => r.value);

describe('Sfx', () => {
  let audio;

  beforeEach(() => {
    audio = installFakeAudio();
  });

  const unlocked = () => {
    const s = new Sfx();
    s.unlock();
    return s;
  };

  describe('unlock / ready', () => {
    it('unlock 前 ready() 为 false，tone/noise 不创建任何节点', () => {
      const s = new Sfx();
      expect(s.ready()).toBeFalsy();
      expect(s.ctx).toBe(null);
      s.tone({ freq: 440 });
      s.noise({ dur: 0.1 });
      expect(audio.created).toHaveLength(0);
    });

    it('unlock 创建 AudioContext、0.5 音量的 master 并接到 destination', () => {
      const s = new Sfx();
      expect(vi.isMockFunction(s.setMuted)).toBe(false);
      s.unlock();
      expect(audio.created).toHaveLength(1);
      const ctx = audio.created[0];
      expect(s.ctx).toBe(ctx);
      expect(s.master).toBeTruthy();
      expect(s.master.gain.value).toBe(0.5);
      expect(s.master.connect).toHaveBeenCalledWith(ctx.destination);
      expect(s.ready()).toBe(true);
    });

    it('unlock 预生成 1.2 秒噪声缓冲，全部是 [-1,1] 随机数', () => {
      const s = unlocked();
      const ctx = audio.created[0];
      expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
      expect(ctx.createBuffer).toHaveBeenCalledWith(1, Math.floor(44100 * 1.2), 44100);
      expect(s.noiseBuf).toBeTruthy();
      expect(s.noiseBuf.length).toBe(Math.floor(44100 * 1.2));
      const data = s.noiseBuf.getChannelData(0);
      for (let i = 0; i < 50; i++) {
        expect(data[i]).toBeGreaterThanOrEqual(-1);
        expect(data[i]).toBeLessThanOrEqual(1);
      }
    });

    it('重复 unlock 不重复创建 AudioContext / master / 缓冲', () => {
      const s = unlocked();
      const ctx = s.ctx;
      const master = s.master;
      s.unlock();
      s.unlock();
      expect(audio.created).toHaveLength(1);
      expect(s.ctx).toBe(ctx);
      expect(s.master).toBe(master);
      expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
      expect(ctx.createGain).toHaveBeenCalledTimes(1);
    });

    it('ctx 为 suspended 时 unlock 调 resume', () => {
      const s = unlocked();
      const ctx = s.ctx;
      ctx.state = 'suspended';
      s.unlock();
      expect(ctx.resume).toHaveBeenCalledTimes(1);
      expect(ctx.resume).toHaveBeenCalledTimes(1);
    });

    it('环境没有 AudioContext 时 unlock 安静返回', () => {
      delete window.AudioContext;
      delete window.webkitAudioContext;
      const s = new Sfx();
      expect(() => s.unlock()).not.toThrow();
      expect(s.ctx).toBe(null);
      expect(s.ready()).toBeFalsy();
    });

    it('AudioContext 构造抛错时 unlock 吞掉异常', () => {
      window.AudioContext = function () {
        throw new Error('blocked');
      };
      const s = new Sfx();
      expect(() => s.unlock()).not.toThrow();
      expect(s.ctx).toBe(null);
    });

    it('没有 createStereoPanner 的环境下 pan 参数被忽略且仍发声', () => {
      const s = unlocked();
      const ctx = s.ctx;
      delete ctx.createStereoPanner;
      expect(() => s.tone({ freq: 440, pan: 0.8 })).not.toThrow();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      expect(effectGains(ctx)[0].connect).toHaveBeenCalledWith(s.master);
    });

    it('ctx.state !== running 时 ready() 为 false 且不发声', () => {
      const s = unlocked();
      const ctx = s.ctx;
      ctx.state = 'suspended';
      expect(s.ready()).toBeFalsy();
      const oscBefore = ctx.createOscillator.mock.calls.length;
      const srcBefore = ctx.createBufferSource.mock.calls.length;
      s.shootPea();
      s.explosion(true);
      s.tone({ freq: 440 });
      s.noise({ dur: 0.1 });
      expect(ctx.createOscillator.mock.calls.length).toBe(oscBefore);
      expect(ctx.createBufferSource.mock.calls.length).toBe(srcBefore);
    });

    it('已 unlock 但尚未 running 时 unlock() 会 resume', () => {
      const s = unlocked();
      s.ctx.state = 'closed';
      s.unlock();
      expect(s.ctx.resume).not.toHaveBeenCalled();
      s.ctx.state = 'suspended';
      s.unlock();
      expect(s.ctx.resume).toHaveBeenCalled();
    });
  });

  describe('setMuted', () => {
    it('未创建 ctx 时调用不抛错，只记录状态', () => {
      const s = new Sfx();
      expect(() => s.setMuted(true)).not.toThrow();
      expect(s.muted).toBe(true);
    });

    it('静音切到 0、取消静音切回 0.5，走 setTargetAtTime(…, 0.03)', () => {
      const s = unlocked();
      const ctx = s.ctx;
      const spy = vi.spyOn(s.master.gain, 'setTargetAtTime');
      s.setMuted(true);
      expect(spy).toHaveBeenLastCalledWith(0, ctx.currentTime, 0.03);
      expect(s.master.gain.value).toBe(0);
      s.setMuted(false);
      expect(spy).toHaveBeenLastCalledWith(0.5, ctx.currentTime, 0.03);
      expect(s.master.gain.value).toBe(0.5);
    });

    it('静音状态下 unlock 的 master 初始音量为 0', () => {
      const s = new Sfx();
      s.setMuted(true);
      s.unlock();
      expect(s.master.gain.value).toBe(0);
    });
  });

  describe('tone / noise 基础参数', () => {
    it('tone 设置类型、频率、包络并接到 master', () => {
      const s = unlocked();
      const ctx = s.ctx;
      const master = s.master;
      s.tone({ type: 'square', freq: 500, endFreq: 200, dur: 0.2, gain: 0.3, attack: 0.01, delay: 0.05 });

      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.type).toBe('square');
      expect(osc.frequency.calls[0]).toEqual(['setValueAtTime', 500, 0.05]);
      expect(osc.frequency.calls[1]).toEqual(['expRamp', 200, 0.25]);
      expect(osc.start).toHaveBeenCalledWith(0.05);
      expect(osc.stop).toHaveBeenCalledWith(0.05 + 0.2 + 0.03);

      const gain = effectGains(ctx)[0];
      expect(gain.gain.calls.map((c) => c[0])).toEqual(['setValueAtTime', 'expRamp', 'expRamp']);
      expect(gain.gain.calls[0]).toEqual(['setValueAtTime', 0.0001, 0.05]);
      expect(gain.gain.calls[1]).toEqual(['expRamp', 0.3, 0.05 + 0.01]);
      expect(gain.gain.calls[2]).toEqual(['expRamp', 0.0001, 0.05 + 0.2]);
      expect(gain.connect).toHaveBeenCalledWith(master);
      expect(osc.connect).toHaveBeenCalledWith(gain);
    });

    it('tone 默认值：sine / 0.15 秒 / 增益 0.15 / 攻击 0.006；频率下限 20', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.tone({ freq: 5 });
      const osc = ctx.createOscillator.mock.results[0].value;
      expect(osc.type).toBe('sine');
      expect(osc.frequency.calls[0]).toEqual(['setValueAtTime', 20, 0]);
      expect(osc.stop).toHaveBeenCalledWith(0.15 + 0.03);
      const gain = effectGains(ctx)[0];
      expect(gain.gain.calls[1]).toEqual(['expRamp', 0.15, 0.006]);
    });

    it('tone 的 pan 走 StereoPanner 并钳制到 [-1,1]', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.tone({ freq: 440, pan: 5 });
      expect(ctx.createStereoPanner).toHaveBeenCalledTimes(1);
      const pan = ctx.createStereoPanner.mock.results[0].value;
      expect(pan.pan.value).toBe(1);
      const gain = effectGains(ctx)[0];
      expect(pan.connect).toHaveBeenCalledWith(s.master);
      expect(gain.connect).toHaveBeenCalledWith(pan);

      s.tone({ freq: 440, pan: -2 });
      expect(ctx.createStereoPanner.mock.results[1].value.pan.value).toBe(-1);
    });

    it('tone 的 vibrato 额外创建 LFO 振荡器接到频率', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.tone({ freq: 440, vibrato: 6, vibratoDepth: 15 });
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
      const lfo = ctx.createOscillator.mock.results[1].value;
      expect(lfo.frequency.value).toBe(6);
      const lfoGain = effectGains(ctx)[1];
      expect(lfoGain.gain.value).toBe(15);
      expect(lfo.connect).toHaveBeenCalledWith(lfoGain);
      const osc = ctx.createOscillator.mock.results[0].value;
      expect(lfoGain.connect).toHaveBeenCalledWith(osc.frequency);
      expect(lfo.start).toHaveBeenCalled();
    });

    it('noise 使用预生成缓冲、可循环，经 BiquadFilter + gain 到 master', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.noise({ dur: 0.5, gain: 0.4, freq: 1200, endFreq: 100, filter: 'highpass', attack: 0.02 });
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
      const src = ctx.createBufferSource.mock.results[0].value;
      expect(src.buffer).toBe(s.noiseBuf);
      expect(src.loop).toBe(true);
      expect(src.start).toHaveBeenCalledWith(0);
      expect(src.stop).toHaveBeenCalledWith(0.5 + 0.05);

      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(filter.type).toBe('highpass');
      expect(filter.frequency.calls[0]).toEqual(['setValueAtTime', 1200, 0]);
      expect(filter.frequency.calls[1]).toEqual(['expRamp', 100, 0.5]);

      const gain = effectGains(ctx)[0];
      expect(gain.gain.calls[1]).toEqual(['expRamp', 0.4, 0.02]);
      expect(src.connect).toHaveBeenCalledWith(filter);
      expect(filter.connect).toHaveBeenCalledWith(gain);
      expect(gain.connect).toHaveBeenCalledWith(s.master);
    });

    it('noise 默认 lowpass / 1000Hz / 0.3 秒 / 增益 0.2', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.noise({});
      const filter = ctx.createBiquadFilter.mock.results[0].value;
      expect(filter.type).toBe('lowpass');
      expect(filter.frequency.calls[0]).toEqual(['setValueAtTime', 1000, 0]);
      expect(ctx.createBufferSource.mock.results[0].value.stop).toHaveBeenCalledWith(0.35);
      expect(effectGains(ctx)[0].gain.calls[1]).toEqual(['expRamp', 0.2, 0.004]);
    });
  });

  describe('全部音效方法', () => {
    // [标签, 方法名, 参数, 预期的振荡器数, 预期的噪声源数（含采样播放的 BufferSource）]
    const CASES = [
      // 开火/命中这类高频音效走采样（createBufferSource 播音频缓冲，也算一个 BufferSource），
      // 合成层只保留气声、提示音、低频扫频这类补充。
      ['shootPea', 'shootPea', [], 0, 2],
      ['shootIce', 'shootIce', [], 0, 1],
      ['throwCherry', 'throwCherry', [], 0, 1],
      ['cannon', 'cannon', [], 0, 2],
      ['explosion()', 'explosion', [false], 0, 1],
      ['explosion(true)', 'explosion', [true], 0, 2],
      ['hit', 'hit', [], 0, 1],
      ['headshot', 'headshot', [], 2, 1],
      ['hurt', 'hurt', [], 0, 2],
      ['pickup', 'pickup', [], 2, 0],
      ['deny', 'deny', [], 1, 0],
      ['click', 'click', [], 1, 0],
      // groan 的第一层带 vibrato → 额外一个 LFO 振荡器
      ['groan()', 'groan', [], 0, 1],
      ['groan(vol,pan)', 'groan', [0.8, -0.3], 0, 1],
      ['dirt', 'dirt', [], 0, 1],
      ['step', 'step', [], 0, 1],
      ['waveStart()', 'waveStart', [], 2, 1],
      ['waveStart(boss)', 'waveStart', [true], 3, 1],
      ['waveClear', 'waveClear', [], 3, 0],
      ['death', 'death', [], 0, 1],
      ['shootFire', 'shootFire', [], 0, 1],
      ['armorBreak', 'armorBreak', [], 1, 2],
      ['shieldUp', 'shieldUp', [], 0, 1],
      ['shieldBreak', 'shieldBreak', [], 1, 1],
      ['balloonPop', 'balloonPop', [], 0, 1],
    ];

    it.each(CASES)('%s 产生预期的振荡器/噪声源数量', (label, method, args, oscs, noises) => {
      const s = unlocked();
      const ctx = s.ctx;
      expect(typeof s[method]).toBe('function');
      s[method](...args);
      expect(ctx.createOscillator.mock.calls.length).toBe(oscs);
      expect(ctx.createBufferSource.mock.calls.length).toBe(noises);
      // 所有节点最终都要连到 master，不能直连 destination
      for (const r of ctx.createBufferSource.mock.results) expect(r.value.connect).toHaveBeenCalled();
      // 所有发声节点最终都经由 master 输出，没有直连 destination
      expect(s.master.connect).toHaveBeenCalledWith(ctx.destination);
    });

    it('每个音效方法在未解锁时都不抛错且不创建节点', () => {
      const s = new Sfx();
      const methods = ['shootPea', 'shootIce', 'shootFire', 'throwCherry', 'cannon', 'explosion', 'hit', 'headshot',
        'hurt', 'pickup', 'deny', 'click', 'groan', 'dirt', 'step', 'waveStart', 'waveClear', 'death',
        'armorBreak', 'shieldUp', 'shieldBreak', 'balloonPop'];
      for (const m of methods) expect(() => s[m]()).not.toThrow();
      expect(audio.created).toHaveLength(0);
    });

    it('explosion(big) 额外加一层低频噪声，小爆炸只有采样', () => {
      const counts = (big) => {
        const s = unlocked();
        const ctx = s.ctx;
        s.explosion(big);
        return ctx.createBufferSource.mock.calls.length;
      };
      expect(counts(false)).toBe(counts(true) - 1);
    });

    it('groan 的音量随 vol 缩放（vol=0 不发声），并按 pan 摆左右', () => {
      const sources = (vol) => {
        const s = unlocked();
        s.groan(vol, 0);
        return s.ctx.createBufferSource.mock.calls.length;
      };
      expect(sources(0)).toBe(0);
      expect(sources(0.5)).toBe(1);
      expect(sources(0.8)).toBe(1);
      const s = unlocked();
      s.groan(0.8, 0.5);
      const pan = s.ctx.createStereoPanner.mock.results.at(-1).value;
      expect(pan.pan.value).toBe(0.5);
    });

    it('采样走 BufferSource → Gain → master，播放速率在随机音高范围内', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.shootIce();
      const src = ctx.createBufferSource.mock.results.at(-1).value;
      expect(src.buffer).toBe(s.sample('freeze'));
      expect(src.start).toHaveBeenCalled();
      expect(src.onended).toBeTypeOf('function');
      const rate = src.playbackRate.value;
      expect(rate).toBeGreaterThanOrEqual(0.95);
      expect(rate).toBeLessThanOrEqual(1.05);
      const gain = ctx.createGain.mock.results.at(-1).value;
      expect(gain.gain.value).toBeGreaterThan(0);
      expect(gain.gain.value).toBeLessThan(1);
    });

    it('同一个采样只解码一次，重复播放复用缓冲', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.step();
      const first = s.sample('splash5');
      const calls = ctx.createBuffer.mock.calls.length;
      s.step();
      expect(s.sample('splash5')).toBe(first);
      expect(ctx.createBuffer.mock.calls.length).toBe(calls);
    });

    it('sample/handle 在未解锁或素材缺失时安全返回 null', () => {
      const locked = new Sfx();
      expect(locked.sample('gun1')).toBe(null);
      const s = unlocked();
      expect(s.sample('不存在的键')).toBe(null);
      expect(() => s.play('不存在的键')).not.toThrow();
      expect(() => s.playSample('不存在的键', 1, {})).not.toThrow();
    });

    it('decodeWav 拒绝非 WAV / 非 PCM16 的数据', () => {
      expect(decodeWav(new Uint8Array(0))).toBe(null);
      expect(decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toBe(null);
      const bytes = Uint8Array.from(gun1, (c) => c.charCodeAt(0) & 0xff);
      const wav = decodeWav(bytes);
      expect(wav.rate).toBe(22050);
      expect(wav.channels).toBe(1);
      expect(wav.frames).toBeGreaterThan(1000);
    });

    it('headshot 有比普通命中更高的提示音（听感上区分爆头）', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.headshot();
      const freqs = ctx.createOscillator.mock.results.map((r) => r.value.frequency.calls[0][1]);
      expect(freqs).toEqual([1320, 1760]);
    });

    it('waveStart(boss) 追加一个低沉的 52→34Hz 扫频', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.waveStart(true);
      const freqCalls = ctx.createOscillator.mock.results.map((r) => r.value.frequency.calls);
      expect(freqCalls.map((c) => c[0][1])).toEqual([118, 157, 52]);
      expect(freqCalls[2][1]).toEqual(['expRamp', 34, 1.2]);
    });
  });
});