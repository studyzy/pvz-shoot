// 多房间压测：在一台机器上同时跑 N 场 MatchSim，测真实承载力。
// 用法：node tools/bench-rooms.mjs [房间数] [秒数]
//
// 这不是跑渲染 —— 服务器只跑纯逻辑。输出 CPU 占用、内存、快照带宽，
// 用来回答「2 核 8G 的 Lighthouse 能扛多少场」。
import { MatchSim } from '../src/sim/MatchSim.js';
import { headlessMap, duoStartSpawns } from '../src/sim/headlessMap.js';
import { encodeSnapshot } from '../src/sim/snapshot.js';
import { setZombieTypes } from '../src/sim/snapshot.js';
import { ZOMBIES } from '../src/config.js';

setZombieTypes(Object.keys(ZOMBIES));

const rooms = Number(process.argv[2] || 8);
const seconds = Number(process.argv[3] || 30);
const TICK = 30;

const MAPS = ['backyard', 'snow', 'dust', 'forest', 'cloud'];
const sims = [];
for (let i = 0; i < rooms; i++) {
  const id = MAPS[i % MAPS.length];
  const map = headlessMap(id);
  const sim = new MatchSim({ map, duo: true, spawns: duoStartSpawns(map) });
  sim.start(1);
  sims.push(sim);
}

function memMB() {
  return process.memoryUsage().rss / (1024 * 1024);
}

const inputsA = { moveX: 0.2, moveZ: 0.8, yaw: 0.3, pitch: 0, buttons: 0 };
const inputsB = { moveX: -0.5, moveZ: 0.2, yaw: 1.1, pitch: 0, buttons: 0 };

const startMem = memMB();
const t0 = process.hrtime.bigint();
const cpu0 = process.cpuUsage();
let bytes = 0;
let ticks = 0;
let maxTickMs = 0;

const totalTicks = TICK * seconds;
for (let t = 0; t < totalTicks; t++) {
  const tickStart = process.hrtime.bigint();
  for (const sim of sims) {
    sim.step([inputsA, inputsB]);
    // 每个房间每 tick 给两个客户端各发一包快照
    const snap = encodeSnapshot(sim);
    bytes += snap.byteLength * 2;
    sim.drainEvents();
  }
  const tickMs = Number(process.hrtime.bigint() - tickStart) / 1e6;
  if (tickMs > maxTickMs) maxTickMs = tickMs;
  ticks++;
}

const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
const cpu = process.cpuUsage(cpu0);
const cpuMs = (cpu.user + cpu.system) / 1000;
const endMem = memMB();

const budget = 1000 / TICK;
const roomsPerTick = elapsedMs / ticks; // 所有房间合计每 tick 耗时

console.log('=== 多房间压测 ===');
console.log('房间数        :', rooms, '（每场 2 人 =', rooms * 2, '人）');
console.log('模拟时长      :', seconds, '秒 =', ticks, 'tick @30Hz');
console.log('');
console.log('每 tick 总耗时 :', roomsPerTick.toFixed(3), 'ms（预算', budget.toFixed(1), 'ms）');
console.log('峰值 tick     :', maxTickMs.toFixed(3), 'ms');
console.log('CPU 占用      :', (cpuMs / elapsedMs * 100).toFixed(1), '%（单核百分比，Node 单线程）');
console.log('单核可容纳    : 约', Math.floor(budget / (roomsPerTick / rooms)), '场');
console.log('');
console.log('内存增量      :', (endMem - startMem).toFixed(1), 'MB（', ((endMem - startMem) / rooms).toFixed(2), 'MB/场）');
console.log('RSS 合计      :', endMem.toFixed(1), 'MB');
console.log('');
const perSec = bytes / seconds;
console.log('出网带宽      :', (perSec / 1024).toFixed(1), 'KB/s =', (perSec * 8 / 1e6).toFixed(2), 'Mbps');
console.log('每月流量      :', (perSec * 3600 * 24 * 30 / 1024 / 1024 / 1024).toFixed(1), 'GB（24/7 跑满）');