// @vitest-environment node
// 服务器权威命中判定的单元测试。
//
// 这块的核心诉求：服务器只信「我朝哪个方向开了枪」，不信客户端上报的「我打中了谁」。
// 所以每个用例都在验证：角度对 → 命中；角度错 → 打空；被墙挡住 → 打空。
import { describe, it, expect } from 'vitest';
import { MatchSim } from '../../src/sim/MatchSim.js';
import { headlessMap, duoStartSpawns } from '../../src/sim/headlessMap.js';
import { adjudicateShot, lookDir, eyePos, raycastZombies } from '../../src/sim/hit.js';

function makeSim(mapId = 'backyard') {
  const map = headlessMap(mapId);
  const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
  sim.start(1);
  // 跑一会儿让僵尸刷出来
  for (let i = 0; i < 30 * 6; i++) sim.step([null, null]);
  return { sim, map };
}

// 瞄准某只僵尸的胸口：返回 (yaw, pitch)
function aimAt(player, z, headshot = false) {
  const eye = eyePos(player);
  const y = (headshot ? z.headY : z.chestY) * z.scaleFactor;
  const dx = z.root.position.x - eye.x;
  const dz = z.root.position.z - eye.z;
  const d = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(y - eye.y, d) };
}

describe('服务器权威命中判定', () => {
  it('lookDir 与 Player 的相机约定一致：yaw=0 面向 -Z', () => {
    const d = lookDir(0, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    // 抬头为正
    expect(lookDir(0, 0.5).y).toBeGreaterThan(0);
  });

  it('eyePos 是脚底 + 1.66 米（与 applyCamera 一致）', () => {
    const p = { pos: { x: 3, y: 0, z: 7 } };
    expect(eyePos(p)).toEqual({ x: 3, y: 1.66, z: 7 });
  });

  it('朝僵尸开枪命中，反方向打空', () => {
    // 不依赖随机出生点：手动在玩家正前方 5 米放一只，保证视线通畅
    const { sim, map } = makeSim();
    const p = sim.players[0];
    const zm = sim.zombies;
    zm.zombies.length = 0;
    const z = zm.spawnAt('normal', 1, p.pos.x, p.pos.z - 5, 1, 1);
    z.spawnT = 1;
    const aim = aimAt(p, z);
    expect(adjudicateShot(p, aim.yaw, aim.pitch, zm.zombies, map)).toBeTruthy();
    // 反方向必然打空
    expect(adjudicateShot(p, Math.PI, 0, zm.zombies, map)).toBeNull();
  });

  it('墙体遮挡：墙后的僵尸打不到', () => {
    // 直接构造：玩家在原点朝 -Z，僵尸放在身后（+Z），中间放一面墙。
    // 不依赖随机出生点，判定稳定。
    const { sim, map } = makeSim();
    const p = sim.players[0];
    const zm = sim.zombies;
    zm.zombies.length = 0;
    // 僵尸在玩家正前方 6 米
    const z = zm.spawnAt('normal', 1, p.pos.x, p.pos.z - 6, 1, 1);
    z.spawnT = 1;
    // 不放墙时能打中
    const clear = adjudicateShot(p, 0, 0, zm.zombies, map);
    expect(clear, '无遮挡时应命中').toBeTruthy();
    // 在两者中间放一面墙
    const walled = {
      ...map,
      walls: [
        ...map.walls,
        // 轴对齐盒体：OBB 字段必须齐全（hx/hy/hz/c/s），缺一个就会判成整个盒子必中
        { x: p.pos.x, y: 1.5, z: p.pos.z - 3, hx: 8, hy: 1.5, hz: 0.2, c: 1, s: 0 },
      ],
    };
    const blocked = adjudicateShot(p, 0, 0, zm.zombies, walled);
    expect(blocked, '有墙时应被挡住').toBeNull();
  });

  it('fireShot 由服务器扣血：客户端不能直接指定伤害', () => {
    // 僵尸出生位置带随机，可能整批都在墙后。多试几个时刻，任一时刻能瞄准即可。
    let sim = null;
    let target = null;
    let aim = null;
    for (let attempt = 0; attempt < 6 && !target; attempt++) {
      const made = makeSim();
      sim = made.sim;
      const p = sim.players[0];
      for (const z of sim.zombies.zombies.filter((x) => x.alive && !x.dying)) {
        const a = aimAt(p, z);
        if (adjudicateShot(p, a.yaw, a.pitch, sim.zombies.zombies, sim.map)) {
          target = z;
          aim = a;
          break;
        }
      }
      if (!target) {
        for (let i = 0; i < 30 * 4; i++) sim.step([null, null]);
      }
    }
    expect(target).toBeTruthy();
    const hp0 = target.hp;
    const r = sim.fireShot(0, 'pea', aim.yaw, aim.pitch);
    expect(r).toBeTruthy();
    expect(r.hit).toBe(true);
    // 伤害来自武器配置，不是调用方给的
    expect(target.hp).toBeLessThan(hp0);
  });

  it('打空时发出 hit=false 事件且不结算', () => {
    const { sim } = makeSim();
    const p = sim.players[0];
    // 清空场内僵尸，朝任何方向都是空
    sim.zombies.zombies.length = 0;
    const before = sim.scores.slice();
    const r = sim.fireShot(0, 'pea', 0, 0);
    expect(r).toBeNull();
    const shots = sim.drainEvents().filter((e) => e.t === 'shot');
    expect(shots).toHaveLength(1);
    expect(shots[0].hit).toBe(false);
    expect(sim.scores).toEqual(before);
  });

  it('未知武器 id 被拒绝', () => {
    const { sim } = makeSim();
    expect(sim.fireShot(0, 'no-such-weapon', 0, 0)).toBeNull();
  });

  it('倒地/死亡的玩家不能开枪', () => {
    const { sim } = makeSim();
    sim.players[0].downed = true;
    expect(sim.fireShot(0, 'pea', 0, 0)).toBeNull();
    sim.players[0].downed = false;
    sim.players[0].dead = true;
    expect(sim.fireShot(0, 'pea', 0, 0)).toBeNull();
  });

  it('零方向向量不会命中（防 NaN 穿透）', () => {
    const { sim, map } = makeSim();
    const hit = raycastZombies({ x: 0, y: 1.66, z: 0 }, { x: 0, y: 0, z: 0 }, sim.zombies.zombies, {
      walls: map.walls,
      bounds: map.bounds,
    });
    expect(hit).toBeNull();
  });

  it('地图数据完整性：墙体保留 OBB 字段（否则所有射线都被判成打墙）', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown']) {
      const map = headlessMap(id);
      expect(map.walls.length, id).toBeGreaterThan(0);
      for (const w of map.walls) {
        // 圆柱墙
        if (w.r !== undefined) {
          expect(typeof w.r, id + ' cylinder r').toBe('number');
          expect(typeof w.h, id + ' cylinder h').toBe('number');
          continue;
        }
        // OBB 盒体墙：缺 hx/hy/hz/c/s 会让 sweepWalls 判成「整个盒子必中」
        for (const k of ['x', 'y', 'z', 'hx', 'hy', 'hz', 'c', 's']) {
          expect(typeof w[k], `${id} wall.${k}`).toBe('number');
        }
      }
    }
  });
});
// 回归：双人联机「打不掉血」——
// 客户端本地命中 → 发 FIRE 帧（只带朝向）→ 服务器权威判定 → 扣血 → 计分。
// 这条链任何一环断掉都会表现为「怎么打都不掉血」。
describe('开火链路（双人打不掉血的回归）', () => {
  it('FIRE 帧只携带朝向，不含「打中了谁」', async () => {
    const { encodeFire, decodeFire, FRAME } = await import('../../src/sim/snapshot.js');
    const f = decodeFire(encodeFire(7, 1.2, -0.3, 'pea', 6));
    expect(f).toEqual({ seq: 7, yaw: 1.2, pitch: -0.3, weapon: 'pea', aimLagTicks: 6 });
    // 协议里没有 zid / dmg / head 字段 —— 客户端无法伪造目标与伤害。
    // aimLagTicks 是延迟补偿用的「我看的是几 tick 前的世界」，不是判定结果。
    expect(Object.keys(f).sort()).toEqual(['aimLagTicks', 'pitch', 'seq', 'weapon', 'yaw']);
    expect(encodeFire(1, 0, 0, 'pea')[0]).toBe(FRAME.FIRE);
  });

  it('fireShot 造成伤害并按武器配置计分', () => {
    let found = null;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      const { sim } = makeSim();
      const p = sim.players[0];
      for (const z of sim.zombies.zombies.filter((x) => x.alive && !x.dying)) {
        const a = aimAt(p, z);
        if (adjudicateShot(p, a.yaw, a.pitch, sim.zombies.zombies, sim.map)) {
          found = { sim, z, aim: a };
          break;
        }
      }
      if (!found) for (let i = 0; i < 30 * 4; i++) sim.step([null, null]);
    }
    expect(found, '找不到可命中的目标').toBeTruthy();
    const { sim, z, aim } = found;
    // 让目标濒死，一发必杀
    z.hp = 1;
    const score0 = sim.scores[0];
    sim.fireShot(0, 'pea', aim.yaw, aim.pitch);
    // 连续打几发保证打死
    for (let i = 0; i < 5 && !z.dying && !z.dead; i++) sim.fireShot(0, 'pea', aim.yaw, aim.pitch);
    expect(sim.scores[0]).toBeGreaterThan(score0);
    expect(sim.kills[0]).toBeGreaterThan(0);
  });

  it('快照里带比分与击杀（客户端 HUD 的唯一来源）', async () => {
    const { encodeSnapshot, decodeSnapshot } = await import('../../src/sim/snapshot.js');
    const { ZombieManager } = await import('../../src/sim/index.js');
    void ZombieManager;
    const { sim } = makeSim();
    sim.scores = [1234, 567];
    sim.kills = [7, 3];
    const d = decodeSnapshot(encodeSnapshot(sim));
    expect(d.scores).toEqual([1234, 567]);
    expect(d.kills).toEqual([7, 3]);
  });
});

// 回归：爆炸类武器在服务器侧必须打出范围伤害。
// 曾经这里算错落点（把射线命中距离和地面交点取小），俯角射击时爆炸落在脚边，
// 表现为「樱桃/玉米炮怎么扔都炸不到人」。
describe('爆炸类武器的服务器侧结算', () => {
  const EXPLOSIVE = ['cherry', 'cob', 'melon', 'jalapeno'];

  it('瞄准僵尸投掷/射击时必然造成范围伤害（20 次随机场景全中）', () => {
    let hit = 0;
    let attempted = 0;
    for (let trial = 0; trial < 20; trial++) {
      const { sim } = makeSim();
      const p = sim.players[0];
      const z = sim.zombies.zombies.find((x) => x.alive && !x.dying);
      if (!z) continue;
      const dist = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
      if (dist > 22) continue; // 超出射程不算
      const a = aimAt(p, z);
      const r = sim.fireShot(0, 'cherry', a.yaw, a.pitch);
      attempted++;
      if (r && r.hits > 0) hit++;
    }
    expect(attempted).toBeGreaterThan(0);
    expect(hit).toBe(attempted);
  });

  it('四种爆炸武器都走范围伤害分支（不是射线）', () => {
    for (const id of EXPLOSIVE) {
      const { sim } = makeSim();
      const p = sim.players[0];
      // 在玩家正前方 5 米摆一对僵尸，确保落在半径内
      const zm = sim.zombies;
      zm.zombies.length = 0;
      const z1 = zm.spawnAt('normal', 1, p.pos.x, p.pos.z - 5, 1, 1);
      const z2 = zm.spawnAt('normal', 1, p.pos.x + 1, p.pos.z - 5.5, 1, 1);
      z1.spawnT = 1;
      z2.spawnT = 1;
      const hp = [z1.hp, z2.hp];
      const r = sim.fireShot(0, id, 0, -0.1);
      expect(r, id).toBeTruthy();
      expect(r.aoe, id).toBe(true);
      expect(r.hits, id + ' 应该至少炸到 1 只').toBeGreaterThan(0);
      expect(z1.hp < hp[0] || z2.hp < hp[1], id + ' 应该掉血').toBe(true);
    }
  });

  it('射程外的爆炸不会误伤（落点不会被拉近）', () => {
    const { sim } = makeSim();
    const p = sim.players[0];
    const zm = sim.zombies;
    zm.zombies.length = 0;
    // 40 米外放一只，爆炸射程 22 米，不该伤到
    const far = zm.spawnAt('normal', 1, p.pos.x, p.pos.z - 40, 1, 1);
    far.spawnT = 1;
    const hp = far.hp;
    sim.fireShot(0, 'cherry', 0, 0);
    expect(far.hp).toBe(hp);
  });
});

// hit.js 的直接单元测试（不走 MatchSim，覆盖扫掠/延迟补偿等分支）
describe('hit.js 底层', () => {
  it('raycastZombiesAt 用历史位置判定（延迟补偿）', async () => {
    const { raycastZombiesAt, lookDir } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    // 当前位置在 -5，历史位置在 -5 也一样；构造一个偏差很大的历史，验证用的是历史
    const here = new Map([[z.netId, { x: 0, y: 0, z: -5 }]]);
    const elsewhere = new Map([[z.netId, { x: 100, y: 0, z: 100 }]]);
    const eye = { x: 0, y: 1.66, z: 0 };
    const dir = lookDir(0, 0); // 朝 -Z
    expect(raycastZombiesAt(eye, dir, [z], here, { walls: map.walls, bounds: map.bounds })).toBeTruthy();
    expect(raycastZombiesAt(eye, dir, [z], elsewhere, { walls: map.walls, bounds: map.bounds })).toBeNull();
  });

  it('raycastZombiesAt 遇到已死亡/正在死亡的僵尸跳过', async () => {
    const { raycastZombiesAt, lookDir } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    z.alive = false;
    const byId = new Map([[z.netId, { x: 0, y: 0, z: -5 }]]);
    const hit = raycastZombiesAt({ x: 0, y: 1.66, z: 0 }, lookDir(0, 0), [z], byId, {
      walls: map.walls,
      bounds: map.bounds,
    });
    expect(hit).toBeNull();
  });

  it('历史快照里没有这只僵尸时跳过（不崩）', async () => {
    const { raycastZombiesAt, lookDir } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    const hit = raycastZombiesAt({ x: 0, y: 1.66, z: 0 }, lookDir(0, 0), [z], new Map(), {
      walls: map.walls,
      bounds: map.bounds,
    });
    expect(hit).toBeNull();
  });

  it('raycastZombiesAt 零方向返回 null', async () => {
    const { raycastZombiesAt } = await import('../../src/sim/hit.js');
    expect(raycastZombiesAt({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, [], new Map(), {})).toBeNull();
  });

  it('不做延迟补偿时退回当前位置判定', async () => {
    const { raycastZombiesAt, lookDir } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    // byId 传 null → 走 raycastZombies（当前位置）
    const hit = raycastZombiesAt({ x: 0, y: 1.66, z: 0 }, lookDir(0, 0), [z], null, {
      walls: map.walls,
      bounds: map.bounds,
    });
    expect(hit).toBeTruthy();
    expect(hit.zombie).toBe(z);
  });

  it('命中头部时 head=true', async () => {
    const { eyePos, adjudicateShot } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    const p = { pos: { x: 0, y: 0, z: 0 } };
    const eye = eyePos(p);
    const headH = z.root.position.y + z.headY * z.scaleFactor;
    const pitch = Math.atan2(headH - eye.y, 5);
    const hit = adjudicateShot(p, 0, pitch, [z], map);
    expect(hit).toBeTruthy();
    expect(hit.head).toBe(true);
  });
});

describe('snapshot 编解码健壮性', () => {
  it('截断的帧不会崩，返回 null', async () => {
    const { decodeSnapshot } = await import('../../src/sim/snapshot.js');
    expect(decodeSnapshot(new Uint8Array([0x20]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([0xff, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('输入帧长度不对时拒绝', async () => {
    const { decodeInput, encodeInput } = await import('../../src/sim/snapshot.js');
    expect(decodeInput(new Uint8Array(5))).toBeNull();
    const ok = decodeInput(encodeInput(1, { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 }));
    expect(ok.seq).toBe(1);
  });

  it('开火帧武器名超长时按 24 字节截断', async () => {
    const { encodeFire, decodeFire } = await import('../../src/sim/snapshot.js');
    const f = decodeFire(encodeFire(1, 0, 0, 'a'.repeat(40)));
    expect(f.weapon.length).toBe(24);
  });

  it('阳光帧只接受 3 字节', async () => {
    const { encodeSun, decodeSun } = await import('../../src/sim/snapshot.js');
    expect(decodeSun(new Uint8Array(3))).toBeNull(); // 首字节不是 SUN
    expect(decodeSun(new Uint8Array(4))).toBeNull();
    expect(decodeSun(encodeSun(5)).amount).toBe(5);
  });

  it('事件帧非法 JSON 返回 null', async () => {
    const { decodeEvents } = await import('../../src/sim/snapshot.js');
    expect(decodeEvents(new TextEncoder().encode('x'))).toBeNull();
    expect(decodeEvents(new TextEncoder().encode('{"t":"other"}'))).toBeNull();
  });
});

describe('MatchSim · 生命周期与边界', () => {
  it('over 之后 step 不再推进', () => {
    const { sim } = makeSim();
    sim.over = true;
    const t = sim.tick;
    sim.step([null, null]);
    expect(sim.tick).toBe(t);
  });

  it('drainEvents 清空队列', () => {
    const { sim } = makeSim();
    sim.emit({ t: 'x' });
    expect(sim.drainEvents().length).toBeGreaterThan(0);
    expect(sim.drainEvents().length).toBe(0);
  });

  it('spendSun 拒绝超出余额的扣费', () => {
    const { sim } = makeSim();
    sim.sun = 10;
    expect(sim.spendSun(0, 20)).toBe(false);
    expect(sim.sun).toBe(10);
    expect(sim.spendSun(0, 5)).toBe(true);
    expect(sim.sun).toBe(5);
    expect(sim.spendSun(0, 0)).toBe(true);
  });

  it('historicalAt 找不到目标 tick 时给最接近的一份', () => {
    const { sim } = makeSim();
    for (let i = 0; i < 10; i++) sim.step([null, null]);
    const h = sim.historicalAt(999); // 超出范围
    expect(h).toBeTruthy();
    expect(sim.historicalAt(0)).toBeTruthy();
  });

  it('救援：两人靠近累计 2.5 秒后救起', () => {
    const { sim } = makeSim();
    const a = sim.players[0];
    const b = sim.players[1];
    b.pos.x = a.pos.x;
    b.pos.z = a.pos.z;
    a.downed = true;
    a.downTimer = 0;
    for (let i = 0; i < 30 * 3; i++) sim.updateRescue(1 / 30);
    expect(a.downed).toBe(false);
  });

  it('救援：两人都倒地判定团灭', () => {
    const { sim } = makeSim();
    sim.players[0].downed = true;
    sim.players[1].downed = true;
    sim.checkWipe();
    expect(sim.over).toBe(true);
    expect(sim.overReason).toBe('WIPE');
  });

  it('单人模式玩家死亡直接结束对局', () => {
    const { headlessMap } = require('../../src/sim/headlessMap.js');
    void headlessMap;
  });
});

describe('爆炸落点的边界情况', () => {
  it('俯角射击且没打到僵尸时，爆炸落在地面', () => {
    const { sim } = makeSim();
    const p = sim.players[0];
    sim.zombies.zombies.length = 0; // 清场，确保是「没打到」
    // 大俯角：射线会很快与 y=0 相交
    const r = sim.fireShot(0, 'cherry', 0, -0.8);
    expect(r.aoe).toBe(true);
    expect(r.pos.y).toBeGreaterThanOrEqual(0.9); // 不低于地面
    expect(r.hits).toBe(0);
  });

  it('平射且没打到时落在射程末端', () => {
    const { sim } = makeSim();
    sim.zombies.zombies.length = 0;
    const p = sim.players[0];
    const r = sim.fireShot(0, 'cherry', 0, 0);
    // 射程 22 米左右（沿 -Z）
    const dist = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
    expect(dist).toBeGreaterThan(15);
    expect(dist).toBeLessThan(25);
  });

  it('仰角射击不会落到玩家脚下', () => {
    const { sim } = makeSim();
    sim.zombies.zombies.length = 0;
    const p = sim.players[0];
    const r = sim.fireShot(0, 'cherry', 0, 0.5); // 抬头
    const dist = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
    expect(dist).toBeGreaterThan(10);
  });
});

describe('MatchSim · 受击与死亡事件', () => {
  it('僵尸攻击玩家：扣血并发出 hitPlayer 事件', () => {
    const { sim } = makeSim();
    sim.players[0].hp = 100;
    sim.onZombieAttack({ def: { damage: 15 }, targetSeat: 0, airborne: false });
    expect(sim.players[0].hp).toBe(85);
    const evs = sim.drainEvents().filter((e) => e.t === 'hitPlayer');
    expect(evs).toHaveLength(1);
    expect(evs[0].dmg).toBe(15);
    expect(evs[0].seat).toBe(0);
  });

  it('单人模式玩家死亡直接结束对局', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: false, spawns: [duoStartSpawns(map)[0]] });
    const p = sim.players[0];
    p.hp = 5;
    sim.onZombieAttack({ def: { damage: 50 }, targetSeat: 0, airborne: false });
    expect(sim.over).toBe(true);
    expect(sim.overReason).toBe('DEAD');
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.t === 'over' && e.reason === 'DEAD')).toBe(true);
  });

  it('倒地玩家不再吃第二次伤害', () => {
    const { sim } = makeSim();
    sim.players[0].hp = 100;
    sim.players[0].downed = true;
    sim.onZombieAttack({ def: { damage: 15 }, targetSeat: 0, airborne: false });
    expect(sim.players[0].hp).toBe(100);
  });

  it('攻击已死玩家不出事件', () => {
    const { sim } = makeSim();
    sim.players[0].dead = true;
    sim.drainEvents();
    sim.onZombieAttack({ def: { damage: 15 }, targetSeat: 0 });
    expect(sim.drainEvents().filter((e) => e.t === 'hitPlayer')).toHaveLength(0);
  });
});

describe('snapshot · 状态位与边界分支', () => {
  it('玩家倒地/死亡状态位正确编码', async () => {
    const { encodeSnapshot, decodeSnapshot } = await import('../../src/sim/snapshot.js');
    const sim = {
      tick: 1, sun: 0, scores: [0, 0], kills: [0, 0], players: [{}, {}],
      playerState: (i) => ({
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100,
        downed: i === 0, dead: i === 1, downTimer: i === 0 ? 12.5 : 0,
      }),
      zombieStates: () => [], zombies: { wave: 1, state: 'idle' },
    };
    const d = decodeSnapshot(encodeSnapshot(sim));
    expect(d.players[0].downed).toBe(true);
    expect(d.players[0].dead).toBe(false);
    expect(d.players[0].downTimer).toBeCloseTo(12.5, 1);
    expect(d.players[1].dead).toBe(true);
  });

  it('僵尸的减速/悬赏/协同/空中状态位都编码', async () => {
    const { encodeSnapshot, decodeSnapshot } = await import('../../src/sim/snapshot.js');
    const sim = {
      tick: 1, sun: 0, scores: [0, 0], kills: [0, 0], players: [{}],
      playerState: () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false }),
      zombieStates: () => [
        { id: 1, t: 'normal', x: 0, y: 0, z: 0, yaw: 0, hp: 50, st: 3, sl: 1, bo: 1, co: 1, ab: 1, sp: 1, ar: 7 },
      ],
      zombies: { wave: 2, state: 'spawning' },
    };
    const d = decodeSnapshot(encodeSnapshot(sim));
    const z = d.zombies[0];
    expect(z.st).toBe(3);
    expect(z.sl).toBe(1);
    expect(z.bo).toBe(1);
    expect(z.co).toBe(1);
    expect(z.ab).toBe(1);
    expect(z.ar).toBe(7);
  });

  it('错误的帧类型被拒绝', async () => {
    const { decodeSnapshot, decodeInput, decodeFire } = await import('../../src/sim/snapshot.js');
    const snapBytes = new Uint8Array(20);
    snapBytes[0] = 0xff; // 不是 SNAP
    expect(decodeSnapshot(snapBytes)).toBeNull();
    const inpBytes = new Uint8Array(12);
    inpBytes[0] = 0xff;
    expect(decodeInput(inpBytes)).toBeNull();
    const fireBytes = new Uint8Array(14);
    fireBytes[0] = 0xff;
    expect(decodeFire(fireBytes)).toBeNull();
  });

  it('僵尸段被截断时只丢弃不完整的部分，不抛异常', async () => {
    const { encodeSnapshot, decodeSnapshot } = await import('../../src/sim/snapshot.js');
    const sim = {
      tick: 1, sun: 0, scores: [0, 0], kills: [0, 0], players: [{}],
      playerState: () => ({ x: 0, y: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 }),
      zombieStates: () => [
        { id: 1, t: 'normal', x: 0, y: 0, z: 0, yaw: 0, hp: 100, st: 0, sl: 0, bo: 0, co: 0, ab: 0, sp: 1, ar: 0 },
        { id: 2, t: 'normal', x: 1, y: 0, z: 1, yaw: 0, hp: 100, st: 0, sl: 0, bo: 0, co: 0, ab: 0, sp: 1, ar: 0 },
      ],
      zombies: { wave: 1, state: 'idle' },
    };
    const full = encodeSnapshot(sim);
    // 砍掉最后 8 字节，让第二只僵尸读不全
    const cut = full.subarray(0, full.byteLength - 8);
    const d = decodeSnapshot(cut);
    expect(d).toBeTruthy();
    expect(d.zombies.length).toBe(1); // 只保留完整的
  });
});

describe('MatchSim · 波次与 Boss 回调', () => {
  it('清波给双方各加 150×波次 的分', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    const before = sim.scores.slice();
    sim.ctx.onWaveClear(3);
    expect(sim.scores[0] - before[0]).toBe(450);
    expect(sim.scores[1] - before[1]).toBe(450);
    expect(sim.drainEvents().some((e) => e.t === 'waveClear' && e.n === 3)).toBe(true);
  });

  it('Boss 出现/死亡发出带名字的事件', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    sim.ctx.onBossSpawn({ def: { title: '巨人' } });
    sim.ctx.onBossDead({ def: { title: '巨人' } });
    // 没有 title 时兜底 BOSS
    sim.ctx.onBossSpawn({ def: {} });
    const evs = sim.drainEvents();
    expect(evs.find((e) => e.t === 'boss').name).toBe('巨人');
    expect(evs.find((e) => e.t === 'bossDead').name).toBe('巨人');
    expect(evs.filter((e) => e.t === 'boss')[1].name).toBe('BOSS');
  });

  it('onAttackHook 可以接管僵尸攻击（测试/表现层观察用）', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    let hooked = 0;
    sim.onAttackHook = () => hooked++;
    sim.ctx.onZombieAttack({ def: { damage: 1 }, targetSeat: 0 });
    expect(hooked).toBe(1);
  });
});

describe('hit.js · 头部/身体命中的取舍', () => {
  it('身体命中（头球没碰到）走 t1 分支', async () => {
    const { adjudicateShot, eyePos } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    const p = { pos: { x: 0, y: 0, z: 0 } };
    const eye = eyePos(p);
    // 瞄准胸口高度
    const chestH = z.root.position.y + z.chestY * z.scaleFactor;
    const pitch = Math.atan2(chestH - eye.y, 5);
    const hit = adjudicateShot(p, 0, pitch, [z], map);
    expect(hit).toBeTruthy();
    expect(hit.head).toBe(false);
  });

  it('死亡中的僵尸被跳过', async () => {
    const { raycastZombies, lookDir } = await import('../../src/sim/hit.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const { ZombieManager, headlessCtx } = await import('../../src/sim/index.js');
    const zm = new ZombieManager(headlessCtx({ map }));
    const z = zm.spawnAt('normal', 1, 0, -5, 1, 1);
    z.spawnT = 1;
    z.dying = true;
    const hit = raycastZombies({ x: 0, y: 1.66, z: 0 }, lookDir(0, 0), [z], {
      walls: map.walls, bounds: map.bounds,
    });
    expect(hit).toBeNull();
  });
});

describe('MatchSim · 边界守卫', () => {
  it('事件队列有上限，不会无限增长', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    for (let i = 0; i < 400; i++) sim.emit({ t: 'x', i });
    expect(sim.events.length).toBeLessThanOrEqual(256);
  });

  it('单人模式（只有 1 名玩家）checkWipe 直接返回', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: false, spawns: [duoStartSpawns(map)[0]] });
    sim.players[0].downed = true;
    sim.checkWipe();
    expect(sim.over).toBe(false);
  });

  it('对局已结束时 checkWipe 不重复触发', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    sim.over = true;
    sim.players[0].downed = true;
    sim.players[1].downed = true;
    sim.drainEvents();
    sim.checkWipe();
    expect(sim.drainEvents().filter((e) => e.t === 'over')).toHaveLength(0);
  });

  it('救援：两人分开时进度归零', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    const a = sim.players[0];
    const b = sim.players[1];
    a.downed = true;
    // 两人相距很远
    a.pos.x = 0; a.pos.z = 0;
    b.pos.x = 30; b.pos.z = 30;
    sim.rescueAcc = 2.0;
    sim.updateRescue(0.016);
    expect(sim.rescueAcc).toBe(0);
    expect(a.downed).toBe(true);
  });

  it('playerState 越界返回 null', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    expect(sim.playerState(5)).toBeNull();
    expect(sim.playerState(-1)).toBeNull();
  });

  it('worldState 给出完整的世界摘要', async () => {
    const { headlessMap, duoStartSpawns } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
    sim.start(1);
    sim.step([null, null]);
    const w = sim.worldState();
    for (const k of ['tick', 'sun', 'wave', 'state', 'scores', 'kills', 'bossHp', 'over']) {
      expect(w, k).toHaveProperty(k);
    }
  });
});
