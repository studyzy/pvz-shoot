// 画质档位（docs/plans/2026-11-12-render-overhaul.md §7.2）。
//
// 三个档位对应三类设备，每档给四组参数：像素比上限、后期等级、阴影贴图尺寸、
// 阴影窗口半宽。写进 localStorage 后下次进来直接生效，不用再靠帧率自适应摸。
//
// 为什么要有显式档位而不是纯自适应：自适应只在「已经卡了」之后才降，
// 玩家第一分钟就在掉帧。而低端机玩家通常知道自己机器弱，愿意主动选低画质
// 换取稳定的帧率 —— 这是玩家偏好问题，不是算法问题。

export const QUALITY_KEY = 'pvz.quality';

// 三档。auto 是「不指定，交给运行时探测 + 自适应降级」。
export const QUALITY_PRESETS = {
  auto: {
    label: '自动',
    pixelRatioCap: null, // 不设上限，沿用设备 DPR（触屏另有限制）
    postLevel: null,     // 不指定，交给 postLevelFromQuery / 自动探测
    shadowMapSize: null,
    shadowHalf: null,
  },
  high: {
    label: '高',
    pixelRatioCap: 2,
    postLevel: 2,        // Bloom + SSAO + ACES + 收尾
    shadowMapSize: 2048,
    shadowHalf: 22,
  },
  medium: {
    label: '中',
    pixelRatioCap: 1.5,
    postLevel: 1,        // ACES + 收尾（无 Bloom / SSAO）
    shadowMapSize: 1024,
    shadowHalf: 20,
  },
  low: {
    label: '低',
    pixelRatioCap: 1,
    postLevel: 0,        // 直出
    shadowMapSize: 512,
    shadowHalf: 18,
  },
};

export const QUALITY_ORDER = ['auto', 'high', 'medium', 'low'];

// 从存档读档位。非法值退回 auto。
export function readQuality(storage) {
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return 'auto';
    const v = store.getItem(QUALITY_KEY);
    if (v && QUALITY_PRESETS[v]) return v;
  } catch (e) {
    // 隐私模式下 localStorage 会抛异常
  }
  return 'auto';
}

// 写档位。失败静默（不影响游戏）。
export function writeQuality(id, storage) {
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store || !QUALITY_PRESETS[id]) return false;
    store.setItem(QUALITY_KEY, id);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 把档位解析成实际生效的参数。
 *
 * auto 保留调用方传入的探测值（触屏探测、?post= 覆盖），
 * 显式档位则覆盖它们 —— 玩家的选择优先于自动探测。
 *
 * @param {string} id  档位 id
 * @param {object} [detected] 自动探测的结果
 * @param {boolean} [detected.isTouch]
 * @param {number} [detected.devicePixelRatio]
 * @returns {{id:string, pixelRatioCap:number, postLevel:number|null, maxPostLevel:number, shadowMapSize:number|null, shadowHalf:number|null}}
 */
export function resolveQuality(id, detected = {}) {
  const key = QUALITY_PRESETS[id] ? id : 'auto';
  const p = QUALITY_PRESETS[key];
  const isTouch = !!detected.isTouch;
  const dpr = Number(detected.devicePixelRatio) || 1;

  // 触屏设备一律封到 1.5：手机上 2 倍 DPR 换来的清晰度不值得那个填充率
  const touchCap = isTouch ? 1.5 : 2;

  if (key === 'auto') {
    return {
      id: key,
      pixelRatioCap: Math.min(dpr, touchCap),
      postLevel: null,                        // 交给调用方的探测/URL 覆盖
      maxPostLevel: isTouch ? 1 : 2,
      shadowMapSize: null,
      shadowHalf: null,
    };
  }

  return {
    id: key,
    pixelRatioCap: Math.min(dpr, p.pixelRatioCap, touchCap),
    postLevel: p.postLevel,
    maxPostLevel: p.postLevel,
    shadowMapSize: p.shadowMapSize,
    shadowHalf: p.shadowHalf,
  };
}