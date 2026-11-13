// 无尽的赛博空间：程序化区块生成（纯数据，零 DOM / 零 THREE 依赖）。
//
// 为什么单独一个文件：这张地图是「无限的」，但游戏里所有几何体都必须有限。
// 解法是把世界切成 24×24 米的区块，只保留玩家附近的一圈：
//
//   · 视觉圈 VIEW_RADIUS = 2（5×5 = 25 块，120 米见方）
//   · 碰撞圈 SOLID_RADIUS = 1（3×3 = 9 块）
//
// 碰撞圈只要 1 就够：玩家永远站在自己那一块里，周围 8 块覆盖了半径 ≥24 米的
// 全部方向，一帧走不了 24 米。视觉圈 2 是为了让雾把边界吃掉之前楼还在。
//
// 关键约束：**同样的 (cx,cz) 必须永远生成同样的内容**。
// 玩家走出去再走回来，那块地必须还是原来那块 —— 否则「记住路」这件事不成立，
// 而且服务端（双人）算出来的碰撞体必须和客户端一致。
// 所以这里全部用坐标哈希出来的确定性 RNG，不能用 Math.random。
//
// 这个文件同时被 src/world/CyberSpace.js（渲染）和 src/sim/headlessMap.js（服务端）使用。

const TAU = Math.PI * 2;

export const CHUNK = 24;
// 区块本地坐标范围是 [-12, 12]
export const HALF = CHUNK / 2;

// 视觉/碰撞半径（单位：块）。
// VIEW 4 → 9×9 = 81 块、216 米见方：玩家离锚点最多 12 米，最近的边界也永远在 96 米外，
//   正好落在雾的末端（FOG_FAR=96），所以看不见「地图没了」这件事。
// SOLID 1 → 3×3 = 9 块（±36 米）：碰撞体每帧被 Player/Zombie/弹道读，够用就行。
export const VIEW_RADIUS = 4;
export const SOLID_RADIUS = 1;

// 出生广场：这一块强制留空。玩家要有地方站，拾取点也要有净空。
export const HOME = { cx: 0, cz: 0 };
export const HOME_CLEAR = 11;

// 32 位整数哈希（FNV 变体）。负数坐标必须也能散开，所以先 |0 再乘奇数。
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// mulberry32：同一种子一定产出同一序列
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 世界坐标 → 区块索引。区块 (cx,cz) 覆盖 [cx*24-12, cx*24+12)。
export function chunkIndex(v) {
  return Math.round(v / CHUNK);
}

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

const CELLS = [-8, 0, 8];

// 盒子外沿贴一圈圆碰撞（僵尸用）。
// 间距上限：僵尸不能从两圆之间钻过去，要求 gap < 2×(r + 僵尸半径×0.8) = 2×(0.68+0.42) ≈ 2.2。
// 取 1.5 留了 30% 余量，同时比 1.05 少 1/3 的圆 —— 这张图的碰撞表每帧被
// Player / 每个 Zombie 遍历，块数多，密度必须抠。
function ringColliders(x, z, w, d, out) {
  const r = 0.68;
  const GAP = 1.5;
  const hw = Math.max(0, w / 2 - r);
  const hd = Math.max(0, d / 2 - r);
  if (hw <= 0 && hd <= 0) {
    out.push({ x, z, r });
    return;
  }
  const nx = Math.max(1, Math.ceil((hw * 2) / GAP));
  const nz = Math.max(1, Math.ceil((hd * 2) / GAP));
  for (let i = 0; i <= nx; i++) {
    const px = x - hw + ((hw * 2) / nx) * i;
    out.push({ x: px, z: z - hd, r });
    out.push({ x: px, z: z + hd, r });
  }
  for (let i = 1; i < nz; i++) {
    const pz = z - hd + ((hd * 2) / nz) * i;
    out.push({ x: x - hw, z: pz, r });
    out.push({ x: x + hw, z: pz, r });
  }
}

// 霓虹色板：渲染层按 tone 取色，数据层只存索引，避免两边色值漂移。
//
// 赛博朋克夜景的核心不是「一种色」，而是**冷暖对撞**：
// 青（技术/数据）撞洋红（欲望/商业），中间夹一层紫做过渡，
// 再留一个琥珀做「老旧白炽灯」的破败感。
// 这四个色相放在一起才是《银翼杀手》/《攻壳》的夜市，
// 单一色相只会读成「电子游戏的一关」。
export const NEON_TONES = [
  0x2ee6ff, // 青：主色，占大头
  0xff2d95, // 洋红：次级主色
  0xa855f7, // 紫：过渡
  0xffb020, // 琥珀：破败的暖光
];

// 配色权重（累加）。青 40% / 洋红 30% / 紫 20% / 琥珀 10%。
// 青和洋红是「双主色」，紫是它们之间的混色，琥珀只做点缀 ——
// 比例错了会立刻变成「彩虹」，所以这里写死成表而不是随手 rng。
const TONE_CDF = [0.40, 0.70, 0.90, 1.0];

function toneRoll(rng) {
  const v = rng();
  for (let i = 0; i < TONE_CDF.length; i++) {
    if (v < TONE_CDF[i]) return i;
  }
  return 0;
}

function pickCells(rng, n) {
  const pool = [];
  for (let i = 0; i < CELLS.length; i++) {
    for (let j = 0; j < CELLS.length; j++) pool.push([CELLS[i], CELLS[j]]);
  }
  // Fisher-Yates（用同一颗确定性 RNG）
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    const t = pool[i];
    pool[i] = pool[k];
    pool[k] = t;
  }
  return pool.slice(0, n);
}

const ARCHETYPES = ['towers', 'bridge', 'arena', 'plaza'];

// 街面杂物的尺寸谱：[基准宽, 宽随机, 基准高, 高随机, 基准深, 深随机]
// 用「几组相似的东西」而不是完全随机的尺寸，因为真实街道上的物件
// 是有规格的（垃圾桶都差不多大，路障都有标准高度）。
// 全部是低矮体（0.4~3.2 米），远看是地面的碎块，近看是小物件。
const CLUTTER_KINDS = [
  [0.55, 0.25, 0.95, 0.35, 0.55, 0.25], // 垃圾桶
  [1.6, 0.7, 0.85, 0.25, 0.22, 0.1],    // 路障栏
  [0.16, 0.06, 2.6, 1.1, 0.16, 0.06],   // 霓虹灯管立柱
  [1.1, 0.5, 0.5, 0.3, 0.8, 0.35],      // 变压箱
  [2.4, 1.2, 0.18, 0.1, 0.9, 0.4],      // 倾倒的广告板
  [0.35, 0.15, 1.3, 0.6, 0.35, 0.15],   // 消防栓/立柱
  [3.0, 1.4, 0.22, 0.08, 0.22, 0.08],   // 地面管线
];

/**
 * 生成一个区块的内容。纯函数、可缓存、可在 Node 里跑。
 *
 * @param {number} cx
 * @param {number} cz
 * @returns {{cx:number,cz:number,arche:string,blocks:Array,pillars:Array,holo:Array,props:Array,colliders:Array,platforms:Array,walls:Array}}
 */
export function chunkData(cx, cz) {
  const rng = makeRng(hash2(cx, cz) || 1);
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const home = cx === HOME.cx && cz === HOME.cz;
  const arche = home ? 'plaza' : ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];

  const blocks = [];
  const pillars = [];
  const holo = [];
  const props = [];

  const pushBlock = (bx, bz, w, d, h, tone) => {
    if (home) {
      // 出生广场上任一盒体都不能压进 HOME_CLEAR 里
      if (Math.hypot(bx, bz) < HOME_CLEAR + Math.max(w, d) * 0.5) return;
    }
    blocks.push({ x: ox + bx, z: oz + bz, w, d, h, tone });
  };

  if (arche === 'towers') {
    const n = 2 + Math.floor(rng() * 2);
    for (const [cellX, cellZ] of pickCells(rng, n)) {
      // 尺寸谱：这是「赛博朋克」和「低模方块」的分水岭。
      // 原来 4.5~7 米宽、7~15 米高 —— 只有 4~5 层，贴 6×8 的窗格图
      // 只能露出半格，屏幕上就是一块白板。
      // 真实的赛博朋克街区是**又窄又高**：楼宽 6~11 米（窄面），
      // 高 22~62 米（7~19 层），高宽比 3~6，这样才有压迫感，
      // 而且 62 米高的楼能铺下 2 张窗格贴图（每张 26.4 米），
      // 窗格才真正读得出来。
      const w = 6 + rng() * 5;
      const d = 6 + rng() * 5;
      const h = 22 + rng() * 40;
      const bx = cellX + (rng() - 0.5) * 1.4;
      const bz = cellZ + (rng() - 0.5) * 1.4;
      pushBlock(bx, bz, w, d, h, toneRoll(rng));
      // 屋顶设备：这是把「盒子」读成「楼」的关键。
      // 一个纯立方体无论贴什么纹理都是盒子；真正的楼顶有
      // 空调机组、水箱、电梯机房、天线 —— 它们打破顶部的直线，
      // 让天际线有起伏，而且给 silhouettes 提供了辨识度。
      // 高楼的屋顶还常常退台（setback），所以顶部再叠一个小一点的盒子。
      const roofN = 1 + Math.floor(rng() * 3);
      for (let ri = 0; ri < roofN; ri++) {
        const rw = 1.0 + rng() * (w * 0.55);
        const rd = 1.0 + rng() * (d * 0.55);
        props.push({
          x: ox + bx + (rng() - 0.5) * (w - rw),
          y: h,
          z: oz + bz + (rng() - 0.5) * (d - rd),
          w: rw, h: 0.7 + rng() * 2.2, d: rd,
          rot: 0,
          tone: toneRoll(rng),
        });
      }
      // 天线 / 尖塔：细高柱，只在较高的楼上出现
      if (h > 12 && rng() < 0.45) {
        props.push({
          x: ox + bx, y: h, z: oz + bz,
          w: 0.22, h: 3 + rng() * 6, d: 0.22,
          rot: 0,
          tone: toneRoll(rng),
        });
      }
      // 楼侧的招牌是一栋楼「有内容」的关键：纯窗格的楼只是办公楼，
      // 挂上竖排灯箱/巨大广告才像赛博朋克街区。
      // 每栋高楼有 65% 概率带一块招牌，挂在朝向随机的一面。
      if (h > 8 && rng() < 0.65) {
        const side = rng() < 0.5 ? 1 : -1;
        const along = rng() < 0.5;
        const sx = along ? 0 : side * (w / 2 + 0.35);
        const sz = along ? side * (d / 2 + 0.35) : 0;
        holo.push({
          x: ox + cellX + sx,
          y: 4 + rng() * (h * 0.75),
          z: oz + cellZ + sz,
          w: Math.min(3.2, w * 0.7),
          h: 1.6 + rng() * 2.4,
          tone: toneRoll(rng),
        });
      }
    }
    // 楼间一根光柱（纯装饰，不挡人）
    pillars.push({ x: ox + (rng() - 0.5) * 16, z: oz + (rng() - 0.5) * 16, h: 60 + rng() * 40, tone: toneRoll(rng) });

  } else if (arche === 'bridge') {
    // 一条横跨的高架：玩家可以从下面走过去，也能跳上两侧的矮台绕行
    const along = rng() > 0.5;
    const off = (rng() - 0.5) * 6;
    if (along) pushBlock(0, off, 21, 3.2, 2.9, toneRoll(rng));
    else pushBlock(off, 0, 3.2, 21, 2.9, toneRoll(rng));
    for (const [cellX, cellZ] of pickCells(rng, 2)) {
      const w = 4 + rng() * 2;
      pushBlock(cellX * 0.6, cellZ * 0.6, w, w, 1.2 + rng() * 0.6, toneRoll(rng));
    }
    holo.push({ x: ox + (rng() - 0.5) * 10, y: 3.6, z: oz + (rng() - 0.5) * 10, w: 4 + rng() * 2, h: 2.2, tone: toneRoll(rng) });
  } else if (arche === 'arena') {
    // 四块 1.2 米矮掩体：能跳上去、能挡子弹、能绕
    for (const [cellX, cellZ] of pickCells(rng, 3 + Math.floor(rng() * 2))) {
      const w = 3.4 + rng() * 1.6;
      pushBlock(cellX, cellZ, w, w, 1.15 + rng() * 0.25, toneRoll(rng));
    }
  } else {
    // plaza：空场 + 一根光柱 + 一块孤楼
    if (!home) {
      const [cellX, cellZ] = pickCells(rng, 1)[0];
      pushBlock(cellX, cellZ, 5 + rng() * 2, 5 + rng() * 2, 3 + rng() * 4, toneRoll(rng));
    }
    pillars.push({ x: ox + (rng() - 0.5) * 12, z: oz + (rng() - 0.5) * 12, h: 20 + rng() * 10, tone: toneRoll(rng) });
    if (!home) holo.push({ x: ox + (rng() - 0.5) * 12, y: 2.8, z: oz + (rng() - 0.5) * 12, w: 3 + rng() * 2, h: 1.8, tone: toneRoll(rng) });
  }

    // 街面杂物：赛博朋克街区的「脏」和「密」全靠这些。
    // 只有楼 + 光 + 反光仍然像展厅；真实街区有垃圾桶、路障、
    // 霓虹管、变压箱、歪倒的广告牌。它们体量小，所以不挡路（纯装饰，
    // 不加碰撞），但视觉上把地面的空白填满了。
    // 每个区块 5~9 件，散在楼与楼之间的缝隙里。
    const clutter = 8 + Math.floor(rng() * 6);
    for (let ci = 0; ci < clutter; ci++) {
      const kind = CLUTTER_KINDS[Math.floor(rng() * CLUTTER_KINDS.length)];
      const cw = kind[0] + rng() * kind[1];
      const ch = kind[2] + rng() * kind[3];
      const cd = kind[4] + rng() * kind[5];
      props.push({
        x: ox + (rng() - 0.5) * (CHUNK - 3),
        y: 0,
        z: oz + (rng() - 0.5) * (CHUNK - 3),
        w: cw, h: ch, d: cd,
        rot: rng() * TAU,
        tone: toneRoll(rng),
      });
    }
  const colliders = [];
  const platforms = [];
  const walls = [];
  for (const b of blocks) {
    platforms.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h });
    walls.push({ x: b.x, y: b.h / 2, z: b.z, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, c: 1, s: 0 });
    ringColliders(b.x, b.z, b.w, b.d, colliders);
  }
  // 光柱只挡投掷物（细柱，挡人反而碍事）
  for (const p of pillars) {
    walls.push({ x: p.x, z: p.z, r: 0.55, h: p.h });
  }

  return { cx, cz, arche, blocks, pillars, holo, props, colliders, platforms, walls };
}

// 缓存：同一块地反复取（碰撞圈每帧问、视觉圈生成时再问一次）。
// 上限 512 块，超了整体清空 —— 无限世界里长期游荡不该把内存吃掉。
const CACHE = new Map();
const CACHE_MAX = 512;

export function chunkDataCached(cx, cz) {
  const key = chunkKey(cx, cz);
  let d = CACHE.get(key);
  if (d) return d;
  if (CACHE.size > CACHE_MAX) CACHE.clear();
  d = chunkData(cx, cz);
  CACHE.set(key, d);
  return d;
}

/**
 * 收集以 (cx,cz) 为中心、半径 r 的区块内容，合并成三张表。
 *
 * @param {number} cx
 * @param {number} cz
 * @param {number} radius 单位：块
 * @returns {{colliders:Array,platforms:Array,walls:Array,chunks:Array}}
 */
export function collect(cx, cz, radius) {
  const colliders = [];
  const platforms = [];
  const walls = [];
  const chunks = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = chunkDataCached(cx + dx, cz + dz);
      chunks.push(d);
      for (let i = 0; i < d.colliders.length; i++) colliders.push(d.colliders[i]);
      for (let i = 0; i < d.platforms.length; i++) platforms.push(d.platforms[i]);
      for (let i = 0; i < d.walls.length; i++) walls.push(d.walls[i]);
    }
  }
  return { colliders, platforms, walls, chunks };
}

/**
 * 区块流场：无限地图的导航。
 *
 * FlowField 本身假设世界是 [-halfX, halfX] 的固定矩形，而这张图没有固定范围。
 * 所以这里在「锚点周围 ±48 米」的窗口上跑一份普通 FlowField，读写时把世界坐标
 * 平移成窗口局部坐标 —— FlowField 完全不知道自己是无限的。
 *
 * 窗口半径 48 米的选择：僵尸出生环在 22~29 米，攻击距离 1.5 米左右，
 * 48 米足够覆盖「从出生点绕开楼走到玩家」的整段路径；再大的窗口
 * 只是让 96×96 的 BFS 变慢，对玩家没有可见收益。
 *
 * 每次换锚点重建一次（每 24 米），不每帧重建。
 */
const NAV_HALF = CHUNK * (SOLID_RADIUS + 1); // 48

export class ChunkNav {
  constructor() {
    const n = (NAV_HALF * 2) | 0;
    const cell = 1;
    this.half = NAV_HALF;
    this.cols = n;
    this.rows = n;
    this.cell = cell;
    this.blocked = new Uint8Array(n * n);
    // BFS 用的缓冲与 dist/dir 现算现用：换锚点时整块重填，不留跨块的旧方向
    this.dist = new Int32Array(n * n);
    this.dirX = new Float32Array(n * n);
    this.dirZ = new Float32Array(n * n);
    this.queue = new Int32Array(n * n);
    this.cx = 0;
    this.cz = 0;
    this.targetX = -9999;
    this.targetZ = -9999;
    this.timer = 0;
    this.ready = false;
  }

  get anchorX() { return this.cx * CHUNK; }
  get anchorZ() { return this.cz * CHUNK; }

  // 换窗口：重栅格化障碍，清掉旧 BFS 结果。
  // platforms / colliders 是**世界坐标**，这里平移成窗口局部再算。
  rebuild(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    const ox = this.anchorX;
    const oz = this.anchorZ;
    const half = this.half;
    const cols = this.cols;
    const rows = this.rows;
    this.blocked.fill(0);

    const w = collect(cx, cz, SOLID_RADIUS + 1);
    // 平台：0.55 米 padding（与 FlowField.blockPlatforms 口径一致），
    // 低于 0.6 米的矮掩体不挡僵尸（它们能迈过去）
    for (let i = 0; i < w.platforms.length; i++) {
      const p = w.platforms[i];
      if (p.h <= 0.6) continue;
      const lx = p.x - ox;
      const lz = p.z - oz;
      const x0 = Math.max(0, Math.floor(lx - p.w * 0.5 - 0.55 + half));
      const x1 = Math.min(cols - 1, Math.floor(lx + p.w * 0.5 + 0.55 + half));
      const z0 = Math.max(0, Math.floor(lz - p.d * 0.5 - 0.55 + half));
      const z1 = Math.min(rows - 1, Math.floor(lz + p.d * 0.5 + 0.55 + half));
      for (let z = z0; z <= z1; z++) {
        const row = z * cols;
        for (let x = x0; x <= x1; x++) this.blocked[row + x] = 1;
      }
    }
    // 圆碰撞（楼体外沿的一圈）：这些和平台是同一批楼，但楼体窄边可能比平台的
    // 栅格化结果更宽（ringColliders 的圆心在楼外沿），所以两边都栅格化，
    // 取并集才不会漏掉贴边的格子。
    for (let i = 0; i < w.colliders.length; i++) {
      const c = w.colliders[i];
      const lx = c.x - ox;
      const lz = c.z - oz;
      const r = c.r + 0.45;
      const x0 = Math.max(0, Math.floor(lx - r + half));
      const x1 = Math.min(cols - 1, Math.floor(lx + r + half));
      const z0 = Math.max(0, Math.floor(lz - r + half));
      const z1 = Math.min(rows - 1, Math.floor(lz + r + half));
      for (let z = z0; z <= z1; z++) {
        const row = z * cols;
        const dz = (z + 0.5) - half - lz;
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5) - half - lx;
          if (dx * dx + dz * dz <= r * r) this.blocked[row + x] = 1;
        }
      }
    }
    this.ready = true;
    this.targetX = -9999;
  }

  // BFS：与 FlowField.update 同一套 8 邻域 + 对角穿墙检查，只是坐标要平移。
  update(x, z, dt) {
    if (!this.ready) return;
    this.timer -= dt;
    const cols = this.cols;
    const rows = this.rows;
    const half = this.half;
    const blocked = this.blocked;
    const lx = x - this.anchorX;
    const lz = z - this.anchorZ;
    let cx = Math.floor((lx + half) / this.cell);
    let cz = Math.floor((lz + half) / this.cell);
    if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
    if (cz < 0) cz = 0; else if (cz >= rows) cz = rows - 1;
    if (cx === this.targetX && cz === this.targetZ && this.timer > 0) return;
    this.targetX = cx;
    this.targetZ = cz;
    this.timer = 0.45;

    let sx = cx;
    let sz = cz;
    if (blocked[cz * cols + cx]) {
      // 玩家站在障碍格（走上矮台 / 贴墙）：找最近的空格当 BFS 起点。
      // 只搜 40 米半径而不是全窗口：全窗口 96×96 每帧搜一遍是纯浪费。
      let best = Infinity;
      sx = -1;
      const R = 40;
      for (let zz = Math.max(0, cz - R); zz <= Math.min(rows - 1, cz + R); zz++) {
        const row = zz * cols;
        for (let xx = Math.max(0, cx - R); xx <= Math.min(cols - 1, cx + R); xx++) {
          if (blocked[row + xx]) continue;
          const d = (xx - cx) * (xx - cx) + (zz - cz) * (zz - cz);
          if (d < best) { best = d; sx = xx; sz = zz; }
        }
      }
      if (sx < 0) return;
    }

    const dist = this.dist;
    const queue = this.queue;
    dist.fill(-1);
    let head = 0;
    let tail = 0;
    const start = sz * cols + sx;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      const idx = queue[head++];
      const gx = idx % cols;
      const gz = (idx / cols) | 0;
      const d = dist[idx];
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oz === 0) continue;
          const nx = gx + ox;
          const nz = gz + oz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (blocked[ni] || dist[ni] >= 0) continue;
          if (ox && oz && (blocked[gz * cols + nx] || blocked[nz * cols + gx])) continue;
          dist[ni] = d + 1;
          queue[tail++] = ni;
        }
      }
    }

    const dirX = this.dirX;
    const dirZ = this.dirZ;
    dirX.fill(0);
    dirZ.fill(0);
    for (let zz = 0; zz < rows; zz++) {
      const row = zz * cols;
      for (let xx = 0; xx < cols; xx++) {
        const idx = row + xx;
        if (blocked[idx] || dist[idx] <= 0) continue;
        let bestD = dist[idx];
        let bx = 0;
        let bz = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oz === 0) continue;
            const nx = xx + ox;
            const nz = zz + oz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            const ni = nz * cols + nx;
            if (blocked[ni]) continue;
            if (ox && oz && (blocked[row + nx] || blocked[nz * cols + xx])) continue;
            if (dist[ni] >= 0 && dist[ni] < bestD) {
              bestD = dist[ni];
              bx = ox;
              bz = oz;
            }
          }
        }
        if (bx !== 0 || bz !== 0) {
          const len = Math.hypot(bx, bz);
          dirX[idx] = bx / len;
          dirZ[idx] = bz / len;
        }
      }
    }
  }

  // 世界坐标读方向。窗口外返回 false → Zombie 退化成直线追踪（远处僵尸看得见就够）。
  flowAt(x, z, out) {
    if (!this.ready) return false;
    const cx = Math.floor((x - this.anchorX + this.half) / this.cell);
    const cz = Math.floor((z - this.anchorZ + this.half) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
    const idx = cz * this.cols + cx;
    if (this.blocked[idx]) return false;
    const dx = this.dirX[idx];
    const dz = this.dirZ[idx];
    if (dx === 0 && dz === 0) return false;
    out.x = dx;
    out.z = dz;
    return true;
  }
}

// 出生广场的净空半径：拾取点/天降阳光/出生点都靠它自证。
export function isHomeClear(x, z) {
  return Math.hypot(x, z) >= HOME_CLEAR - 0.5;
}