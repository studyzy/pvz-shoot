// 压测页的纯计算：帧率统计、网格排布、相机取景、自动爬坡档位。
// 不碰 DOM / WebGL，由 tests/unit/stress.test.js 覆盖；WebGL 入口是 src/stress/main.js。

// 自动测极限的档位：前段细、后段粗，够快找到拐点又不至于测太久。
export const RAMP_STEPS = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];

// 每个档位先热身（等 shader 编译 / 贴图上传完），再采样；低于 failFps 就判定为掉帧。
// 45fps 与游戏里 trackPerformance 的自动降分辨率阈值同口径。
export const RAMP = { warmupMs: 2200, measureMs: 2500, failFps: 45 };

// 帧时间滑窗：只看最近 capacity 帧，掉帧后能较快反映出来，又不会被单帧毛刺带偏。
export class FrameStats {
  constructor(capacity = 90) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.frames = [];
  }

  reset() {
    this.frames.length = 0;
  }

  push(dt) {
    const ms = dt * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return;
    // 切标签页回来时 rAF 会给出几秒的巨大间隔，按 1 秒封顶，避免一个毛刺毁掉整窗
    this.frames.push(Math.min(ms, 1000));
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  get count() {
    return this.frames.length;
  }

  get avgMs() {
    if (!this.frames.length) return 0;
    let sum = 0;
    for (let i = 0; i < this.frames.length; i++) sum += this.frames[i];
    return sum / this.frames.length;
  }

  get fps() {
    const avg = this.avgMs;
    return avg > 0 ? 1000 / avg : 0;
  }

  get p95Ms() {
    if (!this.frames.length) return 0;
    const sorted = this.frames.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  }

  get worstMs() {
    if (!this.frames.length) return 0;
    let max = 0;
    for (let i = 0; i < this.frames.length; i++) if (this.frames[i] > max) max = this.frames[i];
    return max;
  }

  summary() {
    return { frames: this.count, fps: this.fps, avgMs: this.avgMs, p95Ms: this.p95Ms, worstMs: this.worstMs };
  }
}

// 把 N 只僵尸排成接近 16:9 的方格：列比行多，镜头从斜上方看过去刚好铺满画面。
export function gridLayout(count, spacing = 1.5) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const step = Math.max(0.5, Number(spacing) || 1.5);
  if (n === 0) return { cols: 0, rows: 0, width: 0, depth: 0, positions: [] };
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.9));
  const rows = Math.ceil(n / cols);
  const positions = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    positions.push({
      x: (c - (cols - 1) / 2) * step,
      z: (r - (rows - 1) / 2) * step,
    });
  }
  return { cols, rows, width: cols * step, depth: rows * step, positions };
}

// 让整块方阵刚好入镜：横向按宽度，纵向按"进深被俯角压扁 + 模型高度"算。
// 用包围球会保守很多（方阵是扁的），摆 8 只时画面一半是空地；这里按投影尺寸算更贴。
export function fitCamera({
  width = 1,
  depth = 1,
  height = 2.2,
  fov = 45,
  aspect = 1,
  elevation = 0.67,
} = {}) {
  const vFov = (fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.35, aspect));
  const elev = Math.min(1.35, Math.max(0.08, elevation));
  const pad = 1.1;
  const halfW = Math.max(0.5, width / 2);
  const halfD = Math.max(0.5, depth / 2);
  const halfH = Math.max(0.5, height / 2);
  const distH = (halfW + pad) / Math.tan(hFov / 2);
  const distV = (halfD * Math.sin(elev) + halfH * Math.cos(elev) + pad) / Math.tan(vFov / 2);
  return {
    distance: Math.max(distH, distV) + halfD * Math.cos(elev),
    targetY: Math.max(0.65, halfH),
  };
}

// 帧率分档只管绝对帧率：120Hz 设备跑满 60 也算流畅，因为游戏本身的目标就是 60。
export const VERDICTS = [
  { id: 'smooth', min: 55, label: '流畅' },
  { id: 'light', min: 40, label: '轻微掉帧' },
  { id: 'heavy', min: 25, label: '明显卡顿' },
  { id: 'bad', min: -Infinity, label: '不可玩' },
];

export function verdictFor(fps) {
  const v = Number(fps) || 0;
  return VERDICTS.find((level) => v >= level.min);
}

// 三角面/绘制数用短单位，面板上不跳长度。
export function shortNumber(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
  return String(Math.round(v));
}

// 自动爬坡：当前档位 -> 下一档；到顶返回 null。
export function nextRampStep(current) {
  const idx = RAMP_STEPS.indexOf(current);
  if (idx < 0) return RAMP_STEPS[0];
  return idx + 1 < RAMP_STEPS.length ? RAMP_STEPS[idx + 1] : null;
}
