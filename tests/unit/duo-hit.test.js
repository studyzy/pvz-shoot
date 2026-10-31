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
  await new Promise((r) => setTimeout(r, 50));
  return game;
}

describe('guest 命中请求由 host 裁决', () => {
  it('重算伤害、方向拒绝、冷却、aoe', async () => {
    const game = await boot();
    const session = {
      sendZombieSpawn: vi.fn(),
      sendZombieDead: vi.fn(),
      sendAoe: vi.fn(),
      getZombieAt: (zid) => {
        const z = game.zombies.zombies.find(z=>z.netId===zid);
        return z ? {id:zid,x:z.root.position.x,y:z.root.position.y,z:z.root.position.z,ab:z.airborne?1:0,ys:1,sk:z.skillState} : null;
      },
    };
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const z = game.zombies.spawnOne(game.player);
    z.spawnT = 1;
    z.root.position.set(game.netGuest.pos.x, 0, game.netGuest.pos.z - 4);
    game.netGuest.yaw = 0;
    game.netGuest.pitch = 0;
    const hp0 = z.hp;
    const zid = z.netId;

    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, -1], seq: 1 });
    expect(z.hp).toBeLessThan(hp0);
    const hp1 = z.hp;

    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, -1], seq: 1 });
    expect(z.hp).toBe(hp1);

    game.guestHit.clear();
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, 1], seq: 1 });
    expect(z.hp).toBe(hp1);

    game.applyGuestHit({ w: 'no-such-weapon', zid, dir: [0, 0, -1], seq: 1 });
    expect(z.hp).toBe(hp1);

    z.hit(1, false, false, { source: 1 });
    expect(z.lastHitBy).toBe(1);
    z.hit(1, false, false, { source: 1, burn: { dps: 1, time: 1 } });
    expect(z.burnSource).toBe(1);
    game.guestHit.clear();
    game.applyGuestAoe({ w: 'cherry', x: z.root.position.x, y: 0, z: z.root.position.z, seq: 1 });
    expect(z.dying || z.hp < hp1).toBe(true);
    expect(game.duoStats[1]).toBeGreaterThan(0);

    // guest 的爆炸回调会发 aoe 请求
    game.projectiles.explodeAt({ x: 0, y: 0.4, z: 0 }, 1, 1, false, null, false, 'cherry');
    expect(session.sendAoe).toHaveBeenCalled();
  });

  it('命中裁决的拒绝分支：无目标/已死/零方向/打空/墙体/身体命中', async () => {
    const game = await boot();
    const session = {
      sendZombieSpawn: vi.fn(),
      sendZombieDead: vi.fn(),
      sendAoe: vi.fn(),
      getZombieAt: (zid) => {
        const z = game.zombies.zombies.find(z=>z.netId===zid);
        return z ? {id:zid,x:z.root.position.x,y:z.root.position.y,z:z.root.position.z,ab:z.airborne?1:0,ys:1,sk:z.skillState} : null;
      },
    };
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const z = game.zombies.spawnOne(game.player);
    z.spawnT = 1;
    z.hp = 100;
    z.root.position.set(game.netGuest.pos.x, 0, game.netGuest.pos.z - 4);
    game.netGuest.yaw = 0;
    game.netGuest.pitch = 0;
    const zid = z.netId;

    game.applyGuestHit({ w: 'pea', zid: 999, dir: [0, 0, -1], seq: 1 });
    expect(z.hp).toBe(100);

    z.dying = true;
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, -1], seq: 1 });
    z.dying = false;
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, 0], seq: 1 });
    expect(z.hp).toBe(100);

    z.root.position.x += 5;
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0, -1], seq: 1 });
    z.root.position.x -= 5;
    expect(z.hp).toBe(100);

    game.netGuest.pitch = -0.27;
    game.guestHit.clear();
    game.applyGuestHit({ w: 'pea', zid, dir: [0, -0.27, -0.96], seq: 1 });
    expect(z.hp).toBe(85);

    game.guestHit.clear();
    game.map.walls = [{ x: game.netGuest.pos.x, y: 1, z: game.netGuest.pos.z - 2, hx: 3, hy: 1, hz: 0.2, c: 1, s: 0 }];
    game.applyGuestHit({ w: 'pea', zid, dir: [0, -0.27, -0.96], seq: 1 });
    expect(z.hp).toBe(85);
    game.map.walls = [];

    game.applyGuestAoe({ w: 'nope', x: 0, y: 0, z: 0 });
    game.applyGuestAoe({ w: 'pea', x: 0, y: 0, z: 0 });
    game.applyGuestAoe({ w: 'cherry', x: 'x', y: 0, z: 0 });
    expect(z.hp).toBe(85);
    game.guestHit.clear();
    game.applyGuestAoe(null);
    game.applyGuestAoe({ w: 'cherry', x: z.root.position.x, y: 0, z: z.root.position.z, seq: 1 });
    game.applyGuestAoe({ w: 'cherry', x: z.root.position.x, y: 0, z: z.root.position.z, seq: 1 });
    game.applyGuestHit(null);

    game.duoSession = null;
    const soloDir = { x: 0, y: 0, z: -1 };
    expect(() => game.ctx.onGuestHit(z, 'pea', soloDir)).not.toThrow();
    expect(() => game.ctx.onGuestAoe('cherry', { x: 0, y: 0, z: 0 })).not.toThrow();
    game.duo = null;
    game.applyGuestHit({ w: 'pea', zid: z.netId, dir: [0, 0, -1], seq: 1 });
    game.applyGuestAoe({ w: 'cherry', x: 0, y: 0, z: 0, seq: 1 });
  });

  it('空中目标：低处普通弹丸拒绝，站高台放行；snapshot 位置参与射线', async () => {
    const game = await boot();
    const session = {
      sendZombieSpawn: vi.fn(),
      sendZombieDead: vi.fn(),
      sendAoe: vi.fn(),
      getZombieAt: (zid) => ({ id: zid, x: game.netGuest.pos.x, y: 2.2, z: game.netGuest.pos.z - 3 }),
    };
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.zombies.queue = ['balloon'];
    const z = game.zombies.spawnOne(game.player);
    z.spawnT = 1;
    z.root.position.set(game.netGuest.pos.x, 2.2, game.netGuest.pos.z - 3);
    game.netGuest.yaw = 0;
    const zid = z.netId;
    const hp = z.hp;

    game.netGuest.pos.y = 0.5;
    game.netGuest.pitch = 0.34;
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0.34, -0.94], seq: 1 });
    expect(z.hp).toBe(hp);

    game.netGuest.pos.y = 1.0;
    game.netGuest.pitch = 0.184;
    game.guestHit.clear();
    game.applyGuestHit({ w: 'pea', zid, dir: [0, 0.184, -0.983], seq: 1 });
    expect(z.hp).toBeLessThan(hp);
  });

  it('guest 本地开火命中远端僵尸时只发 hit 请求，不扣本地快照血量', async () => {
    const game = await boot();
    const session = {
      sendHit: vi.fn(),
      sendAoe: vi.fn(),
      update: vi.fn(),
      captureInput: vi.fn(),
    };
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    game.applyPeerState({
      seq: 3,
      z: [{ id: 11, t: 'normal', x: game.player.pos.x, y: 0, z: game.player.pos.z - 3, yaw: 0, hp: 100, st: 0, sl: 0 }],
    });
    const z = game.zombies.zombies[0];
    expect(z.remote).toBe(true);
    game.player.yaw = 0;
    game.player.pitch = 0;
    game.controls.firing = true;
    for (let i = 0; i < 12; i++) game.update(0.05);

    expect(session.sendHit).toHaveBeenCalled();
    const call = session.sendHit.mock.calls[0];
    expect(call[0]).toBe('pea');
    expect(call[1]).toBe(11);
    expect(call[2].z).toBeLessThan(0);
    expect(z.hp).toBe(100);
  });
});
