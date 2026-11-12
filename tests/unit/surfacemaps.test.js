// 程序化法线/粗糙度贴图（docs/plans/2026-11-12-render-overhaul.md §5.1）。
//
// 全仓原本 0 处 normalMap / roughnessMap：所有表面都是「颜色贴图 + 平滑着色」，
// 光是平的，凑近看是一张贴纸。这里把已有的颜色贴图当高度场，Sobel 求梯度转法线。
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  heightFromSource, detailPass, normalFromHeight, roughnessTexture, deriveSurfaceMaps,
} from '../../src/world/surfaceMaps.js';

// 造一张有明确横条纹的图：竖条纹 → 高度场沿 x 变化 → 法线 x 分量该有符号变化
function striped(size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let x = 0; x < size; x++) {
    const v = x % 4 < 2 ? 255 : 0;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, size);
  }
  return c;
}

function flat(size = 32, level = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${level},${level},${level})`;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// jsdom 里 canvas 的 getContext('2d') 是空壳（getImageData 全 0），所以凡是需要
// 真实像素的用例都不走 canvas，而是直接构造高度场 —— 测的是 Sobel/高通那套逻辑本身。
function stripes(n = 32) {
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) h[y * n + x] = x % 4 < 2 ? 1 : 0;
  }
  return h;
}

describe('法线贴图 · 高度场提取', () => {
  it('输出尺寸等于请求尺寸', () => {
    const h = heightFromSource(striped(), 16);
    expect(h.length).toBe(256);
  });

  it('纯灰图的高度场处处相等', () => {
    const h = heightFromSource(flat(16, 100), 16);
    for (let i = 0; i < 16; i++) expect(h[i]).toBeCloseTo(h[0], 5);
  });

  it('源图不可用时不抛错，返回中性高度场', () => {
    expect(() => heightFromSource({}, 8)).not.toThrow();
    const h = heightFromSource(null, 8);
    expect(h.length).toBe(64);
    expect(h[0]).toBeCloseTo(0.5, 5);
  });
});

describe('法线贴图 · 高通细节', () => {
  it('纯色高度场经高通后仍接近 0.5（不制造假凹凸）', () => {
    const h = new Float32Array(64).fill(0.7);
    const d = detailPass(h, 8, 1.6);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(0.5, 5);
  });

  it('细节强度越大，起伏越大', () => {
    const h = stripes(32);
    const a = detailPass(h, 32, 0.5);
    const b = detailPass(h, 32, 3.0);
    const spread = (arr) => Math.max(...arr) - Math.min(...arr);
    expect(spread(b)).toBeGreaterThan(spread(a));
  });
});

describe('法线贴图 · Sobel 转法线', () => {
  it('输出的是一张 DataTexture，线性空间、可平铺', () => {
    const n = normalFromHeight(new Float32Array(16 * 16).fill(0.5), 16);
    expect(n).toBeInstanceOf(THREE.DataTexture);
    expect(n.image.width).toBe(16);
    // sRGB 解码会把法线弄错，必须 NoColorSpace
    expect(n.colorSpace).toBe(THREE.NoColorSpace);
    expect(n.wrapS).toBe(THREE.RepeatWrapping);
  });

  it('平坦表面 → 法线指向正上方 (0.5, 0.5, 1.0)', () => {
    const n = normalFromHeight(new Float32Array(8 * 8).fill(0.5), 8);
    const d = n.image.data;
    // 中心像素
    const i = (4 * 8 + 4) * 4;
    expect(d[i]).toBe(128);      // nx = 0
    expect(d[i + 1]).toBe(128);  // ny = 0
    expect(d[i + 2]).toBe(255);  // nz = 1
    expect(d[i + 3]).toBe(255);  // alpha
  });

  it('竖条纹 → 法线 x 分量有正有负（不是一片平坦）', () => {
    const d = detailPass(stripes(32), 32, 2.0);
    const n = normalFromHeight(d, 32, { scale: 3 });
    const data = n.image.data;
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < 32 * 32; i++) {
      const nx = data[i * 4];
      if (nx > 140) pos++;
      if (nx < 116) neg++;
    }
    expect(pos).toBeGreaterThan(10);
    expect(neg).toBeGreaterThan(10);
  });

  it('所有法线都是单位向量（长度 1，否则光照会偏）', () => {
    const n = normalFromHeight(detailPass(stripes(16), 16, 2), 16, { scale: 5 });
    const d = n.image.data;
    for (let i = 0; i < 64; i += 7) {
      const x = d[i * 4] / 255 * 2 - 1;
      const y = d[i * 4 + 1] / 255 * 2 - 1;
      const z = d[i * 4 + 2] / 255 * 2 - 1;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
    }
  });

  it('不可平铺模式不报错（给未来非平铺贴图留口子）', () => {
    const n = normalFromHeight(new Float32Array(64).fill(0.5), 8, { wrap: false });
    expect(n.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });
});

describe('粗糙度贴图', () => {
  it('是灰度数据（RGB 三个通道相等）', () => {
    const t = roughnessTexture(0.6, 32, 0.1);
    const d = t.image.data;
    for (let i = 0; i < 20; i++) {
      expect(d[i * 4]).toBe(d[i * 4 + 1]);
      expect(d[i * 4 + 1]).toBe(d[i * 4 + 2]);
    }
  });

  it('基准值决定均值（base=0.2 比 base=0.8 暗）', () => {
    const avg = (t) => {
      const d = t.image.data;
      let s = 0;
      for (let i = 0; i < d.length / 4; i++) s += d[i * 4];
      return s / (d.length / 4);
    };
    expect(avg(roughnessTexture(0.2, 32))).toBeLessThan(avg(roughnessTexture(0.8, 32)));
  });

  it('有低频变化（不是全图一个值，那样看起来像塑料）', () => {
    const t = roughnessTexture(0.5, 64, 0.15);
    const d = t.image.data;
    const vals = new Set();
    for (let i = 0; i < 64 * 64; i++) vals.add(d[i * 4]);
    expect(vals.size).toBeGreaterThan(5);
  });

  it('base/variance 越界被夹紧，不产生 NaN', () => {
    const t = roughnessTexture(5, 8, 9);
    const d = t.image.data;
    expect(d[0]).toBeLessThanOrEqual(255);
    expect(Number.isFinite(d[0])).toBe(true);
  });
});

describe('deriveSurfaceMaps', () => {
  it('给一张有 image 的贴图，产出法线 + 粗糙度', () => {
    const tex = new THREE.CanvasTexture(striped(64));
    const r = deriveSurfaceMaps(tex, { size: 64 });
    expect(r.normalMap).toBeInstanceOf(THREE.DataTexture);
    expect(r.roughnessMap).toBeInstanceOf(THREE.DataTexture);
  });

  it('同一张贴图第二次调用走缓存（不重复烘焙）', () => {
    const tex = new THREE.CanvasTexture(striped(32));
    const a = deriveSurfaceMaps(tex, { size: 32 });
    const b = deriveSurfaceMaps(tex, { size: 32 });
    expect(b.normalMap).toBe(a.normalMap);
  });

  it('贴图没有 image 时返回 null，不崩', () => {
    const r = deriveSurfaceMaps({}, {});
    expect(r.normalMap).toBe(null);
    expect(r.roughnessMap).toBe(null);
  });

  it('法线贴图的 repeat 跟随颜色贴图（细节尺度要对得上）', () => {
    const tex = new THREE.CanvasTexture(striped(32));
    tex.repeat.set(6, 6);
    const r = deriveSurfaceMaps(tex, { size: 32 });
    expect(r.normalMap.repeat.x).toBe(6);
    expect(r.roughnessMap.repeat.y).toBe(6);
  });

  it('烘焙异常时退化为 null（地图加载不能因为法线挂掉）', () => {
    const bad = { image: { width: 4, height: 4 } };
    expect(() => deriveSurfaceMaps(bad, {})).not.toThrow();
  });
});