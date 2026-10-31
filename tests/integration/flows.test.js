// 端到端流程：真实 Game + 真实 index.html DOM，按玩家操作路径推进完整帧循环。
// 不直接调用内部私有方法，能走 DOM / 键盘 / 指针事件的都走事件。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// 用 doMock（模块级、不提升）而不是 hoisted 的 vi.mock：后面的重置模块生命周期用例
// 要重新安装一次，才能把 three 的 WebGLRenderer 替身重新打回新建的模块图。
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

let createGame;
let step;
let spawnZombieAt;
let aimAt;
let readyToFire;
let WEAPONS;
let ZOMBIES;
let TUNING;
let THREE;
let initZombieModel;
let stubGltfLoader;

// createGame 会在内部动态 import src/Game.js，必须等 vi.mock 生效后加载。
beforeAll(async () => {
  ({ createGame, step, spawnZombieAt, aimAt, readyToFire } = await import('../helpers/game.js'));
  ({ WEAPONS, ZOMBIES, TUNING } = await import('../../src/config.js'));
  THREE = await import('three');
  ({ initZombieModel } = await import('../../src/entities/ZombieModel.js'));
  ({ stubGltfLoader } = await import('../helpers/game.js'));
}, 60000);

const $ = (id) => document.getElementById(id);
const hidden = (el) => !!el && el.classList.contains('hidden');
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const key = (code) => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));

let game;
let pointerLock;

beforeEach(async () => {
  // hp>1 的波次里僵尸模型可能还没加载好（ZombieManager 会等 zombieModel.ready），
  // 这里显式确认一次，避免用到上一个用例残留的模块状态。
  await stubGltfLoader();
  initZombieModel();
  ({ game, pointerLock } = await createGame());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 模拟"刷新页面重新开一局"：重置模块图 + 重装 three 替身，再建一个全新的 Game。
// 假计时器会劫持 @napi-rs/canvas 创建 2D 上下文时的内部计时器（卡住不返回），
// 所以给每个用例一套干净的 canvas 替身（业务代码只用到这几个方法）。
async function freshGame() {
  vi.resetModules();
  await installThreeMock();
  const htmlCanvas = HTMLCanvasElement.prototype;
  vi.spyOn(htmlCanvas, 'getContext').mockImplementation(function (type) {
    if (type !== '2d') return null;
    return {
      canvas: this,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowBlur: 0,
      shadowColor: '#000',
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      ellipse() {},
      bezierCurveTo() {},
      quadraticCurveTo() {},
      rect() {},
      roundRect() {},
      fill() {},
      stroke() {},
      clip() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      drawImage() {},
      putImageData() {},
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}),
      measureText: () => ({ width: 10 }),
      fillText() {},
      strokeText() {},
    };
  });
  const h = await import('../helpers/game.js');
  return h.createGame();
}

// fake timers 用例专用：@napi-rs/canvas 的 getContext('2d') 内部会把自己的计时器挂到
// 被假化的 setTimeout 上（卡住不返回），所以这类用例连 2D canvas 也要替换掉。
// 三张地图/金属质感的程序化贴图只影响外观，这里用固定点位的替身页面，Game 逻辑全部真实。
const SKY_MAPS = [
  {
    id: 'backyard',
    name: '戴夫的后院',
    short: '后院',
    tag: '经典草地',
    desc: '草坪开阔，墓碑与树会挡路',
    startLabel: '开始保卫后院',
    create: () => ({
      id: 'backyard',
      name: '戴夫的后院',
      startLabel: '开始保卫后院',
      root: new THREE.Group(),
      bounds: { x: 23, z: 23 },
      colliders: [],
      platforms: [],
      spawn: { x: 0, z: 13, yaw: 0 },
      pickupSpots: [[0, 0], [3, 3]],
      activate(scene) {
        scene.background = null;
        scene.fog = new THREE.Fog(0xddeeff, 30, 90);
        this.root.visible = true;
      },
      menuCamera() {},
      update() {},
    }),
  },
  {
    id: 'snow',
    name: '雪地',
    short: '雪地',
    tag: 'FY_ICEWORLD',
    desc: 'CS 经典 fy_iceworld：田字四柱与两侧矮墙',
    startLabel: '进入雪地',
    create: () => ({ ...SKY_MAPS[0].create(), id: 'snow', name: '雪地', startLabel: '进入雪地' }),
  },
  {
    id: 'dust',
    name: '沙城',
    short: '沙城',
    tag: 'DUST YARD',
    desc: '致敬 de_dust2：中门、长 A、B 长廊三线压进',
    startLabel: '进入沙城',
    create: () => ({ ...SKY_MAPS[0].create(), id: 'dust', name: '沙城', startLabel: '进入沙城' }),
  },
];

async function freshSkyGame() {
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  await installThreeMock();
  vi.doMock('../../src/world/materials.js', async (importOriginal) => {
    const actual = await importOriginal();
    const tex = () => ({ wrapS: 0, wrapT: 0, repeat: { set() {} }, dispose() {} });
    return {
      ...actual,
      grassTexture: () => tex(),
      skyTexture: () => tex(),
      snowTexture: () => tex(),
      sandTexture: () => tex(),
      iceWallTexture: () => tex(),
      iceTexture: () => tex(),
      snowSkyTexture: () => tex(),
      desertSkyTexture: () => tex(),
      blobShadowTexture: () => tex(),
      glowTexture: () => tex(),
      cloudTexture: () => tex(),
      outdoorEnvironment: () => null,
    };
  });
  vi.doMock('../../src/world/maps.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, MAPS: SKY_MAPS, createMaps: (scene) => SKY_MAPS.map((m) => {
      const map = m.create();
      map.meta = m;
      scene.add(map.root);
      return map;
    }) };
  });
  const h = await import('../helpers/game.js');
  return h.createGame();
}

// 跳过 70 阳光的开局等待：直接给够阳光，专注流程本身。
function giveSun(n = 999) {
  game.sun = n;
  game.hud.setSun(n, true);
}

// 模拟按住左键持续开火：等价于 pointerdown → 每帧 Game.update。
async function fireAt(gameRef, x, y, z, frames, perShot = 6) {
  readyToFire(gameRef, 999);
  gameRef.controls.setFiring(true);
  for (let i = 0; i < frames; i++) {
    await aimAt(gameRef, x, y, z);
    gameRef.update(1 / 60);
  }
  gameRef.controls.setFiring(false);
}

describe('1. 菜单与地图选择', () => {
  it('开局渲染三张地图卡片，默认选中后院，startBtn 文案来自 startLabel', () => {
    expect(game.state).toBe('menu');
    const cards = [...$('mapSelect').querySelectorAll('.map-card')];
    expect(cards.map((c) => c.dataset.map)).toEqual(['backyard', 'snow', 'dust', 'forest']);
    expect(cards[0].querySelector('.map-name').textContent).toBe('戴夫的后院');
    expect(cards[1].querySelector('.map-tag').textContent).toBe('FY_ICEWORLD');
    expect(cards[0].classList.contains('active')).toBe(true);
    expect($('startBtn').textContent).toBe('开始保卫后院');
    expect(hidden($('startScreen'))).toBe(false);
    expect(game.mapId).toBe('backyard');
  });

  it('点击雪地卡片：mapId 切换、旧地图 root 隐藏、startBtn 文案与背景/雾随之变化', () => {
    const before = { background: game.scene.background, fog: game.scene.fog };
    const oldMap = game.map;

    click($('mapSelect').querySelector('[data-map="snow"]'));

    expect(game.mapId).toBe('snow');
    expect(game.map.id).toBe('snow');
    expect(oldMap.root.visible).toBe(false);
    expect(game.map.root.visible).toBe(true);
    expect($('mapSelect').querySelector('[data-map="snow"]').classList.contains('active')).toBe(true);
    expect($('startBtn').textContent).toBe('进入雪地');
    expect(game.scene.background).not.toBe(before.background);
    expect(game.scene.fog).not.toBe(before.fog);
    expect(game.scene.fog.far).toBe(132);
    // 地面拾取点位随后院地图一起换掉
    expect(game.pickups.map).toBe(game.map);
  });

  it('菜单状态下 setMap 才生效：playing 时 selectMap 被忽略', () => {
    game.start();
    expect(game.state).toBe('playing');
    game.selectMap('dust');
    expect(game.mapId).toBe('backyard');
  });

  it('未知地图 id 回落到第一张地图', () => {
    game.setMap('no-such-map');
    expect(game.mapId).toBe('backyard');
  });
});

describe('2. 开局', () => {
  it('点击 startBtn：playing、HUD 显示、阳光 60、第 1 波已排队、请求指针锁定', () => {
    const waveSpy = vi.spyOn(game.zombies, 'startWave');
    const lockSpy = vi.spyOn(game.controls, 'requestLock');

    click($('startBtn'));

    expect(game.state).toBe('playing');
    expect(hidden($('hud'))).toBe(false);
    expect(hidden($('startScreen'))).toBe(true);
    expect(game.sun).toBe(TUNING.startSun);
    expect($('sunValue').textContent).toBe('60');
    expect(waveSpy).toHaveBeenCalledWith(1);
    expect(game.zombies.wave).toBe(1);
    expect(game.zombies.state).toBe('spawning');
    expect(game.zombies.queue.length).toBeGreaterThan(0);
    expect($('waveLabel').textContent).toBe('第 1 波');
    expect(lockSpy).toHaveBeenCalled();
    expect(pointerLock.isLocked()).toBe(game.canvas);
    expect(game.controls.enabled).toBe(true);
  });

  it('开局生成僵尸并推进：出生后场上出现僵尸、HUD 血量 100', () => {
    game.start();
    step(game, 180);
    expect(game.zombies.zombies.length).toBeGreaterThan(0);
    expect($('hpText').textContent).toBe('100');
  });
});

// 下面是状态机用例：指针锁定替身会同步派发 pointerlockchange → 又会走一遍 onLockChange，
// 这里把锁定请求做成"无副作用"，只验证 Game 自己的状态迁移。
function isolateLock(g) {
  vi.spyOn(g.controls, 'requestLock').mockImplementation(() => {});
  vi.spyOn(g.controls, 'exitLock').mockImplementation(() => {});
}

describe('3. 暂停 / 恢复 / 回菜单', () => {
  it('pauseBtn → paused 且 HUD 隐藏；resumeBtn → playing 且 HUD 恢复', () => {
    isolateLock(game);
    game.start();
    click($('pauseBtn'));
    expect(game.state).toBe('paused');
    expect(hidden($('hud'))).toBe(true);
    expect(hidden($('pauseScreen'))).toBe(false);
    expect(game.controls.enabled).toBe(false);

    click($('resumeBtn'));
    expect(game.state).toBe('playing');
    expect(hidden($('hud'))).toBe(false);
    expect(hidden($('pauseScreen'))).toBe(true);
    expect(game.controls.enabled).toBe(true);
  });

  it('playing 时失锁（Esc）自动暂停，非 playing 时失锁不影响', () => {
    // 这里要测的是真实的 requestPointerLock 链路，所以只把「失锁后自动重新申请锁定」
    // 这一步结果固定住（否则测试替身会同步把锁抢回去）。失锁本身走真实事件。
    const reLock = vi.spyOn(game.controls, 'requestLock');
    reLock.mockImplementation(() => {});
    game.start();
    expect(reLock).toHaveBeenCalled();

    pointerLock.forceUnlock();
    expect(game.state).toBe('paused');
    expect(hidden($('hud'))).toBe(true);
    expect(hidden($('pauseScreen'))).toBe(false);
    expect(game.controls.enabled).toBe(false);

    click($('resumeBtn'));
    expect(game.state).toBe('playing');
    expect(reLock).toHaveBeenCalledTimes(2);

    // 已暂停时再失锁不产生副作用（不会二次暂停/喷错面板）
    isolateLock(game);
    game.pause();
    expect(game.state).toBe('paused');
    pointerLock.forceUnlock();
    expect(game.state).toBe('paused');
  });

  it('菜单/结算状态下失锁不会误暂停', () => {
    expect(game.state).toBe('menu');
    game.controls.requestLock = () => {};
    pointerLock.forceUnlock();
    expect(game.state).toBe('menu');
  });

  it('mapBtn → menu，resetRun 把分数/击杀/僵尸/阳光复位', () => {
    isolateLock(game);
    game.start();
    step(game, 120);
    expect(game.zombies.zombies.length).toBeGreaterThan(0);
    game.onKill({ type: 'normal' }, 300, false);
    const scoreBefore = game.stats.score;
    giveSun(5);

    click($('mapBtn'));

    expect(game.state).toBe('menu');
    expect(hidden($('startScreen'))).toBe(false);
    expect(hidden($('hud'))).toBe(true);
    expect(scoreBefore).toBe(300);
    expect(game.stats).toEqual({ score: 0, kills: 0, wave: 0 });
    expect($('scoreLabel').textContent).toBe('0');
    expect($('killLabel').textContent).toBe('0');
    expect(game.sun).toBe(TUNING.startSun);
    expect(game.zombies.zombies.length).toBe(0);
    expect(game.zombies.queue.length).toBe(0);
    expect(game.zombies.state).toBe('idle');
    expect(game.weapons.slots).toEqual({
      peaGun: [0], gun: [-1], demo: [-1], grenade: [-1],
      shield: [WEAPONS.findIndex((w) => w.id === 'wallnut')],
    });
  });

  it('pauseMapBtn 也能回到主菜单', () => {
    isolateLock(game);
    game.start();
    click($('pauseBtn'));
    expect(game.state).toBe('paused');
    click($('pauseMapBtn'));
    expect(game.state).toBe('menu');
    expect(hidden($('startScreen'))).toBe(false);
  });
});

describe('4. 死亡结算', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hp 归零 → over，800ms 后结算面板显示分数/波次/击杀，againBtn 重开', async () => {
    game.start();
    step(game, 60);
    game.stats.score = 4321;
    game.stats.kills = 17;
    game.stats.wave = 4;
    const deathSpy = vi.spyOn(game.sfx, 'death');

    game.player.hp = 1;
    game.player.invuln = 0;
    game.player.damage(50);

    expect(game.state).toBe('over');
    expect(deathSpy).toHaveBeenCalled();
    expect(hidden($('hud'))).toBe(true);
    expect(hidden($('overScreen'))).toBe(true); // 800ms 后才会弹

    vi.advanceTimersByTime(799);
    expect(hidden($('overScreen'))).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hidden($('overScreen'))).toBe(false);
    expect($('finalScore').textContent).toBe('4,321');
    expect($('finalWave').textContent).toBe('4');
    expect($('finalKills').textContent).toBe('17');

    click($('againBtn'));
    expect(game.state).toBe('playing');
    expect(hidden($('overScreen'))).toBe(true);
    expect(hidden($('hud'))).toBe(false);
    expect(game.player.hp).toBe(game.player.maxHp);
    expect(game.stats).toEqual({ score: 0, kills: 0, wave: 1 });
    expect(game.zombies.queue.length).toBeGreaterThan(0);
  });

  it('被僵尸攻击致死走真实链路：贴近的僵尸把玩家打到 over', async () => {
    game.start();
    step(game, 30);
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';
    const p = game.player.pos;
    spawnZombieAt(game, 'normal', p.x, p.z - 1.3, { speedMul: 0 });

    const startHp = game.player.hp;
    // 僵尸贴身攻击间隔 1.28s，先推 2 秒确认第一口
    step(game, 120);
    expect(game.player.hp).toBeLessThan(startHp);
    // 一直挨打直到死亡（每口 9 点，100 血约 11 口 ≈ 15 秒）
    for (let i = 0; i < 60 * 40 && game.state === 'playing'; i++) step(game, 1);
    expect(game.state).toBe('over');
    vi.advanceTimersByTime(800);
    expect(hidden($('overScreen'))).toBe(false);
    expect($('finalWave').textContent).toBe('1');
  });

});

describe('5. 射击 → 击杀 → 掉阳光 → 拾取', () => {
  it('瞄准僵尸开火直到死亡：kills+1、掉阳光、踩到后 game.sun +5', async () => {
    game.start();
    giveSun(999);
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';

    const p = game.player.pos;
    // 与玩家保持距离，避免被僵尸推开影响弹道
    const zombie = spawnZombieAt(game, 'normal', p.x, p.z - 8, { speedMul: 0 });
    expect(zombie.maxHp).toBe(ZOMBIES.normal.hp);

    // 一直按住开火；每帧重新瞄准胸口
    let frames = 0;
    while (!zombie.dying && frames < 400) {
      readyToFire(game, 999);
      game.controls.setFiring(true);
      await aimAt(game, p.x, 0.95, zombie.root.position.z);
      game.update(1 / 60);
      frames++;
    }
    game.controls.setFiring(false);
    // 死亡动画期间 alive 仍为 true，dying 才是"已被打死"的可靠信号
    expect(zombie.dying).toBe(true);
    expect(zombie.hp).toBe(0);
    expect(game.stats.kills).toBe(1);
    // 开火会花阳光，而且 999 会封顶；拾取前压到 500 才能真的看出 +5
    // 上限已降到 300，取一个能观察到 +5 的起始值
    game.sun = 55;
    game.hud.setSun(55, true);
    const s0 = game.sun;
    expect(game.stats.score).toBe(ZOMBIES.normal.score);
    expect($('killLabel').textContent).toBe('1');
    expect($('scoreLabel').textContent).toBe(String(ZOMBIES.normal.score));
    // 命中有 hitmarker 反馈
    expect($('hitmarker').classList.contains('show')).toBe(true);

    // 掉阳光：普通僵尸 1 颗
    const active = game.sunOrbs.orbs.filter((o) => o.active);
    expect(active.length).toBe(1);

    // 玩家走到阳光下面：磁吸后自动拾取，阳光 +5
    const orb = active[0];
    game.player.pos.x = orb.pos.x;
    game.player.pos.z = orb.pos.z;
    for (let i = 0; i < 600 && orb.active; i++) {
      game.player.pos.x = orb.pos.x;
      game.player.pos.z = orb.pos.z;
      game.update(1 / 60);
    }

    expect(orb.active).toBe(false);
    expect(game.sun).toBe(s0 + TUNING.sunPerOrb);
    expect(game.sun - s0).toBe(5);
    expect(game.sun).toBeLessThanOrEqual(TUNING.maxSun);
  });

  it('阳光封顶 300', () => {
    game.start();
    giveSun(297);
    game.addSun(10);
    expect(game.sun).toBe(300);
    expect($('sunValue').textContent).toBe('300');
  });

  it('弹匣打空且阳光不够续弹：hud.sunPill 出现 deny，且不扣阳光', async () => {
    game.start();
    game.weapons.pickup(3); // 玉米炮进大杀器槽
    game.weapons.equip(3);
    game.weapons.ammo[3] = 0;
    game.sun = 5;
    game.hud.setSun(5, true);
    game.weapons.cooldown = 0;
    const denySpy = vi.spyOn(game.hud, 'denySun');
    await aimAt(game, 0, 1, 5);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    expect(denySpy).toHaveBeenCalled();
    expect(game.sun).toBe(5);
    expect($('sunPill').classList.contains('deny')).toBe(true);
  });
});

describe('5.5 准星与弹道一致（回归）', () => {
  const resetField = () => {
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';
    game.projectiles.clear();
  };

  it.each([6, 12, 25, 40])('准星压在胸口、%i 米外开一枪必定命中', async (dist) => {
    game.start();
    giveSun(999);
    resetField();
    game.weapons.reset();
    game.weapons.current = 0;
    const p = game.player.pos;
    const zombie = spawnZombieAt(game, 'normal', p.x, p.z - dist, { speedMul: 0 });
    const chest = zombie.getChest(new THREE.Vector3());
    await aimAt(game, chest.x, chest.y, chest.z);
    game.update(1 / 60); // 瞄准辅助先算一遍
    readyToFire(game, 999);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    // 子弹有飞行时间，按 60 帧/秒推进到它消失
    for (let i = 0; i < 120 && game.projectiles.peas.some((q) => q.active); i++) game.update(1 / 60);
    expect(zombie.hp).toBeLessThan(zombie.maxHp);
  });

  it('豌豆撞墙就地消失，不会穿过墙打到后面的僵尸', async () => {
    game.start();
    giveSun(999);
    resetField();
    game.weapons.reset();
    const p = game.player.pos;
    const zombie = spawnZombieAt(game, 'normal', p.x, p.z - 12, { speedMul: 0 });
    const chest = zombie.getChest(new THREE.Vector3());
    // 在中间插一道比僵尸还高的墙（地图 walls 就是投掷物/弹丸的挡板）
    game.map.walls.push({ x: p.x, y: 1.5, z: p.z - 6, hx: 3, hy: 1.5, hz: 0.2, c: 1, s: 0 });
    try {
      await aimAt(game, chest.x, chest.y, chest.z);
      game.update(1 / 60);
      readyToFire(game, 999);
      game.controls.setFiring(true);
      game.update(1 / 60);
      game.controls.setFiring(false);
      for (let i = 0; i < 120 && game.projectiles.peas.some((q) => q.active); i++) game.update(1 / 60);
      expect(zombie.hp).toBe(zombie.maxHp);
      expect(game.projectiles.peas.some((q) => q.active)).toBe(false);
    } finally {
      game.map.walls.pop();
    }
  });

  it('西瓜投手走抛物线：出手带垂直速度、有顶点、落地才炸', () => {
    game.start();
    giveSun(999);
    resetField();
    game.weapons.reset();
    game.weapons.pickup(8); // 西瓜
    expect(game.weapons.current).toBe(8);
    const P = game.projectiles;
    // 手上（枪口）出手，目标 12 米外贴地 —— 和开火时传进去的参数一致
    const muzzle = new THREE.Vector3();
    game.weapons.models[8].muzzle.getWorldPosition(muzzle);
    P.throwCherry(muzzle, new THREE.Vector3(muzzle.x, 0, muzzle.z - 12), WEAPONS[8], { dist: 12, y: 0 });
    const c = P.cherries.find((q) => q.active);
    expect(c.active).toBe(true);
    // 垂直速度就是"重力弹道"的标志：直线弹种 vy 恒为 0，这里由解算式给出
    expect(Math.abs(c.vel.y)).toBeGreaterThan(1);
    expect(c.gravity).toBeGreaterThan(0);
    let maxY = c.pos.y;
    let hitWall = false;
    // 只推进到它落地：继续 update 会让池里的弹位被下一帧复用，读到的是别的飞行物
    for (let i = 0; i < 200 && c.active; i++) {
      game.update(1 / 60);
      maxY = Math.max(maxY, c.pos.y);
      if (c.bounced) hitWall = true;
    }
    expect(maxY).toBeGreaterThan(2); // 抛物线有顶点
    expect(c.active).toBe(false); // 最终落地爆炸
  });

  it('西瓜撞墙会反弹继续飞（只有投掷物能弹墙）', () => {
    game.start();
    giveSun(999);
    resetField();
    const P = game.projectiles;
    const muzzle = new THREE.Vector3();
    game.weapons.models[8].muzzle.getWorldPosition(muzzle);
    // 落点正前方 8 米处立一道 4 米高的墙：西瓜会先撞上去
    const wallZ = muzzle.z - 8;
    game.map.walls.push({ x: muzzle.x, y: 2, z: wallZ, hx: 4, hy: 2, hz: 0.25, c: 1, s: 0 });
    try {
      P.throwCherry(muzzle, new THREE.Vector3(muzzle.x, 0, muzzle.z - 12), WEAPONS[8], { dist: 12, y: 0 });
      const c = P.cherries.find((q) => q.active);
      let bouncedZ = null;
      for (let i = 0; i < 200 && c.active; i++) {
        game.update(1 / 60);
        if (c.bounced && bouncedZ === null) bouncedZ = c.pos.z;
      }
      // 确实撞过墙，而且撞完之后还继续活着飞了一段（没有撞墙即炸）
      expect(bouncedZ).not.toBeNull();
      expect(bouncedZ).toBeGreaterThan(wallZ);
      expect(c.active).toBe(false);
    } finally {
      game.map.walls.pop();
    }
  });
});

describe('6. 爆头', () => {
  it('瞄头部击杀：handleKill 收到 headshot=true，分数 ×1.5', async () => {
    game.start();
    giveSun(999);
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';

    const handle = vi.spyOn(game.zombies, 'handleKill');
    const p = game.player.pos;
    const zombie = spawnZombieAt(game, 'normal', p.x, p.z - 8, { speedMul: 0 });
    // 玉米炮是 hitscan：瞄准点就是命中点，不受弹道/辅助瞄准影响
    game.weapons.pickup(3); // 玉米炮进大杀器槽
    game.weapons.equip(3);
    game.weapons.cooldown = 0;
    game.sun = 999;
    await aimAt(game, p.x, 1.45 * zombie.scaleFactor, zombie.root.position.z);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);

    expect(zombie.dying).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
    const [, headshot] = handle.mock.calls[0];
    expect(headshot).toBe(true);
    expect(zombie.headHit).toBe(true);
    expect(game.stats.kills).toBe(1);
    expect(game.stats.score).toBe(Math.round(ZOMBIES.normal.score * 1.5));
    expect($('scoreLabel').textContent).toBe('150');
    // 玉米炮是弹匣制：弹匣内开火不扣阳光，只有打空后自动续弹才花钱
    expect(game.sun).toBe(999);
    expect(game.weapons.ammo[3]).toBe(WEAPONS[3].ammo - 1);
    expect(game.sunOrbs.orbs.filter((o) => o.active).length).toBe(1);
  });

  it('瞄胸口击杀不送爆头：分数按基础分计', async () => {
    game.start();
    giveSun(999);
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';

    const handle = vi.spyOn(game.zombies, 'handleKill');
    const p = game.player.pos;
    const zombie = spawnZombieAt(game, 'normal', p.x, p.z - 8, { speedMul: 0 });
    game.weapons.pickup(3);
    game.weapons.equip(3);
    game.weapons.cooldown = 0;
    game.sun = 999;
    // 瞄到胸口球下沿以下（y≈0.2），保证只可能命中身体
    await aimAt(game, p.x, 0.2 * zombie.scaleFactor, zombie.root.position.z);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);

    expect(zombie.dying).toBe(true);
    const [, headshot] = handle.mock.calls[0];
    expect(headshot).toBe(false);
    expect(game.stats.score).toBe(ZOMBIES.normal.score);
  });
});

describe('7. 波次推进与 Boss', () => {
  it('清波：击杀奖励 150×n、回血、进入 intermission，6.5 秒后自动开下一波', () => {
    game.start();
    giveSun(999);
    game.zombies.queue = [];
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.player.hp = 40;
    game.player.sinceDamage = 0; // 关掉被动回血，只验证清波 heal(14)
    game.zombies.state = 'spawning';
    game.zombies.wave = 1;

    step(game, 1);
    expect(game.zombies.state).toBe('intermission');
    expect(game.stats.score).toBe(150);
    expect(game.player.hp).toBe(54);
    expect($('banner').textContent).toBe('第 1 波 守住了!');
    expect($('banner').classList.contains('show')).toBe(true);
    expect(game.stats.wave).toBe(1);

    // 6.5 秒倒计时；用显式 step 推进，不依赖真实时钟
    step(game, Math.ceil(6.4 * 60));
    expect(game.zombies.state).toBe('intermission');
    expect(game.stats.wave).toBe(1);

    step(game, 20);
    expect(game.zombies.state).toBe('spawning');
    expect(game.stats.wave).toBe(2);
    expect(game.zombies.queue.length).toBeGreaterThan(0);
    expect($('waveLabel').textContent).toBe('第 2 波');
    expect(game.zombies.hpMul).toBeGreaterThan(1);
  });

  it('startWave(5) 生成 Boss：hud boss 条可见、横幅提示；击杀后 boss 条隐藏', () => {
    game.start();
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.startWave(5);
    // 第 5 波的 BOSS 是轮换表第一只（巨人）
    expect(game.zombies.queue).toContain('gargantuar');

    // 只留 boss，其余排队清掉，避免干扰
    game.zombies.queue = ['gargantuar'];
    const before = game.zombies.zombies.length;
    step(game, 40);
    const boss = game.zombies.boss;
    expect(boss).toBeTruthy();
    expect(boss.type).toBe('gargantuar');
    expect(game.zombies.zombies.length).toBe(before + 1);
    expect(hidden($('bossBar'))).toBe(false);
    expect($('banner').textContent).toBe('巨人出现了!');

    // 推进一帧后 boss 血条按比例写入
    step(game, 1);
    expect($('bossFill').style.width).toBe('100%');
    boss.spawnT = 1;
    boss.hit(boss.maxHp / 2, false);
    step(game, 1);
    expect(parseFloat($('bossFill').style.width)).toBeCloseTo(50, 0);

    const onBossDead = vi.spyOn(game, 'onBossDead');
    boss.hit(9999, false);
    game.zombies.handleKill(boss, false);
    expect(onBossDead).toHaveBeenCalled();
    expect(game.zombies.boss).toBe(null);
    expect(hidden($('bossBar'))).toBe(true);
    expect($('banner').textContent).toBe('巨人倒下了!');
    // boss 掉 7 颗阳光
    expect(game.sunOrbs.orbs.filter((o) => o.active).length).toBe(7);
  });

  it('桶头僵尸掉 3 颗阳光、路障头掉 2 颗', () => {
    game.start();
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';
    game.sunOrbs.clear();

    const p = game.player.pos;
    const bucket = spawnZombieAt(game, 'bucket', p.x + 6, p.z - 6, { speedMul: 0 });
    game.zombies.handleKill(bucket, false);
    expect(game.sunOrbs.orbs.filter((o) => o.active).length).toBe(3);

    game.sunOrbs.clear();
    const cone = spawnZombieAt(game, 'cone', p.x - 6, p.z - 6, { speedMul: 0 });
    game.zombies.handleKill(cone, false);
    expect(game.sunOrbs.orbs.filter((o) => o.active).length).toBe(2);
  });
});

describe('8. 地面武器拾取', () => {
  it('走到点位自动拾取：进武器槽、弹药、开火扣弹药不扣阳光、打空后花阳光续弹', async () => {
    game.start();
    giveSun(999);
    // 地面刷新是随机的；这条用例要验证「有弹匣的地面武器」完整链路，钉死成双发射手
    const repeater = WEAPONS.findIndex((w) => w.id === 'repeater');
    game.pickups.lootIndices = [repeater];
    game.pickups.reset();
    const item = game.pickups.items.find((it) => it.active);
    const spot = [item.group.position.x, item.group.position.z];
    expect(item.active).toBe(true);
    const index = item.index;
    const def = WEAPONS[index];
    expect(def.id).toBe('repeater');
    expect(def.ammo).toBeGreaterThan(0);

    game.player.pos.x = spot[0];
    game.player.pos.z = spot[1];
    game.update(1 / 60);

    const at = game.weapons.slotIndexOf(index);
    expect(at).toBeTruthy();
    expect(game.weapons.activeSlot).toEqual(at);
    expect(game.weapons.current).toBe(index);
    expect(game.weapons.ammo[index]).toBe(def.ammo);
    expect(item.active).toBe(false);
    expect(hidden(game.hud.slotDock)).toBe(false);
    // 找到这个角色对应的那格 UI，它不该是空的
    const cellIdx = game.hud.slotLayout.findIndex((c) => c.role === at.role && c.pos === at.pos);
    expect(cellIdx).toBeGreaterThanOrEqual(0);
    expect(game.hud.slotButtons[cellIdx].classList.contains('empty')).toBe(false);
    expect(hidden($('ammoChip'))).toBe(false);
    expect($('ammoNow').textContent).toBe(String(def.ammo));
    expect($('ammoMax').textContent).toBe(String(def.ammo));
    expect($('banner').textContent).toBe('拾取 ' + def.name + ' · ' + def.ammo + ' 发');

    // 开火：扣弹药、不扣阳光
    await aimAt(game, 0, 1, -20);
    const sunBefore = game.sun;
    game.weapons.cooldown = 0;
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    expect(game.sun).toBe(sunBefore);
    expect(game.weapons.ammo[index]).toBe(def.ammo - 1);
    expect($('ammoNow').textContent).toBe(String(def.ammo - 1));

    // 打空最后一发：不丢枪，下次开火自动用阳光续一整梭子
    game.weapons.ammo[index] = 1;
    game.weapons.cooldown = 0;
    await aimAt(game, 0, 1, -20);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    expect(game.weapons.ammo[index]).toBe(0);
    expect(game.weapons.slotIndexOf(index)).toBeTruthy();

    const sunBeforeReload = game.sun;
    game.weapons.cooldown = 0;
    await aimAt(game, 0, 1, -20);
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    // 续弹扣 def.cost * def.ammo，随后正常打出这一发
    expect(game.sun).toBe(sunBeforeReload - def.cost * def.ammo);
    expect(game.weapons.ammo[index]).toBe(def.ammo - 1);
    expect(game.weapons.slotIndexOf(index)).toBeTruthy();
    expect(game.weapons.locked).toBe(false);
  });

  it('开局只在随机点位刷一个道具；捡走后本关不再原地刷新', () => {
    game.start();
    const active = game.pickups.items.filter((it) => it.active);
    expect(active.length).toBe(1);
    const item = active[0];
    expect(game.map.pickupSpots).toContain(item.spot);
    const spot = item.spot;

    game.player.pos.x = spot[0];
    game.player.pos.z = spot[1];
    game.update(1 / 60);
    expect(item.active).toBe(false);

    // 走开等 30 秒：点位上不能重新长出道具（只有其它还没用过的点位可能补刷）
    game.player.pos.x = 0;
    game.player.pos.z = 19;
    for (let i = 0; i < 60 * 30; i++) game.update(1 / 60);
    expect(item.active).toBe(false);
    expect(item.used).toBe(true);
    for (const it of game.pickups.items) {
      if (it.active) expect(it.spot).not.toEqual(spot);
    }
  });

  it('随机补刷只在开局出过的点位之外出现，一关里每个点位只出一次；点位用尽后彻底不再刷', () => {
    game.start();
    const P = game.pickups;
    const spots = game.map.pickupSpots;
    // 清掉开局的第一个，等它被捡走后再看补刷
    const first = P.items.find((it) => it.active);
    P.items.forEach((it) => {
      it.active = false;
      it.group.visible = false;
    });
    const seen = new Set([spots.indexOf(first.spot)]);
    expect(seen.has(-1)).toBe(false);

    for (let n = 1; n < spots.length; n++) {
      P.spawnTimer = 0;
      game.update(1 / 60);
      const live = P.items.filter((it) => it.active);
      expect(live.length).toBe(1);
      const idx = spots.indexOf(live[0].spot);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(seen.has(idx)).toBe(false);
      seen.add(idx);
      P.items.forEach((it) => {
        it.active = false;
        it.group.visible = false;
      });
    }
    // 点位全部用完：再等也刷不出新道具
    P.spawnTimer = 0;
    for (let i = 0; i < 60 * 20; i++) game.update(1 / 60);
    expect(P.finished).toBe(true);
    expect(P.items.some((it) => it.active)).toBe(false);
  });

  it('被顶掉/捡走的道具不会在地图上再次出现，新一局才重新随机关卡道具', () => {
    game.start();
    giveSun(999);
    const P = game.pickups;
    const item = P.items.find((it) => it.active);
    const spot = item.spot;
    const index = item.index;
    game.player.pos.x = spot[0];
    game.player.pos.z = spot[1];
    game.update(1 / 60);
    expect(item.active).toBe(false);
    // 同一关里这个点位/这件道具都不会再出现
    for (let i = 0; i < 60 * 20; i++) game.update(1 / 60);
    expect(P.items.some((it) => it.active && it.spot === spot && it.index === index)).toBe(false);
    // 重开一局：重新随机刷新
    game.restart();
    expect(P.items.filter((it) => it.active).length).toBe(1);
    expect(P.finished).toBe(false);
  });

  it('豌豆常驻 1 号槽；枪②只一格，捡到新枪顶掉上一把；大杀器独立成槽', () => {
    game.start();
    const W = game.weapons;
    game.pickups.dropAt = vi.fn();
    game.ctx.pickups = game.pickups;
    // 豌豆永远在 1 号枪槽
    expect(W.slots.peaGun).toEqual([0]);
    W.pickup(4); // 双发 → 枪②
    expect(W.slots.gun).toEqual([4]);
    W.pickup(8); // 西瓜 → 大杀器
    expect(W.slots.gun).toEqual([4]);
    expect(W.slots.demo).toEqual([8]);
    // 再捡机枪：顶掉枪②的双发，豌豆和大杀器都不动
    expect(W.pickup(6)).toBe(true);
    expect(W.slots.gun).toEqual([6]);
    expect(W.slots.peaGun).toEqual([0]);
    expect(W.slots.demo).toEqual([8]);
    expect(W.ammo[4]).toBe(0);
    // 大杀器也只有一个位：辣椒顶掉西瓜
    expect(W.pickup(9)).toBe(true);
    expect(W.slots.demo).toEqual([9]);
    expect(W.ammo[8]).toBe(0);
  });
});

describe('9. 武器切换', () => {
  it('按 1-5 切五个角色槽（豌豆/枪/大杀器/手雷/护盾），没有植物栏了', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    const idx = (id) => WEAPONS.findIndex((w) => w.id === id);
    const nut = idx('wallnut');
    const fire = idx('firepea');

    // 先把手里的东西摆好：火豌豆进枪②、坚果进护盾槽
    W.pickup(fire);
    W.pickup(nut);
    key('Digit1');
    game.update(1 / 60);
    expect(W.current).toBe(0); // 1 = 常驻豌豆

    key('Digit2');
    game.update(1 / 60);
    expect(W.current).toBe(fire);

    key('Digit5');
    game.update(1 / 60);
    expect(W.current).toBe(nut);
    expect(W.models[nut].group.visible).toBe(true);
    expect(game.hud.weaponButtons[4].btn.classList.contains('active')).toBe(true);

    // 空槽按了没反应，不会打断当前武器
    key('Digit3');
    game.update(1 / 60);
    expect(W.current).toBe(nut);
    key('Digit4');
    game.update(1 / 60);
    expect(W.current).toBe(nut);

    // 切回火豌豆后真的能开火（弹匣制：扣弹药，不直接扣阳光）
    key('Digit2');
    game.update(1 / 60);
    game.zombies.queue = [];
    game.zombies.state = 'idle';
    const sunBefore = game.sun;
    const ammoBefore = W.ammo[fire];
    const peaBefore = game.projectiles.peas.filter((p) => p.active).length;
    W.cooldown = 0;
    game.controls.setFiring(true);
    game.update(1 / 60);
    game.controls.setFiring(false);
    expect(W.ammo[fire]).toBe(ammoBefore - 1);
    expect(game.sun).toBe(sunBefore);
    expect(game.projectiles.peas.filter((p) => p.active).length).toBeGreaterThan(peaBefore);
  });

  it('数字键与槽位一一对应：1 豌豆 / 2 枪② / 3 大杀器 / 4 手雷 / 5 护盾', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    W.pickup(6); // 机枪 → 枪②
    W.pickup(8); // 西瓜 → 大杀器
    W.pickup(2); // 樱桃 → 手雷

    key('Digit1');
    game.update(1 / 60);
    expect(W.current).toBe(0);

    key('Digit2');
    game.update(1 / 60);
    expect(W.current).toBe(6);

    key('Digit3');
    game.update(1 / 60);
    expect(W.current).toBe(8);

    key('Digit4');
    game.update(1 / 60);
    expect(W.current).toBe(2);

    // Tab 在这几个槽之间循环（护盾空，跳过）
    key('Digit1');
    game.update(1 / 60);
    key('Tab');
    game.update(1 / 60);
    expect(W.current).toBe(6);
    key('Tab');
    game.update(1 / 60);
    expect(W.current).toBe(8);
  });

  it('未拾取的战利品空位不能被装备', () => {
    game.start();
    game.weapons.equip(4); // repeater 没捡过
    expect(game.weapons.current).toBe(0);
  });

  it('暂停中点击植物栏不切枪', () => {
    game.start();
    game.pause();
    click(game.hud.weaponButtons[1].btn);
    expect(game.weapons.current).toBe(0);
  });

  it('非 playing 下的键盘输入不生效', () => {
    expect(game.state).toBe('menu');
    key('Digit3');
    game.update(1 / 60);
    expect(game.weapons.current).toBe(0);
  });
});

describe('10. 平台 / 跳跃', () => {
  it('雪地：矮墙旁跳跃能站上去（y≈0.92），走出边缘落回地面', async () => {
    game.selectMap('snow');
    game.start();
    const platforms = game.map.platforms;
    // 两侧 0.85 米矮墙：x=±14.6，w=1，d=28，平台高度 h+0.07
    const wall = platforms.find((p) => Math.abs(p.x - 14.6) < 0.01 && p.d > 20);
    expect(wall).toBeTruthy();
    expect(wall.h).toBeCloseTo(0.92, 2);

    const p = game.player.pos;
    // 离墙 1.6 米起跳：弧顶正好落在 1.3 米宽的墙顶上（贴墙跑跳会直接跨过去）
    p.x = wall.x - wall.w / 2 - 1.6;
    p.z = 0;
    p.y = 0;
    game.player.yaw = 0;
    game.player.vel.set(0, 0, 0);
    // 面向 +x 方向（yaw = -PI/2 → forward = (-sin, -cos) = (1, 0)）
    game.player.yaw = -Math.PI / 2;
    await aimAt(game, wall.x, 1.66, 0);

    // 一直前进 + 起跳：墙高 0.92 > STEP_HEIGHT(0.42)，只能靠跳跃越过侧碰撞
    game.controls.keys.add('KeyW');
    let topped = -1;
    for (let i = 0; i < 150; i++) {
      // 只在脚下没有平台时起跳：站上墙顶后别再跳，否则会从墙的另一面下去
      if (game.player.grounded && game.player.pos.y < 0.01) game.controls.jumpQueued = true;
      step(game, 1);
      game.controls.jumpQueued = false; // 起跳后清掉，别每帧连跳
      if (topped < 0 && game.player.grounded && game.player.pos.y >= wall.h - 0.02) {
        topped = game.player.pos.y;
        break;
      }
    }
    expect(topped).toBeGreaterThan(0);
    expect(topped).toBeCloseTo(wall.h, 1);
    game.controls.keys.delete('KeyW');

    // 继续往 +x 走出矮墙外侧 → 下落回地面
    game.controls.keys.add('KeyW');
    step(game, 120);
    game.controls.keys.delete('KeyW');
    step(game, 120); // 停下来等落地：边走边落会正好走进 14.6 米外侧、紧贴墙脚的下一处碰撞
    expect(game.player.pos.x).toBeGreaterThan(wall.x + wall.w / 2);
    expect(game.player.pos.y).toBeCloseTo(0, 1);
    expect(game.player.grounded).toBe(true);
  });

  it('雪地 3.6 米田字柱跳不上去', async () => {
    game.selectMap('snow');
    game.start();
    const pillar = game.map.platforms.reduce((a, b) => (a.h > b.h ? a : b), { h: 0 });
    expect(pillar.h).toBeGreaterThan(3);
    const p = game.player.pos;
    p.x = pillar.x - pillar.w / 2 - 0.7;
    p.z = pillar.z;
    p.y = 0;
    game.player.vel.set(0, 0, 0);
    await aimAt(game, pillar.x + 4, 1.66, pillar.z);
    game.controls.keys.add('KeyW');
    game.controls.jumpQueued = true;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      step(game, 1);
      peak = Math.max(peak, game.player.pos.y);
    }
    game.controls.keys.delete('KeyW');
    // 从没站上过柱子：全程脚都没高过柱子顶面，峰值也不超过一次跳跃的最高点
    expect(peak).toBeLessThan(TUNING.jumpSpeed ** 2 / (TUNING.gravity * 2) + 0.01);
  });

  it('沙城 0.4 米观景台：走过去自动踏步上去', async () => {
    game.selectMap('dust');
    game.start();
    const deck = game.map.platforms.find((pl) => pl.x === 22.5 && pl.z === -17.5);
    expect(deck).toBeTruthy();
    expect(deck.h).toBeCloseTo(0.4, 2);

    const p = game.player.pos;
    p.x = deck.x - deck.w / 2 - 1.2;
    p.z = deck.z;
    p.y = 0;
    game.player.vel.set(0, 0, 0);
    await aimAt(game, deck.x + 4, 1.66, deck.z);
    game.controls.keys.add('KeyW');
    step(game, 90);
    game.controls.keys.delete('KeyW');
    expect(game.player.pos.y).toBeCloseTo(deck.h, 2);
  });

  it('空格跳跃：离开地面后落回 0', () => {
    game.start();
    game.player.pos.set(0, 0, 12);
    game.player.vy = 0;
    game.player.grounded = true;
    key('Space');
    step(game, 1);
    expect(game.player.pos.y).toBeGreaterThan(0);
    expect(game.player.grounded).toBe(false);
    step(game, 90);
    expect(game.player.pos.y).toBeCloseTo(0, 3);
    expect(game.player.grounded).toBe(true);
  });
});

describe('11. 僵尸进攻与回血', () => {
  it('僵尸贴近攻击：hp 下降、受伤闪烁、regenDelay 后回血', () => {
    game.start();
    game.zombies.zombies.forEach((z) => z.dispose());
    game.zombies.zombies.length = 0;
    game.zombies.queue = [];
    game.zombies.state = 'idle';

    const p = game.player.pos;
    spawnZombieAt(game, 'normal', p.x, p.z - 1.3, { speedMul: 0 });
    const hurt = vi.spyOn(game.sfx, 'hurt');

    step(game, 90);
    expect(game.player.hp).toBeLessThan(game.player.maxHp);
    expect(hurt).toHaveBeenCalled();
    expect($('damageVignette').classList.contains('show')).toBe(true);
    expect(parseInt($('hpText').textContent, 10)).toBe(Math.ceil(game.player.hp));
    expect(hidden($('hud'))).toBe(false);

    // 移开僵尸，等待 regenDelay(7s) 后开始回血
    game.zombies.zombies[0].root.position.z = p.z - 20;
    game.zombies.zombies[0].speed = 0;
    const hpLow = game.player.hp;
    step(game, Math.ceil(7.2 * 60));
    expect(game.player.hp).toBeGreaterThan(hpLow);
    expect($('hpFill').style.width).not.toBe('');
  });

  it('血量低于 32% 时血条换成警示滤镜', () => {
    game.start();
    game.player.hp = 20;
    game.hud.setHealth(20, 100);
    expect($('hpFill').style.filter).toContain('brightness');
    game.player.hp = 90;
    game.hud.setHealth(90, 100);
    expect($('hpFill').style.filter).toBe('');
  });

  it('onZombieAttack 在非 playing 时不扣血', () => {
    game.start();
    game.pause();
    const hp = game.player.hp;
    game.onZombieAttack({ type: 'normal', def: { damage: 30 } });
    expect(game.player.hp).toBe(hp);
  });
});

describe('12. 渲染循环', () => {
  it('loop 调用 renderer.render；playing 时武器可见，over 后隐藏', () => {
    expect(game.weapons.root.visible).toBe(true); // 构造函数里默认 visible，loop 才会按状态写
    game.loop();
    expect(game.renderer.render).toHaveBeenCalledTimes(1);
    expect(game.weapons.root.visible).toBe(false); // menu 状态

    game.start();
    game.renderer.render.mockClear();
    game.loop();
    expect(game.renderer.render).toHaveBeenCalledTimes(1);
    expect(game.weapons.root.visible).toBe(true);

    game.player.damage(999);
    expect(game.state).toBe('over');
    game.loop();
    expect(game.weapons.root.visible).toBe(false);
  });

  it('loop 在 running=false 时直接返回、不再续帧', () => {
    game.running = false;
    globalThis.__rafQueue.length = 0;
    game.loop();
    expect(globalThis.__rafQueue.length).toBe(0);
    expect(game.renderer.render).not.toHaveBeenCalled();
  });

  it('帧率过低自动降分辨率、恢复后回升', () => {
    game.maxPixelRatio = 2;
    game.pixelRatio = 2;
    game.perfTime = 0;
    game.perfFrames = 0;
    // 模拟 20fps：每帧 raw=0.05，累计 2.5s 后降 0.25
    game.trackPerformance(0.05);
    for (let i = 0; i < 60; i++) game.trackPerformance(0.05);
    expect(game.pixelRatio).toBeLessThan(2);
    expect(game.renderer.setPixelRatio).toHaveBeenCalled();

    // 模拟 120fps → 回升
    const low = game.pixelRatio;
    for (let i = 0; i < 400; i++) game.trackPerformance(1 / 120);
    expect(game.pixelRatio).toBeGreaterThan(low);
  });

  it('镜头震动随时间衰减到 0', () => {
    game.shake(1);
    expect(game.shakeAmp).toBeCloseTo(1, 5);
    game.shake(1);
    expect(game.shakeAmp).toBeLessThanOrEqual(1.4);
    step(game, 120);
    expect(game.shakeAmp).toBe(0);
  });

  it('resize 按宽高比调整 FOV', () => {
    globalThis.__setViewport(390, 844);
    game.resize();
    expect(game.camera.fov).toBe(90);
    globalThis.__setViewport(844, 390);
    game.resize();
    expect(game.camera.fov).toBe(73);
    expect(game.camera.aspect).toBeCloseTo(844 / 390, 5);
  });
});

describe('13. 触屏模式', () => {
  it('触摸事件后切到 touch 模式、显示摇杆、不请求指针锁定', async () => {
    globalThis.__setViewport(844, 390);
    vi.stubGlobal('matchMedia', (query) => ({
      matches: /coarse|hover/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));
    Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    const { game: touchGame } = await freshGame();
    const lockSpy = vi.spyOn(touchGame.canvas, 'requestPointerLock');

    expect(touchGame.controls.isTouch).toBe(true);
    expect(document.body.classList.contains('touch')).toBe(true);
    expect(document.body.classList.contains('desktop')).toBe(false);
    expect(touchGame.ctx.touch).toBe(true);
    expect(hidden($('joyBase'))).toBe(false);

    touchGame.start();
    expect(lockSpy).not.toHaveBeenCalled();
    expect(document.pointerLockElement).toBeNull();
    expect(touchGame.state).toBe('playing');
  });

  it('。桌面首次触摸后切到 touch 模式并显示摇杆', async () => {
    const { game: g } = await createGame();
    expect(g.controls.isTouch).toBe(false);
    expect(g.ctx.touch).toBe(false);
    g.start();
    g.pause();
    g.controls.enabled = true;

    const ev = new window.MouseEvent('pointerdown', { bubbles: true, clientX: 700, clientY: 300 });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    Object.defineProperty(ev, 'pointerId', { value: 7 });
    g.canvas.dispatchEvent(ev);

    expect(g.controls.isTouch).toBe(true);
    expect(g.ctx.touch).toBe(true);
    expect(document.body.classList.contains('touch')).toBe(true);
    expect(document.body.classList.contains('desktop')).toBe(false);
    expect(g.hud.isTouch).toBe(true);
    expect($('tutorial').innerHTML).toContain('左下摇杆');
  });

  it('竖屏时 checkOrientation 暂停 playing', () => {
    isolateLock(game);
    game.start();
    expect(game.state).toBe('playing');
    globalThis.__setViewport(390, 844);
    game.checkOrientation();
    expect(game.state).toBe('paused');
    expect(hidden($('pauseScreen'))).toBe(false);
  });

  it('竖屏下开始游戏同样会被暂停（resize 链路）', () => {
    isolateLock(game);
    globalThis.__setViewport(390, 844);
    click($('startBtn'));
    expect(game.state).toBe('playing');
    window.dispatchEvent(new Event('resize'));
    expect(game.state).toBe('paused');
  });

  it('切回横屏不会自动恢复，需要玩家点「继续战斗」', () => {
    isolateLock(game);
    game.start();
    globalThis.__setViewport(390, 844);
    game.checkOrientation();
    expect(game.state).toBe('paused');
    globalThis.__setViewport(844, 390);
    window.dispatchEvent(new Event('resize'));
    expect(game.state).toBe('paused');
    click($('resumeBtn'));
    expect(game.state).toBe('playing');
    expect(hidden($('hud'))).toBe(false);
  });

  it('横屏触屏布局：开火/跳跃按钮驱动 controls', () => {
    game.start();
    const fireBtn = $('fireBtn');
    const down = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    fireBtn.dispatchEvent(down);
    expect(game.controls.firing).toBe(true);
    expect(fireBtn.classList.contains('pressed')).toBe(true);
    fireBtn.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    expect(game.controls.firing).toBe(false);
    expect(fireBtn.classList.contains('pressed')).toBe(false);

    const jumpDown = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(jumpDown, 'pointerType', { value: 'touch' });
    $('jumpBtn').dispatchEvent(jumpDown);
    expect(game.controls.jumpQueued).toBe(true);
    // 菜单/暂停状态下按钮不生效
    game.pause();
    fireBtn.dispatchEvent(down);
    expect(game.controls.firing).toBe(false);
  });
});

describe('14. 引导与计时器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('开局 2.8s 后显示引导，开火后引导淡出', async () => {
    const { game: g } = await freshSkyGame();
    g.start();
    expect($('tutorial').classList.contains('fade')).toBe(true);
    vi.advanceTimersByTime(2800);
    expect($('tutorial').classList.contains('fade')).toBe(false);

    // 真实开火链路：ctx.onFire → hud.fadeTutorial()
    g.ctx.onFire();
    expect($('tutorial').classList.contains('fade')).toBe(true);
  });

  it('第一滴血也会淡出引导', async () => {
    const { game: g } = await freshSkyGame();
    g.start();
    vi.advanceTimersByTime(2800);
    expect($('tutorial').classList.contains('fade')).toBe(false);
    g.onKill({ type: 'normal' }, 100, false);
    expect($('tutorial').classList.contains('fade')).toBe(true);
  });

  it('暂停中不会弹引导；9s 后桌面键位提示淡出', async () => {
    const { game: g } = await freshSkyGame();
    g.start();
    g.pause();
    vi.advanceTimersByTime(2800);
    expect($('tutorial').classList.contains('fade')).toBe(true);
    vi.advanceTimersByTime(6200);
    expect($('desktopHint').classList.contains('fade')).toBe(true);
  });

  it('重开一局会清掉上一局的引导计时器', async () => {
    const { game: g } = await freshSkyGame();
    g.start();
    vi.advanceTimersByTime(1000); // 上一局的引导还差 1.8s
    // 重开：scheduleTutorial 先 clearTimeout(旧计时器) 再重新计 2.8s
    g.restart();
    expect($('tutorial').classList.contains('fade')).toBe(true);
    vi.advanceTimersByTime(2799);
    expect($('tutorial').classList.contains('fade')).toBe(true);
    vi.advanceTimersByTime(1);
    expect($('tutorial').classList.contains('fade')).toBe(false);
  });
});

describe('15. 浏览器事件与生命周期细节', () => {
  it('横屏按钮：触摸设备下请求全屏并锁横屏，桌面直接忽略', async () => {
    const { game: g } = await createGame();
    const btn = $('orientationBtn');
    // 桌面：requestLandscape 直接返回，不碰全屏
    g.requestLandscape();
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();

    g.controls.isTouch = true;
    click(btn);
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('webglcontextlost 被阻止默认行为（防止浏览器重置上下文）', async () => {
    const { game: g } = await createGame();
    const ev = new Event('webglcontextlost', { cancelable: true });
    g.canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('切到后台（visibilitychange）会暂停，回前台不自动恢复', async () => {
    const { game: g } = await createGame();
    isolateLock(g);
    g.start();
    expect(g.state).toBe('playing');

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(g.state).toBe('paused');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(g.state).toBe('paused');
  });

  it('fullscreenchange / orientationchange 会延后重建尺寸', async () => {
    vi.useFakeTimers();
    const { game: g } = await freshSkyGame();
    const resize = vi.spyOn(g, 'resize');
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(resize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(resize).toHaveBeenCalledTimes(1);

    resize.mockClear();
    window.dispatchEvent(new Event('orientationchange'));
    vi.advanceTimersByTime(250);
    expect(resize).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('渲染循环被停下后 start() 会重新拉起 requestAnimationFrame', async () => {
    const { game: g } = await createGame();
    g.running = false;
    globalThis.__rafQueue.length = 0;
    g.start();
    expect(g.running).toBe(true);
    expect(globalThis.__rafQueue.length).toBe(1);
    expect(typeof globalThis.__rafQueue[0].cb).toBe('function');
  });

  it('静音按钮切换 sfx.muted 并加 muted 类', async () => {
    const { game: g } = await createGame();
    const mute = vi.spyOn(g.sfx, 'setMuted');
    click($('muteBtn'));
    expect(mute).toHaveBeenCalledWith(true);
    expect($('muteBtn').classList.contains('muted')).toBe(true);
    click($('muteBtn'));
    expect(mute).toHaveBeenLastCalledWith(false);
    expect($('muteBtn').classList.contains('muted')).toBe(false);
  });

  it('spendSun 边界：0 视为成功、超额失败、扣减后 HUD 同步', async () => {
    const { game: g } = await createGame();
    expect(g.spendSun(0)).toBe(true);
    expect(g.spendSun(1000)).toBe(false);
    expect(g.sun).toBe(TUNING.startSun);
    expect(g.spendSun(20)).toBe(true);
    expect(g.sun).toBe(TUNING.startSun - 20);
    expect($('sunValue').textContent).toBe(String(TUNING.startSun - 20));
  });

  it('onKill 累加分数与击杀、boss 额外镜头震动', async () => {
    const { game: g } = await createGame();
    g.shakeAmp = 0;
    // 传真实 def：onKill 现在按 def.boss 判 BOSS（数据驱动，不再看 type 字符串）
    g.onKill({ type: 'normal', def: ZOMBIES.normal }, 100, false);
    expect(g.stats.score).toBe(100);
    expect(g.shakeAmp).toBe(0);
    g.onKill({ type: 'boss', def: ZOMBIES.boss }, 2500, true);
    expect(g.stats.score).toBe(2600);
    expect(g.stats.kills).toBe(2);
    expect(g.shakeAmp).toBeCloseTo(0.9, 5);
  });

  it('onExplosion 按距离衰减震屏', async () => {
    const { game: g } = await createGame();
    g.shakeAmp = 0;
    g.onExplosion({ x: g.player.pos.x, z: g.player.pos.z }, 5);
    const near = g.shakeAmp;
    expect(near).toBeCloseTo(1.2, 5);
    g.shakeAmp = 0;
    g.onExplosion({ x: g.player.pos.x + 40, z: g.player.pos.z }, 5);
    expect(g.shakeAmp).toBe(0);
  });
});

describe('14. 武器角色槽端到端', () => {
  it('捡起→丢下→再捡回：丢下的枪仍在原地，可被重新拾取', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    W.pickup(5);
    expect(W.slots.gun[0]).toBe(5);
    W.dropSlot('gun', 0);
    expect(W.slots.gun[0]).toBe(-1);
    const onGround = game.pickups.items.find((it) => it.dropped && it.active);
    expect(onGround).toBeTruthy();
    expect(onGround.index).toBe(5);
    // 走回枪的位置（丢下的地方有 1 秒冷却）
    game.player.pos.x = onGround.group.position.x;
    game.player.pos.z = onGround.group.position.z;
    for (let i = 0; i < 60 * 2; i++) game.update(1 / 60);
    expect(W.slots.gun[0]).toBe(5);
  });

  it('同角色槽满了就替换，不弹窗；旧枪掉在地上，豌豆槽不动', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    W.pickup(4); // 双发 → 枪②
    const item = game.pickups.items[0];
    item.active = true;
    item.dropped = true;
    item.index = 7; // 仙人掌
    item.pickCooldown = 0;
    game.player.pos.x = item.group.position.x;
    game.player.pos.z = item.group.position.z;
    game.update(1 / 60);
    // 一步到位：顶掉枪②，拾取物被拿走
    expect(W.slots.gun).toEqual([7]);
    expect(W.slots.peaGun).toEqual([0]);
    expect(item.active).toBe(false);
    expect(W.ammo[4]).toBe(0);
    // 被换下来的枪掉在脚边，可以再捡
    expect(game.pickups.items.some((it) => it.dropped && it.index === 4)).toBe(true);
  });

  it('Tab 循环切槽、Backspace 丢弃都走真实按键路径', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    game.pickups.dropAt = vi.fn();
    game.ctx.pickups = game.pickups;
    W.pickup(4);
    W.pickup(8);
    key('Digit1');
    game.update(1 / 60);
    expect(W.current).toBe(0);
    // Tab：豌豆 → 枪② → 大杀器
    key('Tab');
    game.update(1 / 60);
    expect(W.current).toBe(4);
    key('Tab');
    game.update(1 / 60);
    expect(W.current).toBe(8);
    // G 现在是手雷蓄力键，丢弃改到 Backspace
    key('Backspace');
    game.update(1 / 60);
    expect(W.slots.demo).toEqual([-1]);
    expect(W.slots.gun).toEqual([4]);
    expect(W.slots.peaGun).toEqual([0]);
  });

  it('坚果是常驻槽，Backspace 丢不掉', () => {
    game.start();
    const W = game.weapons;
    const nut = WEAPONS.findIndex((w) => w.id === 'wallnut');
    key('Digit5');
    game.update(1 / 60);
    expect(W.current).toBe(nut);
    key('Backspace');
    game.update(1 / 60);
    expect(W.slots.shield).toEqual([nut]);
    expect(W.current).toBe(nut);
  });

  it('12345 走真实按键切到对应角色槽', () => {
    game.start();
    giveSun(999);
    const W = game.weapons;
    W.pickup(6); // 机枪 → 枪②
    W.pickup(8); // 西瓜 → 大杀器
    key('Digit3');
    game.update(1 / 60);
    key('Digit1');
    game.update(1 / 60);
    expect(W.current).toBe(0); // 1 = 常驻豌豆
    key('Digit2');
    game.update(1 / 60);
    expect(W.current).toBe(6);
    key('Digit3');
    game.update(1 / 60);
    expect(W.current).toBe(8);
    expect(game.hud.slotButtons[2].classList.contains('active')).toBe(true);
  });

  it('重开一局只保留豌豆和坚果两个常驻槽', () => {
    game.start();
    giveSun(999);
    game.weapons.pickup(5);
    game.weapons.pickup(8);
    game.start();
    // 重开清空捡来的枪，但豌豆/坚果常驻槽保留
    expect(game.weapons.slots).toEqual({
      peaGun: [0], gun: [-1], demo: [-1], grenade: [-1],
      shield: [WEAPONS.findIndex((w) => w.id === 'wallnut')],
    });
    expect(game.hud.slotDock.classList.contains('hidden')).toBe(false);
  });
});
