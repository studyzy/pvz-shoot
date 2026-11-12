// 阴影视锥跟随（docs/plans/2026-11-12-render-overhaul.md §1.1）。
//
// 为什么需要这块：阴影视锥原本写死在地图中心（后院 ±30、摩天街区 ±50）。
// 玩家走到场地边缘时，一半怪落在视锥外 —— 影子不是变淡，是直接消失。
// 收紧窗口同时把同样 1024² 贴图的 texel 密度翻倍。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { setFollowShadow } from '../../src/world/shadowFollow.js';

function makeSun() {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(24, 32, 16);
  sun.target.position.set(0, 0, 0);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  return sun;
}

describe('setFollowShadow', () => {
  it('把视锥设置成 ±half 的方窗口', () => {
    const sun = makeSun();
    const f = setFollowShadow(sun, { half: 17, near: 1, far: 90, mapSize: 1024 });
    expect(f.half).toBe(17);
    expect(sun.shadow.camera.left).toBe(-17);
    expect(sun.shadow.camera.right).toBe(17);
    expect(sun.shadow.camera.top).toBe(17);
    expect(sun.shadow.camera.bottom).toBe(-17);
    expect(sun.shadow.mapSize.x).toBe(1024);
    expect(sun.shadow.mapSize.y).toBe(1024);
  });

  it('窗口比原来铺满全场的范围小 —— 这是清晰度翻倍的原因', () => {
    const sun = makeSun();
    // 后院原来写死 ±30，摩天街区 ±50
    const f = setFollowShadow(sun, { half: 17 });
    expect(f.half).toBeLessThan(30);
    // 60 m 场 / 1024 = 5.86 cm；34 m 场 / 1024 = 3.32 cm
    const beforeCm = (30 * 2) / 1024 * 100;
    const afterCm = (f.half * 2) / 1024 * 100;
    expect(afterCm).toBeLessThan(beforeCm * 0.6);
  });

  it('update 把光源与 target 一起平移到焦点，方向不变', () => {
    const sun = makeSun();
    const dirBefore = sun.position.clone().sub(sun.target.position).normalize();
    const f = setFollowShadow(sun, { half: 17 });
    f.update(new THREE.Vector3(18, 0, -15));
    const dirAfter = sun.position.clone().sub(sun.target.position).normalize();
    // 方向必须一模一样：只平移，不改光照角度
    expect(dirAfter.x).toBeCloseTo(dirBefore.x, 6);
    expect(dirAfter.y).toBeCloseTo(dirBefore.y, 6);
    expect(dirAfter.z).toBeCloseTo(dirBefore.z, 6);
    // target 落在焦点附近（量化到 0.5 m 格子）
    expect(Math.abs(sun.target.position.x - 18)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(sun.target.position.z - -15)).toBeLessThanOrEqual(0.25);
  });

  it('位移量化到 0.5 米格子：同一格子内不重算，避免阴影边缘抖动', () => {
    const sun = makeSun();
    const f = setFollowShadow(sun, { half: 17 });
    f.update(new THREE.Vector3(4.0, 0, 4.0));
    const x1 = sun.target.position.x;
    // 同一格（4.0 与 4.2 都落在 4.0 格）→ 不动
    f.update(new THREE.Vector3(4.2, 0, 4.1));
    expect(sun.target.position.x).toBe(x1);
    // 跨格 → 动
    f.update(new THREE.Vector3(4.6, 0, 4.6));
    expect(sun.target.position.x).not.toBe(x1);
  });

  it('reset 让下一次 update 强制重算（切图用）', () => {
    const sun = makeSun();
    const f = setFollowShadow(sun, { half: 17 });
    f.update(new THREE.Vector3(0, 0, 0));
    sun.target.position.set(999, 0, 999);
    f.reset();
    f.update(new THREE.Vector3(0, 0, 0));
    expect(Math.abs(sun.target.position.x)).toBeLessThanOrEqual(0.25);
  });

  it('焦点为 null 时不崩、不改动光源', () => {
    const sun = makeSun();
    const f = setFollowShadow(sun, { half: 17 });
    const before = sun.target.position.clone();
    expect(() => f.update(null)).not.toThrow();
    expect(sun.target.position.x).toBe(before.x);
  });

  it('half 有下限，传 0 或负数不会退化成退化视锥', () => {
    const sun = makeSun();
    const f = setFollowShadow(sun, { half: 0 });
    expect(f.half).toBeGreaterThanOrEqual(4);
    expect(sun.shadow.camera.right).toBeGreaterThan(0);
  });
});