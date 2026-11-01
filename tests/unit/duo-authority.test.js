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
  // stubGltfLoader 只给每个槽回调一次（异步），而且**第 1 波的队列是 normal**——
  // 必须等 alchemist 槽 ready（普通僵尸的模型），只等顶层 zombieModel.ready 不够：
  // spawnOne 会因为没有可刷的类型一直返回 null。
  const { zombieModel } = await import('../../src/entities/ZombieModel.js');
  const ready = () => zombieModel.ready && zombieModel.alchemist.ready;
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 5));
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
  it('双人世界：客户端不再本地跑僵尸 AI，也不广播 spawn/dead', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    // 新架构：僵尸世界一律由服务器快照驱动，本地是「远端」模式
    expect(game.zombies.remote).toBe(true);
    expect(game.zombies.duo).toBe(false);
    expect(game.zombies.onNetSpawn).toBeNull();
    expect(game.zombies.onNetDead).toBeNull();
    // 不再有房主/客人之分
    expect(game.isGuestWorld()).toBe(false);
  });

  it('僵尸快照字段仍然完整（服务器 serialize 与客户端消费的口径一致）', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    // 客户端处于远端模式，netSpawn 会按快照建出僵尸
    const z = game.zombies.netSpawn(snap());
    expect(z).toBeTruthy();
    const s = z.serialize();
    // 二进制快照消费的是这几个字段，必须都在
    for (const k of ['id', 't', 'x', 'y', 'z', 'yaw', 'hp', 'st', 'sl', 'ar']) {
      expect(s, k).toHaveProperty(k);
    }
    // 远端僵尸只按快照摆姿势，不参与 AI 结算
    expect(z.remote).toBe(true);
  });

  it('netDespawn 能按 id 回收远端僵尸', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '队友 A' });
    const z = game.zombies.netSpawn(snap());
    expect(game.zombies.zombies.length).toBe(1);
    game.zombies.netDespawn(z.netId);
    expect(game.zombies.zombies.length).toBe(0);
  });
});
