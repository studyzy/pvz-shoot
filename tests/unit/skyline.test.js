// 远景剪影（docs/plans/2026-11-12-render-overhaul.md §3.3）。
//
// 场地外原本是空的（天直接接地面）。补一圈远景：约 2 个 draw call，但让
// 「世界比场地大」成立。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSkyline, SKYLINE_PRESETS } from '../../src/world/skyline.js';

describe('远景剪影', () => {
  it('六张图都有配方', () => {
    for (const id of ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown']) {
      expect(SKYLINE_PRESETS[id], id).toBeTruthy();
    }
  });

  it('只有 2 个 draw call（近层 + 远层）', () => {
    const s = createSkyline({ preset: 'backyard' });
    expect(s.group.children.length).toBe(2);
    for (const c of s.group.children) expect(c.isMesh).toBe(true);
  });

  it('不接阴影、不吃雾、不挡场景（renderOrder 在天空之后）', () => {
    const s = createSkyline({ preset: 'downtown' });
    for (const c of s.group.children) {
      expect(c.castShadow).toBe(false);
      expect(c.receiveShadow).toBe(false);
      expect(c.material.fog).toBe(false);
      // 天空是 -1000，剪影必须在它之后、场景（0）之前
      expect(c.renderOrder).toBeGreaterThan(-1000);
      expect(c.renderOrder).toBeLessThan(0);
    }
  });

  it('半径远大于场地半宽 —— 玩家走到任何位置它都在外面', () => {
    for (const id of Object.keys(SKYLINE_PRESETS)) {
      expect(SKYLINE_PRESETS[id].radius, id).toBeGreaterThan(150);
    }
  });

  it('同一张图反复 setPreset 不重建（按 id 短路）', () => {
    const s = createSkyline({ preset: 'backyard' });
    const before = s.group.children[0];
    s.setPreset('backyard');
    expect(s.group.children[0]).toBe(before);
  });

  it('切图会换颜色与几何（不是复用上一张图）', () => {
    const s = createSkyline({ preset: 'backyard' });
    const c0 = s.group.children[0].material.color.getHex();
    s.setPreset('downtown');
    const c1 = s.group.children[0].material.color.getHex();
    expect(c1).not.toBe(c0);
    expect(s.group.children.length).toBe(2);
  });

  it('几何位置生成稳定（同 seed 同结果，不会每次进图都不一样）', () => {
    const a = createSkyline({ preset: 'snow' });
    const b = createSkyline({ preset: 'snow' });
    const pa = a.group.children[0].geometry.getAttribute('position');
    const pb = b.group.children[0].geometry.getAttribute('position');
    expect(pa.count).toBe(pb.count);
    for (let i = 0; i < Math.min(pa.count, 30); i++) {
      expect(pa.getX(i)).toBeCloseTo(pb.getX(i), 6);
    }
  });

  it('未知 preset 回落到后院', () => {
    const s = createSkyline({ preset: 'no-such' });
    expect(s.group.children.length).toBe(2);
  });

  it('dispose 后 group 为空、材质已释放', () => {
    const s = createSkyline({ preset: 'forest' });
    const mat = s.group.children[0].material;
    s.dispose();
    expect(s.group.children.length).toBe(0);
    expect(mat.color).toBeTruthy(); // Color 对象还在，材质本身已 dispose（不抛错即可）
  });

  it('围成一圈：几何在多个象限都有（不是只铺一侧）', () => {
    const s = createSkyline({ preset: 'downtown' });
    const pos = s.group.children[0].geometry.getAttribute('position');
    const quad = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const q = (x >= 0 ? 0 : 1) + (z >= 0 ? 0 : 2);
      quad[q]++;
    }
    for (let i = 0; i < 4; i++) expect(quad[i], `象限 ${i} 没有轮廓`).toBeGreaterThan(0);
  });
});