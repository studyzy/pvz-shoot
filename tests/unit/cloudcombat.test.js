import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { CLOUD, ZOMBIES } from '../../src/config.js';
import { Player } from '../../src/entities/Player.js';

let CloudCombat;
beforeAll(async () => {
  const path = '../../src/entities/CloudCombat.js';
  try { ({ CloudCombat } = await import(path)); } catch (e) { if (!String(e).includes('Cannot find') && !String(e).includes('Failed to load')) throw e; }
});
function make(guest = false) {
  expect(CloudCombat, 'CloudCombat constructor').toBeTypeOf('function');
  const player = new Player(null);
  player.pos.set(0, 0, 0);
  player.onDamage = vi.fn();
  const netGuest = new Player(null);
  netGuest.pos.set(5, 0, 0);
  netGuest.onDamage = vi.fn();
  const ctx = { player, game: { netGuest, isGuestWorld: () => guest },
    map: { id: 'cloud', root: new THREE.Group(), bounds: { x: 36, z: 36 }, walls: [], platforms: [], bellHit: vi.fn() },
    zombies: { zombies: [] }, sfx: { cloudBell: vi.fn() } };
  const combat = ctx.cloud = new CloudCombat(ctx);
  return { ctx, combat, player, netGuest };
}
function toy(ctx, type = 'springDuck', x = -16, z = 3, y = 0) {
  const m = { type, def: ZOMBIES[type], root: { position: new THREE.Vector3(x, y, z) },
    alive: true, dying: false, dead: false, stopTimer: 0, skillState: 'idle', skillTimer: .65 };
  ctx.zombies.zombies.push(m);
  return m;
}
function tick(c, seconds) { while (seconds > 1e-8) { const dt = Math.min(1 / 60, seconds); c.update(dt); seconds -= dt; } }

describe('铜钟 · 几何和权威局部停机', () => {
  it('命中球按3D和最早t，其他图禁用，不吸附敌人', () => {
    const { combat, ctx } = make();
    const a = new THREE.Vector3(-25, 1.7, 3), b = new THREE.Vector3(25, 1.7, 3);
    expect(combat.bellIntersection(a, b)).toEqual({ id: 0, t: (9 - .575) / 50 });
    expect(combat.bellIntersection(a.clone().setY(3), b.clone().setY(3))).toBeNull();
    expect(combat.bellIntersection(new THREE.Vector3(-16, 1.7, 3), new THREE.Vector3(-16, 1.7, 3))).toEqual({ id: 0, t: 0 });
    ctx.map.id = 'forest';
    expect(combat.bellIntersection(a, b)).toBeNull();
    expect(combat.ringBell(0)).toBe(false);
  });
  it('三钟共享18s冷却，半径8m三维只影响cloud活玩具且不重置技能', () => {
    const { combat, ctx } = make();
    const duck = toy(ctx); duck.skillState = 'telegraph';
    const rabbit = toy(ctx, 'clockRabbit', -16, 10);
    const glider = toy(ctx, 'paperGlider', -16, 3, 2.6);
    const high = toy(ctx, 'toySoldier', -16, 3, 10);
    const outside = toy(ctx, 'springDuck', -16, 12);
    const corpse = toy(ctx); corpse.dying = true;
    const old = toy(ctx, 'normal');
    expect(combat.ringBell(0)).toBe(true);
    for (const m of [duck, rabbit, glider]) expect(m.stopTimer).toBe(CLOUD.bell.duration);
    for (const m of [high, outside, corpse, old]) expect(m.stopTimer).toBe(0);
    expect(duck.skillState).toBe('telegraph'); expect(duck.skillTimer).toBe(.65);
    expect(combat.cooldown).toBe(18);
    expect(combat.ringBell(1)).toBe(false);
    expect(ctx.map.bellHit.mock.calls).toEqual([[0, true], [1, false]]);
    tick(combat, 18);
    expect(combat.cooldown).toBeCloseTo(0);
    expect(combat.ringBell(0)).toBe(true);
  });
  it('空响不耗冷却，无效id不反馈，guest不裁决钟', () => {
    const { combat, ctx } = make();
    expect(combat.ringBell(-1)).toBe(false);
    expect(combat.ringBell(3)).toBe(false);
    expect(ctx.map.bellHit).not.toHaveBeenCalled();
    expect(combat.ringBell(0)).toBe(false);
    expect(combat.cooldown).toBe(0);
    expect(ctx.map.bellHit).toHaveBeenCalledWith(0, false);
    const guest = make(true); toy(guest.ctx);
    expect(guest.combat.ringBell(0)).toBe(false);
    expect(guest.ctx.map.bellHit).not.toHaveBeenCalled();
  });
});

describe('茶滴 · 锁地抛射、固定池和墙', () => {
  it('六发池封顶，锁定位置不追玩家；停机与发射者死亡不暂停已发茶滴', () => {
    const { combat, ctx, player } = make();
    const z = toy(ctx, 'teaSprite', 0, -4);
    const target = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 6; i++) expect(combat.throwTea(z, target)).toBe(true);
    expect(combat.throwTea(z, target)).toBe(false);
    expect(combat.tea.filter((p) => p.active)).toHaveLength(6);
    player.pos.set(10, 0, 0); z.stopTimer = 1.6; z.dying = true;
    tick(combat, 1);
    expect(player.onDamage).not.toHaveBeenCalled();
    expect(combat.tea.filter((p) => p.active)).toHaveLength(0);
  });
  it('触地同一目标只结算一次，两个seat独立，撞墙作废不穿墙伤人', () => {
    const { combat, ctx, player, netGuest } = make();
    netGuest.pos.copy(player.pos);
    const z = toy(ctx, 'teaSprite', 0, -4);
    expect(combat.throwTea(z, player.pos)).toBe(true);
    tick(combat, .8);
    expect(player.onDamage).toHaveBeenCalledTimes(1);
    expect(netGuest.onDamage).toHaveBeenCalledTimes(1);
    expect(player.hp).toBe(92);
    tick(combat, 1); expect(player.onDamage).toHaveBeenCalledTimes(1);
    player.invuln = 0; netGuest.invuln = 0;
    ctx.map.walls = [{ x: 0, y: 3, z: -2, hx: 2, hy: 3, hz: .2, c: 1, s: 0 }];
    expect(combat.throwTea(z, player.pos)).toBe(true);
    tick(combat, 1);
    expect(player.onDamage).toHaveBeenCalledTimes(1);
  });
  it('被墙挡视线时不允许开始茶壶抛射', () => {
    const { combat, ctx, player } = make();
    const z = toy(ctx, 'teaSprite', 0, -4);
    expect(combat.hasLineOfSight(z, player)).toBe(true);
    ctx.map.walls = [{ x: 0, y: 2, z: -2, hx: 2, hy: 2, hz: .2, c: 1, s: 0 }];
    expect(combat.hasLineOfSight(z, player)).toBe(false);
  });
});

describe('报时圈 · 真实支撑面与单次seat伤害', () => {
  it('圈从2到10扫掠，平地和站0.4台都会受伤，跳高>0.35才躲过', () => {
    const { combat, ctx, player, netGuest } = make();
    player.pos.set(5, .4, 0); netGuest.pos.set(5, .8, 0);
    ctx.map.platforms = [{ x: 5, z: 0, w: 3, d: 3, h: .4 }];
    const z = toy(ctx, 'clockRabbit', 0, 0);
    expect(combat.emitWave(z)).toBe(true);
    tick(combat, .65);
    expect(player.hp).toBe(82);
    expect(netGuest.hp).toBe(100);
    netGuest.pos.y = .4;
    player.invuln = 0;
    tick(combat, .8);
    expect(player.onDamage).toHaveBeenCalledTimes(1);
    expect(netGuest.onDamage).not.toHaveBeenCalled();
    expect(combat.waves.some((p) => p.active)).toBe(false);
  });
  it('每圈两人各一次；大dt不穿过命中，死亡/倒地跳过，固定小池', () => {
    const { combat, ctx, player, netGuest } = make();
    player.pos.set(5, 0, 0); netGuest.pos.set(5, 0, 0);
    const z = toy(ctx, 'clockRabbit', 0, 0);
    expect(combat.emitWave(z)).toBe(true);
    combat.update(1);
    expect(player.onDamage).toHaveBeenCalledTimes(1); expect(netGuest.onDamage).toHaveBeenCalledTimes(1);
    combat.update(.5);
    expect(player.onDamage).toHaveBeenCalledTimes(1);
    player.dead = true; netGuest.downed = true;
    for (let i = 0; i < CLOUD.waveMax; i++) expect(combat.emitWave(z)).toBe(true);
    expect(combat.emitWave(z)).toBe(false);
    combat.update(1);
    expect(player.onDamage).toHaveBeenCalledTimes(1); expect(netGuest.onDamage).toHaveBeenCalledTimes(1);
  });
  it('高波仅两条普通冲撞/俯冲预警，Boss圈预警/发圈延后新普通攻击', () => {
    const { combat, ctx } = make();
    const a = toy(ctx), b = toy(ctx, 'paperGlider'), c = toy(ctx);
    a.skillState = 'telegraph'; b.skillState = 'descent';
    expect(combat.canStartAttack(c)).toBe(false);
    b.skillState = 'land'; expect(combat.canStartAttack(c)).toBe(true);
    const boss = toy(ctx, 'clockRabbit'); boss.skillState = 'ringTelegraph';
    expect(combat.canStartAttack(c)).toBe(false);
    boss.skillState = 'idle'; combat.emitWave(boss);
    expect(combat.canStartAttack(c)).toBe(false);
  });
});

describe('cloud权威快照与清理', () => {
  it('guest只显示host茶滴/圈/钟冷却，不自推伤害或时钟；state空集回收', () => {
    const host = make(); const z = toy(host.ctx, 'teaSprite', 0, -4);
    host.combat.throwTea(z, host.player.pos); host.combat.emitWave(toy(host.ctx, 'clockRabbit', 0, 0));
    host.combat.cooldown = 9;
    const s = host.combat.serialize();
    const guest = make(true);
    guest.combat.applyNetState(s);
    expect(guest.combat.serialize()).toEqual(s);
    guest.combat.update(1);
    expect(guest.combat.serialize()).toEqual(s);
    expect(guest.player.onDamage).not.toHaveBeenCalled();
    expect(guest.combat.throwTea(z, host.player.pos)).toBe(false);
    expect(guest.combat.emitWave(z)).toBe(false);
    guest.combat.applyNetState({ cooldown: 0, tea: [], waves: [] });
    expect(guest.combat.tea.some((p) => p.active)).toBe(false);
  });
  it('reset回收自己的场景网格、钟冷却和effects，换图不会残留', () => {
    const { combat, ctx, player } = make();
    combat.throwTea(toy(ctx, 'teaSprite'), player.pos); combat.emitWave(toy(ctx, 'clockRabbit'));
    combat.cooldown = 9;
    const root = ctx.map.root;
    expect(root.children.some((m) => m.visible)).toBe(true);
    ctx.map = { id: 'forest', root: new THREE.Group() };
    combat.reset();
    expect(combat.serialize()).toEqual({ cooldown: 0, tea: [], waves: [] });
    expect(root.children).toHaveLength(0);
    combat.update(1);
  });
});
