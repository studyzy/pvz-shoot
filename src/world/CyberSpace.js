import * as THREE from 'three';
import { rand, TAU, clamp } from '../utils.js';
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
const HOLO_CAP = 520;  // 招牌：每栋高楼约 65% 带一块
const PROP_CAP = 1600; // 街面杂物 + 屋顶设备/天线：每块 ~24 件

const FOG_NEAR = 22;
const FOG_FAR = 96;
const FOG_COLOR = 0x1a0b2e;

const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();
const tmpAxis = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);

// 楼体表面贴图：**发光的窗格**。
//
// 这是让赛博朋克夜景「有细节」的核心。上一版楼体是纯黑块 + 边缘线，
// 等于把城市简化成了线框图 —— 干净，但空。真实夜景的密度来自
// 每一栋楼上成百上千扇亮着或没亮的窗：它们是随机的、不齐的、
// 有的整层黑、有的格子里有暖光的人影。
//
// 做法：一张 canvas 画窗格阵列，然后靠 emissiveMap 让「亮窗」自发光。
// 二楼时空网格对齐（每 8 米 4 层窗），所以近看是一扇扇窗，
// 远看叠成一片光斑 —— 这正是夜景该有的两个尺度上的读法。
//
// 窗的随机性用固定种子：同一个区块每次进来窗型一样，
// 走出去再走回来不会变（和 chunkData 的确定性保持同一个原则）。
function windowTexture() {
  if (windowTexture.tex) return windowTexture.tex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  // 底色不用纯黑：留一点点蓝灰，让墙面在暗处仍有体积感
  ctx.fillStyle = '#05080e';
  ctx.fillRect(0, 0, s, s);

  let seed = 0x5f3a91c7;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };

  // 6 窗 × 8 层 / 张，整张铺 7.2 米宽 × 26.4 米高。
  // 之前是 8×16 且只铺 3.2 米 —— 等于每 20 厘米就有一层窗，
  // 屏幕上一律糊成横条纹（这是「没细节」的真因）。
  // 现在单扇窗 1.2 米宽、层高 3.3 米：远看是窗格阵列，近看是一扇扇窗。
  const COLS = 6;
  const ROWS = 8;
  const pad = 3;
  const cw = s / COLS;
  const chh = s / ROWS;

  for (let r = 0; r < ROWS; r++) {
    // 整层亮/整层暗：办公楼夜里常有的「整层还在加班」或「整层关灯」
    const floorMood = rnd();
    for (let col = 0; col < COLS; col++) {
      const x = col * cw + pad;
      const y = r * chh + pad;
      const w = cw - pad * 2;
      const h = chh - pad * 2;

      let lit = rnd();
      if (floorMood < 0.18) lit = 0.04;       // 18% 的楼层几乎全黑
      else if (floorMood > 0.86) lit = 0.95;  // 14% 的楼层几乎全亮

      if (lit < 0.34) {
        // 没亮的窗：极暗的玻璃，带一点冷色反光
        ctx.fillStyle = 'rgba(18,26,38,0.9)';
        ctx.fillRect(x, y, w, h);
      } else {
        // 亮窗：亮度分四档，越亮越偏白（过曝），越暗越偏色
        const b = 0.35 + rnd() * 0.65;
        const warm = rnd() < 0.28; // 少数是暖光（白炽灯/老式灯泡）
        let cr, cg, cb;
        if (warm) {
          cr = 255; cg = Math.round(150 + b * 70); cb = Math.round(60 + b * 50);
        } else {
          cr = Math.round(140 + b * 115);
          cg = Math.round(190 + b * 65);
          cb = 255;
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.5 + b * 0.5).toFixed(3)})`;
        ctx.fillRect(x, y, w, h);
        // 亮窗中心再点一层更亮的芯：模拟灯光在玻璃上的高光
        if (b > 0.72) {
          ctx.fillStyle = `rgba(255,255,255,${((b - 0.72) * 2.2).toFixed(3)})`;
          ctx.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5);
        }
      }
    }
  }

  // 楼层分隔：每层之间一条暗线，让窗格有「楼板」的实感
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let r = 0; r <= ROWS; r++) {
    ctx.fillRect(0, r * chh, s, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  windowTexture.tex = tex;
  return tex;
}

// 楼体表面贴图（第二层）：**玻璃幕墙的横向反光带**。
// 只靠窗格会让楼看起来像公寓；CBD 的玻璃楼要有横向的
// 一道道光带（楼层反光），叠在窗格上就有「写字楼」的识别度。
function mullionTexture() {
  if (mullionTexture.tex) return mullionTexture.tex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, s, s);
  // 竖向密肋：幕墙的竖框
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 16; i++) ctx.fillRect(i * (s / 16), 0, 1.6, s);
  // 横向楼板线：更粗更暗
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let i = 0; i < 8; i++) ctx.fillRect(0, i * (s / 8), s, 2.4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  mullionTexture.tex = tex;
  return tex;
}

// 贴地光斑贴图：中心亮、边缘透明。
// 直接用纯色平面会得到一个硬边方块（加色混合下尤其明显），
// 而真实的灯光洒在地上是**从中心往外衰减**的。
// 一张 128×128 的径向渐变就能解决，且能被所有光斑共用（一个 draw call）。
function spillTexture() {
  if (spillTexture.tex) return spillTexture.tex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  spillTexture.tex = tex;
  return tex;
}

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
    this.exposure = 1.25;

    // 泛光强度：夜景的「绚丽」本质上是「高光溢出」。
    // 白天场景 0.06 就够，夜景需要 0.42 才能让亮窗、描边、地面积光都晕开。
    // 这个值偏高不是失误 —— 赛博朋克夜景的观感就是「光太多了」。
    this.bloom = 0.42;

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
    // 赛博朋克夜景的光是**多层叠加**的，不是一盏主光定天下：
    //   1) 天光：上方冷青（城市上空的辉光）、下方洋红（街面霓虹的反射）
    //   2) 主光：高空冷白，负责给楼切出硬边、投出长影
    //   3) 补光：洋红从低角度舔背光面 —— 这一盏最关键，
    //      没有它，所有背光面都是死黑，画面立刻失去「霓虹包围感」
    const hemi = new THREE.HemisphereLight(0x3a7fd0, 0x8a1f5a, 0.95);
    this.root.add(hemi);

    const sun = new THREE.DirectionalLight(0xa8d8ff, 1.25);
    sun.position.set(18, 40, 12);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.045;
    this.shadowFollow = setFollowShadow(sun, { half: 20, near: 1, far: 120, mapSize: 1024 });
    this.root.add(sun);
    this.root.add(sun.target);
    this.sunLight = sun;

    const fill = new THREE.DirectionalLight(0xff3ea5, 0.85);
    fill.position.set(-26, 9, -20);
    this.root.add(fill);

    // 街面暖光：从地面往上打的一层极淡琥珀，模拟路灯/招牌在低处的照明。
    // 位置压在 y=0.5，方向朝上，只影响近地物体（玩家脚边、楼的底部）。
    const bounce = new THREE.DirectionalLight(0xffa040, 0.35);
    bounce.position.set(0, -6, 0);
    bounce.target.position.set(0, 6, 0);
    this.root.add(bounce);
    this.root.add(bounce.target);
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
      // 湿沥青：底色近黑但**保留反光**。
      // 赛博朋克夜景一半的绚丽来自地面：霓虹倒影铺满街面，
      // 把画面的亮度面积从「楼上的窗」扩大到「整个下半屏」。
      // roughness 0.18 + metalness 0.75 让地面像刚下过雨的沥青，
      // 环境贴图和霓虹倒影会被拉成竖条（这是「湿地」的关键视觉特征）。
      color: 0x0a0f16,
      roughness: 0.18,
      metalness: 0.75,
      envMapIntensity: 1.6,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.38,
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

    // 街面霓虹光斑：楼体底部的一圈加色光带。
    //
    // 这是夜景「密度」的最后一层：现实里每栋楼的一层都是店面/大堂，
    // 灯光从楼里漫到人行道上。少了这层，楼就像从黑地里长出来的方块，
    // 地面和楼之间没有过渡。
    // 做法：每栋楼在脚下铺一个略大于楼体、贴地的加色圆环片，
    // 用一个 InstancedMesh 画完全城，色彩取该楼的霓虹色。
    this.spillMat = new THREE.MeshBasicMaterial({
      map: spillTexture(),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // 街面光斑需要绕 X 轴转 90° 才是贴地的
    const spillGeo = new THREE.PlaneGeometry(1, 1);
    spillGeo.rotateX(-Math.PI / 2);
    this.spills = new THREE.InstancedMesh(spillGeo, this.spillMat, BLOCK_CAP);
    this.spills.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spills.count = 0;
    this.spills.frustumCulled = false;
    this.spills.renderOrder = 2;
    this.root.add(this.spills);
  }

  buildCity() {
    // 楼体：受光的 PBR + 自发光窗格。
    //
    // 上一版用 MeshBasicMaterial 纯黑是为了做 TRON 的黑剪影，
    // 但那是「主动放弃细节」—— 楼变成几个色块，整个场景就空了。
    // 赛博朋克夜景的密度恰恰来自**表面信息**：
    //   · map / emissiveMap = 窗格贴图（亮窗自发光，暗窗是玻璃）
    //   · roughnessMap     = 幕墙竖肋（让反光被切碎成条状，而不是整片糊）
    //   · metalness 0.55   = 玻璃幕墙该有的反射
    // 这样一栋楼就有三种读法：近看是窗，中看是玻璃幕墙，远看是一团光。
    const winTex = windowTexture();
    const mulTex = mullionTexture();
    this.blockMat = new THREE.MeshStandardMaterial({
      map: winTex,
      emissiveMap: winTex,
      emissive: 0xffffff,
      // 自发光强度是「夜景有多亮」的总闸。1.35 让亮窗真正过曝到发白，
      // 配合 bloom 才会溢光；低于 1 就只是「贴图上画了窗」，不会发光。
      emissiveIntensity: 1.35,
      color: 0x2a3340,
      roughness: 1.0,
      roughnessMap: mulTex,
      metalness: 0.55,
      envMapIntensity: 0.85,
    });
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    blockGeo.translate(0, 0.5, 0); // 原点移到箱底，按「高」缩放即可落地
    // UV 按楼的真实尺寸缩放：每个顶点带一个 aScale（该楼的 w,h,d），
    // 在 shader 里把 uv 乘上去。否则一个 20 米宽的楼和一个 4 米宽的楼
    // 会用同一套 UV —— 前者每扇窗宽 2.5 米，后者宽 0.5 米，
    // 一栋楼看起来像公寓，另一栋像毛坯房。
    // 这里用 onBeforeCompile 注入，保留 InstancedMesh 的全部原生机能。
    // 一张窗格贴图铺出去多大（横 / 竖分开，因为窗宽和层高不同）。
// 真实写字楼：窗宽 1.2~1.5 米，层高 3.3~4 米。
// 这两个数字必须分开算 —— 用同一个值会让窗变成正方形，
// 要么太宽（看着像封板），要么太窄（远看糊成横条纹）。
const WIN_TILE_X = 7.2;   // 6 扇窗 × 1.2 米
const WIN_TILE_Y = 26.4;  // 8 层   × 3.3 米
    blockGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(BLOCK_CAP * 3), 3));
    // aUvOffset：每栋楼的 UV 起点随机偏移。
    // 没有它，全城每栋楼的窗格纹理是从同一个像素开始的 ——
    // 几十栋楼“长得一模一样”，远看就是一片规整的网格，
    // 这正是「重复、无聊」的来源。偏移一下之后每栋楼的窗型、
    // 哪一层亮、亮窗的分布全都不同，成本是每个实例多 2 个 float。
    blockGeo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(new Float32Array(BLOCK_CAP * 2), 2));
    this.blockMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWinTile = { value: new THREE.Vector2(WIN_TILE_X, WIN_TILE_Y) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aScale;
          attribute vec2 aUvOffset;
          uniform vec2 uWinTile;
          varying vec2 vWinUv;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // 顶点的局部坐标（-0.5..0.5, 0..1, -0.5..0.5）乘真实尺寸 = 米
          // 再除以「一格窗的大小」就得到按米对齐的 UV。
          // 用 local 坐标而不是 uv，是为了让相邻楼的窗格在世界上是同一套网格 ——
          // 这才是「同一个城市」，而不是每栋楼各自贴了张图。
          // aUvOffset 再给每栋楼一个随机起点，避免全城纹理同源。
          vec3 worldPos = position * aScale;
          // 用**法线**判断当前面朝向哪个轴，不能用 position 判断：
          // 箱体的顶点都在角上，四角的 |x| 同为 0.5，
          // 于是朝向 Z 的面也会走进 X 分支，U 取到的是常量 z ——
          // 整个面退化成一条竖列的颜色，看起来就是一块大白板。
          // 法线是逐面的（+X/-X 面的 normal.x = ±1），这才是能判断朝向的量。
          float uCoord = abs(normal.x) > 0.5 ? worldPos.z : worldPos.x;
          // box 已 translate(0, 0.5, 0)，position.y 现在是 0..1，直接乘高度即可
          float py = position.y * aScale.y;
          vWinUv = vec2(uCoord / uWinTile.x, py / uWinTile.y) + aUvOffset;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vWinUv;`)
        .replace('#include <map_fragment>', `
          vec4 sampledDiffuseColor = texture2D( map, vWinUv );
          diffuseColor *= sampledDiffuseColor;
        `)
        .replace('#include <emissivemap_fragment>', `
          vec4 emissiveColor = texture2D( emissiveMap, vWinUv );
          totalEmissiveRadiance *= emissiveColor.rgb;
        `);
    };
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
    const pillarGeo = new THREE.CylinderGeometry(0.22, 0.42, 1, 12, 1, true);
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
        varying float vRad;
        void main() {
          vY = position.y; // translate 之后 0..1
          vColor = instanceColor;
          // 圆柱侧面：x/z 是半径方向，归一化成 0..1 传给片元做边缘软化。
          // 圆柱半径 0.5，所以 x,z ∈ [-0.5, 0.5]，取径向长度×2 得到 0..1。
          vRad = clamp(length(position.xz) * 2.0, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vY;
        varying vec3 vColor;
        varying float vRad;
        void main() {
          // 垂直衰减 + 径向软化。
          // 之前只有垂直衰减，柱体的**横截面**是一块实心色 ——
          // 加上 bloom 就糊成一根灰白色的烟柱。
          // 真实的光柱横截面是中心亮、边缘散，所以这里再乘一次
          // 基于径向距离的衰减（vRad 由顶点着色器算好）。
          float fade = 1.0 - vY;
          fade = fade * fade * 0.90 + 0.02;
          float edge = 1.0 - vRad;
          edge = edge * edge;
          float a = fade * edge * uOpacity;
          gl_FragColor = vec4(vColor * fade, a);
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

    // 街面杂物：小体块 + 自发光（霓虹管/变压箱的指示灯）。
    // 用和楼体一样的 BoxGeometry，但更小的 CAP，且带 instanceColor ——
    // 这些小东西是画面里唯一的「非几何体」碎块，
    // 它们的价值在于**打破楼与光柱的规整感**，让街面看起来是被人用过的。
    this.propMat = new THREE.MeshStandardMaterial({
      color: 0x140c22,
      roughness: 0.55,
      metalness: 0.5,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
    });
    const propGeo = new THREE.BoxGeometry(1, 1, 1);
    propGeo.translate(0, 0.5, 0);
    this.propMesh = new THREE.InstancedMesh(propGeo, this.propMat, PROP_CAP);
    this.propMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.propMesh.count = 0;
    this.propMesh.frustumCulled = false;
    this.root.add(this.propMesh);
  }

  // 重建可视圈：只在锚点换块时跑（每走 24 米一次）。
  rebuild(force) {
    const cx = this.anchorCx;
    const cz = this.anchorCz;
    if (!force && cx === this._builtCx && cz === this._builtCz) return;
    this._builtCx = cx;
    this._builtCz = cz;

    const w = collect(cx, cz, VIEW_RADIUS);
    const scaleAttr = this.blocks.geometry.getAttribute('aScale');
    const uvOffAttr = this.blocks.geometry.getAttribute('aUvOffset');
    let bi = 0;
    let ei = 0;
    let pi = 0;
    let hi = 0;
    let si = 0;
    let qi = 0;

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
        // 每栋楼的真实尺寸写进 aScale，shader 用它把 UV 换算成「米」，
        // 于是全城的窗格是同一套网格（3.2 米一格），不会随楼变大变小。
        scaleAttr.setXYZ(bi, b.w, b.h, b.d);
        // 每栋楼的窗格纹理起点用世界坐标哈希 —— 确定性（走出去再回来一样），
        // 但楼与楼之间彼此不同。
        const hsh = ((b.x * 73856093) ^ (b.z * 19349663)) >>> 0;
        uvOffAttr.setXY(bi, (hsh & 0xffff) / 65536 * 16, ((hsh >>> 16) & 0xffff) / 65536 * 16);
        // 楼底光斑：略大于楼体（1.9 倍），贴地 0.03 米避免 z-fighting
        if (si < BLOCK_CAP) {
          tmpPos.set(b.x, 0.03, b.z);
          tmpQuat.identity();
          const spread = Math.max(b.w, b.d) * 1.9;
          tmpScale.set(spread, 1, spread);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.spills.setMatrixAt(si, tmpMat);
          tmpColor.setHex(tone);
          this.spills.setColorAt(si, tmpColor);
          si++;
        }
        // 楼体基色按 tone 轻微染色：玻璃幕墙会映出周围霓虹的颜色，
        // 所以青楼偏青、洋红楼偏洋红 —— 这是「环境反射」的廉价近似，
        // 比全楼一个色要自然得多。
        tmpColor.setHex(tone).lerp(WHITE, 0.72);
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
        // 招牌朝向：贴着楼的四个面中最接近的那一面。
        // 用坐标取模判断「朝东/南/西/北」，这样招牌永远平行于墙面，
        // 不会斜插进楼里，也不会背对街道。
        const face = ((Math.round(h.x / 3) & 1) << 1) | (Math.round(h.z / 3) & 1);
        tmpQuat.setFromAxisAngle(tmpAxis, face * (Math.PI / 2));
        tmpScale.set(h.w, h.h, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.holo.setMatrixAt(hi, tmpMat);
        tmpColor.setHex(NEON_TONES[h.tone % NEON_TONES.length]);
        this.holo.setColorAt(hi, tmpColor);
        hi++;
      }
    }
      // 街面杂物：数据在区块里（w.props 不存在，要遍历 w.chunks）
      for (const ch of w.chunks) {
        if (qi >= PROP_CAP) break;
        for (const q of ch.props) {
          if (qi >= PROP_CAP) break;
          tmpPos.set(q.x, q.y, q.z);
          tmpQuat.setFromAxisAngle(tmpAxis, q.rot);
          tmpScale.set(q.w, q.h, q.d);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.propMesh.setMatrixAt(qi, tmpMat);
          // 杂物偏暗紫：它们是「脏东西」，不该抢霓虹的注意力，
          // 只用自发光带一点点颜色，让它们在暗处有轮廓。
          tmpColor.setHex(0x2a1436).lerp(tmpColor2.setHex(NEON_TONES[q.tone % NEON_TONES.length]), 0.35);
          this.propMesh.setColorAt(qi, tmpColor);
          qi++;
        }
      }

    this.blocks.count = bi;
    this.edges.count = ei;
    this.pillars.count = pi;
    this.holo.count = hi;
    this.spills.count = si;
    this.propMesh.count = qi;
    this.blocks.instanceMatrix.needsUpdate = true;
    scaleAttr.needsUpdate = true;
    uvOffAttr.needsUpdate = true;
    this._blockScale = scaleAttr;
    this.edges.instanceMatrix.needsUpdate = true;
    this.pillars.instanceMatrix.needsUpdate = true;
    this.holo.instanceMatrix.needsUpdate = true;
    if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
    if (this.edges.instanceColor) this.edges.instanceColor.needsUpdate = true;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
    if (this.holo.instanceColor) this.holo.instanceColor.needsUpdate = true;
    this.spills.instanceMatrix.needsUpdate = true;
    if (this.spills.instanceColor) this.spills.instanceColor.needsUpdate = true;
    this.propMesh.instanceMatrix.needsUpdate = true;
    if (this.propMesh.instanceColor) this.propMesh.instanceColor.needsUpdate = true;
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
    if (!env) return;
    // 环境贴图要同时挂给三处，否则夜景的「反射」只有一半：
    //   · 楼体（玻璃幕墙）
    //   · 地面（湿沥青倒影，这是下半屏亮度与色彩的来源）
    //   · 街面光斑不需要（纯加色）
    // 之前只挂了楼体，groundMat 的 metalness 0.75 等于在对着一片黑反射 ——
    // 地面看起来永远是干的。
    if (this.blockMat && this.blockMat.envMap !== env) {
      this.blockMat.envMap = env;
      this.blockMat.needsUpdate = true;
    }
    if (this.groundMat && this.groundMat.envMap !== env) {
      this.groundMat.envMap = env;
      this.groundMat.needsUpdate = true;
    }
    if (this.spillMat && this.spillMat.envMap !== env) {
      this.spillMat.envMap = env;
      this.spillMat.needsUpdate = true;
    }
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