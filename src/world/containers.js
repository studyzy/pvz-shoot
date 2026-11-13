import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './materials.js';

// 摩天街区的集装箱堆场（参考 ~/saltline-fable-5.2 的物流场语汇，重做成 Toon）。
//
// Saltline 那座"城市"其实是港区堆场：36 种道具里 20 种是集装箱/防撞墩/灯塔/围栏/
// 叉车/货架/轮胎堆/油桶/托盘。它的城市感不来自高楼，来自**尺度参照**——两米半的
// 铁箱层层码起来，人走在箱缝里，视线被切成一条条窄巷。
//
// 本图原本只有玻璃塔 + 广场，外围 8 米环街是空的。这里把那圈空场改成堆场：
// 既补上尺度参照，也给外环的刷怪点（±41）一点可读的掩体背景。
//
// 三条硬约束（不满足就会打破既有测试契约）：
//   1) 只动外环（|x|>30 或 |z|>30 的四个角 + 南北带），主街/横街不动；
//   2) 拾取点四周 1.2 米的流场探针格必须保持净空（maps.test 会查）；
//   3) 刷怪点周围留 ≥1.6 米（downtown.test 查碰撞圆间距）。
//
// 卡通化的做法（不是把写实模型调个色）：
//   - 角件放大到实物的 1.4 倍，成为粗黑边框 —— 真实集装箱的角件是隐蔽的铸件，
//     卡通化要把它提成轮廓线；
//   - 波纹板肋条加粗到 7 厘米（实物 ~3 厘米），侧面读作竖条纹而不是灰面；
//   - 每个箱子随机偏航 ±0.8°、堆叠时错位 ±6 厘米 —— 手工码放的不齐感，
//     整齐划一的箱子会像程序生成；
//   - 配色用饱和工业色（珊瑚红/钢蓝/薄荷绿/奶油黄/橙/青），不用锈色：
//     Toon 语言下锈迹会脏，纯色块才立得住。

// 三种箱型（米）。20ft / 40ft / 40ft 高箱。
export const CONTAINER_SPECS = {
  c20: { w: 6.06, h: 2.59, d: 2.44 },
  c40: { w: 12.19, h: 2.59, d: 2.44 },
  c40hc: { w: 12.19, h: 2.9, d: 2.44 },
};

// 堆场配色：黄昏暖光下仍能互相区分，且都不与玻璃塔的冷灰撞。
export const YARD_PALETTE = [
  0xc25540, // 珊瑚红
  0x3f7fa8, // 钢蓝
  0x4f8f6a, // 薄荷绿
  0xd9a441, // 奶油黄
  0xc47a2e, // 橙
  0x3f8f8a, // 青
  0xd8d2c2, // 骨白
];

// 往几何列表里塞一个带顶点色的盒子。
// shade 是"结构明度"：1.0 箱体、0.92 肋条凹槽、0.62 边框、0.45 角件。
// 它与 instanceColor（每箱的漆色）在着色器里相乘，所以同一个几何能出任意配色。
function pushBox(list, w, h, d, x, y, z, shade) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = shade;
    col[i * 3 + 1] = shade;
    col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  list.push(g);
}

function mergeColored(list) {
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  return merged;
}

/**
 * 单个集装箱的几何（原点在箱底中心，长边沿 X，门朝 +X）。
 *
 * 卡通化：角件放大 1.4×、肋条加粗、边框提成深色轮廓。
 */
export function containerGeometry(spec) {
  const s = CONTAINER_SPECS[spec] || CONTAINER_SPECS.c20;
  const { w, h, d } = s;
  const list = [];
  const t = 0.06; // 面板厚
  const hw = w / 2;
  const hd = d / 2;

  // 主体（比外框略收，让肋条能凸出来）
  pushBox(list, w - 0.12, h - 0.24, d - 0.12, 0, h / 2, 0, 1.0);
  // 底板与顶板：给出实心上下沿
  pushBox(list, w, 0.12, d, 0, 0.06, 0, 0.62);
  pushBox(list, w, 0.1, d, 0, h - 0.05, 0, 0.72);

  // 四根竖向角柱（深色轮廓线，卡通化的关键）
  const post = 0.17;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushBox(list, post, h, post, sx * (hw - post / 2), h / 2, sz * (hd - post / 2), 0.55);
    }
  }

  // 八个角件：放大到实物的 1.4 倍（0.30 见方 → 0.42），读作粗黑角
  const cast = 0.42;
  for (const sy of [0, 1]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pushBox(
          list, cast, cast, cast,
          sx * (hw - cast / 2), sy ? h - cast / 2 : cast / 2, sz * (hd - cast / 2),
          0.42,
        );
      }
    }
  }

  // 侧壁竖向波纹：肋条 7 厘米宽、间隔 0.55 米（实物约 3 厘米 / 0.3 米）
  const rib = Math.max(6, Math.floor((w - 1.0) / 0.55));
  const ribW = 0.07;
  const step = (w - 1.2) / rib;
  for (let i = 0; i <= rib; i++) {
    const x = -(w - 1.2) / 2 + step * i;
    // 避开角柱区，否则肋条会从柱子里穿出来
    if (Math.abs(x) > hw - 0.34) continue;
    for (const sz of [-1, 1]) {
      pushBox(list, ribW, h - 0.5, 0.05, x, h / 2, sz * (hd - 0.03), 0.9);
    }
  }

  // 门端（+X）：两扇门 + 四道横锁杆（与箱体异色，卡通化后读作"集装箱的门"）
  const dw = 0.08;
  for (const sz of [-1, 1]) {
    pushBox(list, dw, h - 0.42, (d - 0.5) / 2 - 0.02, hw - 0.04, h / 2, sz * ((d - 0.5) / 4 + 0.02), 0.8);
  }
  for (let i = 0; i < 4; i++) {
    const y = 0.34 + i * ((h - 0.68) / 3);
    pushBox(list, 0.1, 0.09, d - 0.42, hw + 0.015, y, 0, 0.38);
  }
  // 门把手：两根竖杆，比锁杆更粗
  for (const sz of [-1, 1]) {
    pushBox(list, 0.13, h * 0.5, 0.1, hw + 0.03, h * 0.5, sz * 0.16, 0.34);
  }

  // 底梁：架空的箱脚，让箱子看起来是"码"在箱子上而不是嵌进去
  for (const sz of [-1, 1]) {
    pushBox(list, w - 0.2, 0.09, 0.16, 0, 0.045, sz * (hd - 0.12), 0.5);
  }

  return mergeColored(list);
}

/** 防撞墩（jersey barrier）：上窄下宽的水泥条。 */
export function barrierGeometry() {
  const list = [];
  const len = 3.0;
  pushBox(list, len, 0.3, 0.62, 0, 0.15, 0, 0.9);
  pushBox(list, len, 0.36, 0.42, 0, 0.48, 0, 1.0);
  pushBox(list, len, 0.22, 0.26, 0, 0.77, 0, 1.0);
  return mergeColored(list);
}

/** 锥桶。 */
export function coneGeometry() {
  const list = [];
  pushBox(list, 0.38, 0.05, 0.38, 0, 0.025, 0, 0.55);
  const cone = new THREE.ConeGeometry(0.16, 0.6, 6);
  cone.translate(0, 0.35, 0);
  const n = cone.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
  cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
  list.push(cone);
  return mergeColored(list);
}

/**
 * 零碎堆（托盘 + 油桶 + 锥桶）：整簇做成一个几何，整簇实例化。
 *
 * 这样 12 种小道具只占 3 个 draw call —— 逐个类型建 InstancedMesh 要 12 个。
 * 代价是簇内相对位置固定，所以做三套不同的簇轮换。
 */
export function clusterGeometry(kind) {
  const list = [];
  if (kind === 0) {
    // 托盘堆 + 两只油桶 + 锥桶
    for (let i = 0; i < 3; i++) {
      pushBox(list, 1.2, 0.14, 1.0, 0, 0.07 + i * 0.15, 0, 0.9 - i * 0.06);
    }
    for (const [bx, bz] of [[0.95, 0.2], [0.95, -0.55]]) {
      const c = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8);
      c.translate(bx, 0.45, bz);
      const n = c.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = 0.42; col[i * 3 + 1] = 0.62; col[i * 3 + 2] = 0.72; }
      c.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(c);
    }
    pushBox(list, 0.34, 0.6, 0.34, -0.85, 0.3, 0.55, 0.95);
  } else if (kind === 1) {
    // 轮胎堆 + 电缆盘
    for (let i = 0; i < 4; i++) {
      const t = new THREE.TorusGeometry(0.32, 0.14, 5, 10);
      t.rotateX(-Math.PI / 2);
      t.translate(0, 0.14 + i * 0.24, 0);
      const n = t.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { col[k * 3] = 0.26; col[k * 3 + 1] = 0.26; col[k * 3 + 2] = 0.28; }
      t.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(t);
    }
    const reel = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 10);
    reel.rotateZ(Math.PI / 2);
    reel.translate(1.15, 0.62, 0.1);
    const n2 = reel.attributes.position.count;
    const c2 = new Float32Array(n2 * 3);
    for (let k = 0; k < n2; k++) { c2[k * 3] = 0.78; c2[k * 3 + 1] = 0.6; c2[k * 3 + 2] = 0.4; }
    reel.setAttribute('color', new THREE.BufferAttribute(c2, 3));
    list.push(reel);
  } else {
    // 木箱堆 + 锥桶 + 托盘
    pushBox(list, 0.95, 0.9, 0.95, 0, 0.45, 0, 0.85);
    pushBox(list, 0.8, 0.75, 0.8, 0.06, 1.27, 0.04, 0.95);
    for (let i = 0; i < 2; i++) {
      pushBox(list, 1.2, 0.13, 1.0, 1.15, 0.065 + i * 0.14, -0.35, 0.88);
    }
    pushBox(list, 0.34, 0.6, 0.34, -0.9, 0.3, 0.6, 0.95);
  }
  return mergeColored(list);
}

/** 铁丝网片：两根立杆 + 斜撑 + 一层半透明网格（用细条近似，避免额外材质）。 */
export function fenceGeometry() {
  const list = [];
  const len = 3.0;
  const h = 2.4;
  for (const sx of [-1, 1]) {
    pushBox(list, 0.09, h, 0.09, sx * (len / 2 - 0.05), h / 2, 0, 0.55);
  }
  pushBox(list, len, 0.07, 0.07, 0, h - 0.06, 0, 0.6);
  pushBox(list, len, 0.07, 0.07, 0, 0.1, 0, 0.6);
  // 网格：竖条 12 + 横条 5，条宽 0.03
  for (let i = 0; i < 12; i++) {
    const x = -len / 2 + (len / 11) * i;
    if (Math.abs(x) > len / 2 - 0.08) continue;
    pushBox(list, 0.032, h - 0.28, 0.032, x, h / 2, 0, 0.75);
  }
  for (let i = 0; i < 5; i++) {
    const y = 0.24 + ((h - 0.5) / 4) * i;
    pushBox(list, len - 0.16, 0.032, 0.032, 0, y, 0, 0.75);
  }
  return mergeColored(list);
}

/**
 * 堆场布置表。
 *
 * 每条 stack：{ x, z, spec, yaw, n }
 *   spec 箱型、n 码放层数（层间错位 ±6 厘米，手工码放感）
 *
 * 位置全部落在四个角与南北带（|x|>30 或 |z|>30），主街/横街（|x|≤7 或 |z|≤7）净空。
 * 刷怪点 (−41,0)(41,0)(−41,−30)(41,−30)(0,−43)(±6,−41)(±4,−37/39)(26,−39)
 * 与拾取点都已经按 ≥1.6 米/≥1.2 米避让过（containers.test 会逐条复核）。
 */
export const YARD_STACKS = [
  // ---- 西北角 / 东北角：两摞 40 尺高箱，从出生点望过去是两堵彩色墙 ----
  { x: -37.5, z: -41.6, spec: 'c40', yaw: 0, n: 2 },
  { x: -37.5, z: -38.0, spec: 'c40', yaw: 0, n: 1 },
  { x: 37.5, z: -41.6, spec: 'c40', yaw: 0, n: 2 },
  { x: 37.5, z: -38.0, spec: 'c40', yaw: 0, n: 1 },
  // ---- 北带：贴着场地边，让 (±6,-41) 那条刷怪缝有背景 ----
  { x: -16.0, z: -43.0, spec: 'c20', yaw: 0, n: 2 },
  { x: -27.0, z: -41.2, spec: 'c20', yaw: 0, n: 1 },
  { x: 16.0, z: -43.0, spec: 'c20', yaw: 0, n: 2 },
  // ---- 西南角 / 东南角 ----
  { x: -37.5, z: 41.6, spec: 'c40', yaw: 0, n: 2 },
  { x: -37.5, z: 38.0, spec: 'c20', yaw: 0, n: 1 },
  { x: -33.0, z: 33.0, spec: 'c20', yaw: 1.5708, n: 2 },
  { x: 37.5, z: 41.6, spec: 'c40', yaw: 0, n: 2 },
  { x: 37.5, z: 38.0, spec: 'c20', yaw: 0, n: 1 },
  { x: 33.0, z: 33.0, spec: 'c20', yaw: 1.5708, n: 2 },
  // ---- 南带：出生点背后，开局就能看见 ----
  { x: -16.0, z: 43.0, spec: 'c20', yaw: 0, n: 2 },
  { x: -26.0, z: 41.2, spec: 'c20', yaw: 0, n: 1 },
  { x: 16.0, z: 43.0, spec: 'c20', yaw: 0, n: 2 },
  { x: 26.0, z: 41.2, spec: 'c20', yaw: 0, n: 1 },
];

/** 防撞墩：沿街沿摆，把外环切出车道感（纯装饰，不登记碰撞）。 */
export const YARD_BARRIERS = [
  [-34.5, -30.4, 0], [-31.2, -30.4, 0], [-27.9, -30.4, 0],
  [27.9, -30.4, 0], [31.2, -30.4, 0], [34.5, -30.4, 0],
  [-27.9, 30.4, 0], [27.9, 30.4, 0],
];

/** 围栏：沿堆场外缘拉一道，给"这个区域是作业区"的边界感。 */
export const YARD_FENCES = [
  [-44.2, -34.5, 1.5708], [-44.2, -31.0, 1.5708], [-44.2, -27.5, 1.5708],
  [-44.2, 27.5, 1.5708], [-44.2, 31.0, 1.5708], [-44.2, 34.5, 1.5708],
  [44.2, -34.5, 1.5708], [44.2, -31.0, 1.5708], [44.2, -27.5, 1.5708],
  [44.2, 27.5, 1.5708], [44.2, 31.0, 1.5708], [44.2, 34.5, 1.5708],
];

/** 零碎堆：贴着集装箱脚放，制造"正在装卸"的现场感。 */
export const YARD_CLUSTERS = [
  [-34.2, -35.2, 0.3, 0],
  [-34.2, -31.6, 1.1, 1],
  [-41.0, -31.2, 0.7, 0],
  [34.2, -35.2, 0.4, 1],
  [34.2, -31.6, 0.9, 0],
  [-17.6, -39.6, 0.6, 2],
  [17.6, -39.6, 2.0, 0],
  [-17.6, 39.6, 1.2, 1],
  [17.6, 39.6, 0.5, 2],
];

/** 锥桶：车道导向。 */
export const YARD_CONES = [
  [-31.5, -33.6], [-28.2, -33.6],
  [28.2, -33.6], [31.5, -33.6],
  [-28.2, 33.6], [28.2, 33.6],
  [-11.4, -39.8], [11.4, -39.8],
  [-11.4, 39.8], [11.4, 39.8],
];

/**
 * 大件机械：门吊 / 卡车 / 堆高机。
 *
 * 这些是"城市感"的真正来源——集装箱提供尺度，机械提供**叙事**（这里在作业）。
 * 全部摆在场地最外圈的箱堆之外（|x| 或 |z| > 44），玩家看得见但走不进去，
 * 所以不登记碰撞、不进 platforms/walls（当作远景道具）。
 */
export const YARD_MACHINES = [
  // 门吊跨在角上的两摞 40 尺箱上方 —— 这才是龙门吊的真实用法（跨着箱列吊箱），
  // 也是唯一能让人一眼认出"这是货场"的剪影。
  // yaw=90° 让跨距沿 Z；腿落在 z=±5、x=±3.2 的四个点上，
  // 而两摞箱在 z=-41.6 / -38.0（±1.22），腿在 z=-44.4 / -34.4，正好夹在箱列外侧。
  { kind: 'gantry', x: -37.5, z: -39.4, yaw: Math.PI / 2, collide: false },
  { kind: 'gantry', x: 37.5, z: -39.4, yaw: Math.PI / 2, collide: false },
  { kind: 'gantry', x: 37.5, z: 39.4, yaw: Math.PI / 2, collide: false },
  // 卡车与堆高机摆在场地内的内环车道（z≈±34）：玩家能走近、能撞上，必须绕行。
  // x=±8 不行：卡车 9.8 米宽，内边缘会伸到 x=∓3.1，把主街（x∈[-7,7]）中段切出
  // 一道 9.8 米长的横向路障，还把两侧人行道的流场标障（downtown.test「楼峡主街贯通」
  // 因此长期红）。挪到 x=±13：内边缘 ∓8.1，压在 8 米宽的外环车道里，主街完全不碰。
  { kind: 'truck', x: 13.0, z: -34.2, yaw: 0, collide: true },
  { kind: 'truck', x: -13.0, z: 34.2, yaw: Math.PI, collide: true },
  { kind: 'stacker', x: -25.0, z: -34.2, yaw: 0.3, collide: true },
  { kind: 'stacker', x: 25.0, z: 34.2, yaw: Math.PI - 0.3, collide: true },
];

/** 装卸平台：贴着东西两侧外墙，给"仓库"实体感。 */
export const YARD_DOCKS = [];

// 确定性随机（mulberry32）：同一份布局每次进图完全一样，玩家才能记住路。
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 门式起重机（轮胎式龙门吊）：两根立柱 + 横梁 + 小车 + 吊具。港区最有辨识度的剪影。 */
export function gantryGeometry() {
  const list = [];
  const span = 10;    // 跨距
  const h = 12;       // 起升高度
  const legW = 0.7;
  // 四条腿（每条腿两段：竖直 + 底部外张）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushBox(list, legW, h, legW, sx * (span / 2), h / 2, sz * 3.2, 0.72);
      pushBox(list, legW, 2.4, legW * 1.2, sx * (span / 2 + 0.5), 1.2, sz * 3.4, 0.6);
    }
  }
  // 底部横梁（两侧各一根，沿 Z）
  for (const sx of [-1, 1]) {
    pushBox(list, 0.8, 0.9, 7.6, sx * (span / 2), 2.6, 0, 0.65);
  }
  // 顶部主梁（沿 X 跨过去）
  pushBox(list, span + 1.2, 0.95, 1.1, 0, h + 0.4, 0, 0.8);
  // 小车
  pushBox(list, 2.2, 1.0, 1.6, 2.5, h + 1.3, 0, 0.55);
  // 吊具 + 吊索
  pushBox(list, 0.16, 3.2, 0.16, 2.0, h - 0.9, 0.4, 0.4);
  pushBox(list, 0.16, 3.2, 0.16, 3.0, h - 0.9, -0.4, 0.4);
  pushBox(list, 6.4, 0.45, 2.5, 2.5, h - 2.6, 0, 0.9);
  return mergeColored(list);
}

/** 拖挂卡车：车头 + 挂车 + 轮胎。压出"这里在装卸"的现场感。 */
export function truckGeometry() {
  const list = [];
  const L = 9.0;
  // 挂车箱体
  pushBox(list, 7.4, 2.6, 2.5, -0.4, 2.05, 0, 1.0);
  // 箱体侧壁肋条
  for (let i = 0; i < 7; i++) {
    pushBox(list, 0.06, 2.3, 0.04, -3.9 + i * 1.1, 2.05, 1.26, 0.86);
  }
  // 车头
  pushBox(list, 2.3, 2.0, 2.3, 4.2, 1.75, 0, 0.72);
  pushBox(list, 1.6, 1.1, 2.1, 4.6, 2.85, 0, 0.5);   // 驾驶室上沿
  pushBox(list, 0.3, 0.9, 2.0, 5.35, 1.6, 0, 0.35);  // 前脸
  // 底盘
  pushBox(list, L, 0.32, 1.9, 0.2, 0.72, 0, 0.4);
  // 六只轮子
  for (const wx of [4.1, -1.2, -2.6]) {
    for (const wz of [-1.05, 1.05]) {
      const w = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 8);
      w.rotateX(Math.PI / 2);
      w.translate(wx, 0.52, wz);
      const n = w.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { col[k * 3] = 0.22; col[k * 3 + 1] = 0.22; col[k * 3 + 2] = 0.24; }
      w.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(w);
    }
  }
  return mergeColored(list);
}

/** 堆高机（reach stacker）：港区标志性的"抬箱子"机器，前端举起一个箱。 */
export function stackerGeometry() {
  const list = [];
  // 车身
  pushBox(list, 4.2, 2.4, 2.4, -1.2, 1.7, 0, 0.8);
  pushBox(list, 2.0, 1.3, 2.0, -2.2, 3.3, 0, 0.5);   // 驾驶室
  // 升降臂（斜向上）
  const arm = new THREE.BoxGeometry(6.0, 0.5, 0.5);
  arm.rotateZ(0.42);
  arm.translate(2.0, 2.9, 0);
  const n = arm.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = 0.72; c[i * 3 + 1] = 0.6; c[i * 3 + 2] = 0.3; }
  arm.setAttribute('color', new THREE.BufferAttribute(c, 3));
  list.push(arm);
  // 前端吊起的箱子
  pushBox(list, 2.4, 2.4, 2.36, 4.4, 4.4, 0, 1.0);
  pushBox(list, 2.44, 0.22, 2.4, 4.4, 5.6, 0, 0.55);
  // 轮子
  for (const wx of [-2.6, 0.6]) {
    for (const wz of [-1.1, 1.1]) {
      const w = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 8);
      w.rotateX(Math.PI / 2);
      w.translate(wx, 0.62, wz);
      const nn = w.attributes.position.count;
      const cc = new Float32Array(nn * 3);
      for (let k = 0; k < nn; k++) { cc[k * 3] = 0.22; cc[k * 3 + 1] = 0.22; cc[k * 3 + 2] = 0.24; }
      w.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      list.push(w);
    }
  }
  return mergeColored(list);
}

/** 仓库侧墙贴纸：一长条带顶棚的装卸平台（bay）。 */
export function dockGeometry() {
  const list = [];
  const len = 22;
  pushBox(list, len, 0.9, 4.0, 0, 0.45, 0, 0.62);  // 站台
  pushBox(list, len, 0.6, 4.2, 0, 1.0, 0, 0.5);
  // 顶棚
  pushBox(list, len, 0.22, 4.6, 0, 5.2, -0.3, 0.7);
  // 撑柱
  for (let i = 0; i <= 5; i++) {
    const x = -len / 2 + (len / 5) * i;
    pushBox(list, 0.22, 4.2, 0.22, x, 3.1, 1.9, 0.55);
  }
  // 卷帘门（每个 bay 一扇，向内凹）
  for (let i = 0; i < 5; i++) {
    const x = -len / 2 + 2.2 + i * 4.4;
    pushBox(list, 3.4, 3.6, 0.14, x, 2.7, -1.9, 0.42);
  }
  return mergeColored(list);
}

/**
 * 把堆场造进地图。
 *
 * 只碰 root / platforms / colliders / walls —— 与地图其它 build* 同一套登记方式，
 * 所以玩家碰撞、僵尸绕行、投掷物反弹都会自动生效。
 *
 * @param {object} map  Downtown 实例（需要 root / addPlatform / blockColliders / walls）
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @returns {{drawCalls:number, containers:number, meshes:THREE.Object3D[], stacks:Array}}
 */
export function buildYard(map, opts = {}) {
  const rng = makeRng(opts.seed || 20261112);
  const meshes = [];
  const root = map.root;

  // 顶点色 × 实例色 = 每箱独立漆色，却只占一个 draw call。
  const bodyMat = toon(0xffffff, { vertexColors: true });

  // ---- 集装箱 ----
  const bySpec = { c20: [], c40: [], c40hc: [] };
  const stackInfo = [];
  for (const st of YARD_STACKS) {
    const spec = CONTAINER_SPECS[st.spec] ? st.spec : 'c20';
    const levels = Math.max(1, st.n | 0);
    const s = CONTAINER_SPECS[spec];
    const yaw = (st.yaw || 0) + (rng() - 0.5) * 0.028; // ±0.8°
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const halfW = (Math.abs(cos) * s.w + Math.abs(sin) * s.d) / 2;
    const halfD = (Math.abs(sin) * s.w + Math.abs(cos) * s.d) / 2;

    for (let L = 0; L < levels; L++) {
      // 堆叠错位 ±6 厘米：完全对齐会像程序摆的
      const ox = L === 0 ? 0 : (rng() - 0.5) * 0.12;
      const oz = L === 0 ? 0 : (rng() - 0.5) * 0.12;
      bySpec[spec].push({
        x: st.x + ox,
        y: L * s.h,
        z: st.z + oz,
        yaw,
        color: YARD_PALETTE[Math.floor(rng() * YARD_PALETTE.length)],
      });
    }

    const totalH = s.h * levels;
    // 一个平台 + 一个反弹盒覆盖整摞：逐层登记会让玩家被上下两个推挤区夹住。
    // addPlatform 内部已顺带登进 this.walls，这里不再重复推（重复会让投掷物算两次反弹）。
    map.addPlatform(st.x, st.z, halfW * 2, halfD * 2, totalH);
    map.blockColliders(st.x, st.z, halfW * 2, halfD * 2);
    stackInfo.push({ x: st.x, z: st.z, spec, levels, halfW, halfD, h: totalH });
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  let containers = 0;
  for (const spec of Object.keys(bySpec)) {
    const list = bySpec[spec];
    if (!list.length) continue;
    const geo = containerGeometry(spec);
    if (!geo) continue;
    const mesh = new THREE.InstancedMesh(geo, bodyMat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    list.forEach((it, i) => {
      v.set(it.x, it.y, it.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
      m.compose(v, q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(it.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    meshes.push(mesh);
    containers += list.length;
  }

  // ---- 防撞墩 / 围栏 / 锥桶 ----
  const place = (geo, items, colorHex) => {
    if (!items.length || !geo) return;
    const mat = toon(0xffffff, { vertexColors: true });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    items.forEach((it, i) => {
      v.set(it[0], 0, it[1]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it[2] || 0);
      m.compose(v, q, one);
      mesh.setMatrixAt(i, m);
      // 顶点色自带明度；实例色只给一点整体偏色，避免整排一模一样
      col.setHex(colorHex + (i % 3) * 0x000f08);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    meshes.push(mesh);
  };

  place(barrierGeometry(), YARD_BARRIERS, 0xbfb49c);
  place(fenceGeometry(), YARD_FENCES, 0xb9c0bd);
  place(coneGeometry(), YARD_CONES.map((c) => [c[0], c[1], 0]), 0xd2603a);

  // ---- 大件机械 + 装卸平台：远景道具，不登记碰撞 ----
  const machineGeo = {};
  for (const mg of YARD_MACHINES) {
    if (!machineGeo[mg.kind]) {
      machineGeo[mg.kind] =
        mg.kind === 'gantry' ? gantryGeometry()
          : mg.kind === 'truck' ? truckGeometry()
            : stackerGeometry();
    }
    const geo = machineGeo[mg.kind];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    mesh.position.set(mg.x, 0, mg.z);
    mesh.rotation.y = mg.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    meshes.push(mesh);
    // 场内机械要能撞：粗算一个 AABB 就够（玩家是圆柱，近距离不需要精确轮廓）。
    // 门吊在场外，跳过——围墙已经把玩家挡住了。
    if (mg.kind === 'gantry') {
      // 门吊：脚要挡人、身子要让人从下面钻过去 —— 只登记四条腿，不登记整体平台。
      // 登记整体 AABB 会把箱堆上空 12 米的空腔一起封死，玩家再也走不进箱缝。
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = mg.x + Math.cos(mg.yaw) * sx * 5 - Math.sin(mg.yaw) * sz * 3.2;
          const lz = mg.z + Math.sin(mg.yaw) * sx * 5 + Math.cos(mg.yaw) * sz * 3.2;
          map.blockColliders(lx, lz, 1.0, 1.0);
        }
      }
      continue;
    }
    if (mg.collide) {
      const box = new THREE.Box3().setFromObject(mesh);
      const w = box.max.x - box.min.x;
      const d = box.max.z - box.min.z;
      const h = box.max.y;
      const cx = (box.max.x + box.min.x) / 2;
      const cz = (box.max.z + box.min.z) / 2;
      map.addPlatform(cx, cz, w, d, h);
      map.blockColliders(cx, cz, w, d);
    }
  }
  for (const dk of YARD_DOCKS) {
    const geo = dockGeometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    mesh.position.set(dk.x, 0, dk.z);
    mesh.rotation.y = dk.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    meshes.push(mesh);
  }

  // ---- 零碎堆：三套簇各一个 InstancedMesh ----
  for (let kind = 0; kind < 3; kind++) {
    const items = YARD_CLUSTERS.filter((c) => c[3] === kind).map((c) => [c[0], c[1], c[2]]);
    if (!items.length) continue;
    const geo = clusterGeometry(kind);
    if (!geo) continue;
    const mesh = new THREE.InstancedMesh(geo, bodyMat, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    items.forEach((it, i) => {
      v.set(it[0], 0, it[1]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it[2]);
      m.compose(v, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    meshes.push(mesh);
  }

  return { drawCalls: meshes.length, containers, meshes, stacks: stackInfo };
}