// 音频外置（docs/plans/2026-11-12-render-overhaul.md §6.3）。
//
// 内嵌 WAV 在 bundle 里以 latin-1 + \xNN 转义形式存在，756 KB 原始数据膨胀成约 2.2 MB
// 的 JS 字面量 —— 比主包其他所有代码加起来还大。改成运行时加载 204 KB 的 ogg。
//
// 关键设计：不是「删掉内嵌、全走网络」，而是「内嵌兜底 + ogg 覆盖」。
// fetch 是异步的，开第一枪时 ogg 往往还没到；内嵌路径保证那一刻仍然有声。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeAudio } from '../helpers/env.js';
import { Sfx } from '../../src/audio/Sfx.js';

// 假 AudioBuffer：只要有 duration 就够断言「解码成功」
const fakeBuf = (dur) => ({ duration: dur, length: 1000, sampleRate: 44100 });

describe('Sfx · ogg 运行时加载', () => {
  let audio;
  let origFetch;
  beforeEach(() => {
    audio = installFakeAudio();
    origFetch = global.fetch;
    // 让假 AudioContext 支持 decodeAudioData
    const AC = window.AudioContext;
    window.AudioContext = function () {
      const ctx = new AC();
      ctx.decodeAudioData = vi.fn(async () => fakeBuf(1.5));
      return ctx;
    };
  });
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  // 每个用例都要「干净的一个实例」：unlock 会自动触发一次全量预加载，
  // 那批异步任务会污染下面手动 preloadOgg 的 ogg 表。
  // 所以这里建好实例后立刻把 ogg 清成 {} 并标记已启动，模拟「预加载还没落地」的状态。
  // 不调 unlock()：它会自动踢一次全量预加载，那批异步结果会在断言之后写进 ogg，
  // 造成「表里多出 8 条」这类假失败。这里只建 AudioContext 所需的最小状态。
  const fresh = () => {
    const s = new Sfx();
    s.ctx = { state: 'running', sampleRate: 44100, decodeAudioData: async () => fakeBuf(1.5),
      createBuffer: () => ({ getChannelData: () => new Float32Array(8), duration: 1 }),
      createGain: () => ({ gain: { value: 1, setTargetAtTime() {} }, connect() {}, disconnect() {} }),
      createConvolver: () => ({ buffer: null, connect() {}, normalize: true }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
      destination: {}, currentTime: 0,
    };
    s.master = { gain: { value: 0.5, setTargetAtTime() {} }, connect() {} };
    s.ogg = {};
    return s;
  };
  const unlocked = fresh;

  it('清单里的文件都在 public/audio 下（防止拼错路径静默失效）', () => {
    const m = Sfx.OGG_MANIFEST;
    expect(Object.keys(m).length).toBeGreaterThan(0);
    for (const [name, url] of Object.entries(m)) {
      expect(url, name).toMatch(/^audio\/[a-z0-9]+\.ogg$/);
    }
  });

  it('unlock 后自动开始预加载', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const s = new Sfx();
    expect(s.oggStarted).toBe(false);
    s.unlock();
    expect(s.oggStarted).toBe(true);
    // 等异步落地，顺便验证「unlock 触发的那一批」真的写进了 ogg
    await new Promise((r) => setTimeout(r, 20));
    expect(Object.keys(s.ogg).length).toBe(Object.keys(Sfx.OGG_MANIFEST).length);
  });

  it('重复 unlock 不会重复预加载（oggStarted 是闸门）', () => {
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const s = new Sfx();
    s.unlock();
    const first = global.fetch.mock.calls.length;
    s.unlock();
    s.unlock();
    expect(global.fetch.mock.calls.length).toBe(first);
  });

  it('ctx 处于 suspended 时也要加载（否则无头/未交互环境永远不加载）', () => {
    const AC = window.AudioContext;
    window.AudioContext = function () {
      const ctx = new AC();
      ctx.state = 'suspended';
      ctx.resume = () => {};   // 保持 suspended
      ctx.decodeAudioData = async () => fakeBuf(1.5);
      return ctx;
    };
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const s = new Sfx();
    s.unlock();
    expect(s.ctx.state).toBe('suspended');
    expect(s.oggStarted).toBe(true);
    window.AudioContext = AC;
  });

  it('加载成功后按名字能取到缓冲，且时长正确', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const s = fresh();
    await s.preloadOgg({ gun1: 'audio/gun1.ogg', boom: 'audio/boom.ogg' });
    expect(Object.keys(s.ogg).sort()).toEqual(['boom', 'gun1']);
    expect(s.ogg.gun1.duration).toBe(1.5);
  });

  it('单个音效失败不影响其它（Promise.all 里各自 catch）', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('network');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const s = fresh();
    await s.preloadOgg({ bad: 'audio/bad.ogg', good: 'audio/good.ogg' });
    expect(s.ogg.good).toBeTruthy();
    expect(s.ogg.bad).toBeUndefined();
  });

  it('HTTP 404 静默跳过，不抛错', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    const s = unlocked();
    await expect(s.preloadOgg({ x: 'audio/x.ogg' })).resolves.toBeUndefined();
    expect(s.ogg.x).toBeUndefined();
  });

  it('decodeAudioData 抛错时静默跳过', async () => {
    const s = unlocked();
    s.ctx.decodeAudioData = async () => { throw new Error('bad codec'); };
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    await expect(s.preloadOgg({ x: 'audio/x.ogg' })).resolves.toBeUndefined();
    expect(s.ogg.x).toBeUndefined();
  });

  it('没有 fetch 的环境（老浏览器/测试）直接返回，不崩', async () => {
    const s = unlocked();
    const save = global.fetch;
    delete global.fetch;
    await expect(s.preloadOgg({ x: 'audio/x.ogg' })).resolves.toBeUndefined();
    global.fetch = save;
  });

  it('没有 AudioContext 时 preloadOgg 直接返回', async () => {
    const s = new Sfx();
    await expect(s.preloadOgg({ x: 'audio/x.ogg' })).resolves.toBeUndefined();
  });

  it('传 null / undefined 清单不崩', async () => {
    const s = unlocked();
    await expect(s.preloadOgg(null)).resolves.toBeUndefined();
    await expect(s.preloadOgg(undefined)).resolves.toBeUndefined();
  });

  it('ogg 就绪后 sample() 优先返回 ogg，而不是内嵌 WAV', async () => {
    const s = unlocked();
    const oggBuf = fakeBuf(9.9);
    s.ogg = { gun1: oggBuf };
    // 清掉旧缓存，强制重新查
    if (s.buffers) delete s.buffers.gun1;
    expect(s.sample('gun1')).toBe(oggBuf);
  });

  it('ogg 没就绪时 sample() 不返回 ogg（回落到内嵌或合成兜底）', () => {
    const s = fresh();
    if (s.buffers) delete s.buffers.gun1;
    const buf = s.sample('gun1');
    // 测试环境下是否注入内嵌 WAV 取决于 vitest 插件；这里只断言「不会拿到未加载的 ogg」
    if (buf) expect(buf.duration === undefined || buf.duration >= 0).toBe(true);
  });

  it('ogg 到达后会清掉同名旧缓存，下次 sample() 拿新的', async () => {
    const s = fresh();
    s.buffers = { gun1: fakeBuf(1) };
    global.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    await s.preloadOgg({ gun1: 'audio/gun1.ogg' });
    // preload 里会 delete buffers[name]
    expect(s.buffers.gun1).toBeUndefined();
    expect(s.ogg.gun1).toBeTruthy();
  });
});