import { describe, it, expect } from 'vitest';
import {
  FrameStats,
  RAMP,
  RAMP_STEPS,
  fitCamera,
  gridLayout,
  nextRampStep,
  shortNumber,
  verdictFor,
} from '../../src/stress/metrics.js';

describe('压测页帧率统计', () => {
  it('没有样本时所有指标为 0，不会出现 NaN', () => {
    const s = new FrameStats(10);
    expect(s.count).toBe(0);
    expect(s.fps).toBe(0);
    expect(s.avgMs).toBe(0);
    expect(s.p95Ms).toBe(0);
    expect(s.worstMs).toBe(0);
    expect(s.summary()).toEqual({ frames: 0, fps: 0, avgMs: 0, p95Ms: 0, worstMs: 0 });
  });

  it('稳定 60fps 的窗口读到 60', () => {
    const s = new FrameStats(90);
    for (let i = 0; i < 60; i++) s.push(1 / 60);
    expect(s.count).toBe(60);
    expect(s.avgMs).toBeCloseTo(16.667, 3);
    expect(s.fps).toBeCloseTo(60, 5);
    expect(s.p95Ms).toBeCloseTo(16.667, 3);
  });

  it('只保留最近 capacity 帧，旧帧被挤掉', () => {
    const s = new FrameStats(3);
    s.push(1 / 60);
    s.push(1 / 30);
    s.push(1 / 20);
    s.push(1 / 10);
    expect(s.count).toBe(3);
    expect(s.worstMs).toBeCloseTo(100, 5);
    expect(s.avgMs).toBeCloseTo((50 + 33.333 + 100) / 3, 2);
  });

  it('忽略 0 / 负数 / NaN / Infinity 这类无效间隔', () => {
    const s = new FrameStats(5);
    s.push(0);
    s.push(-1);
    s.push(NaN);
    s.push(Infinity);
    expect(s.count).toBe(0);
    s.push(0.02);
    expect(s.count).toBe(1);
  });

  it('卡顿帧会被 P95 抓到，但不会被平均帧时间完全掩盖', () => {
    const s = new FrameStats(200);
    for (let i = 0; i < 90; i++) s.push(0.01);
    for (let i = 0; i < 10; i++) s.push(0.1);
    expect(s.count).toBe(100);
    expect(s.worstMs).toBeCloseTo(100, 5);
    expect(s.p95Ms).toBeCloseTo(100, 5);
    expect(s.avgMs).toBeCloseTo(19, 5);
  });

  it('超长间隔（切标签页）按 1 秒封顶', () => {
    const s = new FrameStats(5);
    s.push(5);
    expect(s.worstMs).toBe(1000);
  });

  it('reset 清空窗口', () => {
    const s = new FrameStats(5);
    s.push(0.016);
    s.reset();
    expect(s.count).toBe(0);
    expect(s.fps).toBe(0);
  });

  it('capacity 至少为 1', () => {
    const s = new FrameStats(0);
    s.push(0.016);
    s.push(0.016);
    expect(s.count).toBe(1);
  });
});

describe('压测页方阵排布', () => {
  it('0 只时没有任何位置', () => {
    const g = gridLayout(0);
    expect(g).toEqual({ cols: 0, rows: 0, width: 0, depth: 0, positions: [] });
  });

  it('1 只摆在原点', () => {
    const g = gridLayout(1, 1.5);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
    expect(g.positions).toEqual([{ x: 0, z: 0 }]);
  });

  it('方阵居中、列比行多，且位置数量等于僵尸数', () => {
    const g = gridLayout(14, 2);
    expect(g.positions.length).toBe(14);
    expect(g.cols).toBeGreaterThan(g.rows);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(14);
    expect(g.width).toBe(g.cols * 2);
    expect(g.depth).toBe(g.rows * 2);
    const xs = g.positions.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 6);
    const zs = g.positions.map((p) => p.z);
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0, 6);
  });

  it('64 只也是居中的网格，不会退化成一条线', () => {
    const g = gridLayout(64, 1.55);
    expect(g.positions.length).toBe(64);
    expect(g.cols).toBeGreaterThan(1);
    expect(g.rows).toBeGreaterThan(1);
    expect(new Set(g.positions.map((p) => p.x)).size).toBe(g.cols);
  });

  it('非法数量与间距有兜底', () => {
    expect(gridLayout('abc').positions).toEqual([]);
    expect(gridLayout(-5).positions).toEqual([]);
    const g = gridLayout(4, 0);
    expect(g.width).toBe(g.cols * 1.5); // 间距 0 回落到默认 1.5
  });
});

describe('压测页相机取景', () => {
  it('方阵越大，相机越远', () => {
    const small = fitCamera({ width: 4, depth: 3, aspect: 1.6 });
    const big = fitCamera({ width: 20, depth: 12, aspect: 1.6 });
    expect(big.distance).toBeGreaterThan(small.distance);
  });

  it('竖屏视野窄，同样方阵要拉得更远', () => {
    const landscape = fitCamera({ width: 12, depth: 6, aspect: 1.8 });
    const portrait = fitCamera({ width: 12, depth: 6, aspect: 0.5 });
    expect(portrait.distance).toBeGreaterThan(landscape.distance);
  });

  it('注视点取模型半高，短方阵也不会贴地', () => {
    expect(fitCamera({ width: 2, depth: 2, height: 2.2 }).targetY).toBeCloseTo(1.1, 5);
    expect(fitCamera({ width: 2, depth: 2, height: 0.2 }).targetY).toBeCloseTo(0.65, 5);
  });

  it('缺省参数可用', () => {
    const d = fitCamera();
    expect(d.distance).toBeGreaterThan(0);
    expect(Number.isFinite(d.distance)).toBe(true);
  });
});

describe('压测页判定与格式化', () => {
  it('帧率分档边界', () => {
    expect(verdictFor(120).id).toBe('smooth');
    expect(verdictFor(60).id).toBe('smooth');
    expect(verdictFor(55).id).toBe('smooth');
    expect(verdictFor(54.9).id).toBe('light');
    expect(verdictFor(40).id).toBe('light');
    expect(verdictFor(39.9).id).toBe('heavy');
    expect(verdictFor(25).id).toBe('heavy');
    expect(verdictFor(24.9).id).toBe('bad');
    expect(verdictFor(0).id).toBe('bad');
    expect(verdictFor(NaN).id).toBe('bad');
  });

  it('三角面/绘制数用短单位', () => {
    expect(shortNumber(0)).toBe('0');
    expect(shortNumber(999)).toBe('999');
    expect(shortNumber(1000)).toBe('1.0k');
    expect(shortNumber(7822)).toBe('7.8k');
    expect(shortNumber(150000)).toBe('150k');
    expect(shortNumber(80000)).toBe('80k');
    expect(shortNumber(1000000)).toBe('1.0M');
    expect(shortNumber(12000000)).toBe('12M');
    expect(shortNumber(-5)).toBe('0');
    expect(shortNumber('abc')).toBe('0');
  });

  it('自动爬坡档位单调递增，到顶返回 null', () => {
    for (let i = 1; i < RAMP_STEPS.length; i++) {
      expect(RAMP_STEPS[i]).toBeGreaterThan(RAMP_STEPS[i - 1]);
    }
    expect(nextRampStep(RAMP_STEPS[0])).toBe(RAMP_STEPS[1]);
    expect(nextRampStep(RAMP_STEPS[RAMP_STEPS.length - 1])).toBeNull();
    expect(nextRampStep(999)).toBe(RAMP_STEPS[0]);
    expect(RAMP.measureMs).toBeGreaterThan(0);
    expect(RAMP.failFps).toBeGreaterThan(0);
  });
});
