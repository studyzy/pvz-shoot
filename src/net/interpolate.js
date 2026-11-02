// 实体插值：把 30Hz 的权威快照渲染成 60fps 的平滑运动。
//
// 这是「客人看着卡」的直接解药。原来的实现是收一包快照就直接 set 位置
// （Zombie.applyNetState → root.position = 快照值），20Hz 抖动 + 无插值 =
// 每 50~80ms 一次跳变，肉眼就是幻灯片。
//
// 插值原理：渲染时刻比服务器时间晚 INTERP_DELAY，在最近两帧快照之间做线性插值。
// 代价是固定的延迟，收益是永远有「未来的一帧」可以插，网络抖动被吸收掉。
// 延迟可自适应：抖动大时自动加大缓冲。

export const INTERP_DELAY_MS = 100;

// 环形缓冲：只保留最近 N 帧快照
const BUFFER_SIZE = 24;

export class SnapshotBuffer {
  constructor() {
    this.frames = [];
    this.delayMs = INTERP_DELAY_MS;
    this.jitterAvg = 0;
    this.lastArriveAt = 0;
  }

  push(snap) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // 测量到达间隔的抖动，用来自适应缓冲深度
    if (this.lastArriveAt) {
      const gap = now - this.lastArriveAt;
      const expect = 1000 / 30;
      const dev = Math.abs(gap - expect);
      this.jitterAvg = this.jitterAvg * 0.9 + dev * 0.1;
    }
    this.lastArriveAt = now;

    this.frames.push({ snap, at: now });
    if (this.frames.length > BUFFER_SIZE) this.frames.shift();

    // 抖动越大，缓冲越深（上限 200ms）
    if (this.frames.length > 6) {
      const target = Math.min(200, INTERP_DELAY_MS + this.jitterAvg * 1.5);
      this.delayMs = this.delayMs * 0.95 + target * 0.05;
    }
  }

  get latest() {
    return this.frames.length ? this.frames[this.frames.length - 1].snap : null;
  }

  get empty() {
    return this.frames.length === 0;
  }

  get frameCount() {
    return this.frames.length;
  }

  clear() {
    this.frames.length = 0;
    this.lastArriveAt = 0;
  }

  /**
   * 取「渲染时刻」对应的插值状态。
   * 不够两帧时退化为最新一帧（开局那 100ms）。
   */
  sample(nowMs) {
    const n = this.frames.length;
    if (n === 0) return null;
    if (n === 1) return this.frames[0].snap;

    const renderAt = nowMs - this.delayMs;
    // 找到第一帧比 renderAt 新的
    let hi = n - 1;
    for (let i = 0; i < n; i++) {
      if (this.frames[i].at > renderAt) {
        hi = i;
        break;
      }
    }
    if (hi === 0) return this.frames[0].snap; // 还没追上
    const lo = hi - 1;
    const a = this.frames[lo];
    const b = this.frames[hi];
    const span = b.at - a.at;
    let t = span > 0 ? (renderAt - a.at) / span : 1;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return blendSnapshot(a.snap, b.snap, t);
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 角度插值要走最短弧，否则 +π 到 -π 会整圈转过去
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function blendSnapshot(a, b, t) {
  if (!a) return b;
  if (!b || t <= 0) return a;
  if (t >= 1) return b;

  const players = a.players.map((pa, i) => {
    const pb = (b.players && b.players[i]) || pa;
    return {
      ...pb,
      x: lerp(pa.x, pb.x, t),
      y: lerp(pa.y, pb.y, t),
      z: lerp(pa.z, pb.z, t),
      yaw: lerpAngle(pa.yaw, pb.yaw, t),
      pitch: lerp(pa.pitch, pb.pitch, t),
      hp: pb.hp,
      downed: pb.downed,
      dead: pb.dead,
      downTimer: pb.downTimer,
    };
  });

  // 僵尸按 id 配对：新出现的直接用 b 的位置，消失的不返回（由调用方做移除）
  const mapA = new Map(a.zombies.map((z) => [z.id, z]));
  const zombies = b.zombies.map((zb) => {
    const za = mapA.get(zb.id);
    if (!za) return zb;
    return {
      ...zb,
      x: lerp(za.x, zb.x, t),
      y: lerp(za.y, zb.y, t),
      z: lerp(za.z, zb.z, t),
      yaw: lerpAngle(za.yaw, zb.yaw, t),
      // 血量/状态不插值，直接取权威值
      hp: zb.hp,
      st: zb.st,
      sl: zb.sl,
      ar: zb.ar,
    };
  });

  return { ...b, players, zombies };
}