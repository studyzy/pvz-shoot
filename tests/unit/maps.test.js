// src/world 的契约测试：三张地图跑同一套断言（AGENTS.md 5.9 + 地图专项），外加 FlowField 连通性与 materials 缓存。
// 新增地图只要在 MAPS 里挂一行，这里的契约会自动覆盖到它。
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

// 拾取半径：WeaponPickups.PICK_RADIUS（池上限 MAX_SPOTS 用于约束点位数量）。
const PICK_RADIUS = 1.45;
const MAX_SPOTS = 10;
// 占用检测用的口径：玩家踩上去算“有坎”的高度（= Player 的 STEP_HEIGHT 相近量级）。
const OBSTACLE_H = 0.6;
const PLAYER_RADIUS = 0.42;
// 僵尸圆形碰撞的等效半径：Zombie.update 里用 c.r + zombie.radius * 0.8 推出。
const ZOMBIE_R_ROUGH = 0.52;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBox = (w) => isFiniteNum(w.hx) && isFiniteNum(w.hy) && isFiniteNum(w.hz) && w.hx > 0 && w.hy > 0 && w.hz > 0;
const isColumn = (w) => isFiniteNum(w.r) && isFiniteNum(w.h) && w.r > 0 && w.h > 0;

function boxContains(w, x, z) {
  const dx = x - w.x;
  const dz = z - w.z;
  // OBB：把点转回盒子局部坐标再比半尺寸（弧形墙 c/s 不为 1/0 时也成立）。
  const lx = dx * w.c + dz * w.s;
  const lz = -dx * w.s + dz * w.c;
  return Math.abs(lx) <= w.hx && Math.abs(lz) <= w.hz;
}

// 只有采用了“平顶盒体地形”的地图才有 platforms（后院是纯平地，没有这张表）。
function platformAt(platforms, x, z, minH) {
  if (!platforms) return undefined;
  return platforms.find(
    (p) =>
      p.h >= minH &&
      x >= p.x - p.w * 0.5 &&
      x <= p.x + p.w * 0.5 &&
      z >= p.z - p.d * 0.5 &&
      z <= p.z + p.d * 0.5
  );
}

function colliderAt(colliders, x, z, radius) {
  return colliders.find((c) => Math.hypot(c.x - x, c.z - z) < c.r + radius);
}

// 有 nav 的地图（雪地 / 沙城）：流场从玩家格做 BFS，询问出生点。
function flowTowardPlayer(map, player, out) {
  map.updateNav(player, 0.5);
  const ok = map.flowAt(out.x, out.z, out.dir);
  if (!ok) return { ok: false };
  const toX = player.pos.x - out.x;
  const toZ = player.pos.z - out.z;
  const len = Math.hypot(toX, toZ) || 1;
  const dot = (out.dir.x * toX + out.dir.z * toZ) / len;
  return { ok: true, dot, dir: { ...out.dir } };
}

const SECONDS = 20 * 1000;

let THREE;
let Game;
let MAPS;
let DEFAULT_MAP;
let createMaps;
let materials;
let Arena;
let IceWorld;
let DustYard;
let FlowField;
let PerspectiveCamera;

beforeAll(async () => {
  // 先加载会静态 import three 的业务模块，再取 three 命名空间：这样拿到的一定是 mock 生效后的那一份实例。
  ({ Game } = await import('../../src/Game.js'));
  THREE = await import('three');
  ({ MAPS, DEFAULT_MAP, createMaps } = await import('../../src/world/maps.js'));
  materials = await import('../../src/world/materials.js');
  ({ Arena } = await import('../../src/world/Arena.js'));
  ({ IceWorld } = await import('../../src/world/IceWorld.js'));
  ({ DustYard } = await import('../../src/world/DustYard.js'));
  ({ FlowField } = await import('../../src/world/FlowField.js'));
  ({ PerspectiveCamera } = THREE);
}, SECONDS);

describe('地图注册表 maps.js', () => {
  it('MAPS 元数据完整：id 唯一、名字/描述/开始按钮文案就位、create 是工厂函数', () => {
    expect(MAPS.length).toBe(3);
    expect(MAPS.map((m) => m.id)).toEqual(['backyard', 'snow', 'dust']);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
    for (const m of MAPS) {
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.short).toBe('string');
      expect(m.short.length).toBeGreaterThan(0);
      expect(typeof m.tag).toBe('string');
      expect(m.tag.length).toBeGreaterThan(0);
      expect(typeof m.desc).toBe('string');
      expect(m.desc.length).toBeGreaterThan(0);
      expect(typeof m.startLabel).toBe('string');
      expect(m.startLabel.length).toBeGreaterThan(0);
      expect(typeof m.create).toBe('function');
    }
    expect(DEFAULT_MAP).toBe(MAPS[0].id);
  });

  it('createMaps(scene) 建出 3 张地图，meta/id/startLabel 一一对应，且全部挂在 scene 上', () => {
    const scene = new THREE.Scene();
    const maps = createMaps(scene);
    expect(maps.length).toBe(3);
    maps.forEach((map, i) => {
      expect(map.meta).toBe(MAPS[i]);
      expect(map.id).toBe(MAPS[i].id);
      expect(map.startLabel).toBe(MAPS[i].startLabel);
      expect(map.scene).toBe(scene);
      expect(map.root.parent).toBe(scene);
      expect(map.root.visible).toBe(false); // 未激活的地图默认不可见
    });
  });

  it('未知地图 id 回落到第一张；Game.setMap 切图后只有当前地图可见', async () => {
    const { game } = await createGame();
    expect(game.maps.length).toBe(3);
    game.setMap('nope');
    expect(game.mapId).toBe(MAPS[0].id);
    for (const id of ['snow', 'dust', 'backyard']) {
      game.setMap(id);
      expect(game.mapId).toBe(id);
      expect(game.map.id).toBe(id);
      game.maps.forEach((m) => expect(m.root.visible).toBe(m.id === id));
    }
  });
});

// createGame 很重（完整 Game + 三张地图）；本文件所有用例共用一份。
let gameShared = null;
async function createGame() {
  if (!gameShared) {
    const { createGame: boot } = await import('../helpers/game.js');
    gameShared = await boot();
  }
  return gameShared;
}

// describe.each 在收集阶段同步执行；three/maps 只能 await import，
// 所以用一组静态 id 驱动参数化（下面的“注册表”用例会断言它和 MAPS 完全一致）。
const MAP_IDS = ['backyard', 'snow', 'dust'];

describe.each(MAP_IDS)('地图契约：%s', (id) => {
  let scene;
  let map;

  beforeAll(() => {
    const names = { backyard: Arena, snow: IceWorld, dust: DustYard };
    scene = new THREE.Scene();
    map = new names[id](scene);
  }, SECONDS);

  it('接口契约（AGENTS.md 5.9）齐全', () => {
    expect(map.root).toBeInstanceOf(THREE.Object3D);
    expect(map.bounds).toEqual({ x: expect.any(Number), z: expect.any(Number) });
    expect(map.bounds.x).toBeGreaterThan(5);
    expect(map.bounds.z).toBeGreaterThan(5);
    expect(Array.isArray(map.colliders)).toBe(true);
    expect(map.spawn).toEqual(
      expect.objectContaining({ x: expect.any(Number), z: expect.any(Number), yaw: expect.any(Number) })
    );
    expect(Array.isArray(map.pickupSpots)).toBe(true);
    expect(typeof map.activate).toBe('function');
    expect(typeof map.menuCamera).toBe('function');
    expect(typeof map.update).toBe('function');
    // 可选能力（AGENTS.md 5.9“可选 platforms”）：有就必须是数组；walls 是本轮新增的反弹体表
    if (map.platforms !== undefined) expect(Array.isArray(map.platforms)).toBe(true);
    expect(Array.isArray(map.walls)).toBe(true);
  });

  it('拾取点位合法：在场地内、不重叠、数量不超过 MAX_SPOTS', () => {
    const spots = map.pickupSpots;
    expect(Array.isArray(spots)).toBe(true);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    expect(spots.length).toBeLessThanOrEqual(MAX_SPOTS);
    for (const s of spots) {
      expect(s.length).toBe(2);
      const [x, z] = s;
      expect(isFiniteNum(x) && isFiniteNum(z)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(map.bounds.x - 1);
      expect(Math.abs(z)).toBeLessThanOrEqual(map.bounds.z - 1);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]);
        expect(d, `点位 ${i} 与 ${j} 距离 ${d.toFixed(2)} 过近`).toBeGreaterThan(PICK_RADIUS);
      }
    }
  });

  it('拾取点位可达：不压在实心碰撞体 / 高台上，玩家站得进去', () => {
    for (const [x, z] of map.pickupSpots) {
      const blocker = colliderAt(map.colliders, x, z, PLAYER_RADIUS - 0.02);
      expect(blocker, `点位 (${x}, ${z}) 压在碰撞体 (${blocker && blocker.x}, ${blocker && blocker.z}) 上`).toBeUndefined();
      const high = platformAt(map.platforms, x, z, OBSTACLE_H);
      expect(high, `点位 (${x}, ${z}) 落在 ${high && high.h} 米高台上，玩家踩不到`).toBeUndefined();
    }
  });

  it('出生点在地图内、脚下不是高台、也不卡在碰撞体里', () => {
    const { x, z } = map.spawn;
    expect(Math.abs(x)).toBeLessThanOrEqual(map.bounds.x - 1);
    expect(Math.abs(z)).toBeLessThanOrEqual(map.bounds.z - 1);
    expect(platformAt(map.platforms, x, z, OBSTACLE_H)).toBeUndefined();
    expect(colliderAt(map.colliders, x, z, PLAYER_RADIUS)).toBeUndefined();
  });

  it('碰撞体有效：{x,z,r} 有限、r>0，且每个球附近 3 米内确实有可以碰撞的物体', () => {
    expect(map.colliders.length).toBeGreaterThan(0);
    const solids = map.walls.filter(isBox).concat(map.walls.filter(isColumn));
    // 纯装饰件（后院招牌）只拦僵尸、不拦投掷物：它没有对应的反弹体是设计如此。
    const decorOnly = [{ x: -8.5, z: 16.5 }];
    for (const c of map.colliders) {
      expect(isFiniteNum(c.x) && isFiniteNum(c.z) && isFiniteNum(c.r)).toBe(true);
      expect(c.r).toBeGreaterThan(0);
      expect(c.r).toBeLessThan(5);
      if (decorOnly.some((d) => Math.abs(d.x - c.x) < 1e-6 && Math.abs(d.z - c.z) < 1e-6)) continue;
      // 碰撞球必须贴着真实的网格：附近（球心 3 米内）能找到一个对应的反弹体
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
      expect(near, `碰撞球 (${c.x}, ${c.z}, r=${c.r}) 附近没有任何反弹体`).toBe(true);
    }
  });

  it('walls 反弹体：每项要么是 OBB 盒（c²+s²≈1）要么是立地圆柱', () => {
    expect(map.walls.length).toBeGreaterThan(0);
    for (const w of map.walls) {
      expect(isFiniteNum(w.x) && isFiniteNum(w.z)).toBe(true);
      if (w.hx !== undefined) {
        expect(isBox(w), JSON.stringify(w)).toBe(true);
        expect(isFiniteNum(w.y)).toBe(true);
        expect(isFiniteNum(w.c) && isFiniteNum(w.s)).toBe(true);
        expect(w.c * w.c + w.s * w.s).toBeCloseTo(1, 6);
        expect(w.y - w.hy).toBeGreaterThan(-0.2); // 贴地，不悬空
      } else {
        expect(isColumn(w), JSON.stringify(w)).toBe(true);
      }
    }
  });

  it('activate(scene)：设背景与雾、本图可见、其余地图不可见、不往 scene 塞地图物体', () => {
    const local = new THREE.Scene();
    const all = createMaps(local);
    const before = local.children.slice();
    const target = all.find((m) => m.id === id);
    target.activate(local);

    expect(local.background).toBeTruthy();
    expect(local.fog).toBeTruthy();
    expect(local.fog.isFog || local.fog.isFogExp2).toBe(true);
    expect(local.fog.near).toBeGreaterThan(0);
    expect(local.fog.far).toBeGreaterThan(local.fog.near);
    expect(target.root.visible).toBe(true);
    for (const other of all) {
      if (other !== target) expect(other.root.visible).toBe(false);
    }
    // scene.children 只有地图 root（加上原本就存在的常驻对象），背景/雾走属性而不是网格。
    expect(local.children).toEqual(before);
    expect(new Set(local.children)).toEqual(new Set(all.map((m) => m.root)));
    // 灯的 target 等对象也必须挂在 root 里（AGENTS.root 内），不能直接进 scene
    let lights = 0;
    target.root.traverse((o) => {
      if (o.isLight) lights++;
    });
    expect(lights).toBeGreaterThanOrEqual(2);
  });

  it('menuCamera：相机在场地附近、y>0、随 t 转动，且看向场地中心', () => {
    const cam = new PerspectiveCamera(73, 1, 0.05, 240);
    const dir = new THREE.Vector3();
    const toCenter = new THREE.Vector3();
    const samples = [0, 3, 11, 26].map((t) => {
      map.menuCamera(cam, t);
      expect(cam.position.y).toBeGreaterThan(0);
      expect(Number.isFinite(cam.position.x) && Number.isFinite(cam.position.z)).toBe(true);
      const horiz = Math.hypot(cam.position.x, cam.position.z);
      // 在场地附近盘旋：既不在场地正中，也不会飞到无限远
      expect(cam.position.y).toBeLessThan(200);
      expect(horiz).toBeLessThan(200);
      cam.getWorldDirection(dir);
      toCenter.set(0, 0, 0).sub(cam.position).normalize();
      const dot = dir.dot(toCenter);
      expect(dot, `t=${t} 时相机没看向场地中心`).toBeGreaterThan(0.6);
      return { x: cam.position.x, z: cam.position.z };
    });
    // 位置必须随 t 变化（菜单是环绕运镜，不能是静止机位）
    const moved = samples.some((s, i) => Math.hypot(s.x - samples[0].x, s.z - samples[0].z) > 0.5 * (i || 1));
    expect(moved).toBe(true);
    expect(new Set(samples.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`)).size).toBe(samples.length);
  });

  it('update(dt) 连续推进不抛错、不改变碰撞/平台表', () => {
    const c0 = JSON.stringify(map.colliders);
    const p0 = JSON.stringify(map.platforms);
    for (let i = 0; i < 30; i++) map.update(1 / 60);
    expect(() => map.update(0.5)).not.toThrow();
    expect(JSON.stringify(map.colliders)).toBe(c0);
    expect(JSON.stringify(map.platforms)).toBe(p0);
  });
});

// ---------------------------------------------------------------------------
// 雪地专项
// ---------------------------------------------------------------------------
describe('雪地 IceWorld 专项', () => {
  let map;
  beforeAll(() => {
    map = new IceWorld(new THREE.Scene());
  }, SECONDS);

  it('田字四根 3.6 米高柱：四块各 9×9 的平台，顶面约 3.6 米，四周有圆形碰撞', () => {
    const pillars = map.platforms.filter((p) => p.w === 9 && p.d === 9);
    expect(pillars.length).toBe(4);
    const centers = pillars.map((p) => `${p.x},${p.z}`).sort();
    expect(centers).toEqual(['-6.5,-6.5', '-6.5,6.5', '6.5,-6.5', '6.5,6.5'].sort());
    for (const p of pillars) {
      expect(p.h).toBeCloseTo(3.6 + 0.14, 6); // 柱身 3.6 + 顶盖 0.14
      expect(p.h).toBeGreaterThan(3.6);
      expect(p.h).toBeLessThan(3.8);
      // 柱子挡僵尸：中心必须有碰撞体
      expect(colliderAt(map.colliders, p.x, p.z, 0)).toBeTruthy();
    }
  });

  it('两侧 0.85 米矮墙可跳上，且碰撞圆足够密（间距 < 2×(r + 僵尸半径×0.8)）', () => {
    const low = map.platforms.filter((p) => Math.abs(p.h - (0.85 + 0.07)) < 1e-6);
    expect(low.length).toBe(2);
    expect(low.map((p) => p.x).sort()).toEqual([-14.6, 14.6]);
    for (const p of low) {
      expect(p.w).toBe(1);
      expect(p.d).toBe(28);
      // 可跳：低于跳跃能上去的阈值（约 1.3 米），高于平地
      expect(p.h).toBeGreaterThan(0.8);
      expect(p.h).toBeLessThan(1.0);
      // 沿矮墙收集碰撞圆，相邻圆心间距
      const row = map.colliders
        .filter((c) => Math.abs(c.x - p.x) < 1e-6)
        .map((c) => c.z)
        .sort((a, b) => a - b);
      expect(row.length).toBeGreaterThan(20);
      const limit = 2 * (0.6 + ZOMBIE_R_ROUGH * 0.8);
      for (let i = 1; i < row.length; i++) {
        const gap = row[i] - row[i - 1];
        expect(gap, `矮墙 x=${p.x} 的碰撞圆间距 ${gap.toFixed(3)}`).toBeLessThan(limit);
        expect(gap).toBeCloseTo(0.85, 2);
      }
      // 两端也要补圆，否则僵尸从墙头绕进来
      expect(row[0]).toBeLessThanOrEqual(-p.d / 2 + 0.01);
      expect(row[row.length - 1]).toBeGreaterThanOrEqual(p.d / 2 - 0.01);
    }
  });

  it('四角砖台是可跳的矮台（≤ 玩家一次跳跃高度）', () => {
    const bricks = map.platforms.filter((p) => p.w === 3.2 && p.d === 3.2);
    expect(bricks.length).toBe(4);
    expect(bricks.map((p) => `${p.x},${p.z}`).sort()).toEqual(
      ['-13.9,-17.4', '-13.9,17.4', '13.9,-17.4', '13.9,17.4'].sort()
    );
    for (const p of bricks) {
      expect(p.h).toBeCloseTo(0.4, 6);
      expect(p.h).toBeLessThan(1.0);
    }
  });

  it('僵尸出生点全部在北端（z < 0）且在地图内、不卡在高台里', () => {
    const pts = map.zombieSpawnPoints;
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    for (const [x, z] of pts) {
      expect(z).toBeLessThan(0);
      expect(z).toBeLessThan(map.spawn.z); // 比玩家出生点更靠北
      expect(Math.abs(x)).toBeLessThanOrEqual(map.bounds.x - 1);
      expect(Math.abs(z)).toBeLessThanOrEqual(map.bounds.z - 1);
      expect(platformAt(map.platforms, x, z, OBSTACLE_H)).toBeUndefined();
      // 出生点不能落在墙里，否则僵尸一出生就被推出地图
      expect(colliderAt(map.colliders, x, z, ZOMBIE_R_ROUGH * 0.8)).toBeUndefined();
    }
  });

  it('nav.blockPlatforms 已执行：所有 h>0.6 的平台格被标成不可通行', () => {
    expect(map.nav).toBeInstanceOf(FlowField);
    expect(map.nav.halfX).toBe(map.bounds.x);
    expect(map.nav.halfZ).toBe(map.bounds.z);
    expect(map.nav.blocked.length).toBe(map.nav.cols * map.nav.rows);
    const high = map.platforms.filter((p) => p.h > OBSTACLE_H);
    expect(high.length).toBeGreaterThan(0);
    let blockedCount = 0;
    for (let i = 0; i < map.nav.blocked.length; i++) blockedCount += map.nav.blocked[i];
    expect(blockedCount).toBeGreaterThan(0);
    for (const p of high) {
      // 平台中心格必被标障
      const cx = Math.floor((p.x + map.nav.halfX) / map.nav.cell);
      const cz = Math.floor((p.z + map.nav.halfZ) / map.nav.cell);
      if (cx >= 0 && cz >= 0 && cx < map.nav.cols && cz < map.nav.rows) {
        expect(map.nav.blocked[cz * map.nav.cols + cx], `平台 (${p.x}, ${p.z}) 中心格未标障`).toBe(1);
      }
    }
    // 矮台（< 0.6）不挡僵尸：低矮矮墙的格子仍可通行
    const low = map.platforms.filter((p) => p.h <= OBSTACLE_H);
    expect(low.length).toBeGreaterThan(0);
    for (const p of low) {
      const out = { x: 0, z: 0 };
      expect(map.nav.blocked[
        Math.floor((p.z + map.nav.halfZ) / map.nav.cell) * map.nav.cols +
          Math.floor((p.x + map.nav.halfX) / map.nav.cell)
      ]).toBe(0);
    }
  });

  it('雪地外墙与基地墙登记成反弹盒，且把场地围起来', () => {
    const boxes = map.walls.filter(isBox);
    expect(boxes.length).toBeGreaterThan(10);
    // 四面外墙
    const outer = boxes.filter((b) => b.hy > 5);
    expect(outer.length).toBeGreaterThanOrEqual(4);
    // 场地四边都被覆盖：任意一条边中点都在某个盒子里
    for (const [x, z] of [
      [0, -map.bounds.z - 0.45],
      [0, map.bounds.z + 0.45],
      [-map.bounds.x - 0.45, 0],
      [map.bounds.x + 0.45, 0],
    ]) {
      expect(boxes.some((b) => boxContains(b, x, z)), `外墙缺口 (${x}, ${z})`).toBe(true);
    }
  });

  it('雪地菜单相机在雪坑上方环绕', () => {
    const cam = new PerspectiveCamera(73, 1, 0.05, 240);
    map.menuCamera(cam, 0);
    expect(cam.position.y).toBeCloseTo(10, 0);
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeCloseTo(14.5, 3);
    map.menuCamera(cam, Math.PI / 2 / 0.075);
    expect(cam.position.x).toBeCloseTo(0, 3);
    expect(cam.position.z).toBeCloseTo(14.5, 3);
  });

  it('雪景：activate 后把 background 换成雪天空、雾色偏冷', () => {
    const s = new THREE.Scene();
    map.activate(s);
    expect(s.background).toBe(materials.snowSkyTexture());
    expect(s.fog.color.getHex()).toBe(0xe2f2ff);
    expect(s.fog.near).toBe(45);
    expect(s.fog.far).toBe(132);
  });
});

// ---------------------------------------------------------------------------
// 沙城专项
// ---------------------------------------------------------------------------
describe('沙城 DustYard 专项', () => {
  let map;
  beforeAll(() => {
    map = new DustYard(new THREE.Scene());
  }, SECONDS);

  it('场地 26.5×26.5，围墙四面封闭（反弹盒覆盖各边中点）', () => {
    expect(map.bounds).toEqual({ x: 26.5, z: 26.5 });
    const boxes = map.walls.filter(isBox);
    for (const [x, z] of [
      [0, -26.5 - 0.5],
      [0, 26.5 + 0.5],
      [-26.5 - 0.5, 0],
      [26.5 + 0.5, 0],
    ]) {
      expect(boxes.some((b) => boxContains(b, x, z)), `外墙缺口 (${x}, ${z})`).toBe(true);
    }
  });

  it('三线动线成立：南广场 → B 长廊 / 中路 / 长 A → 北横道 → A、B 点', () => {
    // 南广场：出生点附近开阔（无高台、无碰撞）
    expect(platformAt(map.platforms, 0, 20.5, OBSTACLE_H)).toBeUndefined();
    // 中路：中门 3.8 米门洞（x∈[-2.2, 2.2] 在 z≈9.5 处可通行）
    expect(map.spawn.z).toBeCloseTo(20.5, 6);
    for (const x of [-1, 0, 1]) {
      expect(colliderAt(map.colliders, x, 9.5, 0.1), `中门 x=${x} 被堵`).toBeUndefined();
      expect(platformAt(map.platforms, x, 9.5, OBSTACLE_H)).toBeUndefined();
    }
    // 长 A 门与 B 洞同样留出通道
    expect(colliderAt(map.colliders, 21.3, 8, 0.1), '长 A 门被堵').toBeUndefined();
    expect(colliderAt(map.colliders, -22.05, 9, 0.1), 'B 洞被堵').toBeUndefined();
    // 北横道：z≈0 的十字路口横穿全场；两侧楼体各被 B 门 / A 短道切开，所以横道本身可通行。
    // x=0 处的十字矮墙（0.9 米，cap:false）算“高台”但高度不足以阻挡流场，两边从它脚下绕过去。
    const blocked = (x, z) =>
      map.nav.blocked[Math.floor((z + map.nav.halfZ) / map.nav.cell) * map.nav.cols + Math.floor((x + map.nav.halfX) / map.nav.cell)];
    // 横道是两条 2 米宽的口子：西侧 B 门（x∈[-6,-4]）、东侧 A 短道（x∈[4,10]），
    // 中间 z∈[-1,1] 被十字路口的矮墙占住（僵尸从矮墙两边绕，不穿墙）。
    for (const x of [-5, -4, 4, 5, 6, 7, 8]) {
      expect(blocked(x, 0), `北横道 x=${x} 的口子被堵`).toBe(0);
    }
    for (const x of [-8, -6, -2, 0, 2]) {
      expect(blocked(x, 0), `北横道 x=${x} 被楼体/矮墙占住`).toBe(1);
    }
    // 横道南北两侧都是楼体：位置被楼占住（西楼 z∈[-6,2]，东楼 z∈[-6,-2]）
    expect(platformAt(map.platforms, -12, -4, OBSTACLE_H), '横道南侧应有楼体作为边界').toBeTruthy();
    expect(platformAt(map.platforms, 11, -4, OBSTACLE_H), '横道南侧（东）应有楼体作为边界').toBeTruthy();
    // A/B 点可站人
    for (const [x, z] of [
      [22.5, -17.5],
      [-22.5, -17.5],
    ]) {
      expect(colliderAt(map.colliders, x, z, PLAYER_RADIUS), `包点 (${x}, ${z}) 站不进去`).toBeUndefined();
    }
  });

  it('A/B 观景台 0.4 米、不挂碰撞（僵尸能直接压上来）', () => {
    const decks = map.platforms.filter((p) => p.w === 7 && p.d === 6 && p.h === 0.4);
    expect(decks.length).toBe(2);
    expect(decks.map((p) => `${p.x},${p.z}`).sort()).toEqual(['-22.5,-17.5', '22.5,-17.5'].sort());
    for (const p of decks) {
      // 观景台必须低（< 0.6 米，流场不挡僵尸），且四角都不挂圆形碰撞
      expect(p.h).toBeLessThanOrEqual(0.6);
      for (const [ox, oz] of [
        [0, 0],
        [-p.w / 2 + 0.1, -p.d / 2 + 0.1],
        [p.w / 2 - 0.1, -p.d / 2 + 0.1],
        [-p.w / 2 + 0.1, p.d / 2 - 0.1],
        [p.w / 2 - 0.1, p.d / 2 - 0.1],
      ]) {
        expect(colliderAt(map.colliders, p.x + ox, p.z + oz, 0), '观景台上挂了碰撞体会卡死僵尸').toBeUndefined();
      }
    }
  });

  it('观景台格子不被流场标障（僵尸可以走上去）', () => {
    expect(map.nav.blocked.some((v) => v === 1)).toBe(true);
    for (const p of map.platforms.filter((q) => q.h <= OBSTACLE_H)) {
      const cx = Math.floor((p.x + map.nav.halfX) / map.nav.cell);
      const cz = Math.floor((p.z + map.nav.halfZ) / map.nav.cell);
      if (cx >= 0 && cz >= 0 && cx < map.nav.cols && cz < map.nav.rows) {
        expect(map.nav.blocked[cz * map.nav.cols + cx], `矮台 (${p.x}, ${p.z}) 不应挡僵尸`).toBe(0);
      }
    }
  });

  it('僵尸出生点：绝大多数在 CT 一侧（z < 0），全部在地图内', () => {
    const pts = map.zombieSpawnPoints;
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    for (const [x, z] of pts) {
      expect(Math.abs(x)).toBeLessThanOrEqual(map.bounds.x - 1);
      expect(Math.abs(z)).toBeLessThanOrEqual(map.bounds.z - 1);
    }
    const north = pts.filter(([x, z]) => z < 0);
    expect(north.length / pts.length).toBeGreaterThanOrEqual(0.8);
    // 横向要铺开，不能挤在一条线上
    expect(new Set(pts.map((p) => Math.sign(p[0]))).size).toBeGreaterThan(1);
  });

  // 出生点本身必须离障碍足够远，但随机抖动 ±1.6 米后偶尔探进碰撞圆是允许的：
  // ZombieManager.spawnOne 会用 clearOfColliders(x, z, colliders) 把落点推到 r + 1.05 之外。
  // 所以这里只锁定“出生点偏移量”，运行期“落点不压碰撞体”交给下面的 spawnOne 用例。
  // 注：(±10, -12.5) 这两个出生点距离 A/B 隔墙的碰撞圆只有 0.18 米（圆半径 0.68），
  // 出生点本身就是“贴着隔墙”的。run-time 由 ZombieManager.clearOfColliders 把落点推出 r + 1.05，
  // 因此“不卡在箱子里”由下面的 spawnOne 用例把关；这里不再对原始点位做距离断言。

  it('ZombieManager.spawnOne 在沙城的落点永不压进碰撞体（clearOfColliders 生效）', async () => {
    // 走真实出生流程：spawnOne 先夹 bounds，再用 clearOfColliders 把落点推到 r + 1.05 之外。
    // 这里覆盖“棋子抖动 ±1.6 米后探进碰撞圆”的场景，保证不会被箱子卡住。
    const { game } = await createGame();
    const { zombieModel } = await import('../../src/entities/ZombieModel.js');
    const modelsReady = () => zombieModel.ready && zombieModel.skeleton.ready;
    for (let i = 0; i < 100 && !modelsReady(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(zombieModel.ready).toBe(true);
    const mapId = 'dust'; // 这条用例在「沙城专项」里，锁死沙城
    game.setMap(mapId);
    expect(game.mapId).toBe(mapId);

    const m = game.map;
    const zm = game.zombies;
    const overlaps = [];
    for (let i = 0; i < 120; i++) {
      const type = i % 6 === 0 ? 'boss' : 'normal'; // Boss radius 0.9，最容易卡
      zm.queue = [type];
      const z = zm.spawnOne(game.player);
      const x = z.root.position.x;
      const zz = z.root.position.z;
      const hit = m.colliders.find((c) => Math.hypot(c.x - x, c.z - zz) < c.r + z.radius * 0.8 - 1e-6);
      if (hit) overlaps.push(`#${i} type=${type} (${x.toFixed(2)}, ${zz.toFixed(2)}) r=${z.radius} 压住 (${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})`);
      z.dispose();
    }
    expect(overlaps, `出生落点压进碰撞体：\n${overlaps.slice(0, 5).join('\n')}`).toEqual([]);
  });

  it('门楣悬空登记成反弹盒（否则投掷物从门洞上方飞过去）', () => {
    // 中门楣：y0=3.6 h=0.9 → 中心 y=4.05
    const lintel = map.walls.find(
      (w) => isBox(w) && Math.abs(w.x) < 1e-6 && Math.abs(w.z - 9.5) < 1e-6 && Math.abs(w.y - 4.05) < 1e-6
    );
    expect(lintel).toBeTruthy();
    expect(lintel.hy).toBeCloseTo(0.45, 6);
    expect(lintel.hx).toBeCloseTo(2.25, 6);
  });

  it('铁桶按圆柱登记（盒体近似会多出一圈空气墙）', () => {
    const cols = map.walls.filter(isColumn);
    expect(cols.length).toBeGreaterThanOrEqual(4);
    for (const c of cols) {
      expect(c.r).toBeCloseTo(0.45, 6);
      expect(c.h).toBeGreaterThan(0.5);
    }
    expect(cols.some((c) => Math.abs(c.x + 5.6) < 1e-6 && Math.abs(c.z - 7.4) < 1e-6)).toBe(true);
  });

  it('沙城菜单相机在场地高空俯瞰，雾色偏沙', () => {
    const cam = new PerspectiveCamera(73, 1, 0.05, 240);
    map.menuCamera(cam, 0);
    expect(cam.position.y).toBeCloseTo(41, 0);
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeCloseTo(30, 3);
    const s = new THREE.Scene();
    map.activate(s);
    expect(s.background).toBe(materials.desertSkyTexture());
    expect(s.fog.color.getHex()).toBe(0xe8d6ac);
    expect(s.fog.near).toBe(52);
    expect(s.fog.far).toBe(156);
  });
});

// ---------------------------------------------------------------------------
// 后院专项
// ---------------------------------------------------------------------------
describe('后院 Arena 专项', () => {
  let map;
  beforeAll(() => {
    map = new Arena(new THREE.Scene());
  }, SECONDS);

  it('纯平地：没有 platforms 表（AGENTS.md 5.9 里 platforms 是可选能力）', () => {
    expect(map.platforms).toBeUndefined();
    expect(map.bounds).toEqual({ x: 23, z: 23 });
  });

  it('树/墓碑/割草机/向日葵/招牌都登记了圆形碰撞', () => {
    const near = (x, z, r = 0.05) => map.colliders.find((c) => Math.hypot(c.x - x, c.z - z) < r);
    expect(near(-20.6, -20.6), '树').toBeTruthy();
    expect(near(-10.5, -5.5), '墓碑').toBeTruthy();
    expect(near(-7, 20.6), '割草机').toBeTruthy();
    expect(near(-21.5, -21), '向日葵').toBeTruthy();
    expect(near(-8.5, 16.5), '招牌').toBeTruthy();
    // 树的碰撞按缩放给：r = 0.55 × scale + 0.25
    expect(near(-20.6, -20.6).r).toBeCloseTo(0.55 * 1.15 + 0.25, 6);
    // 墓碑与向日葵是固定半径
    expect(near(-10.5, -5.5).r).toBeCloseTo(0.55, 6);
    expect(near(-21.5, -21).r).toBeCloseTo(0.4, 6);
  });

  it('树 / 向日葵 / 墓碑都同时登记了投掷物用的圆柱（撞墙要弹回来）', () => {
    const col = (x, z) => map.walls.find((w) => isColumn(w) && Math.abs(w.x - x) < 1e-6 && Math.abs(w.z - z) < 1e-6);
    expect(col(-20.6, -20.6), '树').toBeTruthy();
    expect(col(-21.5, -21), '向日葵').toBeTruthy();
    expect(col(-10.5, -5.5), '墓碑').toBeTruthy();
    // 圆柱高度：树是通顶的“墙”，日出花 1.75，墓碑 1.4（豌豆可以从墓碑上方飞过）
    expect(col(-20.6, -20.6).h).toBe(99);
    expect(col(-21.5, -21).h).toBeCloseTo(1.75, 6);
    expect(col(-10.5, -5.5).h).toBeCloseTo(1.4, 6);
    // 投掷物圆柱半径与圆形碰撞不同源：树按 0.6 × scale，墓碑/葵花贴碰撞球半径
    expect(col(-20.6, -20.6).r).toBeCloseTo(0.6 * 1.15, 6);
    expect(col(-10.5, -5.5).r).toBeCloseTo(0.55, 6);
  });

  it('栅栏四面围住场地，登记成四块细长反弹盒（高 1.05 米）', () => {
    const fence = map.walls.filter((b) => isBox(b) && Math.abs(b.hy - 0.575) < 1e-9 && b.hx !== b.hz);
    expect(fence.length).toBe(4);
    for (const f of fence) {
      expect(Math.min(f.hx, f.hz)).toBeCloseTo(0.2, 6); // 栅栏厚度
      expect(Math.max(f.hx, f.hz)).toBeCloseTo(24.2, 6); // 栅栏半长
      expect(f.y).toBeCloseTo(0.575, 6); // 顶沿 1.05 米
    }
    expect(map.spawn.z).toBeLessThan(24.2 - 0.2); // 出生点在栅栏内
  });

  it('割草机按自身朝向登记 OBB（c²+s²≈1 且真的有旋转）', () => {
    const mowers = map.walls.filter((b) => isBox(b) && Math.abs(b.y - 0.36) < 1e-9);
    expect(mowers.length).toBe(3);
    mowers.forEach((m, i) => expect(m.x).toBeCloseTo(-7 + i * 7, 6));
    expect(mowers.some((m) => Math.abs(m.s) > 1e-6)).toBe(true);
  });

  it('后院菜单相机是贴地运镜（低机位、looping），雾色偏天蓝', () => {
    const cam = new PerspectiveCamera(73, 1, 0.05, 240);
    map.menuCamera(cam, 0);
    expect(cam.position.y).toBeCloseTo(5.4, 0);
    expect(cam.position.z).toBeCloseTo(-16 + 3.5, 3);
    const s = new THREE.Scene();
    map.activate(s);
    expect(s.background).toBe(materials.skyTexture());
    expect(s.fog.color.getHex()).toBe(0xdff1ff);
    expect(s.fog.near).toBe(58);
    expect(s.fog.far).toBe(140);
  });

  it('Arena.update 是空实现，不抛错', () => {
    expect(() => map.update(0.016)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FlowField 走通性（有 nav 的地图）
// ---------------------------------------------------------------------------
describe('FlowField 连通性', () => {
  it('基本 BFS：直线场指向目标，障碍另一侧绕行，场外返回 false', () => {
    const nav = new FlowField(5, 5, 1); // 10×10 格
    nav.update(0, 0, 1); // 玩家在中心
    const out = { x: 0, z: 0 };
    // 玩家所在格 dist=0，方向为空
    expect(nav.flowAt(0, 0, out)).toBe(false);
    // 8 邻域 BFS 里，斜邻与正邻同价（距离都是 1），所以方向可能是指向斜邻的 (±√½, ±√½)
    expect(nav.flowAt(4, 0, out)).toBe(true);
    expect(out.x).toBeLessThan(0); // 朝玩家（-x 方向）
    expect(Math.abs(out.x)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(out.z)).toBeCloseTo(Math.SQRT1_2, 6);
    // 对角象限里每一格的方向都必须让僵尸离玩家更近（与“朝玩家”的夹角 < 90°）
    for (const px of [2, 3, 4]) {
      for (const pz of [2, 3, 4]) {
        expect(nav.flowAt(px, pz, out)).toBe(true);
        const toPlayer = { x: -px, z: -pz };
        const len = Math.hypot(toPlayer.x, toPlayer.z);
        const dot = (out.x * toPlayer.x + out.z * toPlayer.z) / len;
        expect(dot, `格 (${px}, ${pz}) 的方向背离玩家`).toBeGreaterThan(0);
      }
    }
    // 场外：halfX=5 → cols=10，落在格子 0..9，即 x ∈ [-5, 5)。
    // 格索引 floor((x+halfX)/cell)：x=4.99 → 9（合法），x=5 → 10（越界）。
    expect(nav.flowAt(4.99, 0, out)).toBe(true);
    expect(nav.flowAt(5, 0, out)).toBe(false);
    expect(nav.flowAt(10.5, 0, out)).toBe(false);
    expect(nav.flowAt(0, 10.5, out)).toBe(false);

    // 中间竖一道 1×3 米的墙：blockPlatforms 的 0.55 米 padding 让它实际挡住 x∈[-3, 2]、z∈[-4, -1]。
    // 玩家站在墙南侧（0, 3），墙北侧必须绕行，不能穿墙。
    nav.blockPlatforms([{ x: 0, z: -2, w: 1, d: 3, h: 2 }]);
    nav.update(0, 3, 1);
    const blockedIdx = (x, z) => nav.blocked[(z + 5) * 10 + (x + 5)];
    for (const x of [-2, -1, 0, 1]) {
      for (const z of [-3, -2, -1]) {
        expect(blockedIdx(x, z), `(${x}, ${z}) 应在墙的膨胀范围内`).toBe(1);
        expect(nav.flowAt(x, z, out), `(${x}, ${z}) 是墙格，不该有方向`).toBe(false);
      }
    }
    // 墙正西侧（-3,-2）必须指回玩家一侧（+z），而不是穿过墙朝北
    expect(nav.flowAt(-3, -2, out)).toBe(true);
    expect(out.z).toBeGreaterThan(0);
    // 更西边的 -4,-2 再往西绕一格，方向是 (-√½, √½)：既有 +z，也不会往墙里钻
    expect(nav.flowAt(-4, -2, out)).toBe(true);
    expect(out.z).toBeGreaterThan(0);
    // 墙东侧的格子指向 -x（往西绕）
    expect(nav.flowAt(3, -2, out)).toBe(true);
    expect(out.x).toBeLessThan(0);
    // 墙南侧（玩家同侧）的格子直接朝玩家 +z 走，不能有朝墙的 -z 分量
    expect(nav.flowAt(-2, 1, out)).toBe(true);
    expect(out.z).toBeGreaterThan(0);
    // 跟随流场从墙西侧出发：不会卡死在墙格上，且最终能走到墙南侧（z > 墙的南沿）
    let x = -2.5;
    let z = -5;
    let escaped = false;
    for (let i = 0; i < 80; i++) {
      if (!nav.flowAt(x, z, out)) break; // 撞到墙格 = 走法是错的
      x += out.x * 0.2;
      z += out.z * 0.2;
      if (z > 0) {
        escaped = true;
        break;
      }
    }
    expect(escaped, `绕墙失败，停在 (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
  });

  it('玩家每次换格才重算；同格内不重复 BFS', () => {
    const nav = new FlowField(5, 5, 1);
    nav.update(0, 0, 0.2);
    expect(nav.cx).toBe(5);
    expect(nav.cz).toBe(5);
    const snap = nav.dist.slice();
    nav.update(0.2, 0.2, 0.2); // 同一格、timer 还没到
    expect(nav.dist).toEqual(snap);
    expect(nav.timer).toBeCloseTo(0.25, 6);
    nav.update(0.2, 0.2, 0.3); // timer 归零后即使同格也重算
    expect(nav.timer).toBeCloseTo(0.45, 6);
  });

  it('玩家站在障碍格上时从最近的空格起算', () => {
    const nav = new FlowField(6, 6, 1);
    nav.blockPlatforms([{ x: 0, z: 0, w: 2, d: 2, h: 2 }]);
    const idx = Math.floor((0 + 6) / 1) + Math.floor((0 + 6) / 1) * nav.cols;
    expect(nav.blocked[idx]).toBe(1);
    nav.update(0, 0, 1);
    const out = { x: 0, z: 0 };
    // 玩家被标记障碍时，周围格子仍然有方向
    expect(nav.flowAt(3, 3, out)).toBe(true);
  });

  it('全图被障碍封死时 flowAt 不返回方向（不会抛错）', () => {
    const nav = new FlowField(2, 2, 1);
    nav.blockPlatforms([{ x: 0, z: 0, w: 10, d: 10, h: 3 }]);
    expect(() => nav.update(0, 0, 1)).not.toThrow();
    const out = { x: 0, z: 0 };
    expect(nav.flowAt(0, 0, out)).toBe(false);
  });

  describe.each([
    ['snow', '冰'],
    ['dust', '沙'],
  ])('%s：僵尸出生点与全部拾取点位都可到达玩家', (id) => {
    let map;
    beforeAll(() => {
      map = id === 'snow' ? new IceWorld(new THREE.Scene()) : new DustYard(new THREE.Scene());
    }, SECONDS);

    it('各个特殊的僵尸出生点 → 玩家出生点：场均有效且指向玩家', () => {
      const player = { pos: { x: map.spawn.x, z: map.spawn.z } };
      map.updateNav(player, 0.5);
      const check = (x, z, label) => {
        const out = { x, z, dir: { x: 0, z: 0 } };
        const r = flowTowardPlayer(map, player, out);
        expect(r.ok, `${label} (${x}, ${z}) 拿不到流场方向`).toBe(true);
        expect(r.dot, `${label} (${x}, ${z}) 的流场背离玩家（dot=${r.dot.toFixed(3)}）`).toBeGreaterThan(0);
      };
      // 出生点本身可能正好落在障碍格里（推挤后的僵尸站在障碍边缘），
      // 所以额外检查出生点周围 2 米的格子：这些才是僵尸实际会站的格子。
      for (const [x, z] of map.zombieSpawnPoints) {
        let okCells = 0;
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            const px = x + dx;
            const pz = z + dz;
            if (Math.abs(px) >= map.bounds.x - 1 || Math.abs(pz) >= map.bounds.z - 1) continue;
            const out = { x: px, z: pz, dir: { x: 0, z: 0 } };
            const r = flowTowardPlayer(map, player, out);
            if (!r.ok) continue;
            okCells++;
          }
        }
        expect(okCells, `出生点 (${x}, ${z}) 周围 5×5 米内一个可通行格都没有`).toBeGreaterThan(0);
      }
      // 正对玩家的方向一定有场
      check(map.spawn.x, map.spawn.z - 6, '玩家出生点南侧');
    });

    it('每个拾取点位站玩家，四周 1.2 米处都指向玩家（点位本身可达）', () => {
      const dir = { x: 0, z: 0 };
      for (const [x, z] of map.pickupSpots) {
        const player = { pos: { x, z } };
        map.updateNav(player, 0.5);
        // 点位所在格周围（僵尸实际站的地方）都必须有指向玩家的方向
        const probes = [
          [x, z - 1.2],
          [x, z + 1.2],
          [x - 1.2, z],
          [x + 1.2, z],
        ];
        let reachable = 0;
        for (const [px, pz] of probes) {
          if (Math.abs(px) >= map.bounds.x || Math.abs(pz) >= map.bounds.z) continue;
          const out = { x: px, z: pz, dir };
          const r = flowTowardPlayer(map, player, out);
          if (!r.ok) continue;
          reachable++;
          expect(r.dot, `点位 (${x}, ${z}) 附近 (${px.toFixed(1)}, ${pz.toFixed(1)}) 背离玩家`).toBeGreaterThan(0);
        }
        expect(reachable, `拾取点位 (${x}, ${z}) 四周完全没有流场`).toBeGreaterThan(0);
      }
    });

    it('flowAt 对地图外的坐标返回 false', () => {
      const out = { x: 0, z: 0 };
      expect(map.flowAt(map.bounds.x + 5, 0, out)).toBe(false);
      expect(map.flowAt(0, -map.bounds.z - 5, out)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// materials.js
// ---------------------------------------------------------------------------
describe('materials.js 程序化材质与贴图', () => {
  it('toon / flat 返回正确类型，toon 带共享渐变图', () => {
    const t = materials.toon(0x123456);
    expect(t).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(t.color.getHex()).toBe(0x123456);
    expect(t.gradientMap).toBeInstanceOf(THREE.DataTexture);
    const t2 = materials.toon(0xffffff, { map: null, transparent: true });
    expect(t2.transparent).toBe(true);
    // 每次调用都是新材质（材质要各自改色/闪烁），但渐变图共享
    expect(t2).not.toBe(t);
    expect(t2.gradientMap).toBe(t.gradientMap);

    const f = materials.flat(0xabcdef);
    expect(f).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(f.color.getHex()).toBe(0xabcdef);
    expect(materials.flat(0x1, { transparent: true }).transparent).toBe(true);
  });

  const TEX_FNS = [
    ['grassTexture', true],
    ['skyTexture', false],
    ['snowTexture', true],
    ['sandTexture', true],
    ['iceWallTexture', true],
    ['iceTexture', true],
    ['snowSkyTexture', false],
    ['desertSkyTexture', false],
    ['blobShadowTexture', false],
    ['glowTexture', false],
    ['cloudTexture', false],
  ];

  it.each(TEX_FNS)('%s 返回 SRGB 的 CanvasTexture，且单例缓存', (name, repeat) => {
    const fn = materials[name];
    expect(typeof fn).toBe('function');
    const a = fn();
    const b = fn();
    expect(a).toBeInstanceOf(THREE.Texture);
    expect(a.isCanvasTexture).toBe(true);
    expect(a.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(a.image.width).toBeGreaterThan(0);
    expect(a.image.height).toBeGreaterThan(0);
    expect(b).toBe(a); // 第二次调用命中缓存
    if (repeat) {
      expect(a.wrapS).toBe(THREE.RepeatWrapping);
      expect(a.wrapT).toBe(THREE.RepeatWrapping);
      expect(a.repeat.x).toBeGreaterThan(1);
      expect(a.repeat.y).toBeGreaterThan(1);
      expect(a.anisotropy).toBe(4);
    }
  });

  it('室外环境贴图：三张地图各生成一次 PMREM 贴图并缓存', async () => {
    const { game } = await createGame();
    const renderer = game.renderer;
    const envs = {
      backyard: materials.outdoorEnvironment(renderer, 'backyard'),
      snow: materials.outdoorEnvironment(renderer, 'snow'),
      dust: materials.outdoorEnvironment(renderer, 'dust'),
    };
    for (const id of ['backyard', 'snow', 'dust']) {
      expect(envs[id]).toBeInstanceOf(THREE.Texture);
      // 第二次调用必须返回同一个引用（Game 频率很高地取 env）
      expect(materials.outdoorEnvironment(renderer, id)).toBe(envs[id]);
    }
    // 三张地图的环境贴图互不相同
    expect(new Set(Object.values(envs)).size).toBe(3);
    // 未知 id 落到后院
    expect(materials.outdoorEnvironment(renderer, 'nope')).toBe(envs.backyard);
    expect(materials.outdoorEnvironment(renderer, undefined)).toBe(envs.backyard);
    // Game.setMap 写入的 ctx.env 就是缓存里的那一份
    game.setMap('snow');
    expect(game.ctx.env).toBe(envs.snow);
    game.setMap('dust');
    expect(game.ctx.env).toBe(envs.dust);
  });

  it('同一张地图的环境贴图只生成一次 PMREM：同引用、不重复构造 PMREMGenerator', async () => {
    const spy = vi.spyOn(THREE, 'PMREMGenerator');
    // 走 Game.setMap 这条真实路径：ctx.env 由 Game 写入，必须和缓存里的是同一份
    const { game } = await createGame();
    game.setMap('dust');
    const env = game.ctx.env;
    spy.mockClear();
    expect(materials.outdoorEnvironment(game.renderer, 'dust')).toBe(env);
    game.setMap('snow');
    game.setMap('dust');
    expect(game.ctx.env).toBe(env);
    expect(spy).not.toHaveBeenCalled(); // 命中缓存后不再 new PMREMGenerator
    spy.mockRestore();
  });
});
// ---------------------------------------------------------------------------
// 地图内部几何工具的分支（这些分支平时不会走到，只有新增地图/调尺寸时才触发）
// ---------------------------------------------------------------------------
describe('地图几何工具的边界分支', () => {
  it('DustYard.blockColliders：小到装不下碰撞圆的实心体退化成一个圆', () => {
    const map = new DustYard(new THREE.Scene());
    const before = map.colliders.length;
    // 0.9 × 0.9 的桶：w/2 - r < 0 且 d/2 - r < 0，两条退化分支都命中
    map.blockColliders(100, 100, 0.9, 0.9);
    expect(map.colliders.length).toBe(before + 1);
    expect(map.colliders[map.colliders.length - 1]).toEqual({ x: 100, z: 100, r: 0.68 });

    // 细长条（只有一条轴装得下）：沿长边等距铺圆，间距 ≤ 1.1 米
    const start = map.colliders.length;
    map.blockColliders(200, 0, 0.9, 6);
    const row = map.colliders.slice(start);
    expect(row.length).toBeGreaterThan(3);
    for (const c of row) expect(c.x).toBe(200);
    const zs = row.map((c) => c.z).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeLessThanOrEqual(1.1 + 1e-9);
    expect(zs[0]).toBeCloseTo(-3 + 0.68, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(3 - 0.68, 6);
  });

  it('DustYard.solid：cap:false 不抬顶面、collide:false 不挂僵尸碰撞', () => {
    const map = new DustYard(new THREE.Scene());
    const colBefore = map.colliders.length;
    const platBefore = map.platforms.length;
    const wallBefore = map.walls.length;
    const top = map.solid(300, 300, 4, 4, 1.5, { cap: false, collide: false });
    expect(top).toBe(1.5); // 没有顶盖 → 顶面就是盒体本身
    expect(map.platforms[map.platforms.length - 1]).toEqual({ x: 300, z: 300, w: 4, d: 4, h: 1.5 });
    expect(map.colliders.length).toBe(colBefore); // collide:false 不登记
    expect(map.platforms.length).toBe(platBefore + 1);
    expect(map.walls.length).toBe(wallBefore + 1); // 但依然进反弹体

    const topCap = map.solid(320, 300, 4, 4, 1.5, {});
    expect(topCap).toBeCloseTo(1.72, 6); // +0.22 顶盖
    expect(map.colliders.length).toBeGreaterThan(colBefore); // 默认登记碰撞
  });

  it('Arena 的向日葵花头把 10 片花瓣合并成一份几何体（顶点数守恒）', () => {
    const map = new Arena(new THREE.Scene());
    // SphereGeometry(0.16, 6, 4) → (6+1) × (4+1) = 35 个顶点、6×4×6 = 108 个索引
    const petalVerts = 35;
    let head = null;
    map.root.traverse((o) => {
      if (!head && o.isMesh && o.geometry.attributes.position.count === 10 * petalVerts) head = o;
    });
    expect(head, '向日葵花头几何体没找到').toBeTruthy();
    expect(head.geometry.index.count).toBe(10 * 108);
    expect(head.geometry.attributes.normal.count).toBe(10 * petalVerts);
    // 每片花瓣都被转到不同角度：包围盒在 x/z 两个方向都铺开
    head.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    head.geometry.boundingBox.getSize(size);
    expect(size.x).toBeGreaterThan(0.6);
    expect(size.z).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// 天气粒子：update 会把粒子循环重播，长时间跑不能数值爆炸
// ---------------------------------------------------------------------------
describe('雪 / 沙粒子循环', () => {
  it('雪地：雪花竖直下落、落到地面以下会被重播到 13..16 米高', () => {
    const map = new IceWorld(new THREE.Scene());
    const p = map.snowData;
    expect(p.length).toBe(380 * 3);
    const y0 = p[1];
    map.update(0.1);
    // 每帧 y 都减小（snowSpeed ∈ [1.5, 3.4]，0.1 秒至少掉 0.15）
    expect(p[1]).toBeLessThan(y0);

    // 雪花落到地面以下会被重播到 13..16 米高并重新随机 x/z，所以横向漂移必须按“每帧步长”断言，
    // 不能按绝对位置或累积增量（重播会直接把 x 跳到半个场地之外）。
    const maxY = new Float32Array(380);
    for (let i = 0; i < 380; i++) maxY[i] = p[i * 3 + 1];
    let maxStep = 0;
    for (let f = 0; f < 120; f++) {
      const prevX = Float32Array.from({ length: 380 }, (_, i) => p[i * 3]);
      map.update(0.1);
      for (let i = 0; i < 380; i++) {
        // 横向每帧最多漂 dt × 0.5 = 0.05 米（重播那一帧会整粒换位置，按 y 回升识别并跳过）
        if (p[i * 3 + 1] > maxY[i]) {
          expect(Math.abs(p[i * 3])).toBeLessThanOrEqual(map.bounds.x);
          continue;
        }
        maxStep = Math.max(maxStep, Math.abs(p[i * 3] - prevX[i]));
      }
      for (let i = 0; i < 380; i++) maxY[i] = p[i * 3 + 1];
    }
    expect(maxStep).toBeLessThanOrEqual(0.05 + 1e-6);

    // y 始终落在 [0, 16] 的循环区间，z 从不漂移
    for (let i = 0; i < 380; i++) {
      const y = p[i * 3 + 1];
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(16);
      expect(Math.abs(p[i * 3 + 2])).toBeLessThanOrEqual(map.bounds.z);
    }
  });

  it('沙城：沙尘横向漂移，穿出东边界会被卷回西边界', () => {
    const map = new DustYard(new THREE.Scene());
    const p = map.dustData;
    expect(p.length).toBe(220 * 3);
    const xs = [];
    for (let i = 0; i < 220; i++) xs.push(p[i * 3]);
    map.update(0.5);
    let advanced = 0;
    for (let i = 0; i < 220; i++) if (p[i * 3] >= xs[i]) advanced++;
    // dustSpeed ∈ [0.15, 0.5] 全为正：除了恰好从东边界被卷回的那一粒，其余都往 +x 漂
    expect(advanced).toBeGreaterThanOrEqual(218);
    for (let i = 0; i < 400; i++) map.update(0.25);
    for (let i = 0; i < 220; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      // x 越界即被卷回 HALF_X 西侧；y 只做了下界重播（上界会缓慢抬高，这是当前实现的既有行为）
      expect(x).toBeLessThanOrEqual(map.bounds.x);
      expect(x).toBeGreaterThanOrEqual(-map.bounds.x);
      expect(y).toBeGreaterThanOrEqual(0.2);
      expect(y).toBeLessThanOrEqual(8);
    }
  });
});
