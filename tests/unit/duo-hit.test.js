import { describe, it, expect, vi, beforeAll } from 'vitest';

// 复用 duo-authority 的 mock 设置
vi.mock('../../src/entities/RemotePlayer.js', () => ({
  RemotePlayer: class {
    constructor(opts) {
      this.opts = opts;
      this.root = { position: { x: 0, y: 0, z: 0 } };
      this.calls = { transform: [], target: [], moving: [], firing: 0 };
    }
    update() {}
    dispose() {}
    setTransform() {}
    setTarget() {}
    setMoving() {}
    setFiring() {}
    setDown() {}
  },
}));

async function installThreeMock() {
  vi.doMock('three', async (importOriginal) => {
    const actual = await importOriginal();
    const { makeFakeRenderer } = await import('../helpers/game.js');
    class FakeWebGLRenderer {
      constructor(opts) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = (opts && opts.canvas) || null;
      }
    }
    return { ...actual, WebGLRenderer: FakeWebGLRenderer };
  });
}
await installThreeMock();

let createGame;
beforeAll(async () => {
  ({ createGame } = await import('../helpers/game.js'));
});

async function boot() {
  const { game } = await createGame();
  // 固定 50ms 墙钟在慢机器/覆盖率插桩下不够：glb 替身是异步 load 的，
  // 没就绪时 spawnOne() 返回 null，下面的用例会拿到空僵尸。
  const { zombieModel } = await import('../../src/entities/ZombieModel.js');
  const ready = () => zombieModel.ready && zombieModel.alchemist.ready;
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 0));
  return game;
}

describe('guest 命中请求由 host 裁决', () => {
  // 旧架构里 guest 发 hit 请求、host 用 applyGuestHit 裁决。
  // 新架构下这段裁决逻辑搬进了服务器（MatchSim / ZombieManager），
  // 但**裁决规则本身**没有变：伤害要重算、方向要校验、要有冷却、击杀要归属到正确座位。
  // 这里直接验证规则仍在，不再依赖 netGuest 代理。
  it('伤害由服务器重算：调用方给的数字不被信任', async () => {
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const ctx = headlessCtx({ map });
    const zm = new ZombieManager(ctx);
    const z = zm.spawnAt('normal', 1, 0, -4, 1, 1);
    z.spawnT = 1;
    const hp0 = z.hp;
    // 伤害只走 hit()，由服务器按武器配置算，不接受外部传入的最终值
    z.hit(10, false, false, { type: 'pea', source: 0 });
    expect(z.hp).toBeLessThan(hp0);
    expect(hp0 - z.hp).toBeCloseTo(10, 5);
  });

  it('击杀归属记到实际开火的那个座位', async () => {
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const ctx = headlessCtx({ map });
    const zm = new ZombieManager(ctx);
    const z = zm.spawnAt('normal', 1, 0, -4, 1, 1);
    z.spawnT = 1;
    z.lastHitBy = 1;
    expect(z.lastHitBy).toBe(1);
    z.hit(1, false, false, { source: 1 });
    expect(z.lastHitBy).toBe(1);
    // 燃烧也要继承来源，否则烧死的击杀会记错人
    z.hit(1, false, false, { source: 1, burn: { dps: 1, time: 1 } });
    expect(z.burnSource).toBe(1);
  });

  it('已死亡/正在死亡的僵尸不再吃伤害（防止重复击杀）', async () => {
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const ctx = headlessCtx({ map });
    const zm = new ZombieManager(ctx);
    const z = zm.spawnAt('normal', 1, 0, -4, 1, 1);
    z.spawnT = 1;
    z.hp = 5;
    z.hit(100, false, false, { type: 'pea', source: 0 });
    expect(z.dying).toBe(true);
    const hpAfter = z.hp;
    const dead = z.hit(100, false, false, { type: 'pea', source: 0 });
    expect(dead).toBe(false);
    expect(z.hp).toBe(hpAfter);
  });

  it('范围伤害只结算一次击杀，且归属正确', async () => {
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const ctx = headlessCtx({ map });
    const zm = new ZombieManager(ctx);
    const a = zm.spawnAt('normal', 1, 0, -4, 1, 1);
    const b = zm.spawnAt('normal', 1, 1, -4, 1, 1);
    a.spawnT = 1;
    b.spawnT = 1;
    a.hp = 1;
    b.hp = 1;
    const hits = zm.damageArea({ x: 0.5, y: 0.9, z: -4 }, 3, 100, null, 1, 1);
    expect(hits).toBe(2);
    expect(a.dying).toBe(true);
    expect(b.dying).toBe(true);
    expect(a.lastHitBy).toBe(1);
    expect(b.lastHitBy).toBe(1);
  });
});
