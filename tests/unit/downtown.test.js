// 《摩天街区 DOWNTOWN》专项：全部数值来自 docs/FPS-MAPS-RESEARCH-city.md §5（§5.2/§5.4/§5.5/§5.6）
// + 任务定稿修正（天桥 {x:26,z:0,w:8,d:3,h:1.9} 跨 EW 横街、pickupSpots 全地面点、侧翼点 (26,-39)）。
// 通用契约（接口/点位/流场可达）由 maps.test.js 的 describe.each 覆盖，这里只锁 downtown 的布局规格。
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

const SECONDS = 20 * 1000;
// 占用口径与 maps.test.js 一致：≥0.6 米的平台算“有坎”（僵尸流场封锁阈值）。
const OBSTACLE_H = 0.6;
// 僵尸圆形碰撞的等效半径（Zombie.update 用 c.r + zombie.radius * 0.8 推出）。
const ZOMBIE_R_ROUGH = 0.52;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

function isBox(w) {
  return isFiniteNum(w.hx) && isFiniteNum(w.hy) && isFiniteNum(w.hz) && w.hx > 0 && w.hy > 0 && w.hz > 0;
}

function boxContains(w, x, z) {
  const dx = x - w.x;
  const dz = z - w.z;
  // OBB：把点转回盒子局部坐标再比半尺寸（照沙城专项的写法）。
  const lx = dx * w.c + dz * w.s;
  const lz = -dx * w.s + dz * w.c;
  return Math.abs(lx) <= w.hx && Math.abs(lz) <= w.hz;
}

function platformAt(platforms, x, z, minH) {
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

let THREE;
let Downtown;
let materials;
let FlowField;
let PerspectiveCamera;

beforeAll(async () => {
  ({ Downtown } = await import('../../src/world/Downtown.js'));
  THREE = await import('three');
  materials = await import('../../src/world/materials.js');
  ({ FlowField } = await import('../../src/world/FlowField.js'));
  ({ PerspectiveCamera } = THREE);
}, SECONDS);

describe('摩天街区 Downtown 专项', () => {
  let map;
  beforeAll(() => {
    map = new Downtown(new THREE.Scene());
  }, SECONDS);

  // 流场格子查询（1 米网格，与 FlowField.update/flowAt 同一公式）。
  const blockedAt = (x, z) => {
    const nav = map.nav;
    return nav.blocked[Math.floor((z + nav.halfZ) / nav.cell) * nav.cols + Math.floor((x + nav.halfX) / nav.cell)];
  };

  it('场地 90×90（±45），玩家在南广场 (0,34) 面向正北出生', () => {
    // 设计稿 §5.2 尺度 90×90（HALF=45）+ 定稿 spawn {x:0,z:34,yaw:0}
    expect(map.bounds).toEqual({ x: 45, z: 45 });
    expect(map.spawn).toEqual({ x: 0, z: 34, yaw: 0 });
  });

  it('围墙四面封闭：反弹盒覆盖各边中点（照沙城专项写法）', () => {
    const boxes = map.walls.filter(isBox);
    for (const [x, z] of [
      [0, -45 - 0.5],
      [0, 45 + 0.5],
      [-45 - 0.5, 0],
      [45 + 0.5, 0],
    ]) {
      expect(boxes.some((b) => boxContains(b, x, z)), `外墙缺口 (${x}, ${z})`).toBe(true);
    }
  });

  it('楼峡主街贯通：x=0 全程无障碍；x=±3 除中段掩体 crate(±3.5,-30) 外无障碍', () => {
    // 设计稿 §5.4：双塔 solid(±11,-26,8,8,18) 夹出 14 米峡谷主街（NS 大道 x∈[-7,7]），z 从 -45 贯通到 -16。
    // P1-3①（任务定稿）在楼峡中段加 crate(±3.5,-30,1.6,0.9) 分段 29m 裸视线：脚印 x∈[±2.7,±4.3]
    // 含 0.55 padding 后挡住格 x∈[±3]、z∈[-32,-28)，两侧 x=0 中线与街沿仍贯通。
    expect(map.nav).toBeInstanceOf(FlowField);
    for (let z = -40; z <= -16; z += 2) {
      expect(blockedAt(0, z), `楼峡 (0, ${z}) 被流场标障`).toBe(0);
      expect(colliderAt(map.colliders, 0, z, 0.1), `楼峡 (0, ${z}) 有碰撞体`).toBeUndefined();
    }
    for (const x of [-3, 3]) {
      for (let z = -40; z <= -16; z += 2) {
        const inCover = z === -32 || z === -30;
        // 掩体格：流场标障（含 0.55 padding 外扩格）；其余格净空。
        // 碰撞圆只在箱体本身所在行（z=-30）断言——padding 外扩格（z=-32）没有碰撞圆是正常的。
        expect(blockedAt(x, z), `楼峡 (${x}, ${z}) 流场状态`).toBe(inCover ? 1 : 0);
        if (z === -30) {
          expect(
            colliderAt(map.colliders, x, z, 0.1) !== undefined,
            `楼峡 (${x}, ${z}) 掩体碰撞圆缺失`
          ).toBe(true);
        } else if (!inCover) {
          expect(colliderAt(map.colliders, x, z, 0.1), `楼峡 (${x}, ${z}) 有碰撞体`).toBeUndefined();
        }
      }
    }
  });

  it('双塔占位：8×8×18 平台位于 (±11,-26)，塔基裙台 8×5×0.95 位于 (±11,-18.5)', () => {
    // 设计稿 §5.4：双塔 8×8×18 夹楼峡、塔基裙台 8×5×0.95（跳上 → Δ0.95 上天桥线）。
    const towers = map.platforms.filter((p) => p.w === 8 && p.d === 8);
    expect(towers.map((p) => `${p.x},${p.z}`).sort()).toEqual(['-11,-26', '11,-26'].sort());
    for (const p of towers) expect(p.h).toBeCloseTo(18, 3);
    const skirt = map.platforms.filter((p) => p.w === 8 && p.d === 5);
    expect(skirt.map((p) => `${p.x},${p.z}`).sort()).toEqual(['-11,-18.5', '11,-18.5'].sort());
    for (const p of skirt) expect(p.h).toBeCloseTo(0.95, 6);
  });

  it('NW 停车楼三级跳链：0.95 → 1.9 → 2.85，相邻级差 ≤0.95 且 >0.6（引擎可跳 + 僵尸封锁双条件）', () => {
    // 设计稿 §5.4：阶梯台 0.95/1.9/2.85 各 10×10；§5.7：全部 >0.6 米 → 僵尸流场封锁。
    const steps = map.platforms.filter((p) => p.w === 10 && p.d === 10).map((p) => p.h).sort((a, b) => a - b);
    expect(steps, `停车楼阶梯台应是 0.95/1.9/2.85 三级，实际 ${JSON.stringify(steps)}`).toEqual([0.95, 1.9, 2.85]);
    for (let i = 1; i < steps.length; i++) {
      const d = steps[i] - steps[i - 1];
      expect(d, `第 ${i} 级级差 ${d} 应 ≤0.95（玩家一次跳跃能上去）`).toBeLessThanOrEqual(0.95 + 1e-9);
      expect(d, `第 ${i} 级级差 ${d} 应 >0.6（僵尸流场封锁）`).toBeGreaterThan(OBSTACLE_H);
    }
  });

  it('天桥精确占位 {x:26,z:0,w:8,d:3,h:1.9}，并与两端 1.9 米板台平接', () => {
    // 定稿修正：天桥是悬空 platform，横跨 EW 横街连接 NE 商场裙台与 SE 工地板台。
    const bridge = map.platforms.find((p) => p.x === 26 && p.z === 0 && p.w === 8 && p.d === 3);
    expect(bridge, '天桥 platform {x:26,z:0,w:8,d:3} 不存在').toBeTruthy();
    expect(bridge.h).toBeCloseTo(1.9, 6);
    // NE 商场裙台 16×16×1.9（§5.4），与天桥同高平接
    const deck = map.platforms.find((p) => p.x === 26 && p.z === -26);
    expect(deck, 'NE 商场裙台 (26,-26) 不存在').toBeTruthy();
    expect(deck.w).toBe(16);
    expect(deck.d).toBe(16);
    expect(deck.h).toBeCloseTo(1.9, 6);
    // SE 工地板台 1.9（§5.4），在天桥东南象限一侧
    const seDeck = map.platforms.filter((p) => Math.abs(p.h - 1.9) < 1e-6 && p.x > 16 && p.z > 16);
    expect(seDeck.length, 'SE 工地象限内没有 1.9 米板台').toBeGreaterThanOrEqual(1);
  });

  it('天桥脚印两侧地面通道净空：(19,0) 与 (34,0) 不被流场标障，桥脚印本身标障', () => {
    // 定稿修正：横街两侧地面通道 x∈[16,22] 与 [30,37] 必须净空（玩家可从桥两侧走过）。
    // 天桥 h=1.9 > 0.6（含 0.55 padding）→ 脚印 x∈[21,31) 被标障，僵尸沿两侧通道绕行。
    expect(blockedAt(19, 0), '天桥西侧通道 (19,0) 被流场标障').toBe(0);
    expect(blockedAt(34, 0), '天桥东侧通道 (34,0) 被流场标障').toBe(0);
    expect(blockedAt(26, 0), '天桥脚印 (26,0) 应被流场标障（僵尸不走桥）').toBe(1);
  });

  it('门洞 ≥3m：商场口 / 工地口 / 停车场楼梯两侧采样点不被碰撞体堵死', () => {
    // 设计稿 §5.9 风险 3：所有门洞 ≥3m（Boss 半径 0.9）。两侧采样点相距 3 米，都无碰撞体 ⇒ 口宽 ≥3m。
    // 口位按 §5.4 尺寸表推导：商场口在 NE 裙台北沿与环街之间的北走廊（z≈-35.5），
    // 工地口在 SE 半成品塔北沿走廊（z≈17.5），停车场楼梯在 NW 楼体南沿与广场之间（z≈-17.5）。
    const doors = [
      ['商场口', 24.5, -35.5],
      ['商场口', 27.5, -35.5],
      ['工地口', 24.5, 17.5],
      ['工地口', 27.5, 17.5],
      ['停车场楼梯', -27.5, -17.5],
      ['停车场楼梯', -24.5, -17.5],
    ];
    for (const [name, x, z] of doors) {
      expect(colliderAt(map.colliders, x, z, 0.1), `${name} 采样点 (${x}, ${z}) 被碰撞体堵死`).toBeUndefined();
    }
  });

  it('刷怪点恰好 10 个：主路楼峡 5 + 侧翼 3 + 远端环街 2，且不压高台、离碰撞圆足够远', () => {
    // 设计稿 §5.5 + 定稿修正（侧翼商场北侧口为 (26,-39)）+ P3-8 主路横向铺开拉纵深：
    // (0,-43) (-6,-41) (6,-41) (-4,-37) (4,-39)——仍保持 |x|<7 且 z<-36 的楼峡主路约束。
    const pts = map.zombieSpawnPoints;
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBe(10);
    expect(pts.map((p) => p.join(',')).sort()).toEqual(
      ['0,-43', '-6,-41', '6,-41', '-4,-37', '4,-39', '-41,0', '41,0', '26,-39', '-41,-30', '41,-30'].sort()
    );
    // 主路 5 点全在楼峡内：|x| < 7 且 z < -36
    const canyon = pts.filter(([x, z]) => Math.abs(x) < 7 && z < -36);
    expect(canyon.length, '楼峡主路应有 5 个刷怪点').toBe(5);
    // 远端 2 点在西北/东北环角（环街）
    const far = pts.filter(([x, z]) => Math.abs(x) > 37 && z < -16);
    expect(far.length, '环街远端应有 2 个刷怪点').toBe(2);
    // 侧翼 3 点：西/东横街口在环街（|x|>37），商场北侧口在北环街（|z|>37）
    const flank = pts.filter((p) => !canyon.includes(p) && !far.includes(p));
    expect(flank.length, '侧翼应有 3 个刷怪点').toBe(3);
    for (const [x, z] of flank) {
      expect(Math.abs(x) > 37 || Math.abs(z) > 37, `侧翼点 (${x}, ${z}) 不在环街上`).toBe(true);
    }
    // 首波教学口：openingSpawnPoints 4 个全部来自楼峡一线（§5.5 波 1 用可选接口）
    expect(map.openingSpawnPoints.map((p) => p.join(',')).sort()).toEqual(
      ['0,-40', '-3,-41', '3,-41', '0,-36'].sort()
    );
    for (const [x, z] of map.openingSpawnPoints) {
      expect(Math.abs(x)).toBeLessThan(7);
      expect(z, '首波点应在楼峡北段（z ≤ -36，钉死点含 [0,-36] 本身）').toBeLessThanOrEqual(-36);
    }
    // 全部刷怪点不压 ≥0.6 平台（僵尸不会跳）
    for (const [x, z] of pts) {
      expect(platformAt(map.platforms, x, z, OBSTACLE_H), `刷怪点 (${x}, ${z}) 压在高台上`).toBeUndefined();
      // 距最近碰撞圆 > 0.8 × 0.52 + 0.01：Zombie 推出量（c.r + radius×0.8）之外再留 0.01 余量
      let clearance = Infinity;
      for (const c of map.colliders) {
        clearance = Math.min(clearance, Math.hypot(c.x - x, c.z - z) - c.r);
      }
      expect(clearance, `刷怪点 (${x}, ${z}) 离碰撞圆太近`).toBeGreaterThan(0.8 * ZOMBIE_R_ROUGH + 0.01);
    }
  });

  it('拾取点恰好 8 个且坐标与设计稿一致（安全 2 / 中风险 3 / 高风险 3 的梯度）', () => {
    // 设计稿 §5.6 + 定稿修正：8 个点全部是地面点（契约禁止点位在 ≥0.6 平台上）。
    const spots = map.pickupSpots;
    expect(spots.length).toBe(8);
    expect(spots.map((p) => p.join(',')).sort()).toEqual(
      ['-8,30', '8,30', '0,9', '-26,0', '34,0', '0,-33', '-19,-19', '26,19'].sort()
    );
    // 风险梯度：安全 = 南广场两侧；中风险 = 广场南沿与东西横街；高风险 = 楼峡 / 西北内院 / 东南工地
    const safe = spots.filter(([x, z]) => z > 28);
    const mid = spots.filter(([x, z]) => (z >= 8 && z <= 10) || (Math.abs(z) < 1 && Math.abs(x) >= 16));
    expect(safe.length).toBe(2);
    expect(mid.length).toBe(3);
    expect(spots.length - safe.length - mid.length).toBe(3);
  });

  it('activate：黄昏天空 duskSkyTexture、雾色 0x4a3c50、near 60 / far 210', () => {
    const s = new THREE.Scene();
    map.activate(s);
    expect(s.background).toBe(materials.duskSkyTexture());
    expect(s.fog.color.getHex()).toBe(0x4a3c50);
    expect(s.fog.near).toBe(60);
    expect(s.fog.far).toBe(210);
  });

  it('menuCamera：低机位掠景（视觉评审 D 定稿）——y≈14、半径≈30，双塔剪影+发光窗当画面主体', () => {
    // 出处：三方评审视觉清单 D「menuCamera 低机位重构」——原 26 米高空俯瞰把塔窗压成色块；
    // 新机位 y≈13~16、半径≈30、lookAt(0,1,-6)（maps.test 的 dot>0.6/随 t 移动契约不变）。
    const cam = new PerspectiveCamera(73, 1, 0.05, 240);
    for (const t of [0, 3, 11, 26]) {
      map.menuCamera(cam, t);
      expect(cam.position.y, `t=${t} 机位高度脱离低机位区间`).toBeGreaterThan(13);
      expect(cam.position.y, `t=${t} 机位高度脱离低机位区间`).toBeLessThan(16);
      const horiz = Math.hypot(cam.position.x, cam.position.z);
      expect(horiz, `t=${t} 机位半径脱离 ≈30 区间`).toBeGreaterThan(28);
      expect(horiz, `t=${t} 机位半径脱离 ≈30 区间`).toBeLessThan(32);
    }
  });

  it('update(dt) 长跑 600 帧：不抛错且碰撞/平台/拾取表数值不漂移（契约 30 帧版的强化）', () => {
    const c0 = JSON.stringify(map.colliders);
    const p0 = JSON.stringify(map.platforms);
    const k0 = JSON.stringify(map.pickupSpots);
    for (let i = 0; i < 600; i++) map.update(1 / 60);
    expect(JSON.stringify(map.colliders)).toBe(c0);
    expect(JSON.stringify(map.platforms)).toBe(p0);
    expect(JSON.stringify(map.pickupSpots)).toBe(k0);
  });
});

describe('摩天街区 · 碰撞体辅助与材质接线', () => {
  let m;
  beforeAll(() => {
    m = new Downtown(new THREE.Scene());
  }, SECONDS);

  it('blockColliders：比僵尸还瘦的盒子退化成单个圆', () => {
    const before = m.colliders.length;
    m.blockColliders(5, 5, 1, 1); // 半宽 0.5 < 半径 0.68 → 两个方向都是 0
    expect(m.colliders.length).toBe(before + 1);
    expect(m.colliders.at(-1)).toMatchObject({ x: 5, z: 5, r: 0.68 });
  });

  it('blockColliders：横向细长盒沿 x 每 1.1 米铺一个圆（z 不变）', () => {
    const before = m.colliders.length;
    m.blockColliders(0, 10, 6, 1);
    const added = m.colliders.slice(before);
    expect(added.length).toBeGreaterThan(2);
    expect(new Set(added.map((c) => c.z))).toEqual(new Set([10]));
    // 铺满整条边：两端的圆心正好在 ±(6/2-0.68)
    expect(Math.min(...added.map((c) => c.x))).toBeCloseTo(-2.32, 5);
    expect(Math.max(...added.map((c) => c.x))).toBeCloseTo(2.32, 5);
  });

  it('blockColliders：纵向细长盒沿 z 铺（x 不变）', () => {
    const before = m.colliders.length;
    m.blockColliders(-12, 0, 1, 6);
    const added = m.colliders.slice(before);
    expect(added.length).toBeGreaterThan(2);
    expect(new Set(added.map((c) => c.x))).toEqual(new Set([-12]));
  });

  it('setEnv：重复喂同一张 envMap 幂等，null 直接忽略', () => {
    const map2 = new Downtown(new THREE.Scene());
    const env = new THREE.Texture();
    map2.setEnv(env);
    expect(map2.matGlass.envMap).toBe(env);
    expect(map2.matGlass.metalness).toBeCloseTo(0.28, 5);

    const version = map2.matGlass.version;
    map2.setEnv(env);      // 同一张：直接 return，不再触发材质重编译
    expect(map2.matGlass.version).toBe(version);

    map2.setEnv(null);     // 保护：没 envMap 也不该把已有的清掉
    expect(map2.matGlass.envMap).toBe(env);
  });
});
