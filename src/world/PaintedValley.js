import * as THREE from 'three';
import { VALLEY_LAYOUT } from './valleyLayout.js';
// 纯函数高度场（无 three、无 DOM）：地形高度要给引擎的地面采样用，不能等 Renderer 就绪。
import { heightAt as valleyHeightAt, tarnDistance } from '../painted/valley/world.js';
import {
  VALLEY_START_HOUR, VALLEY_SUNSET, VALLEY_DRIFT, VALLEY_TIME,
  clampValleyHour, nextValleyTime, valleyTimeName,
} from './valleyHours.js';
import { createValleyRenderer, canAttachValleyRenderer, VALLEY_QUALITY } from './valleyRenderer.js';

/**
 * The eighth map: the painted-valley rendering stack running as its own frame pipeline.
 *
 * The constructor is deliberately WebGL-free. The renderer stack is imported and built lazily by
 * attachRenderer(), which Game calls with the real renderer; jsdom (extract:maps) and unit tests
 * (fake renderer) never reach it. Until the build resolves, valleyFrame is null and the game keeps
 * using the ordinary postfx pipeline as a fallback.
 */
export class PaintedValley {
  constructor(scene) {
    this.scene = scene;
    this.id = 'valley';
    this.name = '彩绘山谷';
    this.root = new THREE.Group();
    this.root.name = 'painted-valley';
    this.root.visible = false;
    scene.add(this.root);

    this.bounds = { ...VALLEY_LAYOUT.bounds };
    // 原版 walker 的行走半径是 extent/2 - 110；Player 用它做圆形边界（矩形 bounds 只给子弹/刷怪钳位）。
    this.reach = VALLEY_LAYOUT.reach;
    this.colliders = VALLEY_LAYOUT.colliders.map((c) => ({ ...c }));
    this.walls = VALLEY_LAYOUT.walls.map((w) => ({ ...w }));
    this.spawn = { ...VALLEY_LAYOUT.spawn };
    this.pickupSpots = VALLEY_LAYOUT.pickupSpots.map((s) => [...s]);
    // 真实地形高度（世界米）。Player / Zombie / 投射物 / 阳光 / 道具都读它来决定脚下的地面；
    // 没有这张表的地图仍旧是 y=0 平地。压平半径（28 m）在 world.js 里，出生点附近仍是平的。
    this.heightAt = valleyHeightAt;
    // 山谷可玩范围远比原来的 56 米方盘大，敌人必须围着玩家刷（按原点 ±21.5 的方框刷会让走远的人再也遇不到僵尸）。
    this.spawnAroundPlayer = true;
    // 原版不能涉水：走进水塘边缘会被推回（main.js 的 tarnDistance < 0.88 判定）。
    this.waterAt = (x, z) => tarnDistance(x, z) < 0.88;

    // The valley draws its own light/shadows in shaders, so a 1024 PCFSoft pass is wasted work.
    // Zombie.js:427 falls back to blob shadows on maps with noShadows.
    this.noShadows = true;
    // Village/mountains sit hundreds of metres out; the default 240 m far plane would clip them.
    this.cameraFar = 3000;
    this.cameraNear = 0.3;
    this.sunDir = new THREE.Vector3(0.6, 0.7, 0.3).normalize();

    this.hour = VALLEY_START_HOUR;
    this.drift = true;
    this._timeName = valleyTimeName(this.hour);
    this.onHourChange = null;

    this.valley = null;
    this._renderer = null;
    this._valleyCamera = null;
    this._building = null;

    // Ordinary three.js lights for the game's own meshes (glb zombies, weapons, pickups). The
    // vendored shaders read field.uniforms instead of these, but standard materials need them.
    this.hemi = new THREE.HemisphereLight(0xcdeaff, 0x5f8a34, 1.1);
    this.sunLight = new THREE.DirectionalLight(0xfff3d2, 2.2);
    this.sunLight.position.set(24, 32, 16);
    this.root.add(this.hemi, this.sunLight);
  }

  activate(scene) {
    scene.background = new THREE.Color(0x9fd0f0);
    // Far fog: the vendored shaders do their own haze, this is only for built-in materials.
    scene.fog = new THREE.Fog(0xcfe6f2, 200, 3000);
    this.root.visible = true;
  }

  menuCamera(camera, time) {
    const t = time * 0.06;
    const x = Math.sin(t) * 16;
    const z = -18 + Math.cos(t) * 4;
    camera.position.set(x, 5.5 + Math.sin(time * 0.21) * 0.6, z);
    camera.lookAt(0, 2.2, 0);
  }

  /** Called by Game.setMap. Idempotent, and a no-op on fake/jsdom renderers. */
  attachRenderer(renderer, camera, onProgress = () => {}) {
    if (this._renderer || !canAttachValleyRenderer(renderer)) return;
    this._renderer = renderer;
    this._valleyCamera = camera;
    this._building = createValleyRenderer({
      renderer,
      camera,
      root: this.root,
      quality: VALLEY_QUALITY,
      onProgress,
    }).then((v) => {
      this.valley = v;
      v.setHour(this.hour);
      v.syncLights(this.hemi, this.sunLight);
      this.sunDir.copy(v.sky.sunDir);
      return v;
    }).catch((e) => {
      // Keep the game playable: no valley frame means the postfx fallback stays in charge.
      console.error('[valley] renderer failed', e);
      this.valley = null;
    });
    return this._building;
  }

  /** Non-null only once the renderer stack is ready; Game.render branches on this. */
  get valleyFrame() {
    return this.valley;
  }

  get timeName() {
    return this._timeName;
  }

  setHour(hour, soft = false) {
    this.hour = clampValleyHour(hour);
    if (this.valley) {
      this.valley.setHour(this.hour, soft);
      this.valley.syncLights(this.hemi, this.sunLight);
      this.sunDir.copy(this.valley.sky.sunDir);
    }
    const name = valleyTimeName(this.hour);
    if (name !== this._timeName) {
      this._timeName = name;
      if (this.onHourChange) this.onHourChange(name);
    }
  }

  handleTimeRequest(req) {
    if (req === VALLEY_TIME.CYCLE) {
      this.drift = false;
      this.setHour(nextValleyTime(this.hour));
    } else if (req === VALLEY_TIME.DRIFT) {
      this.drift = true;
    } else if (req === VALLEY_TIME.EARLIER) {
      this.drift = false;
      this.setHour(this.hour - 0.25);
    } else if (req === VALLEY_TIME.LATER) {
      this.drift = false;
      this.setHour(this.hour + 0.25);
    }
  }

  /** The valley's own painted walker shadow; Game feeds the player's foot position. */
  setWalker(x, z) {
    if (this.valley) this.valley.setWalker(x, z, 1, 1.2);
  }

  update(dt) {
    if (this.drift && this.hour < VALLEY_SUNSET - 1e-4) {
      this.setHour(Math.min(VALLEY_SUNSET, this.hour + dt * VALLEY_DRIFT), true);
    }
    const v = this.valley;
    if (!v || !this._valleyCamera) return;
    v.update(dt, this._valleyCamera);
  }
}
