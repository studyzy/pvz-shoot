import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async (importOriginal) => {
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

/**
 * 单元测试：src/entities/Player.js
 *
 * Player 只依赖 three、TUNING 与外部传入的 controls / terrain / zombies，
 * 所以这里用最小替身就地构造，精确断言速度、方向、高度与碰撞后的数值。
 */

const { TUNING } = await import('../../src/config.js');
const { Player } = await import('../../src/entities/Player.js');
const THREE = await import('three');

const STEP_HEIGHT = 0.42;
const EPS = 1e-6;

// 假输入：consumeLook / consumeJump / move 都由测试直接写字段。
function makeControls() {
  return {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    jump: false,
    consumeLook() {
      const l = { x: this.look.x, y: this.look.y };
      this.look.x = 0;
      this.look.y = 0;
      return l;
    },
    consumeJump() {
      const j = this.jump;
      this.jump = false;
      return j;
    },
  };
}

function makeSfx() {
  return { step: vi.fn() };
}

// 平地：没有平台也有边界，Player 走 else 分支（地面 y=0）。
function flatTerrain(bounds = TUNING.arenaHalf) {
  return { bounds: { x: bounds, z: bounds } };
}

function makePlayer(opts = {}) {
  const p = new Player(opts.sfx || makeSfx());
  p.pos.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? TUNING.startZ);
  p.eye.set(p.pos.x, TUNING.playerHeight, p.pos.z);
  return p;
}

// 一帧的闭式解：accel 分支是 v += (target - v) * (1 - e^{-a dt})
function expSpeedAfter(frames, target, accel, dt = 1 / 60) {
  let v = 0;
  const k = 1 - Math.exp(-accel * dt);
  for (let i = 0; i < frames; i++) v += (target - v) * k;
  return v;
}

describe('Player 构造与 reset', () => {
  it('默认站在 TUNING.startZ、满血、不死亡', () => {
    const p = new Player(makeSfx());
    expect(p.pos.toArray()).toEqual([0, 0, TUNING.startZ]);
    expect(p.hp).toBe(TUNING.maxHealth);
    expect(p.maxHp).toBe(TUNING.maxHealth);
    expect(p.dead).toBe(false);
    expect(p.grounded).toBe(true);
    expect(p.yaw).toBe(0);
    expect(p.pitch).toBe(0);
    expect(p.invuln).toBe(0);
    expect(p.sinceDamage).toBe(99);
  });

  it('reset(spawn) 恢复位置/朝向/速度/血量/dead 与 eye', () => {
    const p = makePlayer({ x: 5, z: 6 });
    p.yaw = 1.1;
    p.pitch = 0.5;
    p.roll = 0.03;
    p.recoil = 0.1;
    p.vy = 3;
    p.bob = 2;
    p.moveAmt = 0.8;
    p.invuln = 0.3;
    p.sinceDamage = 1;
    p.stepTimer = 0.2;
    p.hp = 12;
    p.dead = true;

    p.reset({ x: -3, z: 8, yaw: 0.7 });
    expect(p.pos.toArray()).toEqual([-3, 0, 8]);
    expect(p.vel.toArray()).toEqual([0, 0, 0]);
    expect(p.yaw).toBe(0.7);
    expect(p.pitch).toBe(0);
    expect(p.roll).toBe(0);
    expect(p.recoil).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.grounded).toBe(true);
    expect(p.bob).toBe(0);
    expect(p.moveAmt).toBe(0);
    expect(p.hp).toBe(TUNING.maxHealth);
    expect(p.invuln).toBe(0);
    expect(p.sinceDamage).toBe(99);
    expect(p.dead).toBe(false);
    expect(p.stepTimer).toBe(0);
    expect(p.eye.toArray()).toEqual([-3, TUNING.playerHeight, 8]);
  });

  it('reset() 无参时回到默认出生点', () => {
    const p = makePlayer({ x: 9, z: 9 });
    p.reset();
    expect(p.pos.toArray()).toEqual([0, 0, TUNING.startZ]);
    expect(p.yaw).toBe(0);
  });
});

describe('Player 移动', () => {
  let p;
  let c;
  beforeEach(() => {
    p = makePlayer();
    c = makeControls();
  });

  it('yaw=0 时 move.y=1 向 -Z 前进', () => {
    c.move.y = 1;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.pos.z).toBeLessThan(TUNING.startZ);
    expect(p.pos.x).toBeCloseTo(0, 12);
    // 速度方向也必须是 -Z
    expect(p.vel.z).toBeLessThan(0);
    expect(p.vel.x).toBeCloseTo(0, 12);
  });

  it('yaw=0 时 move.x=1 向 +X 走（右方向 = cos(yaw), -sin(yaw)）', () => {
    c.move.x = 1;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.pos.x).toBeGreaterThan(0);
    expect(p.pos.z).toBeCloseTo(TUNING.startZ, 12);
    expect(p.vel.x).toBeGreaterThan(0);
  });

  it('yaw=π/2 时前进方向变为 -X', () => {
    p.yaw = Math.PI / 2;
    c.move.y = 1;
    for (let i = 0; i < 30; i++) p.update(1 / 60, c, flatTerrain(), []);
    expect(p.vel.x).toBeLessThan(-1);
    expect(p.vel.z).toBeCloseTo(0, 6);
  });

  it('地面加速度 15：首帧速度 = playerSpeed * (1 - e^{-15/60})', () => {
    c.move.y = 1;
    const dt = 1 / 60;
    p.update(dt, c, flatTerrain(), []);
    const expectSpeed = TUNING.playerSpeed * (1 - Math.exp(-15 * dt));
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(expectSpeed, 9);
  });

  it('持续输入时速度逼近 playerSpeed（5.4），不会超速', () => {
    c.move.y = 1;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) p.update(dt, c, flatTerrain(), []);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    expect(speed).toBeCloseTo(expSpeedAfter(120, TUNING.playerSpeed, 15, dt), 9);
    expect(speed).toBeLessThanOrEqual(TUNING.playerSpeed + EPS);
    expect(speed).toBeGreaterThan(TUNING.playerSpeed - 0.001);
    expect(TUNING.playerSpeed).toBe(5.4);
  });

  it('对角输入被归一化：速度仍只有 playerSpeed', () => {
    c.move.x = 1;
    c.move.y = 1;
    for (let i = 0; i < 120; i++) p.update(1 / 60, c, flatTerrain(), []);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    expect(speed).toBeLessThanOrEqual(TUNING.playerSpeed + EPS);
    // 方向为 (-Z, +X) 的 45°
    expect(p.vel.x).toBeCloseTo(-p.vel.z, 6);
    expect(p.moveAmt).toBeCloseTo(1, 6);
  });

  it('空中加速度 4.5（地面 15）：同样从静止出发一帧的水平速度不同', () => {
    const dt = 1 / 60;
    const v = TUNING.playerSpeed;
    c.move.y = 1;

    // 地面：首帧 accel=15
    p.update(dt, c, flatTerrain(), []);
    expect(Math.abs(p.vel.z)).toBeCloseTo(v * (1 - Math.exp(-15 * dt)), 9);

    // 空中：先走到最大高度并保持 grounded=false，再把水平速度清零后测一帧
    const air = makePlayer();
    const ac = makeControls();
    ac.jump = true;
    air.update(dt, ac, flatTerrain(), []);
    ac.jump = false;
    for (let i = 0; i < 3; i++) air.update(dt, ac, flatTerrain(), []);
    expect(air.grounded).toBe(false);
    air.vel.set(0, 0, 0);
    air.pos.z = 0;
    ac.move.y = 1;
    air.update(dt, ac, flatTerrain(), []);
    expect(air.grounded).toBe(false);
    expect(Math.abs(air.vel.z)).toBeCloseTo(v * (1 - Math.exp(-4.5 * dt)), 9);
    // 4.5 的加速度约为 15 的 30%
    expect(Math.abs(air.vel.z)).toBeLessThan(v * (1 - Math.exp(-15 * dt)) * 0.4);
  });

  it('moveAmt 等于输入向量长度（对角输入为 1）', () => {
    c.move.x = 0.5;
    c.move.y = 0.5;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.moveAmt).toBeCloseTo(Math.hypot(0.5, 0.5), 9);
  });
});

describe('Player 视角', () => {
  it('consumeLook 后 yaw 减小、pitch 被 clamp 到 ±1.42，look 被清零', () => {
    const p = makePlayer();
    const c = makeControls();
    c.look.x = 0.3;
    c.look.y = 0.2;
    p.update(1 / 60, c, flatTerrain(), []);
    // yaw -= look.x，pitch -= look.y（look.y 为正 = 鼠标下移 = 低头）
    expect(p.yaw).toBeCloseTo(-0.3, 12);
    expect(p.pitch).toBeCloseTo(-0.2, 12);
    expect(c.look.x).toBe(0);
    expect(c.look.y).toBe(0);
    expect(p.lastLook.x).toBe(0.3);
    expect(p.lastLook.y).toBe(0.2);

    // 上报了但没有被消费 → 不在 update 里自行清零
    c.look.x = 5;
    c.look.y = 5;
    c.consumeLook();
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.yaw).toBeCloseTo(-0.3, 12);
  });

  it('pitch 上限 1.42 / 下限 -1.42', () => {
    const p = makePlayer();
    const c = makeControls();
    for (let i = 0; i < 20; i++) {
      c.look.y = 1; // 鼠标下移 → pitch -= 1 → 低头到 -1.42
      p.update(1 / 60, c, flatTerrain(), []);
    }
    expect(p.pitch).toBe(-1.42);
    for (let i = 0; i < 40; i++) {
      c.look.y = -1; // 鼠标上移 → pitch += 1 → 抬头到 +1.42
      p.update(1 / 60, c, flatTerrain(), []);
    }
    expect(p.pitch).toBe(1.42);
  });

  it('移动时 roll 按横移速度倾斜并夹在 ±0.05', () => {
    const p = makePlayer();
    const c = makeControls();
    c.move.x = 1; // +X 右移 → localStrafe > 0 → roll 为负
    for (let i = 0; i < 120; i++) p.update(1 / 60, c, flatTerrain(), []);
    expect(p.roll).toBeLessThan(0);
    expect(p.roll).toBeGreaterThanOrEqual(-0.05);
    // 5.4 * 0.009 = 0.0486 → 最终贴着上限
    expect(p.roll).toBeCloseTo(-0.0486, 3);
  });
});

describe('Player 跳跃与重力', () => {
  const dt = 1 / 60;

  it('grounded 时跳起，空中不能再跳', () => {
    const p = makePlayer();
    const c = makeControls();
    c.jump = true;
    p.update(dt, c, flatTerrain(), []);
    expect(p.grounded).toBe(false);
    // vy 先被设为 jumpSpeed 再被重力扣一帧
    expect(p.vy).toBeCloseTo(TUNING.jumpSpeed - TUNING.gravity * dt, 9);
    expect(p.pos.y).toBeCloseTo((TUNING.jumpSpeed - TUNING.gravity * dt) * dt, 9);

    // 空中再次请求跳跃无效
    c.jump = true;
    p.update(dt, c, flatTerrain(), []);
    expect(p.vy).toBeCloseTo(TUNING.jumpSpeed - TUNING.gravity * dt * 2, 9);
    expect(p.grounded).toBe(false);
  });

  it('重力 21：跳起后按抛物线落地回到 y=0 且 grounded、vy=0', () => {
    const p = makePlayer();
    const c = makeControls();
    c.jump = true;
    p.update(dt, c, flatTerrain(), []);
    let peak = p.pos.y;
    let frames = 1;
    while (!p.grounded && frames < 200) {
      p.update(dt, c, flatTerrain(), []);
      peak = Math.max(peak, p.pos.y);
      frames++;
    }
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBe(0);
    expect(p.vy).toBe(0);
    // 半隐式欧拉：峰值低于解析解 v0²/(2g)≈1.037，且高于一帧位移
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan((TUNING.jumpSpeed * TUNING.jumpSpeed) / (2 * TUNING.gravity));
    // 滞空时间 2*v0/g ≈ 0.63s → 约 38 帧
    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThan(45);
  });

  it('没有 platforms 的 terrain 走平地分支，y 不会为负', () => {
    const p = makePlayer({ y: 3 });
    const c = makeControls();
    for (let i = 0; i < 120; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.pos.y).toBe(0);
    expect(p.grounded).toBe(true);
  });
});

describe('Player 地图边界', () => {
  const dt = 1 / 60;
  it('超出 bounds 被 clamp 到 ±(bounds - 0.55)', () => {
    const bounds = 10;
    const half = bounds - 0.55;
    const c = makeControls();

    const p = makePlayer({ x: 0, z: 0 });
    c.move.x = 1;
    c.move.y = 1; // move.y=+1 → 向 -Z；move.x=+1 → 向 +X
    for (let i = 0; i < 300; i++) p.update(dt, c, flatTerrain(bounds), []);
    expect(p.pos.x).toBeCloseTo(half, 9);
    expect(p.pos.z).toBeCloseTo(-half, 9);

    c.move.x = -1;
    c.move.y = -1;
    for (let i = 0; i < 600; i++) p.update(dt, c, flatTerrain(bounds), []);
    expect(p.pos.x).toBeCloseTo(-half, 9);
    expect(p.pos.z).toBeCloseTo(half, 9);
  });

  it('terrain 缺省时用 TUNING.arenaHalf 作为边界', () => {
    const p = makePlayer({ x: 0, z: 0 });
    const c = makeControls();
    c.move.y = 1; // 向 -Z
    for (let i = 0; i < 600; i++) p.update(dt, c, { platforms: [] }, []);
    expect(p.pos.z).toBeCloseTo(-(TUNING.arenaHalf - 0.55), 9);
  });

  it('x/z 边界彼此独立', () => {
    const p = makePlayer({ x: 0, z: 0 });
    const c = makeControls();
    c.move.x = 1;
    for (let i = 0; i < 200; i++) p.update(dt, c, { bounds: { x: 4, z: 20 } }, []);
    expect(p.pos.x).toBeCloseTo(3.45, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);
  });
});

describe('Player 圆形 collider 推出', () => {
  it('进入 collider 内被推到 r + playerRadius 外', () => {
    const p = makePlayer({ x: 0.1, z: 0 });
    const c = makeControls();
    const terrain = { bounds: { x: 30, z: 30 }, colliders: [{ x: 0, z: 0, r: 1 }] };
    p.update(1 / 60, c, terrain, []);
    const d = Math.hypot(p.pos.x, p.pos.z);
    expect(d).toBeCloseTo(1 + TUNING.playerRadius, 9);
    expect(p.pos.x).toBeGreaterThan(0);
  });

  it('圆心重合（d≈0）时不做无意义推出，不会出现 NaN', () => {
    const p = makePlayer({ x: 0, z: 0 });
    const c = makeControls();
    const terrain = { bounds: { x: 30, z: 30 }, colliders: [{ x: 0, z: 0, r: 1 }] };
    p.update(1 / 60, c, terrain, []);
    expect(Number.isNaN(p.pos.x)).toBe(false);
    expect(Number.isNaN(p.pos.z)).toBe(false);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBe(0);
  });

  it('玩家已在外侧时不推（边界情况：恰好贴边）', () => {
    const p = makePlayer({ x: 1.5, z: 0 });
    const c = makeControls();
    const terrain = { bounds: { x: 30, z: 30 }, colliders: [{ x: 0, z: 0, r: 1 }] };
    p.update(1 / 60, c, terrain, []);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeCloseTo(1.5, 9);
  });

  it('playerColliders 存在时只吃这一组，忽略 colliders', () => {
    const p = makePlayer({ x: 0.1, z: 0 });
    const c = makeControls();
    const near = makePlayer({ x: 0.1, z: 0 });
    near.update(1 / 60, c, { bounds: { x: 30, z: 30 }, colliders: [{ x: 0, z: 0, r: 1 }] }, []);
    p.update(
      1 / 60,
      c,
      { bounds: { x: 30, z: 30 }, colliders: [{ x: 0, z: 0, r: 1 }], playerColliders: [] },
      []
    );
    expect(p.pos.x).toBeCloseTo(0.1, 9);
    expect(near.pos.x).toBeGreaterThan(0.5);
  });
});

describe('Player 平台与踏步', () => {
  const dt = 1 / 60;
  const box = (x, z, w, d, h) => ({ x, z, w, d, h });

  function terrainWith(platforms) {
    return { bounds: { x: 20, z: 20 }, platforms };
  }

  it('supportHeight 只接受 h <= feetY + 0.02 的平台', () => {
    const p = makePlayer({ x: 0, z: 0 });
    const platforms = [box(0, 0, 4, 4, 0.5), box(0, 0, 4, 4, 1.2)];
    // 脚在 0.5 上：0.5 合格；1.2 > 0.52 不合格
    expect(p.supportHeight(platforms, 0, 0, 0.5)).toBeCloseTo(0.5, 12);
    // 脚在 1.2 上：两平台都合格，取最高
    expect(p.supportHeight(platforms, 0, 0, 1.2)).toBeCloseTo(1.2, 12);
    // 恰好在 1.18：1.18 + 0.02 = 1.20 恰好不过 h（h > feetY+0.02 才不通过） → 通过
    expect(p.supportHeight(platforms, 0, 0, 1.18)).toBeCloseTo(1.2, 12);
    // 1.17：1.17+0.02 = 1.19 < 1.2 → 排除
    expect(p.supportHeight(platforms, 0, 0, 1.17)).toBeCloseTo(0.5, 12);
    // 平台外的水平位置得到 0
    expect(p.supportHeight(platforms, 10, 0, 5)).toBe(0);
    // 平面范围含边界（>= / <=）
    expect(p.supportHeight([box(0, 0, 4, 4, 0.5)], 2, 2, 1)).toBeCloseTo(0.5, 12);
    expect(p.supportHeight([box(0, 0, 4, 4, 0.5)], 2.0001, 0, 1)).toBe(0);
  });

  it('STEP_HEIGHT=0.42 内自动踏上平台', () => {
    const p = makePlayer({ x: 0, z: 0, y: 0 });
    p.grounded = true;
    // 0.4 米台的边缘：玩家左缘贴到平台边缘即被托起
    const platforms = [box(1.5, 0, 3, 3, 0.4)];
    p.pos.set(0.05, 0, 0); // 距平台左边缘 0.05 米，已进入
    const c = makeControls();
    p.update(dt, c, terrainWith(platforms), []);
    expect(p.pos.y).toBeCloseTo(0.4, 9);
    expect(p.grounded).toBe(true);
  });

  it('恰好 STEP_HEIGHT（0.42）能踏上去，0.43 不能', () => {
    const c = makeControls();
    // 0.42：可踏（并且 aboveTop 判定会推出去，所以一开始就要站在平台顶面之上）
    const ok = makePlayer({ x: 0, z: 0, y: 0 });
    ok.grounded = true;
    ok.pos.set(1.2, 0, 0);
    ok.update(dt, c, terrainWith([box(0, 0, 4, 4, 0.42)]), []);
    expect(ok.pos.y).toBeCloseTo(0.42, 9);

    const high = makePlayer({ x: 0, z: 0, y: 0 });
    high.grounded = true;
    high.pos.set(1.2, 0, 0);
    high.update(dt, c, terrainWith([box(0, 0, 4, 4, 0.43)]), []);
    expect(high.pos.y).toBe(0);
    // 被推出平台（0.43 - 0 <= 0.42 但 canStep 需要 grounded && h-y<=0.42；
    // 0.43 > 0.42 → canStep=false，aboveTop=false → 推开）
    expect(high.pos.x).toBeGreaterThanOrEqual(2 + TUNING.playerRadius - 1e-9);
  });

  it('更高平台走 pushOutOfPlatforms：分轴取最小穿透方向', () => {
    const c = makeControls();
    // 平台 4x6，玩家站在 z 方向靠近中心、x 方向更靠外侧 → 应沿 x 推出
    const p = makePlayer({ x: 1.9, z: 0, y: 0 });
    const platforms = [box(0, 0, 4, 6, 2)];
    p.update(dt, c, terrainWith(platforms), []);
    // hw = 2 + r = 2.42；dx=1.9 → px = 0.52；hd = 3 + r = 3.42；dz=0 → pz = 3.42
    expect(p.pos.x).toBeCloseTo(2 + TUNING.playerRadius, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);

    // 反过来：z 方向穿透更小 → 沿 z 推出
    const q = makePlayer({ x: 0, z: 2.9, y: 0 });
    q.update(dt, c, terrainWith(platforms), []);
    expect(q.pos.z).toBeCloseTo(3 + TUNING.playerRadius, 9);
    expect(q.pos.x).toBeCloseTo(0, 9);

    // 从另一侧进入时朝负方向推
    const r = makePlayer({ x: -1.9, z: 0, y: 0 });
    r.update(dt, c, terrainWith(platforms), []);
    expect(r.pos.x).toBeCloseTo(-(2 + TUNING.playerRadius), 9);
  });

  it('已经在平台顶面之上（y >= h-0.02）不会被推出', () => {
    const c = makeControls();
    const p = makePlayer({ x: 0, z: 0, y: 2 });
    p.update(dt, c, terrainWith([box(0, 0, 4, 4, 2)]), []);
    expect(p.pos.x).toBeCloseTo(0, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);
    expect(p.pos.y).toBeCloseTo(2, 9);
    expect(p.grounded).toBe(true);
  });

  it('站在平台上不会掉下去；走出边缘后下落回 0', () => {
    const c = makeControls();
    const platforms = [box(0, 0, 2, 2, 1)];
    const p = makePlayer({ x: 0, z: 0, y: 1 });
    // 先静止站 30 帧
    for (let i = 0; i < 30; i++) p.update(dt, c, terrainWith(platforms), []);
    expect(p.pos.y).toBeCloseTo(1, 9);
    expect(p.grounded).toBe(true);

    // 向 +X 走离开平台（平台半边 1 米）
    c.move.x = 1;
    let leftAt = -1;
    for (let i = 0; i < 120; i++) {
      p.update(dt, c, terrainWith(platforms), []);
      if (!p.grounded && leftAt < 0) leftAt = i;
    }
    expect(leftAt).toBeGreaterThan(0);
    expect(p.pos.x).toBeGreaterThan(1);
    expect(p.pos.y).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('有 platforms 时也能在地面起跳落地', () => {
    const c = makeControls();
    const p = makePlayer({ x: 0, z: 0, y: 0 });
    const platforms = [box(0, 0, 2, 2, 1)];
    // 站到平台上
    p.pos.set(0, 1, 0);
    p.update(dt, c, terrainWith(platforms), []);
    c.jump = true;
    p.update(dt, c, terrainWith(platforms), []);
    expect(p.grounded).toBe(false);
    expect(p.pos.y).toBeGreaterThan(1);
    c.jump = false;
    let frames = 0;
    while (!p.grounded && frames < 200) {
      p.update(dt, c, terrainWith(platforms), []);
      frames++;
    }
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBeCloseTo(1, 9);
  });

  it('贴到平台侧面且高于 STEP_HEIGHT 时被挡在平台外（不能穿墙）', () => {
    const c = makeControls();
    const platforms = [box(4, 0, 2, 2, 1.2)];
    const p = makePlayer({ x: 0, z: 0, y: 0 });
    c.move.x = 1;
    for (let i = 0; i < 200; i++) p.update(dt, c, terrainWith(platforms), []);
    expect(p.pos.x).toBeCloseTo(4 - 1 - TUNING.playerRadius, 9);
    expect(p.pos.y).toBe(0);
  });
});

describe('Player 与僵尸碰撞', () => {
  const dt = 1 / 60;
  const zombie = (x, z, radius = 0.46, scaleFactor = 1, extra = {}) => ({
    root: { position: new THREE.Vector3(x, 0, z) },
    radius,
    scaleFactor,
    dying: false,
    dead: false,
    ...extra,
  });

  it('活僵尸把玩家推出到 radius + playerRadius 以外（每帧 85%）', () => {
    const p = makePlayer({ x: 0.5, z: 0 });
    const z = zombie(0, 0);
    // z.radius 已是世界空间半径，不再乘 scaleFactor —— 二次缩放曾让 Boss 的推离半径
    // （0.9×2.3+0.42=2.49 米）大于它自己的攻击距离（1.15+2.3×0.55=2.415），巨人僵尸永远咬不到人。
    const min = z.radius + TUNING.playerRadius;
    p.update(dt, makeControls(), flatTerrain(), [z]);
    const d = Math.hypot(p.pos.x, p.pos.z);
    // 推出量只走 85%：d' = d + (min - d) * 0.85
    expect(d).toBeCloseTo(0.5 + (min - 0.5) * 0.85, 9);
    expect(d).toBeLessThan(min);
  });

  it('多帧后玩家被稳定推到最小距离之外', () => {
    const p = makePlayer({ x: 0.5, z: 0 });
    const z = zombie(0, 0);
    const min = z.radius + TUNING.playerRadius;
    for (let i = 0; i < 60; i++) p.update(dt, makeControls(), flatTerrain(), [z]);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(min - 1e-9);
  });

  it('推离半径必须小于 Boss 的攻击距离（radius 不再乘 scaleFactor）', () => {
    const p = makePlayer({ x: 1, z: 0 });
    const z = zombie(0, 0, 0.9, 1.85);
    const min = 0.9 + TUNING.playerRadius;
    p.update(dt, makeControls(), flatTerrain(), [z]);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeCloseTo(1 + (min - 1) * 0.85, 9);
    // 回归底线：推离半径不得把玩家顶出 Boss 的攻击范围（1.15 + scale×0.55）
    expect(min).toBeLessThan(1.15 + z.scaleFactor * 0.55);
  });

  it('dying / dead 僵尸不参与推出', () => {
    for (const flag of ['dying', 'dead']) {
      const p = makePlayer({ x: 0.1, z: 0 });
      p.update(dt, makeControls(), flatTerrain(), [zombie(0, 0, 0.46, 1, { [flag]: true })]);
      expect(p.pos.x).toBeCloseTo(0.1, 9);
    }
  });

  it('僵尸数组缺省/空不影响移动', () => {
    const p = makePlayer({ x: 0, z: 0 });
    const c = makeControls();
    c.move.x = 1;
    p.update(dt, c, flatTerrain(), []);
    expect(p.pos.x).toBeGreaterThan(0);
  });
});

describe('Player 伤害 / 回血 / 死亡', () => {
  const dt = 1 / 60;

  it('damage 扣血并进入 0.32s 无敌帧', () => {
    const p = makePlayer();
    const onDamage = vi.fn();
    p.onDamage = onDamage;
    expect(p.damage(10)).toBe(true);
    expect(p.hp).toBe(90);
    expect(p.invuln).toBe(0.32);
    expect(p.sinceDamage).toBe(0);
    expect(onDamage).toHaveBeenCalledWith(10);

    expect(p.damage(10)).toBe(false);
    expect(p.hp).toBe(90);
    expect(onDamage).toHaveBeenCalledTimes(1);
  });

  it('无敌帧在 update 中按 dt 递减，0.32s 后可再次受伤', () => {
    const p = makePlayer();
    const c = makeControls();
    p.damage(10);
    // 0.3s → 还剩 0.02
    for (let i = 0; i < 18; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.invuln).toBeCloseTo(0.32 - 18 * dt, 9);
    expect(p.invuln).toBeGreaterThan(0);
    expect(p.damage(5)).toBe(false);
    for (let i = 0; i < 2; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.invuln).toBe(0);
    expect(p.damage(5)).toBe(true);
    expect(p.hp).toBe(85);
  });

  it('hp 归零时夹到 0、dead=true，onDeath 只触发一次', () => {
    const p = makePlayer();
    const onDeath = vi.fn();
    p.onDeath = onDeath;
    p.damage(60);
    p.update(1, makeControls(), flatTerrain(), []); // 清掉无敌帧
    expect(p.damage(60)).toBe(true);
    expect(p.hp).toBe(0);
    expect(p.dead).toBe(true);
    expect(onDeath).toHaveBeenCalledTimes(1);
    expect(p.damage(10)).toBe(false);
    expect(onDeath).toHaveBeenCalledTimes(1);
    expect(p.hp).toBe(0);
  });

  it('死亡后 update 直接返回，不再处理移动/回血/无敌帧', () => {
    const p = makePlayer();
    p.damage(999);
    expect(p.dead).toBe(true);
    const hpBefore = p.hp;
    const posBefore = p.pos.clone();
    const c = makeControls();
    c.move.x = 1;
    c.look.x = 1;
    for (let i = 0; i < 600; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.hp).toBe(hpBefore);
    expect(p.pos.equals(posBefore)).toBe(true);
    expect(p.invuln).toBe(0.32);
    expect(p.yaw).toBe(0);
    expect(c.look.x).toBe(1); // 没有被 consume
  });

  it('heal 不超过 maxHp', () => {
    const p = makePlayer();
    p.damage(40);
    p.heal(10);
    expect(p.hp).toBe(70);
    p.heal(1000);
    expect(p.hp).toBe(p.maxHp);
  });

  it('regenDelay 7s 内不回血，之后按 regenRate 9/s 回血直到满', () => {
    const p = makePlayer();
    const c = makeControls();
    p.damage(50);
    expect(p.hp).toBe(50);
    // 推进 6.9 秒：仍在 regenDelay 内
    let t = 0;
    while (t + dt < TUNING.regenDelay - 0.2) {
      p.update(dt, c, flatTerrain(), []);
      t += dt;
    }
    expect(p.hp).toBe(50);
    // 越过 7s 后再走 1 秒，约回 9 点
    for (let i = 0; i < 60; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.hp).toBeGreaterThan(55);
    expect(p.hp).toBeLessThan(60);
    // 再走很久回满
    for (let i = 0; i < 600; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.hp).toBe(p.maxHp);
  });

  it('满血时 sinceDamage 仍累加，但不会溢出超过 maxHp', () => {
    const p = makePlayer();
    const c = makeControls();
    for (let i = 0; i < 900; i++) p.update(dt, c, flatTerrain(), []);
    expect(p.hp).toBe(p.maxHp);
    expect(p.sinceDamage).toBeGreaterThan(TUNING.regenDelay);
  });
});

describe('Player applyCamera', () => {
  it('相机位置 = 眼睛位置，rotation 依次为 pitch+recoil / yaw / roll', () => {
    const p = makePlayer({ x: 2, z: -3 });
    p.yaw = 0.4;
    p.pitch = 0.2;
    p.roll = 0.01;
    p.recoil = 0.05;
    p.grounded = true;
    p.moveAmt = 0;
    p.bob = 0;
    p.eye.set(p.pos.x, p.pos.y + TUNING.playerHeight, p.pos.z);
    const cam = new THREE.PerspectiveCamera();
    cam.rotation.order = 'YXZ';
    p.applyCamera(cam);
    expect(cam.position.x).toBeCloseTo(2, 12);
    expect(cam.position.y).toBeCloseTo(TUNING.playerHeight, 12);
    expect(cam.position.z).toBeCloseTo(-3, 12);
    expect(cam.rotation.order).toBe('YXZ');
    expect(cam.rotation.x).toBeCloseTo(0.25, 12);
    expect(cam.rotation.y).toBeCloseTo(0.4, 12);
    expect(cam.rotation.z).toBeCloseTo(0.01, 12);
  });

  it('走路时的 sway 只影响相机的 x/z，不影响 y；静止时无 sway', () => {
    const p = makePlayer();
    p.bob = Math.PI / 2;
    p.moveAmt = 1;
    p.grounded = true;
    p.yaw = 0;
    p.eye.set(0, TUNING.playerHeight, 0);
    const cam = new THREE.PerspectiveCamera();
    p.applyCamera(cam);
    // sway = sin(π/2)*0.03*1 = 0.03；x += cos(0)*0.03, z -= sin(0)*0.03
    expect(cam.position.x).toBeCloseTo(0.03, 12);
    expect(cam.position.y).toBeCloseTo(TUNING.playerHeight, 12);
    expect(cam.position.z).toBeCloseTo(0, 12);

    p.moveAmt = 0;
    p.applyCamera(cam);
    expect(cam.position.x).toBeCloseTo(0, 12);
  });

  it('yaw 旋转视角时 sway 方向随之旋转', () => {
    const p = makePlayer();
    p.bob = Math.PI / 2;
    p.moveAmt = 1;
    p.grounded = true;
    p.yaw = Math.PI / 2;
    p.eye.set(0, TUNING.playerHeight, 0);
    const cam = new THREE.PerspectiveCamera();
    p.applyCamera(cam);
    // x += cos(π/2)*0.03 ≈ 0；z -= sin(π/2)*0.03 = -0.03
    expect(cam.position.x).toBeCloseTo(0, 12);
    expect(cam.position.z).toBeCloseTo(-0.03, 12);
  });

  it('recoil 每帧按 e^{-9dt} 指数衰减，addRecoil 上限 0.22', () => {
    const p = makePlayer();
    const c = makeControls();
    p.recoil = 0.1;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.recoil).toBeCloseTo(0.1 * Math.exp(-9 / 60), 9);
    p.addRecoil(0.1);
    expect(p.recoil).toBeCloseTo(0.1 * Math.exp(-0.15) + 0.1, 9);
    p.addRecoil(1);
    expect(p.recoil).toBe(0.22);
    p.addRecoil(0.5);
    expect(p.recoil).toBe(0.22);
  });
});

describe('Player 脚步音效节流', () => {
  const dt = 1 / 60;

  it('走路时按 stepTimer 节流触发 sfx.step 与 bob 累加', () => {
    const sfx = makeSfx();
    const p = makePlayer({ sfx });
    const c = makeControls();
    c.move.y = 1;
    // 加速到 >0.4 需要几帧
    let framesToFirstStep = null;
    for (let i = 0; i < 240; i++) {
      p.update(dt, c, flatTerrain(), []);
      if (framesToFirstStep === null && sfx.step.mock.calls.length > 0) framesToFirstStep = i;
    }
    expect(framesToFirstStep).not.toBeNull();
    expect(sfx.step.mock.calls.length).toBeGreaterThan(2);
    // 间隔在 0.3~0.5s 之间（20~30 帧），4 秒内约 8~13 次
    expect(sfx.step.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(sfx.step.mock.calls.length).toBeLessThanOrEqual(14);
    expect(p.bob).toBeGreaterThan(0);
  });

  it('stepTimer 重置值 = clamp(0.46 - speed*0.012, 0.3, 0.5)', () => {
    const sfx = makeSfx();
    const p = makePlayer({ sfx });
    const c = makeControls();
    c.move.y = 1;
    for (let i = 0; i < 120; i++) p.update(dt, c, flatTerrain(), []);
    expect(sfx.step.mock.calls.length).toBeGreaterThan(0);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    expect(speed).toBeCloseTo(TUNING.playerSpeed, 2);
    // 满速 5.4 → 重置间隔 0.46 - 0.0648 = 0.3952；之后每帧再减 dt
    const interval = 0.46 - speed * 0.012;
    expect(interval).toBeCloseTo(0.3952, 3);
    expect(p.stepTimer).toBeGreaterThan(0);
    expect(p.stepTimer).toBeLessThanOrEqual(interval + 1e-9);
    // 两次踩步之间的帧数 = 1 + ceil(interval / dt)
    const calls = sfx.step.mock.calls.length;
    const expectedCalls = Math.floor((120 - 1) / (1 + Math.ceil(0.3952 / dt)));
    expect(calls).toBeGreaterThanOrEqual(expectedCalls - 1);
    expect(calls).toBeLessThanOrEqual(expectedCalls + 1);
  });

  it('静止时把 stepTimer 复位到 0.15 且不发声', () => {
    const sfx = makeSfx();
    const p = makePlayer({ sfx });
    const c = makeControls();
    p.stepTimer = 0;
    p.update(dt, c, flatTerrain(), []);
    expect(p.stepTimer).toBe(0.15);
    expect(sfx.step).not.toHaveBeenCalled();
  });

  it('空中不发声、bob 不累加', () => {
    const sfx = makeSfx();
    const p = makePlayer({ sfx });
    const c = makeControls();
    c.jump = true;
    c.move.y = 1;
    p.update(dt, c, flatTerrain(), []);
    expect(p.grounded).toBe(false);
    for (let i = 0; i < 10; i++) p.update(dt, c, flatTerrain(), []);
    expect(sfx.step).not.toHaveBeenCalled();
    expect(p.bob).toBe(0);
  });

  it('sfx 缺省（或没有 step）时不抛错', () => {
    const p = new Player(null);
    const c = makeControls();
    c.move.y = 1;
    expect(() => {
      for (let i = 0; i < 60; i++) p.update(dt, c, flatTerrain(), []);
    }).not.toThrow();
    expect(p.grounded).toBe(true);
  });

  it('走路时眼睛高度叠加 bob', () => {
    const p = makePlayer();
    const c = makeControls();
    c.move.y = 1;
    for (let i = 0; i < 30; i++) p.update(dt, c, flatTerrain(), []);
    const bobY = Math.abs(Math.sin(p.bob)) * 0.045 * p.moveAmt;
    expect(p.eye.y).toBeCloseTo(p.pos.y + TUNING.playerHeight + bobY, 12);
    expect(p.eye.y).toBeGreaterThanOrEqual(TUNING.playerHeight);
    expect(p.eye.y).toBeLessThanOrEqual(TUNING.playerHeight + 0.045 + 1e-9);
    expect(p.eye.x).toBeCloseTo(p.pos.x, 12);
    expect(p.eye.z).toBeCloseTo(p.pos.z, 12);
  });
});
describe('lastInput（双人 input 协议）', () => {
  it('记录每帧 move/look/jump，jump 只在真正起跳时为 true', () => {
    const p = makePlayer();
    const c = makeControls();
    c.move.x = 1;
    c.look.x = 0.1;
    c.look.y = -0.2;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.lastInput.move.x).toBe(1);
    expect(p.lastInput.move.y).toBe(0);
    expect(p.lastInput.look).toEqual({ x: 0.1, y: -0.2 });
    expect(p.lastInput.jump).toBe(false);

    c.jump = true;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.lastInput.jump).toBe(true);
  });
});

describe('duoDown 倒地', () => {
  it('HP 归零倒地、镜头压低、revive 半血', () => {
    const p = makePlayer();
    p.duoDown = true;
    p.hp = 5;
    p.damage(10);
    expect(p.downed).toBe(true);
    expect(p.dead).toBe(false);
    expect(p.downTimer).toBe(30);
    const c = makeControls();
    c.look.x = 0.1;
    p.update(1 / 60, c, flatTerrain(), []);
    expect(p.eye.y).toBeCloseTo(p.pos.y + 0.55);
    p.revive();
    expect(p.downed).toBe(false);
    expect(p.hp).toBe(50);
    expect(p.invuln).toBe(3);
  });
});
