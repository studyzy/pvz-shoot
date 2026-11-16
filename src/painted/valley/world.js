// The valley: you start on the shoulder of a hill beside one great tree, the land falls away ahead to a tarn on
// the valley floor, wooded hills close it in on both sides and behind, and far off, past a plain of fields, are
// mountains. Plain functions of (x, z), read once by the field and by the far land.

/** The way the valley runs from the start, a unit vector (x, z). */
export const HERO = [0.6, 0.8];
const [DX, DZ] = HERO;

/** Where you start, the great tree, and the tarn: [x, z]. */
export const START = [0, 0];
export const TREE = fromValley(9, -13);
/** Where the village stands, (u, v): near enough to be seen as a village, on a rise of its own. */
export const VILLAGE = [740, -210];
export const TARN = { at: fromValley(415, 38), rx: 46, rz: 27, level: 0 };

/** (metres down the valley, metres to the right of it) to (x, z). */
export function fromValley(u, v) {
  return [u * DX - v * DZ, u * DZ + v * DX];
}

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** 0 to 1, mostly near 0.5. */
export function fbm(x, z, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x, z, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 11.7;
    z = z * 2.03 - 5.3;
  }
  return sum / norm;
}

/** Sharp crests and broad flanks, 0 to 1: mountains. */
function ridged(x, z, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * vnoise(x, z, seed + o * 13) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.42;
    x = x * 2.07 + 3.1;
    z = z * 2.07 - 8.9;
  }
  return sum / norm;
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 in the middle of the tarn, 1 at its shore, more outside. */
export function tarnDistance(x, z) {
  const dx = x - TARN.at[0];
  const dz = z - TARN.at[1];
  // its long side lies across the valley, and its shore wanders
  const u = dx * DX + dz * DZ;
  const v = -dx * DZ + dz * DX;
  const wobble = 1 + 0.16 * Math.sin(Math.atan2(u, v) * 3 + 0.7) + 0.09 * Math.sin(Math.atan2(u, v) * 7 + 2.1);
  return Math.hypot(v / TARN.rx, u / TARN.rz) / wobble;
}

/** Where the river runs: metres to the right of the valley's line, at u metres down it. */
function riverLine(u) {
  return 60 + 330 * Math.sin(u / 520 + 0.6) + 80 * Math.sin(u / 170 + 2) + 900 * Math.exp(-Math.max(u, -400) / 350);
}

/** How far (x, z) is from the middle of the river, metres. */
export function riverDistance(x, z) {
  const u = x * DX + z * DZ;
  const v = -x * DZ + z * DX;
  const slope = (330 / 520) * Math.cos(u / 520 + 0.6) + (80 / 170) * Math.cos(u / 170 + 2) - (u > -400 ? (900 / 350) * Math.exp(-u / 350) : 0);
  return Math.abs(v - riverLine(u)) / Math.sqrt(1 + slope * slope);
}

/** 0 to 1: how much of the far land at (x, z) is ploughed and hedged, the fields round the hamlet. */
export function fieldsAt(x, z) {
  const u = x * DX + z * DZ;
  const v = -x * DZ + z * DX;
  const d = Math.hypot((u - 1350) / 1000, (v + 60) / 820) + (fbm(x / 600 + 4, z / 600 + 8, 2, 83) - 0.5) * 0.4;
  // (it begins a little way past where the walk ends)
  return (1 - smooth(0.8, 1.0, d)) * smooth(545, 640, Math.hypot(x, z));
}

/** 0 to 1: forest on the far land at (x, z). None near the walk, none on the fields or the river's banks. */
export function forestAt(x, z) {
  const r = Math.hypot(x, z);
  let f = smooth(0.44, 0.52, fbm(x / 1700 + 7.3, z / 1700 + 3.1, 4, 91) * 0.72 + fbm(x / 430 + 1.7, z / 430 + 5.9, 3, 97) * 0.28);
  // the hills carry more of it than the plain
  f = Math.max(f, smooth(55, 120, land(x, z)) * smooth(0.36, 0.5, fbm(x / 900 + 2.2, z / 900 + 6.1, 3, 101)));
  f *= smooth(820, 1500, r) * smooth(30, 170, riverDistance(x, z)) * (1 - fieldsAt(x, z));
  return f;
}

function rawLand(x, z) {
  const u = x * DX + z * DZ;
  const v = -x * DZ + z * DX;
  const r = Math.hypot(x, z);
  // rolling ground, calmer where you start so the crest is one clean line against the sky
  let h = (fbm(x / 260 + 3.1, z / 260 - 1.7, 4, 1) - 0.5) * 20 * (0.25 + 0.75 * smooth(60, 420, r));
  h += (fbm(x / 70 + 9.3, z / 70 + 4.1, 3, 5) - 0.5) * 3.0;
  // rises and hollows a stone's throw across, so the meadow is a land of its own and not one sheet (they die away
  // on the far plain, which is too coarsely made to carry them)
  let roll = (fbm(x / 120 + 1.7, z / 120 + 6.3, 2, 13) - 0.5) * 24 * smooth(14, 90, r) * (1 - smooth(900, 1800, r));
  roll += (fbm(x / 48 + 8.1, z / 48 + 2.9, 2, 17) - 0.5) * 5.5 * smooth(10, 50, r) * (1 - smooth(500, 900, r));
  // (down the middle of the view from the start they may dip but not rise: the valley is what is to be seen, and the
  // rises stand to either side of it)
  if (roll > 0) roll *= 1 - 0.9 * Math.exp(-((v / 95) ** 2)) * smooth(0, 40, u) * (1 - smooth(300, 460, u));
  h += roll;
  // the hill you start on, a long shoulder
  h += 54 * Math.exp(-((u + 30) ** 2) / (2 * 185 ** 2) - (v * v) / (2 * 330 ** 2));
  // the village's rise
  h += 17 * Math.exp(-((u - VILLAGE[0]) ** 2 + (v - VILLAGE[1]) ** 2) / (2 * 95 ** 2));
  // the valley floor, a broad shallow dish round the tarn
  h -= 5 * Math.exp(-((u - 420) ** 2) / (2 * 160 ** 2) - ((v - 40) ** 2) / (2 * 220 ** 2));
  // wooded hills to either side, and behind
  const side = Math.abs(v) + 160 * (fbm(u / 520 + 5, v / 520, 2, 31) - 0.5);
  h += 120 * smooth(430, 1500, side) * (0.6 + 0.8 * fbm(x / 800 + 2, z / 800 + 9, 3, 37));
  h += 95 * smooth(260, 1200, -u);
  // a river crosses the plain to the right of the walk: the land lies down to it
  const river = riverDistance(x, z);
  if (river < 420) {
    const level = -9 - u * 0.0035;
    // (only across low ground: where its line meets the hills it is lost behind them, not cut through them)
    h += (level - h) * Math.exp(-(river * river) / (2 * 150 * 150)) * (1 - smooth(22, 60, h));
  }
  return h;
}

// pvz-shoot: the playable arena is a flat y=0 disc at the origin. The engine has no terrain-height
// system (Player/Zombie/projectiles all assume a flat floor), so the valley is rebased to the height
// at (0,0) and flattened inside 28 m, blending back to the real hills from 28 to 80 m. Everything
// downstream (TARN.level, village, trees, horizon, the baked field maps) reads land()/heightAt(),
// so all of it follows this one change.
const ARENA_BASE = rawLand(0, 0);
function land(x, z) {
  const h = rawLand(x, z) - ARENA_BASE;
  const flat = 1 - smooth(28, 80, Math.hypot(x, z));
  const keep = 1 - flat;
  return keep === 0 ? 0 : h * keep; // 显式返回 +0，别让 -0 漏到高度图里
}

const tarnFloor = land(TARN.at[0], TARN.at[1]);
TARN.level = tarnFloor - 0.55;

export function heightAt(x, z) {
  let h = land(x, z);
  const t = tarnDistance(x, z);
  if (t < 2.2) {
    // level ground round the water, a bank, and a bed that deepens to the middle
    const flat = 1 - smooth(1.25, 2.2, t);
    h += (tarnFloor - h) * flat;
    h -= 2.4 * (1 - smooth(0.25, 1.06, t));
  }
  return h;
}

/** How far (x, z) is from the middle of the nearest footpath, metres. */
export function pathDistance(x, z) {
  const u = x * DX + z * DZ;
  const v = -x * DZ + z * DX;
  let best = 1e3;
  // one runs from the tree down to the tarn
  if (u >= -60 && u <= 372) {
    const pv = -4 + 30 * Math.sin(u / 95) + 9 * Math.sin(u / 37 + 1.3) + (u / 372) * 22;
    const slope = (30 / 95) * Math.cos(u / 95) + (9 / 37) * Math.cos(u / 37 + 1.3) + 22 / 372;
    // it peters out at both ends
    const ends = Math.max(0, 14 - (u + 60), 14 - (372 - u)) * 0.12;
    best = Math.abs(v - pv) / Math.sqrt(1 + slope * slope) + ends;
  }
  // a second crosses it on the slope, from the groves on one side of the valley to those on the other
  if (v > -250 && v < 280) {
    const pu = 236 + 34 * Math.sin(v / 80 + 0.6) + 10 * Math.sin(v / 29);
    const slope = (34 / 80) * Math.cos(v / 80 + 0.6) + (10 / 29) * Math.cos(v / 29);
    const ends = Math.max(0, 14 - (v + 250), 14 - (280 - v)) * 0.12;
    best = Math.min(best, Math.abs(u - pu) / Math.sqrt(1 + slope * slope) + ends);
  }
  // and a third leaves the tarn for the road to the village
  if (u > 428 && u < 640) {
    const pv = -30 - (u - 428) * 0.7 + 9 * Math.sin(u / 24);
    const slope = -0.7 + (9 / 24) * Math.cos(u / 24);
    const ends = Math.max(0, 14 - (u - 428)) * 0.12;
    best = Math.min(best, Math.abs(v - pv) / Math.sqrt(1 + slope * slope) + ends);
  }
  return best;
}

export function paint(x, z) {
  // lush nearly everywhere: summer. A little straw on the driest shoulders.
  const dry = 0.1 + 0.34 * smooth(0.52, 0.78, fbm(x / 90 + 2.2, z / 90 + 8.1, 3, 21));
  const t = tarnDistance(x, z);
  const wet = Math.max(smooth(0.66, 0.74, fbm(x / 47 + 5.5, z / 47 + 9.9, 2, 33)) * 0.6, 1 - smooth(1.0, 1.7, t));
  let growth = 1;
  // a footpath worn to earth, its edges ragged
  const path = pathDistance(x, z);
  growth = Math.min(growth, smooth(0.42, 1.1, path + (fbm(x / 2.7, z / 2.7, 2, 61) - 0.5) * 0.7));
  // nothing grows under the water
  growth = Math.min(growth, smooth(0.8, 0.86, t + (fbm(x / 3.3, z / 3.3, 2, 67) - 0.5) * 0.04));
  // flowers in drifts, thickest on the slope below the start and round the tarn
  const u = x * DX + z * DZ;
  const v = -x * DZ + z * DX;
  const slope = Math.exp(-((u - 150) ** 2) / (2 * 80 ** 2) - ((v + 70) ** 2) / (2 * 120 ** 2));
  const shore = Math.exp(-((u - 390) ** 2) / (2 * 80 ** 2) - ((v - 50) ** 2) / (2 * 120 ** 2));
  const flowers = Math.min(1, smooth(0.4, 0.68, fbm(x / 38 - 6, z / 38 + 3, 2, 55)) * 0.75 + slope * 0.9 + shore * 0.7);
  return { dry: dry * (1 - wet), growth, wet, flowers };
}
