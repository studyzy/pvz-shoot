import * as THREE from 'three';
import { TUNING } from '../config.js';
import { clamp, damp } from '../utils.js';

const STEP_HEIGHT = 0.42;

export class Player {
  constructor(sfx) {
    this.sfx = sfx;
    this.pos = new THREE.Vector3(0, 0, TUNING.startZ);
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.recoil = 0;
    this.vy = 0;
    this.grounded = true;
    this.bob = 0;
    this.moveAmt = 0;
    this.lastLook = { x: 0, y: 0 };
    this.hp = TUNING.maxHealth;
    this.maxHp = TUNING.maxHealth;
    this.invuln = 0;
    this.sinceDamage = 99;
    this.dead = false;
    this.stepTimer = 0;
    this.onDamage = null;
    this.onDeath = null;
  }

  reset(spawn) {
    const s = spawn || { x: 0, z: TUNING.startZ, yaw: 0 };
    this.pos.set(s.x ?? 0, 0, s.z ?? TUNING.startZ);
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw ?? 0;
    this.pitch = 0;
    this.roll = 0;
    this.recoil = 0;
    this.vy = 0;
    this.grounded = true;
    this.bob = 0;
    this.moveAmt = 0;
    this.hp = this.maxHp;
    this.invuln = 0;
    this.sinceDamage = 99;
    this.dead = false;
    this.stepTimer = 0;
    this.eye.set(this.pos.x, TUNING.playerHeight, this.pos.z);
  }

  addRecoil(amount) {
    this.recoil = Math.min(0.22, this.recoil + amount);
  }

  damage(amount) {
    if (this.dead || this.invuln > 0) return false;
    // 坚果墙免伤盾：伤害先落到盾上，玩家一点血不掉。
    // 必须在 invuln 判定**之后**（否则有盾时无敌帧逻辑就失效了），且**不重置 sinceDamage**
    // （否则「有盾」和「没盾」在回血计时上无法区分，站在盾里的玩家会永远回不了血）。
    if (this.shield && this.shield.absorb(amount)) return false;
    this.hp -= amount;
    this.invuln = 0.32;
    this.sinceDamage = 0;
    if (this.onDamage) this.onDamage(amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
    return true;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // 当前移速倍率：坚果罩内的重甲惩罚（C2）
  get speedMul() {
    return this.shield && this.shield.active ? this.shieldMoveMul || 1 : 1;
  }

  update(dt, controls, terrain, zombies) {
    if (this.dead) return;

    const look = controls.consumeLook();
    this.lastLook.x = look.x;
    this.lastLook.y = look.y;
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch - look.y, -1.42, 1.42);

    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceDamage += dt;
    if (this.sinceDamage > TUNING.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + TUNING.regenRate * dt);
    }

    let ix = controls.move.x;
    let iz = controls.move.y;
    const inLen = Math.hypot(ix, iz);
    if (inLen > 1) {
      ix /= inLen;
      iz /= inLen;
    }
    this.moveAmt = Math.min(1, Math.hypot(ix, iz));

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    const wishX = fx * iz + rx * ix;
    const wishZ = fz * iz + rz * ix;

    const accel = this.grounded ? 15 : 4.5;
    // speedMul：坚果罩内的重甲惩罚（≥ 1 是常态，护盾生效时 < 1）
    const walkSpeed = TUNING.playerSpeed * this.speedMul;
    const targetX = wishX * walkSpeed;
    const targetZ = wishZ * walkSpeed;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (targetX - this.vel.x) * k;
    this.vel.z += (targetZ - this.vel.z) * k;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    const platforms = terrain && terrain.platforms ? terrain.platforms : null;
    const bounds = (terrain && terrain.bounds) || { x: TUNING.arenaHalf, z: TUNING.arenaHalf };
    const halfX = bounds.x - 0.55;
    const halfZ = bounds.z - 0.55;
    this.pos.x = clamp(this.pos.x, -halfX, halfX);
    this.pos.z = clamp(this.pos.z, -halfZ, halfZ);

    const colliders = (terrain && (terrain.playerColliders || terrain.colliders)) || [];
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + TUNING.playerRadius;
      if (d < min && d > 0.0001) {
        const push = (min - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }
    if (platforms) this.pushOutOfPlatforms(platforms);

    if (platforms) {
      const stepSupport = this.supportHeight(platforms, this.pos.x, this.pos.z, this.pos.y + STEP_HEIGHT);
      if (this.grounded && stepSupport > this.pos.y && stepSupport - this.pos.y <= STEP_HEIGHT + 0.01) {
        this.pos.y = stepSupport;
      }
      if (controls.consumeJump() && this.grounded) {
        this.vy = TUNING.jumpSpeed;
        this.grounded = false;
      }
      const support = this.supportHeight(platforms, this.pos.x, this.pos.z, this.pos.y);
      this.vy -= TUNING.gravity * dt;
      const nextY = this.pos.y + this.vy * dt;
      if (nextY <= support) {
        this.pos.y = support;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.pos.y = nextY;
        this.grounded = false;
      }
    } else {
      if (controls.consumeJump() && this.grounded) {
        this.vy = TUNING.jumpSpeed;
        this.grounded = false;
      }
      this.vy -= TUNING.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.grounded = true;
      }
    }

    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (z.dying || z.dead) continue;
      const dx = this.pos.x - z.root.position.x;
      const dz = this.pos.z - z.root.position.z;
      const d = Math.hypot(dx, dz);
      const min = z.radius * z.scaleFactor + TUNING.playerRadius;
      if (d < min && d > 0.0001) {
        const push = (min - d) / d;
        this.pos.x += dx * push * 0.85;
        this.pos.z += dz * push * 0.85;
      }
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speed > 0.4) {
      this.bob += dt * (4.6 + speed * 1.15);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = clamp(0.46 - speed * 0.012, 0.3, 0.5);
        if (this.sfx && this.sfx.step) this.sfx.step();
      }
    } else if (this.grounded) {
      this.stepTimer = 0.15;
    }

    this.recoil *= Math.exp(-dt * 9);
    const localStrafe = this.vel.x * cos + this.vel.z * -sin;
    this.roll = damp(this.roll, clamp(-localStrafe * 0.009, -0.05, 0.05), 7, dt);

    const bobY = this.grounded ? Math.abs(Math.sin(this.bob)) * 0.045 * this.moveAmt : 0;
    this.eye.set(this.pos.x, this.pos.y + TUNING.playerHeight + bobY, this.pos.z);
  }

  supportHeight(platforms, x, z, feetY) {
    let support = 0;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.h > feetY + 0.02) continue;
      if (
        x >= p.x - p.w * 0.5 &&
        x <= p.x + p.w * 0.5 &&
        z >= p.z - p.d * 0.5 &&
        z <= p.z + p.d * 0.5
      ) {
        if (p.h > support) support = p.h;
      }
    }
    return support;
  }

  pushOutOfPlatforms(platforms) {
    const r = TUNING.playerRadius;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const aboveTop = this.pos.y >= p.h - 0.02;
      const canStep = this.grounded && p.h - this.pos.y <= STEP_HEIGHT;
      if (aboveTop || canStep) continue;
      const hw = p.w * 0.5 + r;
      const hd = p.d * 0.5 + r;
      const dx = this.pos.x - p.x;
      const dz = this.pos.z - p.z;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
      const px = hw - Math.abs(dx);
      const pz = hd - Math.abs(dz);
      if (px < pz) this.pos.x += (dx < 0 ? -1 : 1) * px;
      else this.pos.z += (dz < 0 ? -1 : 1) * pz;
    }
  }

  applyCamera(camera) {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const sway = this.grounded ? Math.sin(this.bob) * 0.03 * this.moveAmt : 0;
    camera.position.set(this.eye.x + cos * sway, this.eye.y, this.eye.z - sin * sway);
    camera.rotation.set(this.pitch + this.recoil, this.yaw, this.roll);
  }
}
