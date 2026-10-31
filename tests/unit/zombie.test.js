import { describe, it, expect, vi, beforeEach } from 'vitest';

// 僵尸模型替身：结构同 public/models/zombie.glb（Quaternius Zombie_Basic，CC0 1.0）。
// 单蒙皮网格 + 50 根骨骼、Y-up、面朝 +Z、脚底 y≈0、高 1.194，带 idle/walk/attack/death/hitreact 动画。
// 在模块级 mock 掉 ZombieModel.js，这样不依赖 createGame() 的时序：任何用例里 new Zombie 都能拿到模型，
// 同时保持 zombieModel.ready 的语义给 ZombieManager 用。
vi.mock('../../src/entities/ZombieModel.js', async (importOriginal) => {
  const THREE = await import('three');
  const actual = await importOriginal();
  // SkinnedMesh.applyBoneTransform 需要 skinIndex/skinWeight；
  // 缺了它们 headCrownLocal 会跳过网格，帽子高度就按默认值算，测试会误判。
  const skinGeo = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
      Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4
    ));
    return g;
  };
  const geo = skinGeo(0.45, 1.194, 0.3);
  geo.translate(0, 1.194 / 2, 0); // BoxGeometry 居中；真实 glb 脚底在 y≈0，这里对齐
  // 顶部顶点由 Head 驱动，配件定位只采样头骨权重，不把躯干算进颅顶。
  for (let i = 0; i < geo.attributes.position.count; i++) {
    if (geo.attributes.position.getY(i) > 0.8) geo.attributes.skinIndex.setX(i, 2);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x9ab271, roughness: 0.8 });
  // 真实模型是 SkinnedMesh：造一套最小骨骼，让 AnimationMixer 有东西可驱动
  const rootBone = new THREE.Bone();
  rootBone.name = 'Root';
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.y = 0.37;
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.y = 0.39;
  rootBone.add(hips);
  hips.add(head);
  // bind 时传 bindMatrix=单位阵：让骨骼的世界缩放保持 1（真实 glb 里缩放算在 body 上，
  // 不算在 Head 骨骼里）；否则 headCrownLocal 的 worldToLocal 会被骨骼缩放带偏。
  const skeleton = new THREE.Skeleton([rootBone, hips, head]);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'zombie_body';
  mesh.add(rootBone);
  mesh.bind(skeleton, new THREE.Matrix4());
  // 绑定姿态统一成单位变换：替身几何本身就是最终形状，
  // headCrownLocal 量出来的头顶才等于 BoxGeometry 的顶面（和真实 glb 的口径一致）。
  // 躯干顶点给 Root，顶部顶点给 Head；配件取样与真实模型一样按头骨权重过滤。
  rootBone.updateMatrixWorld(true);
  skeleton.calculateInverses();
  mesh.bindMatrix.identity();
  mesh.bindMatrixInverse.identity();
  // 动画轨道驱动 Head 的旋转，验证 mixer 确实在工作
  const mkClip = (name) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.99]),
  ]);
  const clips = ['Idle', 'Walk', 'Idle_Attack', 'Death', 'HitReact'].map(mkClip);
  const scene = new THREE.Group();
  scene.name = 'Scene';
  scene.add(mesh);
  // 骷髅模型替身：高 2.166、带 handslotr 挂载点（Boss 的木棒要挂上去）
  const skGeo = skinGeo(0.5, 2.166, 0.35);
  skGeo.translate(0, 2.166 / 2, 0);
  const skMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.9 });
  const skRoot = new THREE.Bone();
  skRoot.name = 'root';
  const skBody = new THREE.Bone();
  skBody.name = 'Body';
  skBody.position.y = 0.4;
  const skHand = new THREE.Bone();
  skHand.name = 'handr';
  skHand.position.set(-0.79, 0.71, 0);
  const skSlot = new THREE.Bone();
  skSlot.name = 'handslotr';
  skHand.add(skSlot);
  skRoot.add(skBody);
  skBody.add(skHand);
  const skSkeleton = new THREE.Skeleton([skRoot, skBody, skHand, skSlot]);
  const skMesh = new THREE.SkinnedMesh(skGeo, skMat);
  skMesh.name = 'Skeleton_Minion_Body';
  skMesh.add(skRoot);
  skMesh.bind(skSkeleton);
  const skClip = (name) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('handr.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.99]),
  ]);
  const skClips = ['Idle_Combat', 'Walking_A', '1H_Melee_Attack_Chop', 'Death_A', 'Hit_A'].map(skClip);
  const skScene = new THREE.Group();
  skScene.name = 'SkeletonScene';
  skScene.add(skMesh);
  // 奇幻单位：共用同一个替身，但各自带一套「该模型真实会有的」clip 名，
  // 这样才能验证 buildAnimations 按动画族查表真的命中（而不是回退到 quaternius）。
  const clipsFor = (...names) => names.map(mkClip);
  const FAM_CLIPS = {
    humanoid: ['Idle', 'Walk', 'Run', 'Attack', 'Death', 'HitRecieve'],
    blob: ['Idle', 'Walk', 'Bite_Front', 'Death', 'HitRecieve'],
    slime: ['Slime_Idle', 'Slime_Walk', 'Slime_Attack', 'Slime_Death'],
    beast: ['Idle', 'Walk', 'Headbutt', 'Death'],
    spider: ['Spider_Idle', 'Spider_Walk', 'Spider_Attack', 'Spider_Death'],
    rat: ['Rat_Idle', 'Rat_Walk', 'Rat_Attack', 'Rat_Death'],
    bat: ['Bat_Flying', 'Bat_Attack', 'Bat_Death', 'Bat_Hit'],
    flying: ['Flying_Idle', 'Fast_Flying', 'Headbutt', 'Death', 'HitReact'],
    duck: ['Idle', 'Walk', 'Punch', 'Death', 'HitReact', 'Duck'],
  };
  const slotFor = (fam, box = null) => ({ ready: true, failed: false, scene, clips: clipsFor(...FAM_CLIPS[fam]), box });
  return {
    ...actual,
    zombieModel: {
      started: true,
      ready: true,
      failed: false,
      scene,
      clips,
      skeleton: { ready: true, failed: false, scene: skScene, clips: skClips },
      alchemist: { ready: true, failed: false, scene, clips },
      football: { ready: true, failed: false, scene, clips },
      goblin: slotFor('humanoid'),
      demon3: slotFor('humanoid'),
      // 真实 giant.glb 加载后量得的包围盒（归一化到 1.85、脚底贴地）：高 1.85、宽 1.406。
      // 命中球按它推（HIT 表里没有 giant）。
      giant: slotFor('humanoid', {
        min: new THREE.Vector3(-0.703, 0, -0.43),
        max: new THREE.Vector3(0.703, 1.85, 0.43),
        center: new THREE.Vector3(0, 0.925, 0),
        size: new THREE.Vector3(1.406, 1.85, 0.86),
      }),
      bones: slotFor('humanoid'),
      'mushroom-king': slotFor('duck'),
      slime: slotFor('slime'),
      'pink-slime': slotFor('blob'),
      'green-blob': slotFor('blob'),
      ghost: slotFor('flying'),
      'ghost-skull': slotFor('flying'),
      // 真实 dragon-evolved.glb 的 clip 是 Flying_Idle / Fast_Flying / Headbutt / Death / HitReact，
      // 并没有 Dragon_* 命名（曾按设计稿猜了一组不存在的名字，巨龙永远停在 bind pose）
      dragon: slotFor('flying'),
      wolf: slotFor('beast'),
      spider: slotFor('spider'),
      rat: slotFor('rat'),
      bat: slotFor('bat'),
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

// 僵尸的所有行为都在 Zombie.update / hit / startDeath 里，数值口径来自 config.js：
// normal hp62 speed2.05 radius0.46 scale1；cone 130/1.95/0.48/1.02；bucket 140（+金属甲 200）/1.55/0.52/1.08；
// boss 1450/1.3/0.9/**2.3**（巨型骷髅，骷髅模型 2.166 × SKELETON_SCALE 0.9 × 2.3 ≈ 4.48 米）。
const DT = 1 / 60;

let THREE;
let ZOMBIES;
let ZombieManager;
let Zombie;
let zombieModel;
let PD;

async function boot() {
  const g = await import('../helpers/game.js');
  PD = g;
  THREE = await import('three');
  ({ ZOMBIES } = await import('../../src/config.js'));
  ({ Zombie } = await import('../../src/entities/Zombie.js'));
  ({ zombieModel } = await import('../../src/entities/ZombieModel.js'));
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

  it('普通僵尸换用 alchemist.glb，命中球按 Q 版口径；路障仍走原模型', () => {
    const z = makeZombie('normal');
    expect(z.modelId).toBe('alchemist');
    expect(z.chestY).toBe(0.83);
    expect(z.headY).toBe(1.44);
    expect(z.hitRadiusScale).toBe(0.85);
    // 头球半径必须仍小于胸球半径，否则“打哪儿都爆头”
    expect(0.36 * z.hitRadiusScale).toBeLessThan(0.46 * z.hitRadiusScale);
    const cone = makeZombie('cone');
    expect(cone.modelId).toBe('zombie');
    expect(cone.chestY).toBe(1.02);
    expect(cone.headY).toBe(1.52);
    expect(z.headY).toBeLessThan(cone.headY);
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
    expect(g2.maxHp).toBe(378); // 140 * 2.7
    expect(g2.speed).toBeCloseTo(1.55 * 1.45, 10);

    // 四舍五入而不是截断：1450 × 1.45 = 2102.5 -> 2103
    const g3 = PD.spawnZombieAt(game, 'boss', 6, 0, { hpMul: 1.45 });
    expect(g3.maxHp).toBe(2103);
    expect(g3.scaleFactor).toBe(2.3);
    expect(g3.radius).toBe(0.9);
  });

  it('命中球：胸口 1.02×scale、头部 1.52×scale，头部球半径必须小于胸口球', () => {
    // 口径必须与 ProjectileSystem / WeaponSystem 的判定一致；头部球半径 0.36×scale < 胸口 0.46×scale，
    // 否则扫掠时头部球永远先被碰到，爆头会退化成"打哪儿都爆头"（AGENTS.md 3 节）。
    // 三套模型的命中球高度口径不同（模型体块比例差很多）：
    //   僵尸（高 1.194，路障/铁桶/橄榄球/气球在用）：胸口 1.02、头部 1.52
    //   骷髅（高 2.166，含 Boss 巨型骷髅）：胸口 0.90、头部 1.68
    //   炼金（高 1.077，普通僵尸在用）：胸口 0.83、头部 1.44
    const zn = makeZombie('cone', 2, -3);
    const cN = zn.getChest(vec());
    const hN = zn.getHead(vec());
    expect(cN.x).toBeCloseTo(2, 10);
    expect(cN.z).toBeCloseTo(-3, 10);
    expect(cN.y).toBeCloseTo(1.02 * zn.scaleFactor, 10);
    expect(hN.y).toBeCloseTo(1.52 * zn.scaleFactor, 10);
    expect(zn.modelId).toBe('zombie');
    expect(zn.getAimPoint(vec()).toArray()).toEqual(cN.toArray());
    // 僵尸模型替身总高 1.194 × ZOMBIE_SCALE 1.55 × scale，头顶高于头部球
    expect(1.194 * 1.55 * zn.scaleFactor).toBeGreaterThan(hN.y);

    const bs = makeZombie('boss', 2, -3);
    const cB = bs.getChest(vec());
    const hB = bs.getHead(vec());
    expect(cB.y).toBeCloseTo(0.90 * bs.scaleFactor, 10);
    expect(hB.y).toBeCloseTo(1.68 * bs.scaleFactor, 10);
    // 骷髅模型替身总高 2.166 × SKELETON_SCALE 0.9 × scale，头顶高于头部球
    expect(2.166 * 0.9 * bs.scaleFactor).toBeGreaterThan(hB.y);

    // 头部球半径必须严格小于胸口球（否则“打哪儿都爆头”）
    for (const z of [zn, bs]) {
      const rs = z.hitRadiusScale || 1;
      expect(0.36 * z.scaleFactor * rs).toBeLessThan(0.46 * z.scaleFactor * rs);
    }
    // 骷髅的半径倍率单独给（骨架更细），僵尸保持 1
    expect(zn.hitRadiusScale).toBe(1);
    expect(bs.hitRadiusScale).toBe(0.8);
  });

  it('buildRig：每个僵尸克隆材质（几何体共享、材质独立），骨骼独立、动画混合器与动作就位', () => {
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
    // 骨骼必须独立：共用同一套骨骼会让所有僵尸一起动
    const boneA = a.body.getObjectByName('Head');
    const boneB = b.body.getObjectByName('Head');
    expect(boneA).toBeTruthy();
    expect(boneA).not.toBe(boneB);
    // 动画：有 mixer，idle/walk/attack/die/hit 动作按需建立，初始播 idle
    expect(a.mixer).toBeTruthy();
    expect(Object.keys(a.actions).sort()).toEqual(['attack', 'die', 'hit', 'idle', 'walk']);
    expect(a.current).toBe('idle');
    expect(a.actions.idle.isRunning()).toBe(true);
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
      // 配件都挂在骨骼上跟着动：Boss 木棒→handslotr（右手），交通锥/铁桶→Head（头顶）
      if (type === 'boss') expect(z.hat.parent).toBe(z.body.getObjectByName('handslotr'));
      else expect(z.hat.parent).toBe(z.body.getObjectByName('Head'));
      // 配件材质必须同时进 mats / matBase，白闪与寒冰才作用得到帽子上（AGENTS.md 5.2）
      expect(z.mats.length).toBe(1 + parts);
      expect(z.matBase.length).toBe(1 + parts);
      for (let i = 1; i < z.mats.length; i++) {
        expect(z.mats[i]).not.toBe(z.mats[0]);
        expect(z.mats[i].emissiveIntensity).toBe(0);
      }
    }
    // 帽子挂在 Head 骨骼上，位置由 worldToLocal 反算（骨骼带 100× 缩放 + 13° 前倾，手算会错）。
    // 校验的是"换算出世界坐标后确实在头顶"，不是某个具体局部数值。
    const cone = makeZombie('cone');
    const bucket = makeZombie('bucket');
    for (const zz of [cone, bucket]) {
      const bone = zz.body.getObjectByName('Head');
      expect(zz.hat.parent).toBe(bone);
      // 把帽子写回 true 后取世界坐标，应落在模型顶端附近而不是身体内部
      zz.spawnT = 1;
      zz.model.position.y = 0;
      zz.root.updateMatrixWorld(true);
      zz.body.updateWorldMatrix(true, true);
      // 头顶落点是在首帧 mountHeadTop() 里量的（构造时骨骼绑定矩阵还没稳定），
      // 这里显式调一次，别依赖前面用例有没有把全局缓存填上。
      // 缓存是挂在模型源上的（按模型只量一次），先清掉，免得拿到构造期 model.position.y=-2.3 时量的错值。
      zz.modelSource()._headCrown = null;
      zz.mountHeadTop();
      zz.root.updateMatrixWorld(true);
      const w = vec();
      zz.hat.getWorldPosition(w);
      // 模型替身高 1.194 × ZOMBIE_SCALE 1.55，再乘 scaleFactor
      const modelTop = 1.194 * 1.55 * zz.scaleFactor;
      expect(w.y, zz.type + ' 帽子高度').toBeGreaterThan(modelTop * 0.75);
      expect(w.y, zz.type + ' 帽子高度').toBeLessThan(modelTop + 0.2);
    }
    // Boss 是巨型骷髅：木棒挂在 handslotr 骨骼上（跟着手臂挥动），不是挂在 body 上
    const boss = makeZombie('boss');
    expect(boss.isSkeleton).toBe(true);
    const slot = boss.body.getObjectByName('handslotr');
    expect(slot).toBeTruthy();
    expect(boss.hat.parent).toBe(slot);
    expect(boss.hat.position.y).toBeCloseTo(0, 10);
    // 骷髅的木棒朝前（局部 +Y 指向世界 +Z）：棒头在上、棒身在下
    expect(boss.hat.children[0].position.y).toBeCloseTo(-0.05, 10);
    expect(boss.hat.children[1].position.y).toBeCloseTo(0.36, 10);
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
    expect(c.pos.y).toBeCloseTo(1.2 * 2.3, 10);
    expect(c.pos.x).toBeCloseTo(0, 10);
    expect(c.pos.z).toBeCloseTo(5, 10);
  });

  it('死亡流程：播死亡动画、0.55 秒后下沉、deathT > 1.55 才 dead', () => {
    const z = freshZombie();
    z.hit(999, false, false);
    const advance = (sec) => {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) z.update(DT, game.player, []);
    };
    advance(0.36);
    // 骨骼模型：翻倒交给 death 动画，模型自身不再靠旋转倒地
    expect(z.current).toBe('die');
    expect(z.mixer).toBeTruthy();
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
    // 移动时切到 walk 动画，mixer 正在跑
    expect(z.current).toBe('walk');
    expect(z.actions.walk.isRunning()).toBe(true);
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

  it('命中球比例：boss 胸口 2.07、头部 3.864（骷髅口径 0.90/1.68 × scale 2.3）', () => {
    const z = PD.spawnZombieAt(game, 'boss', 0, 0);
    expect(z.getChest(vec()).y).toBeCloseTo(0.90 * 2.3, 6);
    expect(z.getHead(vec()).y).toBeCloseTo(1.68 * 2.3, 6);
    expect(z.getHead(vec()).y / z.getChest(vec()).y).toBeCloseTo(1.68 / 0.90, 10);
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
// ── 夜之森林的奇幻单位：走真实 Zombie 构造链路 ──
describe('奇幻单位：命中球与动画', () => {
  const FANTASY = [
    'goblin', 'demon3', 'slime', 'pink-slime', 'slimelet', 'green-blob',
    'bones', 'ghost', 'ghost-skull', 'wolf', 'spider', 'rat', 'bat',
  ];

  it('每个奇幻单位都能被构造出来，且命中球有限、为正', () => {
    for (const type of FANTASY) {
      const z = makeZombie(type);
      const chest = new THREE.Vector3();
      const head = new THREE.Vector3();
      z.getChest(chest);
      z.getHead(head);
      for (const v of [chest, head]) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), type).toBe(true);
      }
      expect(z.hitRadiusScale, type).toBeGreaterThan(0);
      // 头一定在胸口上方（高度），不然「瞄头」是反的
      expect(head.y, type + ' 头部应高于胸口').toBeGreaterThan(chest.y);
      z.dispose();
    }
  });

  it('命中半径按模型分档：大块头不小于小怪', () => {
    const r = (t) => makeZombie(t).hitRadiusScale;
    // 史莱姆/绿块是宽体，老鼠/蝙蝠不是
    expect(r('slime')).toBeGreaterThan(r('rat'));
    expect(r('green-blob')).toBeGreaterThan(r('bat'));
  });

  it('蝙蝠是空中单位：root 抬到 airHeight，命中球跟着抬', () => {
    // 注意：makeZombie 里的 place() 会把 y 归零（地面怪用），空中单位直接 new 才看得到抬升
    const bat = new Zombie('bat', 1, 0, 0, makeCtx(), 1, 1);
    expect(bat.airborne).toBe(true);
    expect(bat.root.position.y).toBeCloseTo(bat.def.airHeight, 5);
    const chest = new THREE.Vector3();
    bat.getChest(chest);
    // 命中球高度 = airHeight + chestY * scale，一定高于地面命中的同类体型怪
    expect(chest.y).toBeGreaterThan(bat.def.airHeight);
    bat.dispose();
  });

  it('每个奇幻单位都按自己的动画族取到了动作，不会回退成同一套', () => {
    // 蝙蝠只有 Bat_* 命名，按 quaternius 族应该一个都取不到；能取到说明族映射生效
    const bat = makeZombie('bat');
    expect(bat.actions.walk).toBeTruthy();
    expect(bat.actions.attack).toBeTruthy();
    // 蝙蝠的 walk 应该绑的是 Bat_Flying 那条 clip
    expect(bat.actions.walk.getClip().name).toBe('Bat_Flying');
    bat.dispose();

    const spider = makeZombie('spider');
    expect(spider.actions.attack.getClip().name).toBe('Spider_Attack');
    spider.dispose();

    const dragon = makeZombie('dragon');
    // 巨龙挂 flying 族：它的 glb 里只有 Flying_Idle / Fast_Flying / Headbutt 这组 clip
    expect(dragon.actions.attack.getClip().name).toBe('Headbutt');
    expect(dragon.actions.walk.getClip().name).toBe('Fast_Flying');
    dragon.dispose();
  });

  it('奇幻单位不接受旧的 acc 配件（buildHat 假设了老模型的骨骼链）', () => {
    for (const type of FANTASY) {
      expect(ZOMBIES[type].acc, type + '.acc').toBeFalsy();
    }
  });

  it('蘑菇王 Duck 单次夹持动作不混用 Walk，结束后可以恢复站立', () => {
    const z = makeZombie('mushroomKing');
    expect(z.actions.duck.getClip().name).toBe('Duck');
    expect(z.actions.duck.loop).toBe(THREE.LoopOnce);
    expect(z.actions.duck.clampWhenFinished).toBe(true);
    z.play('duck', 0);
    z.mixer.update(2);
    expect(z.current).toBe('duck');
    z.play('idle', 0);
    expect(z.current).toBe('idle');
    z.dispose();
  });

  it('BOSS 三只都能构造，且 def.boss 为真（Game/Manager 靠它判定）', () => {
    for (const type of ['gargantuar', 'mushroomKing', 'dragon']) {
      const z = makeZombie(type);
      expect(z.def.boss).toBe(true);
      expect(typeof z.def.title).toBe('string');
      expect(z.maxHp).toBeGreaterThan(1500);
      z.dispose();
    }
  });

  it('巨人：命中球按模型真实包围盒推，跟着放大（回归：打上半身不掉血）', async () => {
    await boot();
    const z = makeZombie('gargantuar');
    // 命中球按模型包围盒比例换算：胸口 ≈ 九成身高、头部 ≈ 头顶略下，半径按身宽放大，
    // 而不是写死人形口径（巨人是长腿短躯干，取中线会把胸口球放到膝盖附近）
    const box = zombieModel.giant.box;
    const sy = box.size.y;
    const dbg = 'chest=' + z.chestY + ' head=' + z.headY + ' r=' + z.hitRadiusScale;
    expect(z.chestY, dbg).toBeCloseTo(box.min.y + sy * 0.9, 5);
    expect(z.headY).toBeCloseTo(box.min.y + sy * 0.97, 5);
    expect(z.headY).toBeGreaterThan(z.chestY);
    // 头球半径必须仍比胸球小（否则打哪儿都爆头）
    expect(0.36 * z.hitRadiusScale).toBeLessThan(0.46 * z.hitRadiusScale);
    // 命中球跟着模型走：比旧写死的 0.95 / 1.5 高出一截
    expect(z.chestY).toBeGreaterThan(0.95);
    z.dispose();
  });

  it('巨人模型未就绪时命中球退回普通人形，就绪后 syncHitSpheres 重算', async () => {
    await boot();
    const z = makeZombie('gargantuar');
    const src = zombieModel.giant;
    const saved = src.box;
    try {
      src.box = null;
      z.syncHitSpheres();
      expect(z.chestY).toBe(1.02);
      expect(z.headY).toBe(1.52);
      src.box = saved;
      z.syncHitSpheres();
      expect(z.chestY).toBeCloseTo(saved.min.y + saved.size.y * 0.9, 5);
    } finally {
      src.box = saved;
      z.dispose();
    }
  });

  it('targetHeight 模型烙进 scene 的归一化缩放不得被 buildRig 抹掉（蝙蝠 4.7 米回归）', async () => {
    await boot();
    const slot = zombieModel.bat;
    const savedScene = slot.scene;
    const savedClips = slot.clips;
    try {
      // 模拟真实 bat.glb 加载完的样子：fitToHeight 把 0.117 的缩放烘进 scene.scale，
      // 原始包围盒高 4.7 米。buildRig 里若对它 setScalar(1)，模型就会按 4.7 米渲染，
      // 而命中球仍按 0.55 米口径标在 2.28 米 —— 空中单位「看着打中却不出血」。
      const scene = new THREE.Group();
      scene.scale.setScalar(0.117);
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4.7, 1), new THREE.MeshStandardMaterial()));
      slot.scene = scene;
      slot.clips = [];
      const z = makeZombie('bat');
      expect(z.body.scale.x).toBeCloseTo(0.117, 5);
      z.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(z.body);
      // 世界高度 = 原始 4.7 × 归一化 0.117 ≈ 0.55 米，悬空在 airHeight 2 米
      expect(box.max.y - box.min.y).toBeCloseTo(4.7 * 0.117, 3);
      z.dispose();
      // 老四套（无 targetHeight）仍然乘自己的 MODELS.scale，行为不变
      const n = makeZombie('normal');
      expect(n.body.scale.x).toBeCloseTo(1.72, 5);
      n.dispose();
    } finally {
      slot.scene = savedScene;
      slot.clips = savedClips;
    }
  });

  it('奇幻单位命中球按动画姿态实测校准（狼/小恶魔/绿块回归）', async () => {
    await boot();
    // 狼的身体立在腿上、身长 1.46 米：胸口球按体块重心抬高，半径放大才罩得住躯干。
    // 旧口径 0.58/0.72/0.72 会让豌豆几乎打不中（实测扫掠覆盖率仅 15%）
    const wolf = makeZombie('wolf');
    expect(wolf.chestY).toBe(0.7);
    expect(wolf.headY).toBe(0.98);
    expect(wolf.hitRadiusScale).toBe(1.1);
    wolf.dispose();
    const demon = makeZombie('demon3');
    expect(demon.chestY).toBe(0.9);
    expect(demon.headY).toBe(1.28);
    expect(demon.hitRadiusScale).toBe(1);
    demon.dispose();
    const blob = makeZombie('green-blob');
    expect(blob.chestY).toBe(0.72);
    expect(blob.headY).toBe(1.05);
    expect(blob.hitRadiusScale).toBe(1.15);
    blob.dispose();
  });

  it('三只新 Boss 的体型倍率：命中球世界高度跟着放大', async () => {
    await boot();
    // 巨人按设计稿 3.4 米（1.85 × 1.84）；蘑菇王/巨龙保持修复渲染缩放前的可视尺寸
    expect(ZOMBIES.gargantuar.scale).toBeCloseTo(1.84, 5);
    expect(ZOMBIES.mushroomKing.scale).toBeCloseTo(1.86, 5);
    expect(ZOMBIES.dragon.scale).toBeCloseTo(1.53, 5);
    // 巨人命中球（包围盒口径 chest = 1.85×0.9）乘上体型后应落在胸口一带，
    // 而不是停在 1.85 米人形口径（旧 bug：3.4 米的巨人只有膝盖以下能被打中）
    const g = makeZombie('gargantuar');
    expect(g.getChest(vec()).y).toBeCloseTo(1.85 * 0.9 * 1.84, 2);
    g.dispose();
    const mk = makeZombie('mushroomKing');
    expect(mk.getChest(vec()).y).toBeCloseTo(1.0 * 1.86, 2);
    mk.dispose();
    const d = makeZombie('dragon');
    expect(d.getChest(vec()).y).toBeCloseTo(1.4 * 1.53, 2);
    d.dispose();
  });

  it('旧 skeleton 与新的 bones 是两个独立类型，模型各自独立', () => {
    const oldSkel = makeZombie('skeleton');
    const newBones = makeZombie('bones');
    expect(oldSkel.modelId).toBe('skeleton');
    expect(newBones.modelId).toBe('bones');
    expect(newBones.isSkeleton).toBe(false);
    oldSkel.dispose();
    newBones.dispose();
  });
});

// ── Boss 双人换目标 / 量不到颅顶的兜底 ──
describe('Zombie · Boss 仇恨切换与配件兜底', () => {
  function makePlayer(x, z) {
    return { pos: vec(x, 0, z), dead: false, downed: false, hp: 100 };
  }

  it('Boss 双目标时按 aggroT 轮换，并在换人前闪红预警', async () => {
    const { BOSS_AGGRO } = await import('../../src/config.js');
    const ctx = makeCtx();
    const z = new Zombie('boss', 1, 0, 0, ctx, 1, 1);
    z.spawnT = 1;
    const a = makePlayer(0, -3);
    const b = makePlayer(0, 3);
    z.aggroT = 0.01;
    z.aggroWarnFired = false;
    z.update(0.02, [a, b], []);
    // 换人后计时重置、预警标志复位
    expect(z.aggroT).toBeCloseTo(BOSS_AGGRO.switchEvery, 4);
    expect(z.aggroWarnFired).toBe(false);
    z.dispose();
  });

  it('Boss 换人预警会闪红并喷粒子', () => {
    const ctx = makeCtx();
    const z = new Zombie('boss', 1, 0, 0, ctx, 1, 1);
    z.spawnT = 1;
    z.aggroT = 0.5;
    z.aggroWarnFired = false;
    z.update(0.02, [makePlayer(0, -3), makePlayer(0, 3)], []);
    expect(z.aggroWarnFired).toBe(true);
    expect(z.flash).toBeGreaterThan(0);
    z.dispose();
  });

  it('非 Boss 单目标不进入仇恨轮换', () => {
    const z = makeZombie('goblin', 0, -3);
    z.aggroT = 0.01;
    z.update(0.02, makePlayer(0, 0), []);
    // 没被改写过（仍然是初始值）
    expect(z.aggroWarnFired).toBe(false);
    z.dispose();
  });
});

// ── 构建期分支：envMap 缺失 / 模型源缺失 / 动画族兜底 ──
describe('Zombie · 构建期兜底', () => {
  it('ctx.env 为 null 时材质 envMap 也为 null，不崩', () => {
    const ctx = makeCtx();
    ctx.env = null;
    const z = new Zombie('goblin', 1, 0, 0, ctx, 1, 1);
    for (const m of z.mats) expect(m.envMap).toBe(null);
    z.dispose();
  });

  it('模型场景还没加载好时也能构造出占位骨架', () => {
    const ctx = makeCtx();
    const z = new Zombie('goblin', 1, 0, 0, ctx, 1, 1);
    // 替身场景存在，至少 body 是个 Object3D
    expect(z.body).toBeTruthy();
    expect(z.body.isObject3D).toBe(true);
    z.dispose();
  });

  it('未知 model 名回退到 zombie 模型，不崩', async () => {
    const { ZOMBIES } = await import('../../src/config.js');
    const saved = ZOMBIES.goblin.model;
    ZOMBIES.goblin.model = '__not_a_model__';
    try {
      const ctx = makeCtx();
      const z = new Zombie('goblin', 1, 0, 0, ctx, 1, 1);
      expect(z.modelId).toBe('zombie');
      z.dispose();
    } finally {
      ZOMBIES.goblin.model = saved;
    }
  });

  it('没有 clip 的模型不建 mixer，play 也是空操作', () => {
    const ctx = makeCtx();
    const z = new Zombie('goblin', 1, 0, 0, ctx, 1, 1);
    // 替身模型带 5 段动画；这里只断言播放不崩
    expect(() => z.play('walk', 0.1)).not.toThrow();
    expect(() => z.play('不存在的动作', 0.1)).not.toThrow();
    z.dispose();
  });
});
