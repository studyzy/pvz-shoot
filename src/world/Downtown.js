import * as THREE from 'three';
import { toon, glassTexture, asphaltTexture, duskSkyTexture, plazaTexture } from './materials.js';
import { rand, TAU } from '../utils.js';
import { FlowField } from './FlowField.js';
import { PLAYER_PERCH } from '../config.js';

const HALF = 45;
const WALL_H = 5.2;
const MOTE_COUNT = 120;

// 摩天街区：黄昏 CBD 的十字大道攻防（docs/FPS-MAPS-RESEARCH-city.md §5）。
// 90×90 场地：NS 主街 x∈[-7,7] 与 EW 横街 z∈[-7,7] 全场贯通，夹出中央广场；
// 双塔楼峡是主刷怪轴，天桥 1.9 米高线串起 NE 商场裙台 ↔ 工地板台，NW 停车楼是 0.95 级三级跳链。
// 高线的真实制约（定稿，research §5.7「克制机制」）：不是气球——气球 airHeight=2.2 恒高、
// 咬合需与脚底 dy≥1.6，站上 1.9/2.85 平台后 dy<1.6 咬不到，「气球垂直压制高线」是假命题；
// 真正的代价是阳光经济（击杀掉落全在地面、18s TTL，蹲楼顶等于断收入）+ 台缘四面暴露。
// 所有可站平台的顶面都按任务定稿取整（裙台/天桥/板台 1.9、停车楼 0.95/1.9/2.85），
// 因此这里的 solid() 不再加顶盖（cap），高度即平台顶面。
export class Downtown {
  constructor(scene) {
    this.scene = scene;
    this.id = 'downtown';
    this.name = '摩天街区';
    this.root = new THREE.Group();
    this.root.name = 'downtown';
    this.root.visible = false;
    scene.add(this.root);
    this.bounds = { x: HALF, z: HALF };
    this.spawn = { x: 0, z: 34, yaw: 0 };
    this.colliders = [];
    // 玩家只吃这一组圆形碰撞（照雪地/沙城惯例 platforms 管墙体）；
    // buildRing 会把 24 根灯柱圆补进来——灯柱是细柱，平台推挤区盖不住，玩家不能穿柱。
    this.playerColliders = [];
    this.platforms = [];
    // 投掷物反弹用的真实几何体：OBB 盒 {x,y,z,hx,hy,hz,c,s} 与立地圆柱 {x,z,r,h}
    this.walls = [];
    this.pickupSpots = [
      [-8, 30], [8, 30],
      [0, 9], [-26, 0], [34, 0],
      [0, -33], [-19, -19], [26, 19],
    ];
    // 主 5（楼峡一线，横向铺开拉纵深）/ 侧 3（东西横街口 + 商场北侧口）/ 远 2（西北/东北环角）
    this.zombieSpawnPoints = [
      [0, -43], [-6, -41], [6, -41], [-4, -37], [4, -39],
      [-41, 0], [41, 0], [26, -39],
      [-41, -30], [41, -30],
    ];
    // 首波教学：只从楼峡一线出（主向可读）
    this.openingSpawnPoints = [[0, -40], [-3, -41], [3, -41], [0, -36]];
    this.time = 0;

    // 配色四色系：暮紫天空 + 暖橙窗光 + 混凝土灰 + 沥青深灰
    this.matConcrete = toon(0x8f8a7e);
    this.matConcreteDark = toon(0x655f58);
    this.matDeck = toon(0x7a7468);
    this.matCrate = toon(0xa8763e);
    this.matPlanter = toon(0x5f6b52);
    this.matGreen = toon(0x556b3a);
    this.matWreck = toon(0x4a4440);
    this.matAccent = toon(0xd8a02a);
    // 玻璃幕墙：贴图同时做 map 与 emissiveMap，亮窗格自发光（黄昏塔窗的灵魂）。
    // 窗光色 0xffe6c8（视觉评审 B 白炽边 + 终轮亮度收敛再去饱和）：亮窗读作
    // 「办公室白炽灯」而不是霓虹；强度基线 0.5 由 update() 的闪烁公式接管。
    this.matGlass = new THREE.MeshStandardMaterial({
      map: glassTexture(),
      emissiveMap: glassTexture(),
      emissive: 0xffe6c8,
      emissiveIntensity: 0.5,
      roughness: 0.5,
      metalness: 0.15,
    });

    this.build();
    this.nav = new FlowField(HALF, HALF, 1);
    this.nav.blockPlatforms(this.platforms, PLAYER_PERCH);
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  addPlatform(x, z, w, d, h) {
    this.platforms.push({ x, z, w, d, h });
    // 平台都是轴对齐盒体，顺带登进反弹体。
    this.walls.push({ x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, c: 1, s: 0 });
  }

  // 僵尸用的圆形碰撞：沿盒体外沿铺一圈，圆半径 0.68，间距 1.1，保证无缝（照沙城）。
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

  // 实心体：从地面起算的盒体，玩家靠 platforms 挡住/承载，僵尸靠圆形碰撞绕行。
  solid(x, z, w, d, h, opts) {
    const o = opts || {};
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.mat || this.matConcrete);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);
    this.addPlatform(x, z, w, d, h);
    if (o.collide !== false) this.blockColliders(x, z, w, d);
    return h;
  }

  // 悬空板（天桥/引桥）：厚 0.3、板面 1.9。只登记 platform + walls 反弹体，
  // 不铺僵尸碰撞圆——板底 1.6 米悬空，桥下地面僵尸照常走（流场会绕开脚印）。
  plate(x, z, w, d) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), this.matDeck);
    mesh.position.set(x, 1.75, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.platforms.push({ x, z, w, d, h: 1.9 });
    this.walls.push({ x, y: 1.75, z, hx: w / 2, hy: 0.15, hz: d / 2, c: 1, s: 0 });
  }

  // 0.4 米视觉栏板：collide:false（不挡人、不挡僵尸），只登记 walls 让投掷物弹回。
  // len 是栏板长度，axis='z' 表示栏板沿 z 向铺（立在东西两侧）。
  railPair(cx, cz, len, width, axis) {
    for (const s of [-1, 1]) {
      const off = (width / 2 - 0.06) * s;
      const w = axis === 'z' ? 0.08 : len;
      const d = axis === 'z' ? len : 0.08;
      const x = axis === 'z' ? cx + off : cx;
      const z = axis === 'z' ? cz : cz + off;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), this.matConcreteDark);
      rail.position.set(x, 2.1, z);
      rail.castShadow = true;
      this.root.add(rail);
      this.walls.push({ x, y: 2.1, z, hx: w / 2, hy: 0.2, hz: d / 2, c: 1, s: 0 });
    }
  }

  // 木箱/花坛/毁车：单个网格 + platform + 圆碰撞（照沙城 crate）。
  crate(x, z, size, h, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat || this.matCrate);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);
    this.addPlatform(x, z, size, size, h);
    this.blockColliders(x, z, size, size);
  }

  // 台沿矮墙：贴在平台顶面四周的视觉护栏，不挡人不挡僵尸，只登记 walls。
  parapet(x, z, w, d, base) {
    const t = 0.15;
    const hh = 0.4;
    const strips = [
      { x, z: z - d / 2 + t / 2, w, d: t },
      { x, z: z + d / 2 - t / 2, w, d: t },
      { x: x - w / 2 + t / 2, z, w: t, d: d - 2 * t },
      { x: x + w / 2 - t / 2, z, w: t, d: d - 2 * t },
    ];
    for (const s of strips) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, hh, s.d), this.matConcreteDark);
      m.position.set(s.x, base + hh / 2, s.z);
      m.castShadow = true;
      this.root.add(m);
      this.walls.push({ x: s.x, y: base + hh / 2, z: s.z, hx: s.w / 2, hy: hh / 2, hz: s.d / 2, c: 1, s: 0 });
    }
  }

  // 地面导语：纯装饰（无碰撞，不进 platforms/colliders/walls）。y 可选：铺在台面上的
  // 导语（高线入口/桥面）抬到台面 +0.02，默认贴地 0.02 防 z-fight。
  groundText(x, z, size, text, color, y = 0.02) {
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
    plane.position.set(x, y, z);
    this.root.add(plane);
  }

  build() {
    this.buildLights();
    this.buildGround();
    this.buildOuterWalls();
    this.buildCanyon();
    this.buildNE();
    this.buildBridge();
    this.buildNW();
    this.buildSW();
    this.buildSE();
    this.buildPlaza();
    this.buildBunkers();
    this.buildWestFacade();
    this.buildRing();
    this.buildDistant();
    this.buildMotes();
    this.buildText();
  }

  buildLights() {
    // 终轮亮度收敛：hemi 是唯一能照进塔身背光面/阴影地面的环境光，0.6→1.3、
    // 地面色 0x2e2440→0x5e577a、天空色去饱和到 0xffbe9a——垂直面吃一半 ground 色，
    // 原值让背光塔面整片近黑；天空去饱和把暖橙占比压回 8% 以内。
    const hemi = new THREE.HemisphereLight(0xffbe9a, 0x5e577a, 1.3);
    this.root.add(hemi);

    // 低角度暖光主光：黄昏太阳压在西天上。0xffa060→0xffe2c4 两轮去饱和（视觉评审 A
    // + 终轮亮度收敛）：提亮的同时把暖橙像素占比压回 3~8% 窄带，混凝土/沥青的蓝灰可读。
    const sun = new THREE.DirectionalLight(0xffe2c4, 2.1);
    sun.position.set(-40, 18, 20);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.updateProjectionMatrix();
    this.root.add(sun);
    this.root.add(sun.target);

    // 冷蓝补光：从东面把背光面托起来，避免整个场子闷成一片。
    // 强度 0.5 → 1.2（视觉评审 A）→ 3.0（终轮亮度收敛）：冷光补暗面抬亮度，
    // 不占暖橙预算——菜单/游戏帧的中性灰占比因此回到 40%+。
    const fill = new THREE.DirectionalLight(0x4a6a9a, 3.0);
    fill.position.set(30, 26, -30);
    this.root.add(fill);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshLambertMaterial({ map: asphaltTexture() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  buildOuterWalls() {
    const walls = [
      { x: 0, z: -HALF - 0.5, w: 2 * (HALF + 1), d: 1 },
      { x: 0, z: HALF + 0.5, w: 2 * (HALF + 1), d: 1 },
      { x: -HALF - 0.5, z: 0, w: 1, d: 2 * (HALF + 1) },
      { x: HALF + 0.5, z: 0, w: 1, d: 2 * (HALF + 1) },
    ];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const body = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.d), this.matConcreteDark);
      body.position.set(w.x, WALL_H / 2, w.z);
      body.castShadow = true;
      body.receiveShadow = true;
      this.root.add(body);
      this.walls.push({ x: w.x, y: WALL_H / 2, z: w.z, hx: w.w / 2, hy: WALL_H / 2, hz: w.d / 2, c: 1, s: 0 });

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.24, 0.28, w.d + 0.24), this.matConcrete);
      cap.position.set(w.x, WALL_H + 0.14, w.z);
      cap.castShadow = true;
      this.root.add(cap);

      const base = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.12, 1.2, w.d + 0.12), this.matConcrete);
      base.position.set(w.x, 0.6, w.z);
      base.receiveShadow = true;
      this.root.add(base);
    }
  }

  // 双塔楼峡：两栋 18 米玻璃塔夹出 14 米主街，塔基各留一座 0.95 裙台当掩体/跳板。
  buildCanyon() {
    for (const sx of [-11, 11]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 18, 8), this.matGlass);
      tower.position.set(sx, 9, -26);
      tower.castShadow = true;
      tower.receiveShadow = true;
      this.root.add(tower);
      this.addPlatform(sx, -26, 8, 8, 18);
      this.blockColliders(sx, -26, 8, 8);
      // 反弹盒罩住塔身+顶部收边（18.4 米内的投掷物都会弹回）
      this.walls[this.walls.length - 1] = { x: sx, y: 9.2, z: -26, hx: 4.25, hy: 9.2, hz: 4.25, c: 1, s: 0 };

      const trim = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.4, 8.5), this.matConcreteDark);
      trim.position.set(sx, 18.2, -26);
      trim.castShadow = true;
      this.root.add(trim);

      this.solid(sx, -18.5, 8, 5, 0.95);
      // 楼峡中段掩体（P1-3① 分段 29m 裸视线）：一对花坛 crate(±3.5,-30,1.6,0.9)。
      // 离刷怪点 (0,-37) 7.6m；拾取点 (0,-33) 四周 1.2m 探针格（x∈[-1,1)、z∈[-34,-31)）
      // 必须净空——crate 脚印 x∈[±2.7,±4.3] 含 0.55 padding 后 x∈[±2.15,±4.85]，不冲突。
      this.crate(3.5, -30, 1.6, 0.9, this.matPlanter);
      this.crate(-3.5, -30, 1.6, 0.9, this.matPlanter);
      for (const px of [-3.5, 3.5]) {
        const soil = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.08, 1.48), this.matGreen);
        soil.position.set(px, 0.9 + 0.04, -30);
        soil.receiveShadow = true;
        this.root.add(soil);
      }
    }
  }

  // NE 商场：16×16 裙台是四面暴露的二层平台，上面立一栋玻璃塔（纯视觉体块）。
  buildNE() {
    // 先登记裙台（契约按 (26,-26) 找 16×16 平台），塔身平台在后。
    this.solid(26, -26, 16, 16, 1.9);
    // 玻璃塔身：底部嵌进裙台 0.1 米避免共面，从 1.8 升到 20。
    // 只登记 walls + 一块 9.98 平台：walls 不挡人，这块平台负责把玩家推出塔身脚印
    // （顶面 20 米按 supportHeight 规则天然不可达）；不铺僵尸碰撞圆——裙台的圆圈已经围了一圈。
    const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 18.2, 10), this.matGlass);
    tower.position.set(26, 1.8 + 9.1, -26);
    tower.castShadow = true;
    tower.receiveShadow = true;
    this.root.add(tower);
    this.platforms.push({ x: 26, z: -26, w: 9.98, d: 9.98, h: 20 });
    this.walls.push({ x: 26, y: 10.9, z: -26, hx: 5, hy: 9.1, hz: 5, c: 1, s: 0 });

    // 西/南两侧各一级台阶箱：地面 → 0.95 → 裙台 1.9。
    // 南台阶放在裙台东南角（x=33.5）：天桥北引板脚印盖住 x∈[22,30]，台阶若放在引板正下方，
    // 站台阶的玩家会被引板平台往北推、又被裙台推挤区往南弹，来回钉死在墙脚。
    this.solid(33.5, -17.4, 6, 2.4, 0.95);
    this.solid(17.4, -26, 2.4, 6, 0.95);
  }

  // 天桥高线（本图招牌）：北引板贴裙台南沿 → 主跨横跨 EW 横街 → 南板 → 2 米窄跳板平接工地板台。
  // 全程板面 1.9 平接；南段收窄成跳板是为了给拾取点 (26,19) 留出脚下净空（桥脚印会推出玩家）。
  // 各板之间正好相接（不留缝）：1cm 级的缝会让慢速步行的玩家 support 落空踩空，
  // 裙台/板台一侧的缝还会让落点同时落进两块板的推挤区被来回推钉死。
  buildBridge() {
    this.plate(26, -9.75, 8, 16.5); // z ∈ [-18.0, -1.5]，北端与裙台南沿相接、南端接主跨
    this.plate(26, 0, 8, 3); // 主跨（定稿占位 {x:26,z:0,w:8,d:3,h:1.9}）
    this.plate(26, 8.75, 8, 14.5); // z ∈ [1.5, 16.0]
    // 窄跳板东移（P1-4 东横街绕行税）：x 23 → 24.4，在桥板西侧让出 1.4m 的南绕行缝。
    // 东沿停在 25.4：blockPlatforms 的 0.55 padding 外扩到 25.95，必须 <26 才不会标障
    // 拾取点 (26,19) 北探针格 x∈[26,27)（maps.test 拾取探针契约只有这一格可用）。
    // 南端 d=4.22 压进板台 0.02（z∈[16.0,20.22]）：缝会踩空/钉死，宁可重叠——两板顶面
    // 同为 1.9，重叠方向沿支撑面，落点支撑连续。
    this.plate(24.4, 18.11, 2, 4.22); // 窄跳板 z ∈ [16.0, 20.22]，南端压进板台北沿
    this.railPair(26, -9.75, 16.3, 8, 'z');
    this.railPair(26, 0, 7.9, 3, 'x');
    this.railPair(26, 8.75, 14.3, 8, 'z');
    this.railPair(24.4, 18.1, 4.0, 2, 'z');
  }

  // NW 停车楼：三级 10×10 跳链 0.95 → 1.9 → 2.85，顶面是楼顶停车场。
  // 三级平铺不叠放——引擎会把「脚底低于台面」的玩家推出更高平台的脚印，
  // 同心叠放的话人根本站不上一级台（会被二级台推下楼）。
  // 相邻两级必须正好接上（不留缝）：缝里的落点会同时落在两级推挤区内被来回推钉死。
  buildNW() {
    this.solid(-26, -14.5, 10, 10, 0.95);
    this.solid(-26, -24.5, 10, 10, 1.9); // 南沿 -19.5 与 L1 北沿相接
    this.solid(-16.0, -26.1, 10, 10, 2.85); // 西沿 -21.0 与 L2 东沿相接
    this.parapet(-16.0, -26.1, 10, 10, 2.85);
  }

  // SW 出生区：裙楼夹出南广场，靠内侧一块天台可以跳上打点。
  buildSW() {
    this.solid(-26, 26, 14, 12, 4.6);
    this.solid(-18.5, 26, 4, 8, 0.95);
  }

  // SE 工地：脚手架箱链 + 半成品塔 + 板台，致敬 MW2 High Rise。
  // 板台从 (26,19) 北移 4.2 米：拾取点 (26,19) 是地面点，不能压在 1.9 平台脚印里。
  buildSE() {
    this.solid(26, 23.2, 8, 6, 1.9); // 板台
    this.crate(32, 21, 2, 0.95); // 板台东侧一级箱：地面 → 0.95 → 板台 1.9（与板台留 1m 缝，避免夹角推挤区重叠钉死）
    this.crate(20.8, 28, 2, 0.95); // 脚手架箱链（0.95 → 1.9 两级，两箱相接不留缝）
    this.crate(22.8, 28, 2, 1.9);
    // 半成品塔：视觉体块（宽度收到 9.9，避免和停车楼三级台共用 10×10 口径）
    this.solid(29, 31.3, 9.9, 9.9, 12, { mat: this.matConcreteDark });
    // 工地警示色块
    const stripes = [
      { x: 29, y: 0.6, z: 26.41, w: 9.5, h: 0.32, d: 0.06 },
      { x: 29, y: 1.3, z: 26.41, w: 6.2, h: 0.32, d: 0.06 },
      { x: 22 - 0.03, y: 1.0, z: 23.2, w: 0.06, h: 0.32, d: 4.5 },
    ];
    for (const s of stripes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), this.matAccent);
      m.position.set(s.x, s.y, s.z);
      this.root.add(m);
    }
  }

  // 中央广场掩体群：纪念碑是视觉锚点，毁车/花坛把 32 米广场切成可绕的掩体阵。
  buildPlaza() {
    // 广场铺装（视觉评审 E）：32×32 混凝土分缝铺装贴地片，比沥青浅一档勾出广场边界。
    // y=0.01 防 z-fight；纯视觉——不进 platforms/colliders/walls，与拾取/刷怪探针无关。
    const pave = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshLambertMaterial({ map: plazaTexture() })
    );
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.01, 0);
    pave.receiveShadow = true;
    this.root.add(pave);

    this.solid(0, -1, 4.4, 4.4, 1.2, { mat: this.matConcreteDark });
    // 碑顶方尖柱：platform 挡人（顶面 3.6 不可达）、walls 挡投掷物
    const obelisk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), this.matDeck);
    obelisk.position.set(0, 1.2 + 1.2, -1);
    obelisk.castShadow = true;
    this.root.add(obelisk);
    this.platforms.push({ x: 0, z: -1, w: 0.9, d: 0.9, h: 3.6 });
    this.walls.push({ x: 0, y: 2.4, z: -1, hx: 0.45, hy: 1.2, hz: 0.45, c: 1, s: 0 });

    this.crate(-6, 7, 1.8, 0.95, this.matPlanter);
    this.crate(6, 7, 1.8, 0.9, this.matPlanter);
    this.crate(-6, -8, 1.8, 1.2, this.matWreck);
    this.crate(6, -8, 1.8, 0.9, this.matWreck);
    // 花坛里的一层草皮
    for (const [px, pz] of [[-6, 7], [6, 7]]) {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.08, 1.68), this.matGreen);
      soil.position.set(px, (px === -6 ? 0.95 : 0.9) + 0.04, pz);
      soil.receiveShadow = true;
      this.root.add(soil);
    }
  }

  // 横街分段掩体：把 14 米横街的视线切碎（略外移到 ±4.5，给横街拾取点留流场探针净空）。
  // P1-3②③：西横街一对从 (-26,±4.5) 移到 (-33,±2.2)——中线切段（含 0.55 padding 后
  // z∈[-4,4) 全断，僵尸贴街沿绕行）；拾取点 (-26,0) 的探针格不变仍净空。
  // 南主街 (0,28) 补一对花坛，切掉广场南沿到南环街的裸视线。
  buildBunkers() {
    this.crate(-33, -2.2, 1.6, 0.9, this.matPlanter);
    this.crate(-33, 2.2, 1.6, 0.9, this.matPlanter);
    this.crate(34, -4.5, 1.6, 0.9, this.matPlanter);
    this.crate(34, 4.5, 1.6, 0.9, this.matPlanter);
    this.crate(-2.5, 28, 1.4, 0.9, this.matPlanter);
    this.crate(2.5, 28, 1.4, 0.9, this.matPlanter);
    for (const [px, pz] of [[-2.5, 28], [2.5, 28]]) {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.08, 1.28), this.matGreen);
      soil.position.set(px, 0.9 + 0.04, pz);
      soil.receiveShadow = true;
      this.root.add(soil);
    }
  }

  // 西横街立面（P2-5，只做西侧——东侧桥板本身就是立面）：四块街廓体块收紧走廊，
  // 高低交错（x=-20 两块 4.6、x=-33 两块 2.2）。净空自证：离拾取点 (-26,0) 探针格
  // （x∈[-27,-25)、z∈[-2,2)）≥1.2m——体块脚印 x∈[-23,-17]/[-36,-30]、z∈[10,14]/[-14,-10]；
  // 离刷怪点 (-41,0) 最近角 (-36,-10) 距离 11.2m ≥1.6m。z=-12 两块与停车楼一级台
  // （x∈[-31,-21]，z∈[-19.5,-9.5]）的东北/西北角有 2m/1m 脚印重叠：台面只做支撑、
  // 体块只做侧推（顶面 4.6/2.2 不可达），无对缝无来回推挤，视觉上是贴着停车楼的街廓连体。
  buildWestFacade() {
    this.solid(-20, 12, 6, 4, 4.6);
    this.solid(-20, -12, 6, 4, 4.6);
    this.solid(-33, -12, 6, 4, 2.2);
    this.solid(-33, 12, 6, 4, 2.2);
  }

  // 环街灯柱：外圈 8 米净空里只放灯柱装饰，24 根走两个 InstancedMesh（每种 1 个 draw call）。
  // 灯柱线取 ±42.4：刷怪落点 clamp 在 ±43.8，ZombieManager 先 clearOfColliders 再二次 clamp，
  // 灯柱若贴在 ±43.2（距 clamp 线 0.6 < 推离距离 1.4），贴边落点会被二次 clamp 夹回灯柱推离圆里。
  buildRing() {
    const spots = [];
    for (const v of [-33, -19.8, -6.6, 6.6, 19.8, 33]) {
      spots.push([v, -42.4], [v, 42.4], [-42.4, v], [42.4, v]);
    }
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 4.6, 6),
      this.matConcreteDark,
      spots.length
    );
    poles.castShadow = true;
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0x554d3a,
      emissive: 0xffb060,
      emissiveIntensity: 0.8,
    });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), this.lampMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      m.identity().setPosition(x, 2.3, z);
      poles.setMatrixAt(i, m);
      m.identity().setPosition(x, 4.72, z);
      heads.setMatrixAt(i, m);
      this.addCollider(x, z, 0.35);
      // 玩家也吃灯柱圆碰撞（本图 platforms 承担墙体，playerColliders 只补灯柱这类细柱）
      this.playerColliders.push({ x, z, r: 0.35 });
      this.walls.push({ x, z, r: 0.2, h: 4.6 });
      // 灯头也是实心体：豌豆在 4.6~4.83 米高度穿过灯头会穿模，按盒登记
      this.walls.push({ x, y: 4.72, z, hx: 0.25, hy: 0.11, hz: 0.25, c: 1, s: 0 });
    });
    this.root.add(poles);
    this.root.add(heads);
  }

  // 远景：围墙外一圈楼群剪影（12～30 米高），借雾色融进黄昏天际，不投影。
  // 0x332847 → 0x4d3c6a（视觉评审 F）：原色在黄昏灯下渲染≈黑，与暗部糊死；提亮一档
  // 让剪影从夜幕里浮出来，仍比雾色（0x4a3c50）暗、保持逆光层次。
  buildDistant() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x594678 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rand(-0.18, 0.18);
      const dist = rand(58, 84);
      const h = rand(12, 30);
      const box = new THREE.Mesh(new THREE.BoxGeometry(rand(10, 22), h, rand(10, 20)), mat);
      box.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
      box.rotation.y = rand(0, TAU);
      this.root.add(box);
    }
  }

  buildMotes() {
    const positions = new Float32Array(MOTE_COUNT * 3);
    this.moteData = positions;
    this.moteSpeed = new Float32Array(MOTE_COUNT);
    this.motePhase = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      positions[i * 3] = rand(-HALF, HALF);
      positions[i * 3 + 1] = rand(0.5, 14);
      positions[i * 3 + 2] = rand(-HALF, HALF);
      this.moteSpeed[i] = rand(0.12, 0.45);
      this.motePhase[i] = rand(0, TAU);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.moteAttr = geo.attributes.position;
    const mat = new THREE.PointsMaterial({
      color: 0xffc890,
      size: 0.12,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.root.add(points);
  }

  buildText() {
    this.groundText(0, 16.5, 3.2, 'PLAZA', 'rgba(232,190,130,0.5)');
    this.groundText(0, -33, 3.2, 'CANYON', 'rgba(232,190,130,0.55)');
    // P2-7：EAST 原 (26,12) 埋在天桥脚印下（玩家推挤区，走近不了）→ 移 (34,12) 东通道。
    this.groundText(34, 12, 3.0, 'EAST', 'rgba(232,190,130,0.45)');
    this.groundText(-26, 12, 3.0, 'WEST', 'rgba(232,190,130,0.45)');
    this.groundText(0, 40, 3.2, 'SOUTH', 'rgba(232,190,130,0.5)');
    this.groundText(0, -40, 3.0, 'NORTH', 'rgba(232,190,130,0.5)');
    // 高线入口导语（P2-7）：PARK 画在停车楼一级台面上（(-26,-11) 在 0.95 台脚印内，
    // 贴地会埋进实体）；SITE 在工地口；BRIDGE 画在南板桥面上提示上桥过街（同理抬到板面）。
    this.groundText(-26, -11, 3.0, 'PARK', 'rgba(232,190,130,0.45)', 0.97);
    this.groundText(31.5, 17, 3.0, 'SITE', 'rgba(232,190,130,0.45)');
    this.groundText(24.5, 15, 3.0, 'BRIDGE', 'rgba(232,190,130,0.5)', 1.92);
  }

  updateNav(player, dt) {
    this.nav.update(player.pos.x, player.pos.z, dt);
  }

  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  activate(scene) {
    scene.background = duskSkyTexture();
    scene.fog = new THREE.Fog(0x4a3c50, 60, 210);
    this.root.visible = true;
  }

  // 菜单机位（视觉评审 D 定稿）：低机位掠景——y≈14、半径 30、看向广场偏北 (0,1,-6)，
  // 让双塔剪影 + 发光窗带成为画面主体（原 26 米俯瞰机位塔窗缩成一团色块）。
  // 契约（maps.test）：y>0、horiz<200、看向场地中心 dot>0.6、位置随 t 移动。
  menuCamera(camera, time) {
    const a = time * 0.06;
    camera.position.set(Math.cos(a) * 30, 14 + Math.sin(time * 0.17) * 0.4, Math.sin(a) * 30);
    camera.lookAt(0, 1, -6);
  }

  // Game.setMap 统一喂入 PMREM 环境贴图（NightForest.setFlash 同款「按地图开关」接线）。
  // 幕墙材质是构造期单例：重复 setMap 重复调用是幂等的——重复赋同一张 envMap 无副作用，
  // 材质不重建。metalness 0.15 → 0.28 让玻璃塔挂上天空与街谷反射（视觉评审 C）。
  setEnv(env) {
    if (!env || this.matGlass.envMap === env) return;
    this.matGlass.envMap = env;
    this.matGlass.metalness = 0.28;
    this.matGlass.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    // 塔窗与路灯微闪：只动材质强度，不碰碰撞/平台/拾取表。
    // 自发光基线 0.34→0.5（终轮亮度收敛）：菜单低机位下亮窗占画面小、整帧亮度靠它托一段
    this.matGlass.emissiveIntensity = 0.5 + Math.sin(this.time * 1.7) * 0.07;
    this.lampMat.emissiveIntensity = 0.8 + Math.sin(this.time * 2.3 + 1) * 0.12;
    const p = this.moteData;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const i3 = i * 3;
      p[i3] += this.moteSpeed[i] * dt;
      p[i3 + 1] += Math.sin(this.time * 0.6 + this.motePhase[i]) * dt * 0.25;
      if (p[i3] > HALF) p[i3] = -HALF;
      // 上下界都要卷回，否则浮尘会一路飘出场地
      if (p[i3 + 1] < 0.5) p[i3 + 1] = 14;
      else if (p[i3 + 1] > 14) p[i3 + 1] = 0.5;
    }
    this.moteAttr.needsUpdate = true;
  }
}
