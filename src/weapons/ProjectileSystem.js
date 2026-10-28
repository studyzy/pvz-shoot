import * as THREE from 'three';
import { segmentSphereT } from '../utils.js';

const PEA_POOL = 64;
const CHERRY_POOL = 5;
const tmpChest = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class ProjectileSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.zombies = ctx.zombies;
    this.particles = ctx.particles;
    this.sfx = ctx.sfx;

    const peaGeo = new THREE.SphereGeometry(0.125, 8, 6);
    this.peaMatCache = new Map();
    const defaultPeaMat = this.peaMaterial(0x9bf227);
    this.peas = [];
    for (let i = 0; i < PEA_POOL; i++) {
      const mesh = new THREE.Mesh(peaGeo, defaultPeaMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.peas.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        damage: 0,
        slow: false,
        type: 'pea',
        life: 0,
        pierce: 0,
        hits: new Set(),
      });
    }

    this.cherries = [];
    for (let i = 0; i < CHERRY_POOL; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshToonMaterial({ color: 0xe8452f, emissive: 0x5a0c05, emissiveIntensity: 0.5 });
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat);
      a.position.set(-0.09, 0, 0);
      b.position.set(0.1, 0.05, 0.04);
      g.add(a);
      g.add(b);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 5), new THREE.MeshToonMaterial({ color: 0x4f9c26 }));
      stem.position.set(0.02, 0.2, 0);
      stem.rotation.z = 0.5;
      g.add(stem);
      g.visible = false;
      this.scene.add(g);
      this.cherries.push({
        group: g,
        mat,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        damage: 0,
        radius: 5,
        life: 0,
        fuse: 0,
      });
    }
  }

  spawnPea(origin, dir, def) {
    const p = this.peas.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.pos.copy(origin);
    p.prev.copy(origin);
    p.vel.copy(dir).multiplyScalar(def.speed);
    p.damage = def.damage;
    p.slow = !!def.slow;
    p.type = def.id;
    p.life = 1.6;
    p.pierce = def.pierce || 0;
    p.hits.clear();
    p.mesh.material = this.peaMaterial(def.color);
    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    p.mesh.scale.setScalar(def.pierce ? 1.05 : def.slow ? 1.15 : 1);
  }

  peaMaterial(color) {
    const key = color || 0x9bf227;
    let mat = this.peaMatCache.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: key, toneMapped: false });
      this.peaMatCache.set(key, mat);
    }
    return mat;
  }

  throwCherry(origin, target, def) {
    const c = this.cherries.find((x) => !x.active);
    if (!c) return;
    c.active = true;
    c.pos.copy(origin);
    c.group.position.copy(origin);
    c.group.visible = true;
    c.damage = def.damage;
    c.radius = def.radius;
    c.fuse = 2.6;
    c.life = 0;
    c.mat.color.setHex(def.color || 0xe8452f);
    c.mat.emissive.setHex(def.id === 'melon' ? 0x143d10 : 0x5a0c05);
    c.group.scale.setScalar(def.id === 'melon' ? 1.35 : 1);

    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dz = target.z - origin.z;
    const horiz = Math.max(1.5, Math.hypot(dx, dz));
    const T = Math.min(1.5, Math.max(0.4, horiz / 17));
    const g = 15;
    c.vel.set(dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
    c.gravity = g;
  }

  explodeAt(pos, radius, damage, big) {
    this.particles.explosion(pos, radius);
    this.sfx.explosion(!!big);
    if (this.ctx.onExplosion) this.ctx.onExplosion(pos, radius);
    const hits = this.zombies.damageArea(pos, radius, damage);
    if (hits > 0 && this.ctx.onHit) this.ctx.onHit(false, false);
    return hits;
  }

  update(dt) {
    for (let i = 0; i < this.peas.length; i++) {
      const p = this.peas[i];
      if (!p.active) continue;
      p.life -= dt;
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      let bestT = 2;
      let bestZ = null;
      let headshot = false;
      for (let j = 0; j < this.zombies.zombies.length; j++) {
        const z = this.zombies.zombies[j];
        if (!z.alive || z.dying || z.spawnT < 0.5 || p.hits.has(z)) continue;
        z.getChest(tmpChest);
        const tBody = segmentSphereT(p.prev, p.pos, tmpChest, 0.46 * z.scaleFactor + 0.14);
        z.getHead(tmpHead);
        const tHead = segmentSphereT(p.prev, p.pos, tmpHead, 0.38 * z.scaleFactor + 0.14);
        let t = -1;
        let head = false;
        if (tHead >= 0 && (tBody < 0 || tHead <= tBody)) {
          t = tHead;
          head = true;
        } else if (tBody >= 0) {
          t = tBody;
        }
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestZ = z;
          headshot = head;
        }
      }

      if (bestZ) {
        const damage = p.damage * (headshot ? 2 : 1);
        tmpA.copy(p.prev).lerp(p.pos, bestT);
        const killed = bestZ.hit(damage, p.slow);
        this.particles.splat(tmpA, p.slow ? 0xa8f0ff : 0x7fbf3f);
        if (headshot) this.sfx.headshot();
        else this.sfx.hit();
        if (this.ctx.onHit) this.ctx.onHit(headshot, killed);
        if (killed) this.zombies.handleKill(bestZ, headshot);
        if (p.pierce > 0) {
          p.pierce--;
          p.hits.add(bestZ);
        } else {
          this.deactivatePea(p);
        }
        continue;
      }

      if (p.pos.y <= 0.06) {
        tmpA.copy(p.pos);
        tmpA.y = 0.08;
        this.particles.splat(tmpA, p.slow ? 0xa8f0ff : 0x7fbf3f);
        this.deactivatePea(p);
        continue;
      }
      if (p.life <= 0) this.deactivatePea(p);
    }

    for (let i = 0; i < this.cherries.length; i++) {
      const c = this.cherries[i];
      if (!c.active) continue;
      c.life += dt;
      c.fuse -= dt;
      c.vel.y -= c.gravity * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.group.position.copy(c.pos);
      c.group.rotation.x += dt * 7;
      c.group.rotation.z += dt * 3;

      let boom = false;
      if (c.pos.y <= 0.25) boom = true;
      if (c.fuse <= 0) boom = true;
      for (let j = 0; j < this.zombies.zombies.length; j++) {
        const z = this.zombies.zombies[j];
        if (!z.alive || z.dying) continue;
        const d = Math.hypot(z.root.position.x - c.pos.x, z.root.position.z - c.pos.z);
        if (d < 0.9 && c.pos.y < 2.4) { boom = true; break; }
      }

      if (boom) {
        tmpB.copy(c.pos);
        if (tmpB.y < 0.4) tmpB.y = 0.4;
        this.explodeAt(tmpB, c.radius, c.damage, true);
        c.active = false;
        c.group.visible = false;
      }
    }
  }

  deactivatePea(p) {
    p.active = false;
    p.mesh.visible = false;
  }

  clear() {
    for (let i = 0; i < this.peas.length; i++) this.deactivatePea(this.peas[i]);
    for (let i = 0; i < this.cherries.length; i++) {
      this.cherries[i].active = false;
      this.cherries[i].group.visible = false;
    }
  }
}
