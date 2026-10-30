import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { initZombieModel, zombieModel } from '../entities/ZombieModel.js';
import { Zombie } from '../entities/Zombie.js';
import {
  GALLERY_TYPES,
  ANGLE_PRESETS,
  typeInfo,
  anglePosition,
  walkTimeScale,
  statLines,
} from './presets.js';
import './gallery.css';

const canvas = document.getElementById('galleryCanvas');
const typeList = document.getElementById('typeList');
const infoPanel = document.getElementById('infoPanel');
const angleBar = document.getElementById('angleBar');
const loading = document.getElementById('loading');
const errorBox = document.getElementById('error');

const MODEL_SLOTS = ['zombie', 'skeleton', 'alchemist', 'football'];
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let current = null;
let activeAngle = 'threeQuarter';
let modelEnv = null;

function modelSlot(id) {
  if (id === 'zombie') return zombieModel;
  return zombieModel[id] || { ready: false, failed: true };
}

function isModelReady(id) {
  const slot = modelSlot(id);
  return !!(slot && slot.ready);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showError(message) {
  loading.classList.add('hidden');
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function makeGroundTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, '#2b4220');
  grad.addColorStop(0.55, '#172610');
  grad.addColorStop(1, '#0a1206');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function setupScene() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x081006, 11, 25);

  const pmrem = new THREE.PMREMGenerator(renderer);
  modelEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = modelEnv;

  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);

  const hemi = new THREE.HemisphereLight(0xdceeff, 0x263716, 1.7);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2d8, 2.7);
  key.position.set(4.5, 8, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0006;
  key.target.position.set(0, 2, 0);
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0x9be564, 1.15);
  rim.position.set(-5, 3.5, -6);
  scene.add(rim);

  const fill = new THREE.PointLight(0xffd27a, 1.1, 22, 2);
  fill.position.set(0, 3.2, 3.5);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(12, 96),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.94, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x9be564,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.42, 72), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  scene.add(ring);

  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(2.9, 2.94, 72),
    new THREE.MeshBasicMaterial({
      color: 0x9be564,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.005;
  scene.add(outerRing);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI * 0.54;
  controls.addEventListener('start', () => {
    activeAngle = null;
    updateAngleButtons();
  });
}

function setCameraFor(info, angleId) {
  if (!camera || !controls) return;
  // 竖屏时水平视野很窄，3/4 机位容易把肩膀裁掉；按宽高比把相机往后拉一点。
  const aspect = camera.aspect || 1;
  const fit = aspect < 0.9 ? Math.min(1.55, 1 / Math.max(0.65, aspect)) : 1;
  const distance = info.distance * fit;
  const p = anglePosition(angleId || 'threeQuarter', distance, info.focusY);
  controls.target.set(0, info.focusY, 0);
  camera.position.set(p.x, p.y, p.z);
  controls.minDistance = Math.max(1.1, distance * 0.5);
  controls.maxDistance = Math.max(4, distance * 2.6);
  controls.update();
}

function updateAngleButtons() {
  for (const btn of angleBar.querySelectorAll('[data-angle]')) {
    const on = btn.dataset.angle === activeAngle;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function setAngle(id) {
  if (!current) return;
  activeAngle = id;
  setCameraFor(current.info, id);
  updateAngleButtons();
}

function buildAngleBar() {
  angleBar.innerHTML = '';
  for (const angle of ANGLE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'angle-btn';
    btn.dataset.angle = angle.id;
    btn.textContent = angle.label;
    btn.addEventListener('click', () => setAngle(angle.id));
    angleBar.appendChild(btn);
  }
  updateAngleButtons();
}

function updateActiveButton() {
  for (const btn of typeList.querySelectorAll('[data-type]')) {
    const on = current && btn.dataset.type === current.type;
    btn.classList.toggle('active', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function updateInfo() {
  const info = current.info;
  const stats = statLines(info.id)
    .map((s) => '<div class="stat"><em>' + s.label + '</em><b>' + s.value + '</b></div>')
    .join('');
  infoPanel.innerHTML =
    '<div class="info-kicker">' + info.subtitle + '</div>' +
    '<h2>' + info.name + '</h2>' +
    '<p>' + info.desc + '</p>' +
    '<div class="stat-grid">' + stats + '</div>' +
    '<div class="model-row"><span>模型 <b>' + info.modelFile + '</b></span><span>动画 <b>Walk</b>（循环）</span></div>';
}

function firstBone(root) {
  let out = null;
  root.traverse((n) => {
    if (!out && n.isBone) out = n;
  });
  return out;
}

function disposeCurrent() {
  if (!current) return;
  const z = current.zombie;
  // 配件几何体是每只新生成的；模型本体几何体是共享的，不能 dispose。
  for (const group of [z.hat, z.balloon]) {
    if (group) {
      group.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
      });
    }
  }
  if (z.shadow && z.shadow.geometry) z.shadow.geometry.dispose();
  z.dispose();
  current = null;
  window.__gallery.current = null;
}

function selectType(type) {
  const info = typeInfo(type);
  if (!isModelReady(info.modelId)) return;

  disposeCurrent();

  const ctx = {
    scene,
    map: null,
    env: modelEnv,
    particles: { burst() {} },
    sfx: {},
  };
  const z = new Zombie(type, 1, 0, 0, ctx, 1, 1);
  z.spawnT = 1;
  z.model.position.y = 0;
  z.baseTint.setHex(0xffffff);
  z.applyTint(0);
  z.shadow.visible = false;
  z.root.position.set(0, z.airHeight, 0);
  z.root.rotation.y = 0;
  z.play('walk', 0);
  z.mixer.timeScale = walkTimeScale(z.speed);
  z.mixer.update(0);
  // 锥帽/铁桶的落点要等 root 进场景后才能量（见 Zombie.mountHeadTop）；图鉴不跑 update，这里补一次。
  if (z.hat) z.mountHeadTop();

  // Quaternius 的 Walk 带根位移；图鉴里把它按第 0 帧钉住，只保留四肢/躯干的走路动画。
  const rootBone = info.modelId === 'zombie' ? firstBone(z.body) : null;
  current = {
    type,
    zombie: z,
    info,
    rootBone,
    rootPos: rootBone ? rootBone.position.clone() : null,
    rootQuat: rootBone ? rootBone.quaternion.clone() : null,
  };
  window.__gallery.current = current;
  activeAngle = 'threeQuarter';
  setCameraFor(info, activeAngle);
  updateAngleButtons();
  updateActiveButton();
  updateInfo();
}

function buildTypeList() {
  typeList.innerHTML = '';
  for (const meta of GALLERY_TYPES) {
    const info = typeInfo(meta.id);
    const ready = isModelReady(info.modelId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'type-btn';
    btn.dataset.type = meta.id;
    btn.disabled = !ready;
    btn.title = ready ? '查看 ' + meta.name : '模型未加载';
    btn.innerHTML =
      '<span class="type-name">' + meta.name + '</span>' +
      '<span class="type-sub">' + (ready ? meta.subtitle : '模型未加载') + '</span>';
    btn.addEventListener('click', () => selectType(meta.id));
    typeList.appendChild(btn);
  }
  updateActiveButton();
}

async function waitForModels() {
  const started = performance.now();
  while (performance.now() - started < 30000) {
    const settled = MODEL_SLOTS.every((id) => isModelReady(id) || modelSlot(id).failed);
    if (settled) break;
    await sleep(100);
  }
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  if (current) setCameraFor(current.info, activeAngle || 'threeQuarter');
}

function animate() {
  const clock = new THREE.Clock();
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (current) {
      if (current.zombie.mixer) current.zombie.mixer.update(dt);
      if (current.rootBone && current.rootPos) {
        current.rootBone.position.copy(current.rootPos);
        current.rootBone.quaternion.copy(current.rootQuat);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
}

async function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    showError('无法启动 3D 预览：浏览器不支持 WebGL');
    return;
  }

  setupScene();
  onResize();
  window.addEventListener('resize', onResize);
  buildAngleBar();

  window.__gallery = {
    ready: false,
    current: null,
    types: GALLERY_TYPES,
    camera,
    scene,
    renderer,
    controls,
    selectType,
    setAngle,
    modelReady: isModelReady,
    zombieModel,
  };

  initZombieModel();
  await waitForModels();

  buildTypeList();
  const first = GALLERY_TYPES.find((meta) => isModelReady(typeInfo(meta.id).modelId));
  if (!first) {
    showError('僵尸模型加载失败，请刷新重试');
    return;
  }

  selectType(first.id);
  loading.classList.add('hidden');
  window.__gallery.ready = true;
  animate();
}

boot().catch((err) => {
  console.error(err);
  showError('图鉴加载失败：' + (err && err.message ? err.message : '未知错误'));
});
