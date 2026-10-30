import { SUN_SKY } from '../config.js';
import { rand } from '../utils.js';

// 天降阳光：按固定间隔在三张地图范围内随机落下一颗。
// 只是小福利（每 30 秒 1 颗 = 0.167 阳光/秒），主收入仍然来自击杀掉落。
export class SkySun {
  constructor(ctx) {
    this.ctx = ctx;
    this.elapsed = 0;
    // 双人 22 s、单人 30 s（Game.resetRun 按模式写入）
    this.interval = SUN_SKY.interval;
  }

  reset() {
    this.elapsed = 0;
  }

  update(dt) {
    const map = this.ctx.map;
    if (!map || !map.bounds) return;
    // 累加而非减法：避免浮点累积误差让计时永远差一点点
    this.elapsed += dt;
    if (this.elapsed < this.interval) return;
    this.elapsed -= this.interval;
    if (this.elapsed < 0) this.elapsed = 0;

    const b = map.bounds;
    const m = SUN_SKY.edgeMargin;
    // bounds 是半边长 { x, z }，随机点限制在离边缘 edgeMargin 以内。
    // 极小的图（半边长 < margin）要把 margin 收回来，否则区间反转会刷到界外。
    const mx = Math.min(m, Math.max(0, b.x * 0.5));
    const mz = Math.min(m, Math.max(0, b.z * 0.5));
    const x = rand(-b.x + mx, b.x - mx);
    const z = rand(-b.z + mz, b.z - mz);
    this.ctx.sunOrbs.spawnSky(x, z);
  }
}