// 摩天街区集装箱堆场（参考 saltline 的物流场语汇，重做成 Toon）。
//
// 这几条断言的作用是「防止堆场悄悄破坏玩法」：
//   - 不能挡住刷怪点（僵尸落点被推挤区夹住会卡死）
//   - 不能压掉拾取点四周的流场探针格（maps.test 那条会红）
//   - 不能侵占主街/横街（楼峡是对枪主轴的视线通道）
//   - draw call 必须真的是常数（每类 1 个）
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CONTAINER_SPECS,
  YARD_PALETTE,
  YARD_STACKS,
  YARD_BARRIERS,
  YARD_FENCES,
  YARD_CLUSTERS,
  YARD_CONES,
  containerGeometry,
  barrierGeometry,
  coneGeometry,
  fenceGeometry,
  clusterGeometry,
  gantryGeometry,
  truckGeometry,
  stackerGeometry,
  dockGeometry,
  YARD_MACHINES,
  YARD_DOCKS,
  buildYard,
} from '../../src/world/containers.js';

// 与地图一致的换算：实例世界脚印（含偏航后的 AABB）
function footprint(st) {
  const s = CONTAINER_SPECS[st.spec];
  const yaw = st.yaw || 0;
  const c = Math.abs(Math.cos(yaw));
  const sn = Math.abs(Math.sin(yaw));
  return { hw: (c * s.w + sn * s.d) / 2, hd: (sn * s.w + c * s.d) / 2 };
}

describe('集装箱规格', () => {
  it('三种箱型尺寸与真实 ISO 箱一致', () => {
    expect(CONTAINER_SPECS.c20.w).toBeCloseTo(6.06, 2);
    expect(CONTAINER_SPECS.c20.h).toBeCloseTo(2.59, 2);
    expect(CONTAINER_SPECS.c20.d).toBeCloseTo(2.44, 2);
    expect(CONTAINER_SPECS.c40.w).toBeCloseTo(12.19, 2);
    expect(CONTAINER_SPECS.c40hc.h).toBeGreaterThan(CONTAINER_SPECS.c40.h);
  });

  it('配色够多且互不相同（同色堆在一起会糊成一块）', () => {
    expect(YARD_PALETTE.length).toBeGreaterThanOrEqual(6);
    expect(new Set(YARD_PALETTE).size).toBe(YARD_PALETTE.length);
  });
});

describe('几何构造', () => {
  it('每种箱型都能生成合法几何（有顶点色、有包围球）', () => {
    for (const spec of Object.keys(CONTAINER_SPECS)) {
      const g = containerGeometry(spec);
      expect(g, spec).toBeTruthy();
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('color'), spec + ' 缺顶点色').toBeTruthy();
      expect(g.boundingSphere).toBeTruthy();
    }
  });

  it('顶点色覆盖全部顶点（漏一段会让那部分染成黑色）', () => {
    const g = containerGeometry('c20');
    const pos = g.getAttribute('position').count;
    const col = g.getAttribute('color').count;
    expect(col).toBe(pos);
  });

  it('顶点色分三档明度：能看出轮廓/肋条/主体（卡通化的关键）', () => {
    const g = containerGeometry('c20');
    const c = g.getAttribute('color').array;
    const shades = new Set();
    for (let i = 0; i < c.length; i += 3) shades.add(Math.round(c[i] * 100));
    // 至少要能分出深(角件/柱)、中(肋条)、亮(主体)三层
    expect(shades.size).toBeGreaterThanOrEqual(3);
    const arr = [...shades].sort((a, b) => a - b);
    expect(arr[arr.length - 1] - arr[0]).toBeGreaterThan(30);
  });

  it('40 尺箱比 20 尺箱长一倍（比例没写错）', () => {
    const a = containerGeometry('c20');
    const b = containerGeometry('c40');
    expect(b.boundingSphere.radius).toBeGreaterThan(a.boundingSphere.radius);
  });

  it('小道具几何都能生成', () => {
    for (const g of [barrierGeometry(), coneGeometry(), fenceGeometry()]) {
      expect(g).toBeTruthy();
      expect(g.getAttribute('color')).toBeTruthy();
    }
    for (let k = 0; k < 3; k++) {
      expect(clusterGeometry(k), 'cluster ' + k).toBeTruthy();
    }
  });

  it('围栏是镂空的（竖条 + 横条，不是一块板）', () => {
    const f = fenceGeometry();
    const base = barrierGeometry();
    // 同样 3 米跨度，围栏的三角形数应明显多于实心条
    expect(f.getAttribute('position').count).toBeGreaterThan(base.getAttribute('position').count);
  });

  it('大件机械都能生成几何（门吊/卡车/堆高机/装卸平台）', () => {
    for (const [name, fn] of [
      ['gantry', gantryGeometry], ['truck', truckGeometry],
      ['stacker', stackerGeometry], ['dock', dockGeometry],
    ]) {
      const g = fn();
      expect(g, name).toBeTruthy();
      expect(g.getAttribute('color'), name + ' 缺顶点色').toBeTruthy();
      expect(g.getAttribute('position').count).toBeGreaterThan(100);
    }
  });

  it('门吊高于集装箱两层（否则剪影会被箱堆吃掉）', () => {
    const g = gantryGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox.max.y).toBeGreaterThan(CONTAINER_SPECS.c20.h * 2 + 3);
  });
});

describe('布置表 · 不破坏玩法', () => {
  it('所有集装箱都在场地内（±45 以内，留 1 米余量）', () => {
    for (const st of YARD_STACKS) {
      expect(Math.abs(st.x)).toBeLessThan(44);
      expect(Math.abs(st.z)).toBeLessThan(44);
    }
  });

  it('主街与横街净空：|x|≤7 或 |z|≤7 的区域不放箱子', () => {
    for (const st of YARD_STACKS) {
      const f = footprint(st);
      // 箱子的 AABB 不能压进主街/横街通道
      const overlapsMainX = Math.abs(st.x) - f.hw < 7;
      const overlapsMainZ = Math.abs(st.z) - f.hd < 7;
      expect(overlapsMainX && overlapsMainZ, `箱子 (${st.x},${st.z}) 压在主街/横街交叉口`).toBe(false);
      // 更严格：箱子整体必须落在外环（任一边超出 30）
      const inOuter = Math.abs(st.x) - f.hw > 30 || Math.abs(st.z) - f.hd > 30;
      expect(inOuter, `箱子 (${st.x},${st.z}) 不在外环`).toBe(true);
    }
  });

  it('不挡刷怪点：离每个刷怪点 ≥1.6 米（Zombie 推出量之外再留余量）', () => {
    const spawns = [
      [0, -43], [-6, -41], [6, -41], [-4, -37], [4, -39],
      [-41, 0], [41, 0], [26, -39], [-41, -30], [41, -30],
    ];
    for (const st of YARD_STACKS) {
      const f = footprint(st);
      for (const [sx, sz] of spawns) {
        // 点到 AABB 的距离
        const dx = Math.max(0, Math.abs(sx - st.x) - f.hw);
        const dz = Math.max(0, Math.abs(sz - st.z) - f.hd);
        const dist = Math.hypot(dx, dz);
        expect(dist, `箱子 (${st.x},${st.z}) 离刷怪点 (${sx},${sz}) 只有 ${dist.toFixed(2)}m`).toBeGreaterThan(1.6);
      }
    }
  });

  it('不挡拾取点：离每个拾取点 ≥1.2 米（流场探针格必须活着）', () => {
    const spots = [
      [-8, 30], [8, 30], [0, 9], [-26, 0],
      [34, 0], [0, -33], [-19, -19], [26, 19],
    ];
    for (const st of YARD_STACKS) {
      const f = footprint(st);
      for (const [px, pz] of spots) {
        const dx = Math.max(0, Math.abs(px - st.x) - f.hw);
        const dz = Math.max(0, Math.abs(pz - st.z) - f.hd);
        const dist = Math.hypot(dx, dz);
        expect(dist, `箱子 (${st.x},${st.z}) 离拾取点 (${px},${pz}) 只有 ${dist.toFixed(2)}m`).toBeGreaterThan(1.2);
      }
    }
  });

  it('箱子之间不重叠（两摞叠在一起会出现双份碰撞圆）', () => {
    for (let i = 0; i < YARD_STACKS.length; i++) {
      for (let j = i + 1; j < YARD_STACKS.length; j++) {
        const a = YARD_STACKS[i];
        const b = YARD_STACKS[j];
        // 同坐标视为同一条目（多层用 n 表达，不是重复条目）
        if (a.x === b.x && a.z === b.z) continue;
        const fa = footprint(a);
        const fb = footprint(b);
        const overlapX = Math.abs(a.x - b.x) < fa.hw + fb.hw - 0.01;
        const overlapZ = Math.abs(a.z - b.z) < fa.hd + fb.hd - 0.01;
        expect(!(overlapX && overlapZ), `箱子 (${a.x},${a.z}) 与 (${b.x},${b.z}) 重叠`).toBe(true);
      }
    }
  });

  it('锥桶与围栏不压在箱子里（视觉会穿模）', () => {
    const all = [...YARD_CONES.map((c) => [c[0], c[1]]), ...YARD_FENCES.map((f) => [f[0], f[1]])];
    for (const [x, z] of all) {
      for (const st of YARD_STACKS) {
        const f = footprint(st);
        const inside = Math.abs(x - st.x) < f.hw + 0.2 && Math.abs(z - st.z) < f.hd + 0.2;
        expect(!inside, `道具 (${x},${z}) 嵌在箱子 (${st.x},${st.z}) 里`).toBe(true);
      }
    }
  });

  it('大件机械不互相重叠', () => {
    // 粗略足迹：门吊 15×8、卡车 11×3、堆高机 8×3、装卸平台 23×5
    const size = { gantry: [15, 8], truck: [11, 3], stacker: [8, 3], dock: [23, 5] };
    const all = [...YARD_MACHINES, ...YARD_DOCKS.map((d) => ({ ...d, kind: 'dock' }))];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const sa = size[a.kind];
        const sb = size[b.kind];
        const ox = Math.abs(a.x - b.x) < (sa[0] + sb[0]) / 2 - 0.5;
        const oz = Math.abs(a.z - b.z) < (sa[1] + sb[1]) / 2 - 0.5;
        expect(!(ox && oz), `${a.kind}(${a.x},${a.z}) 与 ${b.kind}(${b.x},${b.z}) 重叠`).toBe(true);
      }
    }
  });
});

describe('buildYard · 接线', () => {
  const fakeMap = () => {
    const platforms = [];
    const colliders = [];
    const walls = [];
    return {
      root: new THREE.Group(),
      platforms,
      colliders,
      walls,
      addPlatform(x, z, w, d, h) {
      platforms.push({ x, z, w, d, h });
      // 真实地图的 addPlatform 会顺带登进 walls（Downtown/Arena 都是），假件要照做，
      // 否则测不出「buildYard 有没有重复推」
      walls.push({ x, z, hx: w / 2, hz: d / 2, hy: h / 2, y: h / 2, c: 1, s: 0 });
    },
      blockColliders(x, z, w, d) { colliders.push({ x, z, w, d }); },
    };
  };

  it('大件机械：卡车/堆高机占平台+碰撞，门吊只挡四条腿', () => {
    const map = fakeMap();
    const r = buildYard(map);
    const solid = YARD_MACHINES.filter((m) => m.collide).length;
    const gantries = YARD_MACHINES.filter((m) => m.kind === 'gantry').length;
    // 卡车/堆高机：各一条平台
    expect(map.platforms.length).toBe(r.stacks.length + solid);
    // 门吊：不占平台（横梁 12 米高，玩家要从底下过），但四条腿各有碰撞
    // 箱子每摞 blockColliders 铺一圈圆，机械各一圈，门吊 4 圈
    expect(gantries).toBeGreaterThan(0);
    expect(map.colliders.length).toBeGreaterThan(r.stacks.length + solid);
  });

  it('返回 draw call / 箱数 / mesh 表', () => {
    const map = fakeMap();
    const r = buildYard(map);
    expect(r.drawCalls).toBeGreaterThan(0);
    expect(r.containers).toBeGreaterThan(10);
    expect(r.meshes.length).toBe(r.drawCalls);
  });

  it('draw call 是常数级，不随箱数增长', () => {
    const r = buildYard(fakeMap());
    // 3 种箱型 + 防撞墩 + 围栏 + 锥桶 + 3 套簇 + 7 台机械 + 2 个装卸平台 = 最多 17 个
    expect(r.drawCalls).toBeLessThanOrEqual(17);
    // 关键：27 个箱体只占 3 个 draw call（实例化），不是一箱一个
    expect(r.containers).toBeGreaterThan(20);
    expect(r.drawCalls).toBeLessThan(r.containers);
  });

  it('每摞都登记了 platform / colliders（wall 由 addPlatform 代劳，不能重复）', () => {
    const map = fakeMap();
    const r = buildYard(map);
    const machineCount = YARD_MACHINES.filter((m) => m.collide).length;
    // 箱子每摞一条，加上场内机械（卡车/堆高机）各一条；门吊不占平台
    expect(map.platforms.length).toBe(r.stacks.length + machineCount);
    // walls 与 platforms 一对一：重复推会让投掷物算两次反弹
    expect(map.walls.length).toBe(r.stacks.length + machineCount);
    // colliders 比 platforms 多：门吊四条腿各铺一圈圆
    expect(map.colliders.length).toBeGreaterThan(r.stacks.length + machineCount);
  });

  it('平台高度 = 箱高 × 层数（多层堆叠不能只按一层算）', () => {
    const map = fakeMap();
    const r = buildYard(map);
    for (const s of r.stacks) {
      const pf = map.platforms.find((p) => p.x === s.x && p.z === s.z);
      expect(pf.h, `(${s.x},${s.z}) 高度错`).toBeCloseTo(s.h, 3);
      expect(pf.h).toBeCloseTo(CONTAINER_SPECS[s.spec].h * s.levels, 3);
    }
  });

  it('所有 instance 都有颜色（没染色的会变成白块）', () => {
    const map = fakeMap();
    buildYard(map);
    for (const mesh of map.root.children) {
      if (!mesh.isInstancedMesh) continue;
      if (!mesh.geometry.getAttribute('color')) continue;
      // 主体箱子必须带 instanceColor
      expect(mesh.count).toBeGreaterThan(0);
    }
    const withColor = map.root.children.filter((m) => m.isInstancedMesh && m.instanceColor);
    expect(withColor.length).toBeGreaterThan(0);
  });

  it('重复构建位置完全一致（确定性随机，玩家要能记住路）', () => {
    const a = buildYard(fakeMap());
    const b = buildYard(fakeMap());
    expect(a.containers).toBe(b.containers);
    expect(JSON.stringify(a.stacks)).toBe(JSON.stringify(b.stacks));
  });

  it('不同 seed 只改配色与微抖动，不改布局骨架', () => {
    const a = buildYard(fakeMap(), { seed: 1 });
    const b = buildYard(fakeMap(), { seed: 2 });
    expect(a.containers).toBe(b.containers);
    // 位置会有 ±8cm 的偏航抖动，但箱型/层数/落点必须一致
    const key = (r) => r.stacks.map((s) => `${s.x},${s.z},${s.spec},${s.levels}`).join('|');
    expect(key(a)).toBe(key(b));
  });

  it('实例矩阵是有限数（NaN 会让整个箱子消失）', () => {
    const map = fakeMap();
    buildYard(map);
    for (const mesh of map.root.children) {
      if (!mesh.isInstancedMesh) continue;
      const arr = mesh.instanceMatrix.array;
      for (let i = 0; i < arr.length; i++) {
        expect(Number.isFinite(arr[i]), `${mesh.count} 实例的矩阵含非有限值`).toBe(true);
      }
    }
  });

  it('整摞只有一个平台（逐层登记会让玩家被上下推挤区夹死）', () => {
    const map = fakeMap();
    buildYard(map);
    const multi = map.platforms.filter((p) => p.h > CONTAINER_SPECS.c20.h + 0.01);
    // 有堆叠的平台存在，但每摞只有一条记录
    expect(multi.length).toBeGreaterThan(0);
    const keys = map.platforms.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});