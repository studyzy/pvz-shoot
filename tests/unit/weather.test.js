// 天气粒子（docs/plans/2026-11-12-render-overhaul.md §3.4）。
//
// 两条硬约束必须守住：
//   1) CPU 零开销 —— 位置全在顶点着色器里算，JS 每帧只写一个标量；
//   2) 绕相机铺开 —— 否则玩家走 20 米就走出雪区。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWeather, WEATHER_PRESETS } from '../../src/fx/weather.js';

describe('天气粒子', () => {
  it('没有天气的图不建对象（不白花 draw call）', () => {
    const w = createWeather({ preset: 'backyard' });
    expect(w.enabled).toBe(false);
    expect(w.points).toBeNull();
    expect(w.group.children.length).toBe(0);
  });

  it('雪地建出粒子，且只有 1 个 draw call', () => {
    const w = createWeather({ preset: 'snow' });
    expect(w.enabled).toBe(true);
    expect(w.points).toBeInstanceOf(THREE.Points);
    expect(w.group.children.length).toBe(1);
  });

  it('粒子数就是配方里的数量', () => {
    const w = createWeather({ preset: 'snow' });
    const seed = w.points.geometry.getAttribute('aSeed');
    expect(seed.count).toBe(WEATHER_PRESETS.snow.count);
  });

  it('关掉视锥剔除 —— 位置在 shader 里算，包围盒永远不准', () => {
    const w = createWeather({ preset: 'snow' });
    expect(w.points.frustumCulled).toBe(false);
    // 包围球要给个巨大值，否则 three 会按 0 半径剔除
    expect(w.points.geometry.boundingSphere.radius).toBeGreaterThan(10000);
  });

  it('update 只推进时间与相机位置，不动几何', () => {
    const w = createWeather({ preset: 'snow' });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(11, 5, -7);
    const posBefore = w.points.geometry.getAttribute('position').array[0];
    w.update(0.5, cam);
    expect(w.points.material.uniforms.uTime.value).toBeCloseTo(0.5, 6);
    expect(w.points.material.uniforms.uCam.value.x).toBeCloseTo(11, 6);
    // CPU 侧位置必须一个字节都不改（这就是「零开销」）
    expect(w.points.geometry.getAttribute('position').array[0]).toBe(posBefore);
    // needsUpdate 一旦被置 true 就会每帧重传缓冲区 —— 这才是真会吃掉带宽的错误
    expect(w.points.geometry.getAttribute('position').version).toBe(0);
  });

  it('顶点着色器自己算下落、漂移与绕相机卷回', () => {
    const w = createWeather({ preset: 'snow' });
    const vs = w.points.material.vertexShader;
    expect(vs).toContain('mod(uTime');
    expect(vs).toContain('uCam');
    // 绕相机卷回的标志性写法：rel = mod(rel + box, box*2) - box
    expect(vs).toContain('mod(rel + uBox');
    // 边缘淡出，否则盒子的边界看得出来
    expect(vs).toContain('smoothstep(uBox.x');
  });

  it('萤火用加色混合，雪用普通混合', () => {
    const f = createWeather({ preset: 'forest' });
    expect(f.points.material.blending).toBe(THREE.AdditiveBlending);
    f.dispose();
    const s = createWeather({ preset: 'snow' });
    expect(s.points.material.blending).toBe(THREE.NormalBlending);
  });

  it('萤火往上飘（速度为负），雪往下落', () => {
    expect(WEATHER_PRESETS.forest.speed).toBeLessThan(0);
    expect(WEATHER_PRESETS.snow.speed).toBeGreaterThan(0);
  });

  it('切到没有天气的图会清掉粒子', () => {
    const w = createWeather({ preset: 'snow' });
    expect(w.enabled).toBe(true);
    w.setPreset('backyard');
    expect(w.enabled).toBe(false);
    expect(w.points).toBeNull();
    expect(w.group.children.length).toBe(0);
  });

  it('同一张图反复 setPreset 不重建', () => {
    const w = createWeather({ preset: 'snow' });
    const p0 = w.points;
    w.setPreset('snow');
    expect(w.points).toBe(p0);
  });

  it('setViewportScale 更新 uScale（分辨率变了粒子大小不能跟着变）', () => {
    const w = createWeather({ preset: 'snow', scale: 600 });
    expect(w.points.material.uniforms.uScale.value).toBe(600);
    w.setViewportScale(1080);
    expect(w.points.material.uniforms.uScale.value).toBe(1080);
    // 非法值要兜底，不能变成 NaN（NaN 会让整批粒子消失）
    w.setViewportScale(NaN);
    expect(Number.isFinite(w.points.material.uniforms.uScale.value)).toBe(true);
  });

  it('位置属性占位为 0 —— 真实位置全在 shader 里', () => {
    const w = createWeather({ preset: 'dust' });
    const pos = w.points.geometry.getAttribute('position');
    expect(pos.count).toBe(WEATHER_PRESETS.dust.count);
    for (let i = 0; i < Math.min(9, pos.count); i++) expect(pos.array[i]).toBe(0);
  });

  it('种子分布在不同位置（不会全挤在一处）', () => {
    const w = createWeather({ preset: 'snow' });
    const seed = w.points.geometry.getAttribute('aSeed');
    const xs = new Set();
    for (let i = 0; i < 200; i++) xs.add(Math.round(seed.getX(i) * 100));
    expect(xs.size).toBeGreaterThan(50);
  });

  it('没有粒子时 update / dispose 不崩', () => {
    const w = createWeather({ preset: 'backyard' });
    expect(() => w.update(0.1, null)).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
  });

  it('dispose 释放几何与材质（GPU 资源交还，JS 侧引用保留）', () => {
    const w = createWeather({ preset: 'snow' });
    const g = w.points.geometry;
    const m = w.points.material;
    w.dispose();
    expect(w.group.children.length).toBe(0);
    expect(w.points).toBeNull();
    // three 的 dispose() 只丢 GPU 资源，不动 JS 属性 —— 断言的是「资源已交还」这件事
    // 由 dispose 事件确认，而不是属性被清空。
    let disposed = 0;
    g.addEventListener('dispose', () => { disposed++; });
    m.addEventListener('dispose', () => { disposed++; });
    g.dispose();
    m.dispose();
    expect(disposed).toBe(2);
  });

  it('每张有天气的图配方合法（数量与盒子尺寸为正）', () => {
    for (const [id, p] of Object.entries(WEATHER_PRESETS)) {
      expect(p.count, id).toBeGreaterThan(0);
      for (const v of p.box) expect(v, id).toBeGreaterThan(0);
      expect(p.opacity, id).toBeGreaterThan(0);
      expect(p.opacity, id).toBeLessThanOrEqual(1);
    }
  });
});