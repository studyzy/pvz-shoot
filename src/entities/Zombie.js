import * as THREE from 'three';
import { toon, faceTexture, blobShadowTexture } from '../world/materials.js';
import { ZOMBIES } from '../config.js';
import { clamp, rand, TAU } from '../utils.js';

const G = {
  torso: new THREE.BoxGeometry(0.64, 0.72, 0.36),
  head: new THREE.BoxGeometry(0.52, 0.5, 0.46),
  arm: new THREE.BoxGeometry(0.15, 0.56, 0.15),
  leg: new THREE.BoxGeometry(0.18, 0.62, 0.19),
  cone: new THREE.ConeGeometry(0.26, 0.42, 9),
  bucket: new THREE.CylinderGeometry(0.25, 0.27, 0.32, 12),
  club: new THREE.BoxGeometry(0.18, 1.4, 0.18),
  clubHead: new THREE.DodecahedronGeometry(0.34, 0),
  face: new THREE.PlaneGeometry(0.5, 0.5),
  shadow: new THREE.PlaneGeometry(1.5, 1.5),
  tie: new THREE.BoxGeometry(0.1, 0.3, 0.03),
  belt: new THREE.BoxGeometry(0.64, 0.08, 0.37),
};

const ICE = new THREE.Color(0x9fe4ff);
const tmpV = new THREE.Vector3();
const shoeMat = toon(0x3a3340);
const tieMat = toon(0xb03a2e);
const clubShaftMat = toon(0x7a5230);
const clubHeadMat = toon(0x8d6a3c);

let shadowMatShared = null;
function shadowMaterial() {
  if (!shadowMatShared) {
    shadowMatShared = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      color: 0x2a3a14,
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

    const variation = rand(-0.05, 0.05);
    this.skinBase = new THREE.Color(this.def.skin).offsetHSL(rand(-0.02, 0.02), 0, variation);
    this.shirtBase = new THREE.Color(this.def.shirt).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.05, 0.05));

    this.skinMat = toon(this.skinBase.clone());
    this.shirtMat = toon(this.shirtBase.clone());
    this.pantsMat = toon(this.def.pants);
    this.accMat = toon(this.type === 'cone' ? 0xe07b2c : this.type === 'bucket' ? 0x9aa3ad : 0x6b4a2b);
    this.mats = [this.skinMat, this.shirtMat, this.pantsMat, this.accMat];
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].emissive.setHex(0xffffff);
      this.mats[i].emissiveIntensity = 0;
    }

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(this.scaleFactor);

    const shadow = new THREE.Mesh(G.shadow, shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.renderOrder = 1;
    this.shadow = shadow;
    this.root.add(shadow);

    this.model = new THREE.Group();
    this.model.position.y = -1.6;
    this.root.add(this.model);

    const torso = new THREE.Mesh(G.torso, this.shirtMat);
    torso.position.y = 1.18;
    torso.castShadow = true;
    this.model.add(torso);

    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.3), this.shirtMat);
    shoulders.position.y = 1.5;
    this.model.add(shoulders);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), this.skinMat);
    neck.position.y = 1.56;
    this.model.add(neck);

    const head = new THREE.Mesh(G.head, this.skinMat);
    head.position.y = 1.78;
    head.castShadow = true;
    this.headMesh = head;
    this.model.add(head);

    const face = new THREE.Mesh(G.face, new THREE.MeshBasicMaterial({
      map: faceTexture(Math.floor(rand(0, 3))),
      alphaTest: 0.4,
      depthWrite: true,
    }));
    face.position.set(0, 1.78, 0.235);
    this.model.add(face);

    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.11, 0.44), this.pantsMat);
    hair.position.set(0, 2.02, -0.02);
    this.model.add(hair);

    const tie = new THREE.Mesh(G.tie, tieMat);
    tie.position.set(0, 1.3, 0.19);
    this.model.add(tie);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.05), tieMat);
    knot.position.set(0, 1.47, 0.19);
    this.model.add(knot);

    const belt = new THREE.Mesh(G.belt, this.pantsMat);
    belt.position.set(0, 0.9, 0);
    this.model.add(belt);

    this.arms = [];
    for (let i = 0; i < 2; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(i === 0 ? -0.4 : 0.4, 1.46, 0);
      pivot.rotation.x = -1.15;
      pivot.rotation.y = i === 0 ? 0.26 : -0.26;
      const arm = new THREE.Mesh(G.arm, this.skinMat);
      arm.position.y = -0.28;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.16, 0.17), this.skinMat);
      hand.position.y = -0.58;
      pivot.add(hand);
      this.model.add(pivot);
      this.arms.push(pivot);
    }

    this.legs = [];
    for (let i = 0; i < 2; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(i === 0 ? -0.17 : 0.17, 0.7, 0);
      const leg = new THREE.Mesh(G.leg, this.pantsMat);
      leg.position.y = -0.31;
      leg.castShadow = true;
      pivot.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.12, 0.28), shoeMat);
      shoe.position.set(0, -0.62, 0.05);
      pivot.add(shoe);
      this.model.add(pivot);
      this.legs.push(pivot);
    }

    this.buildAccessory();

    this.root.rotation.y = this.rotY;
    ctx.scene.add(this.root);
  }

  buildAccessory() {
    if (this.def.acc === 'cone') {
      const cone = new THREE.Mesh(G.cone, this.accMat);
      cone.position.y = 2.22;
      cone.castShadow = true;
      this.model.add(cone);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), this.accMat);
      brim.position.y = 2.02;
      this.model.add(brim);
    } else if (this.def.acc === 'bucket') {
      const bucket = new THREE.Mesh(G.bucket, this.accMat);
      bucket.position.y = 2.08;
      bucket.castShadow = true;
      this.model.add(bucket);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.035, 5, 12), this.accMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 2.24;
      this.model.add(rim);
    } else if (this.def.acc === 'club') {
      const club = new THREE.Group();
      const shaft = new THREE.Mesh(G.club, clubShaftMat);
      shaft.position.y = -0.5;
      club.add(shaft);
      const head = new THREE.Mesh(G.clubHead, clubHeadMat);
      head.position.y = -1.15;
      club.add(head);
      club.position.set(0, -0.15, 0.12);
      club.rotation.x = 0.25;
      this.arms[1].add(club);
    }
  }

  getAimPoint(out) {
    out.set(this.root.position.x, 1.02 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getChest(out) {
    out.set(this.root.position.x, 1.02 * this.scaleFactor, this.root.position.z);
    return out;
  }

  getHead(out) {
    out.set(this.root.position.x, 1.8 * this.scaleFactor, this.root.position.z);
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
      pos: tmpV.set(p.x, 1.1 * this.scaleFactor, p.z),
      color: [0x6f9a3f, 0x8fbf58, 0x4b6b28],
      count: this.type === 'boss' ? 26 : 12,
      speed: 3.6,
      size: 0.14,
      life: 0.75,
      gravity: 9,
    });
  }

  update(dt, player, colliders) {
    if (this.dead) return;

    if (this.dying) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.32);
      this.model.rotation.x = t * 1.5;
      if (this.deathT > 0.5) {
        const k = Math.min(1, (this.deathT - 0.5) / 0.9);
        this.root.position.y = -k * 0.9;
        this.model.scale.setScalar(Math.max(0.02, 1 - k * 0.4));
      }
      if (this.deathT > 1.45) this.dead = true;
      return;
    }

    // rise from the dirt
    if (this.spawnT < 0.55) {
      this.spawnT += dt;
      const t = Math.min(1, this.spawnT / 0.55);
      const e = 1 - Math.pow(1 - t, 3);
      this.model.position.y = -1.6 * (1 - e);
      this.model.rotation.z = Math.sin(t * 12) * 0.04 * (1 - t);
      return;
    }

    this.animSpeed = 0;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 11);
      const e = this.flash * 0.42;
      for (let i = 0; i < this.mats.length; i++) this.mats[i].emissiveIntensity = e;
    }

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.skinMat.color.copy(this.skinBase).lerp(ICE, 0.62);
      this.shirtMat.color.copy(this.shirtBase).lerp(ICE, 0.38);
      if (this.slowTimer <= 0) {
        this.skinMat.color.copy(this.skinBase);
        this.shirtMat.color.copy(this.shirtBase);
      }
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

    if (dist > attackRange && this.stagger <= 0) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      let mx = dx * inv + this.pushX;
      let mz = dz * inv + this.pushZ;
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

    // keep out of props
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

    // animation
    const phaseSpeed = moving ? 4.6 + this.speed * 1.4 : 1.6;
    this.phase += dt * phaseSpeed * (moving ? 1 : 0.45);
    const sw = moving ? 0.62 : 0.08;
    const s = Math.sin(this.phase);
    this.legs[0].rotation.x = s * sw;
    this.legs[1].rotation.x = -s * sw;

    const swing = this.attackAnim > 0 ? (1 - this.attackAnim / 0.4) : 0;
    const attackArc = Math.sin(swing * Math.PI) * 1.05;
    this.arms[0].rotation.x = -1.15 + s * 0.12 + attackArc * 0.7;
    this.arms[1].rotation.x = -1.15 - s * 0.12 + attackArc * 0.7;
    this.arms[0].rotation.z = 0.06 + s * 0.03 + attackArc * 0.18;
    this.arms[1].rotation.z = -0.06 - s * 0.03 - attackArc * 0.18;

    this.model.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.045 : 0;
    this.model.rotation.z = moving ? Math.sin(this.phase) * 0.035 : 0;
    this.model.rotation.x = -attackArc * 0.16;
    this.model.rotation.y = Math.sin(this.phase * 0.5) * 0.05;
    this.headMesh.rotation.z = Math.sin(this.phase * 0.5 + 1) * 0.06;

    this.pushX = 0;
    this.pushZ = 0;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    for (let i = 0; i < this.mats.length; i++) this.mats[i].dispose();
    this.mats.length = 0;
  }
}

function turnToward(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + clamp(d, -maxStep, maxStep);
}
