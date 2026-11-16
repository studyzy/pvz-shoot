import * as THREE from 'three';

/**
 * 第九张地图：深渊花园（abyssal-garden）。
 *
 * 这张图的地形、海带、蝠鲼、光束、后期全都在 WebGPU 里，three.js 这边只剩"游戏物体"
 * （僵尸、武器、拾取物、阳光）。两者没法共享深度缓冲，所以分工是：
 *
 *   iframe（WebGPU 场景，z-index 0）  ←  背景层，永远在最下面
 *   canvas#game（three，z-index 1，清屏 alpha = 0）  ←  游戏物体，画在上面
 *
 * 玩家/僵尸的位置由父页面算，碰撞用场景里那份压缩距离场（CI/CG）：每帧把点丢给
 * iframe 的 pushOutPoints() 推出来，所以岩石是实心的，鱼和海带可以穿过。
 *
 * 相机：父页面每帧写 __ABYSS_CAM（x/y/z/yaw/pitch），iframe 的 frame() 直接读它，
 * 自己不做输入积分也不再自开 rAF —— 由这里调用 step() 驱动，两个渲染器共用一帧。
 */
const VIEW_TAN = 0.6; // 与 abyssal 的 TANH 一致：垂直视角 2·atan(0.6) ≈ 61.9°
export const ABYSS_FOV = (Math.atan(VIEW_TAN) * 2 * 180) / Math.PI;

export class AbyssalGarden {
  constructor(scene) {
    this.scene = scene;
    this.id = 'abyss';
    this.name = '深渊花园';
    this.root = new THREE.Group();
    this.root.name = 'abyssal-garden';
    this.root.visible = false;
    scene.add(this.root);

    // 场景本身是半径 150 米、y ∈ [-52, -1.2] 的圆柱水体。
    this.bounds = { x: 150, z: 150 };
    this.reach = 148;
    this.swim = true;
    // 没有 WebGPU（Safari 老版本 / 关了硬件加速）时 iframe 里只会显示报错页：
    // 这时退回深蓝色的普通渲染，玩家照样能游，只是没有那套海底画面。
    this.gpuOk = typeof navigator !== 'undefined' && !!navigator.gpu;
    this.noShadows = true;     // 场景自带烘焙阴影，three 的 shadow pass 没有意义
    this.cameraFar = 400;
    // 与 abyssal 的 TANH=0.6 对齐，Game.applyStanceFov 会把它钉死。
    this.cameraFov = ABYSS_FOV;
    this.cameraNear = 0.1;
    this.sunDir = new THREE.Vector3(0.08, 1, 0.05).normalize();
    // 出生点：海带林上方，朝北看向沉船方向（POSES[0] 附近，略高于海床）。
    this.spawn = { x: 4, y: -26, z: 64, yaw: 0.35 };
    this.spawnAroundPlayer = true;

    // SDF 负责岩石碰撞，没有圆柱/盒子碰撞体；僵尸也不该被看不见的墙挡住。
    this.colliders = [];
    this.walls = [];
    // 拾取物撒在海床上（高度由 heightAt 采样）。
    this.pickupSpots = [
      [-38, -6], [30, 18], [12, -70], [-64, -58], [70, -30],
      [-20, 92], [96, 66], [-104, 40], [44, -112], [0, 120],
    ];

    // 水下补光：水面上方的冷白 + 深水反射的青蓝。
    this.hemi = new THREE.HemisphereLight(0xbfefff, 0x0a2233, 2.2);
    this.sunLight = new THREE.DirectionalLight(0xd8f6ff, 1.6);
    this.sunLight.position.set(6, 40, 4);
    this.root.add(this.hemi, this.sunLight);

    this.frame = null;
    this.win = null;
    this.ready = false;
    this._wait = 0;
    this._cam = null;
    this._points = new Float32Array(3 * 32);
    this._floor = new Map();
    this._onLoad = null;
    this._lastYaw = 0;
  }

  /** Game.render 用它决定是否透明清屏 + 跳过后期；没有 WebGPU 时走普通管线。 */
  get backdrop() {
    return this.gpuOk;
  }

  /** 30 秒还没喂出第一帧（驱动不支持 / 场景崩了）：退回深蓝兜底，别让玩家对着白屏。 */
  _fallback(reason) {
    if (!this.gpuOk) return;
    console.warn('[abyss] backdrop fallback:', reason);
    this.gpuOk = false;
    this.ready = false;
    this._showFrame(false);
    if (this.scene) {
      this.scene.background = new THREE.Color(0x062433);
      this.scene.fog = new THREE.FogExp2(0x0a3346, 0.02);
    }
  }

  activate(scene) {
    this.root.visible = true;
    // 有 WebGPU：清成透明，露出 iframe 里的场景；没有：深蓝水体兜底（不黑屏）。
    scene.background = this.gpuOk ? null : new THREE.Color(0x062433);
    scene.fog = new THREE.FogExp2(0x0a3346, this.gpuOk ? 0.010 : 0.02);
    if (this.gpuOk) {
      this._ensureFrame();
      this._showFrame(true);
    }
  }

  /** Game.setMap 切走时调用：停掉背景层的渲染，省一张 GPU 的活。 */
  deactivate() {
    this.root.visible = false;
    this._showFrame(false);
  }

  menuCamera(camera, time) {
    const t = time * 0.05;
    camera.position.set(Math.sin(t) * 26, -24 + Math.sin(time * 0.17) * 2.2, 66 + Math.cos(t) * 10);
    camera.lookAt(0, -32, -10);
  }

  attachRenderer(renderer, camera) {
    this._renderer = renderer;
    this._camera = camera;
  }

  // ---------------------------------------------------------------- iframe backdrop
  _ensureFrame() {
    if (this.frame || typeof document === 'undefined') return;
    const app = document.getElementById('app') || document.body;
    const f = document.createElement('iframe');
    // ?seaLv=0/1/2 可强制海底场景的画质档（低配机 / 自动化验收用）。
    const lv = typeof location !== 'undefined' ? (/[?&]seaLv=([0-2])\b/.exec(location.search) || [])[1] : null;
    f.src = new URL('abyssal/index.html?embed=1' + (lv ? '&lv=' + lv : ''), document.baseURI).href;
    f.title = '';
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;z-index:0;'
      + 'pointer-events:none;background:#04141f;display:none;';
    app.insertBefore(f, app.firstChild);
    const canvas = document.querySelector('canvas#game');
    if (canvas) canvas.style.zIndex = '1';
    this.frame = f;
    f.addEventListener('load', () => {
      this.win = f.contentWindow;
      if (this._onLoad) this._onLoad();
    });
  }

  _showFrame(on) {
    if (!this.frame) return;
    this.frame.style.display = on ? 'block' : 'none';
    // 背景层暂停时不 step，它自己的 rAF 在 embed 模式下也不会跑。
    this._paused = !on;
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const camera = this._camera;
    if (!this.gpuOk) return;
    const w = this.win;
    if (!w || !camera || this._paused) return;
    const A = w.__ABYSS;
    if (!A || !A.ready) {
      this._wait += dt;
      if (this._wait > 45) this._fallback('no frame after 45s');
      return;
    }
    if (!this.ready) {
      this.ready = true;
      if (this.onReady) this.onReady();
    }
    if (!this._cam) this._cam = w.__ABYSS_CAM || (w.__ABYSS_CAM = { x: 0, y: -30, z: 60, yaw: 0, pitch: 0 });
    // three 的相机：yaw 正方向向左（右手），abyss 的 yaw 正方向向右 → 取反；pitch 一致。
    this._cam.x = camera.position.x;
    this._cam.y = camera.position.y;
    this._cam.z = camera.position.z;
    this._cam.yaw = -camera.rotation.y;
    this._cam.pitch = camera.rotation.x;
    A.step();
  }

  /** 把一个点推出岩石（返回是否被推过）。z 轴与 three 相同，无需换轴。 */
  resolve(x, y, z, radius = 0.55) {
    const A = this.win && this.win.__ABYSS;
    if (!A || !A.ready) return { x, y, z, hit: false };
    const a = this._points;
    a[0] = x; a[1] = y; a[2] = z;
    A.pushOutPoints(a, 1, radius);
    return { x: a[0], y: a[1], z: a[2], hit: a[0] !== x || a[1] !== y || a[2] !== z };
  }

  /** 批量推出：pts 是 Float32Array(x,y,z…)，原地改写。给僵尸群用，一次跨窗口调用。 */
  resolveMany(pts, n, radius = 0.5) {
    const A = this.win && this.win.__ABYSS;
    if (!A || !A.ready || n <= 0) return;
    A.pushOutPoints(pts, n, radius);
  }

  /** 脚下岩石面的高度（2 米网格缓存，一次 floorY 要几十次距离场采样）。 */
  heightAt(x, z) {
    const A = this.win && this.win.__ABYSS;
    if (!A || !A.ready) return -46;
    const kx = Math.floor(x / 2), kz = Math.floor(z / 2);
    const key = kx + ',' + kz;
    let y = this._floor.get(key);
    if (y === undefined) {
      y = A.floorY(kx * 2 + 1, kz * 2 + 1, -8);
      this._floor.set(key, y);
    }
    return y;
  }

  update2() { /* reserved */ }
}