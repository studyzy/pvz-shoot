import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WEAPONS } from '../../src/config.js';

let requests;
let loadWeaponModel;
let WeaponSystem;
let WeaponPickups;

function template(id) {
  const group = new THREE.Group();
  group.name = id;
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x75ba34 })));
  return group;
}

function ctx() {
  return {
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    player: { pos: new THREE.Vector3() },
    hud: { setSlots: vi.fn(), setWeapon: vi.fn(), setActiveSlot: vi.fn(), setAmmo: vi.fn(), setCharges: vi.fn() },
  };
}

beforeEach(async () => {
  vi.resetModules();
  requests = [];
  vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class {
      load(url, done, progress, fail) { requests.push({ url, done, fail }); }
    },
  }));
  ({ loadWeaponModel } = await import('../../src/weapons/WeaponModels.js'));
  ({ WeaponSystem } = await import('../../src/weapons/WeaponSystem.js'));
  ({ WeaponPickups } = await import('../../src/entities/WeaponPickups.js'));
});

describe('植物 GLB 缓存', () => {
  it('同 id 只加载一次，不同植物变体使用独立 URL', async () => {
    const a = loadWeaponModel('pea');
    expect(loadWeaponModel('pea')).toBe(a);
    const b = loadWeaponModel('snow');
    expect(requests.map((r) => r.url)).toEqual(['/models/weapons/pea.glb', '/models/weapons/snow.glb']);
    const pea = template('pea');
    const snow = template('snow');
    requests[0].done({ scene: pea });
    requests[1].done({ scene: snow });
    expect(await a).toBe(pea);
    expect(await b).toBe(snow);
  });

  it('加载失败保留占位，不重复请求或产生未处理拒绝', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = loadWeaponModel('pea');
    requests[0].fail(new Error('missing'));
    expect(await a).toBeNull();
    expect(await loadWeaponModel('pea')).toBeNull();
    expect(requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('空模型视为加载失败', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = loadWeaponModel('pea');
    requests[0].done({ scene: new THREE.Group() });
    expect(await a).toBeNull();
  });
});

describe('手持植物视觉替换', () => {
  it.each(WEAPONS.map((def) => [def.id]))('%s 只替换视觉，保留枪口、姿势和装备可见性', async (id) => {
    const system = new WeaponSystem(ctx());
    const index = WEAPONS.findIndex((w) => w.id === id);
    const model = system.models[index];
    const muzzle = model.muzzle;
    const position = model.group.position.clone();
    const rotation = model.group.rotation.clone();
    const scale = model.group.scale.clone();
    const muzzlePosition = muzzle.getWorldPosition(new THREE.Vector3());
    const visible = model.group.visible;
    expect(model.visual.children.length).toBeGreaterThan(0);
    const resource = template(id);
    requests.find((r) => r.url.endsWith('/' + id + '.glb')).done({ scene: resource });
    await model.ready;
    expect(model.loaded).toBe(true);
    expect(model.visual.children).toHaveLength(1);
    expect(model.visual.children[0]).not.toBe(resource);
    expect(model.visual.children[0].children[0].geometry).toBe(resource.children[0].geometry);
    expect(model.muzzle).toBe(muzzle);
    expect(muzzle.parent).toBe(model.group);
    expect(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(muzzlePosition)).toBeLessThan(1e-10);
    expect(model.group.position).toEqual(position);
    expect(model.group.rotation.toArray()).toEqual(rotation.toArray());
    expect(model.group.scale).toEqual(scale);
    expect(model.group.visible).toBe(visible);
  });

  it('森林中迟到的GLB也保持受光隔离、原顶点色和共享模板', async () => {
    const system = new WeaponSystem(ctx());
    system.setMapAppearance('forest');
    const model = system.models[0];
    const oldMeshes = [];model.visual.traverse(n=>{if(n.isMesh)oldMeshes.push(n);});
    const disposed = oldMeshes.filter(n=>n.userData.dayMaterial).map(n=>({
      day:vi.spyOn(n.userData.dayMaterial,'dispose'),
      night:vi.spyOn(n.userData.nightMaterial,'dispose'),
    }));
    const resource = template('pea');
    const source = resource.children[0];
    source.geometry.setAttribute('color', new THREE.Float32BufferAttribute(
      Array.from({length:source.geometry.attributes.position.count},()=>[.2,.5,.1]).flat(),3));
    source.material.vertexColors=true;
    const before=source.geometry.attributes.color.array.slice();
    requests[0].done({scene:resource});await model.ready;
    const mesh=model.visual.children[0].children[0];
    expect(mesh.material.isMeshBasicMaterial).toBe(true);
    expect(mesh.geometry).not.toBe(source.geometry);
    expect(source.material.isMeshStandardMaterial).toBe(true);
    expect(source.geometry.attributes.color.array).toEqual(before);
    const paint=mesh.geometry.attributes.color;
    expect(paint.getX(0)/paint.getY(0)).toBeCloseTo(.4);
    expect(paint.getZ(0)/paint.getY(0)).toBeCloseTo(.2);
    expect(disposed.length).toBeGreaterThan(0);
    disposed.forEach(d=>{expect(d.day).toHaveBeenCalled();expect(d.night).toHaveBeenCalled();});
    const cachedGeometry=mesh.geometry;const cachedMaterial=mesh.material;
    system.setMapAppearance('snow');
    expect(mesh.geometry).toBe(source.geometry);expect(mesh.material).toBe(source.material);
    system.setMapAppearance('forest');
    expect(mesh.geometry).toBe(cachedGeometry);expect(mesh.material).toBe(cachedMaterial);
  });

  it('加载后切图不把夜间明暗烘进地面拾取的共享几何', async () => {
    const system = new WeaponSystem(ctx());const resource=template('pea');
    requests[0].done({scene:resource});await system.models[0].ready;
    const mesh=system.models[0].visual.children[0].children[0];
    system.setMapAppearance('forest');expect(mesh.material.isMeshBasicMaterial).toBe(true);
    expect(resource.children[0].geometry.getAttribute('color')).toBeUndefined();
    expect(resource.children[0].material.isMeshStandardMaterial).toBe(true);
    system.setMapAppearance('dust');expect(mesh.material.isMeshStandardMaterial).toBe(true);
  });

  it('加载前切回白天也释放占位模型的夜间资源', async () => {
    const system = new WeaponSystem(ctx());system.setMapAppearance('forest');
    const mesh=system.models[0].visual.children.find(n=>n.userData.nightMaterial);
    const material=vi.spyOn(mesh.userData.nightMaterial,'dispose');
    const geometry=vi.spyOn(mesh.userData.nightGeometry,'dispose');
    system.setMapAppearance('snow');
    requests[0].done({scene:template('pea')});await system.models[0].ready;
    expect(material).toHaveBeenCalled();expect(geometry).toHaveBeenCalled();
    expect(system.models[0].visual.children[0].children[0].material.isMeshStandardMaterial).toBe(true);
  });

  it('下载失败后仍保留可见的原植物', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const system = new WeaponSystem(ctx());
    const model = system.models[0];
    const children = [...model.visual.children];
    requests[0].fail(new Error('offline'));
    await model.ready;
    expect(model.loaded).toBe(false);
    expect(model.visual.children).toEqual(children);
  });
});

describe('地面植物视觉替换', () => {
  it('重绘时旧请求不能改写新 holder，包括 A→B→A', async () => {
    const pickups = new WeaponPickups(ctx());
    const item = pickups.items[0];
    pickups.paint(item, 1);
    const old = item.holder.children[0];
    pickups.paint(item, 2);
    pickups.paint(item, 1);
    const current = item.holder.children[0];
    requests.find((r) => r.url.endsWith('/snow.glb')).done({ scene: template('snow') });
    await item.visualReady;
    requests.find((r) => r.url.endsWith('/cherry.glb')).done({ scene: template('cherry') });
    await Promise.resolve();
    expect(old.parent).toBeNull();
    expect(item.holder.children).toEqual([current]);
    expect(current.children).toHaveLength(1);
    expect(current.children[0].name).toBe('snow');
  });

  it('相同植物各拾取实例变换独立且不改模板', async () => {
    const pickups = new WeaponPickups(ctx());
    const a = pickups.items[0];
    const b = pickups.items[1];
    pickups.paint(a, 3);
    pickups.paint(b, 3);
    const resource = template('cob');
    requests[0].done({ scene: resource });
    await Promise.all([a.visualReady, b.visualReady]);
    const first = a.holder.children[0].children[0];
    const second = b.holder.children[0].children[0];
    expect(first).not.toBe(second);
    expect(first.children[0].geometry).toBe(second.children[0].geometry);
    const secondPos = second.position.clone();
    first.position.x += 7;
    expect(second.position).toEqual(secondPos);
    expect(resource.position).toEqual(new THREE.Vector3());
    expect(resource.scale).toEqual(new THREE.Vector3(1, 1, 1));
    expect(new THREE.Box3().setFromObject(second).min.y).toBeCloseTo(0, 6);
  });

  it('地面模型下载失败仍保留占位缩略模型', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pickups = new WeaponPickups(ctx());
    const item = pickups.items[0];
    pickups.paint(item, 1);
    const visual = item.holder.children[0];
    const fallback = visual.children[0];
    requests[0].fail(new Error('offline'));
    await item.visualReady;
    expect(visual.children).toEqual([fallback]);
  });
});
