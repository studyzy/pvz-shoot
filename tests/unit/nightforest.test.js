// 夜之森林专属契约：尺寸、族群分区、平台高度红线、树干挡板、发光与萤火虫。
// 通用地图契约在 maps.test.js 里已经跑过（接口/碰撞/反弹体/拾取点），这里只测这张图独有的设计约束。
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

let NightForest;
let FLASH;
let map;

beforeAll(async () => {
  ({ NightForest } = await import('../../src/world/NightForest.js'));
  map = new NightForest(new THREE.Scene());
}, 30000);

describe('夜之森林 · 基本契约', () => {
  it('id / 名字 / 尺寸是 90×90 的「大」森林', () => {
    expect(map.id).toBe('forest');
    expect(map.name).toBe('夜之森林');
    // 比雪地（35.2×41.6）大三倍以上，才当得起「巨大的森林」
    expect(map.bounds.x).toBe(45);
    expect(map.bounds.z).toBe(45);
  });

  it('出生点在南侧营地，且不压在任何碰撞体上', () => {
    expect(map.spawn.z).toBeGreaterThan(30);
    expect(map.spawn.x).toBe(0);
    for (const c of map.colliders) {
      const d = Math.hypot(c.x - map.spawn.x, c.z - map.spawn.z);
      expect(d, `出生点被碰撞体 ${c.x},${c.z} 挡住`).toBeGreaterThan(c.r + 1);
    }
  });

  it('所有可站立平台 ≤ 0.6 米：僵尸不会跳，高台就是无敌点', () => {
    for (const p of map.platforms) {
      expect(p.h, `平台 ${p.x},${p.z} 高 ${p.h}`).toBeLessThanOrEqual(0.6);
    }
  });

  // 回归：这张图没有 platforms，树/灯杆的圆形 collider 是玩家碰撞的唯一来源；
  // 一旦声明 `playerColliders = []`，Player 的 `playerColliders || colliders` 会取到空表，
  // 表现为整片树林直接穿过去。雪地/沙城才该用空表（它们靠 platforms 挡人）。
  it('不声明 playerColliders：玩家必须回落到 colliders，树才挡得住人', () => {
    expect(map.playerColliders, '森林不能声明 playerColliders=[]').toBeUndefined();
    expect(map.colliders.length).toBeGreaterThan(50);
    const trees = map.treeSpots.filter((s) => !s[2]);
    expect(trees.length).toBeGreaterThan(50);
    for (const [x, z] of trees) {
      const hit = map.colliders.some((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6);
      expect(hit, `树 (${x.toFixed(1)}, ${z.toFixed(1)}) 没有碰撞体`).toBe(true);
    }
  });

  it('刷怪点全在边界内，且离出生点足够远（玩家有反应时间）', () => {
    expect(map.zombieSpawnPoints.length).toBeGreaterThanOrEqual(8);
    for (const [x, z] of map.zombieSpawnPoints) {
      expect(Math.abs(x)).toBeLessThan(map.bounds.x);
      expect(Math.abs(z)).toBeLessThan(map.bounds.z);
      const d = Math.hypot(x - map.spawn.x, z - map.spawn.z);
      expect(d, `刷怪点 ${x},${z} 离出生点太近`).toBeGreaterThan(20);
    }
  });

  it('拾取点位 ≤ MAX_SPOTS(10)，且两两间距 > 2×拾取半径', () => {
    expect(map.pickupSpots.length).toBeLessThanOrEqual(10);
    const PICK_RADIUS = 1.45;
    for (let i = 0; i < map.pickupSpots.length; i++) {
      for (let j = i + 1; j < map.pickupSpots.length; j++) {
        const [ax, az] = map.pickupSpots[i];
        const [bx, bz] = map.pickupSpots[j];
        expect(Math.hypot(ax - bx, az - bz), `点位 ${i}/${j} 太近`).toBeGreaterThan(PICK_RADIUS * 2);
      }
    }
  });
});

describe('夜之森林 · 树干与投掷物', () => {
  it('树干登记成圆柱反弹体，否则豌豆会直接穿过树', () => {
    const columns = map.walls.filter((w) => w.r !== undefined && w.h !== undefined);
    expect(columns.length).toBeGreaterThan(30);
    for (const c of columns) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
      expect(c.r).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  });

  it('每根灯杆 / 栅栏桩 / 倒木都有对应的反弹体（碰撞球不能凭空存在）', () => {
    const solids = map.walls.filter((w) => w.hx !== undefined || w.r !== undefined);
    for (const c of map.colliders) {
      const near = solids.some((w) => {
        if (w.hx !== undefined) {
          const dx = c.x - w.x;
          const dz = c.z - w.z;
          const lx = dx * w.c + dz * w.s;
          const lz = -dx * w.s + dz * w.c;
          return Math.abs(lx) <= w.hx + 3 && Math.abs(lz) <= w.hz + 3;
        }
        return Math.hypot(c.x - w.x, c.z - w.z) <= w.r + 3;
      });
      expect(near, `碰撞球 (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) 附近没有反弹体`).toBe(true);
    }
  });
});

describe('夜之森林 · 渲染预算与夜间氛围', () => {
  it('场景 draw call 控制在预算内（同屏 14 只怪时总 dc 不能爆 250）', () => {
    let plain = 0;
    let instanced = 0;
    let points = 0;
    let sprites = 0;
    map.root.traverse((o) => {
      if (o.isInstancedMesh) instanced++;
      else if (o.isMesh) plain++;
      else if (o.isPoints) points++;
      else if (o.isSprite) sprites++;
    });
    const total = plain + instanced + points + sprites;
    // 留足余量给 14 只僵尸（每只 1–6 dc）与武器视图模型
    expect(total, `森林场景 dc=${total}：普通 mesh ${plain} / instanced ${instanced}`).toBeLessThanOrEqual(40);
  });

  it('大量重复物件必须走 InstancedMesh，而不是逐棵建 mesh', () => {
    let instanced = 0;
    let plain = 0;
    map.root.traverse((o) => {
      if (o.isInstancedMesh) instanced++;
      else if (o.isMesh) plain++;
    });
    expect(instanced).toBeGreaterThan(plain);
  });

  it('activate 设置夜空与近距雾（夜里可视距离要短）', () => {
    const scene = new THREE.Scene();
    map.activate(scene);
    expect(scene.background).toBeTruthy();
    expect(scene.fog).toBeTruthy();
    expect(scene.fog.near).toBeLessThan(20);
    expect(scene.fog.far).toBeLessThan(60);
    expect(map.root.visible).toBe(true);
  });

  it('发光物件用的是自发光材质，不是逐盏点光源', () => {
    const lights = [];
    map.root.traverse((o) => {
      if (o.isLight) lights.push(o);
    });
    // 8 盏以内：半球 + 月光 + 少量分区补光；不能靠 point light 堆氛围
    expect(lights.length).toBeLessThanOrEqual(10);
    const glowMat = map.matGlowGreen;
    expect(glowMat.emissive).toBeTruthy();
    expect(glowMat.emissiveIntensity).toBeGreaterThan(0);
  });

  it('萤火虫是一个 Points，update 会让它们动', () => {
    expect(map.fireflies).toBeInstanceOf(THREE.Points);
    const attr = map.fireflies.geometry.getAttribute('position');
    const before = attr.array.slice(0, 30);
    for (let i = 0; i < 30; i++) map.update(0.05);
    let moved = 0;
    for (let i = 0; i < 30; i++) if (Math.abs(attr.array[i] - before[i]) > 1e-4) moved++;
    expect(moved).toBeGreaterThan(0);
    // needsUpdate 会被渲染器消费后复位，这里只断言「位置真的变了」即可
  });
});

describe('夜之森林 · 导航', () => {
  it('提供流场接口：flowAt 给出方向、updateNav 不崩', () => {
    const player = { pos: new THREE.Vector3(0, 0, 20) };
    expect(() => map.updateNav(player, 0.016)).not.toThrow();
    const out = { x: 0, z: 0 };
    const ok = map.flowAt(-28, -26, out);
    expect(typeof ok).toBe('boolean');
    if (ok) {
      expect(Number.isFinite(out.x) && Number.isFinite(out.z)).toBe(true);
    }
  });

  it('从每片族群领地都能寻路到玩家（流场连通，不会卡死）', () => {
    const player = { pos: new THREE.Vector3(0, 0, 20) };
    // 强制重算一次
    map.nav.update(0, 20, 1);
    const out = { x: 0, z: 0 };
    for (const [x, z] of map.zombieSpawnPoints) {
      const ok = map.flowAt(x, z, out);
      // 刷怪点必须可寻路（返回 true 才算接上流场）
      expect(ok, `刷怪点 (${x}, ${z}) 没接入流场`).toBe(true);
    }
  });
});
describe('夜之森林 · 投影开关', () => {
  it('森林声明 noShadows，其它地图不声明（Game.setMap 据此关掉 shadow pass）', async () => {
    expect(map.noShadows).toBe(true);
    const { Arena } = await import('../../src/world/Arena.js');
    const { IceWorld } = await import('../../src/world/IceWorld.js');
    const { DustYard } = await import('../../src/world/DustYard.js');
    const s = new THREE.Scene();
    expect(new Arena(s).noShadows).toBeFalsy();
    expect(new IceWorld(s).noShadows).toBeFalsy();
    expect(new DustYard(s).noShadows).toBeFalsy();
  });

  it('森林的灯全都不投影（关掉 shadowMap 之后也不该有残留 caster 配置）', () => {
    map.root.traverse((o) => {
      if (o.isLight) expect(o.castShadow, o.type + ' 不该投影').toBe(false);
    });
  });
});

// TECH-flashlight.md：夜之森林"太黑"的根治手段是跟相机走的 SpotLight。
// 这一段把方案里每条"别踩"的约束都钉成断言：不挂 scene、跟着准星、不投影、按图开关。
describe('夜之森林 · 手电（TECH-flashlight.md）', () => {
  let camera;
  let scene;
  let map;

  beforeAll(async () => {
    const { NightForest } = await import('../../src/world/NightForest.js');
    ({ FLASH } = await import('../../src/world/NightForest.js'));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
    map = new NightForest(scene, camera);
  });

  it('有且仅有一盏 spot：挂在相机上（不是 root、更不是 scene）', () => {
    const spots = [];
    map.root.traverse((o) => {
      if (o.isSpotLight) spots.push(o);
    });
    expect(spots.length, '手电不能再在 root 里塞一盏（切图残留）').toBe(0);
    const onCamera = [];
    camera.traverse((o) => {
      if (o.isSpotLight) onCamera.push(o);
    });
    expect(onCamera.length).toBe(1);
    expect(onCamera[0]).toBe(map.flash);
    expect(map.flash.parent).toBe(camera);
    // 相机本身当然还挂在 scene 上；灯不能直接进 scene.children
    for (const c of scene.children) expect(c.isSpotLight).toBeFalsy();
  });

  it('castShadow === false：本图靠 noShadows 省掉整个 shadow pass，灯不能把它带回来', () => {
    expect(map.flash.castShadow).toBe(false);
    expect(map.noShadows).toBe(true);
  });

  it('target 存在且也挂在相机上、在相机前方并略向下（光斑落在地面）', () => {
    const target = map.flash.target;
    expect(target).toBeTruthy();
    expect(target).toBe(map.flashTarget);
    expect(target.parent).toBe(camera);
    // 相机默认朝 -Z：target 的 z 必须为负、y 必须为负，否则光打在远处而不是脚下
    expect(target.position.z).toBeLessThan(0);
    expect(target.position.y).toBeLessThan(0);
    expect(target.position).toEqual(new THREE.Vector3(...FLASH.target));
  });

  it('参数与实测曲线一致：暖白 110 / 40 米 / 36° / penumbra 0.5 / decay 1', () => {
    const f = map.flash;
    expect(f.color.getHex()).toBe(0xffe8b0);
    expect(f.intensity).toBe(110);
    expect(f.distance).toBe(40);
    expect(f.angle).toBeCloseTo(Math.PI / 5, 10);
    expect(f.penumbra).toBe(0.5);
    expect(f.decay).toBe(1);
    // 灯位置贴着相机（眼睛略下），不挂在别处
    expect(f.position).toEqual(new THREE.Vector3(...FLASH.pos));
    // 灯本身就是相机的直接子节点，不再套一层（否则 getWorldPosition 要额外烧 CPU，本轮不引入）
    expect(f.parent).toBe(camera);
  });

  it('activate 点亮手电；setFlash(false) 能关掉（其它地图靠它关灯）', () => {
    map.setFlash(false);
    expect(map.flash.visible).toBe(false);
    map.activate(scene, camera);
    expect(map.flash.visible).toBe(true);
    map.setFlash(false);
    expect(map.flash.visible).toBe(false);
  });

  it('没相机时构造不报错、也不建灯；activate 再给相机也能补上（单测/图鉴场景）', async () => {
    const { NightForest } = await import('../../src/world/NightForest.js');
    const bare = new NightForest(new THREE.Scene());
    expect(bare.flash).toBeUndefined();
    expect(bare.attachFlash(null)).toBeNull();
    expect(() => bare.activate(new THREE.Scene())).not.toThrow();
    expect(bare.flash).toBeUndefined();

    const late = new THREE.PerspectiveCamera();
    bare.activate(new THREE.Scene(), late);
    expect(bare.flash).toBeTruthy();
    expect(bare.flash.parent).toBe(late);
    expect(bare.flash.visible).toBe(true);
  });

  it('反复 attach / activate 不会堆出第二盏灯', async () => {
    const { NightForest } = await import('../../src/world/NightForest.js');
    const cam = new THREE.PerspectiveCamera();
    const m = new NightForest(new THREE.Scene(), cam);
    const first = m.flash;
    m.attachFlash(cam);
    m.activate(new THREE.Scene(), cam);
    m.activate(new THREE.Scene(), cam);
    let spots = 0;
    cam.traverse((o) => {
      if (o.isSpotLight) spots++;
    });
    expect(spots).toBe(1);
    expect(m.flash).toBe(first);
  });

  it('切图不残留：其它三张地图没有手电，map.setFlash 只有森林有', async () => {
    const { Arena } = await import('../../src/world/Arena.js');
    const { IceWorld } = await import('../../src/world/IceWorld.js');
    const { DustYard } = await import('../../src/world/DustYard.js');
    const { createMaps } = await import('../../src/world/maps.js');
    const s = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera();
    const all = createMaps(s, cam);
    const withFlash = all.filter((m) => typeof m.setFlash === 'function');
    expect(withFlash.map((m) => m.id)).toEqual(['forest']);
    for (const cls of [Arena, IceWorld, DustYard]) {
      const m = new cls(new THREE.Scene());
      expect(m.setFlash).toBeUndefined();
      expect(m.flash).toBeUndefined();
    }
  });
});
