import {
  encode,
  decode,
  cleanName,
  cleanToken,
  cleanMapId,
  cleanRelay,
  MSG,
} from './protocol.js';

const TOKEN_KEY = 'pvz-duo-token';

function storageGet(key) {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value);
  } catch (e) {
    // Safari 隐私模式可能禁用 sessionStorage
  }
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function makeToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    const t = crypto.randomUUID().replace(/-/g, '');
    if (cleanToken(t)) return t;
  }
  let out = '';
  for (let i = 0; i < 24; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function defaultNetUrl(env, loc) {
  const e = env === undefined ? (typeof import.meta !== 'undefined' ? import.meta.env : null) : env;
  const l = loc === undefined ? (typeof location !== 'undefined' ? location : null) : loc;
  if (e && e.VITE_NET_URL) return e.VITE_NET_URL;
  if (!l) return 'ws://localhost:8080/ws';
  if (e && e.DEV) return 'ws://' + l.hostname + ':8080/ws';
  return (l.protocol === 'https:' ? 'wss://' : 'ws://') + l.host + '/ws';
}

// 浏览器端 WebSocket 客户端：连接、hello、心跳/RTT、断线重连、token 持久化。
export class NetClient {
  constructor(opts = {}) {
    this.url = opts.url || defaultNetUrl();
    this.name = cleanName(opts.name || '戴夫');
    this.mapId = cleanMapId(opts.mapId);
    this.build = String(opts.build || 'dev').slice(0, 32);
    this.access = opts.access || null;
    this.join = cleanToken(opts.join);
    // 页面实例 id：同一页内断线重连不变，刷新/新标签页会变；服务器用它区分「网络抖动」和「刷新」。
    this.pageId = cleanToken(opts.pageId) || makeToken();
    this.token = cleanToken(opts.token) || cleanToken(storageGet(TOKEN_KEY)) || makeToken();
    storageSet(TOKEN_KEY, this.token);
    this.onMessage = opts.onMessage || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.autoReconnect = opts.autoReconnect !== false;
    this.wsFactory = opts.wsFactory || ((url) => new WebSocket(url));
    this.ws = null;
    this.status = 'idle';
    this.rtt = 0;
    this.retry = 0;
    this.retryTimer = null;
    this.pingTimer = null;
    this.manualClose = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.manualClose = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus('connecting');
    let ws;
    try {
      ws = this.wsFactory(this.url);
    } catch (e) {
      this.setStatus('error', { error: e });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.setStatus('open');
      this.send(MSG.HELLO, {
        token: this.token,
        name: this.name,
        build: this.build,
        mapId: this.mapId,
        access: this.access,
        join: this.join || undefined,
        page: this.pageId,
      });
      this.startPing();
    };
    ws.onmessage = (ev) => this.handle(ev && ev.data);
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.stopPing();
      this.setStatus('closed');
      if (!this.manualClose && this.autoReconnect) this.scheduleReconnect();
    };
    ws.onerror = () => {
      this.setStatus('error');
    };
  }

  handle(raw) {
    const msg = decode(typeof raw === 'string' ? raw : '');
    if (!msg) return;
    if (msg.t === MSG.PONG) {
      const t = Number(msg.d.t);
      if (Number.isFinite(t)) this.rtt = Math.max(0, now() - t);
      return;
    }
    if (msg.t === MSG.WELCOME) {
      const token = cleanToken(msg.d.token);
      if (token) {
        this.token = token;
        storageSet(TOKEN_KEY, token);
      }
    }
    this.onMessage(msg);
  }

  send(type, data) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(encode(type, data));
    return true;
  }

  relay(payload) {
    const p = cleanRelay(payload);
    if (!p) return false;
    return this.send(MSG.RELAY, { payload: p });
  }

  setMap(id) {
    this.mapId = cleanMapId(id);
    return this.send(MSG.MAP, { id: this.mapId });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send(MSG.PING, { t: now() });
    }, 2000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  scheduleReconnect() {
    if (!this.autoReconnect || this.manualClose) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(8000, 500 * 2 ** Math.min(this.retry, 4));
    this.retry++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  setStatus(status, info) {
    this.status = status;
    this.onStatus(status, info || {});
  }

  close() {
    this.manualClose = true;
    this.stopPing();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // 忽略
      }
    }
    this.setStatus('closed');
  }
}
