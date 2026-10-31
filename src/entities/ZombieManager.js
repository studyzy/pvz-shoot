import * as THREE from 'three';
import { Zombie } from './Zombie.js';
import { zombieModel } from './ZombieModel.js';
import { ZOMBIES, DUO, BOUNTY, FOREST, bossForWave, wavePlan, duoWavePlan, waveMaxAlive, waveSpawnInterval, waveAirQuota, zombieHpMul, zombieSpeedMul, SKELETON_MAX_ALIVE, SKELETON_MAPS } from '../config.js';
import { rand, clamp } from '../utils.js';

export class ZombieManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.zombies = [];
    this.wave = 0;
    this.queue = [];
    this.pendingSplits = [];
    this.state = 'idle';
    this.intermission = 0;
    this.spawnTimer = 0;
    this.groanTimer = rand(2, 5);
    this.boss = null;
    this.totalKills = 0;
    this.hpMul = 1;
    this.speedMul = 1;
    // 双人：只由 host 打开。数量/血量/Boss 血量/刷怪间隔/清波休整按 DUO 缩放。
    this.duo = false;
    // 双人悬赏怪：每波 1 只非 Boss，击杀 +300 个人分
    this.bountyPending = false;
    // 双人 M2：guest 侧只维护 host 快照的视图，不刷怪、不跑 AI、不结算。
    this.remote = false;
    this.nextNetId = 1;
    this.onNetSpawn = null;
    this.onNetDead = null;
    this.despawned = new Set();
  }

  setDuo(v) {
    this.duo = !!v;
  }

  setRemote(v) {
    this.remote = !!v;
    this.despawned.clear();
    if (this.remote) {
      this.state = 'idle';
      this.queue.length = 0;
      this.pendingSplits.length = 0;
    }
  }

  reset() {
    for (let i = 0; i < this.zombies.length; i++) {
      if (this.onNetDead) this.onNetDead(this.zombies[i]);
      this.zombies[i].dispose();
    }
    this.zombies.length = 0;
    this.queue.length = 0;
    this.pendingSplits.length = 0;
    this.despawned.clear();
    this.wave = 0;
    this.state = 'idle';
    this.intermission = 0;
    this.spawnTimer = 0;
    this.boss = null;
    this.totalKills = 0;
    this.bountyPending = false;
  }

  startWave(n) {
    if (this.remote) return;
    this.wave = n;
    const mapId = this.ctx.map && this.ctx.map.id;
    let plan = wavePlan(n, mapId);
    // 骷髅只在指定地图出现（雪地墓园氛围）。
    // 注意：这里只按地图过滤，**不要**在这里看模型是否加载好——glb 是异步的，
    // 开局很快时骨架还没 ready，在这里滤掉会让整波都刷不出骷髅（踩过）。
    // 模型未就绪的处理放在 spawnOne 里：把骷髅留在队首，等下次再刷。
    if (!SKELETON_MAPS.includes(mapId)) plan = plan.filter((t) => t !== 'skeleton');
    // 双人：非 Boss 数量 ×1.5（先按地图过滤再扩，否则骷髅会被扩到不该出现的图）
    this.queue = this.duo ? duoWavePlan(plan) : plan;
    this.hpMul = zombieHpMul(n) * (this.duo ? DUO.hpMul : 1);
    this.speedMul = zombieSpeedMul(n);
    this.spawnTimer = 0.35;
    this.state = 'spawning';
    this.maxAlive = this.duo ? Math.min(DUO.maxAlive, waveMaxAlive(n)) : waveMaxAlive(n);
    // 空中单位（气球）的同屏配额：14 只时 2 只。超出的留在队列里等死亡再刷。
    this.airQuota = waveAirQuota(n) + (this.duo ? DUO.airQuotaBonus : 0);
    this.interval = waveSpawnInterval(n) * (this.duo ? DUO.spawnIntervalMul : 1);
    // 第 2 波起，每波标记 1 只非 Boss 悬赏怪
    this.bountyPending = this.duo && n >= BOUNTY.fromWave;
    this.ctx.onWaveStart(n);
  }

  update(dt, player, colliders, targets) {
    if (this.remote) {
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
        z.update(dt, player, colliders);
        if (z.dead) {
          this.despawned.add(z.netId);
          if (this.boss === z) this.boss = null;
          z.dispose();
          this.zombies.splice(i, 1);
        }
      }
      return;
    }
    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && this.zombies.length < Math.min(14, this.maxAlive) && this.spawnTimer <= 0) {
        const spawned = this.spawnOne(player);
        // spawnOne 可能返回 null（骷髅超上限且队列里只剩骷髅），这时不重置计时，下个 tick 再试
        if (spawned) this.spawnTimer = this.interval * rand(0.75, 1.25);
      }
      if (this.queue.length === 0 && this.zombies.length === 0 && this.pendingSplits.length === 0) {
        this.state = 'intermission';
        this.intermission = this.ctx.map && this.ctx.map.id === 'forest'
          ? (bossForWave(this.wave) ? FOREST.bossIntermission : FOREST.intermission)
          : (this.duo ? DUO.intermission : 6.5);
        this.ctx.onWaveClear(this.wave);
      }
    } else if (this.state === 'intermission') {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
    }

    for (let i = 0; i < this.zombies.length; i++) {
      this.zombies[i].update(dt, targets || player, colliders);
    }

    this.applySeparation();

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      if (this.zombies[i].dead) {
        if (this.onNetDead) this.onNetDead(this.zombies[i]);
        this.zombies[i].dispose();
        this.zombies.splice(i, 1);
      }
    }

    this.spawnSplits();

    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = rand(2.6, 6.5);
      if (this.ctx.map && this.ctx.map.id === 'forest') {
        let nearest = null;
        let distance = FOREST.nearSound;
        for (const z of this.zombies) {
          if (!z.alive || z.dying) continue;
          const d = Math.hypot(z.root.position.x - player.pos.x, z.root.position.z - player.pos.z);
          if (d <= distance) { nearest = z; distance = d; }
        }
        if (nearest) {
          const dx = nearest.root.position.x - player.pos.x;
          const dz = nearest.root.position.z - player.pos.z;
          if (nearest.def.family && this.ctx.sfx.creature) {
            const yaw = player.yaw || 0;
            const pan = distance > 0 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance : 0;
            const volume = (nearest.def.boss ? 0.9 : 0.55) * (1 - distance / (FOREST.nearSound * 1.25));
            this.ctx.sfx.creature(nearest.def.family, volume, clamp(pan, -1, 1));
          } else {
            this.ctx.sfx.groan(nearest.def.boss ? 0.9 : 0.55, dx / 24);
          }
        }
      } else if (this.zombies.length > 0) {
        const z = this.zombies[Math.floor(Math.random() * this.zombies.length)];
        this.ctx.sfx.groan(z.def.boss ? 0.9 : 0.55, (z.root.position.x - player.pos.x) / 24);
      }
    }
  }

  skipIntermission() {
    if (this.remote || this.state !== 'intermission') return false;
    this.intermission = 0;
    this.startWave(this.wave + 1);
    return true;
  }

  forestSpawnPoint(type, player) {
    const map = this.ctx.map;
    const groups = map.zombieSpawnGroups || {};
    const opening = this.wave === 1 && map.openingSpawnPoints;
    const family = ZOMBIES[type].family || 'undead';
    const valid = (point, min, max) => {
      const [x, z] = point;
      const distance = Math.hypot(x - player.pos.x, z - player.pos.z);
      return distance >= min && distance <= max
        && (!map.bounds || (Math.abs(x) <= map.bounds.x - 1.2 && Math.abs(z) <= map.bounds.z - 1.2))
        && !(map.colliders || []).some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.05);
    };
    let candidates = opening ? opening.filter((p) => valid(p, 16, 22)) : [];
    if (!candidates.length) candidates = (groups[family] || []).filter((p) => valid(p, 10, 32));
    if (!candidates.length) {
      const points = Object.values(groups).flat().concat(map.zombieSpawnPoints || []);
      candidates = points.filter((p) => valid(p, 10, 32));
      if (!candidates.length) candidates = points.filter((p) => valid(p, 10, Infinity));
    }
    if (!candidates.length) return null;
    if (!opening) {
      const yaw = player.yaw || 0;
      const isSide = ([x, z]) => {
        const dx = x - player.pos.x, dz = z - player.pos.z;
        const distance = Math.hypot(dx, dz);
        return type === 'wolf'
          ? Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance >= 0.7
          : (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / distance < 0.65;
      };
      let side = candidates.filter(isSide);
      if (type === 'wolf' && !side.length) {
        side = Object.values(groups).flat().concat(map.zombieSpawnPoints || [])
          .filter((point) => valid(point, 10, 32) && isSide(point));
      }
      if (side.length) candidates = side;
    }
    return candidates[Math.floor(rand(0, candidates.length))];
  }

  spawnSplits() {
    for (let i = 0; i < this.pendingSplits.length && this.zombies.length < Math.min(14, this.maxAlive);) {
      const split = this.pendingSplits[i];
      if (this.zombies.includes(split.parent) || !this.modelReady(split.type)) { i++; continue; }
      const map = this.ctx.map;
      const safe = this.clearOfColliders(split.x, split.z, (map && map.colliders) || []);
      if (map && map.bounds) {
        safe.x = clamp(safe.x, -map.bounds.x + 1.2, map.bounds.x - 1.2);
        safe.z = clamp(safe.z, -map.bounds.z + 1.2, map.bounds.z - 1.2);
      }
      this.spawnAt(split.type, split.wave, safe.x, safe.z, split.hpMul, split.speedMul, split.source);
      this.pendingSplits.splice(i, 1);
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
    let skeletons = 0;
    for (const z of this.zombies) {
      if (z.type === 'skeleton' && z.alive && !z.dead) skeletons++;
    }
    const air = this.airborneCount();
    const index = this.queue.findIndex((type) => this.modelReady(type)
      && (type !== 'skeleton' || skeletons < SKELETON_MAX_ALIVE)
      && (!ZOMBIES[type].airborne || air < (this.airQuota || 1)));
    if (index === -1) return null;
    const type = this.queue[index];
    let x = 0;
    let z = 0;
    const map = this.ctx.map;
    const points = map && map.zombieSpawnPoints;
    const forestPoint = map && map.id === 'forest' && this.forestSpawnPoint(type, player);
    if (map && map.id === 'forest' && !forestPoint && (map.zombieSpawnGroups || points)) return null;
    this.queue.splice(index, 1);
    if (forestPoint) {
      [x, z] = forestPoint;
    } else if (points && points.length) {
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
    return this.spawnAt(type, this.wave, x, z,
      this.hpMul * (this.duo && ZOMBIES[type].boss ? DUO.bossHpMul : 1), this.speedMul);
  }

  spawnAt(type, wave, x, z, hpMul, speedMul, source = 0) {
    const zombie = new Zombie(type, wave, x, z, {
      scene: this.scene,
      map: this.ctx.map,
      zombies: this,
      // Zombie.buildRig 用它给身体材质挂 PMREM 环境反射；漏传会让身体 envMap 恒为 null（只有帽子有）
      env: this.ctx.env,
      particles: this.ctx.particles,
      sfx: this.ctx.sfx,
      onAttack: (z2) => this.ctx.onZombieAttack(z2),
    }, hpMul, speedMul);

    zombie.spawnHpMul = hpMul;
    zombie.spawnSpeedMul = speedMul;
    zombie.lastHitBy = source;
    this.zombies.push(zombie);
    zombie.netId = this.nextNetId++;
    if (this.bountyPending && !zombie.def.boss) {
      this.bountyPending = false;
      zombie.setBounty(true);
      this.ctx.hud.showBanner('悬赏出现：' + zombie.def.title + ' +' + BOUNTY.bonus + ' 分', 2);
    }
    if (this.onNetSpawn) this.onNetSpawn(zombie);

    if (zombie.def.boss) {
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
  damageArea(center, radius, damage, headTarget, headMul, source = 0) {
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
        const dead = z.hit(damage * falloff * (head ? headMul || 1 : 1), false, head, { type: 'explosion', source });
        z.stagger = 0.18;
        hits++;
        if (dead) this.handleKill(z, head);
      }
    }
    return hits;
  }

  // guest 侧：host 发来的 spawn / snapshot / dead。
  netSpawn(s) {
    if (!this.remote || !s || this.despawned.has(s.id)) return null;
    let z = this.zombies.find((x) => x.netId === s.id);
    if (!z) {
      z = new Zombie(s.t, this.wave || 1, s.x, s.z, {
        scene: this.scene,
        map: this.ctx.map,
        env: this.ctx.env,
        particles: this.ctx.particles,
        sfx: this.ctx.sfx,
        onAttack: () => {},
      }, 1, 1);
      z.remote = true;
      z.netId = s.id;
      this.zombies.push(z);
      if (z.def && z.def.boss) this.boss = z;
    }
    z.applyNetState(s);
    return z;
  }

  netSnapshot(list) {
    if (!this.remote || !Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) this.netSpawn(list[i]);
  }

  netDespawn(id) {
    if (!this.remote) return;
    this.despawned.add(id);
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      if (this.zombies[i].netId !== id) continue;
      if (this.boss === this.zombies[i]) this.boss = null;
      this.zombies[i].dispose();
      this.zombies.splice(i, 1);
    }
  }

  handleKill(z, headshot) {
    if (this.remote || z.counted) return;
    z.counted = true;
    this.totalKills++;
    const mult = headshot ? 1.5 : 1;
    const score = Math.round(z.scoreValue * mult);
    this.ctx.onKill(z, score, headshot, z.lastHitBy || 0);
    if (this.boss === z) {
      this.boss = null;
      this.ctx.onBossDead(z);
    }
    // 掉落数：优先读 def.sun（奇幻单位各自配好），老类型保留原来的三元链口径。
    const orbs =
      typeof z.def.sun === 'number'
        ? z.def.sun
        : z.def.boss
          ? 7
          : z.type === 'bucket'
            ? 3
            : z.type === 'skeleton'
              ? 3
              : z.type === 'football'
                ? 3
                : z.type === 'cone'
                  ? 2
                  : z.type === 'balloon'
                    ? 2
                    : 1;
    if (orbs > 0) this.ctx.sunOrbs.spawn(z.root.position.clone(), orbs);
    if (z.dying && z.def.split) {
      for (let i = 0; i < z.def.split.count; i++) {
        this.pendingSplits.push({
          parent: z, type: z.def.split.into, wave: z.wave,
          x: z.root.position.x + (i - (z.def.split.count - 1) / 2) * (z.radius + ZOMBIES[z.def.split.into].radius),
          z: z.root.position.z,
          hpMul: z.spawnHpMul, speedMul: z.spawnSpeedMul, source: z.lastHitBy || 0,
        });
      }
    }
  }

  airborneCount() {
    let n = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (z.def.airborne && !z.dying) n++;
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
