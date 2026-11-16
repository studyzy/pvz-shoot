// The vendored painted-valley rendering stack, assembled lazily for the 'valley' map.
//
// Why this file exists separately from PaintedValley.js: the map's constructor must stay free of
// WebGL (tools/extract-map-data.mjs runs createMaps() in jsdom; unit tests use a fake renderer).
// Everything in here is loaded with dynamic import() only when a real WebGLRenderer is attached,
// so jsdom never evaluates a single line of the shader stack.
import * as THREE from 'three';

// User constraint: the machine is slow and performance is explicitly NOT a concern, but it must
// actually run. These are the smallest settings that still exercise every pass of the renderer.
export const VALLEY_QUALITY = Object.freeze({
  // 原版 painted-valley 是 1280。可走半径 = extent/2 - 110（原版 main.js 的 REACH），
  // 512 只能走 146 米、连 415 米外的水塘都到不了，所以地面烘焙范围必须跟着恢复。
  extent: 1280,         // metres of baked ground map (original 1280)
  extentRes: 1280,      // texels per side (original 1280)
  floorSize: 512,       // painted plain texture (was 1536)
  slopeRes: 256,        // ground-slope texture (was 512)
  strokesSize: 256,     // brush dab texture (was 512)
  cloudSize: 128,       // cube map face (was 2048)
  cloudSteps: 32,       // ray-march steps (was 240)
  cloudLive: true,      // redraw a strip a frame, so a drifting hour changes the clouds' light
  backdropWidth: 512,   // painted mountain strip (was 12288)
  backdropGround: 256,  // mountain height map (was 4096)
  cards: 0.6,           // near trees
  density: 0.35,        // grass blades
  samples: 0,           // no MSAA: the paint finish is a blur anyway, and this keeps depth-blit possible
  bloom: 0.1,
  paint: 1,             // Kuwahara radius; 0 turns the brush finish off
});

/** The fake renderer in tests and jsdom have no compileAsync/initTexture. */
export function canAttachValleyRenderer(renderer) {
  return !!renderer
    && typeof renderer.compileAsync === 'function'
    && typeof renderer.initTexture === 'function'
    && !!renderer.capabilities;
}

function slopeTexture(field, res, extent) {
  const data = new Uint8Array(res * res * 2);
  const step = extent / res;
  const byte = (s) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + s * 2)));
  for (let j = 0, k = 0; j < res; j++) {
    const z = -extent / 2 + (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const x = -extent / 2 + (i + 0.5) * step;
      data[k++] = byte((field.heightAt(x + 24, z) - field.heightAt(x - 24, z)) / 48);
      data[k++] = byte((field.heightAt(x, z + 24) - field.heightAt(x, z - 24)) / 48);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the whole valley renderer into `root`. Async because the ground is baked a few rows at a
 * time; the caller keeps a `ready` flag and falls back to the ordinary postfx until this resolves.
 */
export async function createValleyRenderer({ renderer, camera, root, quality = VALLEY_QUALITY, onProgress = () => {} }) {
  const [lib, skyMod, floorMod, strokesMod, treesMod, farwoodsMod, horizonMod, waterMod, worldMod, dressingMod] = await Promise.all([
    import('../painted/lib/index.js'),
    import('../painted/valley/sky.js'),
    import('../painted/valley/floor.js'),
    import('../painted/valley/strokes.js'),
    import('../painted/valley/trees.js'),
    import('../painted/valley/farwoods.js'),
    import('../painted/valley/horizon.js'),
    import('../painted/valley/water.js'),
    import('../painted/valley/world.js'),
    import('../painted/valley/dressing.js'),
  ]);
  const { bakeGround, createField, createFrame, loadGroundTextures } = lib;
  const { createSky, createSkyParts, SUNSET } = skyMod;
  const { heightAt, paint, HERO, START } = worldMod;

  onProgress(0.05, '正在绘制山谷');
  const GROUND = { extent: quality.extent, extentRes: quality.extentRes, centre: [0, 0] };
  const baked = await bakeGround({ heightAt, paint, ...GROUND });
  const textures = await loadGroundTextures(renderer, './textures/valley/');

  onProgress(0.35, '正在铺草地');
  const field = createField({
    heightAt, paint, ...GROUND,
    size: 128,
    baked,
    textures,
    density: quality.density,
    height: 0.5,
    seed: 3,
  });
  root.add(field.group);

  field.uniforms.tFloor.value = floorMod.createFloor(renderer, quality.floorSize, floorMod.paintFloor(quality.floorSize));
  field.uniforms.uFloor.value.set(HERO[0], HERO[1], floorMod.FLOOR.u0, floorMod.FLOOR.v0);
  field.uniforms.uFloorInv.value = 1 / floorMod.FLOOR.size;
  field.uniforms.tStrokes.value = strokesMod.createStrokes(renderer, quality.strokesSize);
  field.uniforms.tSlope.value = slopeTexture(field, quality.slopeRes, quality.extent);
  field.uniforms.uHeroEye.value.set(START[0], field.heightAt(START[0], START[1]) + 1.68, START[1]);

  onProgress(0.55, '正在画远山与云');
  const frame = createFrame(renderer, field, { samples: quality.samples, bloom: quality.bloom });
  frame.paint = quality.paint;
  const skyParts = createSkyParts(renderer, {
    cloudSize: quality.cloudSize,
    cloudSteps: quality.cloudSteps,
    liveClouds: quality.cloudLive,
    backdropWidth: quality.backdropWidth,
    backdropGround: quality.backdropGround,
  });
  // No await on compile()/gpuDone(): the shaders compile on their first draw. We explicitly do
  // not fence the GPU here — correctness is all this build needs.
  skyParts.backdrop.paint();
  const sky = createSky(renderer, field, { parts: skyParts });
  sky.setHour(15.5);

  onProgress(0.8, '正在种树与村庄');
  const trees = treesMod.createTrees(field, { cards: quality.cards });
  trees.cast(sky.sunDir);
  const farWoods = farwoodsMod.createFarWoods(field);
  // 原版走路上会撞到的石头：它们是真实几何，也是真实碰撞体（见 PaintedValley 的 colliders 合并）。
  const stones = dressingMod.createStones(field);
  root.add(
    sky.mesh,
    horizonMod.createHorizon(field, quality.extent / 2),
    trees.group,
    stones.group,
    farWoods.group,
    waterMod.createTarn(field, sky),
  );

  // The paint finish reads the scene's alpha channel: valley scenery is paintable (alpha 1),
  // everything else is tagged to a small alpha by frame.render() so actors stay cel-crisp.
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.userData.valley = true;
  });

  let castAt = sky.hour;
  const api = {
    ready: true,
    frame,
    field,
    sky,
    trees,
    stones,
    farWoods,
    skyParts,
    SUNSET,
    /** Hour 12..SUNSET. `soft` for a drift step (clouds take the new light a strip a frame). */
    setHour(hour, soft = false) {
      sky.setHour(hour, soft);
      if (Math.abs(hour - castAt) > 0.04) {
        trees.cast(sky.sunDir);
        castAt = hour;
      }
      return sky.exposure;
    },
    /** Keep the ordinary three.js lights (used by glb zombies / standard materials) on the hour. */
    syncLights(hemi, sun) {
      if (hemi) hemi.color.copy(field.uniforms.uSkyColor.value);
      if (sun) {
        sun.color.copy(field.uniforms.uSunColor.value);
        sun.position.copy(sky.sunDir).multiplyScalar(60);
      }
    },
    setWalker(x, z, dark = 1, length = 1) {
      field.uniforms.uWalker.value.set(x, z, dark, length);
    },
    update(dt, cam) {
      field.update(dt, cam);
      farWoods.update(dt, 4.5);
      frame.update(dt, cam);
      sky.update(dt, cam);
      frame.exposure = sky.exposure;
    },
    render(scene, cam) {
      frame.render(scene, cam);
    },
  };
  onProgress(1, '山谷就绪');
  return api;
}
