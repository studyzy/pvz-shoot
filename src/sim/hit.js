// 命中判定的纯逻辑：服务器与客户端共用同一份，保证「看到打中了」和「服务器认为打中了」口径一致。
//
// 从 WeaponSystem.raycastZombies / ProjectileSystem 的扫掠逻辑提炼而来，
// 不依赖相机、视图模型、粒子 —— 只吃 (origin, dir, 僵尸列表)。
import * as THREE from 'three';
import { segmentSphereT, clamp } from '../utils.js';
import { sweepWalls } from '../weapons/HitWalls.js';

// 命中球半径（与 WeaponSystem / ProjectileSystem 保持一致，改一处必须同步另外两处）
export const HEAD_R = 0.36;
export const CHEST_R = 0.46;

const tmpOrigin = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpHead = new THREE.Vector3();
const tmpWallsOut = new THREE.Vector3();

/**
 * 射线扫掠僵尸，返回最近命中。
 * @returns {{zombie, head:boolean, dist:number, pos:{x,y,z}}|null}
 */
/**
 * 延迟补偿：用历史快照里的位置判定，而不是当前位置。
 * 客户端看到的是插值后的旧位置，按当前位置算会系统性打偏（打移动目标尤其明显）。
 * @param {Map} byId  id → {x,y,z}
 */
export function raycastZombiesAt(origin, dir, zombies, byId, extra = {}) {
  if (!byId) return raycastZombies(origin, dir, zombies, extra);
  const range = extra.range || 90;
  tmpOrigin.set(origin.x, origin.y, origin.z);
  tmpDir.set(dir.x, dir.y, dir.z);
  if (tmpDir.lengthSq() < 1e-9) return null;
  tmpDir.normalize();
  tmpEnd.copy(tmpOrigin).addScaledVector(tmpDir, range);

  const walls = extra.walls || null;
  const bounds = extra.bounds || null;
  let wallT = -1;
  if (walls && walls.length) {
    tmpWallsOut.set(0, 0, 0);
    wallT = sweepWalls(walls, bounds ? bounds.x : 100, bounds ? bounds.z : 100, tmpOrigin, tmpEnd, 0.05, tmpWallsOut);
  }

  let bestT = wallT >= 0 ? wallT : 1;
  let hit = null;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (!z.alive || z.dying) continue;
    const h = byId.get(z.netId);
    if (!h) continue;
    // 用历史位置构造命中球（高度口径与 getChest/getHead 一致）
    const s = z.scaleFactor;
    const rs = z.hitRadiusScale || 1;
    tmpChest.set(h.x, h.y + z.chestY * s * (z.model ? z.model.scale.y : 1), h.z);
    const t1 = segmentSphereT(tmpOrigin, tmpEnd, tmpChest, CHEST_R * s * rs);
    tmpHead.set(h.x, h.y + z.headY * s * (z.model ? z.model.scale.y : 1), h.z);
    const t2 = segmentSphereT(tmpOrigin, tmpEnd, tmpHead, HEAD_R * s * rs);
    let t = -1;
    let head = false;
    if (t2 >= 0 && (t1 < 0 || t2 <= t1)) {
      t = t2;
      head = true;
    } else if (t1 >= 0) {
      t = t1;
    }
    if (t >= 0 && t < bestT) {
      bestT = t;
      hit = {
        zombie: z,
        head,
        dist: range * t,
        pos: {
          x: tmpOrigin.x + tmpDir.x * range * t,
          y: tmpOrigin.y + tmpDir.y * range * t,
          z: tmpOrigin.z + tmpDir.z * range * t,
        },
      };
    }
  }
  return hit;
}

export function raycastZombies(origin, dir, zombies, extra = {}) {
  const range = extra.range || 90;
  const walls = extra.walls || null;
  const bounds = extra.bounds || null;

  tmpOrigin.set(origin.x, origin.y, origin.z);
  tmpDir.set(dir.x, dir.y, dir.z);
  if (tmpDir.lengthSq() < 1e-9) return null;
  tmpDir.normalize();
  tmpEnd.copy(tmpOrigin).addScaledVector(tmpDir, range);

  // 墙体遮挡：打墙就是没打中，这一条必须在客户端和服务器都成立
  let wallT = -1;
  if (walls && walls.length) {
    tmpWallsOut.set(0, 0, 0);
    wallT = sweepWalls(walls, bounds ? bounds.x : 100, bounds ? bounds.z : 100, tmpOrigin, tmpEnd, 0.05, tmpWallsOut);
  }

  let bestT = wallT >= 0 ? wallT : 1;
  let hit = null;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (!z.alive || z.dying) continue;
    const rs = z.hitRadiusScale || 1;
    z.getChest(tmpChest);
    const t1 = segmentSphereT(tmpOrigin, tmpEnd, tmpChest, CHEST_R * z.scaleFactor * rs);
    z.getHead(tmpHead);
    const t2 = segmentSphereT(tmpOrigin, tmpEnd, tmpHead, HEAD_R * z.scaleFactor * rs);
    let t = -1;
    let head = false;
    // 头球更小时严格比较 t，同 t 头部优先（与 ProjectileSystem 同口径）
    if (t2 >= 0 && (t1 < 0 || t2 <= t1)) {
      t = t2;
      head = true;
    } else if (t1 >= 0) {
      t = t1;
    }
    if (t >= 0 && t < bestT) {
      bestT = t;
      hit = {
        zombie: z,
        head,
        dist: range * t,
        pos: {
          x: tmpOrigin.x + tmpDir.x * range * t,
          y: tmpOrigin.y + tmpDir.y * range * t,
          z: tmpOrigin.z + tmpDir.z * range * t,
        },
      };
    }
  }
  return hit;
}

/**
 * 从 (yaw, pitch) 解算视线方向。服务器的玩家只有角度，没有相机对象。
 * 与 Player.applyCamera 的约定一致：yaw=0 面向 -Z，pitch 正 = 抬头。
 */
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// 眼睛高度：与 Player 的 applyCamera 一致（脚底 + 1.66）
export const EYE_HEIGHT = 1.66;

export function eyePos(player) {
  return { x: player.pos.x, y: player.pos.y + EYE_HEIGHT, z: player.pos.z };
}

/**
 * 服务器权威命中裁决：客户端上报 (yaw, pitch)，服务器重建视线并判定。
 * 客户端上报的「打中了谁」一律不信任，只信任角度。
 */
export function adjudicateShot(player, yaw, pitch, zombies, map, byId) {
  const origin = eyePos(player);
  const dir = lookDir(yaw, pitch);
  const extra = {
    walls: map && map.walls ? map.walls : null,
    bounds: map && map.bounds ? map.bounds : null,
  };
  return byId ? raycastZombiesAt(origin, dir, zombies, byId, extra) : raycastZombies(origin, dir, zombies, extra);
}

export { clamp };