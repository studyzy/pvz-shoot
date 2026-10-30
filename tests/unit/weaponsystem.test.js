// WeaponSystem：切枪 / 拾取 / 开火（阳光、弹药、冷却）/ 辅助瞄准 / hitscan 玉米炮。
// 用真实 Game（createGame）做输入输出，只把 ProjectileSystem 的 spawnPea / throwCherry / explodeAt
// 换成探针，方便断言“开火到底以什么参数发出去了什么”。
//
// 注意：这里用 doMock（不提升）而不是 vi.mock——vi.mock 的工厂会在同一个注册阶段里
// 又去 import three（为了拿 actual），导致「已加载的 actual 缓存」先于 mock 生效。
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// three 的替身必须在任何 src 模块被加载之前装好。
// ⚠ 实测顺序：一旦先加载真 three（哪怕只是 await import('three')），vite 会在同一批请求里
// 把 Game.js 也拉起来，替身就失效；所以只能在这里 doMock，并在 boot() 里先加载 helpers。

const DT = 1 / 60;

let THREE;
let WEAPONS;
let WEAPON_SLOTS;
let GRENADE;
let TUNING;
let game;
let W;
let H;

async function boot() {
  if (game) return;
  // 顺序很重要：createGame 内部才动态 import Game.js；若先 import three 再进 Game，
  // vite 会在 request 队列里提前加载真 three，替身就不生效了（实测）。
  H = await import('../helpers/game.js');
  THREE = await import('three');
  ({ WEAPONS, TUNING, WEAPON_SLOTS, GRENADE } = await import('../../src/config.js'));
  // readyGame：等 zombieModel 就绪，spawnZombieAt 才不会拿到 null 场景
  const created = await H.readyGame();
  game = created.game;
  game.start();
  W = game.weapons;
}

// 清掉自动波次与场上僵尸
function clearField() {
  const zm = game.zombies;
  zm.queue = [];
  zm.state = 'idle';
  zm.reset();
}

function spawn(type, x, z, opts = {}) {
  return H.spawnZombieAt(game, type, x, z, { speedMul: 0, ...opts });
}

// 开火用探针：记录 spawnPea / throwCherry / explodeAt 的调用参数
function probeProjectiles() {
  const peas = [];
  const cherries = [];
  const explosions = [];
  const P = game.projectiles;
  const orig = {
    spawnPea: P.spawnPea,
    throwCherry: P.throwCherry,
    explodeAt: P.explodeAt,
  };
  P.spawnPea = function (origin, dir, def, headshot) {
    peas.push({ origin: origin.clone(), dir: dir.clone(), def, headshot });
  };
  P.throwCherry = function (origin, target, def) {
    cherries.push({ origin: origin.clone(), target: target.clone(), def });
  };
  P.explodeAt = function (pos, radius, damage, big, headTarget, headshot) {
    explosions.push({ pos: pos.clone(), radius, damage, big, headTarget, headshot });
    return 0;
  };
  return { peas, cherries, explosions, restore: () => Object.assign(P, orig) };
}

// 让当前武器立刻可以开火
// 每个用例都从"手上只有初始植物、槽位全空"开始：槽位是跨用例残留的状态，
// 不在这里清会让 pickup/drop 类用例互相污染（那些用例以前只需清 carried 一个变量）。
function arm(sun = 999) {
  H.readyToFire(game, sun);
  W.slots = W.makeSlots();
  W.mountPea();
  W.activeSlot = null;
  W.charge = 0;
  W.locked = false;
  for (let i = 0; i < WEAPONS.length; i++) {
    if (!WEAPONS[i].starter) W.ammo[i] = 0;
  }
  W.current = 0;
}

// 一次“按下开火 → 走一帧 → 松开”的完整手势
function fireOnce() {
  game.controls.setFiring(false);
  game.controls.firePressed = false;
  game.controls.setFiring(true);
  game.update(DT);
  game.controls.setFiring(false);
}

// 让相机水平朝 -Z（yaw=0 / pitch=0），并同步到相机矩阵
function lookForward() {
  const p = game.player;
  p.yaw = 0;
  p.pitch = 0;
  p.recoil = 0;
  p.applyCamera(game.camera);
}

beforeAll(async () => {
  // 重置模块图后再打 three 替身：这样 helpers/src 都会在替身生效后重新加载
  vi.resetModules();
  vi.doMock('three', async (importOriginal) => {
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
  await boot();
}, 60000);

describe('装备与切换', () => {
  it('构造后默认手持豌豆（index 0），只有当前武器视图模型可见', () => {
    expect(W.current).toBe(0);
    expect(W.models.length).toBe(WEAPONS.length);
    expect(W.models[0].group.visible).toBe(true);
    for (let i = 1; i < W.models.length; i++) expect(W.models[i].group.visible).toBe(false);
    expect(W.root.parent).toBe(game.camera); // 视图模型挂在相机上
  });

  it('ammo 初始化：只有豌豆无限，其它武器要靠拾取才有弹药', () => {
    expect(W.ammo[0]).toBe(Infinity); // 豌豆常驻 1 号槽
    expect(W.ammo[1]).toBe(0); // 寒冰现在是枪②的候选，不再白给
    expect(W.ammo[4]).toBe(0); // repeater
    expect(W.ammo[9]).toBe(0); // jalapeno
  });

  it('equip 越界索引被忽略（负数 / 超出）', () => {
    arm();
    W.equip(-1);
    expect(W.current).toBe(0);
    W.equip(WEAPONS.length);
    expect(W.current).toBe(0);
    W.equip(99);
    expect(W.current).toBe(0);
  });

  it('equip 切到槽里的武器：视图模型、HUD、swapAnim、click 音效', () => {
    arm();
    W.current = 0;
    W.pickup(5); // 三线进枪②
    W.equip(0);
    const click = vi.spyOn(game.sfx, 'click');
    const setWeapon = vi.spyOn(game.hud, 'setWeapon');
    const setAmmo = vi.spyOn(game.hud, 'setAmmo');
    W.equip(5);
    expect(W.current).toBe(5);
    expect(W.models[5].group.visible).toBe(true);
    expect(W.models[0].group.visible).toBe(false);
    expect(W.swapAnim).toBe(1);
    expect(setWeapon).toHaveBeenCalledWith(5);
    // 三线是弹匣制：弹药条显示 满/满
    expect(setAmmo).toHaveBeenLastCalledWith(WEAPONS[5].ammo, WEAPONS[5].ammo, true, false);
    expect(click).toHaveBeenCalled();
  });

  it('equip(silent) 不播 click 音效', () => {
    arm();
    W.pickup(5);
    const click = vi.spyOn(game.sfx, 'click');
    W.equip(5, true);
    expect(W.current).toBe(5);
    expect(click).not.toHaveBeenCalled();
    W.equip(0, true);
  });

  it('非 starter 且弹药为 0 时 equip 无效', () => {
    arm();
    W.current = 0;
    W.ammo[4] = 0;
    W.equip(4);
    expect(W.current).toBe(0);
    expect(W.models[4].group.visible).toBe(false);
  });

  it('豌豆常驻 1 号枪槽：开局就在、不能被丢弃、被任何拾取顶掉', () => {
    arm();
    expect(W.slots.peaGun).toEqual([0]);
    // 直接往豌豆槽里塞别的东西也不行
    expect(W.pickup(1)).toBe(true);
    expect(W.slots.peaGun).toEqual([0]);
    expect(W.pickup(2)).toBe(true); // 樱桃进手雷槽
    expect(W.slots.peaGun).toEqual([0]);
    // 豌豆不许丢
    const dropAt = vi.fn();
    game.pickups.dropAt = dropAt;
    game.ctx.pickups = game.pickups;
    expect(W.dropSlot('peaGun', 0)).toBe(false);
    expect(W.slots.peaGun).toEqual([0]);
    expect(dropAt).not.toHaveBeenCalled();
    W.dropSlot('grenade', 0);
  });

  it('pickup：越界返回 false；植物栏的植物能捡进对应角色槽；豌豆槽永不被顶替', () => {
    arm();
    expect(W.pickup(999)).toBe(false);
    // 豌豆常驻 1 号枪槽，任何拾取都不能动它
    expect(W.slots.peaGun[0]).toBe(0);
    expect(W.pickup(1)).toBe(true);
    expect(W.slots.peaGun).toEqual([0]);
    // 樱桃 → 手雷槽
    expect(W.pickup(2)).toBe(true);
    expect(W.slots.grenade[0]).toBe(2);
    W.dropSlot('grenade', 0);
  });

  it('pickup：按 slot 归入角色槽、满弹、清锁定、装备、HUD 回调', () => {
    arm();
    const def = WEAPONS[5]; // 三线射手 → gun
    const setSlots = vi.spyOn(game.hud, 'setSlots');
    const banner = vi.spyOn(game.hud, 'showBanner');
    const pickupSfx = vi.spyOn(game.sfx, 'pickup');
    W.locked = true;
    expect(W.pickup(5)).toBe(true);
    expect(W.slots.gun[0]).toBe(5);
    expect(W.slots.peaGun[0]).toBe(0);
    expect(W.activeSlot).toEqual({ role: 'gun', pos: 0 });
    expect(W.ammo[5]).toBe(def.ammo);
    expect(W.locked).toBe(false);
    expect(W.current).toBe(5);
    expect(W.models[5].group.visible).toBe(true);
    expect(setSlots).toHaveBeenCalled();
    expect(banner).toHaveBeenCalledWith(`拾取 ${def.name} · ${def.ammo} 发`, 1.8);
    expect(pickupSfx).toHaveBeenCalled();
    W.dropLoot();
  });

  it('枪②只一格：捡第二把枪顶掉第一把；大杀器进自己的槽，互不影响', () => {
    arm();
    game.pickups.dropAt = vi.fn();
    game.ctx.pickups = game.pickups;
    W.pickup(4); // 双发 → gun[0]
    expect(W.slots.gun).toEqual([4]);
    W.pickup(8); // 西瓜 → demo[0]
    expect(W.slots.gun).toEqual([4]); // 大杀器不占枪槽
    W.pickup(6); // 机枪 → 顶掉枪②里的双发
    expect(W.slots.gun).toEqual([6]);
    expect(W.ammo[4]).toBe(0);
    expect(W.ammo[6]).toBe(WEAPONS[6].ammo);
    expect(W.slots.demo).toEqual([8]);
    expect(W.slots.peaGun).toEqual([0]);
    W.equipSlot('demo', 0);
    expect(W.current).toBe(8);
    W.dropSlot('demo', 0);
    W.dropSlot('gun', 0);
  });

  it('同角色槽满了就替换：旧枪掉在脚边、不弹窗', () => {
    arm();
    const dropAt = vi.fn();
    game.pickups.dropAt = dropAt;
    game.ctx.pickups = game.pickups;
    W.pickup(4); // 双发 → gun[0]
    const banner = vi.spyOn(game.hud, 'showBanner');
    expect(W.pickup(5)).toBe(true); // 三线顶掉双发
    expect(W.slots.gun).toEqual([5]);
    expect(W.ammo[4]).toBe(0);
    expect(W.current).toBe(5);
    expect(dropAt).toHaveBeenCalledWith(4, expect.any(Number), expect.any(Number));
    expect(banner).toHaveBeenCalled();
    expect(W.replacePrompt).toBeUndefined();
  });

  it('手上是大杀器时捡枪，照样只顶掉枪②，不影响大杀器', () => {
    arm();
    game.pickups.dropAt = vi.fn();
    game.ctx.pickups = game.pickups;
    W.pickup(4);
    W.pickup(8);
    W.equipSlot('demo', 0);
    expect(W.pickup(5)).toBe(true);
    expect(W.slots.gun).toEqual([5]);
    expect(W.slots.demo).toEqual([8]);
  });

  it('重复拾取同一把：补满原槽弹药，不占新格子', () => {
    arm();
    W.pickup(4);
    W.ammo[4] = 12;
    expect(W.pickup(4)).toBe(true);
    expect(W.ammo[4]).toBe(WEAPONS[4].ammo);
    expect(W.slots.gun).toEqual([4]);
    W.dropLoot();
  });

  it('dropSlot：清空该槽、枪掉到地面、手持时切回豌豆', () => {
    arm();
    const dropAt = vi.fn();
    game.pickups.dropAt = dropAt;
    game.ctx.pickups = game.pickups;
    W.pickup(5);
    const banner = vi.spyOn(game.hud, 'showBanner');
    expect(W.dropSlot('gun', 0)).toBe(true);
    expect(W.slots.gun).toEqual([-1]);
    expect(W.ammo[5]).toBe(0);
    expect(W.current).toBe(0);
    expect(dropAt).toHaveBeenCalledWith(5, expect.any(Number), expect.any(Number));
    expect(banner).toHaveBeenCalledWith(`${WEAPONS[5].name} 已丢下`, 1.4);
  });

  it('dropSlot 空槽 / 越界 / 未知角色都是空操作', () => {
    arm();
    expect(W.dropSlot('gun', 0)).toBe(false);
    expect(W.dropSlot('gun', -1)).toBe(false);
    expect(W.dropSlot('gun', 99)).toBe(false);
    expect(W.dropSlot('nope', 0)).toBe(false);
  });

  it('dropLoot 只丢当前手上的那个槽', () => {
    arm();
    game.pickups.dropAt = vi.fn();
    game.ctx.pickups = game.pickups;
    W.pickup(4);
    W.pickup(6);
    W.equipSlot('gun', 0);
    W.dropLoot();
    expect(W.slots.gun).toEqual([-1]);
  });

  it('dropLoot 在手持初始植物时是空操作', () => {
    arm();
    W.pickup(4);
    W.equip(0);
    const dropAt = vi.fn();
    game.pickups.dropAt = dropAt;
    game.ctx.pickups = game.pickups;
    W.dropLoot();
    expect(dropAt).not.toHaveBeenCalled();
    expect(W.slots.gun[0]).toBe(4);
    W.dropSlot('gun', 0);
  });

  it('cycleSlot 跳过空槽与没有枪的格子', () => {
    arm();
    W.pickup(4);
    W.pickup(8);
    W.equip(0);
    W.cycleSlot(1);
    expect(W.current).toBe(4);
    W.cycleSlot(1);
    expect(W.current).toBe(8);
    W.cycleSlot(-1);
    expect(W.current).toBe(4);
    for (const role of Object.keys(W.slots)) {
      for (let pos = 0; pos < W.slots[role].length; pos++) W.dropSlot(role, pos);
    }
  });

  it('equipSlot / equip 不会装备"不在槽里的战利品"', () => {
    arm();
    expect(W.equipSlot('gun', 0)).toBe(false);
    expect(W.equipSlot('gun', 99)).toBe(false);
    expect(W.equipSlot('nope', 0)).toBe(false);
    W.equip(6); // 6 号枪没捡过，不该被装备
    expect(W.current).toBe(0);
  });

  it('reset 把一切恢复到开局状态', () => {
    W.pickup(5);
    W.pickup(6);
    W.current = 3;
    W.cooldown = 2;
    W.recoil = 1;
    W.reset();
    expect(W.current).toBe(0);
    expect(W.slots).toEqual({ peaGun: [0], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] });
    // 重开后手上是常驻的豌豆，占位符指向 1 号枪槽
    expect(W.activeSlot).toEqual({ role: 'peaGun', pos: 0 });
    expect(W.charge).toBe(0);
    expect(W.cooldown).toBe(0);
    expect(W.recoil).toBe(0);
    expect(W.ammo[0]).toBe(Infinity);
    expect(W.ammo[5]).toBe(0);
  });
});

describe('开火：阳光与冷却', () => {
  it('弹匣打空且阳光不够续弹：不花钱、不进入冷却、HUD deny 提示', () => {
    clearField();
    arm(5);
    W.pickup(3); // 玉米炮进大杀器槽
    W.ammo[3] = 0;
    W.cooldown = 0;
    const deny = vi.spyOn(game.sfx, 'deny');
    const denySun = vi.spyOn(game.hud, 'denySun');
    lookForward();
    fireOnce();
    expect(game.sun).toBe(5);
    expect(W.cooldown).toBe(0);
    expect(deny).toHaveBeenCalled();
    expect(denySun).toHaveBeenCalled();
    W.dropSlot('demo', 0);
    W.current = 0;
  });

  it('弹匣武器（寒冰）开火扣弹药、不直接扣阳光，并进入冷却', () => {
    clearField();
    arm(100);
    W.pickup(1); // 寒冰进枪②
    const def = WEAPONS[1];
    const before = W.ammo[1];
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(W.ammo[1]).toBe(before - 1);
      expect(game.sun).toBe(100); // 弹匣内开火不扣阳光
      expect(W.cooldown).toBeCloseTo(def.cooldown, 9);
      expect(probe.peas.length).toBe(1);
      expect(probe.peas[0].def).toBe(def);
    } finally {
      probe.restore();
    }
    W.dropSlot('gun', 0);
    W.current = 0;
  });

  it('cooldown 内再次开火无效（不带穿透）', () => {
    clearField();
    arm(999);
    W.current = 0; // 豌豆 cooldown 0.15
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.peas.length).toBe(1);
      const sunAfterFirst = game.sun;
      W.cooldown = 0.05;
      fireOnce();
      expect(probe.peas.length).toBe(1);
      expect(game.sun).toBe(sunAfterFirst);
    } finally {
      probe.restore();
    }
  });

  it('非 starter：扣弹药不扣阳光，打空后不丢枪、阳光够自动续弹', () => {
    clearField();
    arm(500);
    const idx = 5;
    const def = WEAPONS[idx];
    W.pickup(idx);
    const probe = probeProjectiles();
    try {
      lookForward();
      W.ammo[idx] = 1;
      fireOnce();
      expect(W.ammo[idx]).toBe(0);
      expect(game.sun).toBe(500);
      // 枪留在手里，不会自动丢弃
      expect(W.locked).toBe(false);
      expect(W.slotIndexOf(idx)).toBeTruthy();

      // 再开火：自动续一整梭子并立刻打出一发
      W.cooldown = 0;
      fireOnce();
      const reloadCost = def.cost * def.ammo;
      expect(game.sun).toBe(500 - reloadCost);
      expect(W.ammo[idx]).toBe(def.ammo - 1);
      expect(W.slotIndexOf(idx)).toBeTruthy();
      expect(W.locked).toBe(false);
      expect(probe.peas.length).toBeGreaterThanOrEqual(1);
    } finally {
      probe.restore();
    }
  });

  it('打空且阳光不足：锁定不丢枪，补足阳光后自动续弹', () => {
    clearField();
    arm(0);
    const idx = 5;
    const def = WEAPONS[idx];
    W.pickup(idx);
    const probe = probeProjectiles();
    try {
      lookForward();
      W.ammo[idx] = 0;
      W.cooldown = 0;
      fireOnce();
      // 打不出去、钱不够、但枪还在
      expect(probe.peas.length).toBe(0);
      expect(W.slotIndexOf(idx)).toBeTruthy();
      expect(W.locked).toBe(true);

      // 补足阳光后再开火就自动续弹
      game.sun = def.cost * def.ammo;
      W.cooldown = 0;
      fireOnce();
      expect(W.locked).toBe(false);
      expect(W.ammo[idx]).toBe(def.ammo - 1);
      expect(game.sun).toBe(0);
      expect(probe.peas.length).toBeGreaterThanOrEqual(1);
    } finally {
      probe.restore();
    }
  });

  it('没弹药且续弹也付不起：只打出拒绝音，枪仍在手', () => {
    clearField();
    arm(0);
    W.pickup(4);
    W.ammo[4] = 0;
    W.cooldown = 0;
    const probe = probeProjectiles();
    try {
      lookForward();
      fireOnce();
      expect(probe.peas.length).toBe(0);
      expect(W.slotIndexOf(4)).toBeTruthy();
      expect(W.locked).toBe(true);
    } finally {
      probe.restore();
    }
  });

  it('开火后 recoil 增加、玩家后坐力生效、onFire 与枪口粒子被调用', () => {
    clearField();
    arm(999);
    W.current = 0;
    W.recoil = 0;
    game.player.recoil = 0;
    W.cooldown = 0;
    const onFire = vi.spyOn(game.hud, 'fadeTutorial');
    const addRecoil = vi.spyOn(game.player, 'addRecoil');
    const muzzle = vi.spyOn(game.particles, 'muzzle');
    const burst = vi.spyOn(game.particles, 'burst');
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(W.recoil).toBeCloseTo(0.9, 9);
      expect(addRecoil).toHaveBeenCalledWith(WEAPONS[0].recoil * 0.0055);
      expect(onFire).toHaveBeenCalled();
      expect(muzzle).toHaveBeenCalled();
      // 豌豆：粒子爆发 count = 4 + shots*2
      expect(burst).toHaveBeenCalled();
      expect(burst).toHaveBeenCalled();
      expect(burst.mock.calls[0][0].count).toBe(6);
      expect(game.player.recoil).toBeGreaterThan(0);
    } finally {
      probe.restore();
      W.reset();
    }
  });

  it('视角后坐力上限 0.22', () => {
    clearField();
    arm(999);
    W.current = 0;
    lookForward();
    game.player.recoil = 0;
    const probe = probeProjectiles();
    try {
      for (let i = 0; i < 40; i++) {
        W.cooldown = 0;
        fireOnce();
      }
      expect(game.player.recoil).toBeLessThanOrEqual(0.22);
    } finally {
      probe.restore();
      W.reset();
    }
  });

  it('reset() 会把准星从圆形（投掷物）切回直线', () => {
    const spy = vi.spyOn(game.hud, 'setCrosshair');
    W.reset();
    expect(spy).toHaveBeenCalledWith(false);
    spy.mockRestore();
  });

  it('swapAnim / recoil 随时间衰减', () => {
    W.swapAnim = 1;
    W.recoil = 1;
    W.cooldown = 1;
    game.weapons.update(0.25, game.controls);
    expect(W.swapAnim).toBe(0); // max(0, 1 - 0.25*4)
    expect(W.recoil).toBe(0); // max(0, 1 - 0.25*6)
    expect(W.cooldown).toBeCloseTo(0.75, 9);
  });
});

describe('开火：准星与弹道一致（回归）', () => {
  // 旧实现从枪口（视图模型里、比准星低 0.28 米、偏右 0.25 米）朝准星打：
  // 近距离系统性偏右下、远一点偏右，玩家看到的准星和落点永远是两回事。
  it('豌豆从相机（准星）出发、正前方水平打：每颗子弹的 y 都等于眼睛高度', () => {
    clearField();
    arm(999);
    W.current = 0;
    W.cooldown = 0;
    lookForward();
    game.player.recoil = 0;
    game.player.applyCamera(game.camera);
    game.camera.updateMatrixWorld(true);
    const eyeY = game.camera.position.y;
    const probe = probeProjectiles();
    try {
      fireOnce();
      const pea = probe.peas[0];
      expect(pea.origin.y).toBeCloseTo(eyeY, 9);
      expect(pea.origin.distanceTo(game.camera.position)).toBeCloseTo(0, 9);
      // 正前方平打：方向水平
      expect(Math.abs(pea.dir.y)).toBeLessThan(1e-6);
    } finally {
      probe.restore();
      W.reset();
    }
  });

  it('准星正对僵尸时弹丸方向就指着它（不再被枪口位置带偏）', () => {
    clearField();
    arm(999);
    W.current = 0;
    W.cooldown = 0;
    lookForward();
    const p = game.player.pos;
    const zombie = spawn('normal', p.x, p.z - 12);
    const chest = new THREE.Vector3();
    zombie.getChest(chest);
    const eye = new THREE.Vector3(0, game.camera.position.y, p.z);
    game.player.pitch = Math.atan2(chest.y - eye.y, 12);
    game.player.yaw = Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z));
    game.player.recoil = 0;
    game.player.applyCamera(game.camera);
    game.camera.updateMatrixWorld(true);
    const toChest = chest.clone().sub(game.camera.position).normalize();
    const probe = probeProjectiles();
    try {
      fireOnce();
      // 有辅助瞄准时瞄点会吸附到胸口；无论吸没吸，方向都必须贴近"相机→瞄准点"
      const pea = probe.peas[0];
      if (W.assist) {
        const aim = W.resolveAssist(W.assist).point;
        expect(pea.dir.dot(aim.clone().sub(game.camera.position).normalize())).toBeGreaterThan(0.9999);
      } else {
        expect(pea.dir.dot(toChest)).toBeGreaterThan(0.999);
      }
    } finally {
      probe.restore();
      clearField();
      W.reset();
    }
  });

  it('西瓜有重力：throwCherry 收到准星落点，落点不在相机高度上', () => {
    clearField();
    arm(999);
    W.pickup(8);
    W.current = 8;
    W.cooldown = 0;
    lookForward();
    game.player.pitch = -0.3;
    game.player.applyCamera(game.camera);
    game.camera.updateMatrixWorld(true);
    const probe = probeProjectiles();
    try {
      fireOnce();
      const { target, def } = probe.cherries[0];
      expect(def.arc).toBe(true);
      expect(target.y).toBeCloseTo(0, 9); // 落点贴地
      const horiz = Math.hypot(target.x - game.camera.position.x, target.z - game.camera.position.z);
      expect(horiz).toBeGreaterThan(2);
      expect(horiz).toBeLessThan(6);
    } finally {
      probe.restore();
      W.dropLoot();
    }
  });

  it('准星锁定了僵尸时，西瓜落点直接砸在它脚下（不被视线投影带过头顶）', () => {
    clearField();
    arm(999);
    W.pickup(8);
    W.current = 8;
    W.cooldown = 0;
    lookForward();
    const p = game.player.pos;
    const zombie = spawn('normal', p.x + 3, p.z - 10);
    const chest = new THREE.Vector3();
    zombie.getChest(chest);
    game.player.pitch = Math.atan2(chest.y - 1.66, Math.hypot(chest.x, chest.z - p.z));
    game.player.yaw = Math.atan2(-(chest.x - p.x), -(chest.z - p.z));
    game.player.recoil = 0;
    game.player.applyCamera(game.camera);
    game.camera.updateMatrixWorld(true);
    const probe = probeProjectiles();
    try {
      fireOnce();
      const { target } = probe.cherries[0];
      expect(target.x).toBeCloseTo(zombie.root.position.x, 6);
      expect(target.z).toBeCloseTo(zombie.root.position.z, 6);
    } finally {
      probe.restore();
      W.dropLoot();
      clearField();
    }
  });
});

describe('开火：弹道分支', () => {
  it('双发射手（repeater）：一次 2 发、左右各偏一半扩散角', () => {
    clearField();
    arm(500);
    const idx = 4;
    const def = WEAPONS[idx];
    W.pickup(idx);
    W.cooldown = 0;
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.peas.length).toBe(def.shots);
      expect(probe.peas.length).toBe(2);
      // 两发方向关于正前方对称：yaw 偏 ±spread/2
      const forward = new THREE.Vector3(0, 0, -1);
      // off = (s - (shots-1)/2) * spread；两发的水平夹角应等于 spread
      const yawOf = (d) => Math.atan2(-d.x, -d.z);
      const d0 = yawOf(probe.peas[0].dir);
      const d1 = yawOf(probe.peas[1].dir);
      expect(d1 - d0).toBeCloseTo(def.spread, 5);
      // 两发分别偏向基础瞄准方向的左右两侧
      const aimYaw = yawOf(game.camera.getWorldDirection(new THREE.Vector3()));
      expect((d0 - aimYaw) * (d1 - aimYaw)).toBeLessThan(0);
      expect(probe.peas[0].dir.dot(forward)).toBeGreaterThan(0.99);
    } finally {
      probe.restore();
      W.dropLoot();
    }
  });

  it('三线射手：一次 3 发、扩散 ±spread（整体张角 2×spread）', () => {
    clearField();
    arm(500);
    const idx = 5;
    const def = WEAPONS[idx];
    W.pickup(idx);
    W.cooldown = 0;
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.peas.length).toBe(3);
      // 三发与瞄准方向的夹角应为 -spread / 0 / +spread
      const aim = game.camera.getWorldDirection(new THREE.Vector3());
      const offs = probe.peas.map((p) => Math.atan2(-p.dir.x, -p.dir.z)).sort((a, b) => a - b);
      const aimYaw = Math.atan2(-aim.x, -aim.z);
      // 视图模型的朝向（baseRot.y ≈ 0.46）会给整组子弹一个很小的整体偏移，
      // 所以只校验相邻间隔与瞄准方向的一致性（误差 < 0.01 rad）
      expect(offs[1] - offs[0]).toBeCloseTo(def.spread, 2);
      expect(offs[2] - offs[1]).toBeCloseTo(def.spread, 2);
      expect(Math.abs(offs[1] - aimYaw)).toBeLessThan(0.01);
    } finally {
      probe.restore();
      W.dropLoot();
    }
  });

  it('仙人掌：spawnPea 收到 pierce', () => {
    clearField();
    arm(500);
    const idx = 7;
    const def = WEAPONS[idx];
    expect(def.pierce).toBe(2);
    W.pickup(idx);
    W.cooldown = 0;
    lookForward();
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.peas.length).toBe(1);
      expect(probe.peas[0].def.pierce).toBe(2);
    } finally {
      probe.restore();
      W.dropLoot();
    }
  });

  it('单发武器带 headshot 标记时透传给 spawnPea', () => {
    clearField();
    arm(999);
    W.current = 0;
    lookForward();
    const p = game.player.pos;
    const zombie = spawn('cone', p.x, p.z - 12);
    const head = new THREE.Vector3();
    zombie.getHead(head);
    const probe = probeProjectiles();
    try {
      // 准星直接压在头部球上：assist 会解析成 head
      game.player.yaw = Math.atan2(-(head.x - p.x), -(head.z - p.z));
      game.player.pitch = Math.atan2(head.y - (p.y + 1.66), Math.hypot(head.x - p.x, head.z - p.z));
      game.player.applyCamera(game.camera);
      W.cooldown = 0;
      fireOnce();
      expect(probe.peas.length).toBe(1);
      expect(probe.peas[0].headshot).toBe(true);
    } finally {
      probe.restore();
      clearField();
      W.reset();
    }
  });

  it('樱桃（手雷）：蓄力期间不投出，松手才走 throwCherry，且不调 spawnPea', () => {
    clearField();
    arm(999);
    W.current = 2;
    W.cooldown = 0;
    lookForward();
    const throwSfx = vi.spyOn(game.sfx, 'throwCherry');
    const probe = probeProjectiles();
    try {
      game.controls.setFiring(true);
      game.update(DT);
      game.update(DT);
      // 还按着：一颗都没扔出去
      expect(probe.cherries.length).toBe(0);
      expect(W.charge).toBeGreaterThan(0);
      // 松手：投出
      game.controls.setFiring(false);
      game.update(DT);
      expect(probe.cherries.length).toBe(1);
      expect(probe.peas.length).toBe(0);
      expect(probe.cherries[0].def).toBe(WEAPONS[2]);
      expect(throwSfx).toHaveBeenCalled();
      expect(W.charge).toBe(0);
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('手雷蓄得越久扔得越远：短蓄力约 minRange、蓄满约 maxRange', () => {
    clearField();
    arm(999);
    W.current = 2;
    lookForward();
    const probe = probeProjectiles();
    const rangeAfter = (holdSec) => {
      W.cooldown = 0;
      W.charge = 0;
      game.controls.setFiring(true);
      const steps = Math.max(1, Math.round(holdSec / DT));
      for (let i = 0; i < steps; i++) game.update(DT);
      game.controls.setFiring(false);
      game.update(DT);
      const t = probe.cherries[probe.cherries.length - 1].target;
      return Math.hypot(t.x - game.camera.position.x, t.z - game.camera.position.z);
    };
    try {
      const near = rangeAfter(0.02);
      const far = rangeAfter(GRENADE.chargeTime + 0.2);
      expect(near).toBeLessThan(6);
      expect(near).toBeGreaterThan(3);
      expect(far).toBeCloseTo(GRENADE.maxRange, 1);
      expect(far).toBeGreaterThan(near);
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('手雷落点沿相机水平朝向走：低头的俯仰不影响投掷距离', () => {
    clearField();
    arm(999);
    W.current = 2;
    W.cooldown = 0;
    lookForward();
    game.player.pitch = -0.4;
    game.player.applyCamera(game.camera);
    game.camera.updateMatrixWorld(true);
    const probe = probeProjectiles();
    try {
      W.charge = GRENADE.chargeTime;
      game.controls.setFiring(false);
      game.update(DT);
      const target = probe.cherries[0].target;
      const cam = game.camera.position;
      const fwd = game.camera.getWorldDirection(new THREE.Vector3());
      expect(target.y).toBeCloseTo(0, 9);
      // 水平方向上仍顺着相机朝向
      expect(Math.atan2(target.x - cam.x, -(target.z - cam.z))).toBeCloseTo(Math.atan2(fwd.x, -fwd.z), 5);
      expect(Math.hypot(target.x - cam.x, target.z - cam.z)).toBeCloseTo(GRENADE.maxRange, 1);
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('玉米炮（hitscan）：即时 explodeAt，不产生弹丸；播放炮击音效与震屏', () => {
    clearField();
    arm(999);
    W.current = 3;
    W.cooldown = 0;
    lookForward();
    const cannon = vi.spyOn(game.sfx, 'cannon');
    const shake = vi.spyOn(game, 'shake');
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.peas.length).toBe(0);
      expect(probe.cherries.length).toBe(0);
      expect(probe.explosions.length).toBe(1);
      const e = probe.explosions[0];
      expect(e.radius).toBe(WEAPONS[3].radius);
      expect(e.damage).toBe(WEAPONS[3].damage);
      expect(e.big).toBe(true);
      expect(e.headshot).toBe(false);
      expect(e.headTarget).toBe(null);
      expect(cannon).toHaveBeenCalled();
      expect(shake).toHaveBeenCalledWith(0.55);
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('命中音效按武器区分：普通豌豆 shootPea、寒冰 shootIce', () => {
    clearField();
    arm(999);
    W.current = 0;
    W.cooldown = 0;
    lookForward();
    const shootPea = vi.spyOn(game.sfx, 'shootPea');
    let probe = probeProjectiles();
    try {
      fireOnce();
      expect(shootPea).toHaveBeenCalled();
    } finally {
      probe.restore();
    }
    W.current = 1;
    W.cooldown = 0;
    const shootIce = vi.spyOn(game.sfx, 'shootIce');
    probe = probeProjectiles();
    try {
      fireOnce();
      expect(shootIce).toHaveBeenCalled();
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('非自动武器（auto:false）只认“按下”事件，按住不会连发', () => {
    clearField();
    arm(999);
    W.current = 3; // 玉米炮 auto:false
    W.cooldown = 0;
    lookForward();
    const probe = probeProjectiles();
    try {
      // 一帧内按下+松开：auto:false 武器靠「按下」事件，这一帧就开火
      game.controls.setFiring(false);
      game.controls.setFiring(true);
      game.update(DT);
      game.controls.setFiring(false);
      expect(probe.explosions.length).toBe(1);
      // 冷却中对按住状态不再产生新的爆炸
      W.cooldown = 0.1;
      game.controls.setFiring(true);
      game.update(DT);
      game.controls.setFiring(false);
      expect(probe.explosions.length).toBe(1);
    } finally {
      probe.restore();
      W.current = 0;
    }
  });

  it('自动武器（auto:true）按住即连发，直到冷却限制', () => {
    clearField();
    arm(999);
    W.current = 0;
    lookForward();
    const probe = probeProjectiles();
    try {
      game.controls.setFiring(true);
      for (let i = 0; i < 18; i++) game.update(DT); // 0.3 秒 ≈ 两发豌豆（cd 0.15）
      expect(probe.peas.length).toBeGreaterThanOrEqual(2);
      game.controls.setFiring(false);
    } finally {
      probe.restore();
    }
  });
});

describe('辅助瞄准 findAimTarget', () => {
  // aimAt 会写 player.yaw/pitch 并同步相机；相机用 YXZ 顺序，getWorldDirection 依赖
  // matrixWorld，所以每次改完都要 updateMatrixWorld。
  async function aimAtChest(zombie) {
    const chest = new THREE.Vector3();
    zombie.getChest(chest);
    await H.aimAt(game, chest.x, chest.y, chest.z);
    game.camera.updateMatrixWorld(true);
    return chest;
  }

  // 把准星从“正对胸口”沿水平方向偏 rad 角（绕相机本地 Y 轴）
  async function aimOffsetRad(chest, rad) {
    const cam = game.camera;
    const dir = chest.clone().sub(cam.position).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    const p = game.player;
    p.yaw = Math.atan2(-dir.x, -dir.z);
    p.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    p.recoil = 0;
    p.applyCamera(cam);
    cam.updateMatrixWorld(true);
  }

  it('桌面端锥形角度 0.045 rad：正对必锁，0.03 仍锁，0.09 不锁', async () => {
    clearField();
    const p = game.player.pos;
    const zombie = spawn('normal', p.x, p.z - 12);
    const chest = await aimAtChest(zombie);
    let target = W.findAimTarget(WEAPONS[0]);
    expect(target).toBeTruthy();
    expect(target.zombie).toBe(zombie);
    expect(target.point.distanceTo(chest)).toBeCloseTo(0, 6);

    await aimOffsetRad(chest, 0.03);
    expect(W.findAimTarget(WEAPONS[0])).toBeTruthy();
    await aimOffsetRad(chest, 0.09);
    expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    clearField();
  });

  it('触屏端锥形角度放大到 0.17 rad', async () => {
    clearField();
    const p = game.player.pos;
    const zombie = spawn('normal', p.x, p.z - 12);
    const chest = await aimAtChest(zombie);
    await aimOffsetRad(chest, 0.09);
    expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    const prev = game.ctx.touch;
    game.ctx.touch = true;
    try {
      expect(W.findAimTarget(WEAPONS[0])).toBeTruthy();
      await aimOffsetRad(chest, 0.3);
      expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    } finally {
      game.ctx.touch = prev;
      clearField();
    }
  });

  it('出生动画中（spawnT<0.5）与死亡僵尸不进辅助瞄准', async () => {
    clearField();
    const p = game.player.pos;
    const zombie = spawn('normal', p.x, p.z - 10);
    await aimAtChest(zombie);
    expect(W.findAimTarget(WEAPONS[0])).toBeTruthy();

    zombie.spawnT = 0.4;
    expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    zombie.spawnT = 1;
    zombie.dying = true;
    expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    zombie.dying = false;
    expect(W.findAimTarget(WEAPONS[0])).toBeTruthy();
    clearField();
  });

  it('超过 62 米的目标不锁（玩家 z=13，边界 62 米处）', async () => {
    clearField();
    const p = game.player.pos;
    // 62.5 米：确认超限
    const far = spawn('normal', p.x, p.z - 62.5);
    await aimAtChest(far);
    expect(W.findAimTarget(WEAPONS[0])).toBe(null);
    // 61 米：在范围内
    far.root.position.z = p.z - 61;
    await aimAtChest(far);
    expect(W.findAimTarget(WEAPONS[0])).toBeTruthy();
    clearField();
  });

  it('多只僵尸时取「角度*10 + 距离*0.006」最小者', async () => {
    clearField();
    const p = game.player.pos;
    const near = spawn('normal', p.x, p.z - 6);
    const far = spawn('normal', p.x, p.z - 20);
    // 正眼对准远处那只：远处角度 0 → 分数只剩距离项，但它还是比“角度看更偏的近处”小
    const f = new THREE.Vector3();
    far.getChest(f);
    await H.aimAt(game, f.x, f.y, f.z);
    game.camera.updateMatrixWorld(true);
    expect(W.findAimTarget(WEAPONS[0]).zombie).toBe(far);

    // 正眼对准近处那只
    const n = new THREE.Vector3();
    near.getChest(n);
    await H.aimAt(game, n.x, n.y, n.z);
    game.camera.updateMatrixWorld(true);
    expect(W.findAimTarget(WEAPONS[0]).zombie).toBe(near);
    clearField();
  });

  it('两只正对着时取近的那只（距离项 0.006 决定）', async () => {
    clearField();
    const p = game.player.pos;
    const a = spawn('normal', p.x, p.z - 10);
    const b = spawn('normal', p.x, p.z - 14);
    // 两者都在同一条竖直射线上，角度都是 0
    const chest = new THREE.Vector3();
    a.getChest(chest);
    await H.aimAt(game, chest.x, chest.y, chest.z);
    game.camera.updateMatrixWorld(true);
    expect(W.findAimTarget(WEAPONS[0]).zombie).toBe(a);
    clearField();
  });
});

describe('resolveAssist：准星正对头部才抬到头部', () => {
  it('准星压在头部球上（夹角 < 0.02）→ 瞄点抬到头部并标 head', async () => {
    clearField();
    arm();
    const p = game.player.pos;
    const zombie = spawn('cone', p.x, p.z - 12);
    const head = new THREE.Vector3();
    zombie.getHead(head);
    await H.aimAt(game, head.x, head.y, head.z);
    game.camera.updateMatrixWorld(true);
    const assist = W.findAimTarget(WEAPONS[0]);
    expect(assist).toBeTruthy();
    const resolved = W.resolveAssist(assist);
    expect(resolved.head).toBe(true);
    expect(resolved.point.distanceTo(head)).toBeCloseTo(0, 6);
    expect(resolved.zombie).toBe(zombie);
    clearField();
  });

  it('准星对着胸口 → 保持胸口、不带 head 标记', async () => {
    clearField();
    arm();
    const p = game.player.pos;
    const zombie = spawn('cone', p.x, p.z - 12);
    const chest = new THREE.Vector3();
    zombie.getChest(chest);
    await H.aimAt(game, chest.x, chest.y, chest.z);
    game.camera.updateMatrixWorld(true);
    const assist = W.findAimTarget(WEAPONS[0]);
    const resolved = W.resolveAssist(assist);
    expect(resolved.head).toBeUndefined();
    expect(resolved.point.distanceTo(chest)).toBeCloseTo(0, 6);
    clearField();
  });

  it('夹角跨过 0.02 rad 时：朝头部就抬、偏一点就只锁胸口', async () => {
    clearField();
    arm();
    const p = game.player.pos;
    const zombie = spawn('cone', p.x, p.z - 12);
    const head = new THREE.Vector3();
    zombie.getHead(head);
    const dist = game.camera.position.distanceTo(head);
    const off = Math.tan(0.01) * dist; // 角度约 0.01 < 0.02
    await H.aimAt(game, head.x + off, head.y, head.z);
    game.camera.updateMatrixWorld(true);
    let assist = W.findAimTarget(WEAPONS[0]);
    expect(assist).toBeTruthy();
    expect(W.resolveAssist(assist).head).toBe(true);
    // 直接验证「给定 assist 对象」在准星偏离头部时的行为（不依赖 0.045 锥形边界）。
    // 注意：resolveAssist 内部用的是模块级 tmpFwd（上一次 findAimTarget 写入的值），
    // 不是实时 camera.getWorldDirection，所以这里用「真实地改变玩家朝向 + 重新找目标」的方式。
    const cam = game.camera;
    const origDir = cam.getWorldDirection.bind(cam);
    const chest = new THREE.Vector3();
    zombie.getChest(chest);
    const toHead = head.clone().sub(cam.position).normalize();
    const toChest = chest.clone().sub(cam.position).normalize();
    void toHead;
    void toChest;
    void origDir;
    // 1) 准星对准胸口：新找到的 assist 走 resolveAssist 后只锁胸口
    const chest2 = new THREE.Vector3();
    zombie.getChest(chest2);
    await H.aimAt(game, chest2.x, chest2.y, chest2.z);
    game.camera.updateMatrixWorld(true);
    const assist2 = W.findAimTarget(WEAPONS[0]);
    expect(assist2).toBeTruthy();
    const r2 = W.resolveAssist(assist2);
    expect(r2.head).toBeUndefined();
    expect(r2.point.distanceTo(chest2)).toBeCloseTo(0, 6);
    // 2) 目标已死：原样返回 assist，不做任何抬升
    zombie.dying = true;
    expect(W.resolveAssist(assist2)).toBe(assist2);
    zombie.dying = false;
    clearField();
  });

  it('辅助目标已死亡时原样返回（不再抬到头部）', async () => {
    clearField();
    arm();
    const p = game.player.pos;
    const zombie = spawn('cone', p.x, p.z - 12);
    const head = new THREE.Vector3();
    zombie.getHead(head);
    await H.aimAt(game, head.x, head.y, head.z);
    game.camera.updateMatrixWorld(true);
    const assist = W.findAimTarget(WEAPONS[0]);
    zombie.dying = true;
    const r = W.resolveAssist(assist);
    expect(r).toBe(assist);
    clearField();
  });
});

describe('hitscan（玉米炮）', () => {
  it('瞄准辅助命中时：爆炸位置取僵尸、headTarget 与强制爆头标记都指向被辅助的那只', async () => {
    clearField();
    arm(999);
    W.current = 3;
    W.cooldown = 0;
    const p = game.player.pos;
    const a = spawn('normal', p.x, p.z - 15);
    const b = spawn('normal', p.x + 0.6, p.z - 15);
    // 准星直接压在 B 的头部球上：resolveAssist 才会标 head
    const headB = new THREE.Vector3();
    b.getHead(headB);
    const chestB = new THREE.Vector3();
    b.getChest(chestB);
    await H.aimAt(game, headB.x, headB.y, headB.z);
    game.camera.updateMatrixWorld(true);
    const probe = probeProjectiles();
    try {
      fireOnce();
      expect(probe.explosions.length).toBe(1);
      const e = probe.explosions[0];
      expect(e.headTarget).toBe(b);
      expect(e.headshot).toBe(true);
      // 爆炸点 = 视线扫到 B 头部球表面的位置（hitscan 取扫掠交点，不是球心）
      expect(e.pos.distanceTo(headB)).toBeLessThanOrEqual(0.37);
      expect(e.pos.distanceTo(headB)).toBeGreaterThan(0);
      expect([a, b]).toContain(e.headTarget);
    } finally {
      probe.restore();
      W.reset();
      clearField();
    }
  });

  it('没有辅助目标时：优先取视线上的僵尸，头部命中优先于身体', async () => {
    clearField();
    arm(999);
    W.current = 3;
    W.cooldown = 0;
    // 关闭辅助：让 hitscan 自己扫
    const findAim = vi.spyOn(W, 'findAimTarget').mockReturnValue(null);
    const p = game.player.pos;
    const near = spawn('normal', p.x, p.z - 8);
    const far = spawn('normal', p.x, p.z - 30);
    const head = new THREE.Vector3();
    near.getHead(head);
    await H.aimAt(game, head.x, head.y, head.z);
    game.camera.updateMatrixWorld(true);
    const probe = probeProjectiles();
    try {
      fireOnce();
      const e = probe.explosions[0];
      expect(e.headTarget).toBe(near);
      expect(e.headshot).toBe(true);
      expect(far.hp).toBe(far.maxHp);
    } finally {
      probe.restore();
      findAim.mockRestore();
      W.reset();
      clearField();
    }
  });

  it('视线打空时爆炸点落在视线与地面的交点上', async () => {
    clearField();
    arm(999);
    W.current = 3;
    W.cooldown = 0;
    const findAim = vi.spyOn(W, 'findAimTarget').mockReturnValue(null);
    game.player.pitch = -0.6; // 明显低头
    game.player.yaw = 0;
    game.player.applyCamera(game.camera);
    const probe = probeProjectiles();
    try {
      fireOnce();
      const e = probe.explosions[0];
      // 以前把爆炸点抬到 0.15 米，看着像"半空炸开"；落点就是准星指到的地面
      expect(e.pos.y).toBeCloseTo(0, 6);
      expect(e.pos.z).toBeLessThan(game.camera.position.z);
    } finally {
      probe.restore();
      findAim.mockRestore();
      W.reset();
    }
  });

  it('抬头发射（视线与地面不相交）时爆炸点退回到准星前方 16 米', async () => {
    clearField();
    arm(999);
    W.current = 3;
    W.cooldown = 0;
    const findAim = vi.spyOn(W, 'findAimTarget').mockReturnValue(null);
    game.player.pitch = 0.5; // 抬头
    game.player.yaw = 0;
    game.player.applyCamera(game.camera);
    const probe = probeProjectiles();
    try {
      fireOnce();
      const e = probe.explosions[0];
      // 抬头：视线与地面永不相交，退化成水平方向 16 米处的地面点
      const camPos = game.camera.position.clone();
      const dir = new THREE.Vector3();
      game.camera.getWorldDirection(dir);
      const flat = Math.hypot(dir.x, dir.z);
      const expected = new THREE.Vector3(camPos.x + (dir.x / flat) * 16, 0, camPos.z + (dir.z / flat) * 16);
      expect(e.pos.distanceTo(expected)).toBeLessThan(1e-6);
    } finally {
      probe.restore();
      findAim.mockRestore();
      W.reset();
    }
  });
});

describe('viewmodel 动画', () => {
  it('portrait 模式缩放与位置都有调整', () => {
    W.setAspect(0.5);
    expect(W.portrait).toBe(true);
    W.setAspect(2);
    expect(W.portrait).toBe(false);
  });

  it('update 把当前武器视图模型摆回基准位置（带后坐位移）', () => {
    W.current = 0;
    W.recoil = 1;
    W.swapAnim = 0;
    W.swayX = 0;
    W.swayY = 0;
    game.player.vel.set(0, 0, 0);
    game.weapons.update(0, game.controls);
    const g = W.models[0].group;
    const base = W.models[0];
    expect(g.position.z).toBeCloseTo(base.basePos.z + 1 * 0.05, 9);
    expect(g.position.y).toBeCloseTo(base.basePos.y + 1 * 0.012, 9);
    expect(g.rotation.x).toBeCloseTo(base.baseRot.x - 1 * 0.28, 9);
    expect(g.scale.x).toBeCloseTo(base.baseScale, 9);
    W.recoil = 0;
    game.weapons.update(0, game.controls);
  });

  it('切枪时 swapAnim 把视图模型向后推一段', () => {
    W.current = 0;
    W.recoil = 0;
    W.swayX = 0;
    W.swayY = 0;
    W.swapAnim = 1;
    game.player.vel.set(0, 0, 0);
    game.weapons.update(0, game.controls);
    const g = W.models[0].group;
    expect(g.position.z).toBeCloseTo(W.models[0].basePos.z + 0.22, 9);
  });
});