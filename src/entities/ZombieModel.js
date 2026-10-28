import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

// 外部 glb：单网格、无骨骼。原始高 1.108，模型本体按 ZOMBIE_SCALE 拉到 1.85 米。
export const ZOMBIE_SCALE = 1.67;
export const ZOMBIE_HEIGHT = 1.85;

export const zombieModel = {
  started: false,
  ready: false,
  failed: false,
  scene: null,
};

export function initZombieModel() {
  if (zombieModel.started) return;
  zombieModel.started = true;
  new GLTFLoader().load(
    BASE + 'models/zombie.glb',
    (gltf) => {
      const root = gltf.scene;
      root.traverse((n) => {
        if (!n.isMesh) return;
        n.castShadow = true;
        n.receiveShadow = false;
        n.frustumCulled = true;
      });
      zombieModel.scene = root;
      zombieModel.ready = true;
    },
    undefined,
    (err) => {
      zombieModel.failed = true;
      console.warn('zombie glb failed', err);
    }
  );
}
