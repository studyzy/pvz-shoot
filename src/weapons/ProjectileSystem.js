import * as THREE from 'three';
import { segmentSphereT } from '../utils.js';
import { TUNING } from '../config.js';
import { sweepWalls, bounceVel } from './HitWalls.js';

const PEA_RADIUS = 0.13;
const CHERRY_RADIUS = 0.17;

const PEA_POOL = 64;
// 命中球半径（米，乘体型系数）：头部球直径必须压到头部真实体积；比身体球还大的话准星在身体/头部交界处
// 必然先碰到头部球，爆头会变成“打哪儿都爆头”。
const HEAD_R = 0.36;
const CHEST_R = 0.46;
const CHERRY_POOL = 5;
const tmpChest = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const noWalls = [];

export class ProjectileSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.zombies = ctx.zombies;
    this.particles = ctx.particles;
    this.sfx = ctx.sfx;

    const peaGeo = new THREE.SphereGeometry(0.125, 8, 6);
    this.peaMatCache = new Map();
    const defaultPeaMat = this.peaMaterial(0x9bf227);
    this.peas = [];
    for (let i = 0; i < PEA_POOL; i++) {
      const mesh = new THREE.Mesh(peaGeo, defaultPeaMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.peas.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        damage: 0,
        slow: false,
        headshot: false,
        type: 'pea',
        life: 0,
        pierce: 0,
        hits: new Set(),
      });
    }

    this.cherries = [];
    for (let i = 0; i < CHERRY_POOL; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshToonMaterial({ color: 0xe8452f, emissive: 0x5a0c05, emissiveIntensity: 0.5 });
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat);
      a.position.set(-0.09, 0, 0);
      b.position.set(0.1, 0.05, 0.04);
      g.add(a);
      g.add(b);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 5), new THREE.MeshToonMaterial({ color: 0x4f9c26 }));
      stem.position.set(0.02, 0.2, 0);
      stem.rotation.z = 0.5;
      g.add(stem);
      g.visible = false;
      this.scene.add(g);
      this.cherries.push({
        group: g,
        mat,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        damage: 0,
        radius: 5,
        life: 0,
        fuse: 0,
        ground: 0.25,
        proximityY: 2.4,
        gravity: 15,
        maxRange: 0,
        origin: new THREE.Vector3(),
        bounced: false,
      });
    }
  }

  spawnPea(origin, dir, def, headshot) {
    const p = this.peas.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.pos.copy(origin);
    p.prev.copy(origin);
    p.vel.copy(dir).multiplyScalar(def.speed);
    p.damage = def.damage;
    // 瞄准辅助把弹道度数补偿到头部时打上标记：这一发第一个命中的僵尸直接吃爆头伤害。
    p.headshot = !!headshot;
    p.slow = !!def.slow;
    p.type = def.id;
    p.life = 1.6;
    p.pierce = def.pierce || 0;
    p.hits.clear();
    p.mesh.material = this.peaMaterial(def.color);
    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    p.mesh.scale.setScalar(def.pierce ? 1.05 : def.slow ? 1.15 : 1);
  }

  peaMaterial(color) {
    const key = color || 0x9bf227;
    let mat = this.peaMatCache.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: key, toneMapped: false });
      this.peaMatCache.set(key, mat);
    }
    return mat;
  }

  throwCherry(origin, target, def, range) {
    const c = this.cherries.find((x) => !x.active);
    if (!c) return;
    c.active = true;
    c.pos.copy(origin);
    c.origin.copy(origin);
    c.bounced = false;
    c.group.position.copy(origin);
    c.group.visible = true;
    c.damage = def.damage;
    c.radius = def.radius;
    c.fuse = 2.6;
    c.life = 0;
    // 落地点取粒子效果的高度：西瓜 1.35 倍缩放，落点抬高一点才像砸在地上。
    c.ground = def.id === 'melon' ? 0.45 : 0.25;
    c.proximityY = Math.max(2.4, origin.y + 1);
    c.mat.color.setHex(def.color || 0xe8452f);
    c.mat.emissive.setHex(def.id === 'melon' ? 0x143d10 : 0x5a0c05);
    c.group.scale.setScalar(def.id === 'melon' ? 1.35 : 1);

    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const horiz = Math.max(1.5, Math.hypot(dx, dz));
    // 飞行时间：4 米 0.4 秒，17 米 1.5 秒，再远也压到 1.5 秒（原公式不封顶，20 米的高抛最高点 8 米多）。
    // 压时间会把落点推到更远处（水平速度 = 距离/T，T 封顶后 22 米要 1.7 秒以上才落地），
    // 所以这里按封顶后的 T 反推水平距离上限，落点仍然压在准星那一带（误差 < 0.3 米）。
    const T = Math.min(1.5, Math.max(0.4, horiz / 17));
    const reach = 17 * T;
    const k = horiz > reach ? reach / horiz : 1;
    const g = 15;
    // 落点解算必须对着**爆点高度** c.ground，而不是准星落点的地面高度：
    // target 是"落点正下方的地面"，头两次就是这么解的，所以每发都多飞了 1 米多。
    const dy = c.ground - origin.y;
    c.vel.set((dx * k) / T, (dy + 0.5 * g * T * T) / T, (dz * k) / T);
    c.gravity = g;
    // 射程只在没撞过墙时生效：撞墙反弹会让水平距离提前变小，再按射程掐会在墙根提前炸。
    // 允许超出准星落点 3 米，高抛落地后还能往前滚一点。
    c.maxRange = horiz * k + 3;
  }

  // headTarget / headshot：准星直接命中僵尸时传进来，该只吃爆头加成，其余范围伤害不变。
  explodeAt(pos, radius, damage, big, headTarget, headshot) {
    this.particles.explosion(pos, radius);
    this.sfx.explosion(!!big);
    if (this.ctx.onExplosion) this.ctx.onExplosion(pos, radius);
    const mul = headshot ? TUNING.headshotMul : 1;
    const hits = this.zombies.damageArea(pos, radius, damage, headTarget, mul);
    if (headshot) this.sfx.headshot();
    if (hits > 0 && this.ctx.onHit) this.ctx.onHit(!!headshot, false);
    return hits;
  }

  update(dt) {
    for (let i = 0; i < this.peas.length; i++) {
      const p = this.peas[i];
      if (!p.active) continue;
      p.life -= dt;
      p.prev.copy(p.pos);
      // 豌豆没有重力：撞墙就地消失（不反弹、不穿墙），撞地同样消失 —— 记下撞点做飞溅
      if (this.step(p.pos, p.vel, dt, PEA_RADIUS, 0)) {
        tmpA.copy(p.pos);
        tmpA.y = 0.08;
        this.particles.splat(tmpA, p.slow ? 0xa8f0ff : 0x7fbf3f);
        this.deactivatePea(p);
        continue;
      }
      p.mesh.position.copy(p.pos);

      let bestT = 2;
      let bestZ = null;
      let headshot = false;
      const forced = p.headshot;
      for (let j = 0; j < this.zombies.zombies.length; j++) {
        const z = this.zombies.zombies[j];
        if (!z.alive || z.dying || z.spawnT < 0.5 || p.hits.has(z)) continue;
        // hitRadiusScale：骷髅（含巨型骷髅 Boss）体块比例和僵尸不同，半径要跟着模型走，
        // 默认 1 保持僵尸口径不变。头部球仍然严格小于胸口球。
        const rs = z.hitRadiusScale || 1;
        z.getChest(tmpChest);
        const tBody = segmentSphereT(p.prev, p.pos, tmpChest, CHEST_R * z.scaleFactor * rs + 0.14);
        z.getHead(tmpHead);
        const tHead = segmentSphereT(p.prev, p.pos, tmpHead, HEAD_R * z.scaleFactor * rs);
        let t = -1;
        let head = false;
        // 头部球必须用原始半径比较：命中球被胖化到 0.52 会从头顶一路盖到胸口，爆头永远判不出来。
        // 同 t 时头部优先，保证重合成的一团也按爆头算。
        if ((forced && (tHead >= 0 || tBody >= 0)) || (tHead >= 0 && (tBody < 0 || tHead <= tBody))) {
          t = forced ? Math.max(tHead, tBody) : tHead;
          head = true;
        } else if (tBody >= 0) {
          t = tBody;
        }
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestZ = z;
          headshot = head;
        }
      }

      if (bestZ) {
        const damage = p.damage * (headshot ? TUNING.headshotMul : 1);
        tmpA.copy(p.prev).lerp(p.pos, bestT);
        const killed = bestZ.hit(damage, p.slow);
        this.particles.splat(tmpA, p.slow ? 0xa8f0ff : 0x7fbf3f);
        if (headshot) this.sfx.headshot();
        else this.sfx.hit();
        if (this.ctx.onHit) this.ctx.onHit(headshot, killed);
        if (killed) this.zombies.handleKill(bestZ, headshot);
        if (p.pierce > 0) {
          p.pierce--;
          p.hits.add(bestZ);
        } else {
          this.deactivatePea(p);
        }
        continue;
      }

      if (p.life <= 0) this.deactivatePea(p);
    }

    for (let i = 0; i < this.cherries.length; i++) {
      const c = this.cherries[i];
      if (!c.active) continue;
      const boom = this.stepCherry(c, dt);
      c.group.position.copy(c.pos);
      c.group.rotation.x += dt * 7;
      c.group.rotation.z += dt * 3;
      if (boom) {
        tmpB.copy(c.pos);
        if (tmpB.y < 0.4) tmpB.y = 0.4;
        this.explodeAt(tmpB, c.radius, c.damage, true);
        c.active = false;
        c.group.visible = false;
      }
    }
  }

  // 投掷物推进一帧，返回 true 表示这一帧该炸了。
  // 重力用半隐式欧拉（先位移、再受一次重力），和 throwCherry 解算落点用的 s = v0·t + ½g·t² 一致；
  // 反过来先减重力再位移的话，vy 少掉第一帧，落点平均会提前约 0.2 秒 × 17 米/秒 ≈ 2.7 米。
  stepCherry(c, dt) {
    c.life += dt;
    c.fuse -= dt;
    const event = this.step(c.pos, c.vel, dt, CHERRY_RADIUS, c.ground);
    c.vel.y -= c.gravity * dt;
    // 西瓜投手能被墙反弹：撞墙继续飞（step 已按法线反射并衰减速度），落到地面才炸。
    if (event === 1) c.bounced = true;
    // 但要守住准星：飞出射程（准星落点再往外 3 米）就就地炸。
    // 撞过墙的不算射程——反弹后水平距离会提前变小，但那是反弹本身的路径。
    const travelled = Math.hypot(c.pos.x - c.origin.x, c.pos.z - c.origin.z);
    if (event === 2 || c.fuse <= 0 || (!c.bounced && travelled > c.maxRange)) return true;
    // 贴身撞到僵尸也算命中（高空掠过不炸：y < 2.4）
    for (let j = 0; j < this.zombies.zombies.length; j++) {
      const z = this.zombies.zombies[j];
      if (!z.alive || z.dying) continue;
      // 贴身判定的高度上限按武器给：西瓜出手就有一米三，樱桃的 2.4 米不够它过封锁线。
      if (Math.hypot(z.root.position.x - c.pos.x, z.root.position.z - c.pos.z) < 0.9 && c.pos.y < c.proximityY) return true;
    }
    return false;
  }

  // 投掷物推进一帧：落回地面平面、撞地图挡板、撞外圈，三者取最近的一件事处理。
  // ground 是地面高度；返回值 2 = 落地，1 = 撞墙，0 = 本帧没事。
  // 撞墙只做一次反射并丢掉剩余位移，速度已按能量损失衰减，下一帧继续 —— 不会穿墙。
  // 不传 ground（豌豆）时不判落地，只处理撞墙。
  step(pos, vel, dt, radius, ground) {
    const map = this.ctx.map;
    const walls = (map && map.walls) || noWalls;
    const b = (map && map.bounds) || { x: 23, z: 23 };
    tmpEnd.copy(pos).addScaledVector(vel, dt);
    let t = 2;
    let kind = 0;
    if (vel.y < 0 && pos.y > ground && tmpEnd.y <= ground) {
      t = (pos.y - ground) / (pos.y - tmpEnd.y);
      kind = 2;
    }
    const tw = sweepWalls(walls, b.x, b.z, pos, tmpEnd, radius, tmpN);
    if (tw >= 0 && tw < t) {
      t = tw;
      kind = 1;
    }
    if (kind === 0) {
      pos.copy(tmpEnd);
      return 0;
    }
    pos.lerpVectors(pos, tmpEnd, Math.min(t, 1));
    if (kind === 2) {
      pos.y = ground;
      return 2;
    }
    bounceVel(vel, tmpN.x, tmpN.y, tmpN.z);
    return 1;
  }

  deactivatePea(p) {
    p.active = false;
    p.mesh.visible = false;
  }

  clear() {
    for (let i = 0; i < this.peas.length; i++) this.deactivatePea(this.peas[i]);
    for (let i = 0; i < this.cherries.length; i++) {
      this.cherries[i].active = false;
      this.cherries[i].group.visible = false;
    }
  }
}
