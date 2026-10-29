import * as THREE from 'three';
import { toon } from '../world/materials.js';
import { WEAPONS } from '../config.js';

const WALLNUT = WEAPONS.find((w) => w.id === 'wallnut');

// 破盾后的软弱无敌：防止「盾刚碎、同一波连击」把玩家瞬间打穿
const BREAK_INVULN = 0.35;
// 剩余盾血比例低于这个值开始闪烁
const FLASH_RATIO = 0.25;
// 破盾碎片的基数（按材质配色）
const FRAG_HEALTHY = [0xd9a85a, 0xc98c3e, 0x8a5b1c];
const FRAG_BROKEN = [0xc98c3e, 0x6b4310, 0x3a2408];

/**
 * 坚果墙 = 玩家身上的**免伤护盾状态**，不是场景里的实体。
 *
 * 语义：按坚果 → 脚下长出一颗坚果把自己罩住 → 罩内僵尸伤害全部打到盾上 → 盾血归零即碎。
 * 三条防无敌点的硬约束：
 *   C1 盾有血（400），同屏僵尸越多破得越快，所以它是「买 9~24 秒」而不是「无敌」
 *   C2 罩内移速 ×0.88，且每开一枪额外扣 1 点盾血，开盾站桩要付代价
 *   C3 气球（空中单位）从头顶俯冲，伤害穿透护盾
 */
export class WallNuts {
  constructor(ctx) {
    this.ctx = ctx;
    this.player = ctx.player;
    this.scene = ctx.scene;
    this.active = false;
    this.hp = 0;
    this.maxHp = WALLNUT.shieldHp;
    this.breakTimer = 0;
    this.flashT = 0;
    this.buildShell();
  }

  // 罩壳：一颗半透明的大坚果，把玩家包在里面。只在开盾时可见。
  buildShell() {
    const group = new THREE.Group();
    group.visible = false;
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0xc98c3e,
      roughness: 0.72,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      emissive: 0xffe0a0,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), this.shellMat);
    body.scale.set(0.92, 1.15, 0.92);
    body.position.y = 1.12;
    body.renderOrder = 2;
    group.add(body);
    // 坚果的褶子：两圈细环，让罩壳不像个普通泡泡
    const ringMat = toon(0xa8742c);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74 - i * 0.12, 0.02, 5, 26), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.86 + i * 0.56;
      ring.renderOrder = 2;
      group.add(ring);
    }
    this.shell = group;
    this.scene.add(group);
  }

  get ratio() {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }

  // 套盾：盾还有血时无效（不叠加、不刷新），由调用方播拒绝音
  raise() {
    if (this.active && this.hp > 0) return false;
    this.active = true;
    this.hp = this.maxHp;
    this.breakTimer = 0;
    this.shell.visible = true;
    this.applyColor();
    if (this.ctx.sfx && this.ctx.sfx.shieldUp) this.ctx.sfx.shieldUp();
    return true;
  }

  clear() {
    this.active = false;
    this.hp = 0;
    this.breakTimer = 0;
    if (this.shell) this.shell.visible = false;
  }

  /**
   * 伤害拦截：返回 true 表示这一下已经被盾吃掉（调用方不要扣玩家血）。
   * 注意调用位置必须在 Player.damage 的 invuln 判定之后、扣血之前，
   * 并且**不重置 sinceDamage**（否则「有盾」和「没盾」在回血计时上无法区分）。
   */
  absorb(amount) {
    if (!this.active || this.hp <= 0) return false;
    // C3：空中单位从头顶俯冲，护盾不挡
    if (this.airborneAttacker) return false;
    this.hp -= amount;
    this.flashT = 0.12;
    if (this.hp <= 0) {
      this.hp = 0;
      this.breakShield();
    }
    this.applyColor();
    return true;
  }

  // C2：开火消耗盾血。返回 true 表示盾被这一枪打碎了。
  spendShot() {
    if (!this.active || this.hp <= 0) return false;
    const cost = WALLNUT.shieldShotCost || 1;
    this.hp -= cost;
    if (this.hp <= 0) {
      this.hp = 0;
      this.breakShield();
      return true;
    }
    this.applyColor();
    return false;
  }

  breakShield() {
    this.active = false;
    this.breakTimer = BREAK_INVULN;
    this.shell.visible = false;
    const p = this.player.pos;
    this.ctx.particles.burst({
      pos: new THREE.Vector3(p.x, p.y + 1.1, p.z),
      color: FRAG_BROKEN,
      count: 22,
      speed: 4.2,
      size: 0.13,
      life: 0.8,
      gravity: 12,
    });
    if (this.ctx.sfx && this.ctx.sfx.shieldBreak) this.ctx.sfx.shieldBreak();
    this.ctx.hud.showBanner('坚果碎了!', 1.4);
  }

  // 盾壳颜色：满血绿 → 半血黄 → 残血红，并闪烁
  applyColor() {
    const r = this.ratio;
    const c = new THREE.Color();
    if (r > 0.5) c.setHex(0x8ed13a).lerp(new THREE.Color(0xd9c93a), (1 - r) * 2);
    else c.setHex(0xd9c93a).lerp(new THREE.Color(0xd94a2a), (0.5 - r) * 2);
    this.shellMat.color.copy(c);
  }

  update(dt) {
    if (this.breakTimer > 0) this.breakTimer -= dt;
    if (!this.active) return;
    this.flashT = Math.max(0, this.flashT - dt);
    const p = this.player.pos;
    // 罩壳钉在玩家脚下（跟着走），并随呼吸轻微缩放
    this.shell.position.set(p.x, p.y, p.z);
    this.flashT += 0;
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.012;
    const low = this.ratio <= FLASH_RATIO;
    const blink = low ? 0.62 + Math.abs(Math.sin(performance.now() * 0.014)) * 0.38 : 1;
    this.shell.scale.setScalar(pulse);
    // 被咬的瞬间亮一下，给「盾在挨打」的即时反馈
    this.shellMat.emissiveIntensity = 0.15 + this.flashT * 5;
    this.shellMat.opacity = 0.42 * blink;
  }

  dispose() {
    this.shell.parent && this.shell.parent.remove(this.shell);
  }
}

export const WALLNUT_DEF = WALLNUT;
export const WALLNUT_FRAG_HEALTHY = FRAG_HEALTHY;
export { BREAK_INVULN, FLASH_RATIO };