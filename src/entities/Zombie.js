import * as THREE from 'three';
import { blobShadowTexture, zombieGrimeTexture } from '../world/materials.js';
import { ZOMBIES } from '../config.js';
import { getZombieRig, zombieVariantCount } from './ZombieModel.js';
import { zombieAtlas } from './ZombieTexture.js';
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
    this.rotY = rand(0, TAU);
    this.animSpeed = 0;

    this.variant = Math.floor(rand(0, zombieVariantCount(type)));
    this.rig = getZombieRig(type, this.variant);

    this.baseTint = new THREE.Color(0xffffff).offsetHSL(0, 0, rand(-0.035, 0.03));
    this.mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: zombieAtlas.map || zombieGrimeTexture(),
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.mapApplied = !!zombieAtlas.map;
    this.mat.color.copy(this.baseTint);

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
    const mat = this.mat;
    const mk = (geo) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };

    this.spine = new THREE.Group();
    this.spine.position.y = 0.88;
    this.spine.add(mk(this.rig.body));
    this.model.add(this.spine);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.632, 0.01);
    this.headPivot.scale.setScalar(this.type === 'boss' ? 1.28 : 1.05);
    this.headPivot.add(mk(this.rig.head));
    this.spine.add(this.headPivot);

    this.shoulders = [];
    this.elbows = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.315, 0.5, 0.0);
      shoulder.add(mk(this.rig.armUpper));
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.34, 0);
      const lowerGeo = i === 1 && this.rig.armLowerClub ? this.rig.armLowerClub : this.rig.armLower;
      elbow.add(mk(lowerGeo));
      shoulder.add(elbow);
      shoulder.rotation.z = side * 0.16;
      shoulder.rotation.x = -1.38;
      elbow.rotation.x = 0.12;
      this.spine.add(shoulder);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    this.hips = [];
    this.knees = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hip = new THREE.Group();
      hip.position.set(side * 0.145, 0.86, 0);
      hip.add(mk(this.rig.legUpper));
      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      knee.add(mk(this.rig.legLower));
      hip.add(knee);
      this.model.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
    }
  }

  getAimPoint(out) {
    out.set(this.root.position.x, 1.12 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, 1.12 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, 1.81 * this.scaleFactor, this.root.position.z);
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

    if (!this.mapApplied && zombieAtlas.map) {
      this.mat.map = zombieAtlas.map;
      this.mat.needsUpdate = true;
      this.mapApplied = true;
    }

    if (this.dying) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.34);
      this.model.rotation.x = -t * 1.5;
      this.model.rotation.z = t * 0.12;
      this.armsLimp(t);
      this.mat.emissiveIntensity = Math.max(0, this.mat.emissiveIntensity - dt * 3);
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
      this.mat.emissiveIntensity = this.flash * 0.45;
    }

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.mat.color.copy(this.baseTint).lerp(ICE, 0.55);
      if (this.slowTimer <= 0) this.mat.color.copy(this.baseTint);
    } else if (this.slowTimer > -1) {
      this.mat.color.copy(this.baseTint);
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

    if (dist > attackRange && this.stagger <= 0) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      mx = dx * inv + this.pushX;
      mz = dz * inv + this.pushZ;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.001) {
        mx /= ml;
        mz /= ml;
        const spd = this.speed * speedMul;
        const step = spd * dt;
        this.root.position.x += mx * step;
        this.root.position.z += mz * step;
        const half = 22.6;
        this.root.position.x = clamp(this.root.position.x, -half, half);
        this.root.position.z = clamp(this.root.position.z, -half, half);
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
      }
    }

    // ---- animation ----
    const speedPhase = moving ? 5.4 + this.speed * 0.9 : 1.5;
    this.phase += dt * speedPhase;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const swing = moving ? 0.52 : 0.05;

    this.hips[0].rotation.x = s * swing;
    this.hips[1].rotation.x = -s * swing;
    this.knees[0].rotation.x = Math.max(0, -s) * 0.95 * (moving ? 1 : 0.25) + 0.05;
    this.knees[1].rotation.x = Math.max(0, s) * 0.95 * (moving ? 1 : 0.25) + 0.05;

    const atk = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.4) * Math.PI) : 0;

    this.shoulders[0].rotation.x = -1.38 + s * 0.1 + atk * 1.0;
    this.shoulders[1].rotation.x = -1.38 - s * 0.1 + atk * 1.0;
    this.shoulders[0].rotation.z = -0.16 - s * 0.03;
    this.shoulders[1].rotation.z = 0.16 + s * 0.03;
    this.elbows[0].rotation.x = 0.12 - atk * 0.18 + c * 0.03;
    this.elbows[1].rotation.x = 0.12 - atk * 0.18 - c * 0.03;

    this.spine.rotation.x = 0.11 + Math.abs(s) * 0.02 * (moving ? 1 : 0) + atk * 0.2;
    this.spine.rotation.z = Math.sin(this.phase * 0.5) * 0.035 * (moving ? 1 : 0.4);
    this.spine.rotation.y = s * 0.06 * (moving ? 1 : 0.3);
    this.spine.position.y = 0.88 + (moving ? Math.abs(s) * 0.022 : 0);

    this.headPivot.rotation.x = -0.06 + atk * 0.22 + Math.sin(this.phase * 0.5 + 1) * 0.03;
    this.headPivot.rotation.z = Math.sin(this.phase * 0.5 + 0.4) * 0.07;
    this.headPivot.rotation.y = Math.sin(this.phase * 0.33) * 0.05;

    this.model.position.y = 0;
    this.model.rotation.z = moving ? Math.sin(this.phase) * 0.025 : 0;

    this.pushX = 0;
    this.pushZ = 0;
  }

  armsLimp(t) {
    const k = Math.min(1, t);
    this.shoulders[0].rotation.x = -1.38 + k * (0.9 + Math.sin(this.phase) * 0.2);
    this.shoulders[1].rotation.x = -1.38 + k * (0.7 + Math.cos(this.phase) * 0.2);
    this.shoulders[0].rotation.z = -0.16 - k * 0.5;
    this.shoulders[1].rotation.z = 0.16 + k * 0.5;
    this.elbows[0].rotation.x = 0.12 - k * 0.3;
    this.elbows[1].rotation.x = 0.12 - k * 0.2;
    this.hips[0].rotation.x = -k * 0.35;
    this.hips[1].rotation.x = k * 0.12;
    this.knees[0].rotation.x = 0.05 + k * 0.5;
    this.knees[1].rotation.x = 0.05 + k * 0.2;
    this.headPivot.rotation.x = -k * 0.35;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    this.mat.dispose();
  }
}

function turnToward(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + clamp(d, -maxStep, maxStep);
}
