// 僵尸配件（交通锥 / 铁桶 / Boss 木棒）挂到骨骼上之后的**世界尺寸**。
// 这里必须用真实 glb 的骨架层级：stubGltfLoader 的替身没有 Head 骨骼，
// 所以配件一直是"挂 body、手写世界坐标"，100 倍骨架缩放的问题在那里永远测不出来。
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.doMock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  class FakeWebGLRenderer {
    constructor(opts) {
      Object.assign(this, makeFakeRenderer());
      this.domElement = (opts && opts.canvas) || null;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

let THREE;
let game;
let spawnZombieAt;
let MODELS;

beforeAll(async () => {
  const H = await import('../helpers/game.js');
  THREE = await import('three');
  await H.realGltfLoader();
  ({ spawnZombieAt } = H);
  game = (await H.createGame()).game;
  game.start();
  // 真实 glb 是异步解析的：spawnZombieAt 之前必须等到模型就绪，否则拿到的是空 Group
  const zm = await import('../../src/entities/ZombieModel.js');
  MODELS = zm.MODELS;
  const { zombieModel } = zm;
  for (let i = 0; i < 200 && !(zombieModel.ready && zombieModel.football.ready); i++) await new Promise((r) => setTimeout(r, 10));
  // realGltfLoader 默认给每个槽同一份 zombie.glb；头盔必须用实际的 football 骨架和头型。
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(__fixture_football_glb__).buffer, '');
  zombieModel.football.scene = gltf.scene;
  zombieModel.football.clips = gltf.animations;
}, 180000);

function spawn(type) {
  game.zombies.zombies.forEach((z) => z.dispose());
  game.zombies.zombies.length = 0;
  const z = spawnZombieAt(game, type, 0, 5, { speedMul: 0 });
  z.root.updateMatrixWorld(true);
  z.mountHeadTop();
  z.root.updateMatrixWorld(true);
  return z;
}

const worldSize = (obj) => new THREE.Box3().setFromObject(obj, true).getSize(new THREE.Vector3());

function headVertices(z) {
  z.root.updateMatrixWorld(true);
  const head = z.body.getObjectByName('Head');
  const points = [];
  z.body.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    const index = mesh.skeleton.bones.indexOf(head);
    for (let i = 0; i < a.position.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) {
        if (a.skinIndex.getComponent(i, j) === index) weight += a.skinWeight.getComponent(i, j);
      }
      if (weight < 0.5) continue;
      const p = new THREE.Vector3().fromBufferAttribute(a.position, i);
      mesh.applyBoneTransform(i, p);
      mesh.localToWorld(p);
      points.push(head.worldToLocal(p));
    }
  });
  return points;
}

function crownBox(z) {
  const points = headVertices(z);
  const box = new THREE.Box3().setFromPoints(points);
  return new THREE.Box3().setFromPoints(points.filter((p) => p.y >= box.max.y - box.getSize(new THREE.Vector3()).y * 0.3));
}

describe('真实颅骨贴合', () => {
  it.each(['cone', 'bucket', 'football'])('%s 的挂点不受出生位置、朝向和动画姿态影响', (type) => {
    const z = spawn(type);
    const pos = z.hat.position.clone();
    const quat = z.hat.quaternion.clone();
    z.root.position.set(25, 3, -18);
    z.root.rotation.y = 2.1;
    z.modelSource()._headCrown = null;
    z.mountHeadTop();
    expect(z.hat.position.distanceTo(pos)).toBeLessThan(1e-6);
    for (const action of ['walk', 'attack', 'hit', 'die']) {
      z.play(action, 0);
      z.mixer.setTime(0.5);
      z.root.updateMatrixWorld(true);
      expect(z.hat.position.distanceTo(pos)).toBeLessThan(1e-6);
      expect(z.hat.quaternion.angleTo(quat)).toBeLessThan(1e-6);
      expect(z.hat.visible).toBe(true);
      expect(z.hat.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(MODELS[z.modelId].scale * z.scaleFactor, 5);
    }
  });

  it.each(['cone', 'bucket'])('%s 的落点在颅顶前后中心，不偏向额头', (type) => {
    const z = spawn(type);
    z.mountHeadTop();
    const crown = crownBox(z);
    const center = crown.getCenter(new THREE.Vector3());
    const scale = z.hat.parent.getWorldScale(new THREE.Vector3()).x;
    expect(Math.abs(z.hat.position.x - center.x) * scale).toBeLessThan(0.025);
    expect(Math.abs(z.hat.position.z - center.z) * scale).toBeLessThan(0.025);
  });

  it('铁桶桶壁包住上半颅骨，不让后脑从侧壁穿出', () => {
    const z = spawn('bucket');
    z.mountHeadTop();
    const points = headVertices(z);
    const box = new THREE.Box3().setFromPoints(points);
    const inv = z.hat.matrixWorld.clone().invert();
    const barrel = z.hat.children[0];
    for (const p of points.filter((p) => p.y > box.max.y - box.getSize(new THREE.Vector3()).y * 0.5)) {
      const local = p.clone().applyMatrix4(z.hat.parent.matrixWorld).applyMatrix4(inv);
      if (Math.abs(local.y) > 0.17) continue;
      const radius = THREE.MathUtils.lerp(barrel.geometry.parameters.radiusBottom, barrel.geometry.parameters.radiusTop, (local.y + 0.17) / 0.34);
      const r = Math.hypot(local.x / barrel.scale.x, local.z / barrel.scale.z);
      expect(r).toBeLessThan(radius);
    }
  });

  it('头盔中线的前额端是完整色带，不保留球面极点的缺口', () => {
    const stripe = spawn('football').hat.children[1].geometry;
    const uv = stripe.attributes.uv;
    const top = [];
    for (let i = 0; i < uv.count; i++) if (uv.getY(i) === 1) top.push(i);
    top.sort((a, b) => uv.getX(a) - uv.getX(b));
    const triangles = stripe.index.array;
    for (let i = 0; i < top.length - 1; i++) {
      let connected = false;
      for (let j = 0; j < triangles.length; j += 3) {
        const tri = Array.from(triangles.slice(j, j + 3));
        if (tri.includes(top[i]) && tri.includes(top[i + 1])) connected = true;
      }
      expect(connected).toBe(true);
    }
  });

  it('橄榄球盔壳覆盖颅顶并保留弧形面罩', () => {
    const z = spawn('football');
    z.mountHeadTop();
    const shell = z.hat.children[0];
    const points = headVertices(z);
    const box = new THREE.Box3().setFromPoints(points);
    const inv = shell.matrixWorld.clone().invert();
    for (const p of points.filter((p) => p.y > box.max.y - box.getSize(new THREE.Vector3()).y * 0.3)) {
      const local = p.clone().applyMatrix4(z.hat.parent.matrixWorld).applyMatrix4(inv);
      expect(local.length()).toBeLessThan(shell.geometry.parameters.radius);
    }
    z.hat.children[2].geometry.computeBoundingBox();
    expect(z.hat.children[2].geometry.boundingBox.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.3);
    expect(z.hat.children.length).toBeLessThanOrEqual(6);
  });
});

describe('僵尸配件挂在骨骼上不会跟着骨架缩放放大', () => {
  it('骨架层级和真实模型一致（Head 骨骼在 100 倍缩放的 CharacterArmature 下）', () => {
    const z = spawn('cone');
    const head = z.body.getObjectByName('Head');
    expect(head).toBeTruthy();
    expect(z.hat.parent).toBe(head);
    // 真实模型这里 ≈158（1.55 模型缩放 × 102 根节点缩放）；stub 模型是 1
    expect(head.getWorldScale(new THREE.Vector3()).x).toBeGreaterThan(100);
  });

  it.each(['cone', 'bucket'])('%s 的世界尺寸和僵尸身体匹配（不超过身高的 0.6 倍、不超过 1.3 米宽）', (type) => {
    const z = spawn(type);
    // 播一会儿动画再量：bind 姿态的 Head 骨骼还带着 glb 的 Z-up 修正旋转（约 108°），
    // 帽子包围盒会按倾斜后的外接盒虚胖（铁桶 0.87 → 1.14），玩家看到的其实是动画姿态。
    for (let i = 0; i < 30; i++) game.update(1 / 60);
    z.root.updateMatrixWorld(true);
    const hat = worldSize(z.hat);
    const body = worldSize(z.body);
    // 旧 bug：直接挂骨骼，交通锥被放大到 80+ 米宽、世界 y 从 -39 跨到 +43
    // 铁桶扩大后包住后脑，动画倾斜后的 AABB 约 1.26 m；旧骨架缩放 bug 是 80 m 量级。
    expect(hat.x).toBeLessThan(1.3);
    expect(hat.z).toBeLessThan(1.3);
    expect(hat.y).toBeLessThan(body.y * 0.6);
  });

  it.each(['cone', 'bucket'])('%s 压在头顶上，不会掉到脚底或悬在半空', (type) => {
    const z = spawn(type);
    const hat = new THREE.Box3().setFromObject(z.hat);
    const body = new THREE.Box3().setFromObject(z.body);
    // 身体（含配件前）最高点由模型决定，帽子应当落在身体顶端附近
    expect(hat.min.y).toBeGreaterThan(z.root.position.y + 1);
    expect(hat.max.y).toBeLessThanOrEqual(body.max.y + 0.01);
  });

  it.each(['cone', 'bucket'])('%s 的世界缩放和身体一致（抵掉 100 倍骨架，保留模型缩放）', (type) => {
    const z = spawn(type);
    // 曾经的 bug：hatScale 直接取 1/骨骼世界缩放，把模型缩放（ZOMBIE_SCALE）也除掉了，
    // 配件世界尺寸只剩身体的 1/1.55，大半截陷进脑袋里，看起来像「没戴帽子」。
    expect(z.hat.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(MODELS.zombie.scale * z.scaleFactor, 2);
  });

  it('身体本身还是正常僵尸尺寸（配件没有把它撑大）', () => {
    const z = spawn('cone');
    // 蒙皮网格的静态包围盒（绑定姿态，几乎是个点）会被骨骼动画撑开，Box3 不可信；
    // 这里只卡"帽子和身体在同一量级"，真正的身高口径见 AGENTS.md 5.2（模型原高 × ZOMBIE_SCALE）。
    expect(z.body.scale.x).toBeCloseTo(1.55, 6);
    const hat = worldSize(z.hat);
    const body = worldSize(z.body);
    expect(hat.y).toBeLessThan(body.y);
    expect(hat.x).toBeLessThan(body.x);
  });
});