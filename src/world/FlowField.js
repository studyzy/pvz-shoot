import { clamp } from '../utils.js';

// 1 米网格流场：从玩家所在格做 BFS，给僵尸输出逐格方向。
// 只处理平面（僵尸不会跳），被 platforms 覆盖的格子一律视为障碍。
export class FlowField {
  constructor(halfX, halfZ, cell = 1) {
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.cell = cell;
    this.cols = Math.ceil((halfX * 2) / cell);
    this.rows = Math.ceil((halfZ * 2) / cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.dirX = new Float32Array(n);
    this.dirZ = new Float32Array(n);
    this.queue = new Int32Array(n);
    this.cx = -9999;
    this.cz = -9999;
    this.timer = 0;
  }

  // 0.55 米的 padding 让僵尸提前绕开障碍，避免贴脸卡住。
  blockPlatforms(platforms) {
    const cols = this.cols;
    const rows = this.rows;
    const cell = this.cell;
    const blocked = this.blocked;
    const halfX = this.halfX;
    const halfZ = this.halfZ;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const x0 = Math.floor((p.x - p.w * 0.5 - 0.55 + halfX) / cell);
      const x1 = Math.floor((p.x + p.w * 0.5 + 0.55 + halfX) / cell);
      const z0 = Math.floor((p.z - p.d * 0.5 - 0.55 + halfZ) / cell);
      const z1 = Math.floor((p.z + p.d * 0.5 + 0.55 + halfZ) / cell);
      for (let z = Math.max(0, z0); z <= Math.min(rows - 1, z1); z++) {
        for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) {
          blocked[z * cols + x] = 1;
        }
      }
    }
  }

  update(x, z, dt) {
    this.timer -= dt;
    const cols = this.cols;
    const rows = this.rows;
    const cell = this.cell;
    const blocked = this.blocked;
    const cx = clamp(Math.floor((x + this.halfX) / cell), 0, cols - 1);
    const cz = clamp(Math.floor((z + this.halfZ) / cell), 0, rows - 1);
    if (cx === this.cx && cz === this.cz && this.timer > 0) return;
    this.cx = cx;
    this.cz = cz;
    this.timer = 0.45;

    let sx = cx;
    let sz = cz;
    if (blocked[cz * cols + cx]) {
      let best = Infinity;
      sx = -1;
      for (let zz = 0; zz < rows; zz++) {
        for (let xx = 0; xx < cols; xx++) {
          if (blocked[zz * cols + xx]) continue;
          const d = (xx - cx) * (xx - cx) + (zz - cz) * (zz - cz);
          if (d < best) {
            best = d;
            sx = xx;
            sz = zz;
          }
        }
      }
      if (sx < 0) return;
    }

    const dist = this.dist;
    const queue = this.queue;
    dist.fill(-1);
    let head = 0;
    let tail = 0;
    const start = sz * cols + sx;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      const idx = queue[head++];
      const gx = idx % cols;
      const gz = (idx / cols) | 0;
      const d = dist[idx];
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oz === 0) continue;
          const nx = gx + ox;
          const nz = gz + oz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (blocked[ni] || dist[ni] >= 0) continue;
          dist[ni] = d + 1;
          queue[tail++] = ni;
        }
      }
    }

    this.dirX.fill(0);
    this.dirZ.fill(0);
    for (let zz = 0; zz < rows; zz++) {
      for (let xx = 0; xx < cols; xx++) {
        const idx = zz * cols + xx;
        if (blocked[idx] || dist[idx] <= 0) continue;
        let bestD = dist[idx];
        let bx = 0;
        let bz = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oz === 0) continue;
            const nx = xx + ox;
            const nz = zz + oz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            const ni = nz * cols + nx;
            if (blocked[ni]) continue;
            if (dist[ni] >= 0 && dist[ni] < bestD) {
              bestD = dist[ni];
              bx = ox;
              bz = oz;
            }
          }
        }
        if (bx !== 0 || bz !== 0) {
          const len = Math.hypot(bx, bz);
          this.dirX[idx] = bx / len;
          this.dirZ[idx] = bz / len;
        }
      }
    }
  }

  flowAt(x, z, out) {
    const cx = Math.floor((x + this.halfX) / this.cell);
    const cz = Math.floor((z + this.halfZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
    const idx = cz * this.cols + cx;
    if (this.blocked[idx]) return false;
    const dx = this.dirX[idx];
    const dz = this.dirZ[idx];
    if (dx === 0 && dz === 0) return false;
    out.x = dx;
    out.z = dz;
    return true;
  }
}
