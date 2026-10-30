import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

// ZombieManager 的波次 / 生成 / 结算数字全部来自 config.js：
//   wavePlan(n): normal 4+floor(1.45n)；cone n>=2 时 floor(1.05(n-1))；bucket n>=3 时 max(1, floor(0.8(n-2)))；n%5===0 追加 boss
//   waveMaxAlive(n)=min(14, 8+floor(n/2))、waveSpawnInterval(n)=max(0.5, 1.35-0.055n)
//   zombieHpMul(n)=1+0.11(n-1)、zombieSpeedMul(n)=min(1.45, 1+0.018(n-1))
const DT = 1 / 60;

let zombieModel;
let config;

// 一条完整的 Game（menu → start）。ZombieManager 的联动（HUD/阳光/音效）都走真实实现。
// 用 readyGame() 而不是 createGame()：glb 替身是异步就绪的，createGame 返回时可能还没好。
let sharedGame = null;

async function boot() {
  if (!sharedGame) {
    ({ zombieModel } = await import('../../src/entities/ZombieModel.js'));
    config = await import('../../src/config.js');
    const { readyGame } = await import('../helpers/game.js');
    const created = await readyGame();
    sharedGame = created.game;
    sharedGame.start();
    sharedGame.zombies.reset();
  }
  return sharedGame;
}

function clearField() {
  const zm = sharedGame.zombies;
  zm.reset();
  // reset() 不会写 maxAlive / interval / 倍率（只在 startWave 里写），恢复成第 1 波默认值，
  // 避免上一用例的波次设置漏到下一用例。
  zm.maxAlive = config.waveMaxAlive(1);
  zm.interval = config.waveSpawnInterval(1);
  zm.hpMul = 1;
  zm.speedMul = 1;
  // Game.update 每帧都用 `this.hud.setBossHp(...)` 覆盖外层记录，这里重新挂一层。
  const hud = sharedGame.hud;
  if (!hud.__origSetBossHp) hud.__origSetBossHp = hud.setBossHp;
  const orig = hud.__origSetBossHp;
  hud.setBossHp = function (r) { sharedGame.__lastBossHp = r; orig.call(this, r); };
  sharedGame.__lastBossHp = null;
  return zm;
}

// 埋点：把 manager 会调用的 ctx 回调换成记录器，返回记录数组。
function collectCtx() {
  const game = sharedGame;
  const calls = {
    onWaveStart: [],
    onWaveClear: [],
    onKill: [],
    onBossSpawn: [],
    onBossDead: 0,
    onZombieAttack: [],
  };
  // 只做记录，真实实现（Game 构造函数里绑的）不再被自动调用，所以这里显式转发一份给 Game
  const game_ = game;
  game.ctx.onWaveStart = (n) => { calls.onWaveStart.push(n); game_.onWaveStart(n); };
  game.ctx.onWaveClear = (n) => { calls.onWaveClear.push(n); game_.onWaveClear(n); };
  game.ctx.onKill = (z, score, head) => { calls.onKill.push([z, score, head]); game_.onKill(z, score, head); };
  game.ctx.onBossSpawn = (z) => { calls.onBossSpawn.push(z); game_.onBossSpawn(z); };
  game.ctx.onBossDead = () => { calls.onBossDead++; game_.onBossDead(); };
  game.ctx.onZombieAttack = (z) => { calls.onZombieAttack.push(z); game_.onZombieAttack(z); };
  return calls;
}

// 沿真实生成路径造一只并钉到 (x, z)，同时跳过出生动画（spawnT=1 才吃伤害 / 才进 AI）。
function spawnAt(type, x, z) {
  const zm = sharedGame.zombies;
  zm.queue = [type];
  zm.maxAlive = 14;
  zm.state = 'spawning';
  zm.spawnTimer = 0;
  zm.interval = 0.5;
  const zombie = zm.spawnOne(sharedGame.player);
  zombie.root.position.set(x, 0, z);
  zombie.spawnT = 1;
  zombie.model.position.y = 0;
  return zombie;
}

// 一直刷到 limit 只（或刷完 queue）。
// 直接调 spawnOne 生成（只用于观察出生点分布，绕过 update 的门槛判定）。
function pump(limit) {
  const zm = sharedGame.zombies;
  while (zm.zombies.length < limit && zm.queue.length > 0) zm.spawnOne(sharedGame.player);
  return zm.zombies.length;
}

// 走 update 的门槛（spawnTimer / maxAlive / state），最多推进 maxFrames 帧。
function pumpViaUpdate(maxFrames = 400) {
  const zm = sharedGame.zombies;
  for (let i = 0; i < maxFrames; i++) {
    zm.spawnTimer = -1;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
  }
  return zm.zombies.length;
}

describe('ZombieManager · 波次调度', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('startWave(n)：queue / 倍率 / 上限 / 间隔，state=spawning、spawnTimer=0.35，触发 onWaveStart', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(4);
    expect(calls.onWaveStart).toEqual([4]);
    expect(zm.wave).toBe(4);
    // 4 波：normal 4+5=9、cone floor(3×1.05)=3、bucket max(1, floor(2×0.8))=1、橄榄球 1 → 14
    expect(zm.queue.length).toBe(14);
    expect(zm.queue.filter((t) => t === 'normal').length).toBe(9);
    expect(zm.queue.filter((t) => t === 'cone').length).toBe(3);
    expect(zm.queue.filter((t) => t === 'bucket').length).toBe(1);
    expect(zm.queue.filter((t) => t === 'football').length).toBe(1);
    // 气球第 6 波才出现
    expect(zm.queue).not.toContain('balloon');
    expect(zm.airQuota).toBe(config.waveAirQuota(4));
    expect(zm.queue).not.toContain('boss');
    expect(zm.hpMul).toBeCloseTo(1.33, 10);
    expect(zm.speedMul).toBeCloseTo(1.054, 10);
    expect(zm.maxAlive).toBe(10); // min(14, 8+floor(4/2))
    expect(zm.interval).toBeCloseTo(1.13, 10);
    expect(zm.state).toBe('spawning');
    expect(zm.spawnTimer).toBe(0.35);
    // 与 config 公式逐项一致
    expect(zm.maxAlive).toBe(config.waveMaxAlive(4));
    expect(zm.interval).toBeCloseTo(config.waveSpawnInterval(4), 10);
    expect(zm.hpMul).toBeCloseTo(config.zombieHpMul(4), 10);
    expect(zm.speedMul).toBeCloseTo(config.zombieSpeedMul(4), 10);
  });

  it('第 5 波是 Boss 波：恰好 1 个 boss；上限与间隔各自封顶', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(5);
    expect(zm.queue.filter((t) => t === 'boss').length).toBe(1);
    // normal 4+7=11、cone floor(4×1.05)=4、bucket max(1, floor(3×0.8))=2、橄榄球 1、boss 1 → 19
    expect(zm.queue.length).toBe(19);
    zm.startWave(20);
    expect(zm.maxAlive).toBe(14); // min(14, 18)
    expect(zm.interval).toBe(0.5); // max(0.5, 1.35-1.1)
    expect(calls.onWaveStart).toEqual([5, 20]);
  });

  it('普通僵尸用的是 alchemist.glb：模型未就绪时改刷别的、自己留在队首', () => {
    const zm = sharedGame.zombies;
    zombieModel.alchemist.ready = false;
    zm.queue = ['normal', 'cone'];
    const before = zm.zombies.length;
    zm.spawnOne(sharedGame.player);
    expect(zm.zombies.length).toBe(before + 1);
    expect(zm.zombies[zm.zombies.length - 1].type).toBe('cone');
    expect(zm.zombies[zm.zombies.length - 1].modelId).toBe('zombie');
    expect(zm.queue[0]).toBe('normal');
    zm.queue = ['normal'];
    expect(zm.spawnOne(sharedGame.player)).toBe(null);
    zombieModel.alchemist.ready = true;
    zm.queue = ['normal'];
    zm.spawnOne(sharedGame.player);
    const last = zm.zombies[zm.zombies.length - 1];
    expect(last.type).toBe('normal');
    expect(last.modelId).toBe('alchemist');
    zm.queue = [];
  });

  it('倍率公式：第 1 波 1 倍，速度倍率 1.45 封顶', () => {
    const zm = sharedGame.zombies;
    zm.startWave(1);
    expect(zm.hpMul).toBe(1);
    expect(zm.speedMul).toBe(1);
    zm.startWave(2);
    expect(zm.hpMul).toBeCloseTo(1.11, 10);
    expect(zm.speedMul).toBeCloseTo(1.018, 10);
    zm.startWave(60);
    expect(zm.speedMul).toBe(1.45);
    expect(zm.hpMul).toBeCloseTo(1 + 59 * 0.11, 10);
  });

  it('reset()：dispose 场上僵尸、清空队列、回到 idle、丢掉 boss 与击杀数', () => {
    const zm = sharedGame.zombies;
    zm.startWave(5);
    zm.queue.length = 0;
    const a = spawnAt('normal', 0, 0);
    const disposeSpy = vi.spyOn(a, 'dispose');
    zm.boss = a;
    zm.totalKills = 7;
    zm.intermission = 3;
    zm.reset();
    expect(disposeSpy).toHaveBeenCalled();
    expect(zm.zombies.length).toBe(0);
    expect(zm.queue.length).toBe(0);
    expect(zm.wave).toBe(0);
    expect(zm.state).toBe('idle');
    expect(zm.intermission).toBe(0);
    expect(zm.spawnTimer).toBe(0);
    expect(zm.boss).toBe(null);
    expect(zm.totalKills).toBe(0);
  });
});

describe('ZombieManager · 生成节流', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('spawnTimer > 0 不生成；归零后生成一只，计时重置到 interval×[0.75,1.25]', () => {
    const zm = sharedGame.zombies;
    zm.startWave(3); // startWave 同时写入 maxAlive（reset 后为 undefined，不写就不会生成）
    const planned = zm.queue.length;
    zm.spawnTimer = 0.5;
    // 计时还在走的阶段：一帧都不生成（归零的同帧就会生成，所以不单独断言"归零帧"）
    while (zm.spawnTimer > 0 && zm.zombies.length === 0) {
      zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    }
    expect(zm.zombies.length).toBe(1);
    expect(zm.zombies.length).toBe(1);
    expect(zm.queue.length).toBe(planned - 1);
    const interval = config.waveSpawnInterval(3);
    expect(zm.spawnTimer).toBeGreaterThanOrEqual(interval * 0.75 - 1e-9);
    expect(zm.spawnTimer).toBeLessThanOrEqual(interval * 1.25 + 1e-9);
    // 生成的僵尸吃 hpMul / speedMul
    const z = zm.zombies[0];
    expect(z.maxHp).toBe(Math.round(config.ZOMBIES[z.type].hp * config.zombieHpMul(3)));
    expect(z.speed).toBeCloseTo(config.ZOMBIES[z.type].speed * config.zombieSpeedMul(3), 10);
    expect(z.wave).toBe(3);
  });

  it('zombieModel.ready=false 时一个都不生成，恢复就绪后立刻继续', () => {
    const zm = sharedGame.zombies;
    zm.startWave(1);
    expect(zombieModel.ready).toBe(true);
    // 第 1 波全是普通僵尸 —— 它们用的是 alchemist.glb，两个都要卡住才一个都刷不出来
    try {
      zombieModel.ready = false;
      zombieModel.alchemist.ready = false;
      zm.spawnTimer = 0;
      for (let i = 0; i < 60; i++) zm.update(DT, sharedGame.player, sharedGame.map.colliders);
      expect(zm.zombies.length).toBe(0);
      expect(zm.spawnTimer).toBeLessThan(0); // 计时不会卡在正数上
    } finally {
      zombieModel.ready = true;
      zombieModel.alchemist.ready = true;
    }
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.zombies.length).toBe(1);
  });

  it('场上僵尸数达到 maxAlive 就停止生成（第 2 波上限 9）', () => {
    const zm = sharedGame.zombies;
    zm.startWave(2);
    expect(zm.maxAlive).toBe(9);
    zm.queue = new Array(30).fill('normal');
    expect(pumpViaUpdate()).toBe(9);
    expect(zm.queue.length).toBeGreaterThan(0); // 队列里还剩怪，只是不刷了
  });

  it('同屏硬上限 14（第 20 波）', () => {
    const zm = sharedGame.zombies;
    zm.startWave(20);
    expect(zm.maxAlive).toBe(14);
    zm.queue = new Array(40).fill('normal');
    expect(pumpViaUpdate()).toBe(14);
  });

  it('每次生成都播放粒子 + 泥土音效', () => {
    const zm = sharedGame.zombies;
    const burst = vi.spyOn(sharedGame.ctx.particles, 'burst');
    const dirt = vi.spyOn(sharedGame.sfx, 'dirt');
    const before = burst.mock.calls.length;
    zm.startWave(1);
    zm.queue = ['normal'];
    zm.spawnTimer = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.zombies.length).toBe(1);
    const calls = burst.mock.calls.slice(before);
    expect(calls.length).toBe(1);
    expect(calls[0][0].count).toBe(14);
    expect(dirt).toHaveBeenCalled();
  });

  it('queue 空但场上有僵尸：保持 spawning，不提前清波', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(1);
    zm.queue.length = 0;
    spawnAt('normal', 0, 0);
    for (let i = 0; i < 30; i++) zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.state).toBe('spawning');
    expect(calls.onWaveClear).toEqual([]);
  });
});

describe('ZombieManager · 清波与换波', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('queue 空且场上无僵尸 → intermission=6.5 并通知 onWaveClear(wave)', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(3);
    zm.queue.length = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.state).toBe('intermission');
    expect(zm.intermission).toBe(6.5);
    expect(calls.onWaveClear).toEqual([3]);
    // 再走一帧不会重复通知
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(calls.onWaveClear).toEqual([3]);
    expect(zm.intermission).toBeCloseTo(6.5 - DT, 9);
  });

  it('intermission 倒数到 0 自动 startWave(wave+1)', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(2);
    zm.queue.length = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.state).toBe('intermission');
    for (let i = 0; i < 400; i++) zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.wave).toBe(3);
    expect(zm.state).toBe('spawning');
    expect(calls.onWaveStart).toContain(3);
    expect(zm.hpMul).toBeCloseTo(config.zombieHpMul(3), 10);
  });

  it('死亡清理：dead 的被 dispose 并从数组移除，还在播死亡动画的留着', () => {
    const zm = sharedGame.zombies;
    zm.startWave(1);
    zm.queue.length = 0;
    const a = spawnAt('normal', 0, 10);
    const b = spawnAt('normal', 2, 10);
    a.hit(a.maxHp, false, false); // 进入 dying
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.zombies).toContain(a);
    expect(a.dead).toBe(false);
    const spy = vi.spyOn(a, 'dispose');
    for (let i = 0; i < 100; i++) zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(a.dead).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(zm.zombies).not.toContain(a);
    expect(zm.zombies).toContain(b);
  });

  it('最后一只死亡动画播完后进入 intermission', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(1);
    zm.queue.length = 0;
    const a = spawnAt('normal', 0, 10);
    a.hit(a.maxHp, false, false);
    for (let i = 0; i < 200 && zm.state === 'spawning'; i++) zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.zombies.length).toBe(0);
    expect(zm.state).toBe('intermission');
    expect(calls.onWaveClear).toEqual([1]);
  });
});

describe('ZombieManager · 出生点', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  // 有点位的地图会先 clearOfColliders(r+1.05) 再夹 bounds，所以断言「落在点位附近、
  // 离玩家足够远、不出 bounds、不在碰撞体里」，不断言精确 ±1.6。
  function assertSpawnsSane(map, player) {
    const zm = sharedGame.zombies;
    expect(zm.zombies.length).toBeGreaterThan(0);
    for (const z of zm.zombies) {
      const x = z.root.position.x;
      const zz = z.root.position.z;
      const near = map.zombieSpawnPoints.some(([sx, sz]) => Math.hypot(x - sx, zz - sz) <= 3.6);
      expect(near).toBe(true);
      expect(Math.hypot(x - player.pos.x, zz - player.pos.z)).toBeGreaterThan(11);
      expect(Math.abs(x)).toBeLessThanOrEqual(map.bounds.x - 1.2 + 1e-6);
      expect(Math.abs(zz)).toBeLessThanOrEqual(map.bounds.z - 1.2 + 1e-6);
      for (const c of map.colliders || []) {
        expect(Math.hypot(x - c.x, zz - c.z)).toBeGreaterThanOrEqual(c.r + 1.05 - 1e-6);
      }
    }
  }

  async function withMap(id, fn) {
    const game = sharedGame;
    game.backToMenu();
    game.selectMap(id);
    game.start();
    try {
      await fn(game);
    } finally {
      game.backToMenu();
      game.selectMap('backyard');
      game.start();
      game.zombies.reset();
      game.ctx.sunOrbs.spawn = vi.fn();
    }
  }

  it('后院没有 zombieSpawnPoints：只在 ±21.5 的边缘出生（离玩家 > 14）', () => {
    const game = sharedGame;
    const zm = game.zombies;
    expect(game.map.id).toBe('backyard');
    expect(game.map.zombieSpawnPoints).toBeUndefined();
    zm.startWave(1);
    zm.queue = new Array(20).fill('normal');
    expect(pump(12)).toBe(12);
    const px = game.player.pos.x;
    const pz = game.player.pos.z;
    for (const z of zm.zombies) {
      const x = z.root.position.x;
      const zz = z.root.position.z;
      const onEdge = Math.abs(Math.abs(x) - 21.5) < 1e-6 || Math.abs(Math.abs(zz) - 21.5) < 1e-6;
      expect(onEdge).toBe(true);
      expect(Math.hypot(x - px, zz - pz)).toBeGreaterThan(14 - 1e-6);
    }
  });

  it('雪地：落在 zombieSpawnPoints 附近、离玩家 > 11、不出 bounds、不被碰撞体压住', async () => {
    await withMap('snow', (game) => {
      const zm = game.zombies;
      expect(game.map.id).toBe('snow');
      expect(Array.isArray(game.map.zombieSpawnPoints)).toBe(true);
      expect(game.map.zombieSpawnPoints.length).toBeGreaterThan(0);
      zm.startWave(1);
      zm.queue = new Array(20).fill('normal');
      pump(10);
      assertSpawnsSane(game.map, game.player);
    });
  });

  it('沙城：同样遵守点位 + clearOfColliders 的约束', async () => {
    await withMap('dust', (game) => {
      const zm = game.zombies;
      expect(game.map.id).toBe('dust');
      zm.startWave(1);
      zm.queue = new Array(20).fill('normal');
      pump(10);
      assertSpawnsSane(game.map, game.player);
    });
  });

  it('clearOfColliders：把点推出碰撞圆，两轮迭代收敛', () => {
    const zm = sharedGame.zombies;
    const out = zm.clearOfColliders(0, 0, [{ x: 0, z: 0, r: 0.6 }]);
    expect(out.x).toBeCloseTo(0.6 + 1.05, 9);
    expect(out.z).toBe(0);
    expect(zm.clearOfColliders(5, 5, [{ x: 0, z: 0, r: 0.6 }])).toEqual({ x: 5, z: 5 });
    const both = zm.clearOfColliders(0, 0, [{ x: 0, z: 0, r: 0.2 }, { x: 0.5, z: 0, r: 0.2 }]);
    for (const c of [{ x: 0, z: 0, r: 0.2 }, { x: 0.5, z: 0, r: 0.2 }]) {
      expect(Math.hypot(both.x - c.x, both.z - c.z)).toBeGreaterThanOrEqual(c.r + 1.05 - 1e-9);
    }
  });

  it('Boss 出生：this.boss 指向它并触发 onBossSpawn（非 boss 不覆盖）', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(5);
    zm.queue = ['boss'];
    zm.spawnTimer = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.zombies.length).toBe(1);
    const z = zm.zombies[0];
    expect(z.type).toBe('boss');
    expect(zm.boss).toBe(z);
    expect(calls.onBossSpawn).toEqual([z]);
    zm.queue = ['normal'];
    zm.spawnTimer = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    expect(zm.boss).toBe(z);
    expect(calls.onBossSpawn.length).toBe(1);
  });

  it('Boss 血量吃第 5 波倍率：round(1450 × 1.44) = 2088', () => {
    const zm = sharedGame.zombies;
    zm.startWave(5);
    zm.queue = ['boss'];
    zm.spawnTimer = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    const boss = zm.zombies[0];
    expect(boss.maxHp).toBe(Math.round(1450 * 1.44));
    expect(boss.maxHp).toBe(Math.round(1450 * config.zombieHpMul(5)));
    expect(boss.scaleFactor).toBe(2.3); // 巨型骷髅
  });
});

describe('ZombieManager · 分离', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('两只重叠僵尸被对称推开到 (ra+rb)×0.95', () => {
    const zm = sharedGame.zombies;
    const a = spawnAt('normal', 0, 0);
    const b = spawnAt('normal', 0.2, 0);
    zm.applySeparation();
    expect(Math.abs(b.root.position.x - a.root.position.x)).toBeCloseTo((0.46 + 0.46) * 0.95, 9);
    expect((a.root.position.x + b.root.position.x) / 2).toBeCloseTo(0.1, 9);
  });

  it('dying 的不参与分离；已经分开的不动', () => {
    const zm = sharedGame.zombies;
    const a = spawnAt('normal', 0, 0);
    const b = spawnAt('normal', 0.1, 0);
    a.dying = true;
    zm.applySeparation();
    expect(a.root.position.x).toBe(0);
    expect(b.root.position.x).toBe(0.1);

    a.dying = false;
    a.root.position.set(0, 0, 0);
    b.root.position.set(3, 0, 0);
    zm.applySeparation();
    expect(a.root.position.x).toBe(0);
    expect(b.root.position.x).toBe(3);
  });

  it('不同半径按各自半径算最小间距（boss 0.9 + bucket 0.52）', () => {
    const zm = sharedGame.zombies;
    const a = spawnAt('boss', 0, 0);
    const b = spawnAt('bucket', 0.3, 0);
    zm.applySeparation();
    expect(Math.abs(b.root.position.x - a.root.position.x)).toBeCloseTo((0.9 + 0.52) * 0.95, 9);
  });

  it('完全重合（d≈0）不产生 NaN', () => {
    const zm = sharedGame.zombies;
    const a = spawnAt('normal', 1, 1);
    const b = spawnAt('normal', 1, 1);
    zm.applySeparation();
    expect(Number.isFinite(a.root.position.x)).toBe(true);
    expect(Number.isFinite(b.root.position.x)).toBe(true);
  });
});

describe('ZombieManager · damageArea', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  function tough() {
    const zm = sharedGame.zombies;
    zm.hpMul = 10; // 普通僵尸不至于一发就死，方便量伤害
    return spawnAt('normal', 0, 0);
  }

  it('中心命中 100% 伤害，返回命中数 1，并设置 stagger 0.18', () => {
    const zm = sharedGame.zombies;
    const a = tough();
    expect(zm.damageArea({ x: 0, z: 0 }, 5, 10, null, 1)).toBe(1);
    expect(a.hp).toBe(a.maxHp - 10);
    expect(a.stagger).toBe(0.18);
  });

  it('边缘衰减 45%：falloff = 1 - clamp((d-0.35R)/R, 0, 1)×0.55', () => {
    const zm = sharedGame.zombies;
    const a = tough();
    a.root.position.set(4.5, 0, 0); // R=5、0.35R=1.75
    zm.damageArea({ x: 0, z: 0 }, 5, 100, null, 1);
    const falloff = 1 - Math.min(1, (4.5 - 1.75) / 5) * 0.55;
    expect(falloff).toBeCloseTo(1 - 0.55 * 0.55, 10);
    expect(a.hp).toBeCloseTo(a.maxHp - 100 * falloff, 6);
    // 半径 + zombie.radius 之外的不算
    a.root.position.set(4.47, 0, 0);
    expect(zm.damageArea({ x: 0, z: 0 }, 4, 5, null, 1)).toBe(0);
  });

  it('headTarget 乘 headMul，其他僵尸不乘', () => {
    const zm = sharedGame.zombies;
    zm.hpMul = 10;
    const a = spawnAt('normal', 0, 0);
    const b = spawnAt('normal', 1, 0);
    zm.damageArea({ x: 0, z: 0 }, 5, 10, b, 3);
    expect(a.hp).toBe(a.maxHp - 10); // d=0，落在 0.35R 内，全额
    expect(b.hp).toBe(b.maxHp - 30);
    const c = spawnAt('normal', 0, 0);
    zm.damageArea({ x: 0, z: 0 }, 5, 10, c, undefined); // 缺省 headMul=1
    expect(c.hp).toBe(c.maxHp - 10);
  });

  it('alive=false / dying 的跳过且不计数', () => {
    const zm = sharedGame.zombies;
    const a = tough();
    a.dying = true;
    expect(zm.damageArea({ x: 0, z: 0 }, 5, 10, null, 1)).toBe(0);
    a.dying = false;
    a.alive = false;
    expect(zm.damageArea({ x: 0, z: 0 }, 5, 10, null, 1)).toBe(0);
  });

  it('致死走 handleKill（计分 + 掉阳光），重复结算不会翻倍', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    const suns = [];
    sharedGame.ctx.sunOrbs.spawn = (pos, n) => suns.push([pos.clone(), n]);
    const a = spawnAt('normal', 0, 0);
    expect(zm.damageArea({ x: 0, z: 0 }, 5, 999, null, 1)).toBe(1);
    expect(a.dying).toBe(true);
    expect(calls.onKill.length).toBe(1);
    expect(calls.onKill[0][1]).toBe(100);
    expect(calls.onKill[0][2]).toBe(false);
    expect(suns.length).toBe(1);
    expect(suns[0][1]).toBe(1); // 普通僵尸 1 颗阳光
    zm.damageArea({ x: 0, z: 0 }, 5, 999, null, 1);
    expect(calls.onKill.length).toBe(1);
    expect(suns.length).toBe(1);
  });

  it('骷髅击杀掉 3 颗阳光（与铁桶同级，按耐打程度给）', async () => {
    const THREE = await import('three');
    const prev = zombieModel.skeleton;
    const bone = new THREE.Bone();
    bone.name = 'root';
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const scene = new THREE.Group();
    scene.add(mesh);
    zombieModel.skeleton = { ready: true, failed: false, scene, clips: [] };
    try {
      const zm = clearField();
      const suns = [];
      sharedGame.ctx.sunOrbs.spawn = (pos, n) => suns.push(n);
      const sk = spawnAt('skeleton', 0, 0);
      zm.damageArea({ x: 0, z: 0 }, 5, 9999, sk, 1);
      expect(sk.dying).toBe(true);
      expect(suns).toEqual([3]);
      zm.reset();
    } finally {
      zombieModel.skeleton = prev;
    }
  });

  it('爆头致死：分数 ×1.5（cone 200 → 300）', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    const cone = spawnAt('cone', 0, 0);
    zm.damageArea({ x: 0, z: 0 }, 5, 9999, cone, 3);
    expect(calls.onKill.length).toBe(1);
    expect(calls.onKill[0][1]).toBe(300);
    expect(calls.onKill[0][2]).toBe(true);
  });

  it('一次爆炸结算多只，返回命中数，各自掉阳光', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.hpMul = 1;
    const list = [spawnAt('bucket', 0, 0), spawnAt('bucket', 0.6, 0), spawnAt('bucket', 1.2, 0)];
    expect(zm.damageArea({ x: 0, z: 0 }, 6, 9999, list[1], 3)).toBe(3);
    expect(calls.onKill.length).toBe(3);
    expect(sharedGame.ctx.sunOrbs.spawn.mock.calls.length).toBe(3);
    for (const c of sharedGame.ctx.sunOrbs.spawn.mock.calls) expect(c[1]).toBe(3);
    // 中间那只被当成 headTarget：350×1.5 = 525，两边 350
    expect(calls.onKill.map((c) => c[1]).sort((x, y) => x - y)).toEqual([350, 350, 525]);
  });
});

describe('ZombieManager · handleKill', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('阳光数量：normal 1 / cone 2 / bucket 3 / boss 7，分数按 config', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    const cases = [
      ['normal', 1, 100],
      ['cone', 2, 200],
      ['bucket', 3, 350],
      ['boss', 7, 2500],
    ];
    for (const [type, orbs, score] of cases) {
      const z = spawnAt(type, 0, 0);
      const before = calls.onKill.length;
      zm.handleKill(z, false);
      const spawn = sharedGame.ctx.sunOrbs.spawn;
      const last = spawn.mock.calls[spawn.mock.calls.length - 1];
      expect(last[1]).toBe(orbs);
      expect(last[0].x).toBeCloseTo(z.root.position.x, 9);
      expect(last[0].z).toBeCloseTo(z.root.position.z, 9);
      expect(calls.onKill.length).toBe(before + 1);
      expect(calls.onKill[before][1]).toBe(score);
    }
  });

  it('counted 幂等：同一只只结算一次，totalKills 只加一次', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    const z = spawnAt('normal', 0, 0);
    zm.handleKill(z, false);
    zm.handleKill(z, false);
    zm.handleKill(z, true);
    expect(calls.onKill.length).toBe(1);
    expect(zm.totalKills).toBe(1);
    expect(sharedGame.ctx.sunOrbs.spawn.mock.calls.length).toBe(1);
  });

  it('爆头计分 ×1.5 四舍五入：bucket 350→525、normal 100→150、boss 2500→3750', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.handleKill(spawnAt('bucket', 0, 0), true);
    zm.handleKill(spawnAt('normal', 0, 0), true);
    zm.handleKill(spawnAt('boss', 0, 0), true);
    expect(calls.onKill.map((c) => c[1])).toEqual([525, 150, 3750]);
    expect(calls.onKill.every((c) => c[2] === true)).toBe(true);
    expect(zm.totalKills).toBe(3);
  });

  it('Boss 死亡清空 this.boss、置 counted 并只结算一次', () => {
    const zm = sharedGame.zombies;
    const calls = collectCtx();
    zm.startWave(5);
    zm.queue = ['boss'];
    zm.spawnTimer = 0;
    zm.update(DT, sharedGame.player, sharedGame.map.colliders);
    const boss = zm.boss;
    expect(boss).toBeTruthy();
    zm.handleKill(boss, false);
    expect(zm.boss).toBe(null); // 清空 boss 指针
    expect(boss.counted).toBe(true); // counted 幂等标记
    expect(calls.onKill.length).toBe(1);
    zm.handleKill(boss, false); // 幂等：counted 已置位，不会再结算
    expect(calls.onKill.length).toBe(1);
    expect(sharedGame.ctx.sunOrbs.spawn.mock.calls.length).toBe(1);
  });
});

describe('ZombieManager · 查询', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('aliveCount 排除 dying，但数组里还在', () => {
    const zm = sharedGame.zombies;
    expect(zm.aliveCount()).toBe(0);
    const a = spawnAt('normal', 0, 0);
    spawnAt('normal', 1, 0);
    expect(zm.aliveCount()).toBe(2);
    a.dying = true;
    expect(zm.aliveCount()).toBe(1);
    expect(zm.zombies.length).toBe(2);
  });

  it('nearestTo：maxDist 内最近、严格小于边界、排除 dying/dead', () => {
    const zm = sharedGame.zombies;
    const far = spawnAt('normal', 0, 5);
    const near = spawnAt('normal', 0, 2);
    const p = { x: 0, z: 0 };
    expect(zm.nearestTo(p, 10)).toBe(near);
    expect(zm.nearestTo(p, 1.9)).toBe(null);
    expect(zm.nearestTo(p, 2)).toBe(null);
    expect(zm.nearestTo(p, 2.01)).toBe(near);
    near.dying = true;
    expect(zm.nearestTo(p, 10)).toBe(far);
    far.alive = false;
    expect(zm.nearestTo(p, 10)).toBe(null);
  });

  it('nearestTo 只看平面距离，忽略高度', () => {
    const zm = sharedGame.zombies;
    const a = spawnAt('normal', 3, 4); // 平面距离正好 5
    a.root.position.y = 9;
    expect(zm.nearestTo({ x: 0, z: 0 }, 5.01)).toBe(a);
    expect(zm.nearestTo({ x: 0, z: 0 }, 4.99)).toBe(null);
  });
});

describe('ZombieManager · 与 Game 的联动', () => {
  beforeAll(async () => {
    await boot();
  });
  beforeEach(() => {
    clearField();
    sharedGame.ctx.sunOrbs.spawn = vi.fn();
  });

  it('僵尸打玩家：Game.onZombieAttack 扣 def.damage，Boss 额外震屏', () => {
    const game = sharedGame;
    const zm = game.zombies;
    const boss = spawnAt('boss', 0, 0.5);
    game.player.pos.set(0, 0, 0);
    game.player.invuln = 0;
    game.player.hp = 100;
    boss.attackTimer = 0;
    zm.state = 'idle';
    zm.update(DT, game.player, game.map.colliders);
    expect(game.player.hp).toBe(100 - 26);
    expect(game.shakeAmp).toBeGreaterThan(0.3);
  });

  it('击杀走 Game.onKill：加分、加击杀数', () => {
    const game = sharedGame;
    game.stats = { score: 0, kills: 0, wave: 1 };
    game.zombies.handleKill(spawnAt('cone', 0, 0), false);
    expect(game.stats.score).toBe(200);
    expect(game.stats.kills).toBe(1);
    expect(game.zombies.totalKills).toBe(1);
  });

  it('Boss 血条：update 之后 HUD 拿到 hp/maxHp 比例', () => {
    const game = sharedGame;
    const zm = game.zombies;
    zm.startWave(5);
    zm.queue = ['boss'];
    zm.spawnTimer = 0;
    zm.update(DT, game.player, game.map.colliders);
    const boss = zm.boss;
    boss.hp = boss.maxHp * 0.25;
    // 血条是在 Game.update 里同步的，单独调 manager.update 不会碰 HUD
    game.update(DT);
    expect(game.__lastBossHp).not.toBe(null);
    expect(game.__lastBossHp).toBeCloseTo(0.25, 6);
  });

  it('呻吟：groanTimer 归零且有僵尸才播，音量随 boss/远近变化', () => {
    const game = sharedGame;
    const zm = game.zombies;
    const groan = vi.spyOn(game.sfx, 'groan').mockImplementation(() => {});
    const z = spawnAt('normal', 0, 0);
    game.player.pos.set(12, 0, 0);
    zm.state = 'idle';
    zm.groanTimer = 0.001;
    zm.update(DT, game.player, game.map.colliders);
    expect(groan).toHaveBeenCalledTimes(1);
    expect(groan.mock.calls[0][0]).toBeCloseTo(0.55, 6);
    // 呻吟会先推一帧僵尸 AI 再算声像：z 会被往前挪一点，所以按实际位置比
    expect(groan.mock.calls[0][1]).toBeCloseTo((z.root.position.x - game.player.pos.x) / 24, 6);
    expect(zm.groanTimer).toBeGreaterThanOrEqual(2.6);
    expect(zm.groanTimer).toBeLessThanOrEqual(6.5);

    clearField();
    spawnAt('boss', 0, 0);
    zm.groanTimer = 0.001;
    zm.update(DT, game.player, game.map.colliders);
    expect(groan.mock.calls[groan.mock.calls.length - 1][0]).toBeCloseTo(0.9, 6);
    expect(z).toBeTruthy();
  });

  it('场上没僵尸时 groanTimer 归零也不播', () => {
    const game = sharedGame;
    const zm = game.zombies;
    const groan = vi.spyOn(game.sfx, 'groan').mockImplementation(() => {});
    zm.state = 'idle';
    zm.groanTimer = 0.001;
    zm.update(DT, game.player, game.map.colliders);
    expect(groan).not.toHaveBeenCalled();
    expect(zm.groanTimer).toBeGreaterThanOrEqual(2.6);
  });
});
describe('ZombieManager · 骷髅（KayKit，雪地专属）', () => {
  const SK = 'skeleton';

  // 骷髅走独立模型：测试里给它一个最小可用的骨骼场景 + 一串动画名，
  // 好覆盖 buildRig 选模型、buildAnimations 选动作、以及同屏上限这三条逻辑。
  async function withSkeletonModel(fn) {
    const THREE = await import('three');
    const prev = zombieModel.skeleton;
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    const mesh = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(0.5, 2.1, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xdedede })
    );
    mesh.name = 'Skeleton_Minion_Body';
    mesh.add(rootBone);
    mesh.bind(new THREE.Skeleton([rootBone]));
    const scene = new THREE.Group();
    scene.add(mesh);
    const mk = (name) => new THREE.AnimationClip(name, 1, [
      new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.99]),
    ]);
    zombieModel.skeleton = {
      ready: true,
      failed: false,
      scene,
      clips: ['Idle_Combat', 'Walking_A', '1H_Melee_Attack_Chop', 'Death_A', 'Hit_A'].map(mk),
    };
    try {
      return await fn();
    } finally {
      zombieModel.skeleton = prev;
    }
  }

  it('skeleton 类型用骷髅模型，动作名走 KayKit 命名', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      clearField();
      const z = game.zombies.spawnOne.call(
        Object.assign(game.zombies, { queue: [SK] }), game.player
      );
      expect(z.type).toBe(SK);
      expect(z.isSkeleton).toBe(true);
      expect(z.mixer).toBeTruthy();
      expect(z.current).toBe('idle');
      // 五段动作都按 KayKit 的名字找到并建好
      expect(Object.keys(z.actions).sort()).toEqual(['attack', 'die', 'hit', 'idle', 'walk']);
      expect(z.actions.walk.getClip().name).toBe('Walking_A');
      expect(z.actions.attack.getClip().name).toBe('1H_Melee_Attack_Chop');
      expect(z.actions.die.getClip().name).toBe('Death_A');
      z.dispose();
    });
  });

  it('骷髅挂的是骷髅几何体，不是僵尸 glb', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      clearField();
      const z = game.zombies.spawnOne.call(
        Object.assign(game.zombies, { queue: [SK] }), game.player
      );
      const names = [];
      z.body.traverse((n) => { if (n.isMesh) names.push(n.name); });
      expect(names).toContain('Skeleton_Minion_Body');
      z.dispose();
    });
  });

  it('非雪地地图：startWave 把骷髅从队列里滤掉', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      const zm = clearField();
      const prevMap = game.ctx.map;
      game.ctx.map = { ...prevMap, id: 'backyard' };
      // 反复开波，anyon 队列都必须没有 skeleton
      for (let n = 4; n <= 12; n++) {
        zm.startWave(n);
        expect(zm.queue.includes(SK), `wave ${n} on backyard`).toBe(false);
      }
      game.ctx.map = prevMap;
      zm.reset();
    });
  });

  it('雪地地图：第 4 波起队列里出现骷髅，且不超过上限', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      const zm = clearField();
      const prevMap = game.ctx.map;
      game.ctx.map = { ...prevMap, id: 'snow' };
      zm.startWave(4);
      expect(zm.queue.filter((t) => t === SK).length).toBeGreaterThan(0);
      for (let n = 5; n <= 30; n++) {
        zm.startWave(n);
        expect(zm.queue.filter((t) => t === SK).length, `wave ${n}`).toBeLessThanOrEqual(config.SKELETON_MAX_ALIVE);
      }
      game.ctx.map = prevMap;
      zm.reset();
    });
  });

  it('骷髅模型没加载好时不刷骷髅，但队列里仍保留（加载完能补上）', async () => {
    // glb 是异步的，开局很快时骨架可能还没 ready。这里不能把骷髅从队列里滤掉——
    // 否则整波都刷不出骷髅（曾经这么写过，E2E 间歇失败）。
    const saved = zombieModel.skeleton;
    zombieModel.skeleton = { ready: false, failed: true, scene: null, clips: [] };
    try {
      const game = sharedGame;
      const zm = clearField();
      const prevMap = game.ctx.map;
      game.ctx.map = { ...prevMap, id: 'snow' };
      zm.startWave(8);
      // 队列里要还留着骷髅
      expect(zm.queue.filter((t) => t === SK).length).toBeGreaterThan(0);
      // 但 spawnOne 不会真的刷出来，而是改刷别的类型
      zm.queue = [SK, 'normal'];
      const z = zm.spawnOne(game.player);
      expect(z.type).toBe('normal');
      expect(zm.queue).toEqual([SK]);
      game.ctx.map = prevMap;
      zm.reset();
    } finally {
      zombieModel.skeleton = saved;
    }
  });

  it('同屏骷髅到上限后，spawnOne 改刷别的类型', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      const zm = clearField();
      // 先刷满上限
      for (let i = 0; i < config.SKELETON_MAX_ALIVE; i++) {
        zm.queue = [SK];
        const z = zm.spawnOne(game.player);
        expect(z.type).toBe(SK);
      }
      // 队列头部是骷髅，但已经到上限 → 应该改刷后面的 normal
      zm.queue = [SK, 'normal'];
      const next = zm.spawnOne(game.player);
      expect(next.type).toBe('normal');
      // 骷髅留着，下次再刷
      expect(zm.queue).toEqual([SK]);
      zm.reset();
    });
  });

  it('队列里只剩骷髅且已到上限时，spawnOne 返回 null 且不丢怪', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      const zm = clearField();
      for (let i = 0; i < config.SKELETON_MAX_ALIVE; i++) {
        zm.queue = [SK];
        zm.spawnOne(game.player);
      }
      zm.queue = [SK, SK];
      expect(zm.spawnOne(game.player)).toBeNull();
      expect(zm.queue).toEqual([SK, SK]);
      zm.reset();
    });
  });
});

describe('ZombieManager · 巨型骷髅 Boss', () => {
  async function withSkeletonModel(fn) {
    const THREE = await import('three');
    const prev = zombieModel.skeleton;
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    const hand = new THREE.Bone();
    hand.name = 'handr';
    const slot = new THREE.Bone();
    slot.name = 'handslotr';
    hand.add(slot);
    rootBone.add(hand);
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.5, 2.166, 0.3), new THREE.MeshStandardMaterial());
    mesh.name = 'Skeleton_Minion_Body';
    mesh.add(rootBone);
    mesh.bind(new THREE.Skeleton([rootBone, hand, slot]));
    const scene = new THREE.Group();
    scene.add(mesh);
    zombieModel.skeleton = { ready: true, failed: false, scene, clips: [] };
    try {
      return await fn();
    } finally {
      zombieModel.skeleton = prev;
    }
  }

  it('Boss 用骷髅模型，且木棒挂在 handslotr 骨骼上', async () => {
    await withSkeletonModel(() => {
      const zm = clearField();
      const z = spawnAt('boss', 0, 0);
      expect(z.isSkeleton).toBe(true);
      const slot = z.body.getObjectByName('handslotr');
      expect(slot).toBeTruthy();
      expect(z.hat.parent).toBe(slot);
      zm.reset();
    });
  });

  it('Boss 出现不受地图限制（三张地图都会出）', async () => {
    await withSkeletonModel(() => {
      const game = sharedGame;
      const zm = clearField();
      const prevMap = game.ctx.map;
      for (const id of ['backyard', 'snow', 'dust']) {
        game.ctx.map = { ...prevMap, id };
        zm.startWave(5); // 第 5 波必有 boss
        expect(zm.queue.filter((t) => t === 'boss').length, `map ${id}`).toBe(1);
      }
      game.ctx.map = prevMap;
      zm.reset();
    });
  });

  it('骷髅模型没就绪时 Boss 也不会白模刷出来（留在队列等）', async () => {
    const saved = zombieModel.skeleton;
    zombieModel.skeleton = { ready: false, failed: true, scene: null, clips: [] };
    try {
      const zm = clearField();
      zm.queue = ['boss', 'normal'];
      const z = zm.spawnOne(sharedGame.player);
      expect(z.type).toBe('normal');
      expect(zm.queue).toEqual(['boss']);
      zm.reset();
    } finally {
      zombieModel.skeleton = saved;
    }
  });

  it('Boss 是 4.5 米级的巨型骷髅，命中球按骷髅口径', async () => {
    const THREE = await import('three');
    await withSkeletonModel(() => {
      const zm = clearField();
      const z = spawnAt('boss', 0, 0);
      // 2.166 × 0.9 × 2.3 ≈ 4.48 米
      expect(2.166 * 0.9 * z.scaleFactor).toBeGreaterThan(4.2);
      expect(2.166 * 0.9 * z.scaleFactor).toBeLessThan(4.8);
      // 骷髅口径：胸口 0.90、头部 1.68，再乘 scaleFactor
      expect(z.getChest(new THREE.Vector3()).y).toBeCloseTo(0.90 * 2.3, 6);
      expect(z.getHead(new THREE.Vector3()).y).toBeCloseTo(1.68 * 2.3, 6);
      zm.reset();
    });
  });
});
