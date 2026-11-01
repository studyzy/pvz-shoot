// 构建期提取：把 5 张地图的**纯数据**（碰撞体/平台/边界/出生点/流场网格）
// 导出成 JSON，供服务器（Node，无渲染）加载。
//
// 为什么不用服务器直接 import 地图类：地图构造函数会创建纹理、材质、Three 场景对象，
// 而这些都要读 document/canvas —— 服务器没有。所以把「数据」在构建期榨出来，
// 服务器只吃 JSON，零渲染依赖。
//
// 用法：node tools/extract-map-data.mjs
// 产物：src/sim/mapdata.json
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- 最小 DOM 桩：让 materials.js 里的 canvas 纹理能"跑"起来但不产生真实像素 ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.ImageData = dom.window.ImageData;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.self = dom.window;

// canvas 2d 上下文：返回一个吞掉所有调用、返回尺寸合理的桩对象。
// 提取的是几何数据，纹理内容一律不关心。
const ctx2d = new Proxy(
  {
    canvas: { width: 1, height: 1 },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set() {
      return true;
    },
  }
);
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

const THREE = await import('three');
const { createMaps } = await import(resolve(ROOT, 'src/world/maps.js'));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
const maps = createMaps(scene, camera);

function round(v, n = 3) {
  return Math.round(v * 10 ** n) / 10 ** n;
}

function extract(map) {
  const out = {
    id: map.id,
    bounds: map.bounds ? { x: map.bounds.x, z: map.bounds.z } : null,
    spawn: map.spawn ? { x: round(map.spawn.x), z: round(map.spawn.z), yaw: round(map.spawn.yaw || 0) } : null,
    colliders: (map.colliders || []).map((c) => ({ x: round(c.x), z: round(c.z), r: round(c.r) })),
    platforms: (map.platforms || []).map((p) => ({
      x: round(p.x), z: round(p.z), w: round(p.w), d: round(p.d), h: round(p.h),
    })),
    // walls 有两种：OBB 盒体 {x,y,z,hx,hy,hz,c,s} 与圆柱 {x,z,r,h}。
    // 必须原样保留（sweepWalls 依赖 hx/hy/hz/c/s 做旋转盒求交），不能自己改字段名。
    walls: (map.walls || []).map((w) => {
      const o = {};
      for (const k of Object.keys(w)) {
        const v = w[k];
        o[k] = typeof v === 'number' ? round(v) : v;
      }
      return o;
    }),
    pickupSpots: (map.pickupSpots || []).map((p) => ({ x: round(p.x), z: round(p.z) })),
    zombieSpawnPoints: (map.zombieSpawnPoints || []).map((p) => ({ x: round(p[0]), z: round(p[1]) })),
  };
  // 流场：把 FlowField 实例的网格参数导出（服务器自己重建一份）
  const nav = map.nav;
  if (nav) {
    out.nav = {
      minX: round(nav.minX), minZ: round(nav.minZ),
      w: nav.w, h: nav.h, cell: nav.cell === undefined ? 1 : nav.cell,
      blocked: nav.blocked ? Array.from(nav.blocked) : null,
    };
  }
  return out;
}

const data = maps.map(extract);
const outPath = resolve(ROOT, 'src/sim/mapdata.json');
writeFileSync(outPath, JSON.stringify(data, null, 0));
console.log('提取完成 ->', outPath);
for (const m of data) {
  console.log(`  ${m.id.padEnd(9)} colliders=${m.colliders.length} platforms=${m.platforms.length} walls=${m.walls.length} pickupSpots=${m.pickupSpots.length} nav=${m.nav ? 'yes' : 'no'}`);
}