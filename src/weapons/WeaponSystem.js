import * as THREE from 'three';
import { WEAPONS, WEAPON_SLOTS, SLOT_KEYS, GRENADE, PEA_ID, AIR_HIGH_GROUND, FOREST } from '../config.js';
import { toon } from '../world/materials.js';
import { clamp, segmentSphereT, damp } from '../utils.js';
import { loadWeaponModel } from './WeaponModels.js';

const tmpFwd = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpSegEnd = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpAim = new THREE.Vector3();
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
    // 充能制植物（坚果）：charges 是当前囤了几颗，recharge 是每颗回复秒数。
    // 非充能植物恒为 Infinity，走原来的路径，行为零变化。
    this.charges = WEAPONS.map((w) => (w.maxCharges ? w.maxCharges : Infinity));
    // 武器槽（按角色）：{ gun: [i0, i1], grenade: i, demo: i, shield: i }，-1 表示空。
    // 槽位本身带角色，所以"同类替换"天然成立，不需要再弹窗问玩家替换哪一格。
    this.slots = this.makeSlots();
    // 当前激活的槽（null = 手上是植物栏里的植物），形如 { role, pos }
    this.activeSlot = null;
    // 手雷蓄力：0 = 没在蓄力；> 0 表示已蓄的秒数（松手投出）
    this.charge = 0;
    this.dropHold = -1;
    this.dropHoldT = 0;
    this.locked = false;
    this.cooldown = 0;
    this.recoil = 0;
    this.swapAnim = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.portrait = false;
    this.root = new THREE.Group();
    this.camera.add(this.root);
    this.buildViewModels();
    this.mountPea();
    this.mountShield();
    // 开局就把 5 号槽的坚果画进底栏；否则要等第一次拾取才会 setSlots
    this.ctx.hud.setSlots(this.slots);
    this.equip(this.slots.peaGun[0], true);
  }

  setMapAppearance(id) {
    this.mapAppearance = id;
    const forest = id === 'forest';
    this.root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (forest && !mesh.userData.dayMaterial && (mesh.material.isMeshToonMaterial || mesh.material.isMeshStandardMaterial)) {
        mesh.userData.dayMaterial = mesh.material;
        mesh.userData.dayGeometry = mesh.geometry;
        // GLB 模板也给地面拾取使用，夜间明暗只烘进手持实例的副本。
        mesh.userData.nightGeometry = mesh.geometry.clone();
        const normals = mesh.geometry.getAttribute('normal');
        const paint = mesh.material.vertexColors ? mesh.geometry.getAttribute('color') : null;
        const colors = new Float32Array(normals.count * 3);
        for (let i = 0; i < normals.count; i++) {
          const light = 0.68 + 0.32 * Math.max(0, (normals.getY(i) - normals.getZ(i)) * Math.SQRT1_2);
          colors[i * 3] = light * (paint ? paint.getX(i) : 1);
          colors[i * 3 + 1] = light * (paint ? paint.getY(i) : 1);
          colors[i * 3 + 2] = light * (paint ? paint.getZ(i) : 1);
        }
        mesh.userData.nightGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        mesh.userData.nightMaterial = new THREE.MeshBasicMaterial({
          color: mesh.material.color, map: mesh.material.map, vertexColors: true, side: mesh.material.side,
          transparent: mesh.material.transparent, opacity: mesh.material.opacity,
        });
      }
      if (mesh.userData.dayMaterial) {
        mesh.material = forest ? mesh.userData.nightMaterial : mesh.userData.dayMaterial;
        mesh.geometry = forest ? mesh.userData.nightGeometry : mesh.userData.dayGeometry;
      }
    });
  }

  makeSlots() {
    const slots = {};
    for (const role of ['peaGun', 'gun', 'demo', 'grenade', 'shield']) {
      slots[role] = new Array(WEAPON_SLOTS[role]).fill(-1);
    }
    return slots;
  }

  // 豌豆常驻 1 号枪槽：开局就装好，任何操作都换不掉它
  mountPea() {
    const idx = WEAPONS.findIndex((w) => w.id === PEA_ID);
    if (idx >= 0) this.slots.peaGun[0] = idx;
    return idx;
  }

  // 坚果常驻 5 号护盾槽：它不进地面随机池，开局不装就等于整局拿不到
  mountShield() {
    const idx = WEAPONS.findIndex((w) => w.id === 'wallnut');
    if (idx >= 0) this.slots.shield[0] = idx;
    return idx;
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
      wallnut: (def) => this.buildWallNut(def),
      fire: (def) => this.buildFireShooter(def),
    };
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      const build = builders[def.model] || builders.shooter;
      const item = build(def);
      item.visual = new THREE.Group();
      for (const child of [...item.group.children]) {
        if (child !== item.muzzle) item.visual.add(child);
      }
      item.group.add(item.visual);
      item.loaded = false;
      item.ready = loadWeaponModel(def.id).then((template) => {
        if (!template) return;
        const geometries = new Set();
        const materials = new Set();
        item.visual.traverse((node) => {
          if (!node.isMesh) return;
          geometries.add(node.geometry);
          if (node.userData.dayGeometry) geometries.add(node.userData.dayGeometry);
          if (node.userData.nightGeometry) geometries.add(node.userData.nightGeometry);
          if (node.material !== outlineMat) materials.add(node.material);
          if (node.userData.dayMaterial) materials.add(node.userData.dayMaterial);
          if (node.userData.nightMaterial) materials.add(node.userData.nightMaterial);
        });
        item.visual.clear();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        item.visual.add(template.clone(true));
        item.loaded = true;
        this.setMapAppearance(this.mapAppearance);
      });
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

  // 坚果墙：手里抱着一颗大坚果，开盾时把盾壳「撑开」到玩家身上
  buildWallNut(def) {
    const group = new THREE.Group();
    const mat = toon(def.color);
    const dark = toon(shade(def.color, 0.62));
    const light = toon(0xe0b070);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), mat);
    body.scale.set(0.92, 1.15, 0.92);
    group.add(body);
    addOutline(body, 1.06);

    // 坚果两端的尖 + 三道褶
    for (let i = 0; i < 2; i++) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), light);
      tip.scale.set(1, 0.7, 1);
      tip.position.set(0, i === 0 ? 0.3 : -0.3, 0);
      group.add(tip);
    }
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.012, 5, 18), dark);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.12 + i * 0.12;
      group.add(band);
    }
    // 一双小眼睛：告诉玩家「这是活着的植物」
    const eyeMat = toon(0x20140a);
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), eyeMat);
      eye.position.set(i === 0 ? 0.085 : -0.085, 0.06, -0.2);
      group.add(eye);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.3);
    group.add(muzzle);

    group.position.set(0.42, -0.34, -0.96);
    group.rotation.set(0.06, 0.3, 0.05);
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

  // 火豌豆：豌豆射手的火系变体 —— 圆头 + 橙色火苗冠 + 发光的枪口
  buildFireShooter(def) {
    const group = new THREE.Group();
    const headMat = toon(def.color);
    const darkMat = toon(shade(def.color, 0.55));
    const flameMat = toon(0xffd23f);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), headMat);
    head.scale.set(1.05, 1, 1.12);
    group.add(head);
    addOutline(head, 1.09);

    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.084, 0.36, 12), headMat);
    snout.rotation.x = Math.PI / 2 - 0.06;
    snout.position.set(0, 0.005, -0.29);
    group.add(snout);
    addOutline(snout, 1.12);

    // 枪口一圈橙光（开火时像烧红的铁）
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.016, 6, 14), new THREE.MeshBasicMaterial({ color: 0xffb03a, toneMapped: false }));
    lip.position.set(0, -0.005, -0.472);
    group.add(lip);

    // 头顶的火苗：三片大小不一的锥形，交错着像在烧
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045 - i * 0.008, 0.13 + i * 0.05, 6), flameMat);
      flame.position.set((i - 1) * 0.055, 0.16 + i * 0.012, 0.01);
      flame.rotation.z = (i - 1) * 0.35;
      group.add(flame);
    }

    const eyeMat = toon(0x2a1004);
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
      eye.position.set(i === 0 ? 0.075 : -0.075, 0.055, -0.06);
      group.add(eye);
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

  setAspect(aspect) {
    this.portrait = aspect < 1;
  }

  // 手上的武器变了 → 同步盾的展开/收起状态。注意是「收起」不是「破盾」：
  // 盾血原样保留，切回坚果会自动重新展开接着用，只有盾血掉到 0 才是真破。
  syncShieldWithHand(nextIndex) {
    const walls = this.ctx.wallNuts;
    if (!walls) return false;
    const next = WEAPONS[nextIndex];
    const holdingNut = !!next && next.kind === 'shield';
    if (holdingNut) {
      // 切回坚果：盾血还在就自动举起来（不用再花阳光）
      if (walls.deploy()) {
        this.ctx.hud.showBanner('盾已举起 · ' + Math.ceil(walls.hp) + ' 盾血', 1.2);
        return true;
      }
      return false;
    }
    // 切走：收起来，盾血保留，人开始正常承伤
    if (walls.stow()) {
      this.ctx.hud.showBanner('盾已收起 · 剩 ' + Math.ceil(walls.hp) + ' 盾血', 1.2);
      return true;
    }
    return false;
  }

  equip(index, silent) {
    if (index < 0 || index >= WEAPONS.length) return;
    const def = WEAPONS[index];
    // 五个槽是独占的：手上只能举一个。切走坚果 = 把盾收起来（盾血保留），切回来再展开。
    this.syncShieldWithHand(index);
    // 不管是不是植物栏的植物：在槽里就用槽，不在槽里且又不是植物栏就切不到
    const at = this.slotIndexOf(index);
    if (!def.starter && !at) return;
    // activeSlot 看的是"手上这把现在归哪个槽"，不是"它是不是战利品"：
    // 植物栏的武器被捡进槽位之后，手上举的就是那一格，切枪/角标都按它走。
    this.activeSlot = at;
    this.current = index;
    for (let i = 0; i < this.models.length; i++) this.models[i].group.visible = i === index;
    this.swapAnim = 1;
    this.ctx.hud.setWeapon(index);
    this.ctx.hud.setActiveSlot(this.activeSlot);
    if (def.starter) {
      this.ctx.hud.setAmmo(0, 0, false);
      // 充能植物（坚果）把剩余颗数画在它那格的角标上
      if (def.maxCharges) this.ctx.hud.setCharges(index, this.charges[index], def.maxCharges);
    } else {
      this.ctx.hud.setAmmo(this.ammo[index], def.ammo, true, this.locked);
    }
    if (!silent) this.ctx.sfx.click();
  }

  // 某个武器现在在哪个槽里：返回 { role, pos }，不在槽里返回 null
  slotIndexOf(index) {
    for (const role of Object.keys(this.slots)) {
      const arr = this.slots[role];
      for (let i = 0; i < arr.length; i++) if (arr[i] === index) return { role, pos: i };
    }
    return null;
  }

  // 某个角色的槽位里有几格
  slotCount(role) {
    const arr = this.slots[role];
    return arr ? arr.length : 0;
  }

  // 把索引 index 从它所在的槽里摘掉（不处理弹药/地面）
  takeOut(index) {
    const at = this.slotIndexOf(index);
    if (!at) return false;
    this.slots[at.role][at.pos] = -1;
    return true;
  }

  // 切到某个槽位（role + 格号）。空格子点了没反应，不打断当前武器。
  equipSlot(role, pos) {
    const at = typeof role === 'object' && role !== null ? role : { role, pos: pos || 0 };
    const arr = this.slots[at.role];
    if (!arr || at.pos < 0 || at.pos >= arr.length) return false;
    const idx = arr[at.pos];
    if (idx < 0) return false;
    this.equip(idx);
    return true;
  }

  // 换一个有枪的槽（Tab / 滚轮）：按 SLOT_ORDER（枪①② → 大杀器 → 手雷）循环，跳过空槽
  cycleSlot(dir) {
    const flat = [];
    for (const role of ['peaGun', 'gun', 'demo', 'grenade', 'shield']) {
      const arr = this.slots[role] || [];
      for (let i = 0; i < arr.length; i++) if (arr[i] >= 0) flat.push({ role, pos: i });
    }
    if (flat.length === 0) return;
    let at = -1;
    if (this.activeSlot) {
      at = flat.findIndex((f) => f.role === this.activeSlot.role && f.pos === this.activeSlot.pos);
    }
    const next = at < 0 ? (dir > 0 ? 0 : flat.length - 1) : ((at + dir) % flat.length + flat.length) % flat.length;
    this.equipSlot(flat[next]);
  }

  // 拾取：按 def.slot 找到该武器的角色槽，同槽满了就替换，旧枪掉在脚边。
  // 返回值语义：true = 已经被拿走（拾取物该消失）；false = 暂时没拿走（拾取物留在地上）。
  // 植物栏里的植物（starter）也能捡进槽位：那是"加一个编排"，不改变它免费的植物栏身份。
  // 共享补给：guest 先本地判断能不能拿，再向 host 发 claim，避免拿走一件自己装不上的枪。
  canAccept(index) {
    const def = WEAPONS[index];
    return !!(def && def.slot && def.slot !== 'peaGun');
  }

  pickup(index) {
    const def = WEAPONS[index];
    if (!def || !def.slot) return false;

    // 已经在身上：补满弹药，切过去，不占新格子
    const at = this.slotIndexOf(index);
    if (at) {
      this.locked = false;
      this.equipSlot(at);
      if (def.maxCharges) {
        // 充能制（坚果）不靠捡来补颗数，避免「丢下再捡」白刷充能
        this.ctx.hud.showBanner(def.name + ' 已装备', 1.2);
      } else {
        this.ammo[index] = def.ammo;
        this.ctx.hud.showBanner(def.name + ' 补满 · ' + def.ammo + ' 发', 1.4);
      }
      this.ctx.sfx.pickup();
      return true;
    }

    // 豌豆常驻槽不接受任何其他武器；它自己也永远不会走到这里（开局已装好）
    if (def.slot === 'peaGun') return false;
    const arr = this.slots[def.slot] || [];
    const empty = arr.indexOf(-1);
    if (empty >= 0) {
      this.placeInSlot(def.slot, empty, index);
      this.ctx.hud.showBanner('拾取 ' + def.name + ' · ' + def.ammo + ' 发', 1.8);
      this.ctx.sfx.pickup();
      return true;
    }

    // 槽满了：直接顶掉这一格（枪槽只有一个可换位，豌豆那格不参与）。
    const pos = 0;
    const old = arr[pos];
    if (old >= 0) this.eject(old);
    this.placeInSlot(def.slot, pos, index);
    const oldName = old >= 0 ? WEAPONS[old].name : '';
    this.ctx.hud.showBanner(
      oldName ? '换装 ' + def.name + ' ↑ ' + oldName + ' 掉在地上' : '拾取 ' + def.name,
      1.8
    );
    this.ctx.sfx.pickup();
    return true;
  }

  // 把一个仍在槽里的武器踢出去：清弹药、掉回脚边（吃鸡式替换的旧枪不消失）
  eject(index) {
    if (index < 0) return;
    this.takeOut(index);
    this.ammo[index] = 0;
    if (this.current === index) this.locked = false;
    this.dropOnGround(index);
  }

  // 在玩家脚边生成一个可再捡起的拾取物
  dropOnGround(index) {
    const p = this.player.pos;
    const ahead = 1.6;
    const yaw = this.player.yaw;
    const dropX = p.x - Math.sin(yaw) * ahead;
    const dropZ = p.z - Math.cos(yaw) * ahead;
    if (this.ctx.pickups && this.ctx.pickups.dropAt) this.ctx.pickups.dropAt(index, dropX, dropZ);
  }

  placeInSlot(role, pos, index) {
    const def = WEAPONS[index];
    // 同一把武器同时只占一个槽：先把它从旧槽摘掉
    this.takeOut(index);
    this.slots[role][pos] = index;
    // 充能制武器没有弹匣，不要把 ammo 写成 undefined
    if (def.ammo !== undefined) this.ammo[index] = def.ammo;
    this.locked = false;
    this.ctx.hud.setSlots(this.slots);
    this.equip(index, true);
  }

  // 丢掉某个槽（role + 格号）：枪不消失，掉回地面可以回去捡
  dropSlot(role, pos) {
    const at = typeof role === 'object' && role !== null ? role : { role, pos: pos || 0 };
    const arr = this.slots[at.role];
    if (!arr || at.pos < 0 || at.pos >= arr.length) return false;
    const idx = arr[at.pos];
    if (idx < 0) return false;
    // 豌豆/坚果是常驻 starter：丢了整局就没了（坚果不在掉落池里），不许丢
    const def = WEAPONS[idx];
    if (def.starter) return false;
    const wasActive = this.activeSlot && this.activeSlot.role === at.role && this.activeSlot.pos === at.pos;
    this.eject(idx);
    this.ctx.hud.setSlots(this.slots);
    if (wasActive) this.equip(this.slots.peaGun[0], true);
    this.ctx.hud.showBanner(def.name + ' 已丢下', 1.4);
    return true;
  }

  // 丢掉当前手上的那把（按 G 时手上不是手雷就走这里）
  dropLoot() {
    if (!this.activeSlot) return;
    this.dropSlot(this.activeSlot.role, this.activeSlot.pos);
  }

  // 打空后用阳光自动续一梭子；阳光不够则锁定，等有钱自动解锁
  tryReload() {
    const idx = this.current;
    if (idx < 0 || WEAPONS[idx].starter) return false;
    const def = WEAPONS[idx];
    const cost = (def.cost || 0) * def.ammo;
    if (!this.ctx.spendSun(cost)) {
      if (!this.locked) {
        this.locked = true;
        this.ctx.hud.setAmmo(0, def.ammo, true, true);
        this.ctx.hud.denySun();
        this.ctx.hud.showBanner('阳光不足 · ' + def.name + ' 待续弹（' + cost + '）', 1.6);
      }
      return false;
    }
    this.ammo[idx] = def.ammo;
    this.locked = false;
    this.ctx.hud.setAmmo(def.ammo, def.ammo, true, false);
    this.ctx.sfx.pickup();
    return true;
  }

  update(dt, controls) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 4);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    // 相机视野是各弹种共用的「准星」，弹道都按它解算，不再跟着视图模型的摆动走
    this.ctx.hud.setCrosshair(!!WEAPONS[this.current].arc);

    // 充能回复：坚果每 recharge 秒回一颗，最多囤到 maxCharges
    for (let i = 0; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      if (!w.maxCharges || this.charges[i] >= w.maxCharges) continue;
      this.charges[i] = Math.min(w.maxCharges, this.charges[i] + dt / w.recharge);
      if (i === this.current) this.ctx.hud.setCharges(i, Math.floor(this.charges[i]), w.maxCharges);
    }

    // ---- 槽位交互：选槽 > 循环 > 丢弃。槽位带角色，所以不再有"替换哪一格"的弹窗 ----
    const slotReq = controls.consumeSlotRequest ? controls.consumeSlotRequest() : -1;
    if (slotReq >= 0 && SLOT_KEYS[slotReq]) this.equipSlot(SLOT_KEYS[slotReq].role, SLOT_KEYS[slotReq].pos);
    const cycle = controls.consumeSlotCycle ? controls.consumeSlotCycle() : 0;
    if (cycle !== 0) this.cycleSlot(cycle);
    if (controls.consumeDropRequest && controls.consumeDropRequest()) this.dropLoot();
    if (controls.consumeLootRequest && controls.consumeLootRequest()) {
      // Q：回到上一个用过的战利品槽（有就切过去，没有就回豌豆）
      this.cycleSlot(1);
    }

    const def = WEAPONS[this.current];
    const pressed = controls.consumeFirePressed();
    this.assist = this.findAimTarget(def);
    this.ctx.hud.setAimLock(!!this.assist);

    // 手雷是"按住蓄力、松手投出"，不吃 auto/pressed 那套；蓄力条交给 HUD 画
    if (def.grenade) {
      this.updateGrenade(dt, controls, def);
      this.ctx.hud.setCharge(def.grenade ? this.charge / GRENADE.chargeTime : 0);
    } else if (def.auto) {
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
    const forestTouch = this.ctx.touch && this.ctx.map && this.ctx.map.id === 'forest';
    g.scale.setScalar(model.baseScale * (this.portrait ? 0.78 : 1) * (forestTouch ? FOREST.touchWeaponScale : 1));
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

    // 坚果墙：不是「开火」，是「套盾」。先查盾有没有在、充能够不够，再扣阳光。
    if (def.kind === 'shield') {
      this.raiseShield(def, index);
      return;
    }

    // 手雷：按住蓄力、松手投出。蓄力期间不扣任何资源，松手才判定。
    if (def.grenade) {
      return;
    }

    if (starter) {
      if (!this.ctx.spendSun(def.cost)) {
        this.ctx.sfx.deny();
        this.ctx.hud.denySun();
        return;
      }
    } else {
      if (this.ammo[index] <= 0) {
        // 打空：阳光够就自动续弹继续打，不够则锁定，下一帧再试
        if (!this.tryReload()) {
          this.ctx.sfx.deny();
          return;
        }
      }
      this.ammo[index]--;
    }
    this.cooldown = def.cooldown;

    // 辅助瞄准（只有直线弹种）：把弹道方向扭向锁定的僵尸。
    // 投掷物不扭方向，改成把落点挪到锁定的僵尸脚下 —— 它用的是完全不同的落点解算。
    const assist = !def.arc && this.assist && this.resolveAssist(this.assist);
    const targetPoint = assist ? assist.point : this.forwardPoint(70, tmpTarget);
    const headshot = !!assist && assist.head;
    const model = this.models[this.current];
    model.muzzle.getWorldPosition(tmpMuzzle);

    if (def.arc) {
      // 有重力的投掷物（西瓜/樱桃）：落点就是准星指的那片地。
      // 准星锁定了僵尸就砸它脚下：视线只在背身时贴地，顺着视线投影落点会越过头顶落到后头去。
      const range = this.groundRange(tmpAim);
      const lock = this.assist;
      if (lock && lock.zombie.alive && !lock.zombie.dying) {
        tmpAim.set(lock.zombie.root.position.x, 0, lock.zombie.root.position.z);
        range.dist = clamp(Math.hypot(tmpAim.x - this.camera.position.x, tmpAim.z - this.camera.position.z), 2, 22);
      }
      this.ctx.projectiles.throwCherry(tmpMuzzle, tmpAim, def, range);
      this.ctx.sfx.throwCherry();
    } else {
      // 直线弹道从**相机**出发（不是枪口）：枪口在枪管里、还比准星低一点，
      // 从枪口朝准星打会在近距离系统性地偏右下，远一点又偏右 —— 这就是"子弹和准星不一致"。
      // 真正的子弹从眼睛发出不真实，但 FPS 里看得见的只有准星，先保证打哪儿中哪儿。
      tmpOrigin.copy(this.camera.position);
      const shots = Math.max(1, def.shots || 1);
      if (def.kind === 'pea') {
        for (let s = 0; s < shots; s++) {
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
      } else {
        this.hitscan(def);
      }
    }

    this.recoil = Math.min(1.6, this.recoil + 0.9);
    this.player.addRecoil(def.recoil * 0.0055);
    this.ctx.particles.muzzle(tmpMuzzle, def.color);
    this.ctx.onFire(def);

    if (!starter) {
      this.ctx.hud.setAmmo(this.ammo[index], def.ammo, true);
    }
  }

  // 手雷蓄力：按住开火键攒 charge，松手按蓄力比例换算成投掷距离。
  updateGrenade(dt, controls, def) {
    if (!def.grenade) {
      // 手上不是手雷：把没走完的蓄力清掉，避免切枪后残留
      if (this.charge > 0) this.charge = 0;
      return;
    }
    const holding = !!controls.firing;
    if (holding) {
      if (this.cooldown <= 0) this.charge = Math.min(GRENADE.chargeTime, this.charge + dt);
    } else if (this.charge > 0) {
      const ratio = this.charge / GRENADE.chargeTime;
      this.charge = 0;
      this.throwGrenade(def, ratio);
    }
  }

  throwGrenade(def, ratio) {
    if (this.cooldown > 0) return;
    const index = this.current;
    if (this.ammo[index] <= 0) {
      // 手雷打空：走和以前一样的自动续弹（阳光不够就 locked，攒够自动续）
      if (!this.tryReload()) {
        this.ctx.sfx.deny();
        return;
      }
    }
    this.ammo[index]--;
    this.cooldown = def.cooldown;

    const model = this.models[this.current];
    model.muzzle.getWorldPosition(tmpMuzzle);
    const dist = clamp(GRENADE.minRange + (GRENADE.maxRange - GRENADE.minRange) * ratio, GRENADE.minRange, GRENADE.maxRange);
    // 落点：沿相机水平朝向走 dist 米（不跟准星俯仰，手雷是"扔出去"而不是"指哪打哪"）
    this.camera.getWorldDirection(tmpFwd);
    const flat = Math.hypot(tmpFwd.x, tmpFwd.z) || 1;
    tmpAim.set(
      this.camera.position.x + (tmpFwd.x / flat) * dist,
      0,
      this.camera.position.z + (tmpFwd.z / flat) * dist
    );
    this.ctx.projectiles.throwCherry(tmpMuzzle, tmpAim, def, { dist, y: 0, point: tmpAim });
    this.ctx.sfx.throwCherry();

    this.recoil = Math.min(1.6, this.recoil + 0.9);
    this.ctx.particles.muzzle(tmpMuzzle, def.color);
    this.ctx.onFire(def);
    this.ctx.hud.setAmmo(this.ammo[index], def.ammo, true);
  }

  // 套盾：钱够 + 盾已碎 + 充能 ≥1 才生效。盾还在时按下去只播拒绝音（不叠加、不刷新）。
  raiseShield(def, index) {
    const walls = this.ctx.wallNuts;
    if (!walls) return;
    // 独占规则：只有手上举着坚果才能套盾
    if (this.current !== index) return;
    // 手上是坚果但盾被切走时收起了：盾血还在就直接展开，不花阳光也不花充能
    if (walls.hp > 0 && !walls.active) {
      walls.deploy();
      this.ctx.hud.showBanner('盾已举起 · ' + Math.ceil(walls.hp) + ' 盾血', 1.2);
      return;
    }
    if (walls.active && walls.hp > 0) {
      this.ctx.sfx.deny();
      this.ctx.hud.showBanner('坚果还在', 1.0);
      return;
    }
    if (this.charges[index] < 1) {
      this.ctx.sfx.deny();
      this.ctx.hud.showBanner('坚果用完了', 1.0);
      return;
    }
    if (!this.ctx.spendSun(def.cost)) {
      this.ctx.sfx.deny();
      this.ctx.hud.denySun();
      return;
    }
    this.charges[index] -= 1;
    walls.raise();
    this.cooldown = def.cooldown;
    this.recoil = Math.min(1.6, this.recoil + 0.5);
    this.ctx.hud.setCharges(index, Math.floor(this.charges[index]), def.maxCharges);
    this.ctx.hud.showBanner('坚果墙 · ' + def.shieldHp + ' 盾血', 1.2);
    this.ctx.onFire(def);
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

  // 从相机沿视线扫掠僵尸：返回第一个被命中的 { zombie, head, dist, pos }，没打到返回 null。
  // 瞬时命中（玉米炮/辣椒）和西瓜落点判定共用，保证「准星指谁」在两条线上算法一致。
  raycastZombies() {
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    tmpSegEnd.copy(tmpOrigin).addScaledVector(tmpFwd, 90);
    let bestT = 2;
    let hit = null;
    for (let i = 0; i < this.ctx.zombies.zombies.length; i++) {
      const z = this.ctx.zombies.zombies[i];
      if (!z.alive || z.dying) continue;
      // hitRadiusScale：骷髅模型体块比例不同，半径跟着模型走（僵尸默认 1，口径不变）
      const rs = z.hitRadiusScale || 1;
      z.getChest(tmpChest);
      const t1 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpChest, 0.46 * z.scaleFactor * rs);
      z.getHead(tmpHead);
      const t2 = segmentSphereT(tmpOrigin, tmpSegEnd, tmpHead, 0.36 * z.scaleFactor * rs);
      let t = -1;
      let head = false;
      // 和 ProjectileSystem 同一套判定：头部球更小时严格比较 t，同 t 头部优先
      if (t2 >= 0 && (t1 < 0 || t2 <= t1)) {
        t = t2;
        head = true;
      } else if (t1 >= 0) {
        t = t1;
      }
      if (t >= 0 && t < bestT) {
        bestT = t;
        hit = { zombie: z, head, dist: 90 * t, pos: new THREE.Vector3().copy(tmpOrigin).addScaledVector(tmpFwd, 90 * t) };
      }
    }
    return hit;
  }

  hitscan(def) {
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    const hit = this.raycastZombies();
    const impact = hit ? hit.pos : this.groundRange(tmpAim).point;
    this.ctx.projectiles.explodeAt(impact, def.radius, def.damage, true, hit && hit.zombie, !!hit && hit.head, def.id);
    this.ctx.sfx.cannon();
    this.ctx.shake(0.55);
  }

  // 投掷物的落点：准星正前方那片地。
  // 视线水平或朝上时与地面永不相交，退化成「准星指向的前方 16 米，最多 22 米」。
  // 返回 { dist：离相机的水平距离, y：落点地面高度 }，落点本身写进 out。
  groundRange(out) {
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    const flat = Math.hypot(tmpFwd.x, tmpFwd.z);
    let horiz = tmpFwd.y < -0.02 ? (tmpOrigin.y * flat) / -tmpFwd.y : 16;
    horiz = clamp(horiz, 2, 22);
    out.set(tmpOrigin.x + (tmpFwd.x / flat) * horiz, 0, tmpOrigin.z + (tmpFwd.z / flat) * horiz);
    return { dist: horiz, y: 0, point: out };
  }

  findAimTarget(def) {
    const maxAngle = this.ctx.touch ? 0.17 : 0.045;
    this.camera.getWorldDirection(tmpFwd);
    tmpOrigin.copy(this.camera.position);
    let best = null;
    let bestScore = Infinity;
    // aerial 既可能是数字倍率（仙人掌 1 / 火豌豆 0.25），也可能是 'explosion' 字符串；
    // 后者同样能打空中目标，不能按 0 处理，否则玉米炮/辣椒的辅助瞄准不会吸附气球。
    const aerial = typeof def.aerial === 'number' ? def.aerial : def.aerial ? 1 : 0;
    for (let i = 0; i < this.ctx.zombies.zombies.length; i++) {
      const z = this.ctx.zombies.zombies[i];
      if (!z.alive || z.dying || z.spawnT < 0.5) continue;
      // 打不到空中目标就别把准星吸过去（辅助瞄准只会帮人打中，不能帮他锁一个打不中的目标）
      if (z.airborne && !(aerial > 0) && !this.canHitAirFromAbove(z)) continue;
      z.getChest(tmpChest);
      tmpTo.copy(tmpChest).sub(tmpOrigin);
      const dist = tmpTo.length();
      const maxDist = this.ctx.map && this.ctx.map.id === 'forest' ? FOREST.aimDistance : 62;
      if (dist > maxDist) continue;
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

  // 站在高处（落地且脚底 ≥0.9 米）且水平 3 米内：任何武器都能打到头顶的气球。与 ProjectileSystem 同一口径。
  canHitAirFromAbove(z) {
    const p = this.player;
    if (!p || !p.pos) return false;
    if (p.grounded === false) return false;
    if (p.pos.y < AIR_HIGH_GROUND) return false;
    return Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z) <= 3;
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
    this.locked = false;
    for (let i = 0; i < WEAPONS.length; i++) {
      this.ammo[i] = WEAPONS[i].starter ? Infinity : 0;
    }
    this.slots = this.makeSlots();
    this.mountPea();
    this.mountShield();
    this.activeSlot = null;
    this.charge = 0;
    for (let i = 0; i < WEAPONS.length; i++) {
      this.charges[i] = WEAPONS[i].maxCharges ? WEAPONS[i].maxCharges : Infinity;
    }
    if (this.ctx.wallNuts) this.ctx.wallNuts.clear();
    this.ctx.hud.setSlots(this.slots);
    // 重开一局若不走武器 update（例如暂停中清 HUD），圆形准星会残留到下一局第一帧
    this.ctx.hud.setCrosshair(false);
    this.equip(this.slots.peaGun[0], true);
  }
}
