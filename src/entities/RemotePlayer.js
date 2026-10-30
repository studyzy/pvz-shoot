import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { blobShadowTexture } from '../world/materials.js';
import { findClip } from './ZombieModel.js';
import { clamp } from '../utils.js';

// 队友模型：Quaternius Farmer（CC0 1.0，Poly Pizza 2022-02-22）。
// 1.3 MB / 3,716 面 / 24 段动画 / 1.823 米；Y-up、面朝 +Z、脚底 y≈0。
// 只在创建 RemotePlayer 时懒加载，单人模式不下载。
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

export const FARMER_SCALE = 1;
export const FARMER_HEIGHT = 1.823;

export const farmerModel = {
  started: false,
  ready: false,
  failed: false,
  scene: null,
  clips: [],
};

let waiters = [];

export function initFarmerModel() {
  if (farmerModel.started) return;
  farmerModel.started = true;
  const loader = new GLTFLoader();
  loader.load(
    BASE + 'models/farmer.glb',
    (gltf) => {
      farmerModel.scene = prepare(gltf.scene);
      farmerModel.clips = gltf.animations || [];
      farmerModel.ready = true;
      const list = waiters;
      waiters = [];
      for (let i = 0; i < list.length; i++) list[i]();
    },
    undefined,
    (err) => {
      farmerModel.failed = true;
      waiters = [];
      console.warn('farmer glb failed', err);
    }
  );
}

export function whenFarmerReady(fn) {
  if (farmerModel.ready) {
    fn();
    return;
  }
  if (!farmerModel.failed) waiters.push(fn);
}

function prepare(root) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = false;
    n.frustumCulled = false;
  });
  return root;
}

// 戴夫化配色：白衬衫 + 棕色背带裤 + 深棕鞋 + 棕胡子/锅盖帽。
export const DAVE_COLORS = {
  shirt: 0xe9e3d2,
  pants: 0x6d4a2f,
  shoes: 0x4b3320,
  pot: 0x8a5a2b,
  potRim: 0x5c3a1e,
  beard: 0x7a3f1e,
  skin: 0xd9a06b,
};

// 把 Farmer 改成戴夫：
// - 隐藏草帽（Farmer_Head 下的 Beige/Red），换成程序化锅盖帽
// - 衬衫（Farmer_Body Brown/Beige）改米白
// - 背带裤/裤子（LightBlue）改棕色
// - 鞋（Farmer_Feet Brown/Brown2）改深棕
// 每件 mesh 克隆材质，避免影响其它 RemotePlayer / 源模型。
export function daveifyModel(root, env, owned) {
  root.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    const mat = n.material;
    const mName = mat.name || '';
    const pName = (n.parent && n.parent.name) || '';
    if (pName === 'Farmer_Head' && (mName === 'Beige' || mName === 'Red')) {
      n.visible = false;
      return;
    }
    const m = mat.clone();
    m.envMap = env || null;
    m.envMapIntensity = 0.35;
    if (m.emissive) {
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 0;
    }
    n.material = m;
    if (owned) owned.push(m);
    if (mName === 'LightBlue') m.color.setHex(DAVE_COLORS.pants);
    else if (pName === 'Farmer_Body' && (mName === 'Brown' || mName === 'Beige')) m.color.setHex(DAVE_COLORS.shirt);
    else if (pName === 'Farmer_Feet' && (mName === 'Brown' || mName === 'Brown2')) m.color.setHex(DAVE_COLORS.shoes);
    n.castShadow = true;
    n.receiveShadow = false;
    n.frustumCulled = false;
  });
  return root;
}

function partMaterial(env, color, roughness) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.04,
  });
  m.envMap = env || null;
  m.envMapIntensity = 0.35;
  return m;
}

// 锅盖帽：低多边形圆柱 + 一圈帽檐，略微歪戴。
export function buildPotHat(env) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.125, 0.105, 10),
    partMaterial(env, DAVE_COLORS.pot, 0.72)
  );
  body.position.y = 0.0525;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.172, 0.172, 0.024, 12),
    partMaterial(env, DAVE_COLORS.potRim, 0.8)
  );
  rim.position.y = 0.105;
  g.add(body, rim);
  g.position.set(0, 1.7, 0.1);
  g.rotation.set(-0.04, 0.12, 0.08);
  g.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = false;
    }
  });
  return g;
}

// 大胡子 + 八字胡 + 鼻头；挂在 Head 骨骼上跟着头部动画。
export function buildBeard(env) {
  const g = new THREE.Group();
  const hair = partMaterial(env, DAVE_COLORS.beard, 0.92);
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), hair);
  beard.scale.set(1.05, 1.0, 0.62);
  const stache = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.026, 0.034), hair);
  stache.position.set(0, 0.095, 0.036);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), partMaterial(env, DAVE_COLORS.skin, 0.75));
  nose.position.set(0, 0.13, 0.045);
  g.add(beard, stache, nose);
  g.position.set(0, 1.47, 0.19);
  g.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = false;
    }
  });
  return g;
}

// 右手豌豆枪：程序化绿色短枪，挂在 WristR 上。
export function buildGun(env) {
  const g = new THREE.Group();
  const green = partMaterial(env, 0x8ade2a, 0.5);
  const dark = partMaterial(env, 0x4e7d1d, 0.6);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.24, 8), green);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.06;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.23;
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), green);
  muzzle.position.z = 0.31;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), dark);
  grip.position.set(0, -0.07, 0.03);
  g.add(body, barrel, muzzle, grip);
  g.position.set(-0.225, 1.04, 0.16);
  g.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = false;
    }
  });
  return g;
}

// 把配件挂到骨骼：先放进模型空间算好世界变换，再 attach 到骨骼。
// 这样不用手算 CharacterArmature 的 100 倍缩放。
export function attachToBone(model, bone, obj) {
  if (!bone) {
    model.add(obj);
    return obj;
  }
  model.add(obj);
  model.updateMatrixWorld(true);
  bone.updateMatrixWorld(true);
  bone.attach(obj);
  return obj;
}

// 头顶名牌：canvas 贴图 + Sprite，始终朝向相机。
export function createNameplate(name) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(16, 24, 12, 0.72)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 14);
    ctx.fill();
  } else {
    ctx.fillRect(8, 8, 240, 48);
  }
  ctx.strokeStyle = 'rgba(160, 220, 90, 0.8)';
  ctx.lineWidth = 2;
  if (ctx.roundRect) ctx.stroke();
  ctx.fillStyle = '#eaf5d8';
  ctx.font = '600 24px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.92, 0.23, 1);
  sprite.position.set(0, 2.06, 0);
  sprite.renderOrder = 2;
  return sprite;
}

let shadowMat = null;
function shadowMaterial() {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
      color: 0x20300f,
    });
  }
  return shadowMat;
}

// 远端玩家：现在只做视觉与动画，位置/朝向由网络层或调试代码写入。
export class RemotePlayer {
  constructor({ scene, env = null, name = '队友', x = 0, z = 0, y = 0, yaw = 0 } = {}) {
    this.scene = scene;
    this.env = env;
    this.name = name;
    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.ready = false;
    this.disposed = false;
    this.target = null;
    this.dead = false;
    this.moving = false;
    this.speed = 0;
    this.shootT = 0;
    this.owned = [];
    this.actions = {};
    this.current = null;

    this.buildShadow();
    this.buildPlaceholder();
    if (scene) scene.add(this.root);
    initFarmerModel();
    whenFarmerReady(() => this.buildModel());
  }

  buildShadow() {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), shadowMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    mesh.renderOrder = 1;
    this.shadow = mesh;
    this.root.add(mesh);
  }

  // 模型还在下载时先站一个绿色人影，避免队友凭空消失。
  buildPlaceholder() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b8f3a, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: DAVE_COLORS.skin, roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), bodyMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), skinMat);
    head.position.y = 1.56;
    g.add(body, head);
    g.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = false;
      }
    });
    this.owned.push(bodyMat, skinMat, body.geometry, head.geometry);
    this.placeholder = g;
    this.root.add(g);
  }

  track(obj) {
    obj.traverse((n) => {
      if (!n.isMesh) return;
      if (n.geometry) this.owned.push(n.geometry);
      if (n.material) this.owned.push(n.material);
    });
    return obj;
  }

  buildModel() {
    if (this.disposed || !farmerModel.scene || this.model) return;
    if (this.placeholder) {
      this.root.remove(this.placeholder);
      this.placeholder = null;
    }
    this.model = cloneSkinned(farmerModel.scene);
    this.model.scale.setScalar(FARMER_SCALE);
    daveifyModel(this.model, this.env, this.owned);
    this.root.add(this.model);
    this.model.updateMatrixWorld(true);

    const head = this.model.getObjectByName('Head');
    // GLTFLoader 会把 Wrist.R 里的点去掉，加载后实际叫 WristR。
    const wrist =
      this.model.getObjectByName('WristR') ||
      this.model.getObjectByName('Wrist_R') ||
      this.model.getObjectByName('Wrist.R');
    this.pot = attachToBone(this.model, head, this.track(buildPotHat(this.env)));
    this.beard = attachToBone(this.model, head, this.track(buildBeard(this.env)));
    this.gun = attachToBone(this.model, wrist, this.track(buildGun(this.env)));

    const plate = createNameplate(this.name);
    if (plate) {
      this.plate = plate;
      this.root.add(plate);
    }

    this.buildAnimations();
    this.ready = true;
  }

  buildAnimations() {
    const clips = farmerModel.clips || [];
    this.mixer = clips.length ? new THREE.AnimationMixer(this.model) : null;
    this.actions = {};
    if (!this.mixer) return;
    const pick = (...names) => {
      for (let i = 0; i < names.length; i++) {
        const c = findClip(clips, names[i]);
        if (c) return c;
      }
      return null;
    };
    const want = {
      idle: pick('idle_gun', 'idle', 'idle_neutral'),
      run: pick('run', 'walk'),
      walk: pick('walk', 'run'),
      shoot: pick('gun_shoot', 'idle_gun_shoot'),
      die: pick('death'),
      hit: pick('hitrecieve', 'hitrecieve_2'),
      wave: pick('wave'),
    };
    for (const k in want) {
      if (!want[k]) continue;
      const a = this.mixer.clipAction(want[k]);
      if (k === 'shoot' || k === 'die' || k === 'hit' || k === 'wave') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }
    this.play('idle', 0);
  }

  play(name, fade = 0.2) {
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  setTransform(x, z, yaw, y = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.target = { x, y, z, yaw };
  }

  // 20 Hz 网络状态不要直接 snap：存目标，在 update 里按 ~100ms 平滑过去。
  // 超过 3 米视为传送（重连/换图），直接吸附，避免拖影。
  setTarget(x, z, yaw, y = 0) {
    this.target = { x, y, z, yaw };
  }

  setMoving(moving, speed = 0) {
    this.moving = !!moving;
    this.speed = speed;
    if (this.dead) return;
    if (this.shootT <= 0) this.play(moving ? 'run' : 'idle', 0.18);
    if (this.mixer) this.mixer.timeScale = moving ? clamp(speed / 4.2, 0.7, 1.5) : 1;
  }

  setFiring() {
    if (this.dead || !this.ready) return;
    this.play('shoot', 0.05);
    const a = this.actions.shoot;
    this.shootT = a ? a.getClip().duration : 0.35;
    if (a) a.reset().play();
  }

  setDead() {
    if (this.dead) return;
    this.dead = true;
    this.play('die', 0.1);
  }

  update(dt) {
    if (this.target) {
      const p = this.root.position;
      const t = this.target;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      let dYaw = t.yaw - this.root.rotation.y;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      if (dist > 3) {
        p.set(t.x, t.y, t.z);
        this.root.rotation.y = t.yaw;
      } else if (dist > 0.0005 || Math.abs(t.y - p.y) > 0.0005 || Math.abs(dYaw) > 0.0005) {
        const a = 1 - Math.exp(-dt * 16);
        p.x += (t.x - p.x) * a;
        p.y += (t.y - p.y) * a;
        p.z += (t.z - p.z) * a;
        this.root.rotation.y += dYaw * a;
      }
    }
    if (this.mixer) this.mixer.update(dt);
    if (this.shootT > 0) {
      this.shootT -= dt;
      if (this.shootT <= 0 && !this.dead) this.play(this.moving ? 'run' : 'idle', 0.15);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    if (this.plate) {
      if (this.plate.material.map) this.plate.material.map.dispose();
      this.plate.material.dispose();
      this.plate = null;
    }
    if (this.shadow) {
      this.shadow.geometry.dispose();
      this.shadow = null;
    }
    for (let i = 0; i < this.owned.length; i++) {
      if (this.owned[i] && this.owned[i].dispose) this.owned[i].dispose();
    }
    this.owned.length = 0;
    if (this.scene) this.scene.remove(this.root);
    this.root.clear();
    this.ready = false;
  }
}
