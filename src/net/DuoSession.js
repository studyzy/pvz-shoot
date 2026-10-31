import { MSG, encode, decode, cleanMapId } from './protocol.js';
import { NetClient } from './NetClient.js';
import { TUNING } from '../config.js';

const ERR_TEXT = {
  BUILD: '版本不一致，请刷新页面',
  VERSION: '协议版本不一致，请刷新页面',
  ACCESS: '口令不正确',
  BUSY: '服务器已满，请稍后再试',
  WAIT_TIMEOUT: '等待超时，点击双人重新匹配',
  PEER_TIMEOUT: '队友掉线，对局结束',
  BAD: '联机请求无效',
  DUPLICATE: '账号已在另一处重连',
  JOIN_EXPIRED: '邀请链接已失效，点击双人重新匹配',
  REMATCH_TIMEOUT: '队友没有再来一局，对局结束',
};

const FATAL = new Set(['BUILD', 'VERSION', 'ACCESS', 'BUSY', 'WAIT_TIMEOUT', 'DUPLICATE', 'JOIN_EXPIRED', 'REMATCH_TIMEOUT']);
const HOST_FLAG = 'pvz-duo-host';

function round(v, n = 2) {
  const p = 10 ** n;
  return Math.round(v * p) / p;
}

export function readJoinParam(loc) {
  const l = loc === undefined ? (typeof location !== 'undefined' ? location : null) : loc;
  if (!l || !l.search) return null;
  try {
    return new URLSearchParams(l.search).get('join');
  } catch (e) {
    return null;
  }
}

export function shareUrlFor(token, loc) {
  const l = loc === undefined ? (typeof location !== 'undefined' ? location : null) : loc;
  if (!l || !token) return '';
  return l.origin + l.pathname + '?join=' + encodeURIComponent(token);
}

function readHostFlag() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HOST_FLAG) === '1';
  } catch (e) {
    return false;
  }
}

function writeHostFlag(v) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (v) sessionStorage.setItem(HOST_FLAG, '1');
    else sessionStorage.removeItem(HOST_FLAG);
  } catch (e) {
    // 隐私模式忽略
  }
}

// 双人会话：把 NetClient 的消息翻译成 Game 的进入/暂停/远端状态。
// 不 import Three，方便单测；游戏侧只需实现 startDuo/applyRemoteState/endDuo。
export class DuoSession {
  constructor(game, opts = {}) {
    this.game = game;
    this.createNet = opts.createNet || ((o) => new NetClient(o));
    this.net = null;
    this.seat = -1;
    this.host = false;
    this.state = 'idle';
    this.peerName = '队友';
    this.matchId = null;
    this.matchMapId = null;
    this.seed = 0;
    this.sendAcc = 0;
    this.inputAcc = 0;
    this.inputSeq = 0;
    this.pendingLook = { x: 0, y: 0 };
    this.pendingMove = { x: 0, y: 0 };
    this.pendingJump = false;
    this.pendingFire = false;
    this.pendingShield = false;
    this.pendingShieldHp = 0;
    this.snapSeq = 0;
    this.history = [];
  }

  start({ name, mapId, url, join } = {}) {
    if (this.net) return false;
    this.state = 'connecting';
    this.seat = -1;
    this.host = false;
    this.sendAcc = 0;
    this.inputAcc = 0;
    this.inputSeq = 0;
    this.pendingLook = { x: 0, y: 0 };
    this.pendingMove = { x: 0, y: 0 };
    this.pendingJump = false;
    this.pendingFire = false;
    this.pendingShield = false;
    const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
    const joinToken = join !== undefined ? join : readHostFlag() ? null : readJoinParam();
    this.net = this.createNet({
      url,
      name: name || '戴夫',
      mapId: cleanMapId(mapId),
      build: env.VITE_BUILD_ID || 'dev',
      access: env.VITE_ACCESS_CODE || null,
      join: joinToken,
      onMessage: (m) => this.onMessage(m),
      onStatus: (s, info) => this.onStatus(s, info),
    });
    this.net.connect();
    return true;
  }

  onStatus(status, info) {
    if (this.state === 'closed') return;
    const hud = this.game.hud;
    if (!hud) return;
    if (status === 'connecting') hud.setDuoStatus('正在连接服务器…', 'wait');
    else if (status === 'open') hud.setDuoStatus(this.state === 'waiting' ? '等待队友加入…' : '已连接，正在配对…', 'ok');
    else if (status === 'closed') hud.setDuoStatus('连接断开，正在重连…', 'warn');
    else if (status === 'error') hud.setDuoStatus('连接失败，正在重试…', 'warn');
  }

  onMessage(msg) {
    const d = msg.d || {};
    switch (msg.t) {
      case MSG.WELCOME:
        this.matchId = d.matchId || null;
        this.seat = Number.isInteger(d.seat) ? d.seat : 0;
        this.host = !!d.host;
        this.matchMapId = d.mapId || this.matchMapId;
        this.seed = d.seed || 0;
        if (d.peer) this.peerName = d.peer;
        this.state = d.state === 'playing' ? 'playing' : 'waiting';
        writeHostFlag(!!this.host);
        if (this.host && d.joinToken) {
          this.joinToken = d.joinToken;
          this.shareUrl = shareUrlFor(d.joinToken);
          if (this.game.hud && this.game.hud.setDuoShare) this.game.hud.setDuoShare(this.shareUrl);
          this.replaceUrl(this.shareUrl);
        } else {
          this.joinToken = null;
          this.shareUrl = '';
          if (this.game.hud && this.game.hud.setDuoShare) this.game.hud.setDuoShare('');
        }
        if (this.state === 'playing') {
          this.game.hud && this.game.hud.setDuoStatus('已重连，等待同步…', 'ok');
        } else {
          this.game.hud &&
            this.game.hud.setDuoStatus(
              this.host ? '等待队友加入…（把网址发给朋友）' : '正在进入队友的对局…',
              'wait'
            );
        }
        break;
      case MSG.QUEUE:
        if (d.state === 'waiting') {
          this.state = 'waiting';
          this.game.hud && this.game.hud.setDuoStatus('等待队友加入…（点「复制邀请链接」发给朋友）', 'wait');
        } else if (d.state === 'timeout') {
          this.game.hud && this.game.hud.setDuoStatus(ERR_TEXT.WAIT_TIMEOUT, 'warn');
          this.close();
        }
        break;
      case MSG.PEER:
        if (d.joined) {
          if (d.name) this.peerName = d.name;
          this.game.hud && this.game.hud.setDuoStatus('队友已加入，准备开始…', 'ok');
          if (this.game.onPeerJoined) this.game.onPeerJoined(this.peerName);
        } else {
          this.game.hud && this.game.hud.setDuoStatus('队友掉线了，等待重连…', 'warn');
          if (this.game.onPeerLeft) this.game.onPeerLeft(Number(d.reconnectIn) || 45);
        }
        break;
      case MSG.START:
        this.state = 'playing';
        this.matchMapId = d.mapId || this.matchMapId;
        this.seed = d.seed || this.seed;
        if (d.rematch && this.game.duo) {
          // 再来一局：服务器交换了座位，host 身份跟着换
          this.seat = Number.isInteger(d.seat) ? d.seat : this.seat;
          this.host = this.seat === 0;
          this.game.startDuoRound({
            mapId: this.matchMapId,
            seed: this.seed,
            t0: d.t0,
            seat: this.seat,
            round: d.round,
          });
          break;
        }
        if (this.game.duo) {
          this.game.hud && this.game.hud.setDuoStatus('已重连', 'ok');
          break;
        }
        this.game.startDuo({
          mapId: this.matchMapId,
          seed: this.seed,
          t0: d.t0,
          seat: this.seat,
          peerName: this.peerName,
        });
        break;
      case MSG.MAP:
        this.matchMapId = cleanMapId(d.id);
        if (this.game.state === 'menu') this.game.setMap(this.matchMapId);
        break;
      case MSG.RELAY:
        this.onRelay(d.payload);
        break;
      case MSG.END:
        this.state = 'closed';
        if (this.game.endDuo) this.game.endDuo(d.reason);
        this.close();
        break;
      case MSG.ERROR: {
        const text = ERR_TEXT[d.code] || d.message || '联机出错';
        this.game.hud && this.game.hud.setDuoStatus(text, 'warn');
        if (d.code === 'JOIN_EXPIRED') this.clearJoinUrl();
        if (FATAL.has(d.code)) this.close();
        break;
      }
      default:
        break;
    }
  }

  onRelay(payload) {
    if (typeof payload !== 'string') return;
    const msg = decode(payload);
    if (!msg) return;
    if (msg.t === 'input') {
      if (this.game.applyGuestInput) this.game.applyGuestInput(msg.d);
    } else if (msg.t === 'pstate') {
      if (this.game.applyPeerState) this.game.applyPeerState(msg.d);
    } else if (msg.t === 'evt') {
      if (this.game.applyWorldEvent) this.game.applyWorldEvent(msg.d);
    } else if (msg.t === 'hit') {
      if (this.game.applyGuestHit) this.game.applyGuestHit(msg.d);
    } else if (msg.t === 'aoe') {
      if (this.game.applyGuestAoe) this.game.applyGuestAoe(msg.d);
    } else if (msg.t === 'nextwave') {
      if (this.host && this.game.applyNextWaveRequest) this.game.applyNextWaveRequest();
    } else if (msg.t === 'claim') {
      if (this.game.applyGuestClaim) this.game.applyGuestClaim(msg.d);
    } else if (msg.t === 'drop') {
      if (this.game.applyGuestDrop) this.game.applyGuestDrop(msg.d);
    } else if (msg.t === 'sun') {
      if (this.game.spendSun) this.game.spendSun(Number(msg.d.n) || 0);
    } else if (msg.t === 'resync') {
      if (this.game.applyResync) this.game.applyResync(msg.d);
    } else if (msg.t === 'wipe') {
      if (this.game.onDuoWipe) this.game.onDuoWipe(msg.d);
    } else if (msg.t === 'pause') {
      if (this.game.pause) this.game.pause(true);
    } else if (msg.t === 'resume') {
      if (this.game.resume) this.game.resume(true);
    }
  }

  // 每帧在 Game.update 里调用：把上一帧 Player 真正消费的 look/move/jump 累积起来。
  // look 是逐帧增量，只按 30Hz 采样会丢一半，所以必须每帧收、按包发。
  captureInput() {
    if (this.host || this.state !== 'playing') return;
    const g = this.game;
    const p = g.player;
    const li = p && p.lastInput;
    if (!li) return;
    this.pendingLook.x += li.look.x;
    this.pendingLook.y += li.look.y;
    this.pendingMove.x = li.move.x;
    this.pendingMove.y = li.move.y;
    if (li.jump) this.pendingJump = true;
    this.pendingFire = !!(g.controls && g.controls.firing);
    this.pendingShield = !!(g.wallNuts && g.wallNuts.active);
    this.pendingShieldHp = g.wallNuts ? Math.round(g.wallNuts.hp) : 0;
  }

  update(dt) {
    if (this.state !== 'playing' || !this.net) return;
    if (this.host) {
      this.sendAcc += dt;
      if (this.sendAcc < 0.05) return;
      this.sendAcc = 0;
      this.sendHostState();
    } else {
      this.inputAcc += dt;
      if (this.inputAcc < 1 / 30) return;
      this.inputAcc = 0;
      this.sendInput();
    }
  }

  sendInput() {
    this.net.relay(
      encode('input', {
        seq: ++this.inputSeq,
        m: [round(this.pendingMove.x, 3), round(this.pendingMove.y, 3)],
        look: [round(this.pendingLook.x, 4), round(this.pendingLook.y, 4)],
        jump: this.pendingJump,
        fire: this.pendingFire,
        shield: this.pendingShield,
        sh: this.pendingShieldHp,
      })
    );
    this.pendingLook.x = 0;
    this.pendingLook.y = 0;
    this.pendingJump = false;
  }

  sendHostState() {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    const h = {
      x: round(p.pos.x),
      y: round(p.pos.y),
      z: round(p.pos.z),
      yaw: round(p.yaw, 3),
      pitch: round(p.pitch, 3),
      hp: Math.round(p.hp),
      moving: (p.moveAmt || 0) > 0.1,
      speed: round(TUNING.playerSpeed * (p.moveAmt || 0) * (p.speedMul || 1), 2),
      firing: !!(g.controls && g.controls.firing),
      down: !!p.downed,
      downT: round(p.downTimer || 0, 1),
    };
    const ng = g.netGuest;
    const gs = ng
      ? {
          seq: g.lastGuestSeq || 0,
          x: round(ng.pos.x),
          y: round(ng.pos.y),
          z: round(ng.pos.z),
          yaw: round(ng.yaw, 3),
          pitch: round(ng.pitch, 3),
          hp: Math.round(ng.hp),
          moving: (ng.moveAmt || 0) > 0.1,
          firing: !!(g.netControls && g.netControls.firing),
          down: !!ng.downed,
          downT: round(ng.downTimer || 0, 1),
          sh: Math.round(ng.shield ? ng.shield.hp : 0),
        }
      : null;
    const zs = g.zombies && g.zombies.zombies ? g.zombies.zombies.map((z) => z.serialize()) : [];
    const boss = g.zombies ? g.zombies.boss : null;
    const seq = ++this.snapSeq;
    this.history.push({ seq, z: zs });
    if (this.history.length > 20) this.history.shift();
    this.net.relay(
      encode('pstate', {
        seq,
        h,
        g: gs,
        z: zs,
        sun: Math.round(g.sun || 0),
        scores: g.duoStats ? g.duoStats.slice() : [0, 0],
        kills: g.duoKills ? g.duoKills.slice() : [0, 0],
        wave: g.zombies ? g.zombies.wave : 0,
        ws: g.zombies ? g.zombies.state : 'idle',
        wt: g.zombies ? round(g.zombies.intermission || 0, 1) : 0,
        bossHp: boss ? Math.max(0, boss.hp / boss.maxHp) : 0,
        o: g.sunOrbs ? g.sunOrbs.serialize() : [],
      })
    );
  }

  // host 用 guest 看到的那个快照做命中回退：seq 是 guest 最后一次 pstate 的序号。
  getZombieAt(zid, seq) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.seq !== seq) continue;
      return h.z.find((x) => x.id === zid) || null;
    }
    return null;
  }

  sendHit(weaponId, zid, dir) {
    if (this.host || this.state !== 'playing' || !this.net || !zid) return;
    const d = dir || { x: 0, y: 0, z: 0 };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    this.net.relay(
      encode('hit', {
        w: weaponId,
        zid,
        dir: [round(d.x / len, 3), round(d.y / len, 3), round(d.z / len, 3)],
        seq: this.game.lastWorldSeq || 0,
      })
    );
  }

  sendWipe(scores, kills) {
    if (this.host || !this.net || this.state !== 'playing') return;
    this.net.relay(encode('wipe', { reason: 'WIPE', scores, kills }));
  }

  sendSunRequest(n) {
    if (this.host || this.state !== 'playing' || !this.net || !(n > 0)) return;
    this.net.relay(encode('sun', { n: Math.round(n) }));
  }

  sendAoe(weaponId, pos) {
    if (this.host || this.state !== 'playing' || !this.net || !pos) return;
    this.net.relay(
      encode('aoe', {
        w: weaponId,
        x: round(pos.x),
        y: round(pos.y),
        z: round(pos.z),
        seq: this.game.lastWorldSeq || 0,
      })
    );
  }

  // guest → host：请求拿一件共享补给（kind 预留给阳光球）
  sendNextWave() {
    if (this.host || this.state !== 'playing' || !this.net) return;
    this.net.relay(encode('nextwave'));
  }

  sendClaim(kind, id) {
    if (this.host || this.state !== 'playing' || !this.net || !id) return;
    this.net.relay(encode('claim', { kind, id, seq: this.game.lastWorldSeq || 0 }));
  }

  // guest → host：丢枪也要在 host 的权威世界里落地，否则队友看不到
  sendPickupDrop(index, x, z) {
    if (this.host || this.state !== 'playing' || !this.net || !(index >= 0)) return;
    this.net.relay(
      encode('drop', {
        i: index,
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
      })
    );
  }

  // host → guest：共享补给列表（有变化才发，≤10 件）
  sendPickups(list) {
    if (!this.host || this.state !== 'playing' || !this.net) return;
    this.net.relay(encode('evt', { type: 'pickups', list: list || [] }));
  }

  // host → guest：客人刷新/重连后的完整世界快照（波次/阳光/分数/僵尸/补给/阳光球）
  sendResync(d) {
    if (!this.host || this.state !== 'playing' || !this.net || !d) return;
    this.net.relay(encode('resync', d));
  }

  sendEvent(d) {
    if (!this.host || this.state !== 'playing' || !this.net || !d) return;
    this.net.relay(encode('evt', d));
  }

  sendZombieSpawn(z) {
    if (!this.net || this.state !== 'playing' || !z || !z.serialize) return;
    this.net.relay(encode('evt', { type: 'zspawn', z: z.serialize() }));
  }

  sendZombieDead(z) {
    if (!this.net || this.state !== 'playing' || !z) return;
    this.net.relay(encode('evt', { type: 'zdead', id: z.netId }));
  }

  sendPause(on) {
    if (this.net) this.net.relay(encode(on ? 'pause' : 'resume'));
  }

  // 结算页「再来一局」：服务器收齐两个人的请求才换种子 + 换座位重开
  sendRematch() {
    if (this.state !== 'playing' || !this.net) return false;
    this.net.send(MSG.REMATCH);
    return true;
  }

  sendMap(id) {
    if (this.net) this.net.setMap(cleanMapId(id));
  }

  replaceUrl(url) {
    if (!url) return;
    try {
      if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', url);
    } catch (e) {
      // 沙箱 iframe 里可能禁止改地址
    }
  }

  clearJoinUrl() {
    if (typeof location === 'undefined') return;
    this.replaceUrl(location.origin + location.pathname);
  }

  close() {
    if (this.state === 'closed' && !this.net) return;
    this.state = 'closed';
    writeHostFlag(false);
    this.clearJoinUrl();
    if (this.game.hud && this.game.hud.setDuoShare) this.game.hud.setDuoShare('');
    const net = this.net;
    this.net = null;
    if (net) {
      net.send(MSG.BYE);
      net.close();
    }
    if (this.game.onDuoClosed) this.game.onDuoClosed(this);
  }
}
