// 二进制快照编解码：服务器发、客户端解。
//
// 为什么不用 JSON：实测 14 只僵尸的 JSON 快照 2.7KB/帧（@30Hz = 54KB/s），
// 而且 JSON.stringify 本身占服务器一半的 CPU。定点整数方案约 300B/帧，
// 省 85% 带宽、几乎没有序列化开销（见 docs/plans/2026-11-01-netcode-refactor.md §3.3）。
//
// 编码约定（全部小端）：
//   坐标 int16 = 厘米（±327.67 米，五张地图最大 90 米，够用）
//   角度 int16 = 弧度 × 1000（±32.7 rad，覆盖 ±π）
//   血量 int16 = 直接取整（僵尸最高血量远小于 32767）
import { TICK_RATE } from './MatchSim.js';

export const FRAME = Object.freeze({
  SNAP: 0x20,
  EVENT: 0x30,
  INPUT: 0x40,
  FIRE: 0x41,
  SUN: 0x42,
  FULL: 0x21,
});

const SCALE_POS = 100;
const SCALE_ANG = 1000;

function clampi(v, lo, hi) {
  const n = Math.round(v);
  return n < lo ? lo : n > hi ? hi : n;
}

function writePos(dv, off, v) {
  dv.setInt16(off, clampi(v * SCALE_POS, -32768, 32767), true);
  return off + 2;
}

function writeAng(dv, off, v) {
  dv.setInt16(off, clampi(v * SCALE_ANG, -32768, 32767), true);
  return off + 2;
}

// 僵尸类型表：把 30 个字符串类型压成 1 字节。
// 服务器与客户端都从同一份 config 生成，索引天然一致。
let TYPE_TABLE = null;
export function setZombieTypes(types) {
  TYPE_TABLE = types;
}
function typeIndex(name) {
  if (!TYPE_TABLE) return 0;
  const i = TYPE_TABLE.indexOf(name);
  return i < 0 ? 0 : i;
}
function typeAt(i) {
  return TYPE_TABLE && TYPE_TABLE[i] ? TYPE_TABLE[i] : 'normal';
}

// 僵尸状态位：动画/减速/悬赏/协同/空中
const ZS = { WALK: 1, ATTACK: 2, DYING: 4, SLOW: 8, BOUNTY: 16, COOP: 32, AIRBORNE: 64 };

// 单只僵尸：id(u16) type(u8) x,y,z(i16) yaw(i16) hp(i16) flags(u8) sp(u8) armor(i16) = 16 字节
const Z_BYTES = 16;

export function encodeSnapshot(sim, opts = {}) {
  const zs = sim.zombieStates();
  const nPlayers = sim.players.length;
  // 头 16 字节 + 玩家 24 字节/人 + 僵尸 16 字节/只
  const size = 16 + nPlayers * 24 + zs.length * Z_BYTES;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;

  dv.setUint8(o++, FRAME.SNAP);
  dv.setUint16(o, sim.tick & 0xffff, true);
  o += 2;
  dv.setUint8(o++, nPlayers);
  dv.setUint8(o++, Math.min(255, zs.length));
  dv.setInt16(o, clampi(sim.sun, -32768, 32767), true);
  o += 2;
  dv.setUint8(o++, Math.min(255, sim.zombies.wave));
  dv.setUint8(o++, sim.zombies.state === 'intermission' ? 1 : sim.zombies.state === 'spawning' ? 2 : 0);
  // 比分与击杀数：客户端 HUD 的唯一来源（服务器权威）
  for (let i = 0; i < 2; i++) {
    dv.setUint16(o, clampi(sim.scores[i] || 0, 0, 65535), true);
    o += 2;
  }
  for (let i = 0; i < 2; i++) {
    dv.setUint16(o, clampi(sim.kills[i] || 0, 0, 65535), true);
    o += 2;
  }

  for (let i = 0; i < nPlayers; i++) {
    const p = sim.playerState(i);
    o = writePos(dv, o, p.x);
    o = writePos(dv, o, p.y);
    o = writePos(dv, o, p.z);
    o = writeAng(dv, o, p.yaw);
    o = writeAng(dv, o, p.pitch);
    dv.setInt16(o, clampi(p.hp, 0, 32767), true);
    o += 2;
    dv.setInt16(o, clampi(p.maxHp, 0, 32767), true);
    o += 2;
    let f = 0;
    if (p.downed) f |= 1;
    if (p.dead) f |= 2;
    dv.setUint8(o++, f);
    dv.setUint8(o++, clampi((p.downTimer || 0) * 10, 0, 255));
  }

  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    dv.setUint16(o, z.id & 0xffff, true);
    o += 2;
    dv.setUint8(o++, typeIndex(z.t));
    o = writePos(dv, o, z.x);
    o = writePos(dv, o, z.y);
    o = writePos(dv, o, z.z);
    o = writeAng(dv, o, z.yaw);
    dv.setInt16(o, clampi(z.hp, 0, 32767), true);
    o += 2;
    let f = 0;
    if (z.st === 1) f |= ZS.WALK;
    if (z.st === 2) f |= ZS.ATTACK;
    if (z.st === 3) f |= ZS.DYING;
    if (z.sl) f |= ZS.SLOW;
    if (z.bo) f |= ZS.BOUNTY;
    if (z.co) f |= ZS.COOP;
    if (z.ab) f |= ZS.AIRBORNE;
    dv.setUint8(o++, f);
    dv.setUint8(o++, clampi((z.sp || 1) * 50, 0, 255));
    dv.setInt16(o, clampi(z.ar || 0, 0, 32767), true);
    o += 2;
  }

  return new Uint8Array(buf, 0, o);
}

export function decodeSnapshot(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const kind = dv.getUint8(o++);
  if (kind !== FRAME.SNAP && kind !== FRAME.FULL) return null;
  const tick = dv.getUint16(o, true);
  o += 2;
  const nPlayers = dv.getUint8(o++);
  const nZ = dv.getUint8(o++);
  const sun = dv.getInt16(o, true);
  o += 2;
  const wave = dv.getUint8(o++);
  const stateByte = dv.getUint8(o++);
  const state = stateByte === 1 ? 'intermission' : stateByte === 2 ? 'spawning' : 'idle';
  const scores = [dv.getUint16(o, true), dv.getUint16(o + 2, true)];
  o += 4;
  const kills = [dv.getUint16(o, true), dv.getUint16(o + 2, true)];
  o += 4;

  const players = [];
  for (let i = 0; i < nPlayers; i++) {
    const x = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const y = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const z = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const yaw = dv.getInt16(o, true) / SCALE_ANG;
    o += 2;
    const pitch = dv.getInt16(o, true) / SCALE_ANG;
    o += 2;
    const hp = dv.getInt16(o, true);
    o += 2;
    const maxHp = dv.getInt16(o, true);
    o += 2;
    const flags = dv.getUint8(o++);
    const downTimer = dv.getUint8(o++) / 10;
    players.push({ x, y, z, yaw, pitch, hp, maxHp, downed: !!(flags & 1), dead: !!(flags & 2), downTimer });
  }

  const zombies = [];
  for (let i = 0; i < nZ; i++) {
    const id = dv.getUint16(o, true);
    o += 2;
    const t = typeAt(dv.getUint8(o++));
    const x = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const y = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const z = dv.getInt16(o, true) / SCALE_POS;
    o += 2;
    const yaw = dv.getInt16(o, true) / SCALE_ANG;
    o += 2;
    const hp = dv.getInt16(o, true);
    o += 2;
    const flags = dv.getUint8(o++);
    const sp = dv.getUint8(o++) / 50;
    const armor = dv.getInt16(o, true);
    o += 2;
    zombies.push({
      id,
      t,
      x,
      y,
      z,
      yaw,
      hp,
      sp,
      ar: armor,
      st: flags & ZS.DYING ? 3 : flags & ZS.ATTACK ? 2 : flags & ZS.WALK ? 1 : 0,
      sl: flags & ZS.SLOW ? 1 : 0,
      bo: flags & ZS.BOUNTY ? 1 : 0,
      co: flags & ZS.COOP ? 1 : 0,
      ab: flags & ZS.AIRBORNE ? 1 : 0,
    });
  }

  return { tick, sun, wave, state, scores, kills, players, zombies };
}

// ---- 输入帧：客户端 → 服务器 ----
// 布局（共 12 字节）：
//   [0] kind  [1..4] seq(u32)  [5] moveX(i8)  [6] moveZ(i8)
//   [7..8] yaw(i16)  [9..10] pitch(i16)  [11] buttons(u8)
export const INPUT_BYTES = 12;

export function encodeInput(seq, inp) {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, FRAME.INPUT);
  dv.setUint32(1, seq >>> 0, true);
  dv.setInt8(5, clampi((inp.moveX || 0) * 127, -127, 127));
  dv.setInt8(6, clampi((inp.moveZ || 0) * 127, -127, 127));
  dv.setInt16(7, clampi((inp.yaw || 0) * SCALE_ANG, -32768, 32767), true);
  dv.setInt16(9, clampi((inp.pitch || 0) * SCALE_ANG, -32768, 32767), true);
  dv.setUint8(11, (inp.buttons || 0) & 0xff);
  return new Uint8Array(buf);
}

export function decodeInput(bytes) {
  if (!bytes || bytes.byteLength < INPUT_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== FRAME.INPUT) return null;
  return {
    seq: dv.getUint32(1, true),
    moveX: dv.getInt8(5) / 127,
    moveZ: dv.getInt8(6) / 127,
    yaw: dv.getInt16(7, true) / SCALE_ANG,
    pitch: dv.getInt16(9, true) / SCALE_ANG,
    buttons: dv.getUint8(11),
  };
}

// ---- 开火帧：客户端 → 服务器 ----
// 布局（11 + weaponLen 字节）：
//   [0] kind  [1..4] seq(u32)  [5..6] yaw(i16)  [7..8] pitch(i16)
//   [9] weaponLen  [10] aimTick(u8 相对量)  [11..] weapon(utf8)
//
// aimTick：客户端瞄准时的服务器 tick 与本包到达 tick 的差（回退帧数）。
// 致命细节：客户端渲染的是**插值后的旧位置**（比服务器晚 100~200ms），
// 如果服务器按当前位置判定，打移动目标必然偏后。所以客户端报告「我看到的是哪一帧」，
// 服务器回退到那一帧的快照做判定 —— 这就是标准的延迟补偿（lag compensation）。
export function encodeFire(seq, yaw, pitch, weaponId, aimLagTicks = 0) {
  const w = String(weaponId || '').slice(0, 24);
  const wb = new TextEncoder().encode(w);
  const buf = new ArrayBuffer(11 + wb.length);
  const dv = new DataView(buf);
  dv.setUint8(0, FRAME.FIRE);
  dv.setUint32(1, seq >>> 0, true);
  dv.setInt16(5, clampi(yaw * SCALE_ANG, -32768, 32767), true);
  dv.setInt16(7, clampi(pitch * SCALE_ANG, -32768, 32767), true);
  dv.setUint8(9, wb.length);
  dv.setUint8(10, clampi(aimLagTicks, 0, 255));
  const out = new Uint8Array(buf);
  out.set(wb, 11);
  return out.subarray(0, 11 + wb.length);
}

export function decodeFire(bytes) {
  if (!bytes || bytes.byteLength < 11) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== FRAME.FIRE) return null;
  const len = dv.getUint8(9);
  if (bytes.byteLength < 11 + len) return null;
  const weapon = new TextDecoder().decode(bytes.subarray(11, 11 + len));
  return {
    seq: dv.getUint32(1, true),
    yaw: dv.getInt16(5, true) / SCALE_ANG,
    pitch: dv.getInt16(7, true) / SCALE_ANG,
    aimLagTicks: dv.getUint8(10),
    weapon,
  };
}

// ---- 阳光消费：客户端 → 服务器 ----
// kind(u8) amount(u16) = 3 字节。服务器校验余额后才扣，防止客户端凭空加钱/超额花。
export const SUN_BYTES = 3;

export function encodeSun(amount) {
  const buf = new ArrayBuffer(SUN_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, FRAME.SUN);
  dv.setUint16(1, clampi(amount, 0, 65535), true);
  return new Uint8Array(buf);
}

export function decodeSun(bytes) {
  if (!bytes || bytes.byteLength !== SUN_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== FRAME.SUN) return null;
  return { amount: dv.getUint16(1, true) };
}

// ---- 事件帧：服务器 → 客户端，只做表现 ----
export function encodeEvents(events) {
  return new TextEncoder().encode(JSON.stringify({ t: 'ev', list: events }));
}

export function decodeEvents(bytes) {
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return o && o.t === 'ev' ? o.list : null;
  } catch (e) {
    return null;
  }
}

export { TICK_RATE, Z_BYTES };