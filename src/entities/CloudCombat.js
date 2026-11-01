import * as THREE from 'three';
import { CLOUD, ZOMBIES, TUNING } from '../config.js';
import { segmentSphereT } from '../utils.js';
import { sweepWalls } from '../weapons/HitWalls.js';

const teaGeometry = new THREE.SphereGeometry(0.12, 8, 6);
const trailGeometry = new THREE.ConeGeometry(0.1, 0.65, 6);
const ringGeometry = new THREE.RingGeometry(0.98, 1.02, 64);
const orange = new THREE.MeshBasicMaterial({ color: 0xff7c31 });
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a36, side: THREE.DoubleSide,
  transparent: true, opacity: 0.75, depthWrite: false });
const a = new THREE.Vector3(), b = new THREE.Vector3(), center = new THREE.Vector3();
const normal = new THREE.Vector3();

export class CloudCombat {
  constructor(ctx) {
    this.ctx = ctx;
    this.cooldown = 0;
    this.nextId = 1;
    this.tea = Array.from({ length: CLOUD.teaMax }, () => {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(teaGeometry, orange));
      const trail = new THREE.Mesh(trailGeometry, orange);
      trail.rotation.x = Math.PI / 2;
      trail.position.z = 0.35;
      mesh.add(trail);
      mesh.visible = false;
      return { active: false, mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3() };
    });
    this.waves = Array.from({ length: CLOUD.waveMax }, () => {
      const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      return { active: false, mesh, hit: 0 };
    });
  }

  get enabled() { return this.ctx.map && this.ctx.map.id === 'cloud'; }
  get remote() { return !!(this.ctx.game && this.ctx.game.isGuestWorld()); }
  targets() {
    const guest = this.ctx.game && this.ctx.game.netGuest;
    return guest ? [this.ctx.player, guest] : [this.ctx.player];
  }

  reset() {
    this.cooldown = 0;
    this.nextId = 1;
    for (const p of [...this.tea, ...this.waves]) {
      p.active = false;
      p.owner = null;
      p.mesh.visible = false;
      p.mesh.removeFromParent();
    }
  }

  bellIntersection(from, to) {
    if (!this.enabled) return null;
    let hit = null;
    CLOUD.bell.positions.forEach(([x, z], id) => {
      center.set(x, CLOUD.bell.y, z);
      const t = from.distanceToSquared(center) <= CLOUD.bell.hitRadius ** 2 ? 0
        : segmentSphereT(from, to, center, CLOUD.bell.hitRadius);
      if (t >= 0 && (!hit || t < hit.t)) hit = { id, t };
    });
    return hit;
  }

  ringBell(id) {
    if (!this.enabled || this.remote || !Number.isInteger(id) || !CLOUD.bell.positions[id]) return false;
    const [x, z] = CLOUD.bell.positions[id];
    center.set(x, CLOUD.bell.y, z);
    const affected = this.ctx.zombies.zombies.filter((m) => m.def.family === 'toy' && m.alive &&
      !m.dying && !m.dead && m.root.position.distanceToSquared(center) <= CLOUD.bell.radius ** 2);
    const active = this.cooldown <= 0 && affected.length > 0;
    if (active) {
      this.cooldown = CLOUD.bell.cooldown;
      for (const m of affected) m.stopTimer = CLOUD.bell.duration;
    }
    this.ctx.map.bellHit(id, active);
    if (this.ctx.sfx && this.ctx.sfx.cloudBell) this.ctx.sfx.cloudBell(active);
    return active;
  }

  canStartAttack(z) {
    if (!this.enabled || this.remote) return false;
    const living = this.ctx.zombies.zombies.filter((m) => m !== z && m.alive && !m.dying && !m.dead);
    if (z.def.boss) return true;
    // 自己的圈还在扩散不算「撞车」：那一圈就是它自己放的，挡的是另一只兔子同时在放。
    if (this.waves.some((p) => p.active && p.owner !== z) || living.some((m) => m.def.clock &&
      ['ringTelegraph', 'ring', 'repeat'].includes(m.skillState))) return false;
    return living.filter((m) => !m.def.boss && (m.def.charge || m.def.flight) &&
      ['telegraph', 'charge', 'descent'].includes(m.skillState)).length < CLOUD.attackMax;
  }

  hasLineOfSight(z, target) {
    const d = z.def.tea;
    a.copy(z.root.position); a.y += d.height;
    b.copy(target.pos); b.y += TUNING.playerHeight * 0.6;
    const map = this.ctx.map;
    return sweepWalls(map.walls, map.bounds.x, map.bounds.z, a, b, 0, normal) < 0;
  }

  throwTea(z, target) {
    if (!this.enabled || this.remote) return false;
    const p = this.tea.find((item) => !item.active);
    if (!p) return false;
    const d = z.def.tea;
    p.active = true;
    p.id = this.nextId++;
    p.pos.copy(z.root.position); p.pos.y += d.height;
    p.target.copy(target);
    p.time = Math.max(0.15, Math.hypot(target.x - p.pos.x, target.z - p.pos.z) / d.speed);
    p.vel.set((target.x - p.pos.x) / p.time,
      (target.y - p.pos.y) / p.time + d.gravity * p.time / 2, (target.z - p.pos.z) / p.time);
    p.damage = z.def.damage;
    this.ctx.map.root.add(p.mesh);
    this.drawTea(p);
    return true;
  }

  drawTea(p) {
    p.mesh.visible = p.active;
    p.mesh.position.copy(p.pos);
    b.copy(p.pos).add(p.vel);
    p.mesh.lookAt(b);
  }

  emitWave(z) {
    if (!this.enabled || this.remote) return false;
    const p = this.waves.find((item) => !item.active);
    if (!p) return false;
    p.active = true;
    p.id = this.nextId++;
    p.owner = z;
    p.x = z.root.position.x; p.z = z.root.position.z;
    p.r = z.def.clock.startRadius;
    p.hit = 0;
    p.damage = z.def.clock.damage;
    this.ctx.map.root.add(p.mesh);
    this.drawWave(p);
    return true;
  }

  drawWave(p) {
    p.mesh.visible = p.active;
    p.mesh.position.set(p.x, 0.05, p.z);
    p.mesh.scale.setScalar(p.r);
  }

  update(dt) {
    if (!this.enabled || this.remote) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const map = this.ctx.map;
    const targets = this.targets();
    const teaDef = ZOMBIES.teaSprite.tea;
    for (const p of this.tea) {
      if (!p.active) continue;
      const step = Math.min(dt, p.time);
      a.copy(p.pos);
      b.copy(p.pos).addScaledVector(p.vel, step); b.y -= teaDef.gravity * step * step / 2;
      p.vel.y -= teaDef.gravity * step;
      p.time = Math.max(0, p.time - step);
      const wall = sweepWalls(map.walls, map.bounds.x, map.bounds.z, a, b, 0.12, normal);
      p.pos.copy(b);
      if (wall >= 0) p.active = false;
      else if (p.time <= 1e-8) {
        p.active = false;
        for (const t of targets) {
          if (t && !t.dead && !t.downed && t.pos.distanceTo(p.target) <= teaDef.radius) t.damage(p.damage, { airborne: false });
        }
      }
      this.drawTea(p);
    }
    const clock = ZOMBIES.clockRabbit.clock;
    for (const p of this.waves) {
      if (!p.active) continue;
      const prev = p.r;
      p.r = Math.min(clock.radius, p.r + dt * clock.speed);
      targets.forEach((t, seat) => {
        if (!t || t.dead || t.downed || p.hit & (1 << seat)) return;
        const distance = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
        if (distance < prev - clock.thickness || distance > p.r + clock.thickness) return;
        p.hit |= 1 << seat;
        const support = t.supportHeight(map.platforms, t.pos.x, t.pos.z, t.pos.y);
        if (t.pos.y - support <= clock.jumpHeight) t.damage(p.damage, { airborne: false });
      });
      if (p.r >= clock.radius) p.active = false;
      this.drawWave(p);
    }
  }

  serialize() {
    return { cooldown: this.cooldown,
      tea: this.tea.filter((p) => p.active).map((p) => ({ id: p.id,
        x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z,
        tx: p.target.x, ty: p.target.y, tz: p.target.z, time: p.time, damage: p.damage })),
      waves: this.waves.filter((p) => p.active).map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r,
        damage: p.damage, hit: p.hit })),
    };
  }

  applyNetState(state) {
    if (!this.enabled) return;
    this.cooldown = state.cooldown;
    this.tea.forEach((p, i) => {
      const s = state.tea[i];
      p.active = !!s;
      if (s) {
        p.id = s.id; p.damage = s.damage; p.time = s.time;
        p.pos.set(s.x, s.y, s.z); p.vel.set(s.vx, s.vy, s.vz); p.target.set(s.tx, s.ty, s.tz);
        this.ctx.map.root.add(p.mesh);
        this.drawTea(p);
      } else p.mesh.visible = false;
    });
    this.waves.forEach((p, i) => {
      const s = state.waves[i];
      p.active = !!s;
      if (s) {
        Object.assign(p, s);
        this.ctx.map.root.add(p.mesh);
        this.drawWave(p);
      } else p.mesh.visible = false;
    });
  }
}
