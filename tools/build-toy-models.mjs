#!/usr/bin/env node
// Deterministic original toy authoring. Geometry, vertex paint, rigs and clips are baked offline.
// Usage: node tools/build-toy-models.mjs [output-directory] [toySoldier springDuck ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

export const TOY_IDS = ['toySoldier', 'springDuck', 'teaSprite', 'paperGlider', 'jackBox', 'clockRabbit'];
const HEIGHTS = [1.8, 1.1, 1.3, 0.65, 1.6, 3.4];
const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models/toys');
const TAU = Math.PI * 2;
const color = (hex) => new THREE.Color(hex).toArray();
const C = Object.fromEntries(Object.entries({
  wood: '#b57a50', grain: '#805332', cream: '#f6e7c9', red: '#c9534e', ruby: '#8c343d',
  blue: '#395c8f', navy: '#263348', gold: '#cb9845', dark: '#302c38', white: '#f3efdf',
  yellow: '#efbd4b', orange: '#db773c', mint: '#6dafa0', porcelain: '#deece8', blush: '#dfa096',
  steel: '#758b92', cyan: '#7acaca', paper: '#efe5ce', fold: '#c1cccf',
}).map(([k, v]) => [k, color(v)]));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v) => Math.min(1, Math.max(0, v));
const quat = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const paint = (base, grain = false) => (p, n, joint = { position: [0, 0, 0] }) => {
  const local = p.clone().sub(new THREE.Vector3(...joint.position));
  const light = 0.89 + 0.1 * clamp(n.y * 0.6 + n.z * 0.3 + 0.25);
  const stripe = grain ? 0.09 * Math.pow(0.5 + Math.sin(local.y * 38 + Math.sin(local.x * 11) * 1.5) * 0.5, 4) : 0;
  return mix(base, C.grain, stripe).map((v) => v * light);
};


class Toy {
  constructor(id, height) {
    this.id = id;
    this.height = height;
    this.joints = [];
    this.parts = new Map();
    this.clips = [];
  }

  joint(name, position, parent = null) {
    const j = { name, position, parent, index: this.joints.length };
    this.joints.push(j);
    return j;
  }

  add(geometry, joint, base, { position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], part = 'ToyMesh', grain = false } = {}) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion(...quat(...rotation)), new THREE.Vector3(...scale));
    geometry.applyMatrix4(matrix);
    // 展平成非索引网格再处理。源网格（球极点、超椭球的大平面）本来就有大量
    // "同向配对"的四边形，光靠顶点法线反推朝向不可靠。
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const fp = flat.getAttribute('position'), fn = flat.getAttribute('normal');
    const data = this.parts.get(part) || { p: [], n: [], c: [], ix: [], w: [], remap: new Map() };
    const remap = data.remap;
    const tint = typeof base === 'function' ? base : paint(base, grain);
    const v = (i) => new THREE.Vector3().fromBufferAttribute(fp, i);
    const key = (q) => q.toArray().map((x) => x.toFixed(4)).join(',');
    // 按位置做面积加权的平滑法线。凸壳上它永远朝外，是不依赖源数据朝向的可靠参考；
    // 硬边（折缝、球极点的接缝）在下面按"与平滑法线夹角过大"拆成独立顶点。
    const smooth = new Map();
    for (let t = 0; t < fp.count; t += 3) {
      const a = v(t), b = v(t + 1), c = v(t + 2);
      const n = b.sub(a).cross(c.sub(a));
      for (const q of [a, b, c]) {
        const k = key(q);
        const slot = smooth.get(k) || { n: new THREE.Vector3(), p: q.clone() };
        slot.n.add(n);
        smooth.set(k, slot);
      }
    }
    const point = new THREE.Vector3();
    for (let t = 0; t < fp.count; t += 3) {
      const tri = [v(t), v(t + 1), v(t + 2)];
      const face = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));
      if (face.length() < 1e-10) continue;
      // 每个角：平滑法线是基准；和基准夹角大的角视为硬边，保留自己的法线。
      const slots = [0, 1, 2].map((k) => {
        const q = tri[k];
        const baseKey = key(q);
        const ref = (smooth.get(baseKey)?.n ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
        const own = new THREE.Vector3().fromBufferAttribute(fn, t + k);
        if (own.lengthSq() < 1e-12) own.copy(ref);
        own.normalize();
        const hard = own.dot(ref) < 0.55;
        return { id: baseKey + (hard ? '|' + own.toArray().map((x) => x.toFixed(2)).join(',') : ''), q, n: hard ? own : ref };
      });
      // 绕序：三角形法线必须和该角的参考法线同向。
      // 三个角的法线可能互相打架（糖罐的把手上有一对反向三角，夹角刚好 90°）；
      // 用三者之和当判据，和测试的判法一致。
      const need = slots[0].n.clone().add(slots[1].n).add(slots[2].n);
      const order = face.dot(need) >= 0 ? [0, 1, 2] : [0, 2, 1];
      for (const k of order) {
        const slot = slots[k];
        if (!remap.has(slot.id)) {
          remap.set(slot.id, data.p.length / 3);
          data.p.push(...slot.q.toArray());
          data.n.push(...slot.n.toArray());
          data.c.push(...tint(point.copy(slot.q), slot.n, joint));
          // 每个顶点只记"所属关节"，JOINTS_0/WEIGHTS_0 在 document() 里按顶点数展开。
          // 这里曾按 4 分量写，导致顶点数被算成 4 倍（241 → 964），accessor count 越界。
          data.w.push(joint.index);
        }
        data.ix.push(remap.get(slot.id));
      }
    }
    this.parts.set(part, data);
    geometry.dispose();
    if (flat !== geometry) flat.dispose();
  }

  oval(joint, center, size, base, rows = 8, sides = 12, opts = {}) {
    this.add(new THREE.SphereGeometry(1, sides, rows), joint, base, { position: center, scale: size, ...opts });
  }

  box(joint, center, size, base, opts = {}) {
    // Superellipsoid panels: broad flat faces and genuinely rounded timber corners.
    const geometry = new THREE.SphereGeometry(1, 16, 10);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = [p.getX(i), p.getY(i), p.getZ(i)].map((x) => Math.abs(x) < 1e-7 ? 0 : Math.sign(x) * Math.pow(Math.abs(x), 0.24));
      p.setXYZ(i, ...v);
    }
    geometry.computeVertexNormals();
    this.add(geometry, joint, base, { position: center, scale: size, ...opts });
  }

  lathe(joint, center, profile, base, sides = 20, opts = {}) {
    // LatheGeometry 以 y=0 为底向上旋成，顶点是"相对截面"的局部高度。
    // 采样回调要给世界系里的 y（陶罐腰部花纹靠它定位），这里先把每个顶点整体搬到 center。
    // 旋转必须绕 center 做：add() 里 position/rotation 是"先转再平移"，先把几何搬到 center
    // 再交给它，等于绕世界原点转 —— 怀表（rotation [PI/2,0,0]）会被甩到 y=-0.77 去。
    const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), sides);
    geometry.translate(...center);
    const { rotation = [0, 0, 0], ...rest } = opts;
    geometry.translate(-center[0], -center[1], -center[2]);
    geometry.applyQuaternion(new THREE.Quaternion(...quat(...rotation)));
    geometry.translate(...center);
    this.add(geometry, joint, base, { ...rest });
  }

  tube(joint, points, radius, base, rows = 12, sides = 6, opts = {}) {
    const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.2);
    this.add(new THREE.TubeGeometry(path, rows, radius, sides, false), joint, base, opts);
  }

  spring(joint, center, radius, height, turns = 3.5, rows = 56) {
    const points = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, angle = t * TAU * turns;
      points.push([center[0] + Math.cos(angle) * radius, center[1] + height * t, center[2] + Math.sin(angle) * radius]);
    }
    this.tube(joint, points, radius * 0.16, C.steel, rows, 6);
  }

  face(joint, center, width, size = 1, mood = 'smile') {
    for (const side of [-1, 1]) {
      const x = center[0] + width * side;
      this.oval(joint, [x, center[1] + 0.02 * size, center[2]], [0.05 * size, 0.075 * size, 0.025 * size], C.cream, 4, 8);
      this.oval(joint, [x + side * 0.004 * size, center[1] + 0.011 * size, center[2] + 0.022 * size], [0.021 * size, 0.043 * size, 0.012 * size], C.dark, 4, 8);
      this.oval(joint, [x - 0.007 * size, center[1] + 0.032 * size, center[2] + 0.033 * size], [0.009 * size, 0.011 * size, 0.006 * size], C.white, 3, 6);
      this.tube(joint, [[x - 0.045 * size, center[1] + 0.097 * size, center[2] - 0.008 * size],
        [x, center[1] + (mood === 'stern' ? 0.08 : 0.11) * size, center[2] + 0.012 * size],
        [x + 0.045 * size, center[1] + 0.10 * size, center[2] - 0.008 * size]], 0.009 * size, C.dark, 4, 5);
    }
    this.tube(joint, [[center[0] - width * 0.65, center[1] - 0.10 * size, center[2] + 0.01],
      [center[0], center[1] - (mood === 'stern' ? 0.09 : 0.13) * size, center[2] + 0.017],
      [center[0] + width * 0.65, center[1] - 0.10 * size, center[2] + 0.01]], 0.008 * size, C.dark, 6, 5);
  }

  animate(name, duration, tracks) {
    this.clips.push({ name, duration, tracks });
  }

  document() {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'pvz-shoot original toy rig builder'.padEnd('glTF-Transform v4.5.1'.length, ' ');
    const buffer = doc.createBuffer();
    const root = doc.createNode(this.id).setExtras({ original: true, up: '+Y', forward: '+Z', targetHeight: this.height });
    doc.createScene(this.id).addChild(root);
    const material = doc.createMaterial('VertexPaint').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.68);
    const accessor = (name, type, array) => doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
    const skin = doc.createSkin('ToyRig');

    for (const joint of this.joints) {
      const relative = joint.position.map((v, i) => v - (joint.parent ? joint.parent.position[i] : 0));
      joint.node = doc.createNode(joint.name).setTranslation(relative);
      (joint.parent ? joint.parent.node : root).addChild(joint.node);
      skin.addJoint(joint.node);
      // Matrix4.toArray() 是列主序，和 glTF 的 MAT4 一致，直接展开即可。
      // 这里曾经多包了一层 makeTranslation(translation(...))，把 16 个数的矩阵平移了 -x/-y/-z，
      // 于是 IBM 被写坏（byteLength 溢出），three 与 gltf-transform 读取时都崩。
    }
    let triangles = 0;
    const ibmByNode = new Map();
    for (const [name, data] of this.parts) {
      // 胸甲是"可拆卸配件"：破甲时由 Zombie 直接隐藏 root.getObjectByName('ChestArmor')。
      // 它做成**静态网格**挂在根节点上（不蒙皮）：顶点留在世界静止位置，不做任何偏移。
      // 之前把它做成蒙皮网格、靠"顶点减锚点 + IBM 加锚点"原地不动 —— 但 three 的蒙皮走的是
      // bindMatrix 路径，那对加减并不抵消，胸甲整体下沉了 0.87 米。身体和胸甲都不做动画位移，
      // 静态网格视觉上完全等价，还少一次蒙皮矩阵乘法。
      const armor = name === 'ChestArmor';
      const ibm = this.joints.map((joint) => new THREE.Matrix4().makeTranslation(...joint.position.map((v) => -v)).toArray());
      const primitive = doc.createPrimitive().setMaterial(material)
        .setAttribute('POSITION', accessor(name + '-position', 'VEC3', new Float32Array(data.p)))
        .setAttribute('NORMAL', accessor(name + '-normal', 'VEC3', new Float32Array(data.n)))
        .setAttribute('COLOR_0', accessor(name + '-linear-paint', 'VEC3', new Float32Array(data.c)))
        .setIndices(accessor(name + '-indices', 'SCALAR', new Uint16Array(data.ix)));
      const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
      root.addChild(node);
      if (armor) node.setExtras({ removableArmor: true });
      else {
        const joints = data.w;
        const weights = new Float32Array(joints.length * 4);
        for (let v = 0; v < joints.length; v++) weights[v * 4] = 1;
        primitive
          .setAttribute('JOINTS_0', accessor(name + '-joints', 'VEC4', new Uint16Array(joints.flatMap((index) => [index, 0, 0, 0]))))
          .setAttribute('WEIGHTS_0', accessor(name + '-weights', 'VEC4', weights));
        node.setSkin(skin);
      }
      ibmByNode.set(node, ibm);
      triangles += data.ix.length / 3;
    }
    // 蒙皮只有一份，IBM 用第一个网格的那套（身体是纯 -p，也是所有玩具唯一的蒙皮网格）。
    const [firstNode, firstIbm] = ibmByNode.entries().next().value;
    void firstNode;
    skin.setSkeleton(this.joints[0].node).setInverseBindMatrices(accessor('inverse-bind-matrices', 'MAT4', new Float32Array(firstIbm.flat())));
    for (const clip of this.clips) {
      const anim = doc.createAnimation(clip.name);
      const frames = 17;
      const times = accessor(clip.name + '-times', 'SCALAR', new Float32Array(Array.from({ length: frames }, (_, i) => i * clip.duration / (frames - 1))));
      for (const track of clip.tracks) {
        const values = Array.from({ length: frames }, (_, i) => track.value(i / (frames - 1))).flat();
        const output = accessor(clip.name + '-' + track.joint.name, track.path === 'rotation' ? 'VEC4' : 'VEC3', new Float32Array(values));
        const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(track.joint.node).setTargetPath(track.path).setSampler(sampler));
      }
    }
    const limit = this.id === 'clockRabbit' ? 8000 : 4000;
    if (triangles > limit) throw new Error(this.id + ': ' + triangles + ' exceeds ' + limit + ' triangles');
    return { doc, triangles, draws: this.parts.size, joints: this.joints.length };
  }
}

const rotationTrack = (joint, value) => ({ joint, path: 'rotation', value: (t) => quat(...value(t)) });
const translateTrack = (joint, value) => ({ joint, path: 'translation', value });
const scaleTrack = (joint, value) => ({ joint, path: 'scale', value });
const wave = (t) => Math.sin(t * TAU);
const pulse = (t) => Math.sin(t * Math.PI);

function puppetClips(p, body, head, limbs, specialty = []) {
  const headTrack = (gain) => rotationTrack(head, (t) => [wave(t) * gain, wave(t) * gain * 0.6, pulse(t) * gain * 0.25]);
  const idle = [headTrack(0.035), rotationTrack(body, (t) => [0, 0, wave(t) * 0.014])];
  const walk = [headTrack(0.065), rotationTrack(body, (t) => [0, wave(t) * 0.035, wave(t) * 0.027])];
  const attack = [rotationTrack(head, (t) => [-pulse(t) * 0.23, wave(t) * 0.05, 0]), rotationTrack(body, (t) => [pulse(t) * 0.13, 0, 0])];
  const hit = [rotationTrack(head, (t) => [pulse(t) * 0.30, 0, wave(t) * 0.06]), rotationTrack(body, (t) => [-pulse(t) * 0.14, 0, 0])];
  const death = [rotationTrack(head, (t) => [t * 0.5, 0, t * 0.1]), rotationTrack(body, (t) => [-t * 1.3, 0, t * 0.12])];
  for (const [joint, side, kind] of limbs) {
    const gain = kind === 'leg' ? 0.38 : 0.48;
    idle.push(rotationTrack(joint, (t) => [wave(t) * 0.03 * side, 0, 0]));
    walk.push(rotationTrack(joint, (t) => [wave(t) * gain * side, 0, 0]));
    attack.push(rotationTrack(joint, (t) => [kind === 'arm' ? -pulse(t) * 1.15 : pulse(t) * 0.04, 0, side * pulse(t) * 0.06]));
    hit.push(rotationTrack(joint, (t) => [pulse(t) * 0.16 * side, 0, 0]));
    death.push(rotationTrack(joint, (t) => [t * 0.23 * side, 0, t * 0.32 * side]));
  }
  for (const s of specialty) {
    if (s.idle) idle.push(s.idle);
    if (s.walk) walk.push(s.walk);
    if (s.attack) attack.push(s.attack);
    if (s.hit) hit.push(s.hit);
    if (s.death) death.push(s.death);
  }
  // 每段动画都给 Body 一条"原地"平移通道：Idle 只有微软的呼吸起伏，其余恒定。
  // 走位完全交给游戏里的 root.position，动画自身绝不带水平根位移
  // （实测过纸飞机 +2.5mm、八音盒 +3cm 的浮点漂移，就是在 Body 位移上漏出来的）。
  // 注意 Walk 里已经有鸭子/弹簧自己的弹跳通道，这里不能再叠一条，否则会互相覆盖。
  const grounded = (bob) => translateTrack(body, (t) => [body.position[0], body.position[1] + bob(t), body.position[2]]);
  p.animate('Idle', 2.4, [...idle, grounded((t) => wave(t) * 0.008)]);
  p.animate('Walk', 0.95, walk.some((track) => track.joint === body && track.path === 'translation') ? walk : [...walk, grounded(() => 0)]);
  p.animate('Idle_Attack', 1.1, [...attack, grounded(() => 0)]);
  p.animate('Attack', 1.1, [...attack, grounded(() => 0)]);
  p.animate('HitReact', 0.42, [...hit, grounded(() => 0)]);
  p.animate('Death', 1.35, [...death, grounded(() => 0)]);
}

function soldier() {
  const p = new Toy('toySoldier', 1.8), body = p.joint('Body', [0, 0.87, 0]), head = p.joint('Head', [0, 1.37, 0], body);
  p.lathe(body, [0, 0.62, 0], [[0, 0], [0.19, 0], [0.24, 0.10], [0.25, 0.37], [0.19, 0.55], [0, 0.55]], C.red, 16);
  p.box(body, [0, 0.99, 0.245], [0.235, 0.22, 0.065], C.cream, { part: 'ChestArmor' });
  for (const x of [-0.13, 0.13]) for (let i = 0; i < 3; i++) p.oval(body, [x, 0.87 + i * 0.10, 0.312], [0.026, 0.026, 0.014], C.gold, 3, 6, { part: 'ChestArmor' });
  p.lathe(body, [0, 0.69, 0], [[0, 0], [0.241, 0], [0.244, 0.055], [0, 0.055]], C.navy, 16);
  p.box(body, [0, 0.72, 0.243], [0.046, 0.032, 0.016], C.gold);
  p.oval(head, [0, 1.37, 0], [0.235, 0.235, 0.22], C.wood, 10, 16, { grain: true });
  p.oval(head, [0, 1.35, 0.225], [0.045, 0.06, 0.061], C.wood, 5, 8);
  p.face(head, [0, 1.40, 0.20], 0.094, 0.65, 'stern');
  for (const side of [-1, 1]) p.tube(head, [[0, 1.30, 0.231], [side * 0.073, 1.285, 0.24], [side * 0.15, 1.325, 0.19]], 0.018, C.dark, 6, 5);
  p.lathe(head, [0, 1.54, 0], [[0, 0], [0.27, 0], [0.27, 0.055], [0.21, 0.055], [0.205, 0.26], [0, 0.26]], C.navy, 16);
  p.tube(head, [[-0.19, 1.66, 0.092], [-0.10, 1.61, 0.195], [0, 1.60, 0.21], [0.10, 1.61, 0.195], [0.19, 1.66, 0.092]], 0.009, C.gold, 10, 5);
  p.oval(head, [0, 1.72, 0.208], [0.035, 0.044, 0.01], C.red, 4, 6);
  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = p.joint(side < 0 ? 'ArmL' : 'ArmR', [side * 0.30, 1.09, 0], body);
    const leg = p.joint(side < 0 ? 'LegL' : 'LegR', [side * 0.13, 0.63, 0], body);
    p.oval(arm, [side * 0.30, 1.09, 0], [0.115, 0.085, 0.12], C.gold, 5, 8);
    p.lathe(arm, [side * 0.32, 0.64, 0], [[0, 0], [0.085, 0], [0.095, 0.35], [0, 0.35]], C.red, 10);
    p.oval(arm, [side * 0.32, 0.59, 0], [0.087, 0.09, 0.082], C.wood, 6, 10, { grain: true });
    p.lathe(leg, [side * 0.13, 0.16, 0], [[0, 0], [0.084, 0], [0.077, 0.47], [0, 0.47]], C.cream, 10);
    p.box(leg, [side * 0.13, 0.10, 0.06], [0.105, 0.10, 0.18], C.navy);
    limbs.push([arm, side, 'arm'], [leg, -side, 'leg']);
  }
  puppetClips(p, body, head, limbs);
  return p;
}

function duck() {
  const p = new Toy('springDuck', 1.1), body = p.joint('Body', [0, 0.48, 0]), head = p.joint('Head', [0, 0.86, 0.16], body);
  const spring = p.joint('Spring', [0, 0.13, 0]);
  p.spring(spring, [0, 0.13, 0], 0.105, 0.32, 3.3, 56);
  p.oval(body, [0, 0.49, -0.02], [0.33, 0.25, 0.35], C.yellow, 12, 20);
  p.oval(head, [0, 0.86, 0.16], [0.235, 0.24, 0.245], C.yellow, 10, 16);
  p.oval(head, [0, 0.80, 0.39], [0.16, 0.068, 0.19], C.orange, 6, 12);
  p.tube(head, [[-0.12, 0.797, 0.485], [0, 0.785, 0.54], [0.12, 0.797, 0.485]], 0.006, C.ruby, 7, 5);
  p.face(head, [0, 0.905, 0.35], 0.092, 0.66);
  const limbs = [];
  for (const side of [-1, 1]) {
    const wing = p.joint(side < 0 ? 'WingL' : 'WingR', [side * 0.28, 0.55, -0.01], body);
    const foot = p.joint(side < 0 ? 'FootL' : 'FootR', [side * 0.13, 0.07, 0]);
    p.oval(wing, [side * 0.30, 0.49, -0.025], [0.064, 0.155, 0.20], C.gold, 6, 12, { rotation: [0.15, side * 0.1, side * 0.35] });
    p.oval(foot, [side * 0.13, 0.055, 0.055], [0.13, 0.055, 0.18], C.orange, 6, 12);
    limbs.push([wing, side, 'arm']);
    // Rubber feet lift rather than rotate through the island surface.
    foot.lift = translateTrack(foot, (t) => [side * 0.13, 0.07 + Math.max(0, side * wave(t)) * 0.04, 0]);
    limbs.push([foot, side, 'foot']);
  }
  const bounce = translateTrack(body, (t) => [0, 0.48 + (1 - Math.cos(t * TAU * 2)) * 0.025, 0]);
  puppetClips(p, body, head, limbs, [
    { idle: scaleTrack(spring, (t) => [1, 1 + wave(t) * 0.055, 1]), walk: scaleTrack(spring, (t) => [1, 1 + (1 - Math.cos(t * TAU * 2)) * 0.13, 1]), attack: scaleTrack(spring, (t) => [1.1, 1 - pulse(t) * 0.42, 1.1]), death: scaleTrack(spring, (t) => [1, 1 - t * 0.72, 1]) },
    { walk: bounce },
  ]);
  return p;
}

function teapot() {
  const p = new Toy('teaSprite', 1.3), body = p.joint('Body', [0, 0.58, 0]), head = p.joint('Head', [0, 0.97, 0], body);
  const lid = p.joint('Lid', [0, 1.06, 0], head), spout = p.joint('Spout', [0.28, 0.67, 0.02], body), handle = p.joint('Handle', [-0.30, 0.71, -0.01], body);
  p.lathe(body, [0, 0.15, 0], [[0, 0], [0.24, 0], [0.29, 0.07], [0.43, 0.27], [0.45, 0.43], [0.35, 0.68], [0.22, 0.86], [0.18, 0.91], [0, 0.91]],
    (v, n) => {
      const band = v.y > 0.40 && v.y < 0.78;
      const petals = Math.cos(Math.atan2(v.z, v.x) * 9) * Math.sin((v.y - 0.4) * 17);
      return paint(band && petals > 0.68 ? C.blue : C.porcelain)(v, n);
    }, 24);
  p.tube(spout, [[0.29, 0.64, 0.01], [0.49, 0.68, 0.12], [0.63, 0.84, 0.25], [0.64, 1.01, 0.37]], 0.095, C.porcelain, 14, 10);
  // Dark recessed mouth and a porcelain rolled rim, facing forward/up.
  p.oval(spout, [0.64, 1.018, 0.374], [0.086, 0.013, 0.09], C.navy, 4, 10, { rotation: [0.6, 0, 0] });
  p.tube(handle, [[-0.27, 0.90, 0], [-0.54, 0.95, -0.045], [-0.66, 0.69, -0.08], [-0.53, 0.47, -0.05], [-0.31, 0.46, 0]], 0.067, C.blue, 18, 8);
  p.lathe(lid, [0, 1.04, 0], [[0, 0], [0.235, 0], [0.26, 0.05], [0.20, 0.105], [0.10, 0.14], [0, 0.15]], C.blue, 24);
  p.oval(lid, [0, 1.245, 0], [0.065, 0.055, 0.065], C.gold, 6, 12);
  p.face(head, [0, 0.72, 0.412], 0.14, 0.94);
  for (const side of [-1, 1]) p.oval(body, [side * 0.19, 0.54, 0.403], [0.046, 0.025, 0.015], C.blush, 4, 8);
  const limbs = [];
  for (const side of [-1, 1]) {
    const foot = p.joint(side < 0 ? 'FootL' : 'FootR', [side * 0.19, 0.12, 0]);
    p.oval(foot, [side * 0.19, 0.075, 0.04], [0.11, 0.075, 0.16], C.blue, 6, 12);
    limbs.push([foot, side, 'foot']);
  }
  puppetClips(p, body, head, limbs, [
    { idle: rotationTrack(lid, (t) => [0, 0, wave(t) * 0.025]), walk: rotationTrack(lid, (t) => [0, 0, wave(t) * 0.075]), attack: translateTrack(lid, (t) => [0, 0.09 + pulse(t) * 0.16, 0]), death: rotationTrack(lid, (t) => [t * 0.6, 0, t * 0.4]) },
    { attack: rotationTrack(spout, (t) => [-pulse(t) * 0.12, -pulse(t) * 0.24, 0]) },
    { walk: rotationTrack(handle, (t) => [wave(t) * 0.025, 0, 0]) },
  ]);
  return p;
}

function paperPanel(p, joint, corners, base) {
  // A closed thin triangular paper prism with crisp folded edges.
  // 纸片必须是封闭实体：以前做的是"正反两片薄面 + 按三角法线猜绕序"，
  // 结果是 577 个反向/零面积三角形（纸飞机的机翼直接隐身）。
  // 现在按 a→b→c 的叉积定出外法线，正面壳、背面壳、三条侧边各自生成，
  // 绕序由外法线推出来，不再猜。
  const [a, b, c] = corners.map((v) => new THREE.Vector3(...v));
  const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const half = 0.005;
  const vertices = [], indices = [];
  const push = (v) => (vertices.push(...v.toArray()), vertices.length / 3 - 1);
  // 让三角形的绕序与该面自己的外法线一致（右手定则）。
  const face = (i0, i1, i2, out) => {
    const p0 = new THREE.Vector3().fromArray(vertices, i0 * 3), p1 = new THREE.Vector3().fromArray(vertices, i1 * 3), p2 = new THREE.Vector3().fromArray(vertices, i2 * 3);
    indices.push(...(p1.sub(p0).cross(p2.sub(p0)).dot(out) > 0 ? [i0, i1, i2] : [i0, i2, i1]));
  };
  for (const sign of [1, -1]) {
    const out = normal.clone().multiplyScalar(sign);
    const na = a.clone().addScaledVector(out, half), nb = b.clone().addScaledVector(out, half), nc = c.clone().addScaledVector(out, half);
    const ia = push(na), ib = push(nb), ic = push(nc);
    face(ia, ib, ic, out);
  }
  // 侧边：每条棱内侧两个点 + 外侧两个点拼成四边形，法线朝棱外。
  for (const [start, end] of [[a, b], [b, c], [c, a]]) {
    const edge = end.clone().sub(start);
    const outward = edge.clone().cross(normal).normalize();
    const i0 = push(start.clone().addScaledVector(normal, half)), i1 = push(end.clone().addScaledVector(normal, half));
    const i2 = push(end.clone().addScaledVector(normal, -half)), i3 = push(start.clone().addScaledVector(normal, -half));
    face(i0, i1, i2, outward);
    face(i0, i2, i3, outward);
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  p.add(geometry, joint, base);
  // Thin colored seam tubes close and emphasize each folded edge.
  for (const [start, end] of [[a, b], [b, c], [c, a]]) p.tube(joint, [start.toArray(), start.clone().lerp(end, 0.5).toArray(), end.toArray()], 0.006, C.fold, 5, 4);
}

function glider() {
  const p = new Toy('paperGlider', 0.65), body = p.joint('Body', [0, 0.25, 0]), head = p.joint('Head', [0, 0.39, 0.37], body);
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = p.joint(side < 0 ? 'WingL' : 'WingR', [side * 0.10, 0.30, 0], body);
    paperPanel(p, wing, [[side * 0.08, 0.29, 0.77], [side * 0.88, 0.30, -0.59], [side * 0.075, 0.46, -0.47]], C.paper);
    // 翻折面在 +X 侧要用相反绕序，否则法线朝内、测试判定出"反向三角形"。
    paperPanel(p, wing, [[side * 0.88, 0.30, -0.59], [side * 0.72, 0.48, -0.59], [side * 0.46, 0.34, -0.05]], C.fold);
    wings.push([wing, side, 'wing']);
  }
  paperPanel(p, body, [[0, 0.025, -0.33], [0, 0.45, -0.48], [0, 0.295, 0.77]], C.paper);
  p.oval(head, [0, 0.39, 0.43], [0.115, 0.10, 0.17], C.red, 8, 12);
  p.face(head, [0, 0.425, 0.562], 0.055, 0.43);
  // 尾旗顶端定在 0.6499：管状扫掠的端盖是圆的，端点 y 会略低于路径末端，
  // 这里预留那一点，让包围盒顶正好落在 0.65（素材契约要求 max.y === targetHeight）。
  p.tube(body, [[0, 0.45, -0.46], [0, 0.577, -0.54], [0, 0.644, -0.66]], 0.007, C.red, 6, 5);
  // 尾翼 + 副翼：纸飞机真正的辨识度在"折出来的层"，不是一块大白面。
  // 每一片都是 paperPanel 的封闭三棱柱，绕序由外法线推出来，不会引入反向三角形。
  for (const side of [-1, 1]) {
    paperPanel(p, body, [[side * 0.03, 0.30, -0.30], [side * 0.30, 0.42, -0.62], [side * 0.05, 0.46, -0.50]], C.fold);
    paperPanel(p, body, [[side * 0.10, 0.295, 0.62], [side * 0.36, 0.30, 0.06], [side * 0.11, 0.40, 0.02]], C.fold);
    paperPanel(p, body, [[side * 0.40, 0.30, 0.10], [side * 0.80, 0.30, -0.55], [side * 0.48, 0.355, -0.20]], C.paper);
    // 机翼折痕上的红色装饰条，靠管状扫掠做出"手工上色"的笔触。
    p.tube(body, [[side * 0.14, 0.31, 0.60], [side * 0.45, 0.315, 0.10], [side * 0.76, 0.30, -0.44]], 0.009, C.red, 9, 5);
    p.oval(body, [side * 0.30, 0.305, -0.12], [0.045, 0.012, 0.045], C.gold, 4, 8);
  }
  // 机身龙骨两侧的小铆钉，给近距离特写一点材质节奏。
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    p.oval(body, [0, 0.028 + t * 0.40, 0.52 - t * 0.72], [0.012, 0.012, 0.012], C.gold, 3, 6);
  }
  // The grounded keel touches zero, while broad folded wings retain a +Z pointed nose.
  p.oval(body, [0, 0.018, -0.33], [0.017, 0.018, 0.03], C.ruby, 4, 6);
  puppetClips(p, body, head, [], wings.map(([joint, side]) => ({
    idle: rotationTrack(joint, (t) => [0, 0, side * wave(t) * 0.04]),
    walk: rotationTrack(joint, (t) => [0, 0, side * wave(t) * 0.18]),
    attack: rotationTrack(joint, (t) => [pulse(t) * 0.06, 0, -side * pulse(t) * 0.55]),
    death: rotationTrack(joint, (t) => [0, 0, -side * t * 0.9]),
  })));
  return p;
}

function jack() {
  const p = new Toy('jackBox', 1.6), body = p.joint('Body', [0, 0.50, 0]), spring = p.joint('Spring', [0, 0.83, 0], body);
  const head = p.joint('Head', [0, 1.32, 0], body), lid = p.joint('Lid', [0, 1.02, -0.36], body), glove = p.joint('Glove', [0.31, 1.22, 0.12], head);
  p.box(body, [0, 0.43, 0], [0.40, 0.40, 0.38], C.blue);
  p.box(body, [0, 0.47, 0.381], [0.31, 0.285, 0.018], C.red);
  p.box(body, [0, 0.055, 0], [0.43, 0.055, 0.41], C.gold);
  p.face(body, [0, 0.52, 0.418], 0.12, 0.9, 'stern');
  p.box(lid, [0, 1.10, -0.39], [0.42, 0.25, 0.042], C.red, { rotation: [-0.22, 0, 0] });
  p.tube(lid, [[-0.30, 1.18, -0.323], [0, 1.28, -0.323], [0.30, 1.18, -0.323]], 0.012, C.gold, 8, 5);
  p.spring(spring, [0, 0.84, 0], 0.105, 0.34, 3, 42);
  p.oval(head, [0, 1.34, 0.01], [0.24, 0.26, 0.23], C.mint, 10, 16);
  p.face(head, [0, 1.40, 0.212], 0.09, 0.7);
  p.oval(head, [0, 1.34, 0.25], [0.036, 0.04, 0.038], C.red, 4, 8);
  p.tube(glove, [[0.16, 1.21, 0.09], [0.30, 1.18, 0.18], [0.37, 1.22, 0.27]], 0.065, C.cream, 8, 8);
  p.oval(glove, [0.39, 1.22, 0.35], [0.16, 0.15, 0.19], C.red, 8, 12);
  p.oval(glove, [0.27, 1.17, 0.39], [0.073, 0.066, 0.085], C.ruby, 5, 8);
  p.oval(body, [0.44, 0.54, 0], [0.04, 0.12, 0.06], C.gold, 6, 8);
  p.tube(body, [[0.44, 0.52, 0], [0.57, 0.52, 0], [0.58, 0.69, 0]], 0.027, C.gold, 5, 6);
  puppetClips(p, body, head, [], [
    { idle: rotationTrack(lid, (t) => [wave(t) * 0.03, 0, 0]), walk: rotationTrack(lid, (t) => [wave(t) * 0.10, 0, 0]), attack: rotationTrack(lid, (t) => [pulse(t) * 0.4, 0, 0]), death: rotationTrack(lid, (t) => [-t * 0.9, 0, 0]) },
    { walk: scaleTrack(spring, (t) => [1, 1 + wave(t) * 0.12, 1]), attack: scaleTrack(spring, (t) => [1, 1 + pulse(t) * 0.30, 1]), death: scaleTrack(spring, (t) => [1, 1 - t * 0.7, 1]) },
    { attack: translateTrack(glove, (t) => [0.31, -0.10, 0.12 + pulse(t) * 0.72]), walk: rotationTrack(glove, (t) => [0, 0, wave(t) * 0.06]), death: rotationTrack(glove, (t) => [0, 0, t * 0.9]) },
  ]);
  return p;
}

function rabbit() {
  const p = new Toy('clockRabbit', 3.4), body = p.joint('Body', [0, 1.37, 0]), head = p.joint('Head', [0, 2.31, 0], body);
  p.oval(body, [0, 1.43, 0], [0.56, 0.70, 0.40], C.wood, 12, 16, { grain: true });
  p.oval(body, [0, 1.69, -0.02], [0.58, 0.52, 0.39], C.blue, 8, 14);
  p.oval(head, [0, 2.30, 0.04], [0.47, 0.43, 0.38], C.cream, 10, 16, { grain: true });
  p.oval(head, [-0.13, 2.18, 0.375], [0.19, 0.14, 0.095], C.white, 5, 8);
  p.oval(head, [0.13, 2.18, 0.375], [0.19, 0.14, 0.095], C.white, 5, 8);
  p.face(head, [0, 2.38, 0.362], 0.17, 1.1);
  p.oval(head, [0, 2.24, 0.45], [0.078, 0.049, 0.047], C.red, 4, 8);
  p.box(head, [0, 2.08, 0.412], [0.09, 0.065, 0.037], C.white);
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = p.joint(side < 0 ? 'EarL' : 'EarR', [side * 0.22, 2.58, 0], head);
    p.oval(ear, [side * 0.23, 2.96, 0.035], [0.14, 0.44, 0.11], C.wood, 9, 12, { grain: true });
    p.oval(ear, [side * 0.23, 3.01, 0.123], [0.075, 0.29, 0.017], C.red, 6, 10);
    p.tube(ear, [[side * 0.23, 2.77, 0.142], [side * 0.23, 3.01, 0.15], [side * 0.23, 3.28, 0.13]], 0.010, C.gold, 10, 5);
    ears.push(ear);
  }
  const watch = p.joint('PocketWatch', [0, 1.50, 0.40], body), hand = p.joint('ClockHand', [0, 1.50, 0.467], watch);
  p.lathe(watch, [0, 1.50, 0.40], [[0, 0], [0.35, 0], [0.37, 0.035], [0.35, 0.095], [0, 0.095]], C.gold, 18, { rotation: [Math.PI / 2, 0, 0] });
  p.oval(watch, [0, 1.50, 0.461], [0.315, 0.315, 0.026], C.paper, 6, 16);
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    p.box(watch, [Math.sin(a) * 0.256, 1.50 + Math.cos(a) * 0.256, 0.49], [0.014, 0.030, 0.005], C.navy, { rotation: [0, 0, -a] });
  }
  p.tube(hand, [[0, 1.49, 0.507], [0, 1.64, 0.507], [0, 1.75, 0.507]], 0.014, C.red, 6, 5);
  p.tube(hand, [[0, 1.50, 0.510], [0.10, 1.52, 0.510], [0.16, 1.54, 0.510]], 0.018, C.navy, 5, 5);
  p.oval(watch, [0, 1.88, 0.41], [0.046, 0.070, 0.028], C.gold, 4, 8);
  p.tube(body, [[0, 1.88, 0.41], [-0.19, 1.89, 0.35], [-0.32, 2.03, 0.25]], 0.015, C.gold, 12, 6);
  p.oval(body, [0, 1.06, -0.44], [0.22, 0.20, 0.20], C.cream, 6, 10, { grain: true });
  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = p.joint(side < 0 ? 'ArmL' : 'ArmR', [side * 0.53, 1.97, 0], body), leg = p.joint(side < 0 ? 'LegL' : 'LegR', [side * 0.25, 0.96, 0], body);
    p.oval(arm, [side * 0.60, 1.63, 0], [0.16, 0.36, 0.17], C.blue, 6, 10);
    p.oval(arm, [side * 0.64, 1.27, 0.06], [0.16, 0.19, 0.15], C.cream, 6, 10, { grain: true });
    p.oval(leg, [side * 0.25, 0.59, 0], [0.19, 0.42, 0.19], C.wood, 7, 10, { grain: true });
    p.oval(leg, [side * 0.25, 0.135, 0.13], [0.23, 0.135, 0.34], C.ruby, 6, 10);
    limbs.push([arm, side, 'arm'], [leg, -side, 'leg']);
  }
  puppetClips(p, body, head, limbs, [
    ...ears.map((ear, i) => ({ idle: rotationTrack(ear, (t) => [wave(t) * 0.06, 0, 0]), walk: rotationTrack(ear, (t) => [wave(t) * 0.12, 0, wave(t) * (i ? -0.05 : 0.05)]), attack: rotationTrack(ear, (t) => [0, 0, pulse(t) * (i ? -0.8 : 0.35)]), death: rotationTrack(ear, (t) => [t * 1.1, 0, t * (i ? -0.35 : 0.35)]) })),
    { idle: rotationTrack(hand, (t) => [0, 0, t * TAU]), walk: rotationTrack(hand, (t) => [0, 0, t * TAU]), attack: rotationTrack(hand, (t) => [0, 0, t * TAU * 2]), death: rotationTrack(hand, (t) => [0, 0, -t * Math.PI / 2]) },
  ]);
  return p;
}

const BUILDERS = { toySoldier: soldier, springDuck: duck, teaSprite: teapot, paperGlider: glider, jackBox: jack, clockRabbit: rabbit };

function provenance() {
  return 'Original cloud carnival toy assets authored for pvz-shoot.\n\n'
    + 'Files: ' + TOY_IDS.map((id) => id + '.glb').join(', ') + '.\n'
    + 'Source: tools/build-toy-models.mjs; deterministic original offline surface, paint, rig and clip authoring.\n'
    + 'No EA models, zombie reskins, downloaded geometry, third-party animations or external textures were used.\n'
    + 'Geometry: rounded timber puppet panels, lathed porcelain, swept spout/handle/springs, closed thin paper folds, glove and long-eared watch rabbit.\n'
    + 'Materials: one shared embedded linear vertex-painted material per toy; warm directional vertex shading and original timber/porcelain motifs.\n'
    + 'Rig: one rigid-weight skinned main mesh, individual articulated joints, one separately removable ChestArmor mesh for toySoldier.\n'
    + 'Clips: Idle, Walk, Idle_Attack, Attack (alias), HitReact, Death; original toy-specific articulation; no horizontal root motion.\n'
    + 'Coordinates: +Y up, +Z forward, feet at zero, target heights ' + HEIGHTS.join('/') + ' meters; type scale 1.\n'
    + 'Rebuild: node tools/build-toy-models.mjs [output-directory] [toy ids ...].\n\n'
    + 'No separate CC0 dedication or third-party license is claimed. Use and redistribution remain subject to the repository owner licensing decisions. This provenance grants no new license.\n';
}

export async function buildToyModels(outputDir = DEFAULT_DIR, ids = TOY_IDS) {
  await mkdir(outputDir, { recursive: true });
  const io = new NodeIO(), report = [];
  for (const id of ids) {
    if (!BUILDERS[id]) throw new Error('Unknown toy: ' + id);
    const { doc, triangles, draws, joints } = BUILDERS[id]().document();
    // NodeIO 用默认 Asset 覆盖 generator，写盘前拷回来，保证来源可追溯。
    // 名字必须和默认值等长：JSON 长度一变，下面按偏移回写就会错位。
    const { generator } = doc.getRoot().getAsset();
    const bytes = await io.writeBinary(doc);
    // glb 头 12B，JSON chunk 头 8B，所以 JSON 正文从 20 开始。
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
    if (json.slice(0, 8) !== '{"asset"') throw new Error(id + ': unexpected JSON head ' + JSON.stringify(json.slice(0, 16)));
    // 直接整体重写 JSON chunk（而不是等长回填）：generator 变长变短都不会错位。
    // 规范要求 JSON chunk 用空格补到 4 字节对齐，且不能写 0x00。
    let chunk = new TextEncoder().encode(json.replace(/^\{"asset":\{"generator":"[^"]*"/, '{"asset":{"generator":' + JSON.stringify(generator)));
    while (chunk.length % 4) chunk = new Uint8Array([...chunk, 0x20]);
    const head = bytes.subarray(0, 20), bin = bytes.subarray(20 + jsonLength);
    const out = new Uint8Array(head.length + 8 + chunk.length + bin.length);
    const view = new DataView(out.buffer);
    out.set(head, 0);
    view.setUint32(12, chunk.length, true);
    out.set(new TextEncoder().encode('JSON'), 16);
    out.set(chunk, 20);
    out.set(bin, 20 + chunk.length);
    view.setUint32(8, out.length, true);
    await writeFile(join(outputDir, id + '.glb'), out);
    report.push({ id, triangles, draws, joints, bytes: bytes.length });
  }
  await writeFile(join(outputDir, 'PROVENANCE.txt'), provenance());
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output = DEFAULT_DIR, ...ids] = process.argv.slice(2);
  console.table(await buildToyModels(resolve(output), ids.length ? ids : TOY_IDS));
}
