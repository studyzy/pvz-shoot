// 画质档位（docs/plans/2026-11-12-render-overhaul.md §7.2）。
//
// 为什么要有显式档位而不是纯自适应：自适应只在「已经卡了」之后才降，
// 玩家第一分钟就在掉帧。低端机玩家通常知道自己机器弱，愿意主动选低画质
// 换稳定帧率 —— 这是偏好问题，不是算法问题。
import { describe, it, expect } from 'vitest';
import {
  QUALITY_PRESETS,
  QUALITY_ORDER,
  QUALITY_KEY,
  readQuality,
  writeQuality,
  resolveQuality,
} from '../../src/fx/quality.js';

const fakeStore = (init = {}) => {
  const m = { ...init };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    _raw: m,
  };
};

describe('档位定义', () => {
  it('四档都在，且顺序从高到低（auto 在最前）', () => {
    expect(QUALITY_ORDER).toEqual(['auto', 'high', 'medium', 'low']);
    for (const id of QUALITY_ORDER) expect(QUALITY_PRESETS[id], id).toBeTruthy();
  });

  it('档位越高，像素比/后期/阴影三项都越大（单调性）', () => {
    const h = QUALITY_PRESETS.high;
    const m = QUALITY_PRESETS.medium;
    const l = QUALITY_PRESETS.low;
    expect(h.pixelRatioCap).toBeGreaterThan(m.pixelRatioCap);
    expect(m.pixelRatioCap).toBeGreaterThan(l.pixelRatioCap);
    expect(h.postLevel).toBeGreaterThan(m.postLevel);
    expect(m.postLevel).toBeGreaterThan(l.postLevel);
    expect(h.shadowMapSize).toBeGreaterThan(m.shadowMapSize);
    expect(m.shadowMapSize).toBeGreaterThan(l.shadowMapSize);
  });

  it('低档关掉全部后期（直出最快）', () => {
    expect(QUALITY_PRESETS.low.postLevel).toBe(0);
  });

  it('auto 三项都是 null（表示「不指定」而不是 0）', () => {
    const a = QUALITY_PRESETS.auto;
    expect(a.pixelRatioCap).toBe(null);
    expect(a.postLevel).toBe(null);
    expect(a.shadowMapSize).toBe(null);
  });
});

describe('读档', () => {
  it('没存过时返回 auto', () => {
    expect(readQuality(fakeStore())).toBe('auto');
  });

  it('读回存过的档位', () => {
    expect(readQuality(fakeStore({ [QUALITY_KEY]: 'low' }))).toBe('low');
  });

  it('非法值退回 auto（不信任存档）', () => {
    expect(readQuality(fakeStore({ [QUALITY_KEY]: 'ultra' }))).toBe('auto');
    expect(readQuality(fakeStore({ [QUALITY_KEY]: '' }))).toBe('auto');
  });

  it('storage 为 null 不抛错', () => {
    expect(() => readQuality(null)).not.toThrow();
  });

  it('storage 抛异常（隐私模式）时退回 auto', () => {
    const bad = { getItem() { throw new Error('SecurityError'); } };
    expect(readQuality(bad)).toBe('auto');
  });
});

describe('写档', () => {
  it('写进去能读回来', () => {
    const s = fakeStore();
    expect(writeQuality('medium', s)).toBe(true);
    expect(readQuality(s)).toBe('medium');
  });

  it('非法档位不写（避免污染存档）', () => {
    const s = fakeStore();
    expect(writeQuality('nonsense', s)).toBe(false);
    expect(readQuality(s)).toBe('auto');
  });

  it('写失败静默返回 false，不抛错', () => {
    const bad = { setItem() { throw new Error('QuotaExceeded'); } };
    expect(() => writeQuality('high', bad)).not.toThrow();
    expect(writeQuality('high', bad)).toBe(false);
  });
});

describe('解析生效参数', () => {
  it('auto 跟随设备 DPR', () => {
    const r = resolveQuality('auto', { devicePixelRatio: 2 });
    expect(r.pixelRatioCap).toBe(2);
    expect(r.postLevel).toBe(null);
  });

  it('auto 在触屏上封到 1.5', () => {
    const r = resolveQuality('auto', { devicePixelRatio: 3, isTouch: true });
    expect(r.pixelRatioCap).toBe(1.5);
    expect(r.maxPostLevel).toBe(1);
  });

  it('显式高档覆盖探测值', () => {
    const r = resolveQuality('high', { devicePixelRatio: 1, isTouch: false });
    expect(r.pixelRatioCap).toBe(1); // 不超过设备 DPR
    expect(r.postLevel).toBe(2);
    expect(r.shadowMapSize).toBe(2048);
  });

  it('高档在 2x 屏上取 2，不会超采样', () => {
    const r = resolveQuality('high', { devicePixelRatio: 2 });
    expect(r.pixelRatioCap).toBe(2);
  });

  it('低档在 3x 屏上仍然封到 1（这是低档的意义）', () => {
    const r = resolveQuality('low', { devicePixelRatio: 3 });
    expect(r.pixelRatioCap).toBe(1);
    expect(r.postLevel).toBe(0);
  });

  it('触屏上选高档也只是 1.5 上限（手机填充率有限）', () => {
    const r = resolveQuality('high', { devicePixelRatio: 3, isTouch: true });
    expect(r.pixelRatioCap).toBe(1.5);
  });

  it('未知档位按 auto 处理', () => {
    const r = resolveQuality('bogus', { devicePixelRatio: 2 });
    expect(r.id).toBe('auto');
    expect(r.pixelRatioCap).toBe(2);
  });

  it('每个显式档位的 postLevel 也是 maxPostLevel（不做二次自适应降级到更高）', () => {
    for (const id of ['high', 'medium', 'low']) {
      const r = resolveQuality(id, {});
      expect(r.maxPostLevel).toBe(r.postLevel);
    }
  });
});