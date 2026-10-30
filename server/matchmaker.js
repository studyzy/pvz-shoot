import {
  cleanName,
  cleanToken,
  cleanBuild,
  cleanMapId,
  cleanRelay,
  MSG,
  ERR,
} from '../src/net/protocol.js';

let matchSeq = 0;
let joinSeq = 0;

// 单场对局：两个座位、一个房主（seat 0）。服务器不模拟，只维护配对/中继/重连。
export class Matchmaker {
  constructor(opts = {}) {
    this.maxMatches = opts.maxMatches === undefined ? 8 : opts.maxMatches;
    this.waitTtlMs = opts.waitTtlMs === undefined ? 10 * 60 * 1000 : opts.waitTtlMs;
    this.reconnectGraceMs = opts.reconnectGraceMs === undefined ? 45 * 1000 : opts.reconnectGraceMs;
    this.buildId = opts.buildId || null;
    this.accessCode = opts.accessCode || null;
    this.now = opts.now || (() => Date.now());
    this.rand = opts.rand || Math.random;
    this.log = opts.log || (() => {});
    this.matches = new Map();
    this.waiting = [];
    this.byToken = new Map();
    this.byJoin = new Map();
  }

  stats() {
    let players = 0;
    for (const match of this.matches.values()) {
      for (const seat of match.seats) if (seat.connected) players++;
    }
    return { matches: this.matches.size, waiting: this.waiting.length, players };
  }

  handle(conn, msg) {
    const d = msg.d || {};
    switch (msg.t) {
      case MSG.HELLO:
        this.onHello(conn, d);
        break;
      case MSG.RELAY:
        this.onRelay(conn, d);
        break;
      case MSG.MAP:
        this.onMap(conn, d);
        break;
      case MSG.PING:
        conn.send(MSG.PONG, { t: d.t, now: this.now() });
        break;
      case MSG.BYE:
        this.leave(conn, 'bye');
        break;
      default:
        break;
    }
  }

  onHello(conn, d) {
    if (conn.seat) {
      this.sendWelcome(conn, conn.seat);
      return;
    }
    if (this.buildId && cleanBuild(d.build) !== this.buildId) {
      conn.send(MSG.ERROR, { code: ERR.BUILD, message: '版本不一致，请刷新页面' });
      return;
    }
    if (this.accessCode && d.access !== this.accessCode) {
      conn.send(MSG.ERROR, { code: ERR.ACCESS, message: '口令不正确' });
      return;
    }

    const token = cleanToken(d.token) || this.newToken();
    const page = cleanToken(d.page) || null;
    const name = cleanName(d.name);
    const mapId = cleanMapId(d.mapId);
    const existing = this.byToken.get(token);
    if (existing) {
      // pageId 在同一页面内不变、刷新后变。房主刷新时旧世界没人能恢复，直接结束本局；
      // 客人刷新先回原座位（M1 世界会重置，M2 再加 resync）。
      if (existing.pageId && page && existing.pageId !== page && existing.index === 0) {
        this.end(existing.match, ERR.HOST_RESET);
        this.createMatch(conn, token, name, mapId, page);
        return;
      }
      existing.pageId = page || existing.pageId;
      this.attach(existing, conn);
      return;
    }

    const join = cleanToken(d.join);
    if (join) {
      const joined = this.takeJoin(join);
      if (!joined) {
        conn.send(MSG.ERROR, { code: ERR.JOIN_EXPIRED, message: '邀请链接已失效，请重新匹配' });
        return;
      }
      this.addSeat(joined, conn, token, name, page);
      this.start(joined);
      return;
    }

    const match = this.takeWaiting();
    if (match) {
      this.addSeat(match, conn, token, name, page);
      this.start(match);
      return;
    }

    if (this.matches.size >= this.maxMatches) {
      conn.send(MSG.ERROR, { code: ERR.BUSY, message: '服务器已满，请稍后再试' });
      return;
    }
    this.createMatch(conn, token, name, mapId, page);
  }

  createMatch(conn, token, name, mapId, page) {
    let joinToken = '';
    for (let i = 0; i < 8; i++) {
      const t = this.newToken().slice(0, 12);
      if (!this.byJoin.has(t)) {
        joinToken = t;
        break;
      }
    }
    if (!joinToken) joinToken = (++joinSeq).toString(16).padStart(12, '0');
    const match = {
      id: 'm' + ++matchSeq,
      state: 'waiting',
      mapId,
      seed: Math.floor(this.rand() * 0x7fffffff),
      joinToken,
      seats: [],
      waitTimer: null,
      startedAt: 0,
    };
    this.matches.set(match.id, match);
    this.byJoin.set(joinToken, match);
    this.addSeat(match, conn, token, name, page);
    this.waiting.push(match);
    match.waitTimer = setTimeout(() => {
      if (match.state !== 'waiting') return;
      const seat = match.seats[0];
      if (seat && seat.connected && seat.conn) {
        seat.conn.send(MSG.ERROR, { code: ERR.WAIT_TIMEOUT, message: '等待超时，请重新匹配' });
      }
      this.destroy(match);
    }, this.waitTtlMs);
    this.log('waiting', match.id, name);
    conn.send(MSG.QUEUE, { state: 'waiting' });
  }

  takeJoin(join) {
    const match = this.byJoin.get(join);
    if (!match || match.state !== 'waiting' || match.seats.length !== 1) return null;
    const host = match.seats[0];
    if (!host || !host.connected || !host.conn) return null;
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
    const wi = this.waiting.indexOf(match);
    if (wi >= 0) this.waiting.splice(wi, 1);
    return match;
  }

  takeWaiting() {
    while (this.waiting.length) {
      const match = this.waiting.shift();
      if (match.state !== 'waiting' || match.seats.length !== 1) continue;
      const seat = match.seats[0];
      if (!seat || !seat.connected || !seat.conn) continue;
      clearTimeout(match.waitTimer);
      match.waitTimer = null;
      return match;
    }
    return null;
  }

  addSeat(match, conn, token, name, page) {
    const index = match.seats.length;
    const suffix = index === 0 ? 'A' : 'B';
    const display = name.slice(0, 14) + ' ' + suffix;
    const seat = {
      index,
      token,
      name: display,
      conn,
      connected: true,
      graceTimer: null,
      pageId: page || null,
      match,
    };
    match.seats.push(seat);
    conn.seat = seat;
    this.byToken.set(token, seat);
    if (index === 1) {
      const host = match.seats[0];
      if (host && host.connected && host.conn) {
        host.conn.send(MSG.PEER, { joined: true, name: seat.name });
      }
    }
    this.sendWelcome(conn, seat);
    return seat;
  }

  sendWelcome(conn, seat) {
    const match = seat.match;
    const peer = match.seats.find((s) => s !== seat && s.connected);
    conn.send(MSG.WELCOME, {
      matchId: match.id,
      seat: seat.index,
      host: seat.index === 0,
      state: match.state,
      mapId: match.mapId,
      seed: match.seed,
      t0: match.startedAt,
      peer: peer ? peer.name : null,
      token: seat.token,
      joinToken: seat.index === 0 && match.state === 'waiting' ? match.joinToken : null,
    });
  }

  attach(seat, conn) {
    const old = seat.conn;
    if (old && old !== conn) {
      old.seat = null;
      old.send(MSG.ERROR, { code: ERR.DUPLICATE, message: '账号已在另一处重连' });
      try {
        old.close();
      } catch (e) {
        // 旧连接可能已经断了
      }
    }
    if (seat.graceTimer) {
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
    }
    seat.conn = conn;
    seat.connected = true;
    conn.seat = seat;
    const peer = seat.match.seats.find((s) => s !== seat && s.connected);
    if (peer && peer.conn) {
      peer.conn.send(MSG.PEER, { joined: true, name: seat.name });
    }
    this.sendWelcome(conn, seat);
    if (seat.match.state === 'playing') {
      conn.send(MSG.START, {
        mapId: seat.match.mapId,
        seed: seat.match.seed,
        t0: seat.match.startedAt,
      });
    }
    this.log('reconnect', seat.match.id, seat.name);
  }

  start(match) {
    match.state = 'playing';
    match.startedAt = this.now();
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
    this.byJoin.delete(match.joinToken);
    for (const seat of match.seats) {
      if (seat.connected && seat.conn) {
        seat.conn.send(MSG.START, {
          mapId: match.mapId,
          seed: match.seed,
          t0: match.startedAt,
        });
      }
    }
    this.log('start', match.id, match.seats.map((s) => s.name).join(' / '));
  }

  onRelay(conn, d) {
    const seat = conn.seat;
    if (!seat || !seat.match || seat.match.state !== 'playing') return;
    const payload = cleanRelay(d.payload);
    if (!payload) return;
    const other = seat.match.seats.find((s) => s !== seat);
    if (!other || !other.connected || !other.conn) return;
    other.conn.send(MSG.RELAY, { payload });
  }

  onMap(conn, d) {
    const seat = conn.seat;
    if (!seat || seat.index !== 0) return;
    const match = seat.match;
    if (match.state !== 'waiting') return;
    match.mapId = cleanMapId(d.id);
    const other = match.seats.find((s) => s !== seat);
    if (other && other.connected && other.conn) other.conn.send(MSG.MAP, { id: match.mapId });
  }

  leave(conn, reason) {
    const seat = conn.seat;
    if (!seat) return;
    conn.seat = null;
    seat.conn = null;
    seat.connected = false;
    const match = seat.match;
    if (!match) return;

    if (match.state === 'waiting') {
      this.destroy(match);
      return;
    }
    if (match.state !== 'playing') return;
    if (reason === 'bye') {
      this.end(match, ERR.PEER_LEFT);
      return;
    }

    const peer = match.seats.find((s) => s !== seat);
    if (peer && peer.connected && peer.conn) {
      peer.conn.send(MSG.PEER, {
        joined: false,
        name: seat.name,
        reconnectIn: Math.round(this.reconnectGraceMs / 1000),
      });
    }
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = setTimeout(() => {
      seat.graceTimer = null;
      if (!seat.connected && match.state === 'playing') this.end(match, ERR.PEER_TIMEOUT);
    }, this.reconnectGraceMs);
    this.log('leave', match.id, seat.name, reason);
  }

  end(match, reason) {
    if (match.state === 'ended') return;
    match.state = 'ended';
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
    this.byJoin.delete(match.joinToken);
    for (const seat of match.seats) {
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
      if (seat.connected && seat.conn) {
        seat.conn.send(MSG.END, { reason });
        seat.conn.seat = null;
      }
      seat.connected = false;
      seat.conn = null;
      this.byToken.delete(seat.token);
    }
    this.matches.delete(match.id);
    const wi = this.waiting.indexOf(match);
    if (wi >= 0) this.waiting.splice(wi, 1);
    this.log('end', match.id, reason);
  }

  destroy(match) {
    if (match.state === 'ended') return;
    match.state = 'ended';
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
    this.byJoin.delete(match.joinToken);
    for (const seat of match.seats) {
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
      if (seat.conn) seat.conn.seat = null;
      seat.connected = false;
      seat.conn = null;
      this.byToken.delete(seat.token);
    }
    this.matches.delete(match.id);
    const wi = this.waiting.indexOf(match);
    if (wi >= 0) this.waiting.splice(wi, 1);
  }

  newToken() {
    let out = '';
    for (let i = 0; i < 24; i++) out += Math.floor(this.rand() * 16).toString(16);
    return out;
  }

  dispose() {
    for (const match of this.matches.values()) {
      clearTimeout(match.waitTimer);
      for (const seat of match.seats) clearTimeout(seat.graceTimer);
    }
    this.matches.clear();
    this.waiting.length = 0;
    this.byToken.clear();
    this.byJoin.clear();
  }
}
