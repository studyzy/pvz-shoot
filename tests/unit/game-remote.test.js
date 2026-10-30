import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/entities/RemotePlayer.js', () => ({
  RemotePlayer: class {
    constructor(opts) {
      this.opts = opts;
      this.updates = 0;
      this.disposed = false;
      this.root = {};
    }
    update() {
      this.updates++;
    }
    dispose() {
      this.disposed = true;
    }
  },
}));

// 和 flows.test.js 一样：先打 three 的 WebGLRenderer 替身，再动态加载 createGame。
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

describe('Game 远端玩家接入', () => {
  it('spawn / update / clear / resetRun / setMap', async () => {
    const { game } = await createGame();
    game.start();

    const r = game.spawnRemotePlayer({ name: '测试', x: 1, z: 2, y: 3, yaw: 0.5 });
    expect(r.opts.name).toBe('测试');
    expect(r.opts.x).toBe(1);
    expect(r.opts.z).toBe(2);
    expect(r.opts.y).toBe(3);
    expect(r.opts.yaw).toBe(0.5);
    expect(r.opts.scene).toBe(game.scene);
    expect(r.opts.env).toBe(game.ctx.env);
    expect(game.remotes).toContain(r);

    const d = game.spawnRemotePlayer();
    expect(d.opts.name).toBe('队友');
    expect(d.opts.x).toBeCloseTo(game.map.spawn.x + 2.6);
    expect(d.opts.z).toBeCloseTo(game.map.spawn.z - 1.4);
    expect(d.opts.y).toBe(0);
    expect(typeof d.opts.yaw).toBe('number');

    game.update(0.016);
    expect(r.updates).toBe(1);
    expect(d.updates).toBe(1);

    game.clearRemotes();
    expect(r.disposed).toBe(true);
    expect(d.disposed).toBe(true);
    expect(game.remotes).toHaveLength(0);

    const e = game.spawnRemotePlayer({ x: 5 });
    game.resetRun();
    expect(e.disposed).toBe(true);
    expect(game.remotes).toHaveLength(0);

    game.backToMenu();
    const f = game.spawnRemotePlayer();
    game.setMap('snow');
    expect(f.disposed).toBe(true);
    expect(game.remotes).toHaveLength(0);
  });

  it('没有地图时 spawnRemotePlayer 返回 null', async () => {
    const { game } = await createGame();
    const map = game.map;
    game.map = null;
    expect(game.spawnRemotePlayer()).toBeNull();
    game.map = map;
  });
});
