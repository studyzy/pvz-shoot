// 无尽的赛博空间：这张图的全部设计承诺都在这一个文件里被钉住。
//
// 这张图跟另外六张的本质区别是「没有边界」—— 大多数断言不是「某物存在」，
// 而是「某物永远追着玩家跑」。所以下面每条用例都对应一条可以被打破的承诺：
//
//   1. 区块生成是纯函数：同样的坐标必须永远产出同样的内容（走出去再走回来还是那块地）
//   2. 走多远都不会走到边：连续跨越上百个区块，碰撞/平台/出生环始终跟着玩家
//   3. 出生广场是空场：玩家开局不会卡在楼里
//   4. 拾取点位永远可达：不压楼、不压碰撞球、彼此不重叠
//   5. 碰撞圈 / 可视圈是分开的：碰撞表不能随着可视圈一起膨胀
//   6. 雾必须落在可视圈边界以内：这是「看不见边缘」的唯一原因
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

// 道具初始化会去 fetch /models/weapons/pack.glb（node 里是无效 URL），
// 那个 Promise 没人接 → 变成 unhandled rejection，把 vitest 退出码拉成非零、
// 进而让部署脚本的 `npm test` 判定失败（用例本身全绿）。
// 这里与 tests/unit/weaponpickups.test.js 用同一个替身。
vi.mock('../../src/weapons/WeaponModels.js', () => ({ loadWeaponModel: () => Promise.resolve(null) }));

const SECONDS = 20 * 1000;

let THREE;
let CyberSpace;
let CC; // cyberChunks
let FOG_PRESETS;

beforeAll(async () => {
  THREE = await import('three');
  ({ CyberSpace } = await import('../../src/world/CyberSpace.js'));
  CC = await import('../../src/world/cyberChunks.js');
  ({ FOG_PRESETS } = await import('../../src/world/heightFog.js'));
}, SECONDS);

// 让 map 认为玩家在 (x,z)：直接喂 updateNav，等价于跑了一帧游戏
function walkTo(map, x, z) {
  map.updateNav({ pos: { x, y: 0, z } }, 1 / 60);
}

describe('cyberChunks · 区块生成是纯函数', () => {
  it('同一坐标永远生成同一内容（函数式）', () => {
    for (const [cx, cz] of [[0, 0], [3, -7], [-42, 91], [1000, -1000]]) {
      expect(JSON.stringify(CC.chunkData(cx, cz))).toBe(JSON.stringify(CC.chunkData(cx, cz)));
    }
  });

  it('不同坐标生成不同内容（不会整片城市长得一样）', () => {
    const a = JSON.stringify(CC.chunkData(5, 5).blocks);
    const b = JSON.stringify(CC.chunkData(6, 5).blocks);
    const c = JSON.stringify(CC.chunkData(5, 6).blocks);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('缓存命中返回同一引用（collect 每帧问，不能每次重算）', () => {
    const a = CC.chunkDataCached(11, 13);
    const b = CC.chunkDataCached(11, 13);
    expect(b).toBe(a);
  });

  it('每块地的几何都落在自己那块 24 米见方的地里（否则区块之间会撕裂）', () => {
    for (const [cx, cz] of [[0, 0], [7, -3], [-9, 4], [20, 20]]) {
      const d = CC.chunkData(cx, cz);
      const ox = cx * CC.CHUNK;
      const oz = cz * CC.CHUNK;
      for (const b of d.blocks) {
        // 允许半宽越界到相邻块（一块楼主跨块界是正常的），但中心必须在场内
        expect(Math.abs(b.x - ox), `block x ${b.x} @ chunk ${cx}`).toBeLessThanOrEqual(CC.HALF + 0.01);
        expect(Math.abs(b.z - oz), `block z ${b.z} @ chunk ${cz}`).toBeLessThanOrEqual(CC.HALF + 0.01);
      }
    }
  });

  it('楼高都在可玩区间内：3~15 米（低于 3 米是掩体、高于 15 米爬不上去只能看）', () => {
    for (let cx = -4; cx <= 4; cx++) {
      for (let cz = -4; cz <= 4; cz++) {
        for (const b of CC.chunkData(cx, cz).blocks) {
          expect(b.h, `chunk ${cx},${cz} block h=${b.h}`).toBeGreaterThan(0.5);
          expect(b.h).toBeLessThan(16);
        }
      }
    }
  });
});

describe('CyberSpace · 出生广场', () => {
  it('出生点在自己那一块的中央，且那一块是空场', () => {
    const map = new CyberSpace(new THREE.Scene());
    expect(map.spawn).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(map.id).toBe('cyber');
    // 出生块没有任何楼
    expect(CC.chunkData(0, 0).blocks.length).toBe(0);
    // 出生点周围 HOME_CLEAR 内也没有碰撞球
    for (const c of map.colliders) {
      expect(Math.hypot(c.x, c.z), `碰撞球 (${c.x}, ${c.z}) 压进出生广场`).toBeGreaterThan(CC.HOME_CLEAR - 0.5);
    }
  });

  it('出生点脚下没有高台（玩家落地不会站在楼顶）', () => {
    const map = new CyberSpace(new THREE.Scene());
    for (const p of map.platforms) {
      const inside = Math.abs(0 - p.x) <= p.w / 2 && Math.abs(0 - p.z) <= p.d / 2;
      expect(inside, `平台 (${p.x}, ${p.z}) 盖住了出生点`).toBe(false);
    }
  });
});

describe('CyberSpace · 走到哪里都没有边', () => {
  it('连续跨越 200 个区块：碰撞/平台/出生环始终跟着玩家', () => {
    const map = new CyberSpace(new THREE.Scene());
    // 一条 200 块的直线：4800 米，任何「有边界」的实现都会在这里露馅
    for (let i = 1; i <= 200; i++) {
      const x = i * CC.CHUNK;
      walkTo(map, x, 0);
      expect(map.anchorCx).toBe(i);
      expect(map.anchorX).toBe(i * CC.CHUNK);
      // 出生环必须以玩家为心（半径 22~29 米），不能漂到原点
      const ring = map.zombieSpawnPoints;
      expect(ring.length).toBe(12);
      for (const [rx, rz] of ring) {
        const d = Math.hypot(rx - x, rz);
        expect(d, `第 ${i} 块的出生点离玩家 ${d.toFixed(1)} 米`).toBeGreaterThan(20);
        expect(d).toBeLessThan(31);
      }
    }
    // 走完 4800 米后，碰撞表仍只有 3×3 块的量（没有随距离累积）
    expect(map.colliders.length).toBeLessThan(600);
  }, SECONDS);

  it('碰撞圈不随可视圈膨胀：距离走得再远，三张表都只覆盖 ±36 米', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 300, -300);
    const cx = map.anchorX;
    const cz = map.anchorZ;
    for (const p of map.platforms) {
      expect(Math.abs(p.x - cx), `平台 x=${p.x} 超出碰撞圈`).toBeLessThanOrEqual(CC.CHUNK * (CC.SOLID_RADIUS + 1));
      expect(Math.abs(p.z - cz), `平台 z=${p.z} 超出碰撞圈`).toBeLessThanOrEqual(CC.CHUNK * (CC.SOLID_RADIUS + 1));
    }
  });

  it('锚点只在跨块时换：同块内连跑 100 帧不重建（零开销）', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 3, 3);
    const built = map._builtCx;
    let rebuilds = 0;
    const orig = map.rebuild.bind(map);
    map.rebuild = (f) => {
      if (!f && map._builtCx === map.anchorCx && map._builtCz === map.anchorCz) return orig(f);
      rebuilds++;
      return orig(f);
    };
    // 在块内小幅移动（锚点 3 → 最多 3±7 = -4~10，离 ±12 的块界还有余量）
    for (let i = 0; i < 100; i++) walkTo(map, 3 + Math.sin(i) * 7, 3 + Math.cos(i) * 7);
    expect(map._builtCx).toBe(built);
    expect(rebuilds).toBe(0);
  });

  it('走出去再走回来：同一块地生成同样的楼（不是随机重排）', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 5 * CC.CHUNK, 0);
    const first = JSON.stringify(map._window.platforms.map((p) => [p.x, p.z, p.w, p.d, p.h]).sort());
    walkTo(map, 40 * CC.CHUNK, 0);
    walkTo(map, 5 * CC.CHUNK, 0);
    const again = JSON.stringify(map._window.platforms.map((p) => [p.x, p.z, p.w, p.d, p.h]).sort());
    expect(again).toBe(first);
  });
});

describe('CyberSpace · 拾取点位', () => {
  it('点位数量在 3~10 之间、互不重叠、不压高台、不压碰撞球', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 7 * CC.CHUNK, -4 * CC.CHUNK);
    const spots = map.pickupSpots;
    expect(spots.length).toBeGreaterThanOrEqual(3);
    expect(spots.length).toBeLessThanOrEqual(10);
    for (let i = 0; i < spots.length; i++) {
      const [x, z] = spots[i];
      // 不压高台
      for (const p of map.platforms) {
        if (p.h < 0.6) continue;
        const inside = Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2;
        expect(inside, `点位 (${x.toFixed(1)}, ${z.toFixed(1)}) 压在 ${p.h} 米高台上`).toBe(false);
      }
      // 不压碰撞球
      for (const c of map.colliders) {
        expect(Math.hypot(x - c.x, z - c.z), `点位压在碰撞球上`).toBeGreaterThan(c.r);
      }
      // 彼此 ≥ 3 米
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(x - spots[j][0], z - spots[j][1])).toBeGreaterThanOrEqual(3);
      }
      // 在玩家附近（8~21 米），不能甩到别的区块去
      expect(Math.hypot(x - map.anchorX, z - map.anchorZ)).toBeLessThan(21.5);
    }
  });

  it('换锚点会举起 spotsDirty，让 Game 把点位重挂到新位置', () => {
    const map = new CyberSpace(new THREE.Scene());
    map.spotsDirty = false;
    walkTo(map, 3 * CC.CHUNK, 0);
    expect(map.spotsDirty).toBe(true);
    const before = map.pickupSpots.map((s) => s.slice());
    walkTo(map, 9 * CC.CHUNK, 0);
    const after = map.pickupSpots;
    // 点位整体搬到新锚点附近
    expect(after[0][0]).not.toBe(before[0][0]);
    expect(Math.abs(after[0][0] - map.anchorX)).toBeLessThan(21);
  });
});

describe('CyberSpace · 视觉与大气', () => {
  it('雾在可视圈边界以内就吃掉画面（「看不见边缘」的唯一原因）', () => {
    const map = new CyberSpace(new THREE.Scene());
    // 玩家离锚点最远 CHUNK/2 = 12 米；可视圈边界在 (VIEW_RADIUS+0.5)*CHUNK 处
    const nearest = (CC.VIEW_RADIUS + 0.5) * CC.CHUNK - CC.CHUNK / 2;
    expect(nearest).toBeGreaterThan(90);
    // 场景雾的 far 必须 ≤ 最近边界
    const scene = new THREE.Scene();
    map.activate(scene);
    expect(scene.fog.far).toBeLessThanOrEqual(nearest);
    expect(scene.fog.near).toBeGreaterThan(0);
    // 后期高度雾的配方也要够浓：在 far 处基本吃满
    const p = FOG_PRESETS.cyber;
    expect(p).toBeTruthy();
    const f = 1 - Math.exp(-p.baseDensity * scene.fog.far);
    expect(f, `far 处只有 ${(f * 100).toFixed(0)}% 的雾`).toBeGreaterThan(0.85);
  });

  it('activate 设背景与雾、本图可见；不往 scene 塞网格', () => {
    const map = new CyberSpace(new THREE.Scene());
    const scene = new THREE.Scene();
    const before = scene.children.length;
    map.activate(scene);
    expect(scene.background).toBeTruthy();
    expect(scene.fog).toBeTruthy();
    expect(map.root.visible).toBe(true);
    expect(scene.children.length).toBe(before);
  });

  it('可视圈的实例缓冲装得下 81 块的内容（cap 不能小于实际需要）', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 13 * CC.CHUNK, 21 * CC.CHUNK);
    // rebuild 里超 cap 会静默截断 → 城市凭空少一角。这里直接对着 cap 断言。
    expect(map.blocks.count).toBeGreaterThan(20);
    expect(map.blocks.count).toBeLessThanOrEqual(map.blocks.instanceMatrix.count);
    expect(map.edges.count).toBeLessThanOrEqual(map.edges.instanceMatrix.count);
    expect(map.pillars.count).toBeLessThanOrEqual(map.pillars.instanceMatrix.count);
    expect(map.holo.count).toBeLessThanOrEqual(map.holo.instanceMatrix.count);
    // 描边数必须等于楼数（每栋楼一圈边框，少一条就是 bug）
    expect(map.edges.count).toBe(map.blocks.count);
  });

  it('天降阳光落在玩家附近（10 公里 bounds 会把它扔到没人到得了的地方）', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 17 * CC.CHUNK, -23 * CC.CHUNK);
    for (let i = 0; i < 40; i++) {
      const s = map.skySunSpot();
      const d = Math.hypot(s.x - map.anchorX, s.z - map.anchorZ);
      expect(d).toBeLessThanOrEqual(22.7);
    }
  });

  it('update(dt) 连续推进不抛错、不改变碰撞/平台表', () => {
    const map = new CyberSpace(new THREE.Scene());
    walkTo(map, 2 * CC.CHUNK, 2 * CC.CHUNK);
    const c0 = JSON.stringify(map.colliders);
    const p0 = JSON.stringify(map.platforms);
    for (let i = 0; i < 60; i++) map.update(1 / 60);
    expect(JSON.stringify(map.colliders)).toBe(c0);
    expect(JSON.stringify(map.platforms)).toBe(p0);
  });

  it('菜单机位在场地附近、y>0、随 t 转动、看向广场中心（契约与其它六张一致）', () => {
    const map = new CyberSpace(new THREE.Scene());
    const cam = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
    const dir = new THREE.Vector3();
    const toCenter = new THREE.Vector3();
    const seen = new Set();
    for (const t of [0, 3, 11, 26]) {
      map.menuCamera(cam, t);
      expect(cam.position.y).toBeGreaterThan(0);
      expect(Math.hypot(cam.position.x, cam.position.z)).toBeLessThan(200);
      cam.getWorldDirection(dir);
      toCenter.set(0, 0, 0).sub(cam.position).normalize();
      expect(dir.dot(toCenter)).toBeGreaterThan(0.6);
      seen.add(cam.position.x.toFixed(3) + ',' + cam.position.z.toFixed(3));
    }
    expect(seen.size).toBe(4);
  });
});

describe('WeaponPickups.rebase · 无限地图换点不重开经济', () => {
  it('只搬未使用的点位，不动地上正在等捡的那把枪、不清 used 标记', async () => {
    const { WeaponPickups } = await import('../../src/entities/WeaponPickups.js');
    const map = new CyberSpace(new THREE.Scene());
    const ctx = {
      map,
      scene: new THREE.Scene(),
      particles: { burst() {} },
      weapons: { canAccept: () => true, pickup: () => true },
    };
    const p = new WeaponPickups(ctx);
    p.setMap(map);
    const active = p.items.find((it) => it.active);
    expect(active, '开局应该有一个点位刷出了道具').toBeTruthy();
    const activeSpot = active.spot ? active.spot.slice() : null;
    const activePos = active.group.position.clone();
    const usedBefore = p.items.filter((it) => it.used).length;
    const timerBefore = p.spawnTimer;
    const finishedBefore = p.finished;

    // 换锚点 → rebase
    walkTo(map, 4 * CC.CHUNK, 0);
    p.rebase(map);

    // 地上的道具原地不动
    expect(active.active).toBe(true);
    expect(active.group.position.x).toBeCloseTo(activePos.x, 6);
    expect(active.group.position.z).toBeCloseTo(activePos.z, 6);
    // used 标记与刷新节拍都没被重置（否则等于每 24 米白送一把枪）
    expect(p.items.filter((it) => it.used).length).toBe(usedBefore);
    expect(p.spawnTimer).toBeCloseTo(timerBefore, 6);
    expect(p.finished).toBe(finishedBefore);
    // 未使用的点位已经搬到新锚点附近
    const idle = p.items.filter((it) => !it.active && !it.used && it.spot);
    expect(idle.length).toBeGreaterThan(0);
    for (const it of idle) {
      expect(Math.hypot(it.spot[0] - map.anchorX, it.spot[1] - map.anchorZ)).toBeLessThan(22);
    }
  });
});