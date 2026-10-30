// 全局测试环境：jsdom 不提供 WebGL / 2D canvas / PointerLock / WebAudio，
// 这里统一补上可用的替身，业务代码一律走真实源码。
import { vi, afterEach } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { cleanup, installFixtures } from './helpers/env.js';
import { installImageBitmap } from './helpers/imagebitmap.js';
import { installBlobUrls } from './helpers/bloburl.js';

installFixtures();
installBlobUrls();
installImageBitmap();

// ---- 2D canvas：materials.js / WeaponPickups.js 会画程序化贴图与文字牌 ----
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== '2d') return null; // WebGL 由 tests/helpers/game.js 里的假渲染器替代
  if (!this.__napiCanvas) this.__napiCanvas = createCanvas(1, 1);
  const c = this.__napiCanvas;
  const w = Math.max(1, this.width | 0);
  const h = Math.max(1, this.height | 0);
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c.getContext('2d');
};
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

// ---- requestAnimationFrame：手动驱动，避免测试里真的跑渲染循环 ----
globalThis.requestAnimationFrame = (cb) => {
  const id = (globalThis.__rafId = (globalThis.__rafId || 0) + 1);
  (globalThis.__rafQueue = globalThis.__rafQueue || []).push({ id, cb });
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  const q = globalThis.__rafQueue || [];
  const i = q.findIndex((x) => x.id === id);
  if (i >= 0) q.splice(i, 1);
};

// ---- matchMedia：Controls 用它识别触屏 ----
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

if (!window.visualViewport) {
  window.visualViewport = { addEventListener() {}, removeEventListener() {} };
}

// 按桌面 1440x860 固定视口，游戏按宽高比算 FOV，断言才好写。
const setViewport = (w, h) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h });
};
setViewport(1440, 860);
globalThis.__setViewport = setViewport;
Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 2 });

window.PointerEvent = window.PointerEvent || window.MouseEvent;

afterEach(() => {
  cleanup();
  // Vitest 4：vi.spyOn 复用已存在的 spy 并保留调用历史，不还原会让下一个用例看到上一个用例的调用。
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.body.className = '';
  setViewport(1440, 860);
});