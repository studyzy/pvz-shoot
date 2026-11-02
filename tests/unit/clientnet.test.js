// ClientNet 单元测试：输入上报、快照消费、校正、事件分发。
//
// ClientNet 是双人模式下客户端与服务器之间唯一的通道。
// 它出问题就是「打了没反应」那一类（2026-11 就踩过一次：开火上报挂错了钩子，
// 表现为「怎么打都不掉血」）。所以这里把每条对外接口都钉住。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientNet } from '../../src/net/ClientNet.js';
import { MSG } from '../../src/net/protocol.js';
import { FRAME } from '../../src/sim/snapshot.js';
import { BTN } from '../../src/sim/MatchSim.js';

// 假游戏：只提供 ClientNet 会用到的字段与方法
function makeGame() {
  return {
    state: 'menu',
    duo: null,
    seat: 0,
    player: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, yaw: 0, pitch: 0, dead: false, downed: false },
    controls: { firing: false, jumpQueued: false, move: { x: 0, y: 0 } },
    wallNuts: { active: false },
    hud: {
      setDuoStatus: vi.fn(),
      setDuoShare: vi.fn(),
      hitmarker: vi.fn(),
      showBanner: vi.fn(),
    },
    startDuo: vi.fn(),
    endDuo: vi.fn(),
    setMap: vi.fn(),
    onPeerLeft: vi.fn(),
    onDuoClosed: vi.fn(),
    applyServerSnapshot: vi.fn(),
    applyServerEvent: vi.fn(),
    weaponId: () => 'pea',
  };
}

// 假 NetClient：记录所有发出的帧，不连网
function makeFakeNet() {
  const sent = [];
  const net = {
    sent,
    connect: vi.fn(),
    close: vi.fn(() => {}),
    send: vi.fn(),
    sendBinary: vi.fn((bytes) => {
      sent.push(bytes);
      return true;
    }),
    setMap: vi.fn(() => true),
    onBinary: null,
  };
  return net;
}

function mk(game, opts = {}) {
  let fake = null;
  const session = new ClientNet(game, {
    createNet: (o) => {
      fake = makeFakeNet();
      fake.opts = o;
      return fake;
    },
    ...opts,
  });
  return { session, net: () => fake };
}

// 只包含 ClientNet 用到的字段的玩家输入快照
function startPlaying(session) {
  session.state = 'playing';
  session.seat = 0;
}

describe('ClientNet · 连接与配对', () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  it('start 会创建连接并置为 connecting；重复 start 返回 false', () => {
    const { session, net } = mk(game);
    expect(session.start({ name: 'A', mapId: 'snow' })).toBe(true);
    expect(session.state).toBe('connecting');
    expect(net().connect).toHaveBeenCalled();
    expect(session.start({ name: 'A' })).toBe(false);
  });

  it('welcome 写入座位/matchId/比分，并把状态切到 waiting', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { matchId: 'm1', seat: 1, mapId: 'dust', seed: 7, peer: 'B' } });
    expect(session.seat).toBe(1);
    expect(session.matchId).toBe('m1');
    expect(session.matchMapId).toBe('dust');
    expect(session.seed).toBe(7);
    expect(session.peerName).toBe('B');
    expect(session.state).toBe('waiting');
  });

  it('房主拿到 joinToken 时显示分享链接', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { seat: 0, host: true, joinToken: 'abc12345xyz' } });
    expect(session.joinToken).toBe('abc12345xyz');
    expect(game.hud.setDuoShare).toHaveBeenCalled();
  });

  it('start 消息在未进局时调用 game.startDuo', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.START, d: { mapId: 'backyard', seed: 3, t0: 1 } });
    expect(session.state).toBe('playing');
    expect(game.startDuo).toHaveBeenCalledWith(expect.objectContaining({ mapId: 'backyard', seed: 3 }));
  });

  it('已在局中时收到 start 不重复开一局（视为重连）', () => {
    const { session } = mk(game);
    session.start({});
    game.duo = { seat: 0 };
    session.onMessage({ t: MSG.START, d: { mapId: 'backyard' } });
    expect(game.startDuo).not.toHaveBeenCalled();
    expect(session.state).toBe('playing');
  });

  it('error 致命错误会关闭会话；非致命只提示', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.ERROR, d: { code: 'PEER_LEFT' } });
    expect(session.state).not.toBe('closed');
    session.onMessage({ t: MSG.ERROR, d: { code: 'BUILD' } });
    expect(session.state).toBe('closed');
  });

  it('end 消息结束对局', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.END, d: { reason: 'WIPE' } });
    expect(game.endDuo).toHaveBeenCalledWith('WIPE');
  });

  it('peer 离开会通知 game.onPeerLeft', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.PEER, d: { joined: false, reconnectIn: 45 } });
    expect(game.onPeerLeft).toHaveBeenCalledWith(45);
  });

  it('queue 超时会自动关闭', () => {
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.QUEUE, d: { state: 'timeout' } });
    expect(session.state).toBe('closed');
  });

  it('map 消息在菜单态才切图', () => {
    const { session } = mk(game);
    session.start({});
    game.state = 'playing';
    session.onMessage({ t: MSG.MAP, d: { id: 'snow' } });
    expect(game.setMap).not.toHaveBeenCalled();
    game.state = 'menu';
    session.onMessage({ t: MSG.MAP, d: { id: 'snow' } });
    expect(game.setMap).toHaveBeenCalledWith('snow');
  });

  it('连接状态变化会写 HUD 提示', () => {
    const { session } = mk(game);
    session.start({});
    session.onStatus('connecting');
    session.onStatus('open');
    session.onStatus('closed');
    session.onStatus('error');
    expect(game.hud.setDuoStatus).toHaveBeenCalledTimes(4);
  });
});

describe('ClientNet · 输入上报', () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  it('update 按 30Hz 节流发送输入帧', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    // 一帧 1/60 秒，要攒够 1/30 才发一次
    session.update(1 / 60);
    expect(net().sendBinary).not.toHaveBeenCalled();
    session.update(1 / 60);
    expect(net().sendBinary).toHaveBeenCalledTimes(1);
    const frame = net().sent[0];
    expect(frame[0]).toBe(FRAME.INPUT);
  });

  it('输入帧里带着当前视角与按钮状态', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    game.player.yaw = 1.2;
    game.player.pitch = -0.3;
    game.controls.move = { x: 0.5, y: 1 };
    game.controls.firing = true;
    game.controls.jumpQueued = true;
    game.wallNuts.active = true;
    session.update(1 / 30);
    const frame = net().sent[0];
    expect(frame[0]).toBe(FRAME.INPUT);
    // 解析回来核对
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getInt16(7, true) / 1000).toBeCloseTo(1.2, 2);
    expect(view.getInt16(9, true) / 1000).toBeCloseTo(-0.3, 2);
    const buttons = view.getUint8(11);
    expect(buttons & BTN.FIRE).toBeTruthy();
    expect(buttons & BTN.JUMP).toBeTruthy();
    expect(buttons & BTN.SHIELD).toBeTruthy();
  });

  it('未开局时不发输入', () => {
    const { session, net } = mk(game);
    session.start({});
    session.update(1 / 30);
    expect(net().sendBinary).not.toHaveBeenCalled();
  });

  it('未确认输入队列有上限，不会无限增长', () => {
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    for (let i = 0; i < 300; i++) session.update(1 / 30);
    expect(session.pendingInputs.length).toBeLessThanOrEqual(90);
  });

  it('sendFire 只上报朝向与武器，不含目标/伤害', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    game.player.yaw = 0.8;
    game.player.pitch = 0.1;
    expect(session.sendFire('pea')).toBe(true);
    const f = net().sent[0];
    expect(f[0]).toBe(FRAME.FIRE);
    // 载荷里没有 zid/dmg 这类字段的空间（长度固定 11 + weapon 长度）
    expect(f.byteLength).toBe(11 + 3);
  });

  it('倒地/死亡时不能开火', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    game.player.downed = true;
    expect(session.sendFire('pea')).toBe(false);
    game.player.downed = false;
    game.player.dead = true;
    expect(session.sendFire('pea')).toBe(false);
    expect(net().sendBinary).not.toHaveBeenCalled();
  });

  it('sendFire 带上延迟补偿的 tick 数', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    session.buffer.delayMs = 150;
    session.sendFire('pea');
    const f = net().sent[0];
    // 150ms / (1000/30) ≈ 4.5 → 5
    expect(f[10]).toBe(5);
  });

  it('sendSunSpend 上报花阳光', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    expect(session.sendSunSpend(20)).toBe(true);
    const f = net().sent[0];
    expect(f[0]).toBe(FRAME.SUN);
    expect(f.byteLength).toBe(3);
    expect(session.sendSunSpend(0)).toBe(false);
  });

  it('sendHit / sendAoe 兼容旧调用点，走同一条开火通道', () => {
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    session.sendHit('pea', 99, { x: 0, y: 0, z: 1 });
    session.sendAoe('cherry', { x: 1, y: 0, z: 1 });
    expect(net().sent).toHaveLength(2);
    expect(net().sent.every((f) => f[0] === FRAME.FIRE)).toBe(true);
  });
});

describe('ClientNet · 快照与校正', () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  it('二进制快照会进缓冲并交给 game.applyServerSnapshot', () => {
    const { session } = mk(game);
    session.start({});
    const snap = { tick: 5, players: [], zombies: [] };
    session.onSnapshot(snap);
    expect(session.latestSnap).toBe(snap);
    expect(game.applyServerSnapshot).toHaveBeenCalledWith(snap);
    expect(session.buffer.frameCount).toBe(1);
  });

  it('事件帧按条分发到 game.applyServerEvent', () => {
    const { session } = mk(game);
    session.start({});
    const bytes = new TextEncoder().encode(JSON.stringify({ t: 'ev', list: [{ t: 'wave', n: 3 }, { t: 'kill', seat: 0 }] }));
    session.onEventFrame(bytes);
    expect(game.applyServerEvent).toHaveBeenCalledTimes(2);
    expect(game.applyServerEvent.mock.calls[0][0].n).toBe(3);
  });

  it('坏事件帧被静默丢弃，不抛异常', () => {
    const { session } = mk(game);
    session.start({});
    expect(() => session.onEventFrame(new TextEncoder().encode('not json'))).not.toThrow();
    expect(game.applyServerEvent).not.toHaveBeenCalled();
  });

  it('小偏差只做平滑靠拢，不直接吸附', () => {
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    game.player.pos.x = 0;
    game.player.pos.z = 0;
    const changed = session.reconcile({ x: 0.5, y: 0, z: 0 });
    expect(changed).toBe(true);
    // 往权威位置靠了一部分，但没到
    expect(game.player.pos.x).toBeGreaterThan(0);
    expect(game.player.pos.x).toBeLessThan(0.5);
  });

  it('偏差在阈值内不校正', () => {
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    game.player.pos.x = 0;
    const changed = session.reconcile({ x: 0.05, y: 0, z: 0 });
    expect(changed).toBe(false);
    expect(game.player.pos.x).toBe(0);
  });

  it('大偏差直接吸附并清空未确认输入', () => {
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    session.pendingInputs = [{ seq: 1 }];
    game.player.pos.x = 0;
    const changed = session.reconcile({ x: 10, y: 0, z: 5 });
    expect(changed).toBe(true);
    expect(game.player.pos.x).toBe(10);
    expect(game.player.pos.z).toBe(5);
    expect(session.pendingInputs).toHaveLength(0);
  });

  it('reconcile 对空输入安全', () => {
    const { session } = mk(game);
    session.start({});
    expect(session.reconcile(null)).toBe(false);
  });

  it('onBinary 按首字节区分快照与事件', () => {
    const { session } = mk(game);
    session.start({});
    // 事件帧是 JSON（以 '{' 开头）
    session.onBinary(new TextEncoder().encode(JSON.stringify({ t: 'ev', list: [] })));
    expect(game.applyServerEvent).not.toHaveBeenCalled(); // 空 list
    // 非法帧不崩
    expect(() => session.onBinary(new Uint8Array([0xff]))).not.toThrow();
  });
});

describe('ClientNet · 会话收尾', () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  it('close 会发 bye、关连接、清缓冲并通知 game', () => {
    const { session, net } = mk(game);
    session.start({});
    session.onSnapshot({ tick: 1, players: [], zombies: [] });
    session.close();
    expect(session.state).toBe('closed');
    expect(session.net).toBeNull();
    expect(session.buffer.empty).toBe(true);
    expect(net().send).toHaveBeenCalledWith(MSG.BYE);
    expect(game.onDuoClosed).toHaveBeenCalled();
  });

  it('重复 close 不会重复回调', () => {
    const { session } = mk(game);
    session.start({});
    session.close();
    session.close();
    expect(game.onDuoClosed).toHaveBeenCalledTimes(1);
  });

  it('sendPause 是空操作（服务器权威下暂停只影响本地）', () => {
    const { session, net } = mk(game);
    session.start({});
    session.sendPause(true);
    expect(net().send).not.toHaveBeenCalled();
  });

  it('sendMap 转给底层连接', () => {
    const { session, net } = mk(game);
    session.start({});
    session.sendMap('snow');
    expect(net().setMap).toHaveBeenCalledWith('snow');
  });

  it('latencyMs / sampleWorld 暴露给渲染层', () => {
    const { session } = mk(game);
    session.start({});
    session.rtt = 42;
    expect(session.latencyMs).toBe(42);
    session.onSnapshot({ tick: 1, players: [], zombies: [] });
    expect(session.sampleWorld()).toBeTruthy();
  });
});
describe('ClientNet · 补充分支', () => {
  it('未知控制消息类型被忽略', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    expect(() => session.onMessage({ t: 'no-such-type', d: {} })).not.toThrow();
  });

  it('真正的二进制快照帧会被解析并分发', async () => {
    const { encodeSnapshot, setZombieTypes } = await import('../../src/sim/snapshot.js');
    const { ZOMBIES } = await import('../../src/config.js');
    setZombieTypes(Object.keys(ZOMBIES));
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    // playerState 必须返回完整字段，否则 encodeSnapshot 会按 24 字节/人 写越界
    const fakeSim = {
      tick: 3,
      sun: 50,
      scores: [0, 0],
      kills: [0, 0],
      players: [{}],
      playerState: () => ({ x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0, hp: 100, maxHp: 100, downed: false, dead: false, downTimer: 0 }),
      zombieStates: () => [],
      zombies: { wave: 1, state: 'spawning' },
    };
    const bytes = encodeSnapshot(fakeSim);
    session.onBinary(bytes);
    expect(game.applyServerSnapshot).toHaveBeenCalled();
    expect(session.latestSnap.tick).toBe(3);
  });

  it('截断的快照帧不会崩', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    expect(() => session.onBinary(new Uint8Array([0x20, 1, 2]))).not.toThrow();
    expect(game.applyServerSnapshot).not.toHaveBeenCalled();
  });

  it('game 缺少 player 时 captureInput 返回 null', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    game.player = null;
    expect(session.captureInput()).toBeNull();
    game.player = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, yaw: 0, pitch: 0 };
    game.controls = null;
    expect(session.captureInput()).toBeNull();
  });

  it('没有 wallNuts 时不发 SHIELD 位', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    delete game.wallNuts;
    const inp = session.captureInput();
    expect(inp.buttons & BTN.SHIELD).toBe(0);
  });

  it('没有 move 对象时移动量归零', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    startPlaying(session);
    delete game.controls.move;
    const inp = session.captureInput();
    expect(inp.moveX).toBe(0);
    expect(inp.moveZ).toBe(0);
  });

  it('reconcile 在 game 没有 player 时返回 false', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    game.player = null;
    expect(session.reconcile({ x: 1, y: 0, z: 1 })).toBe(false);
  });

  it('未连接时 sendFire / sendSunSpend 返回 false', () => {
    const game = makeGame();
    const { session } = mk(game);
    expect(session.sendFire('pea')).toBe(false);
    expect(session.sendSunSpend(10)).toBe(false);
  });

  it('sendMap 在未连接时安全', () => {
    const game = makeGame();
    const { session } = mk(game);
    expect(session.sendMap('snow')).toBe(false);
  });

  it('replaceUrl 在 history 抛错时不崩', () => {
    const game = makeGame();
    const { session } = mk(game);
    const orig = globalThis.history;
    try {
      Object.defineProperty(globalThis, 'history', {
        configurable: true,
        value: {
          replaceState() {
            throw new Error('blocked');
          },
        },
      });
      expect(() => session.replaceUrl('http://x/')).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'history', { configurable: true, value: orig });
    }
  });

  it('queue waiting 与 peer joined 会更新状态与提示', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.QUEUE, d: { state: 'waiting' } });
    expect(session.state).toBe('waiting');
    expect(game.hud.setDuoStatus).toHaveBeenCalledWith('等待队友加入…', 'wait');

    session.onMessage({ t: MSG.PEER, d: { joined: true, name: '小王' } });
    expect(session.peerName).toBe('小王');
  });

  it('host 收到 welcome 时拼出分享链接', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { seat: 0, host: true, joinToken: 'abc12345' } });
    expect(session.shareUrl).toContain('join=abc12345');
  });

  it('非 host 收到 welcome 时不生成分享链接', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { seat: 1, host: false } });
    expect(session.joinToken).toBeUndefined();
  });

  it('welcome 明确 state=playing 时直接进入 playing', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { seat: 0, host: false, state: 'playing' } });
    expect(session.state).toBe('playing');
  });

  it('房主标记在 welcome 时写入、close 时清除', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.start({});
    session.onMessage({ t: MSG.WELCOME, d: { seat: 0, host: true } });
    expect(sessionStorage.getItem('pvz-duo-host')).toBe('1');
    session.close();
    expect(sessionStorage.getItem('pvz-duo-host')).toBeNull();
  });
});

describe('ClientNet · 邀请链接与自动加入', () => {
  it('readJoinParam 从查询串里取 join', async () => {
    const { readJoinParam } = await import('../../src/net/ClientNet.js');
    expect(readJoinParam({ search: '?join=abc12345' })).toBe('abc12345');
    expect(readJoinParam({ search: '' })).toBeNull();
    expect(readJoinParam(null)).toBeNull();
  });

  it('shareUrlFor 拼出可分享的邀请链接', async () => {
    const { shareUrlFor } = await import('../../src/net/ClientNet.js');
    const url = shareUrlFor('abc12345', { origin: 'https://x.com', pathname: '/pvz/' });
    expect(url).toBe('https://x.com/pvz/?join=abc12345');
    expect(shareUrlFor(null, {})).toBe('');
    expect(shareUrlFor('abc', null)).toBe('');
  });

  it('readHostFlag / writeHostFlag 通过 sessionStorage 传递房主身份', async () => {
    const { readHostFlag, writeHostFlag } = await import('../../src/net/ClientNet.js');
    writeHostFlag(false);
    expect(readHostFlag()).toBe(false);
    writeHostFlag(true);
    expect(readHostFlag()).toBe(true);
    writeHostFlag(false);
    expect(readHostFlag()).toBe(false);
  });

  it('shouldAutoJoin：有邀请参数或房主标记时自动进双人', async () => {
    const { shouldAutoJoin, writeHostFlag } = await import('../../src/net/ClientNet.js');
    const orig = globalThis.location;
    try {
      writeHostFlag(false);
      // 地址栏带 ?join= → 自动加入
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?join=abc12345' } });
      expect(shouldAutoJoin()).toBe(true);
      // 无 join 无标记 → 不自动加入（单人路径）
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
      expect(shouldAutoJoin()).toBe(false);
      // 房主刷新：地址栏可能没 join，靠标记识别
      writeHostFlag(true);
      expect(shouldAutoJoin()).toBe(true);
      writeHostFlag(false);
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: orig });
    }
  });

  it('start 时把 join token 与回调交给底层连接', async () => {
    const game = makeGame();
    const { session, net } = mk(game);
    session.start({ name: '小王', mapId: 'dust', join: 'abc12345' });
    expect(net().opts.join).toBe('abc12345');
    expect(net().opts.name).toBe('小王');
    expect(net().opts.mapId).toBe('dust');
    expect(typeof net().opts.onMessage).toBe('function');
    expect(typeof net().opts.onStatus).toBe('function');
    // onBinary 也必须接上，否则收不到快照
    expect(typeof net().onBinary).toBe('function');
  });

  it('底层连接的回调真的接通到 ClientNet', async () => {
    const game = makeGame();
    const { session, net } = mk(game);
    session.start({});
    net().opts.onMessage({ t: MSG.WELCOME, d: { seat: 1 } });
    expect(session.seat).toBe(1);
    net().opts.onStatus('open');
    expect(game.hud.setDuoStatus).toHaveBeenCalled();
  });
});

describe('ClientNet · 异常兜底与防御性分支', () => {
  it('readJoinParam 在 URL 解析抛错时返回 null', async () => {
    const { readJoinParam } = await import('../../src/net/ClientNet.js');
    // search 是非法结构 → URLSearchParams 抛错
    expect(readJoinParam({ search: { toString() { throw new Error('x'); } } })).toBeNull();
  });

  it('shouldAutoJoin 在 storage 访问抛错时安全', async () => {
    const { shouldAutoJoin } = await import('../../src/net/ClientNet.js');
    const orig = globalThis.sessionStorage;
    try {
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get() { throw new Error('denied'); },
      });
      // 访问被拒绝时按「没有房主标记」处理，不抛异常
      expect(typeof shouldAutoJoin()).toBe('boolean');
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: orig });
    }
  });

  it('未注入 createNet 时用默认 NetClient', () => {
    const game = makeGame();
    // 不传 createNet：走默认构造（不会真的连网，只验证分支）
    const s = new ClientNet(game);
    expect(typeof s.createNet).toBe('function');
  });

  it('closed 状态下 onStatus 不再改 HUD', () => {
    const game = makeGame();
    const { session } = mk(game);
    session.state = 'closed';
    session.onStatus('open');
    expect(game.hud.setDuoStatus).not.toHaveBeenCalled();
  });

  it('没有 hud 时 onStatus 安全', () => {
    const game = makeGame();
    game.hud = null;
    const { session } = mk(game);
    expect(() => session.onStatus('open')).not.toThrow();
  });

  it('captureInput 返回 null 时不发输入', () => {
    const game = makeGame();
    const { session, net } = mk(game);
    session.start({});
    startPlaying(session);
    game.player = null;
    session.update(1 / 30);
    expect(net().sendBinary).not.toHaveBeenCalled();
  });

  it('replaceUrl 传空值直接返回', () => {
    const game = makeGame();
    const { session } = mk(game);
    expect(() => session.replaceUrl('')).not.toThrow();
    expect(() => session.replaceUrl(null)).not.toThrow();
  });
});
