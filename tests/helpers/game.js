// 在 jsdom 里把整个 Game 跑起来的工具：假渲染器 + 加载真实 glb 模型 + 可控的帧推进。
// 这是所有集成测试的入口，单元测试不依赖它。
import { vi } from 'vitest';
import { mountIndexHtml, installFakeAudio, installPointerLock, installGlobals } from './env.js';

// 假渲染器：WebGLRenderer 在 jsdom 里没有 WebGL 上下文，用最小的 API 面替代。
export function makeFakeRenderer() {
  return {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    compile: vi.fn(),
    setAnimationLoop: vi.fn(),
    getPixelRatio: () => 1,
    getSize: (v) => v.set(1440, 860),
    capabilities: { isWebGL2: true, maxTextureSize: 4096, getMaxAnisotropy: () => 4 },
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false },
    info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    // PMREMGenerator / 材质编译会读这些状态；jsdom 没有 WebGL 上下文，给中性值即可
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getContext: () => ({}),
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    localClippingEnabled: false,
    xr: { enabled: false, isPresenting: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    toneMappingExposure: 1,
    domElement: null,
  };
}

// 按真实 glb 的骨架层级加载模型：和 stubGltfLoader 不同，它保留 Head 骨骼与
// CharacterArmature 的 100 倍缩放 —— 配件挂骨骼时的大小/位置问题只有这种结构才测得出来。
// 注意：骨骼动画是异步的，必须重新 import 一份新的 Game，不能复用 createGame()。
export async function realGltfLoader() {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = Uint8Array.from(__fixture_zombie_glb__);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  GLTFLoader.prototype.__testStubbed = true; // 拦掉 createGame() 里的 stub
  // 解析是异步的：先让出一次事件循环，createGame() 里 "load() 后立刻 initZombieModel 之后" 的
  // 等待循环才等得到 ready。
  GLTFLoader.prototype.load = function (url, onLoad) {
    if (url.includes('/models/weapons/')) return buildStubWeaponScene(url).then((scene) => onLoad({ scene }));
    return new Promise((resolve) => {
      setTimeout(() => {
        new GLTFLoader().parse(ab, '', (g) => { onLoad(g); resolve('real'); }, (e) => { throw e; });
      }, 0);
    });
  };
}

// 真实 glb 的几何/材质/命名结构：Zombie 依赖它做克隆、假骨骼补丁与配件挂载，
// 用简化的替身就不会真正覆盖到这些分支。GLTFLoader 会在贴图阶段走 fetch/createObjectURL，
// 这些资源只影响外观，测试里换成不需要网络的最小加载器（见 stubGltfLoaded）。
export async function stubGltfLoader() {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  if (GLTFLoader.prototype.__testStubbed) return;
  GLTFLoader.prototype.__testStubbed = true;
  GLTFLoader.prototype.load = async function (url, onLoad) {
    const scene = url.includes('/models/weapons/') ? await buildStubWeaponScene(url) : await buildStubZombieScene();
    onLoad({ scene, animations: [], cameras: [], asset: {} });
    return 'stub';
  };
}

async function buildStubWeaponScene(url) {
  const THREE = await import('three');
  const root = new THREE.Group();
  root.name = url.split('/').pop().replace('.glb', '');
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x75ba34 })));
  return root;
}

async function buildStubZombieScene() {
  const THREE = await import('three');
  // 与 public/models/zombie.glb 一致的关键约束：单网格、Z-up（挂 +90° X 旋转）、脚底 y=0、高 1.108。
  const geo = new THREE.BoxGeometry(0.45, 0.62, 1.108);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9ab271, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'zombie_body';
  const node = new THREE.Group();
  node.name = 'zombie_root';
  node.rotation.x = Math.PI / 2;
  node.add(mesh);
  const root = new THREE.Group();
  root.name = 'Scene';
  root.add(node);
  return root;
}

// WebGLRenderer 替身 constructor，用 vi.mock('three') 打进来。
export function makeThreeMock(actual) {
  class FakeWebGLRenderer {
    constructor(opts) {
      Object.assign(this, makeFakeRenderer());
      this.domElement = (opts && opts.canvas) || null;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
}

/**
 * 建一个完整可跑的 Game。
 * @returns {Promise<{game, canvas, pointerLock, audio, raf}>}
 */
export async function createGame(options = {}) {
  mountIndexHtml();
  installGlobals();
  const audio = installFakeAudio();
  const pointerLock = installPointerLock();
  const { Game } = await import('../../src/Game.js');
  await stubGltfLoader();
  const { initZombieModel } = await import('../../src/entities/ZombieModel.js');
  initZombieModel();
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 860;
  document.body.appendChild(canvas);
  const game = new Game(canvas);
  // 让渲染循环里的每一帧都可控：loop() 通过 requestAnimationFrame 续帧，测试里只手动推进。
  return { game, canvas, pointerLock, audio };
}

// 推进 n 帧，每帧固定 dt 秒（Game.update 的语义），不依赖真实时钟。
// 把 Game 造到"可以立刻 spawnZombieAt"的状态。
// zombieModel 的就绪回调走的是 Promise 微任务队列；测试里有 fake timers 或超时打断时，
// 直接 createGame() 再 spawn 可能拿到 zombieModel.scene === null。用 readyGame() 保证就绪。
export async function readyGame() {
  const booted = await createGame();
  const { zombieModel } = await import('../../src/entities/ZombieModel.js');
  // 多个 glb 是先后多次 load，骷髅（Boss 用）/ 橄榄球通常比僵尸晚一个宏任务就绪，
  // 只等 ready 会让对应类型撞上"模型没就绪所以不刷怪"。
  const ready = () => zombieModel.ready && zombieModel.skeleton.ready && zombieModel.football.ready;
  for (let i = 0; i < 40 && !ready(); i++) await new Promise((r) => setTimeout(r, 0));
  return booted;
}

export function step(game, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) game.update(dt);
}

// 带地图更新的推进：等于 Game.loop 在 playing 状态做的事，但不渲染。
export function stepWithMap(game, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    game.update(dt);
    game.map.update(dt);
  }
}

// 把僵尸刷到指定位置并等它播完出生动画（spawnT < 0.5 的僵尸不吃伤害、也不被辅助瞄准）。
export function spawnZombieAt(game, type, x, z, opts = {}) {
  const zm = game.zombies;
  zm.queue = [type];
  if (opts.hpMul !== undefined) zm.hpMul = opts.hpMul;
  if (opts.speedMul !== undefined) zm.speedMul = opts.speedMul;
  zm.state = 'spawning';
  zm.spawnTimer = 0;
  zm.maxAlive = 14;
  zm.interval = 0.5;
  const zombie = zm.spawnOne(game.player);
  zombie.root.position.set(x, 0, z);
  zombie.spawnT = 1;
  zombie.model.position.y = 0;
  return zombie;
}

// 让玩家看向世界坐标点（yaw/pitch），用于射击类测试。
export async function aimAt(game, x, y, z) {
  const THREE = await import('three');
  const p = game.player;
  const eye = new THREE.Vector3(p.pos.x, p.pos.y + 1.66, p.pos.z);
  const d = new THREE.Vector3(x, y, z).sub(eye);
  p.yaw = Math.atan2(-d.x, -d.z);
  p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  p.recoil = 0;
  p.applyCamera(game.camera);
  return game.camera;
}

// 让当前武器立刻可开火（清冷却、给定阳光）。
export function readyToFire(game, sun = 999) {
  game.sun = sun;
  game.weapons.cooldown = 0;
  game.weapons.recoil = 0;
  game.player.recoil = 0;
}

export { THREE };