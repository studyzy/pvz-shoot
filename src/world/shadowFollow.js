import * as THREE from 'three';

// 阴影视锥跟随：把方向光的阴影相机绑在玩家脚下的一个窗口里，而不是整张地图。
//
// 为什么必须跟随：阴影视锥原本写死在地图中心（后院 ±30、摩天街区 ±50）。
// 玩家走到场地边缘时，一半怪落在视锥外 —— 影子不是变淡，是直接消失。
//
// 为什么必须收紧：同样一张 1024² 阴影贴图，铺 60 米是 5.9 cm/texel，
// 铺 34 米就是 3.3 cm/texel。清晰度翻倍，一分钱不花。
//
// 光的方向保持不变：只平移光源与 target，两者共用同一个位移量，
// 所以 dir = (position - target) 恒定 —— 全场明暗关系不会因为玩家走动而变。

const _focus = new THREE.Vector3();
const _offset = new THREE.Vector3();

/**
 * 配置一台方向光的阴影相机为「跟随窗口」。
 *
 * @param {THREE.DirectionalLight} sun
 * @param {object} opts
 * @param {number} opts.half      视锥半宽（米）。窗口是 half*2 见方。
 * @param {number} opts.near      阴影视锥近裁面
 * @param {number} opts.far       阴影视锥远裁面
 * @param {number} [opts.mapSize] 阴影贴图边长
 * @returns {{half:number, update:(focus:THREE.Vector3)=>void}}
 */
export function setFollowShadow(sun, opts) {
  const half = Math.max(4, Number(opts.half) || 17);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = Number.isFinite(opts.near) ? opts.near : 1;
  cam.far = Number.isFinite(opts.far) ? opts.far : 90;
  cam.updateProjectionMatrix();
  if (opts.mapSize) sun.shadow.mapSize.set(opts.mapSize, opts.mapSize);

  // 光源相对 target 的原始偏移，平移时保持不变。
  _offset.copy(sun.position).sub(sun.target.position);
  const offset = _offset.clone();

  // 位移量化到 0.5 米的格子上。逐帧连续平移会让阴影边缘随相机亚像素抖动（shimmer），
  // 量化后贴图只在跨格时重算，闪烁消失。
  const STEP = 0.5;
  let lastX = NaN;
  let lastZ = NaN;

  const api = {
    half,
    update(focus) {
      if (!focus) return;
      const x = Math.round(focus.x / STEP) * STEP;
      const z = Math.round(focus.z / STEP) * STEP;
      if (x === lastX && z === lastZ) return;
      lastX = x;
      lastZ = z;
      _focus.set(x, 0, z);
      sun.target.position.copy(_focus);
      sun.position.copy(_focus).add(offset);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },
    // 测试与切图用：强制下次 update 重算。
    reset() {
      lastX = NaN;
      lastZ = NaN;
    },
  };
  return api;
}