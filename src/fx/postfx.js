import * as THREE from 'three';

// 后期管线（docs/plans/2026-11-12-render-overhaul.md §1.3）。
//
// 为什么不用 EffectComposer：
//   1) 它每一步都建独立 RT 且不带分级，手机带宽吃紧；
//   2) 它和现有的自适应 pixelRatio 是两套尺寸管理，易失配；
//   3) 后面要接体积光和 SSAO，需要自己控制 RT 的 format/depth。
//
// 这里是一条手写管线，四个 pass：
//   场景 → HDR RT（半浮点，暂不做色调映射）
//        → 亮度预筛 + 5 级降采样
//        → 5 级上采样（加色混合）
//        → 合成：ACES + 曝光 + 色差 + 暗角 + 颗粒 + 锐化 + sRGB 编码
//
// 三档：0 = 关（直出，与改动前逐字节等价）、1 = 色调映射+收尾（无 Bloom）、2 = 全开。
// 档位是降级的闸门：帧率不够先降档、降到底再降 pixelRatio。

const MAX_MIPS = 5;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---- 亮度预筛 + 第一级降采样 ----
const PREFILTER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  // soft knee：阈值附近平滑过渡，否则高光边缘会出现一圈硬边
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  // 4 抽样盒式降采样（源是半分辨率步长）
  vec2 o = uTexel;
  vec3 c = prefilter(texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb)
         + prefilter(texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb)
         + prefilter(texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb)
         + prefilter(texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb);
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;

void main() {
  // 9 抽样帐篷滤波：比 4 抽样少一层阶梯感，代价可忽略
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-uTexel.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2( uTexel.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, -uTexel.y)).rgb
      + texture2D(tSrc, vUv + vec2(0.0,  uTexel.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb
     + texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb
     + texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb
     + texture2D(tSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;

void main() {
  // 3x3 帐篷，加色混合到目标（目标里已经挂着下一级更大的结果）
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-uTexel.x, 0.0) * uRadius).rgb
      + texture2D(tSrc, vUv + vec2( uTexel.x, 0.0) * uRadius).rgb
      + texture2D(tSrc, vUv + vec2(0.0, -uTexel.y) * uRadius).rgb
      + texture2D(tSrc, vUv + vec2(0.0,  uTexel.y) * uRadius).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y) * uRadius).rgb
     + texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y) * uRadius).rgb
     + texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y) * uRadius).rgb
     + texture2D(tSrc, vUv + vec2( uTexel.x,  uTexel.y) * uRadius).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

// ---- 合成 ----
const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2  uTexel;
uniform vec2  uResolution;
uniform float uExposure;
uniform float uBloom;
uniform float uChroma;
uniform float uVignette;
uniform float uGrain;
uniform float uSharpen;
uniform float uTime;
uniform float uFade;      // 0 = 黑场（切图/死亡），1 = 正常

// ACES filmic（Narkowicz 拟合）。比 three 的 Neutral 更「有胶片味」：
// 高光滚降更柔，暗部不死黑。原来 NeutralToneMapping 下白雪和太阳盘会死白。
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// 线性 → sRGB。手写这步是因为自定义 ShaderMaterial 不会被 three 自动编码。
vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = vUv;

  // ---- 色差：越靠近边缘偏移越大（镜头横向色差的近似）----
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * uChroma * (0.35 + r2);
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;

  // ---- 锐化：unsharp mask。后期降采样会软，这一步把轮廓捡回来 ----
  if (uSharpen > 0.001) {
    vec3 blur = (
      texture2D(tScene, uv + vec2(uTexel.x, 0.0)).rgb +
      texture2D(tScene, uv - vec2(uTexel.x, 0.0)).rgb +
      texture2D(tScene, uv + vec2(0.0, uTexel.y)).rgb +
      texture2D(tScene, uv - vec2(0.0, uTexel.y)).rgb
    ) * 0.25;
    col += (col - blur) * uSharpen;
  }

  // ---- Bloom 叠加（在色调映射之前：光晕本身要参与滚降）----
  if (uBloom > 0.001) col += texture2D(tBloom, uv).rgb * uBloom;

  // ---- 曝光 + ACES ----
  col *= uExposure;
  col = aces(col);

  // ---- 暗角 ----
  if (uVignette > 0.001) {
    float v = smoothstep(0.92, 0.28, r2 * 1.55);
    col *= mix(1.0 - uVignette, 1.0, v);
  }

  // ---- 胶片颗粒：暗部更明显（亮部加噪会像坏点）----
  if (uGrain > 0.001) {
    float g = hash(uv * uResolution + uTime * 137.0) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += g * uGrain * (1.0 - lum * 0.75);
  }

  col *= uFade;
  gl_FragColor = vec4(toSRGB(col), 1.0);
}
`;

// ---------------------------------------------------------------------------
// 纯逻辑（可单测，不碰 WebGL）
// ---------------------------------------------------------------------------

export const LEVEL_OFF = 0;
export const LEVEL_TONEMAP = 1;
export const LEVEL_FULL = 2;

/**
 * 解析 ?post= 参数。
 * 显式 0 → 关（回滚开关）；1 → 仅色调映射；其它/缺省 → 全开。
 * @param {string} search location.search
 * @param {boolean} [touch] 触屏设备默认更保守
 */
export function postLevelFromQuery(search, touch = false) {
  const s = String(search || '');
  const m = /[?&]post=([^&]*)/.exec(s);
  if (m) {
    const v = decodeURIComponent(m[1]).trim();
    if (v === '0' || v === 'off') return LEVEL_OFF;
    if (v === '1' || v === 'tonemap') return LEVEL_TONEMAP;
    if (v === '2' || v === 'full') return LEVEL_FULL;
  }
  // 触屏默认只上色调映射：Bloom 是手机端最贵的一步
  return touch ? LEVEL_TONEMAP : LEVEL_FULL;
}

/**
 * 各级 Bloom 的尺寸（逐级减半，最小不小于 2）。
 * @param {number} w
 * @param {number} h
 * @param {number} count
 * @returns {Array<[number, number]>}
 */
export function bloomMipSizes(w, h, count = MAX_MIPS) {
  const out = [];
  let cw = Math.max(2, Math.floor(w / 2));
  let ch = Math.max(2, Math.floor(h / 2));
  for (let i = 0; i < count; i++) {
    out.push([Math.max(2, cw), Math.max(2, ch)]);
    cw = Math.floor(cw / 2);
    ch = Math.floor(ch / 2);
  }
  return out;
}

/**
 * 帧率不够时的降级顺序：先降档（2→1→0），档位见底才降 pixelRatio。
 *
 * 为什么这个顺序：档位是「一档换 3~8 ms」，pixelRatio 是「一档换分辨率」——
 * 用户对分辨率的下降比对方画质更敏感，所以先牺牲后期。
 *
 * @param {object} st
 * @param {number} st.level
 * @param {number} st.pixelRatio
 * @param {number} st.maxPixelRatio
 * @returns {{level:number, pixelRatio:number, changed:boolean}}
 */
export function degradeStep(st) {
  const level = Number(st.level) || 0;
  const pr = Number(st.pixelRatio) || 1;
  const maxPr = Number(st.maxPixelRatio) || 1;
  if (level > LEVEL_OFF) return { level: level - 1, pixelRatio: pr, changed: true };
  if (pr > 1.02) return { level, pixelRatio: Math.max(1, pr - 0.25), changed: true };
  return { level, pixelRatio: pr, changed: false };
}

/**
 * 帧率富余时的恢复顺序：先把 pixelRatio 补满，再升档。
 * （和降级严格对称：最后降的必须最先升，否则会在两个状态间来回跳。）
 *
 * @param {object} st
 * @param {number} st.level
 * @param {number} st.maxLevel
 * @param {number} st.pixelRatio
 * @param {number} st.maxPixelRatio
 */
export function upgradeStep(st) {
  const level = Number(st.level) || 0;
  const maxLevel = st.maxLevel === undefined ? LEVEL_FULL : Number(st.maxLevel) || 0;
  const pr = Number(st.pixelRatio) || 1;
  const maxPr = Number(st.maxPixelRatio) || 1;
  if (pr < maxPr - 0.01) return { level, pixelRatio: Math.min(maxPr, pr + 0.1), changed: true };
  if (level < maxLevel) return { level: level + 1, pixelRatio: pr, changed: true };
  return { level, pixelRatio: pr, changed: false };
}

// ---------------------------------------------------------------------------
// 渲染管线
// ---------------------------------------------------------------------------

/**
 * 创建后期管线。渲染器不支持时返回一个 enabled=false 的哑对象，
 * 调用方据此退回 renderer.render()。
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [opts]
 * @param {number} [opts.level]   起始档位
 * @param {number} [opts.bloomStrength]
 * @param {number} [opts.threshold]
 * @param {number} [opts.samples] 场景 RT 的 MSAA 采样数
 */
export function createPostFX(renderer, opts = {}) {
  const noop = {
    enabled: false,
    level: LEVEL_OFF,
    maxLevel: LEVEL_OFF,
    setLevel() {},
    setSize() {},
    // 必须返回 false：调用方用它判断「管线没接住，快走直出」
    render() { return false; },
    setFade() {},
    setBloom() {},
    dispose() {},
    failed: true,
  };

  // 能力探测：jsdom 的假渲染器没有 capabilities/getContext，直接退直出
  if (!renderer || !renderer.getContext || !renderer.setRenderTarget) return noop;
  let ctx = null;
  try {
    ctx = renderer.getContext();
  } catch (e) {
    return noop;
  }
  if (!ctx || typeof ctx.createTexture !== 'function') return noop;

  const isWebGL2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
  const maxLevel0 = opts.maxLevel === undefined ? LEVEL_FULL : opts.maxLevel;

  let level = opts.level === undefined ? LEVEL_FULL : opts.level;
  let width = 2;
  let height = 2;
  let fade = 1;
  let failed = false;

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial());
  quad.frustumCulled = false;
  quadScene.add(quad);

  const rtOpts = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  };

  let sceneRT = null;
  let mips = [];
  let blackTex = null;

  const prefMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: opts.threshold === undefined ? 1.1 : opts.threshold },
      uKnee: { value: 0.42 },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: PREFILTER_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    fragmentShader: DOWN_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const upMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: UP_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uBloom: { value: opts.bloomStrength === undefined ? 0.06 : opts.bloomStrength },
      uChroma: { value: 0.0008 },
      uVignette: { value: 0.25 },
      uGrain: { value: 0.015 },
      uSharpen: { value: 0.25 },
      uTime: { value: 0 },
      uFade: { value: 1 },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  // 1x1 黑图：关 Bloom 时给 composite 一个合法采样源，省掉一次分支
  {
    const data = new Uint8Array([0, 0, 0, 255]);
    blackTex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    blackTex.needsUpdate = true;
  }

  function buildTargets(w, h) {
    disposeTargets();
    width = Math.max(2, w | 0);
    height = Math.max(2, h | 0);
    try {
      sceneRT = new THREE.WebGLRenderTarget(width, height, {
        ...rtOpts,
        // WebGL2 下开 MSAA，等价于原来的 antialias:true
        samples: isWebGL2 ? (opts.samples === undefined ? 4 : opts.samples) : 0,
      });
      mips = bloomMipSizes(width, height, MAX_MIPS).map(([mw, mh]) => (
        new THREE.WebGLRenderTarget(mw, mh, { ...rtOpts, depthBuffer: false })
      ));
    } catch (e) {
      failed = true;
      disposeTargets();
    }
  }

  function disposeTargets() {
    if (sceneRT) { sceneRT.dispose(); sceneRT = null; }
    for (const m of mips) m.dispose();
    mips = [];
  }

  function blit(mat, target, clear) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(quadScene, quadCam);
  }

  const api = {
    enabled: true,
    failed: false,
    maxLevel: maxLevel0,

    get level() { return level; },

    setLevel(n) {
      const v = Math.max(LEVEL_OFF, Math.min(maxLevel0, Number(n) || 0));
      if (v === level) return;
      level = v;
    },

    setSize(w, h) {
      if (!api.enabled) return;
      if (w === width && h === height) return;
      buildTargets(w, h);
    },

    setFade(v) {
      fade = Math.max(0, Math.min(1, Number(v) || 0));
    },

    // 每帧一次的 Bloom 强度/调参入口（天气、Boss 战可以临时改）
    setBloom(v) {
      compMat.uniforms.uBloom.value = Math.max(0, Number(v) || 0);
    },

    render(scene, camera) {
      if (!api.enabled || failed) return false;
      if (!sceneRT || !width || !height) return false;
      if (level === LEVEL_OFF) return false;

      const prevTarget = renderer.getRenderTarget();
      const prevTone = renderer.toneMapping;

      try {
        // ---- 1. 场景进 HDR RT ----
        // 必须临时关掉色调映射：three 的 tonemapping_fragment 写在内置材质里，
        // 不关的话 RT 里存的已经是压过的 LDR，后面就没得滚降了。
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setRenderTarget(sceneRT);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);

        const bloomOn = level >= LEVEL_FULL;

        // ---- 2/3. Bloom 链 ----
        if (bloomOn && mips.length) {
          prefMat.uniforms.tSrc.value = sceneRT.texture;
          prefMat.uniforms.uTexel.value.set(1 / width, 1 / height);
          blit(prefMat, mips[0], true);

          for (let i = 1; i < mips.length; i++) {
            downMat.uniforms.tSrc.value = mips[i - 1].texture;
            downMat.uniforms.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
            blit(downMat, mips[i], true);
          }
          // 从最小一级往回加色叠加
          for (let i = mips.length - 1; i > 0; i--) {
            upMat.uniforms.tSrc.value = mips[i].texture;
            upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
            blit(upMat, mips[i - 1], false);
          }
        }

        // ---- 4. 合成到画布 ----
        compMat.uniforms.tScene.value = sceneRT.texture;
        compMat.uniforms.tBloom.value = bloomOn && mips.length ? mips[0].texture : blackTex;
        compMat.uniforms.uTexel.value.set(1 / width, 1 / height);
        compMat.uniforms.uResolution.value.set(width, height);
        // 曝光读渲染器的当前值：切图时 Game 会把 downtown 设成 1.5，这里不能缓存
        compMat.uniforms.uExposure.value = renderer.toneMappingExposure === undefined
          ? 1 : renderer.toneMappingExposure;
        compMat.uniforms.uBloom.value = bloomOn
          ? (compMat.uniforms.uBloom.value > 0 ? compMat.uniforms.uBloom.value : 0.06)
          : 0;
        compMat.uniforms.uFade.value = fade;
        compMat.uniforms.uTime.value = (compMat.uniforms.uTime.value + 0.016) % 1000;

        blit(compMat, null, false);
        return true;
      } catch (e) {
        // 任何 GL 失败都不能让整个游戏黑屏 —— 标记失败，之后一律直出
        failed = true;
        api.failed = true;
        return false;
      } finally {
        renderer.toneMapping = prevTone;
        renderer.setRenderTarget(prevTarget);
      }
    },

    dispose() {
      disposeTargets();
      quadGeo.dispose();
      quad.material.dispose();
      for (const m of [prefMat, downMat, upMat, compMat]) m.dispose();
      if (blackTex) blackTex.dispose();
      api.enabled = false;
    },
  };

  buildTargets(2, 2);
  if (failed) {
    api.enabled = false;
    return noop;
  }
  return api;
}