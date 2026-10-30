// 夜之森林专属契约：尺寸、族群分区、平台高度红线、树干挡板、发光与萤火虫。
// 通用地图契约在 maps.test.js 里已经跑过（接口/碰撞/反弹体/拾取点），这里只测这张图独有的设计约束。
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

let NightForest;
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
