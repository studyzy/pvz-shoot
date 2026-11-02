// 实体插值与快照缓冲的单元测试。
//
// 这是「客人看着卡」的直接解药：没有插值，30Hz 快照在 60fps 屏幕上就是每 33ms 一次跳变。
// 这里的用例覆盖：环形缓冲上限、延迟插值、角度最短弧、血量不插值、抖动自适应。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SnapshotBuffer, blendSnapshot, INTERP_DELAY_MS } from '../../src/net/interpolate.js';

// 受控时钟：插值逻辑完全依赖 performance.now，必须能拨
function withClock() {
  let t = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  return {
    advance(ms) {
      t += ms;
    },
  };
}

function snap(tick, opts = {}) {
  return {
    tick,
    sun: 0,
    wave: 1,
    state: 'idle',
    players: [
      { x: opts.x ?? 0, y: 0, z: 0, yaw: opts.yaw ?? 0, pitch: 0, hp: opts.hp ?? 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
    ],
    zombies: opts.zombies || [],
  };
}

function zombie(id, x, z, extra = {}) {
  return { id, t: 'normal', x, y: 0, z, yaw: 0, hp: 100, sp: 1, ar: 0, st: 1, sl: 0, bo: 0, co: 0, ab: 0, ...extra };
}

describe('SnapshotBuffer', () => {
  let clock;
  beforeEach(() => {
    clock = withClock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('空缓冲 sample 返回 null；只有一帧时直接返回那一帧', () => {
    const buf = new SnapshotBuffer();
    expect(buf.empty).toBe(true);
    expect(buf.sample(performance.now())).toBeNull();

    const s = snap(1);
    buf.push(s);
    expect(buf.empty).toBe(false);
    expect(buf.latest).toBe(s);
    expect(buf.sample(performance.now())).toBe(s);
  });

  it('环形缓冲有上限，不会无限增长', () => {
    const buf = new SnapshotBuffer();
    for (let i = 0; i < 100; i++) buf.push(snap(i));
    expect(buf.frameCount).toBeLessThanOrEqual(24);
    // 保留的是最新的
    expect(buf.latest.tick).toBe(99);
  });

  it('在最近两帧之间线性插值', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, { x: 0 }));
    clock.advance(33);
    buf.push(snap(2, { x: 10 }));
    // 渲染时刻 = now - delay。把时间推进到延迟中点附近
    clock.advance(INTERP_DELAY_MS - 16);
    const s = buf.sample(performance.now());
    // 位置必须落在 0~10 之间（证明在做插值，而不是直接跳到最新帧）
    expect(s.players[0].x).toBeGreaterThan(0);
    expect(s.players[0].x).toBeLessThan(10);
  });

  it('渲染时刻还没追上时返回最早的一帧（不越界）', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, { x: 5 }));
    clock.advance(33);
    buf.push(snap(2, { x: 8 }));
    // now 还很小，renderAt < 第一帧时间
    clock.advance(1);
    const s = buf.sample(performance.now());
    expect(s.players[0].x).toBeCloseTo(5, 5);
  });

  it('抖动大时自动加深缓冲（延迟变大）', () => {
    const buf = new SnapshotBuffer();
    const base = buf.delayMs;
    // 制造剧烈的到达间隔抖动
    for (let i = 0; i < 20; i++) {
      clock.advance(i % 2 === 0 ? 5 : 200);
      buf.push(snap(i));
    }
    expect(buf.delayMs).toBeGreaterThan(base);
    // 但不会无限涨
    expect(buf.delayMs).toBeLessThanOrEqual(220);
  });

  it('clear 之后回到空状态', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1));
    buf.clear();
    expect(buf.empty).toBe(true);
    expect(buf.frameCount).toBe(0);
  });
});

describe('blendSnapshot', () => {
  it('t<=0 返回 a，t>=1 返回 b，缺帧时降级', () => {
    const a = snap(1, { x: 0 });
    const b = snap(2, { x: 10 });
    expect(blendSnapshot(a, b, 0).players[0].x).toBe(0);
    expect(blendSnapshot(a, b, 1).players[0].x).toBe(10);
    expect(blendSnapshot(null, b, 0.5)).toBe(b);
    expect(blendSnapshot(a, null, 0.5)).toBe(a);
  });

  it('位置按 t 线性插值', () => {
    const a = snap(1, { x: 0 });
    const b = snap(2, { x: 10 });
    expect(blendSnapshot(a, b, 0.5).players[0].x).toBeCloseTo(5, 6);
    expect(blendSnapshot(a, b, 0.25).players[0].x).toBeCloseTo(2.5, 6);
  });

  it('角度走最短弧，不会整圈转过去', () => {
    // 从 +3.0 转到 -3.0，最短路径是跨过 ±π（约 0.28 rad），不是绕回来 6 rad
    const a = snap(1, { yaw: 3.0 });
    const b = snap(2, { yaw: -3.0 });
    const mid = blendSnapshot(a, b, 0.5).players[0].yaw;
    // 中点应该在 ±π 附近（绝对值 > 3.0），而不是 0 附近
    expect(Math.abs(mid)).toBeGreaterThan(3.0);
  });

  it('血量/状态不插值，直接取权威值 b', () => {
    const a = snap(1, { hp: 100 });
    a.players[0].downed = false;
    const b = snap(2, { hp: 40 });
    b.players[0].downed = true;
    const mid = blendSnapshot(a, b, 0.5).players[0];
    expect(mid.hp).toBe(40);
    expect(mid.downed).toBe(true);
  });

  it('僵尸按 id 配对插值；新出现的直接用 b 的位置', () => {
    const a = snap(1, { zombies: [zombie(1, 0, 0)] });
    const b = snap(2, { zombies: [zombie(1, 10, 0), zombie(2, 99, 99)] });
    const mid = blendSnapshot(a, b, 0.5);
    expect(mid.zombies).toHaveLength(2);
    const z1 = mid.zombies.find((z) => z.id === 1);
    const z2 = mid.zombies.find((z) => z.id === 2);
    expect(z1.x).toBeCloseTo(5, 6); // 插值
    expect(z2.x).toBe(99); // 新出现，没有 a 帧可插
  });

  it('僵尸血量与减速状态取 b，不插值', () => {
    const a = snap(1, { zombies: [zombie(1, 0, 0, { hp: 100, sl: 0 })] });
    const b = snap(2, { zombies: [zombie(1, 10, 0, { hp: 20, sl: 1 })] });
    const mid = blendSnapshot(a, b, 0.5).zombies[0];
    expect(mid.hp).toBe(20);
    expect(mid.sl).toBe(1);
  });

  it('插值结果保留 b 的其它字段（阳光/波次/比分）', () => {
    const a = { ...snap(1), sun: 10, wave: 2, scores: [1, 2] };
    const b = { ...snap(2), sun: 80, wave: 3, scores: [5, 6] };
    const mid = blendSnapshot(a, b, 0.5);
    expect(mid.sun).toBe(80);
    expect(mid.wave).toBe(3);
    expect(mid.scores).toEqual([5, 6]);
  });
});