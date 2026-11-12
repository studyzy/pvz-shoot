import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { blobShadowTexture, glowTexture } from '../world/materials.js';
import { ZOMBIES, ARMOR_MATERIALS, COOP, BOSS_AGGRO } from '../config.js';
import { zombieModel, ZOMBIE_SCALE, MODELS, findClip } from './ZombieModel.js';
import { clamp, rand, TAU } from '../utils.js';

// 无头模拟（服务器权威）用的空壳：粒子与音效是纯表现，服务器一律不产生。
// 放在模块级常量上，避免每个僵尸各建一个对象。
const NOOP_FX = new Proxy({}, { get: () => () => {} });

const ICE = new THREE.Color(0x9fe4ff);
const WHITE = new THREE.Color(0xffffff);
const tmpV = new THREE.Vector3();
// 程序化骨骼动画复用的临时量（每帧给十几根骨头设角度，不能每帧 new）
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const hatQuat = new THREE.Quaternion();
const shadowGeometry = new THREE.PlaneGeometry(1.5, 1.5);
const skillGeometry = new THREE.RingGeometry(0.86, 1, 48);
const lightOrigin = new THREE.Vector3();
const lightDirection = new THREE.Vector3();
const lightTarget = new THREE.Vector3();

// 只量由 Head 驱动的顶点，避免举手/弯腰影响落点；在骨骼局部空间缓存，动画与出生位置不影响贴合。
function headCrownLocal(zombie, headBone) {
  const src = zombie.modelSource();
  if (src._headCrown) return src._headCrown;
  zombie.body.updateWorldMatrix(true, true);
  const invHead = headBone.matrixWorld.clone().invert();
  const points = [];
  zombie.body.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    if (!a.skinIndex || !a.skinWeight) return;
    for (const bone of mesh.skeleton.bones) bone.updateWorldMatrix(true, false);
    const headIndex = mesh.skeleton.bones.indexOf(headBone);
    for (let i = 0; i < a.position.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) {
        if (a.skinIndex.getComponent(i, j) === headIndex) weight += a.skinWeight.getComponent(i, j);
      }
      if (weight < 0.5) continue;
      const v = new THREE.Vector3().fromBufferAttribute(a.position, i);
      mesh.applyBoneTransform(i, v);
      mesh.localToWorld(v);
      points.push(v.applyMatrix4(invHead));
    }
  });
  if (!points.length) return null;
  const box = new THREE.Box3().setFromPoints(points);
  const minCrownY = box.max.y - box.getSize(tmpV).y * 0.3;
  const crown = new THREE.Box3().setFromPoints(points.filter((p) => p.y >= minCrownY));
  // 先确定最高点，再取颅顶范围中心；不能边找最大值边平均，结果会依赖顶点排列并偏向额头。
  const local = crown.getCenter(new THREE.Vector3());
  local.y = box.max.y;
  src._headCrown = local.clone();
  return local;
}

// 各模型的命中球（世界米：已按 MODELS[x].scale / targetHeight 归一化，再乘类型的 scaleFactor）。
// chest/head 是球心高度，radius 是半径倍率：骷髅骨架细取 0.8；普通僵尸用的炼金模型 Q 版身宽，取 0.85。
// 头部球半径必须仍小于身体球，否则爆头会退化成“打哪儿都爆头”。
const HIT = {
  zombie: { chest: 1.02, head: 1.52, radius: 1 },
  skeleton: { chest: 0.9, head: 1.68, radius: 0.8 },
  alchemist: { chest: 0.83, head: 1.44, radius: 0.85 },
  // 橄榄球模型原始高 1.938（头心 1.747、胸心 1.408）；下面的数已乘 MODELS.football.scale 0.95，调用方再乘类型 scale。
  football: { chest: 1.34, head: 1.66, radius: 1 },

  // ── 夜之森林的奇幻单位 ──
  // 这些模型都按 targetHeight 归一化过，所以下面填的是**归一化后**的世界米口径，
  // 调用方仍会再乘类型的 scaleFactor。头部球半径始终小于胸口球（见 §5.3 硬规则）。
  // 数值口径：按「加载真实 glb → 归一化 → 播走路动画 → 逐帧采样蒙皮顶点」实测校准，
  // 保证可见躯干的大块落在命中球内（脚本量法见 git 历史的临时审计 tmp-audit.mjs）。
  goblin: { chest: 0.82, head: 1.18, radius: 0.85 },
  // 小恶魔的体块重心偏高（角+宽肩），胸口球要抬到 0.9、半径给足 1
  demon3: { chest: 0.9, head: 1.28, radius: 1 },
  slime: { chest: 0.45, head: 0.72, radius: 1.05 },
  'pink-slime': { chest: 0.42, head: 0.66, radius: 1.05 },
  'green-blob': { chest: 0.72, head: 1.05, radius: 1.15 },
  bones: { chest: 0.88, head: 1.42, radius: 0.8 },
  ghost: { chest: 0.95, head: 1.55, radius: 0.85 },
  'ghost-skull': { chest: 0.62, head: 0.95, radius: 0.8 },
  // 四足：身体立在腿上、重心比「四足=矮」的直觉高，胸口球按实测体块重心给；
  // 狼身长（z 向 1.46 米），半径倍率放大到 1.1 才罩得住躯干
  wolf: { chest: 0.7, head: 0.98, radius: 1.1 },
  spider: { chest: 0.32, head: 0.42, radius: 0.85 },
  rat: { chest: 0.14, head: 0.2, radius: 0.8 },
  bat: { chest: 0.28, head: 0.38, radius: 0.8 },

  // 蘑菇王/巨龙按**飞行/站立姿态实测**：蘑菇的伞盖占上半身，巨龙走 Flying 姿态
  // （身体抬高、双翼展开），胸口球都要按姿态重心给，不能按 bind pose 猜
  'mushroom-king': { chest: 1.0, head: 1.5, radius: 1 },
  // 僵尸博士：模型原始高 1.834，DOCTOR_SCALE 0.9 → 归一化高 1.651（脚底 y≈0）。
  // 下面填归一化后的世界米，调用方再乘类型 scale 1.36。胸心取身高 0.60（宽肩躯干中段）、
  // 头心 0.91（颅骨中心）。头球半径 0.36 仍小于胸球 0.46，爆头判定成立。
  zombieDoctor: { chest: 1.0, head: 1.5, radius: 1 },
  dragon: { chest: 1.4, head: 1.75, radius: 1.15 },
};

// giant 不进 HIT：它按**模型加载后的真实包围盒**推（见 hitForModel），
// 写死一组固定高度会把命中球压到模型的下半截：枪往上打看着打中，实际落在球外不掉血。
function hitForModel(id, src) {
  const hit = HIT[id];
  if (hit) return hit;
  // 未就绪（没有 box）时给普通人形兜底，模型就绪后由 Zombie.syncHitSpheres 重算
  const box = src && src.box;
  if (box && box.size.y > 1e-6) {
    return {
      // 胸口取躯干高度（约九成身高）：大块头长腿短躯干，取中点会把胸口球放到腰以下，
      // 枪往上打看着中、实际落在球外。头部球卡在头顶略下。
      chest: box.min.y + box.size.y * 0.9,
      head: box.min.y + box.size.y * 0.97,
      // 半径倍率以普通人形的 0.92 米身宽为 1：更宽的模型给更大的球，夹在合理区间
      radius: Math.max(0.75, Math.min(1.8, box.size.x / 0.92)),
    };
  }
  const fallback = HIT.zombie;
  return { chest: fallback.chest, head: fallback.head, radius: fallback.radius };
}

let shadowMatShared = null;
let shadowMatSoft = null;
// 两档：solid 用于「这是唯一影子」的无阴影地图；soft 用于空中单位（真实投影还在远处地上，blob 只是位置提示）。
function shadowMaterial(soft) {
  if (soft) {
    if (!shadowMatSoft) {
      shadowMatSoft = new THREE.MeshBasicMaterial({
        map: blobShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.38,
        color: 0x20300f,
      });
    }
    return shadowMatSoft;
  }
  if (!shadowMatShared) {
    shadowMatShared = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      color: 0x20300f,
    });
  }
  return shadowMatShared;
}

// ── 动画族 ────────────────────────────────────────────────────────────────
// 每个模型 id 归属一个动画命名族；族的候选名按优先级排列，取第一个命中的 clip。
// 新增模型：先在 ANIM_FAMILIES 里挂上族名，族已存在就不用动别的地方。
export const ANIM_NAMES = {
  // Quaternius 僵尸（zombie.glb 与炼金/橄榄球都对齐了这套命名）
  quaternius: {
    idle: ['idle'],
    walk: ['walk'],
    attack: ['idle_attack', 'run_attack'],
    die: ['death'],
    hit: ['hitreact'],
  },
  // KayKit 骷髅（Walking_A / 1H_Melee_Attack_Chop / Death_A / Hit_A）
  kaykit: {
    idle: ['idle_combat', 'idle'],
    walk: ['walking_a', 'walking_b', 'idle'],
    attack: ['1h_melee_attack_chop', '1h_melee_attack_slice_horizontal', 'idle_combat'],
    die: ['death_a', 'death_b'],
    hit: ['hit_a', 'hit_b'],
  },
  // 人形怪族：Attack / Death / HitRecieve / Idle / Jump / Run / Walk
  humanoid: {
    idle: ['idle'],
    walk: ['walk', 'run'],
    attack: ['attack', 'punch', 'bite_front'],
    die: ['death'],
    hit: ['hitrecieve', 'hitreact'],
  },
  // 软体族：Bite_Front / Dance / Death / HitRecieve / Idle / Jump / No / Walk / Yes
  blob: {
    idle: ['idle'],
    walk: ['walk', 'jump'],
    attack: ['bite_front', 'bite_inplace', 'punch', 'headbutt'],
    die: ['death'],
    hit: ['hitrecieve', 'hitreact'],
  },
  // 史莱姆专属：Slime_Attack / Slime_Death / Slime_Idle / Slime_Walk
  slime: {
    idle: ['slime_idle', 'idle'],
    walk: ['slime_walk', 'walk'],
    attack: ['slime_attack', 'bite_front'],
    die: ['slime_death', 'death'],
    hit: ['hitrecieve', 'hitreact', 'hit'],
  },
  // 四足兽：Death / Headbutt / Idle / Jump_* / Run / Walk
  beast: {
    idle: ['idle'],
    walk: ['walk', 'run', 'gallop'],
    attack: ['headbutt', 'bite_front', 'punch'],
    die: ['death'],
    hit: ['hitreact', 'hitrecieve'],
  },
  // 蜘蛛：Spider_Attack / Spider_Death / Spider_Idle / Spider_Jump / Spider_Walk
  spider: {
    idle: ['spider_idle', 'idle'],
    walk: ['spider_walk', 'spider_jump'],
    attack: ['spider_attack', 'bite_front'],
    die: ['spider_death', 'death'],
    hit: ['hitrecieve', 'hitreact', 'hit'],
  },
  // 老鼠：Rat_Attack / Rat_Death / Rat_Idle / Rat_Jump / Rat_Run / Rat_Walk
  rat: {
    idle: ['rat_idle', 'idle'],
    walk: ['rat_walk', 'rat_run'],
    attack: ['rat_attack', 'bite_front'],
    die: ['rat_death', 'death'],
    hit: ['hitrecieve', 'hitreact', 'hit'],
  },
  // 蝙蝠：Bat_Attack / Bat_Attack2 / Bat_Death / Bat_Flying / Bat_Hit（没有 HitReact，用 Bat_Hit）
  bat: {
    idle: ['bat_flying'],
    walk: ['bat_flying'],
    attack: ['bat_attack', 'bat_attack2'],
    die: ['bat_death'],
    hit: ['bat_hit', 'hitrecieve'],
  },
  // 幽灵/飞行怪：Death / Fast_Flying / Flying_Idle / Headbutt / HitReact / Punch
  // 注意：带 Fast_Flying 不代表会飞，是否悬空只由 def.airborne 决定。
  flying: {
    idle: ['flying_idle', 'idle'],
    walk: ['fast_flying', 'flying_idle', 'walk'],
    attack: ['headbutt', 'punch', 'bite_front'],
    die: ['death'],
    hit: ['hitreact', 'hitrecieve'],
  },
  // 云上发条游乐园的原创玩具（tools/build-toy-models.mjs 生成）：
  // 动作名故意对齐 Quaternius，Idle / Walk / Idle_Attack / Death / HitReact。
  toy: {
    idle: ['idle'],
    walk: ['walk'],
    attack: ['idle_attack', 'attack'],
    die: ['death'],
    hit: ['hitreact'],
  },
  // 有 Duck 的怪：Death / Duck / HitReact / Idle / Jump… / Punch / Run / Walk / Wave / Weapon
  duck: {
    duck: ['duck'],
    idle: ['idle'],
    walk: ['walk', 'run'],
    attack: ['punch', 'attack', 'headbutt'],
    die: ['death'],
    hit: ['hitreact', 'hitrecieve'],
  },
};

// 走**程序化骨骼动画**的模型：源资产没有动画片段（僵尸博士的 FBX 只有绑定姿态），
// 由 Zombie.updateProcAnim 逐帧摆骨骼，所以不需要动画族。加进这里的模型必须真的没有 clip。
export const PROC_RIG_MODELS = new Set(['zombieDoctor']);

export const ANIM_FAMILIES = {
  zombie: 'quaternius',
  alchemist: 'quaternius',
  football: 'quaternius',
  skeleton: 'kaykit',

  goblin: 'humanoid',
  demon3: 'humanoid',
  giant: 'humanoid',
  'mushroom-king': 'duck',
  bones: 'humanoid',

  slime: 'slime',
  'pink-slime': 'blob',
  'green-blob': 'blob',

  ghost: 'flying',
  'ghost-skull': 'flying',
  // 巨龙用的 dragon-evolved.glb 里根本没有 Dragon_* 动画（实际是
  // Flying_Idle / Fast_Flying / Headbutt / Death / HitReact），挂 flying 族；
  // 曾经挂了不存在的 dragon 族，导致巨龙永远停在 bind pose 站桩滑动
  dragon: 'flying',

  toySoldier: 'toy',
  springDuck: 'toy',
  teaSprite: 'toy',
  paperGlider: 'toy',
  jackBox: 'toy',
  clockRabbit: 'toy',

  wolf: 'beast',
  spider: 'spider',
  rat: 'rat',
  bat: 'bat',
};

export class Zombie {
  constructor(type, wave, x, z, ctx, hpMul, speedMul) {
    this.type = type;
    this.def = ZOMBIES[type];
    // 无头模式：服务器没有粒子 / 音效 / 材质，用空壳兜底，逻辑路径统一不改
    if (ctx.headless) ctx = { ...ctx, particles: NOOP_FX, sfx: NOOP_FX, env: null };
    this.ctx = ctx;
    this.map = ctx.map || null;
    this.wave = wave;
    // 先定模型 id：syncHitSpheres 要按它取模型槽（buildRig 之后会再赋同样的值）
    this.modelId = MODELS[this.def.model] ? this.def.model : 'zombie';
    this.scaleFactor = this.def.scale;
    // 命中球高度：两套模型体块比例不同，按各自的模型单位给（调用方再乘 scaleFactor）。
    // 命中球按模型查表（见 HIT）：僵尸 1.194、骷髅 2.166、炼金僵尸 1.077 高，口径各不相同；
    // 表里没有的模型（巨人）按加载后的包围盒推，模型就绪后再由 syncHitSpheres 重算一次。
    this.syncHitSpheres();
    this.maxHp = Math.round(this.def.hp * hpMul);
    this.hp = this.maxHp;
    this.speed = this.def.speed * speedMul;
    this.radius = this.def.radius;
    this.scoreValue = this.def.score;
    this.alive = true;
    this.dying = false;
    this.dead = false;
    // 双人 M2：guest 侧的僵尸只是 host 快照的视图，不跑 AI、不结算伤害。
    this.remote = false;
    this.netId = 0;
    this.lastHitBy = 0;
    this.burnSource = 0;
    this.deathT = 0;
    this.spawnT = 0;
    this.phase = rand(0, TAU);
    this.attackTimer = rand(0.4, 1.1);
    this.attackAnim = 0;
    this.flash = 0;
    this.slowTimer = 0;
    this.stagger = 0;
    this.pushX = 0;
    this.pushZ = 0;
    this.stuckT = 0;
    this.detourT = 0;
    this.detourX = 0;
    this.detourZ = 0;
    this.detourFlip = 1;
    this.flow = { x: 0, z: 0 };
    this.flowActive = false;
    this.rotY = rand(0, TAU);
    this.animSpeed = 0;
    this.targetSeat = 0;
    // 双人：协同集火（2 s 内两人都打过 → 之后 ×1.08）与悬赏标记
    this.age = 0;
    this.coopA = -99;
    this.coopB = -99;
    this.coop = false;
    this.bounty = false;
    this.markBounty = null;
    this.markCoop = null;
    // 双人 Boss：每 8 s 强制换目标，换之前 1 s 吼叫预警
    this.aggroT = BOSS_AGGRO.switchEvery;
    this.aggroWarnFired = false;
    this.preferSeat = null;

    // 材质护甲层：护甲有自己的血，打空就掉下来（acc 网格隐藏）。
    // material 决定吸收比例、怕不怕火、挡不挡穿透 —— 一条字段解释所有武器的克制关系。
    const armorDef = this.def.armor || null;
    this.armorRule = armorDef ? ARMOR_MATERIALS[armorDef.material] : null;
    this.armorMax = armorDef ? armorDef.hp : 0;
    this.armorHp = this.armorMax;
    this.burnTimer = 0;
    this.burnDps = 0;
    this.burnTickT = 0;
    // 空中单位：root 整体抬到 airHeight，命中球跟着抬（getChest/getHead 里加）。
    this.airHeight = this.def.airborne ? this.def.airHeight || 2.2 : 0;
    this.airborne = this.airHeight > 0;
    const flight = this.def.landing || this.def.dive;
    this.skillState = this.def.ambush ? 'ambush' : flight ? 'fly' : 'idle';
    this.skillTimer = flight ? flight.period - flight.groundTime - flight.telegraph
      : this.def.duck ? this.def.duck.period - this.def.duck.duration - this.def.duck.recover : 0;
    this.skillCenter = new THREE.Vector3(x, 0, z);
    // 云上发条乐园的玩具技能共用这几个槽位：
    // skillCooldown 是招式之间的间隔，skillDirection 是冲撞/拳套锁定的方向，
    // stopTimer 是铜钟停机剩下的秒数（>0 时整只玩具冻结），chargeSeen 是本次冲撞已结算过的 seat 位图。
    this.skillCooldown = 0;
    this.skillDirection = new THREE.Vector3(0, 0, 1);
    this.stopTimer = 0;
    this.stopCue = null;
    this.chargeSeen = 0;
    this.clockTurn = 0;
    if (this.def.flight) {
      this.airHeight = this.def.flight.high;
      this.airborne = true;
      this.skillState = 'fly';
      this.skillTimer = this.def.flight.cruise;
    }
    if (flight) {
      this.airHeight = flight.high;
      this.airborne = true;
    }

    this.variant = Math.floor(rand(0, 3));
    this.baseTint = new THREE.Color(0xffffff).offsetHSL(0, 0, rand(-0.03, 0.025));

    this.root = new THREE.Group();
    this.root.position.set(x, this.airHeight, z);
    this.root.scale.setScalar(this.scaleFactor);

    // 无头模式（服务器权威模拟）：只建纯逻辑对象，不进场景、不加载 glb、不建材质。
    // blob 影子要读 canvas（document），服务器没有 DOM，所以这条分支要**在建影子之前**返回。
    // root/model/shadow 仍是 Object3D，位置语义（脚底、+Z 朝向）与渲染侧完全一致，
    // 所以 AI / 命中 / 技能那几千行代码一行都不用改。
    if (this.ctx.headless) {
      this.shadow = new THREE.Object3D();
      this.root.add(this.shadow);
      this.model = new THREE.Group();
      this.model.position.y = -2.3;
      this.root.add(this.model);
      this.buildRig();
      this.buildSkillCue();
      this.root.rotation.y = this.rotY;
      this.headless = true;
      return;
    }

    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial(false));
    shadow.rotation.x = -Math.PI / 2;
    // root 在空中时影子要落回地面，而不是跟着飞；气球再缩小一圈，作为「它在天上」的线索
    shadow.position.y = (0.025 - this.airHeight) / this.scaleFactor;
    // 地面单位：身体网格已经 castShadow（见下面的 buildRig），再叠一层贴图影子就是两层，
    // 近距离看是脚下一块脏东西。地面僵尸只留真实投影，blob 只给两种必须靠它的情况：
    //   1) 空中单位 —— 真实投影会飘到很远的地面，反而读不出「它在哪」；
    //   2) 无阴影地图（forest / cloud，map.noShadows）—— 没有真实投影，不补就贴地漂浮。
    // 这两条的判据在下面 setGroundShadow() 里，因为 airborne 之后还会变（气球落地/起飞）。
    if (this.airborne) shadow.scale.setScalar(0.6);
    shadow.renderOrder = 1;
    this.shadow = shadow;
    this.root.add(shadow);
    this.hasGroundShadow = this.airborne || !!(this.map && this.map.noShadows);
    // 无阴影地图上 blob 是唯一影子 → 实心档；否则（空中单位）用 soft 档。
    this.shadowSoft = !(this.map && this.map.noShadows);
    shadow.visible = this.hasGroundShadow;
    if (this.hasGroundShadow && this.shadowSoft) shadow.material = shadowMaterial(true);

    this.model = new THREE.Group();
    this.model.position.y = -2.3;
    this.root.add(this.model);

    this.buildRig();
    this.buildSkillCue();

    this.root.rotation.y = this.rotY;
    ctx.scene.add(this.root);
  }

  // 当前类型用哪份模型资源：普通僵尸直接用 zombieModel 本体，其它压在自己的槽里
  modelSource() {
    if (this.modelId === 'zombie') return zombieModel;
    // 其余模型各自压在自己的槽里（skeleton/alchemist/football + 奇幻单位）
    return zombieModel[this.modelId] || zombieModel;
  }

  // 命中球高度/半径倍率。固定口径的模型查 HIT；HIT 里没有的模型（giant）
  // 用加载后量好的包围盒推：胸口≈九成身高、头部≈头顶、半径按身宽。
  // 存的是倍率不是世界半径：调用方一律 0.46 × scaleFactor × hitRadiusScale。
  syncHitSpheres() {
    const hit = hitForModel(this.def.model, this.modelSource());
    this.chestY = hit.chest;
    this.headY = hit.head;
    this.hitRadiusScale = hit.radius;
  }

  buildRig() {
    // 按 def.model 选模型：不写就是普通僵尸 glb，'skeleton' 是 KayKit 骷髅，'alchemist' 是炼金僵尸，'football' 是橄榄球僵尸
    this.modelId = MODELS[this.def.model] ? this.def.model : 'zombie';
    // 无头：没有任何 glb / 材质 / 骨骼，命中球口径由 syncHitSpheres 的查表给出
    if (this.ctx.headless) {
      this.isSkeleton = this.modelId === 'skeleton';
      this.mats = [];
      this.matBase = [];
      this.body = null;
      this.mixer = null;
      this.actions = null;
      this.hat = null;
      return;
    }
    const src = this.modelSource();
    const def = MODELS[this.modelId];
    this.isSkeleton = this.modelId === 'skeleton';

    // 骨骼模型每个僵尸克隆一份：骨骼必须独立，材质也要独立（白闪/冰冻）
    // 骨骼模型必须用 SkeletonUtils.clone，否则所有僵尸共享同一套骨骼会一起动
    this.body = src.scene ? cloneSkinned(src.scene) : new THREE.Group();
    // 两层缩放不能混：
    //   root.scale = def.scale（类型的体型倍率）
    //   body.scale = 模型自身的归一化缩放（老四套手写在 slot.scale，在这里乘）
    // targetHeight 模型的缩放已由 fitToHeight 烙进 scene.scale，clone 会原样带来 ——
    // 这里绝不能再 setScalar 把它抹掉。曾经对归一化模型填 1，把烘好的缩放冲掉，
    // 模型按原始 glb 尺寸渲染（蝙蝠 4.7 米、老鼠 2.2 米、巨人 3.9 米），而命中球
    // 仍按 targetHeight 口径标定 —— 这就是「看着打中却不掉血」的根源。
    if (!def.targetHeight) this.body.scale.setScalar((src && src.scale) || def.scale || 1);
    this.model.add(this.body);

    this.mats = [];
    this.matBase = [];
    this.body.traverse((n) => {
      if (!n.isMesh) return;
      const m = n.material.clone();
      m.envMap = this.ctx.env || null;
      m.envMapIntensity = 0.35;
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 0;
      m.color.copy(this.baseTint);
      n.material = m;
      n.castShadow = true;
      n.receiveShadow = false;
      // 影子关掉 frustumCulled 误判（骨骼动画会让包围盒失真，跑动时突然消失）
      n.frustumCulled = false;
      this.mats.push(m);
      this.matBase.push(m.color.clone());
    });

    this.buildAnimations();
    this.buildHat();
    // 铜钟停机提示：脚下一圈青色光环，只在被抓停时点亮（衰减由 updateStop 负责）。
    if (this.def.family === 'toy' && this.ctx.cloud) {
      this.stopCue = new THREE.Mesh(skillGeometry, new THREE.MeshBasicMaterial({
        color: 0x8fe6d8, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
      }));
      this.stopCue.rotation.x = -Math.PI / 2;
      this.stopCue.renderOrder = 2;
      this.stopCue.position.y = 0.045 / this.scaleFactor;
      this.stopCue.scale.setScalar(Math.max(0.7, this.radius * 2.2) / this.scaleFactor);
      this.stopCue.visible = false;
      this.root.add(this.stopCue);
    }
    // 胸甲被打穿后重建/接管时保持不可见（快照只带 ar，不带节点状态）。
    if (this.hat && this.armorHp <= 0) this.hat.visible = false;
  }

  // 骨骼动画：idle / walk / attack / die / hit 各一条，同一时刻只播一条。
  // 两套模型的动作名不同，按模型用不同候选名。
  buildAnimations() {
    if (this.ctx.headless) return;
    const src = this.modelSource();
    const clips = (src && src.clips) || [];
    this.mixer = clips.length ? new THREE.AnimationMixer(this.body) : null;
    this.actions = {};
    this.current = null;
    // 没有动画片段的模型（僵尸博士的源 FBX 没有 AnimStack）走程序化骨骼摆动：
    // 骨骼是真实存在的，只是逐帧由代码定角度，不走 AnimationMixer。
    this.procRig = !clips.length ? this.buildProcRig() : null;
    if (!this.mixer) return;

    const pick = (names) => {
      for (const n of names) {
        const c = findClip(clips, n);
        if (c) return c;
      }
      return null;
    };
    // 按**动画族**取候选名，不按模型逐个写分支（见 docs/design/DESIGN-night-forest.md §1.4：
    // 40 个 aigc 怪只有约 12 个命名族，加一只新怪只是往族上挂，不用再写 if）。
    // ANIM_FAMILIES 是纯数据，单元测试直接校验每个 ZOMBIES 类型都能落到一个族上。
    const family = ANIM_FAMILIES[this.modelId] || (this.isSkeleton ? 'kaykit' : 'quaternius');
    const names = ANIM_NAMES[family] || ANIM_NAMES.quaternius;
    const want = {
      idle: pick(names.idle),
      walk: pick(names.walk),
      attack: pick(names.attack),
      die: pick(names.die),
      hit: pick(names.hit),
    };
    if (names.duck) want.duck = pick(names.duck);
    for (const k in want) {
      if (!want[k]) continue;
      const a = this.mixer.clipAction(want[k]);
      if (k === 'attack' || k === 'die' || k === 'hit' || k === 'duck') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }
    this.play('idle', 0);
    // 先把 idle 姿态真正写进骨骼，再挂配件：glb 的 bind pose 带着 108° Z-up 修正，
    // 在 bind pose 里算朝向会让帽子相对游戏姿态歪掉（交通锥曾因此斜插在脑后）。
    this.mixer.update(0);
  }

  play(name, fade) {
    if (this.ctx.headless) return;
    // 程序化骨架不走进这里：它每帧由 updateProcAnim 重新摆，切「动作」没有意义
    if (this.procRig) return;
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  // ── 程序化骨骼动画（仅用于没有动画片段的模型，目前是僵尸博士）─────────────
  // 源 FBX 只有绑定姿态，没有 AnimStack。与其硬套别的骨架的旋转（两套骨轴/摆平面不同，
  // 搬过来腿会绕错轴、脚被抬到 1.3 米——试过，见 docs/ZOMBIE-MODELS.md），
  // 不如按「关节绕哪个轴会往哪动」的实测结果直接摆动：
  //   大腿/小腿：局部 Z（前后摆）、局部 X（左右开合）
  //   手臂：局部 X（前后）、局部 Z（外展）；小臂：局部 Z（屈肘）
  //   脊柱/头：局部 X（前后点头）、局部 Z（侧倾）
  // 基准 = 每个骨骼克隆时的绑定局部旋转，每帧在它上面叠角度，永不累积。
  buildProcRig() {
    if (this.ctx.headless) return;
    const get = (n) => this.body.getObjectByName(n) || null;
    const bones = {
      hips: get('Hips'), spine: get('Spine'), spine1: get('Spine1'), head: get('Head'),
      armL: get('LeftArm'), armR: get('RightArm'), foreL: get('LeftForeArm'), foreR: get('RightForeArm'),
      thighL: get('LeftUpLeg'), thighR: get('RightUpLeg'), shinL: get('LeftLeg'), shinR: get('RightLeg'),
    };
    if (!bones.thighL || !bones.armL) return null;
    const rest = {};
    for (const k in bones) if (bones[k]) rest[k] = bones[k].quaternion.clone();
    return { bones, rest, t: 0, walk: 0, gait: 0 };
  }

  // 每帧调用：moving 决定迈步幅度，attackAnim/死亡分别给手臂与整体姿态加权。
  updateProcAnim(dt, moving, dead) {
    if (this.ctx.headless) return;
    const rig = this.procRig;
    if (!rig) return;
    rig.t += dt;
    // 迈步相位：走路时按速度推进，站住时缓慢衰减（避免突然定格）
    rig.gait = moving ? rig.gait + dt * (3.1 + this.speed * 1.5) : rig.gait + dt * 0.6;
    rig.walk += ((moving ? 1 : 0) - rig.walk) * Math.min(1, dt * 8);
    const t = rig.t;
    const s = Math.sin(rig.gait);
    const c = Math.cos(rig.gait);
    const w = rig.walk;
    const breathe = Math.sin(t * 1.8) * 0.02;
    const atk = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.4) * Math.PI) : 0;
    const set = (key, ax, ay, az) => {
      const b = rig.bones[key];
      if (!b) return;
      tmpQ.setFromEuler(tmpE.set(ax, ay, az));
      b.quaternion.copy(rig.rest[key]).multiply(tmpQ);
    };
    if (dead) {
      // 死亡：整体后仰倒地由上层负责下沉，这里让四肢松下来
      set('spine', 0.25, 0, 0);
      set('head', 0.3, 0, 0);
      set('armL', -0.5, 0, 0.4);
      set('armR', -0.5, 0, -0.4);
      set('thighL', 0, 0, 0.3);
      set('thighR', 0, 0, -0.3);
      return;
    }
    // 腿：前后交替迈步；抬腿时膝盖屈
    set('thighL', 0, 0, s * 0.5 * w);
    set('thighR', 0, 0, -s * 0.5 * w);
    set('shinL', 0, 0, Math.max(0, -s) * 0.6 * w + 0.05);
    set('shinR', 0, 0, Math.max(0, s) * 0.6 * w + 0.05);
    // 手臂：与腿反相摆动；攻击时右手抬高砸下
    set('armL', -s * 0.45 * w + breathe, 0, 0.12);
    set('armR', s * 0.45 * w - atk * 1.5, 0, -0.12);
    set('foreL', 0, 0, 0.35 + Math.max(0, s) * 0.35 * w);
    set('foreR', 0, 0, -0.35 - Math.max(0, s) * 0.35 * w - atk * 0.8);
    // 躯干：行走时左右轻晃 + 上下起伏交给 model.position.y（已有逻辑）
    set('hips', 0, c * 0.08 * w, c * 0.05 * w);
    set('spine', breathe - atk * 0.25, 0, -c * 0.04 * w);
    set('spine1', breathe * 0.6, 0, 0);
    set('head', -breathe * 0.8 + atk * 0.3, Math.sin(t * 0.9) * 0.08, 0);
  }

  // 交通锥 / 铁桶：加在 glb 头顶（模型单位，Y 向上，头骨顶约 1.0）
  buildHat() {
    if (this.ctx.headless) return;
    const acc = this.def.acc;
    // 玩具卫兵的胸甲是 glb 里自带的可拆卸网格（见 tools/build-toy-models.mjs），
    // 不在这里新建几何，只把那块 mesh 当作 this.hat，破甲时直接隐藏。
    // 注意 getObjectByName 找不到时返回 undefined，赋给 this.hat 会把破甲/隐藏逻辑变成空操作。
    if (acc === 'chestArmor') {
      const armor = this.body ? this.body.getObjectByName('ChestArmor') : null;
      this.hat = armor || null;
      return;
    }
    if (acc !== 'cone' && acc !== 'bucket' && acc !== 'club' && acc !== 'helmet' && acc !== 'balloon') return;

    const hat = new THREE.Group();
    const headBone = this.isSkeleton ? this.body.getObjectByName('head') : this.body.getObjectByName('Head');
    const isHeadTop = acc === 'cone' || acc === 'bucket';
    const hatSrc = this.modelSource();
    const modelScaleForHat = MODELS[this.modelId].scale || (hatSrc && hatSrc.scale) || 1;
    const hatWorldScale = modelScaleForHat * this.scaleFactor;
    if (headBone) {
      this.body.updateWorldMatrix(true, true);
      const headScale = headBone.getWorldScale(new THREE.Vector3()).x;
      // 只抵消骨架附带的缩放，保留模型归一化与类型大小。
      hat.scale.setScalar(hatWorldScale / headScale);
      if (isHeadTop || acc === 'helmet') {
        this._hatPending = true;
      } else {
        const target = new THREE.Vector3(0, 1.11, 0.03).applyMatrix4(this.body.matrixWorld);
        hat.position.copy(headBone.worldToLocal(target));
        headBone.getWorldQuaternion(hatQuat).invert();
        hat.quaternion.copy(hatQuat);
      }
    } else {
      hat.position.set(0, acc === 'helmet' ? 1.76 : 1.11, 0.03);
    }

    const push = (geo, color, opts) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: (opts && opts.roughness) !== undefined ? opts.roughness : 0.6,
        metalness: (opts && opts.metalness) || 0,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        envMap: this.ctx.env || null,
        envMapIntensity: 0.4,
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = false;
      // 父级帽子被缩到 1/骨骼缩放后，别让包围盒剔除在动画里误判
      m.frustumCulled = false;
      hat.add(m);
      this.mats.push(mat);
      this.matBase.push(mat.color.clone());
      return m;
    };

    if (acc === 'club') {
      // Boss 的木棒。骷髅模型有 handslotr 专用挂载点（右手），挂上去会跟着手臂挥动；
      // 它的局部 +Y 指向世界 +Z（模型正前方），所以棒子沿 +Y 摆就是朝前伸。
      // 尺寸按 2.166 的骷髅模型单位给，再被 SKELETON_SCALE 和 scaleFactor 放大。
      const slot = this.isSkeleton ? this.body.getObjectByName('handslotr') : null;
      if (slot) {
        hat.position.set(0, 0, 0);
        // 和帽子同理：骷髅骨骼也在带缩放的骨架下，不抵掉的话木棒会跟着放大
        slot.updateWorldMatrix(true, false);
        hat.scale.setScalar(hatWorldScale / slot.getWorldScale(new THREE.Vector3()).x);
        hat.rotation.set(Math.PI, 0, 0); // 棒头朝向手腕外，避免穿进小臂
        push(new THREE.CylinderGeometry(0.026, 0.034, 0.62, 10), 0x7d5733, { roughness: 0.85 });
        push(new THREE.CylinderGeometry(0.062, 0.078, 0.24, 10), 0x5b3d22, { roughness: 0.8 });
        const head = hat.children[hat.children.length - 1];
        head.position.y = 0.36;
        const shaft = hat.children[hat.children.length - 2];
        shaft.position.y = -0.05;
        slot.add(hat);
        this.hat = hat;
        return;
      }
      // 非骷髅模型（旧 Boss 造型）继续用体前悬挂
      hat.position.set(-0.26, 0.46, 0.06);
      hat.rotation.set(0.35, 0, 0.28);
      push(new THREE.CylinderGeometry(0.038, 0.05, 0.52, 10), 0x7d5733, { roughness: 0.85 });
      push(new THREE.CylinderGeometry(0.085, 0.105, 0.2, 10), 0x5b3d22, { roughness: 0.8 });
      const head2 = hat.children[hat.children.length - 1];
      head2.position.y = -0.3;
      const shaft2 = hat.children[hat.children.length - 2];
      shaft2.position.y = 0.02;
      this.body.add(hat);
      this.hat = hat;
      return;
    }

    if (acc === 'helmet') {
      // 前额开口抬高，侧面与后脑下包：不是套在头上的半球，也不遮住眼睛。
      const rx = 0.30, ry = 0.285, rz = 0.30;
      const shellGeo = new THREE.SphereGeometry(1, 32, 20, 0, TAU, 0, 1.85);
      const pos = shellGeo.attributes.position;
      const uv = shellGeo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const phi = uv.getX(i) * TAU;
        const theta = (1 - uv.getY(i)) * (1.85 - 0.62 * Math.max(0, Math.sin(phi)) ** 6);
        pos.setXYZ(i, -Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
      }
      shellGeo.computeVertexNormals();
      const shell = push(shellGeo, 0xb82e29, { roughness: 0.38 });
      shell.scale.set(rx, ry, rz);
      shell.material.side = THREE.DoubleSide;
      // 米白中线贴着椭球表面，从前额跨过头顶延伸到后脑。
      const stripeGeo = new THREE.PlaneGeometry(1, 1, 4, 32);
      const stripePos = stripeGeo.attributes.position;
      for (let i = 0; i < stripePos.count; i++) {
        const t = 1.2 - (1 - stripeGeo.attributes.uv.getY(i)) * 3.05;
        const x = (stripeGeo.attributes.uv.getX(i) - 0.5) * 0.15;
        const r = Math.sqrt(1 - x * x) * 1.008;
        stripePos.setXYZ(i, x, Math.cos(t) * r, Math.sin(t) * r);
      }
      stripeGeo.computeVertexNormals();
      const stripe = push(stripeGeo, 0xf3e5cc, { roughness: 0.5 });
      stripe.scale.set(rx, ry, rz);
      stripe.material.side = THREE.DoubleSide;
      // 两圈弧形护面杆，从耳侧绕到嘴前；共用一个网格，保持原有 draw call 预算。
      const cageGeos = [];
      for (const y of [-0.055, -0.14]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.27, 0.01, 0.015),
          new THREE.Vector3(-0.245, y, 0.24),
          new THREE.Vector3(0, y - 0.025, 0.36),
          new THREE.Vector3(0.245, y, 0.24),
          new THREE.Vector3(0.27, 0.01, 0.015),
        ]);
        cageGeos.push(new THREE.TubeGeometry(curve, 28, 0.014, 8, false));
      }
      for (const x of [-0.1, 0.1]) {
        const curve = new THREE.LineCurve3(new THREE.Vector3(x, -0.072, 0.345), new THREE.Vector3(x, -0.157, 0.345));
        cageGeos.push(new THREE.TubeGeometry(curve, 1, 0.012, 8, false));
      }
      const cage = mergeGeometries(cageGeos);
      for (const geo of cageGeos) geo.dispose();
      push(cage, 0x555b60, { roughness: 0.45, metalness: 0.45 });
      for (const x of [-0.302, 0.302]) {
        const ear = push(new THREE.CylinderGeometry(0.046, 0.046, 0.018, 16), 0xf3e5cc, { roughness: 0.55 });
        ear.rotation.z = Math.PI / 2;
        ear.position.set(x, -0.025, 0.025);
      }
      (headBone || this.body).add(hat);
      this.hat = hat;
      if (this._hatPending) hat.visible = false;
      return;
    }

    if (acc === 'balloon') {
      // 气球：绑在背后的粉色气球 + 一根细绳。它同时是「这只是在天上」的唯一视觉线索，
      // 所以气球本体做得比头还大，玩家在远处也能一眼分辨高度。
      const balloon = new THREE.Group();
      balloon.position.set(0, 0.72, 0.16);
      const pushB = (geo, color, opts) => {
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: (opts && opts.roughness) !== undefined ? opts.roughness : 0.45,
          metalness: 0,
          emissive: 0xffffff,
          emissiveIntensity: 0,
          envMap: this.ctx.env || null,
          envMapIntensity: 0.5,
        });
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.frustumCulled = false;
        balloon.add(m);
        this.mats.push(mat);
        this.matBase.push(mat.color.clone());
        return m;
      };
      const skin = this.variant % 2 === 0 ? 0xe14d8b : 0x4d9be1;
      const b = pushB(new THREE.SphereGeometry(0.27, 16, 14), skin);
      b.scale.set(1, 1.18, 1);
      b.position.y = 0.95;
      // 细绳：从气球底部垂到背后
      pushB(new THREE.CylinderGeometry(0.006, 0.006, 0.72, 4), 0x3a3a3a, { roughness: 0.9 });
      balloon.children[balloon.children.length - 1].position.set(0, 0.42, 0);
      this.body.add(balloon);
      // 注意：气球是**背后的道具**，不是头饰。不能赋给 this.hat —— 那会让「hat 必须高于头骨」
      // 的配件不变量失真，而且破甲逻辑会去隐藏一只气球。单独存 balloon。
      this.balloon = balloon;
      return;
    }

    if (acc === 'cone') {
      // 路障锥：底座 + 锥体 + 两道反光带。组原点在底座**下沿**，整只锥子向上叠，
      // 旧代码四件都摆在 y=0，导致锥体只剩半截、反光带糊在底座上。
      const base = push(new THREE.CylinderGeometry(0.225, 0.235, 0.035, 24), 0xd85c24, { roughness: 0.75 });
      base.position.y = 0.0175;
      const bodyCone = push(new THREE.CylinderGeometry(0.05, 0.195, 0.38, 24), 0xe0662a, { roughness: 0.6 });
      bodyCone.position.y = 0.225;
      const lowBand = push(new THREE.CylinderGeometry(0.147, 0.175, 0.07, 24, 1, true), 0xf3efe2, { roughness: 0.45 });
      lowBand.position.y = 0.13;
      const highBand = push(new THREE.CylinderGeometry(0.101, 0.122, 0.055, 24, 1, true), 0xf3efe2, { roughness: 0.45 });
      highBand.position.y = 0.26;
    } else {
      // 铁桶：桶身 + 上下箍。组原点在桶身中心，桶沿在 ±0.17，扣在头上时沿口约在眉骨。
      push(new THREE.CylinderGeometry(0.315, 0.34, 0.34, 28), 0xb9c0c7, { roughness: 0.5, metalness: 0.45 });
      const rimLow = push(new THREE.TorusGeometry(0.34, 0.016, 8, 28), 0x878f96, { roughness: 0.45, metalness: 0.5 });
      rimLow.rotation.x = Math.PI / 2;
      rimLow.position.y = -0.17;
      const rimHigh = push(new THREE.TorusGeometry(0.315, 0.014, 8, 28), 0x878f96, { roughness: 0.45, metalness: 0.5 });
      rimHigh.rotation.x = Math.PI / 2;
      rimHigh.position.y = 0.17;
    }

    // 有 Head 骨骼就挂骨骼（跟着头部动），否则退回身体（静态模型/骨骼名不匹配时）
    (headBone || this.body).add(hat);
    this.hat = hat;
    if (this._hatPending) hat.visible = false;
  }

  // 游戏、图鉴和压测共用同一挂点；首帧骨骼/蒙皮稳定后再落帽。
  mountHeadTop() {
    if (this.ctx.headless) return;
    const acc = this.def.acc;
    if (acc !== 'cone' && acc !== 'bucket' && acc !== 'helmet') return;
    this._hatPending = false;
    const headBone = this.isSkeleton ? this.body.getObjectByName('head') : this.body.getObjectByName('Head');
    if (!this.hat || !headBone) {
      if (this.hat) this.hat.visible = true;
      return;
    }
    this.root.updateMatrixWorld(true);
    const local = headCrownLocal(this, headBone);
    if (!local) {
      this._hatPending = true;
      this.hat.visible = false;
      return;
    }
    this.hat.position.copy(local);
    // football 的 Head 局部 +X 是脸朝向；zombie 则是 +Z。旋转留在骨骼局部，不依赖生成时的世界朝向。
    this.hat.rotation.set(0, acc === 'helmet' && this.modelId === 'football' ? Math.PI / 2 : 0, 0);
    const inset = acc === 'cone' ? -0.035 : acc === 'bucket' ? -0.14 : -0.235;
    this.hat.translateY(inset * this.hat.scale.y);
    this.hat.visible = !this.armorBroken;
  }

  // 白闪 / 寒冰要同时作用到身体和帽子，所以遍历所有材质
  applyFlash(v) {
    if (this.ctx.headless) return;
    for (let i = 0; i < this.mats.length; i++) this.mats[i].emissiveIntensity = v;
  }

  applyTint(ice) {
    if (this.ctx.headless) return;
    for (let i = 0; i < this.mats.length; i++) {
      const m = this.mats[i];
      m.color.copy(this.matBase[i]);
      if (ice > 0) m.color.lerp(ICE, ice);
      m.color.multiply(this.baseTint);
    }
  }

  // 命中球按**模型实际身高**归一化，两套模型的体块比例差很多：
//   僵尸（高 1.194）：胸口 1.02、头部 1.52  → 归一化 0.854 / 1.273（÷ 模型高）
//   骷髅（高 2.166）：躯干 0.376–1.425、头 1.193–2.166 → 胸口 0.90、头部 1.68
// 乘 scaleFactor 后就是世界高度；再乘模型自身的 SKELETON_SCALE/ZOMBIE_SCALE 由 root 统一处理。
// 注意：这里返回的是**模型局部单位**，调用方（ProjectileSystem / WeaponSystem）会再乘 scaleFactor。
  // 注意：空中单位的 root.position.y = airHeight，命中球的高度要跟着抬，否则打不到气球。
  getAimPoint(out) {
    out.set(this.root.position.x, this.root.position.y + this.chestY * this.scaleFactor * this.model.scale.y, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, this.root.position.y + this.chestY * this.scaleFactor * this.model.scale.y, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, this.root.position.y + this.headY * this.scaleFactor * this.model.scale.y, this.root.position.z);
    return out;
  }

  get armorAlive() {
    return this.armorHp > 0;
  }


  // 伤害结算：先过护甲层，再打血。
  // opts（可选，第 4 参，不传就是老行为）：
  //   type  : 'pea' | 'explosion' | 'burn' | 'pierce'
  //   burn  : { dps, time } 命中挂燃烧（最多一层，重复命中只刷新时间）
  //   aerialDamage : 对空中目标的伤害倍率（火豌豆 0.25）；null 表示该来源根本打不到空中目标
  hit(dmg, slow, head, opts) {
    // guest 的本地命中只做白闪；血量和死亡由 host 快照决定。
    if (this.remote) {
      this.flash = Math.max(this.flash, 0.85);
      this.applyFlash(0.55);
      return false;
    }
    if (!this.alive || this.dying || this.spawnT < 0.5) return false;
    const o = opts || null;
    const source = o && o.source === 1 ? 1 : 0;
    this.lastHitBy = source;
    if (o && o.burn) this.burnSource = source;
    const type = (o && o.type) || 'pea';
    // 协同集火：标记成立**之后**的伤害才吃 1.08，凑成标记的这一下不算
    let amount = dmg * (this.coop ? COOP.mul : 1);
    // 历史快照里的招式状态（命中仲裁用）；没给就用当前状态兜底——本地命中本来就没有历史，
    // 硬当成 idle 会让蹲伏中的蘑菇王白吃满伤。
    const hist = o ? o.skillState : undefined;
    const skillState = hist !== undefined ? hist : this.skillState;
    if (this.def.duck && skillState === 'duck') amount *= this.def.duck.reduce;
    // 报时兔按「打击生效那一刻」的技能状态结算身体倍率，且不改它当前的招式。
    // 头不算：爆头走 headshotMul，不叠身体倍率。判定以「打击生效那一刻的状态」为准：
    // 当前不在 recover 就是暴露；当前在 recover 时再看历史，历史缺失按此刻仍算暴露。
    if (this.def.clock && !head) {
      const exposed = this.skillState !== 'recover' || hist === undefined;
      if (exposed) amount *= this.def.clock.bodyMul;
    }
    if (source === 0) this.coopA = this.age;
    else this.coopB = this.age;
    const coop = this.age - this.coopA <= COOP.window && this.age - this.coopB <= COOP.window;
    if (coop !== this.coop) {
      this.coop = coop;
      this.setCoopMark(coop);
    }

    // 护甲：按材质吸收，护甲自己扣血；吸收比例之外的部分才落到血条上。
    if (this.armorHp > 0 && this.armorRule) {
      const rule = this.armorRule;
      // 穿透弹和燃烧会被金属挡掉它的「额外收益」，但伤害本身照算 —— 否则仙人掌打铁桶会变成负效率
      let armorDmg = amount;
      if (type === 'burn' && rule.burnImmune) {
        armorDmg = 0;
      } else if (type === 'pierce' && rule.pierceBlock) {
        armorDmg = amount * (1 - rule.absorption);
      } else if (o && o.armorBreak) {
        // 火豌豆专用：燃烧直接穿进护甲层，按 2 倍速度烧
        armorDmg = amount * 2;
      }
      const absorbed = rule.absorption;
      const toArmor = Math.min(this.armorHp, armorDmg);
      this.armorHp -= toArmor;
      // 护甲吸收掉的伤害不再落到血条：护甲 HP 本身就代表「挨多少打才掉」，用吸收比例折算。
      amount = amount * (1 - absorbed) + Math.max(0, armorDmg - toArmor);
      if (this.armorHp <= 0 && !this.armorBroken) this.breakArmor();
    }

    this.hp -= amount;
    this.flash = 1;
    this.headHit = !!head;
    if (slow) this.slowTimer = 2.6;

    // 燃烧：最多一层，重复命中只刷新计时（叠层会跟 0.17 秒射速相乘，DPS 直接爆表）
    if (o && o.burn) {
      this.burnDps = o.burn.dps;
      this.burnTimer = o.burn.time;
      this.burnTickT = Math.min(this.burnTickT || 0.25, 0.25);
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.startDeath();
      return true;
    }
    return false;
  }

  // 护甲打穿：头盔/铁桶从模型上掉下来（隐藏 acc 网格），播碎片粒子。
  breakArmor() {
    this.armorBroken = true;
    this.armorHp = 0;
    if (this.hat) this.hat.visible = false;
    const p = this.root.position;
    this.ctx.particles.burst({
      pos: tmpV.set(p.x, (this.airHeight || 0) + this.headY * this.scaleFactor, p.z),
      color: this.def.armor && this.def.armor.material === 'buffalo' ? [0x9c2f2b, 0xf2e6d2, 0x6d1f1c] : [0xb9c0c7, 0x878f96, 0xf3efe2],
      count: 12,
      speed: 3.2,
      size: 0.1,
      life: 0.7,
      gravity: 10,
    });
    if (this.ctx.sfx && this.ctx.sfx.armorBreak) this.ctx.sfx.armorBreak();
  }

  startDeath() {
    this.dying = true;
    this.skillState = 'idle';
    this.skillTimer = 0;
    if (this.skillCue) this.skillCue.visible = false;
    // 气球被打爆有专属的「啵」，别和普通僵尸的扑倒混在一起
    if (this.airborne && this.ctx.sfx && this.ctx.sfx.balloonPop) this.ctx.sfx.balloonPop();
    this.deathT = 0;
    this.shadow.visible = false;
    const p = this.root.position;
    this.ctx.particles.burst({
      pos: tmpV.set(p.x, 1.2 * this.scaleFactor, p.z),
      color: [0x6f9a3f, 0x8fbf58, 0x4b6b28, 0x5f1d16],
      count: this.type === 'boss' ? 28 : 14,
      speed: 3.8,
      size: 0.14,
      life: 0.8,
      gravity: 9,
    });
  }

  // host 快照里的单只僵尸：id/type/位置/朝向/血量/动画状态/减速。
  // 悬赏/协同的头顶标记：用一张发光贴图，不额外建几何
  setCoopMark(on) {
    if (this.ctx.headless) return;
    if (on && !this.markCoop) {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: 0x63d8ff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.85,
        })
      );
      m.scale.set(1.1, 1.1, 1);
      m.position.y = 2.45;
      this.root.add(m);
      this.markCoop = m;
    }
    if (this.markCoop) this.markCoop.visible = !!on;
  }

  setBounty(on) {
    // 逻辑字段是权威状态（进快照、影响计分），必须无条件写
    this.bounty = !!on;
    if (this.ctx.headless) return;
    if (on && !this.markBounty) {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: 0xffc21f,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.95,
        })
      );
      m.scale.set(1.6, 1.6, 1);
      m.position.y = 2.75;
      this.root.add(m);
      this.markBounty = m;
    }
    if (this.markBounty) this.markBounty.visible = !!on;
  }

  buildSkillCue() {
    if (this.ctx.headless) return;
    if (!this.def.slam && !this.def.duck && !this.def.landing && !this.def.dive && !this.def.ambush &&
        !this.def.charge && !this.def.tea && !this.def.punch && !this.def.clock && !this.def.flight) return;
    this.skillCue = new THREE.Mesh(skillGeometry, new THREE.MeshBasicMaterial({
      color: 0xffac55, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.skillCue.rotation.x = -Math.PI / 2;
    this.skillCue.renderOrder = 2;
    this.root.add(this.skillCue);
    this.updateSkillCue();
  }

  setSkill(state, timer) {
    this.skillState = state;
    this.skillTimer = timer;
    this.attackAnim = 0;
  }

  illuminated(targets) {
    const flash = this.map && this.map.flash;
    if (!flash || !flash.visible) return false;
    flash.getWorldPosition(lightOrigin);
    flash.target.getWorldPosition(lightDirection);
    lightDirection.sub(lightOrigin).normalize();
    this.getChest(lightTarget).sub(lightOrigin);
    const distance = lightTarget.length();
    if (distance <= this.def.ambush.notice &&
        lightTarget.normalize().dot(lightDirection) >= Math.cos(flash.angle)) return true;
    // guest 的相机不在 host 场景中，用已同步的代理视角重建同一手电锥。
    for (let i = 1; i < targets.length; i++) {
      const target = targets[i];
      if (!target || target.dead || target.downed || !target.eye) continue;
      const cp = Math.cos(target.pitch);
      lightDirection.set(-Math.sin(target.yaw) * cp, Math.sin(target.pitch), -Math.cos(target.yaw) * cp);
      this.getChest(lightTarget).sub(target.eye);
      if (lightTarget.length() <= this.def.ambush.notice &&
          lightTarget.normalize().dot(lightDirection) >= Math.cos(flash.angle)) return true;
    }
    return false;
  }

  // 铜钟停机：全局技能里 1.6 秒内玩具完全静止（位移/骨骼/技能/近战都不推进），
  // 只保留白闪消退和燃烧致死，否则玩家敲完钟还会被已经出招的怪白打。
  updateStop(dt) {
    if (this.stopTimer <= 0) return false;
    this.stopTimer = Math.max(0, this.stopTimer - dt);
    if (this.stopCue) this.stopCue.visible = this.stopTimer > 0;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.applyFlash();
    // 停机的最后一帧要立刻把控制权交还：否则这一整帧（位移/技能/近战）被白白吞掉，
    // 16 帧的停机看起来像 1 秒多，也会让纸飞机的落地窗口少一帧。
    return this.stopTimer > 0;
  }

  // 冲撞（弹簧鸭/报时兔）：锁向直线推进，撞墙或走满 range 结束。扫掠路径上每 seat 只结算一次。
  updateCharge(dt, targets) {
    const c = this.def.charge;
    const p = this.root.position;
    if (this.skillState === 'idle') {
      if (this.skillCooldown > 0) return false;
      const t = this.targetOf(targets);
      if (!t || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > c.range) return false;
      this.skillDirection.set(t.pos.x - p.x, 0, t.pos.z - p.z).normalize();
      this.rotY = Math.atan2(this.skillDirection.x, this.skillDirection.z);
      this.root.rotation.y = this.rotY;
      this.setSkill('telegraph', c.telegraph);
      return true;
    }
    if (this.skillState === 'telegraph') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) { this.setSkill('charge', c.range / c.speed); this.chargeSeen = 0; }
      return true;
    }
    if (this.skillState === 'charge') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      const step = c.speed * dt;
      const nx = p.x + this.skillDirection.x * step, nz = p.z + this.skillDirection.z * step;
      const cx = nx, cz = nz;
      // 贴墙就停：地图盒子挡住就换到恢复，避免冲进建筑。
      const blocked = (this.ctx.map.walls || []).some((w) =>
        Math.abs(cx - w.x) < w.hx + this.radius && Math.abs(cz - w.z) < w.hz + this.radius &&
        (w.hy === undefined || w.y + w.hy > 0.2));
      if (blocked || this.skillTimer <= 1e-8) { this.hitCharge(targets); this.setSkill('recover', c.recover); return true; }
      p.x = cx; p.z = cz;
      this.hitCharge(targets);
      return true;
    }
    this.skillTimer = Math.max(0, this.skillTimer - dt);
    if (this.skillTimer <= 1e-8) {
      this.setSkill('idle', 0);
      this.skillCooldown = c.period;
    }
    return true;
  }

  // 冲撞扫掠：玩家到线段(本帧位移)距离 < width 且垂直差在可跳范围外就算命中。
  hitCharge(targets) {
    const c = this.def.charge;
    const p = this.root.position;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || t.dead || t.downed || (this.chargeSeen & (1 << i))) continue;
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
      const along = dx * this.skillDirection.x + dz * this.skillDirection.z;
      const side = Math.abs(dx * this.skillDirection.z - dz * this.skillDirection.x);
      if (along > -c.width * 0.5 && along < this.radius + c.width * 0.5 && side < c.width * 0.5 + this.radius &&
          Math.abs(t.pos.y - p.y) < 1) {
        this.chargeSeen |= 1 << i;
        this.deliverHit(i);
      }
    }
  }

  // 技能伤害直接结算到对应 seat 的玩家。常规近战走 ctx.onAttack（按 targetSeat 分派）；
  // 玩具技能是定点/定向攻击，seat 在命中瞬间就确定了，直接命中才不会打错人。
  deliverHit(seat) {
    const t = this.ctx.cloud ? this.ctx.cloud.targets()[seat] : this.ctx.player;
    if (t && !t.dead && !t.downed) t.damage(this.def.damage, { airborne: false });
  }

  targetOf(targets) {
    for (const t of targets) if (t && !t.dead && !t.downed) return t;
    return null;
  }

  // 茶壶：锁地预警后从云端抛一壶茶落到预警点（tea 池上限 6）。
  updateTea(dt, targets) {
    const d = this.def.tea;
    const p = this.root.position;
    if (this.skillState === 'idle') {
      if (this.skillCooldown > 0) return false;
      const t = this.targetOf(targets);
      if (!t || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > d.range) return false;
      if (!this.ctx.cloud || !this.ctx.cloud.hasLineOfSight(this, t)) return false;
      // 锁定开火瞬间的地面点：之后玩家跑开也打不中，这是"可躲"的契约。
      this.skillCenter.set(t.pos.x, 0, t.pos.z);
      this.setSkill('teaTelegraph', d.telegraph);
      return true;
    }
    if (this.skillState === 'teaTelegraph') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) {
        this.ctx.cloud.throwTea(this, this.skillCenter);
        this.setSkill('recover', 0.3);
      }
      return true;
    }
    this.skillTimer = Math.max(0, this.skillTimer - dt);
    if (this.skillTimer <= 1e-8) { this.setSkill('idle', 0); this.skillCooldown = d.period; }
    return true;
  }

  // 八音盒小丑：0.7 秒预警后拳套沿预警时的方向直捅 2.2 米，命中判定只看固定扇区。
  updatePunch(dt, targets) {
    const d = this.def.punch;
    const p = this.root.position;
    if (this.skillState === 'idle') {
      if (this.skillCooldown > 0) return false;
      const t = this.targetOf(targets);
      if (!t || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > d.range) return false;
      this.skillDirection.set(t.pos.x - p.x, 0, t.pos.z - p.z).normalize();
      this.rotY = Math.atan2(this.skillDirection.x, this.skillDirection.z);
      this.root.rotation.y = this.rotY;
      this.setSkill('punchTelegraph', d.telegraph);
      return true;
    }
    if (this.skillState === 'punchTelegraph') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) {
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (!t || t.dead || t.downed) continue;
          const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > d.range + this.radius || Math.abs(t.pos.y - p.y) > 1) continue;
          // 拳套只打预警时锁定的方向：偏离中线超过一个身位就算躲开。
          const angle = Math.abs(Math.atan2(
            dx * this.skillDirection.z - dz * this.skillDirection.x,
            dx * this.skillDirection.x + dz * this.skillDirection.z));
          if (angle > Math.PI / 2) continue;
          this.deliverHit(i);
        }
        this.setSkill('recover', d.recover);
      }
      return true;
    }
    this.skillTimer = Math.max(0, this.skillTimer - dt);
    if (this.skillTimer <= 1e-8) { this.setSkill('idle', 0); this.skillCooldown = d.period; }
    return true;
  }

  // 报时兔：先放报时圈（预警 → 扩散），半血时再叠一圈；恢复完再锁向冲撞。
  updateClock(dt, targets) {
    const c = this.def.clock;
    const p = this.root.position;
    if (this.skillState === 'ringTelegraph') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) {
        this.ctx.cloud.emitWave(this);
        this.setSkill('ring', (c.radius - c.startRadius) / c.speed);
        // 半血以下直接排第二圈：等 1.2 秒 → 完整的 0.9 秒预警 → 再扩散一次，
        // 两圈都跑完才进恢复。只排一次，否则血量卡在半血会无限连圈。
        if (!this.clockRepeated && this.hp <= this.maxHp * 0.5) {
          this.clockRepeated = true;
          // repeat 的计时 = 等第一圈扩散完 + 额外的 1.2 秒。
          this.setSkill('repeat', (c.radius - c.startRadius) / c.speed + c.repeatDelay);
        }
      }
      return true;
    }
    if (this.skillState === 'ring') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) this.setSkill('recover', c.recover);
      return true;
    }
    if (this.skillState === 'repeat') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) {
        this.setSkill('ringTelegraph', c.telegraph);
        this.skillTimer = c.telegraph;
      }
      return true;
    }
    if (this.skillState === 'recover') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      // 收招结束才起冷却：和冲撞那招同口径，别让报时圈刚吃完就接着放下一招。
      if (this.skillTimer <= 1e-8) {
        this.setSkill('idle', 0);
        this.skillCooldown = c.period;
      }
      return true;
    }
    if (this.skillState !== 'idle') return true;
    if (this.skillCooldown > 0) return false;
    if (!this.ctx.cloud || !this.ctx.cloud.canStartAttack(this)) return false;
    const t = this.targetOf(targets);
    if (!t) return false;
    // 槽轮：第 0 轮永远先放报时圈（startRadius → radius 的扩散就是玩家的躲避窗口），
    // 之后一轮圈、一轮锁向冲撞交替 —— 连着的两圈会被冲撞隔开。
    const ringTurn = this.clockTurn % 2 === 0;
    this.clockTurn += 1;
    if (ringTurn) {
      this.clockRepeated = false;
      this.setSkill('ringTelegraph', c.telegraph);
      return true;
    }
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
    if (d > c.radius) return false;
    return this.updateCharge(dt, targets);
  }

  // 纸飞机：巡航 → 预警 → 下降落地打 2.4 秒豌豆窗口 → 升空。
  updateFlight(dt, targets) {
    const f = this.def.flight;
    const p = this.root.position;
    const state = this.skillState;
    if (state === 'fly') {
      this.skillTimer -= dt;
      if (this.skillTimer <= 0) this.setSkill('telegraph', f.telegraph);
    } else if (state === 'telegraph') {
      this.skillTimer -= dt;
      const t = this.targetOf(targets);
      if (t) { this.skillCenter.set(t.pos.x, 0, t.pos.z); this.rotY = Math.atan2(t.pos.x - p.x, t.pos.z - p.z); }
      if (this.skillTimer <= 0) this.setSkill('descent', f.descent);
    } else if (state === 'descent') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      this.airHeight = f.high * Math.max(0, 1 + this.skillTimer / f.descent);
      if (this.skillTimer <= 1e-8) { this.airHeight = 0; this.setSkill('land', f.groundTime); }
    } else if (state === 'land') {
      this.skillTimer -= dt;
      if (this.skillTimer <= 0) this.setSkill('rise', f.ascent);
    } else if (state === 'rise') {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      this.airHeight = f.high * Math.min(1, 1 - this.skillTimer / f.ascent);
      if (this.skillTimer <= 1e-8) { this.airHeight = f.high; this.setSkill('fly', f.cruise); }
    } else {
      this.setSkill('fly', f.cruise);
    }
    this.airborne = this.skillState !== 'land';
    p.y = this.airHeight;
    // 飞行循环全程接管：落地窗口也归这招管，放回常规近战会在着陆那几帧夹带一次撕咬。
    return true;
  }

  // 只由 host 推进阶段；返回 true 时，本帧不能移动或触发普通近战。
  updateSkill(dt, targets, target) {
    const p = this.root.position;
    if (this.skillCooldown > 0) this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    // clock 排在 charge 前面：报时兔自己也有 charge（冲撞是它的第二招），
    // 由 updateClock 槽轮决定什么时候把控制权交给 updateCharge。
    if (this.def.clock) return this.updateClock(dt, targets);
    if (this.def.charge) return this.updateCharge(dt, targets);
    if (this.def.tea) return this.updateTea(dt, targets);
    if (this.def.punch) return this.updatePunch(dt, targets);
    if (this.def.flight) return this.updateFlight(dt, targets);
    const slam = this.def.slam;
    if (slam) {
      if (this.skillState === 'idle') {
        if (!target || Math.hypot(target.pos.x - p.x, target.pos.z - p.z) > slam.range) return false;
        this.attackTimer -= dt;
        if (this.attackTimer > 0) return false;
        this.skillCenter.set(target.pos.x, 0, target.pos.z);
        this.setSkill('telegraph', slam.telegraph);
      } else if (this.skillState === 'telegraph') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer <= 1e-8) {
          this.setSkill('slam', 0);
          for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t || t.dead || t.downed ||
                Math.hypot(t.pos.x - this.skillCenter.x, t.pos.y, t.pos.z - this.skillCenter.z) > slam.radius) continue;
            this.targetSeat = i;
            this.ctx.onAttack(this);
          }
        }
      } else if (this.skillState === 'slam') {
        this.setSkill('recover', slam.recover);
      } else if (this.skillState === 'recover') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer <= 1e-8) {
          this.setSkill('idle', 0);
          this.attackTimer = 0;
        }
      }
      return this.skillState !== 'idle';
    }

    const duck = this.def.duck;
    if (duck) {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer <= 1e-8) {
        if (this.skillState === 'idle') this.setSkill('duck', duck.duration);
        else if (this.skillState === 'duck') this.setSkill('recover', duck.recover);
        else this.setSkill('idle', duck.period - duck.duration - duck.recover);
      }
      return this.skillState !== 'idle';
    }

    const flight = this.def.landing || this.def.dive;
    if (flight) {
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillState === 'fly') {
        this.airHeight = Math.min(flight.high, this.airHeight + (flight.high - flight.ground) * dt / flight.telegraph);
        if (this.skillTimer <= 1e-8) {
          this.skillCenter.set(p.x, 0, p.z);
          this.setSkill('telegraph', flight.telegraph);
        }
      } else if (this.skillState === 'telegraph') {
        this.airHeight = flight.ground + (flight.high - flight.ground) * this.skillTimer / flight.telegraph;
        if (this.skillTimer <= 1e-8) this.setSkill('land', flight.groundTime);
      } else if (this.skillState === 'land' && this.skillTimer <= 1e-8) {
        this.setSkill('fly', flight.period - flight.groundTime - flight.telegraph);
      }
      this.airborne = this.skillState !== 'land';
      p.y = this.airHeight;
      return this.skillState === 'telegraph';
    }

    const ambush = this.def.ambush;
    if (ambush) {
      if (this.skillState === 'ambush') {
        if ((target && Math.hypot(target.pos.x - p.x, target.pos.z - p.z) <= ambush.range) || this.illuminated(targets)) {
          this.setSkill('wake', ambush.wake);
        }
      } else if (this.skillState === 'wake') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer <= 1e-8) this.setSkill('idle', 0);
      }
      return this.skillState !== 'idle';
    }
    return false;
  }

  updateSkillCue() {
    if (!this.skillCue) return;
    const state = this.skillState;
    const impact = this.remote && this.def.slam && state === 'recover' && this.skillTimer > this.def.slam.recover * 0.75;
    // 玩具的预警环：冲撞/拳套/报时圈/茶壶都画在各自锁定的位置上，预警期间才亮。
    // 纸飞机的落地窗口用 'descent' 亮，其余节拍不亮（否则空中一直有一圈光）。
    const toyWarn = state === 'telegraph' || state === 'punchTelegraph' || state === 'ringTelegraph' ||
      state === 'teaTelegraph' || state === 'descent';
    this.skillCue.visible = !this.dying && !this.dead &&
      (impact || state === 'telegraph' || state === 'slam' || state === 'duck' || state === 'land' || state === 'ambush' || state === 'wake' || toyWarn);
    const slam = this.def.slam;
    const toyLocked = this.def.tea || state === 'teaTelegraph';
    const center = slam || toyLocked ? this.skillCenter : this.root.position;
    const dx = center.x - this.root.position.x, dz = center.z - this.root.position.z;
    const c = Math.cos(this.root.rotation.y), s = Math.sin(this.root.rotation.y);
    this.skillCue.position.set((dx * c - dz * s) / this.scaleFactor,
      (0.045 - this.root.position.y) / this.scaleFactor, (dx * s + dz * c) / this.scaleFactor);
    // 玩具的预警环半径取各自招式的实际覆盖范围：冲撞沿射线，拳套 2.2 米，茶滴是落点。
    const radius = slam ? slam.radius
      : this.def.charge ? this.def.charge.width * 0.5
        : this.def.punch ? this.def.punch.range
          : this.def.tea ? this.def.tea.radius
            : this.radius * 1.5;
    this.skillCue.scale.setScalar(radius / this.scaleFactor);
    this.skillCue.material.color.setHex(state === 'ambush' ? 0x976dc4 : state === 'duck' ? 0x65bcdc : 0xffac55);
    this.skillCue.material.opacity = state === 'ambush' ? 0.35 : 0.55 + Math.sin(this.age * 15) * 0.2;
  }

  // 姿态只读技能快照，guest 也调用但绝不推进技能时钟。
  updateSkillVisuals() {
    this.shadow.position.y = (0.025 - this.root.position.y) / this.scaleFactor;
    this.shadow.scale.setScalar(this.airborne ? 0.6 : 1);
    this.updateSkillCue();
    const state = this.skillState;
    // 20 Hz快照可能跳过单帧slam；恢复前段仍展示冲击，不改变权威计时或结算。
    const impact = this.remote && this.def.slam && state === 'recover' && this.skillTimer > this.def.slam.recover * 0.75;
    const flight = this.def.landing || this.def.dive;
    let special = false;
    let lean = 0, squash = 1;
    if (this.def.duck && (state === 'duck' || state === 'recover')) {
      this.play(state === 'duck' ? 'duck' : 'idle', 0.12);
      squash = state === 'duck' ? 0.65 : 1 - 0.35 * this.skillTimer / this.def.duck.recover;
      special = true;
    } else if (this.def.slam && state !== 'idle') {
      this.play(state === 'recover' && !impact ? 'idle' : 'attack', 0.1);
      lean = state === 'telegraph' ? -0.18 : 0.22;
      special = true;
    } else if (this.def.ambush && state !== 'idle') {
      this.play('idle', 0.1);
      squash = state === 'ambush' ? 0.6 : 1 - 0.4 * this.skillTimer / this.def.ambush.wake;
      special = true;
    } else if (flight) {
      this.play(state === 'land' && this.attackAnim > 0 ? 'attack' : 'idle', 0.12);
      lean = state === 'telegraph' ? 0.22 : state === 'land' ? 0 : -0.08;
      special = true;
    }
    this.model.scale.set(1, squash, 1);
    if (special) {
      this.model.position.y = 0;
      this.model.rotation.set(lean, 0, 0);
      if (this.mixer) this.mixer.timeScale = 1;
    }
    return special;
  }

  serialize() {
    let st = 0;
    if (this.dying) st = 3;
    else if (this.attackAnim > 0) st = 2;
    else if (this.animSpeed > 0.2) st = 1;
    return {
      id: this.netId,
      t: this.type,
      x: +this.root.position.x.toFixed(2),
      y: +this.root.position.y.toFixed(2),
      z: +this.root.position.z.toFixed(2),
      yaw: +this.root.rotation.y.toFixed(2),
      hp: Math.round(this.hp),
      st,
      sl: this.slowTimer > 0 ? 1 : 0,
      bo: this.bounty ? 1 : 0,
      co: this.coop ? 1 : 0,
      ab: this.airborne ? 1 : 0,
      // 模型的 Y 缩放（duck 压扁 / 受击压缩）：guest 直接用，不自己算姿态曲线。
      sp: +this.model.scale.y.toFixed(2),
      sk: this.skillState,
      kt: +this.skillTimer.toFixed(2),
      kx: +this.skillCenter.x.toFixed(2),
      kz: +this.skillCenter.z.toFixed(2),
      ys: +this.model.scale.y.toFixed(2),
      // 玩具专属：冷却 / 锁向 / 停机 / 冲撞已结算位图 / 出招轮次 / 甲血。
      // guest 只按这些值做姿态与提示，不自行推进任何一个时钟。
      kc: +this.skillCooldown.toFixed(2),
      kd: [+this.skillDirection.x.toFixed(2), +this.skillDirection.z.toFixed(2)],
      kh: +this.stopTimer.toFixed(2),
      ks: this.chargeSeen,
      ka: this.clockTurn || 0,
      ar: Math.round(this.armorHp),
    };
  }

  // guest 侧应用快照：只改位置/朝向/血量/动画，不参与任何 AI 或伤害。
  applyNetState(s) {
    this.spawnT = 1;
    this.model.position.y = 0;
    this.root.position.set(s.x, s.y, s.z);
    this.rotY = s.yaw;
    this.root.rotation.y = s.yaw;
    this.hp = s.hp;
    this.airHeight = s.y;
    if (s.ab !== undefined) this.airborne = !!s.ab;
    if (s.sk !== undefined) this.skillState = s.sk;
    if (s.kt !== undefined) this.skillTimer = s.kt;
    if (s.kx !== undefined && s.kz !== undefined) this.skillCenter.set(s.kx, 0, s.kz);
    if (s.kd) this.skillDirection.set(s.kd[0], 0, s.kd[1]);
    if (s.kc !== undefined) this.skillCooldown = s.kc;
    if (s.ks !== undefined) this.chargeSeen = s.ks;
    if (s.ka !== undefined) this.clockTurn = s.ka;
    if (s.kh !== undefined) this.stopTimer = s.kh;
    if (s.ar !== undefined) {
      this.armorHp = s.ar;
      if (this.hat && this.armorHp <= 0) this.hat.visible = false;
    }
    this.slowTimer = s.sl ? 0.2 : 0;
    if (!!s.bo !== this.bounty) this.setBounty(!!s.bo);
    if (!!s.co !== this.coop) this.setCoopMark(!!s.co);
    this.coop = !!s.co;
    if (s.st === 3) {
      if (this.skillCue) this.skillCue.visible = false;
      this.shadow.visible = false;
      if (!this.dying) {
        this.dying = true;
        this.deathT = 0;
        this.play('die', 0.12);
      }
      return;
    }
    if (this.dying) return;
    this.attackAnim = s.st === 2 ? 0.4 : 0;
    const special = this.updateSkillVisuals();
    if (!special && s.st === 2) {
      this.attackAnim = 0.4;
      this.play('attack', 0.1);
    } else if (!special && s.st === 1) {
      this.attackAnim = 0;
      this.play('walk', 0.18);
    } else if (!special) {
      this.attackAnim = 0;
      this.play('idle', 0.18);
    }
    if (s.sl) this.applyTint(0.55);
    else this.applyTint(0);
  }

  update(dt, player, colliders) {
    if (this.dead) return;
    if (this._hatPending) this.mountHeadTop();
    // 出生升起动画期间要计数（下面靠它判断就绪）；只有就绪之后才累计年龄 ——
    // 协同/悬赏的窗口都是按 age 算的，出生那 0.55 秒不该被算进去。
    if (this.spawnT >= 0.55) this.age += dt;

    if (this.remote) {
      if (this.dying) {
        this.deathT += dt;
        this.play('die', 0.12);
        if (this.mixer) this.mixer.update(dt);
        this.flash = Math.max(0, this.flash - dt * 3);
        this.applyFlash(this.flash * 0.45);
        if (this.deathT > 1.55) this.dead = true;
        return;
      }
      this.flash = Math.max(0, this.flash - dt * 12);
      if (this.flash > 0) this.applyFlash(this.flash * 0.45);
      if (this.slowTimer > 0) {
        this.slowTimer -= dt;
        this.applyTint(0.55);
        if (this.slowTimer <= 0) this.applyTint(0);
      }
      this.updateSkillVisuals();
      // guest 只照快照摆姿势，不自己推进骨骼：停机（kh>0）时 host 也冻着 mixer，
      // guest 一旦自推就会和 host 错开半个动作。
      if (this.mixer && this.stopTimer <= 0) this.mixer.update(dt);
      return;
    }

    if (this.dying) {
      this.deathT += dt;
      // 骨骼模型：播死亡动画，身体整体下沉保留
      this.play('die', 0.12);
      if (this.mixer) this.mixer.update(dt);
      this.flash = Math.max(0, this.flash - dt * 3);
      this.applyFlash(this.flash * 0.45);
      if (this.deathT > 0.55) {
        const k = Math.min(1, (this.deathT - 0.55) / 1.0);
        this.root.position.y = -k * 0.95;
        this.model.scale.setScalar(Math.max(0.02, 1 - k * 0.35));
      }
      if (this.procRig) this.updateProcAnim(dt, false, true);
      if (this.deathT > 1.55) this.dead = true;
      return;
    }

    if (this.spawnT < 0.55) {
      this.spawnT += dt;
      const t = Math.min(1, this.spawnT / 0.55);
      const e = 1 - Math.pow(1 - t, 3);
      this.model.position.y = -2.3 * (1 - e);
      this.model.rotation.z = Math.sin(t * 12) * 0.04 * (1 - t);
      if (this.mixer) this.mixer.update(dt);
      return;
    }

    this.animSpeed = 0;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 12);
      this.applyFlash(this.flash * 0.45);
    }

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.applyTint(0.55);
      if (this.slowTimer <= 0) this.applyTint(0);
    } else if (this.slowTimer > -1) {
      this.applyTint(0);
      this.slowTimer = -1;
    }

    // 燃烧：每 0.25 秒结算一跳，跳的时候才吐火苗粒子（每帧吐会把粒子池打爆）
    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.burnTickT -= dt;
      if (this.burnTickT <= 0.25) {
        if (this.burnTickT <= 0) {
          this.burnTickT += 0.25;
          const died = this.hit(this.burnDps * 0.25, false, false, { type: 'burn', source: this.burnSource || 0 });
          if (died) {
            this.ctx.zombies.handleKill(this, false);
            return;
          }
          this.fly_iconT = (this.fly_iconT || 0) + 1;
          if (this.fly_iconT % 2 === 1) {
            const p = this.root.position;
            this.ctx.particles.burst({
              pos: tmpV.set(p.x, (this.airHeight || 0) + 0.9 * this.scaleFactor, p.z),
              color: [0xff7a1a, 0xffd23f, 0xff3b1a],
              count: 2,
              speed: 1.4,
              size: 0.07,
              life: 0.4,
              gravity: -3,
              up: 1.2,
            });
          }
        }
      }
    }

    const targets = Array.isArray(player) ? player : [player];
    // Boss 双目标：每 8 s 强制换人，换之前 1 s 红光亮起 + 吼叫预警
    if (this.def.boss && targets.length > 1) {
      this.aggroT -= dt;
      if (this.aggroT <= BOSS_AGGRO.warn && !this.aggroWarnFired) {
        this.aggroWarnFired = true;
        this.flash = Math.max(this.flash, 0.5);
        if (this.ctx && this.ctx.particles) {
          this.ctx.particles.burst({
            pos: tmpV.set(this.root.position.x, this.root.position.y + 1.6, this.root.position.z),
            color: [0xff2a1a, 0xff6a3a],
            count: 10,
            speed: 2.4,
            size: 0.14,
            life: 0.5,
            gravity: -1,
          });
        }
      }
      if (this.aggroT <= 0) {
        this.aggroT = BOSS_AGGRO.switchEvery;
        this.aggroWarnFired = false;
        // 换到当前目标之外的那个座位
        const other = targets[1 - this.targetSeat];
        if (other && !other.dead && !other.downed) this.preferSeat = 1 - this.targetSeat;
      }
    }
    let target = null;
    let bestDist = Infinity;
    if (this.preferSeat !== null) {
      const pref = targets[this.preferSeat];
      if (pref && !pref.dead && !pref.downed) target = pref;
      this.preferSeat = null;
    }
    if (!target) {
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        if (!p || p.dead || p.downed) continue;
        const d = Math.hypot(p.pos.x - this.root.position.x, p.pos.z - this.root.position.z);
        if (d < bestDist) {
          bestDist = d;
          target = p;
        }
      }
    }
    // 铜钟停机：整只玩具冻结一帧（位移/骨骼/技能/近战都不推进），只保留白闪与燃烧致死。
    if (this.updateStop(dt)) {
      this.animSpeed = 0;
      this.updateSkillVisuals();
      if (this.stopCue) this.stopCue.visible = true;
      this.pushX = 0;
      this.pushZ = 0;
      return;
    }
    if (this.updateSkill(dt, targets, target)) {
      this.animSpeed = 0;
      this.updateSkillVisuals();
      if (this.mixer) this.mixer.update(dt);
      this.pushX = 0;
      this.pushZ = 0;
      return;
    }
    if (!target) {
      this.updateSkillVisuals();
      this.attackAnim = 0;
      this.play('idle', 0.18);
      if (this.mixer) this.mixer.update(dt);
      return;
    }
    this.targetSeat = targets.indexOf(target);
    const dx = target.pos.x - this.root.position.x;
    const dz = target.pos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    const attackRange = 1.15 + this.scaleFactor * 0.55;
    // 空中单位（气球）从头顶俯冲：玩家在脚下（垂直差 ≥ 1.6 米）才咬得到。
    // 跳起来（+1.04 米）或站上高台会把垂直差压到 1.6 米以内，这一口就落空 —— 这是气球唯一的弱点窗口。
    const dy = Math.abs(target.pos.y - this.root.position.y);
    const flight = this.def.landing || this.def.dive;
    const inReach = flight ? Math.hypot(dist, dy) <= attackRange + 0.25 : !this.airborne || dy >= 1.6;

    const targetRot = Math.atan2(dx, dz);
    this.rotY = turnToward(this.rotY, targetRot, dt * 6);
    this.root.rotation.y = this.rotY;

    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt * 2.6);

    const speedMul = this.slowTimer > 0 ? 0.42 : 1;
    let moving = false;
    let mx = 0;
    let mz = 0;
    const prevX = this.root.position.x;
    const prevZ = this.root.position.z;

    if (dist > attackRange && this.stagger <= 0) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      let sx = dx * inv;
      let sz = dz * inv;
      this.flowActive = false;
      if (!this.def.phase && !this.airborne && this.targetSeat === 0 && this.map && this.map.flowAt && dist > attackRange + 1.2) {
        if (this.map.flowAt(this.root.position.x, this.root.position.z, this.flow)) {
          sx = this.flow.x;
          sz = this.flow.z;
          this.flowActive = true;
        }
      }
      if (this.detourT > 0) {
        this.detourT -= dt;
        mx = this.detourX + this.pushX;
        mz = this.detourZ + this.pushZ;
      } else {
        mx = sx + this.pushX;
        mz = sz + this.pushZ;
      }
      const ml = Math.hypot(mx, mz);
      if (ml > 0.001) {
        mx /= ml;
        mz /= ml;
        const spd = this.speed * speedMul;
        const step = spd * dt;
        this.root.position.x += mx * step;
        this.root.position.z += mz * step;
        const b = this.map && this.map.bounds;
        const halfX = (b ? b.x : 23) - 0.6;
        const halfZ = (b ? b.z : 23) - 0.6;
        this.root.position.x = clamp(this.root.position.x, -halfX, halfX);
        this.root.position.z = clamp(this.root.position.z, -halfZ, halfZ);
        moving = true;
        this.animSpeed = spd;
      }
      this.attackTimer = Math.max(this.attackTimer, 0.5);
    } else if (!this.def.slam && dist <= attackRange + 0.25 && inReach) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = 1.28;
        this.attackAnim = 0.4;
        this.ctx.onAttack(this);
      }
    }

    if (this.stagger > 0) this.stagger -= dt;

    if (!this.def.phase && dist > attackRange && !this.flowActive) {
      const moved = Math.hypot(this.root.position.x - prevX, this.root.position.z - prevZ);
      if (moved < this.speed * dt * 0.35) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt * 1.5);

      if (this.stuckT > 0.45 && this.detourT <= 0) {
        this.stuckT = 0;
        this.detourT = 2.4;
        let ax = 0;
        let az = 0;
        if (Math.abs(dz) >= Math.abs(dx)) ax = dx >= 0 ? 1 : -1;
        else az = dz >= 0 ? 1 : -1;
        if (this.detourFlip < 0) {
          ax = -ax;
          az = -az;
        }
        this.detourFlip *= -1;
        this.detourX = ax;
        this.detourZ = az;
      }
    } else {
      this.stuckT = 0;
      this.detourT = 0;
    }

    for (let i = 0; !this.def.phase && !this.airborne && i < colliders.length; i++) {
      const c = colliders[i];
      const px = this.root.position.x - c.x;
      const pz = this.root.position.z - c.z;
      const d = Math.hypot(px, pz);
      const min = c.r + this.radius * 0.8;
      if (d < min && d > 0.0001) {
        const push = (min - d) / d;
        this.root.position.x += px * push;
        this.root.position.z += pz * push;

        // 沿障碍物切线滑动，避免僵尸顶着长墙原地卡死。
        const nx = px / d;
        const nz = pz / d;
        let tx = -nz;
        let tz = nx;
        if (tx * dx + tz * dz < 0) {
          tx = -tx;
          tz = -tz;
        }
        const slide = this.speed * speedMul * 0.5 * dt;
        this.root.position.x += tx * slide;
        this.root.position.z += tz * slide;
      }
    }

    // ---- animation：骨骼动画（walk / idle / attack），整体前倾保持僵尸蹒跚感 ----
    const speedPhase = moving ? 5.4 + this.speed * 0.9 : 1.5;
    this.phase += dt * speedPhase;
    const s = Math.sin(this.phase);
    const atk = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.4) * Math.PI) : 0;
    const moveK = moving ? 1 : 0.3;

    this.animSpeed = moving ? this.speed * speedMul : 0;
    const special = this.updateSkillVisuals();
    if (!special) {
      if (this.attackAnim > 0) this.play('attack', 0.1);
      else this.play(moving ? 'walk' : 'idle', 0.18);
    }

    if (this.mixer) {
      // 走快时动画也放快，脚步才不会打滑
      this.mixer.timeScale = moving ? clamp(0.75 + this.speed * 0.22, 0.8, 1.7) : 1;
      this.mixer.update(dt);
    } else if (this.procRig) {
      // 没有动画片段的模型：骨骼角度由代码逐帧摆（不受 mixer 的 timeScale 影响）
      this.updateProcAnim(dt, moving, false);
    }

    if (!special) {
      this.model.position.y = moving ? Math.abs(s) * 0.03 : 0;
      this.model.rotation.x = 0.03 + atk * 0.16;
      this.model.rotation.z = s * 0.03 * moveK;
    }

    this.pushX = 0;
    this.pushZ = 0;
    this.syncGroundShadow();
  }

  // blob 影子只在「必须有它」的时候显示：空中单位，或整张图没有真实投影（forest/cloud）。
  // airborne 会随气球落地/起飞、飞行单位起降而变，所以每帧校一次（只写一个布尔，代价可忽略）。
  syncGroundShadow() {
    if (!this.shadow || this.headless) return;
    const noReal = !!(this.map && this.map.noShadows);
    const want = this.airborne || noReal;
    if (want !== this.hasGroundShadow) {
      this.hasGroundShadow = want;
      this.shadow.visible = want;
    }
    // 无阴影地图：blob 是唯一影子 → 实心；空中单位：真实投影还在远处地上 → soft。
    const soft = !noReal;
    if (want && this.shadowSoft !== soft) {
      this.shadowSoft = soft;
      this.shadow.material = shadowMaterial(soft);
    }
    if (this.airborne && this.shadow.scale.x !== 0.6) this.shadow.scale.setScalar(0.6);
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.body);
    }
    for (let i = 0; i < this.mats.length; i++) this.mats[i].dispose();
    if (this.skillCue) this.skillCue.material.dispose();
    if (this.markBounty) this.markBounty.material.dispose();
    if (this.markCoop) this.markCoop.material.dispose();
  }
}

function turnToward(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + clamp(d, -maxStep, maxStep);
}
