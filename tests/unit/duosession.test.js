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
    session.onMessage({ t: MSG.RELAY, d: { payload: encode('wipe', { reason: 'WIPE' }) } });
    expect(game.calls.ended).toEqual(['WIPE']);
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
