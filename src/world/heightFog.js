import * as THREE from 'three';

// 高度雾（docs/plans/2026-11-12-render-overhaul.md §3.2）。
//
// 现在六张图用的都是 THREE.Fog（均匀距离雾）：雾量只跟距离有关，所以远处的
// 集装箱顶和地面的雾一样浓 —— 一眼假。真实大气是「低处先起雾、高处清晰」：
//
//   density(h) = base * exp(-falloff * max(0, h - groundY))
//   factor     = 1 - exp(-density * distance)
//
// 这条公式在视觉上做对三件事：
//   1) 洼地/草地先白，楼顶/树冠保持清晰（纵深读得出来）
//   2) 远处逐渐吃掉，不需要 pop-in
//   3) 雾色随高度略变（低处偏白、高处偏天气色），不会是一块死色

// 每张图的雾配方。意思：baseDensity 是地面处的每米雾量，falloff 是「每升高 1 米雾少多少」。
// 原来的 Fog near/far 换算过来大致对应：far 决定 baseDensity 的量级，night 最浓。
export const FOG_PRESETS = {
  backyard: { color: 0xdff1ff, baseDensity: 0.0125, falloff: 0.075, groundY: 0, heightMax: 26 },
  snow: { color: 0xe2f2ff, baseDensity: 0.0165, falloff: 0.06, groundY: 0, heightMax: 26 },
  dust: { color: 0xe8d6ac, baseDensity: 0.0145, falloff: 0.055, groundY: 0, heightMax: 26 },
  forest: { color: 0x101e2d, baseDensity: 0.055, falloff: 0.10, groundY: 0, heightMax: 22 },
  cloud: { color: 0xf6dfc5, baseDensity: 0.0118, falloff: 0.045, groundY: 0, heightMax: 40 },
  downtown: { color: 0x4a3c50, baseDensity: 0.0082, falloff: 0.05, groundY: 0, heightMax: 60 },
};

/**
 * 计算给定高度处的雾密度。
 * 纯函数，方便单测；也是 shader 里那一行的 JS 对照实现。
 *
 * @param {object} p  预设（需要 baseDensity / falloff / groundY）
 * @param {number} y  世界高度（米）
 * @returns {number}  每米雾量
 */
export function densityAtHeight(p, y) {
  const base = Number(p && p.baseDensity) || 0;
  const falloff = Number(p && p.falloff) || 0;
  const groundY = Number(p && p.groundY) || 0;
  if (base <= 0) return 0;
  const h = Math.max(0, (Number(y) || 0) - groundY);
  return base * Math.exp(-falloff * h);
}

/**
 * 雾在给定距离处的混合系数（0 = 全清晰，1 = 全雾色）。
 *
 * @param {object} p
 * @param {number} y   视线起点高度
 * @param {number} dist 距离（米）
 * @returns {number}
 */
export function fogFactor(p, y, dist) {
  const d = Math.max(0, Number(dist) || 0);
  if (d <= 0) return 0;
  const density = densityAtHeight(p, y);
  if (density <= 0) return 0;
  // 1 - exp(-density * dist) 是标准 Beer-Lambert 消光；夹到 1 避免浮点溢出后 >1
  return Math.min(1, 1 - Math.exp(-density * d));
}

// 六张图共用的雾 shader 片段（在后期管线的合成 pass 里用）。
// 之所以预先算好 density 常量而不是在 shader 里 exp：高度是逐像素的，exp 必须逐像素算，
// 但 base/falloff 是常量，传进去就行。
export const HEIGHT_FOG_GLSL = /* glsl */ `
uniform vec3  uFogColor;
uniform vec3  uFogColorHigh;
uniform float uFogBase;      // 地面处每米雾量
uniform float uFogFalloff;   // 每升高 1 米衰减
uniform float uFogGroundY;
uniform float uFogMax;       // 雾最多影响多远（超过就全雾，省算力）

// 沿视线积分高度雾。
// 用 y0（起点高度）与 dy（终点-起点高度差）做粗略解析：把密度当作 y0 处的常数 + 线性修正。
// 精确解需要指数积分，这里用两步近似就够 —— 视觉上分辨不出来，移动端便宜很多。
float heightFog(float y0, float dist, float dy) {
  if (uFogBase <= 0.0) return 0.0;
  float h0 = max(0.0, y0 - uFogGroundY);
  float h1 = max(0.0, y0 + dy - uFogGroundY);
  // 起点与终点的密度取平均（一阶近似）
  float d0 = uFogBase * exp(-uFogFalloff * h0);
  float d1 = uFogBase * exp(-uFogFalloff * h1);
  float d = (d0 + d1) * 0.5;
  float dd = min(dist, uFogMax);
  return clamp(1.0 - exp(-d * dd), 0.0, 1.0);
}

// 雾色：低处偏白（水汽），高处取天气色，避免整片死色
vec3 fogColorAt(float y) {
  float t = clamp((y - uFogGroundY) / 26.0, 0.0, 1.0);
  return mix(uFogColor, uFogColorHigh, t);
}
`;

/**
 * 把预设填进一组 uniform（后期管线用的 GLSL 版本）。
 * 纯数据转换，方便单测。
 *
 * @param {object} p
 * @param {object} u 目标 uniform 对象（需要 uFogColor 等字段）
 * @returns {object} 传入的 u
 */
export function applyFogPreset(p, u) {
  if (!p || !u) return u;
  u.uFogColor.value.setHex(p.color);
  // 高处雾色往天顶色偏一点会更自然；这里先简单地抬高亮度、降饱和（避免高处偏紫）
  const high = new THREE.Color(p.color);
  const hsl = { h: 0, s: 0, l: 0 };
  high.getHSL(hsl);
  high.setHSL(hsl.h, hsl.s * 0.72, Math.min(1, hsl.l * 1.12));
  u.uFogColorHigh.value.copy(high);
  u.uFogBase.value = p.baseDensity;
  u.uFogFalloff.value = p.falloff;
  u.uFogGroundY.value = p.groundY;
  u.uFogMax.value = Number(p.fogMax) || 220;
  return u;
}

/**
 * 给某个地图找雾预设；未知地图回落到后院。
 * @param {string} id
 */
export function fogPresetFor(id) {
  return FOG_PRESETS[id] || FOG_PRESETS.backyard;
}