// 服务器权威的房间：每场一个 MatchSim + 一个固定 30Hz 的推进循环。
//
// 关键设计（对应 docs/plans/2026-11-01-netcode-refactor.md §3.5）：
//   1. 不再有「房主」这个身份。谁掉线都只是该座位暂停输入，世界照常推进。
//   2. 模拟与渲染帧率彻底解耦 —— 房主手机掉到 20fps，客人看到的世界仍然是 30Hz。
//   3. 每 tick 广播二进制快照（约 300B），事件单独走 JSON（只做表现）。
import { TICK_RATE } from '../src/sim/MatchSim.js';
import { encodeSnapshot, encodeEvents, setZombieTypes } from '../src/sim/snapshot.js';
import { ZOMBIES, WEAPONS } from '../src/config.js';

// 类型表只需注册一次：服务器与客户端用同一份 config，索引天然对齐
setZombieTypes(Object.keys(ZOMBIES));

const MAX_INPUT_BACKLOG = 8;

export class Room {
  constructor(id, sim, opts = {}) {
    this.id = id;
    this.sim = sim;
    this.createdAt = Date.now();
    this.clients = new Map(); // seat -> { send, connected }
    this.inputs = [null, null];
    this.lastInputAt = [0, 0];
    // 开火：每个座位一个队列 + 冷却计时，防止客户端超频连发
    this.fireQueue = [[], []];
    this.cooldown = [0, 0];
    // 阳光消费请求：下一 tick 结算（服务器校验余额）
    this.sunRequests = [];
    this.tickTimer = null;
    this.running = false;
    this.onTickStats = opts.onTickStats || null;
    this.tickCost = 0;
  }

  attach(seat, client) {
    this.clients.set(seat, client);
  }

  detach(seat) {
    const c = this.clients.get(seat);
    if (c) c.connected = false;
    this.inputs[seat] = null;
  }

  // 收客户端输入：直接覆盖，不做插值（固定步长 30Hz + 客户端 30Hz 发送）
  pushInput(seat, input) {
    if (seat < 0 || seat > 1) return;
    this.inputs[seat] = input;
    this.lastInputAt[seat] = Date.now();
  }

  // 收开火请求：只记录「朝向」，判定全部在 tick 里由 MatchSim 做
  pushFire(seat, fire) {
    if (seat < 0 || seat > 1) return;
    const q = this.fireQueue[seat];
    // 一帧最多攒 4 发，防止一次塞爆
    if (q.length >= 4) return;
    q.push(fire);
  }

  queueSun(seat, amount) {
    if (seat < 0 || seat > 1) return;
    if (!(amount > 0) || amount > 500) return; // 单次扣费上限，防脏数据
    if (this.sunRequests.length > 16) return;
    this.sunRequests.push({ seat, amount });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.sim.start(1);
    this.scheduleNext();
  }

  scheduleNext() {
    if (!this.running) return;
    const now = Date.now();
    if (!this.nextTickAt) this.nextTickAt = now;
    // 自校正：按绝对时间排下一帧，避免 setInterval 累积漂移
    this.nextTickAt += 1000 / TICK_RATE;
    const delay = Math.max(0, this.nextTickAt - Date.now());
    this.tickTimer = setTimeout(() => this.onTick(), delay);
    if (this.tickTimer.unref) this.tickTimer.unref();
  }

  onTick() {
    if (!this.running) return;
    const t0 = process.hrtime ? process.hrtime.bigint() : 0n;
    // 掉线玩家 300ms 没输入就归零，否则代理会一直往前走
    const now = Date.now();
    const inputs = [];
    for (let i = 0; i < this.sim.players.length; i++) {
      const inp = this.inputs[i];
      if (!inp || now - this.lastInputAt[i] > 300) {
        inputs.push({ moveX: 0, moveZ: 0, yaw: inp ? inp.yaw : 0, pitch: inp ? inp.pitch : 0, buttons: 0 });
      } else {
        inputs.push(inp);
      }
    }

    // 阳光消费先于 step 结算，保证本 tick 生效
    while (this.sunRequests.length) {
      const r = this.sunRequests.shift();
      this.sim.spendSun(r.seat, r.amount);
    }

    this.sim.step(inputs);

    // 处理开火：冷却按秒消耗，到点才允许这一发
    const dt = 1 / TICK_RATE;
    for (let seat = 0; seat < 2; seat++) {
      this.cooldown[seat] = Math.max(0, this.cooldown[seat] - dt);
      const q = this.fireQueue[seat];
      while (q.length && this.cooldown[seat] <= 0) {
        const f = q.shift();
        const def = WEAPONS.find((w) => w.id === f.weapon);
        if (!def) continue;
        this.cooldown[seat] = Math.max(def.cooldown || 0, 1 / TICK_RATE);
        this.sim.fireShot(seat, f.weapon, f.yaw, f.pitch, f.aimLagTicks || 0);
      }
      // 冷却没到就继续攒着（下一 tick 再处理），但不无限积压
      if (q.length > 8) q.length = 8;
    }

    const snap = encodeSnapshot(this.sim);
    const events = this.sim.drainEvents();
    const evPkt = events.length ? encodeEvents(events) : null;

    for (const [seat, c] of this.clients) {
      if (!c.connected) continue;
      try {
        c.send(snap, evPkt);
      } catch (e) {
        c.connected = false;
      }
    }

    if (t0) {
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      this.tickCost = this.tickCost * 0.9 + dt * 0.1;
    }
    if (this.sim.over) this.stop();
    else this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  get connectedCount() {
    let n = 0;
    for (const c of this.clients.values()) if (c.connected) n++;
    return n;
  }
}