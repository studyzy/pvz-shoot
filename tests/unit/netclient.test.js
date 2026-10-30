import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetClient, defaultNetUrl, makeToken } from '../../src/net/NetClient.js';
import { MSG, encode, decode } from '../../src/net/protocol.js';

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    FakeWS.instances.push(this);
  }
  send(s) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.closed = true;
    if (this.onclose) this.onclose({});
  }
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }
  message(obj) {
    this.readyState = 1;
    if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) });
  }
  error() {
    if (this.onerror) this.onerror({});
  }
}

function make(opts = {}) {
  const statuses = [];
  const messages = [];
  const client = new NetClient({
    url: 'ws://test/ws',
    name: '小明',
    mapId: 'snow',
    build: 'v1',
    token: 'tok12345',
    wsFactory: (url) => new FakeWS(url),
    onMessage: (m) => messages.push(m),
    onStatus: (s, info) => statuses.push({ s, info }),
    ...opts,
  });
  return { client, statuses, messages };
}

beforeEach(() => {
  FakeWS.instances.length = 0;
  try {
    sessionStorage.clear();
  } catch (e) {
    // ignore
  }
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NetClient', () => {
  it('连接后发 hello；未打开时 send 返回 false', () => {
    const { client, statuses } = make();
    client.connect();
    expect(statuses[0].s).toBe('connecting');
    const ws = FakeWS.instances[0];
    expect(ws.url).toBe('ws://test/ws');
    expect(client.send('x')).toBe(false);
    ws.open();
    expect(statuses[statuses.length - 1].s).toBe('open');
    const hello = decode(ws.sent[0]);
    expect(hello.t).toBe(MSG.HELLO);
    expect(hello.d).toMatchObject({ token: 'tok12345', name: '小明', build: 'v1', mapId: 'snow' });
    expect(client.send('x')).toBe(true);
    expect(decode(ws.sent[1]).t).toBe('x');
  });

  it('消息路由：pong 算 RTT，welcome 更新 token，坏消息忽略', () => {
    const { client, messages } = make();
    client.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message('not json');
    expect(messages).toHaveLength(0);

    const t = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(1042);
    ws.message({ v: 1, t: MSG.PONG, d: { t } });
    expect(client.rtt).toBe(42);
    expect(messages).toHaveLength(0);

    ws.message({ v: 1, t: MSG.WELCOME, d: { token: 'abcdefgh', seat: 0 } });
    expect(client.token).toBe('abcdefgh');
    expect(messages).toHaveLength(1);
    expect(messages[0].t).toBe(MSG.WELCOME);
  });

  it('relay / setMap / ping；超长 relay 被拒绝', () => {
    const { client } = make();
    client.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    expect(client.relay('{"v":1,"t":"state"}')).toBe(true);
    expect(decode(ws.sent[1]).t).toBe(MSG.RELAY);
    expect(client.relay('x'.repeat(40000))).toBe(false);
    expect(client.setMap('dust')).toBe(true);
    expect(client.mapId).toBe('dust');
    expect(decode(ws.sent[2]).d.id).toBe('dust');

    vi.useFakeTimers();
    client.stopPing();
    client.startPing();
    vi.advanceTimersByTime(2100);
    expect(ws.sent.some((s) => decode(s).t === MSG.PING)).toBe(true);
    client.stopPing();
  });

  it('断线自动重连，close 后不重连', () => {
    vi.useFakeTimers();
    const { client } = make();
    client.connect();
    FakeWS.instances[0].open();
    FakeWS.instances[0].close();
    expect(client.status).toBe('closed');
    vi.advanceTimersByTime(500);
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1].open();
    expect(client.status).toBe('open');

    client.close();
    expect(client.manualClose).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('wsFactory 抛错时进入 error 并安排重连', () => {
    vi.useFakeTimers();
    let calls = 0;
    const { client, statuses } = make({
      wsFactory: () => {
        calls++;
        throw new Error('nope');
      },
    });
    client.connect();
    expect(calls).toBe(1);
    expect(statuses.some((x) => x.s === 'error')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(calls).toBe(2);
    client.close();
  });

  it('onerror 状态', () => {
    const { client, statuses } = make();
    client.connect();
    FakeWS.instances[0].error();
    expect(statuses[statuses.length - 1].s).toBe('error');
    client.close();
  });

  it('默认 wsFactory/回调与本地 token', () => {
    class NoopWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', NoopWS);
    sessionStorage.setItem('pvz-duo-token', 'stored123');
    const c = new NetClient({ url: 'ws://x' });
    expect(c.token).toBe('stored123');
    c.connect();
    expect(c.ws).toBeInstanceOf(NoopWS);
    c.close();
    vi.unstubAllGlobals();
  });

  it('hello 带 join/page', () => {
    const { client } = make({ join: 'abcdefgh', pageId: 'pageaaaa' });
    client.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    const hello = decode(ws.sent[0]);
    expect(hello.d.join).toBe('abcdefgh');
    expect(hello.d.page).toBe('pageaaaa');
    client.close();
  });

  it('sessionStorage 读写异常时不崩，仍生成 token', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const c = new NetClient({ url: 'ws://x', wsFactory: (u) => new FakeWS(u) });
    expect(c.token).toMatch(/^[a-f0-9]{24,32}$/);
    get.mockRestore();
    set.mockRestore();
  });

  it('connect 会清掉待执行的重连定时器', () => {
    vi.useFakeTimers();
    const { client } = make();
    client.connect();
    FakeWS.instances[0].open();
    FakeWS.instances[0].close();
    expect(FakeWS.instances).toHaveLength(1);
    client.connect();
    expect(FakeWS.instances).toHaveLength(2);
    vi.advanceTimersByTime(10000);
    expect(FakeWS.instances).toHaveLength(2);
    client.close();
  });
});

describe('defaultNetUrl / makeToken', () => {
  it('优先 VITE_NET_URL；DEV 走 8080；生产走同源 ws/wss', () => {
    expect(defaultNetUrl({ VITE_NET_URL: 'wss://x/ws' }, null)).toBe('wss://x/ws');
    expect(defaultNetUrl({ DEV: true }, { hostname: '192.168.1.5', host: '192.168.1.5:5173', protocol: 'http:' })).toBe(
      'ws://192.168.1.5:8080/ws'
    );
    expect(defaultNetUrl({}, { host: 'game.example', protocol: 'https:' })).toBe('wss://game.example/ws');
    expect(defaultNetUrl({}, { host: 'game.example', protocol: 'http:' })).toBe('ws://game.example/ws');
    expect(defaultNetUrl({}, null)).toBe('ws://localhost:8080/ws');
  });

  it('token 是 24~32 位十六进制', () => {
    expect(makeToken()).toMatch(/^[a-f0-9]{24,32}$/);
  });

  it('crypto.randomUUID 可用时优先用它', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '12345678-1234-1234-1234-123456789abc' });
    expect(makeToken()).toBe('12345678123412341234123456789abc');
    vi.unstubAllGlobals();
  });
});

describe('makeToken · 兜底路径', () => {
  it('没有 crypto.randomUUID 时退回随机十六进制串，长度 24', async () => {
    const { makeToken } = await import('../../src/net/NetClient.js');
    const saved = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const t = makeToken();
      expect(typeof t).toBe('string');
      expect(t).toHaveLength(24);
      expect(/^[0-9a-f]{24}$/.test(t)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
    }
  });
});

describe('NetClient · connect 的异常与重复调用', () => {
  it('wsFactory 抛错时进 error 状态并安排重连', () => {
    vi.useFakeTimers();
    const statuses = [];
    const client = new NetClient({
      url: 'ws://test/ws',
      name: 'A',
      token: 'tok12345',
      wsFactory: () => { throw new Error('boom'); },
      onStatus: (s, info) => statuses.push({ s, info }),
    });
    client.connect();
    expect(statuses.some((x) => x.s === 'error')).toBe(true);
    // 安排了一次重连计时器
    expect(client.retryTimer).toBeTruthy();
    client.close();
    vi.useRealTimers();
  });

  it('已连接（OPEN/CONNECTING）时重复 connect 不会新建连接', () => {
    const { client } = make();
    client.connect();
    const first = FakeWS.instances.length;
    client.connect();
    expect(FakeWS.instances.length).toBe(first);
  });

  it('close 后手动标记，不再自动重连', () => {
    const { client } = make();
    client.connect();
    client.close();
    expect(client.manualClose).toBe(true);
    expect(client.ws).toBe(null);
  });
});
