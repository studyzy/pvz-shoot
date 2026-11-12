// 后期管线（docs/plans/2026-11-12-render-overhaul.md §1.3）。
//
// 这是和参照物差距最核心的一处：原本是 forward 直出，零后处理，所以画面「干」——
// 高光死白、没有光晕、没有镜头感。这里补一条手写的四步管线。
//
// jsdom 没有 WebGL，所以测的是「决策逻辑」（档位解析、mip 尺寸、降级顺序）和
// 「能力探测失败时安全退回直出」，不是像素。
import { describe, it, expect } from 'vitest';
import { makeGLRenderer } from '../helpers/glstub.js';
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

// 下面是「装配层」：能力探测通过后，管线真的建起来了吗？
// jsdom 里的 GL 调用由 tests/helpers/glstub.js 记录，测的是 pass 编排与失败兜底，不是像素。
describe('管线装配', () => {
  it('拿到上下文后真正建起管线：默认全开、不处于失败态', () => {
    const { renderer } = makeGLRenderer();
    const p = createPostFX(renderer);
    expect(p.enabled).toBe(true);
    expect(p.failed).toBe(false);
    expect(p.level).toBe(LEVEL_FULL);
    expect(p.maxLevel).toBe(LEVEL_FULL);
    p.dispose();
  });

  it('opts.level / opts.maxLevel 决定起始档与上限', () => {
    const a = createPostFX(makeGLRenderer().renderer, { level: LEVEL_TONEMAP });
    expect(a.level).toBe(LEVEL_TONEMAP);
    expect(a.maxLevel).toBe(LEVEL_FULL);
    a.dispose();

    // 触屏这类只有一格余量的设备：档位封顶 1，降级到底也不会回 2
    const b = createPostFX(makeGLRenderer().renderer, { maxLevel: LEVEL_TONEMAP });
    expect(b.maxLevel).toBe(LEVEL_TONEMAP);
    b.setLevel(LEVEL_FULL);
    expect(b.level).toBe(LEVEL_TONEMAP);
    b.dispose();
  });

  it('setLevel 夹在 [0, maxLevel]：越界与非法值都不炸', () => {
    const p = createPostFX(makeGLRenderer().renderer);
    p.setLevel(9);
    expect(p.level).toBe(LEVEL_FULL);
    p.setLevel(-3);
    expect(p.level).toBe(LEVEL_OFF);
    p.setLevel('abc');
    expect(p.level).toBe(LEVEL_OFF);
    p.setLevel(LEVEL_TONEMAP);
    expect(p.level).toBe(LEVEL_TONEMAP);
    p.dispose();
  });

  it('setSize 换尺寸后照常出帧，同尺寸重复调用是空操作', () => {
    const { renderer } = makeGLRenderer();
    const p = createPostFX(renderer);
    p.setSize(1280, 720);
    p.setSize(1280, 720); // 命中「尺寸没变直接返回」的短路
    expect(p.render({}, {})).toBe(true);
    // 0 尺寸的 RT 会 GL 报错，必须被抬到 2
    p.setSize(0, 0);
    expect(p.render({}, {})).toBe(true);
    p.dispose();
  });

  it('setFade / setBloom 接受越界值，setFog 接受残缺配方', () => {
    const p = createPostFX(makeGLRenderer().renderer);
    expect(() => p.setFade(5)).not.toThrow();
    expect(() => p.setFade(-1)).not.toThrow();
    expect(() => p.setBloom(-3)).not.toThrow();
    // baseDensity 缺失/为 0 = 关雾，不能把 undefined 塞进 uniform
    expect(() => p.setFog(null)).not.toThrow();
    expect(() => p.setFog({ color: 0x8899aa })).not.toThrow();
    expect(() => p.setFog({
      color: 0x8899aa, baseDensity: 0.004, falloff: 0.08, groundY: -2, fogMax: 180,
    })).not.toThrow();
    expect(p.render({}, {})).toBe(true);
    p.dispose();
  });
});

describe('每帧 pass 编排', () => {
  // 全开档的固定编排：场景 1 + SSAO 1 + 预筛 1 + 降采样 4 + 上采样 4 + 合成 1
  const FULL_PASSES = 12;

  it('全开档跑满四步：场景 → SSAO → 预筛/降采样/上采样 → 合成', () => {
    const { renderer, calls } = makeGLRenderer();
    const p = createPostFX(renderer);
    p.setSize(1280, 720);
    expect(p.render({}, {})).toBe(true);
    expect(calls.render.length).toBe(FULL_PASSES);
    // 最后一定回到画布（null），否则下一帧场景会画进 RT 里
    expect(calls.setRenderTarget.at(-1)).toBe(null);
    p.dispose();
  });

  it('关掉 SSAO 时少一个 pass（深度纹理仍在，但没人读）', () => {
    const { renderer, calls } = makeGLRenderer();
    const p = createPostFX(renderer, { ssao: false });
    p.setSize(1280, 720);
    expect(p.render({}, {})).toBe(true);
    expect(calls.render.length).toBe(FULL_PASSES - 1);
    p.dispose();
  });

  it('WebGL1 没有深度纹理：SSAO 与高度雾自动失效，Bloom 照跑', () => {
    const { renderer, calls } = makeGLRenderer({ webgl2: false });
    const p = createPostFX(renderer);
    p.setSize(640, 360);
    expect(p.render({}, {})).toBe(true);
    // 没有深度纹理 → SSAO 不跑；预筛 + 4 降 + 4 升 + 合成 + 场景
    expect(calls.render.length).toBe(FULL_PASSES - 1);
    p.dispose();
  });

  it('色调映射档只跑场景 + 合成（Bloom 链是手机端最贵的一步）', () => {
    const { renderer, calls } = makeGLRenderer();
    const p = createPostFX(renderer, { level: LEVEL_TONEMAP });
    p.setSize(1280, 720);
    expect(p.render({}, {})).toBe(true);
    expect(calls.render.length).toBe(2);
    p.dispose();
  });

  it('关档时一帧都不画，返回 false 让调用方直出', () => {
    const { renderer, calls } = makeGLRenderer();
    const p = createPostFX(renderer, { level: LEVEL_OFF });
    expect(p.render({}, {})).toBe(false);
    expect(calls.render.length).toBe(0);
    p.dispose();
  });

  it('渲染期间临时关掉 three 的色调映射，结束后原样恢复', () => {
    const { renderer, calls } = makeGLRenderer();
    renderer.toneMapping = 4; // ACESFilmicToneMapping
    const p = createPostFX(renderer);
    p.render({}, {});
    // RT 里必须存线性 HDR：three 的 tonemapping 若生效，后面就没得滚降
    for (const c of calls.render) expect(c.toneMapping).toBe(0);
    expect(renderer.toneMapping).toBe(4);
    p.dispose();
  });

  it('GL 抛错时标记 failed 并退回直出，之后不再尝试', () => {
    const { renderer } = makeGLRenderer({ onRender: () => { throw new Error('gl lost'); } });
    renderer.toneMapping = 4;
    const p = createPostFX(renderer, { level: LEVEL_TONEMAP });
    expect(p.render({}, {})).toBe(false);
    expect(p.failed).toBe(true);
    // 失败路径也要把状态还回去，否则整个游戏会留在 RT 里且没有色调映射
    expect(renderer.toneMapping).toBe(4);
    expect(renderer.getRenderTarget()).toBe(null);
    expect(p.render({}, {})).toBe(false);
    p.dispose();
  });

  it('dispose 之后一律直出，重复 dispose 不抛错', () => {
    const p = createPostFX(makeGLRenderer().renderer);
    p.dispose();
    expect(p.enabled).toBe(false);
    expect(p.render({}, {})).toBe(false);
    // 关掉之后再 resize 不能重建 RT
    expect(() => p.setSize(320, 200)).not.toThrow();
    expect(() => p.dispose()).not.toThrow();
  });
});