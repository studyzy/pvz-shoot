export const TUNING = {
  arenaHalf: 23,
  playerSpeed: 5.4,
  playerHeight: 1.66,
  playerRadius: 0.42,
  gravity: 21,
  jumpSpeed: 6.6,
  maxHealth: 100,
  regenDelay: 7,
  regenRate: 9,
  headshotMul: 3,
  startSun: 60,
  maxSun: 300,
  startZ: 13,
  // 阳光球：面额、吸附距离、未拾取存活时间
  sunPerOrb: 5,
  sunOrbMagnet: 4.6,
  sunOrbTtl: 18,
};

// 天降阳光：小福利，主收入仍然靠击杀掉落
export const SUN_SKY = {
  interval: 30,
  height: 12,
  edgeMargin: 3,
};

export const WEAPONS = [
  {
    id: 'pea',
    name: '豌豆射手',
    short: '豌豆',
    desc: '无限弹药',
    starter: true,
    model: 'shooter',
    cost: 0,
    cooldown: 0.15,
    damage: 15,
    kind: 'pea',
    speed: 74,
    color: 0x8ade2a,
    auto: true,
    recoil: 0.55,
  },
  {
    id: 'snow',
    name: '寒冰射手',
    short: '寒冰',
    desc: '减速僵尸',
    starter: true,
    model: 'shooter',
    cost: 2,
    cooldown: 0.26,
    damage: 19,
    kind: 'pea',
    speed: 62,
    color: 0x8fe6ff,
    slow: true,
    ice: true,
    auto: true,
    recoil: 0.7,
  },
  {
    id: 'cherry',
    name: '樱桃炸弹',
    short: '樱桃',
    desc: '范围爆炸',
    starter: true,
    model: 'cherry',
    cost: 22,
    cooldown: 1.3,
    damage: 210,
    kind: 'lob',
    // arc：有重力的投掷物。直线弹种（pea / hitscan）统一从准星出发，不参与重力，撞墙即消失
    arc: true,
    speed: 21,
    radius: 5.6,
    color: 0xe8452f,
    auto: false,
    recoil: 2.4,
  },
  {
    id: 'cob',
    name: '玉米加农炮',
    short: '玉米炮',
    desc: '远程重炮',
    starter: true,
    model: 'cob',
    cost: 26,
    cooldown: 1.9,
    damage: 165,
    kind: 'hitscan',
    radius: 4.2,
    color: 0xffd23f,
    auto: false,
    recoil: 3.4,
  },
  // 以下植物只能从地图地面拾取，自带弹药、不消耗阳光
  {
    id: 'repeater',
    name: '双发射手',
    short: '双发',
    desc: '一次两发',
    starter: false,
    model: 'multi',
    cost: 2,
    ammo: 70,
    cooldown: 0.24,
    damage: 12,
    kind: 'pea',
    speed: 76,
    color: 0x9ae63a,
    shots: 2,
    spread: 0.026,
    auto: true,
    recoil: 0.65,
  },
  {
    id: 'threepeater',
    name: '三线射手',
    short: '三线',
    desc: '三向散射',
    starter: false,
    model: 'multi',
    cost: 3,
    ammo: 48,
    cooldown: 0.46,
    damage: 14,
    kind: 'pea',
    speed: 70,
    color: 0x76d62a,
    shots: 3,
    spread: 0.07,
    auto: true,
    recoil: 0.95,
  },
  {
    id: 'gatling',
    name: '机枪射手',
    short: '机枪',
    desc: '超高射速',
    starter: false,
    model: 'gatling',
    cost: 1,
    ammo: 140,
    cooldown: 0.075,
    damage: 8,
    kind: 'pea',
    speed: 82,
    color: 0xc2f24e,
    auto: true,
    recoil: 0.3,
  },
  {
    id: 'cactus',
    name: '仙人掌',
    short: '仙人掌',
    desc: '一发穿透三只',
    starter: false,
    model: 'cactus',
    cost: 3,
    ammo: 40,
    cooldown: 0.42,
    damage: 30,
    kind: 'pea',
    speed: 98,
    color: 0x9be15d,
    pierce: 2,
    auto: true,
    recoil: 0.85,
  },
  {
    id: 'melon',
    name: '西瓜投手',
    short: '西瓜',
    desc: '大范围爆炸',
    starter: false,
    model: 'melon',
    cost: 18,
    ammo: 10,
    cooldown: 1.55,
    damage: 280,
    kind: 'lob',
    arc: true,
    speed: 21,
    radius: 6.6,
    color: 0x3fae3a,
    auto: false,
    recoil: 2.6,
  },
  {
    id: 'jalapeno',
    name: '火爆辣椒',
    short: '辣椒',
    desc: '引燃一片',
    starter: false,
    model: 'pepper',
    cost: 20,
    ammo: 6,
    cooldown: 1.5,
    damage: 240,
    kind: 'hitscan',
    radius: 5.2,
    color: 0xff5a2a,
    auto: false,
    recoil: 3.2,
  },
];

export const STARTER_WEAPONS = WEAPONS.filter((w) => w.starter);
export const LOOT_WEAPONS = WEAPONS.filter((w) => !w.starter);

export const ZOMBIES = {
  normal: {
    hp: 62,
    speed: 2.05,
    damage: 9,
    score: 100,
    scale: 1,
    acc: null,
    radius: 0.46,
  },
  cone: {
    hp: 130,
    speed: 1.95,
    damage: 9,
    score: 200,
    scale: 1.02,
    acc: 'cone',
    radius: 0.48,
  },
  bucket: {
    hp: 270,
    speed: 1.55,
    damage: 15,
    score: 350,
    scale: 1.08,
    acc: 'bucket',
    radius: 0.52,
  },
  boss: {
    hp: 1450,
    speed: 1.3,
    damage: 26,
    score: 2500,
    // 巨型骷髅：骷髅原始高 2.166 × SKELETON_SCALE 0.9 × 2.3 ≈ 4.48 米
    scale: 2.3,
    model: 'skeleton',
    acc: 'club',
    radius: 0.9,
  },
  // 骷髅（KayKit，CC0）：雪地专属亡灵精英，也会在 Boss 波出现。
  // 比普通僵尸耐打、劈得更狠，但同屏最多 3 只（单只 9 个 skinned mesh，见 AGENTS.md 5.2）。
  skeleton: {
    hp: 210,
    speed: 1.75,
    damage: 18,
    score: 450,
    scale: 1,
    model: 'skeleton',
    acc: null,
    radius: 0.5,
  },
};

// 普通骷髅（skeleton 类型）的同屏上限：单只 9 个 skinned mesh，比普通僵尸贵 4.5 倍，必须限流。
// 注意：Boss 也是骷髅模型，但它每波只有 1 只，不吃这条上限。
export const SKELETON_MAX_ALIVE = 3;

// 哪些地图会刷**普通**骷髅（雪地是墓园氛围，最贴切）。
// Boss（巨型骷髅）不受此限制，三张地图都会出。
export const SKELETON_MAPS = ['snow'];

export const COLORS = {
  grass: 0x77bd3c,
  fence: 0xf6f1e2,
  wood: 0xa97b4b,
  tomb: 0xa8a795,
  leaf: 0x4f9c26,
  leafDark: 0x3a7a18,
  house: 0xd9c8a4,
  roof: 0xb4584a,
  sky: 0xcfe9ff,
};

export function wavePlan(n) {
  const list = [];
  const normals = 4 + Math.floor(n * 1.45);
  const cones = n >= 2 ? Math.floor((n - 1) * 1.05) : 0;
  const buckets = n >= 3 ? Math.max(1, Math.floor((n - 2) * 0.8)) : 0;
  // 骷髅：第 4 波起掺进来，随波次变多，但整波最多 3 只（它贵）
  const skeletons = n >= 4 ? Math.min(SKELETON_MAX_ALIVE, 1 + Math.floor((n - 4) * 0.5)) : 0;
  for (let i = 0; i < normals; i++) list.push('normal');
  for (let i = 0; i < cones; i++) list.push('cone');
  for (let i = 0; i < buckets; i++) list.push('bucket');
  for (let i = 0; i < skeletons; i++) list.push('skeleton');
  if (n % 5 === 0) list.push('boss');
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

export function waveMaxAlive(n) {
  return Math.min(14, 8 + Math.floor(n / 2));
}

export function waveSpawnInterval(n) {
  return Math.max(0.5, 1.35 - n * 0.055);
}

export function zombieHpMul(n) {
  return 1 + Math.max(0, n - 1) * 0.11;
}

export function zombieSpeedMul(n) {
  return Math.min(1.45, 1 + Math.max(0, n - 1) * 0.018);
}
