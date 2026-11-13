import * as THREE from 'three';
import { rand, TAU } from '../utils.js';
import { setFollowShadow } from './shadowFollow.js';
import {
  CHUNK, VIEW_RADIUS, SOLID_RADIUS, collect, chunkIndex, ChunkNav, NEON_TONES, HOME_CLEAR,
} from './cyberChunks.js';

// 无尽的赛博空间。
//
// 这是本仓库第一张「边界不存在」的地图：没有外墙、没有围栏、没有把玩家钳在地图里的边界。
// 世界由 24 米见方的程序化区块实时拼接（见 cyberChunks.js），玩家走到哪，
// 周边的楼就按坐标哈希重新长出来 —— 走出去再走回来，那块地还是原来那块。
//
// 三层结构，各管一件事：
//
//   1) 地面：一张 320×320 的平面跟着锚点平移，UV 偏移按「世界坐标」反向补偿，
//      所以网格线钉死在世界上，人在动、地平线不动。
//   2) 楼群：整个可视圈（9×9 = 81 块，216 米见方）的盒子合并进 InstancedMesh，
//      外加霓虹描边、光柱、全息广告 —— 4 个 draw call 画完整个城市。
//      锚点每跨 24 米才重建一次实例缓冲，平时零开销。
//   3) 碰撞：只收集 3×3 块（±36 米）。一帧最多走 0.3 米，这个半径足够。
//
// 为什么碰撞圈和可视圈分开：碰撞体每帧被 Player / Zombie / 弹道读，
// 维持 81 块的碰撞表是纯浪费；视觉要远到雾吃掉为止，所以给 81 块。
//
// 边缘为什么看不见 —— 这是「无限」成立的全部秘密：
//   锚点中心到可视圈边界 4.5×24 = 108 米；玩家离锚点最多 12 米（跨半块才换锚点），
//   所以最近的边界永远在 96 米外。雾 near 20 / far 96：96 米处雾已经完全吃掉，
//   而地面平面（320 米）比可视圈还大，所以边界之外不是「虚空」而是「浓雾里的地面」。
//   想验证这一点：把 fog.far 调到 200 再站到远处看，边界会立刻露馅。

const GROUND_SIZE = 320;
const GROUND_TILE = 8; // 一格网格 = 8 米

const BLOCK_CAP = 560;
const EDGE_CAP = 560;
const PILLAR_CAP = 128;
const HOLO_CAP = 192;

const FOG_NEAR = 20;
const FOG_FAR = 96;
const FOG_COLOR = 0x120a20;

const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpAxis = new THREE.Vector3(0, 1, 0);

// 楼体描边：12 条细棱拼成一个 1×1×1 的线框盒，整体缩放成任意尺寸。
// 合成一份几何 → 一个 InstancedMesh 画完全城的霓虹边框。
function wireBoxGeo(t = 0.035) {
  const parts = [];
  for (const y of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) {
      const g = new THREE.BoxGeometry(1, t, t);
      g.translate(0, y, z);
      parts.push(g);
    }
  }
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) {
      const g = new THREE.BoxGeometry(t, 1, t);
      g.translate(x, 0, z);
      parts.push(g);
    }
  }
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.5, 0.5]) {
      const g = new THREE.BoxGeometry(t, t, 1);
      g.translate(x, y, 0);
      parts.push(g);
    }
  }
  return mergePosition(parts);
}

// 只合并 position/normal/index（子几何都是同构 BoxGeometry）。
function mergePosition(list) {
  let count = 0;
  let idx = 0;
  for (const g of list) {
    count += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const index = new Uint16Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    const gi = g.index ? g.index.array : null;
    const n = g.attributes.position.count;
    if (gi) {
      for (let k = 0; k < gi.length; k++) index[io + k] = gi[k] + vo;
      io += gi.length;
    } else {
      for (let k = 0; k < n; k++) index[io + k] = k + vo;
      io += n;
    }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

// 全息广告贴图：暗底 + 霓虹「字块」+ 扫描线。加色混合下只留亮的部分。
// 用固定种子：同一张图每次进来招牌图案一样（不能每次刷新都换）。
function holoTexture() {
  if (holoTexture.tex) return holoTexture.tex;
  const w = 128;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  ctx.fillStyle = '#ffffff';
  for (let row = 0; row < 4; row++) {
    let x = 8;
    const y = 10 + row * 20;
    while (x < w - 12) {
      const bw = 3 + Math.round(rnd() * 7);
      if (rnd() > 0.28) ctx.fillRect(x, y, bw, 11);
      x += bw + 4;
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  holoTexture.tex = tex;
  return tex;
}

// 霓虹地砖：深蓝紫底 + 噪点 + 青色网格 + 一条洋红分格线。
function gridTexture() {
  if (gridTexture.tex) return gridTexture.tex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  // 固定种子噪点：贴图是模块级缓存，但要可复现（截图对比 / 视觉回归）
  let r = 0x1a2b3c4d;
  const rnd = () => {
    r ^= r << 13; r >>>= 0;
    r ^= r >>> 17;
    r ^= r << 5; r >>>= 0;
    return r / 4294967296;
  };
  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const v = 18 + Math.floor(rnd() * 26);
    ctx.fillStyle = 'rgb(' + Math.floor(v * 0.6) + ',' + Math.floor(v * 0.85) + ',' + (v + 12) + ')';
    ctx.fillRect(rnd() * s, rnd() * s, 2, 2);
  }
  ctx.strokeStyle = 'rgba(39,232,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, s);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(s, 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(39,232,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (s / 4) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  // 不是每格都有洋红：跳着放才有「接口松动」的赛博感
  ctx.strokeStyle = 'rgba(255,62,165,0.30)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.75);
  ctx.lineTo(s, s * 0.75);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  gridTexture.tex = tex;
  return tex;
}

export class CyberSpace {
  constructor(scene) {
    this.scene = scene;
    this.id = 'cyber';
    this.name = '无尽的赛博空间';
    // 标记：没有固定范围。extract-map-data / net-protocol 一致性检查都认这个字段，
    // 有它就走「按坐标生成」的路径，而不是当作固定地图导出。
    this.infinite = true;
    this.root = new THREE.Group();
    this.root.name = 'cyber';
    this.root.visible = false;
    scene.add(this.root);

    // 10 公里：任何一局都走不到，但保留有限值，让所有 clamp / 弹道兜底逻辑有数可算。
    // 这张图的「无边界」不是靠 bounds 撑大的，是靠区块永远跟着玩家长。
    this.bounds = { x: 10000, z: 10000 };
    this.spawn = { x: 0, z: 0, yaw: 0 };
    this.noShadows = false;
    // 太阳沉在地平线以下（y<0）：skyDome 的 shader 里 sunUp=0，
    // 太阳盘与光晕自动消失，只留下方位角上的洋红「城市光污染」地平线带。
    this.sunDir = new THREE.Vector3(-0.62, -0.28, 0.73).normalize();
    // 霓虹很亮、场景很暗，曝光抬一档才压得住暗部（Game.setMap 读这个字段）
    this.exposure = 1.12;

    // 锚点 = 当前区块索引（不是世界坐标！couple: collect(chunkIdx) 用它做区块寻址）
    this.anchorCx = 0;
    this.anchorCz = 0;
    // 三张动态表：换锚点时整体换引用，不原地改内容
    // （Player / Zombie / 弹道都按数组引用迭代，原地 push 会让它们看到半成品）
    this._applyWindow(0, 0);
    // 流场：窗口跟着锚点走，其它地图是静态 FlowField，这里是 ChunkNav
    this.nav = new ChunkNav();
    this.nav.rebuild(0, 0);
    this._spots = [];
    this.pickupSpots = [];
    // 拾取点位换了地方要让 WeaponPickups 重挂（Game.update 消费这个旗标）
    this.spotsDirty = false;
    this._spotsInited = false;

    this.time = 0;
    this.build();
    this.rebuild(true);
    this.computeSpots();
    this.syncGround();
  }

  // 世界坐标 ← 锚点区块索引
  get anchorX() { return this.anchorCx * CHUNK; }
  get anchorZ() { return this.anchorCz * CHUNK; }

  _applyWindow(cx, cz) {
    const w = collect(cx, cz, SOLID_RADIUS);
    this._window = w;
    this.colliders = w.colliders;
    this.platforms = w.platforms;
    this.walls = w.walls;
  }

  // ---- 僵尸出生环：无限地图没有固定出生点，按锚点现算一圈。
  // ZombieManager 拿到的仍是 [[x,z], ...]，不需要它认识「区块」这个概念。
  // 用 getter 而不是数组字段：锚点每跨 24 米就搬家，数组若被缓存住就成了旧位置，
  // 玩家往前走一公里后僵尸会从背后一公里外刷新。
  get zombieSpawnPoints() {
    return this.spawnRing();
  }

  // 首波教学：同样一圈，半径更近（14 米），让第一波从「看得见的四面」压上来。
  get openingSpawnPoints() {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.39;
      out.push([this.anchorX + Math.cos(a) * 14, this.anchorZ + Math.sin(a) * 14]);
    }
    return out;
  }

  spawnRing() {
    const out = [];
    const cx = this.anchorX;
    const cz = this.anchorZ;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const r = 22 + (i % 3) * 3.5;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  }

  // 拾取点位：锚点周围三圈候选，逐点验净空（不压楼、不压碰撞球、彼此 ≥3 米）。
  computeSpots() {
    const w = collect(this.anchorCx, this.anchorCz, SOLID_RADIUS);
    // 点位是**世界坐标**（WeaponPickups 直接拿去摆模型，不做锚点换算），
    // 所以候选环必须加上锚点偏移 —— 少加这一句，锚点一动点位就全留在原点附近。
    const ox = this.anchorX;
    const oz = this.anchorZ;
    const spots = [];
    const radii = [8, 14, 20];
    for (let ri = 0; ri < radii.length && spots.length < 8; ri++) {
      for (let i = 0; i < 10 && spots.length < 8; i++) {
        const a = (i / 10) * TAU + ri * 0.41;
        const x = ox + Math.cos(a) * radii[ri];
        const z = oz + Math.sin(a) * radii[ri];
        // 出生广场中心留空（Home 区不放枪，避免开局就有一把枪躺在脚下）
        const lx = x - ox;
        const lz = z - oz;
        if (Math.hypot(lx, lz) < 6) continue;
        let bad = false;
        for (let k = 0; k < w.platforms.length; k++) {
          const p = w.platforms[k];
          if (p.h < 0.6) continue;
          if (Math.abs(x - p.x) <= p.w / 2 + 0.5 && Math.abs(z - p.z) <= p.d / 2 + 0.5) { bad = true; break; }
        }
        if (!bad) {
          for (let k = 0; k < w.colliders.length; k++) {
            const c = w.colliders[k];
            if (Math.hypot(x - c.x, z - c.z) < c.r + 0.5) { bad = true; break; }
          }
        }
        if (!bad) {
          for (let k = 0; k < spots.length; k++) {
            if (Math.hypot(x - spots[k][0], z - spots[k][1]) < 3) { bad = true; break; }
          }
        }
        if (bad) continue;
        spots.push([x, z]);
      }
    }
    // 兜底：候选全被挡时至少给出生广场一圈（理论上出生块是空的，走不到这里）
    if (spots.length < 3) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        spots.push([ox + Math.cos(a) * 7, oz + Math.sin(a) * 7]);
      }
    }
    this._spots = spots;
    this.pickupSpots = spots;
    this.spotsDirty = true;
  }

  // 天降阳光：SkySun 默认按 bounds 撒（10 公里外没人捡得到），这张图自己给点。
  skySunSpot() {
    return { x: this.anchorX + rand(-16, 16), z: this.anchorZ + rand(-16, 16) };
  }

  build() {
    this.buildLights();
    this.buildGround();
    this.buildCity();
  }

  buildLights() {
    // 天光：上方冷青、下方洋红反射。赛博朋克的环境光永远是「两盏互相打架的灯」。
    const hemi = new THREE.HemisphereLight(0x4f8cff, 0x601a52, 1.15);
    this.root.add(hemi);

    // 主光：高空斜切的冷白，给楼体切出硬边。
    const sun = new THREE.DirectionalLight(0xbfe6ff, 1.55);
    sun.position.set(18, 40, 12);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.045;
    this.shadowFollow = setFollowShadow(sun, { half: 20, near: 1, far: 120, mapSize: 1024 });
    this.root.add(sun);
    this.root.add(sun.target);
    this.sunLight = sun;

    // 补光：洋红从偏低的角度舔背光面，让楼不糊成一团黑。
    const fill = new THREE.DirectionalLight(0xff4fb0, 0.75);
    fill.position.set(-26, 8, -20);
    this.root.add(fill);
  }

  buildGround() {
    const tex = gridTexture();
    tex.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
    this.groundTex = tex;
    this.groundMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.35,
      // 自发光让网格线在暗处自己亮，不必依赖灯（路灯是没有的）
      emissive: 0x0a2a3a,
      emissiveIntensity: 1,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    this.ground = ground;

    // 地面光带：贴地的极淡青色加色平面，缓慢扫过时像数据总线的光。
    this.sheenMat = new THREE.MeshBasicMaterial({
      color: 0x27e8ff,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, 26), this.sheenMat);
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.y = 0.02;
    this.root.add(sheen);
    this.sheen = sheen;
  }

  buildCity() {
    // 楼体：单位立方体 + 实例矩阵缩放。深色 PBR 基底靠 instanceColor 染暗调霓虹。
    this.blockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.62 });
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    blockGeo.translate(0, 0.5, 0); // 原点移到箱底，按「高」缩放即可落地
    this.blocks = new THREE.InstancedMesh(blockGeo, this.blockMat, BLOCK_CAP);
    this.blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blocks.castShadow = true;
    this.blocks.receiveShadow = true;
    this.blocks.count = 0;
    this.blocks.frustumCulled = false;
    this.root.add(this.blocks);

    // 霓虹描边：加色白光 × 实例色，全图最亮的一层。
    this.edgeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });
    this.edges = new THREE.InstancedMesh(wireBoxGeo(), this.edgeMat, EDGE_CAP);
    this.edges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.edges.count = 0;
    this.edges.frustumCulled = false;
    this.root.add(this.edges);

    // 光柱：地面直上三十米的加色圆柱，远景里的方向锚点。
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
    pillarGeo.translate(0, 0.5, 0);
    this.pillarMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.pillars = new THREE.InstancedMesh(pillarGeo, this.pillarMat, PILLAR_CAP);
    this.pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pillars.count = 0;
    this.pillars.frustumCulled = false;
    this.root.add(this.pillars);

    // 全息广告：竖在空中的发光板，双面、加色、不写深度。
    this.holoMat = new THREE.MeshBasicMaterial({
      map: holoTexture(),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.holo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.holoMat, HOLO_CAP);
    this.holo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.holo.count = 0;
    this.holo.frustumCulled = false;
    this.root.add(this.holo);
  }

  // 重建可视圈：只在锚点换块时跑（每走 24 米一次）。
  rebuild(force) {
    const cx = this.anchorCx;
    const cz = this.anchorCz;
    if (!force && cx === this._builtCx && cz === this._builtCz) return;
    this._builtCx = cx;
    this._builtCz = cz;

    const w = collect(cx, cz, VIEW_RADIUS);
    let bi = 0;
    let ei = 0;
    let pi = 0;
    let hi = 0;

    for (let ci = 0; ci < w.chunks.length; ci++) {
      const ch = w.chunks[ci];

      for (let k = 0; k < ch.blocks.length; k++) {
        const b = ch.blocks[k];
        if (bi >= BLOCK_CAP) break;
        const tone = NEON_TONES[b.tone % NEON_TONES.length];
        tmpPos.set(b.x, 0, b.z);
        tmpQuat.identity();
        tmpScale.set(b.w, b.h, b.d);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.blocks.setMatrixAt(bi, tmpMat);
        // 楼体本身是暗的：霓虹压到 18%，只有描边走全强度
        tmpColor.setHex(tone).multiplyScalar(0.18);
        this.blocks.setColorAt(bi, tmpColor);
        bi++;

        if (ei < EDGE_CAP) {
          tmpPos.set(b.x, b.h / 2, b.z);
          tmpScale.set(b.w, b.h, b.d);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.edges.setMatrixAt(ei, tmpMat);
          tmpColor.setHex(tone);
          this.edges.setColorAt(ei, tmpColor);
          ei++;
        }
      }

      for (let k = 0; k < ch.pillars.length; k++) {
        const p = ch.pillars[k];
        if (pi >= PILLAR_CAP) break;
        tmpPos.set(p.x, 0, p.z);
        tmpScale.set(1, p.h, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.pillars.setMatrixAt(pi, tmpMat);
        tmpColor.setHex(NEON_TONES[p.tone % NEON_TONES.length]);
        this.pillars.setColorAt(pi, tmpColor);
        pi++;
      }

      for (let k = 0; k < ch.holo.length; k++) {
        const h = ch.holo[k];
        if (hi >= HOLO_CAP) break;
        tmpPos.set(h.x, h.y, h.z);
        // 朝向由世界坐标决定：全城不会是一排同向的板子
        tmpQuat.setFromAxisAngle(tmpAxis, (h.x * 0.37 + h.z * 0.11) % TAU);
        tmpScale.set(h.w, h.h, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.holo.setMatrixAt(hi, tmpMat);
        tmpColor.setHex(NEON_TONES[h.tone % NEON_TONES.length]);
        this.holo.setColorAt(hi, tmpColor);
        hi++;
      }
    }

    this.blocks.count = bi;
    this.edges.count = ei;
    this.pillars.count = pi;
    this.holo.count = hi;
    this.blocks.instanceMatrix.needsUpdate = true;
    this.edges.instanceMatrix.needsUpdate = true;
    this.pillars.instanceMatrix.needsUpdate = true;
    this.holo.instanceMatrix.needsUpdate = true;
    if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
    if (this.edges.instanceColor) this.edges.instanceColor.needsUpdate = true;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
    if (this.holo.instanceColor) this.holo.instanceColor.needsUpdate = true;
  }

  // 地面网格按世界坐标对齐：平面跟着锚点走，UV 偏移反向补偿，
  // 于是网格线钉在世界上，人走动时它不动。
  syncGround() {
    const cx = this.anchorX;
    const cz = this.anchorZ;
    this.ground.position.set(cx, 0, cz);
    this.sheen.position.set(cx, 0.02, cz);
    const tile = GROUND_TILE;
    // repeat = 40 → 纹理 0..1 覆盖 8 米，所以 offset 用 anchor/8 的小数部分
    const ox = ((cx / tile) % 1 + 1) % 1;
    const oz = ((cz / tile) % 1 + 1) % 1;
    this.groundTex.offset.set(ox, oz);
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  // ---- Game 侧接口 ----

  activate(scene) {
    // 背景色只是过渡帧的底：Game.setMap 随后会把 scene.background 置空、
    // 天空交给穹顶（SKY_PRESETS.cyber）。但 activate 自己的契约仍是「设背景 + 雾」，
    // 而且首帧穹顶还没画时，纯黑底比白底安全。
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.root.visible = true;
  }

  // 菜单机位：贴地低角度掠景。赛博朋克的味道全在「仰视」——
  // 平视会把霓虹拉到人眼高度，读起来像商场。
  menuCamera(camera, time) {
    const a = time * 0.055;
    const r = 34;
    camera.position.set(Math.cos(a) * r, 9 + Math.sin(time * 0.19) * 0.5, Math.sin(a) * r);
    camera.lookAt(0, 5.5, 0);
  }

  setEnv(env) {
    if (!env || this.blockMat.envMap === env) return;
    this.blockMat.envMap = env;
    this.blockMat.needsUpdate = true;
  }

  // 玩家位置驱动锚点：跨过半块（12 米）才换，避免每帧重建。
  // 换锚点 = 换碰撞表 + 重算拾取点 + 重建可视圈 + 对齐地面，四件事一起做。
  updateNav(player, dt) {
    if (!player || !player.pos) return;
    this._lastX = player.pos.x;
    this._lastZ = player.pos.z;
    const px = player.pos.x;
    const pz = player.pos.z;
    const cx = chunkIndex(px);
    const cz = chunkIndex(pz);
    if (cx !== this.anchorCx || cz !== this.anchorCz) {
      this.anchorCx = cx;
      this.anchorCz = cz;
      this._applyWindow(cx, cz);
      this.nav.rebuild(cx, cz);
      this.computeSpots();
      this.rebuild();
      this.syncGround();
    }
    // 流场 BFS 与其它地图同频（内部有 0.45s 节流 + 同格短路，不会每帧全跑）
    this.nav.update(px, pz, dt);
  }

  // Zombie 每帧调（它认的是 map.flowAt / map.nav.flowAt，与固定地图同签名）
  flowAt(x, z, out) {
    return this.nav.flowAt(x, z, out);
  }

  update(dt) {
    this.time += dt;
    // 霓虹呼吸：只动材质标量，不碰实例缓冲。
    const pulse = 0.86 + Math.sin(this.time * 1.9) * 0.14;
    this.edgeMat.opacity = 0.72 + pulse * 0.26;
    this.pillarMat.opacity = 0.34 + pulse * 0.22;
    this.holoMat.opacity = 0.62 + Math.sin(this.time * 2.7 + 1.3) * 0.16;
    this.groundMat.emissiveIntensity = 0.7 + pulse * 0.5;
    // 扫描光带沿 z 轴缓慢推过地面（只在锚点周围 320 米内，够用）
    const bandZ = ((this.time * 7) % (GROUND_SIZE + 40)) - GROUND_SIZE / 2;
    this.sheen.position.z = this.anchorZ + bandZ;
    this.sheenMat.opacity = 0.045 + Math.sin(this.time * 1.4) * 0.012;
  }
}

export { HOME_CLEAR };