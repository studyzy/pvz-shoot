import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  MSG,
  ERR,
  MAP_IDS,
  MAX_MESSAGE,
  MAX_RELAY,
  encode,
  decode,
  cleanName,
  cleanToken,
  cleanMapId,
  cleanBuild,
  cleanRelay,
  isControlType,
} from '../../src/net/protocol.js';

describe('联机协议', () => {
  it('encode/decode 往返，d 缺省为空对象', () => {
    const raw = encode(MSG.HELLO, { name: '戴夫', token: 'abcdefgh' });
    expect(decode(raw)).toEqual({ t: MSG.HELLO, d: { name: '戴夫', token: 'abcdefgh' } });
    expect(decode(encode('state'))).toEqual({ t: 'state', d: {} });
  });

  it('拒绝坏消息', () => {
    expect(decode(null)).toBeNull();
    expect(decode('not json')).toBeNull();
    expect(decode(JSON.stringify({ v: PROTOCOL_VERSION + 1, t: 'hello', d: {} }))).toBeNull();
    expect(decode(JSON.stringify({ v: PROTOCOL_VERSION, t: 42, d: {} }))).toBeNull();
    expect(decode(JSON.stringify({ v: PROTOCOL_VERSION, t: 'hello', d: [] }))).toBeNull();
    expect(decode(JSON.stringify({ v: PROTOCOL_VERSION, t: 'hello', d: null }))).toBeNull();
    expect(decode('x'.repeat(MAX_MESSAGE + 1))).toBeNull();
  });

  it('顶层控制消息类型白名单', () => {
    for (const t of Object.values(MSG)) expect(isControlType(t)).toBe(true);
    expect(isControlType('state')).toBe(false);
    expect(isControlType(42)).toBe(false);
  });

  it('名字清洗：去控制字符、trim、限长、空值兜底', () => {
    expect(cleanName('  \u0000 小明 \u007f ')).toBe('小明');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('')).toBe('戴夫');
    expect(cleanName(null)).toBe('戴夫');
  });

  it('token 清洗：8~64 位字母数字下划线横线', () => {
    expect(cleanToken('abcdefgh')).toBe('abcdefgh');
    expect(cleanToken('abc-def_12')).toBe('abc-def_12');
    expect(cleanToken('short')).toBeNull();
    expect(cleanToken('has space')).toBeNull();
    expect(cleanToken('x'.repeat(65))).toBeNull();
    expect(cleanToken(null)).toBeNull();
  });

  it('地图 id 兜底与 build 限长', () => {
    expect(cleanMapId('snow')).toBe('snow');
    expect(cleanMapId('lava')).toBe('backyard');
    expect(cleanMapId(null)).toBe('backyard');
    expect(cleanMapId('cloud')).toBe('cloud');
    // 不要在这里硬编码地图清单（曾经因为清单没跟着更新，导致新地图在联机时被静默改回后院）。
    // 只断言白名单本身是只读的、且非空；与 MAPS 注册表的一致性由下面的守卫用例负责。
    expect(MAP_IDS.length).toBeGreaterThan(0);
    expect(() => {
      MAP_IDS.push('x');
    }).toThrow();
    expect(cleanBuild(' v1 ')).toBe('v1');
    expect(cleanBuild(null)).toBe('dev');
    expect(cleanBuild('x'.repeat(40))).toHaveLength(32);
  });

  it('relay 载荷限长与类型', () => {
    expect(cleanRelay('x'.repeat(MAX_RELAY))).toHaveLength(MAX_RELAY);
    expect(cleanRelay('x'.repeat(MAX_RELAY + 1))).toBeNull();
    expect(cleanRelay({})).toBeNull();
    expect(ERR.PEER_TIMEOUT).toBe('PEER_TIMEOUT');
  });
});

// 守卫：三处地图清单必须一致，否则会出现「单人可以玩、双人选不到」或
// 「选了新地图被静默改回后院」这类只在联机时才暴露的问题。
describe('地图清单一致性（新增地图必查）', () => {
  it('MAPS 注册表 / MAP_IDS 白名单 / mapdata.json 三者完全一致', async () => {
    const { MAP_IDS } = await import('../../src/net/protocol.js');
    const { MAPS } = await import('../../src/world/maps.js');
    const mapdata = (await import('../../src/sim/headlessMap.js')).HEADLESS_MAP_IDS;
    const registry = MAPS.map((m) => m.id);
    const whitelist = [...MAP_IDS];
    const exported = [...mapdata];
    expect(whitelist.sort()).toEqual(registry.sort());
    expect(exported.sort()).toEqual(registry.sort());
  });
});
