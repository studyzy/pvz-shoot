
// 投掷物用的静态挡板：地图 this.walls（盒体 OBB / 立地圆柱）+ 外圈围栏兜底。
// 撞击后按能量损失做一次反射：法线 40%、切线 95%，撞一两次就明显减速，不会在墙角弹一辈子。
const EPS = 1e-4;
const REST_N = 0.4;
const REST_T = 0.95;
const MIN_SPEED = 2.5;

export function bounceVel(v, nx, ny, nz) {
  const vn = v.x * nx + v.y * ny + v.z * nz;
  const tx = v.x - vn * nx;
  const ty = v.y - vn * ny;
  const tz = v.z - vn * nz;
  const kn = Math.abs(vn) < MIN_SPEED ? 0 : REST_N;
  v.set(tx * REST_T + vn * kn * nx, ty * REST_T + vn * kn * ny, tz * REST_T + vn * kn * nz);
}

// 水平面上的圆：线段 (a,b) 的 xz 投影第一次进入以 (cx,cz) 为心、半径 radius 的圆时的比例，
// 没有命中返回 -1。圆柱挡板用它，省掉 y 方向那一段不用算。
function segmentCircleT(a, b, cx, cz, radius) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const fx = a.x - cx;
  const fz = a.z - cz;
  const qa = dx * dx + dz * dz;
  const qc = fx * fx + fz * fz - radius * radius;
  if (qa < 1e-9) return qc <= 0 ? 0 : -1;
  const qb = 2 * (fx * dx + fz * dz);
  let disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-qb - disc) / (2 * qa);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-qb + disc) / (2 * qa);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

// 球（半径 r）从 a 扫到 b，返回最早撞墙的比例 t∈[0,1]，没撞到返回 -1；法线写入 out。
export function sweepWalls(walls, halfX, halfZ, a, b, r, out) {
  let best = 2;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.r !== undefined) {
      // 竖直圆柱只看水平距离：等价于球心在一个以圆柱轴为心、半径 r+球半径 的无限高圆柱里。
      const t = segmentCircleT(a, b, w.x, w.z, w.r + r);
      if (t < 0 || t >= best) continue;
      if (a.y + (b.y - a.y) * t > w.h + r) continue;
      const px = a.x + (b.x - a.x) * t - w.x;
      const pz = a.z + (b.z - a.z) * t - w.z;
      const d = Math.hypot(px, pz);
      if (d < EPS) continue;
      best = t;
      out.x = px / d;
      out.y = 0;
      out.z = pz / d;
      continue;
    }

    // 球心离开「盒体外扩 r」的条数变化只发生在贴着盒面的平面上，所以分轴解是精确的。
    const lx = (a.x - w.x) * w.c - (a.z - w.z) * w.s;
    const lz = (a.x - w.x) * w.s + (a.z - w.z) * w.c;
    const ly = a.y - w.y;
    const dx = (b.x - a.x) * w.c - (b.z - a.z) * w.s;
    const dz = (b.x - a.x) * w.s + (b.z - a.z) * w.c;
    const dy = b.y - a.y;

    const o = [lx, ly, lz];
    const d = [dx, dy, dz];
    const h = [w.hx + r, w.hy + r, w.hz + r];
    let tEnter = -Infinity;
    let tExit = Infinity;
    let axis = -1;
    let sign = 0;
    let outside = false;

    for (let k = 0; k < 3; k++) {
      if (d[k] === 0) {
        // 该轴方向不移动：球心距离只要超出盒面就是平行掠过，整条线段都不相交。
        if (o[k] <= -h[k] || o[k] >= h[k]) { outside = true; break; }
        continue;
      }
      const b0 = (-h[k] - o[k]) / d[k];
      const b1 = (h[k] - o[k]) / d[k];
      const s = b0 > b1 ? 1 : -1;
      const t1 = s > 0 ? b1 : b0;
      const t2 = s > 0 ? b0 : b1;
      if (t1 > tEnter) { tEnter = t1; axis = k; sign = s; }
      if (t2 < tExit) tExit = t2;
    }
    if (outside || tEnter > tExit) continue;
    const t = tEnter < 0 ? 0 : tEnter;
    if (t > 1 || t >= best) continue;
    best = t;
    if (axis === 0) {
      out.x = sign * w.c;
      out.y = 0;
      out.z = -sign * w.s;
    } else if (axis === 1) {
      out.x = 0;
      out.y = sign;
      out.z = 0;
    } else {
      out.x = sign * w.s;
      out.y = 0;
      out.z = sign * w.c;
    }
  }

  // 外圈围栏：后院没有四面实体墙，靠这里兜底，保证任何弹道都出不了场地。
  if (Math.abs(a.x) <= halfX - r && Math.abs(a.z) <= halfZ - r) {
    const ux = Math.abs(a.x);
    const uz = Math.abs(a.z);
    if (Math.abs(b.x) > halfX - r) {
      const t = (halfX - r - ux) / (Math.abs(b.x) - ux);
      if (t <= 1 && t < best) { best = t; out.x = b.x > 0 ? 1 : -1; out.y = 0; out.z = 0; }
    }
    if (Math.abs(b.z) > halfZ - r) {
      const t = (halfZ - r - uz) / (Math.abs(b.z) - uz);
      if (t <= 1 && t < best) { best = t; out.x = 0; out.y = 0; out.z = b.z > 0 ? 1 : -1; }
    }
  }
  return best <= 1 ? best : -1;
}