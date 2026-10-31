export const TUNING = {
  arenaHalf: 23,
  playerSpeed: 5.4,
  playerHeight: 1.66,
  playerRadius: 0.42,
  gravity: 21,
  // 跳跃最高 7.2²/(2×21) ≈ 1.234 米：矮墙（雪地 0.92）、木箱（沙城 0.9 / 0.95 / 1.2）能上，
  // 基地墙 2.2 与田字柱 3.6 仍上不去。CS 1.6 的净升高是 268²/(2×800) ≈ 44.9u ≈ 1.14 米。
  jumpSpeed: 7.2,
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

// 双人缩放：人数 ×2 但同屏上限不变，靠「更耐打的怪 + 更密的波次」加压力。
// 设计依据见 docs/design/DESIGN-duo-online.md §6：总 HP ×2.25、人均压力 1.12×。
// 双人竞争/合作层（见设计稿 §4.2 / §5.2）
export const COOP = { window: 2, mul: 1.08 };
export const BOUNTY = { bonus: 300, fromWave: 2 };
export const AIRDROP = {
  everyWaves: 3,
  delay: 20,
  warn: 5,
  sun: 40,
  score: 200,
  weapons: ['gatling', 'melon', 'firepea', 'cactus'],
};
export const BOSS_AGGRO = { switchEvery: 8, warn: 1 };

export const DUO = {
  countMul: 1.5,
  hpMul: 1.5,
  bossHpMul: 1.33,
  spawnIntervalMul: 0.9,
  maxAlive: 14,
  airQuotaBonus: 1,
  startSun: 80,
  maxSun: 400,
  skySunInterval: 22,
  intermission: 5.0,
  sunOrbPool: 40,
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
    // 开局常驻 5 号护盾槽：坚果不进地面随机池，否则一关只出一次、还容易永远拿不到
    starter: true,
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
    // 铁桶是「桶才是本体」：甲 200 + 身 140，合计耐久和旧版 270 血基本持平
    // （旧版把桶算进 270 里，护甲层不能直接叠在旧血上，否则 TTK 会从 2.7 秒涨到 4.5 秒）
    hp: 140,
    speed: 1.55,
    damage: 15,
    score: 350,
    scale: 1.08,
    acc: 'bucket',
    // 金属桶：吸伤 70%，对燃烧免疫，还吃不到穿透（仙人掌穿不过它）
    armor: { material: 'metal', hp: 200 },
    radius: 0.52,
  },
  // 橄榄球僵尸：快（2.6 m/s，全场第二）、厚甲（buffalo 材质，吸收 50%，怕火）
  // 模型是 AIGC 橄榄球僵尸（无头盔），头顶的头盔仍由 buildHat 程序化补上。
  football: {
    // 护甲是主体：甲 260 + 身 150。豌豆要打穿整层头盔，火豌豆 2 倍破甲才明显更快
    hp: 150,
    armor: { material: 'buffalo', hp: 260 },
    speed: 2.6,
    damage: 16,
    score: 450,
    scale: 1.12,
    model: 'football',
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
    boss: true,
    title: '骷髅王',
    sun: 7,
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

  // ══════════════════════════════════════════════════════════════════════
  // 夜之森林 · 奇幻单位（全部来自 aigc/monsters，CC0 1.0）
  // 数值口径：普通僵尸 hp 62 / speed 2.05 / damage 9 是基准线。
  // 族群分工：哥布林=快脆、史莱姆=分裂弹跳、亡灵=成群、兽=伏击。
  // ══════════════════════════════════════════════════════════════════════

  // ── 哥布林族：脆、快、成群 ──
  goblin: {
    hp: 55, speed: 2.6, damage: 8, score: 90,
    scale: 1, model: 'goblin', acc: null, radius: 0.4,
    sun: 1,
  },
  // 小恶魔：哥布林的强化版，W6 起补位
  demon3: {
    hp: 80, speed: 2.2, damage: 12, score: 140,
    scale: 1, model: 'demon3', acc: null, radius: 0.44,
    sun: 1,
  },

  // ── 史莱姆族：弹跳、分裂、厚 ──
  slime: {
    hp: 70, speed: 1.5, damage: 10, score: 110,
    scale: 1, model: 'slime', acc: null, radius: 0.48,
    sun: 1,
  },
  // 粉史莱姆：死亡分裂成 2 只小史莱姆
  'pink-slime': {
    hp: 45, speed: 1.8, damage: 7, score: 90,
    scale: 1, model: 'pink-slime', acc: null, radius: 0.42,
    sun: 1,
    split: { into: 'slimelet', count: 2 },
  },
  // 分裂出的小史莱姆：不再分裂（模型复用 slime，缩小）
  slimelet: {
    hp: 22, speed: 2.3, damage: 5, score: 30,
    scale: 0.55, model: 'slime', acc: null, radius: 0.26,
    sun: 1,
  },
  // 绿块：厚、慢、弹开豌豆（轻护甲）
  'green-blob': {
    hp: 120, speed: 1.2, damage: 13, score: 180,
    scale: 1, model: 'green-blob', acc: null, radius: 0.56,
    armor: { material: 'plastic', hp: 60 },
    sun: 2,
  },

  // ── 亡灵族：成群、夜里显形 ──
  // 注意：type 故意叫 bones 而不是 skeleton —— skeleton 那个 type 有 9 dc 的旧限流
  // （SKELETON_MAX_ALIVE / spawnOne 里的换队逻辑），新骷髅只要 3 dc，不该吃这条。
  bones: {
    hp: 90, speed: 1.9, damage: 14, score: 160,
    scale: 1, model: 'bones', acc: null, radius: 0.46,
    sun: 1,
  },
  ghost: {
    hp: 70, speed: 1.7, damage: 11, score: 190,
    scale: 1, model: 'ghost', acc: null, radius: 0.46,
    sun: 2,
  },
  'ghost-skull': {
    hp: 50, speed: 2.1, damage: 9, score: 130,
    scale: 1, model: 'ghost-skull', acc: null, radius: 0.38,
    sun: 1,
  },

  // ── 兽族：快、伏击、成群 ──
  wolf: {
    hp: 75, speed: 3.0, damage: 15, score: 170,
    scale: 1, model: 'wolf', acc: null, radius: 0.5,
    sun: 2,
  },
  spider: {
    hp: 60, speed: 1.4, damage: 14, score: 150,
    scale: 1, model: 'spider', acc: null, radius: 0.5,
    sun: 1,
  },
  rat: {
    hp: 25, speed: 3.2, damage: 4, score: 40,
    scale: 1, model: 'rat', acc: null, radius: 0.24,
    sun: 1,
  },
  // 蝙蝠：飞行单位，吃 AIR_QUOTA_RATIO 的同屏配额
  bat: {
    hp: 40, speed: 2.4, damage: 7, score: 120,
    scale: 1, model: 'bat', acc: null, radius: 0.36,
    airborne: true, airHeight: 2.0,
    sun: 1,
  },

  // ══════════════════════════════════════════════════════════════════════
  // 夜之森林 · BOSS（每 5 波一只，按 BOSS_ROTATION 轮换）
  // boss: true 是数据驱动开关——ZombieManager / Game 都读它，不要再写死 type === 'boss'。
  // ══════════════════════════════════════════════════════════════════════
  gargantuar: {
    hp: 1560, speed: 1.15, damage: 30, score: 3000,
    // 巨人：模型按 targetHeight 1.85 归一化，再乘类型 scale 1.84 → 约 3.4 米
    // （设计稿 DESIGN-traps-and-bosses-v2 的既定口径）。
    // 命中球由模型自身的包围盒推（Zombie.hitForModel），跟着这个 scale 一起放大。
    scale: 1.84, model: 'giant', acc: null, radius: 0.85,
    boss: true, title: '巨人',
    slam: { range: 2.6, radius: 2.3, telegraph: 0.85, recover: 1.4 },
    sun: 7,
  },
  mushroomKing: {
    hp: 1620, speed: 1.05, damage: 28, score: 3100,
    // 蘑菇王：1.85 × 1.86 ≈ 3.44 米，保持 Boss 级观感（与修复渲染缩放前的可视尺寸一致）
    scale: 1.86, model: 'mushroom-king', acc: null, radius: 0.8,
    boss: true, title: '蘑菇王',
    duck: { period: 9, duration: 3, reduce: 0.25 },
    sun: 7,
  },
  dragon: {
    hp: 1740, speed: 1.25, damage: 34, score: 3300,
    // 巨龙：1.85 × 1.53 ≈ 2.83 米，保持 Boss 级观感（与修复渲染缩放前的可视尺寸一致）
    scale: 1.53, model: 'dragon', acc: null, radius: 0.9,
    boss: true, title: '巨龙',
    dive: { high: 3.2, ground: 0, period: 7, groundTime: 2 },
    sun: 8,
  },
};

// 每 5 波出一个 BOSS，按这张表轮换（第 5/25/45… 波 = 巨人，第 10 波 = 骷髅王 …）。
export const BOSS_ROTATION = ['gargantuar', 'boss', 'mushroomKing', 'dragon'];

// 第 n 波该出哪只 BOSS；不是 BOSS 波返回 null。
export function bossForWave(n) {
  if (n < 5 || n % 5 !== 0) return null;
  return BOSS_ROTATION[(Math.floor(n / 5) - 1) % BOSS_ROTATION.length];
}

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

// 站在这个高度以上的可站立平台（雪地矮墙 0.92、沙城 1.5 箱子）时，任何武器都能打到气球。
// 必须 grounded：跳跃（最高 1.04）不算，否则「跳起来平射」会让对空白名单失效。
export const AIR_HIGH_GROUND = 0.9;
// 玩家站上去就不该被僵尸跟上的高度：流场由此封住平台所在格，防止「站矮墙无敌」。
// 必须低于跳跃能上的最高平台（雪地矮墙 0.92），否则僵尸会沿安全区走上矮墙把人逼下来。
export const PLAYER_PERCH = 0.6;

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

// 奇幻族群在夜之森林里的出场节奏：[首波, 每波增量, 单波上限]
// 总量守恒：奇幻怪从普通僵尸里扣，不叠加，否则第 20 波怪量会翻倍。
export const FANTASY_PLAN = {
  goblin: [1, 0.5, 5],
  slime: [1, 0.35, 4],
  rat: [2, 0.3, 3],
  wolf: [3, 0.4, 3],
  bones: [4, 0.35, 3],
  spider: [5, 0.3, 2],
  ghost: [6, 0.3, 2],
  demon3: [6, 0.3, 2],
  'pink-slime': [7, 0.28, 2],
  bat: [8, 0.25, 2],
  'green-blob': [9, 0.22, 2],
  'ghost-skull': [11, 0.2, 2],
};

// 一张图这一波总共出多少只（不含 BOSS）。普通地图和森林共用这一条口径，
// 保证「换成奇幻怪」不会偷偷改难度曲线。
export function waveTotal(n) {
  const normals = 4 + Math.floor(n * 1.45);
  const cones = n >= 2 ? Math.floor((n - 1) * 1.05) : 0;
  const buckets = n >= 3 ? Math.max(1, Math.floor((n - 2) * 0.8)) : 0;
  const skeletons = n >= 4 ? Math.min(SKELETON_MAX_ALIVE, 1 + Math.floor((n - 4) * 0.5)) : 0;
  const footballs = n >= 4 ? 1 + Math.floor((n - 4) * 0.6) : 0;
  const balloons = n >= 6 ? 1 + Math.floor((n - 6) * 0.7) : 0;
  return normals + cones + buckets + skeletons + footballs + balloons;
}

// 森林专属波次：奇幻单位替换普通僵尸，总只数与普通地图一致。
function forestWavePlan(n) {
  const list = [];
  const total = waveTotal(n);
  const picks = [];
  for (const id in FANTASY_PLAN) {
    const [start, rate, cap] = FANTASY_PLAN[id];
    if (n < start) continue;
    const k = Math.min(cap, Math.floor((n - start) * rate) + 1);
    for (let i = 0; i < k; i++) picks.push(id);
  }
  // 总量守恒：奇幻怪最多占 (总只数 - 4)，普通僵尸始终留 4 只保底。
  const room = Math.max(0, total - 4);
  const fantasy = picks.length > room ? picks.slice(0, room) : picks;
  const normals = total - fantasy.length;
  for (let i = 0; i < normals; i++) list.push('normal');
  for (let i = 0; i < fantasy.length; i++) list.push(fantasy[i]);
  return withBoss(shuffle(list), n);
}

// BOSS 洗牌后插到队首：否则它排在十几个普通怪后面，玩家要等很久才见到，
// 甚至因为同屏上限一直排不上（实测：不加这条第 5 波打了 20 秒 BOSS 还没出来）。
function withBoss(list, n) {
  const boss = bossForWave(n);
  if (!boss) return list;
  return [boss].concat(list);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

// mapId 可选：传 'forest' 走奇幻波次，其余地图保持原来的僵尸波次（零回归）。
export function wavePlan(n, mapId) {
  if (mapId === 'forest') return forestWavePlan(n);
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
  return withBoss(shuffle(list), n);
}

// 双人波次：把非 Boss 条目循环补到 countMul 倍，Boss 保持 1 只。
// 单独导出便于单测，ZombieManager 只在 host 侧调用。
export function duoWavePlan(plan) {
  const normals = [];
  const bosses = [];
  for (let i = 0; i < plan.length; i++) {
    const def = ZOMBIES[plan[i]];
    if (def && def.boss) bosses.push(plan[i]);
    else normals.push(plan[i]);
  }
  if (!normals.length) return bosses.slice();
  const target = Math.round(normals.length * DUO.countMul);
  const out = [];
  for (let i = 0; i < target; i++) out.push(normals[i % normals.length]);
  return out.concat(bosses);
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
