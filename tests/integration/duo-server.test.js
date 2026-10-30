// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createDuoServer } from '../../server/index.js';
import { MSG, ERR, encode, decode } from '../../src/net/protocol.js';

let srv;
let port;
const clients = [];

function open(clientPort = port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + clientPort + '/ws');
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = decode(raw.toString());
      if (!msg) return;
      const i = waiters.findIndex((w) => w.type === msg.t);
      if (i >= 0) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
      inbox.push(msg);
    });
    ws.on('open', () => {
      const client = {
        ws,
        inbox,
        send(type, d) {
          ws.send(encode(type, d));
        },
        wait(type, ms = 3000) {
          const idx = inbox.findIndex((m) => m.t === type);
          if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
          return new Promise((res, rej) => {
            const w = { type, resolve: res };
            w.timer = setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i >= 0) waiters.splice(i, 1);
              rej(new Error('等待 ' + type + ' 超时'));
            }, ms);
            waiters.push(w);
          });
        },
      };
      clients.push(client);
      resolve(client);
    });
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  srv = createDuoServer({
    publicDir: null,
    maxMatches: 2,
    waitTtlMs: 5000,
    reconnectGraceMs: 250,
    log: null,
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  port = srv.server.address().port;
});

afterAll(async () => {
  for (const c of clients) {
    try {
      c.ws.terminate();
    } catch (e) {
      // ignore
    }
  }
  await srv.close();
});

describe('真实双人服务器', () => {
  it('自动配对、开始、中继、重连、超时结束', async () => {
    const a = await open();
    a.send(MSG.HELLO, { token: 'tokaaaaa', name: '戴夫', mapId: 'snow', build: 'dev' });
    const wa = await a.wait(MSG.WELCOME);
    expect(wa.d).toMatchObject({ seat: 0, host: true, state: 'waiting', mapId: 'snow' });

    const b = await open();
    b.send(MSG.HELLO, { token: 'tokbbbbb', name: '队友', build: 'dev' });
    const wb = await b.wait(MSG.WELCOME);
    expect(wb.d).toMatchObject({ seat: 1, host: false, mapId: 'snow', peer: '戴夫 A' });
    await a.wait(MSG.START);
    await b.wait(MSG.START);
    expect((await a.wait(MSG.PEER)).d.joined).toBe(true);

    a.send(MSG.RELAY, { payload: encode('state', { x: 1 }) });
    const relay = await b.wait(MSG.RELAY);
    expect(decode(relay.d.payload).d.x).toBe(1);

    b.ws.close();
    const left = await a.wait(MSG.PEER);
    expect(left.d.joined).toBe(false);

    const b2 = await open();
    b2.send(MSG.HELLO, { token: 'tokbbbbb', name: '队友', build: 'dev' });
    const wb2 = await b2.wait(MSG.WELCOME);
    expect(wb2.d.seat).toBe(1);
    await b2.wait(MSG.START);
    const joined = await a.wait(MSG.PEER);
    expect(joined.d.joined).toBe(true);

    b2.send(MSG.RELAY, { payload: encode('state', { x: 2 }) });
    expect(decode((await a.wait(MSG.RELAY)).d.payload).d.x).toBe(2);

    b2.ws.close();
    const end = await a.wait(MSG.END, 4000);
    expect(end.d.reason).toBe(ERR.PEER_TIMEOUT);
  });

  it('per-IP 连接上限', async () => {
    const small = createDuoServer({ publicDir: null, maxPerIp: 2, log: null });
    await new Promise((r) => small.server.listen(0, '127.0.0.1', r));
    const p = small.server.address().port;
    await open(p);
    await open(p);
    const c = await open(p);
    const err = await c.wait(MSG.ERROR);
    expect(err.d.code).toBe(ERR.BUSY);
    await small.close();
  });

  it('并发上限与健康检查；没有 dist 时静态 404', async () => {
    const list = [];
    for (let i = 0; i < 5; i++) list.push(await open());
    list[0].send(MSG.HELLO, { token: 'bustaaaa', name: 'A', build: 'dev' });
    list[1].send(MSG.HELLO, { token: 'bustbbbb', name: 'B', build: 'dev' });
    await list[1].wait(MSG.START);
    list[2].send(MSG.HELLO, { token: 'bustcccc', name: 'C', build: 'dev' });
    await list[2].wait(MSG.WELCOME);
    list[3].send(MSG.HELLO, { token: 'bustdddd', name: 'D', build: 'dev' });
    await list[3].wait(MSG.START);
    list[4].send(MSG.HELLO, { token: 'busteeee', name: 'E', build: 'dev' });
    const busy = await list[4].wait(MSG.ERROR);
    expect(busy.d.code).toBe(ERR.BUSY);

    const health = await fetch('http://127.0.0.1:' + port + '/api/health').then((r) => r.json());
    expect(health.ok).toBe(true);
    expect(health.matches).toBe(2);
    expect(health.players).toBe(4);

    const res = await fetch('http://127.0.0.1:' + port + '/');
    expect(res.status).toBe(404);
  });
});
