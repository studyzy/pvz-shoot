// 夜之森林的奇幻单位与 BOSS 轮换：数值、动画族、命中球、掉落、波次守恒。
// 这些是纯数据 + 纯函数的测试，不依赖 WebGL。
import { describe, it, expect } from 'vitest';
import {
  ZOMBIES,
  BOSS_ROTATION,
  MAP_BOSSES,
  bossForWave,
  wavePlan,
  waveTotal,
  FANTASY_PLAN,
  SKELETON_MAPS,
} from '../../src/config.js';
import { ANIM_FAMILIES, ANIM_NAMES, PROC_RIG_MODELS } from '../../src/entities/Zombie.js';
import { MODELS } from '../../src/entities/ZombieModel.js';

const FANTASY_IDS = [
  'goblin', 'demon3', 'slime', 'pink-slime', 'slimelet', 'green-blob',
  'bones', 'ghost', 'ghost-skull', 'wolf', 'spider', 'rat', 'bat',
];
const BOSS_IDS = ['gargantuar', 'mushroomKing', 'dragon'];

describe('奇幻单位 · 数值与模型', () => {
  it('12 种奇幻单位都已登记', () => {
    for (const id of FANTASY_IDS) expect(ZOMBIES[id], id).toBeTruthy();
  });

  it('每种奇幻单位都能在 MODELS 里找到模型，且带 targetHeight 归一化', () => {
    for (const id of FANTASY_IDS) {
      const def = ZOMBIES[id];
      const mod = MODELS[def.model];
      expect(mod, `${id} -> MODELS.${def.model}`).toBeTruthy();
      // 新模型一律走包围盒归一化，不手写 scale（aigc 素材有 100× Armature 缩放）
      expect(mod.targetHeight, `${def.model}.targetHeight`).toBeGreaterThan(0);
      expect(typeof mod.url).toBe('string');
    }
  });

  it('每种奇幻单位都配了阳光掉落与命中半径', () => {
    for (const id of FANTASY_IDS) {
      const def = ZOMBIES[id];
      expect(typeof def.sun, `${id}.sun`).toBe('number');
      if (id === 'slimelet') expect(def.sun).toBe(0);
      else expect(def.sun).toBeGreaterThan(0);
      expect(def.radius).toBeGreaterThan(0);
      expect(def.hp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.damage).toBeGreaterThan(0);
    }
  });

  it('蝙蝠是唯一的空中奇幻单位，且踩了气球的配额规则', () => {
    expect(ZOMBIES.bat.airborne).toBe(true);
    expect(ZOMBIES.bat.airHeight).toBeGreaterThan(1.5);
    for (const id of FANTASY_IDS) {
      if (id === 'bat') continue;
      expect(ZOMBIES[id].airborne, `${id} 不该飞`).toBeFalsy();
    }
  });

  it('粉史莱姆会分裂，分裂产物存在且不再分裂', () => {
    expect(ZOMBIES['pink-slime'].split.into).toBe('slimelet');
    expect(ZOMBIES['pink-slime'].split.count).toBe(2);
    expect(ZOMBIES.slimelet).toBeTruthy();
    expect(ZOMBIES.slimelet.split).toBeUndefined();
  });

  it('绿块有塑料护甲（弹开豌豆），且护甲材质在表里', () => {
    expect(ZOMBIES['green-blob'].armor).toBeTruthy();
    expect(['plastic', 'metal', 'buffalo']).toContain(ZOMBIES['green-blob'].armor.material);
  });
});

describe('奇幻单位 · 动画族', () => {
  it('每个带模型的僵尸类型都挂了动画族，或明确走程序化骨架', () => {
    for (const [id, def] of Object.entries(ZOMBIES)) {
      const modelId = def.model || 'zombie';
      // 二选一：有 clip 的走动画族；没有 clip 的（僵尸博士）必须挂进 PROC_RIG_MODELS，
      // 否则模型会停在绑定姿势——这正是「加了新模型却站桩滑动」的老坑。
      const covered = !!ANIM_FAMILIES[modelId] || PROC_RIG_MODELS.has(modelId);
      expect(covered, `${id} 的模型 ${modelId} 既没挂动画族也不在 PROC_RIG_MODELS 里`).toBe(true);
      expect(!!ANIM_FAMILIES[modelId] && PROC_RIG_MODELS.has(modelId),
        `${id} 的模型 ${modelId} 同时挂了动画族和程序化骨架，只能选一个`).toBe(false);
    }
  });

  it('每个用到的动画族都有完整候选名（idle/walk/attack/die/hit）', () => {
    const used = new Set(Object.values(ANIM_FAMILIES));
    for (const fam of used) {
      const names = ANIM_NAMES[fam];
      expect(names, fam).toBeTruthy();
      for (const k of ['idle', 'walk', 'attack', 'die', 'hit']) {
        expect(Array.isArray(names[k]), `${fam}.${k}`).toBe(true);
        expect(names[k].length).toBeGreaterThan(0);
      }
    }
  });

  it('蝙蝠用 Bat_* 命名族（它没有 HitReact，得走 Bat_Hit）', () => {
    expect(ANIM_FAMILIES.bat).toBe('bat');
    expect(ANIM_NAMES.bat.hit).toContain('bat_hit');
    expect(ANIM_NAMES.bat.walk).toContain('bat_flying');
  });

  it('带 Fast_Flying 的模型不自动变成飞行单位（goleling 这类地面怪也有这组 clip）', () => {
    const flyingFam = ANIM_FAMILIES.ghost;
    expect(flyingFam).toBe('flying');
    // ghost 的动画族里有 fast_flying，但飞行与否只由 def.airborne 决定
    expect(ANIM_NAMES.flying.walk).toContain('fast_flying');
    expect(ZOMBIES.ghost.airborne).toBeFalsy();
  });

  it('巨龙挂 flying 族：dragon-evolved.glb 里没有 Dragon_* 动画', () => {
    // 它的 clip 实际是 Flying_Idle / Fast_Flying / Headbutt / Death / HitReact。
    // 曾经按设计稿猜了一组 Dragon_* 名字，一个都取不到，巨龙永远停在 bind pose 站桩滑动。
    expect(ANIM_FAMILIES.dragon).toBe('flying');
    expect(ANIM_NAMES.dragon).toBeUndefined();
  });
});

describe('BOSS 轮换', () => {
  it('轮换表 4 只，第 1 只是巨人', () => {
    expect(BOSS_ROTATION.length).toBe(4);
    expect(BOSS_ROTATION[0]).toBe('gargantuar');
  });

  it('轮换表里每个类型都标了 def.boss 且有 title', () => {
    for (const id of BOSS_ROTATION) {
      expect(ZOMBIES[id], id).toBeTruthy();
      expect(ZOMBIES[id].boss, `${id}.boss`).toBe(true);
      expect(typeof ZOMBIES[id].title).toBe('string');
      expect(ZOMBIES[id].title.length).toBeGreaterThan(0);
    }
  });

  it('每 5 波一只，按表循环', () => {
    expect(bossForWave(1)).toBe(null);
    expect(bossForWave(4)).toBe(null);
    expect(bossForWave(5)).toBe('gargantuar');
    expect(bossForWave(10)).toBe('boss');
    expect(bossForWave(15)).toBe('mushroomKing');
    expect(bossForWave(20)).toBe('dragon');
    expect(bossForWave(25)).toBe('gargantuar'); // 循环回第一只
    expect(bossForWave(30)).toBe('boss');
  });

  it('后花园第 10 波换成僵尸博士，其余地图与波次不变', () => {
    // MAP_BOSSES 是地图专属覆盖表：只有插了 key 的那张图那一波会变
    expect(MAP_BOSSES.backyard[10]).toBe('zombieDoctor');
    expect(bossForWave(10, 'backyard')).toBe('zombieDoctor');
    // 同一波在别的图上仍是轮换表里的骷髅王
    for (const map of ['snow', 'dust', 'forest', undefined]) {
      expect(bossForWave(10, map), String(map)).toBe('boss');
    }
    // 后花园其它 BOSS 波不受影响（第 5/15/20/25 波仍是轮换）
    expect(bossForWave(5, 'backyard')).toBe('gargantuar');
    expect(bossForWave(15, 'backyard')).toBe('mushroomKing');
    expect(bossForWave(20, 'backyard')).toBe('dragon');
    expect(bossForWave(25, 'backyard')).toBe('gargantuar');
  });

  it('僵尸博士的数值与其它 BOSS 同档，且走程序化骨架', () => {
    const doc = ZOMBIES.zombieDoctor;
    expect(doc.boss).toBe(true);
    expect(doc.title).toBe('僵尸博士');
    expect(PROC_RIG_MODELS.has(doc.model)).toBe(true);
    // 和骷髅王同为第 10 波压力，数值对齐
    expect(doc.hp).toBe(ZOMBIES.boss.hp);
    expect(doc.damage).toBe(ZOMBIES.boss.damage);
    // Boss 级体型：和蘑菇王同档（约 3.2 米），但不是挡半个屏幕的巨人
    const height = 1.834 * 0.9 * doc.scale;
    expect(height).toBeGreaterThan(3);
    expect(height).toBeLessThan(3.4);
    // 比普通僵尸（1.85 米）高出一大截，远处一眼认得出
    expect(height).toBeGreaterThan(2.8);
  });

  it('非 5 的倍数永远不出 BOSS', () => {
    for (let n = 6; n <= 40; n++) {
      if (n % 5 === 0) continue;
      expect(bossForWave(n), `n=${n}`).toBe(null);
    }
  });

  it('三只新 BOSS 各自带一个机制参数，且都不新增系统', () => {
    expect(ZOMBIES.gargantuar.slam).toBeTruthy();
    expect(ZOMBIES.gargantuar.slam.range).toBeGreaterThan(2);
    expect(ZOMBIES.mushroomKing.duck).toBeTruthy();
    expect(ZOMBIES.dragon.dive).toBeTruthy();
    // 骷髅王保持原样，不额外加机制
    expect(ZOMBIES.boss.slam).toBeUndefined();
  });

  it('所有 BOSS 都能被风筝：速度低于玩家移速的一半', () => {
    for (const id of BOSS_ROTATION) {
      expect(ZOMBIES[id].speed, `${id}.speed`).toBeLessThan(2.7);
    }
  });
});

describe('森林波次', () => {
  it('FANTASY_PLAN 里的类型都真实存在', () => {
    for (const id of Object.keys(FANTASY_PLAN)) {
      expect(ZOMBIES[id], id).toBeTruthy();
    }
  });

  it('森林波次总量与普通地图完全一致（换皮不改难度曲线）', () => {
    for (let n = 1; n <= 40; n++) {
      const forest = wavePlan(n, 'forest');
      const legacy = wavePlan(n);
      expect(forest.length, `n=${n}`).toBe(legacy.length);
      expect(forest.length).toBe(waveTotal(n) + (bossForWave(n) ? 1 : 0));
    }
  });

  it('森林波次以奇幻族群为主，普通僵尸不超过非 Boss 20%', () => {
    for (let n = 5; n <= 30; n++) {
      const plan = wavePlan(n, 'forest');
      const normals = plan.filter((t) => t === 'normal').length;
      expect(normals, `n=${n} 普通僵尸占比`).toBeLessThanOrEqual(waveTotal(n) * 0.2);
      const fantasy = plan.filter((t) => FANTASY_IDS.includes(t)).length;
      if (n >= 5) expect(fantasy, `n=${n} 应该有奇幻单位`).toBeGreaterThan(0);
    }
  });

  it('森林第 1 波只出哥布林和史莱姆（不做教学，靠第一波自己说话）', () => {
    const plan = wavePlan(1, 'forest');
    const fantasy = plan.filter((t) => FANTASY_IDS.includes(t));
    expect(fantasy.length).toBeGreaterThan(0);
    for (const t of fantasy) expect(['goblin', 'slime']).toContain(t);
  });

  it('森林波次的 BOSS 与普通地图用的是同一张轮换表', () => {
    for (let n = 5; n <= 40; n += 5) {
      const plan = wavePlan(n, 'forest');
      const bosses = plan.filter((t) => ZOMBIES[t].boss);
      expect(bosses.length, `n=${n}`).toBe(1);
      expect(bosses[0]).toBe(bossForWave(n));
    }
  });

  it('不传 mapId 时保持原有僵尸波次（零回归）', () => {
    const plan = wavePlan(10);
    expect(plan.filter((t) => FANTASY_IDS.includes(t)).length).toBe(0);
    expect(plan.filter((t) => t === 'normal').length).toBe(4 + Math.floor(10 * 1.45));
  });

  it('新骷髅 type 叫 bones，不吃旧 skeleton 的地图白名单', () => {
    // skeleton 只在雪地图出；bones 是奇幻单位，森林图可以刷
    expect(SKELETON_MAPS).not.toContain('forest');
    expect(ZOMBIES.bones).toBeTruthy();
    expect(ZOMBIES.bones.model).toBe('bones');
    // 两者是不同的 type，避免新版 3dc 骷髅被旧版 9dc 的限流误伤
    expect(ZOMBIES.bones).not.toBe(ZOMBIES.skeleton);
  });
});
describe('后花园第 10 波的波次计划', () => {
  it('wavePlan 把僵尸博士排在第 10 波队首，其它地图第 10 波仍是骷髅王', async () => {
    const { wavePlan } = await import('../../src/config.js');
    for (let round = 0; round < 20; round++) {
      const yard = wavePlan(10, 'backyard');
      // BOSS 必须排队首：否则玩家要等十几只普通怪才见到它
      expect(yard[0]).toBe('zombieDoctor');
      expect(yard.filter((t) => t === 'zombieDoctor')).toHaveLength(1);
      // 别的图第 10 波不受影响
      expect(wavePlan(10, 'snow')[0]).toBe('boss');
      expect(wavePlan(10, 'dust')[0]).toBe('boss');
    }
    // 后花园第 5/15/20 波的 BOSS 仍然是轮换表里的那几只
    expect(wavePlan(5, 'backyard')[0]).toBe('gargantuar');
    expect(wavePlan(15, 'backyard')[0]).toBe('mushroomKing');
    expect(wavePlan(20, 'backyard')[0]).toBe('dragon');
  });

  it('总只数不受覆盖表影响（换 Boss 不改难度曲线）', () => {
    for (const n of [5, 10, 15, 20, 30]) {
      expect(wavePlan(n, 'backyard').length).toBe(wavePlan(n, 'snow').length);
    }
  });
});
