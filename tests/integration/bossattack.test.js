// 巨人僵尸（Boss）必须能咬到人。
// 曾经的 bug：Player.update 的僵尸推离把 z.radius 又乘了一次 scaleFactor ——
// Boss 的推离半径变成 0.9×2.3+0.42=2.49 米，比它自己的攻击距离
// （1.15+2.3×0.55=2.415）还大，玩家永远被推在攻击范围外，Boss 只追人咬不着。
// 这个 bug 是纯几何数值问题，和模型无关，stub 模型即可复现。
import { describe, it, expect, beforeAll, vi } from 'vitest';

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

let game;
let spawnZombieAt;
let step;

beforeAll(async () => {
  const H = await import('../helpers/game.js');
  ({ spawnZombieAt, step } = H);
  game = (await H.createGame()).game;
  game.start();
  const { zombieModel } = await import('../../src/entities/ZombieModel.js');
  const modelsReady = () => zombieModel.ready && zombieModel.skeleton.ready;
  for (let i = 0; i < 100 && !modelsReady(); i++) await new Promise((r) => setTimeout(r, 10));
}, 60000);

describe('巨人僵尸能咬到玩家', () => {
  it('Boss 贴脸后玩家掉血（推离半径不得大于攻击距离）', () => {
    const p = game.player.pos;
    // 出生在攻击距离（2.415 米）内：不用等它追，攻击计时一到就该咬
    const boss = spawnZombieAt(game, 'boss', p.x + 2, p.z, { speedMul: 1 });
    const hp0 = game.player.hp;
    step(game, 300); // 5 秒，足够咬 3 口（1.28 秒一口）
    expect(game.player.hp).toBeLessThan(hp0);
    // Boss 不能把玩家推得越来越远：推离半径必须收在攻击距离之内
    const dist = Math.hypot(p.x - boss.root.position.x, p.z - boss.root.position.z);
    expect(dist).toBeLessThanOrEqual(1.15 + boss.scaleFactor * 0.55 + 0.25);
  });
});
