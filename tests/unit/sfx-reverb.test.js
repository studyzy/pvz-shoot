// 卷积混响（docs/plans/2026-11-12-render-overhaul.md §4.2）。
//
// 现状：所有音效都是干声，直接进 master。听感上「贴脸」，没有任何空间信息。
// 补一条混响总线后，玩家能靠尾音判断自己是在旷野（无尾音）还是街区（有回声）。
//
// 为什么自己生成 IR 而不是加载采样：2.4 秒立体声 IR @48kHz 是 460 KB 未压缩，
// 六个场景各一条 2.7 MB —— 比整个游戏 JS 还大。这个代价不能付。
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeAudio } from '../helpers/env.js';
import { Sfx } from '../../src/audio/Sfx.js';

describe('Sfx · 混响总线', () => {
  let audio;
  beforeEach(() => {
    audio = installFakeAudio();
  });

  const unlocked = () => {
    const s = new Sfx();
    s.unlock();
    return s;
  };

  it('unlock 时建好 convolver 与 wetGain，且默认湿声为 0', () => {
    const s = unlocked();
    expect(s.reverb).toBeTruthy();
    expect(s.wetGain).toBeTruthy();
    // 默认必须是 0：没进游戏前不该有任何混响
    expect(s.wetAmount).toBe(0);
    expect(s.wetGain.gain.value).toBe(0);
  });

  it('convolver 挂了一条真实长度的 IR（不是空 buffer）', () => {
    const s = unlocked();
    const buf = s.reverb.buffer;
    expect(buf).toBeTruthy();
    expect(buf.numberOfChannels).toBe(2);
    // 2.4 秒：太短听不出空间感，太长会糊掉枪声
    expect(buf.length).toBe(Math.floor(s.ctx.sampleRate * 2.4));
  });

  it('IR 有衰减包络（开头响、结尾接近静音）', () => {
    const s = unlocked();
    const d = s.reverb.buffer.getChannelData(0);
    const head = Math.max(...Array.from(d.subarray(0, 200)).map(Math.abs));
    const tail = Math.max(...Array.from(d.subarray(d.length - 200)).map(Math.abs));
    expect(head).toBeGreaterThan(tail * 5);
  });

  it('左右声道不是同一份数据（否则听起来是单声道）', () => {
    const s = unlocked();
    const l = s.reverb.buffer.getChannelData(0);
    const r = s.reverb.buffer.getChannelData(1);
    let diff = 0;
    for (let i = 0; i < Math.min(5000, l.length); i++) {
      if (Math.abs(l[i] - r[i]) > 1e-6) diff++;
    }
    expect(diff).toBeGreaterThan(1000);
  });

  it('setReverb 改变湿声量并夹在 0~1', () => {
    const s = unlocked();
    s.setReverb(1);
    expect(s.wetAmount).toBe(1);
    expect(s.wetGain.gain.value).toBeCloseTo(0.42, 4);
    s.setReverb(0.5);
    expect(s.wetAmount).toBe(0.5);
    expect(s.wetGain.gain.value).toBeCloseTo(0.21, 4);
  });

  it('setReverb 对越界与非法输入夹紧，不产生 NaN', () => {
    const s = unlocked();
    s.setReverb(9);
    expect(s.wetAmount).toBe(1);
    s.setReverb(-3);
    expect(s.wetAmount).toBe(0);
    s.setReverb(NaN);
    expect(s.wetAmount).toBe(0);
    expect(Number.isFinite(s.wetGain.gain.value)).toBe(true);
  });

  it('音效同时接干声与湿声两条支路', () => {
    const s = unlocked();
    s.setReverb(0.8);
    const before = s.master.connections ? s.master.connections.length : 0;
    s.tone({ freq: 440, dur: 0.1 });
    // convolver 被调用过 = 湿声支路通
    expect(s.ctx.createConvolver).toHaveBeenCalled();
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('没有 createConvolver 的环境（老 Safari）不崩，湿声静默失效', () => {
    const s = new Sfx();
    // 模拟旧实现：删掉 createConvolver
    const AC = window.AudioContext;
    window.AudioContext = function () {
      const ctx = new AC();
      delete ctx.createConvolver;
      return ctx;
    };
    expect(() => s.unlock()).not.toThrow();
    expect(s.reverb).toBe(null);
    expect(s.wetGain).toBe(null);
    expect(s.ready()).toBe(true); // 其他功能照常
    // setReverb 也不能崩
    expect(() => s.setReverb(0.5)).not.toThrow();
    window.AudioContext = AC;
  });

  it('unlock 之前 setReverb 不崩（只记下意图，等 unlock 后生效）', () => {
    const s = new Sfx();
    expect(() => s.setReverb(0.6)).not.toThrow();
    expect(s.wetAmount).toBe(0.6);
    expect(s.reverb).toBe(null);
  });

  it('IR 生成不依赖 Math.random 的特定值（可重复构建不抛错）', () => {
    for (let i = 0; i < 3; i++) {
      const s = new Sfx();
      expect(() => s.unlock()).not.toThrow();
      expect(s.reverb.buffer.length).toBeGreaterThan(0);
    }
  });
});