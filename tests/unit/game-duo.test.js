import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/entities/RemotePlayer.js', () => ({
  RemotePlayer: class {
    constructor(opts) {
      this.opts = opts;
      this.root = {};
      this.calls = { transform: [], target: [], moving: [], firing: 0 };
    }
    update() {}
    dispose() {
      this.disposed = true;
    }
    setTransform(x, z, yaw, y) {
      this.calls.transform.push([x, z, yaw, y]);
    }
    setTarget(x, z, yaw, y) {
      this.calls.target.push([x, z, yaw, y]);
    }
    setMoving(m, s) {
      this.calls.moving.push([m, s]);
    }
    setFiring() {
      this.calls.firing++;
    }
  },
}));

vi.mock('../../src/net/DuoSession.js', () => ({
  DuoSession: class {
    constructor(game) {
      if (globalThis.__duoThrow) throw new Error('boom');
      this.game = game;
      this.started = null;
      this.closed = false;
      DuoSession.last = this;
    }
    start(opts) {
      this.started = opts;
    }
    close() {
      this.closed = true;
    }
  },
}));

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

let createGame;
let DuoSession;
beforeAll(async () => {
  ({ createGame } = await import('../helpers/game.js'));
  ({ DuoSession } = await import('../../src/net/DuoSession.js'));
});

async function boot() {
  const { game } = await createGame();
  return game;
}

describe('Game 双人接入', () => {
  it('startDuo 进图、双出生点、无僵尸波次', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'snow', seat: 1, peerName: '队友 B', seed: 7, t0: 123 });
    expect(game.state).toBe('playing');
    expect(game.mapId).toBe('snow');
    expect(game.duo).toMatchObject({ seat: 1, peerName: '队友 B', seed: 7 });
    expect(game.seat).toBe(1);
    expect(game.player.pos.x).toBeCloseTo(game.map.spawn.x + 1.8);
    expect(game.player.pos.z).toBeCloseTo(game.map.spawn.z);
    expect(game.zombies.state).toBe('idle');
    expect(game.remotes).toHaveLength(1);
    expect(game.remote.opts.name).toBe('队友 B');
    expect(game.remote.opts.x).toBeCloseTo(game.map.spawn.x - 1.8);
    expect(game.remote.opts.z).toBeCloseTo(game.map.spawn.z);
  });

  it('applyRemoteState 驱动位置/移动/开火，开火只在上升沿触发', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const r = game.remote;
    game.applyRemoteState({ x: 3, z: 4, y: 0.5, yaw: 1, moving: true, speed: 4, firing: true });
    expect(r.calls.target.at(-1)).toEqual([3, 4, 1, 0.5]);
    expect(r.calls.moving.at(-1)).toEqual([true, 4]);
    expect(r.calls.firing).toBe(1);
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: true, speed: 4, firing: true });
    expect(r.calls.firing).toBe(1);
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: false, speed: 0, firing: false });
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: false, speed: 0, firing: true });
    expect(r.calls.firing).toBe(2);
    game.applyRemoteState({ x: 'bad', z: 4 });
    expect(r.calls.target).toHaveLength(4);
    game.remote = null;
    expect(() => game.applyRemoteState({ x: 1, z: 1 })).not.toThrow();
  });

  it('host 跑 guest 代理：input → 移动/转向/开火/护盾 → remote 跟随', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    expect(game.netGuest).toBeTruthy();
    expect(game.netControls).toBeTruthy();
    const spawnZ = game.netGuest.pos.z;
    const r = game.remote;

    game.applyGuestInput({ seq: 1, m: [0, 1], look: [0, 0], jump: false, fire: true, shield: true });
    game.update(0.05);
    expect(game.netGuest.pos.z).toBeLessThan(spawnZ);
    expect(game.netGuest.shield.active).toBe(true);
    expect(r.calls.transform.length).toBeGreaterThan(0);
    expect(r.calls.firing).toBe(1);

    game.applyGuestInput({ seq: 2, m: [0, 1], look: [0.1, 0], jump: false, fire: true, shield: false });
    game.update(0.05);
    expect(game.netGuest.yaw).toBeCloseTo(-0.1, 3);
    expect(r.calls.firing).toBe(1);

    game.applyGuestInput({ seq: 3, m: [0, 1], look: [0, 0], jump: false, fire: false, shield: false });
    game.update(0.05);
    game.applyGuestInput({ seq: 4, m: [0, 1], look: [0, 0], jump: false, fire: true, shield: false });
    game.update(0.05);
    expect(r.calls.firing).toBe(2);

    game.applyGuestInput({ seq: 5, m: [1, 0], look: [0, 0], jump: false, fire: true, shield: false });
    game.applyGuestInput({ m: 'bad', look: 'bad', jump: false, fire: false, shield: false });
    expect(game.netControls.move.x).toBe(1);
    expect(game.lastGuestInputAt).toBeGreaterThan(0);
    game.lastGuestInputAt = Date.now() - 1000;
    game.update(0.05);
    expect(game.netControls.move.x).toBe(0);
    expect(game.netControls.move.y).toBe(0);
    expect(game.netControls.firing).toBe(false);
  });

  it('guest 应用 pstate：host 远端 + 自身软校正/吸附；host 忽略 pstate', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    expect(game.netGuest).toBeNull();
    const r = game.remote;
    const before = game.player.pos.x;
    game.applyPeerState({
      h: { x: 3, y: 0, z: 4, yaw: 1, moving: true, speed: 4, firing: true },
      g: { x: before + 0.5, y: 0, z: game.player.pos.z },
    });
    expect(r.calls.target).toHaveLength(1);
    expect(r.calls.firing).toBe(1);
    expect(game.player.pos.x).toBeCloseTo(before + 0.175, 4);

    const target = game.player.pos.x + 3;
    game.applyPeerState({ g: { x: target, y: 0, z: game.player.pos.z } });
    expect(game.player.pos.x).toBe(target);

    game.applyPeerState({ sun: 42, scores: [10, 20], kills: [1, 2] });
    expect(game.sun).toBe(42);
    expect(game.stats.score).toBe(20);
    expect(game.stats.kills).toBe(2);
    game.duoSession = { sendSunRequest: vi.fn() };
    expect(game.spendSun(20)).toBe(true);
    expect(game.sun).toBe(22);
    expect(game.duoSession.sendSunRequest).toHaveBeenCalledWith(20);
    expect(game.spendSun(999)).toBe(false);

    game.seat = 0;
    const x = game.player.pos.x;
    game.applyPeerState({ g: { x: x + 5, y: 0, z: game.player.pos.z } });
    expect(game.player.pos.x).toBe(x);
    expect(() => game.applyGuestInput({ m: [0, 1] })).not.toThrow();
    expect(() => game.applyGuestInput(null)).not.toThrow();
    expect(() => game.applyPeerState(null)).not.toThrow();
    expect(() => game.applyWorldEvent(null)).not.toThrow();
  });

  it('双人暂停/继续会中继；来自网络的暂停不回传', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const sendPause = vi.fn();
    game.duoSession = { sendPause };
    game.pause();
    expect(sendPause).toHaveBeenCalledWith(true);
    expect(game.state).toBe('paused');
    game.resume();
    expect(sendPause).toHaveBeenCalledWith(false);
    expect(game.state).toBe('playing');
    game.pause(true);
    expect(sendPause).toHaveBeenCalledTimes(2);
    game.resume(true);
    expect(sendPause).toHaveBeenCalledTimes(2);
  });

  it('endDuo 回菜单、清远端、给出提示', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const closed = vi.fn();
    game.duoSession = { close: closed };
    game.endDuo('PEER_TIMEOUT');
    expect(game.state).toBe('menu');
    expect(game.duo).toBeNull();
    expect(game.remotes).toHaveLength(0);
    expect(game.remote).toBeNull();
    expect(closed).toHaveBeenCalled();
    expect(document.getElementById('duoStatus').textContent).toContain('队友掉线');
  });

  it('toggleDuo 动态加载会话；再点取消', async () => {
    const game = await boot();
    await game.toggleDuo();
    expect(game.duoSession).toBeInstanceOf(DuoSession);
    expect(game.duoSession.started).toMatchObject({ name: '戴夫', mapId: game.mapId });
    expect(document.getElementById('duoBtn').textContent).toContain('取消');

    await game.toggleDuo();
    expect(game.duoSession).toBeNull();
    expect(DuoSession.last.closed).toBe(true);
    expect(document.getElementById('duoBtn').textContent).toBe('双人联机');
    expect(document.getElementById('duoStatus').classList.contains('hidden')).toBe(true);

    game.state = 'playing';
    await game.toggleDuo();
    expect(game.duoSession).toBeNull();
  });

  it('backToMenu 关闭会话；start 单人会取消双人', async () => {
    const game = await boot();
    const close = vi.fn();
    game.duoSession = { close };
    game.backToMenu();
    expect(close).toHaveBeenCalled();
    expect(game.duoSession).toBeNull();
    expect(game.duo).toBeNull();

    const close2 = vi.fn();
    game.duoSession = { close: close2 };
    game.start();
    expect(close2).toHaveBeenCalled();
    expect(game.duoSession).toBeNull();
    expect(game.state).toBe('playing');
  });

  it('双人重新开始保留双人模式并重新放队友', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.restart();
    expect(game.state).toBe('playing');
    expect(game.duo).toBeTruthy();
    expect(game.player.pos.x).toBeCloseTo(game.map.spawn.x - 1.8);
    expect(game.remotes).toHaveLength(1);
    expect(game.remote.opts.name).toBe('队友 B');
  });

  it('onPeerLeft / onPeerJoined 显示横幅', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.onPeerLeft(30);
    expect(document.getElementById('banner').textContent).toContain('30');
    game.onPeerJoined('队友 B');
    expect(document.getElementById('banner').textContent).toContain('重连');
  });

  it('onDuoClosed：无关会话忽略；相关会话清空或结束对局', async () => {
    const game = await boot();
    const other = { close: vi.fn() };
    game.duoSession = { close: vi.fn() };
    game.onDuoClosed(other);
    expect(game.duoSession).toBeTruthy();

    const s = { close: vi.fn() };
    game.duoSession = s;
    game.duo = null;
    game.state = 'menu';
    game.onDuoClosed(s);
    expect(game.duoSession).toBeNull();
    expect(document.getElementById('duoBtn').textContent).toBe('双人联机');

    const s2 = { close: vi.fn() };
    game.duoSession = s2;
    game.duo = { seat: 0, peerName: '队友 B' };
    game.state = 'playing';
    game.onDuoClosed(s2);
    expect(game.state).toBe('menu');
    expect(game.duo).toBeNull();
    expect(document.getElementById('duoStatus').textContent).toContain('断开');
  });

  it('toggleDuo：导入后离开菜单会取消；构造抛错会提示', async () => {
    const game = await boot();
    const p = game.toggleDuo();
    game.state = 'playing';
    await p;
    expect(game.duoSession).toBeNull();
    expect(document.getElementById('duoStatus').classList.contains('hidden')).toBe(true);

    game.state = 'menu';
    globalThis.__duoThrow = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await game.toggleDuo();
    expect(game.duoSession).toBeNull();
    expect(document.getElementById('duoStatus').textContent).toContain('加载失败');
    expect(document.getElementById('duoBtn').textContent).toBe('双人联机');
    delete globalThis.__duoThrow;
    err.mockRestore();
  });

  it('双人击杀归属、个人分与结算比分', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.onKill({ type: 'normal' }, 100, false, 1);
    expect(game.duoStats[1]).toBe(100);
    expect(game.duoKills[1]).toBe(1);
    game.onKill({ type: 'normal' }, 50, false, 0);
    expect(game.duoStats[0]).toBe(50);
    expect(game.stats.score).toBe(50);
    expect(game.stats.kills).toBe(1);

    game.endDuo('WIPE', { scores: [50, 100], kills: [1, 1] });
    expect(game.state).toBe('menu');
    expect(document.getElementById('duoStatus').textContent).toContain('本局得分');
  });

  it('复制邀请链接：有剪贴板时复制，没有时提示手动复制', async () => {
    const game = await boot();
    const url = 'https://game.example/?join=abcdefgh';
    game.hud.setDuoShare(url);
    expect(document.getElementById('duoShare').classList.contains('hidden')).toBe(false);

    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.getElementById('duoShare').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(document.getElementById('duoStatus').textContent).toContain('已复制');

    vi.stubGlobal('navigator', {});
    document.getElementById('duoShare').click();
    expect(document.getElementById('duoStatus').textContent).toContain('手动复制');

    game.hud.setDuoShare('');
    game.copyDuoLink();
    vi.unstubAllGlobals();
  });

  it('房主改地图会通知服务器，客人不通知', async () => {
    const game = await boot();
    const sendMap = vi.fn();
    game.duoSession = { host: true, sendMap };
    game.selectMap('snow');
    expect(sendMap).toHaveBeenCalledWith('snow');

    game.duoSession = { host: false, sendMap };
    game.selectMap('dust');
    expect(sendMap).toHaveBeenCalledTimes(1);
  });
});

// ── 双人共享补给 / 重连快照：Game 侧的分支 ──
describe('Game · 补给事件与重连快照', () => {
  it('applyPickupEvent：自己抢到空投 / 队友抢到 / 无该武器索引', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'B' });
    const banners = [];
    game.hud.showBanner = (t) => banners.push(t);
    game.pickups.removeById = () => true;
    game.weapons.pickup = (i) => { banners.push('picked:' + i); return true; };

    // 自己抢到空投（seat 1 会真的 pickup）
    game.applyPickupEvent({ index: 5, seat: 1, air: true, id: 1 });
    expect(banners.some((b) => b.includes('空投'))).toBe(true);
    expect(banners.some((b) => b.startsWith('picked:'))).toBe(true);

    // 队友抢到普通补给
    banners.length = 0;
    game.applyPickupEvent({ index: 5, seat: 0, id: 2 });
    expect(banners.some((b) => b.includes('队友拿到了'))).toBe(true);

    // 非法索引直接返回，不崩
    banners.length = 0;
    expect(() => game.applyPickupEvent({ index: 9999, seat: 1, id: 3 })).not.toThrow();
    expect(banners.length).toBe(0);
  });

  it('buildResync 给出完整世界快照', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.zombies.wave = 7;
    game.sun = 123.4;
    game.duoStats = [10, 20];
    game.duoKills = [1, 2];
    const snap = game.buildResync();
    expect(snap.wave).toBe(7);
    expect(snap.sun).toBe(123);
    expect(snap.scores).toEqual([10, 20]);
    expect(snap.kills).toEqual([1, 2]);
    expect(Array.isArray(snap.z)).toBe(true);
    expect(Array.isArray(snap.pickups)).toBe(true);
    expect(Array.isArray(snap.orbs)).toBe(true);
    expect(typeof snap.bossHp).toBe('number');
  });

  it('buildResync 在没有僵尸/boss 时也能安全产出', async () => {
    const game = await boot();
    game.zombies = null;
    game.pickups = null;
    game.sunOrbs = null;
    const snap = game.buildResync();
    expect(snap.wave).toBe(0);
    expect(snap.bossHp).toBe(0);
    expect(snap.z).toEqual([]);
    expect(snap.pickups).toEqual([]);
    expect(snap.orbs).toEqual([]);
  });

  it('onDuoWipe 收尾：回菜单并保留比分', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'B' });
    game.duoStats = [111, 222];
    expect(() => game.onDuoWipe({ scores: [111, 222], kills: [3, 4] })).not.toThrow();
  });
});

// ── 双人世界事件：host 权威校验 + guest 本地镜像 ──
describe('Game · 世界事件与 claim 校验', () => {
  async function hostGame() {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.netGuest = { pos: { x: 0, y: 0, z: 0 } };
    return game;
  }

  it('applyWorldEvent 的 sun 分支只收 id 存在的球', async () => {
    const game = await hostGame();
    const collectById = vi.fn(() => true);
    game.sunOrbs.collectById = collectById;
    game.sfx.pickup = vi.fn();
    game.applyWorldEvent({ type: 'sun', id: 42 });
    expect(collectById).toHaveBeenCalledWith(42);
    expect(game.sfx.pickup).toHaveBeenCalled();
    // 收不到（ball 不存在）时不响
    collectById.mockReturnValue(false);
    game.sfx.pickup.mockClear();
    game.applyWorldEvent({ type: 'sun', id: 43 });
    expect(game.sfx.pickup).not.toHaveBeenCalled();
  });

  it('applyWorldEvent 的 air 分支：坐标合法才亮光柱', async () => {
    const game = await hostGame();
    const beamAt = vi.fn();
    game.pickups.beamAt = beamAt;
    game.applyWorldEvent({ type: 'air', x: 3, z: 4 });
    expect(beamAt).toHaveBeenCalledWith(3, 4, expect.any(Number));
    beamAt.mockClear();
    game.applyWorldEvent({ type: 'air', x: NaN, z: 4 });
    expect(beamAt).not.toHaveBeenCalled();
  });

  it('applyGuestClaim：太阳球要过 2.2 米距离校验', async () => {
    const game = await hostGame();
    game.sunOrbs.orbs = [{ active: true, id: 5, pos: { x: 0, z: 0 } }];
    game.sunOrbs.collectById = vi.fn(() => true);
    game.addSun = vi.fn();
    game.duoSession = { sendEvent: vi.fn() };

    // 代理在远处：不认
    game.netGuest.pos = { x: 10, y: 0, z: 10 };
    game.applyGuestClaim({ kind: 'sun', id: 5 });
    expect(game.addSun).not.toHaveBeenCalled();

    // 走近：认
    game.netGuest.pos = { x: 0.5, y: 0, z: 0.5 };
    game.applyGuestClaim({ kind: 'sun', id: 5 });
    expect(game.addSun).toHaveBeenCalled();
  });

  it('applyGuestClaim：不存在的 id / 非 host / 无代理都直接返回', async () => {
    const game = await hostGame();
    game.sunOrbs.orbs = [];
    game.addSun = vi.fn();
    game.applyGuestClaim({ kind: 'sun', id: 999 });
    expect(game.addSun).not.toHaveBeenCalled();
    game.seat = 1;
    game.applyGuestClaim({ kind: 'sun', id: 1 });
    game.seat = 0;
    game.netGuest = null;
    expect(() => game.applyGuestClaim({ kind: 'sun', id: 1 })).not.toThrow();
  });

  it('applyGuestDrop：越过 3.5 米或非法坐标都丢掉', async () => {
    const game = await hostGame();
    const dropAt = vi.fn();
    game.pickups.dropAt = dropAt;
    // 太远
    game.applyGuestDrop({ i: 1, x: 20, z: 20 });
    expect(dropAt).not.toHaveBeenCalled();
    // 非法坐标
    game.applyGuestDrop({ i: 1, x: NaN, z: 0 });
    expect(dropAt).not.toHaveBeenCalled();
    // 非法武器索引
    game.applyGuestDrop({ i: 9999, x: 0, z: 0 });
    expect(dropAt).not.toHaveBeenCalled();
    // 合法：落一把
    game.applyGuestDrop({ i: 1, x: 1, z: 1 });
    expect(dropAt).toHaveBeenCalledWith(1, 1, 1);
  });

  it('onSlotSelect 只在 playing 时切槽', async () => {
    const game = await hostGame();
    const equipSlot = vi.fn();
    game.weapons.equipSlot = equipSlot;
    game.state = 'menu';
    game.hud.onSlotSelect('gun', 0);
    expect(equipSlot).not.toHaveBeenCalled();
    game.state = 'playing';
    game.hud.onSlotSelect('gun', 0);
    expect(equipSlot).toHaveBeenCalledWith('gun', 0);
  });
});

// ── setupDuoWorld 的 host/guest 补给回调 ──
describe('Game · 双人补给回调接线', () => {
  it('host：本地拾取会把事件发给 guest；空投还会发奖', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const sendEvent = vi.fn();
    game.duoSession = { sendEvent, sendPickups: vi.fn(), sendClaim: vi.fn(), sendPickupDrop: vi.fn() };
    // 触发 host 的 onLocalPickup 回调
    game.pickups.onLocalPickup({ id: 7, air: false }, 3);
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'pickup', id: 7, seat: 0 }));
  });

  it('guest：claim 与 drop 都会发请求给 host', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'B' });
    const sendClaim = vi.fn();
    const sendPickupDrop = vi.fn();
    game.duoSession = { sendClaim, sendPickupDrop, sendEvent: vi.fn() };
    game.pickups.onClaim(9);
    expect(sendClaim).toHaveBeenCalledWith('pickup', 9);
    game.pickups.onDrop(2, 1, 1);
    expect(sendPickupDrop).toHaveBeenCalledWith(2, 1, 1);
  });

  it('队友倒地/站起会出横幅', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const banners = [];
    game.hud.showBanner = (t) => banners.push(t);
    game.applyRemoteState({ down: true });
    expect(banners.some((b) => b.includes('队友倒下'))).toBe(true);
    banners.length = 0;
    game.applyRemoteState({ down: false });
    expect(banners.some((b) => b.includes('站起来'))).toBe(true);
  });

  it('applyResync：guest 未进局时先缓存，进局后消费', async () => {
    const game = await boot();
    game.applyResync({ wave: 5, sun: 10 });
    expect(game.pendingResync).toBeTruthy();
    expect(game.pendingResync.wave).toBe(5);
    // 空值不缓存
    const before = game.pendingResync;
    game.applyResync(null);
    expect(game.pendingResync).toBe(before);
  });
});

// ── guest 命中限流 / 盾血同步 / 横屏锁定 ──
describe('Game · 命中限流与状态同步', () => {
  it('applyGuestHit 在超频命中时被丢弃', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.netGuest = { pos: { x: 0, y: 1.7, z: 0 }, dead: false, downed: false };
    game.duoSession = { sendEvent: vi.fn() };
    const z = game.zombies.zombies[0] || { netId: 1, def: { damage: 1 }, hit: vi.fn(), alive: true };
    game.zombies.zombies = [];
    expect(() => game.applyGuestHit(null)).not.toThrow();
    void z;
  });

  it('applyPeerState 同步队友盾血；归零会清掉', async () => {
    const game = await boot();
    // applyPeerState 只对 guest（seat 1）生效
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'B' });
    game.wallNuts.hp = game.wallNuts.maxHp;
    // 先收到正数：记下 netShieldHp 并同步盾血
    game.applyPeerState({ g: { sh: Math.round(game.wallNuts.maxHp / 2) } });
    expect(game.netShieldHp).toBeGreaterThan(0);
    expect(game.wallNuts.hp).toBe(game.netShieldHp);
    // 再变 0：判定为碎盾（只有先见过正数才这么判）
    game.applyPeerState({ g: { sh: 0 } });
    expect(game.netShieldHp).toBe(0);
    expect(game.wallNuts.hp).toBe(0);
  });

  it('requestLandscape 在没有 fullscreen API 时也不崩', async () => {
    const game = await boot();
    const root = document.documentElement;
    const saved = root.requestFullscreen;
    try {
      delete root.requestFullscreen;
      expect(() => game.requestLandscape()).not.toThrow();
    } finally {
      if (saved) root.requestFullscreen = saved;
    }
  });
});

// ── applyGuestHit：host 对 guest 命中的完整裁决路径 ──
describe('Game · guest 命中裁决 applyGuestHit', () => {
  async function setup() {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.duoSession = { getZombieAt: () => null, sendEvent: vi.fn() };
    game.netGuest = {
      pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, dead: false, downed: false,
    };
    return game;
  }

  it('各种非法输入直接返回', async () => {
    const game = await setup();
    for (const bad of [null, {}, { w: '不存在的武器' }]) {
      expect(() => game.applyGuestHit(bad)).not.toThrow();
    }
    // 无 guest 代理
    game.netGuest = null;
    expect(() => game.applyGuestHit({ w: 'pea', zid: 1 })).not.toThrow();
  });

  it('找不到僵尸 / 僵尸已死 / 方向为零向量都丢弃', async () => {
    const game = await setup();
    expect(() => game.applyGuestHit({ w: 'pea', zid: 9999, dir: [0, 0, 1] })).not.toThrow();
    game.zombies.zombies = [{ netId: 1, alive: false, dying: false }];
    expect(() => game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, 1] })).not.toThrow();
  });

  it('背对目标的命中被锥形校验拒绝', async () => {
    const game = await setup();
    const hit = vi.fn(() => false);
    game.zombies.zombies = [{
      netId: 1, alive: true, dying: false, hitRadiusScale: 1, scaleFactor: 1,
      chestY: 1.02, headY: 1.52,
      root: { position: { x: 0, y: 0, z: -5 } },
      hit,
    }];
    // 玩家朝 -Z（yaw=0），dir 却朝 +Z：背对，应拒绝
    expect(() => game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, 1] })).not.toThrow();
    expect(hit).not.toHaveBeenCalled();
  });

  it('正面命中会真的扣血（host 权威）', async () => {
    const game = await setup();
    const hit = vi.fn(() => false);
    game.zombies.zombies = [{
      netId: 1, alive: true, dying: false, hitRadiusScale: 1, scaleFactor: 1,
      chestY: 1.02, headY: 1.52,
      root: { position: { x: 0, y: 0, z: -5 } },
      hit,
    }];
    game.map.walls = [];
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1] });
    expect(hit).toHaveBeenCalled();
  });

  it('连续超频命中被限流丢弃', async () => {
    const game = await setup();
    const hit = vi.fn(() => false);
    game.zombies.zombies = [{
      netId: 1, alive: true, dying: false, hitRadiusScale: 1, scaleFactor: 1,
      chestY: 1.02, headY: 1.52,
      root: { position: { x: 0, y: 0, z: -5 } },
      hit,
    }];
    game.map.walls = [];
    // 第一次通过
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1] });
    const first = hit.mock.calls.length;
    // 立刻再来很多次：应被 cooldown 窗口限制
    for (let i = 0; i < 6; i++) game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1] });
    expect(hit.mock.calls.length - first).toBeLessThan(6);
  });
});

describe('Game · clearRemotes 的兜底', () => {
  it('子系统被拆掉后调用 clearRemotes 也不崩', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.zombies = null;
    game.pickups = null;
    game.skySun = null;
    expect(() => game.clearRemotes()).not.toThrow();
    expect(game.remotes.length).toBe(0);
    expect(game.netGuest).toBe(null);
  });

  it('正常情况会复位 skySun 间隔并清空远端', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.skySun.interval = 1;
    game.clearRemotes();
    expect(game.skySun.interval).toBeGreaterThan(1);
  });
});
