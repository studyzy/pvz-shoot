import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { initZombieModel, zombieModel } from '../entities/ZombieModel.js';
import { Zombie } from '../entities/Zombie.js';
import { outdoorEnvironment } from '../world/materials.js';
import { GALLERY_TYPES, typeInfo, walkTimeScale } from '../gallery/presets.js';
import {
  FrameStats,
  RAMP,
  RAMP_STEPS,
  fitCamera,
  gridLayout,
  nextRampStep,
  shortNumber,
  verdictFor,
} from './metrics.js';
import './stress.css';

// 独立压测页：只负责“把 N 只僵尸摆在你面前”，渲染设置刻意和游戏一致
// （antialias / PCFSoft 阴影 / DPR 上限 2 / NeutralToneMapping / PMREM 环境贴图），
// 但**不启用**游戏的自动降分辨率 —— 否则读数会被悄悄抹平，测不出真实拐点。

const MAX_COUNT = 64;
const SPACING = 1.55;
const SPAWN_PER_FRAME = 4;
const MIX_ID = 'mix';
const QUICK_COUNTS = [4, 8, 14, 20, 32, 48];
const CAMERA_DIR = new THREE.Vector3(0.14, 0.62, 0.77).normalize();

const $ = (id) => document.getElementById(id);
const canvas = $('stressCanvas');
const typeChips = $('typeChips');
const countRange = $('countRange');
const countValue = $('countValue');
const quickBtns = $('quickBtns');
const shadowToggle = $('shadowToggle');
const animToggle = $('animToggle');
const dprToggle = $('dprToggle');
const rampBtn = $('rampBtn');
const rampResult = $('rampResult');
const fpsValue = $('fpsValue');
const verdictEl = $('verdict');
const frameLine = $('frameLine');
const renderLine = $('renderLine');
const memoryLine = $('memoryLine');
const sceneLine = $('sceneLine');
const deviceLine = $('deviceLine');
const loading = $('loading');
const errorBox = $('error');

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let keyLight = null;
let envMap = null;
let lastLayout = { width: 1, depth: 1 };
let lastAspect = 1;
let lastNow = 0;
let hudAt = 0;
let countTimer = 0;

const zombies = [];
const stats = new FrameStats(90);
const state = {
  type: 'normal',
  count: 8,
  shadows: true,
  anim: true,
  highDpr: true,
  queue: [],
  settleAt: 0,
  ramp: null,
};

const ctx = {
  scene: null,
  map: null,
  env: null,
  particles: { burst() {} },
  sfx: {},
};

function modelSlot(id) {
  if (id === 'zombie') return zombieModel;
  return zombieModel[id] || { ready: false, failed: true };
}

function isModelReady(id) {
  const slot = modelSlot(id);
  return !!(slot && slot.ready);
}

function availableTypes() {
  return GALLERY_TYPES.filter((t) => isModelReady(typeInfo(t.id).modelId)).map((t) => t.id);
}

function typeLabel(id) {
  if (id === MIX_ID) return '混合';
  const meta = GALLERY_TYPES.find((t) => t.id === id);
  return meta ? meta.name : id;
}

function showError(message) {
  loading.classList.add('hidden');
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function maxDpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

// ---------------------------------------------------------------- 场景

function setupScene() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  // 和 Game.js 同一套：DPR 上限 2、NeutralToneMapping、PCFSoft 1024 阴影
  renderer.setPixelRatio(maxDpr());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d180a);
  scene.fog = new THREE.Fog(0x0d180a, 34, 110);
  envMap = outdoorEnvironment(renderer, 'backyard');
  scene.environment = envMap;

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 260);

  const hemi = new THREE.HemisphereLight(0xdceeff, 0x263716, 1.45);
  scene.add(hemi);

  keyLight = new THREE.DirectionalLight(0xfff2d8, 2.4);
  keyLight.position.set(14, 26, 18);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 160;
  keyLight.shadow.bias = -0.0006;
  keyLight.target.position.set(0, 0, 0);
  scene.add(keyLight);
  scene.add(keyLight.target);

  const rim = new THREE.DirectionalLight(0x9be564, 0.9);
  rim.position.set(-16, 10, -18);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x2c4420, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(160, 160, 0x51703f, 0x3a5230);
  grid.material.transparent = true;
  grid.material.opacity = 0.32;
  grid.position.y = 0.012;
  scene.add(grid);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;

  ctx.scene = scene;
  ctx.env = envMap;
  renderLine.title = 'draw call / 三角面只统计主渲染通道，阴影 pass 另算';

  updateShadowFrustum({ width: 10, depth: 10 });
}

function updateShadowFrustum(layout) {
  if (!keyLight) return;
  const half = Math.max(9, Math.max(layout.width, layout.depth) / 2 + 4);
  const cam = keyLight.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.far = half * 6;
  // 改完正交阴影相机必须重新算投影矩阵，否则阴影会消失（项目里踩过这个坑）
  cam.updateProjectionMatrix();
  keyLight.position.set(half * 0.55, half * 1.45, half * 0.75);
  keyLight.target.position.set(0, 0, 0);
  keyLight.target.updateMatrixWorld();
}

function fitView(layout) {
  if (!camera || !controls) return;
  lastLayout = layout;
  lastAspect = camera.aspect;
  const info = fitCamera({
    width: layout.width,
    depth: layout.depth,
    height: 2.2,
    fov: camera.fov,
    aspect: camera.aspect,
    elevation: Math.asin(CAMERA_DIR.y),
  });
  controls.target.set(0, info.targetY, 0);
  camera.position.copy(CAMERA_DIR).multiplyScalar(info.distance).add(controls.target);
  controls.minDistance = Math.max(1.5, info.distance * 0.25);
  controls.maxDistance = Math.max(6, info.distance * 3);
  controls.update();
}

// ---------------------------------------------------------------- 僵尸生成

function clearZombies() {
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    // 配件与 blob 影子是每只新生成的几何体；身体几何体在所有僵尸间共享，绝对不能 dispose
    for (const group of [z.hat, z.balloon]) {
      if (!group) continue;
      group.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
      });
    }
    if (z.shadow && z.shadow.geometry) z.shadow.geometry.dispose();
    z.dispose();
  }
  zombies.length = 0;
}

function spawnOne(item, index) {
  const z = new Zombie(item.type, 1, item.x, item.z, ctx, 1, 1);
  z.spawnT = 1; // 跳过入场的钻地动画，第一帧就是站姿
  z.model.position.y = 0;
  z.baseTint.setHex(0xffffff);
  z.applyTint(0);
  z.root.position.set(item.x, z.airHeight, item.z);
  z.root.rotation.y = 0; // 统一面向镜头，方便逐只对比
  z.play('walk', 0);
  if (z.mixer) {
    z.mixer.timeScale = walkTimeScale(z.speed);
    z.mixer.update((index % 9) * 0.19); // 错开步态相位
  }
  // 图鉴/压测页都不跑 Zombie.update，锥帽/铁桶的落点要在这里补一次
  if (z.hat) z.mountHeadTop();
  return z;
}

function pickTypes(n) {
  if (state.type !== MIX_ID) return new Array(n).fill(state.type);
  const pool = availableTypes();
  const safe = pool.length ? pool : ['normal'];
  return Array.from({ length: n }, (_, i) => safe[i % safe.length]);
}

function rebuild() {
  clearZombies();
  const layout = gridLayout(state.count, SPACING);
  const types = pickTypes(state.count);
  state.queue = layout.positions.map((p, i) => ({ type: types[i], x: p.x, z: p.z }));
  state.settleAt = 0;
  stats.reset();
  if (layout.positions.length) {
    updateShadowFrustum(layout);
    fitView(layout);
  }
  updateSceneLine();
}

function pumpQueue(now) {
  const batch = Math.min(SPAWN_PER_FRAME, state.queue.length);
  for (let i = 0; i < batch; i++) {
    const item = state.queue.shift();
    zombies.push(spawnOne(item, zombies.length));
  }
  if (!state.queue.length) {
    // 留 350ms 给贴图上传 / 首帧 shader 编译，别把初始化开销记进稳态帧率
    state.settleAt = now + 350;
    updateSceneLine();
  }
}

// ---------------------------------------------------------------- 交互

function applyCount(n, force = false) {
  const next = Math.max(0, Math.min(MAX_COUNT, Math.floor(Number(n) || 0)));
  const changed = next !== state.count;
  state.count = next;
  countValue.textContent = String(next);
  countRange.value = String(next);
  if (!changed && !force) return;
  rebuild();
}

function setType(id, force = false) {
  if (id !== MIX_ID && !availableTypes().includes(id)) return; // 模型没加载好的类型不切
  if (!force && id === state.type) return;
  state.type = id;
  updateChips();
  rebuild();
}

function setShadows(on) {
  state.shadows = on;
  shadowToggle.checked = on;
  if (keyLight) keyLight.castShadow = on;
  renderer.shadowMap.needsUpdate = true;
  updateSceneLine();
}

function setAnim(on) {
  state.anim = on;
  animToggle.checked = on;
  updateSceneLine();
}

function setHighDpr(on) {
  state.highDpr = on;
  dprToggle.checked = on;
  renderer.setPixelRatio(on ? maxDpr() : 1);
  resize();
}

function updateChips() {
  for (const btn of typeChips.querySelectorAll('[data-type]')) {
    const on = btn.dataset.type === state.type;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function buildTypeChips() {
  typeChips.innerHTML = '';
  const all = [{ id: MIX_ID, name: '混合' }].concat(GALLERY_TYPES.map((t) => ({ id: t.id, name: t.name })));
  const readyIds = availableTypes();
  for (const meta of all) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'type-chip';
    btn.dataset.type = meta.id;
    const usable = meta.id === MIX_ID ? readyIds.length > 0 : readyIds.includes(meta.id);
    btn.disabled = !usable;
    btn.title = usable ? meta.name : '模型未加载';
    btn.textContent = meta.name;
    btn.addEventListener('click', () => {
      cancelRamp();
      setType(meta.id);
    });
    typeChips.appendChild(btn);
  }
  updateChips();
}

function buildQuickButtons() {
  quickBtns.innerHTML = '';
  for (const n of QUICK_COUNTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-btn';
    btn.textContent = String(n);
    btn.addEventListener('click', () => {
      cancelRamp();
      applyCount(n);
    });
    quickBtns.appendChild(btn);
  }
}

function shortLabel(id) {
  return typeLabel(id).replace(/僵尸$/, '');
}

function updateSceneLine() {
  const building = state.queue.length ? ' · 生成中' : '';
  sceneLine.innerHTML =
    zombies.length + ' 只 · ' + shortLabel(state.type) +
    ' · <span class="tag' + (state.shadows ? '' : ' off') + '">阴影</span>' +
    ' <span class="tag' + (state.anim ? '' : ' off') + '">动画</span>' + building;
}

// ---------------------------------------------------------------- 自动测极限

function startRamp() {
  const first = RAMP_STEPS[0];
  state.ramp = { phase: 'spawn', at: 0, best: null, fail: null };
  rampResult.classList.add('hidden');
  rampBtn.textContent = '停止测试';
  rampBtn.classList.add('running');
  applyCount(first, true);
}

function cancelRamp() {
  if (!state.ramp) return;
  state.ramp = null;
  rampBtn.textContent = '自动测极限';
  rampBtn.classList.remove('running');
}

function finishRamp(hitMax) {
  const ramp = state.ramp;
  if (!ramp) return;
  state.ramp = null;
  rampBtn.textContent = '自动测极限';
  rampBtn.classList.remove('running');

  const best = ramp.best;
  const fail = ramp.fail;
  let text;
  if (!best && fail) {
    text = '第一档 ' + fail.count + ' 只就只有 ' + Math.round(fail.fps) + ' fps，这台设备基本带不动';
  } else if (hitMax && best) {
    text = best.count + ' 只仍有 ' + Math.round(best.fps) + ' fps，没压到极限（档位已到顶）';
  } else if (best && fail) {
    text = Math.round(best.fps) + ' fps 撑到 ' + best.count + ' 只；加到 ' + fail.count + ' 只掉到 ' + Math.round(fail.fps) + ' fps';
  } else {
    text = '测试中断';
  }
  rampResult.textContent = text;
  rampResult.classList.remove('hidden');
}

function tickRamp(now) {
  const ramp = state.ramp;
  if (!ramp) return;
  if (ramp.phase === 'warmup') {
    if (now - ramp.at >= RAMP.warmupMs) {
      ramp.phase = 'measure';
      ramp.at = now;
      stats.reset();
    }
    return;
  }
  if (ramp.phase !== 'measure') return;
  if (now - ramp.at < RAMP.measureMs) return;

  const fps = stats.fps;
  if (fps >= RAMP.failFps) {
    ramp.best = { count: state.count, fps };
    const next = nextRampStep(state.count);
    if (next === null) {
      finishRamp(true);
      return;
    }
    ramp.phase = 'spawn';
    ramp.at = 0;
    applyCount(next, true);
  } else {
    ramp.fail = { count: state.count, fps };
    finishRamp(false);
  }
}

// ---------------------------------------------------------------- HUD

function updateHud(now) {
  const s = stats.summary();
  const measuring = s.frames >= 4;
  fpsValue.textContent = measuring ? String(Math.round(s.fps)) : '--';
  const v = verdictFor(s.fps);
  verdictEl.textContent = measuring ? v.label : '待测';
  verdictEl.dataset.tone = measuring ? v.id : 'idle';

  frameLine.textContent = measuring
    ? '帧时间 ' + s.avgMs.toFixed(1) + 'ms · P95 ' + s.p95Ms.toFixed(1) + 'ms'
    : '帧时间 --';

  const info = renderer.info;
  renderLine.textContent =
    'draw ' + info.render.calls + ' · 三角面 ' + shortNumber(info.render.triangles);
  memoryLine.textContent = '几何 ' + info.memory.geometries + ' · 贴图 ' + info.memory.textures;

  const w = Math.round(canvas.clientWidth);
  const h = Math.round(canvas.clientHeight);
  const dpr = renderer.getPixelRatio();
  deviceLine.textContent = 'DPR ' + dpr.toFixed(2) + ' · ' + w + '×' + h;
  deviceLine.title = '屏幕像素比 ' + (window.devicePixelRatio || 1).toFixed(2) + '×，渲染像素比已按游戏口径封顶 2×';

  updateSceneLine();
  hudAt = now;
}

// ---------------------------------------------------------------- 循环

function resize() {
  if (!renderer || !camera) return;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 只有横竖屏比例明显变化时才重新取景，避免滚动地址栏把用户调好的视角顶回去
  if (Math.abs(camera.aspect - lastAspect) / Math.max(0.001, lastAspect) > 0.15) {
    lastAspect = camera.aspect;
    fitView(lastLayout);
  }
}

function loop(now) {
  const raw = (now - lastNow) / 1000;
  lastNow = now;
  const dt = Math.min(Math.max(raw, 0), 0.05);

  if (state.queue.length) {
    pumpQueue(now);
  } else if (state.settleAt && now >= state.settleAt) {
    state.settleAt = 0;
    stats.reset();
    if (state.ramp && state.ramp.phase === 'spawn') {
      state.ramp.phase = 'warmup';
      state.ramp.at = now;
    }
  }

  if (state.anim) {
    for (let i = 0; i < zombies.length; i++) {
      const mixer = zombies[i].mixer;
      if (mixer) mixer.update(dt);
    }
  }

  controls.update();
  renderer.render(scene, camera);

  // 生成期间与 settle 期间的帧不采样：那是初始化开销，不是稳态渲染成本
  if (!state.queue.length && !state.settleAt) stats.push(Math.min(raw, 1));
  if (now - hudAt > 180) updateHud(now);

  tickRamp(now);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- 启动

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForModels() {
  const started = performance.now();
  while (performance.now() - started < 30000) {
    const settled = ['zombie', 'skeleton', 'alchemist', 'football'].every((id) => {
      const slot = modelSlot(id);
      return slot.ready || slot.failed;
    });
    if (settled) break;
    await sleep(100);
  }
}

function bindControls() {
  countRange.addEventListener('input', () => {
    countValue.textContent = countRange.value;
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      cancelRamp();
      applyCount(Number(countRange.value));
    }, 140);
  });
  countRange.addEventListener('change', () => {
    clearTimeout(countTimer);
    cancelRamp();
    applyCount(Number(countRange.value));
  });
  shadowToggle.addEventListener('change', () => {
    setShadows(shadowToggle.checked);
    updateSceneLine();
  });
  animToggle.addEventListener('change', () => {
    setAnim(animToggle.checked);
  });
  dprToggle.addEventListener('change', () => {
    setHighDpr(dprToggle.checked);
  });
  rampBtn.addEventListener('click', () => {
    if (state.ramp) cancelRamp();
    else startRamp();
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stats.reset();
  });
}

async function boot() {
  try {
    setupScene();
  } catch (err) {
    showError('无法启动 3D 场景：浏览器不支持 WebGL');
    return;
  }

  resize();
  bindControls();
  buildQuickButtons();

  window.__stress = {
    ready: false,
    // 类型清单（来自 GALLERY_TYPES）：E2E 用它核对 chips 数量，新增僵尸类型不用改测试
    types: GALLERY_TYPES,
    renderer,
    scene,
    camera,
    controls,
    zombies,
    get stats() {
      return stats.summary();
    },
    get state() {
      return {
        type: state.type,
        count: state.count,
        shadows: state.shadows,
        anim: state.anim,
        highDpr: state.highDpr,
        ramp: state.ramp ? { phase: state.ramp.phase, best: state.ramp.best, fail: state.ramp.fail } : null,
      };
    },
    setType: (id) => {
      cancelRamp();
      setType(id, true);
    },
    setCount: (n) => {
      cancelRamp();
      applyCount(n, true);
    },
    setShadows,
    setAnim,
    setHighDpr,
    startRamp,
    stopRamp: cancelRamp,
    modelReady: isModelReady,
    zombieModel,
  };

  initZombieModel();
  await waitForModels();

  buildTypeChips();
  const types = availableTypes();
  if (!types.length) {
    showError('僵尸模型加载失败，请刷新重试');
    return;
  }

  state.type = types.includes('normal') ? 'normal' : types[0];
  updateChips();
  applyCount(state.count, true);

  loading.classList.add('hidden');
  window.__stress.ready = true;

  lastNow = performance.now();
  hudAt = lastNow;
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  showError('压测页加载失败：' + (err && err.message ? err.message : '未知错误'));
});
