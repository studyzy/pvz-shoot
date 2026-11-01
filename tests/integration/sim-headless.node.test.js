// 集成测试：在 Node 环境（不是 jsdom）里真正跑一场波次模拟。
//
// 这是「服务器权威」能否成立的地基验证：如果这一层跑不起来，
// 服务器就必须依赖浏览器环境，整个方案不成立。
// 用 `// @vitest-environment node` 强制裸 Node —— 没有 document、没有 canvas、没有 WebGL。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ZombieManager, headlessCtx } from '../../src/sim/index.js';

function flatMap(id = 'backyard') {
  return {
    id,
    colliders: [],
    platforms: [],
    bounds: { x: 90, z: 90 },
    flowAt() {
      return null;
    },
    updateNav() {},
  };
}

function makePlayer() {
  const p = {
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    downed: false,
    hp: 100,
    damage() {},
  };
  return p;
}

describe('无头世界模拟（纯 Node）', () => {
  it('没有 document / window 也能构造僵尸（服务器没有 DOM）', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    const ctx = headlessCtx({ map: flatMap() });
    const mgr = new ZombieManager(ctx);
    mgr.startWave(1);
    expect(mgr.zombies.length).toBe(0);
    // startWave 把首刷延迟定在 0.35s，跑够 1 秒再断言
    for (let i = 0; i < 30; i++) mgr.update(1 / 30, makePlayer(), [], null);
    expect(mgr.zombies.length).toBeGreaterThan(0);
    // 僵尸确实进了世界、有位置和血量
    const z = mgr.zombies[0];
    expect(z.alive).toBe(true);
    expect(Number.isFinite(z.root.position.x)).toBe(true);
    expect(z.hp).toBeGreaterThan(0);
    expect(z.headless).toBe(true);
  });

  it('僵尸会真的走向玩家并攻击（不是空转）', () => {
    const ctx = headlessCtx({ map: flatMap() });
    const mgr = new ZombieManager(ctx);
    const player = makePlayer();
    let attacks = 0;
    mgr.ctx.onZombieAttack = () => attacks++;
    mgr.startWave(1);
    // 玩家站在出生点不动，僵尸出生点在远处
    const before = mgr.zombies.length;
    for (let i = 0; i < 30 * 30; i++) mgr.update(1 / 30, player, [], null);
    expect(before).toBe(0);
    // 30 秒内至少刷出过僵尸，并且有僵尸打到了玩家
    expect(attacks).toBeGreaterThan(0);
  });

  it('60 秒的模拟开销是毫秒级（服务器能承载多场）', () => {
    const ctx = headlessCtx({ map: flatMap() });
    const mgr = new ZombieManager(ctx);
    const player = makePlayer();
    mgr.startWave(1);
    const t0 = process.hrtime.bigint();
    const TICKS = 30 * 60;
    for (let i = 0; i < TICKS; i++) mgr.update(1 / 30, player, [], null);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const perTick = ms / TICKS;
    // 30Hz 下单 tick 预算 33.3ms；这里留 10 倍安全余量断言 3ms
    expect(perTick).toBeLessThan(3);
  });

  it('五张地图都能在无头模式下爬起来', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud']) {
      const ctx = headlessCtx({ map: flatMap(id) });
      const mgr = new ZombieManager(ctx);
      mgr.startWave(1);
      for (let i = 0; i < 60; i++) mgr.update(1 / 30, makePlayer(), [], null);
      expect(mgr.wave, id).toBe(1);
    }
  });
});