import { describe, it, expect, vi, afterEach } from 'vitest';
import { FlowField } from '../../src/world/FlowField.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// 小网格便于手算：halfX=halfZ=2, cell=1 => cols=rows=4，格心 x,z ∈ {-1.5,-0.5,0.5,1.5}
const make = (hx = 2, hz = 2, cell = 1) => new FlowField(hx, hz, cell);

// 世界坐标 -> 格子（与 update/flowAt 同一公式）
const cellX = (ff, x) => Math.floor((x + ff.halfX) / ff.cell);
const cellZ = (ff, z) => Math.floor((z + ff.halfZ) / ff.cell);
const idx = (ff, x, z) => cellZ(ff, z) * ff.cols + cellX(ff, x);

const flow = (ff, x, z) => {
  const out = { x: 0, z: 0 };
  const ok = ff.flowAt(x, z, out);
  return { ok, x: out.x, z: out.z };
};

describe('FlowField / 构造', () => {
  it('网格尺寸 = ceil(跨度/格子)', () => {
    const ff = make();
    expect(ff.cols).toBe(4);
    expect(ff.rows).toBe(4);
    expect(ff.blocked).toBeInstanceOf(Uint8Array);
    expect(ff.blocked.length).toBe(16);
    expect(ff.dist.length).toBe(16);
    expect(ff.dirX.length).toBe(16);
    expect(ff.dirZ.length).toBe(16);
    expect(ff.queue.length).toBe(16);
  });

  it('非整除跨度向上取整', () => {
    const ff = new FlowField(5, 3, 1);
    expect(ff.cols).toBe(10);
    expect(ff.rows).toBe(6);
  });

  it('初始未计算：flowAt 一律返回 false（不给出过期方向）', () => {
    const ff = make();
    expect(flow(ff, 0, 0).ok).toBe(false);
  });

  it('初始缓存格为 -9999 / 计时器 0（首次 update 一定会算）', () => {
    const ff = make();
    expect(ff.cx).toBe(-9999);
    expect(ff.cz).toBe(-9999);
    expect(ff.timer).toBe(0);
  });
});

describe('FlowField / 无遮挡时的方向场', () => {
  it('玩家在西南角 (x=-1.5,z=-1.5)：邻居沿对角指向玩家', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    // 东北对角格 (-0.5,-0.5) 的最近邻居是玩家格 => dir = (-1,-1)/√2
    const d = flow(ff, -0.5, -0.5);
    expect(d.ok).toBe(true);
    expect(d.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(d.z).toBeCloseTo(-Math.SQRT1_2, 6);
    // 正北格 (-0.5,-1.5) => dir = (-1,0)
    const e = flow(ff, -0.5, -1.5);
    expect(e.ok).toBe(true);
    expect(e.x).toBe(-1);
    expect(e.z).toBe(0);
    // 正东格 (-1.5,-0.5) => dir = (0,-1)
    const n = flow(ff, -1.5, -0.5);
    expect(n.ok).toBe(true);
    expect(n.x).toBe(0);
    expect(n.z).toBe(-1);
  });

  it('玩家在东南角 (x=1.5,z=-1.5)：方向朝 (+x 的反向, 即 -x) 与 -z', () => {
    const ff = make();
    ff.update(1.5, -1.5, 0.016);
    const d = flow(ff, 0.5, -0.5);
    expect(d.ok).toBe(true);
    expect(d.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(d.z).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it('玩家在中心 (0.5,0.5)：正对角格指向 (-1,1)/√2', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    const d = flow(ff, 1.5, 1.5);
    expect(d.ok).toBe(true);
    expect(d.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(d.z).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it('players 所在格 dist 为 0，流场方向处处指向它（dist 沿路径严格递减）', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    const start = idx(ff, -1.5, -1.5);
    expect(ff.dist[start]).toBe(0);
    // 切比雪夫距离：距玩家格 (dx,dz) 的格 dist 就是 Chebyshev 距离
    for (let z = 0; z < ff.rows; z++) {
      for (let x = 0; x < ff.cols; x++) {
        const cheb = Math.max(x - 0, z - 0);
        expect(ff.dist[z * ff.cols + x], `dist(${x},${z})`).toBe(cheb);
      }
    }
  });

  it('沿流场走能真的走到玩家格（每一步 dist 变小，直到 0）', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    let cx = 3;
    let cz = 3;
    const target = idx(ff, 0.5, 0.5);
    for (let step = 0; step < 20 && cz * ff.cols + cx !== target; step++) {
      const cur = cz * ff.cols + cx;
      const i = cur;
      const dx = ff.dirX[i];
      const dz = ff.dirZ[i];
      expect(dx !== 0 || dz !== 0, `死路在 (${cx},${cz})`).toBe(true);
      // dir 是单位向量
      expect(Math.hypot(dx, dz)).toBeCloseTo(1, 6);
      // 按符号走一格：必须恰好落在 dir 指向的 8 邻居之一
      const nx = cx + Math.sign(dx);
      const nz = cz + Math.sign(dz);
      expect(Math.abs(nx - cx)).toBeLessThanOrEqual(1);
      expect(Math.abs(nz - cz)).toBeLessThanOrEqual(1);
      expect(ff.dist[nz * ff.cols + nx]).toBeLessThan(ff.dist[cur]);
      cx = nx;
      cz = nz;
    }
    expect(cz * ff.cols + cx).toBe(target);
  });

  it('玩家所在格本身没有方向（flowAt 返回 false）', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    expect(flow(ff, 0.5, 0.5).ok).toBe(false);
  });

  it('世界坐标落在格子边缘时按 floor 归属（-2 < x < -1 都属于第 0 列）', () => {
    const ff = make();
    ff.update(-2, -2, 0.016);
    expect(ff.cx).toBe(0);
    expect(ff.cz).toBe(0);
    // x=-1.0 恰好是第 1 列
    expect(flow(ff, -1.0, -2).ok).toBe(true);
  });
});

describe('FlowField / flowAt 边界', () => {
  it('越界返回 false（左下/右上四个方向）', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    const out = { x: 7, z: 7 };
    expect(ff.flowAt(-2.01, 0, out)).toBe(false);
    expect(ff.flowAt(0, -2.01, out)).toBe(false);
    expect(ff.flowAt(2.01, 0, out)).toBe(false);
    expect(ff.flowAt(0, 2.01, out)).toBe(false);
  });

  it('越界时不会写入 out（保持调用方的值）', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    const out = { x: 7, z: 8 };
    expect(ff.flowAt(-10, 0, out)).toBe(false);
    expect(out).toEqual({ x: 7, z: 8 });
  });

  it('边界内侧（-2 <= x < 2）都在网格内', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    expect(ff.flowAt(-2, 0, { x: 0, z: 0 })).toBe(true);
    expect(ff.flowAt(1.999, 0, { x: 0, z: 0 })).toBe(true);
  });

  it('命中时把方向写进传入的 out 对象并返回 true', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    const out = { x: 99, z: 99 };
    expect(ff.flowAt(-0.5, -1.5, out)).toBe(true);
    expect(out.x).toBe(-1);
    expect(out.z).toBe(0);
  });
});

describe('FlowField / blockPlatforms', () => {
  it('height > minHeight 的平台把格子标为障碍', () => {
    const ff = make();
    // 平台中心 (0.5,0.5) 宽高 1x1，高 3.6（田字柱）=> 覆盖 x,z ∈ [0,1]
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 3.6 }]);
    expect(ff.blocked[idx(ff, 0.5, 0.5)]).toBe(1);
  });

  it('默认 minHeight = 0.6：正好 0.6 的矮台不挡路，0.61 才挡', () => {
    const a = make();
    a.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 0.6 }]);
    expect(a.blocked[idx(a, 0.5, 0.5)]).toBe(0);
    const b = make();
    b.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 0.61 }]);
    expect(b.blocked[idx(b, 0.5, 0.5)]).toBe(1);
  });

  it('沙城 0.4 米观景台（僵尸不会跳）默认不挡路', () => {
    const ff = make();
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 0.4 }]);
    expect(ff.blocked.every((v) => v === 0)).toBe(true);
  });

  it('padding 0.55：平台外扩后覆盖到的邻格也被 block', () => {
    const ff = make();
    // 平台只占 x∈[0,1]（第 2 列），外扩 0.55 后 x∈[-0.55,1.55] => 覆盖第 1、2 列
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 2 }]);
    expect(ff.blocked[idx(ff, -0.5, 0.5)]).toBe(1);
    expect(ff.blocked[idx(ff, 1.5, 0.5)]).toBe(1);
    // 再往外（第 0 列 / 第 3 列）仍通畅
    expect(ff.blocked[idx(ff, -1.5, 0.5)]).toBe(0);
  });

  it('padding 覆盖整张 4x4 小网格（1x1 平台外扩 0.55 后跨满全场）', () => {
    const ff = make(); // halfX=2, 格心 -1.5/-0.5/0.5/1.5
    // 平台 x∈[-0.5,0.5]，外扩 0.55 => [-1.05,1.05]
    // 列范围 floor(-1.05+2)=floor(0.95)=0 .. floor(1.05+2)=floor(3.05)=3 => 第 0..3 列全部命中
    ff.blockPlatforms([{ x: 0, z: 0, w: 1, d: 1, h: 2 }]);
    const rows = [];
    for (let z = 0; z < 4; z++) rows.push(Array.from(ff.blocked.subarray(z * 4, z * 4 + 4)));
    expect(rows).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
  });

  it('padding 精确到 0.55：halfX=2、平台 x=-0.95 宽 1 时覆盖第 0..2 列', () => {
    // halfX=2（cols=4，格心 -1.5/-0.5/0.5/1.5），平台中心 x=-0.95 宽 1 => x∈[-1.45,-0.45]
    //   padding=0.30 => floor(-1.75+2)=0 .. floor(-0.15+2)=1 => 只覆盖第 0、1 列
    //   padding=0.55 => floor(-2+2)=0 ..  floor(0.1+2)=2    => 覆盖第 0、1、2 列
    const a = new FlowField(2, 1, 1);
    a.blockPlatforms([{ x: -0.95, z: 0, w: 1, d: 1, h: 2 }]);
    expect(Array.from(a.blocked.subarray(0, 4))).toEqual([1, 1, 1, 0]);
  });

  it('padding 的纵向同理', () => {
    const ff = make();
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 2 }]);
    expect(ff.blocked[idx(ff, 0.5, -0.5)]).toBe(1);
    expect(ff.blocked[idx(ff, 0.5, 1.5)]).toBe(1);
  });

  it('越界部分被裁掉，不写坏数组（负下标不会回绕到上一行）', () => {
    const ff = make();
    ff.blockPlatforms([{ x: -1.8, z: -1.8, w: 1, d: 1, h: 2 }]);
    // 左下角被 block
    expect(ff.blocked[idx(ff, -1.8, -1.8)]).toBe(1);
    // 右上角不受影响
    expect(ff.blocked[idx(ff, 1.5, 1.5)]).toBe(0);
    // 数组长度不变
    expect(ff.blocked.length).toBe(16);
  });

  it('大平台完全覆盖地图时全部 blocked', () => {
    const ff = make();
    ff.blockPlatforms([{ x: 0, z: 0, w: 20, d: 20, h: 3 }]);
    expect(Array.from(ff.blocked).every((v) => v === 1)).toBe(true);
  });

  it('小网格（3x3）上用一个 1x1 平台把中间堵死的精确行列范围', () => {
    const ff = new FlowField(1.5, 1.5, 1); // cols=rows=3，格心 -1,0,1
    // 平台中心 (0,0) 宽 1：x∈[-0.5,0.5]，外扩 0.55 => [-1.05,1.05]
    // 格子范围对 1.5 米跨度：floor((-1.05+1.5)/1)=floor(0.45)=0，floor(1.05+1.5)=floor(2.55)=2
    // 所以第 0..2 列全部被 block（padding 让 1 米平台吃掉整张 3x3 图）
    ff.blockPlatforms([{ x: 0, z: 0, w: 1, d: 1, h: 2 }]);
    const rows = [];
    for (let z = 0; z < 3; z++) rows.push(Array.from(ff.blocked.subarray(z * 3, z * 3 + 3)));
    expect(rows).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
  });

  it('可传自定义 minHeight', () => {
    const ff = make();
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 0.4 }], 0.3);
    expect(ff.blocked[idx(ff, 0.5, 0.5)]).toBe(1);
  });
});

describe('FlowField / 有障碍时的寻路', () => {
  it('障碍格 flowAt 返回 false', () => {
    const ff = make();
    ff.blockPlatforms([{ x: 0.5, z: 0.5, w: 1, d: 1, h: 2 }]);
    ff.update(1.5, 1.5, 0.016);
    expect(flow(ff, 0.5, 0.5).ok).toBe(false);
  });

  it('BFS 不穿过障碍：玩家在角落时障碍后的格子 dist 为 -1（大局被墙隔开）', () => {
    // 2x4 网格，中间一列全堵死，玩家在右侧
    const ff = new FlowField(1, 2, 1); // cols=2, rows=4
    // 直接把左列（x=0）全部标记 blocked
    for (let z = 0; z < 4; z++) ff.blocked[z * 2 + 0] = 1;
    ff.update(1, 1, 0.016);
    expect(ff.dist[0 * 2 + 0]).toBe(-1); // blocked 格永远不会被访问
    // 右列能正常到达
    for (let z = 0; z < 4; z++) expect(ff.dist[z * 2 + 1]).toBeGreaterThanOrEqual(0);
  });

  it('半堵的墙：流场绕过墙头，转角处给出正确的偏移方向', () => {
    // 5x5 网格，第 2 列 (x=0) 的 z=-2..0 三格堵死（只在 z=1、z=2 两行留出通道），
    // 玩家在右上角 (2,2)
    const ff = new FlowField(2.5, 2.5, 1); // cols=rows=5，格心 -2..2
    for (const z of [-2, -1, 0]) ff.blocked[idx(ff, 0, z)] = 1;
    ff.update(2, 2, 0.016);
    expect(ff.dist[idx(ff, 2, 2)]).toBe(0);
    // 左下角 (-2,-2) 的直线路径被墙挡住：最近通道在上方 => 第一步沿 +z 走到 (-2,-1)
    const d = flow(ff, -2, -2);
    expect(d.ok).toBe(true);
    expect(d.z).toBeGreaterThan(0);
    expect(ff.dist[idx(ff, -2, -1)]).toBe(5);
    // 禁止贴墙切角：4 步直线距离绕墙需要 6 步
    expect(ff.dist[idx(ff, -2, -2)]).toBe(6);
    // 墙左侧贴墙格先正交走向通道，不能沿对角擦进墙角
    const beside = flow(ff, -1, 0);
    expect(beside.ok).toBe(true);
    expect(beside.x).toBe(0);
    expect(beside.z).toBe(1);
    expect(ff.dist[idx(ff, -1, -2)]).toBe(6);
  });

  it('整列墙把地图劈成两半：另一侧完全不可达（-1）', () => {
    const ff = new FlowField(3.5, 3.5, 1);
    for (let z = 0; z < 7; z++) ff.blocked[z * 7 + 3] = 1;
    ff.update(3, 3, 0.016);
    expect(ff.dist[idx(ff, -3, -3)]).toBe(-1);
    expect(flow(ff, -3, -3).ok).toBe(false);
    // 玩家自己一侧正常
    expect(flow(ff, 3, -3).ok).toBe(true);
  });

  it('被墙围死的区域 dist 为 -1（BFS 到不了），且不给方向', () => {
    const ff = new FlowField(2.5, 2.5, 1);
    // 用一圈墙把 (1,1) 围死，玩家在中心 (0,0)
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        if (x === 0 || z === 0 || x === 4 || z === 4) continue;
        if (x === 2 && z === 2) continue; // (1,1) 世界坐标
        ff.blocked[z * 5 + x] = 1;
      }
    }
    ff.update(0, 0, 0.016);
    expect(ff.dist[idx(ff, 1, 1)]).toBe(-1);
    expect(flow(ff, 1, 1).ok).toBe(false);
    // 中心自身 dist=0
    expect(ff.dist[idx(ff, 0, 0)]).toBe(0);
  });
});

describe('FlowField / 玩家站在 blocked 格上', () => {
  it('从最近的未 blocked 格起算 BFS（距离该格为 0）', () => {
    const ff = make();
    // 只堵中间一格 (0.5, 0.5)
    ff.blocked[idx(ff, 0.5, 0.5)] = 1;
    ff.update(0.5, 0.5, 0.016);
    // 4 个正交邻居距离平方都是 1；扫描顺序 z 外层、x 内层、严格 < 比较，
    // 第一个命中的是 (x=2,z=1) => 世界 (0.5,-0.5)（blocked 格的 -z 侧邻居）作为 BFS 起点
    expect(ff.dist[idx(ff, 0.5, -0.5)]).toBe(0);
    // 起点左右不能贴 blocked 格切角，需各走 2 步
    expect(ff.dist[idx(ff, 1.5, 0.5)]).toBe(2);
    expect(ff.dist[idx(ff, -0.5, 0.5)]).toBe(2);
    expect(ff.dist[idx(ff, 0.5, 1.5)]).toBe(4);
    // 绕 blocked 格转角需正交经过
    expect(ff.dist[idx(ff, 1.5, 1.5)]).toBe(3);
    // 被堵格自身永远不会被访问
    expect(ff.dist[idx(ff, 0.5, 0.5)]).toBe(-1);
    // 其余格子仍能算出方向（场是联通的）
    const d = flow(ff, -1.5, -1.5);
    expect(d.ok).toBe(true);
    // 被堵的格本身没有方向
    expect(flow(ff, 0.5, 0.5).ok).toBe(false);
  });

  it('玩家站在 blocked 格上时缓存格记录的是原始格（不是代理起点）', () => {
    const ff = make();
    ff.blocked[idx(ff, 0.5, 0.5)] = 1;
    ff.update(0.5, 0.5, 0.016);
    expect(ff.cx).toBe(cellX(ff, 0.5));
    expect(ff.cz).toBe(cellZ(ff, 0.5));
  });

  it('整张图都被 blocked 且换到另一格时：直接返回，旧方向场原样保留（不重算）', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    const dirX = Array.from(ff.dirX);
    const dist = Array.from(ff.dist);
    ff.blocked.fill(1);
    // 换一个格子（避免节流短路），此时找不到空格起点 => 提前 return
    ff.update(1.5, 1.5, 0.016);
    expect(ff.cx).toBe(cellX(ff, 1.5));
    expect(Array.from(ff.dirX)).toEqual(dirX);
    expect(Array.from(ff.dist)).toEqual(dist);
    // 残留的旧方向随即被 blocked 判定挡掉，flowAt 仍然安全
    expect(flow(ff, 1.5, 1.5).ok).toBe(false);
  });

  it('全 blocked 时也不会抛错（BFS 队列保持空）', () => {
    const ff = make();
    ff.blocked.fill(1);
    expect(() => ff.update(0, 0, 0.016)).not.toThrow();
    expect(ff.cx).toBe(cellX(ff, 0));
  });
});

describe('FlowField / update 节流', () => {
  it('首次 update 的重算窗口为 0.45s', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0.016);
    expect(ff.timer).toBe(0.45);
  });


  it('同格 + dt 足够小：不重算（timer 继续递减但方向场保持不变）', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    const snapshot = Array.from(ff.dist);
    const dirX = Array.from(ff.dirX);
    // 改一个不相干的 blocked 格作为“是否重算”的探针：重算会把它写进 dist
    ff.blocked[idx(ff, 1.5, 1.5)] = 1;
    // 0.016*27 = 0.432s < 0.45，仍在节流窗口内
    for (let i = 0; i < 27; i++) ff.update(-1.5, -1.5, 0.016);
    expect(Array.from(ff.dist)).toEqual(snapshot);
    expect(Array.from(ff.dirX)).toEqual(dirX);
    expect(ff.timer).toBeGreaterThan(0);
    // 探针格：blocked 标记立即生效（flowAt 自己查 blocked），但 dist 仍是重算前的值 => 没重算过
    expect(flow(ff, 1.5, 1.5).ok).toBe(false);
    expect(ff.dist[idx(ff, 1.5, 1.5)]).toBe(snapshot[idx(ff, 1.5, 1.5)]);
  });

  it('累计 dt 超过 0.45 后同格也会重算', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    ff.blocked[idx(ff, 1.5, 1.5)] = 1;
    // 再走满 0.45s：timer 从 0.434 减到 <=0 触发重算
    ff.update(-1.5, -1.5, 0.45);
    expect(ff.dist[idx(ff, 1.5, 1.5)]).toBe(-1);
    expect(ff.timer).toBeCloseTo(0.45, 10);
  });

  it('格子变化时立即重算（不等节流）', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    expect(ff.dist[idx(ff, -1.5, -1.5)]).toBe(0);
    ff.update(1.5, 1.5, 0.001);
    expect(ff.dist[idx(ff, 1.5, 1.5)]).toBe(0);
    expect(ff.dist[idx(ff, -1.5, -1.5)]).toBeGreaterThan(0);
    expect(ff.timer).toBe(0.45);
  });

  it('节流比较的是格子而不是坐标（同格内移动不触发重算）', () => {
    const ff = make();
    ff.update(0.1, 0.1, 0.016); // 格 (2,2)
    expect(ff.cx).toBe(2);
    expect(ff.cz).toBe(2);
    const snapshot = Array.from(ff.dist);
    ff.update(0.9, 0.9, 0.016); // 仍在格 (2,2)
    expect(ff.cx).toBe(2);
    expect(ff.cz).toBe(2);
    expect(Array.from(ff.dist)).toEqual(snapshot);
  });

  it('dt 传 0 时首次仍会计算，之后同格不再变化', () => {
    const ff = make();
    ff.update(0.5, 0.5, 0);
    expect(ff.dist[idx(ff, 0.5, 0.5)]).toBe(0);
    const snapshot = Array.from(ff.dist);
    ff.update(0.5, 0.5, 0);
    expect(Array.from(ff.dist)).toEqual(snapshot);
    expect(ff.timer).toBe(0.45);
  });

  it('玩家越界坐标被 clamp 到边界格', () => {
    const ff = make();
    ff.update(-999, -999, 0.016);
    expect(ff.cx).toBe(0);
    expect(ff.cz).toBe(0);
    expect(ff.dist[0]).toBe(0);
    ff.update(999, 999, 0.016);
    expect(ff.cx).toBe(ff.cols - 1);
    expect(ff.cz).toBe(ff.rows - 1);
    expect(ff.dist[ff.rows * ff.cols - 1]).toBe(0);
  });

  it('重算后 dirX/dirZ 一定不会指向 blocked 或更远的格', () => {
    const ff = new FlowField(4, 4, 1); // 8x8
    ff.blockPlatforms([
      { x: 0, z: 0, w: 2, d: 2, h: 3 },
      { x: 2.5, z: -2.5, w: 2, d: 2, h: 3 },
    ]);
    ff.update(3, 3, 0.016);
    for (let z = 0; z < ff.rows; z++) {
      for (let x = 0; x < ff.cols; x++) {
        const i = z * ff.cols + x;
        const dx = ff.dirX[i];
        const dz = ff.dirZ[i];
        if (dx === 0 && dz === 0) continue;
        expect(ff.blocked[i]).toBe(0);
        const offX = Math.round(dx);
        const offZ = Math.round(dz);
        expect([-1, 0, 1]).toContain(offX);
        expect([-1, 0, 1]).toContain(offZ);
        const ni = (z + offZ) * ff.cols + (x + offX);
        expect(ff.blocked[ni]).toBe(0);
        expect(ff.dist[ni]).toBeLessThan(ff.dist[i]);
      }
    }
  });

  it('dist 数组每次重算都会被重置（没有残留的旧值）', () => {
    const ff = make();
    ff.update(-1.5, -1.5, 0.016);
    ff.blocked[0] = 1; // 堵住玩家原格
    ff.update(1.5, 1.5, 0.5);
    expect(ff.dist[0]).toBe(-1);
    expect(ff.dist[idx(ff, 1.5, 1.5)]).toBe(0);
  });
});

describe('FlowField / 与 IceWorld 规模一致（23 米半宽的整图）', () => {
  it('流场覆盖 -23..23 且玩家在中心时四面都有方向', () => {
    const ff = new FlowField(23, 23, 1);
    expect(ff.cols).toBe(46);
    expect(ff.rows).toBe(46);
    ff.update(0, 0, 0.016);
    for (const [x, z] of [[20, 20], [-20, 20], [20, -20], [-20, -20], [0, 20], [20, 0]]) {
      expect(flow(ff, x, z).ok, `(${x},${z})`).toBe(true);
    }
  });
});

describe('FlowField / 圆形实体与禁止切角', () => {
  it('圆形padding只阻挡圆内格心，支持出界/自定义padding/累加平台', () => {
    const ff = new FlowField(5,5,1);
    ff.blockCircles([{x:.5,z:.5,r:1}]);
    expect(ff.blocked[idx(ff,.5,.5)]).toBe(1);
    expect(ff.blocked[idx(ff,1.5,1.5)]).toBe(1);
    expect(ff.blocked[idx(ff,2.5,.5)]).toBe(0);
    const tight = new FlowField(5,5,1);
    tight.blockCircles([{x:.5,z:.5,r:.2}],0);
    expect(tight.blocked.reduce((a,b)=>a+b,0)).toBe(1);
    tight.blockCircles([{x:-5,z:-5,r:.5},{x:99,z:99,r:1}]);
    expect(tight.blocked[0]).toBe(1);
    expect(tight.blocked.length).toBe(100);
    tight.blockPlatforms([{x:3,z:3,w:1,d:1,h:2}]);
    expect(tight.blocked[idx(tight,.5,.5)]).toBe(1);
    expect(tight.blocked[idx(tight,3,3)]).toBe(1);
  });

  it('BFS不能从两个实体夹角漏到隔绝格', () => {
    const ff=make();
    ff.blocked[idx(ff,-.5,-1.5)]=1;
    ff.blocked[idx(ff,-1.5,-.5)]=1;
    ff.update(.5,.5,1);
    expect(ff.dist[idx(ff,-1.5,-1.5)]).toBe(-1);
    expect(flow(ff,-1.5,-1.5).ok).toBe(false);
  });

  it('方向不进入任何邻接障碍的对角线，保留开放格的对角捷径', () => {
    const ff=make();
    ff.blocked[idx(ff,-.5,-1.5)]=1;
    ff.update(-1.5,-1.5,1);
    const d=flow(ff,-.5,-.5);
    expect(d).toEqual({ok:true,x:-1,z:0});
    const open=make();
    open.update(-1.5,-1.5,1);
    expect(flow(open,-.5,-.5).x).toBeCloseTo(-Math.SQRT1_2);
  });
});
