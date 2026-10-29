// 测试工具：DOM 骨架、WebAudio / 指针锁替身、全局状态清理。
// 只做“把浏览器环境补齐”，不碰业务逻辑，业务逻辑一律走真实源码。
import { vi } from 'vitest';

// 真实 fixture 由 vitest.config.js 在 node 侧读好并 define 注入（见 installFixtures）。
export function installFixtures() {
  globalThis.__fixture = {
    indexHtml: __fixture_index_html__,
    zombieGlb: new Uint8Array(__fixture_zombie_glb__),
    sources: __fixture_sources__,
  };
}

// 读取仓库内的项目文件内容（index.html / 源码）。文件由 vitest.config.js 在 node 侧读好
// 并 define 注入，因为 jsdom 测试环境的模块图里 node:fs 会被 vite externalize 成空壳。
export function readSource(relPath) {
  const text = globalThis.__fixture.sources[relPath];
  if (text === undefined) throw new Error('未注入的 fixture 文件：' + relPath + '（在 vitest.config.js 的 SOURCE_FILES 里补上）');
  return text;
}

// 读取真实 index.html 并渲染到 document，保证 DOM 结构与线上一致（不手抄 id）。
export function mountIndexHtml() {
  const html = globalThis.__fixture.indexHtml;
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  return document;
}

// ---- WebAudio 替身：Sfx 只用到这些接口，记录调用次数方便断言 ----
class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.calls.push(['setValueAtTime', v, t]);
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.calls.push(['linearRamp', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.calls.push(['expRamp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, c) {
    this.value = v;
    this.calls.push(['setTarget', v, t, c]);
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

function fakeNode(extra = {}) {
  const node = {
    connect: vi.fn((dest) => dest),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...extra,
  };
  return node;
}

export function createFakeAudioContext() {
  const ctx = {
    state: 'running',
    sampleRate: 44100,
    currentTime: 0,
    destination: fakeNode(),
    resume: vi.fn(() => {
      ctx.state = 'running';
      return Promise.resolve();
    }),
    suspend: vi.fn(() => {
      ctx.state = 'suspended';
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => fakeNode({ gain: new FakeParam(1) })),
    createOscillator: vi.fn(() =>
      fakeNode({
        type: 'sine',
        frequency: new FakeParam(440),
        detune: new FakeParam(0),
      })
    ),
    createBuffer: vi.fn((ch, len, rate) => ({
      length: len,
      sampleRate: rate,
      numberOfChannels: ch,
      getChannelData: () => new Float32Array(len),
    })),
    createBufferSource: vi.fn(() =>
      fakeNode({
        buffer: null,
        playbackRate: new FakeParam(1),
        loop: false,
        loopStart: 0,
        loopEnd: 0,
      })
    ),
    createBiquadFilter: vi.fn(() =>
      fakeNode({ type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), detune: new FakeParam(0) })
    ),
    createStereoPanner: vi.fn(() => fakeNode({ pan: new FakeParam(0) })),
    createWaveShaper: vi.fn(() => fakeNode({ curve: null, oversample: 'none' })),
    createDynamicsCompressor: vi.fn(() =>
      fakeNode({
        threshold: new FakeParam(-24),
        knee: new FakeParam(30),
        ratio: new FakeParam(12),
        attack: new FakeParam(0.003),
        release: new FakeParam(0.25),
      })
    ),
  };
  return ctx;
}

// 安装 AudioContext 替身；返回 { AudioContext, created } 供断言。
export function installFakeAudio() {
  const created = [];
  class FakeAudioContext {
    constructor() {
      const ctx = createFakeAudioContext();
      created.push(ctx);
      return ctx;
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
  return { created };
}

// ---- 指针锁替身 ----
export function installPointerLock() {
  let lockedEl = null;
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => lockedEl,
  });
  const lock = function () {
    lockedEl = this;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  const unlock = () => {
    lockedEl = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  HTMLCanvasElement.prototype.requestPointerLock = lock;
  document.exitPointerLock = unlock;
  return {
    isLocked: () => lockedEl,
    forceUnlock: unlock,
  };
}

// ---- 其它全局兜底 ----
export function installGlobals() {
  globalThis.screen = globalThis.screen || {};
  if (!globalThis.screen.orientation) {
    globalThis.screen.orientation = { lock: vi.fn(() => Promise.resolve()) };
  }
  if (!document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
    HTMLElement.prototype.releasePointerCapture = () => {};
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLMediaElement.prototype.play) HTMLMediaElement.prototype.play = () => Promise.resolve();
}

// 每个测试结束后调用：撤掉本轮监听，防止 20+ 个测试文件互相污染。
export function cleanup() {
  if (globalThis.__rafQueue) globalThis.__rafQueue.length = 0;
}