import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TUNING,
  WEAPONS,
  STARTER_WEAPONS,
  LOOT_WEAPONS,
  ZOMBIES,
  COLORS,
  wavePlan,
  waveMaxAlive,
  waveSpawnInterval,
  zombieHpMul,
  zombieSpeedMul,
  SKELETON_MAX_ALIVE,
  SKELETON_MAPS,
  ARMOR_MATERIALS,
  AIR_QUOTA_RATIO,
  waveAirQuota,
  bossForWave,
  BOSS_ROTATION,
  waveTotal,
} from '../../src/config.js';
import { MODELS } from '../../src/entities/ZombieModel.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config / TUNING', () => {
  it('关键手感/经济数值被锁定（改动必须同步 docs/GAMEPLAY.md）', () => {
    expect(TUNING.playerSpeed).toBe(5.4);
    expect(TUNING.playerHeight).toBe(1.66);
    expect(TUNING.gravity).toBe(21);
    expect(TUNING.jumpSpeed).toBe(6.6);
    expect(TUNING.maxHealth).toBe(100);
    expect(TUNING.headshotMul).toBe(3);
    expect(TUNING.startSun).toBe(60);
    expect(TUNING.maxSun).toBe(300);
    expect(TUNING.sunPerOrb).toBe(5);
    expect(TUNING.sunOrbTtl).toBe(18);
  });

  it('数值关系自洽：出生阳光不超过上限、僵尸同屏上限不超过 14', () => {
    expect(TUNING.startSun).toBeLessThanOrEqual(TUNING.maxSun);
    expect(TUNING.arenaHalf).toBeGreaterThan(0);
  });
});

describe('config / WEAPONS 数据完整性', () => {
  it('id 全局唯一', () => {
    const ids = WEAPONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每把武器都有完整必填字段且类型正确', () => {
    for (const w of WEAPONS) {
      expect(typeof w.id, w.id).toBe('string');
      expect(typeof w.name, w.id).toBe('string');
      expect(typeof w.short, w.id).toBe('string');
      expect(typeof w.cost, w.id).toBe('number');
      expect(typeof w.cooldown, w.id).toBe('number');
      expect(typeof w.damage, w.id).toBe('number');
      expect(typeof w.recoil, w.id).toBe('number');
      expect(typeof w.auto, w.id).toBe('boolean');
      expect(typeof w.starter, w.id).toBe('boolean');
      expect(typeof w.model, w.id).toBe('string');
      expect(typeof w.color, w.id).toBe('number');
      expect(['pea', 'lob', 'hitscan', 'shield']).toContain(w.kind);
      // 坚果墙是护盾，不是输出武器：damage 0，只有 shieldHp
      if (w.kind === 'shield') {
        expect(w.damage, w.id).toBe(0);
        expect(w.shieldHp, w.id).toBeGreaterThan(0);
      } else {
        expect(w.damage, w.id).toBeGreaterThan(0);
      }
      expect(w.cooldown, w.id).toBeGreaterThan(0);
      expect(w.cost, w.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('豌豆类武器才有弹速 speed（>0）；投掷/即时命中不读 speed', () => {
    for (const w of WEAPONS) {
      if (w.kind === 'pea') expect(w.speed, w.id).toBeGreaterThan(0);
    }
  });

  it('爆炸类（lob/hitscan 需要范围伤害）必须有正半径', () => {
    for (const w of WEAPONS) {
      if (w.kind === 'lob' || w.kind === 'hitscan') {
        expect(w.radius, w.id).toBeGreaterThan(0);
      }
    }
  });

  it('多发射手（shots > 1）必须给 spread，否则弹道完全重合', () => {
    for (const w of WEAPONS) {
      if ((w.shots || 1) > 1) expect(w.spread, w.id).toBeGreaterThan(0);
    }
  });

  it('穿透武器 pierce 为非负整数', () => {
    for (const w of WEAPONS) {
      if (w.pierce !== undefined) {
        expect(Number.isInteger(w.pierce), w.id).toBe(true);
        expect(w.pierce, w.id).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('config / 角色槽', () => {
  it('豌豆和坚果是 starter：分别常驻 1 号枪槽与 5 号护盾槽', () => {
    expect(STARTER_WEAPONS.map((w) => w.id).sort()).toEqual(['pea', 'wallnut']);
    const pea = WEAPONS.find((w) => w.id === 'pea');
    expect(pea.cost).toBe(0);
    expect(pea.slot).toBe('peaGun');
    expect(pea.ammo).toBeUndefined();
  });

  it('每把武器都有 slot，且落在这五种角色里', () => {
    const roles = new Set(['peaGun', 'gun', 'demo', 'grenade', 'shield']);
    for (const w of WEAPONS) expect(roles.has(w.slot), w.id + ' -> ' + w.slot).toBe(true);
  });

  it('五个角色槽的成员分布正确', () => {
    const by = (role) => WEAPONS.filter((w) => w.slot === role).map((w) => w.id).sort();
    expect(by('peaGun')).toEqual(['pea']);
    // 寒冰/火豌豆 已并入枪②，和双发/三线/机枪/仙人掌互为候选
    expect(by('gun')).toEqual(['cactus', 'firepea', 'gatling', 'repeater', 'snow', 'threepeater']);
    expect(by('demo')).toEqual(['cob', 'jalapeno', 'melon']);
    expect(by('grenade')).toEqual(['cherry']);
    expect(by('shield')).toEqual(['wallnut']);
  });

  it('除豌豆与坚果外，所有武器都自带弹匣（坚果是充能制，不走 ammo）', () => {
    for (const w of WEAPONS) {
      if (w.id === 'pea') continue;
      if (w.id === 'wallnut') {
        expect(w.ammo, w.id).toBeUndefined();
        expect(w.maxCharges, w.id).toBeGreaterThan(0);
        continue;
      }
      expect(w.ammo, w.id).toBeGreaterThan(0);
      expect(w.cost, w.id).toBeGreaterThan(0);
    }
  });

  it('豌豆射手的 cost 为 0（无限弹药的基础枪）', () => {
    expect(WEAPONS.find((w) => w.id === 'pea').cost).toBe(0);
  });

  it('每把武器都有模型与配色（视图模型构建依赖它）', () => {
    for (const w of WEAPONS.filter((x) => x.id !== 'pea')) {
      expect(typeof w.model, w.id).toBe('string');
      expect(typeof w.color, w.id).toBe('number');
    }
  });

  it('STARTER_WEAPONS / LOOT_WEAPONS 与 starter 标记完全一致', () => {
    expect(STARTER_WEAPONS.every((w) => w.starter)).toBe(true);
    expect(LOOT_WEAPONS.every((w) => !w.starter)).toBe(true);
    expect(STARTER_WEAPONS.length + LOOT_WEAPONS.length).toBe(WEAPONS.length);
    expect(new Set([...STARTER_WEAPONS, ...LOOT_WEAPONS])).toEqual(new Set(WEAPONS));
  });

  it('坚果墙是充能制护盾：maxCharges/recharge/盾血都有值，且气球能穿透', () => {
    const nut = WEAPONS.find((w) => w.id === 'wallnut');
    expect(nut.kind).toBe('shield');
    expect(nut.maxCharges).toBe(10);
    expect(nut.recharge).toBeGreaterThan(0);
    expect(nut.shieldHp).toBe(400);
    // C3：气球从头顶俯冲，护盾不挡 —— 否则开盾对空中单位也无敌
    expect(nut.aerialGuard).toBe(false);
  });

  it('火豌豆：燃烧 + 破甲 + 对空打折', () => {
    const f = WEAPONS.find((w) => w.id === 'firepea');
    expect(f.kind).toBe('pea');
    expect(f.burn.dps).toBeGreaterThan(0);
    expect(f.burn.time).toBeGreaterThan(0);
    expect(f.armorBreak).toBe(true);
    // 对空副钥匙：能打气球但只有 25%
    expect(f.aerial).toBe(0.25);
  });

  it('对空白名单：爆炸类 1 发必杀，仙人掌满伤，普通豌豆打不到', () => {
    for (const id of ['cherry', 'cob', 'melon', 'jalapeno']) {
      expect(WEAPONS.find((w) => w.id === id).aerial, id).toBe('explosion');
    }
    expect(WEAPONS.find((w) => w.id === 'cactus').aerial).toBe(1);
    for (const id of ['pea', 'snow', 'repeater', 'threepeater', 'gatling']) {
      expect(WEAPONS.find((w) => w.id === id).aerial, id).toBeUndefined();
    }
  });

  it('LOOT_WEAPONS 是"非 starter"的全集', () => {
    expect(LOOT_WEAPONS.map((w) => w.id).sort()).toEqual(
      ['cactus', 'cherry', 'cob', 'firepea', 'gatling', 'jalapeno', 'melon', 'repeater', 'snow', 'threepeater'].sort(),
    );
  });

  it('地面不刷豌豆（常驻 1 号槽）与坚果（靠阳光充能）', () => {
    // WeaponPickups.lootIndices 单独排除了这两把，和 starter 标记无关
    expect(WEAPONS.filter((w) => !w.starter).map((w) => w.id)).not.toContain('pea');
    const nut = WEAPONS.find((w) => w.id === 'wallnut');
    expect(nut.kind).toBe('shield');
    expect(nut.maxCharges).toBeGreaterThan(0);
  });
});

describe('config / ZOMBIES', () => {
  const FIELD_TYPES = {
    hp: 'number',
    speed: 'number',
    damage: 'number',
    score: 'number',
    scale: 'number',
    radius: 'number',
  };

  it('原七种僵尸类型齐全（含骷髅、橄榄球、气球）', () => {
    // 夜之森林新增了奇幻单位，这里只断言老七种仍在，不锁死完整清单
    const legacy = ['balloon', 'boss', 'bucket', 'cone', 'football', 'normal', 'skeleton'];
    for (const id of legacy) expect(ZOMBIES[id], id).toBeTruthy();
  });

  it('夜之森林的 12 种奇幻单位 + 3 只 BOSS 都在表里', () => {
    const fantasy = [
      'goblin', 'demon3', 'slime', 'pink-slime', 'slimelet', 'green-blob',
      'bones', 'ghost', 'ghost-skull', 'wolf', 'spider', 'rat', 'bat',
    ];
    for (const id of fantasy) expect(ZOMBIES[id], id).toBeTruthy();
    for (const id of ['gargantuar', 'mushroomKing', 'dragon']) {
      expect(ZOMBIES[id].boss, id).toBe(true);
      expect(typeof ZOMBIES[id].title).toBe('string');
    }
  });

  it('奇幻单位都登记了模型与阳光掉落', () => {
    for (const [id, def] of Object.entries(ZOMBIES)) {
      if (!def.model) continue;
      expect(MODELS[def.model], id + ' -> MODELS').toBeTruthy();
      if (!def.boss && !['normal', 'football', 'skeleton'].includes(id)) {
        expect(typeof def.sun, id + '.sun').toBe('number');
      }
    }
  });

  it('模型归属：普通僵尸用 alchemist.glb、橄榄球用 football.glb，路障/铁桶仍用原来的 zombie.glb', () => {
    expect(ZOMBIES.normal.model).toBe('alchemist');
    expect(ZOMBIES.football.model).toBe('football');
    expect(ZOMBIES.cone.model).toBeUndefined();
    expect(ZOMBIES.bucket.model).toBeUndefined();
    // 模型 1.077 高 × 1.72 ≈ 1.85 米，和原本的普通僵尸齐平
    expect(MODELS.alchemist.scale * 1.0767).toBeCloseTo(1.85, 1);
    // 橄榄球原始 1.938 × 0.95 ≈ 1.84 米，再乘类型 scale 1.12 ≈ 2.06 米
    expect(MODELS.football.scale * 1.938).toBeCloseTo(1.84, 1);
    expect(MODELS.alchemist.url).toBe('models/alchemist.glb');
    expect(MODELS.football.url).toBe('models/football.glb');
    expect(MODELS.zombie.url).toBe('models/zombie.glb');
  });

  it('橄榄球僵尸：厚甲（buffalo 材质）+ 血厚 + 速度快', () => {
    const f = ZOMBIES.football;
    expect(f.armor.material).toBe('buffalo');
    expect(f.armor.hp).toBe(260);
    expect(f.hp).toBeGreaterThan(ZOMBIES.cone.hp);
    // 全场第二快（仅次于普通僵尸），比铁桶快 68%
    expect(f.speed).toBeGreaterThan(ZOMBIES.bucket.speed * 1.5);
    expect(f.acc).toBe('helmet');
  });

  it('气球僵尸：空中单位，有飞行高度，血薄', () => {
    const b = ZOMBIES.balloon;
    expect(b.airborne).toBe(true);
    expect(b.airHeight).toBe(2.2);
    expect(b.hp).toBeLessThan(ZOMBIES.cone.hp);
    expect(b.acc).toBe('balloon');
  });

  it('护甲材质表：塑料/金属/水牛角三种，吸收比例与特性齐全', () => {
    for (const k of ['plastic', 'metal', 'buffalo']) {
      const r = ARMOR_MATERIALS[k];
      expect(typeof r.absorption, k).toBe('number');
      expect(r.absorption, k).toBeGreaterThan(0);
      expect(r.absorption, k).toBeLessThan(1);
      expect(typeof r.burnImmune, k).toBe('boolean');
      expect(typeof r.pierceBlock, k).toBe('boolean');
    }
    // 只有水牛角护甲怕火，火豌豆才因此成为橄榄球的克星
    expect(ARMOR_MATERIALS.buffalo.burnImmune).toBe(false);
    expect(ARMOR_MATERIALS.metal.burnImmune).toBe(true);
    expect(ARMOR_MATERIALS.plastic.burnImmune).toBe(true);
  });

  it('骷髅和 Boss 都走骷髅模型，路障/铁桶用僵尸 glb、普通用炼金模型', () => {
    expect(ZOMBIES.skeleton.model).toBe('skeleton');
    expect(ZOMBIES.skeleton.acc).toBeNull();
    // Boss 是巨型骷髅：同样的 glb，靠 scale 拉大到 4.5 米左右
    expect(ZOMBIES.boss.model).toBe('skeleton');
    expect(ZOMBIES.boss.acc).toBe('club');
    expect(ZOMBIES.boss.scale).toBe(2.3);
    // 2.166（模型原始高）× 0.9（SKELETON_SCALE）× 2.3 ≈ 4.48 米
    expect(2.166 * 0.9 * ZOMBIES.boss.scale).toBeGreaterThan(4.2);
    // 普通僵尸换成 alchemist.glb；路障/铁桶不写 model，继续用原来的僵尸 glb（锥帽/铁桶按它头顶做的）
    expect(ZOMBIES.normal.model).toBe('alchemist');
    for (const k of ['cone', 'bucket']) expect(ZOMBIES[k].model).toBeUndefined();
  });

  it('骷髅同屏上限与地图白名单', () => {
    expect(SKELETON_MAX_ALIVE).toBe(3);
    expect(SKELETON_MAPS).toEqual(['snow']);
  });

  it('每种类型字段齐全、数值为正', () => {
    for (const [kind, z] of Object.entries(ZOMBIES)) {
      for (const [field, type] of Object.entries(FIELD_TYPES)) {
        expect(typeof z[field], `${kind}.${field}`).toBe(type);
        expect(z[field], `${kind}.${field}`).toBeGreaterThan(0);
      }
      expect('acc' in z, `${kind}.acc`).toBe(true);
    }
  });

  it('配件与类型对应（normal / skeleton 无配件，其余按 acc 命名）', () => {
    expect(ZOMBIES.normal.acc).toBeNull();
    expect(ZOMBIES.skeleton.acc).toBeNull();
    expect(ZOMBIES.cone.acc).toBe('cone');
    expect(ZOMBIES.bucket.acc).toBe('bucket');
    expect(ZOMBIES.football.acc).toBe('helmet');
    expect(ZOMBIES.balloon.acc).toBe('balloon');
    expect(ZOMBIES.boss.acc).toBe('club');
  });

  it('难度随类型递增：hp / score / damage / radius 单调', () => {
    // 橄榄球和气球是「横向展开」而不是「纵向加码」：橄榄球用护甲换血量，气球用高度换血量，
    // 所以它们不进这条单调链（气球 hp 48 < 普通僵尸 62，是设计如此）
    const chain = [ZOMBIES.normal, ZOMBIES.cone, ZOMBIES.bucket, ZOMBIES.boss];
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].hp).toBeGreaterThan(chain[i - 1].hp);
      expect(chain[i].score).toBeGreaterThan(chain[i - 1].score);
      expect(chain[i].damage).toBeGreaterThanOrEqual(chain[i - 1].damage);
      expect(chain[i].radius).toBeGreaterThan(chain[i - 1].radius);
      expect(chain[i].speed).toBeLessThanOrEqual(chain[i - 1].speed);
    }
  });

  it('每个 BOSS 的 hp / damage / score 都优于所有非 BOSS 单位', () => {
    // 改成数据驱动：不再只认 'boss' 一个 type，任何 def.boss 都要满足
    const bosses = Object.entries(ZOMBIES).filter(([, z]) => z.boss);
    const rest = Object.entries(ZOMBIES).filter(([, z]) => !z.boss).map(([, z]) => z);
    expect(bosses.length).toBeGreaterThanOrEqual(3);
    for (const [id, b] of bosses) {
      for (const field of ['hp', 'damage', 'score']) {
        const max = Math.max(...rest.map((z) => z[field]));
        expect(b[field], `${id}.${field}`).toBeGreaterThan(max);
      }
      // BOSS 必须能被玩家风筝：明显慢于玩家移速（5.4），且不比普通僵尸快
      expect(b.speed, `${id}.speed < 玩家移速`).toBeLessThan(TUNING.playerSpeed * 0.5);
      expect(b.speed, `${id}.speed <= 普通僵尸`).toBeLessThanOrEqual(ZOMBIES.normal.speed);
    }
  });

  it('普通僵尸 scale=1，作为命中球高度换算基准（见 Zombie.getChest/getHead）', () => {
    expect(ZOMBIES.normal.scale).toBe(1);
  });
});

describe('config / COLORS', () => {
  it('基础配色保持不变', () => {
    expect(COLORS.grass).toBe(0x77bd3c);
    expect(COLORS.sky).toBe(0xcfe9ff);
  });
});

describe('config / wavePlan', () => {
  const count = (list, kind) => list.filter((x) => x === kind).length;

  it('n=1：只有 5 只普通僵尸', () => {
    const plan = wavePlan(1);
    expect(plan.length).toBe(5);
    expect(count(plan, 'normal')).toBe(5);
    expect(count(plan, 'cone')).toBe(0);
    expect(count(plan, 'bucket')).toBe(0);
    expect(count(plan, 'boss')).toBe(0);
  });

  it('n=2：开始出交通锥（(2-1)*1.05 = 1 只）', () => {
    const plan = wavePlan(2);
    expect(count(plan, 'normal')).toBe(4 + Math.floor(2 * 1.45)); // 6
    expect(count(plan, 'cone')).toBe(Math.floor(1 * 1.05)); // 1
    expect(count(plan, 'bucket')).toBe(0);
    expect(plan.length).toBe(7);
  });

  it('n=3：铁桶从第 3 波开始，且下限为 1（floor(1*0.8)=0 -> 1）', () => {
    const plan = wavePlan(3);
    expect(count(plan, 'bucket')).toBe(1);
    expect(count(plan, 'cone')).toBe(Math.floor(2 * 1.05)); // 2
    expect(count(plan, 'normal')).toBe(4 + Math.floor(3 * 1.45)); // 8
  });

  it('n=4：铁桶 floor(2*0.8)=1（仍是 1 只）', () => {
    expect(count(wavePlan(4), 'bucket')).toBe(1);
  });

  it('n=5：铁桶 floor(3*0.8)=2 且追加轮换表里的 BOSS', () => {
    const plan = wavePlan(5);
    expect(count(plan, 'bucket')).toBe(2);
    expect(plan.filter((t) => ZOMBIES[t].boss).length).toBe(1);
    expect(count(plan, 'gargantuar')).toBe(1); // 第 5 波 = 轮换表第一只
  });

  it('n=1..20：普通地图数量公式与 BOSS 只在地图 5 波出现', () => {
    for (let n = 1; n <= 20; n++) {
      const plan = wavePlan(n);
      const normals = 4 + Math.floor(n * 1.45);
      const cones = n >= 2 ? Math.floor((n - 1) * 1.05) : 0;
      const buckets = n >= 3 ? Math.max(1, Math.floor((n - 2) * 0.8)) : 0;
      // 骷髅第 4 波起掺进来，整波最多 SKELETON_MAX_ALIVE 只
      const skeletons = n >= 4 ? Math.min(SKELETON_MAX_ALIVE, 1 + Math.floor((n - 4) * 0.5)) : 0;
      // 橄榄球第 4 波起、气球第 6 波起
      const footballs = n >= 4 ? 1 + Math.floor((n - 4) * 0.6) : 0;
      const balloons = n >= 6 ? 1 + Math.floor((n - 6) * 0.7) : 0;
      const boss = bossForWave(n) ? 1 : 0;
      expect(count(plan, 'normal'), `n=${n} normals`).toBe(normals);
      expect(count(plan, 'cone'), `n=${n} cones`).toBe(cones);
      expect(count(plan, 'bucket'), `n=${n} buckets`).toBe(buckets);
      expect(count(plan, 'skeleton'), `n=${n} skeletons`).toBe(skeletons);
      expect(count(plan, 'football'), `n=${n} footballs`).toBe(footballs);
      expect(count(plan, 'balloon'), `n=${n} balloons`).toBe(balloons);
      expect(plan.filter((t) => ZOMBIES[t].boss).length, `n=${n} boss`).toBe(boss);
      expect(plan.length, `n=${n} total`).toBe(
        normals + cones + buckets + skeletons + footballs + balloons + boss,
      );
    }
  });

  it('n=20：总量 = 33 普通 + 19 锥 + 14 桶 + 3 骷髅 + 10 橄榄球 + 10 气球 + 1 boss = 90', () => {
    const plan = wavePlan(20);
    const expected = 4 + Math.floor(20 * 1.45) + Math.floor(19 * 1.05) + Math.max(1, Math.floor(18 * 0.8)) + 3 + 10 + 10 + 1;
    expect(plan.length).toBe(expected);
    expect(plan.length).toBe(90);
    expect(count(plan, 'skeleton')).toBe(SKELETON_MAX_ALIVE);
    expect(count(plan, 'football')).toBe(10);
    expect(count(plan, 'balloon')).toBe(10);
  });

  it('新僵尸首次出现的波次：橄榄球 n=4、气球 n=6', () => {
    expect(count(wavePlan(3), 'football')).toBe(0);
    expect(count(wavePlan(4), 'football')).toBe(1);
    expect(count(wavePlan(5), 'balloon')).toBe(0);
    expect(count(wavePlan(6), 'balloon')).toBe(1);
  });

  it('气球同屏配额：占同屏上限 20%（至少 1 只）', () => {
    expect(AIR_QUOTA_RATIO).toBe(0.2);
    expect(waveAirQuota(1)).toBe(1); // maxAlive 8 -> floor(1.6)=1
    expect(waveAirQuota(12)).toBe(2); // maxAlive 14 -> floor(2.8)=2
    for (let n = 1; n <= 40; n++) {
      expect(waveAirQuota(n)).toBeLessThanOrEqual(Math.max(1, Math.floor(waveMaxAlive(n) * AIR_QUOTA_RATIO)));
    }
  });

  it('洗牌不丢元素：多重集与公式一致', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const plan = wavePlan(9);
    spy.mockRestore();
    const tally = {};
    for (const k of plan) tally[k] = (tally[k] || 0) + 1;
    expect(tally.normal).toBe(4 + Math.floor(9 * 1.45));
    expect(tally.cone).toBe(Math.floor(8 * 1.05));
    expect(tally.bucket).toBe(Math.max(1, Math.floor(7 * 0.8)));
    expect(tally.boss).toBeUndefined();
    expect(plan.every((k) => Object.keys(ZOMBIES).includes(k))).toBe(true);
  });

  it('确实被洗牌（Math.random 恒 0 时顺序不同于入队顺序）', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const plan = wavePlan(3);
    spy.mockRestore();
    // 入队顺序为 normal×8, cone×2, bucket×1；shuffle(random=0) 至少让 bucket 不在末尾
    expect(plan[plan.length - 1]).not.toBe('bucket');
    // 反向 fisher-yates(random=0) 会把原首元素推到首位
    expect(plan[0]).toBe('normal');
  });

  it('n=0 也不崩（防御性：只返回 4 只普通僵尸）', () => {
    const plan = wavePlan(0);
    expect(count(plan, 'normal')).toBe(4);
    expect(count(plan, 'cone')).toBe(0);
    expect(count(plan, 'bucket')).toBe(0);
    // n<5 不出 BOSS（bossForWave 在 n<5 时返回 null）
    expect(plan.filter((t) => ZOMBIES[t].boss).length).toBe(0);
  });
});

describe('config / waveMaxAlive', () => {
  it('前几波 8 只，随波次单调不降', () => {
    expect(waveMaxAlive(1)).toBe(8);
    expect(waveMaxAlive(2)).toBe(9);
    expect(waveMaxAlive(3)).toBe(9);
    expect(waveMaxAlive(4)).toBe(10);
    let prev = -Infinity;
    for (let n = 1; n <= 40; n++) {
      const v = waveMaxAlive(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('上限硬顶 14（移动端同屏上限）', () => {
    expect(waveMaxAlive(12)).toBe(14);
    expect(waveMaxAlive(13)).toBe(14);
    expect(waveMaxAlive(1000)).toBe(14);
    for (let n = 1; n <= 100; n++) expect(waveMaxAlive(n)).toBeLessThanOrEqual(14);
  });

  it('n=0 时也返回有效的正数', () => {
    expect(waveMaxAlive(0)).toBe(8);
  });
});

describe('config / waveSpawnInterval', () => {
  it('第 1 波 1.295s', () => {
    expect(waveSpawnInterval(1)).toBeCloseTo(1.295, 10);
  });

  it('随波次单调不增（封顶前严格递减，16 波之后恒为 0.5）', () => {
    let prev = Infinity;
    for (let n = 1; n <= 20; n++) {
      const v = waveSpawnInterval(n);
      expect(v).toBeLessThanOrEqual(prev);
      if (n <= 16) expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('下限 0.5s', () => {
    expect(waveSpawnInterval(15)).toBeCloseTo(0.525, 10);
    expect(waveSpawnInterval(16)).toBe(0.5);
    expect(waveSpawnInterval(1000)).toBe(0.5);
  });
});

describe('config / zombieHpMul', () => {
  it('第 1 波为 1，第 n 波为 1+(n-1)*0.11', () => {
    expect(zombieHpMul(1)).toBeCloseTo(1, 10);
    expect(zombieHpMul(2)).toBeCloseTo(1.11, 10);
    expect(zombieHpMul(10)).toBeCloseTo(1 + 9 * 0.11, 10);
  });

  it('不受 1.45 速度封顶影响（血量无上限增长）', () => {
    expect(zombieHpMul(100)).toBeCloseTo(1 + 99 * 0.11, 10);
    expect(zombieHpMul(100)).toBeGreaterThan(10);
  });

  it('n=0 / 负数不会削弱到 1 以下', () => {
    expect(zombieHpMul(0)).toBe(1);
    expect(zombieHpMul(-5)).toBe(1);
  });

  it('单调递增', () => {
    for (let n = 1; n < 30; n++) expect(zombieHpMul(n + 1)).toBeGreaterThan(zombieHpMul(n));
  });
});

describe('config / zombieSpeedMul', () => {
  it('第 1 波为 1，之后每波 +1.8%', () => {
    expect(zombieSpeedMul(1)).toBeCloseTo(1, 10);
    expect(zombieSpeedMul(2)).toBeCloseTo(1.018, 10);
    expect(zombieSpeedMul(10)).toBeCloseTo(1 + 9 * 0.018, 10);
  });

  it('封顶 1.45：n=26 起到达上限', () => {
    // 1 + (n-1)*0.018 >= 1.45  <=>  n-1 >= 25
    expect(zombieSpeedMul(25)).toBeCloseTo(1 + 24 * 0.018, 10); // 1.432
    expect(zombieSpeedMul(26)).toBe(1.45);
    expect(zombieSpeedMul(1000)).toBe(1.45);
  });

  it('永不小于 1（n=0 / 负数）', () => {
    expect(zombieSpeedMul(0)).toBe(1);
    expect(zombieSpeedMul(-3)).toBe(1);
  });

  it('单调不降', () => {
    let prev = -Infinity;
    for (let n = 0; n <= 40; n++) {
      const v = zombieSpeedMul(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('与血量倍率的差距随波次拉大（后期僵尸更耐打）', () => {
    expect(zombieHpMul(20)).toBeGreaterThan(zombieSpeedMul(20));
  });
});