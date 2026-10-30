import * as THREE from 'three';
import { Zombie } from './Zombie.js';
import { zombieModel } from './ZombieModel.js';
import { ZOMBIES, wavePlan, waveMaxAlive, waveSpawnInterval, waveAirQuota, zombieHpMul, zombieSpeedMul, SKELETON_MAX_ALIVE, SKELETON_MAPS } from '../config.js';
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
    // 骷髅只在指定地图出现（雪地墓园氛围）。
    // 注意：这里只按地图过滤，**不要**在这里看模型是否加载好——glb 是异步的，
    // 开局很快时骨架还没 ready，在这里滤掉会让整波都刷不出骷髅（踩过）。
    // 模型未就绪的处理放在 spawnOne 里：把骷髅留在队首，等下次再刷。
    const mapId = this.ctx.map && this.ctx.map.id;
    if (!SKELETON_MAPS.includes(mapId)) this.queue = this.queue.filter((t) => t !== 'skeleton');
    this.hpMul = zombieHpMul(n);
    this.speedMul = zombieSpeedMul(n);
    this.spawnTimer = 0.35;
    this.state = 'spawning';
    this.maxAlive = waveMaxAlive(n);
    // 空中单位（气球）的同屏配额：14 只时 2 只。超出的留在队列里等死亡再刷。
    this.airQuota = waveAirQuota(n);
    this.interval = waveSpawnInterval(n);
    this.ctx.onWaveStart(n);
  }

  update(dt, player, colliders) {
    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && this.zombies.length < this.maxAlive && this.spawnTimer <= 0 && this.modelReady(this.queue[0])) {
        const spawned = this.spawnOne(player);
        // spawnOne 可能返回 null（骷髅超上限且队列里只剩骷髅），这时不重置计时，下个 tick 再试
        if (spawned) this.spawnTimer = this.interval * rand(0.75, 1.25);
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

  // 出生点被箱子/柱子这类圆形碰撞体压住时把落点推出去：僵尸一落地就在碰撞体里的话，
  // 第一帧会被 update 的推出逻辑弹开 1~2 米，Boss（radius 0.9）还可能被卡在箱子中间。
  clearOfColliders(x, z, colliders) {
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + 1.05;
        if (d >= min) continue;
        if (d < 0.0001) {
          x = c.x + min;
        } else {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  // 某种僵尸用的 glb 是否已就绪。模型按 ZOMBIES[type].model 分槽（不写就是 zombie.glb）：
  // 普通僵尸现在用 alchemist 模型，所以不能再只看 zombieModel.ready。
  modelReady(type) {
    const def = ZOMBIES[type];
    const id = (def && def.model) || 'zombie';
    if (id === 'zombie') return !!zombieModel.ready;
    const slot = zombieModel[id];
    return !!(slot && slot.ready);
  }

  spawnOne(player) {
    // 骷髅有两个额外条件，不满足时改刷别的类型、骷髅留在队列里下次再来：
    //   1) 同屏不超过 SKELETON_MAX_ALIVE（单只 9 个 skinned mesh，太贵）
    //   2) 骷髅 glb 已就绪（异步加载，开局很快时可能还没好，硬刷会白模）
    // Boss 也是骷髅模型，但它每波只有 1 只、不吃同屏上限，只等模型就绪。
    let type = this.queue[0];
    if (type === 'skeleton') {
      let alive = 0;
      for (let i = 0; i < this.zombies.length; i++) {
        if (this.zombies[i].type === 'skeleton' && this.zombies[i].alive && !this.zombies[i].dead) alive++;
      }
      const blocked = alive >= SKELETON_MAX_ALIVE || !this.modelReady(type);
      if (blocked) {
        const alt = this.queue.findIndex((t) => t !== 'skeleton' && t !== 'boss' && this.modelReady(t));
        if (alt === -1) return null; // 全是骷髅又不能刷：这波先不刷，等下个 tick 或前面的清掉
        type = this.queue.splice(alt, 1)[0];
      } else {
        type = this.queue.shift();
      }
    } else if (type === 'balloon' && this.airborneCount() >= (this.airQuota || 1)) {
      // 气球同屏配额：满了就换别的先刷，气球留在队首下次再来。
      // 不是为了「保底」（爆炸类武器本身就能打气球），而是为了别让整波阳光全拿去对付天上。
      const alt = this.queue.findIndex((t) => t !== 'balloon' && this.modelReady(t));
      if (alt === -1) return null;
      type = this.queue.splice(alt, 1)[0];
    } else if (!this.modelReady(type)) {
      // 任意类型（含 Boss）的 glb 还没就绪：换一个能刷的先上，它留在队首等下次。
      // 普通僵尸走的就是这条 —— 它用的是 alchemist.glb，比 zombie.glb 大，可能后到。
      const alt = this.queue.findIndex((t) => this.modelReady(t));
      if (alt === -1) return null;
      type = this.queue.splice(alt, 1)[0];
    } else {
      type = this.queue.shift();
    }
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
      if (map.colliders) {
        const safe = this.clearOfColliders(x, z, map.colliders);
        x = safe.x;
        z = safe.z;
        if (map.bounds) {
          x = clamp(x, -map.bounds.x + 1.2, map.bounds.x - 1.2);
          z = clamp(z, -map.bounds.z + 1.2, map.bounds.z - 1.2);
        }
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
      // Zombie.buildRig 用它给身体材质挂 PMREM 环境反射；漏传会让身体 envMap 恒为 null（只有帽子有）
      env: this.ctx.env,
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

  // headTarget + headMul：准星命中的那只吃爆头加成（Zombie.hit 自己会记爆头击杀）。
  // 距离用 3D 球距离：爆炸是球形的，气球浮在 2.2 米高空照样吃满伤（离地爆心只有约 1.3 米）；
  // 地面僵尸 y≈0，与爆心高度差约 0.9 米，仍在衰减区起点内，行为和原来的水平距离基本一致。
  damageArea(center, radius, damage, headTarget, headMul) {
    let hits = 0;
    const cy = center.y === undefined ? 0.9 : center.y;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive || z.dying) continue;
      const p = z.root.position;
      const d = Math.hypot(p.x - center.x, p.z - center.z, p.y + 0.9 * z.scaleFactor - cy);
      if (d < radius + z.radius) {
        const falloff = 1 - Math.min(1, Math.max(0, (d - radius * 0.35) / radius)) * 0.55;
        const head = z === headTarget;
        const dead = z.hit(damage * falloff * (head ? headMul || 1 : 1), false, head, { type: 'explosion' });
        z.stagger = 0.18;
        hits++;
        if (dead) this.handleKill(z, head);
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
    // 掉落数按耐打程度给：boss 7 颗 / 铁桶 3 / 骷髅 3（210 血，值得多掉）/ 路障 2 / 其它 1
    const orbs = z.type === 'boss' ? 7
      : z.type === 'bucket' ? 3
      : z.type === 'skeleton' ? 3
      : z.type === 'football' ? 3
      : z.type === 'cone' ? 2
      : z.type === 'balloon' ? 2
      : 1;
    this.ctx.sunOrbs.spawn(z.root.position.clone(), orbs);
  }

  airborneCount() {
    let n = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.airborne && !z.dying) n++;
    }
    return n;
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
