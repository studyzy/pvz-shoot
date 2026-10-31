// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/models/weapons');
const IDS = ['pea', 'snow', 'cherry', 'cob', 'repeater', 'threepeater', 'gatling', 'cactus', 'melon', 'jalapeno', 'wallnut', 'firepea'];
const io = new NodeIO();
const ENVELOPES = {
  pea: [0.55, 0.7, 0.9], snow: [0.55, 0.7, 0.9], firepea: [0.55, 0.8, 0.9],
  repeater: [0.65, 0.7, 0.9], threepeater: [0.65, 0.7, 0.9], gatling: [0.65, 0.75, 0.95],
  cherry: [0.36, 0.56, 0.4], cob: [0.55, 0.65, 0.8], cactus: [0.4, 0.6, 0.85],
  melon: [0.57, 0.81, 0.65], jalapeno: [0.4, 0.55, 0.75], wallnut: [0.6, 0.7, 0.6],
};

describe('original offline plant weapon assets', () => {
  it.each(IDS)('%s is an embedded, named, budgeted GLB with sound organic geometry', async (id) => {
    const file = join(DIR, `${id}.glb`);
    expect(existsSync(file), `${id}: missing distribution asset`).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.buffers.every((b) => !b.uri)).toBe(true);
    expect((json.images || []).every((image) => image.bufferView !== undefined && !image.uri)).toBe(true);
    expect(json.extensionsRequired || []).toEqual([]);
    expect(statSync(file).size).toBeLessThan(350000);

    const document = await io.read(file);
    const root = document.getRoot();
    expect(root.listScenes()).toHaveLength(1);
    expect(root.listScenes()[0].getName()).toBe(id);
    const nodes = root.listScenes()[0].listChildren();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].getName()).toBe(id);
    expect(nodes[0].getTranslation()).toEqual([0, 0, 0]);
    expect(nodes[0].getRotation()).toEqual([0, 0, 0, 1]);
    expect(nodes[0].getScale()).toEqual([1, 1, 1]);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives.length).toBeGreaterThanOrEqual(2);
    expect(primitives.length).toBeLessThanOrEqual(4);
    let triangles = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of primitives) {
      expect(primitive.getMode()).toBe(4);
      const material = primitive.getMaterial();
      expect(material).not.toBeNull();
      expect(material.getMetallicFactor()).toBe(0);
      expect(material.getRoughnessFactor()).toBeGreaterThanOrEqual(0.35);
      expect(material.getRoughnessFactor()).toBeLessThanOrEqual(0.85);
      expect(material.getDoubleSided()).toBe(false);
      const position = primitive.getAttribute('POSITION');
      const normal = primitive.getAttribute('NORMAL');
      const color = primitive.getAttribute('COLOR_0');
      const indices = primitive.getIndices();
      expect(normal.getCount()).toBe(position.getCount());
      expect(color.getCount()).toBe(position.getCount());
      expect(indices.getCount() % 3).toBe(0);
      triangles += indices.getCount() / 3;
      const p = position.getArray(), n = normal.getArray(), c = color.getArray(), ix = indices.getArray();
      let valid = true, white = 0, wrongWinding = 0;
      for (let v = 0; v < position.getCount(); v++) {
        const len = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
        valid &&= Number.isFinite(len) && Math.abs(len - 1) < 0.0001;
        if (c[v * 3] > 0.95 && c[v * 3 + 1] > 0.95 && c[v * 3 + 2] > 0.95) white++;
        for (let axis = 0; axis < 3; axis++) {
          const value = p[v * 3 + axis];
          valid &&= Number.isFinite(value) && Number.isFinite(c[v * 3 + axis]) && c[v * 3 + axis] >= 0 && c[v * 3 + axis] <= 1;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3, b = ix[t + 1] * 3, d = ix[t + 2] * 3;
        valid &&= a < p.length && b < p.length && d < p.length;
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area = Math.hypot(...cross);
        valid &&= Number.isFinite(area) && area > 1e-12;
        const dot = cross.reduce((sum, value, axis) => sum + value * (n[a + axis] + n[b + axis] + n[d + axis]), 0);
        if (dot <= 0) wrongWinding++;
      }
      expect(valid, `${id}: finite/unit normals, colors, nondegenerate triangles and valid indices`).toBe(true);
      expect(wrongWinding, `${id}: triangle winding agrees with vertex normals`).toBe(0);
      expect(white / position.getCount(), `${id}: vertex-painted surfaces, not a white fallback`).toBeLessThan(0.2);
    }
    expect(triangles).toBeGreaterThan(600);
    expect(triangles).toBeLessThanOrEqual(6000);
    const size = max.map((value, axis) => value - min[axis]);
    size.forEach((value, axis) => expect(value, `${id}: local envelope axis ${axis}`).toBeLessThanOrEqual(ENVELOPES[id][axis]));
    expect(min[1]).toBeGreaterThanOrEqual(-0.45);
    expect(max[1]).toBeLessThanOrEqual(0.45);
    if (['pea', 'snow', 'firepea', 'repeater', 'threepeater', 'gatling', 'cactus', 'cob'].includes(id)) {
      expect(min[2], `${id}: forward muzzle uses -Z`).toBeLessThan(-0.35);
    }
  });

  it('fits a small distribution and retains truthful original-asset provenance', () => {
    IDS.forEach((id) => expect(existsSync(join(DIR, `${id}.glb`))).toBe(true));
    expect(IDS.reduce((sum, id) => sum + statSync(join(DIR, `${id}.glb`)).size, 0)).toBeLessThan(2400000);
    expect(existsSync(join(DIR, 'PROVENANCE.txt'))).toBe(true);
    const text = readFileSync(join(DIR, 'PROVENANCE.txt'), 'utf8');
    expect(text).toMatch(/original/i);
    expect(text).toMatch(/build-weapon-models\.mjs/);
    expect(text).toMatch(/no.*CC0|not.*CC0/i);
    IDS.forEach((id) => expect(text).toContain(`${id}.glb`));
  });

  it('regenerates all 12 assets byte-for-byte into an isolated directory', async () => {
    const generator = join(ROOT, 'tools/build-weapon-models.mjs');
    expect(existsSync(generator)).toBe(true);
    const { buildWeaponModels } = await import('../../tools/build-weapon-models.mjs');
    const output = mkdtempSync(join(tmpdir(), 'pvz-weapon-assets-'));
    try {
      await buildWeaponModels(output);
      IDS.forEach((id) => expect(readFileSync(join(output, `${id}.glb`))).toEqual(readFileSync(join(DIR, `${id}.glb`))));
      expect(readFileSync(join(output, 'PROVENANCE.txt'))).toEqual(readFileSync(join(DIR, 'PROVENANCE.txt')));
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
