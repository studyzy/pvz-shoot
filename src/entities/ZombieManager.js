import * as THREE from 'three';
import { Zombie } from './Zombie.js';
import { zombieModel } from './ZombieModel.js';
import { wavePlan, waveMaxAlive, waveSpawnInterval, zombieHpMul, zombieSpeedMul } from '../config.js';
import { rand, clamp } from '../utils.js';

export class ZombieManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.zombies = [];
    this.wave = 0;
    this.queue = [];
    this.state = 'idle';
    this.intermission = 0;
    this.spawnTimer = 0;
    this.groanTimer = rand(2, 5);
    this.boss = null;
    this.totalKills = 0;
    this.hpMul = 1;
    this.speedMul = 1;
  }

  reset() {
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].dispose();
    this.zombies.length = 0;
    this.queue.length = 0;
    this.wave = 0;
    this.state = 'idle';
    this.intermission = 0;
    this.spawnTimer = 0;
    this.boss = null;
    this.totalKills = 0;
  }

  startWave(n) {
    this.wave = n;
    this.queue = wavePlan(n);
    this.hpMul = zombieHpMul(n);
    this.speedMul = zombieSpeedMul(n);
    this.spawnTimer = 0.35;
    this.state = 'spawning';
    this.maxAlive = waveMaxAlive(n);
    this.interval = waveSpawnInterval(n);
    this.ctx.onWaveStart(n);
  }

  update(dt, player, colliders) {
    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && this.zombies.length < this.maxAlive && this.spawnTimer <= 0 && zombieModel.ready) {
        this.spawnOne(player);
        this.spawnTimer = this.interval * rand(0.75, 1.25);
      }
      if (this.queue.length === 0 && this.zombies.length === 0) {
        this.state = 'intermission';
        this.intermission = 6.5;
        this.ctx.onWaveClear(this.wave);
      }
    } else if (this.state === 'intermission') {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
    }

    for (let i = 0; i < this.zombies.length; i++) {
      this.zombies[i].update(dt, player, colliders);
    }

    this.applySeparation();

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      if (this.zombies[i].dead) {
        this.zombies[i].dispose();
        this.zombies.splice(i, 1);
      }
    }

    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = rand(2.6, 6.5);
      if (this.zombies.length > 0) {
        const z = this.zombies[Math.floor(Math.random() * this.zombies.length)];
        this.ctx.sfx.groan(z.type === 'boss' ? 0.9 : 0.55, (z.root.position.x - player.pos.x) / 24);
      }
    }
  }

  applySeparation() {
    const list = this.zombies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dying) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dying) continue;
        const dx = b.root.position.x - a.root.position.x;
        const dz = b.root.position.z - a.root.position.z;
        const d = Math.hypot(dx, dz);
        const min = (a.radius + b.radius) * 0.95;
        if (d < min && d > 0.0001) {
          const p = (min - d) / d * 0.5;
          a.root.position.x -= dx * p;
          a.root.position.z -= dz * p;
          b.root.position.x += dx * p;
          b.root.position.z += dz * p;
        }
      }
    }
  }

  spawnOne(player) {
    const type = this.queue.shift();
    let x = 0;
    let z = 0;
    const map = this.ctx.map;
    const points = map && map.zombieSpawnPoints;
    if (points && points.length) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const p = points[Math.floor(rand(0, points.length))];
        x = p[0] + rand(-1.6, 1.6);
        z = p[1] + rand(-1.6, 1.6);
        if (Math.hypot(x - player.pos.x, z - player.pos.z) > 12) break;
      }
      if (map.bounds) {
        x = clamp(x, -map.bounds.x + 1.2, map.bounds.x - 1.2);
        z = clamp(z, -map.bounds.z + 1.2, map.bounds.z - 1.2);
      }
    } else {
      for (let attempt = 0; attempt < 14; attempt++) {
        const side = Math.floor(rand(0, 4));
        const t = rand(-21.5, 21.5);
        if (side === 0) { x = t; z = -21.5; }
        else if (side === 1) { x = t; z = 21.5; }
        else if (side === 2) { x = -21.5; z = t; }
        else { x = 21.5; z = t; }
        if (Math.hypot(x - player.pos.x, z - player.pos.z) > 14) break;
      }
    }
    const zombie = new Zombie(type, this.wave, x, z, {
      scene: this.scene,
      map: this.ctx.map,
      particles: this.ctx.particles,
      sfx: this.ctx.sfx,
      onAttack: (z2) => this.ctx.onZombieAttack(z2),
    }, this.hpMul, this.speedMul);

    this.zombies.push(zombie);

    if (type === 'boss') {
      this.boss = zombie;
      this.ctx.onBossSpawn(zombie);
    }

    this.ctx.particles.burst({
      pos: new THREE.Vector3(x, 0.2, z),
      color: [0x6b4a2c, 0x8a6238, 0x53702c],
      count: 14,
      speed: 3.4,
      size: 0.16,
      life: 0.7,
      gravity: 8,
      up: 1.2,
    });
    this.ctx.sfx.dirt();
    return zombie;
  }

  damageArea(center, radius, damage) {
    let hits = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive || z.dying) continue;
      const p = z.root.position;
      const d = Math.hypot(p.x - center.x, p.z - center.z);
      if (d < radius + z.radius) {
        const falloff = 1 - Math.min(1, Math.max(0, (d - radius * 0.35) / radius)) * 0.55;
        const dead = z.hit(damage * falloff, false);
        z.stagger = 0.18;
        hits++;
        if (dead) this.handleKill(z, false);
      }
    }
    return hits;
  }

  handleKill(z, headshot) {
    if (z.counted) return;
    z.counted = true;
    this.totalKills++;
    const mult = headshot ? 1.5 : 1;
    const score = Math.round(z.scoreValue * mult);
    this.ctx.onKill(z, score, headshot);
    if (this.boss === z) {
      this.boss = null;
      this.ctx.onBossDead();
    }
    const orbs = z.type === 'boss' ? 7 : z.type === 'bucket' ? 3 : z.type === 'cone' ? 2 : 1;
    this.ctx.sunOrbs.spawn(z.root.position.clone(), orbs);
  }

  aliveCount() {
    let n = 0;
    for (let i = 0; i < this.zombies.length; i++) if (!this.zombies[i].dying) n++;
    return n;
  }

  nearestTo(point, maxDist) {
    let best = null;
    let bd = maxDist;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive || z.dying) continue;
      const d = Math.hypot(z.root.position.x - point.x, z.root.position.z - point.z);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
}
