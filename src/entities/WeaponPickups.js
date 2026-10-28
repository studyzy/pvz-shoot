import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../config.js';
import { toon, glowTexture } from '../world/materials.js';
import { rand, shuffle, TAU } from '../utils.js';

const MAX_SPOTS = 10;
const PICK_RADIUS = 1.45;
const RESPAWN_MIN = 9;
const RESPAWN_MAX = 14;

const labelCache = new Map();
const miniCache = new Map();
const matCache = new Map();

function cssColor(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

function labelTexture(def) {
  if (labelCache.has(def.id)) return labelCache.get(def.id);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(5,16,9,0.82)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(6, 10, 500, 108, 26);
    ctx.fill();
  } else {
    ctx.fillRect(6, 10, 500, 108);
  }
  ctx.strokeStyle = cssColor(def.color);
  ctx.lineWidth = 5;
  if (ctx.roundRect) ctx.stroke();
  else ctx.strokeRect(6, 10, 500, 108);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2ffe4';
  ctx.font = '800 42px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(def.name, 256, 48);
  ctx.fillStyle = cssColor(def.color);
  ctx.font = '800 30px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(def.ammo + ' 发', 256, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(def.id, tex);
  return tex;
}

function makeMini(def) {
  if (miniCache.has(def.id)) return miniCache.get(def.id);
  const g = new THREE.Group();
  const buckets = { color: [], dark: [], green: [], spike: [] };
  const part = (bucket, geo, x, y, z, sx, sy, sz, rx, ry, rz) => {
    geo.scale(sx, sy, sz);
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    buckets[bucket].push(geo);
  };

  part('green', new THREE.CylinderGeometry(0.045, 0.07, 0.36, 7), 0, 0.22, 0, 1, 1, 1, 0, 0, 0);
  part('green', new THREE.SphereGeometry(0.11, 7, 5), 0.16, 0.16, 0.02, 1.5, 0.26, 0.8, 0, 0, -0.5);
  part('green', new THREE.SphereGeometry(0.11, 7, 5), -0.15, 0.16, 0.02, 1.5, 0.26, 0.8, 0, 0, 0.6);

  if (def.model === 'melon') {
    part('color', new THREE.SphereGeometry(0.26, 12, 10), 0, 0.56, 0, 1.1, 0.94, 1.1, 0, 0, 0);
    for (let i = 0; i < 2; i++) {
      part('dark', new THREE.TorusGeometry(0.25, 0.014, 5, 16), 0, 0.5 + i * 0.12, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    }
  } else if (def.model === 'cactus') {
    part('color', new THREE.CylinderGeometry(0.1, 0.12, 0.46, 9), 0, 0.52, 0, 1, 1, 1, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      part(
        'spike',
        new THREE.ConeGeometry(0.022, 0.09, 4),
        Math.cos(a) * 0.11,
        0.53 + (i % 2) * 0.1,
        Math.sin(a) * 0.11,
        1, 1, 1,
        Math.sin(a) * 0.5,
        0,
        Math.cos(a) * 0.5
      );
    }
  } else if (def.model === 'pepper') {
    part('color', new THREE.ConeGeometry(0.16, 0.5, 9), 0, 0.55, 0, 1, 1, 1, 0, 0, 0);
    part('dark', new THREE.SphereGeometry(0.13, 8, 6), 0, 0.79, 0, 1, 0.5, 1, 0, 0, 0);
  } else if (def.model === 'gatling') {
    part('color', new THREE.SphereGeometry(0.19, 10, 8), 0, 0.58, 0, 1, 1, 1, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      part(
        'dark',
        new THREE.CylinderGeometry(0.034, 0.04, 0.34, 7),
        Math.cos(a) * 0.07,
        0.58 + Math.sin(a) * 0.07,
        -0.2,
        1, 1, 1,
        Math.PI / 2, 0, 0
      );
    }
  } else if (def.model === 'multi') {
    const count = Math.max(2, def.shots || 2);
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.17;
      part('color', new THREE.SphereGeometry(0.14, 10, 8), x, 0.58, 0, 1, 1, 1, 0, 0, 0);
      part('dark', new THREE.CylinderGeometry(0.055, 0.08, 0.25, 8), x, 0.56, -0.18, 1, 1, 1, Math.PI / 2, 0, 0);
    }
  } else {
    part('color', new THREE.SphereGeometry(0.17, 10, 8), 0, 0.58, 0, 1, 1, 1, 0, 0, 0);
  }

  const mats = {
    color: toon(def.color),
    dark: toon(new THREE.Color(def.color).multiplyScalar(0.6).getHex()),
    green: toon(0x5cb31d),
    spike: toon(0xe9ffc4),
  };
  for (const key of Object.keys(buckets)) {
    const list = buckets[key];
    if (!list.length) continue;
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    g.add(new THREE.Mesh(merged, mats[key]));
    for (let i = 0; i < list.length; i++) list[i].dispose();
  }

  g.scale.setScalar(1.25);
  miniCache.set(def.id, g);
  return g;
}

function weaponMaterials(index) {
  if (matCache.has(index)) return matCache.get(index);
  const def = WEAPONS[index];
  const mats = {
    ring: new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.8,
      toneMapped: false,
    }),
    glow: new THREE.SpriteMaterial({
      map: glowTexture(),
      color: def.color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.62,
    }),
    label: new THREE.SpriteMaterial({
      map: labelTexture(def),
      transparent: true,
      depthWrite: false,
    }),
  };
  matCache.set(index, mats);
  return mats;
}

export class WeaponPickups {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.map = null;
    this.time = 0;
    this.bag = [];
    this.items = [];
    this.ringGeo = new THREE.TorusGeometry(0.62, 0.05, 6, 24);
    this.lootIndices = [];
    for (let i = 0; i < WEAPONS.length; i++) {
      if (!WEAPONS[i].starter) this.lootIndices.push(i);
    }
    for (let i = 0; i < MAX_SPOTS; i++) this.items.push(this.makeItem());
  }

  makeItem() {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(this.ringGeo, weaponMaterials(this.lootIndices[0]).ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    const glow = new THREE.Sprite(weaponMaterials(this.lootIndices[0]).glow);
    glow.position.y = 0.7;
    glow.scale.set(2.1, 2.1, 1);
    group.add(glow);

    const holder = new THREE.Group();
    holder.position.y = 0.48;
    group.add(holder);

    const label = new THREE.Sprite(weaponMaterials(this.lootIndices[0]).label);
    label.position.y = 1.72;
    label.scale.set(1.9, 0.48, 1);
    group.add(label);

    group.visible = false;
    this.scene.add(group);

    return {
      group,
      ring,
      glow,
      holder,
      label,
      index: -1,
      active: false,
      respawn: 0,
      phase: rand(0, TAU),
      spot: null,
    };
  }

  nextWeapon() {
    if (this.bag.length === 0) {
      this.bag = shuffle(this.lootIndices.slice());
    }
    return this.bag.pop();
  }

  setMap(map) {
    this.map = map;
    const spots = (map && map.pickupSpots) || [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (i >= spots.length) {
        item.active = false;
        item.spot = null;
        item.group.visible = false;
        continue;
      }
      item.spot = spots[i];
      item.group.position.set(spots[i][0], 0, spots[i][1]);
      item.phase = rand(0, TAU);
      this.spawn(item);
    }
  }

  spawn(item) {
    const index = this.nextWeapon();
    item.index = index;
    item.active = true;
    item.respawn = 0;
    const mats = weaponMaterials(index);
    item.ring.material = mats.ring;
    item.glow.material = mats.glow;
    item.label.material = mats.label;
    item.holder.clear();
    item.holder.add(makeMini(WEAPONS[index]).clone(true));
    item.group.visible = true;
  }

  reset() {
    if (!this.map) return;
    this.bag.length = 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.spot) {
        item.active = false;
        item.group.visible = false;
        continue;
      }
      item.group.position.set(item.spot[0], 0, item.spot[1]);
      item.phase = rand(0, TAU);
      this.spawn(item);
    }
  }

  update(dt, player) {
    this.time += dt;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.active) {
        if (!item.spot) continue;
        item.respawn -= dt;
        if (item.respawn <= 0) this.spawn(item);
        continue;
      }

      item.phase += dt * 1.8;
      const bob = Math.sin(item.phase) * 0.08;
      item.holder.position.y = 0.52 + bob;
      item.holder.rotation.y += dt * 1.1;
      item.label.position.y = 1.72 + bob * 0.5;
      const pulse = 1 + Math.sin(item.phase * 1.4) * 0.07;
      item.ring.scale.set(pulse, pulse, 1);

      const dx = player.pos.x - item.group.position.x;
      const dz = player.pos.z - item.group.position.z;
      const dist2 = dx * dx + dz * dz;
      item.group.visible = dist2 < 30 * 30;

      if (!player.dead) {
        if (dist2 < PICK_RADIUS * PICK_RADIUS) {
          const def = WEAPONS[item.index];
          if (this.ctx.weapons.pickup(item.index)) {
            this.ctx.particles.burst({
              pos: new THREE.Vector3(item.group.position.x, 0.8, item.group.position.z),
              color: [def.color, 0xffffff],
              count: 14,
              speed: 3.2,
              size: 0.09,
              life: 0.5,
              gravity: 1.5,
              up: 1.4,
            });
            item.active = false;
            item.group.visible = false;
            item.respawn = rand(RESPAWN_MIN, RESPAWN_MAX);
          }
        }
      }
    }
  }

  clear() {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
      this.items[i].group.visible = false;
      this.items[i].respawn = 0;
    }
  }
}
