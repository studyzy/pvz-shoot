import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import * as config from '../../src/config.js';
import { ZombieManager } from '../../src/entities/ZombieManager.js';
import { zombieModel, initZombieModel } from '../../src/entities/ZombieModel.js';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return { ...actual, WebGLRenderer: class { constructor() { Object.assign(this, makeFakeRenderer()); } } };
});

let manager, ctx, player;
beforeAll(async () => {
  const { stubGltfLoader } = await import('../helpers/game.js');
  await stubGltfLoader();
  initZombieModel();
  await vi.waitFor(() => {
    for (const id of ['goblin', 'slime', 'pink-slime', 'wolf', 'rat', 'bat', 'alchemist']) expect(zombieModel[id].ready, id).toBe(true);
  });
});
beforeEach(() => {
  ctx = {
    scene: new THREE.Scene(), map: { id: 'forest', bounds: { x: 45, z: 45 }, colliders: [], zombieSpawnPoints: [[-20, 0], [20, 0]] },
    sfx: { dirt: vi.fn(), groan: vi.fn(), creature: vi.fn() }, particles: { burst: vi.fn() },
    sunOrbs: { spawn: vi.fn() }, hud: { showBanner: vi.fn() },
    onWaveStart: vi.fn(), onWaveClear: vi.fn(), onKill: vi.fn(), onBossSpawn: vi.fn(), onBossDead: vi.fn(), onZombieAttack: vi.fn(),
  };
  player = { pos: new THREE.Vector3(), yaw: 0 };
  manager = new ZombieManager(ctx);
  manager.startWave(12);
  manager.queue = [];
  manager.groanTimer = 100;
});
afterEach(() => { manager.reset(); vi.restoreAllMocks(); });
function spawn(type, x = 0, z = 0) {
  manager.queue = [type];
  const unit = manager.spawnOne(player);
  unit.root.position.set(x, 0, z);
  unit.spawnT = 1;
  vi.spyOn(unit, 'update').mockImplementation(() => {});
  return unit;
}
function kill(unit, source = 0) {
  unit.alive = false;
  unit.dying = true;
  unit.lastHitBy = source;
  manager.handleKill(unit, false);
}

describe('森林导演 · 配置与波次', () => {
  it('导演夹具所用的模型槽均已就绪', () => {
    for (const id of ['goblin', 'slime', 'pink-slime', 'wolf', 'rat', 'bat', 'alchemist']) expect(zombieModel[id].ready, id).toBe(true);
  });
  it('提供全部批准参数与四族元数据', () => {
    expect(config.FOREST).toEqual({ aimDistance: 30, intermission: 10, bossIntermission: 18, touchWeaponScale: 0.88, nearSound: 18 });
    for (const [family, ids] of Object.entries({ goblin: ['goblin', 'demon3'], slime: ['slime', 'pink-slime', 'slimelet', 'green-blob'], undead: ['bones', 'ghost', 'ghost-skull'], beast: ['wolf', 'spider', 'rat', 'bat'] })) {
      for (const id of ids) expect(config.ZOMBIES[id].family, id).toBe(family);
    }
    expect(config.ZOMBIES.bat.landing).toEqual({ period: 6, groundTime: 2, high: 2, ground: 0.2, telegraph: 0.7 });
    expect(config.ZOMBIES.dragon.dive.telegraph).toBe(0.7);
    expect(config.ZOMBIES.mushroomKing.duck.recover).toBe(1.2);
    expect(config.ZOMBIES.spider.ambush).toEqual({ range: 10, notice: 14, wake: 0.65 });
    expect(config.ZOMBIES.ghost.phase).toBe(true);
    expect(config.ZOMBIES['ghost-skull'].phase).toBe(true);
  });
  it('首波精确三哥布林、两史莱姆', () => {
    expect(config.wavePlan(1, 'forest').sort()).toEqual(['goblin', 'goblin', 'goblin', 'slime', 'slime']);
  });
  it('总量守恒且十二类型按门槛逐步全部出场', () => {
    const seen = new Set();
    for (let n = 1; n <= 60; n++) {
      const plan = config.wavePlan(n, 'forest');
      expect(plan.length).toBe(config.waveTotal(n) + (config.bossForWave(n) ? 1 : 0));
      for (const type of plan) {
        if (type === 'normal' || config.ZOMBIES[type].boss) continue;
        expect(n, type).toBeGreaterThanOrEqual(config.FANTASY_PLAN[type][0]);
        seen.add(type);
      }
      expect(plan.filter((t) => t === 'normal').length).toBeLessThanOrEqual(config.waveTotal(n) * 0.2);
      expect(plan).not.toContain('slimelet');
    }
    expect([...seen].sort()).toEqual(Object.keys(config.FANTASY_PLAN).sort());
  });
  it('每种类型在配置首波即可靠亮相，不受抽样洗牌漏掉', () => {
    for (const [id, [firstWave]] of Object.entries(config.FANTASY_PLAN)) {
      for (let i = 0; i < 20; i++) expect(config.wavePlan(firstWave, 'forest'), id).toContain(id);
    }
  });
  it('后期主族轮转约60%、辅族约25%、普通约15%，不泛滥贵兽或飞行', () => {
    const families = ['goblin', 'slime', 'undead', 'beast'];
    for (let n = 28; n <= 35; n++) {
      const list = config.wavePlan(n, 'forest').filter((id) => !config.ZOMBIES[id].boss);
      const primary = families[(n - 1) % 4];
      const secondary = families[n % 4];
      const count = (family) => list.filter((id) => config.ZOMBIES[id].family === family).length;
      expect(count(primary) / list.length).toBeGreaterThanOrEqual(0.55);
      expect(count(primary) / list.length).toBeLessThanOrEqual(0.65);
      expect(count(secondary) / list.length).toBeGreaterThanOrEqual(0.22);
      expect(count(secondary) / list.length).toBeLessThanOrEqual(0.3);
      expect(list.filter((id) => id === 'normal').length / list.length).toBeGreaterThanOrEqual(0.1);
      expect(list.filter((id) => id === 'wolf').length).toBeLessThanOrEqual(config.FANTASY_PLAN.wolf[2]);
      expect(list.filter((id) => id === 'bat').length).toBeLessThanOrEqual(config.FANTASY_PLAN.bat[2]);
    }
  });
  it('按真实血量含子体、保守击杀收入核算，不暗涨经济负担', () => {
    function budget(plan) {
      let hp = 0, sun = 0;
      for (const id of plan) {
        const def = config.ZOMBIES[id];
        hp += def.hp + (def.armor?.hp || 0);
        sun += def.sun ?? ({ cone: 2, bucket: 3, football: 3, skeleton: 3, balloon: 2 }[id] || 1);
        if (def.split) hp += config.ZOMBIES[def.split.into].hp * def.split.count;
      }
      return { hp, sun };
    }
    for (let n = 1; n <= 40; n++) {
      const forest = budget(config.wavePlan(n, 'forest'));
      const legacy = budget(config.wavePlan(n));
      expect(forest.hp / forest.sun, 'W' + n).toBeLessThanOrEqual(legacy.hp / legacy.sun * 1.2);
    }
    expect(config.ZOMBIES.slimelet.sun).toBe(0);
  });
});

describe('森林导演 · 出生与空中配额', () => {
  it('首波精确使用16–22米开场点，而不是全图点', () => {
    player.pos.z = 30;
    ctx.map.openingSpawnPoints = [[-4, 12], [4, 12]];
    ctx.map.zombieSpawnGroups = { goblin: [[-25, -10]] };
    manager.startWave(1);
    for (let i = 0; i < 5; i++) {
      const z = spawn(i < 3 ? 'goblin' : 'slime');
      // spawn() helper移回原点，改直接读取spawn事件中的位置。
      const p = ctx.particles.burst.mock.calls.at(-1)[0].pos;
      expect(ctx.map.openingSpawnPoints.some(([x, zz]) => Math.hypot(x - p.x, zz - p.z) < 0.01)).toBe(true);
      expect(Math.hypot(p.x - player.pos.x, p.z - player.pos.z)).toBeGreaterThanOrEqual(16);
      expect(z.wave).toBe(1);
    }
  });
  it('后续使用本族点，避脚边、过远、碰撞与边界外点', () => {
    ctx.map.zombieSpawnGroups = { slime: [[0, 0], [44, 44], [14, 0], [20, 0], [100, 0]] };
    ctx.map.colliders = [{ x: 14, z: 0, r: 2 }];
    manager.queue = ['slime'];
    const z = manager.spawnOne(player);
    expect(z.root.position.x).toBe(20);
    expect(z.root.position.z).toBe(0);
  });
  it('狼优先玩家当前相机侧翼，而不选正面点', () => {
    ctx.map.zombieSpawnGroups = { beast: [[0, -20], [20, 0]] };
    for (const yaw of [0, Math.PI / 2]) {
      player.yaw = yaw;
      manager.queue = ['wolf'];
      const z = manager.spawnOne(player);
      expect(Math.abs(z.root.position.x * Math.cos(yaw) - z.root.position.z * Math.sin(yaw))).toBeGreaterThan(18);
    }
  });
  it('狼本族没有侧翼时跨安全登记入口择侧，无侧点才回退本族', () => {
    const beast = [[21, 16], [18, 12], [23, 20]];
    const flank = [0, -20];
    ctx.map.zombieSpawnGroups = { beast, undead: [flank, [0, -4], [0, -24], [0, 60]] };
    ctx.map.zombieSpawnPoints = [];
    ctx.map.colliders = [{ x: 0, z: -24, r: 1 }];
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      player.yaw = yaw;
      expect(manager.forestSpawnPoint('wolf', player)).toEqual(flank);
    }
    player.yaw = 0;
    expect(beast).toContainEqual(manager.forestSpawnPoint('wolf', player));
    player.yaw = Math.PI / 2;
    ctx.map.zombieSpawnGroups.undead = [[22, 14]];
    expect(beast).toContainEqual(manager.forestSpawnPoint('wolf', player));
  });
  it('本族点全在脚边时用其它安全入口，而不是脚下刷怪', () => {
    ctx.map.zombieSpawnGroups = { goblin: [[0, 0]] };
    manager.queue = ['goblin'];
    const z = manager.spawnOne(player);
    expect(Math.hypot(z.root.position.x, z.root.position.z)).toBeGreaterThanOrEqual(10);
  });
  it('没有安全森林入口时暂缓出生，不丢队列或改成脚下随机刷', () => {
    ctx.map.zombieSpawnGroups = { goblin: [[0, 0]] };
    ctx.map.zombieSpawnPoints = [[1, 0]];
    manager.queue = ['goblin'];
    expect(manager.spawnOne(player)).toBe(null);
    expect(manager.queue).toEqual(['goblin']);
  });
  it('落地蝙蝠仍占空中类型配额，不会利用落地叠飞行群', () => {
    manager.airQuota = 1;
    const bat = spawn('bat');
    bat.airborne = false;
    expect(manager.airborneCount()).toBe(1);
    manager.queue = ['bat', 'goblin'];
    expect(manager.spawnOne(player).type).toBe('goblin');
    expect(manager.queue).toEqual(['bat']);
  });
  it('队首模型未就绪时update仍可先刷后续就绪类型', () => {
    const saved = zombieModel.bat.ready;
    try {
      zombieModel.bat.ready = false;
      manager.queue = ['bat', 'goblin'];
      manager.spawnTimer = 0;
      manager.update(0, player, []);
      expect(manager.zombies[0].type).toBe('goblin');
      expect(manager.queue).toEqual(['bat']);
    } finally { zombieModel.bat.ready = saved; }
  });
});

describe('森林导演 · 分裂权威与实体预算', () => {
  it('计数死亡进延迟队列，尸体回收后才生成继承倍率的两子体并同步', () => {
    const parent = spawn('pink-slime', 20, 0);
    const hpMul = manager.hpMul, speedMul = manager.speedMul;
    manager.onNetSpawn = vi.fn();
    kill(parent, 1);
    manager.handleKill(parent, true);
    expect(manager.pendingSplits.length).toBe(2);
    manager.update(0, player, []);
    expect(manager.zombies).toEqual([parent]);
    expect(ctx.onKill).toHaveBeenCalledTimes(1);
    expect(ctx.onKill.mock.calls[0][3]).toBe(1);
    manager.hpMul = 7; manager.speedMul = 3;
    parent.dead = true;
    manager.update(0, player, []);
    expect(manager.zombies.length).toBe(2);
    for (const child of manager.zombies) {
      expect(child.type).toBe('slimelet');
      expect(child.maxHp).toBe(Math.round(config.ZOMBIES.slimelet.hp * hpMul));
      expect(child.speed).toBeCloseTo(config.ZOMBIES.slimelet.speed * speedMul);
      expect(child.wave).toBe(parent.wave);
      expect(child.lastHitBy).toBe(1);
    }
    expect(manager.pendingSplits).toEqual([]);
    expect(manager.onNetSpawn).toHaveBeenCalledTimes(2);
    expect(manager.onNetSpawn.mock.calls[0][0].serialize().t).toBe('slimelet');
    expect(manager.state).toBe('spawning');
    expect(ctx.onWaveClear).not.toHaveBeenCalled();
  });
  it('实体数含尸体严格≤maxAlive和14，队满剩余子体等待不丢', () => {
    manager.maxAlive = 14;
    const parent = spawn('pink-slime');
    for (let i = 0; i < 13; i++) spawn('goblin', 15 + i, 10);
    kill(parent);
    manager.update(0, player, []);
    expect(manager.zombies.length).toBe(14);
    parent.dead = true;
    manager.update(0, player, []);
    expect(manager.zombies.length).toBe(14);
    expect(manager.pendingSplits.length).toBe(1);
    manager.zombies[0].dead = true;
    manager.update(0, player, []);
    expect(manager.zombies.length).toBe(14);
    expect(manager.pendingSplits.length).toBe(0);
  });
  it('maxAlive比14低时仍遵守当波上限', () => {
    const parent = spawn('pink-slime');
    manager.maxAlive = 1;
    kill(parent); parent.dead = true;
    manager.update(0, player, []);
    expect(manager.zombies.length).toBe(1);
    expect(manager.pendingSplits.length).toBe(1);
  });
  it('子体模型暂未就绪时队列保留、无早清波，加载恢复继续生成', () => {
    const parent = spawn('pink-slime');
    kill(parent); parent.dead = true;
    const saved = zombieModel.slime.ready;
    try {
      zombieModel.slime.ready = false;
      manager.update(0, player, []);
      manager.update(0, player, []);
      expect(manager.pendingSplits.length).toBe(2);
      expect(manager.state).toBe('spawning');
      expect(ctx.onWaveClear).not.toHaveBeenCalled();
      zombieModel.slime.ready = true;
      manager.update(0, player, []);
      expect(manager.zombies.length).toBe(2);
    } finally { zombieModel.slime.ready = saved; }
  });
  it('Manager生成的粉体被燃烧击杀时沿真实上下文结算并分裂', () => {
    const parent = spawn('pink-slime', 20, 0);
    parent.update.mockRestore();
    parent.hp = 1; parent.burnDps = 100; parent.burnTimer = 1; parent.burnTickT = 0; parent.burnSource = 1;
    manager.update(0.01, player, []);
    expect(parent.dying).toBe(true);
    expect(parent.counted).toBe(true);
    expect(manager.pendingSplits.length).toBe(2);
    expect(ctx.onKill.mock.calls[0][3]).toBe(1);
  });
  it('子体不再分裂、不再掉阳光，母体收入只付一次', () => {
    const parent = spawn('pink-slime');
    kill(parent); parent.dead = true;
    manager.update(0, player, []);
    for (const child of manager.zombies) { kill(child); manager.handleKill(child, true); }
    expect(ctx.sunOrbs.spawn.mock.calls.map((c) => c[1])).toEqual([1]);
    expect(manager.pendingSplits.length).toBe(0);
    expect(manager.totalKills).toBe(3);
  });
  it('reset和转remote清除pending，remote不得重复结算/分裂', () => {
    const parent = spawn('pink-slime'); kill(parent);
    manager.reset();
    expect(manager.pendingSplits).toEqual([]);
    const other = spawn('pink-slime'); kill(other);
    manager.setRemote(true);
    expect(manager.pendingSplits).toEqual([]);
    const calls = ctx.onKill.mock.calls.length;
    other.counted = false;
    manager.handleKill(other, false);
    expect(ctx.onKill).toHaveBeenCalledTimes(calls);
    expect(manager.pendingSplits).toEqual([]);
  });
});

describe('森林导演 · 休整与空间声音', () => {
  it.each([[3, false, 10], [5, false, 18], [3, true, 10], [10, true, 18]])('森林W%i duo=%s休整=%i秒', (wave, duo, seconds) => {
    manager.setDuo(duo); manager.startWave(wave); manager.queue = [];
    manager.update(0, player, []);
    expect(manager.intermission).toBe(seconds);
    expect(manager.state).toBe('intermission');
    expect(manager.skipIntermission()).toBe(true);
    expect(manager.wave).toBe(wave + 1);
    expect(manager.skipIntermission()).toBe(false);
  });
  it('其它地图保持6.5/双人5秒；idle、remote不能跳波', () => {
    ctx.map.id = 'backyard'; manager.startWave(3); manager.queue = [];
    manager.update(0, player, []); expect(manager.intermission).toBe(6.5);
    manager.setDuo(true); manager.startWave(3); manager.queue = [];
    manager.update(0, player, []); expect(manager.intermission).toBe(config.DUO.intermission);
    manager.setRemote(true); manager.state = 'intermission'; expect(manager.skipIntermission()).toBe(false);
    manager.setRemote(false); manager.state = 'idle'; expect(manager.skipIntermission()).toBe(false);
  });
  it('近威胁优先并按相机right声像旋转，距离衰减且排除尸体', () => {
    spawn('goblin', 12, 0); const near = spawn('wolf', 4, 0); const dead = spawn('rat', 1, 0); dead.dying = true;
    manager.state = 'idle'; manager.groanTimer = 0;
    manager.update(0, player, []);
    expect(ctx.sfx.creature).toHaveBeenCalledTimes(1);
    const [family, volume, pan] = ctx.sfx.creature.mock.calls[0];
    expect(family).toBe('beast'); expect(volume).toBeGreaterThan(0); expect(pan).toBeCloseTo(1);
    near.root.position.set(0, 0, -8); player.yaw = Math.PI / 2;
    manager.groanTimer = 0; manager.update(0, player, []);
    expect(ctx.sfx.creature.mock.calls[1][1]).toBeLessThan(volume);
    expect(ctx.sfx.creature.mock.calls[1][2]).toBeCloseTo(1);
    expect(ctx.sfx.groan).not.toHaveBeenCalled();
  });
  it('18米边界仍可听，外面与死亡单位不抢声音', () => {
    const z = spawn('goblin', 18, 0); manager.state = 'idle'; manager.groanTimer = 0;
    manager.update(0, player, []); expect(ctx.sfx.creature).toHaveBeenCalledTimes(1);
    z.root.position.x = 19; manager.groanTimer = 0; manager.update(0, player, []);
    expect(ctx.sfx.creature).toHaveBeenCalledTimes(1);
  });
  it('旧sfx也不会播放森林远怪或尸体的声，仍选最近威胁', () => {
    delete ctx.sfx.creature;
    const corpse = spawn('rat', 0, 0); corpse.dying = true;
    spawn('goblin', 25, 0); const near = spawn('wolf', 4, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    manager.groanTimer = 0; manager.update(0, player, []);
    expect(ctx.sfx.groan).toHaveBeenCalledWith(0.55, near.root.position.x / 24);
    near.dying = true; manager.groanTimer = 0; manager.update(0, player, []);
    expect(ctx.sfx.groan).toHaveBeenCalledTimes(1);
  });
  it('没有creature方法或族元数据时沿用旧groan', () => {
    delete ctx.sfx.creature; spawn('goblin', 4, 0); manager.state = 'idle'; manager.groanTimer = 0;
    manager.update(0, player, []); expect(ctx.sfx.groan).toHaveBeenCalledTimes(1);
    manager.reset(); ctx.sfx.creature = vi.fn(); spawn('normal', 5, 0); manager.groanTimer = 0;
    manager.update(0, player, []); expect(ctx.sfx.groan).toHaveBeenCalledTimes(2); expect(ctx.sfx.creature).not.toHaveBeenCalled();
  });
});
