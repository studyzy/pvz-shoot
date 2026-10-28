import * as THREE from 'three';
import { glowTexture } from '../world/materials.js';
import { rand, TAU } from '../utils.js';

const POOL = 18;

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

      if (dist < 4.6) o.magnet = true;

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
          if (this.onCollect) this.onCollect(5);
          continue;
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

      if (o.age > 32) {
        o.active = false;
        o.group.visible = false;
      }
    }
  }

  clear() {
    for (let i = 0; i < this.orbs.length; i++) {
      this.orbs[i].active = false;
      this.orbs[i].group.visible = false;
    }
  }
}
