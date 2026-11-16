// What stands on the far plain, done the way games have always done distance: every clump of forest is one flat
// picture of trees turned to face you, thousands of them, and the hamlet is a handful of boxes with roofs. None of
// it is ever nearer than a few hundred metres, where a painted tree and a real one are the same thing.
import * as THREE from 'three';
import { COMMON } from '../lib/index.js';
import { along, FARMS, fieldAt, FLOOR, MILL, ROADS, VILLAGE } from './floor.js';
import { REACH } from './horizon.js';
import { addBuildings, createBuildingMaterial, layFarm, layVillage, VILLAGE_SIZE } from './village.js';
import { fbm, fieldsAt, forestAt, fromValley, heightAt, riverDistance } from './world.js';

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
 * Eight pictures side by side, lit from the left: two stands of firs, two clumps of broadleaves, a row of poplars,
 * a single round tree, a length of hedge, and haystacks. Grey is how light the paint is there (shade, half-light,
 * light); the shader gives it its greens, or its straw.
 */
function treePictures() {
  const cell = 256;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 8;
  canvas.height = cell;
  const g = canvas.getContext('2d');
  const random = mulberry(5150);
  const tone = (t) => `rgb(${t},${t},${t})`;
  const tri = (ax, ay, bx, by, cx, cy, t) => {
    g.fillStyle = tone(t);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(cx, cy);
    g.fill();
  };
  const disc = (x, y, r, t) => {
    g.fillStyle = tone(t);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  /** Leaves, as a brush puts them on a mass: small dabs, lighter towards the upper left where the light is. */
  const dabs = (m, n) => {
    for (let j = 0; j < n; j++) {
      const a = random() * TAU;
      const d = Math.sqrt(random()) * m.r * 0.96;
      const x = m.x + Math.cos(a) * d;
      const y = m.y + Math.sin(a) * d;
      const k = (m.x - x + (m.y - y)) / (m.r * 1.4);
      g.fillStyle = tone(Math.round(Math.max(48, Math.min(228, 132 + k * 62 + (random() - 0.5) * 80))));
      g.beginPath();
      g.ellipse(x, y, m.r * (0.07 + 0.08 * random()), m.r * (0.04 + 0.04 * random()), random() * Math.PI, 0, TAU);
      g.fill();
    }
  };
  for (let k = 0; k < 2; k++) {
    // firs: the tall ones behind. Each is boughs in tiers that droop and end raggedly, dark, with the light catching
    // the upper left of every tier
    const ox = k * cell;
    const firs = [];
    const n = 5 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) firs.push({ x: ox + 54 + (i + random()) * (148 / n), h: 110 + random() * 135 });
    firs.sort((a, b) => b.h - a.h);
    for (const fir of firs) {
      const tiers = 8;
      const w = fir.h * 0.4;
      const lean = (random() - 0.5) * 6;
      // the leader
      tri(fir.x + lean, cell - 2 - fir.h, fir.x + lean - 3, cell - fir.h * 0.86, fir.x + lean + 3, cell - fir.h * 0.86, 62);
      for (let t = 0; t < tiers; t++) {
        const f = (t + 1) / tiers;
        const top = cell - 2 - fir.h * 0.94 + (t * fir.h * 0.86) / tiers;
        const bottom = top + (fir.h / tiers) * 1.9;
        const half = w * 0.5 * (0.2 + 0.8 * f ** 0.85) * (0.82 + 0.36 * random());
        const cx = fir.x + lean * (1 - f);
        /** A skirt of boughs from the trunk out to a drooping tip, and back along a ragged underside. */
        const skirt = (shade, x0, x1, inset) => {
          g.fillStyle = tone(shade);
          g.beginPath();
          g.moveTo(cx, top + inset);
          g.lineTo(x0, bottom + 3);
          const teeth = 4;
          for (let j = 1; j <= teeth; j++) {
            const x = x0 + ((x1 - x0) * j) / teeth;
            g.lineTo(x - (x1 - x0) / teeth / 2, bottom - 5 - random() * 4);
            g.lineTo(x, bottom + (j === teeth ? 3 : random() * 3));
          }
          g.closePath();
          g.fill();
        };
        skirt(62, cx - half, cx + half * (0.85 + 0.3 * random()), 0);
        skirt(134, cx - half * 0.96, cx + half * 0.12, 2);
        skirt(205, cx - half * 0.9, cx - half * 0.42, (bottom - top) * 0.42);
      }
    }
  }
  for (let k = 2; k < 4; k++) {
    // broadleaves: a mound of round masses, each lit on its upper left
    const ox = k * cell;
    g.fillStyle = tone(40);
    g.fillRect(ox + 118 + (random() - 0.5) * 30, cell - 44, 9, 44);
    g.fillRect(ox + 70 + random() * 20, cell - 30, 6, 30);
    g.fillStyle = tone(34);
    g.beginPath();
    g.ellipse(ox + 128, cell - 5, 104, 8, 0, 0, TAU);
    g.fill();
    const masses = [];
    const n = 9 + Math.floor(random() * 4);
    for (let i = 0; i < n; i++) {
      const dx = (random() - 0.5) * 170;
      masses.push({ x: ox + 128 + dx, y: cell - 46 - random() * 128 * (1 - Math.abs(dx) / 120), r: 28 + random() * 30 });
    }
    masses.sort((a, b) => a.y - b.y);
    for (const m of masses) {
      disc(m.x, m.y, m.r, 62);
      for (let j = 0; j < 9; j++) {
        const a = random() * TAU;
        disc(m.x + Math.cos(a) * m.r * 0.92, m.y + Math.sin(a) * m.r * 0.92, m.r * (0.16 + 0.14 * random()), 62);
      }
      // most of a mass is in half-light, its lower right in shade, its upper left catching the sun in dabs
      disc(m.x - m.r * 0.14, m.y - m.r * 0.16, m.r * 0.84, 132);
      for (let j = 0; j < 4; j++) disc(m.x + m.r * (0.1 + 0.5 * random()), m.y + m.r * (0.1 + 0.5 * random()), m.r * (0.12 + 0.12 * random()), 62);
      for (let j = 0; j < 6; j++) disc(m.x - m.r * (0.05 + 0.6 * random()), m.y - m.r * (0.15 + 0.6 * random()), m.r * (0.13 + 0.15 * random()), 205);
      dabs(m, 34);
    }
  }
  /** Draws into one cell only, so nothing spills into its neighbours. */
  const inCell = (k, draw) => {
    g.save();
    g.beginPath();
    g.rect(k * cell, 0, cell, cell);
    g.clip();
    draw(k * cell);
    g.restore();
  };
  const oval = (x, y, rx, ry, t) => {
    g.fillStyle = tone(t);
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fill();
  };
  // poplars, three in a row
  inCell(4, (ox) => {
    for (const [x, h, w] of [[60, 226, 46], [128, 248, 52], [198, 214, 44]]) {
      const cy = cell - 14 - h / 2;
      g.fillStyle = tone(40);
      g.fillRect(ox + x - 3, cell - 24, 6, 24);
      oval(ox + x, cy, w / 2, h / 2, 62);
      oval(ox + x - w * 0.12, cy - h * 0.03, w * 0.34, h * 0.44, 134);
      for (let j = 0; j < 7; j++) oval(ox + x - w * (0.12 + 0.2 * random()), cy + (random() - 0.6) * h * 0.7, w * 0.13, h * 0.06, 205);
    }
  });
  // one round tree
  inCell(5, (ox) => {
    g.fillStyle = tone(40);
    g.fillRect(ox + 122, cell - 70, 12, 70);
    g.fillStyle = tone(34);
    g.beginPath();
    g.ellipse(ox + 128, cell - 6, 96, 9, 0, 0, TAU);
    g.fill();
    const masses = [];
    for (let i = 0; i < 9; i++) {
      const a = random() * TAU;
      const d = 52 * Math.sqrt(random());
      masses.push({ x: ox + 128 + Math.cos(a) * d * 1.15, y: 112 + Math.sin(a) * d * 0.85, r: 34 + random() * 22 });
    }
    masses.sort((a, b) => a.y - b.y);
    for (const m of masses) {
      disc(m.x, m.y, m.r, 62);
      for (let j = 0; j < 8; j++) {
        const a = random() * TAU;
        disc(m.x + Math.cos(a) * m.r * 0.92, m.y + Math.sin(a) * m.r * 0.92, m.r * (0.16 + 0.14 * random()), 62);
      }
      disc(m.x - m.r * 0.14, m.y - m.r * 0.16, m.r * 0.84, 132);
      for (let j = 0; j < 5; j++) disc(m.x - m.r * (0.05 + 0.6 * random()), m.y - m.r * (0.15 + 0.6 * random()), m.r * (0.13 + 0.15 * random()), 205);
      dabs(m, 42);
    }
  });
  // a length of hedge
  inCell(6, (ox) => {
    for (let x = -10; x < cell + 20; x += 20 + random() * 12) {
      const r = 46 + random() * 30;
      const y = cell - r * 0.72;
      disc(ox + x, y, r, 62);
      disc(ox + x - r * 0.12, y - r * 0.16, r * 0.8, 132);
      for (let j = 0; j < 4; j++) disc(ox + x - r * (0.6 * random()), y - r * (0.2 + 0.55 * random()), r * (0.14 + 0.14 * random()), 205);
    }
  });
  // haystacks
  inCell(7, (ox) => {
    for (const [x, w, h] of [[92, 150, 190], [196, 104, 132]]) {
      const dome = (dx, k, t) => {
        g.fillStyle = tone(t);
        g.beginPath();
        g.ellipse(ox + x + dx, cell - 2, (w / 2) * k, h * k, 0, Math.PI, 0);
        g.fill();
      };
      dome(0, 1, 70);
      dome(-w * 0.07, 0.86, 134);
      dome(-w * 0.16, 0.56, 205);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

const treeVertex = /* glsl */ `
${COMMON}
in vec3 aAt;
in vec2 aDim;
in vec2 aLook;   // which picture, how light a stand it is
out vec2 vUv;
out vec3 vWorld;
out float vTone;
out float vKind;
out vec2 vLocal;   // across the picture from its lit side, and up it
void main() {
  vec3 to = uCamPos - aAt;
  vec2 right = normalize(vec2(to.z, -to.x));
  vec3 world = aAt + vec3(right.x, 0.0, right.y) * position.x * aDim.x * 0.5 + vec3(0.0, position.y * aDim.y, 0.0);
  // tops lean with the gusts
  world.xz += uWind.xy * uWind.z * (0.015 + 0.05 * gustAt(aAt.xz)) * position.y * position.y;
  // the picture is lit from its left: turn it so that is the side the sun is on
  float cu = position.x * 0.5 + 0.5;
  if (dot(right, uSunDir.xz) > 0.0) cu = 1.0 - cu;
  vUv = vec2((aLook.x + clamp(cu, 0.006, 0.994)) / 8.0, position.y);
  vWorld = world;
  vTone = aLook.y;
  vKind = aLook.x;
  vLocal = vec2(cu, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const treeFragment = /* glsl */ `
${COMMON}
layout(location = 0) out vec4 outC;
uniform sampler2D tTrees;
in vec2 vUv;
in vec3 vWorld;
in float vTone;
in float vKind;
in vec2 vLocal;
void main() {
  vec4 t = texture(tTrees, vUv);
  float a = clamp((t.a - 0.42) / max(fwidth(t.a), 1e-4) + 0.5, 0.0, 1.0);
  if (a < 0.04) discard;
  float fir = step(vKind, 1.5);
  vec3 shade = mix(vec3(0.02, 0.13, 0.11), vec3(0.016, 0.11, 0.11), fir);
  vec3 half_ = mix(vec3(0.055, 0.26, 0.12), vec3(0.035, 0.2, 0.12), fir);
  vec3 light = mix(vec3(0.2, 0.47, 0.14), vec3(0.1, 0.34, 0.13), fir);
  // (haystacks are straw)
  float straw = step(6.5, vKind);
  shade = mix(shade, vec3(0.25, 0.2, 0.09), straw);
  half_ = mix(half_, vec3(0.5, 0.42, 0.16), straw);
  light = mix(light, vec3(0.74, 0.64, 0.27), straw);
  float form = clamp(t.r * 0.55 + 0.45 * (0.5 + (0.5 - vLocal.x) * 0.9 + (vLocal.y - 0.5) * 0.7), 0.0, 1.0);
  vec3 col = mix(shade, half_, smoothstep(0.3, 0.46, form));
  col = mix(col, light, smoothstep(0.62, 0.78, form));
  col *= 0.8 + 0.4 * vTone;
  // a wood seen from off is rows of tops: each lighter where it stands clear, darker down where the next row hides it
  col *= mix(0.8, 1.2, smoothstep(0.1, 0.9, vUv.y));
  float cloud = cloudAt(vWorld.xz);
  col *= uSkyColor * 0.5 + dot(uSkyColor, vec3(0.22)) + uSunColor * (0.2 + 0.16 * smoothstep(0.5, 0.8, form)) * mix(0.4, 1.0, clamp((cloud - 0.5) * 2.0, 0.0, 1.0));
  outC = vec4(mix(col, applyFog(col, vWorld), 0.55), a);
}
`;

const houseVertex = /* glsl */ `
${COMMON}
in float aPart;
in vec3 aRoof;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec4 vOwn;   // where on the building, in its own metres; roof or wall
out vec3 vOwnN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(m) * normal);
  vOwn = vec4(position, aPart);
  vOwnN = normal;
  vColor = aPart > 0.5 ? aRoof : vec3(0.95, 0.92, 0.82);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const houseFragment = /* glsl */ `
${COMMON}
layout(location = 0) out vec4 outC;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec4 vOwn;
in vec3 vOwnN;
void main() {
  vec3 N = normalize(vNormal);
  float lit = smoothstep(0.0, 0.3, dot(N, uSunDir)) * cloudAt(vWorld.xz);
  vec3 paint = vColor;
  // along the wall or roof, and up it
  float run = abs(vOwnN.z) > abs(vOwnN.x) ? vOwn.x : vOwn.z;
  float wash = texture(tNoise, vec2(run * 0.13 + vOwn.y * 0.05, vOwn.y * 0.21)).r;
  if (vOwn.w > 0.5) {
    // a roof in courses, some tiles darker, moss low on it
    float course = fract(vOwn.y * 2.2);
    paint *= (0.82 + 0.3 * wash) * (0.9 + 0.1 * smoothstep(0.0, 0.25, course));
    paint = mix(paint, vec3(0.2, 0.25, 0.1), smoothstep(0.62, 0.8, wash) * 0.5);
  } else {
    // limewash gone uneven, a darker foot where rain splashes it, and windows and a door
    paint *= 0.86 + 0.2 * wash;
    paint = mix(paint, vec3(0.5, 0.46, 0.38), (1.0 - smoothstep(-0.3, 0.7, vOwn.y)) * 0.6);
    float bay = abs(fract(run / 2.6 + 0.5) - 0.5) * 2.6;
    float pane = step(bay, 0.42) * step(1.25, vOwn.y) * step(vOwn.y, 2.5);
    float door = step(abs(run - 0.6), 0.55) * step(vOwn.y, 2.05) * step(0.5, vOwnN.z);
    paint = mix(paint, vec3(0.09, 0.1, 0.13), max(pane, 0.0) * step(vOwn.y, 3.6));
    paint = mix(paint, vec3(0.2, 0.13, 0.08), door);
  }
  vec3 col = paint * mix(uSkyColor * 0.55 + dot(uSkyColor, vec3(0.26)) + 0.06, uSunColor * 0.42 + uSkyColor * 0.3, lit);
  outC = vec4(applyFog(col, vWorld), 1.0);
}
`;

/** A house: four walls with gables and a pitched roof, w wide, d long, its eaves h up and its ridge r above them. */
function houseGeometry(w, d, h, r, spire = 0) {
  const pos = [];
  const nor = [];
  const part = [];
  const quad = (a, b, c, e, p) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const v of [a, b, c, a, c, e]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      part.push(p);
    }
  };
  const tri = (a, b, c, p) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      part.push(p);
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const x = w / 2;
  const z = d / 2;
  const o = 0.45; // the roof overhangs
  quad(V(-x, -1, z), V(x, -1, z), V(x, h, z), V(-x, h, z), 0);
  quad(V(x, -1, -z), V(-x, -1, -z), V(-x, h, -z), V(x, h, -z), 0);
  quad(V(x, -1, z), V(x, -1, -z), V(x, h, -z), V(x, h, z), 0);
  quad(V(-x, -1, -z), V(-x, -1, z), V(-x, h, z), V(-x, h, -z), 0);
  tri(V(-x, h, z), V(x, h, z), V(0, h + r, z), 0);
  tri(V(x, h, -z), V(-x, h, -z), V(0, h + r, -z), 0);
  quad(V(x + o, h - o * (r / x), z + o), V(x + o, h - o * (r / x), -z - o), V(0, h + r, -z - o), V(0, h + r, z + o), 1);
  quad(V(-x - o, h - o * (r / x), -z - o), V(-x - o, h - o * (r / x), z + o), V(0, h + r, z + o), V(0, h + r, -z - o), 1);
  if (spire) {
    // a tower at one end, with a pointed cap
    const s = w * 0.3;
    const zc = z + s;
    const th = h + r + spire * 0.45;
    quad(V(-s, -1, zc + s), V(s, -1, zc + s), V(s, th, zc + s), V(-s, th, zc + s), 0);
    quad(V(s, -1, zc - s), V(-s, -1, zc - s), V(-s, th, zc - s), V(s, th, zc - s), 0);
    quad(V(s, -1, zc + s), V(s, -1, zc - s), V(s, th, zc - s), V(s, th, zc + s), 0);
    quad(V(-s, -1, zc - s), V(-s, -1, zc + s), V(-s, th, zc + s), V(-s, th, zc - s), 0);
    const top = V(0, th + spire * 0.55, zc);
    tri(V(-s, th, zc + s), V(s, th, zc + s), top, 1);
    tri(V(s, th, zc - s), V(-s, th, zc - s), top, 1);
    tri(V(s, th, zc + s), V(s, th, zc - s), top, 1);
    tri(V(-s, th, zc - s), V(-s, th, zc + s), top, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return geometry;
}

/** Adds one part's corners to the lists a building is made from. */
function addPart(geometry, part, pos, nor, parts) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  pos.push(...g.attributes.position.array);
  nor.push(...g.attributes.normal.array);
  for (let i = 0; i < g.attributes.position.count; i++) parts.push(part);
}

function building(pos, nor, parts) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  geometry.setAttribute('aUp', new THREE.Float32BufferAttribute(new Float32Array(parts.length).fill(-1), 1));
  geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(new Float32Array(parts.length * 2).fill(1e3), 2));
  return geometry;
}

/** A windmill's tower: eight-sided, narrowing upwards, with a pointed cap. Its foot at the origin. */
function millGeometry() {
  const pos = [];
  const nor = [];
  const parts = [];
  addPart(new THREE.CylinderGeometry(1.7, 2.9, 12, 8).translate(0, 5, 0), 0, pos, nor, parts);
  addPart(new THREE.ConeGeometry(2.4, 3.4, 8).translate(0, 12.7, 0), 1, pos, nor, parts);
  return building(pos, nor, parts);
}

/** Its four sails, flat in the plane they turn in, round the origin. */
function sailsGeometry() {
  const pos = [];
  const nor = [];
  const parts = [];
  for (let k = 0; k < 4; k++) {
    // a narrow arm out from the hub, and the sail set to one side of it
    addPart(new THREE.PlaneGeometry(0.34, 9).translate(0, 4.5, 0).rotateZ((k * Math.PI) / 2), 1, pos, nor, parts);
    addPart(new THREE.PlaneGeometry(1.7, 7).translate(0.95, 5.4, 0).rotateZ((k * Math.PI) / 2), 0, pos, nor, parts);
  }
  return building(pos, nor, parts);
}

export function createFarWoods(field) {
  const group = new THREE.Group();
  const random = mulberry(1967);

  // ---- trees ----
  const at = [];
  const dim = [];
  const look = [];
  const put = (x, z, fir, scale) => {
    const w = (fir ? 23 : 31) * scale * (0.75 + 0.55 * random());
    const out = Math.min(1, Math.max(0, (Math.hypot(x, z) - 4000) / 2000));
    at.push(x, heightAt(x, z) * (1 - 0.9 * out * out * (3 - 2 * out)) - 0.6, z);
    dim.push(w, w * (fir ? 1.18 : 0.8) * (0.85 + 0.3 * random()));
    look.push((fir ? 0 : 2) + (random() < 0.5 ? 0 : 1), random());
  };
  const STEP = 31;
  for (let gz = -REACH; gz < REACH; gz += STEP) {
    for (let gx = -REACH; gx < REACH; gx += STEP) {
      const x = gx + random() * STEP;
      const z = gz + random() * STEP;
      const r = Math.hypot(x, z);
      if (r < 690 || r > REACH * 0.97) continue;
      // further off, fewer and bigger: one picture stands for a wider piece of wood
      const farther = r > 2800;
      if (farther && random() > 0.5) continue;
      const scale = farther ? 1.5 : 1;
      const f = forestAt(x, z);
      // firs on the hills and in the heart of the forest, broadleaves at its edges and on the plain
      const fir = fbm(x / 1300 + 5, z / 1300 + 2, 2, 131) + (heightAt(x, z) > 45 ? 0.12 : 0) + (f - 0.6) * 0.2 > 0.4;
      if (f > 0.34 && random() < f * 1.1) {
        put(x, z, fir, scale * (0.7 + 0.95 * fbm(x / 240 + 3, z / 240 + 8, 2, 151)));
        continue;
      }
      if (r < 820) continue;
      // along the river, a ragged line of them; in the meadows, one here and there
      const river = riverDistance(x, z);
      if (river > 24 && river < 70 && random() < 0.2) put(x, z, false, 0.75);
      else if (river > 70 && fieldsAt(x, z) < 0.3 && random() < 0.004) put(x, z, random() < 0.25, 0.8);
      else if (fieldsAt(x, z) > 0.5 && random() < 0.02) put(x, z, false, 0.62);
    }
  }
  // ---- the farmland: what the painted floor has standing on it ----
  const place = (u, v, cell, w, h) => {
    const [x, z] = fromValley(u, v);
    at.push(x, heightAt(x, z) - 0.3, z);
    dim.push(w, h);
    look.push(cell, random());
  };
  const onRoad = new Set();
  for (const line of ROADS) for (const [u, v] of along(line, 3)) onRoad.add(Math.round(u / 9) + ',' + Math.round(v / 9));
  const planted = new Set();
  const S = 7;
  for (let gv = FLOOR.v0; gv < FLOOR.v0 + FLOOR.size; gv += S) {
    for (let gu = FLOOR.u0; gu < FLOOR.u0 + FLOOR.size; gu += S) {
      const u = gu + random() * S;
      const v = gv + random() * S;
      const [x, z] = fromValley(u, v);
      if (Math.hypot(x, z) < 665 || fieldsAt(x, z) < 0.5 || riverDistance(x, z) < 26) continue;
      if (onRoad.has(Math.round(u / 9) + ',' + Math.round(v / 9))) continue;
      const f = fieldAt(u, v);
      if (Math.hypot((u - VILLAGE[0]) / (VILLAGE_SIZE[0] + 8), (v - VILLAGE[1]) / (VILLAGE_SIZE[1] + 8)) < 1) continue;
      if (f.hedge && f.border < 4.2) {
        // a hedge is a row of lengths of hedge, with a tree grown up out of it now and then
        const roll = random();
        if (roll < 0.5) place(u, v, 6, 12 + 6 * random(), 5 + 2.5 * random());
        else if (roll < 0.57) place(u, v, 5, 12 + 5 * random(), 12 + 5 * random());
      } else if (f.kind === 6 && f.border > 8) {
        // an orchard: small round trees in rows
        const a = Math.round((u * f.dirx + v * f.diry) / 11) * 11;
        const b = Math.round((-u * f.diry + v * f.dirx) / 9) * 9;
        const key = a + ',' + b;
        if (!planted.has(key)) {
          planted.add(key);
          place(a * f.dirx - b * f.diry + random() - 0.5, a * f.diry + b * f.dirx + random() - 0.5, 5, 8 + 1.5 * random(), 7.5 + 1.5 * random());
        }
      } else if (f.kind === 2 && f.border > 16 && random() < 0.007) {
        place(u, v, 7, 9 + 3 * random(), 5 + 1.5 * random());
      }
    }
  }
  // poplars along stretches of the road
  {
    const line = along(ROADS[0], 1);
    let gone = 0;
    let next = 30;
    for (let i = 1; i < line.length; i++) {
      const du = line[i][0] - line[i - 1][0];
      const dv = line[i][1] - line[i - 1][1];
      const step = Math.hypot(du, dv);
      gone += step;
      if (gone < next) continue;
      next += 19 + 3 * random();
      if (Math.sin(gone / 150 + 0.6) < -0.15) continue;
      const u = line[i][0] - (dv / step) * 9;
      const v = line[i][1] + (du / step) * 9;
      const [x, z] = fromValley(u, v);
      if (Math.hypot(x, z) < 665 || Math.hypot(u - VILLAGE[0], v - VILLAGE[1]) < 190) continue;
      if (random() < 0.25) continue;
      place(u + (random() - 0.5) * 4, v + (random() - 0.5) * 4, 4, 15 + 8 * random(), 17 + 14 * random());
    }
  }
  // the village stands among trees: a ring of them round its foot, and some between the houses
  for (let i = 0; i < 50; i++) {
    const a = random() * TAU;
    const d = i < 36 ? 0.98 + 0.3 * random() : 0.2 + 0.65 * random();
    // (towards the walk, most of them are left out: the houses are what is to be seen)
    if (i < 36 && Math.cos(a) < -0.2 && random() < 0.7) continue;
    const u = VILLAGE[0] + Math.cos(a) * d * VILLAGE_SIZE[0];
    const v = VILLAGE[1] + Math.sin(a) * d * VILLAGE_SIZE[1];
    const roll = random();
    if (roll < 0.1) place(u, v, 4, 11 + 4 * random(), 20 + 8 * random());
    else if (roll < 0.6) place(u, v, 5, 11 + 5 * random(), 10 + 4 * random());
    else place(u, v, 2 + (random() < 0.5 ? 0 : 1), 18 + 8 * random(), 11 + 4 * random());
  }

  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  quad.setAttribute('aAt', new THREE.InstancedBufferAttribute(new Float32Array(at), 3));
  quad.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(dim), 2));
  quad.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(look), 2));
  quad.instanceCount = at.length / 3;
  const treeMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: treeVertex,
    fragmentShader: treeFragment,
    uniforms: { ...field.uniforms, tTrees: { value: treePictures() } },
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  const trees = new THREE.Mesh(quad, treeMaterial);
  trees.frustumCulled = false;
  group.add(trees);

  // ---- the village and the farmsteads ----
  const houseMaterial = createBuildingMaterial(field);
  const buildings = layVillage(random);
  for (const [u, v] of FARMS) buildings.push(...layFarm(random, u, v));
  addBuildings(group, houseMaterial, buildings);
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  // ---- the mill: its sails go round with the wind ----
  const [mx, mz] = fromValley(MILL[0], MILL[1]);
  const size = 2.1;
  const foot = new THREE.Vector3(mx, heightAt(mx, mz), mz);
  // it faces up the valley, towards the walk
  const yaw = Math.atan2(-mx, -mz);
  const facing = new THREE.Quaternion().setFromAxisAngle(up, yaw);
  const millRoof = new THREE.InstancedBufferAttribute(new Float32Array([0.42, 0.16, 0.1]), 3);
  const tower = new THREE.InstancedMesh(millGeometry(), houseMaterial, 1);
  const millWall = new THREE.InstancedBufferAttribute(new Float32Array([0.95, 0.92, 0.84]), 3);
  tower.geometry.setAttribute('aRoof', millRoof);
  tower.geometry.setAttribute('aWall', millWall);
  tower.setMatrixAt(0, matrix.compose(foot, facing, new THREE.Vector3(size, size, size)));
  tower.frustumCulled = false;
  const sails = new THREE.InstancedMesh(sailsGeometry(), houseMaterial, 1);
  sails.geometry.setAttribute('aRoof', millRoof);
  sails.geometry.setAttribute('aWall', millWall);
  sails.setMatrixAt(0, new THREE.Matrix4());
  sails.position.copy(foot).add(new THREE.Vector3(Math.sin(yaw) * 2.6 * size, 10.6 * size, Math.cos(yaw) * 2.6 * size));
  sails.scale.setScalar(size);
  sails.frustumCulled = false;
  group.add(tower, sails);
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 0, 1);
  let angle = 0.4;

  return {
    group,
    count: at.length / 3,
    update(dt, wind) {
      angle -= dt * (0.2 + wind * 0.07);
      sails.quaternion.copy(facing).multiply(spin.setFromAxisAngle(axis, angle));
    },
  };
}
