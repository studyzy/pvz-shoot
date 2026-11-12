// 阴影视锥跟随的接线（docs/plans/2026-11-12-render-overhaul.md §1.1）。
//
// 单元层面 shadowFollow 已经测过；这里测「地图有没有真的挂上」以及
// 「Game 有没有每帧把它推到玩家脚下」—— 少了任一边，跟随就是死代码。
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('three', async (importOriginal) => {
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

// 注意：THREE 不能在顶层 import —— doMock 是另一张模块图，先 import 会拿到真的 WebGLRenderer。
// 所有 import('three') 都放在用例体/延迟函数里。
async function three() {
  return import('three');
}

let MAPS;
beforeAll(async () => {
  ({ MAPS } = await import('../../src/world/maps.js'));
});

describe('阴影视锥跟随 · 接通了', () => {
  it('四张有阴影的地图都挂了 shadowFollow，且窗口明显小于原写死值', async () => {
    const THREE = await three();
    const need = ['backyard', 'snow', 'dust', 'downtown'];
    for (const id of need) {
      const def = MAPS.find((m) => m.id === id);
      expect(def, id).toBeTruthy();
      const scene = new THREE.Scene();
      const map = def.create(scene, new THREE.PerspectiveCamera());
      expect(map.shadowFollow, `${id} 缺少 shadowFollow`).toBeTruthy();
      expect(map.shadowFollow.half, id).toBeGreaterThan(0);
      // 后院/雪地原来 ±30、沙城 ±34、摩天街区 ±50：都必须在 30 以下才叫「收紧」
      expect(map.shadowFollow.half, `${id} 窗口没收紧`).toBeLessThanOrEqual(22);
    }
  });

  it('无阴影地图没有 shadowFollow（跟着也没有阴影可算）', async () => {
    const THREE = await three();
    for (const id of ['forest', 'cloud']) {
      const def = MAPS.find((m) => m.id === id);
      const scene = new THREE.Scene();
      const map = def.create(scene, new THREE.PerspectiveCamera());
      expect(map.shadowFollow, id).toBeFalsy();
    }
  });

  it('update 把阴影相机推到焦点，光源方向不变', async () => {
    const THREE = await three();
    const def = MAPS.find((m) => m.id === 'backyard');
    const map = def.create(new THREE.Scene(), new THREE.PerspectiveCamera());
    const sun = map.sunLight;
    const dir0 = sun.position.clone().sub(sun.target.position).normalize();
    map.shadowFollow.update(new THREE.Vector3(20, 0, -20));
    const dir1 = sun.position.clone().sub(sun.target.position).normalize();
    expect(dir1.x).toBeCloseTo(dir0.x, 6);
    expect(dir1.y).toBeCloseTo(dir0.y, 6);
    expect(dir1.z).toBeCloseTo(dir0.z, 6);
    expect(Math.abs(sun.target.position.x - 20)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(sun.target.position.z + 20)).toBeLessThanOrEqual(0.3);
  });
});

describe('Game · syncShadowFollow', () => {
  let game;
  beforeAll(async () => {
    const h = await import('../helpers/game.js');
    ({ game } = await h.createGame());
  });

  it('玩法中跟随玩家位置', () => {
    game.state = 'playing';
    game.player.pos.set(19, 0, -18);
    game.syncShadowFollow();
    const t = game.map.sunLight.target.position;
    expect(Math.abs(t.x - 19)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(t.z + 18)).toBeLessThanOrEqual(0.3);
  });

  it('菜单里跟随相机（后院的菜单机位在场地外侧）', () => {
    game.state = 'menu';
    game.camera.position.set(-7, 5, -16);
    game.player.pos.set(0, 0, 0);
    game.syncShadowFollow();
    const t = game.map.sunLight.target.position;
    expect(Math.abs(t.x + 7)).toBeLessThanOrEqual(0.3);
  });

  it('地图没有 shadowFollow 时静默跳过（forest/cloud）', () => {
    const saved = game.map;
    game.map = { noShadows: true };
    expect(() => game.syncShadowFollow()).not.toThrow();
    game.map = saved;
  });
});