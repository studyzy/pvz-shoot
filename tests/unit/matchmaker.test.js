import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Matchmaker } from '../../server/matchmaker.js';
import { MSG, ERR, MAX_RELAY } from '../../src/net/protocol.js';

function conn(id) {
  return {
    id,
    seat: null,
    sent: [],
    closed: false,
    send(t, d) {
      this.sent.push({ t, d });
    },
    close() {
      this.closed = true;
    },
  };
}

function last(c, t) {
  for (let i = c.sent.length - 1; i >= 0; i--) if (c.sent[i].t === t) return c.sent[i];
  return null;
}

function all(c, t) {
  return c.sent.filter((m) => m.t === t);
}

let mm;

function make(opts = {}) {
  return new Matchmaker({
    maxMatches: 2,
    waitTtlMs: 5000,
    reconnectGraceMs: 1000,
    now: () => 1700000000000,
    rand: () => 0.5,
    ...opts,
  });
}

function hello(m, c, opts = {}) {
  m.handle(c, {
    t: MSG.HELLO,
    d: {
      token: opts.token || 'tok' + String(c.id).padStart(5, '0'),
      name: opts.name || '戴夫',
      mapId: opts.mapId || 'backyard',
      build: opts.build || 'dev',
      access: opts.access,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mm = make();
});

afterEach(() => {
  mm.dispose();
  vi.useRealTimers();
});

describe('自动配对', () => {
  it('两个人自动配成一场：座位、地图、开始、中继、ping', () => {
    const a = conn(1);
    const b = conn(2);
    hello(mm, a, { token: 'tokaaaaa', name: '戴夫', mapId: 'snow' });
    expect(last(a, MSG.WELCOME).d).toMatchObject({
      seat: 0,
      host: true,
      state: 'waiting',
      mapId: 'snow',
      peer: null,
    });
    expect(last(a, MSG.QUEUE).d.state).toBe('waiting');

    hello(mm, b, { token: 'tokbbbbb', name: '队友', mapId: 'dust' });
    expect(last(b, MSG.WELCOME).d).toMatchObject({
      seat: 1,
      host: false,
      mapId: 'snow',
      peer: '戴夫 A',
    });
    expect(last(a, MSG.PEER).d).toMatchObject({ joined: true, name: '队友 B' });
    expect(last(a, MSG.START).d.mapId).toBe('snow');
    expect(last(b, MSG.START).d.seed).toBe(last(a, MSG.START).d.seed);
    expect(mm.stats()).toEqual({ matches: 1, waiting: 0, players: 2 });

    mm.handle(a, { t: MSG.RELAY, d: { payload: '{"v":1,"t":"state","d":{"x":1}}' } });
    expect(last(b, MSG.RELAY).d.payload).toContain('"x":1');
    mm.handle(b, { t: MSG.RELAY, d: { payload: '{"v":1,"t":"state","d":{"x":2}}' } });
    expect(last(a, MSG.RELAY).d.payload).toContain('"x":2');

    mm.handle(a, { t: MSG.PING, d: { t: 123 } });
    expect(last(a, MSG.PONG).d).toEqual({ t: 123, now: 1700000000000 });
  });

  it('多人自动开出多场；满了返回 BUSY；等待队列 FIFO', () => {
    const cs = [1, 2, 3, 4, 5].map(conn);
    hello(mm, cs[0], { token: 'tokaaaaa', mapId: 'snow' });
    hello(mm, cs[1], { token: 'tokbbbbb' });
    expect(mm.stats()).toEqual({ matches: 1, waiting: 0, players: 2 });

    hello(mm, cs[2], { token: 'tokccccc' });
    expect(mm.stats()).toEqual({ matches: 2, waiting: 1, players: 3 });

    hello(mm, cs[3], { token: 'tokddddd' });
    expect(mm.stats()).toEqual({ matches: 2, waiting: 0, players: 4 });
    expect(last(cs[2], MSG.START)).toBeTruthy();
    expect(last(cs[3], MSG.START)).toBeTruthy();

    hello(mm, cs[4], { token: 'tokeeeee' });
    expect(last(cs[4], MSG.ERROR).d.code).toBe(ERR.BUSY);
  });

  it('等待中的房主可以改地图，客人拿到的是改后的地图', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa', mapId: 'backyard' });
    mm.handle(a, { t: MSG.MAP, d: { id: 'dust' } });
    const b = conn(2);
    hello(mm, b, { token: 'tokbbbbb' });
    expect(last(b, MSG.WELCOME).d.mapId).toBe('dust');
    expect(last(b, MSG.START).d.mapId).toBe('dust');
  });

  it('客人不能改地图（开局后忽略）', () => {
    const a = conn(1);
    const b = conn(2);
    hello(mm, a, { token: 'tokaaaaa', mapId: 'snow' });
    hello(mm, b, { token: 'tokbbbbb' });
    mm.handle(b, { t: MSG.MAP, d: { id: 'dust' } });
    expect(mm.matches.values().next().value.mapId).toBe('snow');
  });

  it('开局前的 relay 被丢弃；超长 relay 被丢弃', () => {
    const a = conn(1);
    const b = conn(2);
    hello(mm, a, { token: 'tokaaaaa' });
    mm.handle(a, { t: MSG.RELAY, d: { payload: 'x' } });
    expect(last(b, MSG.RELAY)).toBeNull();
    hello(mm, b, { token: 'tokbbbbb' });
    mm.handle(a, { t: MSG.RELAY, d: { payload: 'x'.repeat(MAX_RELAY + 1) } });
    expect(last(b, MSG.RELAY)).toBeNull();
  });
});

describe('重连与超时', () => {
  it('掉线后同 token 回到原座位，不新开一场', () => {
    const a = conn(1);
    const b = conn(2);
    hello(mm, a, { token: 'tokaaaaa' });
    hello(mm, b, { token: 'tokbbbbb' });
    mm.leave(b, 'close');
    expect(last(a, MSG.PEER).d).toMatchObject({ joined: false, reconnectIn: 1 });

    const b2 = conn(3);
    hello(mm, b2, { token: 'tokbbbbb' });
    expect(last(b2, MSG.WELCOME).d.seat).toBe(1);
    expect(last(b2, MSG.START)).toBeTruthy();
    expect(last(a, MSG.PEER).d.joined).toBe(true);
    expect(mm.stats()).toEqual({ matches: 1, waiting: 0, players: 2 });
  });

  it('超过重连窗口，对局结束', () => {
    const a = conn(1);
    const b = conn(2);
    hello(mm, a, { token: 'tokaaaaa' });
    hello(mm, b, { token: 'tokbbbbb' });
    mm.leave(b, 'close');
    vi.advanceTimersByTime(1001);
    expect(last(a, MSG.END).d.reason).toBe(ERR.PEER_TIMEOUT);
    expect(mm.stats()).toEqual({ matches: 0, waiting: 0, players: 0 });
  });

  it('等待超时', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa' });
    vi.advanceTimersByTime(5001);
    expect(last(a, MSG.ERROR).d.code).toBe(ERR.WAIT_TIMEOUT);
    expect(mm.stats()).toEqual({ matches: 0, waiting: 0, players: 0 });
  });

  it('等待中的房主离开立即销毁', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa' });
    mm.leave(a, 'close');
    expect(mm.stats()).toEqual({ matches: 0, waiting: 0, players: 0 });
  });

  it('重复 token 踢掉旧连接', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa' });
    const a2 = conn(2);
    hello(mm, a2, { token: 'tokaaaaa' });
    expect(a.closed).toBe(true);
    expect(last(a2, MSG.WELCOME).d.seat).toBe(0);
    expect(mm.stats()).toEqual({ matches: 1, waiting: 1, players: 1 });
  });

  it('dispose 清掉所有定时器', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa' });
    mm.dispose();
    vi.advanceTimersByTime(999999);
    expect(mm.stats()).toEqual({ matches: 0, waiting: 0, players: 0 });
  });
});

describe('入场校验', () => {
  it('build 不一致拒绝', () => {
    mm = make({ buildId: 'v1' });
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa', build: 'v2' });
    expect(last(a, MSG.ERROR).d.code).toBe(ERR.BUILD);
    expect(mm.stats().matches).toBe(0);
  });

  it('ACCESS_CODE 校验', () => {
    mm = make({ accessCode: 'secret' });
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa' });
    expect(last(a, MSG.ERROR).d.code).toBe(ERR.ACCESS);
    const b = conn(2);
    hello(mm, b, { token: 'tokbbbbb', access: 'secret' });
    expect(last(b, MSG.WELCOME)).toBeTruthy();
  });
});

describe('邀请链接与刷新语义', () => {
  it('join token 邀请特定朋友；过期/无效返回 JOIN_EXPIRED', () => {
    const a = conn(1);
    hello(mm, a, { token: 'tokaaaaa', mapId: 'snow' });
    const join = last(a, MSG.WELCOME).d.joinToken;
    expect(join).toMatch(/^[a-f0-9]{12}$/);

    const b = conn(2);
    mm.handle(b, { t: MSG.HELLO, d: { token: 'tokbbbbb', name: '朋友', build: 'dev', join } });
    expect(last(b, MSG.WELCOME).d.seat).toBe(1);
    expect(last(b, MSG.WELCOME).d.mapId).toBe('snow');
    expect(last(b, MSG.START)).toBeTruthy();

    const c = conn(3);
    mm.handle(c, { t: MSG.HELLO, d: { token: 'tokccccc', name: '过期', build: 'dev', join } });
    expect(last(c, MSG.ERROR).d.code).toBe(ERR.JOIN_EXPIRED);

    const d = conn(4);
    mm.handle(d, { t: MSG.HELLO, d: { token: 'tokddddd', name: '无效', build: 'dev', join: '000000000000' } });
    expect(last(d, MSG.ERROR).d.code).toBe(ERR.JOIN_EXPIRED);
    expect(mm.stats().matches).toBe(1);
  });

  it('房主刷新结束旧局并新开一场；客人刷新回原座位', () => {
    const a = conn(1);
    mm.handle(a, { t: MSG.HELLO, d: { token: 'tokaaaaa', name: '戴夫', mapId: 'snow', build: 'dev', page: 'pageaaaa' } });
    const b = conn(2);
    mm.handle(b, { t: MSG.HELLO, d: { token: 'tokbbbbb', name: '队友', build: 'dev', page: 'pagebbbb' } });
    expect(mm.matches.values().next().value.state).toBe('playing');

    // 客人刷新：同 token、新 pageId → 回原座位
    const b2 = conn(3);
    mm.handle(b2, { t: MSG.HELLO, d: { token: 'tokbbbbb', name: '队友', build: 'dev', page: 'pagebbbb2' } });
    expect(last(b2, MSG.WELCOME).d.seat).toBe(1);
    expect(last(b2, MSG.START)).toBeTruthy();
    expect(mm.stats().matches).toBe(1);

    // 房主刷新：不同 pageId → 旧局结束（客人收到 HOST_RESET），房主新开一场
    const a2 = conn(4);
    mm.handle(a2, { t: MSG.HELLO, d: { token: 'tokaaaaa', name: '戴夫', mapId: 'dust', build: 'dev', page: 'pageaaaa2' } });
    expect(last(b2, MSG.END).d.reason).toBe(ERR.HOST_RESET);
    expect(last(a2, MSG.WELCOME).d).toMatchObject({ host: true, state: 'waiting', mapId: 'dust' });
    expect(mm.stats()).toEqual({ matches: 1, waiting: 1, players: 1 });
  });
});
