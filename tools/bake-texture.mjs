#!/usr/bin/env node
// 盒式投影 UV 烘焙：给没有 UV（或 UV 不适用）的白模 glb 生成 TEXCOORD_0，
// 并把 PNG 贴图作为 baseColorTexture 嵌进 glb。蒙皮（JOINTS_0/WEIGHTS_0）与动画原样保留。
//
// 用法：
//   node tools/bake-texture.mjs <in.glb> <out.glb> [--tile 6] [--rough 0.9] \
//        --tex a.png --mats Body,Arms [--tex b.png --mats Cap --tile 3]
//
// --tex/--mats 成对出现：把 PNG 贴到列出的材质上（未列出的材质保持原样）。
// --tile 是贴图在模型包围盒最长边上重复的次数（每组可单独覆盖）。
// 贴图必须无缝可平铺（ImageGen 提示词写 seamless tileable）。

import { readFileSync, writeFileSync } from 'fs';

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('usage: node tools/bake-texture.mjs <in.glb> <out.glb> [--tile N] [--rough R] (--tex x.png --mats M1,M2)...');
  process.exit(1);
}
const [inPath, outPath] = argv;
const jitter = argv.includes('--jitter');
const groups = [];
let cur = null;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--tex') { cur = { tex: argv[++i], tile: null, rough: null }; groups.push(cur); }
  else if (argv[i] === '--mats') cur.mats = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
  else if (argv[i] === '--tile') cur.tile = parseFloat(argv[++i]);
  else if (argv[i] === '--rough') cur.rough = parseFloat(argv[++i]);
}
let globalTile = 6, globalRough = null;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--tile') globalTile = parseFloat(argv[++i]);
  if (argv[i] === '--rough') globalRough = parseFloat(argv[++i]);
}

// ── GLB 解析 ──────────────────────────────────────────────
const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error(inPath + ': not a GLB');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
let off = 20 + (jsonLen + 3 & ~3);
const binLen = buf.readUInt32LE(off);
const bin = buf.slice(off + 8, off + 8 + binLen);
if ((json.buffers || []).length !== 1 || json.buffers[0].uri) throw new Error('expect single embedded buffer');

const NUMCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TypedArr = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};

function readAccessor(ai) {
  const a = json.accessors[ai];
  if (a.sparse) throw new Error('sparse accessors not supported');
  const bv = json.bufferViews[a.bufferView];
  if (bv.byteStride) throw new Error('byteStride not supported');
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = NUMCOMP[a.type];
  return new TypedArr[a.componentType](bin.buffer, bin.byteOffset + start, a.count * n);
}

// ── 新 BIN 数据收集 ───────────────────────────────────────
const chunks = [];       // { data: Buffer }
let binCursor = bin.length;
function align4() { const pad = (4 - binCursor % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); binCursor += pad; } }
function pushView(data, target) {
  align4();
  const bv = { buffer: 0, byteOffset: binCursor, byteLength: data.length };
  if (target) bv.target = target;
  chunks.push(data); binCursor += data.length;
  return json.bufferViews.push(bv) - 1;
}
function pushAccessor(view, compType, type, count, min, max) {
  const a = { bufferView: view, componentType: compType, count, type };
  if (min) a.min = min;
  if (max) a.max = max;
  return json.accessors.push(a) - 1;
}

// 每个 mesh 收集要烘焙的 prim 变更（延后写，避免边遍历边改结构）
const primPatches = [];  // { mesh, prim, attrs: {NAME: accessorIdx}, indices }

for (const g of groups) {
  const matIdxByName = new Map();
  json.materials.forEach((m, i) => matIdxByName.set(m.name, i));
  const texIdxByName = new Map(); // material name -> group
  for (const name of g.mats) {
    if (!matIdxByName.has(name)) { console.warn('  ! material not found: ' + name); continue; }
    texIdxByName.set(name, matIdxByName.get(name));
  }
  if (!texIdxByName.size) throw new Error('no target material matched for ' + g.tex);

  json.images = json.images || []; json.samplers = json.samplers || []; json.textures = json.textures || [];
  const png = readFileSync(g.tex);
  const imgView = pushView(png);
  const imageIdx = json.images.push({ bufferView: imgView, mimeType: 'image/png', name: g.tex.replace(/.*\//, '').replace(/\.png$/, '') }) - 1;
  const samplerIdx = json.samplers.push({ wrapS: 10497, wrapT: 10497, magFilter: 9729, minFilter: 9987 }) - 1;
  const textureIdx = json.textures.push({ sampler: samplerIdx, source: imageIdx }) - 1;
  const tile = g.tile ?? globalTile;

  json.meshes.forEach((mesh, mi) => {
    mesh.primitives.forEach((prim, pi) => {
      if (prim.material === undefined || !texIdxByName.has(json.materials[prim.material].name)) return;
      if (prim.mode !== undefined && prim.mode !== 4) throw new Error('only TRIANGLES supported');
      const pos = readAccessor(prim.attributes.POSITION);
      const idxAcc = json.accessors[prim.indices];
      const idx = readAccessor(prim.indices);

      // 顶点数翻 3 倍（去索引，逐三角展开，盒式投影的接缝才不会插值串色）
      const n = idx.length;
      const out = {};
      for (const [name, ai] of Object.entries(prim.attributes)) {
        const src = readAccessor(ai);
        const nc = NUMCOMP[json.accessors[ai].type];
        out[name] = new TypedArr[json.accessors[ai].componentType](n * nc);
        if (name === 'POSITION') out[name] = new Float32Array(n * 3);
      }
      const uv = new Float32Array(n * 2);

      // 包围盒决定盒式投影的尺度
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let v = 0; v < pos.length; v += 3) {
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v + k]); hi[k] = Math.max(hi[k], pos[v + k]); }
      }
      const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const maxExt = Math.max(...ext);
      const scale = maxExt / tile; // 1 uv 单位 = scale 模型单位

      let pmin = [1e9, 1e9, 1e9], pmax = [-1e9, -1e9, -1e9];
      let o = 0, uo = 0;
      // 面级抖动默认关：连续投影让图案在平滑区域自然流动，仅在投影轴切换处有缝
      let seed = jitter ? 12345 : 0;
      const rnd = () => (seed ? (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff : 0);

      for (let t = 0; t < n; t += 3) {
        const c = [idx[t], idx[t + 1], idx[t + 2]];
        // 面法线
        const ax = pos[c[0] * 3], ay = pos[c[0] * 3 + 1], az = pos[c[0] * 3 + 2];
        const bx = pos[c[1] * 3], by = pos[c[1] * 3 + 1], bz = pos[c[1] * 3 + 2];
        const cx = pos[c[2] * 3], cy = pos[c[2] * 3 + 1], cz = pos[c[2] * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
        const ox = rnd(), oy = rnd();

        const cornerSrc = {};
        for (const [name, ai] of Object.entries(prim.attributes)) {
          cornerSrc[name] = { src: readAccessor(ai), nc: NUMCOMP[json.accessors[ai].type] };
        }
        for (const ci of c) {
          for (const [name, arr] of Object.entries(out)) {
            const { src, nc } = cornerSrc[name];
            for (let k = 0; k < nc; k++) arr[o * nc + k] = src[ci * nc + k];
          }
          const px = pos[ci * 3], py = pos[ci * 3 + 1], pz = pos[ci * 3 + 2];
          for (let k = 0; k < 3; k++) { pmin[k] = Math.min(pmin[k], out.POSITION[o * 3 + k]); pmax[k] = Math.max(pmax[k], out.POSITION[o * 3 + k]); }
          // 盒式投影：主轴决定投影面（X→zy, Y→xz, Z→xy）
          if (anx >= any && anx >= anz) { uv[uo] = pz / scale + ox; uv[uo + 1] = py / scale + oy; }
          else if (any >= anz) { uv[uo] = px / scale + ox; uv[uo + 1] = pz / scale + oy; }
          else { uv[uo] = px / scale + ox; uv[uo + 1] = py / scale + oy; }
          o++; uo += 2;
        }
      }

      const attrs = {};
      for (const [name, arr] of Object.entries(out)) {
        const acc = json.accessors[prim.attributes[name]];
        let min, max;
        if (name === 'POSITION') { min = pmin; max = pmax; }
        attrs[name] = pushAccessor(pushView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), 34962), acc.componentType, acc.type, n, min, max);
      }
      attrs.TEXCOORD_0 = pushAccessor(pushView(Buffer.from(uv.buffer), 34962), 5126, 'VEC2', n);
      const idxType = o > 65535 ? 5125 : 5123;
      const idxArr = idxType === 5125 ? new Uint32Array(o) : new Uint16Array(o);
      for (let v = 0; v < o; v++) idxArr[v] = v;
      const indices = pushAccessor(pushView(Buffer.from(idxArr.buffer), 34963), idxType, 'SCALAR', o);
      primPatches.push({ mi, pi, attrs, indices, textureIdx, group: g });
    });
  });
}

// 应用补丁 + 材质挂贴图
for (const p of primPatches) {
  const prim = json.meshes[p.mi].primitives[p.pi];
  prim.attributes = p.attrs;
  prim.indices = p.indices;
}
for (const p of primPatches) {
  const mat = json.materials[json.meshes[p.mi].primitives[p.pi].material];
  const pbr = mat.pbrMetallicRoughness = mat.pbrMetallicRoughness || {};
  pbr.baseColorTexture = { index: p.textureIdx };
  pbr.baseColorFactor = [1, 1, 1, 1];
  pbr.metallicFactor = 0;
  const r = p.group.rough ?? globalRough;
  if (r !== null) pbr.roughnessFactor = r;
}

// ── 修复上游 FBX2glTF 的 SKIN_SKELETON_INVALID ────────────
// aigc/monsters 里部分模型（pink-slime/green-blob 等）skins[*].skeleton 指向的不是
// 关节公共根，gltf-transform validate 报 error。重指到关节数组的最低公共祖先；
// three.js 不读该字段，这里只为 validate 干净、语义正确。
if (json.skins && json.nodes) {
  const parent = new Map();
  const walkNodes = (list, p) => list.forEach((n, i) => { parent.set(i, p); if (n.children) walkNodes(n.children, i); });
  walkNodes(json.nodes, -1);
  const anc = (i) => { const a = []; let c = i; while (c !== -1 && a.length < 4096) { a.push(c); c = parent.get(c); } return a; };
  for (const skin of json.skins) {
    const joints = skin.joints || [];
    if (!joints.length) continue;
    let common = anc(joints[0]);
    for (const j of joints.slice(1)) {
      const a = anc(j);
      common = common.filter((x) => a.includes(x));
    }
    if (skin.skeleton !== undefined && !common.includes(skin.skeleton)) {
      if (common.length) skin.skeleton = common[0];
      else delete skin.skeleton;
    }
  }
}

// ── GLB 重组 ──────────────────────────────────────────────
const binTail = Buffer.concat(chunks);
json.buffers[0].byteLength = binCursor;
let jsonStr = JSON.stringify(json);
const jsonPad = (4 - Buffer.byteLength(jsonStr) % 4) % 4;
jsonStr += ' '.repeat(jsonPad);
const jsonBuf = Buffer.from(jsonStr, 'utf8');
const binPad = (4 - binTail.length % 4) % 4;
const binFull = Buffer.concat([bin, binTail], binCursor + binPad);
const total = 12 + 8 + jsonBuf.length + 8 + binFull.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuf.length, 12); out.writeUInt32LE(0x4E4F534A, 16);
jsonBuf.copy(out, 20);
const bo = 20 + jsonBuf.length;
out.writeUInt32LE(binFull.length, bo); out.writeUInt32LE(0x004E4942, bo + 4);
binFull.copy(out, bo + 8);
writeFileSync(outPath, out);
const kb = Math.round(total / 1024);
console.log('baked ' + outPath + ' (' + kb + ' KB, ' + primPatches.length + ' prims)');
