import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, flat, carnivalFloorTexture, carnivalSkyTexture } from './materials.js';
import { FlowField } from './FlowField.js';
import { CLOUD, PLAYER_PERCH, WEAPONS } from '../config.js';

const TAU = Math.PI * 2;
const HALF = 36;

// Per-landmark/material batches retain useful culling without a draw call per ornament.
function part(group, mat, geometry, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  geometry.scale(...scale);
  geometry.rotateX(rot[0]);
  geometry.rotateY(rot[1]);
  geometry.rotateZ(rot[2]);
  geometry.translate(...pos);
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  geo.deleteAttribute('uv');
  const batches = group.userData.batches ||= new Map();
  if (!batches.has(mat)) batches.set(mat, []);
  batches.get(mat).push(geo);
  if (geo !== geometry) geometry.dispose();
}

function finish(group) {
  for (const [mat, geometries] of group.userData.batches) {
    group.add(new THREE.Mesh(mergeGeometries(geometries, false), mat));
    for (const geo of geometries) geo.dispose();
  }
  delete group.userData.batches;
}

function sphere() { return new THREE.SphereGeometry(1, 9, 6); }
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function ring(radius, tube = .09) { return new THREE.TorusGeometry(radius, tube, 4, 28); }

export class CloudCarnival {
  constructor(scene) {
    this.scene = scene;
    this.id = 'cloud';
    this.name = '云上发条游乐园';
    this.root = new THREE.Group();
    this.root.name = 'cloud-carnival';
    this.root.visible = false;
    scene.add(this.root);
    this.noShadows = true;
    this.bounds = { x: HALF, z: HALF };
    this.spawn = { x: 0, z: 28, yaw: 0 };
    this.platforms = [];
    this.colliders = [];
    this.playerColliders = [];
    this.walls = [];
    this.bells = [];
    this.time = 0;
    this.pickupSpots = [[0, 23], [0, 10], [-20, -8], [20, -8], [0, -24], [-23, 14], [23, 14], [-12, -19], [12, -19], [-14, 5]];
    this.initialPickupSpot = 0;
    const guns = WEAPONS.filter((w) => w.slot === 'gun').map((w) => w.id);
    const heavy = WEAPONS.filter((w) => w.slot === 'demo' || w.slot === 'grenade').map((w) => w.id);
    this.pickupPools = { 0: guns, 4: heavy, 5: heavy, 6: heavy, 8: heavy };
    this.openingSpawnPoints = [[-9, 12], [9, 14], [0, 8], [-18, 23], [16, 20]];
    this.zombieSpawnPoints = [[0, -29], [-29, -18], [29, -18], [-29, 2], [29, 2], [-29, 17], [29, 17], [-16, -25], [16, -25], [0, -10]];
    this.zombieSpawnGroups = { toy: this.zombieSpawnPoints };
    this.mats = {
      cream: toon(0xffefd4), wood: toon(0x9a6244), gold: toon(0xc68a3a),
      dark: toon(0x4c666b), coral: toon(0xd76c59), blue: toon(0x3d648c), mint: toon(0x79b5a4),
    };
    this.buildGround();
    this.buildClocktower();
    this.buildCarousel();
    this.buildBlocks();
    this.buildGarden();
    this.buildEntrance();
    this.buildWhale();
    this.buildBells();
    const sun = new THREE.DirectionalLight(0xffeedb, 1.8);
    sun.position.set(-24, 35, 22);
    this.root.add(sun, sun.target, new THREE.HemisphereLight(0xfff1db, 0x94765d, 1.4));
    this.nav = new FlowField(HALF, HALF);
    this.nav.blockPlatforms(this.platforms, PLAYER_PERCH);
  }

  landmark(name) {
    const group = new THREE.Group();
    group.name = name;
    this.root.add(group);
    return group;
  }

  // Axis-aligned silhouettes share exactly the same support, projectile and nav bounds.
  solid(group, mat, x, z, w, d, h) {
    part(group, mat, box(w, h, d), [x, h / 2, z]);
    this.platforms.push({ x, z, w, d, h });
    this.walls.push({ x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, c: 1, s: 0 });
    if (h <= PLAYER_PERCH) return;
    const r = Math.min(.55, w / 2, d / 2);
    const nx = Math.max(1, Math.ceil((w - r * 2) / .85));
    const nz = Math.max(1, Math.ceil((d - r * 2) / .85));
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        this.colliders.push({ x: x - w / 2 + r + (w - r * 2) * ix / nx, z: z - d / 2 + r + (d - r * 2) * iz / nz, r });
      }
    }
  }

  overhead(group, mat, x, y, z, w, h, d) {
    part(group, mat, box(w, h, d), [x, y, z]);
    this.walls.push({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, c: 1, s: 0 });
  }

  buildGround() {
    const { cream, gold, wood } = this.mats;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), toon(0xffffff, { map: carnivalFloorTexture() }));
    this.ground.rotation.x = -Math.PI / 2;
    this.root.add(this.ground);
    const stage = this.landmark('music-box-island');
    part(stage, wood, box(72, 1.6, 72), [0, -.85, 0]);
    for (const z of [-29, 29]) part(stage, cream, box(58, .014, 6), [0, .007, z]);
    for (const x of [-29, 29]) part(stage, cream, box(6, .014, 58), [x, .008, 0]);
    for (const r of [11.8, 12.1]) part(stage, gold, ring(r, .035), [0, .018, 0], [1, 1, .4], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      part(stage, gold, box(.16, .02, .55), [Math.sin(a) * 11.2, .02, Math.cos(a) * 11.2], [1, 1, 1], [0, a, 0]);
    }
    finish(stage);

    const posts = []; const rails = []; const caps = [];
    for (let v = -35; v <= 35; v += 2.5) {
      posts.push([v, .75, -35.5], [v, .75, 35.5], [-35.5, .75, v], [35.5, .75, v]);
      caps.push([v, 1.53, -35.5], [v, 1.53, 35.5], [-35.5, 1.53, v], [35.5, 1.53, v]);
    }
    const postMesh = new THREE.InstancedMesh(box(.16, 1.5, .16), wood, posts.length);
    const capMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.16, 7, 5), gold, caps.length);
    const transform = new THREE.Object3D();
    posts.forEach((p, i) => { transform.position.set(...p); transform.updateMatrix(); postMesh.setMatrixAt(i, transform.matrix); });
    caps.forEach((p, i) => { transform.position.set(...p); transform.updateMatrix(); capMesh.setMatrixAt(i, transform.matrix); });
    this.root.add(postMesh, capMesh);
    for (const z of [-35.5, 35.5]) rails.push([0, .5, z, 71, .12, .12], [0, 1.2, z, 71, .12, .12]);
    for (const x of [-35.5, 35.5]) rails.push([x, .5, 0, .12, .12, 71], [x, 1.2, 0, .12, .12, 71]);
    const border = this.landmark('island-balustrade');
    for (const [x, y, z, w, h, d] of rails) part(border, gold, box(w, h, d), [x, y, z]);
    finish(border);
    // The boundary is solid; low clouds are always outside the continuous walkable deck.
    for (const x of [-35.6, 35.6]) this.walls.push({ x, y: .8, z: 0, hx: .2, hy: .8, hz: 36, c: 1, s: 0 });
    for (const z of [-35.6, 35.6]) this.walls.push({ x: 0, y: .8, z, hx: 36, hy: .8, hz: .2, c: 1, s: 0 });
    const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 5), toon(0xffefd9), 72);
    clouds.name = 'cloud-sea';
    for (let i = 0; i < clouds.count; i++) {
      const a = i * 2.399963; const radius = 49 + (i % 3) * 15;
      transform.position.set(Math.cos(a) * radius, -5 - (i % 4) * 1.6, Math.sin(a) * radius);
      transform.scale.set(9 + i % 5, 2.2 + (i % 3) * .3, 6 + i % 4);
      transform.updateMatrix(); clouds.setMatrixAt(i, transform.matrix);
    }
    this.root.add(clouds);
  }

  buildClocktower() {
    const g = this.landmark('inverted-clocktower');
    const { cream, wood, gold, dark } = this.mats;
    for (const x of [-11, 11]) for (const z of [-11, 11]) {
      this.solid(g, wood, x, z, 1.4, 1.4, 13.4);
      part(g, gold, box(1.6, .25, 1.6), [x, .13, z]);
      part(g, gold, box(1.6, .35, 1.6), [x, 12.8, z]);
    }
    for (const z of [-11, 11]) this.overhead(g, cream, 0, 13.4, z, 23, .9, 1.5);
    for (const x of [-11, 11]) this.overhead(g, cream, x, 13.4, 0, 1.5, .9, 23);
    part(g, wood, new THREE.CylinderGeometry(8, 8, 3.8, 40), [0, 15.7, 0]);
    part(g, gold, new THREE.CylinderGeometry(8.25, 8.25, .3, 40), [0, 17.85, 0]);
    part(g, gold, ring(8, .18), [0, 13.85, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    part(g, cream, new THREE.CircleGeometry(7.85, 48), [0, 13.79, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    // The underside clock is legible from spawn; floating decoration is not a platform.
    this.walls.push({ x: 0, y: 15.7, z: 0, hx: 8, hy: 1.9, hz: 8, c: 1, s: 0 });
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      part(g, dark, box(.16, .08, .85), [Math.sin(a) * 6.9, 13.72, Math.cos(a) * 6.9], [1, 1, 1], [0, a, 0]);
      part(g, gold, box(.2, .5, .25), [Math.sin(a) * 8, 16.3, Math.cos(a) * 8], [1, 1, 1], [0, a, 0]);
    }
    part(g, dark, box(.28, .12, 5.8), [0, 13.67, -2.4]);
    part(g, gold, box(4.5, .13, .32), [1.8, 13.64, 0]);
    part(g, gold, sphere(), [0, 13.6, 0], [.45, .12, .45]);
    finish(g);
    this.gears = [];
    for (const [x, z, r] of [[-5, 4, 2.1], [4, -3, 2.7]]) {
      const gear = new THREE.Group();
      gear.position.set(x, 17.7, z);
      part(gear, gold, ring(r, .14), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 16; i++) {
        const a = i * TAU / 16;
        part(gear, gold, box(.3, .25, .6), [Math.sin(a) * r, 0, Math.cos(a) * r], [1, 1, 1], [0, a, 0]);
      }
      finish(gear); g.add(gear); this.gears.push(gear);
    }
  }

  buildCarousel() {
    const g = this.landmark('carousel-street');
    const { cream, coral, gold, wood, dark } = this.mats;
    // The carousel plinth is a walkable low deck (0.35 m), so it must not carry a collider:
    // solid() would round it into zombie obstacles and bury the whole street.
    part(g, cream, box(9, .35, 8), [-20, .175, -15]);
    this.platforms.push({ x: -20, z: -15, w: 9, d: 8, h: .35 });
    this.walls.push({ x: -20, y: .175, z: -15, hx: 4.5, hy: .175, hz: 4, c: 1, s: 0 });
    // Pole stands beyond the deck edge: the deck's centre cell has to stay walkable for zombies.
    this.solid(g, wood, -20, -19.6, 1.4, 1.4, 6.2);
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const x = -20 + Math.cos(a) * 3.2; const z = -15 + Math.sin(a) * 3.2;
      part(g, gold, new THREE.CylinderGeometry(.06, .06, 4.8, 6), [x, 2.8, z]);
      // Rocking horses: long body, bent neck, ears, four wooden legs, saddle and tail.
      part(g, cream, sphere(), [x, 1.55, z], [.65, .42, .28], [0, a, 0]);
      part(g, cream, sphere(), [x + Math.cos(a) * .6, 2, z + Math.sin(a) * .6], [.2, .58, .23], [0, a, -.35]);
      part(g, cream, sphere(), [x + Math.cos(a) * .78, 2.4, z + Math.sin(a) * .78], [.38, .2, .22], [0, a, 0]);
      part(g, coral, sphere(), [x, 1.82, z], [.3, .12, .3]);
      for (const dx of [-.4, .4]) for (const dz of [-.17, .17]) part(g, wood, box(.11, .52, .11), [x + dx, 1, z + dz]);
      part(g, dark, sphere(), [x + Math.cos(a) * .86, 2.47, z + .19], [.04, .04, .04]);
      part(g, cream, new THREE.ConeGeometry(.1, .3, 5), [x + Math.cos(a) * .65, 2.68, z]);
    }
    finish(g);
    this.carouselRoof = new THREE.Group();
    this.carouselRoof.position.set(-20, 5.8, -15);
    for (let i = 0; i < 12; i++) {
      const sector = new THREE.ConeGeometry(5.1, 2.2, 4, 1, false, i * TAU / 12, TAU / 12);
      part(this.carouselRoof, i % 2 ? cream : coral, sector, [0, 1.1, 0]);
      const a = i * TAU / 12;
      part(this.carouselRoof, coral, sphere(), [Math.sin(a) * 4.9, 0, Math.cos(a) * 4.9], [.5, .35, .5]);
    }
    part(this.carouselRoof, cream, new THREE.ConeGeometry(.25, 1.1, 8), [0, 2.65, 0]);
    finish(this.carouselRoof); g.add(this.carouselRoof);
    this.walls.push({ x: -20, y: 6.9, z: -15, hx: 5.1, hy: 1.1, hz: 5.1, c: 1, s: 0 });
  }

  buildBlocks() {
    const g = this.landmark('block-canyon');
    const { coral, blue, cream, gold } = this.mats;
    for (const [x, z, w, d, h, mat] of [[17, -16, 4, 4, 4.8, blue], [23, -16, 4, 4, 6.1, coral], [20, 0, 7, 4, 3.4, blue], [23, 20, 4, 5, 3.8, coral]]) {
      this.solid(g, mat, x, z, w, d, h);
      for (let i = 0; i < 3; i++) part(g, cream, new THREE.CylinderGeometry(.42, .42, .22, 10), [x - 1.2 + i * 1.2, h + .11, z]);
      part(g, gold, box(w + .05, .12, d + .05), [x, h - 1.15, z]);
    }
    this.overhead(g, cream, 20, 5.6, -16, 12, 1.2, 4.2);
    part(g, coral, new THREE.ConeGeometry(1.7, 1.4, 4), [23, 7, -16], [1, 1, 1], [0, Math.PI / 4, 0]);
    // Northern repair stalls flank an open central route rather than sealing it.
    for (const x of [-7.5, 7.5]) {
      this.solid(g, blue, x, -21, 5, 4, 3);
      part(g, cream, new THREE.ConeGeometry(3.6, 1.2, 4), [x, 3.6, -21], [1, 1, 1], [0, Math.PI / 4, 0]);
      part(g, gold, ring(.65), [x, 1.8, -18.98]);
    }
    finish(g);
  }

  buildGarden() {
    const g = this.landmark('teacup-garden');
    const { cream, mint, gold, wood, blue } = this.mats;
    // High ceramic vessels sit on solid plinths; no moveable/floating player support.
    for (const [x, z, size] of [[-17, 18, 2.8], [-24, 22, 1.8]]) {
      this.solid(g, mint, x, z, size * 1.8, size * 1.8, 2.2);
      // Tilt is baked into the vertices so both cups batch into the garden's own meshes
      // instead of costing five draw calls each.
      const tilt = [-.13, 0, 0];
      const at = (px, py, pz) => {
        const c = Math.cos(tilt[2]); const s = Math.sin(tilt[2]);
        return [px * c + py * s + x, -px * s + py * c + .2, pz + z];
      };
      const profile = [[.7, 0], [1.1, .8], [.98, 1.2], [.8, .2]].map(([r, y]) => new THREE.Vector2(r * size, y * size));
      part(g, cream, new THREE.LatheGeometry(profile, 14), at(0, 0, 0), [1, 1, 1], tilt);
      part(g, mint, ring(size * 1.06, .1), at(0, size * 1.2, 0), [1, 1, 1], [Math.PI / 2 + tilt[2], 0, 0]);
      part(g, gold, ring(size * .65, .15), at(size * 1.14, size * .55, 0), [1, 1, .7], [0, Math.PI / 2, tilt[2]]);
      part(g, wood, new THREE.CircleGeometry(size * .9, 24), at(0, size * 1.05, 0), [1, 1, 1], [-Math.PI / 2 + tilt[2], 0, 0]);
      for (let i = 0; i < 7; i++) {
        const a = i * TAU / 7;
        part(g, blue, sphere(), at(Math.sin(a) * size * 1.02, size * .7, Math.cos(a) * size * 1.02), [.13, .25, .13]);
      }
    }
    // Spoon trellis occupies the southern garden edge, not a combat corridor.
    for (const x of [-22, -12]) {
      this.solid(g, wood, x, 24, .9, .9, 5.5);
      part(g, cream, sphere(), [x, 5.7, 24], [.55, .9, .14]);
    }
    this.overhead(g, gold, -17, 4.9, 24, 11, .24, .25);
    for (const [x, z] of [[-12, 15], [-23, 10], [-9, 22]]) {
      this.solid(g, wood, x, z, 2.3, 2.3, .4);
      part(g, gold, new THREE.CylinderGeometry(1.12, 1.12, .06, 10), [x, .43, z]);
    }
    finish(g);
  }

  buildEntrance() {
    const g = this.landmark('cream-entry-arch');
    const { cream, coral, gold } = this.mats;
    for (const x of [-6, 6]) {
      this.solid(g, cream, x, 24, 1.4, 1.4, 5.6);
      part(g, gold, box(1.55, .18, 1.55), [x, 5.6, 24]);
    }
    this.overhead(g, cream, 0, 5.7, 24, 13.5, .9, 1.5);
    part(g, coral, ring(2.1, .18), [0, 5.7, 24.8], [1, .5, 1]);
    for (let i = 0; i < 9; i++) {
      const x = -5 + i * 1.25;
      part(g, coral, new THREE.ConeGeometry(.3, .8, 3), [x, 6.65 + .25 * Math.sin(i * .6), 24], [1, 1, .22], [0, 0, .08]);
    }
    finish(g);
  }

  buildWhale() {
    this.whale = this.landmark('clockwork-whale');
    const { wood, cream, gold, dark } = this.mats;
    part(this.whale, wood, sphere(), [0, 0, 0], [10, 3.2, 3.4]);
    part(this.whale, cream, sphere(), [1, -1.3, .3], [8.8, 1.7, 3.1]);
    part(this.whale, wood, sphere(), [-9, 1, 0], [3.8, .6, 1.5], [0, 0, -.45]);
    for (const z of [-1.8, 1.8]) part(this.whale, wood, sphere(), [-12, 2, z], [2.2, .5, 2.3], [.3, .3, -.3]);
    for (const z of [-3, 3]) part(this.whale, wood, sphere(), [0, -1, z], [3.1, .3, 1.8], [0, z * .12, .35]);
    part(this.whale, dark, sphere(), [6, .7, 2.8], [.23, .26, .12]);
    part(this.whale, dark, ring(3, .1), [6, -.3, 0], [1, .35, 1], [0, Math.PI / 2, .2]);
    for (let i = 0; i < 7; i++) {
      part(this.whale, gold, ring(.35, .12), [-5 + i * 1.6, -1.35, 2.9]);
      part(this.whale, cream, new THREE.CircleGeometry(.27, 10), [-5 + i * 1.6, -1.35, 2.92]);
    }
    part(this.whale, gold, ring(1.5, .15), [-3, 2.8, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    finish(this.whale);
    this.whale.position.set(11, 9, -60);
  }

  buildBells() {
    const { wood, gold, cream } = this.mats;
    for (const [id, [x, z]] of CLOUD.bell.positions.entries()) {
      const group = this.landmark('copper-bell-' + id);
      const pos = new THREE.Vector3(x, CLOUD.bell.y, z);
      const swing = new THREE.Group();
      swing.position.copy(pos).add(new THREE.Vector3(0, .65, 0));
      const profile = [[.17, 0], [.26, -.12], [.3, -.5], [.42, -.8], [CLOUD.bell.hitRadius, -1.08], [.5, -1.12], [.37, -.79], [.25, -.48]].map(([r, y]) => new THREE.Vector2(r, y));
      part(swing, gold, new THREE.LatheGeometry(profile, 20));
      part(swing, cream, sphere(), [0, -.91, 0], [.1, .12, .1]);
      finish(swing); group.add(swing);
      // The bell hangs off a wall bracket, not a floor post: the three bells sit on the
      // main ring and a standing post would plug the corridor it is meant to be shot over.
      const px = x + (CLOUD.bell.postOffset[0] || 0);
      const pz = z + (CLOUD.bell.postOffset[1] || 0);
      this.overhead(group, wood, px, 2.9, pz, .3, .3, .3);
      part(group, gold, box(.1, 1.0, .1), [px, 2.4, pz]);
      part(group, gold, ring(.8, .035), [x, .035, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
      finish(group);
      const ticks = new THREE.Group();
      for (let i = 0; i < 24; i++) {
        const a = i * TAU / 24;
        part(ticks, flat(0x6bbcb6), box(.045, .015, .18), [Math.sin(a), 0, Math.cos(a)], [1, 1, 1], [0, a, 0]);
      }
      // One shared local material per feedback mesh, with no lights or full-screen flash.
      const pieces = [...ticks.userData.batches.values()].flat();
      const geometry = mergeGeometries(pieces, false);
      for (const geo of pieces) geo.dispose();
      for (const mat of ticks.userData.batches.keys()) mat.dispose();
      const feedback = new THREE.Mesh(geometry, flat(0x6bbcb6, { transparent: true, opacity: 0, depthWrite: false }));
      feedback.position.set(x, .045, z); feedback.visible = false; group.add(feedback);
      this.bells.push({ id, pos, radius: CLOUD.bell.hitRadius, group, swing, ring: feedback, hitTime: 0, active: false });
    }
  }

  bellHit(id, active) {
    const bell = this.bells.find((b) => b.id === id);
    if (!bell) return false;
    bell.hitTime = 0;
    bell.active = active;
    bell.swinging = true;
    return true;
  }

  activate(scene, camera) {
    this.root.visible = true;
    scene.background = carnivalSkyTexture();
    scene.fog = new THREE.Fog(0xf6dfc5, 60, 155);
    if (camera) this.menuCamera(camera, 0);
  }

  menuCamera(camera, time) {
    const a = .78 + time * .035;
    camera.position.set(Math.sin(a) * 34, 10.5 + Math.sin(time * .16) * .5, Math.cos(a) * 34);
    camera.lookAt(0, 7.8, 0);
  }

  updateNav(player, dt) { this.nav.update(player.pos.x, player.pos.z, dt); }
  flowAt(x, z, out) { return this.nav.flowAt(x, z, out); }

  update(dt) {
    this.time += dt;
    this.carouselRoof.rotation.y = this.time * .055;
    this.gears.forEach((gear, i) => { gear.rotation.y = this.time * (i ? -.06 : .08); });
    this.whale.position.set(11 + Math.sin(this.time * .055) * 13, 9 + Math.sin(this.time * .18) * 1.3, -60);
    this.whale.rotation.z = Math.sin(this.time * .18) * .06;
    for (const bell of this.bells) {
      if (!bell.swinging) continue;
      bell.hitTime += dt;
      const t = bell.hitTime;
      bell.swing.rotation.z = t < 2.2 ? Math.sin(t * 15) * Math.exp(-t * 2.7) * (bell.active ? .28 : .12) : 0;
      const duration = CLOUD.bell.duration;
      bell.ring.visible = bell.active && t < duration;
      bell.ring.material.opacity = Math.min(1, t / .12, Math.max(0, (duration - t) / .18)) * .68;
      bell.ring.scale.setScalar(1 + Math.min(t / duration, 1) * 2.5);
      if (t >= 2.2) bell.swinging = false;
    }
  }
}
