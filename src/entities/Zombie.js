import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { blobShadowTexture, glowTexture } from '../world/materials.js';
import { ZOMBIES, ARMOR_MATERIALS, COOP, BOSS_AGGRO } from '../config.js';
import { zombieModel, ZOMBIE_SCALE, MODELS, findClip } from './ZombieModel.js';
import { clamp, rand, TAU } from '../utils.js';

const ICE = new THREE.Color(0x9fe4ff);
const WHITE = new THREE.Color(0xffffff);
const tmpV = new THREE.Vector3();
const hatQuat = new THREE.Quaternion();

// 交通锥 / 铁桶的落点：用**骨架绑定空间**里的头顶，而不是世界坐标。
// Head 骨骼在 glb 里带 ~108° 的 Z-up 修正旋转，拿世界坐标反算局部点会在动画里被甩到脑后；
// 这里量一次「颅顶最高点 + 其正上方的中心」，换算成 Head 骨骼局部坐标，
// 之后不管播 walk / attack / death，帽子都钉在同一个颅顶点上。按模型缓存，只量一次。
function headCrownLocal(zombie, headBone) {
  const src = zombie.modelSource();
  if (src._headCrown) return src._headCrown;
  zombie.body.updateWorldMatrix(true, true);
  // 蒙皮顶点还要靠 skeleton.bones 的 matrixWorld；这些骨骼不一定在 body 的子树里
  // （SkeletonUtils.clone 会把骨骼表挂到 mesh.skeleton 上），逐个强制刷新一次。
  zombie.body.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.updateWorldMatrix(true, false);
    if (!mesh.skeleton) return;
    for (let i = 0; i < mesh.skeleton.bones.length; i++) mesh.skeleton.bones[i].updateWorldMatrix(true, false);
  });
  // 用 Head 骨骼自己的局部坐标找「颅顶」，而不是世界 Y：世界 Y 的最高点在歪头时会偏到一侧，
  // 走路动画一摆，帽子就会跟着左右横跳。骨骼局部 +Y 在该模型上就是头顶方向。
  const invHead = headBone.matrixWorld.clone().invert();
  // 局部单位被 100× 骨架缩得极小，阈值也要按骨骼世界缩放换算（否则 0.08 等于 12 米，
  // 会把整只僵尸都算进「颅顶」平均里）。
  const headScale = headBone.getWorldScale(new THREE.Vector3()).x || 1;
  const band = 0.06 / headScale;
  const v = new THREE.Vector3();
  let maxY = -Infinity;
  let sumX = 0;
  let sumZ = 0;
  let n = 0;
  zombie.body.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    // 蒙皮变换要用 skinIndex/skinWeight；测试替身或残缺 glb 可能没有，跳过而不是崩
    if (!mesh.geometry.attributes.skinIndex || !mesh.geometry.attributes.skinWeight) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      mesh.localToWorld(v);
      v.applyMatrix4(invHead);
      if (v.y > maxY) {
        maxY = v.y;
        sumX = v.x;
        sumZ = v.z;
        n = 1;
      } else if (v.y > maxY - band) {
        sumX += v.x;
        sumZ += v.z;
        n++;
      }
    }
  });
  // 一个蒙皮顶点都没量到（残缺 glb / 测试替身）：没有可信的颅顶，别把帽子塞进身体里，
  // 交给调用方走 _hatPending，等真正稳定了再定。
  if (n === 0 || !Number.isFinite(maxY)) return null;
  const local = new THREE.Vector3(sumX / n, maxY, sumZ / n);
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
  goblin: { chest: 0.82, head: 1.18, radius: 0.85 },
  demon3: { chest: 0.85, head: 1.22, radius: 0.85 },
  slime: { chest: 0.45, head: 0.72, radius: 1.05 },
  'pink-slime': { chest: 0.42, head: 0.66, radius: 1.05 },
  'green-blob': { chest: 0.55, head: 0.88, radius: 1.1 },
  bones: { chest: 0.88, head: 1.42, radius: 0.8 },
  ghost: { chest: 0.95, head: 1.55, radius: 0.85 },
  'ghost-skull': { chest: 0.62, head: 0.95, radius: 0.8 },
  // 四足：胸口（躯干）低于头，但半径仍然头 < 身体
  wolf: { chest: 0.58, head: 0.72, radius: 0.72 },
  spider: { chest: 0.32, head: 0.42, radius: 0.85 },
  rat: { chest: 0.14, head: 0.2, radius: 0.8 },
  bat: { chest: 0.28, head: 0.38, radius: 0.8 },

  'mushroom-king': { chest: 0.9, head: 1.4, radius: 0.9 },
  dragon: { chest: 0.85, head: 1.35, radius: 0.9 },
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
function shadowMaterial() {
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
  // 有 Duck 的怪：Death / Duck / HitReact / Idle / Jump… / Punch / Run / Walk / Wave / Weapon
  duck: {
    idle: ['idle'],
    walk: ['walk', 'run'],
    attack: ['punch', 'attack', 'headbutt'],
    die: ['death'],
    hit: ['hitreact', 'hitrecieve'],
  },
  // 龙：Dragon_Attack / Dragon_Attack2 / Dragon_Death / Dragon_Flying / Dragon_Hit
  dragon: {
    idle: ['dragon_flying'],
    walk: ['dragon_flying'],
    attack: ['dragon_attack', 'dragon_attack2', 'headbutt'],
    die: ['dragon_death', 'death'],
    hit: ['dragon_hit', 'hitreact'],
  },
};

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
  dragon: 'dragon',

  wolf: 'beast',
  spider: 'spider',
  rat: 'rat',
  bat: 'bat',
};

export class Zombie {
  constructor(type, wave, x, z, ctx, hpMul, speedMul) {
    this.type = type;
    this.def = ZOMBIES[type];
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

    this.variant = Math.floor(rand(0, 3));
    this.baseTint = new THREE.Color(0xffffff).offsetHSL(0, 0, rand(-0.03, 0.025));

    this.root = new THREE.Group();
    this.root.position.set(x, this.airHeight, z);
    this.root.scale.setScalar(this.scaleFactor);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    // root 在空中时影子要落回地面，而不是跟着飞；气球再缩小一圈，作为「它在天上」的线索
    shadow.position.y = -this.airHeight + 0.025;
    if (this.airborne) shadow.scale.setScalar(0.6);
    shadow.renderOrder = 1;
    this.shadow = shadow;
    this.root.add(shadow);

    this.model = new THREE.Group();
    this.model.position.y = -2.3;
    this.root.add(this.model);

    this.buildRig();

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
    const src = this.modelSource();
    const def = MODELS[this.modelId];
    this.isSkeleton = this.modelId === 'skeleton';
    // 两层缩放不能混：
    //   root.scale = def.scale（类型的体型倍率）
    //   body.scale = 模型自身的归一化缩放（MODELS[id].scale；老四套手写，新模型加载时算好）
    // 新模型已经把缩放烘进 scene，这里必须填 1，否则二次缩放。
    const modelScale = def.targetHeight ? 1 : ((src && src.scale) || def.scale || 1);

    // 骨骼模型每个僵尸克隆一份：骨骼必须独立，材质也要独立（白闪/冰冻）
    // 骨骼模型必须用 SkeletonUtils.clone，否则所有僵尸共享同一套骨骼会一起动
    this.body = src.scene ? cloneSkinned(src.scene) : new THREE.Group();
    // 归一化过的模型（targetHeight）缩放已经烘进 scene，别再乘一遍
    this.body.scale.setScalar(modelScale);
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
  }

  // 骨骼动画：idle / walk / attack / die / hit 各一条，同一时刻只播一条。
  // 两套模型的动作名不同，按模型用不同候选名。
  buildAnimations() {
    const src = this.modelSource();
    const clips = (src && src.clips) || [];
    this.mixer = clips.length ? new THREE.AnimationMixer(this.body) : null;
    this.actions = {};
    this.current = null;
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
    for (const k in want) {
      if (!want[k]) continue;
      const a = this.mixer.clipAction(want[k]);
      if (k === 'attack' || k === 'die' || k === 'hit') {
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

  // 交通锥 / 铁桶：加在 glb 头顶（模型单位，Y 向上，头骨顶约 1.0）
  buildHat() {
    const acc = this.def.acc;
    if (acc !== 'cone' && acc !== 'bucket' && acc !== 'club' && acc !== 'helmet' && acc !== 'balloon') return;

    const hat = new THREE.Group();
    // 帽子挂到 Head 骨骼上，跟着头部动画一起动（骨骼缺失时才退回挂 body）。
    // 坑：这个 glb 的 CharacterArmature 带 100 倍缩放、Head 骨骼自带 13° 前倾，buildRig 又乘了模型缩放，
    // 手算局部偏移很容易算错（试过，帽子飞到 40 米高 / 偏到 z=0.65）。
    // 所以这里用 Three.js 的 worldToLocal 把"想要的世界位置"反算成骨骼局部坐标，旋转和缩放都交给引擎。
    // 锥帽/铁桶的落点由 headCrownLocal() 量真实颅顶；下面这组手填坐标只留给橄榄球头盔 /
    // 没有 Head 骨骼的退回路径。
    const headBone = this.isSkeleton ? this.body.getObjectByName('head') : this.body.getObjectByName('Head');
    // 橄榄球模型头大、头顶 1.938（旧僵尸 1.186），头盔的落点单独给一套。
    const isFootball = this.modelId === 'football';
    const isHeadTop = acc === 'cone' || acc === 'bucket';
    const targetLocalY = isFootball && acc === 'helmet' ? 1.76 : acc === 'helmet' ? 1.09 : 1.11;
    const targetLocalZ = isFootball && acc === 'helmet' ? -0.02 : 0.03;
    let hatPos = new THREE.Vector3(0, targetLocalY, targetLocalZ);
    // 骨骼链上"多出来"的缩放必须抵掉：glb 里 CharacterArmature 带 100 倍缩放，Head 骨骼自己在它下面，
    // 直接把帽子 add 到 Head 上，几何体会被这 100 倍放大 —— 交通锥会变成十米宽的巨物。
    // 把帽子缩到「应得世界缩放 / 骨骼世界缩放」，再按骨骼的世界旋转摆正，就能得到"手写世界坐标"的老效果，
    // 同时还能跟着头部动画动。父节点必须是已经挂上 body 的骨骼（matrixWorld 才是最终的）。
    // 配件几何按**模型本地单位**给，本来就该吃到模型缩放（MODELS.scale）和 root 缩放
    // （scaleFactor）；骨骼链里**多出来**的部分（僵尸 glb 的 CharacterArmature 100 倍）才要抵掉。
    // 曾经直接除以骨骼世界缩放，把模型缩放也除掉了 —— 交通锥/铁桶的世界尺寸只剩身体的
    // 1/1.55，大半截陷进脑袋里，看起来像「没戴帽子」；Boss 木棒同理缩水一半。
    // 归一化过的模型（targetHeight）缩放记在槽上（加载时算的），MODELS[id].scale 是 undefined
    const hatSrc = this.modelSource();
    const modelScaleForHat = MODELS[this.modelId].scale || (hatSrc && hatSrc.scale) || 1;
    const hatWorldScale = modelScaleForHat * this.scaleFactor;
    let hatScale = 1;
    let headScale = 1;
    if (headBone) {
      this.body.updateWorldMatrix(true, true);
      headBone.updateWorldMatrix(true, false);
      headScale = headBone.getWorldScale(new THREE.Vector3()).x;
      if (isHeadTop) {
        // 头顶落点由模型几何量出来（见 headCrownLocal），不再手填世界高度 ——
        // 旧写法的 1.10 其实落在眼眶高度，锥帽大半截陷进脑袋里。
        // 构造时骨骼的绑定矩阵还没稳定（量出来会飞到 100 米外），有缓存才用，
        // 否则先藏起来，等 root 进场景后的第一次 mountHeadTop()。
        const cached = this.modelSource()._headCrown;
        if (cached) hatPos = cached.clone();
        else this._hatPending = true;
      } else {
        const target = new THREE.Vector3(0, targetLocalY, targetLocalZ).applyMatrix4(this.body.matrixWorld);
        hatPos = headBone.worldToLocal(target);
      }
      hatScale = hatWorldScale / headScale;
      if (isHeadTop) hatQuat.identity();
      else headBone.getWorldQuaternion(hatQuat).invert();
    }
    hat.position.copy(hatPos);
    hat.quaternion.copy(hatQuat);
    if (isHeadTop && headBone) {
      // 锥帽底座压在颅顶（略嵌入 1 cm），铁桶往下扣到眉骨上方。
      hat.translateY((acc === 'cone' ? -0.01 : -0.06) / headScale);
    }
    if (!isHeadTop) {
      hat.rotateX(0.03);
      hat.rotateY(0.1);
      hat.rotateZ(0.05);
    }
    hat.scale.setScalar(hatScale);

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
      // 橄榄球头盔：后移的深红球壳 + 米白前额条 + 面罩格栅。
      // 模型本地单位：头顶 1.938、头心 1.747；球壳后移留出脸，前额条/格栅在脸前。
      // 新模型自带护肩，这里不再补护肩 —— 旧的红色球护肩会和模型自带的白色护肩打架。
      push(new THREE.SphereGeometry(0.25, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.54), 0xb0392e, { roughness: 0.5 });
      const shell = hat.children[hat.children.length - 1];
      shell.scale.set(1.06, 0.96, 1.04);
      shell.position.set(0, 0.005, -0.07);
      // 前额横条
      push(new THREE.BoxGeometry(0.34, 0.05, 0.055), 0xf2e6d2, { roughness: 0.45 });
      hat.children[hat.children.length - 1].position.set(0, 0.02, 0.215);
      // 面罩：三根横杆
      for (let i = 0; i < 3; i++) {
        push(new THREE.CylinderGeometry(0.012, 0.012, 0.30, 6), 0x4a4746, { roughness: 0.5, metalness: 0.3 });
        const bar = hat.children[hat.children.length - 1];
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, -0.04 - i * 0.05, 0.235);
      }
      // 两根竖杆，把横杆连成面罩
      for (let i = 0; i < 2; i++) {
        push(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 6), 0x4a4746, { roughness: 0.5, metalness: 0.3 });
        hat.children[hat.children.length - 1].position.set(i === 0 ? 0.14 : -0.14, -0.065, 0.23);
      }
      (headBone || this.body).add(hat);
      this.hat = hat;
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
      push(new THREE.CylinderGeometry(0.255, 0.28, 0.34, 28), 0xb9c0c7, { roughness: 0.5, metalness: 0.45 });
      const rimLow = push(new THREE.TorusGeometry(0.28, 0.016, 8, 28), 0x878f96, { roughness: 0.45, metalness: 0.5 });
      rimLow.rotation.x = Math.PI / 2;
      rimLow.position.y = -0.17;
      const rimHigh = push(new THREE.TorusGeometry(0.255, 0.014, 8, 28), 0x878f96, { roughness: 0.45, metalness: 0.5 });
      rimHigh.rotation.x = Math.PI / 2;
      rimHigh.position.y = 0.17;
    }

    // 有 Head 骨骼就挂骨骼（跟着头部动），否则退回身体（静态模型/骨骼名不匹配时）
    (headBone || this.body).add(hat);
    this.hat = hat;
    if (this._hatPending) hat.visible = false;
  }

  // 首帧把锥帽/铁桶落到真实头顶：此时 root 已在场景里，骨骼矩阵和蒙皮顶点都稳定了。
  mountHeadTop() {
    // 只服务锥帽/铁桶；Boss 木棒、橄榄球头盔、气球各有自己的挂点，别被这个函数改名顶掉。
    if (this.def.acc !== 'cone' && this.def.acc !== 'bucket') return;
    this._hatPending = false;
    const headBone = this.isSkeleton ? this.body.getObjectByName('head') : this.body.getObjectByName('Head');
    if (!this.hat || !headBone) {
      if (this.hat) this.hat.visible = true;
      return;
    }
    this.root.updateMatrixWorld(true);
    const local = headCrownLocal(this, headBone);
    if (!local) {
      // 量不到颅顶就先保持隐藏，下一帧再试，别把帽子摆到错误位置
      this._hatPending = true;
      this.hat.visible = false;
      return;
    }
    const headScale = headBone.getWorldScale(new THREE.Vector3()).x;
    this.hat.position.copy(local);
    hatQuat.identity();
    this.hat.quaternion.copy(hatQuat);
    this.hat.translateY((this.def.acc === 'cone' ? -0.01 : -0.06) / headScale);
    this.hat.visible = true;
  }

  // 白闪 / 寒冰要同时作用到身体和帽子，所以遍历所有材质
  applyFlash(v) {
    for (let i = 0; i < this.mats.length; i++) this.mats[i].emissiveIntensity = v;
  }

  applyTint(ice) {
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
    out.set(this.root.position.x, this.root.position.y + this.chestY * this.scaleFactor, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, this.root.position.y + this.chestY * this.scaleFactor, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, this.root.position.y + this.headY * this.scaleFactor, this.root.position.z);
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
    this.bounty = !!on;
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
    this.slowTimer = s.sl ? 0.2 : 0;
    if (!!s.bo !== this.bounty) this.setBounty(!!s.bo);
    if (!!s.co !== this.coop) this.setCoopMark(!!s.co);
    this.coop = !!s.co;
    if (s.st === 3) {
      if (!this.dying) {
        this.dying = true;
        this.deathT = 0;
        this.play('die', 0.12);
      }
      return;
    }
    if (this.dying) return;
    if (s.st === 2) {
      this.attackAnim = 0.4;
      this.play('attack', 0.1);
    } else if (s.st === 1) {
      this.attackAnim = 0;
      this.play('walk', 0.18);
    } else {
      this.attackAnim = 0;
      this.play('idle', 0.18);
    }
    if (s.sl) this.applyTint(0.55);
    else this.applyTint(0);
  }

  update(dt, player, colliders) {
    if (this.dead) return;
    if (this._hatPending) this.mountHeadTop();
    this.age += dt;

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
      if (this.mixer) this.mixer.update(dt);
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
    if (!target) {
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
    const inReach = !this.airborne || dy >= 1.6;

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
      if (this.targetSeat === 0 && this.map && this.map.flowAt && dist > attackRange + 1.2) {
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
    } else if (dist <= attackRange + 0.25 && inReach) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = 1.28;
        this.attackAnim = 0.4;
        this.ctx.onAttack(this);
      }
    }

    if (this.stagger > 0) this.stagger -= dt;

    if (dist > attackRange && !this.flowActive) {
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

    for (let i = 0; !this.airborne && i < colliders.length; i++) {
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
    if (this.attackAnim > 0) this.play('attack', 0.1);
    else this.play(moving ? 'walk' : 'idle', 0.18);

    if (this.mixer) {
      // 走快时动画也放快，脚步才不会打滑
      this.mixer.timeScale = moving ? clamp(0.75 + this.speed * 0.22, 0.8, 1.7) : 1;
      this.mixer.update(dt);
    }

    this.model.position.y = moving ? Math.abs(s) * 0.03 : 0;
    this.model.rotation.x = 0.03 + atk * 0.16;
    this.model.rotation.z = s * 0.03 * moveK;

    this.pushX = 0;
    this.pushZ = 0;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.body);
    }
    for (let i = 0; i < this.mats.length; i++) this.mats[i].dispose();
  }
}

function turnToward(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + clamp(d, -maxStep, maxStep);
}
