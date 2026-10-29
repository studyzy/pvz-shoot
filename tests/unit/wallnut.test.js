import { describe, it, expect, vi, beforeEach } from 'vitest';

// 坚果墙免伤盾：套盾 / 吸收 / 破盾 / 开火扣盾 / 空中穿透 / 玩家移速惩罚 / 拦截位置
vi.mock('../../src/entities/ZombieModel.js', async (importOriginal) => {
  const THREE = await import('three');
  const actual = await importOriginal();
  return {
    ...actual,
    zombieModel: {
      started: true,
      ready: true,
      failed: false,
      scene: new THREE.Group(),
      clips: [],
      skeleton: { ready: true, failed: false, scene: new THREE.Group(), clips: [] },
    },
  };
});

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return {
    ...actual,
    WebGLRenderer: class {
      constructor(o) {
        Object.assign(this, makeFakeRenderer());
        this.domElement = o && o.canvas;
      }
    },
  };
});

let THREE;
let game;
let WEAPONS;

async function boot() {
  if (game) return game;
  const g = await import('../helpers/game.js');
  THREE = await import('three');
  ({ WEAPONS } = await import('../../src/config.js'));
  const created = await g.readyGame();
  game = created.game;
  game.start();
  return game;
}

const WALLNUT_IDX = 10;

describe('坚果墙 · 免伤盾基础', () => {
  beforeEach(async () => {
    await boot();
    game.wallNuts.clear();
    game.weapons.reset();
  });

  it('套盾后 active、盾血满值', () => {
    const w = game.wallNuts;
    expect(w.active).toBe(false);
    expect(w.raise()).toBe(true);
    expect(w.active).toBe(true);
    expect(w.hp).toBe(w.maxHp);
    expect(w.maxHp).toBe(WEAPONS.find((x) => x.id === 'wallnut').shieldHp);
  });

  it('盾还在时再次套盾无效（不叠加、不刷新）', () => {
    const w = game.wallNuts;
    w.raise();
    w.hp = 100;
    expect(w.raise()).toBe(false);
    expect(w.hp).toBe(100);
  });

  it('吸收伤害：盾掉血、玩家不掉血', () => {
    const w = game.wallNuts;
    w.raise();
    game.player.hp = 100;
    expect(w.absorb(30)).toBe(true);
    expect(w.hp).toBe(w.maxHp - 30);
    expect(game.player.hp).toBe(100);
  });

  it('破盾：active=false、碎裂粒子 + 音效 + 横幅', () => {
    const w = game.wallNuts;
    w.raise();
    const banner = vi.spyOn(game.hud, 'showBanner');
    const burst = vi.spyOn(game.particles, 'burst');
    expect(w.absorb(w.maxHp + 50)).toBe(true);
    expect(w.active).toBe(false);
    expect(w.hp).toBe(0);
    expect(w.shell.visible).toBe(false);
    expect(burst).toHaveBeenCalled();
    expect(banner).toHaveBeenCalledWith(expect.stringContaining('坚果'), expect.any(Number));
  });

  it('盾被打光后不再吸收（伤害回到玩家身上）', () => {
    const w = game.wallNuts;
    w.raise();
    w.absorb(w.maxHp);
    expect(w.absorb(10)).toBe(false);
  });

  it('C3：空中单位攻击时护盾不生效', () => {
    const w = game.wallNuts;
    w.raise();
    w.airborneAttacker = true;
    expect(w.absorb(30)).toBe(false);
    w.airborneAttacker = false;
    expect(w.absorb(30)).toBe(true);
  });

  it('C2：开火扣盾血，扣到 0 时盾碎', () => {
    const w = game.wallNuts;
    w.raise();
    expect(w.spendShot()).toBe(false);
    expect(w.hp).toBe(w.maxHp - 1);
    w.hp = 1;
    expect(w.spendShot()).toBe(true);
    expect(w.active).toBe(false);
  });

  it('盾壳颜色随血量变化（满血绿、低血清空 active）', () => {
    const w = game.wallNuts;
    w.raise();
    const full = w.shellMat.color.getHex();
    w.hp = w.maxHp * 0.3;
    w.applyColor();
    expect(w.shellMat.color.getHex()).not.toBe(full);
  });

  it('update：盾壳跟随玩家位置', () => {
    const w = game.wallNuts;
    w.raise();
    game.player.pos.set(3, 0, -4);
    w.update(1 / 60);
    expect(w.shell.position.x).toBe(3);
    expect(w.shell.position.z).toBe(-4);
  });

  it('clear 复位盾与破盾计时', () => {
    const w = game.wallNuts;
    w.raise();
    w.clear();
    expect(w.active).toBe(false);
    expect(w.shell.visible).toBe(false);
  });
});

describe('坚果墙 · 接入 Player', () => {
  beforeEach(async () => {
    await boot();
    game.wallNuts.clear();
    game.player.hp = game.player.maxHp;
    game.player.dead = false;
    game.player.invuln = 0;
  });

  it('damage() 在盾生效时不扣血，且不重置 sinceDamage（回血计时照走）', () => {
    const w = game.wallNuts;
    w.raise();
    game.player.sinceDamage = 5;
    expect(game.player.damage(20)).toBe(false);
    expect(game.player.hp).toBe(game.player.maxHp);
    expect(game.player.sinceDamage).toBe(5);
    expect(w.hp).toBe(w.maxHp - 20);
  });

  it('盾碎了之后 damage() 正常扣血', () => {
    const w = game.wallNuts;
    w.raise();
    w.absorb(w.maxHp);
    const before = game.player.hp;
    expect(game.player.damage(20)).toBe(true);
    expect(game.player.hp).toBe(before - 20);
  });

  it('盾生效时移动速度按 shieldMoveMul 打折', () => {
    const w = game.wallNuts;
    expect(game.player.speedMul).toBe(1);
    w.raise();
    expect(game.player.speedMul).toBeCloseTo(WEAPONS.find((x) => x.id === 'wallnut').shieldMoveMul, 5);
  });
});

describe('坚果墙 · WeaponSystem 套盾分支', () => {
  beforeEach(async () => {
    await boot();
    game.wallNuts.clear();
    game.weapons.reset();
  });

  it('花 25 阳光、扣 1 颗充能、套上盾', async () => {
    const g = await import('../helpers/game.js');
    g.readyToFire(game, 999);
    const W = game.weapons;
    const sun = game.sun;
    W.equip(WALLNUT_IDX);
    const charges = W.charges[WALLNUT_IDX];
    W.cooldown = 0;
    W.tryFire(WEAPONS[WALLNUT_IDX]);
    expect(game.wallNuts.active).toBe(true);
    expect(game.sun).toBe(sun - WEAPONS[WALLNUT_IDX].cost);
    expect(W.charges[WALLNUT_IDX]).toBe(charges - 1);
  });

  it('盾还在时按坚果：拒绝音、不扣阳光', async () => {
    const g = await import('../helpers/game.js');
    g.readyToFire(game, 999);
    const W = game.weapons;
    const deny = vi.spyOn(game.sfx, 'deny');
    W.equip(WALLNUT_IDX);
    W.cooldown = 0;
    W.tryFire(WEAPONS[WALLNUT_IDX]);
    const sun = game.sun;
    const charges = W.charges[WALLNUT_IDX];
    W.cooldown = 0;
    W.tryFire(WEAPONS[WALLNUT_IDX]);
    expect(deny).toHaveBeenCalled();
    expect(game.sun).toBe(sun);
    expect(W.charges[WALLNUT_IDX]).toBe(charges);
  });

  it('阳光不够：不套盾、播拒绝', async () => {
    const g = await import('../helpers/game.js');
    g.readyToFire(game, 0);
    const W = game.weapons;
    W.equip(WALLNUT_IDX);
    W.cooldown = 0;
    W.tryFire(WEAPONS[WALLNUT_IDX]);
    expect(game.wallNuts.active).toBe(false);
  });

  it('充能不足时不能套盾', async () => {
    const g = await import('../helpers/game.js');
    g.readyToFire(game, 999);
    const W = game.weapons;
    W.charges[WALLNUT_IDX] = 0;
    W.equip(WALLNUT_IDX);
    W.cooldown = 0;
    W.tryFire(WEAPONS[WALLNUT_IDX]);
    expect(game.wallNuts.active).toBe(false);
  });

  it('充能按 recharge 秒回一颗，封顶 maxCharges', async () => {
    const g = await import('../helpers/game.js');
    const W = game.weapons;
    const def = WEAPONS[WALLNUT_IDX];
    W.charges[WALLNUT_IDX] = 2;
    W.update(def.recharge * 2 + 0.01, game.controls);
    expect(W.charges[WALLNUT_IDX]).toBeGreaterThan(3.9);
    W.charges[WALLNUT_IDX] = def.maxCharges;
    W.update(10, game.controls);
    expect(W.charges[WALLNUT_IDX]).toBe(def.maxCharges);
    void g;
  });

  it('reset 把充能补满并清掉盾', async () => {
    const W = game.weapons;
    game.wallNuts.raise();
    W.charges[WALLNUT_IDX] = 0;
    W.reset();
    expect(game.wallNuts.active).toBe(false);
    expect(W.charges[WALLNUT_IDX]).toBe(WEAPONS[WALLNUT_IDX].maxCharges);
  });

  it('开火后额外扣盾血（spendShieldOnShot）', () => {
    const W = game.weapons;
    game.wallNuts.raise();
    const before = game.wallNuts.hp;
    W.spendShieldOnShot();
    expect(game.wallNuts.hp).toBe(before - 1);
  });
});

describe('火豌豆 · 开火与弹丸参数', () => {
  beforeEach(async () => {
    await boot();
    game.wallNuts.clear();
    game.weapons.reset();
  });

  it('火豌豆开火：spawnPea 收到 burn / armorBreak / aerial', async () => {
    const g = await import('../helpers/game.js');
    g.readyToFire(game, 999);
    const spawn = vi.spyOn(game.projectiles, 'spawnPea').mockImplementation(() => {});
    const idx = WEAPONS.findIndex((w) => w.id === 'firepea');
    game.weapons.equip(idx);
    game.weapons.cooldown = 0;
    game.weapons.assist = null;
    game.weapons.tryFire(WEAPONS[idx]);
    expect(spawn).toHaveBeenCalled();
    const def = spawn.mock.calls[0][2];
    expect(def.burn).toEqual({ dps: 8, time: 3 });
    expect(def.armorBreak).toBe(true);
    expect(def.aerial).toBe(0.25);
    spawn.mockRestore();
  });

  it('真实 spawnPea：空中白名单与燃烧字段落到了弹丸实例上', () => {
    const P = game.projectiles;
    const def = WEAPONS.find((w) => w.id === 'firepea');
    P.spawnPea(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), def, false);
    const pea = P.peas.find((p) => p.active);
    expect(pea.aerial).toBe(0.25);
    expect(pea.burn).toEqual({ dps: 8, time: 3 });
    expect(pea.armorBreak).toBe(true);
    P.clear();
  });

  it('普通豌豆：aerial=0（打不到空中目标）', () => {
    const P = game.projectiles;
    const def = WEAPONS.find((w) => w.id === 'pea');
    P.spawnPea(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), def, false);
    const pea = P.peas.find((p) => p.active);
    expect(pea.aerial).toBe(0);
    P.clear();
  });
});