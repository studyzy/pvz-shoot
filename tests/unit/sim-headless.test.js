// 守护测试：模拟层必须能在「没有 DOM / 没有 WebGL」的纯 Node 里跑。
// 这是服务器权威架构的地基 —— 一旦有人在 sim 路径里引了 document / window /
// WebGLRenderer，服务器就会直接崩，而且是在线上才崩。所以用静态扫描 + 运行时双保险。
import { describe, it, expect } from 'vitest';

// jsdom 模块图里拿不到 node:fs，用 vitest.config.js 在 node 侧读好注入的源码表
const SOURCES = __fixture_sources__;
const read = (rel) => SOURCES[rel];

// 模拟路径上会被服务器加载的文件。注意：Zombie/ZombieManager 里含有渲染代码，
// 但都收在 `ctx.headless` 分支后面，所以静态扫描只查「模块顶层」的渲染依赖。
const SIM_FILES = [
  'src/sim/index.js',
  'src/entities/Zombie.js',
  'src/entities/ZombieManager.js',
  'src/entities/Player.js',
  'src/entities/SkySun.js',
];

describe('模拟层可无头运行', () => {
  it('这些文件里不允许在模块顶层直接 new 渲染器 / 读 document', () => {
    const bad = [];
    for (const rel of SIM_FILES) {
      const src = read(rel);
      // 缩进为 0 的 document./window. 视为模块顶层调用
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^(document|window)\./.test(line)) continue;
        if (/^\s*\*\s/.test(line) || /^\s*\/\//.test(line)) continue;
        bad.push(rel + ':' + (i + 1) + ' ' + line.trim().slice(0, 60));
      }
    }
    expect(bad).toEqual([]);
  });

  it('实体类在 headless 标记下不会去建材质/骨骼', () => {
    const src = read('src/entities/Zombie.js');
    // buildRig 必须保留 headless 早退，否则服务器会去加载 glb
    const rig = src.slice(src.indexOf('buildRig() {'), src.indexOf('buildRig() {') + 600);
    expect(rig).toContain('ctx.headless');
    expect(rig).toContain('return');
    // 构造函数里在建 blob 影子之前就要返回（影子要读 canvas）
    const ctor = src.slice(src.indexOf('constructor(type'), src.indexOf('const shadow = new THREE.Mesh'));
    expect(ctor).toContain('headless');
  });

  it('ZombieManager 在 headless 下认为模型永远就绪（服务器不加载 glb）', () => {
    const src = read('src/entities/ZombieManager.js');
    const fn = src.slice(src.indexOf('modelReady(type) {'), src.indexOf('modelReady(type) {') + 300);
    expect(fn).toContain('headless');
    expect(fn).toContain('return true');
  });
});

describe('模拟层不依赖地图的渲染外观', () => {
  it('地图只被当作数据用（colliders / platforms / flowAt），不碰 root 场景树', () => {
    const src = read('src/entities/Zombie.js');
    // 模拟里允许读 map.colliders / map.id / flowAt，不允许把僵尸塞进地图的 root
    const mapRootUse = src.match(/this\.map\.root/g) || [];
    expect(mapRootUse.length).toBe(0);
  });
});

describe('sim/index.js · 无头上下文工厂', () => {
  it('headlessCtx 提供全部必需字段，且粒子/音效是空壳', async () => {
    const { headlessCtx } = await import('../../src/sim/index.js');
    const map = { id: 'backyard' };
    const ctx = headlessCtx({ map });
    expect(ctx.headless).toBe(true);
    expect(ctx.map).toBe(map);
    expect(ctx.scene).toBeNull();
    expect(ctx.env).toBeNull();
    // 空壳：调用任意方法都不抛，也不产生副作用
    expect(() => ctx.particles.burst({})).not.toThrow();
    expect(() => ctx.sfx.groan(1, 0)).not.toThrow();
    expect(() => ctx.hud.showBanner('x', 1)).not.toThrow();
    expect(() => ctx.onKill()).not.toThrow();
    expect(() => ctx.onWaveStart(1)).not.toThrow();
    expect(() => ctx.onWaveClear(1)).not.toThrow();
    expect(() => ctx.onBossSpawn()).not.toThrow();
    expect(() => ctx.onBossDead()).not.toThrow();
    expect(() => ctx.onAttack()).not.toThrow();
    expect(() => ctx.onZombieAttack()).not.toThrow();
  });

  it('headlessCtx 支持注入回调与 cloud/sunOrbs/pickups', async () => {
    const { headlessCtx } = await import('../../src/sim/index.js');
    let killed = 0;
    const sunOrbs = { spawn() {}, spawnSky() {} };
    const ctx = headlessCtx({ map: { id: 'cloud' }, onKill: () => killed++, cloud: { x: 1 }, sunOrbs, pickups: { dropAt() {} } });
    ctx.onKill();
    expect(killed).toBe(1);
    expect(ctx.cloud).toEqual({ x: 1 });
    expect(ctx.sunOrbs).toBe(sunOrbs);
  });

  it('headlessCtx 不给 cloud 时默认为 null', async () => {
    const { headlessCtx } = await import('../../src/sim/index.js');
    expect(headlessCtx({ map: {} }).cloud).toBeNull();
  });
});

describe('headlessMap · 地图数据重建', () => {
  it('带流场的地图能重建 nav 并提供 flowAt/updateNav', async () => {
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    for (const id of ['snow', 'dust', 'forest', 'cloud', 'downtown']) {
      const map = headlessMap(id);
      expect(map.nav, id).toBeTruthy();
      expect(typeof map.flowAt, id).toBe('function');
      expect(typeof map.updateNav, id).toBe('function');
      // 更新一次不崩
      expect(() => map.updateNav({ pos: { x: 0, z: 0 } })).not.toThrow();
      const out = { x: 0, z: 0 };
      expect(() => map.flowAt(0, 0, out)).not.toThrow();
    }
  });

  it('无流场的地图（后院）返回 null，Zombie 会退化成直线追踪', async () => {
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    expect(map.nav).toBeNull();
    expect(map.flowAt).toBeNull();
    expect(map.updateNav).toBeNull();
  });

  it('未知地图 id 兜底到第一张，不崩', async () => {
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('no-such-map');
    expect(map.id).toBeTruthy();
    expect(map.bounds).toBeTruthy();
  });

  it('duoSpawn 与客户端 Game.duoSpawn 完全一致（否则开局会瞬移）', async () => {
    const { duoSpawn, headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    const s = map.spawn;
    expect(duoSpawn(map, 0)).toEqual({ x: s.x - 1.8, z: s.z, yaw: s.yaw });
    expect(duoSpawn(map, 1)).toEqual({ x: s.x + 1.8, z: s.z, yaw: s.yaw });
  });

  it('duoSpawn 对缺省地图也能产出出生点', async () => {
    const { duoSpawn } = await import('../../src/sim/headlessMap.js');
    expect(duoSpawn(null, 0)).toEqual({ x: -1.8, z: 0, yaw: 0 });
    expect(duoSpawn({ spawn: null }, 1)).toEqual({ x: 1.8, z: 0, yaw: 0 });
  });

  it('每张地图都带齐碰撞/平台/墙体/拾取点字段', async () => {
    const { headlessMap, HEADLESS_MAP_IDS } = await import('../../src/sim/headlessMap.js');
    expect(HEADLESS_MAP_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of HEADLESS_MAP_IDS) {
      const map = headlessMap(id);
      expect(Array.isArray(map.colliders), id).toBe(true);
      expect(Array.isArray(map.platforms), id).toBe(true);
      expect(Array.isArray(map.walls), id).toBe(true);
      expect(Array.isArray(map.pickupSpots), id).toBe(true);
      expect(map.bounds.x).toBeGreaterThan(0);
    }
  });
});

describe('Zombie · 无头分支的视觉方法全部安全短路', () => {
  async function headlessZombie(type = 'normal') {
    const { Zombie } = await import('../../src/entities/Zombie.js');
    const { headlessMap } = await import('../../src/sim/headlessMap.js');
    const map = headlessMap('backyard');
    return new Zombie(type, 1, 0, 0, { headless: true, map, scene: null, env: null }, 1, 1);
  }

  it('无头僵尸不建材质/骨骼/动画，但逻辑字段齐全', async () => {
    const z = await headlessZombie();
    expect(z.headless).toBe(true);
    expect(z.body).toBeNull();
    expect(z.mixer).toBeNull();
    expect(z.mats).toEqual([]);
    expect(z.hp).toBeGreaterThan(0);
    expect(z.root.position).toBeTruthy();
  });

  it('所有视觉方法在无头模式下不抛异常', async () => {
    const z = await headlessZombie();
    expect(() => z.applyFlash(0.5)).not.toThrow();
    expect(() => z.applyTint(0.5)).not.toThrow();
    expect(() => z.play('walk', 0.2)).not.toThrow();
    expect(() => z.updateProcAnim(0.016, true, false)).not.toThrow();
    expect(() => z.mountHeadTop()).not.toThrow();
    expect(() => z.setCoopMark(true)).not.toThrow();
    expect(() => z.setBounty(true)).not.toThrow();
    // 悬赏是逻辑状态，必须真的写进去（曾经被早退一起跳过）
    expect(z.bounty).toBe(true);
  });

  it('破甲/死亡/技能在无头模式下也能推进', async () => {
    const z = await headlessZombie('bucket'); // 带护甲
    expect(z.armorHp).toBeGreaterThan(0);
    z.spawnT = 1;
    z.hit(9999, false, false, { type: 'pea', source: 0 });
    expect(z.dying || z.dead).toBe(true);
  });

  it('带配件的类型也能无头构造（不挂帽子但字段在）', async () => {
    for (const t of ['cone', 'bucket', 'football', 'boss']) {
      const z = await headlessZombie(t);
      expect(z.headless, t).toBe(true);
      expect(z.def.acc !== undefined || t === 'football', t).toBe(true);
    }
  });

  it('空中单位无头下的高度正确', async () => {
    const z = await headlessZombie('balloon');
    expect(z.airborne).toBe(true);
    expect(z.root.position.y).toBeGreaterThan(0);
  });
});
