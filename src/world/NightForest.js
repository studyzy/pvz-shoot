import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, nightSkyTexture, forestFloorTexture, moonPatchTexture, glowTexture } from './materials.js';
import { TAU } from '../utils.js';
import { FlowField } from './FlowField.js';

const HALF_X = 45;
const HALF_Z = 45;
const WALL_H = 7.5;
const FIREFLY_COUNT = 140;
const UP = new THREE.Vector3(0, 1, 0);

// TECH-flashlight.md 实测参数；灯和 target 归相机所有，由地图开关。
export const FLASH = {
  color: 0xffe8b0,
  intensity: 110,
  distance: 40,
  angle: Math.PI / 5,
  penumbra: 0.5,
  decay: 1.0,
  pos: [0, -0.1, 0],
  target: [0, -0.35, -3],
};

// 所有组合几何都在同一局部坐标系，实例只乘一次完整变换。
function merged(parts) {
  const flat = parts.map(g => g.index ? g.toNonIndexed() : g);
  const geometry = mergeGeometries(flat);
  for (const g of new Set([...parts, ...flat])) g.dispose();
  return geometry;
}

function limb(a, b, r0, r1 = r0) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const g = new THREE.CylinderGeometry(r1, r0, direction.length(), 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
  g.translate(...start.add(end).multiplyScalar(0.5).toArray());
  return g;
}

function crown(x, y, z, sx, sy, sz) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function leafGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -.18, .24, .04, -.12, .55, .12,
    0, 0, 0, -.12, .55, .12, .04, .27, .08,
    0, 0, 0, .03, .24, -.2, .12, .43, -.28,
    0, 0, 0, .12, .43, -.28, .18, .2, -.03,
    0, 0, 0, .16, .22, .12, .34, .4, .15,
    0, 0, 0, .34, .4, .15, .28, .18, -.01,
  ], 3));
  g.computeVertexNormals();
  return g;
}

export class NightForest {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    this.id = 'forest';
    this.name = '夜之森林';
    this.root = new THREE.Group();
    this.root.name = 'nightforest';
    this.root.visible = false;
    scene.add(this.root);
    this.noShadows = true;
    this.bounds = { x: HALF_X, z: HALF_Z };
    this.spawn = { x: 0, z: 30, yaw: 0 };
    this.aimDistance = 30;
    this.colliders = [];
    // 玩家直接使用圆形碰撞；不声明空 playerColliders。
    this.platforms = [];
    this.walls = [];
    this.landmarks = {};
    this.pickupSpots = [
      [0, 24], [0, 12], [-24, 0], [24, 0], [0, -24],
      [-18, -18], [18, -18], [-18, 18], [18, 18], [-32, -18],
    ];
    this.initialPickupSpot = 0;
    const ordinary = ['snow', 'repeater', 'threepeater', 'cactus', 'firepea'];
    const strong = ['cherry', 'cob', 'gatling', 'melon', 'jalapeno'];
    this.pickupPools = {
      0: ['snow', 'repeater', 'firepea'],
      1: ordinary, 2: ordinary, 3: ordinary, 4: ordinary,
      5: strong, 6: strong, 7: strong, 8: strong, 9: strong,
    };
    this.zombieSpawnGroups = {
      slime: [[-18, -18], [-14, -20], [-21, -15]],
      goblin: [[18, -18], [14, -20], [21, -15]],
      undead: [[-21, 16], [-18, 12], [-23, 20]],
      beast: [[21, 16], [18, 12], [23, 20]],
    };
    this.openingSpawnPoints = [[0, 12], [-2, 11], [2, 11], [-3, 10], [3, 10]];
    this.zombieSpawnPoints = [...Object.values(this.zombieSpawnGroups).flat(), [0, -34], [-34, 0], [34, 0]];
    this.protectedSpots = [...this.pickupSpots, ...this.zombieSpawnPoints, ...this.openingSpawnPoints, [0, 30]];
    this.time = 0;
    this.seed = 0x6d6f6f6e;
    this.matTrunk = toon(0x40352f);
    this.matLeafDark = toon(0x193b38);
    this.matLeafMid = toon(0x2c5546);
    this.matLeafWarm = toon(0x476546);
    this.matRock = toon(0x3b4d57);
    this.matStone = toon(0x697e80);
    this.matWood = toon(0x73543b);
    this.matBone = toon(0xb9bfad);
    this.matGlowGreen = toon(0x72b6a0, { emissive: 0x215b51, emissiveIntensity: .3 });
    this.matGlowBlue = toon(0x8dded1, { emissive: 0x397c79, emissiveIntensity: .65 });
    this.matGlowPurple = toon(0x94a6cd, { emissive: 0x434e82, emissiveIntensity: .4 });
    this.matGlowAmber = toon(0xf5be70, { emissive: 0xa56b26, emissiveIntensity: .8 });
    this.build();
    this.attachFlash(camera);
    this.nav = new FlowField(HALF_X, HALF_Z, 1);
    this.nav.blockCircles(this.colliders);
  }

  random(a = 0, b = 1) {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return a + (this.seed / 4294967296) * (b - a);
  }

  addInstanced(geo, mat, spots, parent = this.root, name = '') {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const [x, z, scale = 1, yaw = 0, y = 0] = spots[i];
      q.setFromAxisAngle(UP, yaw);
      p.set(x, y, z);
      s.setScalar(scale);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  }

  addProp(x, z, r, h = 1.4) {
    this.colliders.push({ x, z, r });
    this.walls.push({ x, z, r, h });
  }

  clearSpace(x, z, r = .5, pocket = false) {
    if (Math.abs(z) < 32 && Math.abs(x) - r < 4) return false;
    if (Math.abs(x) < 32 && Math.abs(z) - r < 4) return false;
    if (Math.abs(Math.max(Math.abs(x), Math.abs(z)) - 24) - r < 2.5) return false;
    for (const [px, pz] of this.protectedSpots) {
      if (Math.hypot(x - px, z - pz) < r + 2) return false;
    }
    if (pocket) {
      for (const [px, pz, lx, lz] of [[-18, -18, -32, -31], [18, -18, 33, -32], [-18, 18, -33, 31], [18, 18, 33, 32]]) {
        const dx = lx - px;
        const dz = lz - pz;
        const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(x - px - t * dx, z - pz - t * dz) < 3 + r) return false;
      }
      for (const [px, pz] of [[-32, -31], [33, -32], [-33, 31], [33, 32]]) {
        if (Math.hypot(x - px, z - pz) < 9 + r) return false;
      }
      for (const [px, pz] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) {
        if (Math.hypot(x - px, z - pz) < 8 + r) return false;
      }
    }
    return true;
  }

  landmark(name, x, z) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, 0, z);
    this.root.add(group);
    this.landmarks[name] = group;
    return group;
  }

  updateNav(player, dt) {
    this.nav.update(player.pos.x, player.pos.z, dt);
  }

  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  activate(scene, camera = null) {
    scene.background = nightSkyTexture();
    scene.fog = new THREE.Fog(0x101e2d, 18, 52);
    this.root.visible = true;
    this.attachFlash(camera || this.camera);
    this.setFlash(true);
  }

  menuCamera(camera, time) {
    const a = time * .045;
    camera.position.set(Math.sin(a) * 32, 19 + Math.sin(time * .2) * .4, Math.cos(a) * 38);
    camera.lookAt(0, 2, -3);
  }

  attachFlash(camera) {
    if (!camera) return null;
    if (this.flash && this.flash.parent === camera) return this.flash;
    if (this.flash) {
      this.flash.removeFromParent();
      this.flashTarget.removeFromParent();
    }
    const flash = new THREE.SpotLight(FLASH.color, FLASH.intensity, FLASH.distance, FLASH.angle, FLASH.penumbra, FLASH.decay);
    flash.castShadow = false;
    flash.position.set(...FLASH.pos);
    flash.visible = false;
    const target = new THREE.Object3D();
    target.position.set(...FLASH.target);
    flash.target = target;
    camera.add(flash, target);
    this.flash = flash;
    this.flashTarget = target;
    this.camera = camera;
    return flash;
  }

  setFlash(on) {
    if (this.flash) this.flash.visible = !!on;
  }

  build() {
    this.buildLights();
    this.buildGround();
    this.buildMoonGlade();
    this.buildTrees();
    this.buildUndergrowth();
    this.buildMushrooms();
    this.buildGraveyard();
    this.buildCamp();
    this.buildBeastDen();
    this.buildPathLamps();
    this.buildFireflies();
    this.buildBounds();
  }

  buildLights() {
    this.root.add(new THREE.HemisphereLight(0xa0beca, 0x304334, 1.65));
    const moon = new THREE.DirectionalLight(0xb6d3df, 1.8);
    moon.position.set(-28, 46, -34);
    this.root.add(moon, moon.target);
    const fill = new THREE.DirectionalLight(0x53768a, .55);
    fill.position.set(34, 18, 26);
    this.root.add(fill);
    this.groundGlow = new THREE.PointLight(0x8fd8cf, 2.2, 28, 1.4);
    this.groundGlow.position.set(0, 4, -4);
    this.root.add(this.groundGlow);
  }

  buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshLambertMaterial({ map: forestFloorTexture(), color: 0xb4c5b8 }));
    ground.rotation.x = -Math.PI / 2;
    this.root.add(ground);
    // 不规则、多尺度、软边遮罩；不画中央蓝圆盘。
    const patch = new THREE.PlaneGeometry(1, 1);
    patch.rotateX(-Math.PI / 2);
    const patchMat = new THREE.MeshBasicMaterial({
      color: 0x93bdb1, alphaMap: moonPatchTexture(), transparent: true, opacity: .19, depthWrite: false,
    });
    const patches = [[0, 0, 30, .3], [-4, 17, 16, .9], [5, -19, 16, -.4], [-18, 18, 14, .7], [18, -18, 14, 1.7]];
    this.addInstanced(patch, patchMat, patches.map(([x, z, s, yaw]) => [x, z, s, yaw, .015]), this.root, 'moon-patches');
  }

  buildMoonGlade() {
    const heart = this.landmark('moonheart', 0, -8);
    const wood = [];
    const foliage = [];
    for (const side of [-1, 1]) {
      wood.push(limb([side * 5.1, 0, 0], [side * 4.7, 2.7, -.2], .95, .65));
      wood.push(limb([side * 4.7, 2.7, -.2], [side * 2.5, 4.5, 0], .65, .35));
      wood.push(limb([side * 2.5, 4.5, 0], [0, 5.1, 0], .35, .25));
      wood.push(limb([side * 4.8, 2.5, 0], [side * 6.1, 4.1, -.3], .38, .1));
      for (const dz of [-1.1, 1.2]) wood.push(limb([side * 5.1, .65, 0], [side * 6.3, .12, dz], .4, .13));
      foliage.push(crown(side * 4.8, 4.7, -.5, 2.1, .95, 1.7));
      foliage.push(crown(side * 1.9, 5.1, -.4, 2.1, .75, 1.5));
      this.addProp(side * 5.1, -8, .98, 4.2);
    }
    const heartWood = this.matTrunk.clone();
    heartWood.color.setHex(0x66786a);
    heartWood.emissive.setHex(0x29463e);
    heartWood.emissiveIntensity = .2;
    const arch = new THREE.Mesh(merged(wood), heartWood);
    arch.name = 'moonheart-wood';
    heart.add(arch);
    heart.add(new THREE.Mesh(merged(foliage), this.matLeafMid));
    const veins = [];
    for (const side of [-1, 1]) {
      veins.push(limb([side * 5.1, .45, .7], [side * 4.7, 2.7, .5], .045));
      veins.push(limb([side * 4.7, 2.7, .5], [side * 2.5, 4.5, .3], .045));
      veins.push(limb([side * 2.5, 4.5, .3], [0, 5.05, .3], .045));
    }
    const runeMat = this.matGlowGreen.clone();
    runeMat.fog = false;
    const runes = new THREE.Mesh(merged(veins), runeMat);
    runes.name = 'moonheart-runes';
    heart.add(runes);
    // 中央吊晶留空通路，古树门廊而非一堵水晶墙。
    const crystal = new THREE.OctahedronGeometry(.8, 0);
    crystal.scale(.55, 1.25, .55);
    crystal.translate(0, 3.7, 0);
    const crystalMat = this.matGlowBlue.clone();
    crystalMat.fog = false;
    const pendant = new THREE.Mesh(crystal, crystalMat);
    pendant.name = 'moonheart-crystal';
    heart.add(pendant);
    heart.add(new THREE.Mesh(limb([0, 4.95, 0], [0, 4.65, 0], .06), this.matWood));
  }

  buildTrees() {
    const types = [[], [], []];
    this.treeSpots = [];
    // 内林以小簇组织，留出8m主径、5m环路与16m战斗袋。
    for (let i = 0; i < 420; i++) {
      const x = this.random(-42, 42);
      const z = this.random(-42, 42);
      const scale = this.random(.78, 1.25);
      const r = .62 * scale;
      if (Math.hypot(x, z) < 15 || !this.clearSpace(x, z, r, true)) continue;
      if (this.colliders.some(c => Math.hypot(c.x - x, c.z - z) < c.r + r + 1.25)) continue;
      const type = Math.floor(this.random(0, 3));
      types[type].push([x, z, scale, this.random(0, TAU)]);
      this.treeSpots.push([x, z, false]);
      this.addProp(x, z, r, 8 * scale);
    }
    // 方形边界外两层错列密林，遮住围挡，不出现规则盒形墙面。
    for (let side = 0; side < 4; side++) {
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 20; i++) {
          const along = -50 + i * 5.2 + row * 2.6 + this.random(-.8, .8);
          const outward = 46.5 + row * 4 + this.random(-.6, 1.4);
          const x = side < 2 ? along : (side === 2 ? -outward : outward);
          const z = side < 2 ? (side === 0 ? -outward : outward) : along;
          types[(side + row + i) % 3].push([x, z, this.random(1.1, 1.65), this.random(0, TAU)]);
          this.treeSpots.push([x, z, true]);
        }
      }
    }
    const oakWood = merged([
      limb([0, 0, 0], [.25, 4.5, 0], .62, .3),
      limb([.15, 2.8, 0], [-1.7, 5, .3], .3, .09),
      limb([.2, 3.2, 0], [1.6, 5.5, -.3], .3, .09),
      limb([0, .6, 0], [-1, .06, .45], .4, .1),
      limb([0, .6, 0], [1, .06, -.45], .4, .1),
    ]);
    const oakLeaf = merged([crown(-1.5, 5.3, .3, 2.3, 1.6, 2), crown(1.3, 5.7, -.3, 2.2, 1.8, 2), crown(0, 6.5, 0, 2, 1.5, 1.8)]);
    const firWood = merged([
      limb([0, 0, 0], [0, 7.1, 0], .45, .1),
      limb([0, 3.2, 0], [-1.5, 3.8, 0], .16, .03),
      limb([0, 4.1, 0], [1.2, 4.6, 0], .13, .03),
    ]);
    const firLeaf = merged([crown(0, 4.2, 0, 2, 1.3, 1.7), crown(0, 5.5, 0, 1.5, 1.4, 1.3), crown(0, 6.9, 0, .9, 1.7, .85)]);
    const willowWood = merged([
      limb([0, 0, 0], [-.35, 4.2, 0], .58, .3),
      limb([-.3, 3.2, 0], [-1.8, 4.4, .5], .28, .09),
      limb([-.3, 3.2, 0], [1.8, 4.8, -.4], .28, .09),
      limb([0, .5, 0], [1, .06, .4], .32, .1),
    ]);
    const willowLeaf = merged([crown(0, 5.1, 0, 2.8, 1, 2), crown(-2, 3.9, .4, .9, 1.5, 1.1), crown(2, 4.1, -.3, .9, 1.7, 1), crown(0, 3.6, -1.6, 1.2, 1.5, .75)]);
    this.treeArchetypes = [];
    const wood = [oakWood, firWood, willowWood];
    const leaf = [oakLeaf, firLeaf, willowLeaf];
    const mats = [this.matLeafMid, this.matLeafDark, this.matLeafWarm];
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      group.name = ['oak', 'fir', 'willow'][i];
      this.root.add(group);
      this.addInstanced(wood[i], this.matTrunk, types[i], group, 'trunks');
      this.addInstanced(leaf[i], mats[i], types[i], group, 'canopies');
      this.treeArchetypes.push(group);
    }
  }

  buildUndergrowth() {
    const leaves = [[], []];
    const stones = [];
    for (let i = 0; i < 110; i++) {
      const x = this.random(-42, 42);
      const z = this.random(-42, 42);
      if (Math.hypot(x, z) < 14 || !this.clearSpace(x, z, .9, true)) continue;
      for (let k = 0; k < 13; k++) {
        leaves[i % 2].push([x + this.random(-1.4, 1.4), z + this.random(-1.4, 1.4), this.random(.65, 1.25), this.random(0, TAU)]);
      }
      stones.push([x + 1, z - 1, this.random(.4, .8), this.random(0, TAU), .1]);
    }
    const leaf = leafGeometry();
    const mat = toon(0x54745a, { side: THREE.DoubleSide, emissive: 0x142d23, emissiveIntensity: .08 });
    this.addInstanced(leaf, mat, leaves[0], this.root, 'leaf-grass');
    this.addInstanced(leaf, this.matLeafMid, leaves[1], this.root, 'fern-grass');
    this.addInstanced(new THREE.DodecahedronGeometry(.45), this.matRock, stones);
  }

  buildMushrooms() {
    const group = this.landmark('mushrooms', -32, -31);
    const cap = new THREE.SphereGeometry(1, 12, 8, 0, TAU, 0, Math.PI / 2);
    cap.scale(1.6, .8, 1.6);
    cap.translate(0, 1.65, 0);
    const stem = limb([0, 0, 0], [.1, 1.7, 0], .25, .35);
    const big = [[0, 0, 1.2], [-3.9, -1, .9], [3.5, -3, 1.05]];
    this.addInstanced(cap, this.matGlowBlue, big, group, 'giant-caps');
    this.addInstanced(stem, this.matBone, big, group, 'giant-stems');
    const spots = [];
    for (const [x, z, s] of big) {
      this.addProp(x - 32, z - 31, .42 * s, 2.5 * s);
      for (let k = 0; k < 5; k++) {
        const a = k * TAU / 5;
        spots.push([x + Math.cos(a) * s, z + Math.sin(a) * s, s * .13, 0, s * 2.2]);
      }
    }
    this.addInstanced(new THREE.SphereGeometry(1, 6, 4), this.matBone, spots, group, 'cap-speckles');
    const small = [];
    for (let i = 0; i < 35; i++) {
      const x = this.random(-39, -28);
      const z = this.random(-40, -28);
      if (!this.clearSpace(x, z, .3)) continue;
      small.push([x + 32, z + 31, this.random(.18, .4), this.random(0, TAU)]);
    }
    const smallCap = new THREE.SphereGeometry(1, 6, 4, 0, TAU, 0, Math.PI / 2);
    smallCap.scale(1.6, .8, 1.6);
    smallCap.translate(0, 1.65, 0);
    this.addInstanced(smallCap, this.matGlowPurple, small, group, 'small-caps');
    this.addInstanced(stem, this.matBone, small, group, 'small-stems');
  }

  buildGraveyard() {
    const group = this.landmark('graveyard', -33, 31);
    const stone = [];
    for (const side of [-1, 1]) {
      const p = new THREE.BoxGeometry(.9, 3.2, .85);
      p.translate(side * 2.1, 1.6, 0);
      stone.push(p, crown(side * 2, 3.2, 0, .8, .7, .6));
      this.addProp(-33 + side * 2.1, 31, .65, 3.6);
    }
    // 石块依弧排列成残墓拱，中央开口可穿过。
    for (let i = 0; i < 7; i++) {
      const a = i / 6 * Math.PI;
      const block = new THREE.BoxGeometry(.85, .9, .85);
      block.rotateZ(a - Math.PI / 2);
      block.translate(Math.cos(a) * 2.1, 3.1 + Math.sin(a) * 1.35, 0);
      stone.push(block);
    }
    group.add(new THREE.Mesh(merged(stone), this.matStone));
    const graves = [];
    for (const [x, z] of [[-4, -3], [1, 4], [-5, 4], [4, 5], [-1, -4]]) {
      if (!this.clearSpace(x - 33, z + 31, .55)) continue;
      graves.push([x, z, 1, this.random(-.3, .3)]);
      this.addProp(x - 33, z + 31, .55, 1.3);
    }
    const slab = new THREE.BoxGeometry(.75, 1, .25);
    slab.translate(0, .5, 0);
    const top = crown(0, 1, 0, .38, .3, .14);
    this.addInstanced(merged([slab, top]), this.matRock, graves, group, 'headstones');
    const runes = merged([limb([-1.9, 2.9, .45], [-1.9, 3.4, .45], .045), limb([1.9, 2.9, .45], [1.9, 3.4, .45], .045)]);
    group.add(new THREE.Mesh(runes, this.matGlowPurple));
  }

  buildCamp() {
    const group = this.landmark('camp', 33, -32);
    // A形整帐：两幅顶布、封闭背布、入口分开的前帘，不再只有两根杆。
    const canvas = new THREE.BufferGeometry();
    canvas.setAttribute('position', new THREE.Float32BufferAttribute([
      -3,0,-3, 0,3.2,-3, -3,0,2, -3,0,2, 0,3.2,-3, 0,3.2,2,
      0,3.2,-3, 3,0,-3, 0,3.2,2, 0,3.2,2, 3,0,-3, 3,0,2,
      -3,0,-3, 3,0,-3, 0,3.2,-3,
      -3,0,2, 0,3.2,2, -1.1,0,2, 1.1,0,2, 0,3.2,2, 3,0,2,
    ], 3));
    canvas.computeVertexNormals();
    const cloth = toon(0xb28253, { side: THREE.DoubleSide });
    group.add(new THREE.Mesh(canvas, cloth));
    const beams = [limb([0, 3.2, -3.4], [0, 3.2, 2.4], .11)];
    for (const x of [-3, 3]) {
      beams.push(limb([x, 0, 2], [0, 3.3, 2], .1));
      for (const z of [-3, 2]) this.addProp(33 + x, -32 + z, .65, 3);
    }
    // 两侧布面用圆形碰撞/柱挡板近似，间隔不让怪穿过。
    for (const x of [-2, 0, 2]) this.addProp(33 + x, -35, .8, 3);
    for (const x of [-3, 3]) for (const z of [-1.5, 0]) this.addProp(33 + x, -32 + z, .75, 2.4);
    beams.push(limb([4.5, 0, 1], [4.5, 4.8, 1], .1));
    group.add(new THREE.Mesh(merged(beams), this.matWood));
    const flag = new THREE.BufferGeometry();
    flag.setAttribute('position', new THREE.Float32BufferAttribute([4.5,4.6,1, 6.6,4.3,1.1, 4.5,3.5,1, 4.5,3.5,1, 6.6,4.3,1.1, 6.1,3.45,1.2], 3));
    flag.computeVertexNormals();
    group.add(new THREE.Mesh(flag, toon(0x9d6455, { side: THREE.DoubleSide })));
    this.addProp(37.5, -31, .2, 4.8);
    const rocks = [];
    const logs = [];
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      rocks.push([Math.cos(a) * 1.15, 5 + Math.sin(a) * 1.15, .65, a, .17]);
    }
    for (let i = 0; i < 3; i++) logs.push(limb([-1, .2, 4.8 + i * .2], [1, .3, 5.3 - i * .2], .14));
    this.addInstanced(new THREE.DodecahedronGeometry(.38), this.matRock, rocks, group);
    group.add(new THREE.Mesh(merged(logs), this.matTrunk));
    // 合并几瓣火苗，暖光仅一盏。
    const flame = merged([crown(0, .7, 5, .5, .8, .4), crown(.25, .5, 5, .35, .55, .3)]);
    group.add(new THREE.Mesh(flame, this.matGlowAmber));
    this.fireLight = new THREE.PointLight(0xf4ae65, 3.3, 22, 1.5);
    this.fireLight.position.set(0, 2.2, 5);
    group.add(this.fireLight);
  }

  buildBeastDen() {
    const group = this.landmark('beastDen', 33, 32);
    const roots = [];
    const bones = [];
    for (const side of [-1, 1]) {
      roots.push(limb([side * 3.2, 0, 0], [side * 2, 2.6, -1], .75, .45));
      roots.push(limb([side * 2, 2.6, -1], [0, 3.5, -2], .45, .25));
      roots.push(limb([side * 3.2, .5, 0], [side * 4.5, .12, 2], .4, .12));
      this.addProp(33 + side * 3.2, 32, .8, 3.2);
    }
    // 几何骨肋形成兽巢轮廓，保留正面入口。
    for (let i = 0; i < 4; i++) {
      const z = -1 - i * .7;
      for (const side of [-1, 1]) {
        bones.push(limb([side * 2.5, .1, z], [side * 1.8, 1.6, z], .1));
        bones.push(limb([side * 1.8, 1.6, z], [side * .6, 2.3, z], .1, .07));
      }
    }
    roots.push(limb([-2, .3, -4], [2, .3, -4], .32));
    group.add(new THREE.Mesh(merged(roots), this.matTrunk));
    group.add(new THREE.Mesh(merged(bones), this.matBone));
    const skull = merged([crown(0, .5, 2.5, .65, .45, .55), limb([-.45, .55, 2.5], [-1.1, .9, 2.6], .16, .05), limb([.45, .55, 2.5], [1.1, .9, 2.6], .16, .05)]);
    group.add(new THREE.Mesh(skull, this.matBone));
    const eyes = new THREE.SphereGeometry(.1, 6, 4);
    this.addInstanced(eyes, this.matGlowAmber, [[-.25, 2.95, 1, 0, .58], [.25, 2.95, 1, 0, .58]], group);
  }

  buildPathLamps() {
    // 路肩而非路心；统一合并小型木提灯，光晕一个Points。
    const spots = [[-5.2, 28], [5.2, 17], [-5.2, -17], [5.2, -29], [-17, -5.2], [-29, 5.2], [17, 5.2], [29, -5.2]];
    const wood = merged([limb([0, 0, 0], [0, 1.8, 0], .1, .08), limb([0, 1.8, 0], [.45, 1.8, 0], .07), limb([.45, 1.8, 0], [.45, 1.55, 0], .035)]);
    const bulb = new THREE.BoxGeometry(.26, .36, .26);
    bulb.translate(.45, 1.4, 0);
    this.addInstanced(wood, this.matWood, spots);
    this.addInstanced(bulb, this.matGlowAmber, spots);
    const positions = [];
    for (const [x, z] of spots) {
      this.addProp(x, z, .16, 1.9);
      positions.push(x + .45, 1.4, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.lampGlows = new THREE.Points(geometry, new THREE.PointsMaterial({ map: glowTexture(), color: 0xf6c986, size: 1.2, transparent: true, opacity: .45, depthWrite: false }));
    this.root.add(this.lampGlows);
  }

  buildFireflies() {
    const clusters = [[-11, 11], [11, -11], [-32, -31], [33, -32], [-33, 31], [33, 32], [8, 24]];
    const pos = new Float32Array(FIREFLY_COUNT * 3);
    this.fireflyPhase = new Float32Array(FIREFLY_COUNT);
    this.fireflyBase = new Float32Array(FIREFLY_COUNT * 3);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const [x, z] = clusters[i % clusters.length];
      pos[i * 3] = x + this.random(-4, 4);
      pos[i * 3 + 1] = this.random(.8, 3);
      pos[i * 3 + 2] = z + this.random(-4, 4);
      this.fireflyPhase[i] = this.random(0, TAU);
    }
    this.fireflyBase.set(pos);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(geometry, new THREE.PointsMaterial({
      map: glowTexture(), color: 0xb9dfba, size: .24, opacity: .65,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.fireflies.frustumCulled = false;
    this.root.add(this.fireflies);
    this.fireflyPos = geometry.getAttribute('position');
  }

  buildBounds() {
    // 弹道围挡不可见；错列树根与低岩石组成有机林缘，不露出盒形墙。
    for (const [x, z, w, d] of [[0, -46, 94, 1], [0, 46, 94, 1], [-46, 0, 1, 94], [46, 0, 1, 94]]) {
      this.walls.push({ x, y: WALL_H / 2, z, hx: w / 2, hy: WALL_H / 2, hz: d / 2, c: 1, s: 0 });
    }
    const rocks = [];
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < 9; i++) {
        const along = -40 + i * 10 + this.random(-1.5, 1.5);
        const outward = this.random(46.8, 49);
        const x = side < 2 ? along : (side === 2 ? -outward : outward);
        const z = side < 2 ? (side === 0 ? -outward : outward) : along;
        rocks.push([x, z, this.random(.8, 1.4), this.random(0, TAU), .8]);
      }
    }
    const rock = new THREE.DodecahedronGeometry(1.2, 0);
    rock.scale(1.4, 1.1, 1);
    this.addInstanced(rock, this.matRock, rocks, this.root, 'forest-edge-rocks');
  }

  update(dt) {
    this.time += dt;
    const p = this.fireflyPos;
    const t = this.time;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ph = this.fireflyPhase[i];
      const i3 = i * 3;
      p.array[i3] = this.fireflyBase[i3] + Math.sin(t * .4 + ph) * .55;
      p.array[i3 + 1] = this.fireflyBase[i3 + 1] + Math.sin(t * .9 + ph * 2) * .3;
      p.array[i3 + 2] = this.fireflyBase[i3 + 2] + Math.cos(t * .35 + ph) * .55;
    }
    p.needsUpdate = true;
    this.lampGlows.material.opacity = .42 + Math.sin(t * 1.4) * .06;
    this.fireLight.intensity = 3.3 + Math.sin(t * 8.3) * .3 + Math.sin(t * 3.1) * .15;
    this.groundGlow.intensity = 2.2 + Math.sin(t * .7) * .1;
  }
}
