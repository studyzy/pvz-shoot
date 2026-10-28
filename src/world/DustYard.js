import * as THREE from 'three';
import { toon, sandTexture, desertSkyTexture } from './materials.js';
import { rand, TAU } from '../utils.js';
import { FlowField } from './FlowField.js';

const HALF_X = 26.5;
const HALF_Z = 26.5;
const WALL_H = 5.2;
const DUST_COUNT = 220;

// 沙城：以 de_dust2 的动线为灵感重画的原创地图，不使用任何 Valve 资源。
// 南广场 → 三条通道（B 长廊 / 中门 / 长 A）→ 北横道转点 → A 点 / B 点 / CT 出生点。
export class DustYard {
  constructor(scene) {
    this.scene = scene;
    this.id = 'dust';
    this.name = '沙城';
    this.root = new THREE.Group();
    this.root.name = 'dustyard';
    this.root.visible = false;
    scene.add(this.root);
    this.bounds = { x: HALF_X, z: HALF_Z };
    this.spawn = { x: 0, z: 23.5, yaw: 0 };
    this.colliders = [];
    this.playerColliders = [];
    this.platforms = [];
    this.pickupSpots = [
      [-4.5, 19], [4.5, 19],
      [-3.2, 12.5], [-22.5, 9], [21, 12],
      [0, -9], [19, -16], [-19, -16],
    ];
    this.zombieSpawnPoints = [
      [-5, -21], [0, -24], [5, -21], [0, -17],
      [18, -24], [23, -14],
      [-18, -24], [-23, -14],
    ];
    this.time = 0;

    this.matWall = toon(0xd2ab73);
    this.matWallDark = toon(0xba8d59);
    this.matBase = toon(0x9c7346);
    this.matCap = toon(0xf9efd6);
    this.matWood = toon(0x9c6435);
    this.matDeck = toon(0xc59a68);
    this.matDeckTop = toon(0xe8d2a8);
    this.matDoor = toon(0x3f6b63);
    this.matRoof = toon(0xa85a40);
    this.matShutter = toon(0x4f7a78);

    this.build();
    this.nav = new FlowField(HALF_X, HALF_Z, 1);
    this.nav.blockPlatforms(this.platforms);
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  addPlatform(x, z, w, d, h) {
    this.platforms.push({ x, z, w, d, h });
  }

  // 僵尸用的圆形碰撞：沿盒体外沿铺一圈，圆心半径 0.85，间距 1.15，保证无缝。
  blockColliders(x, z, w, d) {
    const r = 0.68;
    const hw = Math.max(0, w / 2 - r);
    const hd = Math.max(0, d / 2 - r);
    if (hw === 0 && hd === 0) {
      this.addCollider(x, z, r);
      return;
    }
    if (hw === 0 || hd === 0) {
      const len = (hw === 0 ? hd : hw) * 2;
      const n = Math.max(1, Math.ceil(len / 1.1));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len / n) * i;
        this.addCollider(hw === 0 ? x : x + t, hw === 0 ? z + t : z, r);
      }
      return;
    }
    const nx = Math.max(1, Math.ceil((hw * 2) / 1.1));
    const nz = Math.max(1, Math.ceil((hd * 2) / 1.1));
    for (let i = 0; i <= nx; i++) {
      const px = x - hw + ((hw * 2) / nx) * i;
      this.addCollider(px, z - hd, r);
      this.addCollider(px, z + hd, r);
    }
    for (let i = 1; i < nz; i++) {
      const pz = z - hd + ((hd * 2) / nz) * i;
      this.addCollider(x - hw, pz, r);
      this.addCollider(x + hw, pz, r);
    }
  }

  // 实心体：盒子 + 顶盖，玩家靠 platforms 挡住，僵尸靠圆形碰撞绕行。
  solid(x, z, w, d, h, opts) {
    const o = opts || {};
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.mat || this.matWall);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);

    if (o.base) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.9, d + 0.12), this.matBase);
      base.position.set(x, 0.45, z);
      base.receiveShadow = true;
      this.root.add(base);
    }

    let top = h;
    if (o.cap !== false) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.22, 0.22, d + 0.22), this.matCap);
      cap.position.set(x, h + 0.11, z);
      cap.castShadow = true;
      cap.receiveShadow = true;
      this.root.add(cap);
      top = h + 0.22;
    }

    this.addPlatform(x, z, w, d, top);
    if (o.collide !== false) this.blockColliders(x, z, w, d);
    return top;
  }

  // 木箱：单个网格，靠深木色和沙墙拉开对比。
  crate(x, z, size, h) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), this.matWood);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);

    this.addPlatform(x, z, size, size, h);
    this.blockColliders(x, z, size, size);
  }

  // 门楣：只有视觉，不挡人不挡僵尸（门洞下方的地面必须保持可通行）。
  lintel(x, z, w, d, y0, h) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.matWall);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);

    // 底部一条深青绿色带，远处一眼能认出是门洞。
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.22, d + 0.08), this.matDoor);
    strip.position.set(x, y0 + 0.11, z);
    this.root.add(strip);
  }

  // 铁桶：挡人也挡僵尸，给空旷的点位一点高低变化。
  barrel(x, z, h) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, h, 10), this.matDoor);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);

    this.addPlatform(x, z, 0.9, 0.9, h);
    this.addCollider(x, z, 0.5);
  }

  // 布篷：贴在楼体上的彩色遮阳布，负责给沙墙加一点颜色。
  awning(x, z, w, mat, flip) {
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, w), mat);
    cloth.position.set(x, 3.1, z);
    cloth.castShadow = true;
    this.root.add(cloth);

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, w), mat);
    skirt.position.set(x + (flip ? -0.1 : 0.1), 2.85, z);
    this.root.add(skirt);
  }

  groundText(x, z, size, text, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = '900 132px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(text, 128, 132);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.set(-Math.PI / 2, 0, 0);
    plane.position.set(x, 0.02, z);
    this.root.add(plane);
  }

  build() {
    this.buildLights();
    this.buildGround();
    this.buildOuterWalls();
    this.buildBuildings();
    this.buildMid();
    this.buildLongA();
    this.buildBLane();
    this.buildSites();
    this.buildNorthBand();
    this.buildPlaza();
    this.buildDistant();
    this.buildDust();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xfff1d6, 0x9a7f52, 1.05);
    this.root.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d8, 2.5);
    sun.position.set(22, 30, 14);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 96;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.updateProjectionMatrix();
    this.root.add(sun);
    this.root.add(sun.target);

    const fill = new THREE.DirectionalLight(0xffd8a4, 0.45);
    fill.position.set(-20, 12, -18);
    this.root.add(fill);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshLambertMaterial({ map: sandTexture(), color: 0xf4e6c6 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  buildOuterWalls() {
    const walls = [
      { x: 0, z: -HALF_Z - 0.5, w: 2 * (HALF_X + 1), d: 1 },
      { x: 0, z: HALF_Z + 0.5, w: 2 * (HALF_X + 1), d: 1 },
      { x: -HALF_X - 0.5, z: 0, w: 1, d: 2 * (HALF_Z + 1) },
      { x: HALF_X + 0.5, z: 0, w: 1, d: 2 * (HALF_Z + 1) },
    ];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const body = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.d), this.matWallDark);
      body.position.set(w.x, WALL_H / 2, w.z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.24, 0.28, w.d + 0.24), this.matCap);
      cap.position.set(w.x, WALL_H + 0.14, w.z);
      cap.castShadow = true;
      this.root.add(cap);

      const base = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.12, 1.2, w.d + 0.12), this.matBase);
      base.position.set(w.x, 0.6, w.z);
      base.receiveShadow = true;
      this.root.add(base);
    }
  }

  // 南半场的两栋楼，把地图切成 B 长廊 / 中路 / 长 A 三条通道。
  buildBuildings() {
    this.solid(-13.25, 4, 13.5, 20, 4.6, { base: true, mat: this.matWall });
    this.solid(11.25, 4, 9.5, 20, 4.6, { base: true, mat: this.matWall });

    // 屋顶挑檐：从场内就能看到一点红瓦，和沙墙拉开层次。
    const roofs = [
      [-13.25, 4, 14.4, 21],
      [11.25, 4, 10.4, 21],
    ];
    for (let i = 0; i < roofs.length; i++) {
      const r = roofs[i];
      const roof = new THREE.Mesh(new THREE.BoxGeometry(r[2], 0.5, r[3]), this.matRoof);
      roof.position.set(r[0], 4.85, r[1]);
      roof.castShadow = true;
      this.root.add(roof);
    }
  }

  buildMid() {
    // 中门：两段墙夹出 3.8 米的门洞。
    this.solid(-4.2, 6, 4.6, 0.8, 3.6, { base: true, mat: this.matWall });
    this.solid(4.2, 6, 4.6, 0.8, 3.6, { base: true, mat: this.matWall });
    this.lintel(0, 6, 3.9, 0.8, 3.6, 0.9);

    this.crate(0, 10.5, 1.8, 0.9);
    this.barrel(-5.5, 3.4, 1.0);
    this.barrel(5.5, 3.4, 1.0);
    this.awning(-6.42, 3.6, 3.4, this.matShutter, false);
    this.awning(6.42, 8.4, 3.4, this.matRoof, true);
    this.solid(0, 0.5, 4.4, 0.8, 0.9, { mat: this.matWallDark, cap: false });
    this.crate(-4.9, -2.4, 1.6, 1.3);
    this.groundText(0, 13.5, 3.2, 'MID', 'rgba(120,88,44,0.55)');
  }

  buildLongA() {
    // 长 A 门：门洞 3 米，进门后是一段直通 A 点的开阔长走廊。
    this.solid(17.6, 8, 3.2, 0.8, 3.6, { base: true, mat: this.matWall });
    this.solid(24.65, 8, 3.7, 0.8, 3.6, { base: true, mat: this.matWall });
    this.lintel(21, 8, 3.6, 0.8, 3.6, 0.9);

    this.crate(24, 1.5, 2, 0.9);
    this.crate(18.2, -2.5, 1.6, 1.2);
    this.groundText(21.2, 12.5, 3.4, 'LONG', 'rgba(120,88,44,0.55)');
  }

  buildBLane() {
    // B 洞：西侧只留 3.5 米通道，是全场最窄的口子。
    this.solid(-25, 6, 3, 0.8, 3.6, { base: true, mat: this.matWall });
    this.lintel(-21.75, 6, 3.4, 0.8, 3.6, 0.9);

    this.crate(-21.5, 0.5, 1.8, 0.95);
    this.crate(-25, 11, 1.6, 1.2);
    this.groundText(-22.5, 12.5, 3.0, 'B', 'rgba(120,88,44,0.55)');
  }

  buildSites() {
    // A 点：东北角平台 + 台阶，玩家可以站上去换视角，僵尸只能从地面绕。
    this.solid(22.5, -21.5, 7, 7, 0.8, { mat: this.matDeck, cap: false });
    this.solid(22.5, -17.6, 7, 1.4, 0.4, { mat: this.matDeckTop, cap: false });
    this.crate(13.5, -18, 2.4, 1.5);
    this.crate(18.2, -22.5, 2, 0.95);
    this.barrel(12.8, -15.2, 1.0);
    this.barrel(25.4, -16.2, 0.9);
    this.groundText(17.5, -16.5, 3.0, 'A', 'rgba(176,72,44,0.5)');

    // B 点：镜像布局。
    this.solid(-22.5, -21.5, 7, 7, 0.8, { mat: this.matDeck, cap: false });
    this.solid(-22.5, -17.6, 7, 1.4, 0.4, { mat: this.matDeckTop, cap: false });
    this.crate(-13.5, -18, 2.4, 1.5);
    this.crate(-18.2, -22.5, 2, 0.95);
    this.barrel(-12.8, -15.2, 1.0);
    this.barrel(-25.4, -16.2, 0.9);
    this.groundText(-17.5, -16.5, 3.0, 'B', 'rgba(176,72,44,0.5)');

    // A / B 点与 CT 出生点之间的隔墙。
    this.solid(10, -19.25, 0.8, 14.5, 4, { mat: this.matWall });
    this.solid(-10, -19.25, 0.8, 14.5, 4, { mat: this.matWall });

    // 出生点前的掩体。
    this.crate(-6, -16.5, 2, 1.2);
    this.crate(6, -16.5, 2, 1.2);
    this.groundText(0, -20, 3.0, 'CT', 'rgba(120,88,44,0.5)');
  }

  // 北横道：三条线在这里汇合，是全场唯一的转点通道。
  buildNorthBand() {
    this.crate(-8, -9, 1.8, 1.0);
    this.crate(8, -9, 1.8, 1.0);
  }

  buildPlaza() {
    this.crate(-6.5, 19.5, 1.8, 0.95);
    this.crate(6.5, 19.5, 1.8, 0.95);
    this.barrel(-12.5, 22, 1.0);
    this.barrel(-11.4, 22.6, 0.9);
    this.barrel(12.5, 21.4, 1.0);
    this.groundText(0, 22, 3.4, 'T', 'rgba(120,88,44,0.45)');
  }

  buildDistant() {
    const matA = toon(0xcbab7c);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rand(-0.16, 0.16);
      const dist = rand(58, 88);
      const h = rand(12, 26);
      const r = rand(14, 26);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), matA);
      base.position.y = h / 2;
      g.add(base);
      g.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist);
      g.rotation.y = rand(0, TAU);
      this.root.add(g);
    }
  }

  buildDust() {
    const positions = new Float32Array(DUST_COUNT * 3);
    this.dustData = positions;
    this.dustSpeed = new Float32Array(DUST_COUNT);
    this.dustPhase = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3] = rand(-HALF_X, HALF_X);
      positions[i * 3 + 1] = rand(0.3, 6);
      positions[i * 3 + 2] = rand(-HALF_Z, HALF_Z);
      this.dustSpeed[i] = rand(0.15, 0.5);
      this.dustPhase[i] = rand(0, TAU);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustAttr = geo.attributes.position;
    const mat = new THREE.PointsMaterial({
      color: 0xfff0cf,
      size: 0.1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.root.add(points);
  }

  updateNav(player, dt) {
    this.nav.update(player.pos.x, player.pos.z, dt);
  }

  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  activate(scene) {
    scene.background = desertSkyTexture();
    scene.fog = new THREE.Fog(0xe8d6ac, 52, 156);
    this.root.visible = true;
  }

  menuCamera(camera, time) {
    const a = time * 0.05;
    camera.position.set(Math.cos(a) * 31, 27 + Math.sin(time * 0.17) * 0.3, Math.sin(a) * 31);
    camera.lookAt(0, 0.4, 0);
  }

  update(dt) {
    this.time += dt;
    const p = this.dustData;
    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      p[i3] += this.dustSpeed[i] * dt;
      p[i3 + 1] += Math.sin(this.time * 0.7 + this.dustPhase[i]) * dt * 0.2;
      if (p[i3] > HALF_X) p[i3] = -HALF_X;
      if (p[i3 + 1] < 0.2) p[i3 + 1] = 6;
    }
    this.dustAttr.needsUpdate = true;
  }
}
