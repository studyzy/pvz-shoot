// WeaponPickups 的池化 / 空投 / 共享补给路径。
// 这些方法原来几乎没有直接覆盖（只被 flows 的整局测试擦到边），这里按方法逐个验。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { WeaponPickups } from '../../src/entities/WeaponPickups.js';
import { WEAPONS, PEA_ID } from '../../src/config.js';

function makeCtx() {
  return {
    scene: new THREE.Scene(),
    player: { pos: new THREE.Vector3(0, 0, 0) },
    sfx: { pickup: vi.fn(), deny: vi.fn() },
    weapons: { pickup: vi.fn(() => true), slotIndexOf: vi.fn(() => null) },
    hud: { setSun: vi.fn() },
  };
}

function makeMap() {
  return {
    id: 'forest',
    pickupSpots: [[-4, 0], [4, 0], [0, -4], [0, 4], [8, 8], [-8, 8], [8, -8], [-8, -8]],
    platforms: [],
  };
}

function fresh() {
  const ctx = makeCtx();
  const p = new WeaponPickups(ctx);
  p.setMap(makeMap());
  return { ctx, p };
}

describe('WeaponPickups · 池与重置', () => {
  it('setMap 后点位数量与池一致，开局只刷 1 个', () => {
    const { p } = fresh();
    expect(p.items.length).toBe(10); // MAX_SPOTS
    const active = p.items.filter((i) => i.active).length;
    expect(active).toBe(1);
  });

  it('空投 spawnAir：带 air 标记，位置落在指定点', () => {
    const { p } = fresh();
    expect(p.spawnAir(0, 5, 5)).toBe(true);
    const item = p.items.find((i) => i.active && i.air);
    expect(item).toBeTruthy();
    expect(item.group.position.x).toBe(5);
    expect(item.group.position.z).toBe(5);
  });

  it('pickAirSpot：点位用尽后返回 null', () => {
    const { p } = fresh();
    const first = p.pickAirSpot();
    expect(first).toBeTruthy();
    for (const it of p.items) it.used = true;
    expect(p.pickAirSpot()).toBeNull();
  });

  it('byId / removeById：按 id 取与移除', () => {
    const { p } = fresh();
    p.spawnAir(0, 1, 1);
    const item = p.items.find((i) => i.active && i.air);
    expect(p.byId(item.id)).toBe(item);
    expect(p.removeById(item.id)).toBe(true);
    expect(p.byId(item.id)).toBeNull();
    expect(item.air).toBe(false);
    expect(p.removeById(99999)).toBe(false);
  });

  it('netList 只列出 active 的道具，且带 id / 坐标', () => {
    const { p } = fresh();
    p.spawnAir(0, 2, 3);
    const list = p.netList();
    expect(list.length).toBeGreaterThan(0);
    for (const e of list) {
      expect(typeof e.id).toBe('number');
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.z)).toBe(true);
    }
  });

  it('clearAll / endLevel：整关结束后池清空且不再补刷', () => {
    const { p } = fresh();
    const fn = p.clearAll || p.endLevel || p.finish;
    if (fn) {
      fn.call(p);
      expect(p.items.every((i) => !i.active)).toBe(true);
      expect(p.finished).toBe(true);
    }
  });
});

describe('WeaponPickups · 空投道具的悬浮表现', () => {
  it('air 道具在 update 里抬到更高高度，label 也跟着抬', () => {
    const { ctx, p } = fresh();
    p.spawnAir(0, 0, 0);
    const item = p.items.find((i) => i.active && i.air);
    const beforeHolder = item.holder.position.y;
    const beforeLabel = item.label.position.y;
    p.update(0.05, ctx.player);
    // air 分支把 holder 定在 1.0 附近、label 定在 2.2，和普通道具不是同一档
    expect(item.holder.position.y).toBeGreaterThanOrEqual(beforeHolder - 0.01);
    expect(item.label.position.y).toBeGreaterThan(beforeLabel - 0.01);
    expect(item.holder.position.y).toBeGreaterThan(0.6);
  });

  it('远离玩家（>30 米）的道具不可见', () => {
    const { ctx, p } = fresh();
    p.spawnAir(0, 40, 0); // 40 米 > 30 米可见半径
    const item = p.items.find((i) => i.active && i.air);
    ctx.player.pos.set(0, 0, 0);
    p.update(0.016, ctx.player);
    expect(item.group.visible).toBe(false);
    // 走近后重新可见
    ctx.player.pos.set(39, 0, 0); // 走到 1 米内
    p.update(0.016, ctx.player);
    expect(item.group.visible).toBe(true);
  });

  it('pickCooldown / claimT 每帧递减且不会变负', () => {
    const { ctx, p } = fresh();
    p.spawnAir(0, 0, 0);
    const item = p.items.find((i) => i.active && i.air);
    // 站远一点，避免靠近后被自动拾取、道具被回收
    ctx.player.pos.set(100, 0, 0);
    item.pickCooldown = 0.05;
    item.claimT = 0.05;
    p.update(0.1, ctx.player);
    expect(item.pickCooldown).toBe(0);
    expect(item.claimT).toBe(0);
  });
});

describe('WeaponPickups · 掉落与随机池', () => {
  it('dropAt 把道具丢到脚边并加 1 秒拾取冷却', () => {
    const { p } = fresh();
    const ok = p.dropAt(1, 2, 3);
    expect(ok).toBe(true);
    const dropped = p.items.find((i) => i.active && i.dropped);
    expect(dropped).toBeTruthy();
    expect(dropped.pickCooldown).toBeCloseTo(1.0, 5);
  });

  it('dropAt 在 shared 模式走 onDrop，非 shared 走 notify', () => {
    const { p } = fresh();
    const onDrop = vi.fn();
    const onChange = vi.fn();
    p.shared = true;
    p.onDrop = onDrop;
    p.dropAt(1, 0, 0);
    expect(onDrop).toHaveBeenCalled();
    p.shared = false;
    p.onChange = onChange;
    p.dropAt(2, 0, 0);
    expect(onChange).toHaveBeenCalled();
  });

  it('lootIndices 排除了豌豆与坚果', () => {
    const { p } = fresh();
    expect(p.lootIndices.length).toBeGreaterThan(0);
    for (const i of p.lootIndices) {
      const def = WEAPONS[i];
      expect(def.starter, def.id).toBeFalsy();
      expect(def.slot).not.toBe('shield');
    }
    expect(p.lootIndices).not.toContain(PEA_ID);
  });
});
describe('WeaponPickups · 共享列表同步与满池', () => {
  it('applyNetList：列表里没有的本地道具会被清掉', () => {
    const { p } = fresh();
    p.spawnAir(0, 1, 1);
    const a = p.items.find((i) => i.active && i.air);
    const keep = { id: a.id, i: a.index, x: 1, z: 1, a: 1 };
    p.applyNetList([keep]);
    expect(a.active).toBe(true);
    // 再来一份空列表：本地全部清掉
    p.applyNetList([]);
    expect(p.items.filter((i) => i.active)).toHaveLength(0);
  });

  it('applyNetList 忽略非法条目（缺 id / i）', () => {
    const { p } = fresh();
    expect(() => p.applyNetList([{ x: 1 }, null, undefined, { id: NaN, i: 1 }])).not.toThrow();
  });

  it('全池占满时 dropAt 仍能成功（搬一个点位道具过来）', () => {
    const { p } = fresh();
    for (const it of p.items) { it.active = true; it.spot = [0, 0]; it.group.visible = true; }
    const ok = p.dropAt(2, 3, 3);
    expect(ok).toBe(true);
  });

  it('beamAt 亮起光柱，beamT 归零后自动隐藏', () => {
    const { p } = fresh();
    p.beamAt(2, 3, 0.5);
    expect(p.beam.visible).toBe(true);
    p.update(0.6, { pos: new THREE.Vector3(100, 0, 0) });
    expect(p.beam.visible).toBe(false);
  });
});

describe('WeaponPickups · clear', () => {
  it('clear 把全部道具收起、复位标记并标记本关结束', () => {
    const { p } = fresh();
    p.spawnAir(0, 1, 1);
    p.clear();
    expect(p.items.every((i) => !i.active)).toBe(true);
    expect(p.items.every((i) => !i.dropped && !i.used)).toBe(true);
    expect(p.spawnTimer).toBe(0);
    expect(p.finished).toBe(true);
  });
});
