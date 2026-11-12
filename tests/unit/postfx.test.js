// 后期管线（docs/plans/2026-11-12-render-overhaul.md §1.3）。
//
// 这是和参照物差距最核心的一处：原本是 forward 直出，零后处理，所以画面「干」——
// 高光死白、没有光晕、没有镜头感。这里补一条手写的四步管线。
//
// jsdom 没有 WebGL，所以测的是「决策逻辑」（档位解析、mip 尺寸、降级顺序）和
// 「能力探测失败时安全退回直出」，不是像素。
import { describe, it, expect } from 'vitest';
import {
  createPostFX,
  postLevelFromQuery,
  bloomMipSizes,
  degradeStep,
  upgradeStep,
  LEVEL_OFF,
  LEVEL_TONEMAP,
  LEVEL_FULL,
} from '../../src/fx/postfx.js';

describe('档位解析 · ?post=', () => {
  it('缺省桌面端全开', () => {
    expect(postLevelFromQuery('', false)).toBe(LEVEL_FULL);
  });

  it('触屏默认只开色调映射（Bloom 是手机最贵的一步）', () => {
    expect(postLevelFromQuery('', true)).toBe(LEVEL_TONEMAP);
  });

  it('?post=0 彻底关掉（回滚开关）', () => {
    expect(postLevelFromQuery('?post=0', false)).toBe(LEVEL_OFF);
    expect(postLevelFromQuery('?post=0', true)).toBe(LEVEL_OFF);
    expect(postLevelFromQuery('?post=off', false)).toBe(LEVEL_OFF);
  });

  it('?post=1 只留色调映射+收尾', () => {
    expect(postLevelFromQuery('?post=1', false)).toBe(LEVEL_TONEMAP);
    expect(postLevelFromQuery('?post=tonemap', false)).toBe(LEVEL_TONEMAP);
  });

  it('?post=2 全开', () => {
    expect(postLevelFromQuery('?post=2', true)).toBe(LEVEL_FULL);
    expect(postLevelFromQuery('?post=full', true)).toBe(LEVEL_FULL);
  });

  it('和其它参数共存时仍能解析', () => {
    expect(postLevelFromQuery('?autostart=1&post=0&noaudio=1', false)).toBe(LEVEL_OFF);
  });

  it('非法值回落到默认，不崩', () => {
    expect(postLevelFromQuery('?post=abc', false)).toBe(LEVEL_FULL);
    expect(postLevelFromQuery(undefined, false)).toBe(LEVEL_FULL);
    expect(postLevelFromQuery(null, true)).toBe(LEVEL_TONEMAP);
  });
});

describe('Bloom 各层尺寸', () => {
  it('逐级减半', () => {
    const s = bloomMipSizes(1280, 720, 5);
    expect(s.length).toBe(5);
    expect(s[0]).toEqual([640, 360]);
    expect(s[1]).toEqual([320, 180]);
    expect(s[2]).toEqual([160, 90]);
  });

  it('最小不小于 2（0 尺寸的 RT 会 GL 报错）', () => {
    const s = bloomMipSizes(8, 8, 6);
    for (const [w, h] of s) {
      expect(w).toBeGreaterThanOrEqual(2);
      expect(h).toBeGreaterThanOrEqual(2);
    }
  });

  it('奇数尺寸向下取整，不会得到非整数', () => {
    const s = bloomMipSizes(1279, 719, 3);
    for (const [w, h] of s) {
      expect(Number.isInteger(w)).toBe(true);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe('自适应降级顺序', () => {
  it('帧率不够先降档，不动 pixelRatio', () => {
    const r = degradeStep({ level: LEVEL_FULL, pixelRatio: 2, maxPixelRatio: 2 });
    expect(r.level).toBe(LEVEL_TONEMAP);
    expect(r.pixelRatio).toBe(2);
    expect(r.changed).toBe(true);
  });

  it('连降两次才到关，然后才动 pixelRatio', () => {
    let st = { level: LEVEL_FULL, pixelRatio: 2, maxPixelRatio: 2 };
    st = { ...st, ...degradeStep(st) };
    expect(st.level).toBe(LEVEL_TONEMAP);
    expect(st.pixelRatio).toBe(2);
    st = { ...st, ...degradeStep(st) };
    expect(st.level).toBe(LEVEL_OFF);
    expect(st.pixelRatio).toBe(2);
    st = { ...st, ...degradeStep(st) };
    expect(st.level).toBe(LEVEL_OFF);
    expect(st.pixelRatio).toBe(1.75);
  });

  it('到底了就 changed=false（不会无限降）', () => {
    const r = degradeStep({ level: LEVEL_OFF, pixelRatio: 1, maxPixelRatio: 2 });
    expect(r.changed).toBe(false);
    expect(r.pixelRatio).toBe(1);
  });

  it('恢复顺序与降级严格对称：先补 pixelRatio，再升档', () => {
    const r = upgradeStep({
      level: LEVEL_OFF, maxLevel: LEVEL_FULL, pixelRatio: 1, maxPixelRatio: 2,
    });
    expect(r.pixelRatio).toBe(1.1);
    expect(r.level).toBe(LEVEL_OFF);
  });

  it('pixelRatio 满了才升档', () => {
    const r = upgradeStep({
      level: LEVEL_OFF, maxLevel: LEVEL_FULL, pixelRatio: 2, maxPixelRatio: 2,
    });
    expect(r.level).toBe(LEVEL_TONEMAP);
    expect(r.pixelRatio).toBe(2);
  });

  it('都满了 changed=false', () => {
    const r = upgradeStep({
      level: LEVEL_FULL, maxLevel: LEVEL_FULL, pixelRatio: 2, maxPixelRatio: 2,
    });
    expect(r.changed).toBe(false);
  });

  it('来回振荡会被抑制：降到底后升一步，再降一步就回到原点（不会跳过中间态）', () => {
    let st = { level: LEVEL_OFF, pixelRatio: 1, maxLevel: LEVEL_FULL, maxPixelRatio: 2 };
    st = { ...st, ...upgradeStep(st) };
    expect(st.pixelRatio).toBeCloseTo(1.1, 4);
    st = { ...st, ...degradeStep(st) };
    // 档位已经到底，所以只能降 pixelRatio —— 这就是「不振汤」的关键
    expect(st.level).toBe(LEVEL_OFF);
    expect(st.pixelRatio).toBeCloseTo(1.0, 4);
  });
});

describe('能力探测与安全退回', () => {
  it('没有 WebGL 时返回哑对象，enabled=false 且不抛错', () => {
    const p = createPostFX(null);
    expect(p.enabled).toBe(false);
    expect(p.failed).toBe(true);
    expect(() => p.render({}, {})).not.toThrow();
    expect(() => p.setLevel(2)).not.toThrow();
    expect(() => p.setSize(100, 100)).not.toThrow();
    expect(() => p.dispose()).not.toThrow();
  });

  it('假渲染器（jsdom / 测试替身）也安全退回直出', () => {
    const fake = { setRenderTarget() {}, getRenderTarget() {} };
    const p = createPostFX(fake);
    expect(p.enabled).toBe(false);
    expect(p.render({}, {})).toBe(false);
  });

  it('哑对象的 render 返回 undefined（调用方据 false/undefined 走直出）', () => {
    const p = createPostFX({});
    expect(p.render(null, null)).toBeFalsy();
  });

  it('getContext 抛异常时也退回直出，不冒泡', () => {
    const p = createPostFX({
      getContext() { throw new Error('context lost'); },
      setRenderTarget() {},
    });
    expect(p.enabled).toBe(false);
  });
});