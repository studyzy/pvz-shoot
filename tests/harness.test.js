import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('./helpers/game.js');
  class FakeWebGLRenderer {
    constructor(opts) {
      Object.assign(this, makeFakeRenderer());
      this.domElement = (opts && opts.canvas) || null;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

// 这条用例保护测试基础设施本身：createGame() 必须把真实结构的僵尸模型准备好，
// 否则所有依赖 spawnZombieAt 的测试都会以 "Cannot read properties of null (reading 'clone')" 挂掉。
describe('integration harness', () => {
  it('boots into menu with three maps built', async () => {
    const { createGame } = await import('./helpers/game.js');
    const { game } = await createGame();
    expect(game.state).toBe('menu');
    expect(game.maps.map((m) => m.id)).toEqual(['backyard', 'snow', 'dust']);
  });

  it('ZombieModel 就绪（gltf 替身已按真实 glb 结构注入）', async () => {
    const { createGame } = await import('./helpers/game.js');
    await createGame();
    const { zombieModel } = await import('../src/entities/ZombieModel.js');
    expect(zombieModel.ready).toBe(true);
    expect(zombieModel.failed).toBe(false);
    let meshes = 0;
    zombieModel.scene.traverse((n) => {
      if (n.isMesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(0);
  });

  it('僵尸身体材质拿到 PMREM envMap（ZombieManager 必须把 ctx.env 传给 Zombie）', async () => {
    const { readyGame, spawnZombieAt } = await import('./helpers/game.js');
    const { game } = await readyGame();
    game.start();
    expect(game.ctx.env).toBeTruthy();
    for (const type of ['normal', 'cone', 'bucket', 'boss']) {
      const z = spawnZombieAt(game, type, 0, -6);
      expect(z.mats.length, type + ' 至少有一个身体材质').toBeGreaterThan(0);
      for (const m of z.mats) {
        expect(m.envMap, type + ' 的材质没有 envMap').toBe(game.ctx.env);
        expect(m.envMapIntensity).toBeGreaterThan(0);
      }
    }
  });

  it('runs a full update frame without throwing', async () => {
    const { createGame, step } = await import('./helpers/game.js');
    const { game } = await createGame();
    game.start();
    step(game, 60);
    expect(game.state).toBe('playing');
  });
});
