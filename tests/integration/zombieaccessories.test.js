// 僵尸配件（交通锥 / 铁桶 / Boss 木棒）挂到骨骼上之后的**世界尺寸**。
// 这里必须用真实 glb 的骨架层级：stubGltfLoader 的替身没有 Head 骨骼，
// 所以配件一直是"挂 body、手写世界坐标"，100 倍骨架缩放的问题在那里永远测不出来。
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

let THREE;
let game;
let spawnZombieAt;

beforeAll(async () => {
  const H = await import('../helpers/game.js');
  THREE = await import('three');
  await H.realGltfLoader();
  ({ spawnZombieAt } = H);
  game = (await H.createGame()).game;
  game.start();
  // 真实 glb 是异步解析的：spawnZombieAt 之前必须等到模型就绪，否则拿到的是空 Group
  const { zombieModel } = await import('../../src/entities/ZombieModel.js');
  for (let i = 0; i < 200 && !zombieModel.ready; i++) await new Promise((r) => setTimeout(r, 10));
}, 180000);

function spawn(type) {
  game.zombies.zombies.forEach((z) => z.dispose());
  game.zombies.zombies.length = 0;
  const z = spawnZombieAt(game, type, 0, 5, { speedMul: 0 });
  z.root.updateMatrixWorld(true);
  return z;
}

const worldSize = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());

describe('僵尸配件挂在骨骼上不会跟着骨架缩放放大', () => {
  it('骨架层级和真实模型一致（Head 骨骼在 100 倍缩放的 CharacterArmature 下）', () => {
    const z = spawn('cone');
    const head = z.body.getObjectByName('Head');
    expect(head).toBeTruthy();
    expect(z.hat.parent).toBe(head);
    // 真实模型这里 ≈158（1.55 模型缩放 × 102 根节点缩放）；stub 模型是 1
    expect(head.getWorldScale(new THREE.Vector3()).x).toBeGreaterThan(100);
  });

  it.each(['cone', 'bucket'])('%s 的世界尺寸和僵尸身体匹配（不超过身高的 0.6 倍、不超过 1 米宽）', (type) => {
    const z = spawn(type);
    const hat = worldSize(z.hat);
    const body = worldSize(z.body);
    // 旧 bug：直接挂骨骼，交通锥被放大到 80+ 米宽、世界 y 从 -39 跨到 +43
    expect(hat.x).toBeLessThan(1);
    expect(hat.z).toBeLessThan(1);
    expect(hat.y).toBeLessThan(body.y * 0.6);
  });

  it.each(['cone', 'bucket'])('%s 压在头顶上，不会掉到脚底或悬在半空', (type) => {
    const z = spawn(type);
    const hat = new THREE.Box3().setFromObject(z.hat);
    const body = new THREE.Box3().setFromObject(z.body);
    // 身体（含配件前）最高点由模型决定，帽子应当落在身体顶端附近
    expect(hat.min.y).toBeGreaterThan(z.root.position.y + 1);
    expect(hat.max.y).toBeLessThanOrEqual(body.max.y + 0.01);
  });

  it('身体本身还是正常僵尸尺寸（配件没有把它撑大）', () => {
    const z = spawn('cone');
    // 蒙皮网格的静态包围盒（绑定姿态，几乎是个点）会被骨骼动画撑开，Box3 不可信；
    // 这里只卡"帽子和身体在同一量级"，真正的身高口径见 AGENTS.md 5.2（模型原高 × ZOMBIE_SCALE）。
    expect(z.body.scale.x).toBeCloseTo(1.55, 6);
    const hat = worldSize(z.hat);
    const body = worldSize(z.body);
    expect(hat.y).toBeLessThan(body.y);
    expect(hat.x).toBeLessThan(body.x);
  });
});