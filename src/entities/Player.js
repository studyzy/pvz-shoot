import * as THREE from 'three';
import { TUNING } from '../config.js';
import { clamp, damp } from '../utils.js';

const STEP_HEIGHT = 0.42;
// 空中水平加速度：与地面同量级，起跳不会吃掉水平速度（CS 里跑跳保留速度）。
const AIR_ACCEL = 12;
// 上升期容错：自然上升轨迹能到的高度还够得着平台顶面时，贴上侧面直接抬上去（CS 的「跳上箱子」）。
// 用自然轨迹峰值判定而不是「前 N% 上升段」：后者等于让玩家凭空多跳 0.42 米，1.42 米的箱子会被误判成能上。
const RISE_MARGIN = 0.02;
// 双人倒地时的镜头侧倾（弧度，约 14°）：只有自己 downed 的时候才生效。
const DOWN_ROLL = 0.24;

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
    // ---- M6：冲刺 / 下蹲 ----
    this.sprinting = false;
    this.crouching = false;
    this.stanceMul = 1;
    this.crouchT = 0;          // 0 = 站立，1 = 完全蹲下；平滑过渡用
    this.eyeHeight = TUNING.playerHeight;
    this.adsT = 0;             // 机瞄过渡 0~1
    this.cameraFov = 73;
    this.bob = 0;
    this.moveAmt = 0;
    this.lastLook = { x: 0, y: 0 };
    // 最近一帧的输入快照：双人 guest 用它组 30Hz input 包（look 是逐帧增量，必须每帧收集）。
    this.lastInput = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, jump: false };
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
    this.downed = false;
    this.downTimer = 0;
    this.stepTimer = 0;
    this.eye.set(this.pos.x, TUNING.playerHeight, this.pos.z);
  }

  addRecoil(amount) {
    this.recoil = Math.min(0.22, this.recoil + amount);
  }

  damage(amount, opts) {
    if (this.dead || this.downed || this.invuln > 0) return false;
    // 坚果墙免伤盾：伤害先落到盾上，玩家一点血不掉。
    // 必须在 invuln 判定**之后**（否则有盾时无敌帧逻辑就失效了），且**不重置 sinceDamage**
    // （否则「有盾」和「没盾」在回血计时上无法区分，站在盾里的玩家会永远回不了血）。
    if (this.shield && this.shield.absorb(amount, opts)) return false;
    this.hp -= amount;
    this.invuln = 0.32;
    this.sinceDamage = 0;
    if (this.onDamage) this.onDamage(amount);
    if (this.hp <= 0) {
      this.hp = 0;
      if (this.duoDown && !this.downed) {
        this.downed = true;
        this.downTimer = 30;
        return true;
      }
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
    return true;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // 当前移速倍率：坚果罩内的重甲惩罚（C2）× 冲刺/下蹲（M6）
  get speedMul() {
    const shieldMul = this.shield && this.shield.active ? this.shieldMoveMul || 1 : 1;
    return shieldMul * (this.stanceMul || 1);
  }

  // ---- M6：冲刺 / 下蹲 ----
  //
  // 为什么这两个值得做：现在的移动只有一个速度，玩家没有任何「表达」空间。
  // 冲刺让走位有风险收益（快但收枪、不能射击），下蹲让掩体有意义（矮一半、更难被打）。
  // 这是玩法层面的补完，不只是手感。

  // 每帧由 Game 调（拿到 controls 的意图与当前速度）
  updateStance(dt, controls) {
    const wantSprint = !!(controls && controls.sprinting) && this.grounded;
    // 冲刺要求有前进输入：原地按 Shift 不该「预备冲刺」
    const moving = !!(controls && (controls.move.y > 0.1 || controls.move.x !== 0));
    this.sprinting = wantSprint && moving && !this.crouching;
    this.crouchT = clamp(this.crouchT + (this.crouching ? dt : -dt) * 6, 0, 1);

    // 姿态倍率：冲刺 1.55，下蹲 0.45。用 crouchT 平滑过渡，避免速度突变。
    const sprintMul = this.sprinting ? 1.55 : 1;
    const crouchMul = 1 - 0.55 * this.crouchT;
    this.stanceMul = sprintMul * crouchMul;

    // 视高：下蹲时从 1.66 降到 1.05（差距要够大，才有「我在掩体后」的感觉）
    this.eyeHeight = TUNING.playerHeight * (1 - 0.37 * this.crouchT);
  }

  // 切换下蹲（Ctrl 是按住的语义，由 Controls 直接设 crouching）
  setCrouch(on) {
    if (this.dead || this.downed) return;
    this.crouching = !!on && this.grounded;
    if (this.crouching) this.sprinting = false;
  }

  revive(frac = 0.5) {
    this.downed = false;
    this.downTimer = 0;
    this.dead = false;
    this.hp = Math.max(1, Math.round(this.maxHp * frac));
    this.invuln = 3;
    this.sinceDamage = 0;
    this.roll = 0;
    this.eye.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt, controls, terrain, zombies) {
    if (this.dead) return;
    if (this.downed) {
      const look = controls.consumeLook();
      this.lastLook.x = look.x;
      this.lastLook.y = look.y;
      this.yaw -= look.x;
      this.pitch = clamp(this.pitch - look.y, -1.42, 1.42);
      controls.consumeJump();
      this.lastInput = { move: { x: 0, y: 0 }, look: { x: look.x, y: look.y }, jump: false };
      this.eye.set(this.pos.x, this.pos.y + 0.55, this.pos.z);
      // 倒地时镜头歪一点，配合压低的视线；revive 后直接归零。
      this.roll = DOWN_ROLL;
      if (this.mixer) this.mixer.update(dt);
      return;
    }
    let jumped = false;

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

    // 空中不再额外减速：原来空中的 4.5 会吃掉起跳瞬间的水平速度，跑跳距离只剩 3.4 米。
    const accel = this.grounded ? 15 : AIR_ACCEL;
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

    // playerColliders 是可选覆盖表：显式给了就只吃这一组（雪地/沙城把玩家碰撞交给 platforms，
// 只留空表给僵尸用），没给就回落到 colliders（后院/森林）。
    // 注意顺序：`[]` 是真值，所以"有没有这张表"要看它存不存在，不能看真假——
    // 森林漏写这一行以外的东西时曾经拿到空表，表现为整片树林都能直接穿过去。
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
    // 平台解算前消费一次跳跃请求，避免落地后重复起跳。
    const jumpRequested = controls.consumeJump();
    if (platforms) {
      const stepSupport = this.supportHeight(platforms, this.pos.x, this.pos.z, this.pos.y + STEP_HEIGHT);
      // 落地那一帧贴着矮台也要自动迈上去：沙城的 0.9 木箱紧挨 1.2 箱子，必须能两级走上去。
      if ((this.grounded || this.vy <= 0) && stepSupport > this.pos.y && stepSupport - this.pos.y <= STEP_HEIGHT + 0.01) {
        this.pos.y = stepSupport;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.pushOutOfPlatforms(platforms);
      }
      if (jumpRequested && this.grounded) {
        this.vy = TUNING.jumpSpeed;
        this.grounded = false;
        jumped = true;
      }
      // 上升段贴着平台侧面：直接把脚抬到顶面（CS 的「跳上箱子」手感）。
      // 少了这一步，人会被 pushOutOfPlatforms 一直挡在墙外，看起来就是「跳不上去」。
      if (!this.grounded && this.vy > 0) {
        const riseTo = this.pos.y + (this.vy * this.vy) / (2 * TUNING.gravity);
        const top = this.supportHeight(platforms, this.pos.x, this.pos.z, riseTo + RISE_MARGIN);
        if (top > this.pos.y) {
          this.pos.y = top;
          this.vy = 0;
          this.grounded = true;
        }
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
      if (jumpRequested && this.grounded) {
        this.vy = TUNING.jumpSpeed;
        this.grounded = false;
        jumped = true;
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
      // z.radius 已是世界空间半径（Zombie 碰撞推出、ZombieManager 分离/范围伤害都直接用它），
      // 这里再乘 scaleFactor 是二次缩放：Boss 推离半径变成 0.9×2.3+0.42=2.49 米，
      // 比它自己的攻击距离（1.15+2.3×0.55=2.415）还大 —— 玩家永远被推在攻击范围外，巨人僵尸咬不到人。
      const min = z.radius + TUNING.playerRadius;
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
    this.eye.set(this.pos.x, this.pos.y + this.eyeHeight + bobY, this.pos.z);

    // ---- M6：机瞄（ADS）----
    // 把 fov 从 73 收到 52 —— 这是「变焦」而不是「换个准星」：
    // 目标在屏幕上变大，远处僵尸头也点得动了。同时几乎关掉头部晃动（adsT 越高越稳）。
    const wantAds = !!(controls && controls.ads) && !this.sprinting && !this.dead;
    this.adsT = clamp(this.adsT + (wantAds ? dt : -dt) * 7, 0, 1);
    // 蹲下也会收一点视野（贴地看远处，视角本来就该更窄）
    const adsFov = 73 - 21 * this.adsT - 6 * this.crouchT;
    this.cameraFov = adsFov;

    this.lastInput = {
      move: { x: ix, y: iz },
      look: { x: look.x, y: look.y },
      jump: jumped,
    };
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
