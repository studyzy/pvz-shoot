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
} from '../../src/config.js';

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
    expect(TUNING.startSun).toBe(70);
    expect(TUNING.maxSun).toBe(999);
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
      expect(['pea', 'lob', 'hitscan']).toContain(w.kind);
      expect(w.damage, w.id).toBeGreaterThan(0);
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

describe('config / starter 与 loot 的区分', () => {
  it('starter 武器花阳光：cost >= 0 且没有 ammo', () => {
    for (const w of WEAPONS.filter((x) => x.starter)) {
      expect(w.cost, w.id).toBeGreaterThanOrEqual(0);
      expect(w.ammo, w.id).toBeUndefined();
    }
  });

  it('豌豆射手的 cost 为 0（无限弹药的基础枪）', () => {
    expect(WEAPONS.find((w) => w.id === 'pea').cost).toBe(0);
  });

  it('非 starter 武器自带弹药、模型与配色，且不消耗阳光', () => {
    for (const w of WEAPONS.filter((x) => !x.starter)) {
      expect(w.starter, w.id).toBe(false);
      expect(w.ammo, w.id).toBeGreaterThan(0);
      expect(typeof w.model, w.id).toBe('string');
      expect(typeof w.color, w.id).toBe('number');
      expect(w.cost, w.id).toBe(0);
    }
  });

  it('STARTER_WEAPONS / LOOT_WEAPONS 与 starter 标记完全一致', () => {
    expect(STARTER_WEAPONS.every((w) => w.starter)).toBe(true);
    expect(LOOT_WEAPONS.every((w) => !w.starter)).toBe(true);
    expect(STARTER_WEAPONS.length + LOOT_WEAPONS.length).toBe(WEAPONS.length);
    expect(new Set([...STARTER_WEAPONS, ...LOOT_WEAPONS])).toEqual(new Set(WEAPONS));
  });

  it('植物栏恰好 4 格（HUD 按 starter 渲染 1-4 快捷键）', () => {
    expect(STARTER_WEAPONS.map((w) => w.id)).toEqual(['pea', 'snow', 'cherry', 'cob']);
  });

  it('战利品池覆盖五种只可拾取的植物', () => {
    expect(LOOT_WEAPONS.map((w) => w.id).sort()).toEqual(
      ['cactus', 'gatling', 'jalapeno', 'melon', 'repeater', 'threepeater'].sort(),
    );
  });

  it('地面拾取只刷非 starter（与 WeaponPickups.lootIndices 语义一致）', () => {
    // WeaponPickups 的随机池来自非 starter 的索引，若某 starter 武器被误改成可拾取，植物栏/战利品格会错位
    const lootIds = WEAPONS.filter((w) => !w.starter).map((w) => w.id);
    expect(lootIds).not.toContain('pea');
    expect(lootIds).not.toContain('snow');
    expect(lootIds).not.toContain('cherry');
    expect(lootIds).not.toContain('cob');
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

  it('五种僵尸类型齐全（含骷髅）', () => {
    expect(Object.keys(ZOMBIES).sort()).toEqual(['boss', 'bucket', 'cone', 'normal', 'skeleton']);
  });

  it('骷髅和 Boss 都走骷髅模型，其余三类用僵尸 glb', () => {
    expect(ZOMBIES.skeleton.model).toBe('skeleton');
    expect(ZOMBIES.skeleton.acc).toBeNull();
    // Boss 是巨型骷髅：同样的 glb，靠 scale 拉大到 4.5 米左右
    expect(ZOMBIES.boss.model).toBe('skeleton');
    expect(ZOMBIES.boss.acc).toBe('club');
    expect(ZOMBIES.boss.scale).toBe(2.3);
    // 2.166（模型原始高）× 0.9（SKELETON_SCALE）× 2.3 ≈ 4.48 米
    expect(2.166 * 0.9 * ZOMBIES.boss.scale).toBeGreaterThan(4.2);
    // 其余三类不写 model，默认用僵尸 glb
    for (const k of ['normal', 'cone', 'bucket']) expect(ZOMBIES[k].model).toBeUndefined();
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

  it('配件与类型对应（normal 无配件，其余按 acc 命名）', () => {
    expect(ZOMBIES.normal.acc).toBeNull();
    expect(ZOMBIES.cone.acc).toBe('cone');
    expect(ZOMBIES.bucket.acc).toBe('bucket');
    expect(ZOMBIES.boss.acc).toBe('club');
  });

  it('难度随类型递增：hp / score / damage / radius 单调', () => {
    const chain = [ZOMBIES.normal, ZOMBIES.cone, ZOMBIES.bucket, ZOMBIES.boss];
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].hp).toBeGreaterThan(chain[i - 1].hp);
      expect(chain[i].score).toBeGreaterThan(chain[i - 1].score);
      expect(chain[i].damage).toBeGreaterThanOrEqual(chain[i - 1].damage);
      expect(chain[i].radius).toBeGreaterThan(chain[i - 1].radius);
      expect(chain[i].speed).toBeLessThanOrEqual(chain[i - 1].speed);
    }
  });

  it('boss 的每一项战斗数值都是全场最大（除速度）', () => {
    const rest = Object.entries(ZOMBIES).filter(([k]) => k !== 'boss').map(([, z]) => z);
    for (const field of ['hp', 'damage', 'score', 'scale', 'radius']) {
      const max = Math.max(...rest.map((z) => z[field]));
      expect(ZOMBIES.boss[field], `boss.${field}`).toBeGreaterThan(max);
    }
    const minSpeed = Math.min(...rest.map((z) => z.speed));
    expect(ZOMBIES.boss.speed).toBeLessThanOrEqual(minSpeed);
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

  it('n=5：铁桶 floor(3*0.8)=2 且追加 boss', () => {
    const plan = wavePlan(5);
    expect(count(plan, 'bucket')).toBe(2);
    expect(count(plan, 'boss')).toBe(1);
  });

  it('n=1..20：数量公式与 boss 只在 n%5===0 出现', () => {
    for (let n = 1; n <= 20; n++) {
      const plan = wavePlan(n);
      const normals = 4 + Math.floor(n * 1.45);
      const cones = n >= 2 ? Math.floor((n - 1) * 1.05) : 0;
      const buckets = n >= 3 ? Math.max(1, Math.floor((n - 2) * 0.8)) : 0;
      // 骷髅第 4 波起掺进来，整波最多 SKELETON_MAX_ALIVE 只
      const skeletons = n >= 4 ? Math.min(SKELETON_MAX_ALIVE, 1 + Math.floor((n - 4) * 0.5)) : 0;
      const boss = n % 5 === 0 ? 1 : 0;
      expect(count(plan, 'normal'), `n=${n} normals`).toBe(normals);
      expect(count(plan, 'cone'), `n=${n} cones`).toBe(cones);
      expect(count(plan, 'bucket'), `n=${n} buckets`).toBe(buckets);
      expect(count(plan, 'skeleton'), `n=${n} skeletons`).toBe(skeletons);
      expect(count(plan, 'boss'), `n=${n} boss`).toBe(boss);
      expect(plan.length, `n=${n} total`).toBe(normals + cones + buckets + skeletons + boss);
    }
  });

  it('n=20：总量 = 33 普通 + 19 锥 + 14 桶 + 3 骷髅 + 1 boss = 70', () => {
    const plan = wavePlan(20);
    expect(plan.length).toBe(4 + Math.floor(20 * 1.45) + Math.floor(19 * 1.05) + Math.max(1, Math.floor(18 * 0.8)) + 3 + 1);
    expect(plan.length).toBe(70);
    expect(count(plan, 'skeleton')).toBe(SKELETON_MAX_ALIVE);
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
    // 0 % 5 === 0 会追加 boss —— 真实行为记录，调用方从 1 开始
    expect(count(plan, 'boss')).toBe(1);
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