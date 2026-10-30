// Game 层的手电接线（TECH-flashlight.md §4）：
// 相机是全局的，手电挂在相机上 → 它会一直存在，所以必须按地图开关，切到后院/雪地/沙城不能剩灯。
// 这里只测接线与开关；灯本身的参数/朝向在 nightforest.test.js。
import { describe, it, expect, vi, beforeAll } from 'vitest';

// 和 game-duo.test.js 一样：先打 three 的 WebGLRenderer 替身，再动态加载 Game。
// 注意：THREE 不能在 beforeAll 里 import —— beforeAll 是另一张模块图，拿到的 three 会绕过
// doMock，构造函数就是真的 WebGLRenderer。所有 import('three') 都放在用例体里。
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

let game;
beforeAll(async () => {
  const h = await import('../helpers/game.js');
  ({ game } = await h.createGame());
});

// 用例体里 import('three')：和 doMock 同一个模块图，拿到的才是打了替身的版本
async function three() {
  return import('three');
}

// 相机侧（含武器视图模型等子节点）的 spot 灯
function cameraSpots() {
  const out = [];
  game.camera.traverse((o) => {
    if (o.isSpotLight) out.push(o);
  });
  return out;
}

// 不属于任何地图、却挂在 scene 上的 spot：切图靠 root.visible，这种灯会残留到别的图。
// 相机是全局的（scene.add(camera)），挂在它上面的手电不算残留——它由 setMap 按图开关。
// 粒子系统那盏复用的点光源是引擎级常驻物（不是地图灯），所以只看 spot。
function straySceneSpots() {
  const out = [];
  for (const c of game.scene.children) {
    if (c === game.camera) continue;
    c.traverse((o) => {
      if (o.isSpotLight) out.push(o);
    });
  }
  return out;
}

describe('Game · 夜之森林手电接线', () => {
  it('相机在 createMaps 之前建好并传进去：森林地图拿到的就是 game.camera', () => {
    const forest = game.maps.find((m) => m.id === 'forest');
    expect(forest).toBeTruthy();
    expect(forest.camera).toBe(game.camera);
    expect(forest.flash).toBeTruthy();
    expect(forest.flash.parent).toBe(game.camera);
    expect(forest.flashTarget.parent).toBe(game.camera);
  });

  it('只有一张地图持有手电，且灯不在世界坐标系里（scene 直属节点无灯）', () => {
    const owners = game.maps.filter((m) => m.flash);
    expect(owners.map((m) => m.id)).toEqual(['forest']);
    const spots = cameraSpots();
    expect(spots).toHaveLength(1);
    expect(spots[0]).toBe(owners[0].flash);
    // 没有一盏 spot 是"直接扔进 scene"的（那才是切图后会残留在后院/雪地/沙城的那种）
    expect(straySceneSpots()).toHaveLength(0);
  });

  it('setMap：森林点亮手电，切到其它三张图全部熄灭，再切回来重新点亮', () => {
    const forest = game.maps.find((m) => m.id === 'forest');
    // 先切到森林，让"熄灭"确实是从"亮着"变过去，而不是本来就关着
    game.setMap('forest');
    expect(forest.flash.visible).toBe(true);
    for (const id of ['backyard', 'snow', 'dust']) {
      game.setMap(id);
      expect(forest.flash.visible, id + ' 上不该有手电').toBe(false);
    }
    game.setMap('forest');
    expect(forest.flash.visible).toBe(true);
    // 灯始终只有一盏，切图不会越切越多
    expect(cameraSpots()).toHaveLength(1);
  });

  it('菜单运镜 / 正式开局都只改相机姿态，不改变灯的归属', () => {
    game.setMap('forest');
    const flash = game.maps.find((m) => m.id === 'forest').flash;
    const parent = flash.parent;
    const localPos = flash.position.clone();
    for (let i = 0; i < 5; i++) game.menuCamera(i * 0.4);
    expect(flash.parent).toBe(parent);
    // 灯是相机子节点：相机怎么飞，灯都不该被写死在世界里
    expect(flash.position.distanceTo(localPos)).toBeLessThan(1e-9);
    expect(flash.visible).toBe(true);
  });

  it('手电不吃投影：灯 castShadow 为 false，且森林把 shadowMap 关掉', () => {
    game.setMap('forest');
    const flash = game.maps.find((m) => m.id === 'forest').flash;
    expect(flash.castShadow).toBe(false);
    expect(game.renderer.shadowMap.enabled).toBe(false);
    game.setMap('backyard');
    expect(game.renderer.shadowMap.enabled).toBe(true);
  });

  it('灯光方向跟着相机：target 在相机本地系的前下方（光斑落在脚下）', async () => {
    game.setMap('forest');
    const THREE = await three();
    const forest = game.maps.find((m) => m.id === 'forest');
    const dir = new THREE.Vector3();
    forest.flashTarget.getWorldPosition(dir);
    const camPos = new THREE.Vector3();
    game.camera.getWorldPosition(camPos);
    const toTarget = dir.clone().sub(camPos);
    // 相机本地 -Z 是世界朝向；target 必须在该方向的前方
    const forward = new THREE.Vector3();
    game.camera.getWorldDirection(forward);
    expect(toTarget.clone().normalize().dot(forward)).toBeGreaterThan(0.9);
    // 且一定在视线下方（否则光打在远处而不是脚下）
    const local = game.camera.worldToLocal(dir.clone());
    expect(local.z).toBeLessThan(0);
    expect(local.y).toBeLessThan(0);
  });
});