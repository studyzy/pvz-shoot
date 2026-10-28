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
const UP = new THREE.Vector3(0, 1, 0);
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x213c08, side: THREE.BackSide });

function shade(hex, mul) {
  return new THREE.Color(hex).multiplyScalar(mul).getHex();
}

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
    this.ammo = WEAPONS.map((w) => (w.starter ? Infinity : 0));
    this.carried = -1;
    this.pendingDrop = 0;
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
    const builders = {
      shooter: (def) => this.buildShooter(def),
      multi: (def) => this.buildMultiShooter(def),
      gatling: (def) => this.buildGatling(def),
      cherry: (def) => this.buildCherry(def),
      cob: (def) => this.buildCob(def),
      melon: (def) => this.buildMelon(def),
      cactus: (def) => this.buildCactus(def),
      pepper: (def) => this.buildPepper(def),
    };
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      const build = builders[def.model] || builders.shooter;
      const item = build(def);
      item.group.visible = false;
      this.root.add(item.group);
      this.models.push(item);
    }
  }

  buildShooter(def) {
    const group = new THREE.Group();
    const color = def.color || 0x7ed321;
    const dark = def.ice ? 0x4fa9c9 : shade(color, 0.62);
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

    if (def.ice) {
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
    // 枪口取枪管中心线：取枪口下沿的话弹丸出膛再回中线，近距离一定擦过头部打进胸口。
    muzzle.position.set(0, 0.005, -0.5);
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

  buildMultiShooter(def) {
    const group = new THREE.Group();
    const count = Math.max(2, def.shots || 2);
    const headMat = toon(def.color);
    const darkMat = toon(shade(def.color, 0.6));
    const eyeMat = toon(0x1d2410);
    const gap = 0.2;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * gap;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), headMat);
      head.position.set(x, 0.02, 0);
      head.scale.set(1.02, 1, 1.12);
      group.add(head);
      addOutline(head, 1.09);

      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.068, 0.3, 10), darkMat);
      snout.rotation.x = Math.PI / 2 - 0.06;
      snout.position.set(x, 0.014, -0.24);
      group.add(snout);
      addOutline(snout, 1.12);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 12), darkMat);
      rim.position.set(x, 0, -0.392);
      group.add(rim);

      for (let k = 0; k < 2; k++) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat);
        eye.position.set(x + (k === 0 ? 0.056 : -0.056), 0.062, -0.052);
        group.add(eye);
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
    muzzle.position.set(0, 0, -0.46);
    group.add(muzzle);

    group.position.set(0.44, -0.3, -1.0);
    group.rotation.set(0.04, 0.46, 0.07);
    group.scale.setScalar(0.78);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.12,
    };
  }

  buildGatling(def) {
    const group = new THREE.Group();
    const bodyMat = toon(def.color);
    const darkMat = toon(shade(def.color, 0.52));
    const eyeMat = toon(0x1d2410);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 10), bodyMat);
    head.scale.set(1.05, 0.95, 1.1);
    group.add(head);
    addOutline(head, 1.08);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.46, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(Math.cos(a) * 0.068, Math.sin(a) * 0.068, -0.31);
      group.add(barrel);
    }

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 14), darkMat);
    ring.position.set(0, 0, -0.53);
    group.add(ring);

    for (let k = 0; k < 2; k++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
      eye.position.set(k === 0 ? 0.062 : -0.062, 0.07, -0.07);
      group.add(eye);
    }

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.32, 7), darkMat);
    stem.position.set(0.02, -0.25, 0.12);
    stem.rotation.x = 0.25;
    stem.rotation.z = -0.22;
    group.add(stem);

    const leafMat = toon(0x5cb31d);
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), leafMat);
      leaf.scale.set(1.5, 0.25, 0.85);
      leaf.position.set(i === 0 ? 0.13 : -0.12, -0.31 - i * 0.02, 0.14);
      leaf.rotation.z = i === 0 ? -0.5 : 0.6;
      group.add(leaf);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.56);
    group.add(muzzle);

    group.position.set(0.44, -0.31, -1.0);
    group.rotation.set(0.04, 0.48, 0.06);
    group.scale.setScalar(0.78);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.14,
    };
  }

  buildMelon(def) {
    const group = new THREE.Group();
    const mat = toon(def.color);
    const dark = toon(shade(def.color, 0.55));
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 12), mat);
    body.scale.set(1.12, 0.92, 1.12);
    group.add(body);
    addOutline(body, 1.07);

    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.013, 5, 18), dark);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.075 + i * 0.095;
      band.scale.set(1.02, 1.02, 1);
      group.add(band);
    }

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.2, 6), toon(0x4f9c26));
    stem.position.set(0, 0.25, 0.04);
    stem.rotation.z = 0.35;
    group.add(stem);

    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 5), toon(0x5cb31d));
    leaf.scale.set(1.5, 0.25, 0.85);
    leaf.position.set(0.13, 0.3, 0.04);
    leaf.rotation.z = 0.5;
    group.add(leaf);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.08, -0.26);
    group.add(muzzle);

    group.position.set(0.4, -0.36, -0.98);
    group.rotation.set(0.14, 0.34, 0.06);
    group.scale.setScalar(0.72);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.1,
    };
  }

  buildCactus(def) {
    const group = new THREE.Group();
    const mat = toon(def.color);
    const dark = toon(shade(def.color, 0.55));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.5, 10), mat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, -0.12);
    group.add(body);
    addOutline(body, 1.09);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.078, 9, 7), mat);
    tip.position.set(0, 0, -0.37);
    group.add(tip);

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 0.1 : -0.1;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 0.22, 7), dark);
      arm.position.set(x, 0.01, -0.02);
      arm.rotation.z = x > 0 ? -0.5 : 0.5;
      group.add(arm);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 5), mat);
      knob.position.set(x * 1.55, 0.09, -0.02);
      group.add(knob);
    }

    const spikeMat = toon(0xe9ffc4);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.07, 4), spikeMat);
      spike.position.set(0, 0.075, -0.3 + i * 0.11);
      spike.rotation.z = 0.4;
      group.add(spike);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.44);
    group.add(muzzle);

    group.position.set(0.44, -0.3, -1.0);
    group.rotation.set(0.04, 0.44, 0.06);
    group.scale.setScalar(0.78);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.12,
    };
  }

  buildPepper(def) {
    const group = new THREE.Group();
    const mat = toon(def.color);
    const dark = toon(shade(def.color, 0.6));
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.46, 10), mat);
    body.rotation.x = -Math.PI / 2;
    body.position.set(0, 0, -0.14);
    group.add(body);
    addOutline(body, 1.08);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), dark);
    cap.position.set(0, 0, 0.08);
    cap.scale.set(1, 1, 0.55);
    group.add(cap);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.18, 6), toon(0x4f9c26));
    stem.position.set(0, 0.06, 0.16);
    stem.rotation.x = -0.7;
    group.add(stem);

    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5), toon(0x5cb31d));
    leaf.scale.set(1.4, 0.24, 0.8);
    leaf.position.set(0.1, 0.08, 0.18);
    leaf.rotation.z = 0.5;
    group.add(leaf);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.4);
    group.add(muzzle);

    group.position.set(0.42, -0.3, -0.98);
    group.rotation.set(0.1, 0.36, 0.05);
    group.scale.setScalar(0.78);

    return {
      group,
      muzzle,
      basePos: group.position.clone(),
      baseRot: group.rotation.clone(),
      baseScale: group.scale.x,
      fireKick: def.recoil * 0.1,
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
    const def = WEAPONS[index];
    if (!def.starter && this.ammo[index] <= 0) return;
    this.current = index;
    for (let i = 0; i < this.models.length; i++) this.models[i].group.visible = i === index;
    this.swapAnim = 1;
    this.ctx.hud.setWeapon(index);
    if (def.starter) {
      this.ctx.hud.setAmmo(0, 0, false);
    } else {
      this.ctx.hud.setAmmo(this.ammo[index], def.ammo, true);
    }
    if (!silent) this.ctx.sfx.click();
  }

  trySwitch(dir) {
    const starters = [];
    for (let i = 0; i < WEAPONS.length; i++) if (WEAPONS[i].starter) starters.push(i);
    let pos = starters.indexOf(this.current);
    if (pos < 0) pos = 0;
    this.equip(starters[(pos + dir + starters.length) % starters.length]);
  }

  pickup(index) {
    const def = WEAPONS[index];
    if (!def || def.starter) return false;
    if (this.carried >= 0 && this.carried !== index) this.ammo[this.carried] = 0;
    this.carried = index;
    this.ammo[index] = def.ammo;
    this.pendingDrop = 0;
    this.equip(index, true);
    this.ctx.hud.setLoot(index);
    this.ctx.hud.setAmmo(def.ammo, def.ammo, true);
    this.ctx.hud.showBanner('拾取 ' + def.name + ' · ' + def.ammo + ' 发', 1.8);
    this.ctx.sfx.pickup();
    return true;
  }

  dropLoot() {
    if (this.carried < 0) return;
    const idx = this.carried;
    const def = WEAPONS[idx];
    this.ammo[idx] = 0;
    this.carried = -1;
    this.pendingDrop = 0;
    this.ctx.hud.setLoot(-1);
    this.ctx.hud.setAmmo(0, 0, false);
    if (this.current === idx) this.equip(0, true);
    this.ctx.hud.showBanner(def.name + ' 弹药耗尽', 1.5);
  }

  update(dt, controls) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 4);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    if (this.pendingDrop > 0) {
      this.pendingDrop -= dt;
      if (this.pendingDrop <= 0) this.dropLoot();
    }

    const req = controls.consumeWeaponRequest();
    if (req >= 0) this.equip(req);
    if (controls.consumeLootRequest && controls.consumeLootRequest() && this.carried >= 0) {
      this.equip(this.carried);
    }

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
    const index = this.current;
    const starter = !!def.starter;

    if (starter) {
      if (!this.ctx.spendSun(def.cost)) {
        this.ctx.sfx.deny();
        this.ctx.hud.denySun();
        return;
      }
    } else {
      if (this.ammo[index] <= 0) {
        this.dropLoot();
        return;
      }
      this.ammo[index]--;
    }
    this.cooldown = def.cooldown;

    const assist = this.assist && this.resolveAssist(this.assist);
    const targetPoint = assist ? assist.point : this.forwardPoint(70, tmpTarget);
    const headshot = !!assist && assist.head;
    const model = this.models[this.current];
    model.muzzle.getWorldPosition(tmpMuzzle);
    const shots = Math.max(1, def.shots || 1);

    if (def.kind === 'pea') {
      for (let s = 0; s < shots; s++) {
        tmpOrigin.copy(tmpMuzzle);
        tmpTo.copy(targetPoint).sub(tmpOrigin).normalize();
        if (shots > 1) {
          const off = (s - (shots - 1) * 0.5) * (def.spread || 0.03);
          tmpTo.applyAxisAngle(UP, off);
        }
        this.ctx.projectiles.spawnPea(tmpOrigin, tmpTo, def, headshot);
      }
      this.particlesAtMuzzle(def, shots);
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
      this.hitscan(def, targetPoint, headshot);
    }

    this.recoil = Math.min(1.6, this.recoil + 0.9);
    this.player.addRecoil(def.recoil * 0.0055);
    this.ctx.particles.muzzle(tmpMuzzle, def.color);
    this.ctx.onFire(def);

    if (!starter) {
      this.ctx.hud.setAmmo(this.ammo[index], def.ammo, true);
      if (this.ammo[index] <= 0) this.pendingDrop = 0.45;
    }
  }

  particlesAtMuzzle(def, shots) {
    this.ctx.particles.burst({
      pos: tmpMuzzle,
      color: [def.color, 0xffffff],
      count: 4 + (shots || 1) * 2,
      speed: 2.6,
      size: 0.06,
      life: 0.22,
      gravity: 2,
      drag: 4,
    });
  }

  hitscan(def, targetPoint, aimHead) {
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    const maxDist = 90;
    tmpSegEnd.copy(tmpOrigin).addScaledVector(tmpFwd, maxDist);

    let bestT = 2;
    let bestPos = null;
    let bestZ = null;
    let headshot = aimHead;
    for (let i = 0; i < this.ctx.zombies.zombies.length; i++) {
      const z = this.ctx.zombies.zombies[i];
      if (!z.alive || z.dying) continue;
      if (aimHead && z !== this.assist.zombie) continue;
      z.getChest(tmpChest);
      const t1 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpChest, 0.46 * z.scaleFactor);
      z.getHead(tmpHead);
      const t2 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpHead, 0.36 * z.scaleFactor);
      let t = -1;
      let head = false;
      if (aimHead) {
        t = t2 >= 0 ? t2 : t1;
        head = true;
      } else if (t2 >= 0 && (t1 < 0 || t2 <= t1)) {
        t = t2;
        head = true;
      } else if (t1 >= 0) {
        t = t1;
      }
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestZ = z;
        headshot = head;
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

    this.ctx.projectiles.explodeAt(impact, def.radius, def.damage, true, bestZ, headshot);
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

  // 准星本来就对着头部球时才把瞄点抬到头上，否则仍锁胸口：辅助瞄准永远只是“帮人打中”，不白送爆头。
  resolveAssist(assist) {
    const z = assist.zombie;
    if (!z.alive || z.dying) return assist;
    z.getHead(tmpHead);
    tmpTo.copy(tmpHead).sub(this.camera.position).normalize();
    if (tmpFwd.dot(tmpTo) < Math.cos(0.02)) return assist;
    return { point: tmpHead.clone(), zombie: z, angle: assist.angle, head: true };
  }

  forwardPoint(dist, out) {
    this.camera.getWorldDirection(tmpFwd);
    out.copy(this.camera.position).addScaledVector(tmpFwd, dist);
    return out;
  }

  reset() {
    this.cooldown = 0;
    this.recoil = 0;
    this.pendingDrop = 0;
    for (let i = 0; i < WEAPONS.length; i++) {
      this.ammo[i] = WEAPONS[i].starter ? Infinity : 0;
    }
    this.carried = -1;
    this.ctx.hud.setLoot(-1);
    this.equip(0, true);
  }
}
