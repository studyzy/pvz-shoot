import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 单元测试：src/entities/SkySun.js
 *
 * 天降阳光是"按固定间隔在全图随机落一颗"的调度器，
 * 这里只验证调度节奏与落点范围，不涉及渲染。
 */

const { SkySun } = await import('../../src/entities/SkySun.js');
const { SUN_SKY } = await import('../../src/config.js');

function makeCtx(bounds) {
  const spawned = [];
  return {
    spawned,
    ctx: {
      map: { bounds },
      sunOrbs: { spawnSky: (x, z) => spawned.push({ x, z }) },
    },
  };
}

describe('SkySun · 调度节奏', () => {
  it('构造后要到 interval 秒才第一次落阳光', () => {
    const { ctx, spawned } = makeCtx({ x: 20, z: 20 });
    const sky = new SkySun(ctx);
    sky.update(SUN_SKY.interval - 0.1);
    expect(spawned).toHaveLength(0);
    sky.update(0.1);
    expect(spawned).toHaveLength(1);
  });

  it('每 interval 秒稳定落一颗（用户定：30 秒 1 颗）', () => {
    const { ctx, spawned } = makeCtx({ x: 20, z: 20 });
    const sky = new SkySun(ctx);
    // 走过 3 个完整周期
    for (let i = 0; i < 3; i++) sky.update(SUN_SKY.interval);
    expect(spawned).toHaveLength(3);
  });

  it('多帧累积到 interval 也会触发（不是只看单帧 dt）', () => {
    const { ctx, spawned } = makeCtx({ x: 20, z: 20 });
    const sky = new SkySun(ctx);
    const step = SUN_SKY.interval / 10;
    for (let i = 0; i < 9; i++) sky.update(step);
    expect(spawned).toHaveLength(0);
    sky.update(step);
    expect(spawned).toHaveLength(1);
  });

  it('reset 把计时器拉回满值', () => {
    const { ctx, spawned } = makeCtx({ x: 20, z: 20 });
    const sky = new SkySun(ctx);
    sky.update(SUN_SKY.interval);
    expect(spawned).toHaveLength(1);
    sky.reset();
    sky.update(SUN_SKY.interval - 0.1);
    expect(spawned).toHaveLength(1);
    sky.update(0.1);
    expect(spawned).toHaveLength(2);
  });
});

describe('SkySun · 落点范围', () => {
  const origRandom = Math.random;
  afterEach(() => {
    Math.random = origRandom;
  });

  it('落点始终留在地图内、且离边缘至少 edgeMargin', () => {
    const bounds = { x: 20, z: 13 };
    const { ctx, spawned } = makeCtx(bounds);
    const sky = new SkySun(ctx);
    // 随机取满整个区间，跑多轮覆盖两端
    for (let i = 0; i < 200; i++) sky.update(SUN_SKY.interval);
    expect(spawned).toHaveLength(200);
    const m = SUN_SKY.edgeMargin;
    for (const p of spawned) {
      expect(p.x).toBeGreaterThanOrEqual(-bounds.x + m);
      expect(p.x).toBeLessThanOrEqual(bounds.x - m);
      expect(p.z).toBeGreaterThanOrEqual(-bounds.z + m);
      expect(p.z).toBeLessThanOrEqual(bounds.z - m);
    }
  });

  it('随机值取边界时也不会越界', () => {
    const bounds = { x: 20, z: 13 };
    const { ctx, spawned } = makeCtx(bounds);
    const sky = new SkySun(ctx);
    Math.random = () => 0;
    sky.update(SUN_SKY.interval);
    Math.random = () => 0.999999;
    sky.update(SUN_SKY.interval);
    const m = SUN_SKY.edgeMargin;
    expect(spawned[0].x).toBeCloseTo(-bounds.x + m, 6);
    expect(spawned[0].z).toBeCloseTo(-bounds.z + m, 6);
    expect(spawned[1].x).toBeLessThanOrEqual(bounds.x - m);
    expect(spawned[1].z).toBeLessThanOrEqual(bounds.z - m);
  });

  it('地图还没就绪（bounds 缺失）时不报错也不落阳光', () => {
    const { ctx, spawned } = makeCtx({ x: 20, z: 20 });
    ctx.map = null;
    const sky = new SkySun(ctx);
    expect(() => sky.update(100)).not.toThrow();
    expect(spawned).toHaveLength(0);
  });
});

describe('SkySun · 与 SunOrbs.spawnSky 的契约', () => {
  let SunOrbs;
  let THREE;

  beforeEach(async () => {
    THREE = await import('three');
    ({ SunOrbs } = await import('../../src/entities/SunOrbs.js'));
  });

  it('落到真实 SunOrbs 上会生成一颗"天降态"阳光球', () => {
    const scene = new THREE.Scene();
    const orbs = new SunOrbs(scene);
    const sky = new SkySun({ map: { bounds: { x: 10, z: 10 } }, sunOrbs: orbs });
    sky.update(SUN_SKY.interval);
    const active = orbs.orbs.filter((o) => o.active);
    expect(active).toHaveLength(1);
    expect(active[0].sky).toBe(true);
    expect(active[0].pos.y).toBeCloseTo(SUN_SKY.height, 6);
  });
});
describe('SkySun · 边界与重置', () => {
  it('没有地图或没有 bounds 时直接返回，不崩也不刷', () => {
    const spawned = [];
    for (const map of [null, {}, { bounds: null }]) {
      const sky = new SkySun({ map, sunOrbs: { spawnSky: (x, z) => spawned.push({ x, z }) } });
      expect(() => sky.update(SUN_SKY.interval * 2)).not.toThrow();
    }
    expect(spawned).toHaveLength(0);
  });

  it('极端小地图（半边长小于 edgeMargin）也不会刷到界外', () => {
    const spawned = [];
    const sky = new SkySun({
      map: { bounds: { x: 1, z: 1 } },
      sunOrbs: { spawnSky: (x, z) => spawned.push({ x, z }) },
    });
    sky.update(SUN_SKY.interval);
    expect(spawned).toHaveLength(1);
    expect(Math.abs(spawned[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(spawned[0].z)).toBeLessThanOrEqual(1);
  });

  it('超长单帧（dt 远大于 interval）也只落一颗，不会连发', () => {
    const spawned = [];
    const sky = new SkySun({
      map: { bounds: { x: 20, z: 20 } },
      sunOrbs: { spawnSky: (x, z) => spawned.push({ x, z }) },
    });
    sky.update(SUN_SKY.interval * 5);
    expect(spawned).toHaveLength(1);
  });
});
