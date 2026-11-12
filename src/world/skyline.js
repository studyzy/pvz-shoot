import * as THREE from 'three';

// 远景剪影（docs/plans/2026-11-12-render-overhaul.md §3.3）。
//
// 场地边界外现在是空的：走到边缘往外看，天直接接在地面上 —— 这个游戏的世界只有
// 一个 23×23 的盒子。补一圈远处屋顶/树线/山脊，成本约 2 个 draw call，
// 但让「世界比场地大」这件事成立了。
//
// 三条硬约束：
//   1) 不接阴影、不吃雾（fog: false，颜色自己算好远景色）
//   2) 不参与碰撞、不进拾取/寻路（只是一圈装饰）
//   3) 必须在玩家走到的任何位置都「在背后」，所以半径远大于场地半宽（默认 260 米）

// 每张图的远景配方。color 是远景色（已被大气吃掉的样子），h 是轮廓高度范围。
export const SKYLINE_PRESETS = {
  backyard: { kind: 'trees', color: 0x7d9c74, color2: 0x9db894, h: [8, 22], count: 64, radius: 260 },
  snow: { kind: 'peaks', color: 0xc8d8e8, color2: 0xe4eef8, h: [22, 62], count: 40, radius: 300 },
  dust: { kind: 'houses', color: 0xc9b088, color2: 0xe0cba4, h: [6, 16], count: 52, radius: 270 },
  forest: { kind: 'trees', color: 0x11202f, color2: 0x182b3d, h: [16, 40], count: 80, radius: 240 },
  cloud: { kind: 'peaks', color: 0xdcc8b4, color2: 0xf2e0cc, h: [10, 34], count: 36, radius: 280 },
  downtown: { kind: 'towers', color: 0x2e2740, color2: 0x453a56, h: [40, 150], count: 56, radius: 340 },
};

// 稳定的伪随机：同一张图每次进来轮廓都一样（用种子重建，不用 Math.random）
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 一棵树：一个锥体的两种高度叠出来，够远处看
function treeGeometry(rng, hMin, hMax) {
  const geos = [];
  const h = hMin + rng() * (hMax - hMin);
  const w = h * (0.22 + rng() * 0.14);
  const c = new THREE.ConeGeometry(w, h, 5);
  c.translate(0, h / 2, 0);
  geos.push(c);
  return geos;
}

// 一排房子/仓库：一个盒 + 一个斜顶（用四棱锥近似）
function houseGeometry(rng, hMin, hMax) {
  const geos = [];
  const h = hMin + rng() * (hMax - hMin);
  const w = h * (1.2 + rng() * 1.4);
  const d = h * (0.8 + rng() * 0.7);
  const b = new THREE.BoxGeometry(w, h, d);
  b.translate(0, h / 2, 0);
  geos.push(b);
  const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.35, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, h + h * 0.175, 0);
  geos.push(roof);
  return geos;
}

// 山脊：一个扁平的锥，底部压到地平线下
function peakGeometry(rng, hMin, hMax) {
  const geos = [];
  const h = hMin + rng() * (hMax - hMin);
  const w = h * (1.6 + rng() * 1.8);
  const c = new THREE.ConeGeometry(w, h, 6);
  c.translate(0, h / 2 - h * 0.15, 0);
  geos.push(c);
  return geos;
}

// 楼群：两个错开的盒（主楼 + 塔冠）
function towerGeometry(rng, hMin, hMax) {
  const geos = [];
  const h = hMin + rng() * (hMax - hMin);
  const w = h * (0.26 + rng() * 0.2);
  const d = h * (0.22 + rng() * 0.2);
  const b = new THREE.BoxGeometry(w, h, d);
  b.translate(0, h / 2, 0);
  geos.push(b);
  if (rng() > 0.45) {
    const ch = h * (0.1 + rng() * 0.14);
    const c = new THREE.BoxGeometry(w * 0.45, ch, d * 0.45);
    c.translate(0, h + ch / 2, 0);
    geos.push(c);
  }
  return geos;
}

const BUILDERS = {
  trees: treeGeometry,
  houses: houseGeometry,
  peaks: peakGeometry,
  towers: towerGeometry,
};

/**
 * 创建远景剪影圈。
 *
 * 性能：所有轮廓合并成一个几何（按材质分 2 组），所以是 2 个 draw call。
 *
 * @param {object} opts
 * @param {string} opts.preset  SKYLINE_PRESETS 的 key
 * @param {number} [opts.half]  场地半宽（决定内圈避开多少）
 * @returns {{mesh:THREE.Mesh, setPreset:Function, update:Function, dispose:Function}}
 */
export function createSkyline(opts = {}) {
  const group = new THREE.Group();
  group.name = 'skyline';

  // 两层材质：近的一批深一点、远的一批浅一点（大气透视的最廉价版）
  const matNear = new THREE.MeshBasicMaterial({ color: 0x7d9c74, fog: false, toneMapped: true });
  const matFar = new THREE.MeshBasicMaterial({ color: 0x9db894, fog: false, toneMapped: true });
  matNear.name = 'skyline-near';
  matFar.name = 'skyline-far';

  let currentId = null;
  let geos = []; // 记录本次生成的几何，切图时 dispose

  const api = {
    group,

    setPreset(id) {
      if (id === currentId) return api;
      currentId = id;
      const p = SKYLINE_PRESETS[id] || SKYLINE_PRESETS.backyard;
      const rng = makeRng(hashId(id));
      const build = BUILDERS[p.kind] || treeGeometry;

      // 清掉上一张图
      for (const child of [...group.children]) group.remove(child);
      for (const g of geos) g.dispose();
      geos = [];

      matNear.color.setHex(p.color);
      matFar.color.setHex(p.color2);

      const near = [];
      const far = [];
      const R = p.radius;
      const n = Math.max(8, p.count | 0);
      for (let i = 0; i < n; i++) {
        // 均匀铺一圈，但允许一点抖动，避免看得出等距
        const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * (Math.PI * 2 / n) * 0.7;
        const isFar = i % 2 === 1;
        const r = isFar ? R * (1.05 + rng() * 0.25) : R * (0.86 + rng() * 0.12);
        const sub = build(rng, p.h[0], p.h[1]);
        for (const g of sub) {
          g.rotateY(rng() * Math.PI * 2);
          g.translate(Math.cos(a) * r, -2, Math.sin(a) * r);
          (isFar ? far : near).push(g);
        }
      }

      // 按层合并成两个 mesh（每层 1 个 draw call）
      const mergeInto = (list, mat) => {
        if (!list.length) return null;
        const merged = mergeGeos(list);
        if (!merged) return null;
        geos.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.frustumCulled = false; // 一圈环绕，包围盒没意义
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = -500; // 在天空之后、场景之前
        group.add(mesh);
        return mesh;
      };
      mergeInto(far, matFar);
      mergeInto(near, matNear);
      // 散落的源几何已经并进 merged，可以释放
      for (const g of near.concat(far)) if (!geos.includes(g)) g.dispose();
      return api;
    },

    // 剪影不跟相机走（要的是「远处有个世界」的感觉）；这里留接口给未来做视差
    update() {},

    dispose() {
      for (const child of [...group.children]) group.remove(child);
      for (const g of geos) g.dispose();
      geos = [];
      matNear.dispose();
      matFar.dispose();
    },
  };

  api.setPreset(opts.preset || 'backyard');
  return api;
}

// BufferGeometryUtils.mergeGeometries 的轻量替代：只处理非索引 + 只有 position 的情况。
// 这里所有几何都是同一套属性（position），所以手动拼接比引入 utils 更可控，
// 也避免在 jsdom 里因为 utils 依赖 DOM 而炸。
function mergeGeos(list) {
  if (!list.length) return null;
  // 先统一转成非索引再统计：BoxGeometry/ConeGeometry 都是 indexed，
  // toNonIndexed 之后顶点数会变（统计时用了旧 count 就会越界）。
  const flat = [];
  for (const g of list) {
    if (!g.getAttribute('position')) {
      for (const f of flat) f.dispose();
      return null;
    }
    flat.push(g.index ? g.toNonIndexed() : g);
  }
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const arr = new Float32Array(total * 3);
  let off = 0;
  for (const g of flat) {
    const pos = g.getAttribute('position');
    arr.set(pos.array.subarray(0, pos.count * 3), off);
    off += pos.count * 3;
    // toNonIndexed 产生的是临时几何，拼完就释放
    if (!list.includes(g)) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  out.computeBoundingSphere();
  return out;
}