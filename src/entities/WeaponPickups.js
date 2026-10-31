import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS, PEA_ID } from '../config.js';
import { toon, glowTexture } from '../world/materials.js';
import { rand, TAU } from '../utils.js';
import { loadWeaponModel } from '../weapons/WeaponModels.js';

const MAX_SPOTS = 10;
const PICK_RADIUS = 1.45;
const SPAWN_MIN = 4;
const SPAWN_MAX = 8;

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
    this.items = [];
    this.spawnTimer = 0;
    this.finished = true;
    // 双人共享补给：host 权威刷/捡/丢，guest 只镜像 host 的列表并发 claim 请求。
    // shared = true 只在 guest 侧；host 用 onChange 广播，guest 用 onClaim/onDrop 上报。
    this.shared = false;
    this.onChange = null;
    this.onClaim = null;
    this.onDrop = null;
    this.onLocalPickup = null;
    this.nextId = 1;
    // 空投光柱（全队唯一，一次只有一根）
    this.beamT = 0;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.75, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc21f,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    this.beam.position.y = 7;
    this.beam.visible = false;
    this.scene.add(this.beam);
    this.ringGeo = new THREE.TorusGeometry(0.62, 0.05, 6, 24);
    // 地面会刷出的武器：不含坚果（开局常驻 5 号槽）与初始豌豆（常驻 1 号槽）。
    // 樱桃/玉米炮/火豌豆虽然也在植物栏，但它们同样是战利品池里的正常成员。
    this.lootIndices = [];
    for (let i = 0; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      if (w.kind === 'shield' || w.id === PEA_ID) continue;
      this.lootIndices.push(i);
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
      air: false,
      active: false,
      // used：本关这个点位已经出过道具，不再刷新
      used: false,
      phase: rand(0, TAU),
      spot: null,
      // dropped：玩家丢下的（没有点位，捡走就永久消失）
      dropped: false,
    };
  }

  setShared(v) {
    this.shared = !!v;
    if (this.shared) {
      // 切到 guest：本地随机刷出的道具作废，等 host 的列表
      for (let i = 0; i < this.items.length; i++) {
        this.items[i].active = false;
        this.items[i].group.visible = false;
      }
      this.finished = true;
    }
  }

  // 把视觉部分（光环/发光/名称牌/小模型）刷成某把武器
  paint(item, index) {
    const mats = weaponMaterials(index);
    item.ring.material = mats.ring;
    item.glow.material = mats.glow;
    item.label.material = mats.label;
    item.holder.clear();
    const visual = new THREE.Group();
    visual.add(makeMini(WEAPONS[index]).clone(true));
    item.holder.add(visual);
    item.visualReady = loadWeaponModel(WEAPONS[index].id).then((template) => {
      // 已重新 paint 的 holder 不能再接收旧请求的模型。
      if (!template || visual.parent !== item.holder) return;
      const model = template.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 0.9 / Math.max(size.x, size.y, size.z);
      model.scale.multiplyScalar(scale);
      model.position.set(-(box.min.x + box.max.x) * scale / 2, -box.min.y * scale, -(box.min.z + box.max.z) * scale / 2);
      visual.clear();
      visual.add(model);
    });
  }

  // 空投：提前 5 秒在落点竖一根光柱；真正落地时再 spawnAir。
  beamAt(x, z, dur = 5) {
    this.beam.position.set(x, 7, z);
    this.beam.visible = true;
    this.beamT = dur;
  }

  // 空投补给：和普通补给同一条 claim 管线，只是带 air 标记（+40 阳光 / +200 分）
  spawnAir(index, x, z) {
    const item = this.items.find((it) => !it.active) || this.items[0];
    if (!item) return false;
    item.spot = null;
    item.dropped = true;
    item.air = true;
    item.index = index;
    item.active = true;
    item.id = this.nextId++;
    this.paint(item, index);
    item.group.position.set(x, 0, z);
    item.group.visible = true;
    item.phase = rand(0, TAU);
    item.pickCooldown = 0.8;
    this.notify();
    return true;
  }

  // host：挑一个还没出过道具的点位给空投
  pickAirSpot() {
    const open = this.items.filter((it) => it.spot && !it.used);
    if (!open.length) return null;
    return open[rand(0, open.length - 1) | 0].spot;
  }

  byId(id) {
    return this.items.find((it) => it.active && it.id === id) || null;
  }

  removeById(id) {
    const item = this.byId(id);
    if (!item) return false;
    item.active = false;
    item.group.visible = false;
    item.dropped = false;
    item.air = false;
    return true;
  }

  netList() {
    const out = [];
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      out.push({
        id: it.id,
        i: it.index,
        x: Math.round(it.group.position.x * 100) / 100,
        z: Math.round(it.group.position.z * 100) / 100,
        a: it.air ? 1 : 0,
      });
    }
    return out;
  }

  // guest 侧：用 host 的列表重排本地池。id 是 host 分配的稳定标识。
  applyNetList(list) {
    const live = new Map();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && Number.isFinite(e.id) && Number.isFinite(e.i)) live.set(e.id, e);
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.active && !live.has(it.id)) {
        it.active = false;
        it.group.visible = false;
      }
    }
    const seen = new Set();
    for (const [id, e] of live) {
      if (seen.has(id)) continue;
      seen.add(id);
      let item = this.items.find((it) => it.active && it.id === id);
      if (!item) item = this.items.find((it) => !it.active);
      if (!item) return;
      const changed = !item.active || item.id !== id || item.index !== e.i;
      item.id = id;
      item.index = e.i;
      item.air = !!e.a;
      item.active = true;
      item.dropped = false;
      item.spot = null;
      item.pickCooldown = 0;
      item.claimT = 0;
      if (changed) this.paint(item, e.i);
      item.group.position.set(e.x, 0, e.z);
      item.group.visible = true;
    }
  }

  notify() {
    if (this.onChange) this.onChange(this.netList());
  }

  // 玩家从武器槽里丢下一把枪：在脚边生成一个可再捡起的拾取物。
  // 优先复用空闲的池对象；池子满了就借用最久没被用的那个点位物品。
  dropAt(index, x, z) {
    let item = this.items.find((it) => !it.active && it.dropped);
    if (!item) item = this.items.find((it) => !it.active);
    if (!item) {
      // 全都在地上：把距离玩家最远的点位物品搬过来（丢掉的是玩家的选择，优先保留）
      item = this.items.find((it) => it.spot) || this.items[0];
      if (!item) return false;
    }
    item.spot = null;
    item.dropped = true;
    item.index = index;
    item.active = true;
    item.id = this.nextId++;
    this.paint(item, index);
    item.group.position.set(x, 0, z);
    item.group.visible = true;
    // 刚丢下的枪立刻可捡会形成"丢→捡"循环，给 1 秒的冷却
    item.phase = rand(0, TAU);
    item.pickCooldown = 1.0;
    // guest 丢枪要让 host 在权威世界里也丢一把，再广播新的列表
    if (this.shared) {
      if (this.onDrop) this.onDrop(index, x, z);
    } else {
      this.notify();
    }
    return true;
  }

  // 随机挑一个空点位出场。一关内每个点位只出一次（used 标记），被捡走后不再补刷；
  // 点位用尽就整关不再出新道具。返回是否真的出成功。
  spawnRandom() {
    const open = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.spot && !item.active && !item.used) open.push(item);
    }
    if (!open.length || this.lootIndices.length === 0) return false;
    const item = open[rand(0, open.length - 1) | 0];
    item.used = true;
    item.index = this.lootIndices[rand(0, this.lootIndices.length - 1) | 0];
    item.active = true;
    item.id = this.nextId++;
    this.paint(item, item.index);
    item.group.position.set(item.spot[0], 0, item.spot[1]);
    item.phase = rand(0, TAU);
    item.group.visible = true;
    this.notify();
    return true;
  }

  setMap(map) {
    this.map = map;
    const spots = (map && map.pickupSpots) || [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      item.spot = i < spots.length ? spots[i] : null;
      item.active = false;
      item.used = false;
      item.dropped = false;
      item.group.visible = false;
    }
    this.beginLevel();
  }

  // 一关开始：重置所有点位与刷新节拍。整关只在开局由它刷道具，过程中不再重置。
  beginLevel() {
    this.spawnTimer = rand(SPAWN_MIN, SPAWN_MAX);
    this.finished = false;
    // guest 不本地刷：等 host 的共享列表
    if (this.shared) {
      this.finished = true;
      return;
    }
    this.spawnRandom();
  }

  reset() {
    if (!this.map) return;
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
      this.items[i].used = false;
      this.items[i].dropped = false;
      this.items[i].group.visible = false;
    }
    this.beginLevel();
  }

  update(dt, player) {
    this.time += dt;
    if (this.beamT > 0) {
      this.beamT = Math.max(0, this.beamT - dt);
      this.beam.visible = this.beamT > 0;
      this.beam.rotation.y += dt * 0.8;
    }
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.active) continue;

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

      if (item.air) {
        item.holder.position.y = 1.0 + bob * 2;
        item.label.position.y = 2.2;
      }

      if (item.pickCooldown > 0) item.pickCooldown = Math.max(0, item.pickCooldown - dt);
      if (item.claimT > 0) item.claimT = Math.max(0, item.claimT - dt);
      // 槽位带角色后不再有"等玩家选替换哪一格"的中间态，pickup 是同步完成的
      if (!player.dead && !(item.pickCooldown > 0) && dist2 < PICK_RADIUS * PICK_RADIUS) {
        if (this.shared) {
          // guest：只上报 claim，等 host 裁决后由 evt 移除；0.4 s 节流防刷屏
          if (item.claimT <= 0 && this.onClaim && this.ctx.weapons.canAccept(item.index)) {
            item.claimT = 0.4;
            this.onClaim(item.id);
          }
        } else if (this.ctx.weapons.pickup(item.index)) {
          const def = WEAPONS[item.index];
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
          // 点位上出的道具捡走即消失，本关不再补刷；丢下的枪捡走也永久消失
          item.dropped = false;
          if (this.onLocalPickup) this.onLocalPickup(item, item.index);
          this.notify();
        }
      }
    }
    // 开局刷出的道具被捡走后，按节拍补刷到其它还没用过的空点位；点位用尽后整关不再出新道具
    if (!this.shared && !this.finished && this.map) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = rand(SPAWN_MIN, SPAWN_MAX);
        if (!this.spawnRandom()) this.finished = true;
      }
    }
  }

  clear() {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
      this.items[i].group.visible = false;
      this.items[i].dropped = false;
      this.items[i].used = false;
    }
    this.spawnTimer = 0;
    this.finished = true;
  }
}
