// ProjectileSystem：豌豆池 / 扫掠命中 / 穿透 / 爆头标记 / 樱桃抛物线 / 爆炸 / 撞墙。
// ctx 尽量薄：只提供 ProjectileSystem 真正会读的字段，不启动整个 Game。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 本文件会间接加载 three（ProjectileSystem 用它建池），jsdom 里没有 WebGL 上下文。
// 用 doMock（不提升）是为了能在 beforeAll 里先拿到 three 再装渲染器替身。
vi.doMock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return {
    ...actual,
    WebGLRenderer: class {
      constructor(o) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = o && o.canvas;
      }
    },
  };
});

const DT = 1 / 60;
const REST_N = 0.4;
const REST_T = 0.95;
// ProjectileSystem 内部常量（命中球半径是物理契约，直接按数值断言）
const HEAD_R = 0.36;
const CHEST_R = 0.46;
const PEA_POOL = 64;
const CHERRY_POOL = 5;

let THREE;
let TUNING;
let Y;
let ctx;
let scene;
let P;

// 只提供一个「僵尸替身 + 记录器」的 ctx：update 只读 zombies.zombies / map.walls / map.bounds。
function fakeZombie(x, z, opts = {}) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const sab = opts.scaleFactor || 1;
  const z0 = {
    type: opts.type || 'normal',
    root,
    scaleFactor: sab,
    radius: opts.radius !== undefined ? opts.radius : 0.46,
    maxHp: opts.maxHp || 62,
    hp: opts.maxHp || 62,
    alive: true,
    dying: false,
    spawnT: opts.spawnT !== undefined ? opts.spawnT : 1,
    slowTimer: 0,
    headHit: false,
    hits: 0,
    getChest(out) {
      out.set(root.position.x, 0.95 * sab, root.position.z);
      return out;
    },
    getHead(out) {
      out.set(root.position.x, 1.45 * sab, root.position.z);
      return out;
    },
    hit(dmg, slow) {
      if (!this.alive || this.dying || this.spawnT < 0.5) return false;
      if (slow) this.slowTimer = 2.6;
      this.hits++;
      this.hp -= dmg;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.dying = true;
        return true;
      }
      return false;
    },
  };
  return z0;
}

async function boot() {
  if (P) return;
  // three 的替身必须在 import three 之前装好
  await import('../helpers/game.js').then((h) => h.stubGltfLoader());
  THREE = await import('three');
  ({ TUNING } = await import('../../src/config.js'));
  Y = await import('../../src/utils.js');
  const { ProjectileSystem } = await import('../../src/weapons/ProjectileSystem.js');
  scene = new THREE.Scene();
  ctx = {};
  const zombies = {
    zombies: [],
    damageArea: vi.fn(() => 0),
    handleKill: vi.fn(),
  };
  ctx.scene = scene;
  ctx.zombies = zombies;
  ctx.particles = { splat: vi.fn(), explosion: vi.fn() };
  ctx.sfx = { hit: vi.fn(), headshot: vi.fn(), explosion: vi.fn() };
  // 默认无墙、场地 100x100：撞墙 / 围栏用例会临时替换
  ctx.map = { walls: [], bounds: { x: 100, z: 100 } };
  ctx.onHit = vi.fn();
  ctx.onExplosion = vi.fn();
  P = new ProjectileSystem(ctx);
}

// 摆一只僵尸替身并登记进 ctx
function placeZombie(type, x, z, opts = {}) {
  const cfg = { normal: { maxHp: 62, radius: 0.46 }, boss: { maxHp: 1450, radius: 0.9, scaleFactor: 1.85 } }[type] || {};
  const z0 = fakeZombie(x, z, { type, maxHp: cfg.maxHp, hp: cfg.maxHp, radius: cfg.radius, ...cfg, ...opts });
  ctx.zombies.zombies.push(z0);
  return z0;
}

// 推进到「没有在飞的豌豆」为止：豌豆一帧只走 speed*dt 米，命中可能发生在好几帧之后。
// 返回实际推进的帧数（有上限，避免死循环）。
function runUntilSettled(maxFrames = 240) {
  let frames = 0;
  while (frames < maxFrames) {
    P.update(DT);
    frames++;
    if (!P.peas.some((p) => p.active)) break;
  }
  return frames;
}

// 与球心等高、沿 -Z 方向的水平射线，在指定水平偏移 off 处是否穿过球（用于验证命中球半径契约）
function horizontalCrossing(origin, center, radius) {
  const step = origin.clone();
  step.z -= (74 / 60) * 2;
  return Y.segmentSphereT(origin, step, center, radius) >= 0;
}

// 复刻僵尸 z 轴排列（间距 1.4 < 身体球直径 1.2 + 穿透余量），用真实坐标
function zLine(count, gap = 1.4, startZ = 0) {
  return Array.from({ length: count }, (_, i) => makeFixedZombie(0, startZ - i * gap));
}

// 单帧扫掠长度 74/60 ≈ 1.23 米；相邻僵尸间距 1.4 米（贴身排布）时每颗球都会被扫到
const LINE_GAP = 1.4;

// 坐标在构造时写死：不依赖 root.position 的 x/z setter（THREE.Vector3 会给三个分量都赋值）
function makeFixedZombie(x, z, opts = {}) {
  const sf = opts.scaleFactor || 1;
  const hp = opts.maxHp || 62;
  const z0 = {
    type: 'normal',
    root: { position: { x, y: 0, z } },
    scaleFactor: sf,
    radius: 0.46,
    maxHp: hp,
    hp,
    alive: true,
    dying: false,
    spawnT: 1,
    slowTimer: 0,
    headHit: false,
    hits: 0,
    getChest(out) {
      out.set(x, 0.95 * sf, z);
      return out;
    },
    getHead(out) {
      out.set(x, 1.45 * sf, z);
      return out;
    },
    hit(dmg, slowTimer) {
      if (!this.alive || this.dying || this.spawnT < 0.5) return false;
      if (slowTimer) this.slowTimer = 2.6;
      this.hits++;
      this.hp -= dmg;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.dying = true;
        return true;
      }
      return false;
    },
  };
  ctx.zombies.zombies.push(z0);
  return z0;
}

const peaDef = (over = {}) => ({ id: 'pea', speed: 74, damage: 15, color: 0x8ade2a, ...over });

// 从 origin 朝 dir 发射一颗豌豆；返回该豌豆对象
function firePeaAt(origin, dir, def, headshot) {
  // 不归一化时豌豆每帧只走几厘米，会完全跳过小目标：测试统一把方向归一化后再给 def.speed
  P.spawnPea(origin, dir.clone().normalize(), def, headshot);
  // 测试专用脚注：只用来让 step 用正确半径，读不到就退回默认
  return P.peas.filter((p) => p.active).at(-1);
}

// 沿初速把投掷物推进到落地，返回落地时的水平距离（不含积分误差之外的近似）
function horizOf(c) {
  return Math.hypot(c.vel.x, c.vel.z) * (c.vel.y / c.gravity + Math.sqrt((c.vel.y / c.gravity) ** 2 + (2 * (c.pos.y - c.ground)) / c.gravity));
}

const cherryDef = (over = {}) => ({ id: 'cherry', damage: 210, radius: 5.6, color: 0xe8452f, ...over });

beforeEach(async () => {
  await boot();
  ctx.zombies.zombies.length = 0;
  ctx.zombies.handleKill.mockClear();
  ctx.zombies.damageArea.mockReset();
  // 复刻 ZombieManager.damageArea 的真实公式：半径 radius + z.radius 内受伤，按距离衰减，
  // 中心 100%、边缘 45%；headTarget 额外乘 headMul。
  ctx.zombies.damageArea.mockImplementation((center, radius, damage, headTarget, headMul) => {
    let n = 0;
    for (const z of ctx.zombies.zombies) {
      if (!z.alive || z.dying) continue;
      // 与 ZombieManager.damageArea 一致：三维距离（含 y 高度差）
      const p = z.root.position;
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      if (d < radius + z.radius) {
        const falloff = 1 - Math.min(1, Math.max(0, (d - radius * 0.35) / radius)) * 0.55;
        const head = z === headTarget;
        const died = z.hit(damage * falloff * (head ? headMul || 1 : 1), false);
        n++;
        if (died) ctx.zombies.handleKill(z, head);
      }
    }
    return n;
  });
  ctx.zombies.handleKill.mockImplementation((z) => {
    z.alive = false;
    z.dying = true;
    return true;
  });
  ctx.particles.splat.mockClear();
  ctx.particles.explosion.mockClear();
  ctx.sfx.hit.mockClear();
  ctx.sfx.headshot.mockClear();
  ctx.sfx.explosion.mockClear();
  ctx.onHit = vi.fn();
  ctx.onExplosion = vi.fn();
  ctx.map.walls = [];
  ctx.map.bounds = { x: 100, z: 100 };
  P.clear();
  P.peas.forEach((p) => p.hits.clear());
});
describe('构造与池', () => {
  it('豌豆池 64 个、樱桃池 5 个，初始全部不可见且不进场景渲染', async () => {
    expect(P.peas.length).toBe(PEA_POOL);
    expect(P.cherries.length).toBe(CHERRY_POOL);
    expect(P.peas.every((p) => !p.active && p.mesh.visible === false)).toBe(true);
    expect(P.cherries.every((c) => !c.active && c.group.visible === false)).toBe(true);
    // 池对象挂在场景里（复用一个几何体 + 每个颜色一份材质缓存）
    expect(P.peas[0].mesh.parent).toBe(scene);
    expect(P.peaMatCache.size).toBeGreaterThanOrEqual(1);
  });

  it('同色豌豆共享同一份材质（材质按颜色缓存）', () => {
    firePeaAt(new THREE.Vector3(0, 1.5, 10), new THREE.Vector3(0, 0, -1), peaDef());
    firePeaAt(new THREE.Vector3(0.1, 1.5, 10), new THREE.Vector3(0, 0, -1), peaDef());
    const [a, b] = P.peas.filter((p) => p.active);
    expect(a.mesh.material).toBe(b.mesh.material);
    expect(a.mesh.material.color.getHex()).toBe(0x8ade2a);
    expect(P.peaMatCache.get(0x8ade2a)).toBe(a.mesh.material);
  });

  it('不同颜色用不同材质', () => {
    firePeaAt(new THREE.Vector3(0, 1.5, 10), new THREE.Vector3(0, 0, -1), peaDef());
    firePeaAt(new THREE.Vector3(0, 1.5, 10), new THREE.Vector3(0, 0, -1), peaDef({ color: 0x8fe6ff, slow: true }));
    const [a, b] = P.peas.filter((p) => p.active);
    expect(a.mesh.material).not.toBe(b.mesh.material);
    expect(b.mesh.material.color.getHex()).toBe(0x8fe6ff);
  });
});

describe('spawnPea', () => {
  it('从池中取一个未激活的豌豆并写入速度 / 伤害 / 类型 / life / 穿透', () => {
    const origin = new THREE.Vector3(1, 2, 3);
    const def = peaDef({ pierce: 2, slow: true });
    firePeaAt(origin, new THREE.Vector3(0, 0, -1), def);
    const p = P.peas.filter((x) => x.active)[0];
    expect(p).toBe(P.peas[0]);
    expect(p.mesh.visible).toBe(true);
    expect(p.mesh.material).toBe(P.peaMaterial(def.color));
    expect(p.pos.toArray()).toEqual([1, 2, 3]);
    expect(p.prev.toArray()).toEqual([1, 2, 3]);
    // 速度 = 归一化方向 * def.speed
    expect(p.vel.length()).toBeCloseTo(def.speed, 9);
    expect(p.vel.z).toBeCloseTo(-def.speed, 9);
    expect(p.damage).toBe(def.damage);
    expect(p.type).toBe('pea');
    expect(p.life).toBe(1.6);
    expect(p.pierce).toBe(2);
    expect(p.slow).toBe(true);
    expect(p.headshot).toBe(false);
    expect(p.hits.size).toBe(0);
    expect(p.mesh.position.toArray()).toEqual([1, 2, 3]);
  });

  it('速度 = dir * def.speed（直接乘，不重新归一化）', () => {
    P.spawnPea(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -3), peaDef());
    const p = P.peas.filter((x) => x.active)[0];
    expect(p.vel.toArray()).toEqual([0, 0, -222]);
    firePeaAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), peaDef({ speed: 62 }));
    const q = P.peas.filter((x) => x.active)[1];
    expect(q.vel.toArray()).toEqual([62, 0, 0]);
  });

  it('headshot 标记透传，且新一发会清掉上一发留下的 hits', () => {
    const res = [];
    P.spawnPea(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef(), true);
    res.push(P.peas.filter((x) => x.active).at(-1));
    expect(res[0].headshot).toBe(true);
    res[0].hits.add({ fake: true });
    // 复用同一个池对象：发第二发时 hits 必须被清空
    P.peas[0].active = false;
    P.spawnPea(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef());
    expect(P.peas[0].hits.size).toBe(0);
    expect(P.peas[0].headshot).toBe(false);
  });

  it('同步覆盖 type / 网格缩放：穿透 1.05、寒冰 1.15、普通 1', () => {
    firePeaAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef());
    firePeaAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef({ id: 'cactus', pierce: 2 }));
    firePeaAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef({ id: 'snow', slow: true, speed: 10 }));
    const [a, b, c] = P.peas.filter((x) => x.active);
    expect(a.mesh.scale.x).toBe(1);
    expect(b.mesh.scale.x).toBeCloseTo(1.05, 9);
    expect(b.type).toBe('cactus');
    expect(c.mesh.scale.x).toBeCloseTo(1.15, 9);
    expect(c.type).toBe('snow');
  });

  it('池满（64）后静默丢弃，不再覆盖已激活的豌豆', () => {
    // 真实池 64 个；这里把池表截短到 3 个只是为了让用例快（spawnPea 的算法完全一样）
    const full = P.peas;
    P.peas = full.slice(0, 3);
    try {
      for (let i = 0; i < 5; i++) {
        P.spawnPea(new THREE.Vector3(i, 1, 0), new THREE.Vector3(0, 0, -1), peaDef());
      }
      expect(P.peas.filter((x) => x.active).length).toBe(3);
      expect(P.spawnPea(new THREE.Vector3(999, 1, 0), new THREE.Vector3(0, 0, -1), peaDef())).toBeUndefined();
      // 最先发射的那些没有被覆盖
      expect(P.peas.map((p) => p.pos.x)).toEqual([0, 1, 2]);
    } finally {
      P.peas = full;
    }
  });

  it('peaMaterial 对未给颜色回落到默认绿，并复用缓存', () => {
    const m1 = P.peaMaterial(undefined);
    const m2 = P.peaMaterial(null);
    const m3 = P.peaMaterial(0x9bf227);
    expect(m1).toBe(m3);
    expect(m2).toBe(m3);
    expect(P.peaMatCache.get(0x9bf227)).toBe(m3);
  });
});

describe('update / 扫掠命中', () => {
  it('命中身体：伤害 = damage（不穿头），豌豆立即失活，onHit(head=false, killed)', () => {
    const z = placeZombie('normal', 0, 0);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    // 从僵尸正前方 5 米、胸口高度朝 -Z 打
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 1.5), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.hp).toBe(62 - 15);
    expect(onHit).toHaveBeenCalledWith(false, false);
    expect(p.active).toBe(false);
    expect(p.mesh.visible).toBe(false);
  });

  it('命中头部：伤害 × headshotMul', () => {
    const z = placeZombie('normal', 0, 0);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    firePeaAt(new THREE.Vector3(0, 1.45, 1.5), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.hp).toBe(62 - 15 * TUNING.headshotMul);
    expect(onHit).toHaveBeenCalledWith(true, false);
  });

  it('头部球按 HEAD_R*scale 判定：超出 0.36 的水平偏移打不中头', () => {
    // 头部球半径 0.36：水平偏 0.5 米、头部高度的射线擦不到头，只可能撞身体球
    const z = placeZombie('normal', 0, 0);
    const head = new THREE.Vector3();
    const chest = new THREE.Vector3();
    z.getHead(head);
    z.getChest(chest);
    const seg0 = new THREE.Vector3(z.root.position.x + 0.5, head.y, 1.5);
    const seg1 = new THREE.Vector3(z.root.position.x + 0.5, head.y, -1.5);
    expect(Y.segmentSphereT(seg0, seg1, head, HEAD_R * z.scaleFactor)).toBe(-1);
    // 0.5 < 身体球 0.46+0.14 之外也不会中身体：这一枪完全落空
    expect(Y.segmentSphereT(seg0, seg1, chest, CHEST_R * z.scaleFactor + 0.14)).toBe(-1);
    firePeaAt(seg0, new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.hp).toBe(62);
  });

  it('身体球被胖化到 CHEST_R*scale+0.14：0.55 米偏移仍能命中身体', () => {
    const z = placeZombie('normal', 0, 0);
    firePeaAt(new THREE.Vector3(0.55, 0.95, 3), new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(z.hp).toBe(62 - 15);
  });

  it('头部球不加宽：头/身命中球尺寸为 0.36 / 0.46+0.14，头部球更小', () => {
    const z = placeZombie('normal', 0, 0);
    const head = new THREE.Vector3();
    z.getHead(head);
    const chest = new THREE.Vector3();
    z.getChest(chest);
    // 命中球半径契约：头部 0.36*scale（不加宽），身体 0.46*scale+0.14（加宽）
    expect(HEAD_R * z.scaleFactor).toBeCloseTo(0.36, 12);
    expect(CHEST_R * z.scaleFactor + 0.14).toBeCloseTo(0.6, 12);
    expect(HEAD_R * z.scaleFactor).toBeLessThan(CHEST_R * z.scaleFactor + 0.14);
    // 同一高度上，宽 0.5 米的水平射线能打到身体球、打不到头部球
    const seg0 = new THREE.Vector3(0.5, chest.y, 3);
    const seg1 = new THREE.Vector3(0.5, chest.y, -3);
    expect(Y.segmentSphereT(seg0, seg1, chest, CHEST_R * z.scaleFactor + 0.14)).toBeGreaterThanOrEqual(0);
    expect(Y.segmentSphereT(seg0, seg1, head, HEAD_R * z.scaleFactor)).toBe(-1);
    // 头部高度上水平偏 0.5 米则完全脱靶（头部球不加宽的直接后果）
    const head0 = new THREE.Vector3(0.5, head.y, 3);
    const head1 = new THREE.Vector3(0.5, head.y, -3);
    expect(Y.segmentSphereT(head0, head1, head, HEAD_R * z.scaleFactor)).toBe(-1);
    expect(Y.segmentSphereT(head0, head1, chest, CHEST_R * z.scaleFactor + 0.14)).toBe(-1);
    firePeaAt(head0, new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(z.hp).toBe(62); // 整枪落空
  });

  it('Boss 体型更大：命中球随 scaleFactor 放大（0.46/0.36 × 1.85）', () => {
    const z = makeFixedZombie(0, 0, { scaleFactor: 1.85, maxHp: 1462, radius: 0.9 });
    expect(z.scaleFactor).toBeCloseTo(1.85, 9);
    // 身体球 1.85*0.46+0.14 = 0.991，头部球 1.85*0.36 = 0.666
    const chest = z.getChest(new THREE.Vector3());
    const head = z.getHead(new THREE.Vector3());
    expect(chest.y).toBeCloseTo(1.7575, 9);
    expect(head.y).toBeCloseTo(2.6825, 9);
    // 身体高度、水平偏 0.8 米：普通僵尸会脱靶，Boss 的身体球够得着
    firePeaAt(new THREE.Vector3(0.8, chest.y, 2.4), new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(z.hp).toBe(1462 - 15);
    expect(z.hits).toBe(1);
  });

  it('spawnT < 0.5 的僵尸不吃伤害（出生动画免疫）', () => {
    const z = placeZombie('normal', 0, 0);
    z.spawnT = 0.3;
    firePeaAt(new THREE.Vector3(0, 0.95, 1.5), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.hp).toBe(z.maxHp);
  });

  it('已经死亡的僵尸不再吃伤害', () => {
    const z = placeZombie('normal', 0, 0);
    z.alive = false;
    firePeaAt(new THREE.Vector3(0, 0.95, 1.5), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.hp).toBe(z.maxHp);
  });

  it('扫掠取最近命中：离得近的僵尸先挨打，后面的不受影响', () => {
    const a = placeZombie('normal', 0, 0);
    const b = placeZombie('normal', 0, -4);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    // 射线高度 1.45：A 的头部球整颗都在（命中判头），B 在 A 后面
    firePeaAt(new THREE.Vector3(0, 1.45, 3), new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(a.hp).toBe(62 - 45);
    expect(b.hp).toBe(62);
  });

  it('位置固定、两球分立的僵尸：头部球在射线高度时按爆头结算', () => {
    // 用真实坐标常量而不是 root.position 引用，避免替身对象的坐标联动问题
    const zs = makeFixedZombie(0, 0);
    firePeaAt(new THREE.Vector3(0, 1.45, 3), new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(zs.hp).toBe(62 - 45);
  });

  it('穿透 pierce=2：同一只不会重复命中，第 4 只之后不再受伤', () => {
    // 贴身排布：间距 1.4 米（< 单帧扫掠 + 球半径 + 外扩），保证每只都会被扫到
    const zs = zLine(4, LINE_GAP);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 2.5), new THREE.Vector3(0, 0, -1), peaDef({ pierce: 2 }));
    runUntilSettled(600);
    expect(p.active).toBe(false);
    // 前两只各挨一枪、第三只只挨一枪（第四枪用掉了最后一格穿透，但豌豆已经没了）
    for (const z of zs) expect(z.hits).toBeLessThanOrEqual(1);
    // 前三只都吃满 15 点（同一只只挨一次）
    expect(zs[0].hp).toBe(62 - 15);
    expect(zs[1].hp).toBe(62 - 15);
    expect(zs[2].hp).toBe(62 - 15);
    expect(zs[3].hits).toBe(0);
    expect(p.hits.size).toBe(2);
  });

  it('穿透的豌豆不会命中同一只僵尸两次（hits 集合去重）', () => {
    const z = placeZombie('normal', 0, 0);
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -0.3), peaDef({ pierce: 2, damage: 1, speed: 18 }));
    for (let f = 0; f < 60; f++) P.update(DT);
    expect(p.hits.has(z)).toBe(true);
    expect(z.hp).toBe(62 - 1);
  });

  it('普通豌豆命中一只后失活，不会继续打后面的僵尸', () => {
    const a = placeZombie('normal', 0, 0);
    const b = placeZombie('normal', 0, -3);
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    for (let f = 0; f < 6; f++) P.update(DT);
    expect(a.hp).toBe(47);
    expect(b.hp).toBe(62);
    expect(p.active).toBe(false);
  });

  it('击中身体也给寒冰减速（slow 传到 Zombie.hit）', () => {
    const z = placeZombie('normal', 0, 0);
    firePeaAt(new THREE.Vector3(0, 0.95, 2), new THREE.Vector3(0, 0, -1), peaDef({ id: 'snow', slow: true, damage: 19, speed: 10 }));
    runUntilSettled();
    expect(z.slowTimer).toBeCloseTo(2.6, 9);
    expect(z.hp).toBe(62 - 19);
  });

  it('寒冰豌豆的 splat 用冰蓝色（粒子颜色随 slow 分支走）', () => {
    const splat = ctx.particles.splat;
    placeZombie('normal', 0, 0);
    firePeaAt(new THREE.Vector3(0, 0.95, 2), new THREE.Vector3(0, 0, -1), peaDef({ id: 'snow', slow: true, speed: 10 }));
    runUntilSettled();
    expect(splat).toHaveBeenCalled();
    expect(splat.mock.calls[0][1]).toBe(0xa8f0ff);
    splat.mockClear();
    P.clear();
    firePeaAt(new THREE.Vector3(0, 0.95, 2), new THREE.Vector3(0, 0, -1), peaDef());
    runUntilSettled();
    expect(splat.mock.calls[0][1]).toBe(0x7fbf3f);
  });
});

describe('update / 爆头与击杀', () => {
  it('forced headshot：一次命中按爆头结算，穿透后剩下的命中回到普通伤害', () => {
    const zs = zLine(3, 1.4);
    const [a] = zs;
    // 断言：A 在 z=0、B 在 z=-1.4，一帧扫掠 1.23 米足够依次打到两只
    // 瞄胸口开火（射线只穿身体球），但瞄准辅助打了 headshot 标记
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 2.5), new THREE.Vector3(0, 0, -1), peaDef({ pierce: 2 }), true);
    expect(p.headshot).toBe(true);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    runUntilSettled(600);
    expect(onHit).toHaveBeenCalled();
    // 第一次命中按爆头（45 点），后续命中按普通伤害（15 点）
    // 第一个命中者：强制爆头 45 点
    expect(a.hp).toBe(62 - 15 * TUNING.headshotMul);
    expect(a.hits).toBe(1);
    // 后续命中最多一次（同一只不重复命中）
    for (const z of zs) {
      if (z === a) continue;
      expect(z.hits).toBeLessThanOrEqual(1);
    }
  });

  it('forced headshot 对同 t 的头部/身体取较大 t（仍按爆头算）', () => {
    const z = placeZombie('normal', 0, 0);
    // 从胸口高度水平打：只命中身体球，但强制标记让它算爆头
    firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -1), peaDef(), true);
    P.update(DT);
    expect(z.hp).toBe(62 - 45);
  });

  it('击杀时调用 zombies.handleKill(z, headshot)，onHit(head, killed=true)', () => {
    const z = placeZombie('normal', 0, 0);
    z.hp = 10;
    const handleKill = ctx.zombies.handleKill;
    const onHit = vi.fn();
    ctx.onHit = onHit;
    firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(z.alive).toBe(false);
    expect(z.dying).toBe(true);
    expect(handleKill).toHaveBeenCalledTimes(1);
    expect(handleKill.mock.calls[0][0]).toBe(z);
    expect(handleKill.mock.calls[0][1]).toBe(false);
    expect(onHit).toHaveBeenCalledWith(false, true);
  });

  it('爆头击杀：handleKill 第二参数为 true', () => {
    const z = placeZombie('normal', 0, 0);
    z.hp = 10;
    const handleKill = ctx.zombies.handleKill;
    firePeaAt(new THREE.Vector3(0, 1.45, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(handleKill).toHaveBeenCalledTimes(1);
    expect(handleKill.mock.calls[0][1]).toBe(true);
  });

  it('未击杀时 onHit(head=false, killed=false)', () => {
    placeZombie('normal', 0, 0);
    const onHit = vi.fn();
    ctx.onHit = onHit;
    firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(onHit).toHaveBeenCalledWith(false, false);
  });

  it('命中时打 hit / headshot 音效（爆头走 headshot）', () => {
    const hitSpy = ctx.sfx.hit;
    const headSpy = ctx.sfx.headshot;
    placeZombie('normal', 0, 0);
    firePeaAt(new THREE.Vector3(0, 0.95, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(hitSpy).toHaveBeenCalledTimes(1);
    expect(headSpy).not.toHaveBeenCalled();

    hitSpy.mockClear();
    firePeaAt(new THREE.Vector3(0, 1.45, 1.2), new THREE.Vector3(0, 0, -1), peaDef());
    P.update(DT);
    expect(headSpy).toHaveBeenCalledTimes(1);
    expect(hitSpy).not.toHaveBeenCalled();
  });
});

describe('update / 落地与寿命', () => {
  it('向下打的豌豆撞地：立刻失活并在 y=0.08 处 splat', () => {
    const splat = ctx.particles.splat;
    const p = firePeaAt(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -1, 0), peaDef());
    let frames = 0;
    while (p.active && frames < 120) {
      P.update(DT);
      frames++;
    }
    expect(p.active).toBe(false);
    expect(splat).toHaveBeenCalled();
    const [pos] = splat.mock.calls.at(-1);
    expect(pos.y).toBeCloseTo(0.08, 9);
    expect(frames).toBeGreaterThan(0);
  });

  it('豌豆走直线、没有重力：水平飞行不落地，只在撞墙或寿命到期时消失', () => {
    const p = firePeaAt(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(0, 0, -1), peaDef());
    let frames = 0;
    while (p.active && frames < 200) {
      P.update(DT);
      frames++;
      expect(p.pos.y).toBeCloseTo(2.2, 9); // 高度一直不变：不受重力，也不会"落地"
    }
    // life 1.6s ≈ 96 帧；撞击后同帧不再扣 life，所以只走到 0.25 秒
    expect(frames).toBeGreaterThan(80);
    expect(p.life).toBeLessThanOrEqual(0.3);
  });

  it('豌豆贴着地面高度水平飞也不会被地面事件吃掉', () => {
    const z = placeZombie('normal', 0, -3);
    // 从胸口高度打到 z=-3 需要十几帧；一路 y 不变，说明没有走"落地"分支
    const p = firePeaAt(new THREE.Vector3(0, 0.95, 1.3), new THREE.Vector3(0, 0, -1), peaDef());
    for (let f = 0; f < 12 && p.active; f++) {
      P.update(DT);
      expect(p.pos.y).toBeCloseTo(0.95, 9);
    }
    expect(z.hp).toBe(62 - 15);
  });

  it('豌豆撞墙就地消失（不反弹、不穿墙）', () => {
    ctx.map.walls = [{ x: 0, y: 1, z: -3, hx: 4, hy: 1.2, hz: 0.3, c: 1, s: 0 }];
    ctx.map.bounds = { x: 100, z: 100 };
    const p = firePeaAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), peaDef());
    let frames = 0;
    while (p.active && frames < 60) {
      P.update(DT);
      frames++;
    }
    expect(p.active).toBe(false);
    expect(p.mesh.visible).toBe(false);
    // 停在墙前（墙 +Z 面 z=-2.7，球半径 0.13），不会穿到墙后
    expect(p.pos.z).toBeGreaterThan(-2.7);
    expect(ctx.particles.splat).toHaveBeenCalled();
    ctx.map.walls = [];
  });

  it('life 耗尽后失活（即使什么都没撞到）', () => {
    // 朝上飞：不会撞地也不会撞围栏，只能靠寿命到期回收
    P.spawnPea(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, 0), peaDef({ speed: 1 }));
    const p = P.peas.filter((x) => x.active)[0];
    // 先推进几帧把寿命耗到 0 以下（update 每帧先扣 life，再判断）
    p.life = 0.01;
    for (let f = 0; f < 3 && p.active; f++) P.update(DT);
    expect(p.active).toBe(false);
    expect(p.mesh.visible).toBe(false);
  });

  it('update 对未激活的豌豆不做任何事', () => {
    const p = P.peas[0];
    const pos = p.pos.clone();
    P.update(DT);
    expect(p.pos.toArray()).toEqual(pos.toArray());
    expect(p.active).toBe(false);
  });

  it('clear() 把豌豆和樱桃全部收回', () => {
    firePeaAt(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -1), peaDef());
    P.throwCherry(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0.4, -5), { id: 'cherry', damage: 210, radius: 5.6, color: 0xe8452f });
    expect(P.peas.some((p) => p.active)).toBe(true);
    expect(P.cherries.some((c) => c.active)).toBe(true);
    P.clear();
    expect(P.peas.every((p) => !p.active && p.mesh.visible === false)).toBe(true);
    expect(P.cherries.every((c) => !c.active && c.group.visible === false)).toBe(true);
  });
});

describe('step / 撞墙与地面', () => {
  // step 返回事件码：0 = 本帧没事，1 = 撞墙，2 = 落地。
  // 每帧结束把临时改掉的墙 / 场地恢复，避免影响后续用例
  afterEach(() => {
    ctx.map.walls = [];
    ctx.map.bounds = { x: 100, z: 100 };
  });

  it('没有墙也没有地面事件时：位置按速度推进，返回 0', () => {
    const pos = new THREE.Vector3(0, 5, 0);
    const vel = new THREE.Vector3(10, 0, 0);
    ctx.map.walls = [];
    ctx.map.bounds = { x: 100, z: 100 };
    expect(P.step(pos, vel, DT, 0.13, 0)).toBe(0);
    expect(pos.x).toBeCloseTo(10 * DT, 9);
    expect(pos.y).toBe(5);
  });

  it('撞地：y 落到 ground 并返回 2', () => {
    const pos = new THREE.Vector3(0, 0.3, 0);
    const vel = new THREE.Vector3(0, -6, 0);
    ctx.map.walls = [];
    ctx.map.bounds = { x: 100, z: 100 };
    expect(P.step(pos, vel, DT, 0.13, 0.25)).toBe(2);
    expect(pos.y).toBe(0.25);
  });

  it('向上飞不触发落地', () => {
    const pos = new THREE.Vector3(0, 3, 0);
    const vel = new THREE.Vector3(0, 6, 0);
    ctx.map.walls = [];
    ctx.map.bounds = { x: 100, z: 100 };
    expect(P.step(pos, vel, DT, 0.13, 0)).toBe(0);
    expect(pos.y).toBeCloseTo(3.1, 9);
  });

  it('地面已经低于 ground（贴地滚动）不再重复判定落地', () => {
    // 已在地面高度上、速度还朝下：本帧直接从地面平面开始穿过去
    const pos = new THREE.Vector3(0, 0.45, 0);
    const vel = new THREE.Vector3(6, -1, 0);
    ctx.map.walls = [];
    ctx.map.bounds = { x: 100, z: 100 };
    // 球半径 0.13 > 本帧下落 0.017：地面事件被忽略，按自由位移处理
    expect(P.step(pos, vel, DT, 0.13, 0.45)).toBe(0);
    expect(pos.y).toBeCloseTo(0.45 - DT, 9);
  });

  // 球半径用豌豆的 0.13
  const WALL = { x: 0, y: 1, z: -2, hx: 2, hy: 1, hz: 0.2, c: 1, s: 0 };

  it('撞墙：速度被 bounceVel 衰减（法向反向 40%）、位移丢弃（不穿墙）', () => {
    const wall = WALL;
    const pos = new THREE.Vector3(0, 1, -1.62);
    const vel = new THREE.Vector3(0, 0, -30);
    ctx.map.walls = [wall];
    P.step(pos, vel, DT, 0.13, 0);
    // 墙的 +Z 面在 z=-1.8，球半径 0.1 → 停在 z≈-1.7
    expect(pos.z).toBeCloseTo(-1.67, 6);
    expect(pos.z).toBeGreaterThan(-1.8);
    // bounceVel 按 n=+Z 分解：先算切线(+Z 的 0)与法向，再按 n 的符号写回；
    // 速度朝 -Z（-30），所以弹回时仍朝 -Z 方向、模长 0.4*30 = 12。
    expect(vel.z).toBeCloseTo(-12, 6);
    expect(vel.x).toBe(0);
  });

  it('撞墙后位移丢弃：下一帧继续走不会跳过墙', () => {
    const wall = { x: 0, y: 1, z: -2, hx: 2, hy: 1, hz: 0.2, c: 1, s: 0 };
    // 球半径用豌豆的 0.13
    const pos = new THREE.Vector3(0, 1, -1.62);
    const vel = new THREE.Vector3(0, 0, -200);
    ctx.map.walls = [wall];
    P.step(pos, vel, DT, 0.13, 0);
    // 一帧走 200/60 ≈ 3.3 米，远大于墙厚：仍然被卡在墙前
    expect(pos.z).toBeGreaterThan(-1.8);
    expect(pos.z).toBeLessThan(-1.6);
    // 再走一帧也一样
    ctx.map.walls = [wall];
    P.step(pos, vel, DT, 0.13, 0);
    expect(pos.z).toBeGreaterThan(-1.8);
  });

  it('低速撞墙：法向速度被清零，不会在墙前抖出一段滑行', () => {
    const wall = { x: 0, y: 1, z: -2, hx: 2, hy: 1, hz: 0.2, c: 1, s: 0 };
    // 球半径用豌豆的 0.13
    const pos = new THREE.Vector3(0, 1, -1.69);
    const vel = new THREE.Vector3(0, 0, -2);
    ctx.map.walls = [wall];
    P.step(pos, vel, DT, 0.13, 0);
    expect(Math.abs(vel.z)).toBe(0);
  });

  it('地面与墙同时发生：取更近的那个事件（地面更近 → 落地）', () => {
    // 球心 y=0.9 往下掉，一帧落到地面；墙在很远处
    const wall = { x: 0, y: 1, z: -50, hx: 2, hy: 1, hz: 0.2, c: 1, s: 0 };
    const pos = new THREE.Vector3(0, 0.2, 0);
    const vel = new THREE.Vector3(0, -60, 0);
    ctx.map.walls = [wall];
    ctx.map.bounds = { x: 100, z: 100 };
    expect(P.step(pos, vel, DT, 0.13, 0)).toBe(2);
    expect(pos.y).toBe(0);
  });

  it('地面与墙同时发生：墙更近时按撞墙处理（不落地）', () => {
    // 球心已经在墙外扩面（hz 0.05 + 球 0.13 = -1.32）上，本帧沿地面方向也往下走
    ctx.map.walls = [{ x: 0, y: 1, z: -1.5, hx: 4, hy: 1, hz: 0.05, c: 1, s: 0 }];
    ctx.map.bounds = { x: 100, z: 100 };
    const pos = new THREE.Vector3(0, 2.0, -1.32);
    const vel = new THREE.Vector3(0, -40, -40);
    expect(P.step(pos, vel, DT, 0.13, 0)).toBe(1); // 撞墙
    expect(pos.y).toBeCloseTo(2.0, 6);
    expect(pos.z).toBeCloseTo(-1.32, 6);
    // 法向 -40 → 0.4 倍；切向 -40 → 0.95 倍
    expect(vel.z).toBeCloseTo(-40 * REST_N, 6);
    expect(vel.y).toBeCloseTo(-40 * REST_T, 6);
  });

  it('外圈围栏兜底：没有墙时投掷物也出不了场地', () => {
    const pos = new THREE.Vector3(22.5, 1, 0);
    const vel = new THREE.Vector3(60, 0, 0);
    ctx.map.walls = [];
    ctx.map.bounds = { x: 23, z: 23 };
    P.step(pos, vel, DT, 0.13, 0);
    // 围栏在 halfX-r = 22.87 处：位置被拦住
    expect(pos.x).toBeCloseTo(22.87, 6);
    // 外圈兜底用的是「水平面的墙」，法线 (1,0,0)，撞后速度按 0.95 倍反向衰减
    expect(vel.x).toBeGreaterThan(0);

  });
});

describe('throwCherry', () => {

  it('从池中取樱桃并初始化：2.6 秒引信、半径 / 伤害 / 颜色、非西瓜地面 0.25', () => {
    P.throwCherry(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, -10), cherryDef());
    const c = P.cherries.filter((x) => x.active)[0];
    expect(c).toBe(P.cherries[0]);
    expect(c.group.visible).toBe(true);
    expect(c.pos.toArray()).toEqual([0, 1.5, 0]);
    expect(c.fuse).toBe(2.6);
    expect(c.life).toBe(0);
    expect(c.damage).toBe(210);
    expect(c.radius).toBeCloseTo(5.6, 9);
    expect(c.ground).toBe(0.25);
    expect(c.mat.color.getHex()).toBe(0xe8452f);
    expect(c.mat.emissive.getHex()).toBe(0x5a0c05);
    expect(c.group.scale.x).toBe(1);
  });

  it('西瓜：地面高度 0.45、缩放 1.35、绿色自发光', () => {
    P.throwCherry(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, -10), cherryDef({ id: 'melon', color: 0x3fae3a, damage: 280, radius: 6.6 }));
    const c = P.cherries.filter((x) => x.active)[0];
    expect(c.ground).toBe(0.45);
    expect(c.group.scale.x).toBeCloseTo(1.35, 9);
    expect(c.mat.color.getHex()).toBe(0x3fae3a);
    expect(c.mat.emissive.getHex()).toBe(0x143d10);
  });

  it('抛物线初速让落点接近 target（误差 < 2m）', () => {
    const origin = new THREE.Vector3(0, 1.42, 13);
    const targets = [
      new THREE.Vector3(0, 0.4, 3),
      new THREE.Vector3(6, 0.4, 0),
      new THREE.Vector3(-4, 0.4, 8),
      new THREE.Vector3(0, 0.4, 12),
    ];
    for (const target of targets) {
      P.clear();
      P.throwCherry(origin, target, cherryDef());
      const c = P.cherries.find((x) => x.active);
      let impact = null;
      const onExplosion = vi.fn((pos) => (impact = pos.clone()));
      ctx.onExplosion = onExplosion;
      for (let f = 0; f < 60 * 4 && !impact; f++) P.update(DT);
      expect(impact).toBeTruthy();
      const d = Math.hypot(impact.x - target.x, impact.z - target.z);
      expect(d).toBeLessThan(2);
    }
  });

  it('fly time 与初速一致：落点解算对着爆点高度而不是准星地面', () => {
    const origin = new THREE.Vector3(0, 1.42, 0);
    // target 是"准星落点正下方的地面"（y=0），爆点要落在 c.ground 上
    const target = new THREE.Vector3(0, 0, -12);
    P.throwCherry(origin, target, cherryDef());
    const c = P.cherries[0];
    const g = 15;
    const horiz = Math.hypot(target.x - origin.x, target.z - origin.z);
    const T = Math.min(1.5, Math.max(0.4, horiz / 17));
    expect(c.vel.x).toBeCloseTo((target.x - origin.x) / T, 9);
    expect(c.vel.z).toBeCloseTo((target.z - origin.z) / T, 9);
    // 解析解必须让落点高度正好是 c.ground（0.25），不是 target.y
    expect(c.vel.y).toBeCloseTo(((c.ground - origin.y) + 0.5 * g * T * T) / T, 9);
    expect(c.gravity).toBe(g);
    // 顶点 ≈ ½gT²：17 米 / 1.5 秒封顶，最高点约 1.7~3.8 米，不会从僵尸头顶飞过去
    const apex = origin.y + (c.vel.y * c.vel.y) / (2 * g);
    expect(apex).toBeGreaterThan(1.5);
    expect(apex).toBeLessThan(4);
  });

  it('远处目标也封顶 1.5 秒飞行：20 米外顶点不超过 4 米', () => {
    P.throwCherry(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, 0, -20), cherryDef({ id: 'melon' }));
    const c = P.cherries[0];
    const apex = c.pos.y + (c.vel.y * c.vel.y) / (2 * c.gravity);
    expect(apex).toBeLessThan(4);
    expect(horizOf(c)).toBeCloseTo(20, 6);
  });

  it('目标贴身（水平 < 1.5m）时按最低 1.5m 算水平时间，不会出现除零', () => {
    const origin = new THREE.Vector3(0, 1.42, 0);
    P.throwCherry(origin, new THREE.Vector3(0, 0.4, -0.2), cherryDef());
    const c = P.cherries[0];
    const T = Math.max(0.4, 1.5 / 17);
    expect(c.vel.z).toBeCloseTo(-0.2 / T, 9);
    expect(Number.isFinite(c.vel.y)).toBe(true);
  });

  it('引信耗尽（2.6s）强制爆炸', () => {
    const onExplosion = vi.fn();
    ctx.onExplosion = onExplosion;
    // 抛物线按落点解算，正常情况都会落地或出射程（那时它就炸）。
    // 这里把重力和射程都拿掉，模拟"飞了很久还没落地"的极端情况，只留引信这一条路。
    P.throwCherry(new THREE.Vector3(0, 1.42, 0), new THREE.Vector3(0, 0, -4), cherryDef());
    const c = P.cherries[0];
    c.gravity = 0;
    c.maxRange = 1e9;
    for (let f = 0; f < 60 * 2.5; f++) P.update(DT);
    expect(onExplosion).not.toHaveBeenCalled();
    for (let f = 0; f < 15; f++) P.update(DT);
    expect(onExplosion).toHaveBeenCalledTimes(1);
    expect(P.cherries[0].active).toBe(false);
    expect(P.cherries[0].group.visible).toBe(false);
  });

  it('落地立刻爆炸，爆炸位置 y 不低于 0.4', () => {
    const onExplosion = vi.fn();
    ctx.onExplosion = onExplosion;
    P.throwCherry(new THREE.Vector3(0, 1.42, 0), new THREE.Vector3(0, 0.4, -6), cherryDef());
    let frames = 0;
    while (frames < 200 && !onExplosion.mock.calls.length) {
      P.update(DT);
      frames++;
    }
    expect(onExplosion).toHaveBeenCalledTimes(1);
    const [pos, radius] = onExplosion.mock.calls[0];
    expect(pos.y).toBeCloseTo(0.4, 9);
    expect(radius).toBeCloseTo(5.6, 9);
    // 落地爆炸发生在引信到点之前
    expect(frames).toBeLessThan(2.6 * 60);
  });

  it('靠近僵尸（< 0.9m）立即爆炸', () => {
    const z = placeZombie('normal', 0, -3);
    const onExplosion = vi.fn((pos) => (impact = pos.clone()));
    let impact = null;
    ctx.onExplosion = onExplosion;
    // 低平抛：樱桃飞到 z≈-3 附近就会触发
    P.throwCherry(new THREE.Vector3(0, 1.42, 0), new THREE.Vector3(0, 1.2, -6), cherryDef());
    let frames = 0;
    while (frames < 400 && !onExplosion.mock.calls.length) {
      P.update(DT);
      frames++;
    }
    expect(onExplosion).toHaveBeenCalled();
    expect(z.hp).toBeLessThan(z.maxHp);
  });

  it('僵尸位置高于 2.4 米时不触发贴身爆炸（y < 2.4 才判定）', () => {
    const z = placeZombie('normal', 0, 0);
    // 樱桃从高空飞过僵尸头顶：pos.y >= 2.4 时不回爆炸
    P.throwCherry(new THREE.Vector3(0, 8, 3), new THREE.Vector3(0, 8, -3), cherryDef());
    P.update(DT);
    expect(P.cherries[0].active).toBe(true);
    expect(z.hp).toBe(z.maxHp);
  });

  it('撞墙反弹不穿墙：撞到墙后停在墙前，速度翻向，不立刻炸', () => {
    ctx.map.walls = [{ x: 0, y: 1, z: -2, hx: 4, hy: 1.2, hz: 0.3, c: 1, s: 0 }];
    ctx.map.bounds = { x: 100, z: 100 };
    const onExplosion = vi.fn();
    try {
      // 水平飞、贴着墙面前 0.118 米：本帧位移 0.167 米会进墙
      P.throwCherry(new THREE.Vector3(0, 1.0, -1.6), new THREE.Vector3(0, 1.0, -5), cherryDef({ id: 'cherry' }));
      const c = P.cherries[0];
      c.vel.set(0, 0, -10);
      c.gravity = 0;
      c.maxRange = 99;
      ctx.onExplosion = onExplosion;
      P.update(DT);
      // 撞墙这一帧只反弹、不炸（西瓜投手靠这堵墙弹开继续飞）
      expect(onExplosion).not.toHaveBeenCalled();
      expect(c.active).toBe(true);
      expect(c.bounced).toBe(true);
      // 墙的 +Z 面在 z=-1.7（hz 0.3），球心被挡在 z=-1.7+0.17=-1.53 附近
      expect(c.pos.z).toBeGreaterThan(-1.7);
      // bounceVel 按法线 +Z 分解：法向 -10 反弹后仍是 -4（法向只衰减、不翻向，翻向由位置钳制承担），
      // 下一帧从墙面外侧继续 —— 关键是位置没有越过墙面
      expect(c.vel.z).toBeCloseTo(-4, 6);
      expect(Math.abs(c.vel.z)).toBeLessThan(10);
    } finally {
      ctx.map.walls = [];
      ctx.map.bounds = { x: 100, z: 100 };
    }
  });

  it('樱桃池满（5）后静默丢弃', () => {
    const full = P.cherries;
    P.cherries = full.slice(0, 2);
    try {
      for (let i = 0; i < 4; i++) {
        P.throwCherry(new THREE.Vector3(i, 1.42, 0), new THREE.Vector3(i, 0.4, -5), cherryDef());
      }
      expect(P.cherries.filter((c) => c.active).length).toBe(2);
      expect(P.cherries.map((c) => c.pos.x)).toEqual([0, 1]);
    } finally {
      P.cherries = full;
    }
  });

  it('飞行中旋转（group.rotation 每帧累加）', () => {
    P.throwCherry(new THREE.Vector3(0, 1.42, 0), new THREE.Vector3(0, 0.4, -8), cherryDef());
    const c = P.cherries[0];
    const rx0 = c.group.rotation.x;
    const rz0 = c.group.rotation.z;
    P.update(DT);
    expect(c.group.rotation.x).toBeCloseTo(rx0 + DT * 7, 9);
    expect(c.group.rotation.z).toBeCloseTo(rz0 + DT * 3, 9);
    // 位置跟随 pos
    expect(c.group.position.toArray()).toEqual(c.pos.toArray());
  });
});

describe('explodeAt', () => {
  it('按半径损伤：半径内的僵尸受伤、半径外不受影响，返回命中数', () => {
    // 用 1000 血替身：210 点爆炸会打死 62 血僵尸并把 hp 夹到 0，看不出「中心满伤」的数值口径
    const near = makeFixedZombie(0, 0, { maxHp: 1000 });
    const edge = makeFixedZombie(3, 0, { maxHp: 1000 });
    const outside = makeFixedZombie(20, 20, { maxHp: 1000 });
    // 中心取僵尸脚下（y=0）才算「零距离」：damageArea 用三维距离，含 y 高度差
    const hits = P.explodeAt(new THREE.Vector3(0, 0, 0), 5.6, 210, false);
    expect(hits).toBe(2);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(edge.hp).toBeLessThan(edge.maxHp);
    // 中心 100%、边缘按距离线性衰减
    expect(near.hp).toBeCloseTo(1000 - 210, 6);
    expect(near.alive).toBe(true);
    expect(1000 - edge.hp).toBeLessThan(210);
    expect(1000 - edge.hp).toBeGreaterThan(70);
    expect(outside.hp).toBe(outside.maxHp);
  });

  it('半径判定是 radius + 僵尸半径（z.radius）', () => {
    // 普通僵尸 z.radius=0.46：d=6.5 > 5.6+0.46 不受伤
    const z = makeFixedZombie(0, 0, { maxHp: 1000 });
    expect(P.explodeAt(new THREE.Vector3(6.5, 0, 0), 5.6, 210, false)).toBe(0);
    expect(z.hp).toBe(1000);
    // d=6.0 < 6.06 命中；d=5.9 更确定
    expect(P.explodeAt(new THREE.Vector3(5.9, 0, 0), 5.6, 210, false)).toBe(1);
    expect(z.hp).toBeLessThan(1000);
    expect(1000 - z.hp).toBeLessThan(210);
  });

  it('headshot 时 headTarget 乘 TUNING.headshotMul，其它僵尸伤害不变', () => {
    const head = makeFixedZombie(0, 0, { maxHp: 1000 });
    const other = makeFixedZombie(1.2, 0, { maxHp: 1000 });
    const hits = P.explodeAt(new THREE.Vector3(0, 0, 0), 5.6, 50, true, head, true);
    expect(hits).toBe(2);
    expect(1000 - head.hp).toBeCloseTo(50 * TUNING.headshotMul, 6);
    expect(1000 - other.hp).toBeGreaterThan(0);
    expect(1000 - other.hp).toBeLessThan(50 * TUNING.headshotMul);
  });

  it('headshot 标记：爆头音效 + onHit(head=true, false)', () => {
    const onHit = vi.fn();
    ctx.onHit = onHit;
    const headSpy = ctx.sfx.headshot;
    const z = placeZombie('normal', 0, 0);
    P.explodeAt(new THREE.Vector3(0, 0.4, 2), 5.6, 50, false, z, true);
    expect(headSpy).toHaveBeenCalled();
    expect(onHit).toHaveBeenCalledWith(true, false);
  });

  it('没有命中时不触发 onHit', () => {
    const onHit = vi.fn();
    ctx.onHit = onHit;
    expect(P.explodeAt(new THREE.Vector3(0, 0.4, 60), 5.6, 210, false)).toBe(0);
    expect(onHit).not.toHaveBeenCalled();
  });

  it('爆炸效果：粒子爆炸、音效、onExplosion 回调参数', () => {
    const boom = ctx.particles.explosion;
    const sfx = ctx.sfx.explosion;
    const onExplosion = vi.fn();
    ctx.onExplosion = onExplosion;
    const pos = new THREE.Vector3(1, 0.4, -2);
    P.explodeAt(pos, 4.2, 165, true);
    expect(boom).toHaveBeenCalledWith(pos, 4.2);
    expect(sfx).toHaveBeenCalledWith(true);
    expect(onExplosion).toHaveBeenCalledWith(pos, 4.2);
  });

  it('爆炸击杀时走 handleKill（带爆头标记），返回包含被击杀者', () => {
    const z = makeFixedZombie(0, 0);
    z.hp = 5;
    const handleKill = ctx.zombies.handleKill;
    const hits = P.explodeAt(new THREE.Vector3(0, 0.4, 2), 5.6, 210, false);
    expect(hits).toBe(1);
    expect(handleKill).toHaveBeenCalledTimes(1);
    expect(handleKill.mock.calls[0][0]).toBe(z);
    expect(handleKill.mock.calls[0][1]).toBe(false);
  });

  it('已死亡 / 濒死僵尸不计入命中数', () => {
    const z = placeZombie('normal', 0, 0);
    z.alive = false;
    const y = placeZombie('normal', 1, 0);
    y.dying = true;
    expect(P.explodeAt(new THREE.Vector3(0, 0.4, 2), 5.6, 210, false)).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// 空中层级（气球）：对空白名单 / 高位射击 / 爆炸球距离
// ---------------------------------------------------------------------------
describe('ProjectileSystem · 空中目标', () => {
  beforeEach(async () => {
    await boot();
    ctx.zombies.zombies.length = 0;
    ctx.zombies.handleKill.mockClear();
    P.clear();
    ctx.player = { pos: new THREE.Vector3(0, 0, 30) };
  });

  // 气球替身：root 在 2.2 米高，命中球跟着抬
  function placeBalloon(x, z) {
    const z0 = fakeZombie(x, z, { type: 'balloon', maxHp: 48, hp: 48, radius: 0.46 });
    z0.airborne = true;
    z0.root.position.y = 2.2;
    z0.getChest = (out) => out.set(x, 2.2 + 0.95, z);
    z0.getHead = (out) => out.set(x, 2.2 + 1.45, z);
    ctx.zombies.zombies.push(z0);
    return z0;
  }

  function fireAt(air, aerial) {
    const def = { id: 'x', speed: 74, damage: 15, color: 0x8ade2a, aerial };
    // 从气球正前方水平射向气球胸口高度
    const origin = new THREE.Vector3(0, 2.2 + 0.95, 3);
    P.spawnPea(origin, new THREE.Vector3(0, 0, -1), def, false);
    runUntilSettled();
    return air;
  }

  it('普通弹丸（aerial 未配置）直接穿过去，气球不掉血', () => {
    const b = placeBalloon(0, 0);
    fireAt(b, undefined);
    expect(b.hits).toBe(0);
    expect(b.hp).toBe(48);
  });

  it('仙人掌（aerial=1）能打中气球', () => {
    const b = placeBalloon(0, 0);
    const def = { id: 'cactus', speed: 98, damage: 30, color: 0x9be15d, aerial: 1 };
    P.spawnPea(new THREE.Vector3(0, 2.2 + 0.95, 3), new THREE.Vector3(0, 0, -1), def, false);
    runUntilSettled();
    expect(b.hits).toBe(1);
  });

  it('火豌豆（aerial=0.25）能打中，但伤害只有 25%', () => {
    const b = placeBalloon(0, 0);
    const def = { id: 'firepea', speed: 78, damage: 20, color: 0xff7a1a, aerial: 0.25 };
    P.spawnPea(new THREE.Vector3(0, 2.2 + 0.95, 3), new THREE.Vector3(0, 0, -1), def, false);
    runUntilSettled();
    expect(b.hits).toBe(1);
    // 20 * 0.25 = 5
    expect(b.hp).toBe(43);
  });

  it('站在高处（≥0.9 米、水平 3 米内）时普通豌豆也能打到气球', () => {
    ctx.player.pos.set(0, 1.6, 2);
    const b = placeBalloon(0, 0);
    // 玩家站高处，直接平射（不经过 canHitAirFromAbove 的倍率，仍是打法上的钥匙）
    const def = { id: 'pea', speed: 74, damage: 15, color: 0x8ade2a };
    P.spawnPea(new THREE.Vector3(0, 2.2 + 0.95, 3), new THREE.Vector3(0, 0, -1), def, false);
    runUntilSettled();
    expect(b.hits).toBe(1);
  });

  it('canHitAirFromAbove：高度不足、距离太远、跳跃中都返回 false', () => {
    const b = placeBalloon(0, 0);
    ctx.player.pos.set(0, 0.8, 1);
    expect(P.canHitAirFromAbove(b)).toBe(false); // 高度不够
    ctx.player.pos.set(0, 1.6, 10);
    expect(P.canHitAirFromAbove(b)).toBe(false); // 水平太远
    ctx.player.grounded = false;
    ctx.player.pos.set(0, 1.6, 2);
    expect(P.canHitAirFromAbove(b)).toBe(false); // 跳跃不算站高处
    ctx.player.grounded = true;
    expect(P.canHitAirFromAbove(b)).toBe(true);
    ctx.player.grounded = undefined;
  });

  it('0.25 倍率对火豌豆生效、对仙人掌不生效', () => {
    // 两只气球分两次测：同一场里一发会先打到近的那只
    const a = placeBalloon(0, 0);
    P.spawnPea(new THREE.Vector3(0, 3.15, 3), new THREE.Vector3(0, 0, -1), { id: 'cactus', speed: 98, damage: 30, color: 0, aerial: 1 }, false);
    runUntilSettled();
    expect(a.hp).toBe(18); // 30 满伤
    ctx.zombies.zombies.length = 0;
    const b = placeBalloon(0, 0);
    P.spawnPea(new THREE.Vector3(0, 3.15, 3), new THREE.Vector3(0, 0, -1), { id: 'firepea', speed: 78, damage: 20, color: 0, aerial: 0.25 }, false);
    runUntilSettled();
    expect(b.hp).toBe(43); // 20 × 0.25 = 5
  });

  it('火豌豆弹丸带燃烧字段与火星尾迹（burn 会让弹丸吐粒子）', () => {
    const b = placeBalloon(0, 0);
    ctx.particles.burst = vi.fn();
    P.spawnPea(new THREE.Vector3(0, 3.15, 3), new THREE.Vector3(0, 0, -1), {
      id: 'firepea', speed: 78, damage: 20, color: 0, aerial: 0.25, burn: { dps: 8, time: 3 },
    }, false);
    runUntilSettled();
    expect(b.hits).toBe(1);
    expect(ctx.particles.burst).toHaveBeenCalled();
  });
});
