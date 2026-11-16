// 彩绘山谷专项：数据面契约、压平后的地形、时段纯函数、懒构建渲染器的空转保护。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PaintedValley } from '../../src/world/PaintedValley.js';
import { VALLEY_LAYOUT } from '../../src/world/valleyLayout.js';
import { heightAt, fromValley, TREE, TARN } from '../../src/painted/valley/world.js';
import { canAttachValleyRenderer, VALLEY_QUALITY } from '../../src/world/valleyRenderer.js';
import {
  VALLEY_TIMES, VALLEY_SUNSET, VALLEY_START_HOUR, VALLEY_TIME,
  clampValleyHour, nextValleyTime, valleyTimeName,
} from '../../src/world/valleyHours.js';

const fakeRenderer = { capabilities: { isWebGL2: true }, render() {}, setRenderTarget() {} };

describe('彩绘山谷：数据面与地形', () => {
  it('布局表满足点位/碰撞/出生点的硬约束', () => {
    expect(VALLEY_LAYOUT.bounds.x).toBeGreaterThan(5);
    expect(VALLEY_LAYOUT.pickupSpots.length).toBeGreaterThanOrEqual(3);
    expect(VALLEY_LAYOUT.pickupSpots.length).toBeLessThanOrEqual(10);
    for (const [x, z] of VALLEY_LAYOUT.pickupSpots) {
      expect(Math.abs(x)).toBeLessThanOrEqual(VALLEY_LAYOUT.bounds.x - 1);
      expect(Math.abs(z)).toBeLessThanOrEqual(VALLEY_LAYOUT.bounds.z - 1);
      for (const c of VALLEY_LAYOUT.colliders) {
        expect(Math.hypot(x - c.x, z - c.z)).toBeGreaterThan(c.r + 0.42);
      }
    }
    expect(VALLEY_LAYOUT.walls.length).toBeGreaterThan(0);
    expect(VALLEY_LAYOUT.colliders.length).toBeGreaterThan(0);
  });

  it('可走范围与原版 painted-valley 一致（REACH = extent/2 - 110）', () => {
    // 原版 main.js：const REACH = EXTENT / 2 - 110，1280 米地面 → 530 米半径。
    // 这不是随便挑的数：山谷边缘的树林就种在 530~600 米，走不出去看起来才像山谷的尽头。
    expect(VALLEY_LAYOUT.reach).toBe(VALLEY_QUALITY.extent / 2 - 110);
    expect(VALLEY_LAYOUT.reach).toBe(530);
    expect(VALLEY_LAYOUT.bounds.x).toBeGreaterThanOrEqual(VALLEY_LAYOUT.reach);
    expect(VALLEY_LAYOUT.bounds.z).toBeGreaterThanOrEqual(VALLEY_LAYOUT.reach);
    const map = new PaintedValley(new THREE.Scene());
    expect(map.reach).toBe(530);
    // 高度场与渲染栈同源。
    expect(typeof map.heightAt).toBe('function');
    for (const [x, z] of [[0, 0], [40, 40], [-120, 90], [200, -160]]) {
      expect(map.heightAt(x, z)).toBeCloseTo(heightAt(x, z), 9);
    }
    expect(Math.abs(map.heightAt(-120, 90))).toBeGreaterThan(0.5);
    // 水塘不能涉水（原版 tarnDistance < 0.88 推回），岸边和出生点是干的。
    expect(map.waterAt(TARN.at[0], TARN.at[1])).toBe(true);
    expect(map.waterAt(0, 0)).toBe(false);
    expect(map.waterAt(0, 13)).toBe(false);
  });

  it('树与石头是真实遮挡物，位置与原版同一份生成数据', () => {
    // 原版 walker 会撞 kind 0..3 的树和大于 0.6 的石头；一棵都不能少，
    // 否则玩家会穿过画出来的树干，或者撞上画里没有的空气。
    expect(VALLEY_LAYOUT.colliders.length).toBeGreaterThan(150);
    const great = VALLEY_LAYOUT.colliders.find(
      (c) => Math.hypot(c.x - TREE[0], c.z - TREE[1]) < 1e-6,
    );
    expect(great).toBeTruthy();
    expect(great.r).toBeCloseTo(1.25, 6);
    // 出生点不能压在碰撞体里
    for (const c of VALLEY_LAYOUT.colliders) {
      const d = Math.hypot(c.x - VALLEY_LAYOUT.spawn.x, c.z - VALLEY_LAYOUT.spawn.z);
      expect(d).toBeGreaterThan(c.r + 0.55);
    }
  });

  it('竞技场压平：原点 28 米内 heightAt 恒为 0，外面渐变回真山谷', () => {
    expect(heightAt(0, 0)).toBe(0);
    for (const [x, z] of [[10, 0], [0, -20], [19, 19], [-25, 5]]) {
      expect(heightAt(x, z)).toBe(0);
    }
    // 80 米之外不再是压平的圆盘，地势重新起伏（至少某处不为 0）。
    const outside = [fromValley(200, 0), fromValley(-300, 120), fromValley(450, -200)]
      .map(([x, z]) => heightAt(x, z));
    expect(outside.some((h) => Math.abs(h) > 0.01)).toBe(true);
    // 水塘与村庄仍跟着重定基准走，没有悬空到几百米高。
    expect(Math.abs(heightAt(TARN.at[0], TARN.at[1]))).toBeLessThan(200);
    expect(TREE.length).toBe(2);
  });
});

describe('彩绘山谷：时段纯函数', () => {
  it('四档循环、越界收敛、名称就近', () => {
    expect(VALLEY_TIMES.map((t) => t.hour)).toEqual([12.5, 15.5, 19, 20.3]);
    expect(nextValleyTime(12.5)).toBe(15.5);
    expect(nextValleyTime(19)).toBe(20.3);
    expect(nextValleyTime(20.3)).toBe(12.5); // 日落之后回到正午
    expect(clampValleyHour(-5)).toBe(12);
    expect(clampValleyHour(99)).toBe(VALLEY_SUNSET);
    expect(valleyTimeName(15.5)).toBe('午后');
    expect(valleyTimeName(20.1)).toBe('日落');
  });

  it('默认从午后开始，漂移速率让一局里能看到变化', () => {
    expect(VALLEY_START_HOUR).toBe(15.5);
    expect(VALLEY_SUNSET - VALLEY_START_HOUR).toBeGreaterThan(4);
    expect(VALLEY_TIME.CYCLE).toBe(1);
  });
});

describe('彩绘山谷：地图实例与懒构建', () => {
  const makeMap = () => new PaintedValley(new THREE.Scene());

  it('构造函数只产出数据面，不碰 WebGL', () => {
    const scene = new THREE.Scene();
    const map = new PaintedValley(scene);
    expect(map.id).toBe('valley');
    expect(map.root.parent).toBe(scene);
    expect(map.root.visible).toBe(false);
    expect(map.noShadows).toBe(true);
    expect(map.cameraFar).toBeGreaterThan(240);
    expect(map.valleyFrame).toBeNull();
    expect(map.colliders).toHaveLength(VALLEY_LAYOUT.colliders.length);
    expect(map.walls).toHaveLength(VALLEY_LAYOUT.walls.length);
    // root 里两盏普通灯，供 glb / 标准材质补光；不能有 spot
    let lights = 0;
    map.root.traverse((o) => {
      if (o.isLight) lights++;
      expect(o.isSpotLight).toBeFalsy();
    });
    expect(lights).toBeGreaterThanOrEqual(2);
  });

  it('activate 设背景/雾/可见，menuCamera 环绕且看向中心', () => {
    const scene = new THREE.Scene();
    const map = makeMap();
    map.activate(scene);
    expect(scene.background).toBeTruthy();
    expect(scene.fog).toBeTruthy();
    expect(scene.fog.near).toBeGreaterThan(0);
    expect(scene.fog.far).toBeGreaterThan(scene.fog.near);
    expect(map.root.visible).toBe(true);
    const cam = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
    const positions = new Set();
    for (const t of [0, 3, 11, 26]) {
      map.menuCamera(cam, t);
      expect(cam.position.y).toBeGreaterThan(0);
      expect(cam.position.y).toBeLessThan(200);
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const toCenter = new THREE.Vector3(0, 0, 0).sub(cam.position).normalize();
      expect(dir.dot(toCenter)).toBeGreaterThan(0.6);
      positions.add(`${cam.position.x.toFixed(3)},${cam.position.z.toFixed(3)}`);
    }
    expect(positions.size).toBe(4);
  });

  it('假渲染器下 attachRenderer 空转，valleyFrame 仍为 null，update 不抛错', () => {
    const map = makeMap();
    expect(canAttachValleyRenderer(fakeRenderer)).toBe(false);
    expect(() => map.attachRenderer(fakeRenderer, new THREE.PerspectiveCamera())).not.toThrow();
    expect(map.valleyFrame).toBeNull();
    const c0 = JSON.stringify(map.colliders);
    for (let i = 0; i < 30; i++) map.update(1 / 60);
    expect(() => map.update(0.5)).not.toThrow();
    expect(JSON.stringify(map.colliders)).toBe(c0);
  });

  it('setHour 收敛、请求码切换时段并停/启漂移', () => {
    const map = makeMap();
    map.setHour(999);
    expect(map.hour).toBe(VALLEY_SUNSET);
    map.setHour(-10);
    expect(map.hour).toBe(12);
    map.setHour(15.5);
    map.handleTimeRequest(VALLEY_TIME.CYCLE);
    expect(map.hour).toBe(19);
    expect(map.drift).toBe(false);
    map.handleTimeRequest(VALLEY_TIME.EARLIER);
    expect(map.hour).toBeCloseTo(18.75, 6);
    map.handleTimeRequest(VALLEY_TIME.LATER);
    expect(map.hour).toBe(19);
    map.handleTimeRequest(VALLEY_TIME.DRIFT);
    expect(map.drift).toBe(true);
    expect(map.timeName).toBe('黄金时刻');
  });
});

describe('彩绘山谷：低档画质参数（差机器可跑）', () => {
  it('所有尺寸都远小于原 demo 的 1280/2048/12288', () => {
    // 地面烘焙范围回到原版的 1280（可走半径直接由它决定），其余参数仍是低档。
    expect(VALLEY_QUALITY.extent).toBe(1280);
    expect(VALLEY_QUALITY.cloudSize).toBeLessThanOrEqual(256);
    expect(VALLEY_QUALITY.backdropWidth).toBeLessThanOrEqual(1024);
    expect(VALLEY_QUALITY.samples).toBe(0);
  });
});
