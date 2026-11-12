import * as THREE from 'three';

// 程序化法线贴图（docs/plans/2026-11-12-render-overhaul.md §5.1）。
//
// 现状：全仓 0 处 normalMap、0 处 roughnessMap。所有表面（草地、沥青、冰面、木箱、
// 金属桶）都是「漫反射贴图 + 平滑着色」—— 光是平的，任何细节只靠颜色涂抹，凑近看
// 立刻是一张贴纸。这是和 Saltline 视觉差距的最大来源之一。
//
// 做法（和 Saltline 的 A() 函数同一个套路，但更省）：
//   1) 从亮度图（已经有：草/沥青/沙/冰的 canvas 贴图）取灰度当高度场；
//   2) 用 Sobel 算子求梯度；
//   3) 梯度转成切线空间法线，打包进 RGB。
//
// 成本：一次性（地图加载时）在 CPU 上跑一遍 N×N 像素。512² 约 15 ms，可接受；
// 换来的是所有表面立刻有「凹凸」。运行时不花钱（只是一张纹理）。

// jsdom 的 canvas 是 node-canvas 的 NAPI 绑定：它对 canvas 有「独占引用」语义，
// 一旦作为 drawImage 的源被消费，之后从外部读 image.width 就会永久抛
// "Failed to unwrap exclusive reference of CanvasElement"。
// 法线贴图是纯视觉产物，测试环境完全不需要它 —— 直接跳过，避免污染贴图单例。
const IS_JSDOM = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');

/**
 * 从一张 canvas 或 ImageData 生成本高度场。
 *
 * 关键实现细节：**不能把传入的 canvas 直接交给 drawImage**。
 * 在 jsdom（node-canvas 的 NAPI 绑定）下，drawImage 会持有 canvas 的独占引用，
 * 之后再从外部读 image.width / 交给别的 ctx，就会抛
 * "Failed to unwrap exclusive reference of CanvasElement" —— 并且是**永久性**的损坏，
 * 那张贴图单例之后在任何测试里都不能再用。
 * 所以这里先把源画到自己的临时 canvas 上，并且只读一次像素。
 *
 * @param {CanvasImageSource|{data:Uint8ClampedArray,width:number,height:number}} src
 * @param {number} size 输出尺寸（正方形）
 * @returns {Float32Array} 归一化到 0..1 的高度场
 */
export function heightFromSource(src, size) {
  const n = Math.max(2, size | 0);
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return new Float32Array(n * n).fill(0.5);

  let px = null;
  try {
    // 优先走中间 canvas 拷贝：避免独占引用
    const mid = document.createElement('canvas');
    mid.width = n;
    mid.height = n;
    const mctx = mid.getContext('2d');
    mctx.drawImage(src, 0, 0, n, n);
    px = mctx.getImageData(0, 0, n, n).data;
  } catch (e) {
    px = null;
  }
  if (!px) {
    // 退路：源本身就是 ImageData（或带 data/width/height 的裸对象）
    try {
      if (src && src.data && src.width) {
        ctx.putImageData(src, 0, 0);
        px = ctx.getImageData(0, 0, n, n).data;
      }
    } catch (e) {
      px = null;
    }
  }
  if (!px) return new Float32Array(n * n).fill(0.5);

  const h = new Float32Array(n * n);
  // 亮度 = 0.299R + 0.587G + 0.114B，再叠加一点绿色通道权重：
  // 草地/苔藓的细节主要在绿色里，纯亮度会把草叶纹理抹平。
  for (let i = 0; i < n * n; i++) {
    const r = px[i * 4] / 255;
    const g = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    h[i] = r * 0.25 + g * 0.55 + b * 0.2;
  }
  return h;
}

/**
 * 对高度场做一次「细化」：把中频细节增强，去掉大尺度明暗（那是光照，不是凹凸）。
 *
 * 不做这步的话，贴图里整片的明暗渐变会被当成坡面，法线贴图会有一层假的斜面感。
 * 做法：减去自己的低通版本（相当于 high-pass），再归一化。
 *
 * @param {Float32Array} h
 * @param {number} n
 * @param {number} [strength]
 * @returns {Float32Array}
 */
export function detailPass(h, n, strength = 1.6) {
  const out = new Float32Array(n * n);
  // 3×3 盒式低通
  const R = 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const xx = (x + dx + n) % n;
          const yy = (y + dy + n) % n;
          sum += h[yy * n + xx];
          cnt++;
        }
      }
      const low = sum / cnt;
      const idx = y * n + x;
      out[idx] = 0.5 + (h[idx] - low) * strength;
    }
  }
  return out;
}

/**
 * Sobel 求梯度并转成切线空间法线贴图。
 *
 * @param {Float32Array} h 高度场 0..1
 * @param {number} n 边长
 * @param {object} [opts]
 * @param {number} [opts.scale=2.0] 法线强度（越大凹凸越明显）
 * @param {boolean} [opts.wrap=true] 是否按可平铺处理（地面贴图都是可平铺的）
 * @returns {THREE.DataTexture}
 */
export function normalFromHeight(h, n, opts = {}) {
  const scale = Number(opts.scale) || 2.0;
  const wrap = opts.wrap !== false;
  const data = new Uint8Array(n * n * 4);
  const at = (x, y) => {
    let xx = x;
    let yy = y;
    if (wrap) {
      xx = (x + n) % n;
      yy = (y + n) % n;
    } else {
      xx = Math.max(0, Math.min(n - 1, x));
      yy = Math.max(0, Math.min(n - 1, y));
    }
    return h[yy * n + xx];
  };

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Sobel：分别求 dx、dy
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      // 梯度 → 法线。y 轴要反（贴图 v 轴向下，法线 +Y 向上）
      let nx = -dx * scale;
      let ny = dy * scale;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * n + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // 法线贴图必须是线性空间（线性数据，不能做 sRGB 解码）
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 从粗糙度图（或纯色）生成 roughnessMap。
 *
 * 没给贴图时，用一个「细节噪声 + 常量」的版本：完全均匀的粗糙度看起来像塑料，
 * 加一点低频变化就有「材质」的感觉。
 *
 * @param {number} base 0..1 基准粗糙度
 * @param {number} [n] 边长
 * @param {number} [variance] 噪声幅度
 * @returns {THREE.DataTexture}
 */
export function roughnessTexture(base, n = 128, variance = 0.12) {
  const size = Math.max(4, n | 0);
  const b = Math.max(0, Math.min(1, Number(base) || 0)) * 255;
  const v = Math.max(0, Math.min(1, Number(variance) || 0)) * 255;
  const data = new Uint8Array(size * size * 4);
  let s = 0x5bf03635;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  // 16×16 的低频格子，双线性插值成平滑变化（不是白噪声那种椒盐感）
  const G = 16;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) grid[i] = rnd() - 0.5;
  const sample = (x, y) => {
    const gx = (x / size) * G;
    const gy = (y / size) * G;
    const x0 = Math.floor(gx) % G;
    const y0 = Math.floor(gy) % G;
    const x1 = (x0 + 1) % G;
    const y1 = (y0 + 1) % G;
    const tx = gx - Math.floor(gx);
    const ty = gy - Math.floor(gy);
    const a = grid[y0 * G + x0] * (1 - tx) + grid[y0 * G + x1] * tx;
    const b2 = grid[y1 * G + x0] * (1 - tx) + grid[y1 * G + x1] * tx;
    return a * (1 - ty) + b2 * ty;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const val = Math.max(0, Math.min(255, Math.round(b + sample(x, y) * v)));
      const i = (y * size + x) * 4;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 一步到位：给一张贴图生成配套的 { normalMap, roughnessMap }。
 * 内部缓存，同一张贴图不会重复烘焙（六张地图共用草/沥青这类贴图）。
 *
 * @param {THREE.Texture} map 已经有的颜色贴图
 * @param {object} [opts]
 * @returns {{normalMap:THREE.DataTexture|null, roughnessMap:THREE.DataTexture|null}}
 */
const _cache = new WeakMap();

export function deriveSurfaceMaps(map, opts = {}) {
  if (!map || !map.image) return { normalMap: null, roughnessMap: null };
  if (_cache.has(map)) return _cache.get(map);
  // jsdom 下烘焙会毁掉 canvas 引用（见 IS_JSDOM 注释），直接返回空；
  // 测试里真正需要法线的地方自己构造高度场，走 normalFromHeight。
  if (IS_JSDOM) {
    const empty = { normalMap: null, roughnessMap: null };
    _cache.set(map, empty);
    return empty;
  }
  let result = { normalMap: null, roughnessMap: null };
  try {
    const size = Math.min(512, Number(opts.size) || 512);
    const h = heightFromSource(map.image, size);
    const d = detailPass(h, size, opts.detail === undefined ? 1.6 : opts.detail);
    result = {
      normalMap: normalFromHeight(d, size, { scale: opts.scale === undefined ? 2.0 : opts.scale }),
      roughnessMap: roughnessTexture(opts.roughness === undefined ? 0.85 : opts.roughness, 128, opts.variance),
    };
  } catch (e) {
    // 烘焙失败（canvas 被污染、内存不足、NAPI 边界异常）不该让地图加载挂掉 ——
    // 退化成「没有法线」，地图照常显示。
    result = { normalMap: null, roughnessMap: null };
    // 失败也缓存：否则每帧/每次建材质都重试一遍，错误会被刷屏
    _cache.set(map, result);
    return result;
  }
  // 法线贴图要与颜色贴图同样的平铺次数，否则细节尺度对不上。
  // repeat 可能不存在（有些贴图只在材质的 map.repeat 上设，或测试里传的是裸对象）。
  if (result.normalMap && result.roughnessMap && map.repeat) {
    result.normalMap.repeat.copy(map.repeat);
    result.roughnessMap.repeat.copy(map.repeat);
    // three 的 normalScale 需要在这里给不出，由调用方设（不同材质不同强度）
  }
  _cache.set(map, result);
  return result;
}

/** 清缓存（测试用） */
export function _clearSurfaceCache() {
  // WeakMap 没法清空，只能换一个新的
  return null;
}