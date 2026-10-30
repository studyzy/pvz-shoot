import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { blobShadowTexture } from '../../src/world/materials.js';
import {
  RemotePlayer,
  farmerModel,
  initFarmerModel,
  whenFarmerReady,
  daveifyModel,
  DAVE_COLORS,
  buildPotHat,
  buildBeard,
  buildGun,
  attachToBone,
  createNameplate,
} from '../../src/entities/RemotePlayer.js';

function makeFarmer() {
  const root = new THREE.Group();
  root.name = 'RootNode';
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 1.5, 0.09);
  root.add(head);
  const wrist = new THREE.Bone();
  wrist.name = 'WristR';
  wrist.position.set(-0.22, 1.03, 0.14);
  root.add(wrist);

  const mk = (name, matName, parent, material) => {
    const mat = material || new THREE.MeshStandardMaterial({ name: matName });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  const headGroup = new THREE.Group();
  headGroup.name = 'Farmer_Head';
  root.add(headGroup);
  const headSkin = mk('Farmer_Head_1', 'Skin', headGroup);
  const hat = mk('Farmer_Head_2', 'Beige', headGroup);
  mk('Farmer_Head_3', 'Eyebrows', headGroup);
  const band = mk('Farmer_Head_4', 'Red', headGroup);
  mk('Farmer_Head_5', 'Eye', headGroup);

  const body = new THREE.Group();
  body.name = 'Farmer_Body';
  root.add(body);
  const shirt = mk('Farmer_Body_1', 'Brown', body);
  const overalls = mk('Farmer_Body_2', 'LightBlue', body);
  mk('Farmer_Body_3', 'Skin', body);
  const cuffs = mk('Farmer_Body_4', 'Beige', body);

  const feet = new THREE.Group();
  feet.name = 'Farmer_Feet';
  root.add(feet);
  const shoe1 = mk('Farmer_Feet_1', 'Brown2', feet);
  const shoe2 = mk('Farmer_Feet_2', 'Brown', feet);
  const pants = mk('Farmer_Pants', 'LightBlue', root);

  return { root, head, wrist, headGroup, body, feet, headSkin, hat, band, shirt, overalls, cuffs, shoe1, shoe2, pants };
}

function makeClip(name, duration = 1) {
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, duration], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

function makeClips(includeShoot = true) {
  const names = [
    'CharacterArmature|Idle_Gun',
    'CharacterArmature|Run',
    'CharacterArmature|Walk',
    'CharacterArmature|Death',
    'CharacterArmature|HitRecieve',
    'CharacterArmature|Wave',
  ];
  if (includeShoot) names.push('CharacterArmature|Gun_Shoot');
  return names.map((n) => makeClip(n));
}

function fakeCanvas(withRound = true) {
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
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

function setModel({ scene, clips, ready = true } = {}) {
  farmerModel.started = true;
  farmerModel.ready = ready;
  farmerModel.failed = false;
  farmerModel.scene = scene === undefined ? makeFarmer().root : scene;
  farmerModel.clips = clips === undefined ? makeClips() : clips;
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
  farmerModel.started = true;
  farmerModel.ready = false;
  farmerModel.failed = false;
  farmerModel.scene = null;
  farmerModel.clips = [];
});

describe('daveifyModel', () => {
  it('隐藏草帽、改色、克隆材质并设置阴影/环境贴图', () => {
    const f = makeFarmer();
    const env = { fake: true };
    const owned = [];
    const srcShirt = f.shirt.material;
    const srcShirtColor = srcShirt.color.getHex();

    daveifyModel(f.root, env, owned);

    expect(f.hat.visible).toBe(false);
    expect(f.band.visible).toBe(false);
    expect(f.headSkin.visible).toBe(true);
    expect(f.shirt.material.color.getHex()).toBe(DAVE_COLORS.shirt);
    expect(f.cuffs.material.color.getHex()).toBe(DAVE_COLORS.shirt);
    expect(f.overalls.material.color.getHex()).toBe(DAVE_COLORS.pants);
    expect(f.pants.material.color.getHex()).toBe(DAVE_COLORS.pants);
    expect(f.shoe1.material.color.getHex()).toBe(DAVE_COLORS.shoes);
    expect(f.shoe2.material.color.getHex()).toBe(DAVE_COLORS.shoes);
    expect(f.shirt.material).not.toBe(srcShirt);
    expect(f.shirt.material.envMap).toBe(env);
    expect(f.shirt.material.envMapIntensity).toBe(0.35);
    expect(f.shirt.castShadow).toBe(true);
    expect(f.shirt.receiveShadow).toBe(false);
    expect(f.shirt.frustumCulled).toBe(false);
    expect(owned.length).toBeGreaterThan(0);
    expect(srcShirtColor).toBe(0xffffff);
  });

  it('不传 owned 也能工作，并跳过非 Mesh / 无材质对象', () => {
    const f = makeFarmer();
    const group = new THREE.Group();
    f.root.add(group);
    const noMat = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), null);
    f.root.add(noMat);
    const basic = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    basic.name = 'basic';
    f.root.add(basic);
    expect(() => daveifyModel(f.root, null, null)).not.toThrow();
  });
});

describe('程序化戴夫配件', () => {
  it('锅盖帽 / 胡子 / 豌豆枪都带材质和阴影', () => {
    const env = { fake: true };
    const hat = buildPotHat(env);
    expect(hat.children).toHaveLength(2);
    expect(hat.children[0].material.envMap).toBe(env);
    expect(hat.children[0].castShadow).toBe(true);
    expect(hat.position.y).toBeCloseTo(1.7);

    const beard = buildBeard(env);
    expect(beard.children).toHaveLength(3);
    expect(beard.children[0].material.color.getHex()).toBe(DAVE_COLORS.beard);

    const gun = buildGun(env);
    expect(gun.children).toHaveLength(4);
    expect(gun.children[0].material.color.getHex()).toBe(0x8ade2a);
    expect(gun.position.x).toBeCloseTo(-0.225);
  });

  it('attachToBone 有骨骼时挂骨骼，没有骨骼时退回模型根', () => {
    const model = new THREE.Group();
    const bone = new THREE.Bone();
    model.add(bone);
    const a = new THREE.Group();
    attachToBone(model, bone, a);
    expect(a.parent).toBe(bone);

    const b = new THREE.Group();
    attachToBone(model, null, b);
    expect(b.parent).toBe(model);
  });
});

describe('createNameplate', () => {
  it('画圆角名牌并返回 Sprite', () => {
    const sprite = createNameplate('队友');
    expect(sprite.isSprite).toBe(true);
    expect(sprite.scale.x).toBeCloseTo(0.92);
    expect(sprite.material.map).toBeTruthy();
    expect(canvas.__ctx.roundRect).toHaveBeenCalled();
    expect(canvas.__ctx.fillText).toHaveBeenCalledWith('队友', 128, 32);
  });

  it('没有 roundRect 时退回矩形', () => {
    const rectCanvas = fakeCanvas(false);
    vi.mocked(document.createElement).mockReturnValue(rectCanvas);
    const sprite = createNameplate('队友');
    expect(sprite).toBeTruthy();
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

describe('RemotePlayer', () => {
  it('构建模型、配件、动画与名牌，并能移动/开火/死亡/销毁', () => {
    const scene = new THREE.Scene();
    const env = { fake: true };
    const r = new RemotePlayer({ scene, env, name: '队友', x: 1, z: 2, yaw: 0.5 });

    expect(r.ready).toBe(true);
    expect(r.root.parent).toBe(scene);
    expect(r.model).toBeTruthy();
    expect(r.current).toBe('idle');
    expect(Object.keys(r.actions).sort()).toEqual(['die', 'hit', 'idle', 'run', 'shoot', 'walk', 'wave']);
    expect(r.pot.parent).toBe(r.model.getObjectByName('Head'));
    expect(r.beard.parent).toBe(r.model.getObjectByName('Head'));
    expect(r.gun.parent).toBe(r.model.getObjectByName('WristR'));
    expect(r.plate).toBeTruthy();
    expect(r.model.getObjectByName('Farmer_Head_2').visible).toBe(false);

    r.play('nope');
    r.play('idle');
    expect(r.current).toBe('idle');

    r.setMoving(true, 4.2);
    expect(r.current).toBe('run');
    expect(r.mixer.timeScale).toBeCloseTo(1);

    r.setFiring();
    expect(r.current).toBe('shoot');
    expect(r.shootT).toBe(1);
    r.update(0.5);
    expect(r.current).toBe('shoot');
    r.update(0.6);
    expect(r.current).toBe('run');

    r.setTransform(3, 4, 5, 6);
    expect(r.root.position.toArray()).toEqual([3, 6, 4]);
    expect(r.root.rotation.y).toBe(5);

    r.setDead();
    expect(r.current).toBe('die');
    r.setFiring();
    r.setMoving(false);
    expect(r.current).toBe('die');
    r.shootT = 0.1;
    r.update(0.2);
    expect(r.current).toBe('die');

    const texSpy = vi.spyOn(r.plate.material.map, 'dispose');
    r.dispose();
    expect(texSpy).toHaveBeenCalled();
    expect(scene.children).not.toContain(r.root);
    expect(r.ready).toBe(false);
    expect(r.owned).toHaveLength(0);

    expect(() => r.dispose()).not.toThrow();
  });

  it('setTarget 平滑过去，超过 3 米直接吸附', () => {
    const r = new RemotePlayer({ scene: new THREE.Scene() });
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

    r.root.remove(r.placeholder);
    r.placeholder = null;
    farmerModel.scene = makeFarmer().root;
    r.buildModel();
    expect(r.ready).toBe(true);
    const first = r.model;
    r.buildModel();
    expect(r.model).toBe(first);
    r.dispose();
  });

  it('没有动画片段时不建 mixer，setFiring 用兜底时长', () => {
    setModel({ clips: [] });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.mixer).toBeNull();
    expect(r.current).toBeNull();
    r.play('idle');
    r.setMoving(true, 4);
    expect(r.current).toBeNull();
    r.setFiring();
    expect(r.shootT).toBe(0.35);
    r.update(0.5);
    r.dispose();
  });

  it('只有 Idle 片段时能找到 idle；全不匹配时 actions 为空', () => {
    setModel({ clips: [makeClip('CharacterArmature|Idle')] });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.actions.idle).toBeTruthy();
    expect(r.actions.run).toBeUndefined();
    r.dispose();

    setModel({ clips: [makeClip('CharacterArmature|Other')] });
    const r2 = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r2.mixer).toBeTruthy();
    expect(r2.current).toBeNull();
    r2.dispose();
  });

  it('模型加载完成前就销毁，不会再建模型', () => {
    setModel({ scene: null, ready: true });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.ready).toBe(false);
    r.dispose();
    farmerModel.scene = makeFarmer().root;
    r.buildModel();
    expect(r.model).toBeUndefined();
  });

  it('未就绪时 setFiring 直接返回；没有名牌/阴影时 dispose 不报错', () => {
    setModel({ scene: null, ready: true });
    vi.mocked(document.createElement).mockReturnValue({ width: 0, height: 0, getContext: () => null });
    const r = new RemotePlayer({ scene: new THREE.Scene() });
    expect(r.ready).toBe(false);
    expect(r.plate).toBeUndefined();
    r.setFiring();
    r.shadow = null;
    r.dispose();
  });
});

describe('initFarmerModel', () => {
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

  it('加载成功：写入 scene/clips、设置阴影，并且只加载一次', async () => {
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(mesh);

    mod.initFarmerModel();
    expect(GLTFLoader.calls).toBe(1);
    expect(GLTFLoader.url.endsWith('models/farmer.glb')).toBe(true);

    GLTFLoader.onLoad({ scene, animations: [{ name: 'Idle' }] });
    expect(mod.farmerModel.ready).toBe(true);
    expect(mod.farmerModel.failed).toBe(false);
    expect(mod.farmerModel.scene).toBe(scene);
    expect(mod.farmerModel.clips).toHaveLength(1);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);

    mod.initFarmerModel();
    expect(GLTFLoader.calls).toBe(1);

    const fn = vi.fn();
    mod.whenFarmerReady(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('加载前注册的回调在成功后触发', async () => {
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const fn = vi.fn();
    mod.initFarmerModel();
    mod.whenFarmerReady(fn);
    expect(fn).not.toHaveBeenCalled();
    GLTFLoader.onLoad({ scene: new THREE.Group(), animations: [] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('加载失败：failed=true，等待回调不触发', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await freshModule();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    mod.initFarmerModel();
    GLTFLoader.onError(new Error('nope'));
    expect(mod.farmerModel.failed).toBe(true);
    expect(warn).toHaveBeenCalled();
    const fn = vi.fn();
    mod.whenFarmerReady(fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
