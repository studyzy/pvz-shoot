import * as THREE from 'three';
import { glowTexture } from '../world/materials.js';
import { rand, TAU } from '../utils.js';
import { TUNING, SUN_SKY } from '../config.js';

// 池容量：击杀掉落 + 天降同屏，超时会自然回收，留足余量避免静默丢弃
const POOL = 28;
// 天降阳光的下落速度（m/s）：从 12 米落地约 2.4 秒，玩家有反应时间
const FALL_SPEED = 5;

export class SunOrbs {
  constructor(scene) {
    this.scene = scene;
    this.orbs = [];
    const geo = new THREE.SphereGeometry(0.17, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd83f, toneMapped: false });
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
      toneMapped: false,
    });

    for (let i = 0; i < POOL; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(geo, mat);
      group.add(core);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.25, 1.25, 1);
      group.add(glow);
      group.visible = false;
      scene.add(group);
      this.orbs.push({
        group,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        phase: rand(0, TAU),
        age: 0,
        magnet: false,
        sky: false,
      });
    }
    this.onCollect = null;
  }

  spawn(pos, count) {
    for (let n = 0; n < count; n++) {
      const orb = this.orbs.find((o) => !o.active);
      if (!orb) return;
      orb.active = true;
      orb.age = 0;
      orb.magnet = false;
      orb.pos.set(pos.x + rand(-0.4, 0.4), pos.y + rand(0.9, 1.5), pos.z + rand(-0.4, 0.4));
      orb.vel.set(rand(-1.2, 1.2), rand(2.4, 3.8), rand(-1.2, 1.2));
      orb.phase = rand(0, TAU);
      orb.group.visible = true;
      orb.group.position.copy(orb.pos);
    }
  }

  // 天降阳光：从高空缓缓落下，落地后转为普通待拾取状态
  spawnSky(x, z) {
    const orb = this.orbs.find((o) => !o.active);
    if (!orb) return null;
    orb.active = true;
    orb.age = 0;
    orb.magnet = false;
    orb.sky = true;
    orb.pos.set(x, SUN_SKY.height, z);
    orb.vel.set(0, -FALL_SPEED, 0);
    orb.phase = rand(0, TAU);
    orb.group.visible = true;
    orb.group.position.copy(orb.pos);
    return orb;
  }

  update(dt, player) {
    const px = player.pos.x;
    const pz = player.pos.z;
    const eyeY = player.pos.y + 1.2;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (!o.active) continue;
      o.age += dt;

      const dx = px - o.pos.x;
      const dz = pz - o.pos.z;
      const dy = eyeY - o.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // 天降球在空中不磁吸，必须落到地面后才会被吸走
      if (!o.sky && dist < TUNING.sunOrbMagnet) o.magnet = true;

      if (o.magnet) {
        const inv = 1 / Math.max(0.001, dist);
        const acc = 26;
        o.vel.x += dx * inv * acc * dt;
        o.vel.y += dy * inv * acc * dt;
        o.vel.z += dz * inv * acc * dt;
        o.vel.multiplyScalar(1 - Math.min(0.9, 3.4 * dt));
        if (dist < 0.85) {
          o.active = false;
          o.group.visible = false;
          o.sky = false;
          if (this.onCollect) this.onCollect(TUNING.sunPerOrb);
          continue;
        }
      } else if (o.sky) {
        // 天降阶段：匀速下落（速度由 spawnSky 设好，靠下面的 addScaledVector 积分），
        // 不弹跳、不受重力，落地后转为普通阳光
        o.vel.set(0, -FALL_SPEED, 0);
        if (o.pos.y <= 0.5) {
          o.pos.y = 0.5;
          o.vel.set(0, 0, 0);
          o.sky = false;
        }
      } else {
        o.vel.y -= 7.5 * dt;
        o.vel.x *= 1 - Math.min(0.9, 1.6 * dt);
        o.vel.z *= 1 - Math.min(0.9, 1.6 * dt);
        if (o.pos.y < 0.5) {
          o.pos.y = 0.5;
          o.vel.y = Math.abs(o.vel.y) * 0.34;
          if (o.vel.y < 0.4) o.vel.y = 0;
        }
      }

      o.pos.addScaledVector(o.vel, dt);
      if (o.pos.y < 0.4) o.pos.y = 0.4;

      o.phase += dt * 2.6;
      o.group.position.set(o.pos.x, o.pos.y + Math.sin(o.phase) * 0.09, o.pos.z);
      o.group.rotation.y += dt * 1.6;

      if (o.age > TUNING.sunOrbTtl) {
        o.active = false;
        o.sky = false;
        o.group.visible = false;
      }
    }
  }

  clear() {
    for (let i = 0; i < this.orbs.length; i++) {
      this.orbs[i].active = false;
      this.orbs[i].sky = false;
      this.orbs[i].group.visible = false;
    }
  }
}
