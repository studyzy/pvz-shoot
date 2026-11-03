// 把 public/models/weapons/*.glb 合并成一次请求的 pack.glb。
//
// 为什么合并：首页打开时 WeaponSystem 会一次性建好全部手持植物，也就是把 12 个 glb
// 全下载了。12 个独立请求在移动网络上的建连 + 队头开销比字节本身更贵，合并成一个请求
// 后首页的"首屏模型就绪"明显提前。合并**不改变运行时形状**：前端 extractPack 会把它
// 拆回 12 份独立模板，clone 语义与原来逐个加载完全一致。
//
// 用法：node tools/pack-weapon-models.mjs
//   - 校验每个 glb 只有顶点色、没有贴图/蒙皮/动画（有任何一个就拒绝打包，否则拆包会串）
//   - 每个原模型挂在名为 pack.<id> 的节点下（GLTFLoader 会清洗节点名，不能用冒号等保留字符）
//   - 打包后重新加载并从包里拆回，逐个比对网格数与包围盒，不一致直接失败
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/models/weapons');
const PACK = join(DIR, 'pack.glb');
const PREFIX = 'pack.';

function parse(buf) {
  return new Promise((res, rej) => {
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
  });
}

// 校验：打包前后的可观察形态必须一致
function signature(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  let verts = 0;
  root.traverse((n) => {
    if (!n.isMesh) return;
    meshes++;
    verts += n.geometry.attributes.position.count;
  });
  const f = (v) => Number(v.toFixed(4));
  return { meshes, verts, box: [box.min, box.max].map((v) => [f(v.x), f(v.y), f(v.z)].join(',')).join(' / ') };
}

async function main() {
  const ids = readdirSync(DIR)
    .filter((f) => f.endsWith('.glb') && f !== 'pack.glb')
    .map((f) => f.slice(0, -4))
    .sort();
  if (!ids.length) throw new Error('no weapon glb found in ' + DIR);

  const merged = new THREE.Group();
  merged.name = 'weapon-pack';
  const before = new Map();
  let bytes = 0;
  for (const id of ids) {
    const file = join(DIR, id + '.glb');
    bytes += statSync(file).size;
    const gltf = await parse(readFileSync(file));
    const scene = gltf.scene;
    // 只有顶点色、没有贴图/蒙皮/动画才算"可安全合并"：贴图会按材质去重、蒙皮会按骨架串
    let ok = true;
    scene.traverse((n) => {
      if (!n.isMesh) { if (n.isSkinnedMesh) ok = false; return; }
      if (n.isSkinnedMesh) ok = false;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m || m.map || m.normalMap || m.roughnessMap || m.metalnessMap) ok = false;
        if (!n.geometry.attributes.color) ok = false;
      }
    });
    if (gltf.animations && gltf.animations.length) ok = false;
    if (!ok) throw new Error(id + '.glb 不是纯顶点色静态模型，不能合并（拆包会串材质）');
    before.set(id, signature(scene));
    const holder = new THREE.Group();
    holder.name = PREFIX + id;
    holder.add(scene);
    merged.add(holder);
  }

  // GLTFExporter 在 Node 里需要 DOM 接口（贴图处理用；这批模型没有贴图，补个最小替身即可）
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.Blob = dom.window.Blob;

  const out = await new GLTFExporter().parseAsync(merged, { binary: true, onlyVisible: false });
  writeFileSync(PACK, Buffer.from(out));

  // 回读校验：从写出去的包里按前端 extractPack 的口径拆回来，逐个比对
  const packGltf = await parse(readFileSync(PACK));
  const found = new Map();
  const holders = [];
  // GLTFLoader 会清洗节点名（吞掉保留字符），原始名在 userData.name
  const rawName = (n) => (n.userData && n.userData.name) || n.name || '';
  packGltf.scene.traverse((n) => {
    if (n !== packGltf.scene && rawName(n).indexOf(PREFIX) === 0) holders.push(n);
  });
  for (const holder of holders) {
    const scene = new THREE.Group();
    scene.name = rawName(holder);
    // 先收集再建：边遍历边 add 会把新加的 mesh 再遍历一遍（每个模型会翻倍）
    const meshes = [];
    holder.traverse((n) => {
      if (n.isMesh) meshes.push(n);
    });
    for (const n of meshes) {
      const mesh = new THREE.Mesh(n.geometry, n.material);
      mesh.position.copy(n.position);
      mesh.quaternion.copy(n.quaternion);
      mesh.scale.copy(n.scale);
      scene.add(mesh);
    }
    found.set(rawName(holder).slice(PREFIX.length), scene);
  }
  let bad = 0;
  for (const id of ids) {
    const want = before.get(id);
    const got = found.get(id);
    if (!got) {
      console.error('MISSING', id);
      bad++;
      continue;
    }
    const s = signature(got);
    if (s.meshes !== want.meshes || s.verts !== want.verts || s.box !== want.box) {
      console.error('MISMATCH', id, JSON.stringify(want), JSON.stringify(s));
      bad++;
    }
  }
  const size = statSync(PACK).size;
  console.log(
    'packed ' + ids.length + ' models: ' + bytes + ' B -> ' + size + ' B (' + (size / Math.max(1, bytes)).toFixed(3) + 'x)'
  );
  if (bad) throw new Error(bad + ' model(s) changed shape after packing');
  console.log('verified: every model keeps its mesh count, vertex count and bounds');
}

main().then(() => process.exit(0), (e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});