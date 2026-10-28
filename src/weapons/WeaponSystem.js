import * as THREE from 'three';
import { WEAPONS } from '../config.js';
import { toon } from '../world/materials.js';
import { clamp, segmentSphereT, damp } from '../utils.js';

const tmpFwd = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpSegEnd = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x213c08, side: THREE.BackSide });

function addOutline(mesh, amount) {
  if (!mesh.parent) return null;
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.scale.copy(mesh.scale).multiplyScalar(amount);
  mesh.parent.add(o);
  return o;
}

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.player = ctx.player;
    this.models = [];
    this.current = 0;
    this.cooldown = 0;
    this.recoil = 0;
    this.swapAnim = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.portrait = false;
    this.root = new THREE.Group();
    this.camera.add(this.root);
    this.buildViewModels();
    this.equip(0, true);
  }

  buildViewModels() {
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      let item;
      if (def.id === 'pea' || def.id === 'snow') item = this.buildShooter(def);
      else if (def.id === 'cherry') item = this.buildCherry(def);
      else item = this.buildCob(def);
      item.group.visible = false;
      this.root.add(item.group);
      this.models.push(item);
    }
  }

  buildShooter(def) {
    const group = new THREE.Group();
    const color = def.id === 'snow' ? 0x9fe8ff : 0x7ed321;
    const dark = def.id === 'snow' ? 0x4fa9c9 : 0x4e9a12;
    const headMat = toon(color);
    const darkMat = toon(dark);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), headMat);
    head.scale.set(1.05, 1, 1.12);
    group.add(head);
    addOutline(head, 1.09);

    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.082, 0.36, 12), headMat);
    snout.rotation.x = Math.PI / 2 - 0.06;
    snout.position.set(0, 0.005, -0.29);
    group.add(snout);
    addOutline(snout, 1.12);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.018, 6, 14), darkMat);
    rim.position.set(0, -0.01, -0.47);
    group.add(rim);

    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.013, 6, 14), darkMat);
    lip.position.set(0, -0.01, -0.475);
    group.add(lip);

    const eyeMat = toon(0x1d2410);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
    eye.position.set(0.075, 0.055, -0.06);
    group.add(eye);
    const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
    eye2.position.set(-0.075, 0.055, -0.06);
    group.add(eye2);

    if (def.id === 'snow') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), toon(0xffffff));
      cap.position.set(0, 0.13, 0.02);
      cap.scale.set(1.4, 0.45, 1.3);
      group.add(cap);
      const iceMat = toon(0xbfefff);
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.11, 4), iceMat);
        spike.position.set(-0.08 + i * 0.08, 0.17, 0.04);
        spike.rotation.z = (i - 1) * 0.3;
        group.add(spike);
      }
    }

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.34, 7), darkMat);
    stem.position.set(0.02, -0.24, 0.1);
    stem.rotation.x = 0.25;
    stem.rotation.z = -0.22;
    group.add(stem);

    const leafMat = toon(0x5cb31d);
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), leafMat);
      leaf.scale.set(1.5, 0.25, 0.85);
      leaf.position.set(i === 0 ? 0.13 : -0.12, -0.3 - i * 0.02, 0.13);
      leaf.rotation.z = i === 0 ? -0.5 : 0.6;
      leaf.rotation.y = i === 0 ? 0.4 : -0.4;
      group.add(leaf);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.01, -0.5);
    group.add(muzzle);

    group.position.set(0.44, -0.3, -1.0);
    group.rotation.set(0.04, 0.5, 0.07);
    group.scale.setScalar(0.8);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.12,
    };
  }

  buildCherry(def) {
    const group = new THREE.Group();
    const red = toon(0xe2402c);
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), red);
    a.position.set(-0.06, 0, 0);
    group.add(a);
    addOutline(a, 1.09);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), red);
    b.position.set(0.09, 0.045, 0.03);
    group.add(b);
    addOutline(b, 1.09);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), toon(0xffb3a0));
    shine.position.set(-0.1, 0.055, -0.09);
    group.add(shine);

    const stemMat = toon(0x4f9c26);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.26, 6), stemMat);
    stem.position.set(0.01, 0.19, 0);
    stem.rotation.z = 0.45;
    group.add(stem);
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), stemMat);
      leaf.scale.set(1.4, 0.22, 0.8);
      leaf.position.set(0.13 + i * 0.02, 0.26 + i * 0.01, 0);
      leaf.rotation.z = i === 0 ? 0.5 : -0.2;
      group.add(leaf);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.05, 0.05);
    group.add(muzzle);

    group.position.set(0.4, -0.4, -0.98);
    group.rotation.set(0.12, 0.34, 0.06);
    group.scale.setScalar(0.64);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.1,
    };
  }

  buildCob(def) {
    const group = new THREE.Group();
    const cobMat = toon(0xffd23f);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.44, 10), cobMat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, -0.14);
    group.add(body);
    addOutline(body, 1.1);

    const kernels = new THREE.Mesh(new THREE.SphereGeometry(0.026, 5, 4), toon(0xf0b62a));
    for (let i = 0; i < 12; i++) {
      const k = kernels.clone();
      const ang = (i / 12) * Math.PI * 2;
      k.position.set(Math.cos(ang) * 0.076, Math.sin(ang) * 0.076, -0.26 + (i % 4) * 0.07);
      group.add(k);
    }

    const huskMat = toon(0x63b32c);
    for (let i = 0; i < 3; i++) {
      const husk = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), huskMat);
      husk.scale.set(0.5, 1.5, 0.36);
      const ang = (i / 3) * Math.PI * 2 + 0.4;
      husk.position.set(Math.cos(ang) * 0.07, Math.sin(ang) * 0.06, 0.12);
      husk.rotation.x = 0.9;
      husk.rotation.z = ang * 0.3;
      group.add(husk);
    }

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.16, 8), toon(0x4f9c26));
    grip.position.set(0, -0.1, 0.06);
    grip.rotation.x = 0.35;
    group.add(grip);

    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.02, 6, 12), toon(0x8a5b1c));
    mouth.position.set(0, 0, -0.34);
    group.add(mouth);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.38);
    group.add(muzzle);

    group.position.set(0.4, -0.29, -0.96);
    group.rotation.set(0.12, 0.4, 0.05);
    group.scale.setScalar(0.8);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.08,
    };
  }

  setAspect(aspect) {
    this.portrait = aspect < 1;
  }

  equip(index, silent) {
    if (index < 0 || index >= WEAPONS.length) return;
    this.current = index;
    for (let i = 0; i < this.models.length; i++) this.models[i].group.visible = i === index;
    this.swapAnim = 1;
    this.ctx.hud.setWeapon(index);
    if (!silent) this.ctx.sfx.click();
  }

  trySwitch(dir) {
    const count = WEAPONS.length;
    this.equip((this.current + dir + count) % count);
  }

  update(dt, controls) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 4);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    const req = controls.consumeWeaponRequest();
    if (req >= 0) this.equip(req);

    const def = WEAPONS[this.current];
    const pressed = controls.consumeFirePressed();
    this.assist = this.findAimTarget(def);
    this.ctx.hud.setAimLock(!!this.assist);

    if (def.auto) {
      if (controls.firing) this.tryFire(def);
    } else if (pressed) {
      this.tryFire(def);
    }

    // viewmodel motion
    const p = this.player;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const bob = p.grounded ? Math.sin(p.bob) * 0.012 * Math.min(1, speed / 4) : 0;
    const bobY = p.grounded ? Math.abs(Math.cos(p.bob)) * 0.014 * Math.min(1, speed / 4) : 0;

    this.swayX = damp(this.swayX, clamp(-p.lastLook.x * 0.55, -0.06, 0.06), 12, dt);
    this.swayY = damp(this.swayY, clamp(p.lastLook.y * 0.55, -0.06, 0.06), 12, dt);

    const model = this.models[this.current];
    if (!model) return;
    const g = model.group;
    const kick = this.recoil;
    const layoutX = this.portrait ? model.basePos.x * 0.5 : model.basePos.x;
    const layoutY = this.portrait ? model.basePos.y + 0.02 : model.basePos.y;
    g.scale.setScalar(model.baseScale * (this.portrait ? 0.78 : 1));
    g.position.set(
      layoutX + bob + this.swayX,
      layoutY + bobY + this.swayY + kick * 0.012,
      model.basePos.z + kick * 0.05 + this.swapAnim * 0.22
    );
    g.rotation.set(
      model.baseRot.x - kick * 0.28 + this.swayY * 2.2,
      model.baseRot.y + this.swayX * 1.6,
      model.baseRot.z + this.swayX * 0.8
    );
  }

  tryFire(def) {
    if (this.cooldown > 0) return;
    if (!this.ctx.spendSun(def.cost)) {
      this.ctx.sfx.deny();
      this.ctx.hud.denySun();
      return;
    }
    this.cooldown = def.cooldown;

    const assist = this.assist;
    const targetPoint = assist ? assist.point : this.forwardPoint(70, tmpTarget);
    const model = this.models[this.current];
    model.muzzle.getWorldPosition(tmpMuzzle);

    if (def.kind === 'pea') {
      tmpOrigin.copy(tmpMuzzle);
      tmpTo.copy(targetPoint).sub(tmpOrigin).normalize();
      this.ctx.projectiles.spawnPea(tmpOrigin, tmpTo, def);
      this.particlesAtMuzzle(def);
      if (def.slow) this.ctx.sfx.shootIce();
      else this.ctx.sfx.shootPea();
    } else if (def.kind === 'lob') {
      tmpOrigin.copy(tmpMuzzle);
      if (!assist) {
        // aim at the ground in front of the player
        this.camera.getWorldDirection(tmpFwd);
        const t = tmpFwd.y < -0.02 ? (tmpOrigin.y - 0.2) / -tmpFwd.y : 16;
        targetPoint.copy(this.camera.position).addScaledVector(tmpFwd, Math.min(t, 22));
      }
      this.ctx.projectiles.throwCherry(tmpOrigin, targetPoint, def);
      this.ctx.sfx.throwCherry();
    } else {
      this.hitscan(def, targetPoint);
    }

    this.recoil = Math.min(1.6, this.recoil + 0.9);
    this.player.addRecoil(def.recoil * 0.0055);
    this.ctx.particles.muzzle(tmpMuzzle, def.color);
    this.ctx.onFire(def);
  }

  particlesAtMuzzle(def) {
    this.ctx.particles.burst({
      pos: tmpMuzzle,
      color: [def.color, 0xffffff],
      count: 4,
      speed: 2.6,
      size: 0.06,
      life: 0.22,
      gravity: 2,
      drag: 4,
    });
  }

  hitscan(def, targetPoint) {
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    const maxDist = 90;
    tmpSegEnd.copy(tmpOrigin).addScaledVector(tmpFwd, maxDist);

    let bestT = 2;
    let bestPos = null;
    for (let i = 0; i < this.ctx.zombies.zombies.length; i++) {
      const z = this.ctx.zombies.zombies[i];
      if (!z.alive || z.dying) continue;
      z.getChest(tmpChest);
      const t1 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpChest, 0.46 * z.scaleFactor);
      z.getHead(tmpHead);
      const t2 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpHead, 0.3 * z.scaleFactor);
      let t = -1;
      if (t1 >= 0 && t2 >= 0) t = Math.min(t1, t2);
      else if (t1 >= 0) t = t1;
      else if (t2 >= 0) t = t2;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestPos = new THREE.Vector3().copy(tmpOrigin).addScaledVector(tmpFwd, maxDist * t);
      }
    }

    let impact;
    if (bestPos) {
      impact = bestPos;
    } else {
      let t = maxDist;
      if (tmpFwd.y < -0.01) {
        const g = (tmpOrigin.y - 0.15) / -tmpFwd.y;
        if (g > 0 && g < maxDist) t = g;
      }
      impact = new THREE.Vector3().copy(tmpOrigin).addScaledVector(tmpFwd, t);
      if (impact.y < 0.15) impact.y = 0.15;
      if (t >= maxDist) impact.copy(targetPoint);
    }

    this.ctx.projectiles.explodeAt(impact, def.radius, def.damage, true);
    this.ctx.sfx.cannon();
    this.ctx.shake(0.55);
  }

  findAimTarget(def) {
    const maxAngle = this.ctx.touch ? 0.17 : 0.045;
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < this.ctx.zombies.zombies.length; i++) {
      const z = this.ctx.zombies.zombies[i];
      if (!z.alive || z.dying || z.spawnT < 0.5) continue;
      z.getChest(tmpChest);
      tmpTo.copy(tmpChest).sub(tmpOrigin);
      const dist = tmpTo.length();
      if (dist > 62) continue;
      tmpTo.divideScalar(dist);
      const dot = tmpFwd.dot(tmpTo);
      if (dot < 0.5) continue;
      const angle = Math.acos(Math.min(1, dot));
      if (angle > maxAngle) continue;
      const score = angle * 10 + dist * 0.006;
      if (score < bestScore) {
        bestScore = score;
        best = { point: tmpChest.clone(), zombie: z, angle };
      }
    }
    return best;
  }

  forwardPoint(dist, out) {
    this.camera.getWorldDirection(tmpFwd);
    out.copy(this.camera.position).addScaledVector(tmpFwd, dist);
    return out;
  }

  reset() {
    this.cooldown = 0;
    this.recoil = 0;
    this.equip(0, true);
  }
}
