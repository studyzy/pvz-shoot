// 天空穹顶（docs/plans/2026-11-12-render-overhaul.md §3.1）。
//
// 替换「8×512 渐变色条当背景」：穹顶是反着看的球 + shader，有太阳盘、光晕、云层、
// 星空。六张图共用一条 shader，只换颜色常量 —— 这是整套优化里性价比最高的一处。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSkyDome, SKY_PRESETS } from '../../src/world/skyDome.js';

describe('天空穹顶', () => {
  it('六张图都有配方（新增地图忘了加会被这条抓住）', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown']) {
      expect(SKY_PRESETS[id], id).toBeTruthy();
    }
  });

  it('是反着看的球：BackSide + 不写深度 + 不吃雾 + 最先绘制', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    expect(sky.mesh.material.side).toBe(THREE.BackSide);
    expect(sky.mesh.material.depthWrite).toBe(false);
    expect(sky.mesh.material.fog).toBe(false);
    // renderOrder 必须是负的：天空要先画，否则会盖住场景
    expect(sky.mesh.renderOrder).toBeLessThan(0);
    expect(sky.mesh.frustumCulled).toBe(false);
  });

  it('setPreset 换颜色与云量', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    const dayCloud = sky.uniform.uCloudCover.value;
    const night = sky.uniform.uStars.value;
    expect(night).toBe(0);

    sky.setPreset('forest');
    expect(sky.uniform.uStars.value).toBeGreaterThan(0.5);
    expect(sky.uniform.uCloudCover.value).not.toBe(dayCloud);

    sky.setPreset('downtown');
    expect(sky.uniform.uSunGlow.value).toBeGreaterThan(1.5);
  });

  it('同一张图反复 setPreset 结果一致（颜色不能每帧随机）', () => {
    const a = createSkyDome({ preset: 'snow' });
    const z1 = a.uniform.uZenith.value.getHex();
    a.setPreset('snow');
    a.setPreset('snow');
    expect(a.uniform.uZenith.value.getHex()).toBe(z1);
  });

  it('未知 preset 回落到后院，不崩', () => {
    const sky = createSkyDome({ preset: 'no-such-map' });
    expect(sky.uniform.uCloudCover.value).toBeCloseTo(SKY_PRESETS.backyard.cloudCover, 6);
  });

  it('update 让穹顶跟着相机平移（否则走出半径就穿帮）', () => {
    const sky = createSkyDome({ preset: 'backyard', radius: 400 });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(120, 7, -90);
    sky.update(0.016, cam);
    expect(sky.mesh.position.x).toBeCloseTo(120, 6);
    expect(sky.mesh.position.y).toBeCloseTo(7, 6);
    expect(sky.mesh.position.z).toBeCloseTo(-90, 6);
  });

  it('update 没有相机时不崩，只推进时间', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    const t0 = sky.uniform.uTime.value;
    expect(() => sky.update(0.1, null)).not.toThrow();
    expect(sky.uniform.uTime.value).toBeGreaterThan(t0);
  });

  it('太阳方向归一化', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    sky.setSunDir(new THREE.Vector3(3, 4, 5));
    expect(sky.uniform.uSunDir.value.length()).toBeCloseTo(1, 6);
  });

  it('闪电强度夹在 0~1', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    sky.setFlash(5);
    expect(sky.uniform.uFlash.value).toBe(1);
    sky.setFlash(-1);
    expect(sky.uniform.uFlash.value).toBe(0);
    sky.setFlash(NaN);
    expect(sky.uniform.uFlash.value).toBe(0);
  });

  it('片元着色器里有太阳盘、云层、星空三段（不是一张纯渐变）', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    const src = sky.mesh.material.fragmentShader;
    expect(src).toContain('uSunSize');
    expect(src).toContain('uCloudCover');
    expect(src).toContain('uStars');
    expect(src).toContain('fbm5');
    // 有 world-space 方向输入，不是屏幕空间 UV 渐变
    expect(sky.mesh.material.vertexShader).toContain('vDir');
  });

  it('dispose 释放几何与材质，但不释放共享噪声图', () => {
    const sky = createSkyDome({ preset: 'backyard' });
    const tex = sky.uniform.uNoise.value;
    expect(() => sky.dispose()).not.toThrow();
    // 共享噪声图必须还活着（下一个地图还要用）
    expect(tex.image).toBeTruthy();
  });
});