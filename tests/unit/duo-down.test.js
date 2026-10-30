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
  await new Promise((r) => setTimeout(r, 50));
  return game;
}

function makeSession() {
  return {
    sendZombieSpawn: vi.fn(),
    sendZombieDead: vi.fn(),
    sendWipe: vi.fn(),
    close: vi.fn(),
  };
}

describe('双人倒地/救援', () => {
  it('host 倒地后队友靠近 2.5s 复活；代理倒地同理', async () => {
    const game = await boot();
    game.duoSession = makeSession();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.player.pos.set(0, 0, 13);
    game.netGuest.pos.set(1, 0, 13);
    game.player.hp = 5;
    game.player.damage(10);
    expect(game.player.downed).toBe(true);
    expect(game.player.dead).toBe(false);
    expect(game.player.downTimer).toBe(30);

    game.updateDuoRescue(1.1);
    expect(game.player.downed).toBe(true);
    game.updateDuoRescue(1.5);
    expect(game.player.downed).toBe(false);
    expect(game.player.hp).toBe(50);

    game.netGuest.hp = 5;
    game.netGuest.damage(10);
    expect(game.netGuest.downed).toBe(true);
    game.updateDuoRescue(1.1);
    game.updateDuoRescue(1.5);
    expect(game.netGuest.downed).toBe(false);
    expect(game.netGuest.hp).toBe(50);
  });

  it('倒地超时：通知队友并回菜单', async () => {
    const game = await boot();
    const session = makeSession();
    game.duoSession = session;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.player.hp = 5;
    game.player.damage(10);
    game.player.downTimer = 0.1;
    game.updateDuoRescue(0.2);
    expect(session.sendWipe).toHaveBeenCalled();
    // 团灭后停在结算页（会话保留，等「再来一局」或离开），不再直接回菜单
    expect(game.state).toBe('over');
    expect(game.duo).not.toBeNull();
    expect(session.close).not.toHaveBeenCalled();
  });

  it('guest 应用 pstate g.down/hp：本地倒地与复活；h.down 弹横幅', async () => {
    const game = await boot();
    game.duoSession = makeSession();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    game.applyPeerState({
      h: { x: 0, y: 0, z: 13, yaw: 0, moving: false, firing: false, down: true },
      g: { x: game.player.pos.x, y: 0, z: game.player.pos.z, hp: 0, down: true, downT: 12 },
    });
    expect(game.player.downed).toBe(true);
    expect(game.player.hp).toBe(0);
    game.player.update(0.05, game.controls, game.map, game.zombies.zombies);
    expect(game.player.eye.y).toBeCloseTo(0.55);

    game.applyPeerState({
      g: { x: game.player.pos.x, y: 0, z: game.player.pos.z, hp: 50, down: false, downT: 0 },
    });
    expect(game.player.downed).toBe(false);
    expect(game.player.hp).toBe(50);
  });

  it('僵尸攻击按 targetSeat 落到对应玩家；僵尸选最近目标并跳过倒地者', async () => {
    const game = await boot();
    game.duoSession = makeSession();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const hpGuest = game.netGuest.hp;
    game.onZombieAttack({ def: { damage: 10 }, targetSeat: 1, type: 'normal', airborne: false });
    expect(game.netGuest.hp).toBe(hpGuest - 10);
    const hpHost = game.player.hp;
    game.onZombieAttack({ def: { damage: 10 }, targetSeat: 0, type: 'normal', airborne: false });
    expect(game.player.hp).toBe(hpHost - 10);

    const z = game.zombies.spawnOne(game.player);
    z.spawnT = 1;
    game.player.pos.set(0, 0, 13);
    game.netGuest.pos.set(4, 0, 13);
    z.root.position.set(1, 0, 10);
    z.update(0.05, [game.player, game.netGuest], game.map.colliders);
    expect(z.targetSeat).toBe(0);
    game.player.downed = true;
    z.update(0.05, [game.player, game.netGuest], game.map.colliders);
    expect(z.targetSeat).toBe(1);
    game.netGuest.downed = true;
    expect(() => z.update(0.05, [game.player, game.netGuest], game.map.colliders)).not.toThrow();
    game.player.downed = false;
    game.netGuest.downed = false;
  });
});
