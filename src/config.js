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
  startSun: 70,
  maxSun: 999,
  startZ: 13,
};

export const WEAPONS = [
  {
    id: 'pea',
    name: '豌豆射手',
    short: '豌豆',
    desc: '无限弹药',
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
    cost: 3,
    cooldown: 0.26,
    damage: 19,
    kind: 'pea',
    speed: 62,
    color: 0x8fe6ff,
    slow: true,
    auto: true,
    recoil: 0.7,
  },
  {
    id: 'cherry',
    name: '樱桃炸弹',
    short: '樱桃',
    desc: '范围爆炸',
    cost: 22,
    cooldown: 1.3,
    damage: 210,
    kind: 'lob',
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
    cost: 40,
    cooldown: 1.9,
    damage: 165,
    kind: 'hitscan',
    radius: 4.2,
    color: 0xffd23f,
    auto: false,
    recoil: 3.4,
  },
];

export const ZOMBIES = {
  normal: {
    hp: 62,
    speed: 2.05,
    damage: 9,
    score: 100,
    scale: 1,
    skin: 0x9ab271,
    shirt: 0x6f5da0,
    pants: 0x474157,
    acc: null,
    radius: 0.46,
  },
  cone: {
    hp: 130,
    speed: 1.95,
    damage: 9,
    score: 200,
    scale: 1.02,
    skin: 0x94ad6b,
    shirt: 0x5f6fa6,
    pants: 0x3f3a4e,
    acc: 'cone',
    radius: 0.48,
  },
  bucket: {
    hp: 270,
    speed: 1.55,
    damage: 15,
    score: 350,
    scale: 1.08,
    skin: 0x8da767,
    shirt: 0x7a4a4a,
    pants: 0x3c3746,
    acc: 'bucket',
    radius: 0.52,
  },
  boss: {
    hp: 1450,
    speed: 1.3,
    damage: 26,
    score: 2500,
    scale: 1.85,
    skin: 0x86a05f,
    shirt: 0x4c3b6e,
    pants: 0x322d40,
    acc: 'club',
    radius: 0.9,
  },
};

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
  for (let i = 0; i < normals; i++) list.push('normal');
  for (let i = 0; i < cones; i++) list.push('cone');
  for (let i = 0; i < buckets; i++) list.push('bucket');
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
