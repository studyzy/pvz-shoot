// 客户端网络栈：输入预测 + 服务器校正 + 僵尸插值。
//
// 取代 DuoSession 的「房主权威 + 字符串中继」。新模型下：
//   - 本地玩家：立刻用同一份 Player.update 预测移动，输入按 seq 存队列；
//     收到快照里的权威位置后比对，偏差超阈值就回滚重放未确认的输入。
//   - 远端玩家/僵尸：完全由服务器快照驱动，经插值缓冲平滑渲染。
//   - 服务器是唯一权威；客户端的任何「预测」都可以被校正。
import { MSG, encode, decode, cleanMapId } from './protocol.js';
import { NetClient } from './NetClient.js';
import { SnapshotBuffer } from './interpolate.js';
import { FRAME, encodeInput, decodeSnapshot } from '../sim/snapshot.js';
import { BTN } from '../sim/MatchSim.js';

// 位置偏差超过这个距离就回滚重放；小偏差直接平滑掉（避免为了毫米级误差抖镜头）
const RECONCILE_EPS = 0.12;
// 超过这个距离视为「瞬移」（重连/换图），直接吸附不做插值
const SNAP_DIST = 3.0;
const INPUT_HZ = 30;

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

export { ERR_TEXT, FATAL };

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// 邀请链接：?join=<token> 进来自动配对。
// 房主自己刷新时地址栏也带着 ?join=，要靠 sessionStorage 的房主标记区分，
// 否则房主刷新会变成「加入自己那一场」。
const HOST_FLAG = 'pvz-duo-host';

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

export function readHostFlag() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HOST_FLAG) === '1';
  } catch (e) {
    return false;
  }
}

export function writeHostFlag(v) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (v) sessionStorage.setItem(HOST_FLAG, '1');
    else sessionStorage.removeItem(HOST_FLAG);
  } catch (e) {
    // 隐私模式忽略
  }
}

// 页面启动时要不要自动进双人（邀请链接 / 房主刷新）
export function shouldAutoJoin() {
  if (readHostFlag()) return true;
  return !!readJoinParam();
}

export class ClientNet {
  constructor(game, opts = {}) {
    this.game = game;
    this.createNet = opts.createNet || ((o) => new NetClient(o));
    this.net = null;
    this.seat = -1;
    this.state = 'idle';
    this.peerName = '队友';
    this.matchId = null;
    this.matchMapId = null;
    this.seed = 0;

    this.buffer = new SnapshotBuffer();
    this.inputSeq = 0;
    this.pendingInputs = []; // [{seq, inp}]，还没被服务器确认的输入
    this.sendAcc = 0;
    this.latestSnap = null;
    this.lastSnapAt = 0;
    this.rtt = 0;

    // 上一次应用给渲染层的玩家权威位置（用于偏差判定）
    this.authPos = null;
    this.snapDist = 0;
    this.needsFullSnap = true;
  }

  start({ name, mapId, url, join } = {}) {
    if (this.net) return false;
    this.state = 'connecting';
    this.seat = -1;
    this.inputSeq = 0;
    this.pendingInputs.length = 0;
    this.buffer.clear();
    const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
    this.net = this.createNet({
      url,
      name: name || '戴夫',
      mapId: cleanMapId(mapId),
      build: env.VITE_BUILD_ID || 'dev',
      access: env.VITE_ACCESS_CODE || null,
      join: join !== undefined ? join : readHostFlag() ? null : readJoinParam(),
      onMessage: (m) => this.onMessage(m),
      onStatus: (s, info) => this.onStatus(s, info),
    });
    this.net.onBinary = (bytes) => this.onBinary(bytes);
    this.net.connect();
    return true;
  }

  onStatus(status) {
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
        this.matchMapId = d.mapId || this.matchMapId;
        this.seed = d.seed || 0;
        if (d.peer) this.peerName = d.peer;
        this.state = d.state === 'playing' ? 'playing' : 'waiting';
        writeHostFlag(!!d.host);
        if (d.host && d.joinToken) {
          this.joinToken = d.joinToken;
          const loc = typeof location !== 'undefined' ? location : null;
          this.shareUrl = loc ? loc.origin + loc.pathname + '?join=' + encodeURIComponent(d.joinToken) : '';
          if (this.game.hud && this.game.hud.setDuoShare) this.game.hud.setDuoShare(this.shareUrl);
          this.replaceUrl(this.shareUrl);
        }
        if (this.game.hud) {
          this.game.hud.setDuoStatus(
            this.state === 'playing'
              ? '已重连，等待同步…'
              : d.host
                ? '等待队友加入…（把网址发给朋友）'
                : '正在进入队友的对局…',
            this.state === 'playing' ? 'ok' : 'wait'
          );
        }
        break;
      case MSG.QUEUE:
        if (d.state === 'waiting') {
          this.state = 'waiting';
          if (this.game.hud) this.game.hud.setDuoStatus('等待队友加入…', 'wait');
        } else if (d.state === 'timeout') {
          if (this.game.hud) this.game.hud.setDuoStatus(ERR_TEXT.WAIT_TIMEOUT, 'warn');
          this.close();
        }
        break;
      case MSG.PEER:
        if (d.joined) {
          if (d.name) this.peerName = d.name;
          if (this.game.hud) this.game.hud.setDuoStatus('队友已加入，准备开始…', 'ok');
        } else {
          if (this.game.hud) this.game.hud.setDuoStatus('队友掉线了，等待重连…', 'warn');
          if (this.game.onPeerLeft) this.game.onPeerLeft(Number(d.reconnectIn) || 45);
        }
        break;
      case MSG.START:
        this.state = 'playing';
        this.matchMapId = d.mapId || this.matchMapId;
        this.seed = d.seed || this.seed;
        this.needsFullSnap = true;
        if (this.game.duo) {
          if (this.game.hud) this.game.hud.setDuoStatus('已重连', 'ok');
        } else {
          this.game.startDuo({
            mapId: this.matchMapId,
            seed: this.seed,
            t0: d.t0,
            seat: this.seat,
            peerName: this.peerName,
          });
        }
        break;
      case MSG.MAP:
        this.matchMapId = cleanMapId(d.id);
        if (this.game.state === 'menu') this.game.setMap(this.matchMapId);
        break;
      case MSG.END:
        this.state = 'closed';
        if (this.game.endDuo) this.game.endDuo(d.reason);
        this.close();
        break;
      case MSG.ERROR: {
        const text = ERR_TEXT[d.code] || d.message || '联机出错';
        if (this.game.hud) this.game.hud.setDuoStatus(text, 'warn');
        if (FATAL.has(d.code)) this.close();
        break;
      }
      default:
        break;
    }
  }

  // 二进制帧：快照 / 事件
  onBinary(bytes) {
    const kind = bytes[0];
    if (kind === FRAME.SNAP || kind === FRAME.FULL) {
      const snap = decodeSnapshot(bytes);
      if (!snap) return;
      this.onSnapshot(snap);
    } else if (kind === FRAME.EVENT || kind === 0x7b) {
      // 0x7b = '{'，兼容 JSON 事件帧
      this.onEventFrame(bytes);
    }
  }

  onSnapshot(snap) {
    this.latestSnap = snap;
    this.lastSnapAt = now();
    this.buffer.push(snap);
    this.game.applyServerSnapshot && this.game.applyServerSnapshot(snap);
  }

  onEventFrame(bytes) {
    try {
      const text = new TextDecoder().decode(bytes);
      const o = JSON.parse(text);
      if (o && o.t === 'ev' && Array.isArray(o.list)) {
        for (const ev of o.list) this.game.applyServerEvent && this.game.applyServerEvent(ev);
      }
    } catch (e) {
      // 坏帧直接丢
    }
  }

  // 每帧：发送输入
  update(dt) {
    if (this.state !== 'playing' || !this.net) return;
    this.sendAcc += dt;
    if (this.sendAcc < 1 / INPUT_HZ) return;
    this.sendAcc = 0;
    const inp = this.captureInput();
    if (!inp) return;
    this.inputSeq++;
    this.pendingInputs.push({ seq: this.inputSeq, inp });
    // 只保留最近 1 秒的未确认输入，防止极端网络下无限增长
    if (this.pendingInputs.length > 90) this.pendingInputs.shift();
    this.net.sendBinary(encodeInput(this.inputSeq, inp));
  }

  // 采集本地输入：视角用绝对值（预测与服务器必须完全一致）
  captureInput() {
    const g = this.game;
    const p = g.player;
    const c = g.controls;
    if (!p || !c) return null;
    let buttons = 0;
    if (c.firing) buttons |= BTN.FIRE;
    if (c.jumpQueued) buttons |= BTN.JUMP;
    if (g.wallNuts && g.wallNuts.active) buttons |= BTN.SHIELD;
    return {
      moveX: c.move ? c.move.x : 0,
      moveZ: c.move ? c.move.y : 0,
      yaw: p.yaw,
      pitch: p.pitch,
      buttons,
    };
  }

  // 服务器确认后的校正：返回 true 表示发生了回滚
  reconcile(authState) {
    const g = this.game;
    const p = g.player;
    if (!p || !authState) return false;
    const dx = p.pos.x - authState.x;
    const dz = p.pos.z - authState.z;
    const dist = Math.hypot(dx, dz);
    this.snapDist = dist;
    this.authPos = authState;

    // 大偏差：直接吸附（重连 / 换图 / 长时间卡顿）
    if (dist > SNAP_DIST) {
      p.pos.x = authState.x;
      p.pos.z = authState.z;
      p.pos.y = authState.y || 0;
      p.vel.x = 0;
      p.vel.z = 0;
      this.pendingInputs.length = 0;
      return true;
    }
    // 小偏差：平滑靠拢（不做全量重放，避免镜头抖动）
    if (dist > RECONCILE_EPS) {
      const k = 0.25;
      p.pos.x -= dx * k;
      p.pos.z -= dz * k;
      return true;
    }
    return false;
  }

  // 供渲染层取插值后的世界
  sampleWorld() {
    return this.buffer.sample(now());
  }

  get latencyMs() {
    return this.rtt;
  }

  // 暂停：服务器权威下「暂停」只影响本地表现，不通过网络锁住队友。
  // 单人对局本来就是本地暂停。这里保留空实现是为了兼容旧调用点，不发任何包。
  sendPause() {}

  // 本地改地图：告诉服务器下一局用哪张图
  sendMap(id) {
    if (!this.net) return false;
    this.matchMapId = cleanMapId(id);
    return this.net.setMap(this.matchMapId);
  }

  replaceUrl(url) {
    if (!url) return;
    try {
      if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', url);
    } catch (e) {
      // 沙箱 iframe 可能禁止改地址
    }
  }

  close() {
    if (this.state === 'closed' && !this.net) return;
    this.state = 'closed';
    writeHostFlag(false);
    const net = this.net;
    this.net = null;
    this.buffer.clear();
    if (net) {
      net.send(MSG.BYE);
      net.close();
    }
    if (this.game.onDuoClosed) this.game.onDuoClosed(this);
  }
}