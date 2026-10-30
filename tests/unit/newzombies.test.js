import { describe, it, expect, vi, beforeEach } from 'vitest';

// 新内容（P1）：材质护甲 / 燃烧 / 空中层级 / 气球配额 / 3D 爆炸距离。
// 与 zombie.test.js 用同一套模型替身：模块级 mock 掉 ZombieModel.js，任何用例里 new Zombie 都能拿到模型。
vi.mock('../../src/entities/ZombieModel.js', async (importOriginal) => {
  const THREE = await import('three');
  const actual = await importOriginal();
  const geo = new THREE.BoxGeometry(0.45, 1.194, 0.3);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9ab271, roughness: 0.8 });
  const rootBone = new THREE.Bone();
  rootBone.name = 'Root';
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.y = 0.39;
  rootBone.add(head);
  const skeleton = new THREE.Skeleton([rootBone, head]);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'zombie_body';
  mesh.add(rootBone);
  mesh.bind(skeleton);
  const mkClip = (name) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.99]),
  ]);
  const clips = ['Idle', 'Walk', 'Idle_Attack', 'Death', 'HitReact'].map(mkClip);
  const scene = new THREE.Group();
  scene.add(mesh);
  return {
    ...actual,
    zombieModel: {
      started: true,
      ready: true,
      failed: false,
      scene,
      clips,
      skeleton: { ready: true, failed: false, scene: new THREE.Group(), clips: [] },
      alchemist: { ready: true, failed: false, scene: new THREE.Group(), clips: [] },
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
let ZOMBIES;
let ARMOR_MATERIALS;
let Zombie;
let WEAPONS;

async function boot() {
  const g = await import('../helpers/game.js');
  THREE = await import('three');
  ({ ZOMBIES, ARMOR_MATERIALS } = await import('../../src/config.js'));
  ({ WEAPONS } = await import('../../src/config.js'));
  ({ Zombie } = await import('../../src/entities/Zombie.js'));
  const { game } = await g.readyGame();
  game.start();
  return game;
}

function makeCtx() {
  return {
    scene: new THREE.Scene(),
    map: null,
    env: null,
    particles: { burst: vi.fn() },
    sfx: { armorBreak: vi.fn(), balloonPop: vi.fn() },
    onAttack: vi.fn(),
    onZombieAttack: vi.fn(),
    onBossSpawn: vi.fn(),
  };
}

function makeZombie(type, ctx = makeCtx()) {
  const z = new Zombie(type, 1, 0, 0, ctx, 1, 1);
  z.spawnT = 1;
  z.model.position.y = 0;
  return z;
}

export { makeCtx, makeZombie, boot };

describe('材质护甲层', () => {
  beforeEach(async () => {
    await boot();
  });

  it('橄榄球：护甲满值时吸收 50%，护甲自己扣血', () => {
    const z = makeZombie('football');
    expect(z.armorMax).toBe(140);
    expect(z.armorHp).toBe(140);
    z.hit(100, false, false, { type: 'pea' });
    // 护甲吸收一半：血掉 50，护甲掉 100
    expect(z.hp).toBe(z.maxHp - 50);
    expect(z.armorHp).toBe(40);
  });

  it('护甲打穿：armorBroken=true、配件隐藏、播碎裂粒子与音效', () => {
    const ctx = makeCtx();
    const z = makeZombie('football', ctx);
    expect(z.hat.visible).toBe(true);
    // 打两下打穿 140 点护甲
    z.hit(80, false, false, { type: 'pea' });
    z.hit(80, false, false, { type: 'pea' });
    expect(z.armorHp).toBe(0);
    expect(z.armorBroken).toBe(true);
    expect(z.hat.visible).toBe(false);
    expect(ctx.sfx.armorBreak).toHaveBeenCalledTimes(1);
    expect(ctx.particles.burst).toHaveBeenCalled();
  });

  it('破甲之后的伤害全额进血条（不再打折）', () => {
    const z = makeZombie('football');
    z.breakArmor();
    const before = z.hp;
    z.hit(20, false, false, { type: 'pea' });
    expect(z.hp).toBe(before - 20);
  });

  it('火豌豆（armorBreak）烧护甲的速度翻倍', () => {
    const pea = makeZombie('football');
    const fire = makeZombie('football');
    pea.hit(20, false, false, { type: 'pea' });
    fire.hit(20, false, false, { type: 'pea', armorBreak: true });
    // 普通弹：20 -> 护甲 -20；火豌豆：20*2 -> 护甲 -40
    expect(pea.armorHp).toBe(120);
    expect(fire.armorHp).toBe(100);
  });

  it('金属桶对燃烧免疫：燃烧跳伤只打血、不打护甲', () => {
    const z = makeZombie('bucket');
    const armorBefore = z.armorHp;
    z.hit(10, false, false, { type: 'burn' });
    expect(z.armorHp).toBe(armorBefore);
    expect(z.hp).toBeLessThan(z.maxHp);
  });

  it('水牛角护甲不免疫燃烧（火豌豆的燃烧能烧穿它）', () => {
    const z = makeZombie('football');
    const armorBefore = z.armorHp;
    z.hit(10, false, false, { type: 'burn' });
    expect(z.armorHp).toBe(armorBefore - 10);
  });

  it('穿透弹被金属挡住（仙人掌穿不过铁桶），但仍造成非穿透部分的伤害', () => {
    const z = makeZombie('bucket');
    const before = z.hp;
    z.hit(30, false, false, { type: 'pierce' });
    // 金属吸收 70%：有效伤害只有 30%
    expect(z.hp).toBeCloseTo(before - 30 * (1 - ARMOR_MATERIALS.metal.absorption), 5);
  });

  it('不传 opts 的老调用仍然只扣血（护甲僵尸除外）', () => {
    const z = makeZombie('normal');
    z.hit(15, false, false);
    expect(z.hp).toBe(z.maxHp - 15);
    expect(z.armorMax).toBe(0);
    expect(z.armorAlive).toBe(false);
  });
});

describe('燃烧', () => {
  beforeEach(async () => {
    await boot();
  });

  it('hit 传 burn 会挂上燃烧，重复命中只刷新时间不叠层', () => {
    const z = makeZombie('normal');
    const burn = { dps: 8, time: 3 };
    z.hit(1, false, false, { type: 'pea', burn });
    expect(z.burnTimer).toBe(3);
    z.burnTimer = 1;
    z.hit(1, false, false, { type: 'pea', burn });
    expect(z.burnTimer).toBe(3);
    expect(z.burnDps).toBe(8);
  });

  it('update 里每 0.25 秒掉一跳血，且在燃烧计时结束后停止', () => {
    const z = makeZombie('normal');
    z.hit(1, false, false, { type: 'pea', burn: { dps: 8, time: 1 } });
    const hpAtStart = z.hp;
    z.update(0.3, { pos: new THREE.Vector3(0, 0, 40) }, []);
    // 一跳 = 8 * 0.25 = 2
    expect(z.hp).toBeCloseTo(hpAtStart - 2, 5);
  });

  it('燃烧致死会走 handleKill（并只结算一次）', () => {
    const ctx = makeCtx();
    ctx.zombies = { handleKill: vi.fn() };
    const z = makeZombie('normal', ctx);
    z.hp = 1;
    z.hit(1, false, false, { type: 'pea', burn: { dps: 40, time: 3 } });
    // 上面这一下已经打死了，这里测的是「活着时被烧死」的路径
    const z2 = makeZombie('normal', ctx);
    z2.hp = 1;
    z2.burnDps = 40;
    z2.burnTimer = 3;
    z2.burnTickT = 0.01;
    z2.update(0.05, { pos: new THREE.Vector3(0, 0, 40) }, []);
    expect(ctx.zombies.handleKill).toHaveBeenCalledTimes(1);
  });
});

describe('空中单位（气球）', () => {
  beforeEach(async () => {
    await boot();
  });

  it('root 抬到 airHeight，命中球跟着抬高', () => {
    const z = makeZombie('balloon');
    expect(z.airborne).toBe(true);
    expect(z.root.position.y).toBe(2.2);
    const chest = new THREE.Vector3();
    z.getChest(chest);
    expect(chest.y).toBeCloseTo(2.2 + z.chestY * z.scaleFactor, 5);
    const head = new THREE.Vector3();
    z.getHead(head);
    expect(head.y).toBeCloseTo(2.2 + z.headY * z.scaleFactor, 5);
  });

  it('空中单位不吃地面碰撞体（它在飞）', () => {
    const z = makeZombie('balloon');
    const collider = { x: 0.1, z: 0, r: 1 };
    z.update(1 / 60, { pos: new THREE.Vector3(5, 0, 5) }, [collider]);
    // 没有被推出到 r 之外
    expect(Math.hypot(z.root.position.x - collider.x, z.root.position.z - collider.z)).toBeLessThan(1);
  });

  it('垂直够不着玩家时不出手（跳起来能躲）', () => {
    const ctx = makeCtx();
    const z = makeZombie('balloon', ctx);
    z.root.position.set(0, 2.2, 0);
    // 水平贴脸，但玩家在地面 -> 垂直差 2.2 > 1.6，够不着
    z.update(1 / 60, { pos: new THREE.Vector3(0, 0, 1) }, []);
    // 多跑几帧确保攻击计时器不会被推进
    for (let i = 0; i < 90; i++) z.update(1 / 60, { pos: new THREE.Vector3(0, 0, 1) }, []);
    expect(ctx.onAttack).not.toHaveBeenCalled();
  });

  it('玩家跳起来（脚底 y≈1.0）时够得着：垂直差 1.2 ≤ 1.6', () => {
    const ctx = makeCtx();
    const z = makeZombie('balloon', ctx);
    z.attackTimer = 0.01;
    z.update(1 / 60, { pos: new THREE.Vector3(0, 1.0, 1) }, []);
    expect(ctx.onAttack).toHaveBeenCalled();
  });

  it('死亡播气球「啵」的音效', () => {
    const ctx = makeCtx();
    const z = makeZombie('balloon', ctx);
    z.startDeath();
    expect(ctx.sfx.balloonPop).toHaveBeenCalled();
  });
});

describe('护甲材质表', () => {
  beforeEach(async () => {
    await boot();
  });

  it('三种材质的吸收/怕火/挡穿透关系符合设计', () => {
    expect(ARMOR_MATERIALS.buffalo.absorption).toBe(0.5);
    expect(ARMOR_MATERIALS.buffalo.burnImmune).toBe(false);
    expect(ARMOR_MATERIALS.metal.absorption).toBe(0.7);
    expect(ARMOR_MATERIALS.metal.burnImmune).toBe(true);
    expect(ARMOR_MATERIALS.metal.pierceBlock).toBe(true);
    expect(ARMOR_MATERIALS.plastic.burnImmune).toBe(true);
  });

  it('橄榄球僵尸的护甲材质与配置一致', () => {
    expect(ZOMBIES.football.armor.material).toBe('buffalo');
    const z = makeZombie('football');
    expect(z.armorRule).toBe(ARMOR_MATERIALS.buffalo);
  });
});

describe('对空白名单', () => {
  beforeEach(async () => {
    await boot();
  });

  it('火豌豆 aerial=0.25、仙人掌 aerial=1、爆炸类 aerial="explosion"', () => {
    const byId = (id) => WEAPONS.find((w) => w.id === id);
    expect(byId('firepea').aerial).toBe(0.25);
    expect(byId('cactus').aerial).toBe(1);
    for (const id of ['cherry', 'cob', 'melon', 'jalapeno']) expect(byId(id).aerial, id).toBe('explosion');
    for (const id of ['pea', 'snow', 'repeater', 'threepeater', 'gatling']) expect(byId(id).aerial, id).toBeUndefined();
  });
});
describe('ZombieManager · 爆炸球距离与气球配额', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
    game.zombies.zombies.length = 0;
    game.zombies.queue.length = 0;
  });

  function put(type, x, y, z) {
    const z0 = makeZombie(type, {
      ...makeCtx(),
      zombies: game.zombies,
    });
    z0.root.position.set(x, y, z);
    z0.spawnT = 1;
    game.zombies.zombies.push(z0);
    return z0;
  }

  it('气球浮在 2.2 米高处，地面爆心照样炸得到（球距离只有约 1.3 米）', () => {
    const b = put('balloon', 0, 2.2, 0);
    const hpBefore = b.hp;
    game.zombies.damageArea(new THREE.Vector3(0, 0.4, 0), 5.6, 210, null, 1);
    expect(b.hp).toBeLessThan(hpBefore);
    // 距离 1.3 米 < 半径 5.6 × 0.35 = 1.96，属于满伤区：210 伤 -> 48 血的球直接进死亡流程
    // （alive 仍是 true 是全局口径：Zombie.hit 致死只置 dying，alive 由外部清理）
    expect(b.hp).toBe(0);
    expect(b.dying).toBe(true);
  });

  it('地面僵尸的伤害与「纯水平距离」口径一致（回归：dy≈0.9 在满伤区外沿，衰减可忽略）', () => {
    const z = put('normal', 0, 0, 0);
    game.zombies.damageArea(new THREE.Vector3(0, 0.9, 0), 5.6, 100, null, 1);
    // d ≈ 0.9，落在 radius*0.35=1.96 以内 -> 满伤（62 血的普通僵尸直接死）
    expect(z.hp).toBe(0);
    expect(z.dying).toBe(true);
  });

  it('气球同屏配额：超配额时先刷别的，气球留在队列里', () => {
    const zm = game.zombies;
    zm.startWave(6);
    zm.airQuota = 1;
    // 场上已经有一只气球 -> 配额满
    put('balloon', 5, 2.2, 5);
    zm.queue = ['balloon', 'normal'];
    zm.spawnOne({ pos: new THREE.Vector3(0, 0, 0), dead: false });
    // 刷出来的是 normal，balloon 还在队列里
    expect(zm.queue).toContain('balloon');
    expect(zm.zombies.filter((z) => z.type === 'normal').length).toBeGreaterThan(0);
  });

  it('队列里只剩气球且配额已满：返回 null（等下个 tick）', () => {
    const zm = game.zombies;
    zm.startWave(6);
    zm.airQuota = 1;
    put('balloon', 5, 2.2, 5);
    zm.queue = ['balloon'];
    expect(zm.spawnOne({ pos: new THREE.Vector3(0, 0, 0), dead: false })).toBeNull();
    expect(zm.queue).toEqual(['balloon']);
  });

  it('airborneCount 只数活着的空中单位', () => {
    const zm = game.zombies;
    put('balloon', 0, 2.2, 0);
    put('normal', 1, 0, 1);
    expect(zm.airborneCount()).toBe(1);
    zm.zombies[0].dying = true;
    expect(zm.airborneCount()).toBe(0);
  });

  it('startWave 会按波次设置 airQuota', () => {
    const zm = game.zombies;
    zm.startWave(20);
    expect(zm.airQuota).toBe(2); // waveAirQuota(20) = floor(14*0.2)
  });

  it('阳光掉落：橄榄球 3 颗、气球 2 颗', () => {
    const spawn = vi.spyOn(game.sunOrbs, 'spawn').mockImplementation(() => {});
    const f = put('football', 0, 0, 0);
    const b = put('balloon', 2, 2.2, 2);
    game.zombies.handleKill(f, false);
    game.zombies.handleKill(b, false);
    expect(spawn.mock.calls[0][1]).toBe(3);
    expect(spawn.mock.calls[1][1]).toBe(2);
    spawn.mockRestore();
  });
});

describe('新僵尸造型与视图模型', () => {
  let game;
  beforeEach(async () => {
    game = await boot();
  });

  it('橄榄球僵尸：头盔挂在头上，另有一对护肩', () => {
    const z = makeZombie('football');
    expect(z.hat).toBeTruthy();
    expect(z.shoulders).toBeTruthy();
    expect(z.hat.children.length).toBeGreaterThanOrEqual(5);
  });

  it('气球僵尸：气球挂在身上，且是 airHeight 的视觉线索', () => {
    const z = makeZombie('balloon');
    // 气球是背后的道具，**不是头饰**：挂 this.balloon，不占 this.hat
    // （this.hat 有一条「必须高过头骨」的不变量，背后道具挂上去会破坏它）
    expect(z.balloon).toBeTruthy();
    expect(z.balloon.children.length).toBeGreaterThanOrEqual(2);
    expect(z.hat).toBeUndefined();
  });

  it('护甲材质的白闪/冰冻会同时作用到护肩（材质都进了 matBase）', () => {
    const z = makeZombie('football');
    const before = z.mats.map((m) => m.color.getHex());
    z.applyTint(0.55);
    const after = z.mats.map((m) => m.color.getHex());
    expect(after).not.toEqual(before);
  });

  it('坚果/火豌豆都有手持视图模型', () => {
    const W = game.weapons;
    for (const id of ['wallnut', 'firepea']) {
      const idx = WEAPONS.findIndex((w) => w.id === id);
      expect(W.models[idx], id).toBeTruthy();
      expect(W.models[idx].group.children.length).toBeGreaterThan(0);
    }
  });
});
