import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

// 外部 glb：Quaternius Zombie_Basic（CC0 1.0），蒙皮网格 + 50 根骨骼。
// 原始高 1.194（Y 向上、面朝 +Z、脚底 y≈0），按 ZOMBIE_SCALE 拉到 1.85 米。
export const ZOMBIE_SCALE = 1.55;
export const ZOMBIE_HEIGHT = 1.85;

// 骷髅（KayKit Character Pack: Skeletons，CC0 1.0）：41 骨骼、13 段动画。
// 原始高 2.166，按 SKELETON_SCALE 拉到约 1.95 米（比普通僵尸略高，当作亡灵精英）。
export const SKELETON_SCALE = 0.9;

// 炼金僵尸（项目内 AIGC 资产，见 docs/ZOMBIE-MODELS.md）：22 骨骼、5 段动画。
// 原始高 1.077（Q 版大头身），按 ALCHEMIST_SCALE 拉到 1.85 米，和普通僵尸同高。
export const ALCHEMIST_SCALE = 1.72;

// 橄榄球僵尸（项目内 AIGC 资产，见 docs/ZOMBIE-MODELS.md）：22 骨骼、5 段动画。
// 原始高 1.938（T-pose），按 FOOTBALL_SCALE 0.95 → 1.84 米；类型 scale 1.12 后约 2.06 米。
export const FOOTBALL_SCALE = 0.95;

// 模型定义：id -> { url, scale, height }。Zombie.buildRig 按 def.model 取。
// 新模型一律用 targetHeight：加载后按包围盒算 scale，不用逐个手量原始高，
// 也绕开 aigc 素材普遍带 100 倍 Armature 缩放的坑（见 aigc/README.md）。
export const MODELS = {
  zombie: { url: 'models/zombie.glb', scale: ZOMBIE_SCALE, height: ZOMBIE_HEIGHT },
  skeleton: { url: 'models/skeleton.glb', scale: SKELETON_SCALE, height: 1.95 },
  alchemist: { url: 'models/alchemist.glb', scale: ALCHEMIST_SCALE, height: 1.85 },
  football: { url: 'models/football.glb', scale: FOOTBALL_SCALE, height: 1.84 },

  // ── 夜之森林的奇幻单位（aigc/monsters，全部 CC0 1.0，见 public/models/LICENSE-cc0.txt）──
  // targetHeight 是该模型**未乘类型 scale 时**的身高；类型自己的 scale 再乘上去。
  goblin: { url: 'models/goblin.glb', targetHeight: 1.55 },
  demon3: { url: 'models/demon-3.glb', targetHeight: 1.6 },
  slime: { url: 'models/slime.glb', targetHeight: 1.05 },
  'pink-slime': { url: 'models/pink-slime.glb', targetHeight: 0.95 },
  'green-blob': { url: 'models/green-blob.glb', targetHeight: 1.3 },
  bones: { url: 'models/bones.glb', targetHeight: 1.9 },
  ghost: { url: 'models/ghost.glb', targetHeight: 1.9 },
  'ghost-skull': { url: 'models/ghost-skull.glb', targetHeight: 1.55 },
  wolf: { url: 'models/wolf.glb', targetHeight: 1.15 },
  spider: { url: 'models/spider.glb', targetHeight: 0.85 },
  rat: { url: 'models/rat.glb', targetHeight: 0.42 },
  bat: { url: 'models/bat.glb', targetHeight: 0.55 },

  // ── BOSS ──
  giant: { url: 'models/giant.glb', targetHeight: 1.85 },
  'mushroom-king': { url: 'models/mushroom-king.glb', targetHeight: 1.85 },
  dragon: { url: 'models/dragon-evolved.glb', targetHeight: 1.85 },
};

// 每个模型一份独立槽：{ ready, failed, scene, clips, scale }
export const zombieModel = {
  started: false,
  ready: false,
  failed: false,
  scene: null,
  clips: [],
  // 骷髅单独一份：只有雪地/Boss 波才会用到，加载完置 ready
  skeleton: { ready: false, failed: false, scene: null, clips: [], scale: SKELETON_SCALE },
  // 炼金模型：普通僵尸在用，加载失败不影响主流程（只是这个类型刷不出来）
  alchemist: { ready: false, failed: false, scene: null, clips: [], scale: ALCHEMIST_SCALE },
  // 橄榄球模型：只给橄榄球僵尸用，加载失败时这个类型会一直留在队列里
  football: { ready: false, failed: false, scene: null, clips: [], scale: FOOTBALL_SCALE },
};

// 新模型（targetHeight 那一批）的槽按需挂上来，与老四套同一套接口。
for (const [id, mod] of Object.entries(MODELS)) {
  if (zombieModel[id]) continue;
  zombieModel[id] = { ready: false, failed: false, scene: null, clips: [], scale: mod.scale || 1, box: null };
}

// 按名字取动画：glb 里可能带 CharacterArmature| 前缀，统一去掉再比
export function findClip(clips, name) {
  if (!clips) return null;
  for (let i = 0; i < clips.length; i++) {
    const n = clips[i].name.replace(/^.*\|/, '').toLowerCase();
    if (n === name) return clips[i];
  }
  return null;
}

function prepare(root) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = false;
    n.frustumCulled = true;
  });
  return root;
}

// 按包围盒把模型归一化到目标身高。aigc 素材的 Armature 普遍带 100 倍缩放，
// 绝对尺寸不可信，必须量出来再算。量完把缩放烘进 scene，之后按正常尺寸用。
export function fitToHeight(scene, targetHeight) {
  const box = new THREE.Box3();
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const h = size.y;
  if (!(h > 1e-6) || !(targetHeight > 0)) return 1;
  const s = targetHeight / h;
  scene.scale.setScalar(s);
  scene.updateMatrixWorld(true);
  // 缩完把脚底贴到 y=0：统一用世界包围盒最低点，Z-up 模型也能落回地面
  const box2 = new THREE.Box3().setFromObject(scene);
  scene.position.y -= box2.min.y;
  return s;
}

// 按包围盒推命中球的模型（巨人）要在加载后量一次尺寸（已归一化、脚底在 0）：
// 写死一组固定高度会让命中球只覆盖模型的一小截（上半身打不掉血）。见 Zombie 的 hitForModel。
function measureRaw(slot, scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  slot.box = { min: box.min, max: box.max, size: box.getSize(new THREE.Vector3()) };
}

// 加载一个模型进它的槽。新模型在加载完成后算归一化缩放。
function loadSlot(loader, id, mod, onDone) {
  const slot = zombieModel[id];
  loader.load(
    BASE + mod.url,
    (gltf) => {
      const scene = prepare(gltf.scene);
      slot.scale = mod.targetHeight ? fitToHeight(scene, mod.targetHeight) : mod.scale;
      // 归一化过的模型才量包围盒（老四套的命中球口径是手写标定过的，别动）
      if (mod.targetHeight) measureRaw(slot, scene);
      slot.scene = scene;
      slot.clips = gltf.animations || [];
      slot.ready = true;
      if (onDone) onDone(slot);
    },
    undefined,
    (err) => {
      slot.failed = true;
      // 根模型（zombie）的失败同时反映到顶层标志上：老逻辑一直这么判
      if (id === 'zombie') zombieModel.failed = true;
      console.warn(id + ' glb failed', err);
    }
  );
}

export function initZombieModel() {
  if (zombieModel.started) return;
  zombieModel.started = true;
  const loader = new GLTFLoader();
  // 老四套保持原样（手写 scale，零回归）
  loadSlot(loader, 'zombie', MODELS.zombie, (slot) => {
    zombieModel.scene = slot.scene;
    zombieModel.clips = slot.clips;
    zombieModel.ready = true;
  });
  for (const id of ['skeleton', 'alchemist', 'football']) {
    loadSlot(loader, id, MODELS[id]);
  }
  // 奇幻单位：加载失败只让对应类型刷不出来，不影响主流程
  for (const [id, mod] of Object.entries(MODELS)) {
    if (!mod.targetHeight) continue;
    loadSlot(loader, id, mod);
  }
}