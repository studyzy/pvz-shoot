import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { blobShadowTexture } from '../world/materials.js';
import { loadWeaponModel } from '../weapons/WeaponModels.js';
import { clamp } from '../utils.js';

// 队友模型：aigc/pumpkin-kid.glb（仓库所有者提供的 AIGC 资产）。
// 800 KB / 12,000 三角面 / 1 个蒙皮网格（1 draw call）/ 23 根骨骼 / 0 段动画。
// Y-up、面朝 +Z、脚底 y≈0、原始高 1.132 米；乘 MODEL_SCALE 到约 1.65 米。
// 模型本身没有动画片段，待机 / 走路 / 开火 / 死亡全部按骨骼程序化摆姿势（见 animate）。
// 只在创建 RemotePlayer 时懒加载，单人模式不下载。
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

export const MODEL_SCALE = 1.46;
export const MODEL_HEIGHT = 1.132;
export const PLATE_Y = 1.92;

export const remoteModel = {
  started: false,
  ready: false,
  failed: false,
  scene: null,
};

let waiters = [];

export function initRemoteModel() {
  if (remoteModel.started) return;
  remoteModel.started = true;
  const loader = new GLTFLoader();
  loader.load(
    BASE + 'models/pumpkin-kid.glb',
    (gltf) => {
      remoteModel.scene = prepare(gltf.scene);
      remoteModel.ready = true;
      const list = waiters;
      waiters = [];
      for (let i = 0; i < list.length; i++) list[i]();
    },
    undefined,
    (err) => {
      remoteModel.failed = true;
      waiters = [];
      console.warn('pumpkin-kid glb failed', err);
    }
  );
}

export function whenRemoteReady(fn) {
  if (remoteModel.ready) {
    fn();
    return;
  }
  if (!remoteModel.failed) waiters.push(fn);
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

// 骨骼表：模型是标准人形骨架（Hips / Spine / LeftArm / LeftUpLeg…）。
// 只登记要摆的骨骼，找不到就跳过（换模型时不至于整只人物消失）。
const BONE_NAMES = {
  hips: 'Hips',
  spine: 'Spine',
  spine1: 'Spine1',
  spine2: 'Spine2',
  head: 'Head',
  armL: 'LeftArm',
  foreArmL: 'LeftForeArm',
  armR: 'RightArm',
  foreArmR: 'RightForeArm',
  handR: 'RightHand',
  upLegL: 'LeftUpLeg',
  legL: 'LeftLeg',
  footL: 'LeftFoot',
  upLegR: 'RightUpLeg',
  legR: 'RightLeg',
  footR: 'RightFoot',
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();
const _delta = new THREE.Quaternion();
const _q = new THREE.Quaternion();

// 节点相对模型根（model）的旋转。用来把「模型空间」的轴向换算到骨骼父空间，
// 这样摆姿势不用猜每根骨骼的本地轴；模型整体转多少度都不影响。
function modelSpaceQuat(node, model) {
  _q.identity();
  let n = node;
  while (n && n !== model) {
    _q.premultiply(n.quaternion);
    n = n.parent;
  }
  return _q.clone();
}

function captureRig(model) {
  const rig = {};
  for (const key in BONE_NAMES) {
    const bone = model.getObjectByName(BONE_NAMES[key]);
    if (!bone) continue;
    rig[key] = {
      bone,
      rest: bone.quaternion.clone(),
      restY: bone.position.y,
      parentInv: modelSpaceQuat(bone.parent || model, model).invert(),
    };
  }
  return rig;
}

// 绕「模型空间」的轴转这根骨骼：角度正负按模型自身朝向定，
// +X = 让肢体向后摆，+Y = 往模型左手边转，+Z = 抬起左侧肢体。
function addSpin(rec, axis, angle) {
  _axis.copy(axis).applyQuaternion(rec.parentInv).normalize();
  _delta.setFromAxisAngle(_axis, angle);
  rec.bone.quaternion.premultiply(_delta);
}

function setBone(rec, rx, ry, rz) {
  if (!rec) return;
  rec.bone.quaternion.copy(rec.rest);
  if (rx) addSpin(rec, AXIS_X, rx);
  if (ry) addSpin(rec, AXIS_Y, ry);
  if (rz) addSpin(rec, AXIS_Z, rz);
}

// 头顶名牌：canvas 贴图 + Sprite，始终朝向相机。
export function createNameplate(name, y = PLATE_Y) {
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
  sprite.position.set(0, y, 0);
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

// 玩家的 yaw 是「相机绕 Y 的旋转」，相机 default 看 -Z，所以 yaw=0 面朝 -Z；
// 而队友模型和 root 一样面朝 +Z。直接写 rotation.y = yaw 会让队友背对着自己，
// 必须转 π 补上这半个圈（模型正面 +Z → root.rotation.y 时朝向 (sin, cos)）。
export function yawToRotation(yaw) {
  return (Number(yaw) || 0) + Math.PI;
}

const SHOOT_TIME = 0.35;
const DEATH_TIME = 0.75;
// 队友手里那把武器的目标长度（世界米，取包围盒最长边）。
const WEAPON_LENGTH = 0.62;
// 只接受 WEAPONS 里的 id 形状：小写字母，避免把 peer 传来的字符串拼进 URL。
const WEAPON_ID = /^[a-z]{3,16}$/;

// 远端玩家：视觉与动画在这里，位置/朝向由网络层或调试代码写入。
export class RemotePlayer {
  constructor({ scene, env = null, name = '队友', x = 0, z = 0, y = 0, yaw = 0 } = {}) {
    this.scene = scene;
    this.env = env;
    this.name = name;
    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = yawToRotation(yaw);
    this.ready = false;
    this.disposed = false;
    this.target = null;
    this.dead = false;
    this.moving = false;
    this.speed = 0;
    this.time = 0;
    this.phase = 0;
    this.moveBlend = 0;
    this.shootT = 0;
    this.deadT = 0;
    this.current = null;
    this.weaponId = null;
    this.weaponReq = 0;
    this.weaponMats = [];
    this.owned = [];

    this.buildShadow();
    this.buildPlaceholder();
    if (scene) scene.add(this.root);
    initRemoteModel();
    whenRemoteReady(() => this.buildModel());
  }

  buildShadow() {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), shadowMaterial());
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
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a06b, roughness: 0.75 });
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

  // 材质按实例克隆（envMap 随地图变），几何体与贴图仍和模板共享，不能 dispose。
  ownModelMaterials(model) {
    model.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        if (c.envMap !== undefined) {
          c.envMap = this.env || null;
          c.envMapIntensity = 0.35;
        }
        this.owned.push(c);
        return c;
      });
      n.material = Array.isArray(n.material) ? cloned : cloned[0];
      n.castShadow = true;
      n.receiveShadow = false;
      n.frustumCulled = false;
    });
  }

  buildModel() {
    if (this.disposed || !remoteModel.scene || this.model) return;
    if (this.placeholder) {
      this.root.remove(this.placeholder);
      this.placeholder = null;
    }
    this.model = cloneSkinned(remoteModel.scene);
    this.model.scale.setScalar(MODEL_SCALE);
    this.ownModelMaterials(this.model);
    this.root.add(this.model);
    this.model.updateMatrixWorld(true);

    this.rig = captureRig(this.model);
    this.bones = Object.keys(this.rig).map((k) => this.rig[k].bone.name);

    // 先摆一次「举枪待机」，让武器的挂点按这个姿势标定（见 buildWeaponMount）。
    this.animate(0);
    this.buildWeaponMount();

    const plate = createNameplate(this.name);
    if (plate) {
      this.plate = plate;
      this.root.add(plate);
    }

    this.current = this.dead ? 'die' : this.moving ? 'run' : 'idle';
    this.ready = true;
  }

  // 武器挂在右手骨骼上。挂点用「举枪待机」这一刻的姿势反解：
  // 先算出手骨在模型空间的矩阵，再求它的逆 × 想要的手部武器矩阵，得到固定的本地偏移。
  // 这样无论 armR/foreArmR 之后怎么摆、模型整体怎么旋转，武器都跟着手走且朝正前方。
  buildWeaponMount() {
    if (!this.rig || !this.rig.handR || !this.model) return;
    const mount = new THREE.Group();
    this.model.updateMatrixWorld(true);
    const invModel = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const handM = new THREE.Matrix4().multiplyMatrices(invModel, this.rig.handR.bone.matrixWorld);
    const hx = handM.elements[12];
    const hy = handM.elements[13];
    const hz = handM.elements[14];
    const want = new THREE.Matrix4().makeTranslation(hx, hy + 0.02, hz + 0.03);
    const local = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(handM).invert(), want);
    local.decompose(mount.position, mount.quaternion, mount.scale);
    this.rig.handR.bone.add(mount);
    this.weaponMount = mount;

    if (!this.weaponId) this.weaponId = 'pea';
    this.queueWeapon();
  }

  // 网络层每帧都会报武器 id；只有变化时才重新加载。
  setWeapon(id) {
    if (typeof id !== 'string' || !WEAPON_ID.test(id) || id === this.weaponId) return;
    this.weaponId = id;
    this.queueWeapon();
  }

  queueWeapon() {
    if (!this.weaponMount || !this.weaponId) return;
    const id = this.weaponId;
    const token = ++this.weaponReq;
    loadWeaponModel(id).then((template) => {
      if (!template || this.disposed || token !== this.weaponReq) return;
      this.attachWeapon(template);
    });
  }

  // 用真实的植物武器 GLB（和第一人称 / 地面拾取同一份素材）。
  // GLB 是 Y-up、枪口朝 -Z，绕 Y 转 π 后枪口朝模型 +Z；按包围盒归一化长度，
  // 再把底部抬到手上，看起来像抓着武器而不是插在手里。
  attachWeapon(template) {
    this.clearWeapon();
    const vis = template.clone(true);
    vis.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        if (c.envMap !== undefined) {
          c.envMap = this.env || null;
          c.envMapIntensity = 0.35;
        }
        this.weaponMats.push(c);
        return c;
      });
      n.material = Array.isArray(n.material) ? cloned : cloned[0];
      n.castShadow = true;
      n.receiveShadow = false;
      n.frustumCulled = false;
    });

    const box = new THREE.Box3().setFromObject(vis);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = WEAPON_LENGTH / (longest * MODEL_SCALE);
    vis.scale.setScalar(scale);
    vis.rotation.y = Math.PI;
    vis.position.set(0, -box.min.y * scale + 0.01, 0.02);

    this.weaponMount.add(vis);
    this.weapon = vis;
  }

  clearWeapon() {
    if (this.weapon && this.weaponMount) this.weaponMount.remove(this.weapon);
    this.weapon = null;
    for (let i = 0; i < this.weaponMats.length; i++) {
      if (this.weaponMats[i] && this.weaponMats[i].dispose) this.weaponMats[i].dispose();
    }
    this.weaponMats.length = 0;
  }

  // 程序化动画：moveBlend 把走路权重从 0 平滑到 1，开火是右手的一个衰减冲量，
  // 死亡是绕脚底整体后仰。所有姿势都以骨骼静止姿势为基准，不会越摆越歪。
  animate(dt) {
    if (!this.rig) return;
    this.time += dt;

    const target = this.moving && !this.dead ? 1 : 0;
    this.moveBlend += (target - this.moveBlend) * (1 - Math.exp(-dt * 10));
    if (this.moveBlend < 0.001) this.moveBlend = 0;
    if (this.moving && !this.dead) {
      this.phase += dt * clamp(3.4 + this.speed * 0.85, 3.4, 9);
    }

    if (this.shootT > 0) this.shootT = Math.max(0, this.shootT - dt);
    const kick = this.shootT > 0 ? Math.pow(clamp(this.shootT / SHOOT_TIME, 0, 1), 1.4) : 0;

    const m = this.dead ? 0 : this.moveBlend;
    const swing = Math.sin(this.phase);
    const t = this.time;
    const breathe = Math.sin(t * 1.7) * 0.02 * (1 - m);
    // 走路时躯干上下起伏（一个周期两步）
    const bob = Math.cos(this.phase * 2) * 0.014 * m + Math.sin(t * 1.7) * 0.005 * (1 - m);

    const rig = this.rig;
    setBone(rig.hips, -0.03 * m + (this.dead ? 0.1 : 0), -0.06 * swing * m, 0);
    if (rig.hips) rig.hips.bone.position.y = rig.hips.restY + bob;
    setBone(rig.spine, -0.04 * m - 0.05 * kick, 0.04 * swing * m, 0);
    setBone(rig.spine1, -0.02 * m, 0.05 * swing * m, 0);
    setBone(rig.spine2, breathe - 0.03 * kick, 0.05 * swing * m, 0);
    setBone(rig.head, -breathe * 0.6 + 0.02 * m, -0.05 * swing * m, 0);

    // 腿：正角度向后摆；膝盖只能向后弯，所以永远取正。
    const legSwing = 0.4 * swing * m;
    setBone(rig.upLegL, -legSwing, 0, 0);
    setBone(rig.upLegR, legSwing, 0, 0);
    const kneeL = (0.08 + 0.5 * Math.max(0, -swing)) * m;
    const kneeR = (0.08 + 0.5 * Math.max(0, swing)) * m;
    setBone(rig.legL, kneeL, 0, 0);
    setBone(rig.legR, kneeR, 0, 0);
    // 脚踝回正一半，落地时不至于脚尖一直戳地
    setBone(rig.footL, -0.5 * (kneeL - legSwing), 0, 0);
    setBone(rig.footR, -0.5 * (kneeR + legSwing), 0, 0);

    // 手臂：左臂 +Z 抬高、右臂 -Z 抬高；所以把 A-pose 收回来是左负右正。
    // 右臂常驻举枪姿势（枪口朝前），只有走路的轻微起伏；左臂自由摆动。
    const armIn = 0.3;
    const armSwing = 0.4 * swing * m;
    setBone(rig.armL, armSwing - 0.1 * kick, 0, -armIn);
    setBone(rig.armR, -0.85 + 0.12 * swing * m - 0.3 * kick, 0, armIn + 0.05);
    setBone(rig.foreArmL, -0.16 - 0.24 * Math.max(0, -swing) * m, 0, 0);
    setBone(rig.foreArmR, -0.75 - 0.1 * Math.max(0, swing) * m - 0.35 * kick, 0, 0);

    // 死亡：绕脚底后仰倒地（模型朝 +Z，负角度 = 往后倒）。
    if (this.dead && this.model) {
      this.deadT += dt;
      const k = clamp(this.deadT / DEATH_TIME, 0, 1);
      const ease = 1 - (1 - k) * (1 - k);
      this.model.rotation.x = -1.5 * ease;
      this.model.position.y = 0.16 * ease;
      if (this.plate) this.plate.position.y = PLATE_Y - 1.15 * ease;
    } else if (this.model) {
      this.model.rotation.x = 0;
      this.model.position.y = 0;
      if (this.plate) this.plate.position.y = PLATE_Y;
    }
  }

  play(name) {
    if (!name || this.current === name) return;
    this.current = name;
  }

  setTransform(x, z, yaw, y = 0) {
    const rot = yawToRotation(yaw);
    this.root.position.set(x, y, z);
    this.root.rotation.y = rot;
    this.target = { x, y, z, yaw, rot };
  }

  // 20 Hz 网络状态不要直接 snap：存目标，在 update 里按 ~100ms 平滑过去。
  // 超过 3 米视为传送（重连/换图），直接吸附，避免拖影。
  setTarget(x, z, yaw, y = 0) {
    this.target = { x, y, z, yaw, rot: yawToRotation(yaw) };
  }

  setMoving(moving, speed = 0) {
    this.moving = !!moving;
    this.speed = speed || 0;
    if (this.dead) return;
    this.play(this.moving ? 'run' : 'idle');
  }

  setFiring() {
    if (this.dead || !this.ready) return;
    this.play('shoot');
    this.shootT = SHOOT_TIME;
  }

  setDead() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.play('die');
  }

  update(dt) {
    if (this.target) {
      const p = this.root.position;
      const t = this.target;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      let dYaw = t.rot - this.root.rotation.y;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      if (dist > 3) {
        p.set(t.x, t.y, t.z);
        this.root.rotation.y = t.rot;
      } else if (dist > 0.0005 || Math.abs(t.y - p.y) > 0.0005 || Math.abs(dYaw) > 0.0005) {
        const a = 1 - Math.exp(-dt * 16);
        p.x += (t.x - p.x) * a;
        p.y += (t.y - p.y) * a;
        p.z += (t.z - p.z) * a;
        this.root.rotation.y += dYaw * a;
      }
    }
    this.animate(dt);
    if (this.shootT <= 0 && this.current === 'shoot' && !this.dead) {
      this.play(this.moving ? 'run' : 'idle');
    }
  }

  dispose() {
    this.disposed = true;
    this.clearWeapon();
    this.weaponMount = null;
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
    this.rig = null;
    this.bones = null;
    this.model = null;
    this.weaponReq++;
    if (this.scene) this.scene.remove(this.root);
    this.root.clear();
    this.ready = false;
  }
}
