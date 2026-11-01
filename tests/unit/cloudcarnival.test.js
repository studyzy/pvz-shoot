import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAPS } from '../../src/world/maps.js';
import { WEAPONS } from '../../src/config.js';
import * as materials from '../../src/world/materials.js';

let map;
let scene;
beforeAll(() => {
  scene = new THREE.Scene();
  const meta = MAPS.find((m) => m.id === 'cloud');
  if (meta) map = meta.create(scene);
});

function cloud() {
  expect(map, '注册表必须提供真实云上地图').toBeDefined();
  return map;
}

function cell(nav, x, z) {
  return Math.floor((z + nav.halfZ) / nav.cell) * nav.cols + Math.floor((x + nav.halfX) / nav.cell);
}

const spots = [[0, 23], [0, 10], [-20, -8], [20, -8], [0, -24], [-23, 14], [23, 14], [-12, -19], [12, -19], [-14, 5]];

describe('云上发条游乐园 · 空间契约', () => {
  it('注册原创72米云海地图并保留南侧出生与十补给点', () => {
    const m = cloud();
    expect(m.bounds).toEqual({ x: 36, z: 36 });
    expect(m.spawn).toEqual({ x: 0, z: 28, yaw: 0 });
    expect(m.pickupSpots).toEqual(spots);
    expect(m.initialPickupSpot).toBe(0);
    expect(m.pickupPools[0].every((id) => WEAPONS.find((w) => w.id === id)?.slot === 'gun')).toBe(true);
    expect(m.playerColliders).toEqual([]);
  });

  it('十补给点和全部敌人入口与出生连通且不卡墙/钟下', () => {
    const m = cloud();
    m.updateNav({ pos: m.spawn }, .5);
    expect(m.openingSpawnPoints.length).toBeGreaterThanOrEqual(3);
    for (const [x, z] of [...m.pickupSpots, ...m.zombieSpawnPoints, ...m.openingSpawnPoints]) {
      expect(m.nav.blocked[cell(m.nav, x, z)], `${x},${z}被封住`).toBe(0);
      expect(m.nav.dist[cell(m.nav, x, z)], `${x},${z}不可达`).toBeGreaterThanOrEqual(0);
      for (const c of m.colliders) expect(Math.hypot(x - c.x, z - c.z)).toBeGreaterThan(c.r + .42);
    }
    for (const [x, z] of m.openingSpawnPoints) expect(Math.hypot(x, z - 28)).toBeGreaterThanOrEqual(16);
    for (const [x, z] of m.openingSpawnPoints) expect(Math.hypot(x, z - 28)).toBeLessThanOrEqual(22);
    for (const [x, z] of m.zombieSpawnPoints) for (const b of m.bells) expect(Math.hypot(x - b.pos.x, z - b.pos.z)).toBeGreaterThan(2);
    expect(m.flowAt(40, 0, {})).toBe(false);
  });

  it('6米主环与5米侧路无遮挡，中央没有迫使跳跃的坠落坑', () => {
    const m = cloud();
    const probe = (x, z, radius) => {
      for (const p of m.platforms.filter((p) => p.h > .6)) {
        const dx = Math.max(0, Math.abs(x - p.x) - p.w / 2);
        const dz = Math.max(0, Math.abs(z - p.z) - p.d / 2);
        expect(Math.hypot(dx, dz), `路线${x},${z}被${p.x},${p.z}侵占`).toBeGreaterThanOrEqual(radius);
      }
    };
    for (let v = -29; v <= 29; v++) {
      probe(v, -29, 3); probe(v, 29, 3); probe(-29, v, 3); probe(29, v, 3);
    }
    for (let v = -29; v <= 29; v++) probe(v, -6, 2.5);
    for (let z = -29; z <= 29; z++) probe(0, z, 2.5);
    expect(m.ground.geometry.parameters.width).toBe(72);
    expect(m.ground.geometry.parameters.height).toBe(72);
    expect(m.ground.position.y).toBeCloseTo(0);
    for (const p of m.platforms) expect(p.h <= .4 || p.h >= 2.2).toBe(true);
  });

  it('实体遮挡与弹道盒体/流场同位，所有可站矮台仍不封导航', () => {
    const m = cloud();
    for (const p of m.platforms) {
      expect(m.walls.some((w) => w.x === p.x && w.z === p.z && w.hx === p.w / 2 && w.hz === p.d / 2 && w.y + w.hy === p.h)).toBe(true);
      if (p.h > .6) expect(m.nav.blocked[cell(m.nav, p.x, p.z)]).toBe(1);
      else expect(m.nav.blocked[cell(m.nav, p.x, p.z)]).toBe(0);
    }
    for (const c of m.colliders) expect(m.walls.some((w) => Math.abs(c.x - w.x) <= w.hx && Math.abs(c.z - w.z) <= w.hz)).toBe(true);
    expect(m.walls.some((w) => w.y - w.hy >= 4.8)).toBe(true);
  });
});

describe('云上发条游乐园 · 地标与低成本动画', () => {
  it('18米倒挂钟楼、木马街、积木峡谷、茶杯花园和鲸都归root', () => {
    const m = cloud();
    for (const name of ['inverted-clocktower', 'carousel-street', 'block-canyon', 'teacup-garden', 'clockwork-whale']) {
      expect(m.root.getObjectByName(name), name).toBeInstanceOf(THREE.Group);
    }
    const box = new THREE.Box3().setFromObject(m.root.getObjectByName('inverted-clocktower'));
    expect(box.max.y).toBeCloseTo(18, 1);
    expect(scene.children).toEqual([m.root]);
    expect(m.noShadows).toBe(true);
    const lights = [];
    m.root.traverse((o) => { if (o.isLight) lights.push(o); if (o.isMesh) expect(o.castShadow).toBe(false); });
    expect(lights).toHaveLength(2);
    expect(lights.some((l) => l.isDirectionalLight)).toBe(true);
    expect(lights.some((l) => l.isHemisphereLight)).toBe(true);
  });

  it('整个场景预算≤55绘制与30k三角面，重复物使用实例化或合并', () => {
    const m = cloud();
    let calls = 0; let triangles = 0; let instanced = 0;
    m.root.traverse((o) => {
      if (!o.isMesh) return;
      calls += Array.isArray(o.material) ? o.geometry.groups.length : 1;
      triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      if (o.isInstancedMesh) instanced++;
    });
    expect(calls).toBeLessThanOrEqual(55);
    expect(triangles).toBeLessThanOrEqual(30000);
    expect(instanced).toBeGreaterThanOrEqual(3);
  });

  it('动态屋顶/齿轮/远鲸不改变地面支撑与碰撞，背景是暖阳而非森林', () => {
    const m = cloud();
    const camera = new THREE.PerspectiveCamera();
    const collision = JSON.stringify([m.platforms, m.colliders, m.walls]);
    const roofBefore = m.carouselRoof.rotation.y;
    const whaleBefore = m.whale.position.clone();
    m.activate(scene, camera);
    expect(scene.background).toBe(materials.carnivalSkyTexture());
    expect(scene.fog.near).toBeGreaterThan(45);
    expect(m.root.visible).toBe(true);
    m.menuCamera(camera, 0); const before = camera.position.clone();
    m.menuCamera(camera, 10); expect(camera.position.distanceTo(before)).toBeGreaterThan(.5);
    m.update(1);
    expect(m.carouselRoof.rotation.y).not.toBe(roofBefore);
    expect(m.whale.position.distanceTo(whaleBefore)).toBeGreaterThan(0);
    expect(JSON.stringify([m.platforms, m.colliders, m.walls])).toBe(collision);
  });
});

describe('云上发条游乐园 · 铜钟视觉接口', () => {
  it('三钟靶保持固定世界坐标与直径，空响/有效命中只有局部视觉反馈', () => {
    const m = cloud();
    expect(m.bells.map((b) => [b.id, ...b.pos.toArray(), b.radius])).toEqual([[0, -16, 1.7, 3, .575], [1, 16, 1.7, 3, .575], [2, 0, 1.7, -17, .575]]);
    for (const bell of m.bells) expect(bell.group.parent).toBe(m.root);
    const fixed = m.bells.map((b) => b.pos.toArray());
    const collision = JSON.stringify(m.walls);
    expect(m.bellHit(0, false)).toBe(true);
    m.update(.08);
    expect(m.bells[0].swing.rotation.z).not.toBe(0);
    expect(m.bells[0].ring.visible).toBe(false);
    expect(m.bellHit(1, true)).toBe(true);
    m.update(.13);
    expect(m.bells[1].ring.visible).toBe(true);
    expect(m.bells[1].ring.material.opacity).toBeGreaterThan(0);
    expect(m.bellHit(99, true)).toBe(false);
    m.update(3);
    expect(m.bells[1].ring.visible).toBe(false);
    expect(m.bells[1].swing.rotation.z).toBe(0);
    expect(m.bells.map((b) => b.pos.toArray())).toEqual(fixed);
    expect(JSON.stringify(m.walls)).toBe(collision);
    expect(m.bellCooldown).toBeUndefined();
  });
});
