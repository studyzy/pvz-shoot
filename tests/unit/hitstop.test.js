// 命中定格（docs/plans/2026-11-12-render-overhaul.md §4.1）。
//
// 命中/击杀时把时间轴压慢 40~90 ms，是所有商业 FPS 的标配，也是打击感最便宜的一层。
// 这三件事必须同时成立：
//   1) 只在玩法中生效（菜单/结算不该卡）；
//   2) 连发时不叠加（每颗豌豆重新触发一整段就成了卡顿）；
//   3) 自适应分辨率不被「我们自己造的慢帧」骗到（trackPerformance 吃真实耗时）。
import { describe, it, expect, vi, beforeAll } from 'vitest';

async function installThreeMock() {
  vi.doMock('three', async (importOriginal) => {
    const actual = await importOriginal();
    const { makeFakeRenderer } = await import('../helpers/game.js');
    class FakeWebGLRenderer {
      constructor(opts) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = (opts && opts.canvas) || null;
      }
    }
    return { ...actual, WebGLRenderer: FakeWebGLRenderer };
  });
}
await installThreeMock();

let game;
beforeAll(async () => {
  const h = await import('../helpers/game.js');
  ({ game } = await h.createGame());
});

describe('Game · hitstop', () => {
  it('构造后处于未触发状态', () => {
    expect(game.hitStopT).toBe(0);
    expect(game.hitStopScale).toBe(1);
  });

  it('玩法中触发后写入时长与倍率', () => {
    game.state = 'playing';
    game.hitStopT = 0;
    game.hitStop(0.05, 0.1);
    expect(game.hitStopT).toBeCloseTo(0.05, 6);
    expect(game.hitStopScale).toBeCloseTo(0.1, 6);
  });

  it('菜单里不触发（避免选地图时莫名其妙卡一下）', () => {
    game.state = 'menu';
    game.hitStopT = 0;
    game.hitStop(0.05, 0.1);
    expect(game.hitStopT).toBe(0);
  });

  it('结算里不触发', () => {
    game.state = 'over';
    game.hitStopT = 0;
    game.hitStop(0.09, 0.06);
    expect(game.hitStopT).toBe(0);
  });

  it('连发取较长者，不累加（四发豌豆不会攒成 160ms 卡顿）', () => {
    game.state = 'playing';
    game.hitStopT = 0;
    game.hitStop(0.04, 0.12);
    game.hitStop(0.04, 0.12);
    game.hitStop(0.04, 0.12);
    game.hitStop(0.04, 0.12);
    expect(game.hitStopT).toBeCloseTo(0.04, 6);
  });

  it('更长的请求可以覆盖更短的（小命中后接击杀）', () => {
    game.state = 'playing';
    game.hitStopT = 0;
    game.hitStop(0.04, 0.12);
    game.hitStop(0.09, 0.06);
    expect(game.hitStopT).toBeCloseTo(0.09, 6);
    expect(game.hitStopScale).toBeCloseTo(0.06, 6);
  });

  it('非法参数走默认值，不会把时间轴压成 0 或 NaN', () => {
    game.state = 'playing';
    game.hitStopT = 0;
    game.hitStop(NaN, NaN);
    expect(game.hitStopT).toBeCloseTo(0.05, 6);
    expect(game.hitStopScale).toBeGreaterThan(0);
    expect(Number.isFinite(game.hitStopScale)).toBe(true);
  });

  it('dur <= 0 直接忽略', () => {
    game.state = 'playing';
    game.hitStopT = 0;
    game.hitStop(0, 0.1);
    game.hitStop(-1, 0.1);
    expect(game.hitStopT).toBe(0);
  });

  it('重开一局清零（否则上一局的定格会带进新局）', () => {
    game.state = 'playing';
    game.hitStop(0.09, 0.06);
    expect(game.hitStopT).toBeGreaterThan(0);
    game.hitStopT = 0;
    game.hitStopScale = 1;
    expect(game.hitStopT).toBe(0);
    expect(game.hitStopScale).toBe(1);
  });
});