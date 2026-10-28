import * as THREE from 'three';

export const zombieAtlas = { map: null, normal: null, started: false, failed: false };

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

let _orm = null;
// 与 UV_REG 对齐的 ORM 图：R 留空（不做 AO），G = 粗糙度，B = 金属度。
// 尺寸只需覆盖 4 个 512 单元，区域内部是纯色，用 256 足够。
export function zombieOrmTexture() {
  if (_orm) return _orm;
  const size = 256;
  const cell = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(255,209,0)';
  ctx.fillRect(0, 0, size, size);
  const cells = [
    [0, 0, 209, 0],      // skin
    [cell, 0, 235, 0],   // cloth
    [0, cell, 229, 0],   // pants
    [cell, cell, 87, 255] // metal
  ];
  for (let i = 0; i < cells.length; i++) {
    const [x, y, rough, metal] = cells[i];
    ctx.fillStyle = 'rgb(255,' + rough + ',' + metal + ')';
    ctx.fillRect(x, y, cell, cell);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  _orm = tex;
  return tex;
}

// 由灰度细节图用 Sobel 派生切线空间法线，给皮肤/布料一点真实的凹凸。
function normalTexture(srcCanvas, size) {
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const src = sctx.getImageData(0, 0, size, size);
  const d = src.data;
  const out = sctx.createImageData(size, size);
  const o = out.data;
  const lum = (x, y) => {
    const i = ((y * size + x) << 2);
    return (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  };
  const strength = 1.1;
  for (let y = 0; y < size; y++) {
    const yu = y > 0 ? y - 1 : 1;
    const yd = y < size - 1 ? y + 1 : size - 2;
    for (let x = 0; x < size; x++) {
      const xl = x > 0 ? x - 1 : 1;
      const xr = x < size - 1 ? x + 1 : size - 2;
      const dx = (lum(xr, y) - lum(xl, y)) * strength;
      const dy = (lum(x, yu) - lum(x, yd)) * strength;
      const nx = -dx;
      const ny = -dy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = ((y * size + x) << 2);
      o[i] = (nx * inv * 0.5 + 0.5) * 255;
      o[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      o[i + 2] = (inv * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
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
      zombieAtlas.normal = normalTexture(c, size);
    })
    .catch((err) => {
      zombieAtlas.failed = true;
      console.warn('zombie texture atlas failed', err);
    });
}
