import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WEAPONS } from '../../src/config.js';

let requests;
let loadWeaponModel;
let WeaponSystem;
let WeaponPickups;

// 植物模型现在是一个合并包（models/weapons/pack.glb）：包里每个原模型是名为 pack.<id> 的节点。
function template(id) {
  const holder = new THREE.Group();
  holder.name = 'pack.' + id;
  const inner = new THREE.Group();
  inner.name = id;
  inner.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x75ba34 })));
  holder.add(inner);
  return holder;
}

function pack(items) {
  const root = new THREE.Group();
  root.name = 'weapon-pack';
  for (const t of items) root.add(t);
  return root;
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
  // 植物包走 TrackedGLTFLoader（LoadProgress 里加载器的子类），替身要同时提供两者
  vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class {
      load(url, done, progress, fail) { requests.push({ url, done, fail }); }
    },
    Loader: class {},
  }));
  ({ loadWeaponModel } = await import('../../src/weapons/WeaponModels.js'));
  ({ WeaponSystem } = await import('../../src/weapons/WeaponSystem.js'));
  ({ WeaponPickups } = await import('../../src/entities/WeaponPickups.js'));
});

describe('植物 GLB 包', () => {
  it('所有植物共用一次请求：不同 id 拿到包里各自独立的模板', async () => {
    const a = loadWeaponModel('pea');
    const b = loadWeaponModel('snow');
    // 12 个植物一次下完，不论要哪个 id 都只发一个请求
    expect(requests.map((r) => r.url)).toEqual(['/models/weapons/pack.glb']);
    const peaTpl = template('pea');
    const peaLive = peaTpl.children[0].getObjectByProperty('isMesh', true);
    const peakGeo = peaLive.geometry;
    requests[0].done({ scene: pack([peaTpl, template('snow')]) });
    const pea = await a;
    const snow = await b;
    expect(pea.name).toBe('pack.pea');
    expect(pea.children[0].name).toBe('');
    expect(snow.name).toBe('pack.snow');
    expect(pea).not.toBe(snow);
    // 拆包是浅克隆：几何/材质仍指向共享模板（内层 <id> 组里挂着那个 Mesh）
    const packedMesh = pea.children[0].getObjectByProperty('isMesh', true);
    expect(packedMesh.isMesh).toBe(true);
    expect(packedMesh.geometry).toBe(peakGeo);
    expect(await loadWeaponModel('pea')).toBe(pea);
    expect(requests).toHaveLength(1);
  });

  it('包里缺某个植物时返回 null 并警告（不抛错）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = loadWeaponModel('melon');
    await Promise.resolve();
    requests[0].done({ scene: pack([template('pea')]) });
    expect(await missing).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('下载失败保留占位，不重复请求或产生未处理拒绝', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = loadWeaponModel('pea');
    await Promise.resolve();
    requests[0].fail(new Error('missing'));
    expect(await a).toBeNull();
    expect(await loadWeaponModel('pea')).toBeNull();
    expect(requests).toHaveLength(1);
    // 一个包只警告一次；后面的 id 直接拿同一个空结果，不再重复刷屏
    // （其余两次警告来自构造 WeaponSystem/WeaponPickups 的其它植物查找，同为"包里没有"）
    expect(warn.mock.calls.filter((c) => String(c[0]) === 'weapon pack failed')).toHaveLength(1);
  });

  it('空包视为加载失败', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = loadWeaponModel('pea');
    await Promise.resolve();
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
    const all = WEAPONS.map((w) => template(w.id));
    requests[0].done({ scene: pack(all) });
    await model.ready;
    // 包里的模板外层是 pack.<id>，里层才是原来那个 <id> 节点；视觉层在它外面又包了一层组
    const resource = all[index].children[0];
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
    const source = resource.children[0].children[0];
    source.geometry.setAttribute('color', new THREE.Float32BufferAttribute(
      Array.from({length:source.geometry.attributes.position.count},()=>[.2,.5,.1]).flat(),3));
    source.material.vertexColors=true;
    const before=source.geometry.attributes.color.array.slice();
    requests[0].done({scene:pack([resource])});await model.ready;
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
    requests[0].done({scene:pack([resource])});await system.models[0].ready;
    const mesh=system.models[0].visual.children[0].children[0];
    system.setMapAppearance('forest');expect(mesh.material.isMeshBasicMaterial).toBe(true);
    expect(resource.children[0].children[0].geometry.getAttribute('color')).toBeUndefined();
    expect(resource.children[0].children[0].material.isMeshStandardMaterial).toBe(true);
    system.setMapAppearance('dust');expect(mesh.material.isMeshStandardMaterial).toBe(true);
  });

  it('加载前切回白天也释放占位模型的夜间资源', async () => {
    const system = new WeaponSystem(ctx());system.setMapAppearance('forest');
    const mesh=system.models[0].visual.children.find(n=>n.userData.nightMaterial);
    const material=vi.spyOn(mesh.userData.nightMaterial,'dispose');
    const geometry=vi.spyOn(mesh.userData.nightGeometry,'dispose');
    system.setMapAppearance('snow');
    requests[0].done({scene:pack([template('pea')])});await system.models[0].ready;
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
    // 包是一次性给的：snow 与 cherry 同批到达，只改当前 holder
    requests[0].done({ scene: pack([template('snow'), template('cherry')]) });
    await item.visualReady;
    await Promise.resolve();
    expect(old.parent).toBeNull();
    expect(item.holder.children).toEqual([current]);
    expect(current.children).toHaveLength(1);
    expect(current.children[0].name).toBe('pack.snow');
  });

  it('相同植物各拾取实例变换独立且不改模板', async () => {
    const pickups = new WeaponPickups(ctx());
    const a = pickups.items[0];
    const b = pickups.items[1];
    pickups.paint(a, 3);
    pickups.paint(b, 3);
    const resource = template('cob');
    requests[0].done({ scene: pack([resource]) });
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
