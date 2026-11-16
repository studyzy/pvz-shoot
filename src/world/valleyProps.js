// Where the valley's solid props stand, as plain data.
//
// The trees and stones are grown procedurally by the render stack (trees.js / dressing.js), but the
// game also needs their collisions before — and without — a WebGL context: the client's collider
// list, the server's headless map (src/sim/headlessMap.js) and tools/extract-map-data.mjs all read
// from here. Keeping one copy of the generation means the player can never bump into an invisible
// trunk standing a metre away from the painted one.
//
// No three.js, no DOM: this module must stay importable from jsdom and Node.
import { fromValley, pathDistance, tarnDistance, TREE } from '../painted/valley/world.js';

const TAU = Math.PI * 2;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the trees stand: [x, z, kind, scale, turn]. Kind 0 is the great tree, 1..3 the trees inside
 * the walk; 4+ (planted by the render stack out on the plain) are past the walk and carry no collision.
 * Copied verbatim from painted-valley's src/valley/trees.js plant() — same seed, same order, so the
 * positions match the painted trunks exactly.
 */
export function valleyTrees() {
  const random = mulberry(20);
  const trees = [[TREE[0], TREE[1], 0, 1, 2.4]];
  const clear = (x, z, gap) => {
    if (tarnDistance(x, z) < 1.75 || pathDistance(x, z) < 6) return false;
    for (const t of trees) if (Math.hypot(t[0] - x, t[1] - z) < gap * (t[2] === 0 ? 5 : 1)) return false;
    return true;
  };
  const copse = (u, v, n, spread) => {
    const turn = random() * TAU;
    const long = 1.3 + 0.9 * random();
    let tries = 0;
    for (let i = 0; i < n && tries < n * 40; tries++) {
      const a = random() * TAU;
      const d = random() ** 0.7;
      const du = Math.cos(a) * d * spread * long;
      const dv = (Math.sin(a) * d * spread) / long;
      const [x, z] = fromValley(u + du * Math.cos(turn) - dv * Math.sin(turn), v + du * Math.sin(turn) + dv * Math.cos(turn));
      if (Math.hypot(x, z) > 596 || !clear(x, z, 4.4)) continue;
      trees.push([x, z, 1 + Math.floor(random() * 3), (1.95 - 1.05 * d) * (0.75 + 0.5 * random()), random() * TAU]);
      i++;
    }
  };
  const lone = (u, v) => {
    const [x, z] = fromValley(u, v);
    if (clear(x, z, 9)) trees.push([x, z, 1 + Math.floor(random() * 3), 1.9 + 0.5 * random(), random() * TAU]);
  };
  copse(118, -104, 8, 15);
  copse(72, 70, 7, 13);
  copse(150, -245, 12, 26);
  copse(75, 228, 10, 24);
  copse(-165, 50, 16, 34);
  copse(340, -262, 12, 26);
  copse(300, 286, 10, 24);
  copse(-70, -228, 9, 22);
  copse(505, 100, 9, 20);
  copse(548, -40, 9, 20);
  copse(476, -176, 7, 16);
  copse(290, -130, 8, 17);
  copse(300, 150, 6, 13);
  copse(170, 70, 5, 10);
  copse(440, 185, 6, 14);
  lone(232, 98);
  lone(125, -62);
  lone(400, -112);
  lone(346, -36);
  lone(520, 30);
  for (let k = 0; k < 12; k++) {
    const a = random() * TAU;
    copse((455 + 95 * random()) * Math.cos(a), (455 + 95 * random()) * Math.sin(a), 5 + Math.floor(random() * 9), 16 + 14 * random());
  }
  return trees;
}

/** The stones lying in the grass: [x, z, size, turn, kind, tall, lean] (dressing.js). */
export function valleyStones() {
  const random = mulberry(424);
  const groups = [
    [16, 12], [46, -24], [92, 34], [128, -78], [172, -38], [214, 38], [262, -92], [300, 22], [352, 74], [392, -16],
    [-28, -42], [62, 62], [458, 64], [122, 148], [204, -168], [36, -70], [330, -40], [246, 120],
    [8, -22], [74, -8], [108, -34], [146, 22], [190, -60], [236, 6], [282, 50], [372, 20], [420, 96], [30, 40],
  ];
  const stones = [];
  for (const [u, v] of groups) {
    const n = 3 + Math.floor(random() * 7);
    const spread = 4 + random() * 7;
    for (let i = 0; i < n; i++) {
      const a = random() * TAU;
      const d = spread * Math.sqrt(random());
      const [x, z] = fromValley(u + Math.cos(a) * d, v + Math.sin(a) * d);
      if (pathDistance(x, z) < 1.7 || tarnDistance(x, z) < 1.12) continue;
      const size = i < 2 ? 0.7 + 0.9 * random() : 0.2 + 0.45 * random();
      stones.push([x, z, size, random() * TAU, Math.floor(random() * 3), 0.7 + 0.5 * random(), (random() - 0.5) * 0.3]);
    }
  }
  return stones;
}

/** The stones big enough to block a walker: [x, z, gap] — same rule as the original main.js. */
export function valleyStonesSolid() {
  return valleyStones().filter((s) => s[2] > 0.6).map(([x, z, size]) => [x, z, size * 0.82]);
}

/**
 * 树干/石头的反弹体（walls 的圆柱格式）。契约测试要求每个碰撞球附近都有可见的实体；
 * 同时子弹打树干应该停住 —— 树是画出来的实物，不是空气。
 */
export function valleyPropWalls() {
  const out = [];
  for (const [x, z, kind, scale] of valleyTrees()) {
    if (!(kind <= 3)) continue;
    const s = scale || 1;
    out.push({ x, z, r: (kind === 0 ? 1.25 : 0.6) * s, h: kind === 0 ? 9 : Math.max(2.5, 7 * s) });
  }
  for (const [x, z, size] of valleyStones()) {
    if (size <= 0.6) continue;
    out.push({ x, z, r: size * 0.82, h: size * 1.6 });
  }
  return out;
}

/** Tree + stone colliders inside the walk, with the original demo's radii. */
export function valleyPropColliders() {
  const out = [];
  for (const [x, z, kind, scale] of valleyTrees()) {
    if (!(kind <= 3)) continue;
    out.push({ x, z, r: (kind === 0 ? 1.25 : 0.6) * (scale || 1) });
  }
  for (const [x, z, gap] of valleyStonesSolid()) out.push({ x, z, r: gap });
  return out;
}