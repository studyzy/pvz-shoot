#!/usr/bin/env node
// Original offline mesh authoring. No runtime geometry builders, downloaded models or textures.
// Usage: node tools/build-weapon-models.mjs [output-directory] [pea snow ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatmullRomCurve3, Color, Vector3 } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

export const WEAPON_IDS = ['pea', 'snow', 'cherry', 'cob', 'repeater', 'threepeater', 'gatling', 'cactus', 'melon', 'jalapeno', 'wallnut', 'firepea'];
const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models/weapons');
const TAU = Math.PI * 2;
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// glTF COLOR_0 is linear, unlike artist-facing hexadecimal sRGB swatches.
const rgb = (hex) => new Color(hex).toArray();
const C = {
  leaf: rgb('#358c40'), vein: rgb('#78b64a'), green: rgb('#76b941'), lime: rgb('#a6ce63'),
  dark: rgb('#172c24'), cream: rgb('#f8efce'), cheek: rgb('#e4aa51'),
  ice: rgb('#74b9d2'), frost: rgb('#d0e8e5'), blue: rgb('#467daf'),
  red: rgb('#c94430'), ruby: rgb('#a42734'), warm: rgb('#ed9050'),
  flame: rgb('#ee7433'), yellow: rgb('#f0bf58'), corn: rgb('#dba13c'),
  melon: rgb('#64a34a'), stripe: rgb('#2d7048'), bark: rgb('#936539'), shell: rgb('#b68751'),
};
const MATERIALS = {
  skin: 0.65, foliage: 0.76, detail: 0.59, polished: 0.39,
};

function curve(points) {
  return new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'catmullrom', 0.3);
}

class Plant {
  constructor(id) {
    this.id = id;
    this.groups = new Map();
  }

  // Closed parametric patches include their own thin edges. No double-sided leaf/outline pass.
  surface(material, rows, sides, point, color, flip = false) {
    const positions = [], colors = [], indices = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= sides; j++) {
        const u = i / rows, v = j / sides;
        positions.push(...point(u, v));
        colors.push(...(typeof color === 'function' ? color(u, v) : color));
      }
    }
    const normalSums = positions.map(() => 0);
    const triangle = (a, b, c) => {
      if (flip) [b, c] = [c, b];
      const x = a * 3, y = b * 3, z = c * 3;
      const ux = positions[y] - positions[x], uy = positions[y + 1] - positions[x + 1], uz = positions[y + 2] - positions[x + 2];
      const vx = positions[z] - positions[x], vy = positions[z + 1] - positions[x + 1], vz = positions[z + 2] - positions[x + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (Math.hypot(...n) < 1e-12) return; // collapsed pole/tip edges have no triangle
      indices.push(a, b, c);
      for (const k of [x, y, z]) for (let axis = 0; axis < 3; axis++) normalSums[k + axis] += n[axis];
    };
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j, b = a + sides + 1;
        triangle(a, b, a + 1);
        triangle(a + 1, b, b + 1);
      }
    }
    // Match seam/pole normals inside this patch, but do not smooth unrelated touching parts.
    const sums = new Map(), keys = [];
    for (let i = 0; i < positions.length; i += 3) {
      const key = positions.slice(i, i + 3).map((v) => Math.round(v * 1e8)).join(',');
      keys.push(key);
      const sum = sums.get(key) || [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) sum[axis] += normalSums[i + axis];
      sums.set(key, sum);
    }
    const target = this.groups.get(material) || { p: [], n: [], c: [], ix: [] };
    const remap = new Map();
    for (const index of indices) {
      if (!remap.has(index)) {
        const offset = index * 3, n = sums.get(keys[index]);
        const length = Math.hypot(...n);
        if (length < 1e-12) throw new Error(`${this.id}: zero normal in ${material}`);
        remap.set(index, target.p.length / 3);
        target.p.push(...positions.slice(offset, offset + 3));
        target.c.push(...colors.slice(offset, offset + 3));
        target.n.push(...n.map((v) => v / length));
      }
      target.ix.push(remap.get(index));
    }
    this.groups.set(material, target);
  }

  fruit(center, size, color, { rows = 12, sides = 20, material = 'skin', shape = () => 1 } = {}) {
    this.surface(material, rows, sides, (u, v) => {
      const phi = u * Math.PI, theta = v * TAU, r = shape(u, v);
      return [center[0] + size[0] * Math.sin(phi) * Math.cos(theta) * r,
        center[1] + size[1] * Math.cos(phi) * r,
        center[2] + size[2] * Math.sin(phi) * Math.sin(theta) * r];
    }, color, true);
  }

  stem(points, radius, color = C.leaf, { rows = 10, sides = 8, material = 'foliage', taper = 0.7 } = {}) {
    const path = curve(points);
    this.surface(material, rows + 2, sides, (u, v) => {
      // One collapsed ring at either end closes even very short veins without a separate cap.
      const t = clamp((u * (rows + 2) - 1) / rows);
      const end = u === 0 || u === 1;
      const p = path.getPoint(t), tangent = path.getTangent(t).normalize();
      const reference = Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const n = reference.addScaledVector(tangent, -reference.dot(tangent)).normalize();
      const b = n.clone().cross(tangent).normalize();
      const r = end ? 0 : radius * (1 - t * (1 - taper));
      return p.addScaledVector(n, Math.cos(v * TAU) * r).addScaledVector(b, Math.sin(v * TAU) * r).toArray();
    }, typeof color === 'function' ? color : (u) => mix(color, C.vein, 0.12 * u));
  }

  leaf(start, angle, length, width, { rise = 0.035, curl = 0.015, color = C.leaf, vein = true, rows = 9 } = {}) {
    const direction = [Math.cos(angle), Math.sin(angle)];
    const center = (t) => [start[0] + direction[0] * length * t,
      start[1] + rise * Math.sin(t * Math.PI) + curl * t * t,
      start[2] + direction[1] * length * t];
    // Separate upper/lower normal domains at the sharp blade edge prevent a thin leaf's
    // opposite face normals cancelling during smooth-normal averaging.
    for (const side of [1, -1]) this.surface('foliage', rows, 5, (u, v) => {
      const p = center(u), across = v * 2 - 1;
      const w = width * Math.pow(Math.sin(u * Math.PI), 0.85) * (1 - u * 0.38);
      const s = w * across;
      const dome = Math.sin(u * Math.PI) * (1 - across * across);
      return [p[0] - direction[1] * s, p[1] + dome * (0.012 + side * 0.003), p[2] + direction[0] * s];
    }, (u) => mix(color, C.vein, clamp(0.1 + side * 0.09 + 0.19 * u)), side === 1);
    if (vein) {
      this.stem([0.05, 0.35, 0.65, 0.95].map((t) => { const p = center(t); p[1] += 0.015 * Math.sin(t * Math.PI) + 0.0015; return p; }), 0.0027, C.vein, { rows: 5, sides: 5 });
      for (const t of [0.33, 0.58]) {
        for (const side of [-1, 1]) {
          const p = center(t), q = center(t + 0.13);
          const w = width * Math.pow(Math.sin((t + 0.13) * Math.PI), 0.85) * (1 - (t + 0.13) * 0.38) * 0.5 * side;
          p[1] += 0.015 * Math.sin(t * Math.PI) + 0.0015;
          q[1] += 0.015 * Math.sin((t + 0.13) * Math.PI) * 0.75 + 0.0015;
          q[0] -= direction[1] * w; q[2] += direction[0] * w;
          this.stem([p, mix(p, q, 0.5), q], 0.0013, C.vein, { rows: 2, sides: 4, taper: 0.25 });
        }
      }
    }
  }

  base(color = C.leaf, width = 0.23) {
    this.stem([[0, -0.34, 0.1], [0.02, -0.24, 0.08], [-0.01, -0.12, 0.04], [0, -0.08, 0]], 0.037, color, { taper: 0.72 });
    for (let i = 0; i < 4; i++) this.leaf([0, -0.33, 0.09], i * Math.PI / 2 + 0.3, width, 0.085, { color });
  }

  shooterHead(offset = [0, 0, 0], scale = 1, color = C.green, { rows = 30, sides = 20, muzzle = -0.5, compact = false } = {}) {
    // One continuous rear -> cheek -> neck -> rolled thick lip -> recessed throat surface.
    const profile = curve([[0.15, 0, 0], [0.11, 0.125, 0], [0.015, 0.175, 0], [-0.09, 0.16, 0],
      [-0.2, 0.095, 0], [muzzle + 0.12, 0.093, 0], [muzzle + 0.035, 0.116, 0],
      [muzzle, 0.104, 0], [muzzle + 0.008, 0.078, 0], [muzzle + 0.085, 0.069, 0], [muzzle + 0.16, 0.055, 0], [muzzle + 0.19, 0, 0]]);
    this.surface('skin', rows, sides, (u, v) => {
      const p = profile.getPoint(u), theta = v * TAU, r = Math.max(0, p.y);
      return [offset[0] + r * Math.cos(theta) * scale,
        offset[1] + (r * Math.sin(theta) * 0.96 + 0.005 * clamp(-p.x * 3)) * scale,
        offset[2] + p.x * scale];
    }, (u, v) => {
      const outer = mix(color, C.lime, clamp(0.12 + 0.13 * Math.sin(v * TAU)));
      return u > 0.72 ? mix(outer, C.dark, clamp((u - 0.72) * 5.5)) : outer;
    });
    for (const side of [-1, 1]) {
      const p = [offset[0] + side * 0.165 * scale, offset[1] + 0.052 * scale, offset[2] + 0.007 * scale];
      this.fruit(p, [0.023 * scale, 0.045 * scale, 0.033 * scale], C.cream, { rows: compact ? 6 : 8, sides: compact ? 8 : 12, material: 'detail' });
      this.fruit([p[0] + side * 0.018 * scale, p[1] - 0.003 * scale, p[2] - 0.009 * scale], [0.009 * scale, 0.024 * scale, 0.019 * scale], C.dark, { rows: compact ? 4 : 6, sides: compact ? 8 : 10, material: 'detail' });
      this.fruit([p[0] + side * 0.024 * scale, p[1] + 0.008 * scale, p[2] - 0.014 * scale], [0.003 * scale, 0.006 * scale, 0.006 * scale], C.cream, { rows: 4, sides: 6, material: 'detail' });
      this.fruit([offset[0] + side * 0.153 * scale, offset[1] - 0.018 * scale, offset[2] - 0.06 * scale], [0.02 * scale, 0.026 * scale, 0.04 * scale], mix(color, C.cheek, 0.5), { rows: compact ? 4 : 6, sides: compact ? 8 : 10 });
      this.stem([[p[0] - side * 0.008 * scale, p[1] + 0.043 * scale, p[2] + 0.024 * scale],
        [p[0] + side * 0.005 * scale, p[1] + 0.05 * scale, p[2]],
        [p[0] - side * 0.009 * scale, p[1] + 0.045 * scale, p[2] - 0.026 * scale]], 0.004 * scale, C.dark, { rows: 5, sides: 5, material: 'detail' });
    }
  }

  frontFace(center, width, depth, { size = 1, smile = true } = {}) {
    for (const side of [-1, 1]) {
      const p = [center[0] + side * width, center[1] + 0.025 * size, center[2] + depth];
      this.fruit(p, [0.027 * size, 0.039 * size, 0.014 * size], C.cream, { rows: 8, sides: 12, material: 'detail' });
      this.fruit([p[0] + 0.002 * size, p[1] - 0.004 * size, p[2] + 0.011 * size], [0.014 * size, 0.025 * size, 0.006 * size], C.dark, { rows: 6, sides: 10, material: 'detail' });
      this.fruit([p[0] - 0.003 * size, p[1] + 0.007 * size, p[2] + 0.016 * size], [0.004 * size, 0.006 * size, 0.003 * size], C.cream, { rows: 4, sides: 6, material: 'detail' });
    }
    const y = center[1] - 0.033 * size, z = center[2] + depth + 0.003;
    this.stem([[center[0] - width * 0.65, y, z], [center[0], y - (smile ? 0.018 : -0.012) * size, z + 0.006],
      [center[0] + width * 0.65, y + 0.003 * size, z]], 0.0045 * size, C.dark, { rows: 7, sides: 6, material: 'detail' });
  }

  crystal(base, tip, width, color) {
    const path = curve([base, mix(base, tip, 0.35), tip]);
    this.surface('polished', 3, 5, (u, v) => {
      const p = path.getPoint(u), theta = v * TAU;
      const r = width * (u === 0 || u === 1 ? 0 : u < 0.5 ? 1 : 0.65);
      return [p.x + Math.cos(theta) * r, p.y, p.z + Math.sin(theta) * r];
    }, (u, v) => mix(color, C.frost, 0.15 + 0.4 * v));
  }

  document() {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'pvz-shoot original offline plant surface authoring';
    const buffer = doc.createBuffer();
    const mesh = doc.createMesh(this.id);
    let triangles = 0;
    for (const [name, data] of this.groups) {
      const material = doc.createMaterial(name).setBaseColorFactor([1, 1, 1, 1])
        .setMetallicFactor(0).setRoughnessFactor(MATERIALS[name]);
      const attribute = (label, type, array) => doc.createAccessor(`${name}-${label}`).setType(type).setArray(array).setBuffer(buffer);
      const primitive = doc.createPrimitive().setMaterial(material)
        .setAttribute('POSITION', attribute('position', 'VEC3', new Float32Array(data.p)))
        .setAttribute('NORMAL', attribute('normal', 'VEC3', new Float32Array(data.n)))
        .setAttribute('COLOR_0', attribute('linear-color', 'VEC3', new Float32Array(data.c)))
        .setIndices(attribute('indices', 'SCALAR', new Uint16Array(data.ix)));
      mesh.addPrimitive(primitive);
      triangles += data.ix.length / 3;
    }
    if (triangles > 6000) throw new Error(`${this.id}: ${triangles} triangles exceeds 6000`);
    doc.createScene(this.id).addChild(doc.createNode(this.id).setMesh(mesh).setExtras({ original: true, up: '+Y', forward: '-Z' }));
    return { doc, triangles, draws: this.groups.size };
  }
}

function pea(id) {
  const p = new Plant(id), ice = id === 'snow', fire = id === 'firepea';
  p.base(ice ? C.blue : C.leaf);
  p.shooterHead([0, 0, 0], 1, ice ? C.ice : fire ? C.flame : C.green);
  if (ice) {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.047;
      p.crystal([x, 0.12, 0.035], [x * 1.5, 0.24 + (i % 2) * 0.03, 0.02 + i * 0.005], 0.021, C.ice);
    }
    for (let i = 0; i < 7; i++) {
      const theta = i * TAU / 7;
      p.fruit([0.109 * Math.cos(theta), 0.005 + 0.109 * Math.sin(theta), -0.45], [0.012, 0.012, 0.025], C.frost, { rows: 4, sides: 6, material: 'polished' });
    }
  } else if (fire) {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.045;
      const path = curve([[x, 0.115, 0.04], [x + 0.006, 0.175, 0.032], [x + 0.02, 0.233, 0.014],
        [x + 0.05, 0.295 + (i % 2) * 0.025, -0.016]]);
      p.surface('skin', 10, 8, (u, v) => {
        const q = path.getPoint(u), theta = v * TAU;
        const r = 0.034 * Math.pow(Math.sin(u * Math.PI), 0.65) * (1 - 0.5 * u);
        return [q.x + Math.cos(theta) * r, q.y, q.z + Math.sin(theta) * r * 0.45];
      }, (u) => mix(C.flame, C.yellow, u * 0.82));
    }
    p.leaf([0, -0.09, 0.04], 0.7, 0.16, 0.055, { color: C.bark, rise: 0.075 });
  } else {
    for (let i = 0; i < 3; i++) p.leaf([0, 0.13, 0.075], 0.5 + i * 2.1, 0.09, 0.035, { rise: 0.04, color: C.green, vein: false });
  }
  return p;
}

function cherries() {
  const p = new Plant('cherry');
  for (const [i, x] of [-0.075, 0.085].entries()) {
    const y = i ? -0.008 : 0.012;
    p.fruit([x, y, 0], [0.096, 0.101, 0.096], (u, v) => mix(C.ruby, C.red, 0.2 + 0.4 * Math.sin(u * Math.PI)),
      { rows: 16, sides: 24, material: 'polished', shape: (u, v) => 1 - 0.09 * Math.exp(-u * u * 90) + 0.018 * Math.cos(v * TAU * 3) * Math.sin(u * Math.PI) });
    p.frontFace([x, y, 0], 0.034, 0.087, { size: 0.58, smile: i === 0 });
    p.stem([[x, y + 0.092, 0], [x * 0.7, 0.2, 0.012], [0.005, 0.3, 0.025]], 0.009, C.leaf, { taper: 0.68 });
    p.fruit([x, y + 0.091, 0], [0.023, 0.007, 0.018], C.bark, { rows: 4, sides: 8, material: 'foliage' });
  }
  p.leaf([0.003, 0.27, 0.023], -0.7, 0.125, 0.047, { rise: 0.026 });
  return p;
}

function corn() {
  const p = new Plant('cob');
  p.base(C.leaf, 0.19);
  const profile = curve([[0.13, 0, 0], [0.08, 0.082, 0], [-0.05, 0.098, 0], [-0.2, 0.091, 0], [-0.33, 0.066, 0], [-0.38, 0.034, 0], [-0.366, 0.02, 0], [-0.31, 0, 0]]);
  p.surface('skin', 24, 20, (u, v) => { const q = profile.getPoint(u); return [q.y * Math.cos(v * TAU), q.y * Math.sin(v * TAU), q.x]; },
    (u) => u > 0.78 ? mix(C.corn, C.dark, clamp((u - 0.78) * 5)) : C.corn);
  for (let row = 0; row < 9; row++) {
    const z = 0.054 - row * 0.043, r = 0.095 - 0.02 * Math.pow(row / 8, 3);
    for (let col = 0; col < 10; col++) {
      const theta = (col + (row % 2) * 0.13) * TAU / 10;
      p.fruit([Math.cos(theta) * r, Math.sin(theta) * r, z], [0.025, 0.025, 0.027], mix(C.yellow, C.corn, (row + col) % 3 * 0.1),
        { rows: 3, sides: 6, shape: (u, v) => 1 + 0.06 * Math.cos(v * TAU * 4) * Math.sin(u * Math.PI) });
    }
  }
  for (let i = 0; i < 4; i++) {
    p.leaf([0, -0.145, 0.13], -Math.PI / 2 + [-0.6, -0.3, 0.3, 0.6][i], 0.37, 0.071,
      { rise: -0.025, curl: 0.15, color: i % 2 ? C.vein : C.leaf, vein: false, rows: 10 });
  }
  p.frontFace([0, 0.004, 0.075], 0.033, 0.04, { size: 0.7 });
  return p;
}

function multiHead(id, count) {
  const p = new Plant(id);
  p.base(C.leaf, 0.21);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.195;
    const scale = count === 3 ? 0.65 : 0.8;
    const y = count === 3 && i === 1 ? 0.03 : 0;
    const z = -0.46 + 0.5 * scale;
    p.shooterHead([x, y, z], scale, i % 2 ? C.green : C.lime, { rows: 24, sides: 16, compact: true });
    p.stem([[0, -0.26, 0.075], [x * 0.55, -0.17, 0.08], [x, y - 0.085, z]], 0.022, C.leaf, { rows: 8, sides: 7 });
  }
  p.leaf([0, -0.17, 0.02], 1.5, 0.16, 0.055, { rise: 0.09, color: C.vein, vein: false });
  return p;
}

function gatling() {
  const p = new Plant('gatling');
  p.base(C.leaf, 0.21);
  p.fruit([0, 0, 0.035], [0.17, 0.159, 0.17], C.green, { rows: 14, sides: 24, shape: (u, v) => 1 + 0.025 * Math.cos(v * TAU * 5) * Math.sin(u * Math.PI) });
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 ? 1 : -1) * 0.068, y = (i < 2 ? -1 : 1) * 0.059;
    const profile = curve([[-0.075, 0, 0], [-0.12, 0.046, 0], [-0.22, 0.049, 0], [-0.42, 0.05, 0],
      [-0.525, 0.064, 0], [-0.56, 0.056, 0], [-0.553, 0.037, 0], [-0.46, 0.034, 0], [-0.4, 0, 0]]);
    p.surface('skin', 20, 12, (u, v) => { const q = profile.getPoint(u); return [x + q.y * Math.cos(v * TAU), y + q.y * Math.sin(v * TAU), q.x]; },
      (u, v) => u > 0.65 ? mix(C.green, C.dark, clamp((u - 0.65) * 4)) : mix(C.green, C.lime, 0.16 + 0.12 * Math.cos(v * TAU * 3)));
  }
  // A layered leafy crown/beret, not a metal receiver or firearm silhouette.
  for (let i = 0; i < 6; i++) p.leaf([0, 0.105, 0.04], i * TAU / 6, 0.19, 0.065, { rise: 0.08, curl: -0.025, color: i % 2 ? C.leaf : C.vein, vein: false });
  p.stem([[0, 0.16, 0.04], [0.012, 0.195, 0.045], [0.026, 0.23, 0.052]], 0.009, C.bark, { rows: 5, sides: 7 });
  p.frontFace([0, 0.012, 0.032], 0.083, 0.14, { size: 0.9, smile: false });
  return p;
}

function cactus() {
  const p = new Plant('cactus');
  const profile = curve([[0.15, 0, 0], [0.115, 0.086, 0], [0.04, 0.125, 0], [-0.12, 0.132, 0],
    [-0.28, 0.102, 0], [-0.37, 0.06, 0], [-0.44, 0.052, 0], [-0.432, 0.031, 0], [-0.34, 0.028, 0], [-0.29, 0, 0]]);
  p.surface('skin', 30, 40, (u, v) => {
    const q = profile.getPoint(u), theta = v * TAU;
    const r = q.y * (1 + 0.08 * Math.cos(theta * 10));
    return [Math.cos(theta) * r, Math.sin(theta) * r, q.x];
  }, (u, v) => u > 0.75 ? mix(C.green, C.dark, clamp((u - 0.75) * 5)) : mix(C.leaf, C.green, 0.46 + 0.3 * Math.cos(v * TAU * 10)));
  for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) {
    const theta = (col + (row % 2) * 0.3) * TAU / 8, z = 0.075 - row * 0.077;
    const r = row === 4 ? 0.106 : 0.135;
    const base = [Math.cos(theta) * r, Math.sin(theta) * r, z];
    const tip = [base[0] + Math.cos(theta) * 0.035, base[1] + Math.sin(theta) * 0.035, z + 0.014];
    p.stem([base, mix(base, tip, 0.45), tip], 0.0047, C.cream, { rows: 2, sides: 4, taper: 0, material: 'detail' });
  }
  p.stem([[0, -0.33, 0.07], [-0.015, -0.2, 0.06], [0, -0.12, 0.02]], 0.037, C.leaf, { rows: 9, sides: 10 });
  for (let i = 0; i < 3; i++) p.leaf([0, -0.32, 0.08], i * TAU / 3, 0.155, 0.068, { color: C.leaf, vein: false });
  for (let i = 0; i < 5; i++) p.leaf([0.01, 0.134, 0.056], i * TAU / 5, 0.065, 0.029, { rise: 0.035, color: C.red, vein: false, rows: 5 });
  p.fruit([0.01, 0.16, 0.056], [0.021, 0.025, 0.02], C.yellow, { rows: 6, sides: 10 });
  p.frontFace([0, 0.015, 0.035], 0.055, 0.088, { size: 0.7 });
  return p;
}

function melon() {
  const p = new Plant('melon');
  p.fruit([0, -0.005, 0], [0.25, 0.232, 0.248], (u, v) => {
    const w = 0.5 + 0.5 * Math.cos(v * TAU * 10 + Math.sin(u * Math.PI * 3) * 0.24);
    return mix(C.melon, C.stripe, clamp((w - 0.42) * 3.5));
  }, { rows: 20, sides: 60, shape: (u, v) => 1 + 0.011 * Math.cos(v * TAU * 10) * Math.sin(u * Math.PI) });
  p.stem([[0, 0.22, 0.01], [0.01, 0.277, 0.005], [-0.018, 0.304, 0.022]], 0.011, C.leaf, { rows: 7, sides: 8 });
  p.leaf([-0.013, 0.271, 0.02], 0.2, 0.09, 0.044, { rise: 0.02 });
  for (const z of [-0.085, 0.105]) p.stem([[-0.247, 0.105, z], [-0.245, -0.08, z], [-0.16, -0.235, z],
    [0, -0.272, z], [0.16, -0.235, z], [0.245, -0.08, z], [0.247, 0.105, z]], 0.016, C.bark, { rows: 18, sides: 8, taper: 1 });
  p.stem([[0, -0.272, -0.155], [0, -0.29, 0], [0, -0.272, 0.155]], 0.026, C.bark, { rows: 9, sides: 8, taper: 1 });
  p.stem([[-0.18, -0.275, 0.11], [0, -0.335, 0.1], [0.18, -0.275, 0.11]], 0.016, C.vein, { rows: 12, sides: 7, taper: 1 });
  p.frontFace([0, 0.017, 0.026], 0.065, 0.206, { size: 0.9 });
  return p;
}

function jalapeno() {
  const p = new Plant('jalapeno');
  const path = curve([[-0.015, 0.005, 0.12], [-0.018, 0.006, 0.04], [-0.008, 0.014, -0.15], [0.025, 0.044, -0.31], [0.078, 0.082, -0.4]]);
  p.surface('polished', 26, 24, (u, v) => {
    const q = path.getPoint(u), t = path.getTangent(u).normalize();
    const n = new Vector3(0, 1, 0).addScaledVector(t, -t.y).normalize(), b = n.clone().cross(t);
    const r = (u === 0 || u === 1 ? 0 : 0.114 * Math.pow(Math.sin(u * Math.PI), 0.36) * (1 - 0.6 * u));
    return q.addScaledVector(n, Math.cos(v * TAU) * r).addScaledVector(b, Math.sin(v * TAU) * r).toArray();
  }, (u, v) => mix(C.ruby, C.red, 0.46 + 0.15 * Math.sin(v * TAU) + 0.16 * u));
  for (let i = 0; i < 5; i++) p.leaf([-0.015, 0.041, 0.105], i * TAU / 5, 0.058, 0.018, { rise: 0.013, color: C.leaf, vein: false, rows: 5 });
  p.stem([[-0.015, 0.04, 0.11], [-0.01, 0.08, 0.172], [0.018, 0.12, 0.199]], 0.014, C.leaf, { rows: 8, sides: 8 });
  p.leaf([0.007, 0.104, 0.18], -0.05, 0.12, 0.035, { rise: 0.035 });
  p.frontFace([-0.015, -0.006, 0.009], 0.028, 0.103, { size: 0.62, smile: false });
  return p;
}

function walnut() {
  const p = new Plant('wallnut');
  const shape = (u, v) => 1 + 0.018 * Math.cos(v * TAU * 6 + Math.sin(u * Math.PI * 5)) * Math.sin(u * Math.PI);
  p.fruit([0, 0, 0], [0.2392, 0.299, 0.2392], (u, v) => mix(C.shell, C.bark, 0.09 + 0.12 * Math.cos(v * TAU * 6 + Math.sin(u * Math.PI * 5))),
    { rows: 20, sides: 40, shape });
  // Raised two-lobe shell seam follows the nut, with shallow irregular secondary grooves.
  const seam = [];
  for (let i = 0; i <= 24; i++) {
    const a = i * TAU / 24;
    seam.push([Math.sin(a) * 0.243, Math.cos(a) * 0.302, Math.sin(a * 5) * 0.005]);
  }
  p.stem(seam, 0.0054, C.bark, { rows: 36, sides: 6, taper: 1, material: 'skin' });
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const points = [];
    for (let j = 0; j <= 7; j++) {
      const a = 0.43 + j * 0.25, longitude = (i + 0.6) * 0.63;
      points.push([side * 0.24 * Math.sin(a) * Math.cos(longitude), 0.3 * Math.cos(a), 0.24 * Math.sin(a) * Math.sin(longitude)]);
    }
    p.stem(points, 0.0022, C.bark, { rows: 10, sides: 5, taper: 0.45, material: 'skin' });
  }
  p.frontFace([0, 0.028, 0.017], 0.067, 0.206, { size: 1.2 });
  for (const side of [-1, 1]) {
    p.fruit([side * 0.124, -0.025, 0.204], [0.037, 0.024, 0.013], C.warm, { rows: 6, sides: 10, material: 'skin' });
    p.stem([[side * 0.036, 0.13, 0.216], [side * 0.068, 0.147, 0.209], [side * 0.096, 0.135, 0.198]], 0.007, C.bark, { rows: 5, sides: 6, material: 'detail' });
  }
  return p;
}

const BUILDERS = {
  pea: () => pea('pea'), snow: () => pea('snow'), cherry: cherries, cob: corn,
  repeater: () => multiHead('repeater', 2), threepeater: () => multiHead('threepeater', 3),
  gatling, cactus, melon, jalapeno, wallnut: walnut, firepea: () => pea('firepea'),
};

function provenance() {
  return `Original plant weapon assets authored for pvz-shoot.\n\nFiles: ${WEAPON_IDS.map((id) => `${id}.glb`).join(', ')}.\nSource: tools/build-weapon-models.mjs, deterministic original parametric surface authoring.\nThese are original stylized plant meshes; no EA models, ripped game data or downloaded third-party geometry were used.\nGeometry: hollow swept/lathed heads, curved stems, closed thin curved leaves, original fruit surfaces and faceted accents.\nMaterials: embedded linear vertex-painted PBR colors, no external images, no AI image watermarks, no outline meshes.\nCoordinates: Y-up, forward -Z, local origin, no baked camera transform; material groups merged offline.\nRebuild: node tools/build-weapon-models.mjs [output-directory]\n\nNo separate CC0 dedication or third-party license is claimed.\nRedistribution and use remain subject to the repository owner's licensing decisions; this provenance file does not grant a new license.\n`;
}

export async function buildWeaponModels(outputDir = DEFAULT_DIR, ids = WEAPON_IDS) {
  await mkdir(outputDir, { recursive: true });
  const io = new NodeIO(), results = [];
  for (const id of ids) {
    if (!BUILDERS[id]) throw new Error(`Unknown plant weapon: ${id}`);
    const { doc, triangles, draws } = BUILDERS[id]().document();
    const bytes = await io.writeBinary(doc);
    await writeFile(join(outputDir, `${id}.glb`), bytes);
    results.push({ id, triangles, draws, bytes: bytes.length });
  }
  await writeFile(join(outputDir, 'PROVENANCE.txt'), provenance());
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output = DEFAULT_DIR, ...ids] = process.argv.slice(2);
  console.table(await buildWeaponModels(resolve(output), ids.length ? ids : WEAPON_IDS));
}
