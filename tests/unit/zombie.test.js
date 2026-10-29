import { describe, it, expect, vi, beforeEach } from 'vitest';

// 僵尸模型替身：结构同 public/models/zombie.glb（单网格、Z-up、脚底 y=0、高 1.108）。
// 在模块级 mock 掉 ZombieModel.js，这样不依赖 createGame() 的时序：任何用例里 new Zombie 都能拿到模型，
// 同时保持 zombieModel.ready 的语义给 ZombieManager 用。
vi.mock('../../src/entities/ZombieModel.js', async (importOriginal) => {
  const THREE = await import('three');
  const actual = await importOriginal();
  const geo = new THREE.BoxGeometry(0.45, 0.62, 1.108);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9ab271, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'zombie_body';
  const node = new THREE.Group();
  node.name = 'zombie_root';
  node.rotation.x = Math.PI / 2;
  node.add(mesh);
  const scene = new THREE.Group();
  scene.name = 'Scene';
  scene.add(node);
  return { ...actual, zombieModel: { started: true, ready: true, failed: false, scene } };
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

// 僵尸的所有行为都在 Zombie.update / hit / startDeath 里，数值口径来自 config.js：
// normal hp62 speed2.05 radius0.46 scale1；cone 130/1.95/0.48/1.02；bucket 270/1.55/0.52/1.08；boss 1450/1.3/0.9/1.85。
const DT = 1 / 60;

let THREE;
let ZOMBIES;
let ZombieManager;
let Zombie;
let PD;

async function boot() {
  const g = await import('../helpers/game.js');
  PD = g;
  THREE = await import('three');
  ({ ZOMBIES } = await import('../../src/config.js'));
  ({ Zombie } = await import('../../src/entities/Zombie.js'));
  const { game } = await g.readyGame();
  game.start();
  return game;
}

function vec(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}

function makeCtx(map = null) {
  return {
    scene: new THREE.Scene(),
    map,
    env: null,
    particles: { burst: vi.fn() },
    sfx: { groan: vi.fn(), dirt: vi.fn() },
    onAttack: vi.fn(),
    onZombieAttack: vi.fn(), // ZombieManager.spawnOne 里会读
    onBossSpawn: vi.fn(),
  };
}

// 直接用 src/entities/Zombie.js 造僵尸（不经过 ZombieManager）：ctx 可精确控制，
// 生成口径与 ZombieManager.spawnOne 一致（hpMul/speedMul 由调用方给）。
// 注意：僵尸模型由本文件顶部的 vi.mock('../../src/entities/ZombieModel.js') 在模块级提供，
// 不依赖 createGame() 的时序；走 Game 的用例仍需先 `await boot()`（它会建好完整 Game）。
// 见下面 it('僵尸模型替身不依赖 createGame 的时序') 的断言。
function makeZombie(type = 'normal', x = 0, z = 0, ctx = makeCtx()) {
  // 走真实生成链路：new Zombie + ZombieManager.spawnOne（后者只在 Game 里用得到，这里贴上帮 plot 位置）
  return place(new Zombie(type, 1, x, z, ctx, 1, 1), x, z);
}

// 跳过出生动画并钉到指定位置。
function place(zombie, x, z) {
  zombie.root.position.set(x, 0, z);
  zombie.spawnT = 1;
  zombie.model.position.y = 0;
  return zombie;
}

function firstMesh(object) {
  let found = null;
  object.traverse((n) => {
    if (n.isMesh && !found) found = n;
  });
  return found;
}

describe('Zombie · 属性与模型骨架', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('属性按 config 与倍率计算，root 在脚底、scale = scaleFactor', () => {
    const z = makeZombie('normal', 3, 4);
    expect(z.type).toBe('normal');
    expect(z.def).toBe(ZOMBIES.normal);
    expect(z.maxHp).toBe(62);
    expect(z.hp).toBe(62);
    expect(z.speed).toBeCloseTo(2.05, 10);
    expect(z.radius).toBe(0.46);
    expect(z.scoreValue).toBe(100);
    expect(z.scaleFactor).toBe(1);
    expect(z.root.position.x).toBeCloseTo(3, 10);
    expect(z.root.position.z).toBeCloseTo(4, 10);
    expect(z.root.position.y).toBe(0);
    expect(z.root.scale.x).toBe(1);
    expect(z.alive).toBe(true);
    expect(z.dying).toBe(false);
    expect(z.dead).toBe(false);
    // attackTimer 初值在 [0.4, 1.1)：第一击不是一见面就打
    expect(z.attackTimer).toBeGreaterThanOrEqual(0.4);
    expect(z.attackTimer).toBeLessThan(1.1);
    // 通过 Game 的 spawnZombieAt 生成时位置被钉到指定坐标
    const viaGame = PD.spawnZombieAt(game, 'normal', -2, 3);
    expect(viaGame.root.position.x).toBeCloseTo(-2, 10);
    expect(viaGame.root.position.z).toBeCloseTo(3, 10);
    expect(viaGame.root.position.y).toBe(0);
  });

  it('maxHp 按 hpMul 四舍五入，speed 按 speedMul 线性放大', () => {
    const g1 = PD.spawnZombieAt(game, 'cone', 0, 0, { hpMul: 1.11, speedMul: 1.02 });
    expect(g1.maxHp).toBe(Math.round(130 * 1.11)); // 144.3 -> 144
    expect(g1.hp).toBe(g1.maxHp);
    expect(g1.speed).toBeCloseTo(1.95 * 1.02, 10);
    expect(g1.scaleFactor).toBe(1.02);
    expect(g1.radius).toBe(0.48);

    const g2 = PD.spawnZombieAt(game, 'bucket', -6, 0, { hpMul: 2.7, speedMul: 1.45 });
    expect(g2.maxHp).toBe(729); // 270 * 2.7
    expect(g2.speed).toBeCloseTo(1.55 * 1.45, 10);

    // 四舍五入而不是截断：1450 × 1.45 = 2102.5 -> 2103
    const g3 = PD.spawnZombieAt(game, 'boss', 6, 0, { hpMul: 1.45 });
    expect(g3.maxHp).toBe(2103);
    expect(g3.scaleFactor).toBe(1.85);
    expect(g3.radius).toBe(0.9);
  });

  it('命中球：胸口 0.95×scale、头部 1.45×scale，头部球半径必须小于胸口球', () => {
    // 口径必须与 ProjectileSystem / WeaponSystem 的判定一致；头部球半径 0.36×scale < 胸口 0.46×scale，
    // 否则扫掠时头部球永远先被碰到，爆头会退化成“打哪儿都爆头”（AGENTS.md 3 节）。
    const z = makeZombie('boss', 2, -3);
    const chest = z.getChest(vec());
    const head = z.getHead(vec());
    const aim = z.getAimPoint(vec());
    expect(chest.x).toBeCloseTo(2, 10);
    expect(chest.z).toBeCloseTo(-3, 10);
    expect(chest.y).toBeCloseTo(0.95 * 1.85, 10);
    expect(head.y).toBeCloseTo(1.45 * 1.85, 10);
    expect(head.y - chest.y).toBeCloseTo(0.5 * 1.85, 10);
    expect(aim.toArray()).toEqual(chest.toArray());
    expect(0.36 * z.scaleFactor).toBeLessThan(0.46 * z.scaleFactor);
    // 模型替身总高 1.108 × ZOMBIE_SCALE 1.67 × scale，头顶高于头部球
    expect(1.108 * 1.67 * z.scaleFactor).toBeGreaterThan(head.y);
  });

  it('buildRig：每个僵尸克隆材质（几何体共享、材质独立），假骨骼 uniform 与深度材质都挂上', () => {
    const a = makeZombie('normal', 0, 0);
    const b = makeZombie('normal', 2, 0);
    expect(a.mats.length).toBe(1);
    expect(a.mats.length).toBe(a.matBase.length);
    expect(a.body).not.toBe(b.body);
    expect(a.mats[0]).not.toBe(b.mats[0]);
    const meshA = firstMesh(a.body);
    const meshB = firstMesh(b.body);
    expect(meshA).toBeTruthy();
    expect(meshA.geometry).toBe(meshB.geometry); // 几何体共享，不 dispose
    expect(meshA.castShadow).toBe(true);
    expect(meshA.receiveShadow).toBe(false);
    expect(a.walk.uPhase.value).toBe(0);
    expect(a.walk.uMove.value).toBe(0);
    expect(typeof a.mats[0].onBeforeCompile).toBe('function');
    expect(a.mats[0].customDepthMaterial).toBeTruthy();
    expect(a.mats[0].envMapIntensity).toBe(0.35);
    expect(a.mats[0].emissiveIntensity).toBe(0);
    // 模型挂在 model 下；model 的 y=-2.3 是出生动画的起点（place 会把它抬到 0）
    expect(a.body.parent).toBe(a.model);
    expect(a.model.position.y).toBe(0);
  });

  it('buildHat：normal 无配件、cone 4 件、bucket 3 件、boss 木棒 2 件', () => {
    const cases = [
      ['normal', 0],
      ['cone', 4],
      ['bucket', 3],
      ['boss', 2],
    ];
    for (const [type, parts] of cases) {
      const z = makeZombie(type);
      if (parts === 0) {
        expect(z.hat).toBeUndefined();
        expect(z.mats.length).toBe(1);
        continue;
      }
      expect(z.hat).toBeTruthy();
      expect(z.hat.children.length).toBe(parts);
      expect(z.hat.parent).toBe(z.body);
      // 配件材质必须同时进 mats / matBase，白闪与寒冰才作用得到帽子上（AGENTS.md 5.2）
      expect(z.mats.length).toBe(1 + parts);
      expect(z.matBase.length).toBe(1 + parts);
      for (let i = 1; i < z.mats.length; i++) {
        expect(z.mats[i]).not.toBe(z.mats[0]);
        expect(z.mats[i].emissiveIntensity).toBe(0);
      }
    }
    const cone = makeZombie('cone');
    expect(cone.hat.position.y).toBeCloseTo(1.01, 10);
    const bucket = makeZombie('bucket');
    expect(bucket.hat.position.y).toBeCloseTo(1.06, 10);
    // Boss 的木棒握在右手（-x 侧）：棒身在上、棒头在下
    const boss = makeZombie('boss');
    expect(boss.hat.position.x).toBeCloseTo(-0.26, 10);
    expect(boss.hat.position.y).toBeCloseTo(0.46, 10);
    expect(boss.hat.children[0].position.y).toBeCloseTo(0.02, 10);
    expect(boss.hat.children[1].position.y).toBeCloseTo(-0.3, 10);
  });

  it('dispose：从场景移除、dispose 全部材质（含帽子），但不碰共享几何体', () => {
    const ctx = makeCtx();
    const z = makeZombie('cone', 0, 0, ctx);
    expect(z.root.parent).toBe(ctx.scene);
    const spies = z.mats.map((m) => vi.spyOn(m, 'dispose'));
    const geoSpy = vi.spyOn(firstMesh(z.body).geometry, 'dispose');
    z.dispose();
    expect(z.root.parent).toBe(null);
    expect(spies.length).toBe(5);
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(geoSpy).not.toHaveBeenCalled();
  });
});

describe('Zombie · 出生动画', () => {
  it('spawnT 从 -2.3 抬到 0，期间不移动、不攻击', async () => {
    const game = await boot();
    const atk = vi.fn();
    const ctx = makeCtx();
    ctx.onAttack = atk; // Zombie 走的是 ctx.onAttack（ZombieManager 里再转给 onZombieAttack）
    const z = makeZombie('normal', 0, 0, ctx);
    // 从 0.51 起步 ≈ 出生动画已播 31 帧，下一帧就跨过 0.55
    z.spawnT = 0.51;
    z.model.position.y = -2.3;
    game.player.pos.set(0, 0, 3); // 已在攻击距离内，正常早就出拳了
    z.attackTimer = 0.01;

    // 出生分支（spawnT<0.55）：只升模型，位置不动、不出拳
    for (let i = 0; i < 2; i++) {
      z.update(DT, game.player, []);
      expect(z.root.position.x).toBe(0);
      expect(z.root.position.z).toBe(0);
      expect(z.model.position.y).toBeCloseTo(0, 3); // ease-out 收尾
      expect(z.model.position.y).toBeLessThanOrEqual(0);
    }
    expect(atk).not.toHaveBeenCalled();
    expect(z.spawnT).toBeGreaterThan(0.51);
    expect(z.spawnT).toBeLessThan(0.55);

    // 跨过 0.55 的那一帧只是"离开出生分支"（这一帧还不会走），attackTimer 仍是出生期设置的值
    z.attackTimer = 0.02;
    z.update(DT, game.player, []);
    expect(z.spawnT).toBeGreaterThanOrEqual(0.55);
    expect(z.root.position.z).toBe(0);
    expect(atk).not.toHaveBeenCalled();
    // 之后才真正开始 AI：先走进攻击距离，再按 0.5 秒节奏倒数 → 归零出拳
    z.spawnT = 1;
    let walked = false;
    for (let i = 0; i < 120 && atk.mock.calls.length === 0; i++) {
      z.update(DT, game.player, []);
      if (z.root.position.z > 0) walked = true;
    }
    expect(walked).toBe(true);
    expect(atk).toHaveBeenCalled();
    expect(atk.mock.calls[0][0]).toBe(z);
  });
});

describe('Zombie · 受击与死亡', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  function freshZombie(type = 'normal', hpMul = 1) {
    return PD.spawnZombieAt(game, type, 0, 5, { hpMul });
  }

  it('spawnT < 0.5 时不吃伤害，也不闪白', () => {
    const z = freshZombie();
    z.spawnT = 0.49;
    expect(z.hit(50, false, false)).toBe(false);
    expect(z.hp).toBe(62);
    expect(z.flash).toBe(0);
    z.spawnT = 0.5;
    expect(z.hit(12, false, false)).toBe(false);
    expect(z.hp).toBe(50);
    expect(z.flash).toBe(1);
  });

  it('扣血 + flash=1；爆头只记标记；寒冰把 slowTimer 设成 2.6', () => {
    const z = freshZombie();
    z.hit(15, false, false);
    expect(z.hp).toBe(47);
    expect(z.flash).toBe(1);
    expect(z.headHit).toBe(false);
    expect(z.slowTimer).toBe(0);
    z.hit(15, true, true);
    expect(z.hp).toBe(32);
    expect(z.headHit).toBe(true);
    expect(z.slowTimer).toBe(2.6);
  });

  it('hit 返回是否致死；hp 归零触发 startDeath：粒子 14 颗 + 影子关掉', () => {
    const ctx = makeCtx();
    const z = makeZombie('normal', 0, 5, ctx);
    expect(z.shadow.visible).toBe(true);
    expect(z.hit(10, false, false)).toBe(false);
    expect(z.dying).toBe(false);
    expect(z.hit(52, false, false)).toBe(true);
    expect(z.dying).toBe(true);
    expect(z.deathT).toBe(0);
    expect(z.shadow.visible).toBe(false);
    const kill = ctx.particles.burst.mock.calls.find((c) => c[0].count === 14);
    expect(kill).toBeTruthy();
    // 爆炸点 = root.position.y + 1.2×scale（root 在脚底，所以就是 1.2）
    expect(kill[0].pos.y).toBeCloseTo(z.root.position.y + 1.2, 10);
    expect(kill[0].pos.z).toBeCloseTo(5, 10);
    expect(kill[0].color).toEqual([0x6f9a3f, 0x8fbf58, 0x4b6b28, 0x5f1d16]);
    expect(kill[0].life).toBe(0.8);
  });

  it('伤害溢出被夹到 0，重复 hit 无效（不死第二次）', () => {
    const z = freshZombie();
    z.hit(999, false, false);
    expect(z.hp).toBe(0);
    expect(z.dying).toBe(true);
    expect(z.hit(999, false, false)).toBe(false);
    expect(z.hp).toBe(0);
  });

  it('出生无敌：spawnT<0.5 时 hit 无效（Boss 也一样）', () => {
    const z = freshZombie('boss');
    z.spawnT = 0;
    expect(z.hit(100, false, false)).toBe(false);
    expect(z.hp).toBe(z.maxHp);
    expect(z.dying).toBe(false);
  });

  it('Boss 死亡粒子 28 颗，从 1.2×scale 的高度炸开', () => {
    const ctx = makeCtx();
    const z = makeZombie('boss', 0, 5, ctx);
    expect(z.spawnT).toBe(1); // makeZombie → place()：跳过出生动画
    const killed = z.hit(z.maxHp, false, false);
    expect(killed).toBe(true);
    expect(z.dying).toBe(true);
    const c = ctx.particles.burst.mock.calls[0][0];
    expect(c.count).toBe(28);
    expect(c.pos.y).toBeCloseTo(1.2 * 1.85, 10);
    expect(c.pos.x).toBeCloseTo(0, 10);
    expect(c.pos.z).toBeCloseTo(5, 10);
  });

  it('死亡流程：0.34 秒翻倒、0.55 秒后下沉、deathT > 1.55 才 dead', () => {
    const z = freshZombie();
    z.hit(999, false, false);
    const advance = (sec) => {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) z.update(DT, game.player, []);
    };
    advance(0.36);
    expect(z.model.rotation.x).toBeCloseTo(-1.5, 5);
    expect(z.model.rotation.z).toBeCloseTo(0.12, 5);
    expect(z.root.position.y).toBe(0);
    expect(z.dead).toBe(false);

    advance(0.83); // t ≈ 1.19：已过 0.55，正在下沉
    expect(z.root.position.y).toBeLessThan(-0.4);
    expect(z.root.position.y).toBeGreaterThan(-0.95);
    expect(z.model.scale.x).toBeLessThan(1);
    expect(z.dead).toBe(false);

    advance(0.5); // t ≈ 1.69 > 1.55
    expect(z.dead).toBe(true);
    expect(z.deathT).toBeGreaterThan(1.55);
    expect(z.root.position.y).toBeCloseTo(-0.95, 5);
    const y = z.root.position.y;
    z.update(DT, game.player, []); // dead 之后 update 直接返回
    expect(z.root.position.y).toBe(y);
  });
});

describe('Zombie · 追击 AI', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('距离大于攻击距离时直线追玩家，速度 = speed×speedMul', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, -10, { speedMul: 1.2 });
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -10);
    z.update(DT, game.player, []);
    expect(z.root.position.z).toBeCloseTo(-10 + 2.05 * 1.2 * DT, 6);
    expect(z.root.position.x).toBeCloseTo(0, 6);
    expect(z.root.position.y).toBe(0);
    expect(z.animSpeed).toBeCloseTo(2.05 * 1.2, 6);
    expect(z.walk.uMove.value).toBe(1);
  });

  it('攻击距离 = 1.15 + scale×0.55；贴身后 attackTimer 倒数、归零打一下并重置 1.28', () => {
    const expected = {
      normal: 1.15 + 1.0 * 0.55,
      boss: 1.15 + 1.85 * 0.55,
    };
    for (const [type, range] of Object.entries(expected)) {
      const calls = [];
      const ctx = makeCtx();
      ctx.onAttack = (z2) => calls.push(z2);
      // 僵尸站在射程内一点点（dist < attackRange），玩家在减速带外：既不追也不被推近
      const z = makeZombie(type, 0, range - 0.3, ctx);
      game.player.pos.set(0, 0, range + 0.2);
      const at = z.root.position.z;
      z.update(DT, game.player, []);
      expect(z.root.position.z).toBeCloseTo(at, 9); // 不进也不退
      // 从追击分支切进出拳分支：不会再被 Math.max(attackTimer, 0.5) 顶回去，
      // 直接按自身节奏（初值 0.4~1.1）倒数
      const chaseTimer = z.attackTimer;
      expect(chaseTimer).toBeGreaterThan(0);
      expect(chaseTimer).toBeLessThanOrEqual(1.1);
      expect(calls.length).toBe(0);

      // 倒数到 0 那帧 → onAttack + 重置 1.28 + 出拳动画
      const need = Math.ceil(chaseTimer / DT) + 2;
      for (let i = 0; i < need && calls.length === 0; i++) z.update(DT, game.player, []);
      expect(calls).toEqual([z]);
      expect(z.attackTimer).toBeCloseTo(1.28, 9);
      expect(z.attackAnim).toBeCloseTo(0.4, 6);

      // 再次倒数满 1.28 秒（76.8 帧）才会打第二下
      for (let i = 0; i < Math.floor(1.28 / DT) - 2; i++) z.update(DT, game.player, []);
      expect(calls.length).toBe(1);
      for (let i = 0; i < 4; i++) z.update(DT, game.player, []);
      expect(calls.length).toBe(2);
    }
  });

  it('在 attackRange..attackRange+0.25 的减速带里也不前进', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    z.root.position.set(0, 0, 0);
    game.player.pos.set(0, 0, 1.15 + 0.1); // 1.25，落在 [1.15, 1.4)
    z.update(DT, game.player, []);
    expect(z.root.position.z).toBeCloseTo(0, 9);
  });

  it('攻击距离之外每帧把 attackTimer 抬到至少 0.5，不会在远处凭空出拳', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, -10);
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -10);
    z.attackTimer = 0.01;
    z.update(DT, game.player, []);
    expect(z.attackTimer).toBe(0.5);
  });

  it('转身每帧最多 dt×6 弧度，并走最短弧', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    z.rotY = 0;
    z.root.rotation.y = 0;
    z.root.position.set(0, 0, 0);
    game.player.pos.set(5, 0, 0); // 目标 atan2(5, 0) = +π/2
    z.update(DT, game.player, []);
    expect(z.rotY).toBeCloseTo(6 * DT, 9);
    expect(z.root.rotation.y).toBe(z.rotY);

    // 从 +3.0 转到约 -3.0416：最短弧是 +0.2416，所以往正方向走一步
    z.rotY = 3.0;
    z.root.position.set(0, 0, 0);
    const ang = -Math.PI + 0.1;
    game.player.pos.set(Math.sin(ang) * 8, 0, Math.cos(ang) * 8);
    z.update(DT, game.player, []);
    expect(z.rotY).toBeCloseTo(3.0 + 6 * DT, 6);
  });

  it('一直朝玩家走会停在攻击距离的减速带（attackRange..attackRange+0.25）里，不会穿过去', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    z.root.position.set(0, 0, -6);
    game.player.pos.set(0, 0, 0);
    for (let i = 0; i < 240; i++) z.update(DT, game.player, []);
    const d = Math.hypot(z.root.position.x, z.root.position.z);
    // 直线追 6 米（≈1.76 秒）后停在 attackRange（normal = 1.15+0.55 = 1.7）附近
    expect(d).toBeLessThan(6 - 3);
    expect(d).toBeLessThanOrEqual(1.15 + 1 * 0.55 + 0.3);
    expect(d).toBeGreaterThan(1.0); // 不会贴到身上
    z.root.position.set(0.05, 0, -1.0);
  });
});

describe('Zombie · 减速与白闪', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('slowTimer > 0：速度乘 0.42，材质染成冰蓝；到期恢复基色', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, -10);
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -10);
    z.hit(5, true, false);
    expect(z.slowTimer).toBe(2.6);
    const base = z.matBase[0].clone();
    z.update(DT, game.player, []);
    expect(z.root.position.z).toBeCloseTo(-10 + 2.05 * 0.42 * DT, 6);
    const tinted = z.mats[0].color.clone();
    expect(tinted.b).toBeGreaterThan(tinted.r);
    expect(tinted.b).toBeGreaterThan(0.5);

    for (let i = 0; i < 170; i++) z.update(DT, game.player, []);
    expect(z.slowTimer).toBeLessThanOrEqual(0);
    const restored = z.mats[0].color.clone();
    expect(restored.r).toBeCloseTo(base.r * z.baseTint.r, 6);
    expect(restored.g).toBeCloseTo(base.g * z.baseTint.g, 6);
    expect(restored.b).toBeCloseTo(base.b * z.baseTint.b, 6);
    // 恢复后再走一帧：slowTimer 被钉在 -1，不会无限减小
    z.update(DT, game.player, []);
    expect(z.slowTimer).toBe(-1);
  });

  it('减速对帽子材质同样生效', () => {
    const z = PD.spawnZombieAt(game, 'bucket', 0, -10);
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -10);
    expect(z.mats.length).toBe(4);
    z.hit(5, true, false);
    z.update(DT, game.player, []);
    for (const m of z.mats) expect(m.color.b).toBeGreaterThan(m.color.r);
  });

  it('白闪：flash=1 时 emissiveIntensity > 0，按 delta×12 衰减到 0', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, -10);
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -10);
    z.hit(5, false, false);
    expect(z.flash).toBe(1);
    z.update(DT, game.player, []);
    expect(z.flash).toBeCloseTo(1 - 12 * DT, 9);
    expect(z.mats[0].emissiveIntensity).toBeCloseTo((1 - 12 * DT) * 0.45, 9);
    for (let i = 0; i < 20; i++) z.update(DT, game.player, []);
    expect(z.flash).toBe(0);
    expect(z.mats[0].emissiveIntensity).toBe(0);
  });

  it('applyFlash / applyTint 覆盖全部材质（身体 + 帽子都闪、都变蓝）', () => {
    const z = makeZombie('cone');
    expect(z.mats.length).toBe(5);
    z.applyFlash(0.75);
    for (const m of z.mats) expect(m.emissiveIntensity).toBe(0.75);
    z.applyFlash(0);
    for (const m of z.mats) expect(m.emissiveIntensity).toBe(0);
    z.applyTint(0.55);
    for (const m of z.mats) expect(m.color.b).toBeGreaterThan(m.color.r);
    z.applyTint(0);
    for (const m of z.mats) expect(m.color.b).toBeLessThanOrEqual(m.color.r);
  });
});

describe('Zombie · 碰撞与卡住绕行', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('撞进圆形碰撞体被推出到 r + radius×0.8 = 0.968', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    game.player.pos.set(0, 0, 0);
    z.root.position.set(0, 0, -0.5);
    z.update(DT, game.player, [{ x: 0, z: 0, r: 0.6 }]);
    const d = Math.hypot(z.root.position.x, z.root.position.z);
    expect(d).toBeGreaterThanOrEqual(0.968 - 1e-6);
    expect(d).toBeLessThan(1.2); // 只推到刚好贴着，不会弹飞
  });

  it('被正面挡住时沿切线滑动：每帧都不陷进碰撞体，横向逐渐绕开', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    game.player.pos.set(0, 0, -5); // 玩家在障碍后面，僵尸被挡住还得继续走
    z.root.position.set(0.05, 0, -1.5);
    const colliders = [{ x: 0, z: -2.0, r: 0.6 }];
    let moved = 0;
    let prev = { x: z.root.position.x, z: z.root.position.z };
    for (let i = 0; i < 30; i++) {
      z.update(DT, game.player, colliders);
      moved += Math.hypot(z.root.position.x - prev.x, z.root.position.z - prev.z);
      prev = { x: z.root.position.x, z: z.root.position.z };
      const d = Math.hypot(z.root.position.x - colliders[0].x, z.root.position.z - colliders[0].z);
      expect(d).toBeGreaterThanOrEqual(0.968 - 1e-6); // 从不陷进去
    }
    expect(moved).toBeGreaterThan(0.05); // 不是被顶死原地不动
    // 沿切线走：x 偏移被放大（绕障碍转开）
    expect(Math.abs(z.root.position.x)).toBeGreaterThan(0.1);
  });

  it('地图 bounds 内 clamp（半宽 - 0.6）', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    const b = game.map.bounds;
    z.root.position.set(b.x - 0.62, 0, 0);
    game.player.pos.set(100, 0, 0);
    z.update(DT, game.player, []);
    expect(z.root.position.x).toBeCloseTo(b.x - 0.6, 9);
    z.root.position.set(0, 0, -(b.z - 0.62));
    game.player.pos.set(0, 0, -100);
    z.update(DT, game.player, []);
    expect(z.root.position.z).toBeCloseTo(-(b.z - 0.6), 9);
  });

  it('被卡住超过 0.45s → 进入 2.4s detour 并每轮翻转方向', () => {
    // 真实卡死场景：僵尸被玩家逼在地图边界外（bounds clamp 每帧把它按回原处），
    // 每帧净位移 < speed*dt*0.35，于是 stuckT 由 update 自己累积。
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    const b = game.map.bounds;
    z.root.position.set(b.x - 0.6, 0, 10);
    game.player.pos.set(b.x + 2, 0, 10); // 玩家在界外，僵尸永远追不到
    let steps = 0;
    for (; steps < 100; steps++) {
      z.update(DT, game.player, []);
      if (z.detourT > 0) break;
    }
    expect(z.detourT).toBe(2.4);
    expect(z.detourT).toBeGreaterThan(2.0);
    expect(z.detourT).toBeLessThanOrEqual(2.4);
    expect(z.stuckT).toBe(0);
    // 0.45 秒才触发：0.45/DT = 27 帧
    expect(steps).toBe(27);
    // 第一轮翻转 detourFlip（+1 → -1）；方向沿主轴（|dz| 更大时取 z 轴），
    // detourFlip<0 时把刚算出的 +z 方向取反再乘回去，最终仍是 (0, +1)
    expect(z.detourFlip).toBe(-1);
    expect(Math.abs(z.detourX) + Math.abs(z.detourZ)).toBe(1);
    expect(z.detourX).toBe(0);
    expect(z.detourZ).toBe(1);

    // detour 期间持续倒数（2.4 秒后归 0），之后再卡住会翻回 +1
    for (let i = 0; i < 150; i++) z.update(DT, game.player, []);
    expect(z.detourT).toBeLessThanOrEqual(0);
    let flippedBack = false;
    for (let i = 0; i < 200 && !flippedBack; i++) {
      z.update(DT, game.player, []);
      if (z.detourT > 0 && z.detourFlip === 1) flippedBack = true;
    }
    expect(flippedBack).toBe(true);
  });

  it('贴身之后 stuckT 与 detourT 清零', () => {
    const z = PD.spawnZombieAt(game, 'normal', 0, 0);
    z.root.position.set(0, 0, 0);
    z.stuckT = 0.4;
    z.detourT = 1.2;
    game.player.pos.set(0, 0, 0.5); // 攻击距离内
    z.update(DT, game.player, []);
    expect(z.stuckT).toBe(0);
    expect(z.detourT).toBe(0);
  });
});

describe('Zombie · 流场寻路', () => {
  const mapWith = (flowAt) => ({ bounds: { x: 23, z: 23 }, flowAt });

  it('距离 > attackRange + 1.2 时优先跟随 map.flowAt，而不是直线扑玩家', () => {
    const ctx = makeCtx(mapWith((x, z, out) => {
      out.x = 1; // 流场指向 +x，玩家在 +z 方向
      out.z = 0;
      return true;
    }));
    const z = makeZombie('normal', 0, -10, ctx);
    z.update(DT, { pos: vec(0, 0, 0) }, []);
    expect(z.flowActive).toBe(true);
    expect(z.flow.x).toBe(1);
    expect(z.flow.z).toBe(0);
    expect(z.root.position.x).toBeCloseTo(2.05 * DT, 6);
    expect(z.root.position.z).toBeCloseTo(-10, 6);
  });

  it('flowAt 返回 false 时回退到直线追击，flowActive=false', () => {
    const ctx = makeCtx(mapWith(() => false));
    const z = makeZombie('normal', 0, -10, ctx);
    z.update(DT, { pos: vec(0, 0, 0) }, []);
    expect(z.flowActive).toBe(false);
    expect(z.root.position.x).toBeCloseTo(0, 9);
    expect(z.root.position.z).toBeCloseTo(-10 + 2.05 * DT, 6);
  });

  it('距离在 attackRange..attackRange+1.2 之间时直接扑玩家，不查流场', () => {
    const flowAt = vi.fn((x, z, out) => {
      out.x = 1;
      out.z = 0;
      return true;
    });
    const ctx = makeCtx(mapWith(flowAt));
    const z = makeZombie('normal', 0, -2.0, ctx);
    z.update(DT, { pos: vec(0, 0, 0) }, []);
    expect(flowAt).not.toHaveBeenCalled();
    expect(z.flowActive).toBe(false);
    expect(z.root.position.z).toBeGreaterThan(-2.0);
  });

  it('跟流场走时位置没变也不判定为卡住（stuckT 不累积）', () => {
    const ctx = makeCtx(mapWith((x, z, out) => {
      out.x = 0; // 流场给 0 方向 → 僵尸原地不动
      out.z = 0;
      return true;
    }));
    const z = makeZombie('normal', 0, -10, ctx);
    for (let i = 0; i < 60; i++) z.update(DT, { pos: vec(0, 0, 0) }, []);
    expect(z.root.position.z).toBeCloseTo(-10, 9);
    expect(z.flowActive).toBe(true);
    expect(z.stuckT).toBe(0);
    expect(z.detourT).toBe(0);
  });
});

describe('Zombie · 与 Game 的联动', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('贴身 Boss 出拳让玩家掉 def.damage 血，并把镜头震一下', () => {
    const z = PD.spawnZombieAt(game, 'boss', 0, 1.85);
    game.player.pos.set(0, 0, 0);
    game.player.invuln = 0;
    game.player.hp = 100;
    const hp0 = game.player.hp;
    z.attackTimer = 0;
    z.update(DT, game.player, []);
    expect(game.player.hp).toBe(hp0 - 26);
    expect(game.shakeAmp).toBeGreaterThan(0.3);
  });

  it('命中球比例：boss 胸口 1.7575、头部 2.6825（1.45/0.95）', () => {
    const z = PD.spawnZombieAt(game, 'boss', 0, 0);
    expect(z.getChest(vec()).y).toBeCloseTo(1.7575, 6);
    expect(z.getHead(vec()).y).toBeCloseTo(2.6825, 6);
    expect(z.getHead(vec()).y / z.getChest(vec()).y).toBeCloseTo(1.45 / 0.95, 10);
  });

  it('normal 的 hit(61.99) 不死，hit(62) 死', () => {
    const a = PD.spawnZombieAt(game, 'normal', 0, 0);
    expect(a.hit(61.99, false, false)).toBe(false);
    expect(a.alive).toBe(true);
    expect(a.dying).toBe(false);
    const b = PD.spawnZombieAt(game, 'normal', 2, 0);
    expect(b.hit(62, false, false)).toBe(true);
    expect(b.dying).toBe(true);
  });
});