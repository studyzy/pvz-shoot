// HitWalls：投掷物挡板扫掠 + 反弹。纯几何函数，不需要 Game。
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { bounceVel, sweepWalls } from '../../src/weapons/HitWalls.js';

const REST_N = 0.4;
const REST_T = 0.95;
const MIN_SPEED = 2.5;

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
// sign * 0 会产生 -0：断言法线时把 ±0 归一，只比较真正的方向。
const noNegZero = (v) => ({
  x: v.x === 0 ? 0 : v.x,
  y: v.y === 0 ? 0 : v.y,
  z: v.z === 0 ? 0 : v.z,
});
const expectNormal = (out, e) => expect(noNegZero(out)).toEqual(e);
// 轴对齐 / 旋转盒墙：w = { x,y,z 中心, hx,hy,hz 半尺寸, c,s 绕 Y 旋转 }
const box = (x, y, z, hx, hy, hz, yaw = 0) => ({ x, y, z, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw) });
const cyl = (x, z, r, h = 4) => ({ x, z, r, h });

describe('bounceVel', () => {
  it('正入射只保留法向 40%（REST_N）并反向', () => {
    const v = new Vector3(0, 0, -10);
    bounceVel(v, 0, 0, 1);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(0, 10);
    expect(v.z).toBeCloseTo(-10 * REST_N, 10); // 弹回 -Z 侧
  });

  it('切向保留 85%（REST_T），法向分量被 40% 衰减', () => {
    const v = new Vector3(10, 0, -10);
    bounceVel(v, 0, 0, 1);
    expect(v.x).toBeCloseTo(10 * REST_T, 10); // 9.5
    expect(v.z).toBeCloseTo(-10 * REST_N, 10); // -4
  });

  it('完全切向（vn=0）只吃切向衰减', () => {
    const v = new Vector3(0, 0, -8);
    bounceVel(v, 1, 0, 0);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.z).toBeCloseTo(-8 * REST_T, 10);
  });

  it('|vn| < 2.5 时法向直接归零（不反弹），切向仍保留 85%', () => {
    const v = new Vector3(3, 0, -2);
    bounceVel(v, 0, 0, 1);
    expect(v.z).toBeCloseTo(0, 12);
    expect(v.x).toBeCloseTo(3 * REST_T, 12);
  });

  it('|vn| 恰为 2.5 不算小速度，仍按 40% 反弹', () => {
    const v = new Vector3(0, 0, -MIN_SPEED);
    bounceVel(v, 0, 0, 1);
    expect(v.z).toBeCloseTo(-MIN_SPEED * REST_N, 10); // -1
  });

  it('法向速度刚低于 2.5 就归零而不是被衰减', () => {
    const v = new Vector3(0, 0, -(MIN_SPEED - 1e-6));
    bounceVel(v, 0, 0, 1);
    expect(v.z).toBe(0);
  });

  it('斜向入射按 n / t 分解：vn=-10√2 且无切向', () => {
    const k = Math.SQRT1_2;
    const v = new Vector3(-10 * k, 0, -10 * k);
    bounceVel(v, k, 0, k);
    // 法向反向、切向衰减：v 只是按 REST_N 缩小并翻到 n 的正方向
    expect(v.x).toBeCloseTo(-10 * k * REST_N, 10);
    expect(v.z).toBeCloseTo(-10 * k * REST_N, 10);
  });

  it('Y 法线（地面 / 天花板）同样适用', () => {
    const v = new Vector3(1, -6, 0);
    bounceVel(v, 0, -1, 0);
    expect(v.y).toBeCloseTo(-6 * REST_N, 10);
    expect(v.x).toBeCloseTo(1 * REST_T, 10);
  });

  it('原地修改传入向量，不返回新对象', () => {
    const v = new Vector3(0, 0, -5);
    expect(bounceVel(v, 0, 0, 1)).toBeUndefined();
    expect(v.z).toBeCloseTo(-2, 10);
  });
});

describe('sweepWalls / 圆柱挡板', () => {
  it('水平射线正面撞圆柱：命中 t 与朝外法线', () => {
    const out = vec();
    const t = sweepWalls([cyl(0, 0, 1)], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.2, out);
    // 起点 z=5，半径和 1.2，首次接触 z=1.2
    expect(t).toBeCloseTo((5 - 1.2) / 10, 6);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(1, 9); // 指向起点一侧
  });

  it('斜向擦过圆柱：法线是撞击点的径向单位向量', () => {
    const out = vec();
    const r = 0.5;
    const t = sweepWalls([cyl(0, 0, 1)], 23, 23, vec(-3, 1, 0.6), vec(3, 1, 0.6), r, out);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    const px = -3 + 6 * t;
    const pz = 0.6;
    const d = Math.hypot(px, pz);
    expect(out.x).toBeCloseTo(px / d, 9);
    expect(out.z).toBeCloseTo(pz / d, 9);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 9);
  });

  it('高于圆柱顶（> h + r）不会命中', () => {
    const out = vec();
    const t = sweepWalls([cyl(0, 0, 1, 2)], 23, 23, vec(0, 5, 5), vec(0, 5, -5), 0.2, out);
    expect(t).toBe(-1);
  });

  it('恰好在 h + r 高度仍算命中（边界包含）', () => {
    const out = vec();
    const t = sweepWalls([cyl(0, 0, 1, 2)], 23, 23, vec(0, 2.2, 5), vec(0, 2.2, -5), 0.2, out);
    expect(t).toBeCloseTo(0.38, 6);
  });

  it('零长度线段：已在圆柱内返回 0，在外返回 -1', () => {
    const out = vec();
    expect(sweepWalls([cyl(0, 0, 1)], 23, 23, vec(0, 1, 0.5), vec(0, 1, 0.5), 0.2, out)).toBe(0);
    expect(sweepWalls([cyl(0, 0, 1)], 23, 23, vec(0, 1, 3), vec(0, 1, 3), 0.2, out)).toBe(-1);
  });

  it('起点在圆柱内、线段尚未离开：两个根都 < 0，返回 -1（圆柱分支只在入口穿过时才给 t）', () => {
    const out = vec();
    expect(sweepWalls([cyl(0, 0, 1)], 23, 23, vec(0, 1, 0), vec(0, 1, -0.5), 0.2, out)).toBe(-1);
  });

  it('径向精确穿过圆心：d≈0 时不写法线（不会被后续围栏用旧值污染）', () => {
    const out = vec(9, 9, 9);
    // 圆柱中心与线段共线：命中点减去圆心 = (0,*,0)，d<EPS 被跳过，不写法线
    const t = sweepWalls([cyl(1, 1, 1)], 23, 23, vec(1, 1, 5), vec(1, 1, -2), 0, out);
    expect(t).toBeCloseTo(3 / 7, 9);
    // 围栏兜底检查用的是原点 a：a.z=5 早就越界，于是法线被围栏覆盖成 +Z
    expectNormal(out, { x: 0, y: 0, z: 1 });
  });
});

describe('sweepWalls / 轴对齐盒', () => {
  const w = box(0, 1, 0, 1, 0.5, 1); // 中心(0,1,0)，半尺寸 1 x 0.5 x 1

  it('+Z 面命中：t 与法线 (0,0,1)', () => {
    const out = vec();
    const t = sweepWalls([w], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, out);
    expect(t).toBeCloseTo((5 - 1.1) / 10, 6);
    expectNormal(out, { x: 0, y: 0, z: 1 });
  });

  it('-Z 面命中：法线 (0,0,-1)', () => {
    const out = vec();
    sweepWalls([w], 23, 23, vec(0, 1, -5), vec(0, 1, 5), 0.1, out);
    expectNormal(out, { x: 0, y: 0, z: -1 });
  });

  it('+X 面命中：t 与法线 (1,0,0)', () => {
    const out = vec();
    const t = sweepWalls([w], 23, 23, vec(5, 1, 0), vec(-5, 1, 0), 0.1, out);
    expect(t).toBeCloseTo((5 - 1.1) / 10, 6);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('-X 面命中：法线 (-1,0,0)', () => {
    const out = vec();
    sweepWalls([w], 23, 23, vec(-5, 1, 0), vec(5, 1, 0), 0.1, out);
    expectNormal(out, { x: -1, y: 0, z: 0 });
  });

  it('顶面命中：法线 (0,1,0)', () => {
    const out = vec();
    const t = sweepWalls([w], 23, 23, vec(0, 5, 0), vec(0, -10, 0), 0.1, out);
    // 盒顶 1.5 + 球半径 0.1 = 1.6，从 y=5 出发
    expect(t).toBeCloseTo(3.4 / 15, 9);
    expectNormal(out, { x: 0, y: 1, z: 0 });
  });

  it('底面命中：法线 (0,-1,0)', () => {
    const out = vec();
    sweepWalls([w], 23, 23, vec(0, -5, 0), vec(0, 5, 0), 0.1, out);
    expectNormal(out, { x: 0, y: -1, z: 0 });
  });

  it('球半径计入外扩：r 越大越早接触', () => {
    const out1 = vec();
    const out2 = vec();
    const t1 = sweepWalls([w], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, out1);
    const t2 = sweepWalls([w], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.5, out2);
    expect(t1).toBeCloseTo(0.39, 6);
    expect(t2).toBeCloseTo(0.35, 6);
    expect(t2).toBeLessThan(t1);
  });

  it('平行掠过（该轴速度为 0 且已在体外）不命中', () => {
    const out = vec();
    expect(sweepWalls([w], 23, 23, vec(5, 3, 0), vec(-5, 3, 0), 0.1, out)).toBe(-1);
    expect(sweepWalls([w], 23, 23, vec(5, 1, 2), vec(-5, 1, 2), 0.1, out)).toBe(-1);
  });

  it('平行且贴着盒面内（该轴速度为 0 但未越界）仍可命中', () => {
    const out = vec();
    const t = sweepWalls([w], 23, 23, vec(5, 1.55, 0), vec(-5, 1.55, 0), 0.1, out);
    expect(t).toBeCloseTo(0.39, 6);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('起点已在盒内（外扩 r 内）返回 0', () => {
    const out = vec();
    expect(sweepWalls([w], 23, 23, vec(0, 1, 0), vec(0, 1, -3), 0.1, out)).toBe(0);
    expect(sweepWalls([w], 23, 23, vec(0, 1, 1.05), vec(0, 1, 3), 0.1, out)).toBe(0);
  });

  it('起点在盒内往外走：t=0，法线取「最后一个离盒」的轴', () => {
    const out = vec();
    // 从盒心朝 +Z 走，速度越快离盒越早：tExit 最小的轴反而最先出去，
    // 所以 sign 由最后更新 axis 的轴决定 —— 这里 Z 轴最快离开，法线落到 -Z 面。
    const t = sweepWalls([w], 23, 23, vec(0, 1, 0), vec(0, 1, 5), 0.1, out);
    expect(t).toBe(0);
    expectNormal(out, { x: 0, y: 0, z: -1 });
  });
});

describe('sweepWalls / 旋转盒', () => {
  // 局部轴到世界的映射：局部 +X = (c, 0, -s)，局部 +Z = (s, 0, c)。
  // c/s 由调用方直接给出，可以直接摆出任意朝向，断言才精确。
  it('绕 Y 转 90°（c=0,s=1）：从 -Z 侧撞到局部 X 面，法线 (0,0,-1)', () => {
    const rotated = { x: 0, y: 1, z: 0, hx: 2, hy: 0.5, hz: 0.25, c: 0, s: 1 };
    const out = vec();
    const t = sweepWalls([rotated], 23, 23, vec(0, 1, -5), vec(0, 1, 5), 0, out);
    // 局部 X 轴指向世界 -Z，厚度由 hx 决定：首次接触 z = -(2)
    expect(t).toBeCloseTo((5 - 2) / 10, 9);
    expectNormal(out, { x: 0, y: 0, z: -1 });
  });

  it('绕 Y 转 90°：从 +Z 侧撞，法线 (0,0,1)', () => {
    const rotated = { x: 0, y: 1, z: 0, hx: 2, hy: 0.5, hz: 0.25, c: 0, s: 1 };
    const out = vec();
    sweepWalls([rotated], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0, out);
    expectNormal(out, { x: 0, y: 0, z: 1 });
  });

  it('绕 Y 转 90°：从 +X 侧撞到局部 Z 面，法线 (1,0,0)', () => {
    const rotated = { x: 0, y: 1, z: 0, hx: 2, hy: 0.5, hz: 0.25, c: 0, s: 1 };
    const out = vec();
    const t = sweepWalls([rotated], 23, 23, vec(5, 1, 0), vec(-5, 1, 0), 0, out);
    // 局部 Z 轴指向世界 +X，厚度由 hz 决定：首次接触 x = 0.25
    expect(t).toBeCloseTo((5 - 0.25) / 10, 9);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('45° 旋转（c=s=√½）：沿世界 +X 射线擦入，法线为 (±c, 0, ±s)', () => {
    const k = Math.SQRT1_2;
    const w2 = { x: 0, y: 1, z: 0, hx: 1, hy: 0.5, hz: 1, c: k, s: k };
    const out = vec();
    const t = sweepWalls([w2], 23, 23, vec(5, 1, 0), vec(-5, 1, 0), 0, out);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    expect(out.x).toBeCloseTo(k, 9);
    expect(out.z).toBeCloseTo(-k, 9);
    expect(out.y).toBe(0);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 9);
  });

  it('45° 旋转：沿世界 +Z 射线擦入，法线为 (±s, 0, ±c)', () => {
    const k = Math.SQRT1_2;
    const w2 = { x: 0, y: 1, z: 0, hx: 1, hy: 0.5, hz: 1, c: k, s: k };
    const out = vec();
    sweepWalls([w2], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0, out);
    expect(out.x).toBeCloseTo(-k, 9);
    expect(out.z).toBeCloseTo(k, 9);
  });

  it('旋转盒的球外扩在局部 Y 轴上同样生效', () => {
    const w2 = { x: 0, y: 1, z: 0, hx: 1, hy: 0.5, hz: 1, c: Math.cos(Math.PI / 6), s: Math.sin(Math.PI / 6) };
    const out = vec();
    const t = sweepWalls([w2], 23, 23, vec(0, 5, 0), vec(0, -10, 0), 0.2, out);
    // 盒顶 1.5 + 0.2 = 1.7，从 y=5 出发，t=(5-1.7)/15
    expect(t).toBeCloseTo(3.3 / 15, 9);
    expectNormal(out, { x: 0, y: 1, z: 0 });
  });

  // 回归：d[k] === 0 的轴曾算出 [-Infinity, +Infinity]，污染 enter/exit 的比较，
  // 让整个盒子无条件命中 —— 后院割草机（0.52 rad）周围因此出现一堵看不见的墙，
  // 投掷物在离地 4 米、「离割草机 17 米」的地方就报撞墙，西瓜在墙根提前炸。
  it('起点在外、盒子在身后的斜向短线段不会误判命中', () => {
    const out = vec();
    // 从 (2, 1, 0) 朝 -X 飞：盒子在身后，整段都不相交
    expect(sweepWalls([box(0, 1, 0, 1, 1, 1)], 100, 100, vec(2, 1, 0), vec(1.2, 1.1, 0.05), 0.13, out)).toBe(-1);
  });

  it('起点在盒面外侧 0.01 米、朝远离盒子的方向发射：t < 0，判定不命中', () => {
    const out = vec();
    // 外扩面在 x = 1 + 0.13，起点 1.14 刚好压在上面，朝 +X 走
    const t = sweepWalls([box(0, 1, 0, 1, 1, 1)], 100, 100, vec(1.14, 1, 0.5), vec(3, 1, 0.5), 0.13, out);
    expect(t).toBeLessThan(0);
  });

  it('x/z 方向都不移动的竖直下落不会命中远处的旋转盒', () => {
    const yaw = 0.5236;
    const mower = { x: 0, y: 0.36, z: 5, hx: 0.45, hy: 0.36, hz: 0.3, c: Math.cos(yaw), s: Math.sin(yaw) };
    const out = vec();
    // 水平离盒心 17 米、从 5 米高竖直落下来：三条轴里有两条全程出界
    expect(sweepWalls([mower], 100, 100, vec(0, 5, -12), vec(0, 4, -12), 0.17, out)).toBe(-1);
    // 沿 -Z 飞过来但在盒子上方 3 米：同样不中
    expect(sweepWalls([mower], 100, 100, vec(0, 4, 12), vec(0, 4, -12), 0.17, out)).toBe(-1);
  });

  it('只有一个轴不移动时仍按真实几何判定：正上方命中、侧面掠过不中', () => {
    const yaw = 0.5236;
    const mower = { x: 0, y: 0.36, z: 5, hx: 0.45, hy: 0.36, hz: 0.3, c: Math.cos(yaw), s: Math.sin(yaw) };
    const out = vec();
    // 只沿 Y 下落、水平位置正好在盒顶上方（盒顶 0.72 + 球 0.17）：命中
    expect(sweepWalls([mower], 100, 100, vec(0, 2, 5), vec(0, 0.8, 5), 0.17, out)).toBeGreaterThanOrEqual(0);
    // 只沿 Z 移动、但高度在盒子上方 3 米：不中
    expect(sweepWalls([mower], 100, 100, vec(-2, 4, 8), vec(-2, 4, 2), 0.17, out)).toBe(-1);
  });
});

describe('sweepWalls / 外圈兜底与多墙', () => {
  it('没有地图墙时用 halfX/halfZ 围栏拦住（+X 侧）', () => {
    const out = vec();
    const t = sweepWalls([], 10, 10, vec(0, 1, 0), vec(30, 1, 0), 0.5, out);
    expect(t).toBeCloseTo(9.5 / 30, 9);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('没有地图墙时围栏拦住 -Z 侧', () => {
    const out = vec();
    const t = sweepWalls([], 10, 10, vec(0, 1, 0), vec(0, 1, -30), 0.5, out);
    expect(t).toBeCloseTo(9.5 / 30, 9);
    expectNormal(out, { x: 0, y: 0, z: -1 });
  });

  it('起点已经在围栏外时兜底不生效', () => {
    const out = vec();
    expect(sweepWalls([], 10, 10, vec(20, 1, 0), vec(30, 1, 0), 0.5, out)).toBe(-1);
  });

  it('两端都越界时取更近的一侧（X 更近）', () => {
    const out = vec();
    sweepWalls([], 10, 10, vec(0, 1, 0), vec(12, 1, 11), 0.5, out);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('两端都越界且 Z 更近时取 Z 侧', () => {
    const out = vec();
    sweepWalls([], 10, 10, vec(0, 1, 0), vec(11, 1, 12), 0.5, out);
    expectNormal(out, { x: 0, y: 0, z: 1 });
  });

  it('负方向越界：法线朝 -X', () => {
    const out = vec();
    sweepWalls([], 10, 10, vec(0, 1, 0), vec(-30, 1, 0), 0.5, out);
    expectNormal(out, { x: -1, y: 0, z: 0 });
  });

  it('完全没碰到任何东西返回 -1', () => {
    const out = vec();
    expect(sweepWalls([box(0, 1, 0, 1, 1, 1)], 23, 23, vec(0, 1, 5), vec(5, 1, 5), 0.1, out)).toBe(-1);
    expect(sweepWalls([], 23, 23, vec(0, 1, 0), vec(1, 1, 1), 0.1, out)).toBe(-1);
  });

  it('多面墙重叠时返回最近的一个 t 且法线属于最近那面', () => {
    const out = vec();
    const near = box(0, 1, 2, 1, 1, 0.5);
    const far = box(0, 1, -2, 1, 1, 0.5);
    const t = sweepWalls([far, near], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, out);
    expect(t).toBeCloseTo((5 - 2.6) / 10, 6);
    expectNormal(out, { x: 0, y: 0, z: 1 });
  });

  it('墙的顺序不影响结果（先远后近与先近后远一致）', () => {
    const near = box(0, 1, 2, 1, 1, 0.5);
    const far = box(0, 1, -2, 1, 1, 0.5);
    const a = vec();
    const b = vec();
    const t1 = sweepWalls([far, near], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, a);
    const t2 = sweepWalls([near, far], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, b);
    expect(t1).toBeCloseTo(t2, 12);
    expect(noNegZero(a)).toEqual(noNegZero(b));
  });

  it('地图墙比围栏更近时用地图墙', () => {
    const out = vec();
    const wall = box(5, 1, 0, 0.2, 1, 1);
    const t = sweepWalls([wall], 23, 23, vec(0, 1, 0), vec(30, 1, 0), 0.1, out);
    expect(t).toBeCloseTo((5 - 0.3) / 30, 6);
    expectNormal(out, { x: -1, y: 0, z: 0 });
  });

  it('围栏比地图墙更近时用围栏', () => {
    const out = vec();
    // 墙在 x=15，但围栏先到（halfX=10）：t = 9.9/30 小于墙的 (15-0.3)/30
    const wall = box(15, 1, 0, 0.2, 1, 1);
    const t = sweepWalls([wall], 10, 10, vec(0, 1, 0), vec(30, 1, 0), 0.1, out);
    expect(t).toBeCloseTo(9.9 / 30, 9);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('外圈围栏不检查起点终点是否都已越界：起点在界内就按比例给 t', () => {
    const out = vec();
    // halfX=5，起点 x=0、终点 x=20：t = (4.9-0)/20
    const t = sweepWalls([], 5, 5, vec(0, 1, 0), vec(20, 1, 0), 0.1, out);
    expect(t).toBeCloseTo(4.9 / 20, 9);
    expectNormal(out, { x: 1, y: 0, z: 0 });
  });

  it('线段没走完就撞墙（t<1），撞完仍返回 t 而不是 1', () => {
    const out = vec();
    const t = sweepWalls([box(0, 1, 0, 1, 1, 1)], 23, 23, vec(0, 1, 2), vec(0, 1, -2), 0.1, out);
    expect(t).toBeCloseTo((2 - 1.1) / 4, 6);
    expect(t).toBeLessThan(1);
  });

  it('法线输出复用 out 对象（不重新分配）', () => {
    const out = vec(7, 7, 7);
    const ref = out;
    sweepWalls([box(0, 1, 0, 1, 1, 1)], 23, 23, vec(0, 1, 5), vec(0, 1, -5), 0.1, out);
    expect(ref).toBe(out);
    expect(noNegZero(out)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('空墙表 + 场地内短线段返回 -1', () => {
    const out = vec();
    expect(sweepWalls([], 23, 23, vec(3, 1, 3), vec(3.2, 1, 3.2), 0.2, out)).toBe(-1);
  });
});