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
    slot: 'peaGun',
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
    slot: 'gun',
    name: '寒冰射手',
    short: '寒冰',
    desc: '减速僵尸',
    starter: false,
    model: 'shooter',
    ammo: 60,
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
    slot: 'grenade',
    // 爆炸是球形的，天上地下都炸得到：气球也吃满伤
    aerial: 'explosion',
    name: '樱桃炸弹',
    short: '樱桃',
    desc: '蓄力投掷 · 范围爆炸',
    starter: false,
    model: 'cherry',
    // 手雷槽：按住 G 蓄力、松手投出（见 GRENADE）
    grenade: true,
    ammo: 4,
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
    slot: 'demo',
    // 爆炸是球形的，天上地下都炸得到：气球也吃满伤
    aerial: 'explosion',
    name: '玉米加农炮',
    short: '玉米炮',
    desc: '远程重炮',
    starter: false,
    model: 'cob',
    ammo: 8,
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
    slot: 'gun',
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
    slot: 'gun',
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
    slot: 'gun',
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
    slot: 'gun',
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
    // 对空主钥匙：唯一无条件的空中解法（弹丸不会被跳过）
    aerial: 1,
    auto: true,
    recoil: 0.85,
  },
  {
    id: 'melon',
    slot: 'demo',
    // 爆炸是球形的，天上地下都炸得到：气球也吃满伤
    aerial: 'explosion',
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
    slot: 'demo',
    // 爆炸是球形的，天上地下都炸得到：气球也吃满伤
    aerial: 'explosion',
    name: '火爆辣椒',
    short: '辣椒',
    desc: '近距离连发',
    starter: false,
    model: 'pepper',
    cost: 20,
    ammo: 6,
    // 三个大杀器的取舍：玉米炮远程精准 / 西瓜半径最大 / 辣椒射程最短但能连发
    cooldown: 0.9,
    damage: 240,
    kind: 'hitscan',
    radius: 5.2,
    color: 0xff5a2a,
    auto: false,
    recoil: 3.2,
  },
  {
    id: 'wallnut',
    slot: 'shield',
    name: '坚果墙',
    short: '坚果',
    desc: '免伤护盾',
    starter: false,
    model: 'wallnut',
    // 护盾不是弹匣制：靠 maxCharges/recharge 充能，所以不带 ammo
    cost: 25,
    cooldown: 1.0,
    damage: 0,
    kind: 'shield',
    // 盾血：被打光就碎，罩内玩家完全不掉血。厚度按「僵尸咬击 1.28 秒 + 0.32 秒无敌」实测算过。
    shieldHp: 400,
    // 罩内移速倍率（重甲感）。盾与手持强绑定：切走坚果就破盾，所以不存在
    // "开着盾用别的枪站桩" —— 原来那条"每开一枪扣 1 点盾血"的约束因此不再需要。
    shieldMoveMul: 0.88,
    // 气球从头顶俯冲，护盾不挡 —— 否则开盾对空中单位也无敌
    aerialGuard: false,
    // 植物栏充能：一颗 25 阳光，最多囤 10 颗，0.6 秒回一颗
    maxCharges: 10,
    recharge: 0.6,
    color: 0xc98c3e,
    auto: false,
    recoil: 1.6,
  },
  {
    id: 'firepea',
    slot: 'gun',
    name: '火豌豆射手',
    short: '火豌豆',
    desc: '高伤 · 燃烧破甲',
    starter: false,
    model: 'fire',
    ammo: 80,
    cost: 2,
    cooldown: 0.17,
    damage: 20,
    kind: 'pea',
    speed: 78,
    color: 0xff7a1a,
    // 燃烧：命中后每秒掉 burn.dps，持续 burn.time 秒，最多一层（不叠层）
    burn: { dps: 8, time: 3 },
    // 护甲伤害倍率：只有火系弹丸能穿过护甲层（buffer 头盔被烧穿）
    armorBreak: true,
    // 对空：能打气球，但只有 25% 伤害（慢速副钥匙）
    aerial: 0.25,
    auto: true,
    recoil: 0.62,
  },
];

// 取消植物栏：所有武器都按 `slot` 归入 5 个角色槽，数字键 12345 就是全部切枪键。
// `starter` 现在的含义只剩"开局就装备"，只有豌豆为 true（它常驻 1 号枪槽）。
export const STARTER_WEAPONS = WEAPONS.filter((w) => w.starter);
export const LOOT_WEAPONS = WEAPONS.filter((w) => !w.starter);

// 武器槽（吃鸡式）：每把武器按 `WEAPONS[].slot` 归入一个角色槽。
// 槽位本身带角色 —— 玩家的「分类」就是槽位本身，不再需要额外一张分类表。
// 注意：`starter` 仍然是"植物栏那 6 格"，和槽位是两套编排；武器可以同时出现在两处。
export const WEAPON_SLOTS = {
  peaGun: 1, // 枪①：豌豆射手常驻，永远不变、不能替换（阳光见底时的承重墙）
  gun: 1, // 枪②：唯一可换的枪槽，捡到什么就顶掉上一把
  grenade: 1, // 手雷 ×1：樱桃炸弹（蓄力投掷）
  demo: 1, // 大杀器 ×1：玉米炮 / 西瓜 / 辣椒
  shield: 1, // 坚果护盾 ×1：坚果墙（充能制，只换展示位置）
  // 抬枪时长：只影响视图模型动画，不重置开火冷却（否则换枪能躲冷却）
  swapAnim: 0.35,
};

// 豌豆射手常驻 1 号枪槽：它不进战利品池、不能被替换
export const PEA_ID = 'pea';

// 数字键 1-5 依次对应五个槽位。取消植物栏之后这就是全部切枪键，没有第二套。
// 顺序按"最常用 → 最不常用"排：保底豌豆、主枪、大杀器、手雷、护盾。
const SLOT_KEYS = [
  { role: 'peaGun', pos: 0 },
  { role: 'gun', pos: 0 },
  { role: 'demo', pos: 0 },
  { role: 'grenade', pos: 0 },
  { role: 'shield', pos: 0 },
];
export const SLOT_ORDER = SLOT_KEYS.map((k) => k.role);
export { SLOT_KEYS };

// 切枪键从 1 开始：第 i 个槽 = 数字键 (i + 1)
export const SLOT_KEY_BASE = 1;

// 樱桃炸弹改成蓄力投掷：按住 G 蓄力，松手投出，蓄得越久扔得越远。
export const GRENADE = {
  minRange: 4,
  maxRange: 20,
  chargeTime: 0.9,
};

export const ZOMBIES = {
  // 普通僵尸：用第三套模型（炼金僵尸 alchemist.glb，1.077 × 1.72 ≈ 1.85 米）。
  // 它是场上最多的类型，模型 1 万面，同屏 14 只时仍是最大的一笔三角面开销。
  normal: {
    hp: 62,
    speed: 2.05,
    damage: 9,
    score: 100,
    scale: 1,
    model: 'alchemist',
    acc: null,
    radius: 0.46,
  },
  // 路障 / 铁桶继续用原来的 Quaternius 僵尸模型（不写 model = zombie.glb），
  // 它们的锥帽/铁桶是按那个模型的头顶尺寸挂上去的。
  cone: {
    hp: 130,
    speed: 1.95,
    damage: 9,
    score: 200,
    scale: 1.02,
    acc: 'cone',
    // 塑料锥：吸伤 35%，对燃烧免疫（烧不掉塑料）
    armor: { material: 'plastic', hp: 90 },
    radius: 0.48,
  },
  bucket: {
    hp: 270,
    speed: 1.55,
    damage: 15,
    score: 350,
    scale: 1.08,
    acc: 'bucket',
    // 金属桶：吸伤 70%，对燃烧免疫，还吃不到穿透（仙人掌穿不过它）
    armor: { material: 'metal', hp: 240 },
    radius: 0.52,
  },
  // 橄榄球僵尸：快（2.6 m/s，全场第二）、厚甲（buffalo 材质，吸收 50%，怕火）
  football: {
    hp: 190,
    armor: { material: 'buffalo', hp: 140 },
    speed: 2.6,
    damage: 16,
    score: 450,
    scale: 1.12,
    acc: 'helmet',
    radius: 0.55,
  },
  // 气球僵尸：悬浮空中 2.2 米，普通弹丸打不到，只有爆炸/仙人掌/火豌豆（弱）能打
  balloon: {
    hp: 48,
    speed: 2.2,
    damage: 11,
    score: 300,
    scale: 1,
    acc: 'balloon',
    radius: 0.46,
    airborne: true,
    airHeight: 2.2,
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
// 护甲材质规则：absorption 是吸收比例（按护甲血量折算 → 等效血量 = armor.hp / absorption），
// burnImmune 表示燃烧烧不动它，pierceBlock 表示穿透弹打不穿。
export const ARMOR_MATERIALS = {
  plastic: { absorption: 0.35, burnImmune: true, pierceBlock: false },
  metal: { absorption: 0.7, burnImmune: true, pierceBlock: true },
  buffalo: { absorption: 0.5, burnImmune: false, pierceBlock: false },
};

// 气球同屏配额：占同屏上限的比例（14 只时 = 2 只）。
// 理由不是「保底」而是「阳光税」：每只气球正常情况下要花 22~40 阳光解决，堆太多会把整波预算吃光。
export const AIR_QUOTA_RATIO = 0.2;

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
  // 橄榄球：第 4 波起，0.6/波（比铁桶的 0.8 更缓 —— 它快一倍，堆太多会劝退）
  // 气球：第 6 波起，0.7/波（脆，但要花阳光打）
  const footballs = n >= 4 ? 1 + Math.floor((n - 4) * 0.6) : 0;
  const balloons = n >= 6 ? 1 + Math.floor((n - 6) * 0.7) : 0;
  for (let i = 0; i < normals; i++) list.push('normal');
  for (let i = 0; i < cones; i++) list.push('cone');
  for (let i = 0; i < buckets; i++) list.push('bucket');
  for (let i = 0; i < skeletons; i++) list.push('skeleton');
  for (let i = 0; i < footballs; i++) list.push('football');
  for (let i = 0; i < balloons; i++) list.push('balloon');
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

// 气球同屏上限：占同屏上限的比例（至少 1 只）
export function waveAirQuota(n) {
  return Math.max(1, Math.floor(waveMaxAlive(n) * AIR_QUOTA_RATIO));
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
