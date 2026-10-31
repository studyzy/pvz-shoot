import * as THREE from 'three';
import { toon, snowTexture, snowSkyTexture, iceWallTexture } from './materials.js';
import { rand, TAU } from '../utils.js';
import { FlowField } from './FlowField.js';
import { PLAYER_PERCH } from '../config.js';

const SNOW_COUNT = 380;
const HALF_X = 17.6;
const HALF_Z = 20.8;
const WALL_H = 11.4;

// 雪地：按 CS 1.6 经典地图 fy_iceworld 的 1408 × 1664 单位比例复刻。
// 长方形雪坑、四块中冰、中央十字通道、两端基地与成排地面武器、四角砖台。
export class IceWorld {
  constructor(scene) {
    this.scene = scene;
    this.id = 'snow';
    this.name = '雪地';
    this.root = new THREE.Group();
    this.root.name = 'iceworld';
    this.root.visible = false;
    scene.add(this.root);
    this.bounds = { x: HALF_X, z: HALF_Z };
    this.spawn = { x: 0, z: 19.2, yaw: 0 };
    this.colliders = [];
    this.playerColliders = [];
    this.platforms = [];
    // 投掷物反弹用的真实几何体：OBB 盒 {x,y,z,hx,hy,hz,c,s} 与立地圆柱 {x,z,r,h}
    this.walls = [];
    this.pickupSpots = [
      [-11, 16.7], [-4, 16.7], [4, 16.7], [11, 16.7],
      [-11, -16.7], [-4, -16.7], [4, -16.7], [11, -16.7],
    ];
    this.zombieSpawnPoints = [
      [-1.5, -19.2], [1.5, -19.2], [-8, -19.0], [8, -19.0],
      [-12.2, -14.0], [12.2, -14.0], [0, -13.0], [0, -19.4],
    ];
    this.time = 0;
    this.build();
    this.nav = new FlowField(HALF_X, HALF_Z, 1);
    this.nav.blockPlatforms(this.platforms, PLAYER_PERCH);
  }

  updateNav(player, dt) {
    this.nav.update(player.pos.x, player.pos.z, dt);
  }

  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  activate(scene) {
    scene.background = snowSkyTexture();
    scene.fog = new THREE.Fog(0xe2f2ff, 45, 132);
    this.root.visible = true;
  }

  menuCamera(camera, time) {
    const a = time * 0.075;
    camera.position.set(Math.cos(a) * 14.5, 10 + Math.sin(time * 0.19) * 0.18, Math.sin(a) * 14.5);
    camera.lookAt(0, 1.0, 0);
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  addPlatform(x, z, w, d, h) {
    this.platforms.push({ x, z, w, d, h });
    // 每个平台都是实心方块，顺带登进反弹体（c=1, s=0）。
    this.walls.push({ x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, c: 1, s: 0 });
  }

  build() {
    this.buildLights();
    this.buildGround();
    this.buildWalls();
    this.buildPillars();
    this.buildLowWalls();
    this.buildBaseWalls();
    this.buildCornerPlatforms();
    this.buildBuyZone();
    this.buildMountains();
    this.buildSnowfall();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x93aecb, 1.1);
    this.root.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.35);
    sun.position.set(16, 30, 12);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.camera.updateProjectionMatrix();
    this.root.add(sun);
    this.root.add(sun.target);

    const fill = new THREE.DirectionalLight(0xa9cdf5, 0.5);
    fill.position.set(-18, 14, -20);
    this.root.add(fill);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ map: snowTexture(), color: 0xe9f5ff })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  buildWalls() {
    const wallMat = toon(0xffffff, { map: iceWallTexture() });
    const capMat = toon(0xffffff);
    const trimMat = toon(0x9fc6dd);
    const walls = [
      { x: 0, z: -HALF_Z - 0.45, w: 2 * (HALF_X + 0.9), d: 0.9 },
      { x: 0, z: HALF_Z + 0.45, w: 2 * (HALF_X + 0.9), d: 0.9 },
      { x: -HALF_X - 0.45, z: 0, w: 0.9, d: 2 * (HALF_Z + 0.9) },
      { x: HALF_X + 0.45, z: 0, w: 0.9, d: 2 * (HALF_Z + 0.9) },
    ];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const body = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.d), wallMat);
      body.position.set(w.x, WALL_H / 2, w.z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.34, w.d), trimMat);
      trim.position.set(w.x, 0.17, w.z);
      this.root.add(trim);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.26, 0.34, w.d + 0.26), capMat);
      cap.position.set(w.x, WALL_H + 0.17, w.z);
      cap.castShadow = true;
      this.root.add(cap);

      // 外墙自带顶盖，统一按 11.4 + 0.34 登记。
      this.walls.push({ x: w.x, y: (WALL_H + 0.34) / 2, z: w.z, hx: w.w / 2, hy: (WALL_H + 0.34) / 2, hz: w.d / 2, c: 1, s: 0 });
    }
  }

  buildPillars() {
    const bodyMat = toon(0xc9e7f6);
    const trimMat = toon(0x94c8e0);
    const capMat = toon(0xffffff);
    const h = 3.6;
    const size = 9;
    const centers = [
      [-6.5, -6.5],
      [6.5, -6.5],
      [-6.5, 6.5],
      [6.5, 6.5],
    ];

    for (let i = 0; i < centers.length; i++) {
      const x = centers[i][0];
      const z = centers[i][1];
      const body = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), bodyMat);
      body.position.set(x, h / 2, z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(size + 0.34, 0.32, size + 0.34), trimMat);
      trim.position.set(x, 0.16, z);
      this.root.add(trim);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.14, size + 0.2), capMat);
      cap.position.set(x, h + 0.07, z);
      cap.castShadow = true;
      this.root.add(cap);

      this.addPlatform(x, z, size, size, h + 0.14);
      for (let ox = -2.6; ox <= 2.6; ox += 2.6) {
        for (let oz = -2.6; oz <= 2.6; oz += 2.6) {
          this.addCollider(x + ox, z + oz, 2.6);
        }
      }
    }
  }

  buildLowWalls() {
    const bodyMat = toon(0xbfe3f5);
    const trimMat = toon(0x94c8e0);
    const capMat = toon(0xffffff);
    const h = 0.85;
    const sides = [-14.6, 14.6];
    for (let i = 0; i < sides.length; i++) {
      const x = sides[i];
      // 1.3 米宽：跳跃能上（顶面 0.92），但跑跳不会直接跨过去落到对面。
      // 1 米宽时一跳 3.4~3.6 米，人在弧顶就飞过整面墙了。
      const w = 1.3;
      const d = 28;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      body.position.set(x, h / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.16, d + 0.1), trimMat);
      trim.position.set(x, 0.08, 0);
      this.root.add(trim);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.08, d + 0.12), capMat);
      cap.position.set(x, h + 0.04, 0);
      this.root.add(cap);

      this.addPlatform(x, 0, w, d, h + 0.07);
      // 圆间距必须足够密，否则僵尸会从圆与圆之间的缝里穿过。
      const steps = Math.ceil(d / 0.85);
      for (let k = 0; k <= steps; k++) {
        this.addCollider(x, -d / 2 + (d / steps) * k, 0.6);
      }
    }
  }

  buildBaseWalls() {
    const bodyMat = toon(0xc7e7f8);
    const capMat = toon(0xffffff);
    const trimMat = toon(0x9fc6dd);

    // 两端的基地矮墙（贴着外墙），作为出生点的背墙。
    for (let i = 0; i < 2; i++) {
      const z = i === 0 ? -20.25 : 20.25;
      const w = 33.2;
      const d = 0.6;
      const h = 2.4;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      body.position.set(0, h / 2, z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.1, d + 0.12), capMat);
      cap.position.set(0, h + 0.03, z);
      this.root.add(cap);
      this.addPlatform(0, z, w, d, h + 0.08);
    }

    // 基地前的两段矮墙，中间留出直通对面基地的中央通道。
    const covers = [
      [-7.6, -14.6],
      [7.6, -14.6],
      [-7.6, 14.6],
      [7.6, 14.6],
    ];
    for (let i = 0; i < covers.length; i++) {
      const x = covers[i][0];
      const z = covers[i][1];
      const w = 5.6;
      const d = 0.6;
      const h = 2.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      body.position.set(x, h / 2, z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.16, d + 0.06), trimMat);
      trim.position.set(x, 0.08, z);
      this.root.add(trim);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.1, d + 0.12), capMat);
      cap.position.set(x, h + 0.03, z);
      this.root.add(cap);
      this.addPlatform(x, z, w, d, h + 0.08);
      // 基地高墙同样要连续碰撞，避免僵尸从缝隙穿过。
      const steps = Math.ceil(w / 0.85);
      for (let k = 0; k <= steps; k++) {
        this.addCollider(x - w / 2 + (w / steps) * k, z, 0.6);
      }
    }
  }

  buildCornerPlatforms() {
    const bodyMat = toon(0x5b6472);
    const topMat = toon(0xdfeefa);
    const spots = [
      [-13.9, -17.4],
      [13.9, -17.4],
      [-13.9, 17.4],
      [13.9, 17.4],
    ];
    for (let i = 0; i < spots.length; i++) {
      const x = spots[i][0];
      const z = spots[i][1];
      const w = 3.2;
      const d = 3.2;
      const h = 0.35;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      body.position.set(x, h / 2, z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.06, d + 0.08), topMat);
      top.position.set(x, h + 0.02, z);
      top.receiveShadow = true;
      this.root.add(top);
      this.addPlatform(x, z, w, d, h + 0.05);
    }
  }

  buildBuyZone() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(130,214,255,0.72)';
    ctx.lineWidth = 16;
    ctx.strokeRect(24, 24, 464, 464);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(150,226,255,0.62)';
    ctx.font = '900 82px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('BUY ZONE', 256, 228);
    ctx.font = '800 44px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('CENTER', 256, 308);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat);
    plane.rotation.set(-Math.PI / 2, 0, Math.PI);
    plane.position.y = 0.018;
    this.root.add(plane);
  }

  buildMountains() {
    const matA = toon(0xd9ecf9);
    const matB = toon(0xf4fbff);
    const count = 11;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rand(-0.12, 0.12);
      const dist = rand(56, 92);
      const h = rand(20, 36);
      const r = rand(16, 28);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), matA);
      base.position.y = h / 2;
      g.add(base);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.46, h * 0.4, 5), matB);
      cap.position.y = h * 0.8;
      g.add(cap);
      g.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist);
      g.rotation.y = rand(0, TAU);
      this.root.add(g);
    }
  }

  buildSnowfall() {
    const positions = new Float32Array(SNOW_COUNT * 3);
    this.snowSpeed = new Float32Array(SNOW_COUNT);
    this.snowPhase = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < SNOW_COUNT; i++) {
      positions[i * 3] = rand(-HALF_X, HALF_X);
      positions[i * 3 + 1] = rand(0, 15);
      positions[i * 3 + 2] = rand(-HALF_Z, HALF_Z);
      this.snowSpeed[i] = rand(1.5, 3.4);
      this.snowPhase[i] = rand(0, TAU);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snowData = positions;
    this.snowAttr = geo.attributes.position;
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.root.add(points);
  }

  update(dt) {
    this.time += dt;
    const p = this.snowData;
    for (let i = 0; i < SNOW_COUNT; i++) {
      const i3 = i * 3;
      p[i3 + 1] -= this.snowSpeed[i] * dt;
      p[i3] += Math.sin(this.time * 1.4 + this.snowPhase[i]) * dt * 0.5;
      if (p[i3 + 1] < 0.02) {
        p[i3] = rand(-HALF_X, HALF_X);
        p[i3 + 1] = rand(13, 16);
        p[i3 + 2] = rand(-HALF_Z, HALF_Z);
      }
    }
    this.snowAttr.needsUpdate = true;
  }
}
