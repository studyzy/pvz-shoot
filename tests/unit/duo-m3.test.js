import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/entities/RemotePlayer.js', () => ({
  RemotePlayer: class {
    constructor() {
      this.root = { position: { x: 0, y: 0, z: 0 } };
    }
    update() {}
    dispose() {}
    setTransform() {}
    setTarget() {}
    setMoving() {}
    setFiring() {}
  },
}));

async function installThreeMock() {
  vi.doMock('three', async (importOriginal) => {
    const actual = await importOriginal();
    const { makeFakeRenderer } = await import('../helpers/game.js');
    class FakeWebGLRenderer {
      constructor(opts) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = (opts && opts.canvas) || null;
      }
    }
    return { ...actual, WebGLRenderer: FakeWebGLRenderer };
  });
}
await installThreeMock();

let readyGame;
let config;
let RemoteShield;
beforeAll(async () => {
  ({ readyGame } = await import('../helpers/game.js'));
  config = await import('../../src/config.js');
  ({ RemoteShield } = await import('../../src/entities/WallNuts.js'));
});

async function boot() {
  const { game } = await readyGame();
  return game;
}

function sessionStub() {
  return {
    sendEvent: vi.fn(),
    sendPickups: vi.fn(),
    sendClaim: vi.fn(),
    sendPickupDrop: vi.fn(),
    sendResync: vi.fn(),
    sendRematch: vi.fn(),
    sendWipe: vi.fn(),
    captureInput: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
  };
}

function snap(over = {}) {
  return { id: 1, t: 'normal', x: 1, y: 0, z: 2, yaw: 0, hp: 100, st: 0, sl: 0, ...over };
}

describe('双人缩放 DUO', () => {
  it('duoWavePlan：非 Boss ×1.5，Boss 仍只 1 只', () => {
    const plan = ['normal', 'normal', 'cone', 'boss'];
    const out = config.duoWavePlan(plan);
    expect(out.filter((t) => t === 'boss')).toHaveLength(1);
    expect(out.filter((t) => t !== 'boss')).toHaveLength(5);
    expect(config.duoWavePlan(['boss'])).toEqual(['boss']);
  });

  it('host 开波时应用数量/血量/间隔/休整缩放', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    expect(game.zombies.duo).toBe(true);
    expect(game.maxSun).toBe(config.DUO.maxSun);
    expect(game.sun).toBe(config.DUO.startSun);
    expect(game.skySun.interval).toBe(config.DUO.skySunInterval);
    expect(game.sunOrbs.orbs.length).toBeGreaterThanOrEqual(config.DUO.sunOrbPool);

    game.zombies.startWave(3);
    const soloCount = config.wavePlan(3).filter((t) => !(config.ZOMBIES[t] && config.ZOMBIES[t].boss)).length;
    const duoCount = game.zombies.queue.filter((t) => !(config.ZOMBIES[t] && config.ZOMBIES[t].boss)).length;
    expect(duoCount).toBe(Math.round(soloCount * config.DUO.countMul));
    expect(game.zombies.hpMul).toBeCloseTo(config.zombieHpMul(3) * config.DUO.hpMul, 6);
    expect(game.zombies.interval).toBeCloseTo(config.waveSpawnInterval(3) * config.DUO.spawnIntervalMul, 6);
    expect(game.zombies.airQuota).toBe(config.waveAirQuota(3) + config.DUO.airQuotaBonus);
  });
});

describe('共享补给 claim', () => {
  it('guest 不本地刷、镜像 host 列表后就近 claim', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    const session = sessionStub();
    game.duoSession = session;
    expect(game.pickups.shared).toBe(true);
    expect(game.pickups.items.some((it) => it.active)).toBe(false);

    const repeater = config.WEAPONS.findIndex((w) => w.id === 'repeater');
    game.applyWorldEvent({ type: 'pickups', list: [{ id: 9, i: repeater, x: 4, z: 5 }] });
    const item = game.pickups.byId(9);
    expect(item).toBeTruthy();
    expect(item.index).toBe(repeater);

    game.player.pos.x = 4;
    game.player.pos.z = 5;
    game.update(1 / 60);
    expect(session.sendClaim).toHaveBeenCalledWith('pickup', 9);
  });

  it('host 校验 guest 距离后移除并广播 pickup 事件', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    const session = sessionStub();
    game.duoSession = session;
    const repeater = config.WEAPONS.findIndex((w) => w.id === 'repeater');
    game.pickups.dropAt(repeater, 2, 3);
    // 开局还会随机刷一个点位道具，按 dropped 精确定位刚丢下的这把
    const item = game.pickups.items.find((it) => it.active && it.dropped);
    expect(item).toBeTruthy();

    // 太远：不认
    game.netGuest.pos.x = 20;
    game.netGuest.pos.z = 20;
    game.applyGuestClaim({ kind: 'pickup', id: item.id });
    expect(game.pickups.byId(item.id)).toBeTruthy();

    game.netGuest.pos.x = 2.2;
    game.netGuest.pos.z = 3;
    game.applyGuestClaim({ kind: 'pickup', id: item.id });
    expect(game.pickups.byId(item.id)).toBeNull();
    expect(session.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pickup', seat: 1, index: repeater })
    );
  });

  it('guest 丢枪交给 host 落地', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    const session = sessionStub();
    game.duoSession = session;
    game.netGuest.pos.x = 1;
    game.netGuest.pos.z = 1;
    game.applyGuestDrop({ i: 4, x: 1.5, z: 1.5 });
    expect(game.pickups.items.some((it) => it.active && it.index === 4)).toBe(true);
  });
});

describe('阳光球同步', () => {
  it('serialize / applyNet / collectById 保留稳定 id', async () => {
    const game = await boot();
    const so = game.sunOrbs;
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    so.spawnSky(1, 2);
    const list = so.serialize();
    expect(list).toHaveLength(1);
    expect(typeof list[0].id).toBe('number');
    expect(list[0].s).toBe(1);

    const guest = await boot();
    guest.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    guest.sunOrbs.applyNet(list);
    const view = guest.sunOrbs.orbs.find((o) => o.active);
    expect(view.id).toBe(list[0].id);
    expect(view.pos.x).toBe(1);

    expect(so.collectById(list[0].id)).toBeTruthy();
    expect(so.serialize()).toHaveLength(0);
  });

  it('guest 就近发 sun claim', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    const session = sessionStub();
    game.duoSession = session;
    game.sunOrbs.applyNet([{ id: 7, x: 0, y: 0.5, z: 0, s: 0 }]);
    game.player.pos.x = 0.2;
    game.player.pos.z = 0.2;
    game.sunOrbs.updateRemote(0.1, game.player, (id) => game.duoSession.sendClaim('sun', id));
    expect(session.sendClaim).toHaveBeenCalledWith('sun', 7);
  });
});

describe('坚果盾按玩家独立结算', () => {
  it('RemoteShield 只挡地面伤害，破碎后不再吸收', () => {
    const sh = new RemoteShield(100);
    expect(sh.absorb(10)).toBe(false);
    sh.active = true;
    expect(sh.absorb(30)).toBe(true);
    expect(sh.hp).toBe(70);
    expect(sh.absorb(10, { airborne: true })).toBe(false);
    sh.hp = 5;
    sh.absorb(20);
    expect(sh.hp).toBe(0);
    expect(sh.active).toBe(false);
  });

  it('host 按 guest input 维护盾血，guest 碎盾时本地有反馈', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    game.applyGuestInput({ m: [0, 0], look: [0, 0], shield: true, sh: 0 });
    expect(game.netGuest.shield.active).toBe(true);
    expect(game.netGuest.shield.hp).toBe(config.WEAPONS.find((w) => w.id === 'wallnut').shieldHp);

    game.applyGuestInput({ m: [0, 0], look: [0, 0], shield: true, sh: 0 });
    expect(game.netGuest.shield.hp).toBe(400);

    const guest = await boot();
    guest.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    guest.netShieldHp = 400;
    guest.wallNuts.hp = 400;
    guest.applyGuestAuth({ hp: 100, sh: 0 });
    expect(guest.wallNuts.hp).toBe(0);
  });
});

describe('resync / 结算 / 再来一局', () => {
  it('guest 应用 host 完整快照', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 1, peerName: '戴夫 A' });
    game.applyResync({
      wave: 4,
      sun: 123,
      scores: [10, 20],
      kills: [1, 2],
      z: [snap({ id: 3 })],
      pickups: [{ id: 5, i: 4, x: 1, z: 1 }],
      orbs: [{ id: 8, x: 0, y: 0.5, z: 0, s: 0 }],
    });
    expect(game.zombies.wave).toBe(4);
    expect(game.sun).toBe(123);
    expect(game.duoStats).toEqual([10, 20]);
    expect(game.zombies.zombies).toHaveLength(1);
    expect(game.pickups.byId(5)).toBeTruthy();
    expect(game.sunOrbs.serialize()).toHaveLength(1);
  });

  it('团灭后停在结算页，再来一局请求发给服务器', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    const session = sessionStub();
    game.duoSession = session;
    game.player.downed = true;
    game.player.downTimer = 0.01;
    game.netGuest.downed = true;
    game.netGuest.downTimer = 0.01;
    game.updateDuoRescue(0.1);
    expect(game.state).toBe('over');
    expect(game.duo).not.toBeNull();
    game.requestDuoRematch();
    expect(session.sendRematch).toHaveBeenCalled();
  });

  it('startDuoRound 换座重开并清空上一局', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    const session = sessionStub();
    game.duoSession = session;
    game.duoStats = [10, 20];
    game.startDuoRound({ mapId: 'backyard', seat: 1, seed: 9, t0: 1, round: 1 });
    expect(game.seat).toBe(1);
    expect(game.duoStats).toEqual([0, 0]);
    expect(game.state).toBe('playing');
    expect(game.isGuestWorld()).toBe(true);
  });
});

describe('双人 M3 玩法', () => {
  it('协同集火：两人 2 s 内都命中后，伤害 ×1.08', async () => {
    const game = await boot();
    const { spawnZombieAt } = await import('../helpers/game.js');
    const mob = spawnZombieAt(game, 'normal', 2, 2, {});
    mob.spawnT = 1;
    const hp0 = mob.hp;
    mob.hit(10, false, false, { source: 0 });
    mob.hit(10, false, false, { source: 1 });
    expect(mob.coop).toBe(true);
    const before = mob.hp;
    mob.hit(10, false, false, { source: 0 });
    expect(before - mob.hp).toBeCloseTo(10 * config.COOP.mul, 5);
    expect(hp0 - mob.hp).toBeGreaterThan(20);
  });

  it('悬赏怪：host 开波刷出金色标记，击杀按来源 +300', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    const zm = game.zombies;
    zm.startWave(2);
    zm.bountyPending = true;
    zm.spawnTimer = 0;
    const z = zm.spawnOne(game.player);
    expect(z).toBeTruthy();
    expect(z.bounty).toBe(true);
    const before = game.duoStats[1];
    game.onKill(z, z.scoreValue, false, 1);
    expect(game.duoStats[1]).toBe(before + z.scoreValue + config.BOUNTY.bonus);
  });

  it('空投：光柱后落地，拾取者 +200 分、全队 +40 阳光', async () => {
    const game = await boot();
    game.startDuo({ mapId: 'backyard', seat: 0, peerName: '戴夫 B' });
    game.duoSession = sessionStub();
    game.zombies.wave = config.AIRDROP.everyWaves;
    game.airdropWave = -1;
    game.updateAirdrop(config.AIRDROP.delay - config.AIRDROP.warn);
    expect(game.airdropBeam).toBe(true);
    game.updateAirdrop(config.AIRDROP.warn + 0.1);
    const air = game.pickups.items.find((it) => it.active && it.air);
    expect(air).toBeTruthy();
    const sun0 = game.sun;
    game.grantAirdrop(1);
    expect(game.duoStats[1]).toBe(config.AIRDROP.score);
    expect(game.sun).toBe(Math.min(game.maxSun, sun0 + config.AIRDROP.sun));
  });
});
