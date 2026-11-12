// 高度雾（docs/plans/2026-11-12-render-overhaul.md §3.2）。
//
// 均匀距离雾让楼顶和地面的雾一样浓 —— 一眼假。高度雾做对三件事：
// 洼地先白、高处清晰、远处渐隐不吃 pop-in。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FOG_PRESETS, densityAtHeight, fogFactor, applyFogPreset, fogPresetFor, HEIGHT_FOG_GLSL,
} from '../../src/world/heightFog.js';

describe('高度雾 · 密度曲线', () => {
  it('地面处密度 = baseDensity', () => {
    const p = FOG_PRESETS.backyard;
    expect(densityAtHeight(p, 0)).toBeCloseTo(p.baseDensity, 8);
  });

  it('越高越稀（这是「低处先起雾」的数学形式）', () => {
    const p = FOG_PRESETS.backyard;
    const d0 = densityAtHeight(p, 0);
    const d5 = densityAtHeight(p, 5);
    const d15 = densityAtHeight(p, 15);
    expect(d5).toBeLessThan(d0);
    expect(d15).toBeLessThan(d5);
    // 单调下降：任意两点都要成立，不能有回升
    expect(densityAtHeight(p, 20)).toBeLessThan(densityAtHeight(p, 19));
  });

  it('falloff 越大衰减越快（森林雾贴地、摩天街区雾拉得开）', () => {
    const forest = densityAtHeight(FOG_PRESETS.forest, 10) / FOG_PRESETS.forest.baseDensity;
    const dt = densityAtHeight(FOG_PRESETS.downtown, 10) / FOG_PRESETS.downtown.baseDensity;
    expect(forest).toBeLessThan(dt);
  });

  it('负高度按地面算（不会算出比 1 还大的密度）', () => {
    const p = FOG_PRESETS.backyard;
    expect(densityAtHeight(p, -50)).toBeCloseTo(p.baseDensity, 8);
  });

  it('baseDensity 为 0（关掉雾）时恒为 0', () => {
    expect(densityAtHeight({ baseDensity: 0, falloff: 0.1, groundY: 0 }, 3)).toBe(0);
  });

  it('非法输入不返回 NaN', () => {
    expect(Number.isFinite(densityAtHeight(FOG_PRESETS.backyard, NaN))).toBe(true);
    expect(densityAtHeight(null, 3)).toBe(0);
  });
});

describe('高度雾 · 混合系数', () => {
  it('距离 0 时完全清晰', () => {
    expect(fogFactor(FOG_PRESETS.backyard, 0, 0)).toBe(0);
  });

  it('距离越远越浓，且永远不超过 1', () => {
    const p = FOG_PRESETS.backyard;
    const a = fogFactor(p, 0, 30);
    const b = fogFactor(p, 0, 90);
    const c = fogFactor(p, 0, 400);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThanOrEqual(1);
  });

  it('同一距离下，低处比高处更浓（纵深可读）', () => {
    const p = FOG_PRESETS.backyard;
    const low = fogFactor(p, 0, 70);
    const high = fogFactor(p, 18, 70);
    expect(high).toBeLessThan(low);
    // 差距要明显到看得见（不是 1% 的差别）
    expect(low - high).toBeGreaterThan(0.05);
  });

  it('森林雾比后院浓（夜景近距离就该糊）', () => {
    const at60 = (id) => fogFactor(FOG_PRESETS[id], 0, 60);
    expect(at60('forest')).toBeGreaterThan(at60('backyard'));
  });

  it('摩天街区雾最淡（100 米场地要看得到楼）', () => {
    const at80 = (id) => fogFactor(FOG_PRESETS[id], 0, 80);
    expect(at80('downtown')).toBeLessThan(at80('backyard'));
  });
});

describe('高度雾 · uniform 填充', () => {
  it('把预设写进 uniform，颜色与常数都对上', () => {
    const u = {
      uFogColor: { value: new THREE.Color() },
      uFogColorHigh: { value: new THREE.Color() },
      uFogBase: { value: 0 },
      uFogFalloff: { value: 0 },
      uFogGroundY: { value: 0 },
      uFogMax: { value: 0 },
    };
    applyFogPreset(FOG_PRESETS.snow, u);
    expect(u.uFogColor.value.getHex()).toBe(FOG_PRESETS.snow.color);
    expect(u.uFogBase.value).toBe(FOG_PRESETS.snow.baseDensity);
    expect(u.uFogFalloff.value).toBe(FOG_PRESETS.snow.falloff);
    expect(u.uFogMax.value).toBeGreaterThan(0);
  });

  it('高处雾色比低处更亮（水汽在地面）', () => {
    const u = {
      uFogColor: { value: new THREE.Color() },
      uFogColorHigh: { value: new THREE.Color() },
      uFogBase: { value: 0 },
      uFogFalloff: { value: 0 },
      uFogGroundY: { value: 0 },
      uFogMax: { value: 0 },
    };
    applyFogPreset(FOG_PRESETS.downtown, u);
    const lo = { h: 0, s: 0, l: 0 };
    const hi = { h: 0, s: 0, l: 0 };
    u.uFogColor.value.getHSL(lo);
    u.uFogColorHigh.value.getHSL(hi);
    expect(hi.l).toBeGreaterThan(lo.l);
  });

  it('传 null 不崩', () => {
    expect(() => applyFogPreset(null, null)).not.toThrow();
  });

  it('未知地图回落到后院', () => {
    expect(fogPresetFor('no-such-map')).toBe(FOG_PRESETS.backyard);
  });

  it('六张图都有雾配方', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown']) {
      expect(FOG_PRESETS[id], id).toBeTruthy();
      expect(FOG_PRESETS[id].baseDensity).toBeGreaterThan(0);
    }
  });
});

describe('高度雾 · shader 片段', () => {
  it('含高度积分与雾色插值两个函数', () => {
    expect(HEIGHT_FOG_GLSL).toContain('heightFog');
    expect(HEIGHT_FOG_GLSL).toContain('fogColorAt');
    expect(HEIGHT_FOG_GLSL).toContain('exp(-uFogFalloff');
  });

  it('uFogBase 为 0 时短路返回（关雾不付算力）', () => {
    expect(HEIGHT_FOG_GLSL).toContain('uFogBase <= 0.0');
  });
});