import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
 * 单元测试：src/entities/SunOrbs.js
 *
 * 阳光球的行为完全由 update(dt, player) 与实时的随机量决定，
 * 这里用固定初速度/位置把轨迹变成确定值，逐帧断言物理量。
 */

const THREE = await import('three');
const { SunOrbs } = await import('../../src/entities/SunOrbs.js');
const { SUN_SKY } = await import('../../src/config.js');

const POOL = 28;
const BALL_REST = 0.5; // 地面弹跳高度
const FLOOR_MIN = 0.4; // y 硬下限

// 固定 Math.random 的返回值，让 spawn 的位置/速度可预测。
// rand(a, b) = a + Math.random() * (b - a)
function stubRandom(value) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

function makePlayer(x = 0, y = 0, z = 0) {
  return { pos: new THREE.Vector3(x, y, z) };
}

function makeOrbs() {
  const scene = new THREE.Scene();
  const orbs = new SunOrbs(scene);
  orbs.onCollect = vi.fn();
  return { scene, orbs };
}

const activeOrbs = (orbs) => orbs.orbs.filter((o) => o.active);

describe('SunOrbs 构造', () => {
  it('池大小 28，全部隐藏并挂在场景里，共用同一几何/材质', () => {
    const { scene, orbs } = makeOrbs();
    expect(orbs.orbs).toHaveLength(POOL);
    expect(POOL).toBe(28);
    expect(scene.children).toHaveLength(POOL);
    for (const o of orbs.orbs) {
      expect(o.active).toBe(false);
      expect(o.group.visible).toBe(false);
      expect(o.group.parent).toBe(scene);
      // core mesh + glow sprite
      expect(o.group.children).toHaveLength(2);
      expect(o.vel.toArray()).toEqual([0, 0, 0]);
      expect(o.age).toBe(0);
      expect(o.magnet).toBe(false);
    }
    const geos = new Set(orbs.orbs.map((o) => o.group.children[0].geometry));
    const mats = new Set(orbs.orbs.map((o) => o.group.children[0].material));
    expect(geos.size).toBe(1);
    expect(mats.size).toBe(1);
    // onCollect 由外部注入；本测试的 makeOrbs 已注入断言用的 spy
    expect(orbs.onCollect).toBeTypeOf('function');
  });

  it('阳光球外观：0.17 半径、0xffd83f 颜色、发光 sprite 1.25 倍缩放', () => {
    const { orbs } = makeOrbs();
    const core = orbs.orbs[0].group.children[0];
    const glow = orbs.orbs[0].group.children[1];
    expect(core.geometry.parameters.radius).toBe(0.17);
    expect(core.material.color.getHex()).toBe(0xffd83f);
    expect(core.material.toneMapped).toBe(false);
    expect(glow.isSprite).toBe(true);
    expect(glow.scale.x).toBe(1.25);
    expect(glow.scale.y).toBe(1.25);
    expect(glow.material.blending).toBe(THREE.AdditiveBlending);
    expect(glow.material.depthWrite).toBe(false);
  });
});

describe('SunOrbs.spawn', () => {
  afterEach(() => vi.restoreAllMocks());

  it('位置在死亡点上方 0.9~1.5 米、水平 ±0.4，向上抛出', () => {
    // random=0 → 全部取区间下界
    let spy = stubRandom(0);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(2, 1, -3), 1);
    const o = activeOrbs(orbs)[0];
    expect(o.active).toBe(true);
    expect(o.group.visible).toBe(true);
    expect(o.pos.x).toBeCloseTo(2 - 0.4, 12);
    expect(o.pos.y).toBeCloseTo(1 + 0.9, 12);
    expect(o.pos.z).toBeCloseTo(-3 - 0.4, 12);
    expect(o.vel.x).toBeCloseTo(-1.2, 12);
    expect(o.vel.y).toBeCloseTo(2.4, 12);
    expect(o.vel.z).toBeCloseTo(-1.2, 12);
    expect(o.group.position.toArray()).toEqual(o.pos.toArray());
    spy.mockRestore();

    // random=1 → 全部取上界
    spy = stubRandom(1);
    const b = makeOrbs();
    b.orbs.spawn(new THREE.Vector3(0, 0, 0), 1);
    const q = activeOrbs(b.orbs)[0];
    expect(q.pos.x).toBeCloseTo(0.4, 12);
    expect(q.pos.y).toBeCloseTo(1.5, 12);
    expect(q.pos.z).toBeCloseTo(0.4, 12);
    expect(q.vel.x).toBeCloseTo(1.2, 12);
    expect(q.vel.y).toBeCloseTo(3.8, 12);
    expect(q.vel.z).toBeCloseTo(1.2, 12);
  });

  it('高度始终落在 [pos.y + 0.9, pos.y + 1.5]', () => {
    const { orbs } = makeOrbs();
    for (let i = 0; i < 50; i++) orbs.spawn(new THREE.Vector3(0, 2, 0), 1);
    orbs.clear();
    for (let round = 0; round < 5; round++) {
      orbs.spawn(new THREE.Vector3(0, 2, 0), 1);
    }
    const list = orbs.orbs.filter((o) => o.age === 0 && o.group.visible);
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) {
      expect(o.pos.y).toBeGreaterThanOrEqual(2.9 - 1e-9);
      expect(o.pos.y).toBeLessThanOrEqual(3.5 + 1e-9);
    }
  });

  it('count 个球逐个占用，池内不重复', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), 5);
    const active = activeOrbs(orbs);
    expect(active).toHaveLength(5);
    expect(new Set(active.map((o) => o.group)).size).toBe(5);
    // 第一个空白槽在 index 0；此后每个 orb 的 group 互不相同
    // 使用池里最前面的空闲槽
    expect(orbs.orbs.slice(0, 5).every((o) => o.active)).toBe(true);
    expect(orbs.orbs.slice(5).every((o) => !o.active)).toBe(true);
    expect(active[0].group).toBe(orbs.orbs[0].group);
  });

  it('数量不超过池上限 28，池满时多余的丢弃', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), 14);
    orbs.spawn(new THREE.Vector3(0, 0, 0), 14);
    expect(activeOrbs(orbs)).toHaveLength(POOL);
    // 再刷也不会超过并集
    orbs.spawn(new THREE.Vector3(0, 0, 0), 5);
    expect(activeOrbs(orbs)).toHaveLength(POOL);
    // 已经失活的槽位会被回收
    orbs.orbs[3].active = false;
    orbs.orbs[3].group.visible = false;
    orbs.spawn(new THREE.Vector3(1, 1, 1), 1);
    expect(orbs.orbs[3].active).toBe(true);
    expect(orbs.orbs[3].pos.x).toBeCloseTo(1, 12);
  });

  it('spawn 会重置复用槽位的 age / magnet', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), 1);
    const o = orbs.orbs[0];
    o.active = false; // 先失活才会被复用
    o.age = 20;
    o.magnet = true;
    o.pos.set(99, 99, 99);
    o.group.visible = false;
    orbs.spawn(new THREE.Vector3(1, 1, 1), 1);
    expect(o.age).toBe(0);
    expect(o.magnet).toBe(false);
    expect(o.group.visible).toBe(true);
    expect(o.pos.y).toBeCloseTo(2.2, 12); // rand(0.9,1.5)=1.2 → 1+1.2
  });
});

describe('SunOrbs 自由落体与弹跳', () => {
  // 把球放到远离玩家的位置，保证不触发磁吸
  function spawnFar(orbs, x = 20, y = 2, z = 20) {
    const o = orbs.orbs[0];
    o.active = true;
    o.age = 0;
    o.magnet = false;
    o.pos.set(x, y, z);
    o.vel.set(0, 0, 0);
    o.group.visible = true;
    return o;
  }

  it('不磁吸时受重力 7.5 下落', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(20, 0, 20); // 水平重合但垂直距离远 → 不磁吸
    const o = spawnFar(orbs, 20, 8, 20);
    const dt = 1 / 60;
    orbs.update(dt, player);
    expect(o.magnet).toBe(false);
    // vy -= 7.5dt；y += vy*dt
    expect(o.vel.y).toBeCloseTo(-7.5 * dt, 10);
    expect(o.pos.y).toBeCloseTo(8 - 7.5 * dt * dt, 10);
  });

  it('落到 0.5 高度反弹并衰减（×0.34），小幅弹跳归零', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = spawnFar(orbs, 20, 0.55, 20); // 已接近地面
    const dt = 1 / 60;
    // 给一个下落速度
    o.vel.y = -4;
    o.pos.y = 0.55;
    orbs.update(dt, player);
    // 落地判定在 pos += vel*dt 之前：y=0.55 >= 0.5 不反弹，本帧只是下落
    expect(o.vel.y).toBeCloseTo(-4 - 7.5 * dt, 10);
    expect(o.pos.y).toBeCloseTo(0.55 - (4 + 7.5 * dt) * dt, 10);

    // 再走一帧：y 已低于 0.5 → 夹回 0.5，vy 反转为 |vy|*0.34，随后 pos += vel*dt
    o.vel.y = -4;
    orbs.update(dt, player);
    const rebound = 4.125 * 0.34;
    expect(rebound).toBeCloseTo(1.4025, 10);
    expect(o.pos.y).toBeCloseTo(0.5 + rebound * dt, 10);
    expect(o.vel.y).toBeCloseTo(rebound, 10);

    // 反弹速度不够（|vy|*0.34 < 0.4）时直接归零，不会无限抖动
    o.vel.y = -0.5;
    o.pos.y = 0.49;
    orbs.update(dt, player);
    expect(o.vel.y).toBe(0);
    expect(o.pos.y).toBeCloseTo(0.5, 10);

    // 从低速下落：反弹量 < 0.4 → 也归零
    o.vel.y = -0.2;
    o.pos.y = 0.45;
    orbs.update(dt, player);
    expect(o.vel.y).toBe(0);
  });

  it('y 永远不低于 0.4', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = spawnFar(orbs, 20, 0.9, 20);
    o.vel.y = -50;
    orbs.update(1, player);
    expect(o.pos.y).toBeGreaterThanOrEqual(0.4);
    expect(o.pos.y).toBeCloseTo(0.4, 10);
  });

  it('水平速度按 1 - 1.6dt 阻尼衰减', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = spawnFar(orbs, 20, 5, 20);
    o.vel.set(3, 0, -2);
    const dt = 1 / 60;
    orbs.update(dt, player);
    const damp = 1 - 1.6 * dt;
    expect(o.vel.x).toBeCloseTo(3 * damp, 10);
    expect(o.vel.z).toBeCloseTo(-2 * damp, 10);
    expect(o.pos.x).toBeCloseTo(20 + 3 * damp * dt, 10);
    expect(o.pos.z).toBeCloseTo(20 - 2 * damp * dt, 10);
  });

  it('group.position 叠加 sin(phase)*0.09 的浮动，rotation.y 持续旋转', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = spawnFar(orbs, 20, 5, 20);
    o.phase = 0;
    const dt = 0.1;
    orbs.update(dt, player);
    expect(o.phase).toBeCloseTo(0.26, 10);
    expect(o.group.position.y).toBeCloseTo(o.pos.y + Math.sin(0.26) * 0.09, 10);
    expect(o.group.position.x).toBeCloseTo(o.pos.x, 10);
    expect(o.group.rotation.y).toBeCloseTo(dt * 1.6, 10);
    orbs.update(dt, player);
    expect(o.group.rotation.y).toBeCloseTo(0.32, 10);
  });

  it('失活的球不参与更新', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = spawnFar(orbs, 20, 5, 20);
    o.active = false;
    orbs.update(1, player);
    expect(o.pos.y).toBe(5);
    expect(o.age).toBe(0);
    expect(o.group.rotation.y).toBe(0);
  });
});

describe('SunOrbs 磁吸与拾取', () => {
  it('玩家距离 < 4.6 触发 magnet，朝玩家加速飞行', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0); // eyeY = 1.2
    const o = orbs.orbs[0];
    o.active = true;
    o.pos.set(0, 3, 0); // dy = 1.2 - 3 = -1.8，dist=1.8 < 4.6
    o.vel.set(0, 0, 0);
    const dt = 1 / 60;
    orbs.update(dt, player);
    expect(o.magnet).toBe(true);
    // 朝玩家加速度 26，再按 1 - min(0.9, 3.4dt) 阻尼
    expect(o.vel.y).toBeCloseTo(-1 * 26 * dt * (1 - 3.4 * dt), 10);
    expect(o.vel.y).toBeLessThan(0);
    expect(o.pos.y).toBeLessThan(3);
  });

  it('距离 >= 4.6 不触发 magnet', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0); // eyeY = 1.2
    const o = orbs.orbs[0];
    o.active = true;
    o.pos.set(0, 1.2 + 4.7, 0);
    orbs.update(1 / 60, player);
    expect(o.magnet).toBe(false);
    // 边界内则触发
    const b = orbs.orbs[1];
    b.active = true;
    b.pos.set(0, 1.2 + 4.5, 0);
    orbs.update(1 / 60, player);
    expect(b.magnet).toBe(true);
  });

  it('一旦触发 magnet 就一直保持（即使之后被甩远）', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.pos.set(0, 1.2, 0);
    orbs.update(1 / 60, player);
    expect(o.magnet).toBe(true);
    o.pos.set(100, 1.2, 0); // 甩远
    orbs.update(1 / 60, player);
    expect(o.magnet).toBe(true);
  });

  it('磁吸到 0.85 内触发 onCollect(5) 并失活隐藏', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.pos.set(0, 1.2 + 0.9, 0);
    o.vel.set(0, 0, 0);
    // 逐帧推进直到被拾取
    let frames = 0;
    while (o.active && frames < 200) {
      orbs.update(1 / 60, player);
      frames++;
    }
    expect(frames).toBeLessThan(200);
    expect(orbs.onCollect).toHaveBeenCalledTimes(1);
    expect(orbs.onCollect).toHaveBeenCalledWith(5);
    expect(o.active).toBe(false);
    expect(o.group.visible).toBe(false);
  });

  it('拾取判定用眼睛高度（pos.y + 1.2）而不是脚底', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.magnet = true;
    o.pos.set(0.8, 1.2, 0); // 距眼睛 0.8 < 0.85 → 直接拾取
    orbs.update(1 / 60, player);
    expect(orbs.onCollect).toHaveBeenCalledWith(5);
    expect(o.active).toBe(false);

    // 距脚底 0.8 但距眼睛 1.44 → 不应立即拾取
    const b = orbs.orbs[1];
    b.active = true;
    b.magnet = true;
    b.pos.set(0.8, 0, 0);
    orbs.update(1 / 60, player);
    expect(b.active).toBe(true);
  });

  it('磁吸时速度按 1 - min(0.9, 3.4dt) 阻尼', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.magnet = true;
    o.pos.set(0, 3, 0);
    o.vel.set(0, -2, 0);
    const dt = 1 / 60;
    orbs.update(dt, player);
    const inv = 1 / 1.8;
    const expected = (-2 + (1.2 - 3) * inv * 26 * dt) * (1 - 3.4 * dt);
    expect(o.vel.y).toBeCloseTo(expected, 10);
  });

  it('onCollect 缺省时不抛错（只是不回调）', () => {
    const { orbs } = makeOrbs();
    orbs.onCollect = null;
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.magnet = true;
    o.pos.set(0, 1.2, 0);
    expect(() => orbs.update(1 / 60, player)).not.toThrow();
    expect(o.active).toBe(false);
  });

  it('多个球都在范围内时逐个拾取并各自回调一次', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const o = orbs.orbs[i];
      o.active = true;
      o.magnet = true;
      o.pos.set(0.5, 1.2, 0);
    }
    orbs.update(1 / 60, player);
    expect(orbs.onCollect).toHaveBeenCalledTimes(3);
    expect(activeOrbs(orbs)).toHaveLength(0);
  });
});

describe('SunOrbs 超时与清理', () => {
  it('age > 18 自动失活隐藏（超时消失）', () => {
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.orbs[0];
    o.active = true;
    o.pos.set(20, 5, 20);
    o.age = 0;
    // 18 秒整不消失（严格大于）
    orbs.update(18, player);
    expect(o.age).toBeCloseTo(18, 10);
    expect(o.active).toBe(true);
    orbs.update(0.01, player);
    expect(o.active).toBe(false);
    expect(o.group.visible).toBe(false);
  });

  it('age 从 spawn 起累积；每球独立计时', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    orbs.spawn(new THREE.Vector3(20, 0, 20), 2);
    orbs.orbs[1].pos.set(20, 5, 20);
    orbs.orbs[0].pos.set(-20, 5, -20);
    orbs.update(0.5, player);
    expect(orbs.orbs[0].age).toBeCloseTo(0.5, 10);
    expect(orbs.orbs[1].age).toBeCloseTo(0.5, 10);
    expect(orbs.orbs[0].pos.y).toBeLessThan(5);
    stubRandom(0.5).mockRestore();
  });

  it('clear() 让所有球失活并隐藏', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), POOL);
    expect(activeOrbs(orbs)).toHaveLength(POOL);
    orbs.clear();
    expect(activeOrbs(orbs)).toHaveLength(0);
    for (const o of orbs.orbs) expect(o.group.visible).toBe(false);
    // 清理后可以重新使用整个池
    orbs.spawn(new THREE.Vector3(0, 0, 0), POOL);
    expect(activeOrbs(orbs)).toHaveLength(POOL);
  });

  it('clear() 后 update 不会复活任何球', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), 3);
    orbs.clear();
    orbs.update(1, makePlayer(0, 0, 0));
    expect(activeOrbs(orbs)).toHaveLength(0);
    expect(orbs.onCollect).not.toHaveBeenCalled();
  });
});
describe('SunOrbs 天降阳光', () => {

  it('spawnSky 从高空生成一颗天降态球，初始竖直下落', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    const o = orbs.spawnSky(5, -3);
    expect(o).not.toBeNull();
    expect(o.active).toBe(true);
    expect(o.sky).toBe(true);
    expect(o.pos.x).toBe(5);
    expect(o.pos.z).toBe(-3);
    expect(o.pos.y).toBeCloseTo(SUN_SKY.height, 6);
  });

  it('天降球在空中不会被磁吸，必须落地后才可拾取', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    // 玩家就在正下方：普通球这一帧就会被吸走
    const player = makePlayer(0, 0, 0);
    const o = orbs.spawnSky(0, 0);
    orbs.update(1 / 60, player);
    expect(o.magnet).toBe(false);
    expect(o.active).toBe(true);
    expect(orbs.onCollect).not.toHaveBeenCalled();
  });

  it('天降球匀速下落：2 秒下降约 10 米（不会因为重复积分而翻倍）', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    // 玩家放到很远的地方，确保这一帧不会被磁吸
    const player = makePlayer(100, 0, 100);
    const o = orbs.spawnSky(0, 0);
    const y0 = o.pos.y;
    orbs.update(1, player);
    orbs.update(1, player);
    // 5 m/s × 2s = 10m
    expect(y0 - o.pos.y).toBeCloseTo(10, 6);
  });

  it('天降球落地后转为普通球，之后可被磁吸拾取', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    const player = makePlayer(0, 0, 0);
    const o = orbs.spawnSky(0, 0);
    // 5 m/s 下落 12 米约 2.4 秒
    for (let i = 0; i < 200 && o.sky; i++) orbs.update(1 / 60, player);
    expect(o.sky).toBe(false);
    expect(o.pos.y).toBeCloseTo(0.5, 6);
    // 落地后继续 update 就会被吸走
    for (let i = 0; i < 200 && o.active; i++) orbs.update(1 / 60, player);
    expect(o.active).toBe(false);
    expect(orbs.onCollect).toHaveBeenCalledWith(5);
  });

  it('池满时 spawnSky 返回 null 而不是抛错', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawn(new THREE.Vector3(0, 0, 0), POOL);
    expect(orbs.spawnSky(1, 1)).toBeNull();
  });

  it('clear() 会把天降态标志一并清掉', () => {
    stubRandom(0.5);
    const { orbs } = makeOrbs();
    orbs.spawnSky(2, 2);
    orbs.clear();
    for (const o of orbs.orbs) expect(o.sky).toBe(false);
  });
});

describe('SunOrbs · 池扩容', () => {
  it('ensureCapacity 只增不减；扩容后新槽可用、重复调用不重复建', () => {
    const { orbs } = makeOrbs();
    const before = orbs.orbs.length;
    orbs.ensureCapacity(before + 12);
    expect(orbs.orbs.length).toBe(before + 12);
    const grown = orbs.orbs.length;
    // 再要更小的容量：不回收
    orbs.ensureCapacity(4);
    expect(orbs.orbs.length).toBe(grown);
    // 新加的槽是隐藏的
    for (let i = before; i < grown; i++) {
      expect(orbs.orbs[i].group.visible).toBe(false);
      expect(orbs.orbs[i].active).toBeFalsy();
    }
  });

  it('扩容出来的球可以直接用 spawn 激活', () => {
    const { orbs } = makeOrbs();
    orbs.ensureCapacity(60);
    orbs.spawn(new THREE.Vector3(1, 0, 1), 1);
    expect(activeOrbs(orbs).length).toBe(1);
  });

  it('池满又扩容后仍能继续生成', () => {
    const { orbs } = makeOrbs();
    orbs.ensureCapacity(80);
    for (let i = 0; i < 50; i++) orbs.spawn(new THREE.Vector3(i * 0.1, 0, 0), 1);
    expect(activeOrbs(orbs).length).toBeGreaterThan(28);
  });
});
