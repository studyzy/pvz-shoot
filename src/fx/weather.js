import * as THREE from 'three';

// 天气粒子（docs/plans/2026-11-12-render-overhaul.md §3.4）。
//
// 雪地是唯一有氛围缺口的图：地面是白的、天是蓝的，但「没有天气」——
// 静态画面，风都不吹。这里给雪地加飘雪、给森林加萤火、给云园加飘絮。
//
// 关键约束：**CPU 零开销**。
// 位置完全在顶点着色器里算（用一个 per-instance 的随机种子 + 时间取模下落），
// JS 侧每帧只更新一个 uTime 标量。所以 4000 个雪粒也只是 1 个 draw call、
// 一段 UBO 上传，不是 4000 次矩阵运算。
//
// 另一个关键约束：**粒子必须绕相机铺开**。
// 如果固定在世界坐标，玩家走 20 米就走出雪区了。做法是模运算把粒子卷回相机周围
// 的盒子里（wrap around camera），这样不管走到哪都在下雪。

const VERT = `
precision highp float;

attribute vec3 aSeed;   // 每颗粒子的随机种子（xyz 各分量独立用）

uniform float uTime;
uniform vec3  uCam;     // 相机位置：粒子绕它铺开
uniform vec3  uBox;     // 盒子半尺寸（xyz）
uniform float uSpeed;   // 下落速度
uniform float uDrift;   // 水平漂移幅度
uniform float uSize;    // 粒子尺寸（世界单位）
uniform float uScale;   // 屏幕缩放（由渲染器高度决定，让近大远小）
uniform float uOpacity;

varying float vAlpha;

void main() {
  // ---- 基础位置：种子铺满盒子 ----
  vec3 p = aSeed * uBox * 2.0 - uBox;

  // ---- 下落：按时间取模，卷回盒顶 ----
  // 每颗速度带一点随机（0.7~1.3），不然整片雪像一块板一起掉
  float spd = uSpeed * (0.7 + aSeed.x * 0.6);
  p.y -= mod(uTime * spd + aSeed.y * uBox.y * 2.0, uBox.y * 2.0);
  // 取模后 y 落在 [0, 2*box.y)，平移回 [-box.y, box.y)
  p.y += uBox.y;

  // ---- 水平漂移：正弦 + 种子相位 ----
  float t = uTime * 0.6 + aSeed.z * 6.283;
  p.x += sin(t) * uDrift;
  p.z += cos(t * 0.83 + 1.7) * uDrift;

  // ---- 绕相机卷回：把世界坐标折进相机周围的盒子 ----
  // 这一步是「走到哪都下雪」的关键。mod 两次是为了处理负数。
  vec3 rel = p - uCam;
  rel = mod(rel + uBox, uBox * 2.0) - uBox;
  p = uCam + rel;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // ---- 近大远小 + 边缘淡出 ----
  // 距离越远粒子越小越淡：靠这个让「盒子边界」看不出来
  float dist = length(rel);
  float fade = 1.0 - smoothstep(uBox.x * 0.62, uBox.x, dist);
  vAlpha = fade * uOpacity;

  float size = uSize * uScale * 0.01;
  gl_PointSize = max(1.5, size / max(0.001, -mv.z));
}
`;

const FRAG = `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;

void main() {
  // 圆形柔边点：距离中心超过 0.5 就透明
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.02, r) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

// 每张图的天气配方。没有天气的图不建对象（避免白花一个 draw call）。
//
// size 是「10 米外的屏幕像素数」，不是世界单位：
//   gl_PointSize = size * uScale / dist / 100，因为 shader 里已经有 /(-mv.z)。
// 原来把 size 当世界尺寸用（26），在 10 米外只有 1.6px，被 max(1.0, ...) 夹住，
// 于是整片雪变成一堆看不见的 1 像素点（实测：完全看不到雪）。
export const WEATHER_PRESETS = {
  snow: {
    kind: 'snow',
    count: 2600,
    box: [22, 14, 22],
    speed: 2.6,
    drift: 0.9,
    size: 26,
    opacity: 0.85,
    color: 0xffffff,
  },
  forest: {
    kind: 'firefly',
    count: 180,
    box: [24, 6, 24],
    // 萤火是「往上飘 + 忽明忽暗」，速度给负值让 shader 里方向反一下
    speed: -0.22,
    drift: 1.6,
    size: 34,
    opacity: 0.75,
    color: 0xa8ff9a,
  },
  cloud: {
    kind: 'pollen',
    count: 420,
    box: [26, 10, 26],
    speed: 0.5,
    drift: 2.2,
    size: 22,
    opacity: 0.4,
    color: 0xffeccc,
  },
  dust: {
    kind: 'dust',
    count: 520,
    box: [24, 8, 24],
    speed: 0.35,
    drift: 2.8,
    size: 16,
    opacity: 0.32,
    color: 0xe8d2a0,
  },
};

/**
 * 创建天气粒子系统。
 *
 * @param {object} opts
 * @param {string} opts.preset  WEATHER_PRESETS 的 key；不在表里则不建粒子
 * @param {number} [opts.scale] 渲染高度（用于 uScale，让粒子大小跟分辨率无关）
 * @returns {{points:THREE.Points|null, setPreset:Function, update:Function, dispose:Function, enabled:boolean}}
 */
export function createWeather(opts = {}) {
  const group = new THREE.Group();
  group.name = 'weather';

  let geo = null;
  let mat = null;
  let points = null;
  let currentId = null;

  const api = {
    group,
    points: null,
    enabled: false,
    scale: Number(opts.scale) || 600,

    setPreset(id) {
      const p = WEATHER_PRESETS[id];
      if (!p) {
        api._clear();
        currentId = id;
        api.enabled = false;
        api.points = null;
        return api;
      }
      if (id === currentId && points) return api;
      currentId = id;
      api._clear();

      const n = Math.max(1, p.count | 0);
      const seeds = new Float32Array(n * 3);
      // 用固定种子的 xorshift：同一张图的雪花分布每次都一样（视觉可复现，也方便截图对比）
      let s = 0x9e3779b9;
      const rnd = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
      for (let i = 0; i < n * 3; i++) seeds[i] = rnd();

      geo = new THREE.BufferGeometry();
      // position 是占位的：真实位置全在顶点着色器里算。
      // 但仍然要给一个，否则 three 无法确定 drawRange。
      const pos = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
      // 关掉视锥剔除：位置在 shader 里，包围盒永远是错的
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      mat = new THREE.ShaderMaterial({
        name: 'weather-' + p.kind,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(p.box[0], p.box[1], p.box[2]) },
          uSpeed: { value: p.speed },
          uDrift: { value: p.drift },
          uSize: { value: p.size },
          uScale: { value: api.scale },
          uOpacity: { value: p.opacity },
          uColor: { value: new THREE.Color(p.color) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: p.kind === 'firefly' ? THREE.AdditiveBlending : THREE.NormalBlending,
        fog: false,
      });

      points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = 800; // 场景之后、HUD 之前
      group.add(points);
      api.points = points;
      api.enabled = true;
      return api;
    },

    // 每帧只写一个标量 + 相机位置，零 CPU 几何运算
    update(dt, camera) {
      if (!points || !mat) return;
      mat.uniforms.uTime.value += dt;
      if (camera) mat.uniforms.uCam.value.copy(camera.position);
    },

    // 视口缩放：默认按窗口高度给（而不是写死 600）。
    // 粒子在 shader 里是 size*uScale/dist，uScale 就该正比于视口像素高度。
    setViewportScale(h) {
      api.scale = Math.max(200, Number(h) || 600);
      if (mat) mat.uniforms.uScale.value = api.scale;
    },

    _clear() {
      if (points) {
        group.remove(points);
        points = null;
        api.points = null;
      }
      if (geo) { geo.dispose(); geo = null; }
      if (mat) { mat.dispose(); mat = null; }
    },

    dispose() {
      api._clear();
      api.enabled = false;
    },
  };

  api.setPreset(opts.preset || '');
  return api;
}