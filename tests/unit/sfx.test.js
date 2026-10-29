import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installFakeAudio } from '../helpers/env.js';
import { Sfx } from '../../src/audio/Sfx.js';

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
    // [标签, 方法名, 参数, 预期的振荡器数, 预期的噪声源数]
    const CASES = [
      ['shootPea', 'shootPea', [], 1, 1],
      ['shootIce', 'shootIce', [], 2, 1],
      ['throwCherry', 'throwCherry', [], 1, 1],
      ['cannon', 'cannon', [], 1, 1],
      ['explosion()', 'explosion', [false], 2, 1],
      ['explosion(true)', 'explosion', [true], 2, 1],
      ['hit', 'hit', [], 1, 0],
      ['headshot', 'headshot', [], 2, 0],
      ['hurt', 'hurt', [], 1, 1],
      ['pickup', 'pickup', [], 2, 0],
      ['deny', 'deny', [], 1, 0],
      ['click', 'click', [], 1, 0],
      // groan 的第一层带 vibrato → 额外一个 LFO 振荡器
      ['groan()', 'groan', [], 3, 0],
      ['groan(vol,pan)', 'groan', [0.8, -0.3], 3, 0],
      ['dirt', 'dirt', [], 0, 1],
      ['step', 'step', [], 1, 1],
      ['waveStart()', 'waveStart', [], 3, 0],
      ['waveStart(boss)', 'waveStart', [true], 4, 0],
      ['waveClear', 'waveClear', [], 3, 0],
      ['death', 'death', [], 1, 1],
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
      const methods = ['shootPea', 'shootIce', 'throwCherry', 'cannon', 'explosion', 'hit', 'headshot',
        'hurt', 'pickup', 'deny', 'click', 'groan', 'dirt', 'step', 'waveStart', 'waveClear', 'death'];
      for (const m of methods) expect(() => s[m]()).not.toThrow();
      expect(audio.created).toHaveLength(0);
    });

    it('explosion(big) 的噪声与低频层按 1 / 0.7 放大，第三层固定 0.14', () => {
      const peaks = (big) => {
        const s = unlocked();
        const ctx = s.ctx;
        s.explosion(big);
        return effectGains(ctx).map((g) => g.gain.calls[1][1]);
      };
      const small = peaks(false);
      const big = peaks(true);
      expect(small).toHaveLength(3);
      expect(small[0]).toBeCloseTo(0.48 * 0.7, 6); // noise
      expect(small[1]).toBeCloseTo(0.34 * 0.7, 6); // 低频 sine
      expect(small[2]).toBeCloseTo(0.14, 6); // 第三层不随 big 变化
      expect(big[0]).toBeCloseTo(0.48, 6);
      expect(big[1]).toBeCloseTo(0.34, 6);
      expect(big[2]).toBeCloseTo(0.14, 6);
      expect(big[0] / small[0]).toBeCloseTo(1 / 0.7, 6);
      expect(big[1] / small[1]).toBeCloseTo(1 / 0.7, 6);
    });

    it('groan 的音量 = vol*0.11，第二层是其 0.4 倍，并都带左右声像', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.groan(0.8, 0.5);
      // 第一层 tone 的包络 gain 先创建，随后插入 vibrato 的 lfoGain，最后才是第二层 tone
      const gains = effectGains(ctx);
      expect(gains).toHaveLength(3);
      expect(gains[1].gain.value).toBe(9); // groan 传入 vibratoDepth: 9
      const toneGains = [gains[0], gains[2]];
      expect(toneGains[0].gain.calls[1][1]).toBeCloseTo(0.8 * 0.11, 6);
      expect(toneGains[1].gain.calls[1][1]).toBeCloseTo(0.8 * 0.11 * 0.4, 6);
      const pans = ctx.createStereoPanner.mock.results.map((r) => r.value);
      expect(pans).toHaveLength(2);
      expect(pans[0].pan.value).toBe(0.5);
      expect(pans[1].pan.value).toBe(0.5);
    });

    it('groan 不传参数时使用默认 vol=0.5 / pan=0', () => {
      const s = unlocked();
      const ctx = s.ctx;
      s.groan();
      const gains = effectGains(ctx);
      expect(gains[0].gain.calls[1][1]).toBeCloseTo(0.5 * 0.11, 6);
      expect(gains[2].gain.calls[1][1]).toBeCloseTo(0.5 * 0.11 * 0.4, 6);
      // pan=0 是 falsy，不会创建 StereoPanner
      expect(ctx.createStereoPanner).not.toHaveBeenCalled();
    });

    it('headshot 频率高于 hit（听感上区分爆头）', () => {
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
      expect(freqCalls.map((c) => c[0][1])).toEqual([118, 157, 78, 52]);
      expect(freqCalls[3][1]).toEqual(['expRamp', 34, 1.2]);
    });
  });
});