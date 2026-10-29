import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

// 外部 glb：Quaternius Zombie_Basic（CC0 1.0），蒙皮网格 + 50 根骨骼。
// 原始高 1.194（Y 向上、面朝 +Z、脚底 y≈0），按 ZOMBIE_SCALE 拉到 1.85 米。
export const ZOMBIE_SCALE = 1.55;
export const ZOMBIE_HEIGHT = 1.85;

// 骷髅（KayKit Character Pack: Skeletons，CC0 1.0）：41 骨骼、13 段动画。
// 原始高 2.166，按 SKELETON_SCALE 拉到约 1.95 米（比普通僵尸略高，当作亡灵精英）。
export const SKELETON_SCALE = 0.9;

// 模型定义：id -> { url, scale, height }。Zombie.buildRig 按 def.model 取。
export const MODELS = {
  zombie: { url: 'models/zombie.glb', scale: ZOMBIE_SCALE, height: ZOMBIE_HEIGHT },
  skeleton: { url: 'models/skeleton.glb', scale: SKELETON_SCALE, height: 1.95 },
};

export const zombieModel = {
  started: false,
  ready: false,
  failed: false,
  scene: null,
  clips: [],
  // 骷髅单独一份：只有雪地/Boss 波才会用到，加载完置 ready
  skeleton: { ready: false, failed: false, scene: null, clips: [] },
};

// 按名字取动画：glb 里可能带 CharacterArmature| 前缀，统一去掉再比
export function findClip(clips, name) {
  if (!clips) return null;
  for (let i = 0; i < clips.length; i++) {
    const n = clips[i].name.replace(/^.*\|/, '').toLowerCase();
    if (n === name) return clips[i];
  }
  return null;
}

function prepare(root) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    n.receiveShadow = false;
    n.frustumCulled = true;
  });
  return root;
}

export function initZombieModel() {
  if (zombieModel.started) return;
  zombieModel.started = true;
  const loader = new GLTFLoader();
  loader.load(
    BASE + MODELS.zombie.url,
    (gltf) => {
      zombieModel.scene = prepare(gltf.scene);
      zombieModel.clips = gltf.animations || [];
      zombieModel.ready = true;
    },
    undefined,
    (err) => {
      zombieModel.failed = true;
      console.warn('zombie glb failed', err);
    }
  );
  // 骷髅是可选外观：加载失败不影响主流程，只是不刷这类怪
  loader.load(
    BASE + MODELS.skeleton.url,
    (gltf) => {
      zombieModel.skeleton.scene = prepare(gltf.scene);
      zombieModel.skeleton.clips = gltf.animations || [];
      zombieModel.skeleton.ready = true;
    },
    undefined,
    (err) => {
      zombieModel.skeleton.failed = true;
      console.warn('skeleton glb failed', err);
    }
  );
}