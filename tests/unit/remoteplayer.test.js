import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { blobShadowTexture } from '../../src/world/materials.js';

// 武器 GLB 走真实加载器太重，这里只验证「按 id 取模板 + 挂到右手 + 按包围盒归一化」。
vi.mock('../../src/weapons/WeaponModels.js', async () => {
  const THREE = await import('three');
  return {
    loadWeaponModel: vi.fn(async (id) => {
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.54, 0.81),
        new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff })
      );
      root.add(mesh);
      root.name = 'weapon-' + id;
      return root;
    }),
  };
});
import {
  RemotePlayer,
  remoteModel,
  initRemoteModel,
  whenRemoteReady,
  createNameplate,
  yawToRotation,
  MODEL_SCALE,
  MODEL_HEIGHT,
  PLATE_Y,
} from '../../src/entities/RemotePlayer.js';
import { loadWeaponModel } from '../../src/weapons/WeaponModels.js';

const BONE_NAMES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

// 假模型：按 pumpkin-kid 的骨架搭一棵纯 Group/Bone 树，外加网格与材质。
function makePumpkin({ missing = [], arrayMaterial = false } = {}) {
  const root = new THREE.Group();
  root.name = 'PumpkinKid';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  root.add(armature);
  const bones = {};
  const add = (name, parent, y = 0, x = 0, z = 0) => {
    if (missing.includes(name)) return parent;
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bones[name] = b;
    return b;
  };
  const hips = add('Hips', armature, 0.44);
  const spine = add('Spine', hips, 0.08);
  const spine1 = add('Spine1', spine, 0.1);
  const spine2 = add('Spine2', spine1, 0.1);
  add('Head', spine2, 0.2);
  const armL = add('LeftArm', spine2, 0, 0.1, 0);
  add('LeftForeArm', armL, 0, 0.1, 0);
  const armR = add('RightArm', spine2, 0, -0.1, 0);
  const foreArmR = add('RightForeArm', armR, 0, -0.1, 0);
  add('RightHand', foreArmR, 0, -0.1, 0);
  const upLegL = add('LeftUpLeg', hips, 0, 0.07, 0);
  const legL = add('LeftLeg', upLegL, -0.2, 0.05, 0);
  add('LeftFoot', legL, -0.2, 0.03, -0.08);
  const upLegR = add('RightUpLeg', hips, 0, -0.07, 0);
  const legR = add('RightLeg', upLegR, -0.2, -0.05, 0);
  add('RightFoot', legR, -0.2, -0.03, -0.08);

  const std = new THREE.MeshStandardMaterial({ name: 'Material.001' });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.2), arrayMaterial ? [std, new THREE.MeshDepthMaterial({ name: 'depth' })] : std);
  root.add(mesh);
  return { root, bones, mesh };
}

function fakeCanvas(withRound = true) {
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  if (withRound) ctx.roundRect = vi.fn();
  return { width: 0, height: 0, getContext: () => ctx, __ctx: ctx };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setModel({ scene, ready = true, failed = false } = {}) {
  remoteModel.started = true;
  remoteModel.ready = ready;
  remoteModel.failed = failed;
  remoteModel.scene = scene === undefined ? makePumpkin().root : scene;
}

let canvas;
let originalCreateElement;

beforeEach(() => {
  canvas = fakeCanvas(true);
  originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) =>
    tag === 'canvas' ? canvas : originalCreateElement(tag)
  );
  // 阴影贴图是模块级缓存：先渲染一次，避免后面的 no-context 用例撞上未缓存的 canvas。
  blobShadowTexture();
  setModel();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  remoteModel.started = true;
  remoteModel.ready = false;
  remoteModel.failed = false;
  remoteModel.scene = null;
});

describe('createNameplate', () => {
  it('画圆角名牌并返回 Sprite，默认挂在模型头顶', () => {
    const sprite = createNameplate('队友');
    expect(sprite.isSprite).toBe(true);
    expect(sprite.material.map).toBeTruthy();
    expect(sprite.scale.x).toBeCloseTo(0.92);
    expect(sprite.position.y).toBeCloseTo(PLATE_Y);
    expect(canvas.__ctx.roundRect).toHaveBeenCalled();
    expect(canvas.__ctx.fillText).toHaveBeenCalledWith('队友', 128, 32);
  });

  it('可以指定高度；没有 roundRect 时退回矩形', () => {
    const rectCanvas = fakeCanvas(false);
    vi.mocked(document.createElement).mockReturnValue(rectCanvas);
    const sprite = createNameplate('队友', 1.2);
    expect(sprite.position.y).toBeCloseTo(1.2);
    expect(rectCanvas.__ctx.fillRect).toHaveBeenCalled();
    expect(rectCanvas.__ctx.stroke).not.toHaveBeenCalled();
  });

  it('没有 document 或 2d context 时返回 null', () => {
    vi.stubGlobal('document', undefined);
    expect(createNameplate('队友')).toBeNull();
    vi.unstubAllGlobals();

    vi.mocked(document.createElement).mockReturnValue({ width: 0, height: 0, getContext: () => null });
    expect(createNameplate('队友')).toBeNull();
  });
});

describe('yawToRotation', () => {
  it('模型朝 +Z，而玩家 yaw=0 朝 -Z，所以要补半个圈', () => {
    expect(yawToRotation(0)).toBeCloseTo(Math.PI);
    expect(yawToRotation(0.5)).toBeCloseTo(0.5 + Math.PI);
    expect(yawToRotation(undefined)).toBeCloseTo(Math.PI);
  });
});

describe('武器挂载', () => {
  it('按 id 加载 GLB 模板、挂到右手骨骼、按包围盒缩放到 0.62 米', async () => {
    const r = new RemotePlayer({ scene: new THREE.Scene(), env: { fake: true } });
    await settle();
    expect(r.weaponId).toBe('pea');
    expect(loadWeaponModel).toHaveBeenCalledWith('pea');
    expect(r.weapon).toBeTruthy();
    expect(r.weaponMount.parent).toBe(r.rig.handR.bone);
    expect(r.weapon.parent).toBe(r.weaponMount);
    expect(r.weapon.rotation.y).toBeCloseTo(Math.PI);
    // 原始最长边 0.81 × 模型缩放 1.46 × 武器缩放 ≈ 0.62 米
    r.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(r.weapon);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(0.62, 1);
    expect(r.weapon.children[0].material.envMap).toEqual({ fake: true });
    expect(r.weapon.children[0].castShadow).toBe(true);
    r.dispose();
  });

  it('切换武器只重新加载变化的 id，非法 id 直接忽略', async () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    await settle();
    const first = r.weapon;
    r.setWeapon('pea');
    expect(r.weapon).toBe(first);

    r.setWeapon('cob');
    expect(r.weaponId).toBe('cob');
    await settle();
    expect(loadWeaponModel).toHaveBeenCalledWith('cob');
    expect(r.weapon).not.toBe(first);
    expect(r.weapon.name).toBe('weapon-cob');

    for (const bad of ['../x', 'PEA', '', null, 42, 'a']) {
      r.setWeapon(bad);
      expect(r.weaponId).toBe('cob');
    }
    r.dispose();
  });

  it('武器材质按实例克隆，换枪/销毁时释放，模板几何体不释放', async () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    await settle();
    const mat = r.weapon.children[0].material;
    const geo = r.weapon.children[0].geometry;
    const templateGeo = geo;
    const matSpy = vi.spyOn(mat, 'dispose');
    const geoSpy = vi.spyOn(templateGeo, 'dispose');
    r.setWeapon('melon');
    await settle();
    expect(matSpy).toHaveBeenCalled();
    expect(geoSpy).not.toHaveBeenCalled();

    const mat2 = r.weapon.children[0].material;
    const mat2Spy = vi.spyOn(mat2, 'dispose');
    r.dispose();
    expect(mat2Spy).toHaveBeenCalled();
    expect(r.weapon).toBeNull();
  });

  it('模型没就绪时先记住武器 id，模型加载后自动补挂', async () => {
    setModel({ scene: null, ready: true });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    r.setWeapon('cactus');
    expect(r.weaponMount).toBeUndefined();
    remoteModel.scene = makePumpkin().root;
    r.buildModel();
    await settle();
    expect(r.weaponId).toBe('cactus');
    expect(r.weapon).toBeTruthy();
    r.dispose();
  });

  it('模板加载失败时保持空手，不抛错', async () => {
    const mod = await import('../../src/weapons/WeaponModels.js');
    mod.loadWeaponModel.mockResolvedValueOnce(null);
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    await settle();
    expect(r.weapon).toBeFalsy();
    r.dispose();
  });
});

describe('RemotePlayer', () => {
  it('克隆模型、收集骨骼、挂名牌，并按 1.65 米缩放', () => {
    const scene = new THREE.Scene();
    const env = { fake: true };
    const r = new RemotePlayer({ scene, env, name: '队友', x: 1, z: 2, yaw: 0.5 });

    expect(r.ready).toBe(true);
    expect(r.root.parent).toBe(scene);
    expect(r.placeholder).toBeNull();
    expect(r.current).toBe('idle');
    expect(r.model.scale.x).toBeCloseTo(MODEL_SCALE);
    expect(MODEL_HEIGHT * MODEL_SCALE).toBeGreaterThan(1.6);
    expect(r.bones.sort()).toEqual([...BONE_NAMES].sort());
    expect(r.rig.hips.bone.name).toBe('Hips');
    expect(r.rig.armR.parentInv).toBeInstanceOf(THREE.Quaternion);
    expect(r.plate).toBeTruthy();
    expect(r.plate.position.y).toBeCloseTo(PLATE_Y);
    expect(r.rig.handR.bone.name).toBe('RightHand');
    r.dispose();
  });

  it('武器在举枪待机时朝模型正前方（+Z），并跟着右手走', async () => {
    const r = new RemotePlayer({ scene: new THREE.Scene(), yaw: 0 });
    await settle();
    r.root.rotation.y = 0;
    r.root.updateMatrixWorld(true);
    const dir = new THREE.Vector3();
    r.weaponMount.getWorldDirection(dir);
    expect(dir.z).toBeGreaterThan(0.97);
    expect(Math.abs(dir.x)).toBeLessThan(0.1);

    const hand = new THREE.Vector3();
    const weaponPos = new THREE.Vector3();
    r.rig.handR.bone.getWorldPosition(hand);
    r.weapon.getWorldPosition(weaponPos);
    // 武器模型的原点在握把上方（底部对齐手掌），所以距离 0.2~0.3 米是正常的
    expect(hand.distanceTo(weaponPos)).toBeLessThan(0.3);

    r.setMoving(true, 4.2);
    r.update(0.2);
    expect(r.weapon.parent).toBe(r.weaponMount);
    expect(r.weaponMount.parent).toBe(r.rig.handR.bone);
    r.dispose();
  });

  it('材质数组也能逐项克隆', () => {
    setModel({ scene: makePumpkin({ arrayMaterial: true }).root });
    const r = new RemotePlayer({ scene: new THREE.Scene(), env: { fake: true } });
    const mats = r.model.children.find((n) => n.isMesh).material;
    expect(Array.isArray(mats)).toBe(true);
    expect(mats).toHaveLength(2);
    expect(mats[0].envMap).toEqual({ fake: true });
    expect(mats[1].envMap).toBeUndefined();
    r.dispose();
  });

  it('缺少部分骨骼时不报错，只摆找到的那几根', () => {
    setModel({ scene: makePumpkin({ missing: ['LeftFoot', 'RightFoot', 'Head', 'RightHand'] }).root });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.rig.head).toBeUndefined();
    expect(r.rig.footL).toBeUndefined();
    expect(r.rig.handR).toBeUndefined();
    expect(r.weaponMount).toBeUndefined();
    expect(r.rig.hips).toBeTruthy();
    expect(() => {
      r.setMoving(true, 4);
      r.update(0.2);
      r.setDead();
      r.update(1);
    }).not.toThrow();
    r.dispose();
  });

  it('完全没有骨骼时 animate 也能空跑', () => {
    setModel({ scene: makePumpkin({ missing: BONE_NAMES }).root });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.bones).toEqual([]);
    r.setMoving(true, 3);
    r.update(0.1);
    expect(r.current).toBe('run');
    r.dispose();
  });

  it('待机时手臂从 A-pose 收回来，走路时四肢摆动且相位推进', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    const restArm = r.rig.armL.rest.clone();
    expect(r.rig.armL.bone.quaternion.equals(restArm)).toBe(false);

    r.setMoving(true, 4.2);
    expect(r.current).toBe('run');
    r.update(0.1);
    r.update(0.1);
    expect(r.moveBlend).toBeGreaterThan(0.5);
    const phase = r.phase;
    expect(phase).toBeGreaterThan(0);
    const leg = r.rig.upLegL.bone.quaternion.clone();
    r.update(0.15);
    expect(r.phase).toBeGreaterThan(phase);
    expect(r.rig.upLegL.bone.quaternion.equals(leg)).toBe(false);

    r.setMoving(false, 0);
    expect(r.current).toBe('idle');
    for (let i = 0; i < 40; i++) r.update(0.05);
    expect(r.moveBlend).toBe(0);
    r.dispose();
  });

  it('开火时右臂前伸，计时结束后回到当前移动状态', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    const before = r.rig.armR.bone.quaternion.clone();
    r.setFiring();
    expect(r.current).toBe('shoot');
    expect(r.shootT).toBeCloseTo(0.35);
    r.update(0.01);
    expect(r.rig.armR.bone.quaternion.equals(before)).toBe(false);
    r.setFiring();
    r.update(0.4);
    expect(r.current).toBe('idle');
    expect(r.shootT).toBe(0);

    r.setMoving(true, 4);
    r.setFiring();
    r.update(0.4);
    expect(r.current).toBe('run');
    r.dispose();
  });

  it('死亡后后仰倒地、抬高到地面之上、名牌跟着落下，并拒绝再开火', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    r.setDead();
    expect(r.dead).toBe(true);
    expect(r.current).toBe('die');
    r.update(0.2);
    expect(r.model.rotation.x).toBeLessThan(-0.3);
    r.update(1);
    expect(r.model.rotation.x).toBeCloseTo(-1.5);
    expect(r.model.position.y).toBeCloseTo(0.16);
    expect(r.plate.position.y).toBeCloseTo(PLATE_Y - 1.15);

    r.setFiring();
    expect(r.current).toBe('die');
    expect(r.shootT).toBe(0);
    r.setMoving(false);
    expect(r.current).toBe('die');
    r.dispose();
  });

  // 回归：双人倒地时远端模型一直站着。setDown(true) 要趴下、setDown(false) 要站回来。
  it('setDown 平滑趴下、setDown(false) 平滑站回，并且和死亡互不覆盖', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    const standArm = r.rig.armL.bone.quaternion.clone();
    r.setDown(true);
    expect(r.down).toBe(true);
    expect(r.current).toBe('down');

    r.update(0.05);
    const mid = r.model.rotation.x;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1.4);
    expect(r.rig.armL.bone.quaternion.equals(standArm)).toBe(false);

    for (let i = 0; i < 40; i++) r.update(0.05);
    expect(r.downK).toBe(1);
    expect(r.model.rotation.x).toBeCloseTo(1.5);
    expect(r.model.position.y).toBeCloseTo(0.22);
    expect(r.plate.position.y).toBeCloseTo(PLATE_Y - 1);

    // 躺着的时候再收到走路/开火也不会抽搐：姿势保持不变
    const lying = r.model.rotation.x;
    r.setMoving(true, 4);
    r.setFiring();
    expect(r.current).toBe('down');
    expect(r.shootT).toBe(0);
    r.update(0.05);
    expect(r.model.rotation.x).toBeCloseTo(lying);

    // 站起：数值单调回落，最后归零
    r.setMoving(false, 0);
    r.setDown(false);
    expect(r.current).toBe('idle');
    r.update(0.05);
    const rising = r.model.rotation.x;
    expect(rising).toBeLessThan(lying);
    expect(rising).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) r.update(0.05);
    expect(r.downK).toBe(0);
    expect(r.model.rotation.x).toBe(0);
    expect(r.model.position.y).toBe(0);
    expect(r.plate.position.y).toBeCloseTo(PLATE_Y);
    expect(r.rig.armL.bone.quaternion.equals(standArm)).toBe(true);

    // 死亡优先：趴着时 setDead 直接接管，之后 setDown(false) 不会把尸体扶起来
    r.setDown(true);
    for (let i = 0; i < 40; i++) r.update(0.05);
    r.setDead();
    expect(r.down).toBe(false);
    expect(r.current).toBe('die');
    for (let i = 0; i < 40; i++) r.update(0.05);
    expect(r.model.rotation.x).toBeCloseTo(-1.5);
    r.setDown(false);
    expect(r.current).toBe('die');
    r.update(0.05);
    expect(r.model.rotation.x).toBeCloseTo(-1.5);
    r.dispose();
  });

  it('模型晚到时按倒地状态初始化', () => {
    setModel({ scene: null, ready: true });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    r.setDown(true);
    expect(r.down).toBe(true);
    remoteModel.scene = makePumpkin().root;
    r.buildModel();
    expect(r.current).toBe('down');
    expect(r.weaponMount).toBeTruthy();
    r.dispose();
  });

  it('play 忽略空值与同名状态', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    r.play('idle');
    expect(r.current).toBe('idle');
    r.play('');
    expect(r.current).toBe('idle');
    r.play('nope');
    expect(r.current).toBe('nope');
    r.dispose();
  });

  it('setTransform 直接对齐；setTarget 平滑过去，超过 3 米吸附', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    r.setTransform(3, 4, 5, 6);
    expect(r.root.position.toArray()).toEqual([3, 6, 4]);
    expect(r.root.rotation.y).toBeCloseTo(5 + Math.PI);

    r.setTransform(0, 0, 0, 0);
    r.setTarget(2, 0, 0, 0);
    r.update(0.05);
    expect(r.root.position.x).toBeGreaterThan(0);
    expect(r.root.position.x).toBeLessThan(2);
    r.setTarget(20, 0, 0, 0);
    r.update(0.05);
    expect(r.root.position.x).toBe(20);
    r.dispose();
  });

  // 回归：玩家 A 面对队友 B 时，B 屏幕上看到的 A 必须是正脸（模型面朝 +Z，yaw 0 = 面朝 -Z）。
  it('yaw 是相机口径：A 面对 B 时，A 的模型正面朝 B', () => {
    const facing = (r) => new THREE.Vector3(0, 0, 1).applyQuaternion(r.root.quaternion);
    const a = new RemotePlayer({ scene: new THREE.Scene(), x: 0, z: 0, yaw: 0 });
    expect(facing(a).z).toBeCloseTo(-1, 5);
    a.setTarget(0, 0, Math.PI, 0);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(facing(a).z).toBeCloseTo(1, 5);
    a.setTransform(0, 0, Math.PI / 2, 0);
    expect(facing(a).x).toBeCloseTo(-1, 5);
    a.setTransform(0, 0, -Math.PI / 2, 0);
    expect(facing(a).x).toBeCloseTo(1, 5);
    a.dispose();
  });

  it('模型未就绪时先放占位体；没有场景也能构建和销毁', () => {
    const r = new RemotePlayer({ scene: null });
    expect(r.root.parent).toBeNull();
    expect(r.placeholder).toBeNull();
    expect(r.ready).toBe(true);
    expect(() => r.dispose()).not.toThrow();
  });

  it('没有模型时 buildModel 直接返回；补上模型后能重建（占位体为空的分支）', () => {
    setModel({ scene: null, ready: true });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.ready).toBe(false);
    expect(r.model).toBeUndefined();
    expect(r.placeholder).toBeTruthy();

    remoteModel.scene = makePumpkin().root;
    r.buildModel();
    expect(r.ready).toBe(true);
    expect(r.placeholder).toBeNull();
    const first = r.model;
    r.buildModel();
    expect(r.model).toBe(first);
    r.dispose();
  });

  it('模型加载完成前就销毁，不会再建模型', () => {
    setModel({ scene: null, ready: true });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.ready).toBe(false);
    r.dispose();
    remoteModel.scene = makePumpkin().root;
    r.buildModel();
    expect(r.model).toBeNull();
  });

  it('模型晚到时按当前状态初始化（走路/死亡两条分支）', () => {
    setModel({ scene: null, ready: true });
    const a = new RemotePlayer({ scene: new THREE.Scene() });
    a.placeholder = null;
    a.setMoving(true, 4);
    remoteModel.scene = makePumpkin().root;
    a.buildModel();
    expect(a.current).toBe('run');
    expect(a.ready).toBe(true);

    const b = new RemotePlayer({ scene: new THREE.Scene() });
    b.setDead();
    b.setMoving(true, 4);
    b.buildModel();
    expect(b.current).toBe('die');
    expect(b.moving).toBe(true);

    b.model = null;
    b.update(0.1);
    a.dispose();
    b.dispose();
    b.update(0.1);
  });

  it('没有名牌时待机/走路/死亡都照常跑，重复 setDead 只生效一次', () => {
    vi.mocked(document.createElement).mockReturnValue({ width: 0, height: 0, getContext: () => null });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.plate).toBeUndefined();
    r.update(0.1);
    expect(r.model.rotation.x).toBe(0);
    r.setDead();
    r.setDead();
    r.update(0.2);
    expect(r.deadT).toBeLessThan(0.4);
    r.dispose();
  });

  it('未就绪时 setFiring 直接返回；没有名牌/阴影时 dispose 不报错', () => {
    setModel({ scene: null, ready: true });
    vi.mocked(document.createElement).mockReturnValue({ width: 0, height: 0, getContext: () => null });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.ready).toBe(false);
    expect(r.plate).toBeUndefined();
    r.setFiring();
    expect(r.shootT).toBe(0);
    r.shadow = null;
    r.owned.push(null);
    r.dispose();

    vi.mocked(document.createElement).mockReturnValue(canvas);
    remoteModel.scene = makePumpkin().root;
    const withPlate = new RemotePlayer({ scene: new THREE.Scene() });
    withPlate.plate.material.map = null;
    withPlate.dispose();
    expect(withPlate.plate).toBeNull();

    const rr = new RemotePlayer({ scene: new THREE.Scene() });
    rr.plate = null;
    rr.setDead();
    rr.update(0.5);
    rr.dispose();
    expect(() => rr.dispose()).not.toThrow();
  });
});

describe('initRemoteModel', () => {
  async function freshModule() {
    vi.resetModules();
    vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => {
      class GLTFLoader {
        load(url, onLoad, onProgress, onError) {
          GLTFLoader.calls++;
          GLTFLoader.url = url;
          GLTFLoader.onLoad = onLoad;
          GLTFLoader.onError = onError;
        }
      }
      GLTFLoader.calls = 0;
      return { GLTFLoader };
    });
    return import('../../src/entities/RemotePlayer.js');
  }

  it('加载 pumpkin-kid.glb：设置阴影、只加载一次、唤醒等待者', async () => {
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(mesh);

    mod.initRemoteModel();
    expect(GLTFLoader.calls).toBe(1);
    expect(GLTFLoader.url.endsWith('models/pumpkin-kid.glb')).toBe(true);

    GLTFLoader.onLoad({ scene, animations: [] });
    expect(mod.remoteModel.ready).toBe(true);
    expect(mod.remoteModel.failed).toBe(false);
    expect(mod.remoteModel.scene).toBe(scene);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);

    mod.initRemoteModel();
    expect(GLTFLoader.calls).toBe(1);

    const fn = vi.fn();
    mod.whenRemoteReady(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('加载前注册的回调在成功后触发', async () => {
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const fn = vi.fn();
    mod.initRemoteModel();
    mod.whenRemoteReady(fn);
    expect(fn).not.toHaveBeenCalled();
    GLTFLoader.onLoad({ scene: new THREE.Group(), animations: [] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('加载失败：failed=true，等待回调不触发', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    mod.initRemoteModel();
    GLTFLoader.onError(new Error('nope'));
    expect(mod.remoteModel.failed).toBe(true);
    expect(warn).toHaveBeenCalled();
    const fn = vi.fn();
    mod.whenRemoteReady(fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
