// SSAO（docs/plans/2026-11-12-render-overhaul.md §2.2）。
//
// 阴影之外的第二层：实时投影给的是方向光的投射影，SSAO 给的是「角落变暗」。
// 没有它时，即使有阴影，僵尸脚与地面、木箱与墙的缝隙里也是亮的 ——
// 物体看起来像「贴」在场景上而不是「站」在里面。
//
// jsdom 没有 WebGL，所以测能力探测、尺寸策略、噪声图与 shader 结构，
// 不测像素。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeGLRenderer } from '../helpers/glstub.js';
import { createSSAO, aoNoiseTexture, AO_FRAG } from '../../src/fx/ssao.js';

describe('SSAO · 能力探测', () => {
  it('没有渲染器时返回哑对象，不抛错', () => {
    const s = createSSAO(null);
    expect(s.enabled).toBe(false);
    expect(s.render(null, null)).toBe(false);
    expect(s.texture).toBe(null);
    expect(() => s.setSize(100, 100)).not.toThrow();
    expect(() => s.dispose()).not.toThrow();
  });

  it('假渲染器（jsdom 测试替身）安全退回', () => {
    const s = createSSAO({ setRenderTarget() {}, getRenderTarget() {} });
    expect(s.enabled).toBe(false);
    expect(s.render({}, {})).toBe(false);
  });

  it('getContext 抛异常也退回，不冒泡', () => {
    const s = createSSAO({
      getContext() { throw new Error('lost'); },
      setRenderTarget() {},
    });
    expect(s.enabled).toBe(false);
  });
});

describe('SSAO · 噪声图', () => {
  it('是 4x4 的 DataTexture，可平铺、最近邻', () => {
    const t = aoNoiseTexture(4);
    expect(t).toBeInstanceOf(THREE.DataTexture);
    expect(t.image.width).toBe(4);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.magFilter).toBe(THREE.NearestFilter);
    // 噪声图是方向向量，不是颜色：必须线性空间
    expect(t.colorSpace === THREE.NoColorSpace || t.colorSpace === '').toBe(true);
  });

  it('方向均匀分布在单位圆上（不是全指向一处）', () => {
    const t = aoNoiseTexture(4);
    const d = t.image.data;
    let sx = 0;
    let sy = 0;
    const n = 16;
    for (let i = 0; i < n; i++) {
      sx += d[i * 4] / 255 * 2 - 1;
      sy += d[i * 4 + 1] / 255 * 2 - 1;
    }
    // 均匀分布下各方向应大致抵消
    expect(Math.abs(sx / n)).toBeLessThan(0.45);
    expect(Math.abs(sy / n)).toBeLessThan(0.45);
  });

  it('z 分量为 0（纯平面旋转，不需要立体噪声）', () => {
    const t = aoNoiseTexture(4);
    for (let i = 0; i < 16; i++) expect(t.image.data[i * 4 + 2]).toBe(0);
  });
});

describe('SSAO · shader 结构', () => {
  it('用 16 抽样', () => {
    expect(AO_FRAG).toContain('const int N = 16');
    expect(AO_FRAG).toContain('for (int i = 0; i < N; i++)');
  });

  it('用噪声旋转采样半球（否则会出现条带）', () => {
    expect(AO_FRAG).toContain('tNoise');
    expect(AO_FRAG).toContain('tbn');
  });

  it('天空（深度 1）不产生 AO', () => {
    expect(AO_FRAG).toContain('0.9999');
  });

  it('从深度重建视空间坐标（不需要额外法线 RT）', () => {
    expect(AO_FRAG).toContain('uProjInv');
    expect(AO_FRAG).toContain('viewPos');
  });

  it('法线由深度偏导重建', () => {
    expect(AO_FRAG).toContain('dFdx');
    expect(AO_FRAG).toContain('dFdy');
    expect(AO_FRAG).toContain('cross');
  });

  it('有 bias 防止自遮蔽（否则平面会糊上一层脏）', () => {
    expect(AO_FRAG).toContain('uBias');
    expect(AO_FRAG).toContain('diff > uBias');
  });

  it('采样半径随 i 递增（近处密、远处稀）', () => {
    expect(AO_FRAG).toContain('uRadius * (0.35 + 0.65');
  });

  it('AO 结果夹在 0~1', () => {
    expect(AO_FRAG).toContain('clamp(ao, 0.0, 1.0)');
  });
});

describe('SSAO · 尺寸策略', () => {
  it('半分辨率运行（AO 是低频信号，省 75% 像素）', () => {
    // 通过 shader 里的 uResolution / uFullRes 两个 uniform 体现：
    // 采样用全分辨率步长，输出用半分辨率 RT。
    expect(AO_FRAG).toContain('uFullRes');
    expect(AO_FRAG).toContain('uResolution');
  });

  it('dispose 后 enabled 置 false', () => {
    const s = createSSAO(null);
    s.dispose();
    expect(s.enabled).toBe(false);
  });
});

// 装配层：能力探测通过后 RT 真的建了吗？尺寸策略与失败兜底在下面是可观测的。
describe('SSAO · 装配（假 GL 渲染器）', () => {
  it('探测通过后 enabled=true，初始就有一张 2×2 的 RT', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    expect(s.enabled).toBe(true);
    expect(s.texture).toBeTruthy();
    expect(s.texture.image.width).toBe(2);
    s.dispose();
  });

  it('按半分辨率建 RT：1280×720 → 640×360', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    s.setSize(1280, 720);
    expect(s.texture.image.width).toBe(640);
    expect(s.texture.image.height).toBe(360);
    s.dispose();
  });

  it('极小尺寸抬到 2，避免 0 尺寸 RT 让 GL 报错', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    s.setSize(1, 1);
    expect(s.texture.image.width).toBeGreaterThanOrEqual(2);
    expect(s.texture.image.height).toBeGreaterThanOrEqual(2);
    s.dispose();
  });

  it('render 读深度图与相机投影逆矩阵，跑完把渲染目标还原', () => {
    const { renderer, calls } = makeGLRenderer();
    const s = createSSAO(renderer);
    s.setSize(640, 360);
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 200);
    expect(s.render(new THREE.DepthTexture(640, 360), camera)).toBe(true);
    expect(calls.render.length).toBe(1);
    // 最后一个渲染目标必须是 null：SSAO 只在半分辨率 RT 里跑一帧
    expect(calls.setRenderTarget.at(-1)).toBe(null);
    s.dispose();
  });

  it('没有相机时用默认近远平面（不依赖调用方一定传）', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    expect(s.render(new THREE.DepthTexture(4, 4), null)).toBe(true);
    s.dispose();
  });

  it('没有深度图（WebGL1 或建深度失败）时不出帧', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    expect(s.render(null, null)).toBe(false);
    s.dispose();
  });

  it('GL 抛错时释放 RT 并退回 false，之后不再尝试', () => {
    const { renderer } = makeGLRenderer({ onRender: () => { throw new Error('gl lost'); } });
    const s = createSSAO(renderer);
    expect(s.render(new THREE.DepthTexture(4, 4), null)).toBe(false);
    expect(s.texture).toBe(null);
    expect(s.render(new THREE.DepthTexture(4, 4), null)).toBe(false);
    s.dispose();
  });

  it('dispose 释放 RT：texture 变 null', () => {
    const s = createSSAO(makeGLRenderer().renderer);
    s.dispose();
    expect(s.enabled).toBe(false);
    expect(s.texture).toBe(null);
  });
});