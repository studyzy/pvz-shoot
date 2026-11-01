// 纯逻辑模拟层：服务器（Node）与浏览器（单人）共用同一份代码。
//
// 这一层的硬约束：**禁止触碰渲染**。不许 import 场景对象、不许读 document/window、
// 不许加载 glb。它只依赖 THREE 的数学类（Vector3/Quaternion/Euler）和 config 里的数值。
//
// 为什么单独拎出来：联网时服务器要跑这一层（没有浏览器、没有 WebGL），
// 单人时浏览器自己跑这一层。同一份代码保证两边行为一致，不需要维护两份模拟。

export { Zombie } from '../entities/Zombie.js';
export { ZombieManager } from '../entities/ZombieManager.js';
export { Player } from '../entities/Player.js';
export { SkySun } from '../entities/SkySun.js';

// 无头上下文：给现有实体类喂一个「没有渲染资源」的 ctx。
// 各实体在 headless 分支里只建 Object3D、不建材质/骨骼/粒子，逻辑照跑。
export function headlessCtx(opts = {}) {
  const noop = () => {};
  const fx = new Proxy({}, { get: () => noop });
  return {
    headless: true,
    map: opts.map,
    scene: null,
    env: null,
    particles: fx,
    sfx: fx,
    hud: fx,
    sunOrbs: opts.sunOrbs || { spawn: noop, spawnSky: noop },
    cloud: opts.cloud || null,
    pickups: opts.pickups || { dropAt: noop },
    onWaveStart: opts.onWaveStart || noop,
    onWaveClear: opts.onWaveClear || noop,
    onKill: opts.onKill || noop,
    onBossSpawn: opts.onBossSpawn || noop,
    onBossDead: opts.onBossDead || noop,
    onAttack: opts.onAttack || noop,
    onZombieAttack: opts.onZombieAttack || noop,
    onKill: opts.onKill || noop,
  };
}