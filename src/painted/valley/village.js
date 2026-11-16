// The village, and every other building in the valley: a few kinds of house, a church, a round tower with a dome
// and a slim one with a pointed cap, painted the way a far village is in a background. Each wall is in the light or
// in blue shade with a clean turn between, eaves throw a line of shadow, windows are dark dabs in rows, and no two
// houses are quite the same cream or the same red. They are drawn a size or two bigger than life, as a painter
// draws a far village so that it reads.
import * as THREE from 'three';
import { COMMON } from '../lib/index.js';
import { fromValley, heightAt, VILLAGE } from './world.js';

const TAU = Math.PI * 2;

/** Half the village's length down the valley and across it, metres. */
export const VILLAGE_SIZE = [72, 88];

const vertex = /* glsl */ `
${COMMON}
in float aPart;
in float aUp;
in vec2 aFace;
in vec3 aRoof;
in vec3 aWall;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec4 vOwn;    // where on the building, in its own metres; what it is: 0 wall, 1 roof, 2 chimney
out vec3 vOwnN;
out vec2 vUp;     // a wall: 0 at its foot to 1 at the eaves (below 0: a gable end or a plain thing). A roof: 0 at the eaves to 1 at the ridge. And a number of the building's own.
out vec2 vFace;   // along the wall from its middle, metres, and half its length (800 and over: not known)
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(m) * normal);
  vOwn = vec4(position, aPart);
  vOwnN = normal;
  vUp = vec2(aUp, fract(m[3].x * 0.37 + m[3].z * 0.71));
  vFace = aFace;
  // (a chimney is brick: something of the roof's colour, greyer)
  vColor = aPart > 1.5 ? mix(aRoof * 0.8, vec3(0.5, 0.42, 0.38), 0.5) : aPart > 0.5 ? aRoof : aWall;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragment = /* glsl */ `
${COMMON}
layout(location = 0) out vec4 outC;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec4 vOwn;
in vec3 vOwnN;
in vec2 vUp;
in vec2 vFace;
void main() {
  vec3 N = normalize(vNormal);
  // in the light or out of it, with a clean turn between: that is what makes a far house a solid thing
  // (a painter turns the light on a far village so that the walls you see are mostly the sunlit ones: the sun, brought
  // a little round towards where the walk is)
  vec3 L = normalize(uSunDir - normalize(vec3(vWorld.x, 0.0, vWorld.z)) * 0.75);
  float lit = smoothstep(0.02, 0.12, dot(N, L)) * smoothstep(0.4, 0.8, cloudAt(vWorld.xz));
  float seed = vUp.y;
  // along the wall or roof
  float run = vFace.y < 800.0 ? vFace.x : abs(vOwnN.x) > abs(vOwnN.z) ? vOwn.z : vOwn.x;
  // metres of the building to a pixel here: fine things are dropped where they would be smaller than one
  float px = max(fwidth(run), fwidth(vOwn.y));
  // the brush: dabs and a slow wash, laid on the face itself
  float dabs = texture(tStrokes, vec2(run, vOwn.y) / 7.0 + seed * 3.7).r - 0.5;
  float wash = texture(tNoise, vec2(run * 0.11 + seed * 5.0, vOwn.y * 0.17)).r - 0.5;
  vec3 paint = vColor;
  float shadeOnly = 1.0;
  if (vOwn.w > 0.5 && vOwn.w < 1.5) {
    if (vUp.x > -0.5) {
      float u = vUp.x;
      // tiles in courses, every tile a touch its own red, each course shading the one below
      float rows = 3.4;
      float fine = 1.0 - smoothstep(0.22, 0.55, px * rows);
      float cy = vOwn.y * rows;
      float course = floor(cy);
      float tile = hash12(vec2(floor(run * 2.6 + mod(course, 2.0) * 0.5), course) + seed * 91.0);
      paint *= mix(1.0, (0.76 + 0.48 * tile) * (0.78 + 0.22 * smoothstep(0.0, 0.25, fract(cy))), fine);
      // bleached and yellower towards the ridge, deeper at the eaves; patches of older tile; moss low on it
      paint *= mix(0.84, 1.1, u) * (1.0 + dabs * 0.2 + wash * 0.36);
      paint = mix(paint, paint * vec3(1.14, 1.05, 0.84), smoothstep(0.45, 1.0, u) * 0.5);
      paint = mix(paint, vec3(0.3, 0.34, 0.14), smoothstep(0.1, 0.3, wash) * (1.0 - smoothstep(0.0, 0.55, u)) * 0.45);
      // a line of cap tiles along the ridge, and a dark edge where the eaves end
      paint *= 1.0 + 0.16 * smoothstep(0.93, 0.96, u);
      paint *= 1.0 - 0.38 * (1.0 - smoothstep(0.0, 0.045, u));
    }
  } else if (vOwn.w > 1.5) {
    paint *= 0.9 + dabs * 0.36;
  } else if (vUp.x > -0.5) {
    // a gable end is wall with no storeys to it
    float up = vUp.x < 0.0 ? 1.0 : vUp.x;
    // limewash gone uneven: warmer and darker where damp climbs, a stained foot, rain streaks under the eaves
    paint *= 1.0 + dabs * 0.17 + wash * 0.16;
    paint *= mix(vec3(0.88, 0.85, 0.78), vec3(1.0), smoothstep(0.0, 0.55, up));
    paint = mix(paint, paint * vec3(0.6, 0.58, 0.52), 1.0 - smoothstep(0.02, 0.09, up));
    float streak = texture(tNoise, vec2(run * 0.9 + seed * 7.0, vOwn.y * 0.05)).g;
    paint *= 1.0 - (vUp.x < 0.0 ? 0.05 : 0.1) * smoothstep(0.52, 0.72, streak) * smoothstep(0.45, 0.95, up);
    if (vUp.x < 0.0) {
      // a small window up in the gable
      float gh = (-vUp.x - 0.25) / 0.2;
      float attic = step(abs(run), 0.42) * step(0.2, gh) * step(gh, 0.46) * step(vFace.y, 500.0);
      float frame = step(abs(run), 0.56) * step(0.16, gh) * step(gh, 0.5) * step(vFace.y, 500.0);
      paint = mix(paint, vColor * 1.08, frame);
      paint = mix(paint, vec3(0.09, 0.11, 0.17), attic);
    }
    // a drawn line down each corner of the wall
    float known = step(vFace.y, 500.0);
    paint *= 1.0 - 0.22 * known * smoothstep(vFace.y - 0.22, vFace.y - 0.06, abs(vFace.x)) * (1.0 - smoothstep(0.1, 0.3, px));
    if (vUp.x > 0.0) {
      // how high this wall stands
      float top = -1.6 + (vOwn.y + 1.6) / max(vUp.x, 0.02);
      // windows: in bays set out from the middle of the wall, a storey at a time; not every bay has one
      float sy = (vOwn.y - 0.2) / 3.0;
      float storey = floor(sy);
      float wy = (fract(sy) - 0.56) * 3.0;
      float bay = floor(run / 2.4 + 0.5);
      float bx = run - bay * 2.4;
      float fits = step(0.0, storey) * step((storey + 0.56) * 3.0 + 1.35, top) * (known > 0.5 ? step(abs(bay * 2.4) + 1.15, vFace.y) : 1.0);
      float has = fits * step(0.24, hash12(vec2(bay, storey) + seed * 53.0));
      // the door, in the middle of the front
      float front = step(0.5, vOwnN.z) * known;
      float doorway = front * step(abs(run), 0.86) * step(vOwn.y, 2.5 - 0.5 * run * run);
      float door = front * step(abs(run), 0.62) * step(vOwn.y, 2.24 - 0.6 * run * run);
      has *= 1.0 - front * step(abs(bay), 0.5) * step(storey, 0.5);
      // shutters, on some houses, in the house's own colour
      float shutters = step(0.45, fract(seed * 13.7));
      float which = fract(seed * 29.3);
      vec3 shutter = which < 0.34 ? vec3(0.2, 0.37, 0.27) : which < 0.67 ? vec3(0.25, 0.36, 0.52) : vec3(0.52, 0.25, 0.17);
      float inY = step(abs(wy), 0.62);
      float surround = step(abs(bx), 0.56) * step(abs(wy), 0.74);
      float pane = step(abs(bx), 0.44) * inY;
      float bars = max(step(abs(bx), 0.04), step(abs(wy - 0.08), 0.035)) * (1.0 - smoothstep(0.03, 0.09, px));
      paint = mix(paint, vColor * 1.08, surround * has);
      paint = mix(paint, shutter * (0.85 + 0.3 * step(0.5, fract(wy * 4.0))), step(0.44, abs(bx)) * step(abs(bx), 0.9) * inY * has * shutters);
      // glass: dark, with a little of the sky in its upper half
      paint = mix(paint, mix(vec3(0.08, 0.1, 0.16), vec3(0.24, 0.36, 0.5), smoothstep(-0.1, 0.6, wy) * 0.8), pane * has);
      paint = mix(paint, vColor * 0.95, bars * pane * has);
      // the sill, and its line of shadow
      paint *= 1.0 - 0.3 * step(abs(bx), 0.6) * step(-0.84, wy) * step(wy, -0.74) * has;
      paint = mix(paint, vec3(0.74, 0.7, 0.62) * (0.9 + 0.3 * dabs), doorway);
      paint = mix(paint, vec3(0.3, 0.18, 0.1) * (0.82 + 0.3 * step(0.5, fract(run * 3.2 + 0.25))), door);
      // the eaves throw a band of shadow along the top of a sunlit wall
      shadeOnly = mix(1.0, 0.68, smoothstep(top - 0.75, top - 0.45, vOwn.y) * lit);
    }
  }
  // sunlight a little warm, shade the sky's grey-blue; a roof in shade keeps its red
  vec3 sun = uSunColor * 0.42 + uSkyColor * 0.3;
  vec3 sky = mix(uSkyColor, vec3(dot(uSkyColor, vec3(0.333))), 0.6) * vec3(0.8, 0.88, 0.92) + 0.13;
  if (vOwn.w > 0.5) sky = mix(sky, vec3(dot(sky, vec3(0.333))) * vec3(1.12, 0.94, 0.98), 0.5);
  vec3 col = paint * mix(sky, sun, lit) * shadeOnly;
  // (painted already: alpha tells the frame's finish to leave it alone, so a window stays a window)
  outC = vec4(mix(col, applyFog(col, vWorld), 0.7), 0.4);
}
`;

/** Collects flat-faced pieces of a building. A corner is a point with `u`: how far up the wall it is. */
function shell() {
  const pos = [];
  const nor = [];
  const part = [];
  const up = [];
  const face = [];
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const tri = (a, b, c, p) => {
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      part.push(p);
      up.push(v.u);
      face.push(v.r, v.hl);
    }
  };
  const quad = (a, b, c, e, p) => {
    tri(a, b, c, p);
    tri(a, c, e, p);
  };
  return {
    tri,
    quad,
    /** A ready-made geometry (a cylinder, a dome): p is wall or roof, upAt gives how far up each point is. */
    add(geometry, p, upAt, faceAt = () => [0, 1e3]) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const at = g.attributes.position;
      for (let i = 0; i < at.count; i++) {
        pos.push(at.getX(i), at.getY(i), at.getZ(i));
        nor.push(g.attributes.normal.getX(i), g.attributes.normal.getY(i), g.attributes.normal.getZ(i));
        part.push(p);
        up.push(upAt(at.getY(i)));
        face.push(...faceAt(at.getX(i), at.getY(i), at.getZ(i)));
      }
    },
    build() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
      geometry.setAttribute('aUp', new THREE.Float32BufferAttribute(up, 1));
      geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 2));
      return geometry;
    },
  };
}

/** A corner: where it is, how far up the wall (or the roof), and along the wall from its middle with half the wall's length. */
const P = (x, y, z, u, r = 0, hl = 1e3) => Object.assign(new THREE.Vector3(x, y, z), { u, r, hl });
/** The walls go this far below the ground, so a house on a slope has no gap under it. */
const FOOT = -1.6;

/** Four walls round (cx, cz), w wide and d long, up to h. */
function walls(m, w, d, h, cx = 0, cz = 0) {
  const x = w / 2;
  const z = d / 2;
  m.quad(P(cx - x, FOOT, cz + z, 0, -x, x), P(cx + x, FOOT, cz + z, 0, x, x), P(cx + x, h, cz + z, 1, x, x), P(cx - x, h, cz + z, 1, -x, x), 0);
  m.quad(P(cx + x, FOOT, cz - z, 0, x, x), P(cx - x, FOOT, cz - z, 0, -x, x), P(cx - x, h, cz - z, 1, -x, x), P(cx + x, h, cz - z, 1, x, x), 0);
  m.quad(P(cx + x, FOOT, cz + z, 0, z, z), P(cx + x, FOOT, cz - z, 0, -z, z), P(cx + x, h, cz - z, 1, -z, z), P(cx + x, h, cz + z, 1, z, z), 0);
  m.quad(P(cx - x, FOOT, cz - z, 0, -z, z), P(cx - x, FOOT, cz + z, 0, z, z), P(cx - x, h, cz + z, 1, z, z), P(cx - x, h, cz - z, 1, -z, z), 0);
}

/** A pitched roof with gables at both ends, its ridge r above the eaves and running the length of the house. */
function gable(m, w, d, h, r, cx = 0, cz = 0) {
  const x = w / 2;
  const z = d / 2;
  const o = 0.5; // the roof overhangs
  const drop = o * (r / x);
  // (the gable ends: wall, with no storeys to it)
  m.tri(P(cx - x, h, cz + z, -0.25, -x, x), P(cx + x, h, cz + z, -0.25, x, x), P(cx, h + r, cz + z, -0.45, 0, x), 0);
  m.tri(P(cx + x, h, cz - z, -0.25, x, x), P(cx - x, h, cz - z, -0.25, -x, x), P(cx, h + r, cz - z, -0.45, 0, x), 0);
  m.quad(P(cx + x + o, h - drop, cz + z + o, 0), P(cx + x + o, h - drop, cz - z - o, 0), P(cx, h + r, cz - z - o, 1), P(cx, h + r, cz + z + o, 1), 1);
  m.quad(P(cx - x - o, h - drop, cz - z - o, 0), P(cx - x - o, h - drop, cz + z + o, 0), P(cx, h + r, cz + z + o, 1), P(cx, h + r, cz - z - o, 1), 1);
}

/** A roof that slopes on all four sides to a short ridge. */
function hip(m, w, d, h, r, cx = 0, cz = 0) {
  const o = 0.5;
  const x = w / 2 + o;
  const z = d / 2 + o;
  const ridge = Math.max(0, d / 2 - w / 2);
  const y = h - 0.3;
  const a = P(cx + x, y, cz + z, 0);
  const b = P(cx + x, y, cz - z, 0);
  const c = P(cx - x, y, cz - z, 0);
  const e = P(cx - x, y, cz + z, 0);
  const r1 = P(cx, h + r, cz + ridge, 1);
  const r2 = P(cx, h + r, cz - ridge, 1);
  m.quad(a, b, r2, r1, 1);
  m.quad(c, e, r1, r2, 1);
  m.tri(e, a, r1, 1);
  m.tri(b, c, r2, 1);
}

/** A pointed cap on a square tower s across, from y0 up by tall. */
function cap(m, s, y0, tall, cx = 0, cz = 0) {
  const k = s / 2 + 0.35;
  const top = P(cx, y0 + tall, cz, 1);
  const c = [P(cx - k, y0, cz + k, 0), P(cx + k, y0, cz + k, 0), P(cx + k, y0, cz - k, 0), P(cx - k, y0, cz - k, 0)];
  for (let i = 0; i < 4; i++) m.tri(c[i], c[(i + 1) % 4], top, 1);
}

/** A chimney: a plain stack s square from y0 up to y1. */
function chimney(m, cx, cz, y0, y1, s = 0.78) {
  const k = s / 2;
  const c = (x, y, z) => P(x, y, z, -1);
  m.quad(c(cx - k, y0, cz + k), c(cx + k, y0, cz + k), c(cx + k, y1, cz + k), c(cx - k, y1, cz + k), 2);
  m.quad(c(cx + k, y0, cz - k), c(cx - k, y0, cz - k), c(cx - k, y1, cz - k), c(cx + k, y1, cz - k), 2);
  m.quad(c(cx + k, y0, cz + k), c(cx + k, y0, cz - k), c(cx + k, y1, cz - k), c(cx + k, y1, cz + k), 2);
  m.quad(c(cx - k, y0, cz - k), c(cx - k, y0, cz + k), c(cx - k, y1, cz + k), c(cx - k, y1, cz - k), 2);
  m.quad(c(cx - k, y1, cz + k), c(cx + k, y1, cz + k), c(cx + k, y1, cz - k), c(cx - k, y1, cz - k), 2);
}

/** The kinds of building, each made once. `reach` is about how far from its middle its walls come, for spacing. */
const SHAPES = {
  cottage: {
    reach: 6,
    make(m) {
      walls(m, 7, 10, 3.4);
      gable(m, 7, 10, 3.4, 3.4);
      chimney(m, 0.9, -3.4, 5.2, 7.9);
    },
  },
  house: {
    reach: 6.5,
    make(m) {
      walls(m, 7.5, 11, 6.2);
      gable(m, 7.5, 11, 6.2, 3.6);
      chimney(m, -1.0, 3.9, 8.2, 11.0);
      chimney(m, 1.3, -4.2, 7.9, 10.6, 0.8);
    },
  },
  // a house with a lower wing along one side
  wing: {
    reach: 8,
    make(m) {
      walls(m, 7.5, 11, 6.2);
      gable(m, 7.5, 11, 6.2, 3.6);
      walls(m, 5.5, 7.5, 3.5, 6.2, -1);
      gable(m, 5.5, 7.5, 3.5, 2.6, 6.2, -1);
      chimney(m, 1.0, 4.0, 8.2, 11.0);
      chimney(m, 6.2, -3.6, 5.0, 7.2, 0.8);
    },
  },
  tall: {
    reach: 5.5,
    make(m) {
      walls(m, 7, 8.5, 9.2);
      hip(m, 7, 8.5, 9.2, 3.4);
      chimney(m, 2.0, 0.4, 10.6, 13.6);
    },
  },
  long: {
    reach: 9,
    make(m) {
      walls(m, 8, 19, 4.6);
      gable(m, 8, 19, 4.6, 4.2);
      chimney(m, -1.2, 6.5, 7.0, 9.8);
    },
  },
  church: {
    reach: 11,
    make(m) {
      walls(m, 9, 17, 8);
      gable(m, 9, 17, 8, 5);
      walls(m, 5, 5, 16, 0, 10.5);
      cap(m, 5, 16, 8, 0, 10.5);
    },
  },
  // a round tower with a dome
  round: {
    reach: 4.5,
    make(m) {
      const tall = 15;
      // (round it, a wall has no ends: only how far round you are)
      const round = (x, y, z) => [Math.atan2(z, x) * 3.5, 600];
      m.add(new THREE.CylinderGeometry(3.3, 3.7, tall - FOOT, 24, 1, true).translate(0, (tall + FOOT) / 2, 0), 0, (y) => (y - FOOT) / (tall - FOOT), round);
      // a ring where the dome sits, and the dome
      m.add(new THREE.CylinderGeometry(3.9, 3.9, 0.7, 24, 1, false).translate(0, tall, 0), 0, () => -1);
      m.add(new THREE.SphereGeometry(3.6, 24, 8, 0, TAU, 0, Math.PI / 2).translate(0, tall + 0.3, 0), 1, (y) => (y - tall - 0.3) / 3.6, round);
    },
  },
  // a slim square tower with a pointed cap
  slim: {
    reach: 3.5,
    make(m) {
      walls(m, 3.8, 3.8, 19);
      cap(m, 3.8, 19, 6);
    },
  },
};

const WALLS = [
  [0.95, 0.92, 0.82],
  [0.92, 0.86, 0.68],
  [0.93, 0.89, 0.76],
  [0.9, 0.76, 0.5],
  [0.9, 0.76, 0.68],
  [0.74, 0.72, 0.66],
];
const ROOFS = [
  [0.86, 0.3, 0.1],
  [0.78, 0.2, 0.1],
  [0.92, 0.42, 0.13],
  [0.66, 0.2, 0.14],
  [0.84, 0.36, 0.2],
];
const SLATE = [0.3, 0.34, 0.45];

/**
 * Where the village's buildings stand: a tight cluster on its rise, the towers and the tall houses at the top, the
 * cottages and barns round the edge, set along two streets and not every which way.
 * Returns [{ x, z, turn, scale, shape, wall, roof }].
 */
export function layVillage(random) {
  const list = [];
  const taken = [];
  const street = random() * Math.PI;
  const pick = (from) => from[Math.floor(random() * from.length)];
  const put = (du, dv, shape, scale, turn, wall = pick(WALLS), roof = pick(ROOFS)) => {
    const [x, z] = fromValley(VILLAGE[0] + du, VILLAGE[1] + dv);
    list.push({ x, z, turn, scale, shape, wall, roof });
    taken.push([du, dv, SHAPES[shape].reach * scale]);
  };
  put(4, -10, 'round', 1.7, 0, WALLS[2], [0.78, 0.8, 0.84]);
  put(-22, 16, 'church', 1.45, street, WALLS[0], SLATE);
  put(24, 20, 'slim', 1.6, street, WALLS[1], ROOFS[1]);
  for (let i = 0, tries = 0; i < 32 && tries < 4000; tries++) {
    const a = random() * TAU;
    const d = Math.sqrt(random());
    const du = Math.cos(a) * d * (VILLAGE_SIZE[0] - 8);
    const dv = Math.sin(a) * d * (VILLAGE_SIZE[1] - 8);
    const shape = d < 0.42 ? pick(['tall', 'house', 'wing', 'tall']) : d < 0.75 ? pick(['house', 'cottage', 'wing', 'house']) : pick(['cottage', 'cottage', 'long', 'house']);
    const scale = 1.6 + 0.45 * random();
    const reach = SHAPES[shape].reach * scale;
    if (taken.some(([x, y, r]) => Math.hypot(x - du, y - dv) < (r + reach) * 0.8)) continue;
    put(du, dv, shape, scale, street + (random() < 0.5 ? 0 : Math.PI / 2) + (random() - 0.5) * 0.4);
    i++;
  }
  return list;
}

/** A farmstead at (u, v): a house, a barn bigger than it, a shed. */
export function layFarm(random, u, v) {
  const [x, z] = fromValley(u, v);
  const turn = random() * TAU;
  const wall = WALLS[Math.floor(random() * 3)];
  const roof = ROOFS[Math.floor(random() * ROOFS.length)];
  return [
    { x, z, turn, scale: 1.6, shape: 'house', wall, roof },
    { x: x + Math.cos(turn) * 26, z: z + Math.sin(turn) * 26, turn: turn + 1.5 + 0.3 * random(), scale: 1.5, shape: 'long', wall: WALLS[5], roof },
    { x: x - Math.sin(turn) * 18, z: z + Math.cos(turn) * 18, turn: turn + 0.2, scale: 1.1, shape: 'cottage', wall, roof: ROOFS[3] },
  ];
}

export function createBuildingMaterial(field) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment, uniforms: field.uniforms, side: THREE.DoubleSide });
}

/** Puts every building in the list on the ground, one draw to a kind. */
export function addBuildings(group, material, list) {
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [name, shape] of Object.entries(SHAPES)) {
    const mine = list.filter((b) => b.shape === name);
    if (!mine.length) continue;
    const m = shell();
    shape.make(m);
    const geometry = m.build();
    const roof = new Float32Array(mine.length * 3);
    const wall = new Float32Array(mine.length * 3);
    const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
    mine.forEach((b, i) => {
      q.setFromAxisAngle(up, b.turn);
      matrix.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z), b.z), q, new THREE.Vector3(b.scale, b.scale, b.scale));
      mesh.setMatrixAt(i, matrix);
      roof.set(b.roof, i * 3);
      wall.set(b.wall, i * 3);
    });
    geometry.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 3));
    geometry.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 3));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
}
