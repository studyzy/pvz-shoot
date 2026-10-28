export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const TAU = Math.PI * 2;

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

// Returns t in [0,1] where the segment p0->p1 first touches the sphere, or -1.
export function segmentSphereT(p0, p1, center, radius) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const fx = p0.x - center.x;
  const fy = p0.y - center.y;
  const fz = p0.z - center.z;
  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (a < 1e-9) return c <= 0 ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function formatNum(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
