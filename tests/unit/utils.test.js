import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clamp,
  lerp,
  damp,
  rand,
  randInt,
  pick,
  shuffle,
  segmentSphereT,
  formatNum,
  TAU,
} from '../../src/utils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('utils / clamp', () => {
  it('区间内原样返回', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-0.5, -1, 1)).toBe(-0.5);
  });

  it('低于下限夹到下限、高于上限夹到上限', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('边界值不被改动', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('utils / lerp', () => {
  it('t=0 返回起点、t=1 返回终点', () => {
    expect(lerp(2, 10, 0)).toBe(2);
    expect(lerp(2, 10, 1)).toBe(10);
  });

  it('t=0.5 返回中点', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(-4, 4, 0.25)).toBe(-2);
  });

  it('t 超出 [0,1] 会外插（函数本身不夹取）', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe('utils / damp', () => {
  it('dt=0 时不移动', () => {
    expect(damp(3, 7, 10, 0)).toBe(3);
  });

  it('lambda*dt 固定时衰减系数为 1-e^-x（不依赖帧率）', () => {
    // lambda=5, dt=0.2 -> k = 1 - e^-1 = 0.6321205588...
    const k = 1 - Math.exp(-1);
    expect(damp(0, 100, 5, 0.2)).toBeCloseTo(100 * k, 10);
    // 拆成两帧各 0.1s 结果应与一帧 0.2s 相同（指数衰减可乘性）
    const a = damp(damp(0, 100, 5, 0.1), 100, 5, 0.1);
    expect(a).toBeCloseTo(100 * k, 10);
  });

  it('总是朝目标靠近、不会越过目标', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      const next = damp(v, 10, 8, 1 / 60);
      expect(next).toBeGreaterThan(v);
      expect(next).toBeLessThanOrEqual(10);
      v = next;
    }
    // 100 帧（1.67s，lambda=8）后残差为 10*e^-13.33 ≈ 1.6e-5
    expect(10 - v).toBeLessThan(1e-4);
  });

  it('反向目标同样收敛', () => {
    expect(damp(10, -10, 5, 0.2)).toBeCloseTo(10 - 20 * (1 - Math.exp(-1)), 10);
  });
});

describe('utils / TAU', () => {
  it('为 2π', () => {
    expect(TAU).toBeCloseTo(6.283185307179586, 12);
    expect(TAU).toBe(Math.PI * 2);
  });
});

describe('utils / rand', () => {
  it('结果落在 [a,b) 内', () => {
    for (let i = 0; i < 200; i++) {
      const v = rand(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
    }
  });

  it('随机数取 0 时返回端点 a，取接近 1 时接近 b 但不到 b', () => {
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0);
    expect(rand(-3, 7)).toBe(-3);
    spy.mockReturnValueOnce(0.999999999);
    const v = rand(-3, 7);
    expect(v).toBeLessThan(7);
    expect(v).toBeGreaterThan(6.999);
  });

  it('a > b 时区间反向（结果落在 (b,a] 语义下仍由调用方决定）', () => {
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0);
    expect(rand(9, 1)).toBe(9);
    spy.mockReturnValueOnce(0.5);
    expect(rand(9, 1)).toBe(5);
  });

  it('a === b 时恒等', () => {
    expect(rand(4, 4)).toBe(4);
  });
});

describe('utils / randInt', () => {
  it('两端都取得到（闭区间）', () => {
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0);
    expect(randInt(1, 4)).toBe(1);
    spy.mockReturnValueOnce(0.9999999);
    expect(randInt(1, 4)).toBe(4);
  });

  it('所有采样都是整数且落在 [a,b]', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const v = randInt(-2, 2);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('单个整数区间 a===b 恒定返回 a', () => {
    expect(randInt(3, 3)).toBe(3);
    expect(randInt(-7, -7)).toBe(-7);
  });

  it('a > b 时按同一公式计算（Math.random=0.5 -> floor(5+0.5*(-2)) = 4），不会抛错', () => {
    // a > b 属于调用方错误；这里锁定函数的真实行为，避免回归成 NaN/undefined
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.5);
    expect(randInt(5, 2)).toBe(4);
    spy.mockReturnValueOnce(0);
    expect(randInt(5, 2)).toBe(5);
  });
});

describe('utils / pick', () => {
  it('按随机下标取元素', () => {
    const list = ['a', 'b', 'c'];
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0);
    expect(pick(list)).toBe('a');
    spy.mockReturnValueOnce(0.5);
    expect(pick(list)).toBe('b');
    spy.mockReturnValueOnce(0.9999999);
    expect(pick(list)).toBe('c');
  });

  it('随机值为 1 的极端（Math.random 不会返回 1）不会因越界取到 undefined', () => {
    const list = [1, 2];
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.999999999);
    expect(pick(list)).toBe(2);
  });
});

describe('utils / shuffle', () => {
  it('原地置换：返回同一个数组引用', () => {
    const list = [1, 2, 3, 4, 5];
    expect(shuffle(list)).toBe(list);
  });

  it('不丢元素也不重复（排序后与原数组一致）', () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffle(list);
    expect(out.length).toBe(20);
    expect([...out].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('确实会发生置换（Math.random 恒为 0 时把最后一位换到首位）', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const list = [1, 2, 3, 4];
    shuffle(list);
    // i=3: j=0 交换 -> [4,2,3,1]; i=2: j=0 -> [3,2,4,1]; i=1: j=0 -> [2,3,4,1]
    expect(list).toEqual([2, 3, 4, 1]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('空数组 / 单元素数组安全', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([7])).toEqual([7]);
  });
});

describe('utils / segmentSphereT', () => {
  const v = (x, y, z) => ({ x, y, z });
  const C = v(0, 0, 0);

  it('正命中：从球心正上方竖直向下穿过，t = (3-1)/6', () => {
    const t = segmentSphereT(v(0, 3, 0), v(0, -3, 0), C, 1);
    // y 从 3 到 -3，首次接触 y=1 => t=(3-1)/6
    expect(t).toBeCloseTo(2 / 6, 10);
  });

  it('起点在球内：返回进入点 t（=-t1<0 时取退出点 t2），不会因球内起点误判为 0', () => {
    // 段长 4.8，从 x=0.2 出射到 x=1 需要走 0.8 => t = 0.8/4.8
    expect(segmentSphereT(v(0.2, 0, 0), v(5, 0, 0), C, 1)).toBeCloseTo(0.8 / 4.8, 10);
    // 起点在球心，段长 5，球面在 1 处 => t = 1/5
    expect(segmentSphereT(v(0, 0, 0), v(0, 0, 5), C, 1)).toBeCloseTo(1 / 5, 10);
  });

  it('起点在球内且终点也在球内：两个根都越界 => -1（调用方的必要性）', () => {
    // 记录当前行为：现实调用中 p0 永远是上一帧的子弹位置（球外），所以不会走到这里；
    // 但若将来把“贴脸开火”的子弹起点放在僵尸命中球内，这段会返回 -1 漏伤。
    expect(segmentSphereT(v(0.1, 0, 0), v(0.5, 0, 0), C, 1)).toBe(-1);
  });

  it('零长度段：点落在球内返回 0，落在球外返回 -1', () => {
    expect(segmentSphereT(v(0, 0.5, 0), v(0, 0.5, 0), C, 1)).toBe(0);
    expect(segmentSphereT(v(0, 2, 0), v(0, 2, 0), C, 1)).toBe(-1);
    // 恰好落在球面上：c = 0 <= 0 => 0
    expect(segmentSphereT(v(1, 0, 0), v(1, 0, 0), C, 1)).toBe(0);
  });

  it('完全错过返回 -1', () => {
    expect(segmentSphereT(v(-5, 1.5, 0), v(5, 1.5, 0), C, 1)).toBe(-1);
    // 距离 2 擦不到半径 1 的球
    expect(segmentSphereT(v(0, 0, -5), v(0, 0, -2), C, 1)).toBe(-1);
  });

  it('擦边：相切线段返回 t ∈ [0,1]', () => {
    // 沿线 y=1 从 x=-5 到 x=5，恰好切在球顶 (0,1,0)
    const t = segmentSphereT(v(-5, 1, 0), v(5, 1, 0), C, 1);
    expect(t).toBeCloseTo(0.5, 10);
  });

  it('t ∈ (0,1) 且终点在球内时返回进入点而不是退出点', () => {
    // 起点 x=-3，终点在球内 x=0；进入点 x=-1 => t=2/3
    const t = segmentSphereT(v(-3, 0, 0), v(0, 0, 0), C, 1);
    expect(t).toBeCloseTo(2 / 3, 10);
  });

  it('球整个落在线段之外（t>1）不命中', () => {
    // 线段在 x∈[-5,-3]，球在 x=0
    expect(segmentSphereT(v(-5, 0, 0), v(-3, 0, 0), C, 1)).toBe(-1);
  });

  it('线段起点在球后方、球在身后：不命中', () => {
    expect(segmentSphereT(v(3, 0, 0), v(5, 0, 0), C, 1)).toBe(-1);
  });

  it('终点恰在球面上时 t = 1', () => {
    const t = segmentSphereT(v(-5, 0, 0), v(-1, 0, 0), C, 1);
    expect(t).toBeCloseTo(1, 12);
  });

  it('斜向命中：方向归一化不影响 t（a 用平方长度）', () => {
    const ts = segmentSphereT(v(-3, -3, 0), v(3, 3, 0), C, 1);
    // 沿 (1,1) 走，进入点在 |x|=1/√2 处：t = (3-0.7071)/6
    expect(ts).toBeCloseTo((3 - Math.SQRT1_2) / 6, 10);
  });

  it('半径 0 退化为点判定', () => {
    // 线段精确穿过球心，半径 0 时在 t=0.5 命中
    expect(segmentSphereT(v(0, 0, -5), v(0, 0, 5), C, 0)).toBeCloseTo(0.5, 12);
  });
});

describe('utils / formatNum', () => {
  it('小于 1000 不加分隔符', () => {
    expect(formatNum(0)).toBe('0');
    expect(formatNum(1)).toBe('1');
    expect(formatNum(999)).toBe('999');
  });

  it('1000 起按千分位分隔', () => {
    expect(formatNum(1000)).toBe('1,000');
    expect(formatNum(1001)).toBe('1,001');
    expect(formatNum(999999)).toBe('999,999');
    expect(formatNum(1234567)).toBe('1,234,567');
  });

  it('小数四舍五入到整数', () => {
    expect(formatNum(999.6)).toBe('1,000');
    expect(formatNum(1234.4)).toBe('1,234');
    expect(formatNum(0.49)).toBe('0');
  });

  it('负数保留符号并分组', () => {
    expect(formatNum(-1234.6)).toBe('-1,235');
    expect(formatNum(-999.4)).toBe('-999');
    expect(formatNum(-1000000)).toBe('-1,000,000');
  });

  it('正好处在分组边界（1000 的倍数）', () => {
    for (const n of [1000, 10000, 100000, 1000000]) {
      expect(formatNum(n)).toBe(n.toLocaleString('en-US'));
    }
  });
});