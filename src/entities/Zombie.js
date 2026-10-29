import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { blobShadowTexture } from '../world/materials.js';
import { ZOMBIES } from '../config.js';
import { zombieModel, ZOMBIE_SCALE, MODELS, findClip } from './ZombieModel.js';
import { clamp, rand, TAU } from '../utils.js';

const ICE = new THREE.Color(0x9fe4ff);
const WHITE = new THREE.Color(0xffffff);
const tmpV = new THREE.Vector3();

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

export class Zombie {
  constructor(type, wave, x, z, ctx, hpMul, speedMul) {
    this.type = type;
    this.def = ZOMBIES[type];
    this.ctx = ctx;
    this.map = ctx.map || null;
    this.wave = wave;
    this.scaleFactor = this.def.scale;
    // 命中球高度：两套模型体块比例不同，按各自的模型单位给（调用方再乘 scaleFactor）。
    // 僵尸模型高 1.194（眼球 0.86–0.98、髋 0.37）；骷髅模型高 2.166（躯干 0.38–1.43、头 1.19–2.17）。
    // 头部球半径必须仍小于身体球，否则爆头会退化成“打哪儿都爆头”。
    // hitRadiusScale：命中球半径的额外倍率。骷髅骨架比僵尸细，模型高 2.166 vs 1.194，
    // 半径按同一比例放大才和身体贴合；脖子/躯干本来也细，取 0.8 折中。
    const isSk = this.def.model === 'skeleton';
    this.chestY = isSk ? 0.90 : 1.02;
    this.headY = isSk ? 1.68 : 1.52;
    this.hitRadiusScale = isSk ? 0.8 : 1;
    this.maxHp = Math.round(this.def.hp * hpMul);
    this.hp = this.maxHp;
    this.speed = this.def.speed * speedMul;
    this.radius = this.def.radius;
    this.scoreValue = this.def.score;
    this.alive = true;
    this.dying = false;
    this.dead = false;
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

    this.variant = Math.floor(rand(0, 3));
    this.baseTint = new THREE.Color(0xffffff).offsetHSL(0, 0, rand(-0.03, 0.025));

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(this.scaleFactor);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
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

  buildRig() {
    // 按 def.model 选模型：不写就是普通僵尸 glb，写 'skeleton' 就是 KayKit 骷髅
    const isSkeleton = this.def.model === 'skeleton';
    const src = isSkeleton ? zombieModel.skeleton : zombieModel;
    const def = MODELS[isSkeleton ? 'skeleton' : 'zombie'];
    this.isSkeleton = isSkeleton;

    // 骨骼模型每个僵尸克隆一份：骨骼必须独立，材质也要独立（白闪/冰冻）
    // 骨骼模型必须用 SkeletonUtils.clone，否则所有僵尸共享同一套骨骼会一起动
    this.body = src.scene ? cloneSkinned(src.scene) : new THREE.Group();
    this.body.scale.setScalar(def.scale);
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
    const src = this.isSkeleton ? zombieModel.skeleton : zombieModel;
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
    // 骷髅用 KayKit 的命名（Walking_A / 1H_Melee_Attack_Chop / Death_A …），僵尸用 Quaternius 的
    const want = this.isSkeleton
      ? {
          idle: pick(['idle_combat', 'idle']),
          walk: pick(['walking_a', 'walking_b', 'idle']),
          attack: pick(['1h_melee_attack_chop', '1h_melee_attack_slice_horizontal', 'idle_combat']),
          die: pick(['death_a', 'death_b']),
          hit: pick(['hit_a', 'hit_b']),
        }
      : {
          idle: pick(['idle']),
          walk: pick(['walk']),
          attack: pick(['idle_attack', 'run_attack']),
          die: pick(['death']),
          hit: pick(['hitreact']),
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
    if (acc !== 'cone' && acc !== 'bucket' && acc !== 'club') return;

    const hat = new THREE.Group();
    // 帽子挂到 Head 骨骼上，跟着头部动画一起动（骨骼缺失时才退回挂 body）。
    // 坑：这个 glb 的 CharacterArmature 带 100 倍缩放、Head 骨骼自带 13° 前倾，buildRig 又乘了模型缩放，
    // 手算局部偏移很容易算错（试过，帽子飞到 40 米高 / 偏到 z=0.65）。
    // 所以这里用 Three.js 的 worldToLocal 把"想要的世界位置"反算成骨骼局部坐标，旋转和缩放都交给引擎。
    // 目标位置按**模型本地单位**给：僵尸头顶 ≈1.186，帽子压在 1.10/1.11。
    const headBone = this.isSkeleton ? this.body.getObjectByName('head') : this.body.getObjectByName('Head');
    const targetLocalY = acc === 'bucket' ? 1.10 : 1.11;
    const targetLocalZ = 0.03;
    let hatY = targetLocalY;
    let hatZ = targetLocalZ;
    if (headBone) {
      // body 的 matrixWorld 要新鲜：builder 里可能还没渲染过一帧
      this.body.updateWorldMatrix(true, false);
      headBone.updateWorldMatrix(true, false);
      // 目标点：模型本地坐标 → 世界坐标（越过 body 的缩放，用 body 的 matrixWorld 换算）
      const target = new THREE.Vector3(0, targetLocalY, targetLocalZ).applyMatrix4(this.body.matrixWorld);
      const local = headBone.worldToLocal(target);
      hatY = local.y;
      hatZ = local.z;
    }
    hat.position.set(0, hatY, hatZ);
    hat.rotation.set(0.03, 0.1, 0.05);

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

    if (acc === 'cone') {
      // 路障锥：底座 + 锥体 + 两道反光带
      push(new THREE.CylinderGeometry(0.205, 0.215, 0.032, 22), 0xd85c24, { roughness: 0.75 });
      push(new THREE.CylinderGeometry(0.045, 0.175, 0.42, 22), 0xe0662a, { roughness: 0.6 });
      push(new THREE.CylinderGeometry(0.118, 0.138, 0.07, 22, 1, true), 0xf3efe2, { roughness: 0.45 });
      push(new THREE.CylinderGeometry(0.078, 0.094, 0.055, 22, 1, true), 0xf3efe2, { roughness: 0.45 });
    } else {
      // 铁桶：桶身 + 上下箍
      push(new THREE.CylinderGeometry(0.222, 0.242, 0.26, 24), 0xb9c0c7, { roughness: 0.5, metalness: 0.45 });
      push(new THREE.TorusGeometry(0.244, 0.016, 6, 24), 0x878f96, { roughness: 0.45, metalness: 0.5 });
      push(new THREE.TorusGeometry(0.226, 0.014, 6, 24), 0x878f96, { roughness: 0.45, metalness: 0.5 });
    }

    // 有 Head 骨骼就挂骨骼（跟着头部动），否则退回身体（静态模型/骨骼名不匹配时）
    (headBone || this.body).add(hat);
    this.hat = hat;
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
  getAimPoint(out) {
    out.set(this.root.position.x, this.chestY * this.scaleFactor, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, this.chestY * this.scaleFactor, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, this.headY * this.scaleFactor, this.root.position.z);
    return out;
  }

  hit(dmg, slow, head) {
    if (!this.alive || this.dying || this.spawnT < 0.5) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.headHit = !!head;
    if (slow) this.slowTimer = 2.6;
    if (this.hp <= 0) {
      this.hp = 0;
      this.startDeath();
      return true;
    }
    return false;
  }

  startDeath() {
    this.dying = true;
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

  update(dt, player, colliders) {
    if (this.dead) return;

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

    const dx = player.pos.x - this.root.position.x;
    const dz = player.pos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    const attackRange = 1.15 + this.scaleFactor * 0.55;

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
      if (this.map && this.map.flowAt && dist > attackRange + 1.2) {
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
    } else if (dist <= attackRange + 0.25) {
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

    for (let i = 0; i < colliders.length; i++) {
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
