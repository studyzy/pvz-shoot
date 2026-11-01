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

let _carnivalSky = null;
export function carnivalSkyTexture() {
  if (_carnivalSky) return _carnivalSky;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#91b9ce');
  sky.addColorStop(.34, '#c2d8dd');
  sky.addColorStop(.62, '#fff0d8');
  sky.addColorStop(.84, '#f6c6ae');
  sky.addColorStop(1, '#fff0d8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 8, 512);
  _carnivalSky = new THREE.CanvasTexture(c);
  _carnivalSky.colorSpace = THREE.SRGBColorSpace;
  return _carnivalSky;
}

let _carnivalFloor = null;
export function carnivalFloorTexture() {
  if (_carnivalFloor) return _carnivalFloor;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e7d3b1';
  ctx.fillRect(0, 0, 256, 256);
  for (let z = 0; z < 4; z++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + z) % 2 ? '#e5d3b6' : '#f0e0c5';
      ctx.fillRect(x * 64 + 1, z * 64 + 1, 62, 62);
      ctx.strokeStyle = 'rgba(153,111,74,.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x * 64 + 5, z * 64 + 15 + i * 16);
        ctx.bezierCurveTo(x * 64 + 21, z * 64 + 11 + i * 16, x * 64 + 39, z * 64 + 20 + i * 16, x * 64 + 57, z * 64 + 15 + i * 16);
        ctx.stroke();
      }
    }
  }
  _carnivalFloor = new THREE.CanvasTexture(c);
  _carnivalFloor.colorSpace = THREE.SRGBColorSpace;
  _carnivalFloor.wrapS = _carnivalFloor.wrapT = THREE.RepeatWrapping;
  _carnivalFloor.repeat.set(9, 9);
  _carnivalFloor.anisotropy = 4;
  return _carnivalFloor;
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
  let seed = 0x6d6f7373;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  ctx.fillStyle = '#30483d';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = random() * 256;
    const y = random() * 256;
    const r = random() * 2.6 + 0.6;
    const g = 26 + random() * 40;
    ctx.fillStyle = 'rgba(' + (g * 0.72 | 0) + ',' + (g | 0) + ',' + (g * 0.78 | 0) + ',' + (0.35 + random() * 0.4).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 一点枯叶暖色，避免整片死绿
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = 'rgba(116,95,65,0.28)';
    ctx.beginPath();
    ctx.arc(random() * 256, random() * 256, random() * 2 + 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  _forestFloor = tex;
  return tex;
}

let _moonPatch = null;
// 灰度alphaMap，不受色彩空间转换；多片柔边月斑替代规则蓝圆盘。
export function moonPatchTexture() {
  if (_moonPatch) return _moonPatch;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, r] of [[180, 275, 164], [295, 250, 130], [270, 335, 90], [250, 190, 75]]) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(180,180,180,1)');
    gradient.addColorStop(.35, 'rgba(140,140,140,.8)');
    gradient.addColorStop(.72, 'rgba(60,60,60,.4)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  _moonPatch = tex;
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

let _glass = null;
// 玻璃幕墙：深蓝灰底 + 按楼层分氛围的暖橙窗格（亮层/常态/熄灯层交替，才有办公楼的呼吸感）。
// 发光靠 MeshStandardMaterial 的 emissiveMap 复用同一张贴图：亮格 texel 顶到接近纯暖白，
// 让 0.35 档的 emissiveIntensity 在暮紫天空下仍读得出「亮着的楼层」；灭格几乎不发光。
export function glassTexture() {
  if (_glass) return _glass;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // 终轮亮度收敛：基底/框梃/灭窗两轮提亮（4b4b52→6e6e7a 一档）——菜单低机位下
  // 塔身暗面曾贡献全帧约 1/3 近黑；亮窗仍靠自发光（emissive）出跳，
  // 灭窗现在是「有 ambient 的暗玻璃」而不是黑洞。摩天街区专属贴图，改色不影响其它图。
  ctx.fillStyle = '#6e6e7a';
  ctx.fillRect(0, 0, size, size);
  const bay = 64;
  for (let gy = 0; gy < 4; gy++) {
    // 楼层氛围：22% 加班亮层（六七成窗亮）、38% 常态、40% 熄灯层——竖向节奏代替均匀棋盘
    const mood = Math.random();
    const litP = mood < 0.22 ? 0.58 + Math.random() * 0.3 : mood < 0.6 ? 0.18 + Math.random() * 0.16 : 0.04 + Math.random() * 0.08;
    let run = 0; // 连亮游程：同层亮窗常连成排（办公室整排亮灯）
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * bay;
      const y = gy * bay;
      // 楼层框与竖梃
      ctx.fillStyle = '#464654';
      ctx.fillRect(x, y + bay - 7, bay, 7);
      ctx.fillRect(x, y, 5, bay);
      // 窗格：亮灭按楼层氛围；亮格接近纯暖白（自发光拉满）、灭格中性灰微变
      const px = x + 7;
      const py = y + 4;
      const pw = bay - 14;
      const ph = bay - 13;
      if (run > 0 || Math.random() < litP) {
        run = run > 0 ? run - 1 : (Math.random() < 0.5 ? 1 + (Math.random() * 2 | 0) : 0);
        const g = ctx.createLinearGradient(px, py, px, py + ph);
        // 终轮亮度收敛：窗光从 255,214,150/255,186,100 去饱和到奶油白炽——暖橙像素占比
        // 被压回 8% 以内，且更贴「办公室白炽灯」而不是霓虹
        const warm = Math.random() < 0.75 ? '255,224,186' : '255,208,146';
        g.addColorStop(0, 'rgba(' + warm + ',1)');
        g.addColorStop(1, 'rgba(' + warm + ',0.86)');
        ctx.fillStyle = g;
      } else if (Math.random() < 0.05) {
        ctx.fillStyle = 'rgba(198,218,248,0.85)'; // 稀少的冷色荧屏窗，添生活感
      } else {
        ctx.fillStyle = Math.random() < 0.5 ? '#787788' : '#706f7c';
      }
      ctx.fillRect(px, py, pw, ph);
      // 窗格内的横向分隔（窗扇）
      ctx.fillStyle = 'rgba(10,14,20,0.4)';
      ctx.fillRect(px, py + ph * 0.5, pw, 2);
    }
  }
  // 微噪点
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _glass = tex;
  return tex;
}

let _asphalt = null;
// 沥青地面：中灰底（黄昏低照度下 albedo 会被暖光吃掉蓝绿通道，底色必须够亮才不至于糊成
// 黑泥；比混凝土裙楼暗一档保住铺装层次）+ 亮粒噪点 + 淡淡的车道虚线。
export function asphaltTexture() {
  if (_asphalt) return _asphalt;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8f8a79';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 16 + Math.random() * 52;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(128,122,110,0.22)' : 'rgba(52,48,42,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1500; i++) {
    const a = 0.06 + Math.random() * 0.12;
    // 亮粒为主的骨料感：暗粒拖底、亮粒提神，远处缩尖后读成细腻沥青而非死黑
    ctx.fillStyle = Math.random() < 0.55 ? 'rgba(216,210,194,' + a + ')' : 'rgba(46,42,36,' + a + ')';
    const s = 1 + Math.random() * 2;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  // 车道虚线（横竖各一条，淡而可读）；手工铺短段——测试环境的 canvas 替身没有 setLineDash
  ctx.fillStyle = 'rgba(232,228,214,0.22)';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(i * 52 + 6, size / 2 - 2, 30, 4);
    ctx.fillRect(size / 2 - 2, i * 52 + 6, 4, 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _asphalt = tex;
  return tex;
}

let _plaza = null;
// 广场混凝土分缝铺装（视觉评审 E）：比沥青浅一档的混凝土底 + 方格分缝 + 淡淡的浇筑块色差，
// 中央广场 32×32 贴地片专用。亮底是为了在黄昏暖光下仍读出「广场铺装 ≠ 马路」的层次。
export function plazaTexture() {
  if (_plaza) return _plaza;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9d968a';
  ctx.fillRect(0, 0, size, size);
  // 4×4 米格的分缝铺装：每格亮度微变（混凝土浇筑块），缝压深一档
  const bay = 64;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const tint = Math.random() * 0.1 - 0.05;
      ctx.fillStyle = tint > 0 ? 'rgba(255,250,238,' + tint + ')' : 'rgba(30,26,20,' + -tint + ')';
      ctx.fillRect(gx * bay + 2, gy * bay + 2, bay - 4, bay - 4);
    }
  }
  ctx.fillStyle = 'rgba(58,54,46,0.85)';
  for (let i = 0; i <= 4; i++) {
    ctx.fillRect(i * bay - 1, 0, 2, size);
    ctx.fillRect(0, i * bay - 1, size, 2);
  }
  // 磨损噪点：亮粒提神、暗粒拖底
  for (let i = 0; i < 900; i++) {
    const a = 0.05 + Math.random() * 0.1;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(226,220,204,' + a + ')' : 'rgba(52,48,42,' + a + ')';
    const s = 1 + Math.random() * 2;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _plaza = tex;
  return tex;
}

let _duskSky = null;
// 黄昏天空（非平铺，整幅铺到屏幕）：暮紫天顶占上 1/4，暖橙光带压到纹理中段——
// 第一人称平视时可见天空只有纹理上半幅，暖带不上移就会被楼群整体剪掉；两层楼群剪影
// 与低垂太阳都落在这段可见带里，逆光剪影叠在暖光上才有「暮色将至」。
// 终轮亮度收敛：整条渐变提亮一档、暖带再上移半档（菜单低机位 y≈14 的画面上沿曾整片
// 落在近黑夜空里）；天顶仍是暮紫、暖带仍是窄带，「黄昏将至」的逆光结构不变。
export function duskSkyTexture() {
  if (_duskSky) return _duskSky;
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#3d3363');
  grd.addColorStop(0.22, '#68537f');
  grd.addColorStop(0.36, '#8a4f5e');
  grd.addColorStop(0.46, '#c06a42');
  grd.addColorStop(0.6, '#e08a48');
  grd.addColorStop(0.74, '#f0a458');
  grd.addColorStop(1, '#f6b96e');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  // 低垂的太阳：压在地平线上，炽核放大（核心近白到 0.22 半径），让天空自带一个炽亮锚点
  const sun = ctx.createRadialGradient(w * 0.7, h * 0.52, 6, w * 0.7, h * 0.52, 170);
  sun.addColorStop(0, 'rgba(255,250,232,1)');
  sun.addColorStop(0.22, 'rgba(255,236,196,0.9)');
  sun.addColorStop(0.5, 'rgba(255,190,110,0.5)');
  sun.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(w * 0.7 - 180, h * 0.52 - 180, 360, 360);
  // 远近两层楼群剪影：叠在暖光带上（太阳先画，剪影盖上去成逆光）
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const skyline = (base, color, minH, maxH) => {
    ctx.fillStyle = color;
    let x = -10;
    while (x < w + 10) {
      const bw = 12 + random() * 36;
      const bh = minH + random() * (maxH - minH);
      ctx.fillRect(x, base - bh, bw, bh);
      if (random() < 0.3) ctx.fillRect(x + bw * 0.4, base - bh - 8 - random() * 14, 2, 10 + random() * 14);
      x += bw + 4 + random() * 16;
    }
  };
  // 剪影层同步提亮一档：远景楼群要「浮在暖带上」而不是沉进黑夜（终轮亮度收敛）
  skyline(h * 0.6, 'rgba(96,70,128,0.8)', 36, 140);
  skyline(h * 0.8, 'rgba(42,32,62,0.95)', 26, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _duskSky = tex;
  return tex;
}

let _envs = null;
// 程序化户外环境贴图（PMREM）：只给 PBR 材质提供反射与高光，不参与场景雾/背景。
export function outdoorEnvironment(renderer, mapId) {
  const key = mapId === 'snow' ? 'snow' : mapId === 'dust' ? 'dust' : mapId === 'forest' ? 'forest' : mapId === 'cloud' ? 'cloud' : mapId === 'downtown' ? 'downtown' : 'backyard';
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
  } else if (key === 'cloud') {
    sky.addColorStop(0, '#91b9ce');
    sky.addColorStop(.5, '#d5e0dd');
    sky.addColorStop(.82, '#fff0d8');
    sky.addColorStop(1, '#f6c6ae');
  } else if (key === 'forest') {
    // 夜之森林：环境贴图只给 PBR 材质提供冷色反光，别用白天的蓝天，否则模型会发亮
    sky.addColorStop(0, '#060c1c');
    sky.addColorStop(0.5, '#1b2b4d');
    sky.addColorStop(0.82, '#3b4a6b');
    sky.addColorStop(1, '#55627e');
  } else if (key === 'downtown') {
    // 摩天街区：黄昏 CBD——暮紫天顶、暖橙地平线，反射里带一点街谷的暖光
    sky.addColorStop(0, '#181430');
    sky.addColorStop(0.5, '#3a2c50');
    sky.addColorStop(0.82, '#c06e40');
    sky.addColorStop(1, '#f0a85e');
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
  } else if (key === 'cloud') {
    ground.addColorStop(0, '#eddbc0');
    ground.addColorStop(1, '#9a6244');
  } else if (key === 'forest') {
    ground.addColorStop(0, '#24401f');
    ground.addColorStop(1, '#0d1a0b');
  } else if (key === 'downtown') {
    ground.addColorStop(0, '#54485c');
    ground.addColorStop(1, '#221a30');
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

