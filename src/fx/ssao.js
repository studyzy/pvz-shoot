import * as THREE from 'three';

// SSAO（docs/plans/2026-11-12-render-overhaul.md §2.2）。
//
// 现状：场景里没有任何环境光遮蔽。两个物体靠近的地方（僵尸脚与地面、木箱与墙、
// 集装箱之间）没有接触阴影，物体看起来像「贴」在场景上而不是「站」在里面。
//
// 这是阴影之外的第二层——实时投影给的是方向光的投射影，SSAO 给的是「角落变暗」。
// 两者互补：没有 SSAO 时，即使有阴影，缝隙里也是亮的。
//
// 实现：半分辨率跑（AO 是低频信号，半分辨率几乎看不出差别，省 75% 像素）。
// 16 抽样、半球内旋转采样向量（每像素按噪声图转一下，防止出现条带）。

const AO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const AO_FRAG = /* glsl */ `
precision highp float;
// dFdx/dFdy 在 WebGL1 里是扩展；WebGL2 内置。没有它就没法重建法线，
// 所以声明失败时整条 SSAO 会退化为「全亮」（无害），而不是编译报错黑屏。
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
varying vec2 vUv;

uniform sampler2D tDepth;
uniform sampler2D tNoise;   // 4x4 随机旋转向量
uniform vec2  uResolution;  // 半分辨率尺寸
uniform vec2  uFullRes;     // 全分辨率尺寸（用于把 uv 换算回深度图的步长）
uniform float uNear;
uniform float uFar;
uniform float uRadius;      // 世界空间采样半径（米）
uniform float uBias;
uniform float uIntensity;
uniform mat4  uProjInv;

// 从非线性深度还原视空间坐标
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * clip;
  return v.xyz / v.w;
}

void main() {
  vec3 p = viewPos(vUv);
  // 背景（深度为 1）不产生 AO
  if (texture2D(tDepth, vUv).x > 0.9999) {
    gl_FragColor = vec4(1.0);
    return;
  }

  // 噪声旋转：把采样半球绕法线转一个随机角度，消除 16 抽样带来的条带
  vec3 rnd = texture2D(tNoise, vUv * uFullRes / 4.0).xyz;

  // 视空间法线：用深度图的偏导重建（没有法线 RT，省一张图）
  vec3 dx = dFdx(p);
  vec3 dy = dFdy(p);
  vec3 n = normalize(cross(dx, dy));
  // 相机朝 -z 看，法线要统一朝向相机
  if (dot(n, -normalize(p)) < 0.0) n = -n;

  // 构造切线基
  vec3 t = normalize(rnd - n * dot(rnd, n));
  vec3 b = cross(n, t);
  mat3 tbn = mat3(t, b, n);

  float occ = 0.0;
  const int N = 16;
  for (int i = 0; i < N; i++) {
    // 半球均匀分布（Cubemap 式的球面斐波那契，比纯随机更均匀）
    float fi = float(i);
    float phi = 6.2831853 * fi / float(N);
    float costh = sqrt(1.0 - (fi + 0.5) / float(N));
    float sinth = sqrt(1.0 - costh * costh);
    // 半径按 i 缩放：近处采样密、远处稀，这是标准做法（避免远处采样点太远失真）
    float r = uRadius * (0.35 + 0.65 * (fi / float(N)));
    vec3 dir = tbn * vec3(cos(phi) * sinth, sin(phi) * sinth, costh);
    // 当前像素与采样点的视空间距离（等距采样，用 r 近似即可）
    float dist = length(p + dir * r);

    // 投回屏幕空间：小半径下用 uv 偏移近似就够（SSAO 本身是低频信号），
    // 省掉一个 proj 正变换 uniform。
    vec2 offs = (dir.xy / max(0.001, -p.z)) * r;
    vec2 suv = vUv + offs;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

    vec3 spv = viewPos(suv);
    float sampleDist = length(spv);
    // 采样点比当前像素更靠近相机 → 被遮挡
    float diff = dist - sampleDist;
    if (diff > uBias) {
      occ += smoothstep(0.0, 1.0, diff / r) * (1.0 - smoothstep(0.0, r * 1.5, abs(diff)));
    }
  }

  float ao = 1.0 - (occ / float(N)) * uIntensity;
  gl_FragColor = vec4(clamp(ao, 0.0, 1.0));
}
`;

// 4x4 随机旋转噪声（半球绕法线转的角度）
export function aoNoiseTexture(size = 4) {
  const n = Math.max(2, size | 0);
  const data = new Uint8Array(n * n * 4);
  let s = 0x1234567;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n * n; i++) {
    // xy 是单位圆上的随机方向，z=0
    const a = rnd() * Math.PI * 2;
    data[i * 4] = Math.round((Math.cos(a) * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((Math.sin(a) * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 创建 SSAO pass。
 *
 * 没有真实 WebGL 时返回 enabled=false 的哑对象。
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [opts]
 */
export function createSSAO(renderer, opts = {}) {
  const noop = {
    enabled: false,
    setSize() {},
    render() { return false; },
    get texture() { return null; },
    dispose() {},
  };
  if (!renderer || !renderer.getContext || !renderer.setRenderTarget) return noop;
  let ctx = null;
  try { ctx = renderer.getContext(); } catch (e) { return noop; }
  if (!ctx || typeof ctx.createTexture !== 'function') return noop;

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial());
  quad.frustumCulled = false;
  quadScene.add(quad);

  let w = 2;
  let h = 2;
  let fullW = 2;
  let fullH = 2;
  let rt = null;

  const noise = aoNoiseTexture(4);

  const mat = new THREE.ShaderMaterial({
    name: 'ssao',
    uniforms: {
      tDepth: { value: null },
      tNoise: { value: noise },
      uResolution: { value: new THREE.Vector2(2, 2) },
      uFullRes: { value: new THREE.Vector2(2, 2) },
      uNear: { value: 0.05 },
      uFar: { value: 240 },
      uRadius: { value: 0.85 },
      uBias: { value: 0.035 },
      uIntensity: { value: 1.35 },
      uProjInv: { value: new THREE.Matrix4() },
    },
    vertexShader: AO_VERT,
    fragmentShader: AO_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  function build(w2, h2) {
    if (rt) rt.dispose();
    w = Math.max(2, w2 | 0);
    h = Math.max(2, h2 | 0);
    try {
      rt = new THREE.WebGLRenderTarget(w, h, {
        // AO 是单通道低频信号，用 8 位就够（省一半带宽）
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    } catch (e) {
      rt = null;
    }
  }

  const api = {
    enabled: true,
    setSize(fullWidth, fullHeight) {
      fullW = Math.max(2, fullWidth | 0);
      fullH = Math.max(2, fullHeight | 0);
      // 半分辨率：AO 低频，几乎看不出差别，省 75% 像素
      build(Math.floor(fullW / 2), Math.floor(fullH / 2));
      mat.uniforms.uResolution.value.set(w, h);
      mat.uniforms.uFullRes.value.set(fullW, fullH);
    },
    render(depthTex, camera) {
      if (!rt || !depthTex) return false;
      try {
        mat.uniforms.tDepth.value = depthTex;
        mat.uniforms.uNear.value = camera && camera.near ? camera.near : 0.05;
        mat.uniforms.uFar.value = camera && camera.far ? camera.far : 240;
        if (camera && camera.projectionMatrixInverse) {
          mat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
        }
        quad.material = mat;
        renderer.setRenderTarget(rt);
        renderer.render(quadScene, quadCam);
        renderer.setRenderTarget(null);
        return true;
      } catch (e) {
        rt = null;
        return false;
      }
    },
    get texture() { return rt ? rt.texture : null; },
    dispose() {
      if (rt) rt.dispose();
      quadGeo.dispose();
      quad.material.dispose();
      mat.dispose();
      noise.dispose();
      api.enabled = false;
    },
  };

  build(1, 1);
  return api;
}