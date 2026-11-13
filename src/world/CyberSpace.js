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
const FOG_COLOR = 0x02060a;

const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpAxis = new THREE.Vector3(0, 1, 0);

// 楼体描边：12 条细棱拼成一个 1×1×1 的线框盒，整体缩放成任意尺寸。
// 合成一份几何 → 一个 InstancedMesh 画完全城的霓虹边框。
//
// 《创》的轮廓光必须**看得出粗细**：0.035 在远处只有不到一个像素，
// 加上 bloom 之后会糊成一层雾而不是一条线。0.055 让 24 米外的楼
// 也能稳定占到 1.5~2 像素，泛光才有「灯管」的实体感。
function wireBoxGeo(t = 0.055) {
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

// 全息数据板：暗底 + 一排排横向「数据条」+ 边框 + 扫描线。
//
// 上一版画的是「文字块」（模拟广告牌上的字），那是赛博朋克街景的语汇。
// 《创》里的屏幕显示的是**结构化数据**：等宽的横条、网格、骨架线，
// 不需要看起来像任何语言 —— 它只是「一排排正在流过的信息」。
// 所以这里改成横条 + 竖刻度 + 边框，没有「字」的形状。
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
  // 数据条：长度参差，但都从左边对齐 —— 像一列正在刷新的读数
  for (let row = 0; row < 12; row++) {
    const y = 8 + row * 7;
    const len = 20 + rnd() * 78;
    ctx.fillRect(10, y, len, 2.5);
  }
  // 右侧竖刻度：给数据板一个「仪表」的骨架
  ctx.fillRect(w - 14, 10, 1.5, h - 24);
  for (let i = 0; i < 8; i++) ctx.fillRect(w - 18, 12 + i * 9, 5, 1.5);
  // 扫描线
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  // 外框
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  holoTexture.tex = tex;
  return tex;
}

// 《创》的地面网格：纯黑底 + 一根极细的青线 + 更暗的次级分格线。
// 跟上一版（噪点地砖 + 洋红跳格线）的关键区别：
//   · 不要噪点。噪点是「脏」，网格世界的表面必须是干净的
//   · 主格线要细、要亮、要锐（1px 实线 + 一层很淡的辉光），不能是 3px 糊条
//   · 次级线只到主线的 1/4 亮度，用来给速度感，不能和主线抢
function gridTexture() {
  if (gridTexture.tex) return gridTexture.tex;
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, s, s);

  // 次级分格：每格再切 4 份，只画很淡的线。
  // 这条线不参与 emissiveIntensity 的主亮，纯靠贴图自身的亮度区分层次。
  ctx.strokeStyle = 'rgba(40,150,180,0.28)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (s / 4) * i + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }

  // 主格线：一条 2px 的亮青线，外面套一层宽度更大的低透明度辉光。
  // 辉光用两遍画（宽淡 + 窄亮），比 shadowBlur 快且不吃边缘。
  ctx.strokeStyle = 'rgba(91,240,255,0.16)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, s);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(s, 0.5);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(150,250,255,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(1, s);
  ctx.moveTo(0, 1);
  ctx.lineTo(s, 1);
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
    // 《创》的光照原则：**几乎不给环境光**。
    // 现实世界靠漫反射，网格世界靠「物体自己发光 + 黑场衬托」。
    // 一旦把 hemisphere 开到 1.15，楼体的每个面都被均匀照亮，
    // 立刻变成「黑暗里的纸盒子」—— 那是赛博朋克夜市，不是 TRON。
    // 所以环境光压到 0.28：只够看出楼是立体的，不足以把楼体照亮。
    const hemi = new THREE.HemisphereLight(0x2a7fa8, 0x04121a, 0.28);
    this.root.add(hemi);

    // 主光：不做造型，只给一点点方向感让楼体的「暗面更暗」，
    // 真正的轮廓全靠霓虹描边自己亮。强度低、颜色带青。
    const sun = new THREE.DirectionalLight(0x8fd8ff, 0.5);
    sun.position.set(18, 40, 12);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.045;
    this.shadowFollow = setFollowShadow(sun, { half: 20, near: 1, far: 120, mapSize: 1024 });
    this.root.add(sun);
    this.root.add(sun.target);
    this.sunLight = sun;
  }

  buildGround() {
    const tex = gridTexture();
    tex.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
    this.groundTex = tex;
    // 《创》的地面：不是「有纹理的深色地砖」，而是**纯黑平面 + 发光线**。
    // 所以贴图只提供网格线（map 压暗、emissiveMap 提亮），
    // 底色走纯黑，roughness 拉满让地面完全不反光 —— 反光会把它拉回现实质感。
    this.groundMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x05080c,
      roughness: 0.92,
      metalness: 0.0,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.55,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    this.ground = ground;

    // 地面光带：《创》里最识别的一个动作 —— 一道亮线贴着地面扫过去，
// 像系统的自检在刷过这个平面。上一版是「很淡的青色加色块」（opacity .055），
// 几乎看不见；现在做成一道真正的亮线（0.5m 芯 + 两侧衰减），
// 并且不止一条：三条不同速度/相位的平行光带，才有「数据在流动」的层次。
    this.sheenMat = new THREE.MeshBasicMaterial({
      color: 0x5bf0ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sheen = new THREE.Group();
    const bandWidths = [0.5, 0.16, 0.16];
    const bandOffsets = [0, -2.2, 2.2];
    this.sheenBands = [];
    for (let i = 0; i < bandWidths.length; i++) {
      const g = new THREE.PlaneGeometry(GROUND_SIZE, bandWidths[i]);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, this.sheenMat.clone());
      m.material.opacity = i === 0 ? 0.85 : 0.30;
      m.position.set(0, i * 0.002, bandOffsets[i]);
      m.renderOrder = 3;
      sheen.add(m);
      this.sheenBands.push(m);
    }
    this.root.add(sheen);
    this.sheen = sheen;
  }

  buildCity() {
    // 楼体：《创》里建筑是**吸收光**的黑体量，不反射、不发光，
    // 唯一的视觉信息来自边缘那一圈光。所以用 MeshBasicMaterial 纯黑 +
    // 不受光，而不是 Standard —— 受光材质再暗也会有明暗过渡，
    // 一有过渡就变成「打了光的箱子」，黑剪影感立刻消失。
    // 不用 Standard 还顺带省掉了这块的灯光计算。
    this.blockMat = new THREE.MeshBasicMaterial({ color: 0x03060a });
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    blockGeo.translate(0, 0.5, 0); // 原点移到箱底，按「高」缩放即可落地
    this.blocks = new THREE.InstancedMesh(blockGeo, this.blockMat, BLOCK_CAP);
    this.blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blocks.castShadow = false;
    this.blocks.receiveShadow = false;
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
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true);
    pillarGeo.translate(0, 0.5, 0);
    // 光柱必须**往上衰减**。
    // 上一版用 MeshBasicMaterial 加色：柱体从上到下一样亮，一路顶到屏幕外，
    // 读起来像一根插在场景里的白棒子，而不是光。
    // 真实的光柱（《创》里的发射井/信标）是「根亮、梢散」，所以这里用 shader
    // 按局部 y（0=地面, 1=柱顶）做二次衰减，并把加色强度再乘一层。
    this.pillarMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.5 },
      },
      vertexShader: `
        attribute mat4 instanceMatrix;
        attribute vec3 instanceColor;
        varying float vY;
        varying vec3 vColor;
        void main() {
          vY = position.y; // translate 之后 0..1
          vColor = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vY;
        varying vec3 vColor;
        void main() {
          // 二次衰减：底部 1.0，柱顶 0.06。留一点底噪，别让它彻底消失。
          float fade = 1.0 - vY;
          fade = fade * fade * 0.94 + 0.06;
          gl_FragColor = vec4(vColor * fade, fade * uOpacity);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
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
        // 楼体固定纯黑（实例色也只留极小的色差，避免完全融成一片死黑）
        tmpColor.setHex(0x05090e);
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
    // 光带组跟着锚点走；各条带子的 z 偏移在 update 里单独动画
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
    // 《创》的呼吸感很克制：光要「稳」，只是在极小的范围内微颤，
    // 像电子设备的热漂移，而不是霓虹招牌那样一明一暗。
    const pulse = 0.94 + Math.sin(this.time * 1.4) * 0.06;
    this.edgeMat.opacity = 0.88 * pulse;
    this.pillarMat.uniforms.uOpacity.value = 0.62 * pulse;
    this.holoMat.opacity = 0.55 + Math.sin(this.time * 2.1 + 1.3) * 0.10;
    this.groundMat.emissiveIntensity = 0.5 * pulse;
    // 三条地面光带：不同速度与相位，沿 z 轴循环推进。
    // 让光带在锚点 ±160 米内循环（地面平面 320 米），到边界时已经在雾里，
    // 所以看不到「光带跳回起点」这件事。
    const span = GROUND_SIZE;
    for (let i = 0; i < this.sheenBands.length; i++) {
      const speed = i === 0 ? 14 : 9 + i * 3.5;
      const phase = i * 0.37;
      const z = ((this.time * speed + phase * span) % span) - span / 2;
      this.sheenBands[i].position.z = z;
    }
  }
}

export { HOME_CLEAR };