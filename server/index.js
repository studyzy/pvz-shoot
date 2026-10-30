import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Matchmaker } from './matchmaker.js';
import { serveStatic } from './static.js';
import { decode, encode, MSG, ERR, MAX_MESSAGE } from '../src/net/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 创建双人服务器（不自动 listen，方便测试用 port 0）。
 * publicDir 为 null 时只开 WS，不服务静态文件。
 */
export function createDuoServer(opts = {}) {
  const publicDir = opts.publicDir === undefined ? path.join(ROOT, 'dist') : opts.publicDir;
  const buildId = opts.buildId || null;
  const maxPerIp = opts.maxPerIp === undefined ? 6 : opts.maxPerIp;
  const trustProxy = !!opts.trustProxy;
  const ipCounts = new Map();
  const resolveIp = (req) => {
    if (trustProxy) {
      const x = req.headers && req.headers['x-forwarded-for'];
      if (typeof x === 'string' && x) return x.split(',')[0].trim();
    }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  };
  const matchmaker = new Matchmaker({
    maxMatches: opts.maxMatches,
    waitTtlMs: opts.waitTtlMs,
    reconnectGraceMs: opts.reconnectGraceMs,
    buildId,
    accessCode: opts.accessCode || null,
    log: opts.log || (() => {}),
  });
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    const pathname = (() => {
      try {
        return new URL(req.url || '/', 'http://localhost').pathname;
      } catch (e) {
        return '/';
      }
    })();
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(
        JSON.stringify({
          ok: true,
          uptime: Math.round((Date.now() - startedAt) / 1000),
          build: buildId || 'dev',
          ...matchmaker.stats(),
          connections: [...ipCounts.values()].reduce((a, b) => a + b, 0),
        })
      );
      return;
    }
    serveStatic(req, res, publicDir).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      } else {
        res.destroy();
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  let nextId = 1;

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch (e) {
      pathname = '/';
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const ip = resolveIp(req);
    const used = ipCounts.get(ip) || 0;
    if (used >= maxPerIp) {
      try {
        ws.send(encode(MSG.ERROR, { code: ERR.BUSY, message: '同一网络连接过多' }));
      } catch (e) {
        // 连接可能已经断了
      }
      try {
        ws.close();
      } catch (e) {
        // 忽略
      }
      return;
    }
    ipCounts.set(ip, used + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (ipCounts.get(ip) || 1) - 1;
      if (n <= 0) ipCounts.delete(ip);
      else ipCounts.set(ip, n);
    };
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    const conn = {
      id: nextId++,
      seat: null,
      send(type, data) {
        if (ws.readyState === 1) ws.send(encode(type, data));
      },
      close() {
        try {
          ws.close();
        } catch (e) {
          // 连接可能已经断了
        }
      },
    };
    ws.on('message', (raw) => {
      if (raw.length > MAX_MESSAGE) return;
      const msg = decode(raw.toString());
      if (!msg) return;
      matchmaker.handle(conn, msg);
    });
    ws.on('close', () => {
      release();
      matchmaker.leave(conn, 'close');
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        // 忽略已经断开的连接
      }
    });
  }, 30000);
  if (heartbeat.unref) heartbeat.unref();

  async function close() {
    clearInterval(heartbeat);
    matchmaker.dispose();
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch (e) {
        // 忽略
      }
    }
    await new Promise((resolve) => wss.close(() => resolve()));
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, wss, matchmaker, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const seconds = (v, d) => (v === undefined ? d : Number(v) * 1000);
  const { server, matchmaker, close } = createDuoServer({
    publicDir: process.env.PUBLIC_DIR || path.join(ROOT, 'dist'),
    maxMatches: Number(process.env.MAX_MATCHES || 8),
    waitTtlMs: seconds(process.env.WAIT_TTL, 10 * 60 * 1000),
    reconnectGraceMs: seconds(process.env.RECONNECT_GRACE, 45 * 1000),
    buildId: process.env.BUILD_ID || null,
    accessCode: process.env.ACCESS_CODE || null,
    maxPerIp: Number(process.env.MAX_CONN_PER_IP || 6),
    trustProxy: process.env.TRUST_PROXY === '1',
    log: (event, id, detail) => {
      console.log('[' + new Date().toISOString() + ']', event, id || '', detail || '');
    },
  });
  server.listen(port, host, () => {
    console.log('duo server listening on http://' + host + ':' + port);
    console.log('  ws: ws://' + host + ':' + port + '/ws');
    console.log('  matches:', JSON.stringify(matchmaker.stats()));
  });
  const shutdown = async () => {
    console.log('shutting down…');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
