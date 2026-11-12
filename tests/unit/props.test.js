// 环境叙事道具（docs/plans/2026-11-12-render-overhaul.md §6.1）。
//
// 后院原本是「草地 + 栅栏 + 房子 + 墓碑 + 树」——布景，不是场景。
// 有晾衣绳、垃圾桶、翻倒的花盆、水洼，才像是有人住的地方。
//
// 三条必须守住的原则：每类 1 个 draw call、位置种子固定（不能每局随机）、
// 中心区留空（装饰不能挡视线或卡走位）。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createProps, PROPS_PRESETS, makeRng } from '../../src/world/props.js';

describe('随机种子', () => {
  it('同一 seed 产出同一序列（道具位置可复现）', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('不同 seed 产出不同序列', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    let diff = 0;
    for (let i = 0; i < 20; i++) if (a() !== b()) diff++;
    expect(diff).toBeGreaterThan(15);
  });

  it('输出落在 [0,1)', () => {
    const r = makeRng(999);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('道具配方', () => {
  it('六张图都有配方', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown']) {
      expect(PROPS_PRESETS[id], id).toBeTruthy();
    }
  });

  it('每张图都有中心留空半径（装饰不能挡视线）', () => {
    for (const [id, p] of Object.entries(PROPS_PRESETS)) {
      expect(p.clearRadius, id).toBeGreaterThan(5);
    }
  });

  it('seed 各不相同（否则不同地图道具位置一样，会被看出来）', () => {
    const seeds = Object.values(PROPS_PRESETS).map((p) => p.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('createProps', () => {
  it('后院生成若干道具，且每类只有 1 个 draw call', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    expect(p.group.children.length).toBeGreaterThan(3);
    // 每个 child 都是 InstancedMesh（1 draw call / 类）
    for (const c of p.group.children) {
      expect(c.isInstancedMesh).toBe(true);
    }
    expect(p.count()).toBeGreaterThan(10);
  });

  it('所有实例都在场地内、且避开中心区', () => {
    const half = 23;
    const clear = PROPS_PRESETS.backyard.clearRadius;
    const p = createProps({ preset: 'backyard', half });
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const c of p.group.children) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        expect(Math.abs(v.x)).toBeLessThan(half);
        expect(Math.abs(v.z)).toBeLessThan(half);
        // 中心 clearRadius 内不该有道具
        expect(Math.hypot(v.x, v.z)).toBeGreaterThan(clear - 0.01);
      }
    }
  });

  it('同一张图两次生成位置完全一致（种子固定）', () => {
    const a = createProps({ preset: 'forest', half: 23 });
    const b = createProps({ preset: 'forest', half: 23 });
    const ma = new THREE.Matrix4();
    const mb = new THREE.Matrix4();
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    expect(a.group.children.length).toBe(b.group.children.length);
    for (let k = 0; k < a.group.children.length; k++) {
      const ca = a.group.children[k];
      const cb = b.group.children[k];
      expect(ca.count).toBe(cb.count);
      for (let i = 0; i < ca.count; i++) {
        ca.getMatrixAt(i, ma);
        cb.getMatrixAt(i, mb);
        va.setFromMatrixPosition(ma);
        vb.setFromMatrixPosition(mb);
        expect(va.x).toBeCloseTo(vb.x, 5);
        expect(va.z).toBeCloseTo(vb.z, 5);
      }
    }
  });

  it('每类道具之间留了间距（不叠在一起）', () => {
    const p = createProps({ preset: 'dust', half: 23 });
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const pts = [];
    for (const c of p.group.children) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        pts.push({ x: v.x, z: v.z });
      }
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        expect(d).toBeGreaterThan(1.0);
      }
    }
  });

  it('blocked 回调能挡住指定区域', () => {
    // 一片盖住半个场地的禁放区
    const blocked = (x) => x > 0;
    const p = createProps({ preset: 'backyard', half: 23, blocked });
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const c of p.group.children) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        expect(v.x).toBeLessThanOrEqual(0);
      }
    }
  });

  it('切图会清掉旧道具（不会累积）', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    const before = p.group.children.length;
    expect(before).toBeGreaterThan(0);
    p.setPreset('downtown');
    // 数量不一定相同，但必须仍是「重建后」的状态，且没有旧材质残留
    expect(p.group.children.length).toBeGreaterThan(0);
    for (const c of p.group.children) expect(c.isInstancedMesh).toBe(true);
  });

  it('同一张图重复 setPreset 不重建（按 id 短路）', () => {
    const p = createProps({ preset: 'snow', half: 23 });
    const first = p.group.children[0];
    p.setPreset('snow');
    expect(p.group.children[0]).toBe(first);
  });

  it('未知 preset 清空而不崩', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    p.setPreset('no-such-map');
    expect(p.group.children.length).toBe(0);
    expect(p.count()).toBe(0);
  });

  it('不接阴影外的额外开销：castShadow 打开，frustumCulled 关掉（实例包围盒不准）', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    for (const c of p.group.children) {
      expect(c.castShadow).toBe(true);
      expect(c.frustumCulled).toBe(false);
    }
  });

  it('dispose 后 group 为空', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    p.dispose();
    expect(p.group.children.length).toBe(0);
    expect(p.count()).toBe(0);
  });

  it('每种道具都有几何（几何合并没失败）', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    for (const c of p.group.children) {
      expect(c.geometry).toBeInstanceOf(THREE.BufferGeometry);
      const pos = c.geometry.getAttribute('position');
      expect(pos).toBeTruthy();
      expect(pos.count).toBeGreaterThan(0);
      // 有法线才能正确受光
      expect(c.geometry.getAttribute('normal')).toBeTruthy();
    }
  });

  it('道具都贴地（y≈0，不悬空不埋地）', () => {
    const p = createProps({ preset: 'backyard', half: 23 });
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const c of p.group.children) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        expect(Math.abs(v.y)).toBeLessThan(0.01);
      }
    }
  });
});
describe('异常配方 · 兜底', () => {
  it('未知道具类型只跳过自己，同组的已知类型照常摆出来', () => {
    PROPS_PRESETS.__test_unknown = { seed: 31, kinds: { bogus: { count: 5 }, rock: { count: 3 } } };
    const p = createProps({ preset: '__test_unknown', half: 20, wallHalf: 1 });
    expect(p.count()).toBeGreaterThan(0);
    // bogus 不该产生空的 InstancedMesh，group 里只该有 rock 那一个
    expect(p.group.children.length).toBe(1);
    p.dispose();
    delete PROPS_PRESETS.__test_unknown;
  });

  it('一整类都被 blocked 拒绝时不留下空 mesh（几何与材质当场释放）', () => {
    PROPS_PRESETS.__test_blocked = { seed: 31, kinds: { rock: { count: 4 } } };
    const p = createProps({ preset: '__test_blocked', half: 20, wallHalf: 1, blocked: () => true });
    expect(p.count()).toBe(0);
    expect(p.group.children.length).toBe(0);
    p.dispose();
    delete PROPS_PRESETS.__test_blocked;
  });
});
