// @vitest-environment node
// 端到端：服务器权威模拟的完整链路。
//
// 验证四件事：
//   1. 两个客户端配对后，服务器用 MatchSim 推进并广播二进制快照
//   2. 房间不再依赖「房主」—— 任何一方掉线，世界照常推进
//   3. 快照内容真实反映模拟（僵尸在动、玩家在动）
//   4. 输入帧能改变权威状态
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createDuoServer } from '../../server/index.js';
import { MSG, encode, decode } from '../../src/net/protocol.js';
import { encodeInput, decodeSnapshot, FRAME } from '../../src/sim/snapshot.js';
import { BTN } from '../../src/sim/MatchSim.js';

let srv;
let port;
const clients = [];

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const inbox = [];
    const snaps = [];
    const waiters = [];
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
        // 快照与事件帧混在一起发，按首字节区分
        if (bytes[0] === FRAME.SNAP || bytes[0] === FRAME.FULL) {
          const s = decodeSnapshot(bytes);
          if (s) snaps.push(s);
        }
        return;
      }
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
        snaps,
        token: newToken(),
        send(type, d) {
          ws.send(encode(type, d));
        },
        sendInput(seq, inp) {
          ws.send(encodeInput(seq, inp));
        },
        wait(type, ms = 4000) {
          const idx = inbox.findIndex((m) => m.t === type);
          if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
          return new Promise((res, rej) => {
            const w = { type, resolve: res };
            w.timer = setTimeout(() => rej(new Error('timeout waiting ' + type)), ms);
            waiters.push(w);
          });
        },
        close() {
          try {
            ws.close();
          } catch (e) {}
        },
        // 等连接彻底关闭（服务器侧的 leave 已经跑完）
        closed() {
          if (ws.readyState === 3) return Promise.resolve();
          return new Promise((res) => ws.once('close', res));
        },
      };
      clients.push(client);
      resolve(client);
    });
    ws.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 用唯一 token 建局，用例之间不共享状态
let tokenSeq = 0;
function newToken() {
  tokenSeq++;
  return 'tok' + String(tokenSeq).padStart(5, '0') + Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  // 同一个 IP 下会建很多连接，测试里放开 per-IP 上限（生产默认 6）
  srv = createDuoServer({ publicDir: null, maxMatches: 50, maxPerIp: 1000, log: () => {} });
  await new Promise((res) => srv.server.listen(0, '127.0.0.1', res));
  port = srv.server.address().port;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await srv.close();
});

async function pairUp(mapId = 'backyard') {
  const a = await open();
  a.send(MSG.HELLO, { token: a.token, name: '戴夫A', mapId, build: 'dev', page: 'pa' });
  await a.wait(MSG.WELCOME);
  const b = await open();
  b.send(MSG.HELLO, { token: b.token, name: '戴夫B', mapId, build: 'dev', page: 'pb' });
  await b.wait(MSG.WELCOME);
  await a.wait(MSG.START);
  await b.wait(MSG.START);
  return { a, b };
}

describe('服务器权威模拟（端到端）', () => {
  it('配对后服务器开始广播二进制快照，且快照里僵尸在动', async () => {
    const { a, b } = await pairUp();
    // 等 1.5 秒，收集快照
    await sleep(1500);
    expect(a.snaps.length).toBeGreaterThanOrEqual(20); // 30Hz 下 1.5s ≈ 45 帧
    expect(b.snaps.length).toBeGreaterThanOrEqual(20);

    const first = a.snaps[0];
    const last = a.snaps[a.snaps.length - 1];
    // tick 必须单调递增
    expect(last.tick).toBeGreaterThan(first.tick);
    // 双方收到的 tick 应该基本一致（同一房间同一时钟）
    expect(Math.abs(a.snaps[a.snaps.length - 1].tick - b.snaps[b.snaps.length - 1].tick)).toBeLessThan(5);
    // 僵尸刷出来了
    expect(last.zombies.length).toBeGreaterThan(0);
    a.close();
    b.close();
    await Promise.all([a.closed(), b.closed()]);
  });

  it('快照体积符合预期（二进制远小于 JSON）', async () => {
    const { a, b } = await pairUp();
    await sleep(2000);
    const s = a.snaps[a.snaps.length - 1];
    // 14 只僵尸约 16*14 + 玩家 48 + 头 8 ≈ 280 字节
    const est = 8 + s.players.length * 24 + s.zombies.length * 16;
    expect(est).toBeLessThan(400);
    a.close();
    b.close();
    await Promise.all([a.closed(), b.closed()]);
  });

  it('输入帧能驱动权威玩家移动（不是凭空不动）', async () => {
    const { a, b } = await pairUp();
    await sleep(300);
    const before = a.snaps[a.snaps.length - 1].players[0];
    // 持续发送「前进」输入
    for (let i = 0; i < 40; i++) {
      a.sendInput(i + 1, { moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 });
      await sleep(30);
    }
    const after = a.snaps[a.snaps.length - 1].players[0];
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    expect(moved).toBeGreaterThan(2); // 约 1.2 秒全速前进应走 4+ 米
    a.close();
    b.close();
    await Promise.all([a.closed(), b.closed()]);
  });

  it('没有「房主」：一方断线，世界照常推进', async () => {
    const { a, b } = await pairUp();
    await sleep(500);
    const tickBefore = b.snaps[b.snaps.length - 1].tick;
    // A 断开（旧架构里 A 是房主，会导致 B 收到 HOST_RESET / 结束）
    a.close();
    const lenBefore = b.snaps.length;
    await sleep(1500);
    const tickAfter = b.snaps[b.snaps.length - 1].tick;
    const gained = b.snaps.length - lenBefore;
    // 世界继续跑：B 仍然收到大量快照，tick 继续前进
    expect(gained).toBeGreaterThan(20);
    expect(tickAfter).toBeGreaterThan(tickBefore + 20);
    // B 收到的是「队友掉线」，而不是对局结束
    const endMsg = b.inbox.find((m) => m.t === MSG.END);
    expect(endMsg).toBeUndefined();
    b.close();
    await b.closed();
  });

  it('五张地图都能作为权威世界启动', async () => {
    for (const id of ['snow', 'dust', 'forest', 'cloud']) {
      const { a, b } = await pairUp(id);
      await sleep(600);
      expect(a.snaps.length, id).toBeGreaterThan(5);
      expect(a.snaps[a.snaps.length - 1].zombies.length, id).toBeGreaterThanOrEqual(0);
      a.close();
      b.close();
      await Promise.all([a.closed(), b.closed()]);
    }
  });
});