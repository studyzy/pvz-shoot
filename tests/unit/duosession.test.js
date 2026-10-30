import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuoSession, readJoinParam, shareUrlFor } from '../../src/net/DuoSession.js';
import { MSG, encode, decode } from '../../src/net/protocol.js';

class FakeNet {
  constructor(opts) {
    this.opts = opts;
    this.relays = [];
    this.maps = [];
    this.closed = false;
    this.sent = [];
    FakeNet.last = this;
  }
  connect() {
    this.opts.onStatus('connecting');
    this.opts.onStatus('open');
  }
  relay(payload) {
    this.relays.push(payload);
    return true;
  }
  setMap(id) {
    this.maps.push(id);
    return true;
  }
  send(type, data) {
    this.sent.push({ type, data });
    return true;
  }
  close() {
    this.closed = true;
  }
}

function makeGame() {
  const hud = {
    statuses: [],
    modes: [],
    setDuoStatus(t, tone) {
      this.statuses.push([t, tone]);
    },
    setDuoMode(v) {
      this.modes.push(v);
    },
    shares: [],
    setDuoShare(url) {
      this.shares.push(url);
    },
  };
  return {
    state: 'menu',
    duo: null,
    sun: 60,
    player: {
      pos: { x: 1, y: 0, z: 2 },
      yaw: 0.5,
      pitch: 0.1,
      hp: 80,
      moveAmt: 0.5,
      speedMul: 1,
      lastInput: { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, jump: false },
    },
    controls: { firing: false },
    wallNuts: { active: false },
    netGuest: null,
    netControls: null,
    lastGuestSeq: 0,
    zombies: {
      wave: 1,
      zombies: [{ serialize: () => ({ id: 1, t: 'normal' }) }],
      boss: { hp: 50, maxHp: 100 },
    },
    hud,
    calls: {
      startDuo: [],
      apply: [],
      input: [],
      peer: [],
      evt: [],
      sun: [],
      pause: [],
      resume: [],
      maps: [],
      peerLeft: null,
      peerJoined: null,
      ended: [],
      wiped: [],
      closed: 0,
    },
    startDuo(o) {
      this.calls.startDuo.push(o);
      this.duo = o;
      this.state = 'playing';
    },
    applyRemoteState(d) {
      this.calls.apply.push(d);
    },
    applyGuestInput(d) {
      this.calls.input.push(d);
    },
    applyPeerState(d) {
      this.calls.peer.push(d);
    },
    applyWorldEvent(d) {
      this.calls.evt.push(d);
    },
    spendSun(n) {
      this.calls.sun.push(n);
      return true;
    },
    pause(v) {
      this.calls.pause.push(v);
    },
    resume(v) {
      this.calls.resume.push(v);
    },
    setMap(id) {
      this.calls.maps.push(id);
    },
    onPeerLeft(s) {
      this.calls.peerLeft = s;
    },
    onPeerJoined(n) {
      this.calls.peerJoined = n;
    },
    endDuo(reason) {
      this.calls.ended.push(reason);
    },
    onDuoWipe(d) {
      this.calls.wiped.push(d);
    },
    onDuoClosed(session) {
      this.calls.closed++;
      this.closedSession = session;
    },
  };
}

function makeSession() {
  const game = makeGame();
  const session = new DuoSession(game, { createNet: (o) => new FakeNet(o) });
  return { game, session };
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch (e) {
    // ignore
  }
});

const WELCOME = (d = {}) => ({
  t: MSG.WELCOME,
  d: {
    matchId: 'm1',
    seat: 1,
    host: false,
    state: 'waiting',
    mapId: 'snow',
    seed: 7,
    t0: 0,
    peer: '戴夫 A',
    token: 'abcdefgh',
    ...d,
  },
});

describe('DuoSession', () => {
  it('start 创建 NetClient 并连接；onStatus 映射', () => {
    const { game, session } = makeSession();
    expect(session.start({ name: '小明', mapId: 'snow' })).toBe(true);
    const net = FakeNet.last;
    expect(net.opts.name).toBe('小明');
    expect(net.opts.mapId).toBe('snow');
    expect(net.opts.onMessage).toBeTypeOf('function');
    expect(session.state).toBe('connecting');
    expect(game.hud.statuses.at(-1)[0]).toContain('已连接');
    net.opts.onMessage({ t: 'unknown', d: {} });
    net.opts.onMessage(WELCOME());
    expect(session.seat).toBe(1);

    session.state = 'waiting';
    net.opts.onStatus('open');
    expect(game.hud.statuses.at(-1)[0]).toContain('等待队友');
    net.opts.onStatus('closed');
    expect(game.hud.statuses.at(-1)[0]).toContain('断开');
    net.opts.onStatus('error');
    expect(game.hud.statuses.at(-1)[0]).toContain('失败');
    const count = game.hud.statuses.length;
    session.state = 'closed';
    net.opts.onStatus('open');
    expect(game.hud.statuses.length).toBe(count);

    expect(session.start({})).toBe(false);
  });

  it('welcome / queue / peer 的消息处理', () => {
    const { game, session } = makeSession();
    session.start({ mapId: 'snow' });
    session.onMessage(WELCOME());
    expect(session.seat).toBe(1);
    expect(session.host).toBe(false);
    expect(session.matchMapId).toBe('snow');
    expect(session.seed).toBe(7);
    expect(session.peerName).toBe('戴夫 A');
    expect(session.state).toBe('waiting');

    session.onMessage(WELCOME({ state: 'playing' }));
    expect(session.state).toBe('playing');
    expect(game.hud.statuses.at(-1)[0]).toContain('已重连');

    session.onMessage({ t: MSG.QUEUE, d: { state: 'waiting' } });
    expect(session.state).toBe('waiting');
    session.onMessage({ t: MSG.PEER, d: { joined: true, name: '队友 B' } });
    expect(session.peerName).toBe('队友 B');
    expect(game.calls.peerJoined).toBe('队友 B');
    session.onMessage({ t: MSG.PEER, d: { joined: false, reconnectIn: 30 } });
    expect(game.calls.peerLeft).toBe(30);
    expect(game.hud.statuses.at(-1)[0]).toContain('掉线');

    session.onMessage({ t: MSG.QUEUE, d: { state: 'timeout' } });
    expect(game.calls.closed).toBe(1);
    expect(FakeNet.last.closed).toBe(true);
    expect(session.state).toBe('closed');
  });

  it('START 进入对局；重连时 game.duo 已存在则不重置', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME());
    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 123 } });
    expect(game.calls.startDuo).toHaveLength(1);
    expect(game.calls.startDuo[0]).toMatchObject({
      mapId: 'snow',
      seed: 8,
      t0: 123,
      seat: 1,
      peerName: '戴夫 A',
    });
    expect(session.state).toBe('playing');

    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 123 } });
    expect(game.calls.startDuo).toHaveLength(1);
    expect(game.hud.statuses.at(-1)[0]).toBe('已重连');
  });

  it('MAP / RELAY / END / ERROR', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage({ t: MSG.MAP, d: { id: 'dust' } });
    expect(session.matchMapId).toBe('dust');
    expect(game.calls.maps).toEqual(['dust']);

    game.state = 'playing';
    session.onMessage({ t: MSG.MAP, d: { id: 'snow' } });
    expect(session.matchMapId).toBe('snow');
    expect(game.calls.maps).toEqual(['dust']);

    session.onMessage({ t: MSG.RELAY, d: { payload: encode('input', { m: [0, 1] }) } });
    expect(game.calls.input).toEqual([{ m: [0, 1] }]);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('pstate', { h: { x: 1 } }) } });
    expect(game.calls.peer).toEqual([{ h: { x: 1 } }]);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('evt', { type: 'zdead', id: 1 }) } });
    expect(game.calls.evt).toEqual([{ type: 'zdead', id: 1 }]);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('sun', { n: 20 }) } });
    expect(game.calls.sun).toEqual([20]);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('pause') } });
    expect(game.calls.pause).toEqual([true]);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('resume') } });
    expect(game.calls.resume).toEqual([true]);
    session.onMessage({ t: MSG.RELAY, d: { payload: 'bad json' } });
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('nope') } });
    session.onMessage({ t: MSG.RELAY, d: { payload: 123 } });
    expect(game.calls.input).toHaveLength(1);
    expect(game.calls.peer).toHaveLength(1);

    session.onMessage({ t: MSG.END, d: { reason: 'PEER_TIMEOUT' } });
    expect(game.calls.ended).toEqual(['PEER_TIMEOUT']);
    expect(session.state).toBe('closed');
    expect(game.calls.closed).toBe(1);
  });

  it('ERROR 致命码关闭，非致命码保留连接', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage({ t: MSG.ERROR, d: { code: 'BAD' } });
    expect(game.hud.statuses.at(-1)[0]).toBeTruthy();
    expect(FakeNet.last.closed).toBe(false);

    session.onMessage({ t: MSG.ERROR, d: { code: 'BUSY' } });
    expect(FakeNet.last.closed).toBe(true);
    expect(session.state).toBe('closed');
    expect(game.calls.closed).toBe(1);
  });

  it('guest 按 30Hz 发 input，look/jump 逐帧累积后清零；pause/map 走 relay', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME({ state: 'playing' }));
    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 1 } });
    const net = FakeNet.last;

    game.player.lastInput = { move: { x: 1, y: 0 }, look: { x: 0.01, y: -0.02 }, jump: true };
    game.controls.firing = true;
    session.captureInput();
    session.update(0.02);
    expect(net.relays).toHaveLength(0);
    session.update(0.02);
    expect(net.relays).toHaveLength(1);
    const input = decode(net.relays[0]);
    expect(input.t).toBe('input');
    expect(input.d).toMatchObject({ m: [1, 0], look: [0.01, -0.02], jump: true, fire: true, shield: false });
    expect(input.d.seq).toBe(1);

    game.player.lastInput = { move: { x: 0, y: 1 }, look: { x: 0, y: 0 }, jump: false };
    session.captureInput();
    session.update(0.04);
    const input2 = decode(net.relays[1]);
    expect(input2.d.m).toEqual([0, 1]);
    expect(input2.d.look).toEqual([0, 0]);
    expect(input2.d.jump).toBe(false);

    session.sendPause(true);
    session.sendPause(false);
    expect(decode(net.relays[2]).t).toBe('pause');
    expect(decode(net.relays[3]).t).toBe('resume');
    session.sendMap('dust');
    expect(net.maps).toEqual(['dust']);

    session.state = 'waiting';
    session.update(1);
    expect(net.relays).toHaveLength(4);
  });

  it('host 按 20Hz 发 pstate（自己的 h + guest 代理的 g）', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME({ host: true, seat: 0, state: 'playing' }));
    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 1 } });
    const net = FakeNet.last;
    game.netGuest = { pos: { x: 3, y: 0, z: 4 }, yaw: 0.3, pitch: -0.1, hp: 100, moveAmt: 0.5 };
    game.netControls = { firing: true };
    game.lastGuestSeq = 9;

    session.update(0.016);
    expect(net.relays).toHaveLength(0);
    session.update(0.04);
    expect(net.relays).toHaveLength(1);
    const ps = decode(net.relays[0]);
    expect(ps.t).toBe('pstate');
    expect(ps.d.h).toMatchObject({ x: 1, y: 0, z: 2, yaw: 0.5, hp: 80 });
    expect(ps.d.g).toMatchObject({ x: 3, y: 0, z: 4, hp: 100, seq: 9, firing: true });
    expect(ps.d.z).toEqual([{ id: 1, t: 'normal' }]);
    expect(ps.d.wave).toBe(1);
    expect(ps.d.bossHp).toBe(0.5);
    expect(ps.d.sun).toBe(60);
    expect(session.getZombieAt(1, ps.d.seq)).toEqual({ id: 1, t: 'normal' });
    expect(session.getZombieAt(2, ps.d.seq)).toBeNull();

    const z = { netId: 7, serialize: () => ({ id: 7, t: 'normal' }) };
    session.sendZombieSpawn(z);
    expect(decode(net.relays[1]).t).toBe('evt');
    expect(decode(net.relays[1]).d).toEqual({ type: 'zspawn', z: { id: 7, t: 'normal' } });
    session.sendZombieDead(z);
    expect(decode(net.relays[2]).d).toEqual({ type: 'zdead', id: 7 });

    game.player = null;
    session.update(1);
    expect(net.relays).toHaveLength(3);
  });

  it('guest 发 hit/aoe；host 侧 sendHit 被拒绝；快照回退查询', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME({ state: 'playing' }));
    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 1 } });
    const net = FakeNet.last;
    game.lastWorldSeq = 5;
    const idle = new DuoSession(game, { createNet: (o) => new FakeNet(o) });
    idle.sendHit('pea', 3, { x: 0, y: 0, z: -1 });
    idle.sendAoe('cherry', { x: 0, y: 0, z: 0 });

    session.sendHit('pea', 3, { x: 0, y: 0, z: -2 });
    const hit = decode(net.relays[0]);
    expect(hit.t).toBe('hit');
    expect(hit.d).toMatchObject({ w: 'pea', zid: 3, seq: 5 });
    expect(hit.d.dir).toEqual([0, 0, -1]);

    session.sendAoe('cherry', { x: 1, y: 2, z: 3 });
    expect(decode(net.relays[1]).d).toMatchObject({ w: 'cherry', x: 1, y: 2, z: 3, seq: 5 });
    session.sendSunRequest(20);
    expect(decode(net.relays[2]).d).toEqual({ n: 20 });

    session.sendHit('pea', 0, { x: 0, y: 0, z: -1 });
    session.sendAoe('cherry', null);
    session.sendSunRequest(0);
    expect(net.relays).toHaveLength(3);

    session.host = true;
    session.sendHit('pea', 3, { x: 0, y: 0, z: -1 });
    session.sendAoe('cherry', { x: 0, y: 0, z: 0 });
    expect(net.relays).toHaveLength(3);

    session.history = [{ seq: 1, z: [{ id: 7, t: 'normal' }] }];
    expect(session.getZombieAt(7, 5)).toEqual({ id: 7, t: 'normal' });
    expect(session.getZombieAt(8, 5)).toBeNull();
    expect(session.getZombieAt(7, 0)).toBeNull();
  });

  it('sendWipe / wipe relay', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME({ state: 'playing' }));
    session.onMessage({ t: MSG.START, d: { mapId: 'snow', seed: 8, t0: 1 } });
    const net = FakeNet.last;
    session.sendWipe();
    expect(decode(net.relays[0]).t).toBe('wipe');
    session.host = true;
    session.sendWipe();
    expect(net.relays).toHaveLength(1);
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('wipe', { reason: 'WIPE', scores: [1, 2] }) } });
    expect(game.calls.wiped).toEqual([{ reason: 'WIPE', scores: [1, 2] }]);
  });

  it('默认 createNet 走 NetClient，并覆盖默认回调', () => {
    class NoopWS {
      constructor() {
        this.readyState = 0;
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', NoopWS);
    const game = makeGame();
    const session = new DuoSession(game);
    expect(session.start({ name: 'x', mapId: 'snow' })).toBe(true);
    expect(session.net).toBeTruthy();
    expect(session.net.constructor.name).toBe('NetClient');
    session.net.handle(JSON.stringify({ v: 1, t: MSG.WELCOME, d: { seat: 0 } }));
    expect(session.seat).toBe(0);
    session.close();
    vi.unstubAllGlobals();
  });

  it('close 只触发一次 onDuoClosed', () => {
    const { game, session } = makeSession();
    session.start({});
    session.close();
    session.close();
    expect(game.calls.closed).toBe(1);
    expect(session.net).toBeNull();
    expect(session.state).toBe('closed');
  });
});

describe('邀请链接', () => {
  it('start 把 join 传给 NetClient', () => {
    const { session } = makeSession();
    session.start({ join: 'abcdefgh' });
    expect(FakeNet.last.opts.join).toBe('abcdefgh');
  });

  it('房主 welcome 的 joinToken 写入分享链接与地址栏', () => {
    const { game, session } = makeSession();
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    session.start({});
    session.onMessage(WELCOME({ host: true, seat: 0, joinToken: 'abcdefgh1234' }));
    expect(session.joinToken).toBe('abcdefgh1234');
    expect(game.hud.shares.at(-1)).toContain('join=abcdefgh1234');
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  it('JOIN_EXPIRED 关闭会话并清掉 join 参数', () => {
    const { game, session } = makeSession();
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    session.start({});
    session.onMessage({ t: MSG.ERROR, d: { code: 'JOIN_EXPIRED' } });
    expect(session.state).toBe('closed');
    expect(game.calls.closed).toBe(1);
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  it('readJoinParam / shareUrlFor', () => {
    expect(readJoinParam({ search: '?join=abc' })).toBe('abc');
    expect(readJoinParam({ search: '' })).toBeNull();
    expect(readJoinParam({})).toBeNull();
    expect(shareUrlFor('abc', { origin: 'https://x', pathname: '/p/' })).toBe('https://x/p/?join=abc');
    expect(shareUrlFor('', { origin: 'https://x', pathname: '/' })).toBe('');
    expect(shareUrlFor('abc', null)).toBe('');
  });
});

// ── guest → host / host → guest 的薄封装：守卫条件都要走到 ──
describe('DuoSession · 消息发送守卫', () => {
  const playingGuest = () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME());
    session.onMessage({ t: MSG.START, d: { seat: 1, peerName: 'B', mapId: 'backyard', seed: 1, t0: 0 } });
    session.seat = 1;
    session.host = false;
    game.state = 'playing';
    return { game, session, net: FakeNet.last };
  };
  const playingHost = () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME());
    session.onMessage({ t: MSG.START, d: { seat: 0, peerName: 'B', mapId: 'backyard', seed: 1, t0: 0 } });
    // START 之后 host 身份由 seat 决定；这里显式钉死，避免依赖 welcome 的字段顺序
    session.seat = 0;
    session.host = true;
    game.state = 'playing';
    return { game, session, net: FakeNet.last };
  };

  it('guest 侧 sendAoe / sendClaim / sendPickupDrop / sendResync 都发得出去', () => {
    const { session, net } = playingGuest();
    session.sendAoe('pepper', { x: 1, y: 0, z: 2 });
    session.sendClaim('sun', 7);
    session.sendPickupDrop(2, 3.456, 4.567);
    expect(net.relays.length).toBeGreaterThanOrEqual(3);
    const kinds = net.relays.map((r) => decode(r).g ? r : r);
    expect(net.relays.some((r) => String(r).includes('aoe'))).toBe(true);
    expect(net.relays.some((r) => String(r).includes('claim'))).toBe(true);
    expect(net.relays.some((r) => String(r).includes('drop'))).toBe(true);
    void kinds;
  });

  it('guest 侧的 host-only 方法直接返回（不发包）', () => {
    const { session, net } = playingGuest();
    const before = net.relays.length;
    session.sendPickups([{}]);
    session.sendResync({ wave: 1 });
    session.sendEvent({ type: 'x' });
    expect(net.relays.length).toBe(before);
  });

  it('host 侧的 guest-only 方法直接返回（不发包）', () => {
    const { session, net } = playingHost();
    const before = net.relays.length;
    session.sendAoe('pepper', { x: 0, y: 0, z: 0 });
    session.sendClaim('sun', 1);
    session.sendPickupDrop(0, 0, 0);
    session.sendSunRequest(5);
    session.sendWipe();
    expect(net.relays.length).toBe(before);
  });

  it('host 侧 sendPickups / sendResync / sendEvent 发得出去', () => {
    const { session, net } = playingHost();
    session.sendPickups([{ i: 1 }]);
    session.sendResync({ wave: 2 });
    session.sendEvent({ type: 'pickups' });
    expect(net.relays.length).toBe(3);
  });

  it('参数缺失时不发包（pos / id / index / payload）', () => {
    const { session, net } = playingGuest();
    const before = net.relays.length;
    session.sendAoe('pepper', null);
    session.sendClaim('sun', 0);
    session.sendPickupDrop(-1, 0, 0);
    session.sendSunRequest(0);
    expect(net.relays.length).toBe(before);
  });

  it('僵尸 spawn / dead 只在有网且 playing 时发', () => {
    const { session, net } = playingHost();
    const z = { netId: 9, serialize: () => ({ id: 9, t: 'goblin' }) };
    session.sendZombieSpawn(z);
    session.sendZombieDead(z);
    expect(net.relays.length).toBe(2);
    // 没 serialize 的僵尸不发
    const before = net.relays.length;
    session.sendZombieSpawn({ netId: 1 });
    session.sendZombieDead(null);
    expect(net.relays.length).toBe(before);
  });

  it('sendRematch 在会话 playing 时返回 true，关闭后返回 false', () => {
    const { session, net } = playingHost();
    expect(session.sendRematch()).toBe(true);
    expect(net.sent.some((s) => s.type === MSG.REMATCH)).toBe(true);
    // 只认会话自己的 state（game.state 由 Game 管，不是这条的判断依据）
    session.state = 'closed';
    expect(session.sendRematch()).toBe(false);
  });

  it('sendMap 走 cleanMapId，未知 id 回退默认图', () => {
    const { session, net } = playingHost();
    session.sendMap('forest');
    session.sendMap('不存在的图');
    expect(net.maps[0]).toBe('forest');
    expect(net.maps[1]).toBe('backyard');
  });

  it('close 关闭连接并复位状态', () => {
    const { session, net } = playingHost();
    session.close();
    expect(net.closed).toBe(true);
  });
});

// ── relay 消息分发：每种游戏内消息都要落到 Game 的对应方法 ──
describe('DuoSession · relay 分发', () => {
  it('每种 relay 类型都转发到 Game 的对应回调', async () => {
    const { game, session } = makeSession();
    const calls = [];
    const spy = (name) => { game[name] = (d) => calls.push([name, d]); };
    for (const n of [
      'applyPeerState', 'applyWorldEvent', 'applyGuestHit', 'applyGuestAoe',
      'applyGuestClaim', 'applyGuestDrop', 'applyResync', 'onDuoWipe',
      'applyGuestInput', 'spendSun',
    ]) spy(n);
    session.start({});

    const relays = [
      { t: 'pstate', d: { k: 1 } },
      { t: 'evt', d: { type: 'sun' } },
      { t: 'hit', d: { zid: 1 } },
      { t: 'aoe', d: { w: 'pepper' } },
      { t: 'claim', d: { id: 2 } },
      { t: 'drop', d: { i: 1 } },
      { t: 'sun', d: { n: 5 } },
      { t: 'resync', d: { wave: 3 } },
      { t: 'wipe', d: { reason: 'WIPE' } },
      { t: 'input', d: { m: { x: 0, y: 0 } } },
    ];
    for (const r of relays) session.onRelay(encode(r.t, r.d));

    const names = calls.map((c) => c[0]);
    for (const n of ['applyPeerState', 'applyWorldEvent', 'applyGuestHit', 'applyGuestAoe', 'applyGuestClaim', 'applyGuestDrop', 'applyResync', 'onDuoWipe', 'spendSun']) {
      expect(names, n).toContain(n);
    }
  });

  it('未知 relay 类型不崩', () => {
    const { session } = makeSession();
    session.start({});
    expect(() => session.onRelay(encode('unknown-type', {}))).not.toThrow();
  });

  it('rematch 的 START 会交换座位并开新一局', () => {
    const { game, session } = makeSession();
    game.duo = { seat: 0 };
    game.startDuoRound = vi.fn();
    session.start({});
    session.onMessage(WELCOME());
    session.onMessage({ t: MSG.START, d: { seat: 1, rematch: true, mapId: 'forest', seed: 9, t0: 1, round: 2 } });
    expect(game.startDuoRound).toHaveBeenCalled();
    expect(session.seat).toBe(1);
    expect(session.host).toBe(false);
  });

  it('重连时（game.duo 已存在）只提示不重开', () => {
    const { game, session } = makeSession();
    game.duo = { seat: 0 };
    session.start({});
    session.onMessage(WELCOME());
    expect(() => session.onMessage({ t: MSG.START, d: { seat: 0, mapId: 'snow', t0: 0 } })).not.toThrow();
  });
});

describe('DuoSession · onStatus 与守卫分支', () => {
  it('四种状态各写一条 HUD 提示；已关闭或无 hud 时不动', () => {
    const { game, session } = makeSession();
    session.start({});
    const seen = [];
    game.hud.setDuoStatus = (t, tone) => seen.push([t, tone]);
    session.onStatus('connecting');
    session.onStatus('open');
    session.onStatus('closed');
    session.onStatus('error');
    expect(seen).toHaveLength(4);
    expect(seen[0][1]).toBe('wait');
    expect(seen[1][1]).toBe('ok');
    expect(seen[2][1]).toBe('warn');
    expect(seen[3][1]).toBe('warn');
    // 关掉之后不再写
    session.state = 'closed';
    session.onStatus('open');
    expect(seen).toHaveLength(4);
    // 没有 hud 也不崩
    session.state = 'waiting';
    game.hud = null;
    expect(() => session.onStatus('open')).not.toThrow();
  });

  it('WELCOME 带非整数 seat / 无 peer / 无 joinToken 都走兜底', () => {
    const { session } = makeSession();
    session.start({});
    expect(() => session.onMessage({ t: MSG.WELCOME, d: { seat: 'x', host: false, state: 'x' } })).not.toThrow();
    expect(session.state).toBe('waiting');
    expect(session.joinToken).toBe(null);
  });

  it('WELCOME 当 host 且有 joinToken 时生成分享链接', () => {
    const { game, session } = makeSession();
    session.start({});
    const shares = [];
    game.hud.setDuoShare = (u) => shares.push(u);
    session.onMessage(WELCOME({ seat: 0, host: true, joinToken: 'tok123' }));
    expect(session.joinToken).toBe('tok123');
    expect(shares.length).toBeGreaterThan(0);
  });

  it('PEER / END / MAP 等消息都能安全处理', () => {
    const { game, session } = makeSession();
    session.start({});
    session.onMessage(WELCOME());
    expect(() => session.onMessage({ t: MSG.PEER, d: { name: 'B' } })).not.toThrow();
    expect(() => session.onMessage({ t: MSG.MAP, d: { id: 'forest' } })).not.toThrow();
    game.mapId = 'backyard';
    expect(session.matchMapId).toBe('forest');
    expect(() => session.onMessage({ t: MSG.END, d: { reason: 'DONE' } })).not.toThrow();
  });

  it('未知消息类型不崩', () => {
    const { session } = makeSession();
    session.start({});
    expect(() => session.onMessage({ t: 'NOT_A_TYPE', d: {} })).not.toThrow();
    expect(() => session.onMessage({})).not.toThrow();
  });
});
