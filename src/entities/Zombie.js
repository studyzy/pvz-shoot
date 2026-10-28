import * as THREE from 'three';
import { blobShadowTexture } from '../world/materials.js';
import { ZOMBIES } from '../config.js';
import { zombieModel, ZOMBIE_SCALE } from './ZombieModel.js';
import { clamp, rand, TAU } from '../utils.js';

const ICE = new THREE.Color(0x9fe4ff);
const WHITE = new THREE.Color(0xffffff);
const tmpV = new THREE.Vector3();

// 假骨骼：顶点着色器里按高度/左右分区绕髋、肩旋转，做真正的交替迈步
const WALK_CHUNK = `
  vec3 transformed = vec3( position );
  // 注意：几何体是 Z-up（节点上挂着 +90° X 旋转），高度 = -position.z
  float h = -position.z;
  float side = transformed.x >= 0.0 ? 1.0 : -1.0;
  float legPhase = uPhase + (side > 0.0 ? 0.0 : PI);
  float legAng = sin(legPhase) * 0.4 * uMove;
  float kneeAng = max(0.0, -sin(legPhase)) * 0.85 * uMove;
  if (h < 0.54) {
    // 大腿：绕髋
    float w = smoothstep(0.0, 1.0, clamp((0.54 - h) / 0.05, 0.0, 1.0));
    vec3 pivot = vec3(side * 0.075, 0.0, -0.52);
    vec3 d = transformed - pivot;
    float s = sin(legAng), c = cos(legAng);
    vec3 r = vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
    transformed = mix(transformed, pivot + r, w);
  }
  if (h < 0.32) {
    // 小腿：绕膝再折一下，脚才不会像棍子一样扫过去
    vec3 kp = vec3(side * 0.075, 0.0, -0.30);
    vec3 kd = transformed - kp;
    float ks = sin(kneeAng), kc = cos(kneeAng);
    vec3 kr = vec3(kd.x, kd.y * kc - kd.z * ks, kd.y * ks + kd.z * kc);
    float kw = smoothstep(0.0, 1.0, clamp((0.32 - h) / 0.04, 0.0, 1.0));
    transformed = mix(transformed, kp + kr, kw);
  }
  // 手臂：只吃 |x| 很大、且在肩以下的顶点，避免把大头卷进来
  float armAng = -legAng * 0.6;
  float aw = smoothstep(0.235, 0.275, abs(transformed.x)) * (1.0 - smoothstep(0.68, 0.80, h));
  if (aw > 0.001 && h > 0.3) {
    vec3 ap = vec3(side * 0.21, 0.0, -0.80);
    vec3 ad = transformed - ap;
    float as = sin(armAng), ac = cos(armAng);
    vec3 ar = vec3(ad.x, ad.y * ac - ad.z * as, ad.y * as + ad.z * ac);
    transformed = mix(transformed, ap + ar, aw);
  }
`;

function patchWalkShader(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uMove = uniforms.uMove;
    shader.vertexShader = 'uniform float uPhase;\nuniform float uMove;\n' + shader.vertexShader.replace('#include <begin_vertex>', WALK_CHUNK);
  };
  mat.needsUpdate = true;
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

export class Zombie {
  constructor(type, wave, x, z, ctx, hpMul, speedMul) {
    this.type = type;
    this.def = ZOMBIES[type];
    this.ctx = ctx;
    this.map = ctx.map || null;
    this.wave = wave;
    this.scaleFactor = this.def.scale;
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
    // glb 是单网格静态模型：每个僵尸克隆一份，只克隆材质（要独立的白闪/冰冻）
    this.body = zombieModel.scene.clone(true);
    this.body.scale.setScalar(ZOMBIE_SCALE);
    this.model.add(this.body);

    this.walk = { uPhase: { value: 0 }, uMove: { value: 0 } };
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
      patchWalkShader(m, this.walk);
      // 阴影走同一套顶点变形，否则腿动了影子不动
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = m.onBeforeCompile;
      m.customDepthMaterial = depth;
      n.material = m;
      n.castShadow = true;
      n.receiveShadow = false;
      this.mats.push(m);
      this.matBase.push(m.color.clone());
    });
    this.buildHat();
  }

  // 交通锥 / 铁桶：加在 glb 头顶（模型单位，Y 向上，头骨顶约 1.0）
  buildHat() {
    const acc = this.def.acc;
    if (acc !== 'cone' && acc !== 'bucket' && acc !== 'club') return;

    const hat = new THREE.Group();
    hat.position.set(0, acc === 'bucket' ? 1.06 : 1.01, 0.015);
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
      // Boss 的木棒：握在右手（-x 侧），斜向体前
      hat.position.set(-0.26, 0.46, 0.06);
      hat.rotation.set(0.35, 0, 0.28);
      push(new THREE.CylinderGeometry(0.038, 0.05, 0.52, 10), 0x7d5733, { roughness: 0.85 });
      push(new THREE.CylinderGeometry(0.085, 0.105, 0.2, 10), 0x5b3d22, { roughness: 0.8 });
      const head = hat.children[hat.children.length - 1];
      head.position.y = -0.3;
      const shaft = hat.children[hat.children.length - 2];
      shaft.position.y = 0.02;
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

    this.body.add(hat);
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

  getAimPoint(out) {
    out.set(this.root.position.x, 0.95 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, 0.95 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, 1.45 * this.scaleFactor, this.root.position.z);
    return out;
  }

  hit(dmg, slow) {
    if (!this.alive || this.dying || this.spawnT < 0.5) return false;
    this.hp -= dmg;
    this.flash = 1;
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
      const t = Math.min(1, this.deathT / 0.34);
      this.model.rotation.x = -t * 1.5;
      this.model.rotation.z = t * 0.12;
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

    // ---- animation：glb 无骨骼，用整体起伏/侧摆做出蹒跚感 ----
    const speedPhase = moving ? 5.4 + this.speed * 0.9 : 1.5;
    this.phase += dt * speedPhase;
    const s = Math.sin(this.phase);
    const atk = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.4) * Math.PI) : 0;
    const moveK = moving ? 1 : 0.3;

    this.walk.uPhase.value = this.phase;
    this.walk.uMove.value = moving ? 1 : 0.12;

    this.model.position.y = moving ? Math.abs(s) * 0.05 : 0;
    this.model.rotation.x = 0.03 + Math.abs(s) * 0.02 * moveK + atk * 0.16;
    this.model.rotation.z = s * 0.045 * moveK;
    this.model.rotation.y = s * 0.09 * moveK;

    this.pushX = 0;
    this.pushZ = 0;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    for (let i = 0; i < this.mats.length; i++) this.mats[i].dispose();
  }
}

function turnToward(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + clamp(d, -maxStep, maxStep);
}
