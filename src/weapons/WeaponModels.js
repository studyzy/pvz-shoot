import * as THREE from 'three';
import { TrackedGLTFLoader, estimateBytes } from '../assets/LoadProgress.js';

const BASE = import.meta.env.BASE_URL;

// 12 款植物 GLB（合计约 1.7 MB）合并成**一次**请求：首页一次就要把全部手持植物下完
// （WeaponSystem 构造时全建），12 个独立请求在移动网络上的建连与队头开销比字节本身更贵。
// 合并后仍是 12 份独立模板，clone 语义不变（见 extractPack）。
//
// 打包器：tools/pack-weapon-models.mjs。它校验每个 glb 只有顶点色、没有贴图/蒙皮/动画，
// 节点名唯一 —— 否则拆包时节点名和材质去重会串。
const PACK_URL = 'models/weapons/pack.glb';
const PACK_PREFIX = 'pack.';
// 还没有响应头时的粗估（实际 1.73 MB）：进度条先有个基数，别从 0 起步干等。
estimateBytes(1750000);

// 兼容旧调用点：WeaponSystem / WeaponPickups / RemotePlayer 传的是植物 id。
export function loadWeaponModel(id) {
  return loadWeaponPack().then((pack) => {
    const scene = pack.get(PACK_PREFIX + id) || null;
    if (!scene) console.warn(id + ' weapon model missing from pack');
    return scene;
  });
}

let packPromise = null;

// 整个包一个 Promise：所有 id 共享同一次下载，失败也共享同一个 null 结果（与旧的按 id 缓存口径一致）。
function loadWeaponPack() {
  if (packPromise) return packPromise;
  packPromise = new Promise((resolve) => {
    new TrackedGLTFLoader().load(BASE + PACK_URL, (gltf) => {
      const pack = extractPack(gltf.scene);
      if (pack.size) {
        resolve(pack);
        return;
      }
      rejectPack(new Error('empty weapon pack'), resolve);
    }, undefined, (err) => rejectPack(err, resolve));
  });
  return packPromise;
}

function rejectPack(err, resolve) {
  console.warn('weapon pack failed', err);
  resolve(new Map());
}

// pack.glb 里每个原模型是一个名为 'pack.<id>' 的节点（GLTFExporter 会吞掉冒号等保留字符，必须用点）。
// 拆回独立模板：克隆 mesh 子树，几何/材质保持指向原对象的引用（不复制顶点数据）。
// 打包时所有节点都是身份变换，所以这里只搬 mesh，不再叠 holder 的矩阵。
export function extractPack(root) {
  const out = new Map();
  const holders = [];
  root.traverse((n) => {
    if (n !== root && packName(n).indexOf(PACK_PREFIX) === 0) holders.push(n);
  });
  for (const holder of holders) {
    const scene = new THREE.Group();
    scene.name = packName(holder);
    // 收集板上钉钉的 mesh 列表再建：边遍历边加节点会把已加进去的 mesh 再遍历一遍
    const meshes = [];
    holder.traverse((n) => {
      if (n.isMesh) meshes.push(n);
    });
    for (const n of meshes) {
      if (isInsideAnotherHolder(n, holders)) continue;
      const mesh = new THREE.Mesh(n.geometry, n.material);
      mesh.name = n.name;
      mesh.position.copy(n.position);
      mesh.quaternion.copy(n.quaternion);
      mesh.scale.copy(n.scale);
      scene.add(mesh);
    }
    if (!scene.children.length) continue;
    out.set(packName(holder), scene);
  }
  return out;
}

// GLTFLoader 会用 PropertyBinding.sanitizeNodeName 清洗节点名（吞掉 . : 等保留字符），
// 原始名字留在 userData.name 里 —— 取那里，取不到再退回清洗后的 name。
export function packName(node) {
  const raw = node.userData && node.userData.name;
  return typeof raw === 'string' && raw ? raw : node.name || '';
}

// 嵌套的 holder（理论上没有）只归最外层的那个
function isInsideAnotherHolder(mesh, holders) {
  let inside = 0;
  for (let p = mesh; p; p = p.parent) {
    if (packName(p).indexOf(PACK_PREFIX) === 0) inside++;
  }
  return inside > 1;
}
