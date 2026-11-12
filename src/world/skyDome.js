import * as THREE from 'three';

// 天空穹顶（docs/plans/2026-11-12-render-overhaul.md §3.1）。
//
// 现状是 8×512 的渐变色条直接当 scene.background 拉满全屏 —— 没有太阳、没有云层、
// 没有大气散射，远景是「一片贴纸」。这里换成一个反着看的球体 + fragment shader：
//
//   地平线暖带（朝阳面更亮）→ 天顶色 → 太阳盘 → 云层 fbm
//
// 六张图共用一条 shader，只换 4 个颜色常量 + 太阳方向 —— 这是性价比最高的一处改动。
// 成本：1 个 draw call、一个半球几何、一条不到 100 行的 fragment shader。

const VERT = `
varying vec3 vDir;
void main() {
  // 球体本地位置就是视线方向：穹顶中心永远跟着相机，所以本地坐标 = 世界方向。
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 噪声：一张程序化生成的 256² RGBA 图当查找表，避免在 shader 里写 hash（移动端更稳）。
const FRAG = `
precision highp float;
varying vec3 vDir;

uniform vec3  uZenith;      // 天顶色
uniform vec3  uHorizon;     // 地平线暖色（朝阳面）
uniform vec3  uHorizonAway; // 地平线冷色（背阳面）
uniform vec3  uHorizonTint; // 朝太阳一侧地平线的提亮系数（白天暖、夜里冷）
uniform vec3  uGlowTint;    // 太阳/月亮方位上那圈近距光晕的叠加色
uniform vec3  uSunColor;    // 太阳盘颜色
uniform vec3  uSunDir;      // 太阳方向（已归一化）
uniform float uSunSize;     // 太阳盘锐度：越大越小越硬
uniform float uSunGlow;     // 太阳光晕强度
uniform float uCloudCover;  // 云量 0~1
uniform float uCloudScale;  // 云层尺度
uniform float uCloudSpeed;  // 云层流速
uniform float uCloudBright; // 云的受光亮度（夜里云只该剩一点月光）
uniform float uTime;
uniform float uStars;       // 星空强度（夜景用；白天传 0）
uniform float uFlash;       // 闪电瞬时亮度
uniform sampler2D uNoise;

// 采样查找表里的一层 value noise
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(uNoise, (i + f + 0.5) / 256.0).r;
}

// 5 层 fbm：云层用。每层旋转 37° 左右，避免轴向条纹
float fbm5(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * n2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.96875;
}

// 3 层 fbm：星空用（高频，层数少一点省算力）
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * n2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.875;
}

// 该方向与太阳方位角的重合度：0 = 背对太阳，1 = 正对太阳
float skyToSun(vec3 d) {
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  return clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float ts = skyToSun(d);

  // ---- 地平线：背阳面是冷灰蓝，朝阳面逐渐被点燃 ----
  vec3 hc = mix(
    uHorizonAway,
    uHorizonAway * 1.25 + vec3(0.05, 0.03, 0.02),
    smoothstep(0.2, 0.75, ts)
  );
  hc = mix(hc, uHorizon * uHorizonTint, pow(ts, 6.0));
  hc = mix(hc, uGlowTint, pow(ts, 34.0));

  // ---- 天顶 → 地平线的垂直渐变 ----
  // pow(h, .55) 让色带压在地平线附近，天空上半部分更均匀 —— 直上直下的 lerp 会显得假。
  vec3 col = mix(hc, uZenith, pow(h, 0.55));

  // ---- 星空（夜景）：只在 h > 0.1 处出现，地平线附近被大气吃掉 ----
  if (uStars > 0.001) {
    vec2 sp = d.xz / max(h, 0.05) * 8.0;
    float st = fbm3(sp * 26.0);
    float star = smoothstep(0.93, 0.985, st) * smoothstep(0.08, 0.35, h);
    col += vec3(0.85, 0.9, 1.0) * star * uStars;
  }

  // ---- 太阳盘 + 光晕 ----
  // 盘用 pow(dot, n) 做，n 越大越小越硬；光晕是低指数那一层。
  float mu = max(dot(d, uSunDir), 0.0);
  float disc = pow(mu, uSunSize);
  float glow = pow(mu, 12.0) * uSunGlow;
  // 太阳落在地平线以下时整体压暗，避免「太阳在地底还在照」
  float sunUp = smoothstep(-0.12, 0.08, uSunDir.y);
  col += uSunColor * (disc * 5.0 + glow) * sunUp;

  // ---- 云层 ----
  // 用 d.xz / (h + 常数) 做平面投影：云在天上像一块平板，靠近地平线被压扁（透视）。
  if (uCloudCover > 0.001) {
    vec2 cp = d.xz / (h * 0.85 + 0.16) * uCloudScale;
    cp += vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.37);
    // 两层不同尺度叠出「大团 + 碎边」
    float c1 = fbm5(cp);
    float c2 = fbm5(cp * 2.7 + 11.0);
    float cloud = smoothstep(0.52 - uCloudCover * 0.34, 0.86, c1 * 0.72 + c2 * 0.28);
    // 云只在水平面以上出现，并且在地平线附近淡出
    cloud *= smoothstep(0.0, 0.22, h);
    // 云的受光面：朝太阳一侧更亮（假散射，但方向对了就够）
    vec3 lit = mix(vec3(0.72, 0.75, 0.82), vec3(1.0, 0.95, 0.88), pow(ts, 2.0));
    lit *= (0.55 + 0.45 * sunUp) * uCloudBright;
    // 云边缘透一点天光：把底色混进去
    col = mix(col, lit, cloud * 0.92);
  }

  // ---- 闪电：整片天空瞬时提亮 ----
  col += vec3(0.55, 0.62, 0.8) * uFlash * (0.35 + 0.65 * h);

  gl_FragColor = vec4(col, 1.0);
}
`;

let _noiseTex = null;

// 256² 程序化噪声（xorshift + value noise 查找表）。六张图共用一张。
// 不能在 shader 里现算 hash：移动端精度不稳，且每像素重算是纯浪费。
function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  let s = 2654435769;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = rnd() * 256;
    data[i * 4 + 1] = rnd() * 256;
    data[i * 4 + 2] = rnd() * 256;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  _noiseTex = tex;
  return tex;
}

// 每张图的天空配方。值来自现有渐变条的颜色（保持美术方向不变，只是让它有层次）。
export const SKY_PRESETS = {
  backyard: {
    zenith: [0x2f7fd0, 0x3f93dd],
    horizon: [0x8fd0f4, 0xcfeaff],
    horizonAway: [0x9cc8e8, 0x586f88],
    sun: [0xfff6e0, 0xffd9a0],
    sunSize: 900,
    sunGlow: 1.1,
    cloudCover: 0.55,
    cloudScale: 2.4,
    cloudSpeed: 0.006,
    stars: 0,
  },
  snow: {
    zenith: [0x3f76b8, 0x5a8ec8],
    horizon: [0xc9e7ff, 0xeaf7ff],
    horizonAway: [0xa8c4dc, 0x6d7f93],
    sun: [0xffffff, 0xdceaff],
    sunSize: 1100,
    sunGlow: 0.8,
    cloudCover: 0.42,
    cloudScale: 2.0,
    cloudSpeed: 0.004,
    stars: 0,
  },
  dust: {
    zenith: [0x3d7fb8, 0x5b96c6],
    horizon: [0xefdfb6, 0xf6ecd0],
    horizonAway: [0xb8b39a, 0x7a7361],
    sun: [0xffffff, 0xffe8b8],
    sunSize: 700,
    sunGlow: 1.6,
    cloudCover: 0.28,
    cloudScale: 1.6,
    cloudSpeed: 0.003,
    stars: 0,
  },
  cloud: {
    zenith: [0x91b9ce, 0xa8c8d8],
    horizon: [0xfff0d8, 0xf6c6ae],
    horizonAway: [0xd8cfc8, 0x9a8f8c],
    sun: [0xfff4e0, 0xffd0a8],
    sunSize: 800,
    sunGlow: 1.4,
    cloudCover: 0.72,
    cloudScale: 3.2,
    cloudSpeed: 0.008,
    stars: 0,
  },
  forest: {
    zenith: [0x050a18, 0x0b1430],
    horizon: [0x3d4a63, 0x4a5570],
    horizonAway: [0x16244a, 0x0b1430],
    sun: [0xcfe0ff, 0x8fa8cc],
    sunSize: 2200,
    sunGlow: 0.45,
    cloudCover: 0.26,
    cloudScale: 2.2,
    cloudSpeed: 0.004,
    stars: 1.0,
    // 夜景：云只剩一层月光，不能是白天的灰白云；地平线也不该有暖色「点燃」，
    // 那圈近距光晕改成一抹冷蓝（月光散射），否则夜空会亮得像傍晚。
    cloudBright: 0.14,
    horizonTint: [1.02, 1.06, 1.22],
    glow: [0.18, 0.24, 0.4],
  },
  downtown: {
    zenith: [0x3d3363, 0x4a3f70],
    horizon: [0xf0a458, 0xe08a48],
    horizonAway: [0x68537f, 0x3d3363],
    sun: [0xffd9a0, 0xc06a42],
    sunSize: 420,
    sunGlow: 2.2,
    cloudCover: 0.46,
    cloudScale: 2.0,
    cloudSpeed: 0.005,
    stars: 0.12,
  },
};

// 白天（改动前）的地平线提亮与近距光晕常量：其它地图不写这两个字段时用它，
// 保证这次只改夜景，白天的天空一个像素都不动。
const DAY_HORIZON_TINT = [1.9, 1.55, 1.2];
const DAY_GLOW = [3.4, 2.04, 0.816];

// 从 [主色, 辅色] 配对里插值出一个色（辅色让同一张图的天空不至于只有一种蓝）
function pair(arr, t, out) {
  const a = new THREE.Color(arr[0]);
  const b = new THREE.Color(arr[1]);
  return out.copy(a).lerp(b, t);
}

/**
 * 创建天空穹顶。
 *
 * 穹顶是一个半径 R 的球、材质 BackSide、depthWrite=false、fog=false，每帧跟着相机走
 * （所以半径只要小于相机远裁面即可，不需要真的很大）。
 *
 * @param {object} opts
 * @param {string} opts.preset  SKY_PRESETS 的 key
 * @param {THREE.Vector3} [opts.sunDir] 太阳方向（归一化前的任意向量都行）
 * @param {number} [opts.radius]
 * @returns {{mesh:THREE.Mesh, uniform:object, setPreset:Function, update:Function, sunDir:THREE.Vector3, dispose:Function}}
 */
export function createSkyDome(opts = {}) {
  const radius = Number(opts.radius) || 400;
  const geo = new THREE.SphereGeometry(radius, 32, 20);

  const uniform = {
    uZenith: { value: new THREE.Color(0x3f93dd) },
    uHorizon: { value: new THREE.Color(0xcfeaff) },
    uHorizonAway: { value: new THREE.Color(0x586f88) },
    // 白天默认值 = 改动前的字面量，保证其它五张图的观感逐像素不变
    uHorizonTint: { value: new THREE.Color(1.9, 1.55, 1.2) },
    uGlowTint: { value: new THREE.Color(3.4, 2.04, 0.816) },
    uSunColor: { value: new THREE.Color(0xfff6e0) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.4).normalize() },
    uSunSize: { value: 900 },
    uSunGlow: { value: 1.0 },
    uCloudCover: { value: 0.5 },
    uCloudScale: { value: 2.4 },
    uCloudSpeed: { value: 0.005 },
    uCloudBright: { value: 1 },
    uTime: { value: 0 },
    uStars: { value: 0 },
    uFlash: { value: 0 },
    uNoise: { value: noiseTexture() },
  };

  const mat = new THREE.ShaderMaterial({
    name: 'saltline-sky',
    uniforms: uniform,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000; // 永远最先画，后面所有东西盖在它上面
  mesh.matrixAutoUpdate = false;

  const api = {
    mesh,
    uniform,
    sunDir: uniform.uSunDir.value,
    radius,

    setPreset(id) {
      const p = SKY_PRESETS[id] || SKY_PRESETS.backyard;
      // 用 id 的 hash 做个稳定的 t，让同一张图每次进都长一样（不能每帧随机）
      let hash = 0;
      for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
      const t = (hash % 1000) / 1000;
      pair(p.zenith, t * 0.35, uniform.uZenith.value);
      // 地平线只取朝太阳那一侧的主色 —— 它在 shader 里会和 horizonAway 混
      uniform.uHorizon.value.setHex(p.horizon[0]);
      pair(p.horizonAway, t * 0.4, uniform.uHorizonAway.value);
      uniform.uSunColor.value.setHex(p.sun[0]);
      uniform.uSunSize.value = p.sunSize;
      uniform.uSunGlow.value = p.sunGlow;
      uniform.uCloudCover.value = p.cloudCover;
      uniform.uCloudScale.value = p.cloudScale;
      uniform.uCloudSpeed.value = p.cloudSpeed;
      uniform.uStars.value = p.stars;
      // 这两组是「夜景/白天」的开关，不写就用原来的白天常量
      const ht = p.horizonTint || DAY_HORIZON_TINT;
      uniform.uHorizonTint.value.setRGB(ht[0], ht[1], ht[2]);
      const gt = p.glow || DAY_GLOW;
      uniform.uGlowTint.value.setRGB(gt[0], gt[1], gt[2]);
      uniform.uCloudBright.value = p.cloudBright === undefined ? 1 : p.cloudBright;
      return api;
    },

    // 每帧：穹顶跟着相机平移（不旋转），并推进时间
    update(dt, camera) {
      uniform.uTime.value += dt;
      if (camera) {
        mesh.position.set(camera.position.x, camera.position.y, camera.position.z);
        mesh.updateMatrix();
        mesh.matrixWorld.copy(mesh.matrix);
      }
    },

    setSunDir(v) {
      uniform.uSunDir.value.copy(v).normalize();
      return api;
    },

    // 闪电用：0~1 的瞬时亮度
    setFlash(v) {
      uniform.uFlash.value = Math.max(0, Math.min(1, v || 0));
      return api;
    },

    dispose() {
      geo.dispose();
      mat.dispose();
      // 噪声贴图是模块级共享的，不在这里 dispose
    },
  };

  api.setPreset(opts.preset || 'backyard');
  if (opts.sunDir) api.setSunDir(opts.sunDir);
  return api;
}