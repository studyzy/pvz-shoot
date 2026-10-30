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
