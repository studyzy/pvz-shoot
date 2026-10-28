import * as THREE from 'three';
import { rand, TAU } from '../utils.js';

const MAX = 280;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

export class Particles {
  constructor(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this.items = [];
    for (let i = 0; i < MAX; i++) {
      this.items.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.1,
        gravity: 0,
        drag: 0,
        rot: new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)),
        spin: rand(-8, 8),
      });
      this.mesh.setColorAt(i, tmpColor.setHex(0xffffff));
      dummy.position.set(0, -1000, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.cursor = 0;

    // explosion shells
    this.shells = [];
    const shellGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
        color: 0xffb04a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }));
      m.visible = false;
      scene.add(m);
      this.shells.push({ mesh: m, t: 0, dur: 0.32, radius: 1, active: false });
    }

    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.66, 1, 36);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffc463,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0.45, radius: 1, active: false });
    }

    this.flash = new THREE.PointLight(0xffb050, 0, 12, 2);
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTime = 0;
  }

  burst(opts) {
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color];
    const count = opts.count || 8;
    const speed = opts.speed || 3;
    const life = opts.life || 0.6;
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      const p = this.items[idx];
      this.cursor = (this.cursor + 1) % MAX;
      p.active = true;
      p.pos.copy(opts.pos);
      const a = rand(0, TAU);
      const elev = rand(-0.25, 1.15);
      const sp = speed * rand(0.35, 1);
      const ch = Math.cos(elev);
      p.vel.set(Math.cos(a) * ch * sp, Math.sin(elev) * sp + (opts.up || 0), Math.sin(a) * ch * sp);
      p.life = life * rand(0.7, 1.25);
      p.maxLife = p.life;
      p.size = (opts.size || 0.12) * rand(0.6, 1.5);
      p.gravity = opts.gravity === undefined ? 7 : opts.gravity;
      p.drag = opts.drag === undefined ? 1.2 : opts.drag;
      p.spin = rand(-9, 9);
      tmpColor.setHex(colors[Math.floor(Math.random() * colors.length)]);
      this.mesh.setColorAt(idx, tmpColor);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  explosion(pos, radius) {
    this.burst({
      pos,
      color: [0xffd24a, 0xff8a2a, 0xfff0b0, 0xe8452f],
      count: 22,
      speed: radius * 2.2,
      size: 0.17,
      life: 0.6,
      gravity: 6,
      drag: 3.4,
      up: 1.4,
    });
    this.burst({
      pos,
      color: [0x575744, 0x6f6f58],
      count: 9,
      speed: radius * 0.9,
      size: 0.26,
      life: 1.0,
      gravity: -1.2,
      drag: 2.4,
      up: 1.8,
    });

    const shell = this.shells.find((s) => !s.active) || this.shells[0];
    shell.active = true;
    shell.t = 0;
    shell.radius = radius;
    shell.mesh.position.copy(pos);
    shell.mesh.scale.setScalar(0.3);
    shell.mesh.material.opacity = 0.55;
    shell.mesh.visible = true;

    const ring = this.rings.find((r) => !r.active) || this.rings[0];
    ring.active = true;
    ring.t = 0;
    ring.radius = radius;
    ring.mesh.position.set(pos.x, 0.08, pos.z);
    ring.mesh.scale.setScalar(0.3);
    ring.mesh.material.opacity = 0.7;
    ring.mesh.visible = true;

    this.flash.position.copy(pos);
    this.flash.position.y += 1.2;
    this.flash.intensity = 26;
    this.flash.visible = true;
    this.flashTime = 0.18;
  }

  muzzle(pos, color) {
    this.burst({
      pos,
      color: [color, 0xffffff],
      count: 5,
      speed: 4,
      size: 0.07,
      life: 0.18,
      gravity: 1,
      drag: 5,
    });
  }

  splat(pos, color) {
    this.burst({
      pos,
      color: [color, 0xffffff],
      count: 6,
      speed: 3.4,
      size: 0.075,
      life: 0.32,
      gravity: 9,
      drag: 2,
    });
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        dummy.position.set(0, -1000, 0);
        dummy.scale.setScalar(0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      const d = 1 - Math.min(0.95, p.drag * dt);
      p.vel.x *= d;
      p.vel.z *= d;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.05) {
        p.pos.y = 0.05;
        p.vel.y *= -0.32;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.rot.x += p.spin * dt;
      p.rot.y += p.spin * 0.6 * dt;
      const k = p.life / p.maxLife;
      const s = p.size * (0.35 + 0.65 * k);
      dummy.position.copy(p.pos);
      dummy.rotation.copy(p.rot);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (!s.active) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = 1 - Math.pow(1 - k, 2.4);
      s.mesh.scale.setScalar(0.3 + e * s.radius * 0.82);
      s.mesh.material.opacity = 0.55 * (1 - k) * (1 - k);
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
      }
    }

    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - Math.pow(1 - k, 2);
      r.mesh.scale.setScalar(0.3 + e * r.radius);
      r.mesh.material.opacity = 0.45 * (1 - k);
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flash.intensity = Math.max(0, this.flashTime / 0.18) * 26;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
  }

  clear() {
    for (let i = 0; i < MAX; i++) {
      this.items[i].active = false;
      dummy.position.set(0, -1000, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.shells.length; i++) {
      this.shells[i].active = false;
      this.shells[i].mesh.visible = false;
    }
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].active = false;
      this.rings[i].mesh.visible = false;
    }
    this.flash.visible = false;
    this.flashTime = 0;
  }
}
