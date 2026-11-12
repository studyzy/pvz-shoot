import * as THREE from 'three';

// 环境叙事道具（docs/plans/2026-11-12-render-overhaul.md §6.1）。
//
// 后院现在是「草地 + 栅栏 + 房子 + 墓碑 + 树」——这是布景，不是场景。
// 真实的院子有：晾衣绳、水管、空调外机、垃圾桶、割草机痕迹、水洼、落叶堆、
// 翻倒的花盆、栅栏缺板、墓碑边的枯花与蜡烛。
//
// 这些不改变玩法，但决定「这里有没有人住」。成本极低：全部走 InstancedMesh，
// 每类 1 个 draw call，材质共用一个 toon。
//
// 设计原则：
//   1) 种子固定 —— 每张图每次进来道具位置一样（不能每局随机，否则记不住路）
//   2) 避开场地中央与出生点 —— 装饰不能挡视线或卡走位
//   3) 单 draw call —— 所有实例合并，材质只 2~3 个

// 稳定 RNG（mulberry32）：同一 seed 一定产出同一序列
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

// 每张图的道具配方。density 是「每 100 平方米几个」，由调用方按场地面积换算。
export const PROPS_PRESETS = {
  backyard: {
    seed: 20261112,
    // 场地半宽 23，中央 7 米内不放装饰（会挡视线）
    clearRadius: 7,
    kinds: {
      clothesline: { count: 2, size: [7.5, 2.1] },   // 晾衣绳：两根柱 + 一条弧线
      acUnit: { count: 2, size: [0.9, 0.7, 0.55] },
      trashCan: { count: 4, size: [0.5, 0.85] },
      flowerPot: { count: 7, size: [0.42, 0.5] },    // 翻倒的花盆
      leafPile: { count: 10, size: [1.4, 0.22] },
      puddle: { count: 7, size: [1.6, 0.01] },
    },
  },
  snow: {
    seed: 20261113,
    clearRadius: 9,
    kinds: {
      snowPile: { count: 8, size: [1.8, 0.4] },
      frozenPot: { count: 3, size: [0.42, 0.5] },
      icicle: { count: 10, size: [0.08, 0.7] },
    },
  },
  dust: {
    seed: 20261114,
    clearRadius: 9,
    kinds: {
      crate: { count: 7, size: [0.8, 0.8, 0.8] },
      barrel: { count: 4, size: [0.45, 1.0] },
      tire: { count: 3, size: [0.6, 0.24] },
    },
  },
  forest: {
    seed: 20261115,
    clearRadius: 7,
    kinds: {
      stump: { count: 6, size: [0.5, 0.6] },
      mushroom: { count: 14, size: [0.16, 0.2] },
      rock: { count: 8, size: [0.55, 0.35] },
    },
  },
  cloud: {
    seed: 20261116,
    clearRadius: 8,
    kinds: {
      balloon: { count: 5, size: [0.4, 0.55] },
      candyPile: { count: 6, size: [0.9, 0.3] },
    },
  },
  downtown: {
    seed: 20261117,
    clearRadius: 9,
    kinds: {
      dumpster: { count: 3, size: [1.5, 1.1, 1.0] },
      cone: { count: 6, size: [0.32, 0.7] },
      hydrant: { count: 3, size: [0.28, 0.75] },
      newspaper: { count: 8, size: [0.5, 0.01, 0.35] },
    },
  },
};

// 单类道具的几何构造。返回 { geo, mat, y }：
//   geo 是「以原点为底中心」的几何（y 向上），y 是额外抬高
//
// 大件家具类道具（晾衣绳、空调外机）贴外圈放：它们属于「院子边上」的东西，
// 出现在场地中央会很荒谬，但也不能绑死某个方向 —— 玩家朝向不固定，
// 绑死 +z 就会永远在背后。所以按「半径必须够大」约束，方向交给随机。
export const PERIMETER_KINDS = new Set(['clothesline', 'acUnit', 'trashCan', 'dumpster']);

function buildKind(kind, mat) {
  const g = [];
  switch (kind) {
    case 'clothesline': {
      // 两根柱子
      for (const x of [-3.4, 3.4]) {
        const p = new THREE.CylinderGeometry(0.055, 0.07, 2.1, 6);
        p.translate(x, 1.05, 0);
        g.push(p);
      }
      // 绳（用细长扁盒近似，比 LineSegments 更容易吃光照）
      const rope = new THREE.BoxGeometry(7.0, 0.03, 0.03);
      rope.translate(0, 1.95, 0);
      g.push(rope);
      // 挂着的两块布
      for (const [x, w, h] of [[-1.4, 0.9, 1.1], [1.2, 0.75, 0.85]]) {
        const c = new THREE.BoxGeometry(w, h, 0.02);
        c.translate(x, 1.95 - h / 2, 0);
        g.push(c);
      }
      break;
    }
    case 'acUnit': {
      const b = new THREE.BoxGeometry(0.9, 0.7, 0.55);
      b.translate(0, 0.35, 0);
      g.push(b);
      // 风扇罩（一个圆环）
      const f = new THREE.TorusGeometry(0.22, 0.03, 6, 12);
      f.rotateY(Math.PI / 2);
      f.translate(0.2, 0.35, 0.29);
      g.push(f);
      break;
    }
    case 'trashCan': {
      const b = new THREE.CylinderGeometry(0.26, 0.22, 0.85, 10);
      b.translate(0, 0.425, 0);
      g.push(b);
      const lid = new THREE.CylinderGeometry(0.29, 0.29, 0.06, 10);
      lid.translate(0, 0.88, 0);
      g.push(lid);
      break;
    }
    case 'flowerPot': {
      // 翻倒：横躺的锥台
      const p = new THREE.CylinderGeometry(0.2, 0.14, 0.42, 8);
      p.rotateZ(Math.PI / 2 * 0.85);
      p.translate(0, 0.16, 0);
      g.push(p);
      // 洒出来的土
      const soil = new THREE.SphereGeometry(0.22, 8, 5);
      soil.scale(1, 0.35, 1);
      soil.translate(0.26, 0.03, 0.05);
      g.push(soil);
      break;
    }
    case 'leafPile': {
      // 一摊低矮的扁球当叶堆
      const s = new THREE.SphereGeometry(0.7, 9, 5);
      s.scale(1, 0.22, 0.85);
      s.translate(0, 0.09, 0);
      g.push(s);
      break;
    }
    case 'puddle': {
      const p = new THREE.CircleGeometry(0.8, 14);
      p.rotateX(-Math.PI / 2);
      p.translate(0, 0.006, 0);
      g.push(p);
      break;
    }
    case 'snowPile': {
      const s = new THREE.SphereGeometry(0.9, 9, 5);
      s.scale(1, 0.32, 0.9);
      s.translate(0, 0.12, 0);
      g.push(s);
      break;
    }
    case 'frozenPot': {
      const p = new THREE.CylinderGeometry(0.2, 0.14, 0.42, 8);
      p.translate(0, 0.21, 0);
      g.push(p);
      break;
    }
    case 'icicle': {
      const c = new THREE.ConeGeometry(0.05, 0.7, 5);
      c.rotateX(Math.PI);      // 倒挂
      c.translate(0, -0.35, 0);
      g.push(c);
      break;
    }
    case 'crate': {
      const b = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      b.translate(0, 0.4, 0);
      g.push(b);
      break;
    }
    case 'barrel': {
      const b = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10);
      b.translate(0, 0.5, 0);
      g.push(b);
      break;
    }
    case 'tire': {
      const t = new THREE.TorusGeometry(0.3, 0.13, 6, 12);
      t.rotateX(-Math.PI / 2);
      t.translate(0, 0.14, 0);
      g.push(t);
      break;
    }
    case 'stump': {
      const s = new THREE.CylinderGeometry(0.42, 0.5, 0.6, 8);
      s.translate(0, 0.3, 0);
      g.push(s);
      break;
    }
    case 'mushroom': {
      const stem = new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6);
      stem.translate(0, 0.08, 0);
      g.push(stem);
      const cap = new THREE.SphereGeometry(0.14, 8, 5);
      cap.scale(1, 0.6, 1);
      cap.translate(0, 0.19, 0);
      g.push(cap);
      break;
    }
    case 'rock': {
      const r = new THREE.IcosahedronGeometry(0.45, 0);
      r.scale(1, 0.6, 0.9);
      r.translate(0, 0.2, 0);
      g.push(r);
      break;
    }
    case 'balloon': {
      const b = new THREE.SphereGeometry(0.3, 10, 8);
      b.scale(1, 1.15, 1);
      b.translate(0, 1.5, 0);
      g.push(b);
      break;
    }
    case 'candyPile': {
      const c = new THREE.SphereGeometry(0.45, 8, 5);
      c.scale(1, 0.25, 1);
      c.translate(0, 0.1, 0);
      g.push(c);
      break;
    }
    case 'dumpster': {
      const b = new THREE.BoxGeometry(1.5, 1.1, 1.0);
      b.translate(0, 0.55, 0);
      g.push(b);
      const lid = new THREE.BoxGeometry(1.55, 0.08, 1.05);
      lid.rotateX(-0.16);
      lid.translate(0, 1.14, -0.07);
      g.push(lid);
      break;
    }
    case 'cone': {
      const c = new THREE.ConeGeometry(0.22, 0.62, 8);
      c.translate(0, 0.31, 0);
      g.push(c);
      const base = new THREE.BoxGeometry(0.42, 0.05, 0.42);
      base.translate(0, 0.025, 0);
      g.push(base);
      break;
    }
    case 'hydrant': {
      const b = new THREE.CylinderGeometry(0.13, 0.15, 0.55, 8);
      b.translate(0, 0.275, 0);
      g.push(b);
      const cap = new THREE.SphereGeometry(0.14, 8, 5);
      cap.scale(1, 0.7, 1);
      cap.translate(0, 0.56, 0);
      g.push(cap);
      break;
    }
    case 'newspaper': {
      const n = new THREE.BoxGeometry(0.5, 0.01, 0.35);
      n.translate(0, 0.005, 0);
      g.push(n);
      break;
    }
    default:
      return null;
  }
  return { geos: g, mat };
}

// 每类道具的材质颜色（shader 里不分材质，所以按类给一份 toon）
const KIND_COLOR = {
  clothesline: 0xd8d2c2,
  acUnit: 0xb8bcc0,
  trashCan: 0x6b7a6a,
  flowerPot: 0xb2643c,
  leafPile: 0x8a6b2f,
  puddle: 0x6f8fa8,
  snowPile: 0xf2f8ff,
  frozenPot: 0xa8b8c8,
  icicle: 0xd8ecff,
  crate: 0x9a7746,
  barrel: 0x7a5a3a,
  tire: 0x2a2a2a,
  stump: 0x6b5232,
  mushroom: 0xd06a6a,
  rock: 0x7a7a72,
  balloon: 0xe8607a,
  candyPile: 0xf0a8c0,
  dumpster: 0x3a5a44,
  cone: 0xe06a2a,
  hydrant: 0xc03a2a,
  newspaper: 0xd8d4c8,
};

/**
 * 创建环境叙事道具组。
 *
 * 每类道具合并成一个 InstancedMesh（1 draw call）。位置用固定 seed 生成，
 * 避开 clearRadius 内的中心区（不挡视线、不卡走位）。
 *
 * @param {object} opts
 * @param {string} opts.preset  PROPS_PRESETS 的 key
 * @param {number} [opts.half]  场地半宽
 * @param {number} [opts.wallHalf] 栅栏内侧留白（道具不贴墙）
 * @param {(x:number,z:number,r:number)=>boolean} [opts.blocked] 额外的占位判断
 * @returns {{group:THREE.Group, setPreset:Function, dispose:Function, count:Function}}
 */
export function createProps(opts = {}) {
  const group = new THREE.Group();
  group.name = 'props';

  let currentId = null;
  let resources = []; // {mesh, geo, mat}

  const clear = () => {
    for (const r of resources) {
      group.remove(r.mesh);
      r.mesh.dispose && r.mesh.dispose();
      r.geo.dispose();
      r.mat.dispose();
    }
    resources = [];
  };

  const api = {
    group,

    setPreset(id, runOpts) {
      const p = PROPS_PRESETS[id];
      if (!p) {
        clear();
        currentId = id;
        return api;
      }
      if (id === currentId) return api;
      currentId = id;
      clear();

      const half = Number(opts.half) || 23;
      const wall = Number(opts.wallHalf) || 1.2;
      const usable = half - wall;
      // blocked 以构造时的为准，setPreset 传入的覆盖它（地图碰撞体每张图不同）
      const blocked = (runOpts && runOpts.blocked) || opts.blocked;
      const rng = makeRng(p.seed);
      const tmpMat = new THREE.Matrix4();
      const tmpPos = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      const tmpScale = new THREE.Vector3(1, 1, 1);
      // 已经放下的位置：同类道具之间要留间距，避免叠在一起
      const placed = [];

      for (const [kind, spec] of Object.entries(p.kinds)) {
        const n = Math.max(1, spec.count | 0);
        const color = KIND_COLOR[kind] === undefined ? 0x9a9a9a : KIND_COLOR[kind];
        const mat = new THREE.MeshToonMaterial({ color });
        const built = buildKind(kind, mat);
        if (!built || !built.geos.length) continue;

        // 合并这一类的所有零件成一个几何（InstancedMesh 只接受单几何）
        const merged = mergeSimple(built.geos);
        for (const g of built.geos) g.dispose();
        if (!merged) continue;

        const mesh = new THREE.InstancedMesh(merged, mat, n);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        let placedCount = 0;
        const perimeter = PERIMETER_KINDS.has(kind);
        for (let attempt = 0; attempt < n * 12 && placedCount < n; attempt++) {
          let x;
          let z;
          // 极坐标撒点：角度均匀。大件家具强制落在外圈环带上（不该出现在场地中央），
          // 小件道具从 clearRadius 起步往上撒。
          const a = rng() * Math.PI * 2;
          const rMin = perimeter ? usable * 0.62 : (p.clearRadius || 8);
          const rMax = usable * 0.95;
          const rr = rMin + rng() * Math.max(0.1, rMax - rMin);
          x = Math.cos(a) * rr;
          z = Math.sin(a) * rr;
          const r = Math.hypot(x, z);
          // 中心留空：装饰不能挡视线
          if (r < (p.clearRadius || 8)) continue;
          // 避免两个道具叠在一起
          let tooClose = false;
          for (const q of placed) {
            if (Math.hypot(x - q.x, z - q.z) < 1.6) { tooClose = true; break; }
          }
          if (tooClose) continue;
          if (blocked && blocked(x, z, 1.0)) continue;

          tmpPos.set(x, 0, z);
          // 绕 Y 随机转一点，避免所有道具朝向一致（一眼看出是复制的）
          tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
          const s = 0.85 + rng() * 0.3;
          tmpScale.set(s, s, s);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          mesh.setMatrixAt(placedCount, tmpMat);
          placed.push({ x, z });
          placedCount++;
        }
        mesh.count = placedCount;
        mesh.instanceMatrix.needsUpdate = true;
        if (placedCount > 0) {
          group.add(mesh);
          resources.push({ mesh, geo: merged, mat });
        } else {
          merged.dispose();
          mat.dispose();
        }
      }
      return api;
    },

    count() {
      let n = 0;
      for (const r of resources) n += r.mesh.count || 0;
      return n;
    },

    dispose() {
      clear();
      currentId = null;
    },
  };

  if (opts.preset) api.setPreset(opts.preset);
  return api;
}

// 简易几何合并：只处理 position/normal（所有基础几何都有），不依赖 BufferGeometryUtils。
function mergeSimple(list) {
  if (!list.length) return null;
  const flat = [];
  for (const g of list) {
    const f = g.index ? g.toNonIndexed() : g;
    if (!f.getAttribute('position')) {
      for (const x of flat) if (!list.includes(x)) x.dispose();
      return null;
    }
    flat.push(f);
  }
  // 法线也要合并，否则光照会错
  let hasNormal = true;
  for (const g of flat) if (!g.getAttribute('normal')) { hasNormal = false; break; }

  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = hasNormal ? new Float32Array(total * 3) : null;
  let off = 0;
  for (const g of flat) {
    const pa = g.getAttribute('position');
    pos.set(pa.array.subarray(0, pa.count * 3), off);
    if (nor) {
      const na = g.getAttribute('normal');
      nor.set(na.array.subarray(0, na.count * 3), off);
    }
    off += pa.count * 3;
    if (!list.includes(g)) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  else out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}