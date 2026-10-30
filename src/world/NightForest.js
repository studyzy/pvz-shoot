import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, nightSkyTexture, forestFloorTexture, glowTexture } from './materials.js';
import { rand, TAU } from '../utils.js';
import { FlowField } from './FlowField.js';

const HALF_X = 45;
const HALF_Z = 45;
const WALL_H = 7.5;
const FIREFLY_COUNT = 260;
const TREE_ROWS = 4;

// 手电参数（docs/technical/TECH-flashlight.md §3.2 的实测曲线）：
// 110 强度时近处地面亮度 6 → ~40，再高（200 → 55）就把"夜"洗成"黄昏"。
export const FLASH = {
  color: 0xffe8b0, // 暖白，和冷蓝月光（0xa9c4ff）拉开冷暖对比
  intensity: 110,
  distance: 40, // 与雾的 far = 38 对齐：再远也被雾吃掉
  angle: Math.PI / 5, // 36°，比俯仰极限宽，扫视时边缘不卡顿
  penumbra: 0.5,
  decay: 1.0, // 物理衰减是 2；这里要"看得远"，用 1
  pos: [0, -0.1, 0], // 相机子节点：灯就在眼睛位置略下方
  target: [0, -0.35, -3], // target 必须下移，光斑才会落在脚下（0，-1 只照远处）
};

// 夜之森林：90 × 90 米的奇幻夜间森林。
// 动线是「中央月光空地 + 四片族群领地 + 四条主径」，每片领地住一个族群：
//   A 菌菇林（史莱姆）  B 哥布林营地（哥布林/小恶魔）
//   C 古墓（亡灵）      D 野兽巢穴（狼/蜘蛛/老鼠）
// 所有可站立平台都必须 ≤ 0.6 米且不挂 colliders —— 僵尸不会跳，站高处就是无敌点。
// 树干登记成圆柱挡板，否则豌豆会直接穿过树。
export class NightForest {
  constructor(scene, camera = null) {
    this.scene = scene;
    // 相机会在 activate(camera) 时补上（createMaps 已经传了，这里留个兜底给单测/图鉴）
    this.camera = camera;
    this.id = 'forest';
    this.name = '夜之森林';
    this.root = new THREE.Group();
    this.root.name = 'nightforest';
    this.root.visible = false;
    scene.add(this.root);

    // 整图不开实时投影（Game.setMap 读这个开关），夜景用雾 + 自发光撑氛围
    this.noShadows = true;
    this.bounds = { x: HALF_X, z: HALF_Z };
    // 出生点在南侧营地，面向 -Z（北），正对着中央月光空地
    this.spawn = { x: 0, z: 40, yaw: 0 };
    this.colliders = [];
    // 不声明 playerColliders：这张图没有 platforms，树干/灯杆的圆形 collider 就是玩家碰撞的唯一来源。
    // （Player 里 `playerColliders || colliders` 的 `[]` 是真值，写了空表等于关掉整张图的玩家碰撞，
    // 表现是整片树林直接穿过去。雪地/沙城才需要空表——它们把玩家碰撞交给 platforms、碰撞圆只给僵尸用。）
    this.platforms = [];
    // 投掷物挡板：OBB 盒 {x,y,z,hx,hy,hz,c,s} 与立地圆柱 {x,z,r,h}
    this.walls = [];

    // 道具点位：南营地 2 个、四条主径各 1 个、四片领地各 1 个。间距都 > 2.9 米（两个拾取半径）。
    this.pickupSpots = [
      [-6, 36], [6, 36],
      [0, 20], [-20, 0], [20, 0], [0, -20],
      [-28, -26], [24, -24], [-26, 20], [26, 24],
    ];

    // 刷怪点：四片领地的外缘，离出生点 (0,40) 都 > 40 米，玩家有反应时间。
    this.zombieSpawnPoints = [
      [-28, -26], [-20, -30], [-34, -18],
      [24, -24], [30, -16], [18, -30],
      [-26, 20], [-32, 12], [-18, 26],
      [26, 24], [32, 16], [18, 27],
      [0, -36], [-36, 0], [36, 0],
    ];

    this.pickupSpots = this.pickupSpots.slice(0, 10);
    this.time = 0;

    // 配色：深绿打底，靠发光物件提亮，避免整图发灰
    this.matTrunk = toon(0x3a2b1c);
    this.matLeafDark = toon(0x1b3a1e);
    this.matLeafMid = toon(0x24502a);
    this.matLeafWarm = toon(0x2f5c30);
    this.matRock = toon(0x3a3f44);
    this.matStone = toon(0x4a5058);
    this.matWood = toon(0x4a3520);
    this.matGlowGreen = toon(0x6cff9e, { emissive: 0x2faa5c, emissiveIntensity: 0.9 });
    this.matGlowBlue = toon(0x7fd8ff, { emissive: 0x2f7fb0, emissiveIntensity: 0.9 });
    this.matGlowPurple = toon(0xc98cff, { emissive: 0x7a3fb0, emissiveIntensity: 0.85 });
    this.matGlowAmber = toon(0xffd98a, { emissive: 0xb07a20, emissiveIntensity: 0.9 });

    this.build();
    this.attachFlash(camera);
    this.nav = new FlowField(HALF_X, HALF_Z, 1);
    this.nav.blockPlatforms(this.platforms);
  }

  addInstanced(geo, mat, spots, yOff = 0, flat = false) {
    if (!spots.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const [x, z, s = 1] = spots[i];
      if (flat) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));
      else q.identity();
      v.set(x, yOff, z);
      sc.setScalar(s);
      m.compose(v, q, sc);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    this.root.add(im);
    return im;
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  addPlatform(x, z, w, d, h) {
    this.platforms.push({ x, z, w, d, h });
    this.walls.push({ x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, c: 1, s: 0 });
  }

  // 树干：立地圆柱挡板（投掷物）+ 僵尸圆形碰撞。r 是树干半径。
  addTrunk(x, z, r) {
    this.walls.push({ x, z, r, h: WALL_H });
    this.addCollider(x, z, r + 0.12);
  }

  // 有实体的装饰件（蘑菇/栅栏桩/倒木/灯杆）：碰撞球必须配一个反弹体，
  // 否则契约测试会判「碰撞球附近没有任何反弹体」，实际表现是豌豆直接穿过。
  addProp(x, z, r, h = 1.4) {
    this.walls.push({ x, z, r, h });
    this.addCollider(x, z, r);
  }

  // 道具点位不能被装饰物压住：玩家要能站进去踩到它。
  // 装饰是随机撒的，所以生成时就得让开，别等测试发现再去补救。
  clearOfPickups(x, z, pad = 1.6) {
    for (let i = 0; i < this.pickupSpots.length; i++) {
      const [px, pz] = this.pickupSpots[i];
      if (Math.hypot(x - px, z - pz) < pad) return false;
    }
    return true;
  }

  updateNav(player, dt) {
    this.nav.update(player.pos.x, player.pos.z, dt);
  }

  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  activate(scene, camera = null) {
    scene.background = nightSkyTexture();
    // 夜里可视距离短：近 14 米清晰、38 米完全没入黑暗，走廊感靠这个撑起来。
    scene.fog = new THREE.Fog(0x0a1226, 14, 38);
    this.root.visible = true;
    this.attachFlash(camera || this.camera);
    this.setFlash(true);
  }

  menuCamera(camera, time) {
    const a = time * 0.045;
    camera.position.set(Math.cos(a) * 40, 26 + Math.sin(time * 0.2) * 0.4, Math.sin(a) * 40);
    camera.lookAt(0, 1.5, 0);
  }

  // ── 手电（TECH-flashlight.md）：跟相机走的 SpotLight，不投影 ──
  // 挂 scene 会残留到别的图（切图靠 root.visible）；挂 root 又不会跟相机。
  // 所以挂相机、由本图持有引用，用 setFlash() 按地图开关。
  attachFlash(camera) {
    if (!camera) return null;
    if (this.flash && this.flash.parent === camera) return this.flash;
    const flash = new THREE.SpotLight(
      FLASH.color,
      FLASH.intensity,
      FLASH.distance,
      FLASH.angle,
      FLASH.penumbra,
      FLASH.decay
    );
    // 承重墙：本图不开投影（noShadows），灯也不能把 shadow pass 带回来
    flash.castShadow = false;
    flash.position.set(...FLASH.pos);
    flash.visible = false;
    // 照射方向由 target 的世界坐标决定：只挂灯不挂 target，灯会一直朝世界的 -Z 打
    const target = new THREE.Object3D();
    target.position.set(...FLASH.target);
    flash.target = target;
    camera.add(flash);
    camera.add(target);
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

  // ── 光照：月光为主，无实时投影（本图关掉 shadowMap，省整个 shadow pass）──
  buildLights() {
    const hemi = new THREE.HemisphereLight(0x4d6fa8, 0x0e1a12, 1.35);
    this.root.add(hemi);

    // 月光：冷蓝、低角度，方向光不投影（投影在 Game 里按地图关掉）
    const moon = new THREE.DirectionalLight(0xa9c4ff, 1.55);
    moon.position.set(-28, 46, -34);
    moon.target.position.set(0, 0, 0);
    this.root.add(moon);
    this.root.add(moon.target);

    // 月光空地的一盏暖色补光（不投影），让中央区域和四周拉开
    this.groundGlow = new THREE.PointLight(0x8fd8ff, 1.05, 34, 1.6);
    this.groundGlow.position.set(0, 5.5, 0);
    this.root.add(this.groundGlow);

    // 远处剪影：东侧一层极暗的补光，避免整片死黑
    const fill = new THREE.DirectionalLight(0x35507f, 0.5);
    fill.position.set(34, 18, 26);
    this.root.add(fill);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_X * 2 + 40, HALF_Z * 2 + 40),
      new THREE.MeshLambertMaterial({ map: forestFloorTexture(), color: 0x9fb89a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  // 中央月光空地：唯一常亮区，也是出生点正对的视觉锚
  buildMoonGlade() {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(15, 40),
      new THREE.MeshBasicMaterial({ color: 0x2c4a72, transparent: true, opacity: 0.55 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    this.root.add(disc);

    // 空地边缘一圈发光水晶：按材质分 2 个 InstancedMesh，不逐颗建 mesh
    const geoCrystal = new THREE.ConeGeometry(0.38, 1.2, 4);
    geoCrystal.translate(0, 0.6, 0);
    const blueList = [];
    const purpleList = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const r = 13.5 + rand(-0.6, 0.6);
      const h = rand(0.8, 1.9);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.clearOfPickups(x, z, 1.5)) continue;
      (i % 3 === 0 ? purpleList : blueList).push([x, z, h / 1.2]);
      this.addCollider(x, z, 0.42);
      this.walls.push({ x, z, r: 0.42, h: h + 0.4 });
    }
    this.addInstanced(geoCrystal, this.matGlowBlue, blueList);
    this.addInstanced(geoCrystal, this.matGlowPurple, purpleList);
  }

  // 树：先合并成一个几何，再按色分成 3 个 InstancedMesh（每组 1 draw call）。
  buildTrees() {
    const spots = [];
    // 沿四条主径两侧推开，避免把通道堵死
    const lanes = [
      { axis: 'z', from: -42, to: 42, x: 0 },
    ];
    for (let i = 0; i < 150; i++) {
      const x = rand(-HALF_X + 3, HALF_X - 3);
      const z = rand(-HALF_Z + 3, HALF_Z - 3);
      // 中央空地里不长树
      if (Math.hypot(x, z) < 17) continue;
      // 四条主径（宽 8 米）保持通畅
      if (Math.abs(x) < 5 && Math.abs(z) < HALF_Z - 2) continue;
      if (Math.abs(z) < 5 && Math.abs(x) < HALF_X - 2) continue;
      // 出生点周围留空
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 7) continue;
      if (!this.clearOfPickups(x, z, 2.2)) continue;
      spots.push([x, z]);
    }
    // 外圈密林：只做视觉遮挡，不可达
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * TAU + rand(-0.03, 0.03);
      const r = rand(HALF_X - 1.5, HALF_X + 12);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < HALF_X && Math.abs(z) < HALF_Z) continue;
      spots.push([x, z, true]);
    }
    this.treeSpots = spots;

    const trunkGeo = new THREE.CylinderGeometry(0.34, 0.52, 5.2, 6);
    trunkGeo.translate(0, 2.6, 0);

    // 三档树冠尺寸，做出层次
    const tiers = [
      { geo: new THREE.IcosahedronGeometry(2.5, 1), mat: this.matLeafDark, y: 5.4, n: 0 },
      { geo: new THREE.IcosahedronGeometry(1.9, 1), mat: this.matLeafMid, y: 6.6, n: 0 },
      { geo: new THREE.IcosahedronGeometry(1.3, 1), mat: this.matLeafWarm, y: 7.6, n: 0 },
    ];

    // 树干全部一个 InstancedMesh
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, this.matTrunk, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const [x, z, outer] = spots[i];
      const scale = outer ? rand(1.15, 1.6) : rand(0.8, 1.3);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));
      v.set(x, 0, z);
      s.setScalar(scale);
      m.compose(v, q, s);
      trunkMesh.setMatrixAt(i, m);
      if (outer) continue;
      this.addTrunk(x, z, 0.52 * scale);
      // 每棵树随机选一档树冠实例
      const t = tiers[(Math.random() * tiers.length) | 0];
      t.n++;
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.castShadow = false;
    this.root.add(trunkMesh);
    this.trunkMesh = trunkMesh;

    // 树冠：每种材质一个 InstancedMesh，位置和对应树干一致
    const counts = { 0: 0, 1: 0, 2: 0 };
    const assign = [];
    for (let i = 0; i < spots.length; i++) {
      const pick = (Math.random() * 3) | 0;
      assign.push(pick);
      counts[pick]++;
    }
    this.canopyMeshes = [];
    for (let t = 0; t < 3; t++) {
      if (counts[t] === 0) continue;
      const im = new THREE.InstancedMesh(tiers[t].geo, tiers[t].mat, counts[t]);
      let k = 0;
      for (let i = 0; i < spots.length; i++) {
        if (assign[i] !== t) continue;
        const [x, z, outer] = spots[i];
        const scale = outer ? rand(1.15, 1.6) : rand(0.8, 1.3);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));
        v.set(x, tiers[t].y * scale, z);
        s.setScalar(scale);
        m.compose(v, q, s);
        im.setMatrixAt(k++, m);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      this.root.add(im);
      this.canopyMeshes.push(im);
    }
  }

  // 灌木 / 草：2 组 InstancedMesh
  buildUndergrowth() {
    const bushGeo = new THREE.IcosahedronGeometry(0.75, 0);
    const bushMat = toon(0x1e3a1c);
    const bushSpots = [];
    for (let i = 0; i < 220; i++) {
      const x = rand(-HALF_X + 2, HALF_X - 2);
      const z = rand(-HALF_Z + 2, HALF_Z - 2);
      if (Math.hypot(x, z) < 16) continue;
      bushSpots.push([x, z]);
    }
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushSpots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < bushSpots.length; i++) {
      const [x, z] = bushSpots[i];
      const sc = rand(0.6, 1.25);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));
      v.set(x, sc * 0.4, z);
      s.set(sc, sc * 0.7, sc);
      m.compose(v, q, s);
      bushes.setMatrixAt(i, m);
    }
    bushes.instanceMatrix.needsUpdate = true;
    this.root.add(bushes);

    // 发光草：细长的小锥体，散在空地边缘与主径旁，夜里全靠它给「地面有光」
    const grassGeo = new THREE.ConeGeometry(0.08, 0.7, 3);
    grassGeo.translate(0, 0.35, 0);
    const glowGrass = new THREE.InstancedMesh(grassGeo, this.matGlowGreen, 320);
    let k = 0;
    for (let i = 0; i < 320; i++) {
      const a = rand(0, TAU);
      const r = Math.sqrt(Math.random()) * (HALF_X - 6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x, z) < 15) continue;
      const sc = rand(0.7, 1.5);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));
      v.set(x, 0, z);
      s.setScalar(sc);
      m.compose(v, q, s);
      glowGrass.setMatrixAt(k++, m);
    }
    glowGrass.count = k;
    glowGrass.instanceMatrix.needsUpdate = true;
    this.root.add(glowGrass);
  }

  // A 菌菇林：史莱姆领地，发光蘑菇当地标
  buildMushrooms() {
    const cx = -28;
    const cz = -26;
    const capGeo = new THREE.SphereGeometry(0.55, 10, 6, 0, TAU, 0, Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.14, 0.6, 6);
    stemGeo.translate(0, 0.3, 0);

    const caps = [];
    const stems = [];
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU);
      const r = rand(1.5, 13);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const sc = rand(0.55, 1.7);
      if (!this.clearOfPickups(x, z, 1.5)) continue;
      caps.push([x, z, sc]);
      stems.push([x, z, sc]);
      this.addProp(x, z, 0.3 * sc, 0.6 * sc + 0.5);
    }
    const capMat = this.matGlowBlue;
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, caps.length);
    const stemMesh = new THREE.InstancedMesh(stemGeo, toon(0xd8dfe6), stems.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < caps.length; i++) {
      const [x, z, sc] = caps[i];
      q.identity();
      v.set(x, 0.6 * sc, z);
      s.setScalar(sc);
      m.compose(v, q, s);
      capMesh.setMatrixAt(i, m);
      v.set(x, 0, z);
      m.compose(v, q, s);
      stemMesh.setMatrixAt(i, m);
    }
    capMesh.instanceMatrix.needsUpdate = true;
    stemMesh.instanceMatrix.needsUpdate = true;
    this.root.add(capMesh);
    this.root.add(stemMesh);

    // 菌菇林的柔和环境光
    const glow = new THREE.PointLight(0x4fa8e8, 1.6, 26, 1.8);
    glow.position.set(cx, 3.2, cz);
    this.root.add(glow);
  }

  // C 古墓：亡灵领地，墓碑+断裂石棺
  buildGraveyard() {
    const cx = -26;
    const cz = 20;
    const graveGeo = new THREE.BoxGeometry(0.85, 1.35, 0.24);
    graveGeo.translate(0, 0.675, 0);
    const headGeo = new THREE.SphereGeometry(0.43, 8, 6, 0, TAU, 0, Math.PI / 2);
    headGeo.translate(0, 1.35, 0);
    const merged = mergeGeometries([graveGeo, headGeo]);

    const spots = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        if (Math.random() < 0.22) continue;
        const x = cx - 10 + col * 4 + rand(-0.5, 0.5);
        const z = cz - 8 + row * 4 + rand(-0.4, 0.4);
        if (!this.clearOfPickups(x, z, 1.5)) continue;
        spots.push([x, z]);
      }
    }
    const im = new THREE.InstancedMesh(merged, this.matStone, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const [x, z] = spots[i];
      const sc = rand(0.85, 1.25);
      const tilt = rand(-0.12, 0.12);
      q.setFromEuler(new THREE.Euler(tilt, rand(0, TAU), rand(-0.08, 0.08)));
      v.set(x, 0, z);
      s.setScalar(sc);
      m.compose(v, q, s);
      im.setMatrixAt(i, m);
      this.addCollider(x, z, 0.5 * sc);
      this.walls.push({ x, y: 0.7, z, hx: 0.45 * sc, hy: 0.7 * sc, hz: 0.14 * sc, c: 1, s: 0 });
    }
    im.instanceMatrix.needsUpdate = true;
    this.root.add(im);

    // 古墓的幽灵灯：紫色冷光
    const glow = new THREE.PointLight(0x9a5cff, 1.5, 26, 1.8);
    glow.position.set(cx, 3.5, cz);
    this.root.add(glow);
  }

  // B 哥布林营地：篝火 + 木栅栏 + 帐篷骨架
  buildCamp() {
    const cx = 24;
    const cz = -24;
    // 篝火：石圈 + 暖色发光
    const stoneGeo = new THREE.DodecahedronGeometry(0.32, 0);
    const stoneSpots = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const x = cx + Math.cos(a) * 1.5;
      const z = cz + Math.sin(a) * 1.5;
      if (!this.clearOfPickups(x, z, 1.5)) continue;
      stoneSpots.push([x, z, 1]);
      this.addProp(x, z, 0.34, 0.5);
    }
    this.addInstanced(stoneGeo, this.matRock, stoneSpots, 0.16);
    // 火堆本体（发光锥）
    const fireGeo = new THREE.ConeGeometry(0.65, 1.4, 6);
    fireGeo.translate(0, 0.7, 0);
    this.addInstanced(fireGeo, this.matGlowAmber, [[cx, cz, 1]]);
    const fireLight = new THREE.PointLight(0xffa542, 2.4, 20, 1.7);
    fireLight.position.set(cx, 1.6, cz);
    this.root.add(fireLight);
    this.fireLight = fireLight;

    // 栅栏：三面围出营地的走向，各登记盒体挡板
    const postGeo = new THREE.BoxGeometry(0.16, 1.5, 0.16);
    postGeo.translate(0, 0.75, 0);
    const posts = [];
    for (let i = 0; i < 14; i++) {
      posts.push([cx - 8 + i * 1.2, cz - 7]);
      posts.push([cx + 8, cz - 7 + i * 1.0]);
    }
    const postMesh = new THREE.InstancedMesh(postGeo, this.matWood, posts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < posts.length; i++) {
      const [x, z] = posts[i];
      if (!this.clearOfPickups(x, z, 1.5)) continue;
      q.identity();
      v.set(x, 0, z);
      m.compose(v, q, s);
      postMesh.setMatrixAt(i, m);
      this.addProp(x, z, 0.22, 1.5);
    }
    postMesh.instanceMatrix.needsUpdate = true;
    this.root.add(postMesh);

    // 帐篷骨架：两根斜梁
    const beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.4, 5);
    this.addInstanced(beamGeo, this.matWood, [[cx - 4.5, cz + 4, 1], [cx + 4.5, cz + 4, 1]], 1.5);
    this.addProp(cx - 4.5, cz + 4, 0.24, 3.2);
    this.addProp(cx + 4.5, cz + 4, 0.24, 3.2);
  }

  // D 野兽巢穴：倒木 + 兽骨堆，低矮，不挡视线
  buildBeastDen() {
    const cx = 26;
    const cz = 24;
    // 倒木：横躺的圆柱，只当装饰（高度低于 0.6，不入 platforms 也不挡僵尸）
    const logGeo = new THREE.CylinderGeometry(0.38, 0.38, 5, 7);
    logGeo.rotateZ(Math.PI / 2);
    logGeo.translate(0, 0.38, 0);
    const logSpots = [];
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU);
      const r = rand(2, 9);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!this.clearOfPickups(x, z, 1.8)) continue;
      logSpots.push([x, z, rand(0.7, 1.4)]);
      this.addProp(x, z, 0.5, 0.8);
    }
    this.addInstanced(logGeo, this.matTrunk, logSpots, 0, true);
    // 兽骨堆：几个发光小锥代表骨骸
    const boneGeo = new THREE.ConeGeometry(0.12, 0.9, 4);
    boneGeo.translate(0, 0.45, 0);
    const bones = new THREE.InstancedMesh(boneGeo, toon(0xcfd6dd), 22);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < 22; i++) {
      const a = rand(0, TAU);
      const r = rand(1, 10);
      q.setFromEuler(new THREE.Euler(rand(-0.4, 0.4), rand(0, TAU), rand(-0.4, 0.4)));
      v.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      s.setScalar(rand(0.7, 1.3));
      m.compose(v, q, s);
      bones.setMatrixAt(i, m);
    }
    bones.instanceMatrix.needsUpdate = true;
    this.root.add(bones);

    const glow = new THREE.PointLight(0xff7a4f, 1.1, 22, 1.9);
    glow.position.set(cx, 2.4, cz);
    this.root.add(glow);
  }

  // 主径上的提灯：给玩家「这条路能走」的隐性引导
  buildPathLamps() {
    this.lamps = [];
    const spots = [
      [0, 28], [0, 12], [0, -12], [0, -28],
      [-14, 0], [-30, 0], [14, 0], [30, 0],
    ];
    const glowTex = glowTexture();
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 2.6, 6);
    poleGeo.translate(0, 1.3, 0);
    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 6);
    bulbGeo.translate(0, 2.7, 0);
    const poleSpots = [];
    const bulbSpots = [];
    for (const [x, z] of spots) {
      poleSpots.push([x, z, 1]);
      bulbSpots.push([x, z, 1]);
      this.addProp(x, z, 0.22, 2.8);
      const bulb = null;
      // 光晕精灵（比真实点光源便宜得多）
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: 0xffc46b, transparent: true, depthWrite: false, opacity: 0.75 })
      );
      sprite.position.set(x, 2.7, z);
      sprite.scale.setScalar(2.6);
      this.root.add(sprite);
      this.lamps.push({ x, z, sprite });
    }
    this.addInstanced(poleGeo, this.matWood, poleSpots);
    this.addInstanced(bulbGeo, this.matGlowAmber, bulbSpots);
  }

  // 萤火虫：一个 Points，260 只会缓慢游动
  buildFireflies() {
    const pos = new Float32Array(FIREFLY_COUNT * 3);
    this.fireflyPhase = new Float32Array(FIREFLY_COUNT);
    this.fireflyBase = new Float32Array(FIREFLY_COUNT * 3);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const a = rand(0, TAU);
      const r = Math.sqrt(Math.random()) * (HALF_X - 4);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = rand(0.7, 4.2);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      this.fireflyBase[i * 3] = x;
      this.fireflyBase[i * 3 + 1] = y;
      this.fireflyBase[i * 3 + 2] = z;
      this.fireflyPhase[i] = rand(0, TAU);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xd8ff9e,
      size: 0.5,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.fireflies = new THREE.Points(geo, mat);
    this.fireflies.frustumCulled = false;
    this.root.add(this.fireflies);
    this.fireflyPos = geo.getAttribute('position');
  }

  // 外圈树墙：只挡住视线和物理边界，不参与导航
  buildBounds() {
    // 四面墙合并成一个几何再建一次 mesh：4 个 draw call 压到 1 个
    const edges = [
      { x: 0, z: -HALF_Z - 0.6, w: HALF_X * 2 + 4, d: 1.2 },
      { x: 0, z: HALF_Z + 0.6, w: HALF_X * 2 + 4, d: 1.2 },
      { x: -HALF_X - 0.6, z: 0, w: 1.2, d: HALF_Z * 2 + 4 },
      { x: HALF_X + 0.6, z: 0, w: 1.2, d: HALF_Z * 2 + 4 },
    ];
    const parts = edges.map((e) => {
      const g = new THREE.BoxGeometry(e.w, WALL_H, e.d);
      g.translate(e.x, WALL_H / 2, e.z);
      return g;
    });
    const merged = mergeGeometries(parts);
    this.root.add(new THREE.Mesh(merged, this.matLeafDark));
  }

  update(dt) {
    this.time += dt;
    // 萤火虫缓慢绕圈 + 上下浮动
    const p = this.fireflyPos;
    const t = this.time;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ph = this.fireflyPhase[i];
      const i3 = i * 3;
      p.array[i3] = this.fireflyBase[i3] + Math.sin(t * 0.4 + ph) * 0.9;
      p.array[i3 + 1] = this.fireflyBase[i3 + 1] + Math.sin(t * 0.9 + ph * 2) * 0.45;
      p.array[i3 + 2] = this.fireflyBase[i3 + 2] + Math.cos(t * 0.35 + ph) * 0.9;
    }
    p.needsUpdate = true;

    // 提灯呼吸 + 篝火闪烁
    const pulse = 0.72 + Math.sin(t * 2.1) * 0.13;
    for (let i = 0; i < this.lamps.length; i++) {
      this.lamps[i].sprite.material.opacity = pulse;
    }
    if (this.fireLight) {
      this.fireLight.intensity = 2.1 + Math.sin(t * 9.3) * 0.5 + Math.sin(t * 3.1) * 0.25;
    }
    if (this.groundGlow) {
      this.groundGlow.intensity = 0.95 + Math.sin(t * 1.3) * 0.12;
    }
  }
}