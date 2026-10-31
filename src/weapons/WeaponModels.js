import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = new Map();
const BASE = import.meta.env.BASE_URL;

export function loadWeaponModel(id) {
  if (cache.has(id)) return cache.get(id);
  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().load(BASE + 'models/weapons/' + id + '.glb', (gltf) => {
      let hasMesh = false;
      gltf.scene.traverse((node) => { if (node.isMesh) hasMesh = true; });
      if (!hasMesh) { reject(new Error('empty weapon model')); return; }
      resolve(gltf.scene);
    }, undefined, reject);
  }).catch((error) => {
    console.warn(id + ' weapon glb failed', error);
    return null;
  });
  cache.set(id, ready);
  return ready;
}
