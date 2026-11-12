// 建 RT 失败时的兜底（M2/M4）。
//
// 显存不足、驱动拒绝、上下文丢失都会让 new WebGLRenderTarget 直接抛错。
// 这两种情况下游戏绝对不能黑屏：
//   - postfx 必须把自己标成失败并退回直出（调用方拿到 false 就走 renderer.render）；
//   - SSAO 必须退化成「没有 AO」，而不是把后期整条拖死。
//
// jsdom 里没法真的把显存打满，所以把 three 的 WebGLRenderTarget 换成必抛的类，
// 让真实的装配路径（try/catch 分支）跑一遍。
import { describe, it, expect, vi } from 'vitest';
import { makeGLRenderer } from '../helpers/glstub.js';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WebGLRenderTarget: class {
      constructor() {
        throw new Error('render target 申请失败');
      }
    },
  };
});

const { createPostFX, LEVEL_FULL } = await import('../../src/fx/postfx.js');
const { createSSAO } = await import('../../src/fx/ssao.js');

describe('后期管线 · 建 RT 失败', () => {
  it('退回哑对象：enabled=false、failed=true、render 一律 false', () => {
    const p = createPostFX(makeGLRenderer().renderer, { level: LEVEL_FULL });
    expect(p.enabled).toBe(false);
    expect(p.failed).toBe(true);
    expect(p.render({}, {})).toBe(false);
    // 哑对象上的调用不能冒泡
    expect(() => p.setSize(640, 360)).not.toThrow();
    expect(() => p.dispose()).not.toThrow();
  });
});

describe('SSAO · 建 RT 失败', () => {
  it('退化成「没有 AO」：texture 为 null、render 返回 false', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    expect(s.texture).toBe(null);
    expect(s.render({}, {})).toBe(false);
    expect(() => s.setSize(1280, 720)).not.toThrow();
    expect(() => s.dispose()).not.toThrow();
  });
});