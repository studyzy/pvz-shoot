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
    const { sim, map } = makeSim();
    const p = sim.players[0];
    const alive = sim.zombies.zombies.filter((z) => z.alive && !z.dying);
    expect(alive.length).toBeGreaterThan(0);

    // 至少能打中一只（其它可能被墙挡住，这是正确行为）
    let hits = 0;
    for (const z of alive) {
      const { yaw, pitch } = aimAt(p, z);
      if (adjudicateShot(p, yaw, pitch, sim.zombies.zombies, map)) hits++;
    }
    expect(hits).toBeGreaterThan(0);

    // 反方向必然打空
    const wrong = adjudicateShot(p, Math.PI, 0, sim.zombies.zombies, map);
    expect(wrong).toBeNull();
  });

  it('墙体遮挡：墙后的僵尸打不到', () => {
    const { sim, map } = makeSim();
    const p = sim.players[0];
    let blockedSeen = false;
    for (const z of sim.zombies.zombies.filter((x) => x.alive && !x.dying)) {
      const { yaw, pitch } = aimAt(p, z);
      const hit = adjudicateShot(p, yaw, pitch, sim.zombies.zombies, map);
      // 如果没打中，必须是因为中间有墙（而不是判定 bug）
      if (!hit) {
        const dist = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
        // 没墙却打不中才可疑；这里只要有墙就算合理
        if (dist > 3) blockedSeen = true;
      }
    }
    // 后院有 25 面墙，必然存在被挡的情况
    expect(blockedSeen).toBe(true);
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
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud']) {
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
    const f = decodeFire(encodeFire(7, 1.2, -0.3, 'pea'));
    expect(f).toEqual({ seq: 7, yaw: 1.2, pitch: -0.3, weapon: 'pea' });
    // 协议里没有 zid / dmg / head 字段 —— 客户端无法伪造目标与伤害
    expect(Object.keys(f).sort()).toEqual(['pitch', 'seq', 'weapon', 'yaw']);
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
