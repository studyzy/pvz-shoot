// Pure data for the 'valley' map. No three.js, no WebGL: tools/extract-map-data.mjs builds this
// module in jsdom, and the contract tests construct PaintedValley with a bare Scene.
// The great tree's position, fromValley(9, -13) with HERO=[0.6, 0.8]; kept as a literal so this
// data module does not statically pull in the (dynamically imported) rendering stack.
const TREE = [15.8, -0.6];
import { valleyPropColliders, valleyPropWalls } from './valleyProps.js';

// The vendored valley is rebased so that (0,0) is a flat y=0 disc 28 m in radius (world.js).
// PaintedValley.heightAt exposes the real height field, so the player walks the same land the
// original demo does: REACH = extent/2 - 110 (1280 m ground -> 530 m radius), exactly the walker's
// limit in painted-valley's src/valley/main.js. bounds stays the square envelope used by
// projectiles / zombie clamping; reach is the round walk limit the player actually feels.
export const VALLEY_LAYOUT = {
  bounds: { x: 530, z: 530 },
  reach: 530,
  spawn: { x: 0, z: 13, yaw: Math.PI },
  pickupSpots: [
    [-20, 18], [20, 18], [-20, -18], [20, -18], [0, -20], [4, 4], [-4, -8],
    // 远处点位：让「走出去」有回报（山坡、谷底、水塘北岸），而不是只有一片空地
    [150, -120], [120, 220], [206, 308],
  ],
  // 山谷的树与石头（原版走路上会撞到的那些）从这里一次性生成：同一份数据同时给画面、客户端碰撞
  // 和服务器无头地图用，避免「看得见的树穿过去、看不见的树撞上」。
  // 上面几条手写条目是二次开发加的掩体（石墙 / 干草车 / 村舍），保留。
  colliders: [
    ...valleyPropColliders(),
    { x: -16, z: -6, r: 0.7 },
    { x: -14, z: -6, r: 0.7 },
    { x: -12, z: -6, r: 0.7 },
    { x: -8, z: 12, r: 0.9 },
    { x: 10, z: 9, r: 1.8 },
  ],
  // 树与石头的树干/石头本身也是反弹体：子弹打树干会停，契约测试也要求每个碰撞球有可见实体。
  walls: [
    ...valleyPropWalls(),
    { x: -14, y: 0.6, z: -6, hx: 3, hy: 0.6, hz: 0.35, c: 1, s: 0 },
    { x: -8, z: 12, r: 0.8, h: 2 },
    { x: 10, y: 1.6, z: 9, hx: 2, hy: 1.6, hz: 2, c: 1, s: 0 },
  ],
};