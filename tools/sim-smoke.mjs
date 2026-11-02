// 无头模拟冒烟：在裸 Node 里跑一场完整对局，验证服务器权威世界真的能动。
// 用法：node tools/sim-smoke.mjs [秒数]
import { MatchSim } from '../src/sim/MatchSim.js';
import { headlessMap, duoStartSpawns } from '../src/sim/headlessMap.js';

const seconds = Number(process.argv[2] || 30);
const MAPS = ['backyard', 'snow', 'dust', 'forest', 'cloud', 'downtown'];
let failed = 0;

for (const id of MAPS) {
  const map = headlessMap(id);
  const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
  sim.start(1);
  // 用血量变化衡量僵尸真的打到了玩家（比挂回调更贴近真实观察）
  // 直接从玩家状态观察（最可信：这就是服务器权威世界里真正发生的事）
  let attacks = 0;
  let lastHp = sim.players.map((p) => p.hp);

  const ticks = 30 * seconds;
  const t0 = process.hrtime.bigint();
  let maxAlive = 0;
  for (let i = 0; i < ticks; i++) {
    // 玩家站定（让僵尸真的能走到并攻击），只转视角
    sim.step([
      { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 },
      { moveX: 0, moveZ: 0, yaw: 0.5, pitch: 0, buttons: 0 },
    ]);
    maxAlive = Math.max(maxAlive, sim.zombies.zombies.length);
    for (let k = 0; k < sim.players.length; k++) {
      const hp = sim.players[k].hp;
      if (hp < lastHp[k]) attacks++;
      lastHp[k] = hp;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perTick = ms / ticks;
  // 硬指标：僵尸必须真的刷出来（服务器在跑）。
  // 攻击数依赖出生点距离与地图，短时长下不一定发生，只做信息展示。
  const ok = maxAlive > 0;
  if (!ok) failed++;
  console.log(
    (ok ? '✓' : '✗'),
    id.padEnd(9),
    'wave=' + sim.zombies.wave,
    'maxAlive=' + String(maxAlive).padStart(2),
    'hits=' + String(attacks).padStart(3),
    'hurt=' + String(attacks).padStart(4),
    perTick.toFixed(3) + ' ms/tick',
    (perTick * 30 / 10).toFixed(2) + '% core @30Hz'
  );
}

console.log('');
console.log(failed ? `✗ ${failed} 张地图没跑起来` : '✓ 全部地图模拟正常（僵尸均已刷出；hits 视线下玩家位置而定）');
process.exit(failed ? 1 : 0);
