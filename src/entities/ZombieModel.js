import * as THREE from 'three';
import { PROC_RIG_MODELS } from './Zombie.js';
import { loader, TrackedGLTFLoader, loadingManager, expectReady, estimateBytes } from '../assets/LoadProgress.js';

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

// 僵尸博士（项目内 AIGC 资产 aigc/僵尸博士.fbx，见 docs/ZOMBIE-MODELS.md）：28 骨骼、**0 段动画**。
// 原始高 1.834，按 DOCTOR_SCALE 0.9 → 约 1.65 米归一化高；类型 scale 1.36 后约 2.25 米。
// 没有动画片段，动作由 Zombie.updateProcAnim 程序化摆动骨骼。
export const DOCTOR_SCALE = 0.9;

// 模型定义：id -> { url, scale, height }。Zombie.buildRig 按 def.model 取。
// 新模型一律用 targetHeight：加载后按包围盒算 scale，不用逐个手量原始高，
// 也绕开 aigc 素材普遍带 100 倍 Armature 缩放的坑（见 aigc/README.md）。
export const MODELS = {
  zombie: { url: 'models/zombie.glb', scale: ZOMBIE_SCALE, height: ZOMBIE_HEIGHT },
  skeleton: { url: 'models/skeleton.glb', scale: SKELETON_SCALE, height: 1.95 },
  alchemist: { url: 'models/alchemist.glb', scale: ALCHEMIST_SCALE, height: 1.85 },
  football: { url: 'models/football.glb', scale: FOOTBALL_SCALE, height: 1.84 },
  zombieDoctor: { url: 'models/zombie-doctor.glb', scale: DOCTOR_SCALE, height: 1.65 },

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

  // ── 云上发条游乐园的原创玩具（tools/build-toy-models.mjs 离线生成，见 public/models/toys/PROVENANCE.txt）──
  // 单材质 + 顶点色，成人身高 1.8~3.4 米，动作名对齐 Quaternius。
  toySoldier: { url: 'models/toys/toySoldier.glb', targetHeight: 1.8 },
  springDuck: { url: 'models/toys/springDuck.glb', targetHeight: 1.1 },
  teaSprite: { url: 'models/toys/teaSprite.glb', targetHeight: 1.3 },
  paperGlider: { url: 'models/toys/paperGlider.glb', targetHeight: 0.65 },
  jackBox: { url: 'models/toys/jackBox.glb', targetHeight: 1.6 },
  clockRabbit: { url: 'models/toys/clockRabbit.glb', targetHeight: 3.4 },

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
  // 僵尸博士：源资产没有动画，clips 恒为空，Zombie 会走程序化骨架（PROC_RIG_MODELS）
  zombieDoctor: { ready: false, failed: false, scene: null, clips: [], scale: DOCTOR_SCALE },
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

// 同时在飞的 glb 加载数上限。30 个模型合计约 22 MB，全部并发会把每个请求挤成龟速
// （慢 runner 上单个模型能拖到 60 s 以上），限流后先到的先进、整体更快。
const MAX_CONCURRENT_SLOTS = 6;
const slotQueue = [];
let slotRunning = 0;

// 首屏模型加载完之前，其余模型只排队不下载（见 LOAD_FIRST / releaseRestModels）：
// 首页不该为了第 20 波才出现的巨龙先下 2.8 MB。
let restSlots = [];
let restReleased = false;

function runNextSlot() {
  while (slotRunning < MAX_CONCURRENT_SLOTS && slotQueue.length) {
    const job = slotQueue.shift();
    slotRunning++;
    job(() => {
      slotRunning--;
      runNextSlot();
    });
  }
}

// 加载一个模型进它的槽。新模型在加载完成后算归一化缩放。
function loadSlot(loader, id, mod, onDone) {
  const slot = zombieModel[id];
  slotQueue.push((done) => loadSlotNow(loader, id, mod, onDone, done));
  runNextSlot();
}

// 首屏模型全部落定后，把剩下的模型放行。由 Game 在进度面板显示"首屏就绪"时调用；
// 图鉴/压测页要全部模型，直接 initZombieModel({ all: true })。
export function releaseRestModels() {
  if (restReleased) return;
  restReleased = true;
  for (const job of restSlots) slotQueue.push(job);
  restSlots = [];
  runNextSlot();
}

function loadSlotNow(loader, id, mod, onDone, done) {
  const slot = zombieModel[id];
  loader.load(
    BASE + mod.url,
    (gltf) => {
      const scene = prepare(gltf.scene);
      slot.scale = mod.targetHeight ? fitToHeight(scene, mod.targetHeight) : mod.scale;
      // 归一化过的模型才量包围盒（老四套的命中球口径是手写标定过的，别动）
      if (mod.targetHeight) measureRaw(slot, scene);
      slot.scene = scene;
      // 程序化骨架的模型不能带 clip：带了 Zombie 就会去建 AnimationMixer、不走 updateProcAnim，
      // 结果停在绑定姿势站桩滑动（zombie-doctor.glb 本身也是 0 段动画）
      slot.clips = PROC_RIG_MODELS.has(id) ? [] : (gltf.animations || []);
      slot.ready = true;
      if (onDone) onDone(slot);
      // 必须在 ready 之后才算这一个结束：done 会立刻拉起队里的下一个，
      // 提前调用会让队列空转、图鉴以为「全部加载完」而把后面的类型永久禁用。
      done();
    },
    (ev) => loadingManager.trackProgress(BASE + mod.url, ev),
    (err) => {
      slot.failed = true;
      // 根模型（zombie）的失败同时反映到顶层标志上：老逻辑一直这么判
      if (id === 'zombie') zombieModel.failed = true;
      console.warn(id + ' glb failed', err);
      done();
    }
  );
}

// opts.all：图鉴/压测页要全部模型，跳过"首屏先、其余后"的分批（它们进场就是等全套）。
export function initZombieModel(opts = {}) {
  if (zombieModel.started) return;
  zombieModel.started = true;
  const all = opts.all === true;
  const gltf = new TrackedGLTFLoader(loadingManager);
  // 老模型保持原样（手写 scale，零回归）：zombie 就绪后同步顶层标志
  loadSlot(gltf, 'zombie', MODELS.zombie, (slot) => {
    zombieModel.scene = slot.scene;
    zombieModel.clips = slot.clips;
    zombieModel.ready = true;
  });
  // 老四套 + 僵尸博士（后花园第 10 波用）：手写 scale，加载后不量包围盒
  // 奇幻单位（targetHeight 那批）加载失败只让对应类型刷不出来，不影响主流程
  const others = ['skeleton', 'alchemist', 'football', 'zombieDoctor'];
  for (const [id, mod] of Object.entries(MODELS)) {
    if (mod.targetHeight) others.push(id);
  }
  estimateBytes(all ? 20000000 : 400000);
  for (const id of others) {
    if (all || LOAD_FIRST.includes(id)) loadSlot(gltf, id, MODELS[id]);
    else restSlots.push((done) => loadSlotNow(gltf, id, MODELS[id], undefined, done));
  }
  if (all) return;
  // 首屏必需 = 首屏模型 + 1 个植物包（WeaponModels 在 import 时就会发请求）。
  // 首页只要这几个落定就能开玩，其余模型（第 2 波以后才用）在这之后才放行。
  const need = LOAD_FIRST.length + 1;
  expectReady(need);
  const release = () => {
    if (restReleased) return;
    if (loader.items.length < need) return;
    if (loader.items.slice(0, need).some((it) => !it.done)) return;
    releaseRestModels();
  };
  loader.listeners.add(release);
}

// 首屏就要用的模型：第 1 波只有普通僵尸（alchemist）与路障/铁桶/气球（zombie）。
// 其余模型合计约 20 MB，首页没必要等；它们由 releaseRestModels 在首屏后放行。
export const LOAD_FIRST = ['zombie', 'alchemist'];
