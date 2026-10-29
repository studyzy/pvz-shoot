import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Particles } from '../../src/fx/Particles.js';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return {
    ...actual,
    WebGLRenderer: class {
      constructor(o) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = o && o.canvas;
      }
    },
  };
});

const MAX = 280;
// 与 Particles 内部一致：用一个临时 Object3D 还原实例矩阵
const tmp = new THREE.Object3D();

function matrixAt(p, i) {
  const m = new THREE.Matrix4();
  p.mesh.getMatrixAt(i, m);
  return m;
}

function decompose(p, i) {
  const m = matrixAt(p, i);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return { pos, quat, scale };
}

// InstancedMesh.getColorAt(index, target) 把颜色写进 target，返回 undefined
function colorAt(p, i) {
  const c = new THREE.Color();
  p.mesh.getColorAt(i, c);
  return c.getHex();
}

function activeCount(p) {
  return p.items.filter((it) => it.active).length;
}

describe('Particles', () => {
  let scene;
  let fx;

  beforeEach(() => {
    scene = new THREE.Scene();
    fx = new Particles(scene);
  });

  describe('构造', () => {
    it('InstancedMesh 容量 280，挂到场景上，关闭视锥剔除', () => {
      expect(fx.mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(fx.mesh.count).toBe(MAX);
      expect(fx.items).toHaveLength(MAX);
      expect(fx.mesh.frustumCulled).toBe(false);
      expect(fx.mesh.renderOrder).toBe(2);
      expect(scene.children).toContain(fx.mesh);
    });

    it('初始全部非活跃，实例矩阵藏在 y=-1000 且缩到极小', () => {
      expect(activeCount(fx)).toBe(0);
      const { pos, scale } = decompose(fx, 0);
      expect(pos.y).toBe(-1000);
      expect(scale.x).toBeCloseTo(0.0001, 8);
      expect(fx.cursor).toBe(0);
    });

    it('创建 3 个爆炸球壳 + 3 个冲击环，初始不可见', () => {
      expect(fx.shells).toHaveLength(3);
      expect(fx.rings).toHaveLength(3);
      for (const s of fx.shells) {
        expect(s.mesh.visible).toBe(false);
        expect(scene.children).toContain(s.mesh);
        expect(s.mesh.material.transparent).toBe(true);
      }
      for (const r of fx.rings) {
        expect(r.mesh.visible).toBe(false);
        expect(scene.children).toContain(r.mesh);
      }
      expect(fx.rings[0].mesh.geometry.attributes.position.count).toBeGreaterThan(0);
    });

    it('只有一盏点光源，初始不可见/强度 0', () => {
      const lights = scene.children.filter((c) => c.isPointLight);
      expect(lights).toHaveLength(1);
      expect(lights[0]).toBe(fx.flash);
      expect(fx.flash.visible).toBe(false);
      expect(fx.flash.intensity).toBe(0);
      expect(fx.flashTime).toBe(0);
    });
  });

  describe('burst', () => {
    it('把 count 个粒子置为活跃，光标环形前进', () => {
      fx.burst({ pos: new THREE.Vector3(1, 2, 3), color: 0xff0000, count: 5 });
      expect(activeCount(fx)).toBe(5);
      expect(fx.cursor).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(fx.items[i].active).toBe(true);
        expect(fx.items[i].pos.x).toBe(1);
        expect(fx.items[i].pos.y).toBe(2);
        expect(fx.items[i].pos.z).toBe(3);
      }
      expect(fx.items[5].active).toBe(false);
    });

    it('默认值：count 8 / speed 3 / life 0.6 / size 0.12 / gravity 7 / drag 1.2', () => {
      fx.burst({ pos: new THREE.Vector3(), color: 0xffffff });
      expect(activeCount(fx)).toBe(8);
      const p = fx.items[0];
      expect(p.gravity).toBe(7);
      expect(p.drag).toBe(1.2);
      expect(p.size).toBeGreaterThanOrEqual(0.12 * 0.6);
      expect(p.size).toBeLessThanOrEqual(0.12 * 1.5);
      expect(p.life).toBeGreaterThanOrEqual(0.6 * 0.7);
      expect(p.life).toBeLessThanOrEqual(0.6 * 1.25);
      expect(p.maxLife).toBe(p.life);
      expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThanOrEqual(3.001);
    });

    it('opts 可覆盖 gravity/drag/up、size 与 life 的随机区间', () => {
      fx.burst({ pos: new THREE.Vector3(), color: 0x00ff00, count: 3, size: 0.5, life: 2, gravity: 0, drag: 0, up: 5 });
      for (const p of fx.items.slice(0, 3)) {
        expect(p.gravity).toBe(0);
        expect(p.drag).toBe(0);
        expect(p.size).toBeGreaterThanOrEqual(0.3);
        expect(p.size).toBeLessThanOrEqual(0.75);
        expect(p.life).toBeGreaterThanOrEqual(1.4);
        expect(p.life).toBeLessThanOrEqual(2.5);
        // up 叠加在纵向速度上：sin(elev)*sp ∈ [-0.75, 3]，所以 vel.y ≥ 4.25
        expect(p.vel.y).toBeGreaterThanOrEqual(5 - 0.25 * 3 - 1e-9);
      }
    });

    it('颜色写入 instanceColor 并标记 needsUpdate', () => {
      const spy = vi.spyOn(fx.mesh.instanceColor, 'needsUpdate', 'set');
      fx.burst({ pos: new THREE.Vector3(), color: [0xff0000, 0x00ff00], count: 4 });
      expect(spy).toHaveBeenCalled();
      const colors = new Set();
      for (let i = 0; i < 4; i++) colors.add(colorAt(fx, i));
      for (const c of colors) expect([0xff0000, 0x00ff00]).toContain(c);
    });

    it('单色用数组包裹，颜色一致', () => {
      fx.burst({ pos: new THREE.Vector3(), color: 0x123456, count: 3 });
      for (let i = 0; i < 3; i++) {
        expect(colorAt(fx, i)).toBe(0x123456);
      }
    });

    it('超过上限时覆盖最老的粒子（环形复用，不会越界）', () => {
      fx.burst({ pos: new THREE.Vector3(0, 0, 0), color: 0xffffff, count: MAX });
      expect(activeCount(fx)).toBe(MAX);
      expect(fx.cursor).toBe(0);

      fx.burst({ pos: new THREE.Vector3(9, 9, 9), color: 0xffffff, count: 10 });
      expect(fx.cursor).toBe(10);
      expect(activeCount(fx)).toBe(MAX); // 总数封顶
      for (let i = 0; i < 10; i++) {
        expect(fx.items[i].pos.x).toBe(9); // 下标 0..9 是最老的，被覆盖
        expect(fx.items[i].active).toBe(true);
      }
      expect(fx.items[10].pos.x).toBe(0);
    });

    it('连续 burst 多次后光标始终在 [0,280)', () => {
      for (let i = 0; i < 90; i++) fx.burst({ pos: new THREE.Vector3(), color: 0xffffff, count: 7 });
      expect(fx.cursor).toBeGreaterThanOrEqual(0);
      expect(fx.cursor).toBeLessThan(MAX);
      expect(activeCount(fx)).toBe(MAX);
    });
  });

  describe('muzzle / splat / explosion', () => {
    it('muzzle 生成 5 个粒子，速度 4、life 0.18、size 0.07、drag 5', () => {
      const pos = new THREE.Vector3(0, 1, 0);
      fx.muzzle(pos, 0x8ade2a);
      expect(activeCount(fx)).toBe(5);
      for (const p of fx.items.slice(0, 5)) {
        expect(p.drag).toBe(5);
        expect(p.life).toBeGreaterThanOrEqual(0.18 * 0.7);
        expect(p.life).toBeLessThanOrEqual(0.18 * 1.25);
        expect(p.pos.equals(pos)).toBe(true);
      }
    });

    it('splat 生成 6 个粒子，重力 9、life 0.32', () => {
      fx.splat(new THREE.Vector3(2, 0.5, 2), 0xe8452f);
      expect(activeCount(fx)).toBe(6);
      expect(fx.items[0].gravity).toBe(9);
      expect(fx.items[0].life).toBeGreaterThanOrEqual(0.32 * 0.7);
      expect(fx.items[0].life).toBeLessThanOrEqual(0.32 * 1.25);
    });

    it('explosion 分两批喷出 22 + 9 个粒子', () => {
      fx.explosion(new THREE.Vector3(0, 0, 0), 3);
      expect(activeCount(fx)).toBe(31);
      expect(fx.cursor).toBe(31);
      // 第二批是烟：负重力
      expect(fx.items[0].gravity).toBe(6);
      expect(fx.items[22].gravity).toBe(-1.2);
      expect(fx.items[22].size).toBeGreaterThanOrEqual(0.26 * 0.6);
      expect(fx.items[22].size).toBeLessThanOrEqual(0.26 * 1.5);
    });

    it('explosion 点亮球壳、冲击环与点光源', () => {
      const pos = new THREE.Vector3(4, 1, -6);
      fx.explosion(pos, 5.6);

      const shell = fx.shells[0];
      expect(shell.active).toBe(true);
      expect(shell.t).toBe(0);
      expect(shell.radius).toBe(5.6);
      expect(shell.mesh.visible).toBe(true);
      expect(shell.mesh.position.equals(pos)).toBe(true);
      expect(shell.mesh.scale.x).toBe(0.3);
      expect(shell.mesh.material.opacity).toBe(0.55);

      const ring = fx.rings[0];
      expect(ring.active).toBe(true);
      expect(ring.mesh.visible).toBe(true);
      expect(ring.mesh.position.x).toBe(pos.x);
      expect(ring.mesh.position.y).toBe(0.08); // 贴地
      expect(ring.mesh.position.z).toBe(pos.z);
      expect(ring.mesh.material.opacity).toBe(0.7);

      expect(fx.flash.visible).toBe(true);
      expect(fx.flash.intensity).toBe(26);
      expect(fx.flashTime).toBe(0.18);
      expect(fx.flash.position.x).toBe(pos.x);
      expect(fx.flash.position.y).toBe(pos.y + 1.2);
      expect(fx.flash.position.z).toBe(pos.z);
    });

    it('多次爆炸轮换使用球壳/冲击环，超出 3 个时复用第 0 个', () => {
      const v = new THREE.Vector3();
      fx.explosion(v, 1);
      fx.explosion(v, 2);
      fx.explosion(v, 3);
      expect(fx.shells.map((s) => s.active)).toEqual([true, true, true]);
      fx.explosion(v, 4);
      expect(fx.shells.map((s) => s.radius)).toEqual([4, 2, 3]);
      expect(fx.rings.map((r) => r.radius)).toEqual([4, 2, 3]);
    });

    it('不传半径时 burst 速度默认 3（explosion 的 radius 为 undefined）', () => {
      expect(() => fx.explosion(new THREE.Vector3(), undefined)).not.toThrow();
      expect(fx.shells[0].radius).toBeUndefined();
    });
  });

  describe('update', () => {
    it('粒子受重力下落、位置按速度推进，写回实例矩阵并标记 needsUpdate', () => {
      fx.burst({
        pos: new THREE.Vector3(0, 10, 0),
        color: 0xffffff,
        count: 1,
        speed: 0.0001,
        gravity: 10,
        drag: 0,
        life: 10,
      });
      const p = fx.items[0];
      const velY0 = p.vel.y;
      const spy = vi.spyOn(fx.mesh.instanceMatrix, 'needsUpdate', 'set');
      fx.update(0.1);
      expect(spy).toHaveBeenCalled();
      expect(p.vel.y).toBeCloseTo(velY0 - 10 * 0.1, 6); // 重力积分
      expect(p.pos.y).toBeCloseTo(10 + p.vel.y * 0.1, 6);
      const { pos } = decompose(fx, 0);
      expect(pos.y).toBeCloseTo(p.pos.y, 4);
    });

    it('水平速度按阻力衰减（1 - min(0.95, drag*dt)）', () => {
      fx.burst({ pos: new THREE.Vector3(0, 5, 0), color: 0xffffff, count: 1, speed: 4, gravity: 0, drag: 2, life: 10 });
      const p = fx.items[0];
      const vx0 = p.vel.x;
      const vz0 = p.vel.z;
      const x0 = p.pos.x;
      fx.update(0.25); // d = 1 - 0.5
      expect(p.vel.x).toBeCloseTo(vx0 * 0.5, 6);
      expect(p.vel.z).toBeCloseTo(vz0 * 0.5, 6);
      // 源码顺序是“先衰减速度、再按新速度位移”
      expect(p.pos.x - x0).toBeCloseTo(p.vel.x * 0.25, 6);
      expect(p.pos.z).toBeCloseTo(p.vel.z * 0.25, 6);
    });

    it('阻力上限 0.95：巨大 dt 也不会把水平速度反向', () => {
      fx.burst({ pos: new THREE.Vector3(0, 50, 0), color: 0xffffff, count: 1, speed: 3, gravity: 0, drag: 100, life: 10 });
      const p = fx.items[0];
      const vx0 = p.vel.x;
      fx.update(1);
      // d = 1 - min(0.95, 100*1) = 0.05，不会反号
      expect(p.vel.x).toBeCloseTo(vx0 * 0.05, 6);
      expect(Math.sign(p.vel.x)).toBe(Math.sign(vx0));
    });

    it('落到地面 y=0.05 时反弹：y 速度反向衰减、水平速度打折', () => {
      fx.items[0].active = true;
      const p = fx.items[0];
      p.pos.set(0, 0.06, 0);
      p.vel.set(2, -4, 2);
      p.gravity = 0;
      p.drag = 0;
      p.life = 1;
      p.maxLife = 1;
      fx.update(0.1);
      expect(p.pos.y).toBe(0.05);
      expect(p.vel.y).toBeCloseTo(4 * 0.32, 6);
      expect(p.vel.x).toBeCloseTo(2 * 0.7, 6);
      expect(p.vel.z).toBeCloseTo(2 * 0.7, 6);
    });

    it('life 归零的粒子失活并把矩阵缩到极小', () => {
      fx.burst({ pos: new THREE.Vector3(0, 4, 0), color: 0xffffff, count: 2, life: 0.2 });
      expect(activeCount(fx)).toBe(2);
      fx.update(1);
      expect(fx.items[0].active).toBe(false);
      expect(fx.items[1].active).toBe(false);
      for (let i = 0; i < 2; i++) {
        const { pos, scale } = decompose(fx, i);
        expect(pos.y).toBe(-1000);
        expect(scale.x).toBeCloseTo(0.0001, 8);
      }
    });

    it('粒子尺寸随生命比例线性缩小（0.35 + 0.65k）', () => {
      fx.items[0].active = true;
      const p = fx.items[0];
      p.pos.set(0, 5, 0);
      p.vel.set(0, 0, 0);
      p.gravity = 0;
      p.drag = 0;
      p.size = 1;
      p.life = 1;
      p.maxLife = 1;
      fx.update(0); // k = 1
      expect(decompose(fx, 0).scale.x).toBeCloseTo(1, 5);
      fx.update(0.5); // life 0.5，k = 0.5
      expect(decompose(fx, 0).scale.x).toBeCloseTo(0.35 + 0.65 * 0.5, 5);
    });

    it('球壳按缓动放大、透明度衰减，dur 到点后隐藏', () => {
      fx.explosion(new THREE.Vector3(), 4);
      const shell = fx.shells[0];
      fx.update(0.16); // dur 0.32，k = 0.5
      expect(shell.mesh.scale.x).toBeGreaterThan(0.3);
      expect(shell.mesh.scale.x).toBeCloseTo(0.3 + (1 - Math.pow(0.5, 2.4)) * 4 * 0.82, 5);
      expect(shell.mesh.material.opacity).toBeCloseTo(0.55 * 0.25, 5);
      expect(shell.mesh.visible).toBe(true);

      fx.update(0.2); // k >= 1
      expect(shell.active).toBe(false);
      expect(shell.mesh.visible).toBe(false);
    });

    it('冲击环线性缓动放大、透明度衰减，dur 到点后隐藏', () => {
      fx.explosion(new THREE.Vector3(), 5);
      const ring = fx.rings[0];
      fx.update(0.225); // dur 0.45，k = 0.5
      expect(ring.mesh.scale.x).toBeCloseTo(0.3 + (1 - Math.pow(0.5, 2)) * 5, 5);
      expect(ring.mesh.material.opacity).toBeCloseTo(0.45 * 0.5, 5);
      fx.update(0.3);
      expect(ring.active).toBe(false);
      expect(ring.mesh.visible).toBe(false);
    });

    it('点光源强度随时间衰减到 0 后隐藏', () => {
      fx.explosion(new THREE.Vector3(), 2);
      expect(fx.flash.intensity).toBe(26);
      fx.update(0.09); // flashTime 0.09 → 一半
      expect(fx.flashTime).toBeCloseTo(0.09, 6);
      expect(fx.flash.intensity).toBeCloseTo(13, 5);
      expect(fx.flash.visible).toBe(true);
      fx.update(0.1); // flashTime 变负
      expect(fx.flashTime).toBeLessThan(0);
      expect(fx.flash.intensity).toBe(0);
      expect(fx.flash.visible).toBe(false);
      // 之后不再变化
      fx.update(1);
      expect(fx.flash.intensity).toBe(0);
      expect(fx.flash.visible).toBe(false);
    });

    it('没有活跃粒子/特效时 update 不抛错', () => {
      expect(() => {
        fx.update(0.016);
        fx.update(1);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('清空所有粒子与特效，隐藏光源并把矩阵归零', () => {
      fx.burst({ pos: new THREE.Vector3(0, 3, 0), color: 0xffffff, count: 20 });
      fx.explosion(new THREE.Vector3(1, 1, 1), 3);
      expect(activeCount(fx)).toBeGreaterThan(0);

      const spy = vi.spyOn(fx.mesh.instanceMatrix, 'needsUpdate', 'set');
      fx.clear();

      expect(spy).toHaveBeenCalled();
      expect(activeCount(fx)).toBe(0);
      for (const i of [0, 1, 21, 30, 100, MAX - 1]) {
        const { pos, scale } = decompose(fx, i);
        expect(pos.y).toBe(-1000);
        expect(scale.x).toBeCloseTo(0.0001, 8);
      }
      expect(fx.shells.every((s) => s.active === false && s.mesh.visible === false)).toBe(true);
      expect(fx.rings.every((r) => r.active === false && r.mesh.visible === false)).toBe(true);
      expect(fx.flash.visible).toBe(false);
      expect(fx.flashTime).toBe(0);
    });

    it('clear 不会重置光标（只是失活，环形复用继续）', () => {
      fx.burst({ pos: new THREE.Vector3(), color: 0xffffff, count: 12 });
      const cursor = fx.cursor;
      fx.clear();
      expect(fx.cursor).toBe(cursor);
    });

    it('update 在 clear 之后不会复活粒子', () => {
      fx.burst({ pos: new THREE.Vector3(0, 2, 0), color: 0xffffff, count: 10 });
      fx.clear();
      fx.update(0.1);
      expect(activeCount(fx)).toBe(0);
    });
  });
});