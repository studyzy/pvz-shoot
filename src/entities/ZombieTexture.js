import * as THREE from 'three';

export const zombieAtlas = { map: null, started: false, failed: false };

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function initZombieAtlas() {
  if (zombieAtlas.started) return;
  zombieAtlas.started = true;
  const files = ['zombie-skin.jpg', 'zombie-shirt.jpg', 'zombie-pants.jpg', 'zombie-metal.jpg'];
  Promise.all(files.map((f) => loadImage(BASE + 'textures/' + f)))
    .then((imgs) => {
      const size = 1024;
      const cell = 512;
      const inset = 16;
      const inner = cell - inset * 2;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#bdbdbd';
      ctx.fillRect(0, 0, size, size);

      const positions = [[0, 0], [cell, 0], [0, cell], [cell, cell]];
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const sw = Math.floor(img.width * 0.88);
        const sh = Math.floor(img.height * 0.88);
        ctx.drawImage(img, 0, 0, sw, sh, positions[i][0] + inset, positions[i][1] + inset, inner, inner);
      }

      for (let i = 0; i < 4; i++) {
        const x = positions[i][0] + inset;
        const y = positions[i][1] + inset;
        const imgData = ctx.getImageData(x, y, inner, inner);
        const d = imgData.data;
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        for (let k = 0; k < d.length; k += 4) {
          const l = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) / 255;
          sum += l;
          sum2 += l * l;
          n++;
        }
        const mean = sum / n;
        const std = Math.sqrt(Math.max(1e-5, sum2 / n - mean * mean));
        for (let k = 0; k < d.length; k += 4) {
          const l = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) / 255;
          const dev = (l - mean) / std;
          const g = Math.max(0.5, Math.min(1, 0.86 + dev * 0.11));
          const v = Math.round(255 * g);
          d[k] = v;
          d[k + 1] = v;
          d[k + 2] = v;
        }
        ctx.putImageData(imgData, x, y);
      }

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      zombieAtlas.map = tex;
    })
    .catch((err) => {
      zombieAtlas.failed = true;
      console.warn('zombie texture atlas failed', err);
    });
}
