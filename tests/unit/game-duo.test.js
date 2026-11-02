import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/entities/RemotePlayer.js', () => ({
  RemotePlayer: class {
    constructor(opts) {
      this.opts = opts;
      this.root = {};
      this.calls = { transform: [], target: [], moving: [], firing: 0, weapon: [], down: [] };
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
    setWeapon(id) {
      this.calls.weapon.push(id);
    }
    setDown(on) {
      this.calls.down.push(on);
    }
  },
}));

// 双人网络层已换成 ClientNet（服务器权威）；测试里用同样的桩
vi.mock('../../src/net/ClientNet.js', () => ({
  ClientNet: class {
    constructor(game) {
      if (globalThis.__duoThrow) throw new Error('boom');
      this.game = game;
      this.started = null;
      this.closed = false;
      ClientNet.last = this;
    }
    start(opts) {
      this.started = opts;
    }
    close() {
      this.closed = true;
    }
  },
  // autoJoinDuo 会动态 import 这个函数来决定是否自动连服务器
  shouldAutoJoin: () => sessionStorage.getItem('pvz-duo-host') === '1' || /[?&]join=/.test(location.search),
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
let ClientNet;
beforeAll(async () => {
  ({ createGame } = await import('../helpers/game.js'));
  ({ ClientNet } = await import('../../src/net/ClientNet.js'));
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
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: true, speed: 4, firing: true, down: true });
    expect(r.calls.firing).toBe(1);
    // 队友倒地要驱动远端模型趴下，救起后站回
    expect(r.calls.down.at(-1)).toBe(true);
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: true, speed: 4, firing: true, down: false });
    expect(r.calls.down.at(-1)).toBe(false);
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: false, speed: 0, firing: false });
    game.applyRemoteState({ x: 3, z: 4, yaw: 1, moving: false, speed: 0, firing: true, w: 'gatling' });
    expect(r.calls.firing).toBe(2);
    expect(r.calls.weapon).toContain('gatling');
    game.applyRemoteState({ x: 'bad', z: 4 });
    expect(r.calls.target).toHaveLength(5);
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

    game.applyGuestInput({ seq: 1, m: [0, 1], look: [0, 0], jump: false, fire: true, shield: true, w: 'cob' });
    game.update(0.05);
    expect(game.netGuest.pos.z).toBeLessThan(spawnZ);
    expect(game.netGuest.shield.active).toBe(true);
    expect(r.calls.transform.length).toBeGreaterThan(0);
    expect(r.calls.firing).toBe(1);
    expect(game.guestWeapon).toBe('cob');
    expect(r.calls.weapon).toContain('cob');

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
    expect(game.weaponId()).toBe('pea');
    game.lastGuestInputAt = Date.now() - 1000;
    game.update(0.05);
    expect(game.netControls.move.x).toBe(0);
    expect(game.netControls.move.y).toBe(0);
    expect(game.netControls.firing).toBe(false);
  });

  it('host 的 syncNetGuest 把代理倒地状态同步给远端模型', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    const r = game.remote;
    game.syncNetGuest();
    expect(r.calls.down.at(-1)).toBe(false);
    game.netGuest.hp = 5;
    game.netGuest.damage(10);
    expect(game.netGuest.downed).toBe(true);
    game.syncNetGuest();
    expect(r.calls.down.at(-1)).toBe(true);
    game.netGuest.revive();
    game.syncNetGuest();
    expect(r.calls.down.at(-1)).toBe(false);
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
    // 新架构：阳光消费上报走 sendSunSpend（服务器权威扣款），不再用 pstate 请求
    game.duoSession = { sendSunSpend: vi.fn() };
    expect(game.spendSun(20)).toBe(true);
    expect(game.sun).toBe(22);
    expect(game.duoSession.sendSunSpend).toHaveBeenCalledWith(20);
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

  it('左上角队友血条：单人隐藏；双人显示并随 netGuest 血量/倒地变化', async () => {
    const solo = await boot();
    solo.start();
    solo.update(0.016);
    expect(document.getElementById('peerHpRow').classList.contains('hidden')).toBe(true);

    const game = await boot();
    const row = document.getElementById('peerHpRow');
    const text = document.getElementById('peerHpText');
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    game.update(0.016);
    expect(row.classList.contains('hidden')).toBe(false);
    expect(text.textContent).toBe(String(Math.ceil(game.netGuest.hp)));

    // host 侧只读代理 Player 的权威血量（回血会在这帧里先走一小步，用 ceil 对齐）
    game.netGuest.hp = 30;
    game.update(0.016);
    expect(text.textContent).toBe(String(Math.ceil(game.netGuest.hp)));
    expect(Number(text.textContent)).toBeGreaterThanOrEqual(30);

    // 队友倒地：数字位写「倒地」
    game.netGuest.hp = 0;
    game.netGuest.downed = true;
    game.update(0.016);
    expect(row.classList.contains('down')).toBe(true);
    expect(text.textContent).toBe('倒地');

    game.endDuo('LEFT');
    expect(row.classList.contains('hidden')).toBe(true);
  });

  it('guest 侧队友血条读 applyRemoteState 的 hp/down', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    game.applyRemoteState({ x: 1, z: 2, hp: 64, down: false });
    expect(game.peerHp).toBe(64);
    game.update(0.016);
    const row = document.getElementById('peerHpRow');
    expect(row.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('peerHpText').textContent).toBe('64');

    // 缺 hp 的包（只有位置）不该把血量打回 0
    game.applyRemoteState({ x: 1, z: 3 });
    expect(game.peerHp).toBe(64);

    game.applyRemoteState({ x: 1, z: 3, hp: 0, down: true });
    game.update(0.016);
    expect(row.classList.contains('down')).toBe(true);
    expect(document.getElementById('peerHpText').textContent).toBe('倒地');

    game.backToMenu();
    expect(row.classList.contains('hidden')).toBe(true);
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
    expect(game.duoSession).toBeInstanceOf(ClientNet);
    expect(game.duoSession.started).toMatchObject({ name: '戴夫', mapId: game.mapId });
    expect(document.getElementById('duoBtn').textContent).toContain('取消');

    await game.toggleDuo();
    expect(game.duoSession).toBeNull();
    expect(ClientNet.last.closed).toBe(true);
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

  it('双人比分完全来自服务器快照（本地不再自己记账）', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '队友 B' });
    // 双人下 onKill 不再改本地分数（否则会和服务器快照打架、HUD 闪烁）
    game.onKill({ type: 'normal', def: {} }, 100, false, 1);
    expect(game.duoStats).toEqual([0, 0]);
    expect(game.duoKills).toEqual([0, 0]);

    // 分数由快照下发
    game.applyServerSnapshot({
      tick: 1, sun: 80, wave: 2, state: 'spawning',
      scores: [50, 100], kills: [1, 1],
      players: [
        { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
        { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
      ],
      zombies: [],
    });
    expect(game.duoStats).toEqual([50, 100]);
    expect(game.stats.score).toBe(50);
    expect(game.stats.kills).toBe(1);

    game.endDuo('WIPE', { scores: [50, 100], kills: [1, 1] });
    expect(game.state).toBe('menu');
    expect(document.getElementById('duoStatus').textContent).toContain('本局得分');
  });

  it('单人击杀仍然本地累加（单人没有服务器）', async () => {
    const game = await boot();
    game.duo = null;
    game.stats.score = 0;
    game.stats.kills = 0;
    game.onKill({ type: 'normal', def: {} }, 100, false, 0);
    expect(game.stats.score).toBe(100);
    expect(game.stats.kills).toBe(1);
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

  it('重连后的世界状态由服务器快照补齐（不再由房主互发 resync）', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    // 服务器快照是唯一的世界真相来源
    game.applyServerSnapshot({
      tick: 99,
      sun: 200,
      wave: 6,
      state: 'intermission',
      scores: [300, 250],
      kills: [9, 7],
      players: [
        { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
        { x: 2, y: 0, z: 8, yaw: 0, pitch: 0, hp: 80, maxHp: 100, downed: false, dead: false, downTimer: 0 },
      ],
      zombies: [],
    });
    expect(game.sun).toBe(200);
    expect(game.zombies.wave).toBe(6);
    expect(game.duoStats).toEqual([300, 250]);
    expect(game.duoKills).toEqual([9, 7]);
  });

  it('空场快照也能安全应用（重连时空世界）', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'A' });
    expect(() =>
      game.applyServerSnapshot({
        tick: 1, sun: 0, wave: 0, state: 'idle', scores: [0, 0], kills: [0, 0],
        players: [
          { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
          { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
        ],
        zombies: [],
      })
    ).not.toThrow();
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
    game.duoSession = { getZombieAt: (id) => {
      const z = game.zombies.zombies.find(z=>z.netId===id);
      return z && z.root ? {id,x:z.root.position.x,y:z.root.position.y,z:z.root.position.z,ys:1} : null;
    }, sendEvent: vi.fn() };
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
    expect(() => game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, 1], seq: 1 })).not.toThrow();
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
    expect(() => game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, 1], seq: 1 })).not.toThrow();
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
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
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
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
    const first = hit.mock.calls.length;
    // 立刻再来很多次：应被 cooldown 窗口限制
    for (let i = 0; i < 6; i++) game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
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

describe('Game · 服务器快照与事件（Netcode v2）', () => {
  it('applyServerSnapshot：队友位置/血量/倒地、阳光、比分、僵尸全部落地', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const before = game.remote.calls.target.length;
    game.applyServerSnapshot({
      tick: 10,
      sun: 123,
      wave: 4,
      state: 'spawning',
      scores: [50, 70],
      kills: [2, 3],
      players: [
        { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 },
        { x: 3, y: 0, z: 5, yaw: 1.2, pitch: 0, hp: 66, maxHp: 100, downed: true, dead: false, downTimer: 5 },
      ],
      zombies: [],
    });
    expect(game.sun).toBe(123);
    expect(game.zombies.wave).toBe(4);
    expect(game.duoStats).toEqual([50, 70]);
    expect(game.duoKills).toEqual([2, 3]);
    expect(game.stats.score).toBe(50);
    expect(game.peerHp).toBe(66);
    expect(game.remoteDown).toBe(true);
    expect(game.remote.calls.target.length).toBeGreaterThan(before);
  });

  it('applyServerSnapshot：非双人时直接返回', async () => {
    const game = await boot();
    game.duo = null;
    expect(() => game.applyServerSnapshot({ players: [] })).not.toThrow();
  });

  it('applyServerEvent：波次/受击/倒地/救援/结算都能处理', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const banners = [];
    game.hud.showBanner = (t) => banners.push(t);
    game.onWaveStart = vi.fn();
    game.finishDuoRound = vi.fn();

    game.applyServerEvent({ t: 'wave', n: 3 });
    expect(game.onWaveStart).toHaveBeenCalledWith(3);

    game.applyServerEvent({ t: 'waveClear', n: 3 });
    game.applyServerEvent({ t: 'shot', seat: 0, hit: true, head: true });
    game.applyServerEvent({ t: 'kill', seat: 0, head: true });
    game.applyServerEvent({ t: 'down', seat: 1 });
    game.applyServerEvent({ t: 'rescue' });
    game.applyServerEvent({ t: 'over', reason: 'WIPE' });
    expect(banners.some((b) => b.includes('队友倒下'))).toBe(true);
    expect(banners.some((b) => b.includes('站起来'))).toBe(true);
    expect(game.finishDuoRound).toHaveBeenCalledWith(expect.anything(), 'WIPE');
  });

  it('applyServerEvent：非双人/空事件安全', async () => {
    const game = await boot();
    game.duo = null;
    expect(() => game.applyServerEvent({ t: 'wave', n: 1 })).not.toThrow();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    expect(() => game.applyServerEvent(null)).not.toThrow();
    expect(() => game.applyServerEvent({ t: 'unknown' })).not.toThrow();
  });

  it('spendSun 在双人时会把自己的扣款上报给服务器', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const sendSunSpend = vi.fn();
    game.duoSession = { sendSunSpend };
    game.sun = 100;
    expect(game.spendSun(30)).toBe(true);
    expect(game.sun).toBe(70);
    expect(sendSunSpend).toHaveBeenCalledWith(30);
    // 余额不足
    expect(game.spendSun(999)).toBe(false);
    expect(game.sun).toBe(70);
    // 0 不扣也不上报
    expect(game.spendSun(0)).toBe(true);
    expect(sendSunSpend).toHaveBeenCalledTimes(1);
  });

  it('双人时开火会通过 onFire 上报（而不是等本地命中）', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    const sendFire = vi.fn();
    game.duoSession = { sendFire };
    // onFire 是 ctx 上的钩子，模拟武器系统扣扳机
    game.ctx.onFire({ id: 'cherry' });
    expect(sendFire).toHaveBeenCalledWith('cherry');
    // 缺 id 时兜底成豌豆
    game.ctx.onFire({});
    expect(sendFire).toHaveBeenCalledWith('pea');
  });
});

describe('Game · 提前开波（新架构）', () => {
  it('单人：applyNextWaveRequest 直接跳过休整', async () => {
    const game = await boot();
    game.state = 'playing';
    game.mapId = 'forest';
    const skip = vi.fn();
    game.zombies.skipIntermission = skip;
    game.requestNextWave = () => skip();
    game.applyNextWaveRequest();
    expect(skip).toHaveBeenCalled();
  });

  it('双人：本地不擅自开波，等服务器快照驱动', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'forest', seat: 0, peerName: 'B' });
    const skip = vi.fn();
    game.zombies.skipIntermission = skip;
    game.applyNextWaveRequest();
    expect(skip).not.toHaveBeenCalled();
  });
});

describe('Game · 相机与镜头震动（覆盖渲染辅助路径）', () => {
  it('applyShake 衰减到 0', async () => {
    const game = await boot();
    game.shake(0.5);
    expect(game.shakeAmp).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) game.applyShake(1 / 60);
    expect(game.shakeAmp).toBe(0);
  });

  it('menuCamera 推进菜单计时', async () => {
    const game = await boot();
    const t0 = game.menuT;
    game.menuCamera(0.5);
    expect(game.menuT).toBeGreaterThan(t0);
  });

  it('updateDeathCam 把镜头放到玩家位置附近', async () => {
    const game = await boot();
    game.deathT = 0;
    game.player.pos.x = 5;
    game.player.pos.z = 7;
    for (let i = 0; i < 90; i++) game.updateDeathCam(1 / 60);
    expect(game.deathT).toBeLessThanOrEqual(1.2);
    expect(Math.abs(game.camera.position.x - game.player.pos.x)).toBeLessThan(0.01);
  });

  it('onExplosion 按距离衰减镜头震动', async () => {
    const game = await boot();
    game.player.pos.x = 0;
    game.player.pos.z = 0;
    game.shakeAmp = 0;
    game.onExplosion({ x: 0, z: 0 }, 5);
    const near = game.shakeAmp;
    game.shakeAmp = 0;
    game.onExplosion({ x: 50, z: 50 }, 5);
    const far = game.shakeAmp;
    expect(near).toBeGreaterThan(far);
  });

  it('onBossSpawn / onBossDead 更新 Boss 血条与横幅', async () => {
    const game = await boot();
    const banners = [];
    game.hud.showBanner = (t) => banners.push(t);
    game.onBossSpawn({ def: { title: '巨人' } });
    expect(banners.some((b) => b.includes('巨人'))).toBe(true);
    game.onBossDead({ def: { title: '巨人' } });
    expect(banners.some((b) => b.includes('倒下'))).toBe(true);
  });

  it('onWaveClear 加分并回血', async () => {
    const game = await boot();
    game.state = 'playing';
    game.stats.score = 0;
    game.player.hp = 50;
    game.onWaveClear(3);
    expect(game.stats.score).toBe(450);
    expect(game.player.hp).toBeGreaterThan(50);
  });

  it('onZombieAttack 按 targetSeat 落到对应玩家', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.state = 'playing';
    const hp0 = game.player.hp;
    game.onZombieAttack({ def: { damage: 10 }, targetSeat: 0 });
    expect(game.player.hp).toBeLessThan(hp0);
  });
});

describe('Game · applyGuestHit 的剩余裁决分支', () => {
  async function setup() {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.duoSession = {
      getZombieAt: (id) => {
        const z = game.zombies.zombies.find((x) => x.netId === id);
        return z && z.root ? { id, x: z.root.position.x, y: z.root.position.y, z: z.root.position.z, ys: 1, ab: z.airborne ? 1 : 0 } : null;
      },
      sendEvent: vi.fn(),
    };
    game.netGuest = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, dead: false, downed: false };
    return game;
  }
  function fakeZ(over = {}) {
    return {
      netId: 1, alive: true, dying: false, hitRadiusScale: 1, scaleFactor: 1,
      chestY: 1.02, headY: 1.52, airborne: false,
      root: { position: { x: 0, y: 0, z: -5 } },
      hit: vi.fn(() => false),
      ...over,
    };
  }

  it('中间有墙挡住时判定不通过', async () => {
    const game = await setup();
    const z = fakeZ();
    game.zombies.zombies = [z];
    // 在玩家与僵尸之间放一面墙（OBB 字段必须齐全）
    game.map.walls = [{ x: 0, y: 1.5, z: -2.5, hx: 10, hy: 1.5, hz: 0.2, c: 1, s: 0 }];
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
    expect(z.hit).not.toHaveBeenCalled();
  });

  it('空中单位：地面平射打不到（对空白名单生效）', async () => {
    const game = await setup();
    // 气球浮在 2.2 米高，玩家在地面平射 —— 垂直差不够，豌豆应被对空规则拒绝
    const z = fakeZ({ airborne: true, root: { position: { x: 0, y: 2.2, z: -3 } } });
    game.zombies.zombies = [z];
    game.map.walls = [];
    game.guestHit.clear();
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
    expect(z.hit).not.toHaveBeenCalled();
  });

  it('击杀时调用 handleKill 结算', async () => {
    const game = await setup();
    const z = fakeZ({ hit: vi.fn(() => true) });
    game.zombies.zombies = [z];
    game.map.walls = [];
    game.guestHit.clear();
    const kill = vi.spyOn(game.zombies, 'handleKill').mockImplementation(() => {});
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
    expect(kill).toHaveBeenCalledWith(z, expect.any(Boolean));
    kill.mockRestore();
  });

  it('seq 非法或快照里没有这只僵尸时丢弃', async () => {
    const game = await setup();
    const z = fakeZ();
    game.zombies.zombies = [z];
    game.map.walls = [];
    game.duoSession.getZombieAt = () => null;
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1 });
    expect(z.hit).not.toHaveBeenCalled();
    // seq 非正整数
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 0 });
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: -3 });
    game.applyGuestHit({ w: 'pea', zid: 1, dir: [0, 0, -1], seq: 1.5 });
    expect(z.hit).not.toHaveBeenCalled();
  });
});

describe('Game · applyResync 的完整还原路径', () => {
  it('未进局/非客人时先缓存，不立即应用', async () => {
    const game = await boot();
    game.applyResync({ wave: 3 });
    expect(game.pendingResync).toEqual({ wave: 3 });
    // 房主（seat 0）也不直接应用
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.applyResync({ wave: 5 });
    expect(game.pendingResync).toEqual({ wave: 5 });
  });

  it('客人状态下逐项还原：波次/阳光/比分/击杀/僵尸/补给/阳光球/Boss', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'A' });
    const setWave = vi.spyOn(game.hud, 'setWave');
    const setBossVisible = vi.spyOn(game.hud, 'setBossVisible');
    const setBossHp = vi.spyOn(game.hud, 'setBossHp');
    const netSpawn = vi.spyOn(game.zombies, 'netSpawn');
    const applyNetList = vi.spyOn(game.pickups, 'applyNetList').mockImplementation(() => {});
    const applyNet = vi.spyOn(game.sunOrbs, 'applyNet').mockImplementation(() => {});

    game.applyResync({
      wave: 7,
      sun: 145,
      scores: [120, 340],
      kills: [3, 8],
      z: [{ id: 11, t: 'normal', x: 0, y: 0, z: -5, yaw: 0, hp: 90, st: 0, sl: 0 }],
      pickups: [{ id: 1, i: 2, x: 1, z: 2 }],
      orbs: [{ id: 5, x: 0, y: 0.5, z: 0, s: 0 }],
      bossHp: 0.6,
    });

    expect(game.pendingResync).toBeNull();
    expect(game.zombies.wave).toBe(7);
    expect(game.stats.wave).toBe(7);
    expect(setWave).toHaveBeenCalledWith(7);
    expect(game.sun).toBe(145);
    expect(game.duoStats).toEqual([120, 340]);
    expect(game.stats.score).toBe(340); // seat 1 看自己的分
    expect(game.duoKills).toEqual([3, 8]);
    expect(game.stats.kills).toBe(8);
    expect(netSpawn).toHaveBeenCalled();
    expect(applyNetList).toHaveBeenCalled();
    expect(applyNet).toHaveBeenCalled();
    expect(setBossVisible).toHaveBeenCalledWith(true);
    expect(setBossHp).toHaveBeenCalledWith(0.6);
  });

  it('bossHp 为 0 时不点亮 Boss 血条', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'A' });
    const setBossVisible = vi.spyOn(game.hud, 'setBossVisible');
    game.applyResync({ bossHp: 0 });
    expect(setBossVisible).not.toHaveBeenCalledWith(true);
  });

  it('空对象/null 都安全', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'A' });
    expect(() => game.applyResync(null)).not.toThrow();
    expect(() => game.applyResync({})).not.toThrow();
  });
});

describe('Game · applyGuestAoe 范围伤害裁决', () => {
  async function setup() {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: 'B' });
    game.duoSession = { sendEvent: vi.fn() };
    game.netGuest = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, dead: false, downed: false };
    return game;
  }

  it('合法爆炸请求触发范围伤害', async () => {
    const game = await setup();
    const area = vi.spyOn(game.zombies, 'damageArea').mockImplementation(() => 0);
    game.guestHit.clear();
    game.applyGuestAoe({ w: 'cherry', x: 3, y: 0, z: -4 });
    expect(area).toHaveBeenCalled();
    const [center, radius, damage] = area.mock.calls[0];
    expect(center.z).toBe(-4);
    expect(radius).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(0);
    area.mockRestore();
  });

  it('非法输入被丢弃', async () => {
    const game = await setup();
    const area = vi.spyOn(game.zombies, 'damageArea').mockImplementation(() => 0);
    game.guestHit.clear();
    game.applyGuestAoe(null);
    game.applyGuestAoe({ w: '不存在的武器', x: 0, y: 0, z: 0 });
    game.applyGuestAoe({ w: 'pea', x: 0, y: 0, z: 0 }); // 豌豆没有 radius
    game.applyGuestAoe({ w: 'cherry', x: NaN, y: 0, z: 0 });
    expect(area).not.toHaveBeenCalled();
    area.mockRestore();
  });

  it('冷却内重复请求被限流', async () => {
    const game = await setup();
    const area = vi.spyOn(game.zombies, 'damageArea').mockImplementation(() => 0);
    game.guestHit.clear();
    game.applyGuestAoe({ w: 'cherry', x: 0, y: 0, z: -4 });
    game.applyGuestAoe({ w: 'cherry', x: 0, y: 0, z: -4 });
    expect(area).toHaveBeenCalledTimes(1);
    area.mockRestore();
  });

  it('非房主（seat 1）不处理 guest 的 aoe 请求', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: 'A' });
    const area = vi.spyOn(game.zombies, 'damageArea').mockImplementation(() => 0);
    game.applyGuestAoe({ w: 'cherry', x: 0, y: 0, z: -4 });
    expect(area).not.toHaveBeenCalled();
    area.mockRestore();
  });
});

describe('Game · autoJoinDuo 自动进双人', () => {
  it('房主标记存在时自动调用 toggleDuo', async () => {
    const game = await boot();
    const toggle = vi.spyOn(game, 'toggleDuo').mockResolvedValue();
    try {
      // 房主刷新：地址栏可能没有 join，靠 sessionStorage 标记识别
      sessionStorage.setItem('pvz-duo-host', '1');
      const joined = await game.autoJoinDuo();
      expect(joined).toBe(true);
      expect(toggle).toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem('pvz-duo-host');
    }
    toggle.mockRestore();
  });

  it('没有 join 参数且没有房主标记时不自动加入（单人路径）', async () => {
    const game = await boot();
    const toggle = vi.spyOn(game, 'toggleDuo').mockResolvedValue();
    const orig = globalThis.location;
    try {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
      sessionStorage.removeItem('pvz-duo-host');
      expect(await game.autoJoinDuo()).toBe(false);
      expect(toggle).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: orig });
    }
    toggle.mockRestore();
  });

  it('非菜单态/已在会话中/正在连接时直接返回 false', async () => {
    const game = await boot();
    game.state = 'playing';
    expect(await game.autoJoinDuo()).toBe(false);
    game.state = 'menu';
    game.duoSession = {};
    expect(await game.autoJoinDuo()).toBe(false);
    game.duoSession = null;
    game.duoPending = true;
    expect(await game.autoJoinDuo()).toBe(false);
  });

  it('toggleDuo 在 pending 时不重复连接', async () => {
    const game = await boot();
    game.duoPending = true;
    await game.toggleDuo();
    expect(game.duoSession).toBeFalsy();
  });
});
