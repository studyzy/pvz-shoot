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

let _snow = null;
export function snowTexture() {
  if (_snow) return _snow;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f9ff';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 18 + Math.random() * 48;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(196,226,255,0.24)');
    g.addColorStop(0.6, 'rgba(196,226,255,0.09)');
    g.addColorStop(1, 'rgba(196,226,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1200; i++) {
    const a = 0.08 + Math.random() * 0.2;
    ctx.fillStyle = Math.random() < 0.65 ? 'rgba(255,255,255,' + a + ')' : 'rgba(170,206,240,' + a + ')';
    const s = 1 + Math.random() * 2.2;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _snow = tex;
  return tex;
}

let _sand = null;
export function sandTexture() {
  if (_sand) return _sand;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e2cb9d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,246,214,0.14)' : 'rgba(150,116,64,0.10)';
    ctx.fillRect(0, i * 26, size, 24);
  }
  for (let i = 0; i < 34; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 14 + Math.random() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(196,158,96,0.16)');
    g.addColorStop(0.6, 'rgba(196,158,96,0.06)');
    g.addColorStop(1, 'rgba(196,158,96,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1500; i++) {
    const a = 0.06 + Math.random() * 0.16;
    ctx.fillStyle = Math.random() < 0.7 ? 'rgba(255,250,228,' + a + ')' : 'rgba(138,104,56,' + a + ')';
    const s = 1 + Math.random() * 1.8;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = 'rgba(120,92,50,' + (0.12 + Math.random() * 0.14) + ')';
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _sand = tex;
  return tex;
}

let _iceWall = null;
export function iceWallTexture() {
  if (_iceWall) return _iceWall;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, '#e8f5fd');
  grd.addColorStop(0.55, '#d4ecf9');
  grd.addColorStop(1, '#c2e2f3');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 900; i++) {
    const a = 0.05 + Math.random() * 0.12;
    ctx.fillStyle = Math.random() < 0.6 ? 'rgba(255,255,255,' + a + ')' : 'rgba(126,182,216,' + a + ')';
    const s = 1 + Math.random() * 2.4;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }

  ctx.strokeStyle = 'rgba(112,172,210,0.34)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= size; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x + 1.5, 0);
    ctx.lineTo(x + 1.5, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += 170) {
    ctx.beginPath();
    ctx.moveTo(0, y + 1.5);
    ctx.lineTo(size, y + 1.5);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 4;
  for (let y = 0; y <= size; y += 170) {
    ctx.beginPath();
    ctx.moveTo(0, y + 6);
    ctx.lineTo(size, y + 6);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(126,182,216,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _iceWall = tex;
  return tex;
}

let _ice = null;
export function iceTexture() {
  if (_ice) return _ice;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, '#c9ecff');
  grd.addColorStop(0.5, '#a9dcf7');
  grd.addColorStop(1, '#d9f3ff');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x;
    let cy = y;
    for (let k = 0; k < 4; k++) {
      cx += (Math.random() - 0.5) * 46;
      cy += (Math.random() - 0.5) * 46;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = 'rgba(122,178,216,' + (0.12 + Math.random() * 0.16) + ')';
    ctx.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _ice = tex;
  return tex;
}

let _snowSky = null;
export function snowSkyTexture() {
  if (_snowSky) return _snowSky;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#3f76b8');
  grd.addColorStop(0.36, '#82b8e8');
  grd.addColorStop(0.62, '#c9e7ff');
  grd.addColorStop(0.82, '#eaf7ff');
  grd.addColorStop(1, '#fbfdff');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _snowSky = tex;
  return tex;
}

let _desertSky = null;
export function desertSkyTexture() {
  if (_desertSky) return _desertSky;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#3d7fb8');
  grd.addColorStop(0.34, '#7fb4d9');
  grd.addColorStop(0.6, '#c9d9d6');
  grd.addColorStop(0.82, '#efdfb6');
  grd.addColorStop(1, '#f6ecd0');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _desertSky = tex;
  return tex;
}

let _nightSky = null;
// 夜空：顶部墨蓝 → 地平线偏紫，中段留一点月光冷色，便于和远景树影拉开层次。
export function nightSkyTexture() {
  if (_nightSky) return _nightSky;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#050a18');
  grd.addColorStop(0.3, '#0b1430');
  grd.addColorStop(0.55, '#16244a');
  grd.addColorStop(0.76, '#2a3a5e');
  grd.addColorStop(0.9, '#3d4a63');
  grd.addColorStop(1, '#4a5570');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _nightSky = tex;
  return tex;
}

let _forestFloor = null;
// 林地面：深苔绿 + 零星枯叶斑点，用噪声点铺，不引外部贴图。
export function forestFloorTexture() {
  if (_forestFloor) return _forestFloor;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d2f1a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 2.6 + 0.6;
    const g = 26 + Math.random() * 40;
    ctx.fillStyle = 'rgba(' + (g * 0.55 | 0) + ',' + (g | 0) + ',' + (g * 0.45 | 0) + ',' + (0.35 + Math.random() * 0.4).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 一点枯叶暖色，避免整片死绿
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = 'rgba(96,74,38,0.35)';
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  _forestFloor = tex;
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

let _envs = null;
// 程序化户外环境贴图（PMREM）：只给 PBR 材质提供反射与高光，不参与场景雾/背景。
export function outdoorEnvironment(renderer, mapId) {
  const key = mapId === 'snow' ? 'snow' : mapId === 'dust' ? 'dust' : mapId === 'forest' ? 'forest' : 'backyard';
  if (_envs && _envs[key]) return _envs[key];
  if (!_envs) _envs = {};

  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, 32);
  if (key === 'snow') {
    sky.addColorStop(0, '#2f66ad');
    sky.addColorStop(0.5, '#8fc0ea');
    sky.addColorStop(0.82, '#dbeafb');
    sky.addColorStop(1, '#ffffff');
  } else if (key === 'dust') {
    sky.addColorStop(0, '#3f7cb0');
    sky.addColorStop(0.5, '#9cc0d2');
    sky.addColorStop(0.82, '#ecd9ac');
    sky.addColorStop(1, '#f7ecc9');
  } else if (key === 'forest') {
    // 夜之森林：环境贴图只给 PBR 材质提供冷色反光，别用白天的蓝天，否则模型会发亮
    sky.addColorStop(0, '#060c1c');
    sky.addColorStop(0.5, '#1b2b4d');
    sky.addColorStop(0.82, '#3b4a6b');
    sky.addColorStop(1, '#55627e');
  } else {
    sky.addColorStop(0, '#2b6ab8');
    sky.addColorStop(0.45, '#8ecdf5');
    sky.addColorStop(0.75, '#cfeaff');
    sky.addColorStop(1, '#f2f6e6');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 128, 32);

  const ground = ctx.createLinearGradient(0, 32, 0, 64);
  if (key === 'snow') {
    ground.addColorStop(0, '#eef7ff');
    ground.addColorStop(1, '#c2d6e8');
  } else if (key === 'dust') {
    ground.addColorStop(0, '#e6cf9f');
    ground.addColorStop(1, '#a5804a');
  } else if (key === 'forest') {
    ground.addColorStop(0, '#24401f');
    ground.addColorStop(1, '#0d1a0b');
  } else {
    ground.addColorStop(0, '#7ba24a');
    ground.addColorStop(1, '#3d5320');
  }
  ctx.fillStyle = ground;
  ctx.fillRect(0, 32, 128, 32);

  const moon = key === 'forest';
  const sun = ctx.createRadialGradient(22, 11, 0, 22, 11, 16);
  sun.addColorStop(0, moon ? 'rgba(198,220,255,1)' : 'rgba(255,250,232,1)');
  sun.addColorStop(0.35, moon ? 'rgba(160,190,240,0.45)' : 'rgba(255,246,214,0.55)');
  sun.addColorStop(1, moon ? 'rgba(140,170,220,0)' : 'rgba(255,246,214,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 48, 32);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();

  _envs[key] = target.texture;
  return target.texture;
}

