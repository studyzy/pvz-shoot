import * as THREE from 'three';

const gradientData = new Uint8Array([70, 122, 180, 235, 255]);
const gradientTex = new THREE.DataTexture(gradientData, 5, 1, THREE.RedFormat);
gradientTex.minFilter = THREE.NearestFilter;
gradientTex.magFilter = THREE.NearestFilter;
gradientTex.generateMipmaps = false;
gradientTex.needsUpdate = true;

export function toon(color, extra) {
  const mat = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradientTex }, extra || {}));
  return mat;
}

export function flat(color, extra) {
  return new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
}

let _grass = null;
export function grassTexture() {
  if (_grass) return _grass;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7cc242';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,210,0.11)' : 'rgba(28,86,8,0.10)';
    ctx.fillRect(0, i * 32, size, 32);
  }
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const h = 2 + Math.random() * 4;
    const g = 130 + Math.random() * 70;
    ctx.strokeStyle = 'rgba(' + Math.floor(g * 0.45) + ',' + Math.floor(g) + ',30,' + (0.10 + Math.random() * 0.16) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 1.5 - 0.7, y - h);
    ctx.stroke();
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = 'rgba(255,255,210,' + (0.05 + Math.random() * 0.12) + ')';
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _grass = tex;
  return tex;
}

let _sky = null;
export function skyTexture() {
  if (_sky) return _sky;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#3f93dd');
  grd.addColorStop(0.42, '#8fd0f4');
  grd.addColorStop(0.62, '#cfeaff');
  grd.addColorStop(0.78, '#eef8ff');
  grd.addColorStop(1, '#f3f0d2');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sky = tex;
  return tex;
}

let _blob = null;
export function blobShadowTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(12,26,4,0.55)');
  g.addColorStop(0.55, 'rgba(12,26,4,0.32)');
  g.addColorStop(1, 'rgba(12,26,4,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _blob = tex;
  return tex;
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.28, 'rgba(255,240,150,0.9)');
  g.addColorStop(0.6, 'rgba(255,200,60,0.32)');
  g.addColorStop(1, 'rgba(255,180,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _glow = tex;
  return tex;
}

let _cloud = null;
export function cloudTexture() {
  if (_cloud) return _cloud;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const blobs = [
    [70, 78, 40],
    [110, 62, 46],
    [155, 72, 38],
    [190, 84, 28],
    [40, 88, 26],
    [130, 92, 44],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    ctx.beginPath();
    ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _cloud = tex;
  return tex;
}

const faceCache = {};
export function faceTexture(variant) {
  const v = variant % 3;
  if (faceCache[v]) return faceCache[v];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  const eyeY = v === 1 ? 48 : 52;
  const eyeR = v === 2 ? 17 : 15;
  const pupilX = v === 2 ? 4 : 2;

  // eye sockets
  ctx.fillStyle = 'rgba(40,48,26,0.55)';
  ctx.beginPath();
  ctx.arc(44, eyeY + 2, eyeR + 5, 0, Math.PI * 2);
  ctx.arc(84, eyeY + 2, eyeR + 5, 0, Math.PI * 2);
  ctx.fill();

  // eyeballs
  ctx.fillStyle = '#f7f6e4';
  ctx.beginPath();
  ctx.arc(44, eyeY, eyeR, 0, Math.PI * 2);
  ctx.arc(84, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // pupils
  ctx.fillStyle = '#1d2116';
  ctx.beginPath();
  ctx.arc(44 + pupilX, eyeY + 3, eyeR * 0.42, 0, Math.PI * 2);
  ctx.arc(84 + pupilX - 1, eyeY + 3, eyeR * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // brows
  ctx.strokeStyle = '#4b4a2c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, eyeY - eyeR - 5);
  ctx.lineTo(54, eyeY - eyeR + 2);
  ctx.moveTo(98, eyeY - eyeR - 5);
  ctx.lineTo(76, eyeY - eyeR + 2);
  ctx.stroke();

  // mouth
  ctx.fillStyle = '#322a1d';
  ctx.beginPath();
  ctx.moveTo(38, 92);
  ctx.quadraticCurveTo(64, 106, 92, 88);
  ctx.quadraticCurveTo(66, 114, 38, 92);
  ctx.fill();

  // teeth
  ctx.fillStyle = '#e8e3c8';
  ctx.beginPath();
  ctx.moveTo(48, 94);
  ctx.lineTo(53, 101);
  ctx.lineTo(57, 95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(72, 93);
  ctx.lineTo(77, 100);
  ctx.lineTo(81, 91);
  ctx.closePath();
  ctx.fill();

  // stitches on cheek
  ctx.strokeStyle = 'rgba(60,62,40,0.75)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(96, 66);
  ctx.lineTo(112, 76);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const x = 98 + t * 12;
    const y = 67 + t * 8;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  faceCache[v] = tex;
  return tex;
}
