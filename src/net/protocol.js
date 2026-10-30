// 双人联机协议：客户端与服务端共用。
// 这一层不碰 DOM、不碰 Three.js，Node 和浏览器都能直接 import。

export const PROTOCOL_VERSION = 1;

export const MAP_IDS = Object.freeze(['backyard', 'snow', 'dust']);
export const DEFAULT_MAP = 'backyard';

export const MAX_NAME = 16;
export const MAX_TOKEN = 64;
export const MAX_BUILD = 32;
export const MAX_MESSAGE = 64 * 1024;
export const MAX_RELAY = 32 * 1024;

export const MSG = Object.freeze({
  HELLO: 'hello',
  WELCOME: 'welcome',
  QUEUE: 'queue',
  PEER: 'peer',
  START: 'start',
  MAP: 'map',
  RELAY: 'relay',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  END: 'end',
  BYE: 'bye',
});

// 顶层控制消息的合法类型；relay 里的 state/pause/resume 是游戏内消息，不走这里。
const TOP_TYPES = new Set(Object.values(MSG));

export const ERR = Object.freeze({
  VERSION: 'VERSION',
  BUILD: 'BUILD',
  ACCESS: 'ACCESS',
  BUSY: 'BUSY',
  BAD: 'BAD',
  WAIT_TIMEOUT: 'WAIT_TIMEOUT',
  PEER_TIMEOUT: 'PEER_TIMEOUT',
  PEER_LEFT: 'PEER_LEFT',
  DUPLICATE: 'DUPLICATE',
  JOIN_EXPIRED: 'JOIN_EXPIRED',
  HOST_RESET: 'HOST_RESET',
});

export function isControlType(type) {
  return typeof type === 'string' && TOP_TYPES.has(type);
}

export function encode(type, data) {
  return JSON.stringify({ v: PROTOCOL_VERSION, t: type, d: data || {} });
}

export function decode(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length > MAX_MESSAGE) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!msg || msg.v !== PROTOCOL_VERSION || typeof msg.t !== 'string') return null;
  if (msg.d !== undefined && (msg.d === null || typeof msg.d !== 'object' || Array.isArray(msg.d))) return null;
  return { t: msg.t, d: msg.d || {} };
}

export function cleanName(name) {
  if (typeof name !== 'string') return '戴夫';
  const s = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return s || '戴夫';
}

export function cleanToken(token) {
  if (typeof token !== 'string') return null;
  const s = token.trim();
  if (s.length < 8 || s.length > MAX_TOKEN) return null;
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

export function cleanMapId(id) {
  return MAP_IDS.includes(id) ? id : DEFAULT_MAP;
}

export function cleanBuild(build) {
  if (typeof build !== 'string') return 'dev';
  const s = build.trim().slice(0, MAX_BUILD);
  return s || 'dev';
}

export function cleanRelay(payload) {
  if (typeof payload !== 'string') return null;
  if (payload.length > MAX_RELAY) return null;
  return payload;
}
