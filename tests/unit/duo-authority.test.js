import { describe, it, expect, vi, beforeAll } from 'vitest';

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
  // stubGltfLoader 是异步的：等模型槽 ready，host 的 spawnOne 才不会一直返回 null。
  await new Promise((r) => setTimeout(r, 50));
  return game;
}

function snap(over = {}) {
  return { id: 1, t: 'normal', x: 1, y: 0, z: 2, yaw: 0.5, hp: 100, st: 0, sl: 0, ...over };
}

describe('guest 世界权威分支', () => {
  it('跳过地图流场/天降/阳光/补给结算，只应用 host 快照', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'snow', seat: 1, peerName: '戴夫 A' });
    expect(game.isGuestWorld()).toBe(true);
    expect(game.zombies.remote).toBe(true);
    const sky = vi.spyOn(game.skySun, 'update');
    const orbs = vi.spyOn(game.sunOrbs, 'update');
    const picks = vi.spyOn(game.pickups, 'update');
    const nav = vi.spyOn(game.map, 'updateNav').mockImplementation(() => {});

    game.update(0.05);
    expect(sky).not.toHaveBeenCalled();
    expect(orbs).not.toHaveBeenCalled();
    expect(picks).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();

    game.applyPeerState({ wave: 2, bossHp: 0.5, z: [snap()] });
    expect(game.zombies.wave).toBe(2);
    expect(game.zombies.zombies).toHaveLength(1);
    const z = game.zombies.zombies[0];
    expect(z.remote).toBe(true);
    expect(z.netId).toBe(1);
    expect(z.hp).toBe(100);
    expect(document.getElementById('waveLabel').textContent).toContain('2');
    expect(document.getElementById('bossBar').classList.contains('hidden')).toBe(false);

    expect(z.hit(50, false, false)).toBe(false);
    expect(z.hp).toBe(100);
    expect(z.flash).toBeGreaterThan(0);
    z.mixer = { update: vi.fn(), stopAllAction: vi.fn(), uncacheRoot: vi.fn() };
    z.update(0.05, game.player, []);
    expect(z.mixer.update).toHaveBeenCalled();
    expect(z.flash).toBeLessThan(0.85);

    game.applyPeerState({ z: [snap({ st: 2, sl: 1 })] });
    expect(z.attackAnim).toBeGreaterThan(0);
    z.update(0.3, game.player, []);

    game.applyPeerState({ z: [snap({ x: 2, z: 3, yaw: 1, hp: 40, st: 1, sl: 1 })] });
    expect(z.hp).toBe(40);
    expect(z.root.position.x).toBe(2);
    expect(z.root.position.z).toBe(3);
    expect(z.root.rotation.y).toBe(1);

    game.applyWorldEvent({ type: 'nope' });
    game.applyWorldEvent({ type: 'zdead', id: 1 });
    expect(game.zombies.zombies).toHaveLength(0);
    game.applyPeerState({ z: [snap({ hp: 1 })] });
    expect(game.zombies.zombies).toHaveLength(0);

    game.applyPeerState({ bossHp: 0 });
    expect(document.getElementById('bossBar').classList.contains('hidden')).toBe(true);

    game.applyWorldEvent({ type: 'zspawn', z: snap({ id: 2 }) });
    expect(game.zombies.zombies).toHaveLength(1);
    game.applyPeerState({ z: [snap({ id: 2, hp: 0, st: 3 })] });
    game.applyPeerState({ z: [snap({ id: 2, st: 1 })] });
    game.zombies.update(2.0, game.player, game.map.colliders);
    expect(game.zombies.zombies).toHaveLength(0);

    game.applyPeerState({ z: [snap({ id: 3, t: 'boss' })], bossHp: 1 });
    expect(game.zombies.boss).toBeTruthy();
    game.applyPeerState({ z: [snap({ id: 3, hp: 0, st: 3 })] });
    game.applyPeerState({ z: [snap({ id: 3, st: 1 })] });
    game.zombies.update(2.0, game.player, game.map.colliders);
    expect(game.zombies.boss).toBeNull();
  });

  it('guest 远端死亡动画走完会自行回收', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    game.applyPeerState({ z: [snap()] });
    expect(game.zombies.zombies).toHaveLength(1);
    game.applyPeerState({ z: [snap({ hp: 0, st: 3 })] });
    game.zombies.update(2.0, game.player, game.map.colliders);
    expect(game.zombies.zombies).toHaveLength(0);
  });
});

describe('host 世界权威', () => {
  it('启动第 1 波，分配 netId，并发出 spawn/dead 事件', async () => {
    const game = await boot();
    const session = { sendZombieSpawn: vi.fn(), sendZombieDead: vi.fn() };
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    expect(game.isGuestWorld()).toBe(false);
    expect(game.zombies.remote).toBe(false);
    expect(game.zombies.state).toBe('spawning');
    expect(game.zombies.netSpawn(snap())).toBeNull();
    game.zombies.netDespawn(99);

    const z = game.zombies.spawnOne(game.player);
    expect(z).toBeTruthy();
    expect(z.netId).toBeGreaterThan(0);
    expect(session.sendZombieSpawn).toHaveBeenCalledWith(z);
    const s = z.serialize();
    expect(s).toMatchObject({ id: z.netId, t: z.type, hp: z.hp, st: 0 });

    z.slowTimer = 1;
    z.attackAnim = 0.4;
    expect(z.serialize().st).toBe(2);
    expect(z.serialize().sl).toBe(1);
    z.dying = true;
    expect(z.serialize().st).toBe(3);

    z.dead = true;
    game.zombies.update(0.016, game.player, game.map.colliders);
    expect(session.sendZombieDead).toHaveBeenCalledWith(z);

    game.clearRemotes();
    expect(game.zombies.remote).toBe(false);
    expect(game.zombies.onNetSpawn).toBeNull();
    expect(game.zombies.onNetDead).toBeNull();
  });
});
