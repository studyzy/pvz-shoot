// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS, zombieModel, fitToHeight } from '../../src/entities/ZombieModel.js';
import { GALLERY_TYPES, typeInfo } from '../../src/gallery/presets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/models/toys');
const HEIGHTS = { toySoldier: 1.8, springDuck: 1.1, teaSprite: 1.3, paperGlider: 0.65, jackBox: 1.6, clockRabbit: 3.4 };
const PARTS = {
  toySoldier: ['Head', 'ChestArmor', 'ArmL', 'ArmR', 'LegL', 'LegR'],
  springDuck: ['Head', 'Spring', 'FootL', 'FootR'],
  teaSprite: ['Head', 'Lid', 'Spout', 'Handle'],
  paperGlider: ['Head', 'WingL', 'WingR'],
  jackBox: ['Head', 'Lid', 'Spring', 'Glove'],
  clockRabbit: ['Head', 'EarL', 'EarR', 'ClockHand', 'PocketWatch'],
};
const CLIPS = ['Idle', 'Walk', 'Idle_Attack', 'Death', 'HitReact'];
const io = new NodeIO();
const ids = Object.keys(HEIGHTS);

async function load(id) {
  const bytes = readFileSync(join(DIR, id + '.glb'));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

describe('云上发条乐园 · 正式原创玩具资产', () => {
  it.each(ids)('%s registers a distinct local model slot and gallery entry', (id) => {
    expect(MODELS[id], id + ': dedicated model, not a zombie reskin').toEqual({ url: 'models/toys/' + id + '.glb', targetHeight: HEIGHTS[id] });
    expect(zombieModel[id]).toMatchObject({ ready: false, failed: false, scene: null, clips: [], scale: 1 });
    expect(GALLERY_TYPES.find((t) => t.id === id)).toMatchObject({ id, name: expect.any(String), subtitle: expect.any(String), desc: expect.any(String) });
  });

  it.each(ids)('%s is self-contained, genuinely painted and within the mesh budget', async (id) => {
    const file = join(DIR, id + '.glb');
    expect(existsSync(file), id + ': missing formal GLB').toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.buffers.every((b) => !b.uri)).toBe(true);
    expect(json.images || []).toHaveLength(0);
    expect(json.extensionsRequired || []).toEqual([]);
    expect(statSync(file).size).toBeLessThan(id === 'clockRabbit' ? 900000 : 500000);
    expect(json.asset.generator).toMatch(/original.*toy/i);
    const root = (await io.read(file)).getRoot();
    expect(root.listMaterials().length).toBeLessThanOrEqual(2);
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listMeshes().length).toBe(id === 'toySoldier' ? 2 : 1);
    const sceneRoot = root.listScenes()[0].listChildren()[0];
    expect(sceneRoot.getName()).toBe(id);
    expect(sceneRoot.getTranslation()).toEqual([0, 0, 0]);
    expect(sceneRoot.getRotation()).toEqual([0, 0, 0, 1]);
    expect(sceneRoot.getScale()).toEqual([1, 1, 1]);
    expect(sceneRoot.getExtras()).toMatchObject({ original: true, up: '+Y', forward: '+Z' });
    for (const part of PARTS[id]) expect(root.listNodes().some((n) => n.getName() === part), part).toBe(true);
    let triangles = 0;
    const palette = new Set();
    for (const primitive of root.listMeshes().flatMap((m) => m.listPrimitives())) {
      expect(primitive.getMode()).toBe(4);
      expect(primitive.getMaterial().getMetallicFactor()).toBe(0);
      expect(primitive.getMaterial().getDoubleSided()).toBe(false);
      const p = primitive.getAttribute('POSITION'), n = primitive.getAttribute('NORMAL'), c = primitive.getAttribute('COLOR_0'), ix = primitive.getIndices();
      expect(n.getCount()).toBe(p.getCount());
      expect(c.getCount()).toBe(p.getCount());
      triangles += ix.getCount() / 3;
      const pos = p.getArray(), normals = n.getArray(), colors = c.getArray(), indices = ix.getArray();
      let valid = true;
      for (let v = 0; v < p.getCount(); v++) {
        const a = v * 3;
        valid &&= Math.abs(Math.hypot(...normals.subarray(a, a + 3)) - 1) < 0.0001;
        palette.add(Array.from(colors.subarray(a, a + 3)).map((x) => Math.round(x * 32)).join(','));
        for (let k = 0; k < 3; k++) valid &&= Number.isFinite(pos[a + k]) && Number.isFinite(colors[a + k]) && colors[a + k] >= 0 && colors[a + k] <= 1;
      }
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, d = indices[t + 2] * 3;
        valid &&= a < pos.length && b < pos.length && d < pos.length;
        const u = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
        const v = new THREE.Vector3(pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]);
        const cross = u.cross(v);
        valid &&= cross.length() > 1e-10 && cross.dot(new THREE.Vector3(normals[a] + normals[b] + normals[d], normals[a + 1] + normals[b + 1] + normals[d + 1], normals[a + 2] + normals[b + 2] + normals[d + 2])) > 0;
      }
      expect(valid, id + ': finite colors/positions, unit normals, nondegenerate outward winding').toBe(true);
      if (primitive.getAttribute('JOINTS_0')) {
        const weights = primitive.getAttribute('WEIGHTS_0').getArray();
        for (let j = 0; j < weights.length; j += 4) expect(weights[j] + weights[j + 1] + weights[j + 2] + weights[j + 3]).toBeCloseTo(1, 5);
      }
    }
    expect(palette.size, id + ': original vertex paint').toBeGreaterThan(12);
    expect(triangles).toBeGreaterThanOrEqual(1800);
    expect(triangles).toBeLessThanOrEqual(id === 'clockRabbit' ? 8000 : 4000);
    expect(root.listAnimations().map((a) => a.getName())).toEqual(expect.arrayContaining(CLIPS));
    for (const anim of root.listAnimations()) {
      expect(anim.listChannels().length).toBeGreaterThan(1);
      for (const channel of anim.listChannels()) expect(channel.getTargetNode()).not.toBe(sceneRoot);
    }
  });

  it.each(ids)('%s actually advances every clip on its real rig without horizontal root motion', async (id) => {
    expect(existsSync(join(DIR, id + '.glb'))).toBe(true);
    const gltf = await load(id);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    expect(bounds.min.y).toBeCloseTo(0, 4);
    expect(bounds.max.y).toBeCloseTo(HEIGHTS[id], 3);
    const originalHeight = bounds.getSize(new THREE.Vector3()).y;
    expect(originalHeight).toBeGreaterThan(0);
    // 量归一化缩放要用一份拷贝：fitToHeight 会原地改 scene.scale/position，
    // 直接拿它回来克隆，下面每条动画的 root.position 都会带上缩放的浮点残渣。
    const probe = clone(gltf.scene);
    expect(fitToHeight(probe, HEIGHTS[id])).toBeCloseTo(1, 3);
    for (const name of CLIPS) {
      const clip = gltf.animations.find((c) => c.name === name);
      expect(clip, name).toBeTruthy();
      const scene = clone(gltf.scene);
      const root = scene.getObjectByName(id);
      const mixer = new THREE.AnimationMixer(scene);
      const action = mixer.clipAction(clip).play();
      action.setLoop(THREE.LoopOnce, 1);
      const initial = scene.getObjectByName('Head').quaternion.clone();
      mixer.setTime(clip.duration * 0.31);
      const moved = scene.getObjectByName('Head').quaternion;
      expect(initial.angleTo(moved), name + ': real Head animation, not empty clip').toBeGreaterThan(0.0001);
      for (const t of [0, 0.19, 0.43, 0.67, 0.91]) {
        mixer.setTime(clip.duration * t);
        expect(root.position.toArray()).toEqual([0, 0, 0]);
        const body = scene.getObjectByName('Body');
        expect(body.position.x).toBe(0);
        expect(body.position.z).toBe(0);
        scene.updateMatrixWorld(true);
        if (name === 'Walk' || name === 'Idle') {
          const box = new THREE.Box3().setFromObject(scene);
          expect(box.min.y, id + ': living feet do not sink').toBeGreaterThanOrEqual(-0.055);
          expect(box.max.y, id + ': bounded locomotion pose').toBeLessThan(HEIGHTS[id] * 1.3);
        }
      }
      mixer.stopAllAction();
    }
    const a = clone(gltf.scene), b = clone(gltf.scene);
    expect(a.getObjectByName('Head')).not.toBe(b.getObjectByName('Head'));
    a.getObjectByName('Head').rotation.x = 0.7;
    // 克隆出来的 Head 是另一个对象且没被改过。用 quaternion 比：单位四元数分解成欧拉角时
    // three 会给出 -0（Object.is(-0, 0) 为假），那是库的分解产物，不是资产漂移。
    expect(b.getObjectByName('Head').quaternion.equals(new THREE.Quaternion())).toBe(true);
    if (id === 'toySoldier') {
      const armor = a.getObjectByName('ChestArmor');
      expect(armor.isMesh).toBe(true);
      armor.visible = false;
      expect(b.getObjectByName('ChestArmor').visible).toBe(true);
      expect(a.getObjectByName('ToyMesh').visible).toBe(true);
    }
  });

  it('includes truthful provenance and deterministic rebuilds without new resources', async () => {
    expect(existsSync(join(ROOT, 'tools/build-toy-models.mjs'))).toBe(true);
    expect(existsSync(join(DIR, 'PROVENANCE.txt'))).toBe(true);
    const text = readFileSync(join(DIR, 'PROVENANCE.txt'), 'utf8');
    expect(text).toMatch(/original/i);
    expect(text).toMatch(/build-toy-models.mjs/);
    expect(text).toMatch(/no.*CC0|not.*CC0/i);
    ids.forEach((id) => expect(text).toContain(id + '.glb'));
    const { buildToyModels, TOY_IDS } = await import('../../tools/build-toy-models.mjs');
    expect(TOY_IDS).toEqual(ids);
    const output = mkdtempSync(join(tmpdir(), 'pvz-toy-assets-'));
    try {
      const report = await buildToyModels(output);
      expect(report.map((r) => r.id)).toEqual(ids);
      ids.forEach((id) => expect(readFileSync(join(output, id + '.glb'))).toEqual(readFileSync(join(DIR, id + '.glb'))));
      expect(readFileSync(join(output, 'PROVENANCE.txt'))).toEqual(readFileSync(join(DIR, 'PROVENANCE.txt')));
    } finally { rmSync(output, { recursive: true, force: true }); }
  });
});
