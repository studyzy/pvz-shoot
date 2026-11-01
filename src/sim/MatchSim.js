// 权威世界模拟：一场对局的完整状态机，跑在服务器（或单人本地）。
//
// 设计要点（对应 docs/plans/2026-11-01-netcode-refactor.md §2）：
//   - 固定步长 30Hz，与渲染帧率彻底解耦。客户端掉帧不影响服务器推进速度。
//   - 只包含「逻辑」：玩家移动、僵尸 AI/波次、阳光、计分。不含任何渲染对象。
//   - 输出两样东西：① 每 tick 的二进制快照 ② 事件（刷怪/死亡/波次…）供客户端做表现。
//
// 单人与联机跑的是同一份类：单人时浏览器本地驱动，联机时服务器驱动。
import * as THREE from 'three';
import { ZombieManager } from '../entities/ZombieManager.js';
import { Player } from '../entities/Player.js';
import { SkySun } from '../entities/SkySun.js';
import { TUNING, DUO, SUN_SKY } from '../config.js';

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

// 输入位掩码：一个字节塞下所有按键状态
export const BTN = {
  JUMP: 1 << 0,
  FIRE: 1 << 1,
  SHIELD: 1 << 2,
  RELOAD: 1 << 3,
};

function noop() {}

// 服务器/单人都需要的空壳依赖：粒子、音效、HUD 是纯表现
const FX = new Proxy({}, { get: () => noop });

export class MatchSim {
  /**
   * @param {object} opts
   * @param {object} opts.map    地图数据（colliders/platforms/bounds/flowAt），**不是** Three 场景
   * @param {number} opts.seed   随机种子（预留；当前模拟里的随机点很少）
   * @param {boolean} opts.duo   双人模式（影响波次数量/血量/阳光）
   * @param {number[]} opts.spawns 玩家出生点 [{x,z,yaw}, ...]
   */
  constructor(opts = {}) {
    this.map = opts.map;
    this.seed = opts.seed || 0;
    this.duo = !!opts.duo;
    this.tick = 0;
    this.events = [];
    this.over = false;
    this.overReason = null;

    // 阳光：双人与单人初始值不同（见 config DUO）
    this.maxSun = this.duo ? DUO.maxSun : TUNING.maxSun;
    this.sun = this.duo ? DUO.startSun : TUNING.startSun;
    this.scores = [0, 0];
    this.kills = [0, 0];

    this.particles = FX;
    this.sfx = FX;
    this.hud = FX;

    this.ctx = {
      headless: true,
      map: this.map,
      scene: null,
      env: null,
      particles: FX,
      sfx: FX,
      hud: FX,
      sunOrbs: { spawn: noop, spawnSky: noop },
      cloud: null,
      pickups: { dropAt: noop },
      onWaveStart: (n) => this.emit({ t: 'wave', n }),
      onWaveClear: (n) => {
        this.scores[0] += 150 * n;
        this.scores[1] += 150 * n;
        this.emit({ t: 'waveClear', n });
      },
      onKill: (z, score, headshot, by) => this.onKill(z, score, headshot, by),
      onBossSpawn: (z) => this.emit({ t: 'boss', name: (z.def && z.def.title) || 'BOSS' }),
      onBossDead: (z) => this.emit({ t: 'bossDead', name: (z.def && z.def.title) || 'BOSS' }),
      onZombieAttack: (z) => this.onZombieAttack(z),
    };

    this.zombies = new ZombieManager(this.ctx);
    this.zombies.setDuo(this.duo);
    this.skySun = new SkySun({ map: this.map, sunOrbs: { spawnSky: noop } });
    this.skySun.interval = this.duo ? DUO.skySunInterval : SUN_SKY.interval;

    // 每个座位一个玩家。Player 完全没有 DOM 依赖，可在 Node 里直接跑。
    this.players = [];
    const spawns = opts.spawns || [{ x: 0, z: TUNING.startZ, yaw: 0 }];
    for (let i = 0; i < spawns.length; i++) {
      this.players.push(this.makePlayer(spawns[i]));
    }
  }

  makePlayer(spawn) {
    const p = new Player(null);
    p.reset(spawn);
    p.duoDown = this.duo;
    // 服务器上的玩家希望：受伤/死亡只产生事件，不播放任何东西
    p.onDamage = null;
    p.onDeath = null;
    return p;
  }

  emit(ev) {
    ev.tick = this.tick;
    this.events.push(ev);
    // 事件只用于表现，攒太多说明没人消费（单人未接表现层时也不该爆内存）
    if (this.events.length > 256) this.events.shift();
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  onKill(z, score, headshot, by) {
    const seat = by === 1 ? 1 : 0;
    this.scores[seat] += score || 0;
    this.kills[seat] += 1;
    this.emit({ t: 'kill', seat, score: score || 0, head: !!headshot, kind: z.type });
    // 掉落阳光：服务器权威，客户端只负责显示
    const orbs = typeof z.def.sun === 'number' ? z.def.sun : z.def.boss ? 7 : 1;
    if (orbs > 0) {
      const p = z.root.position;
      this.emit({ t: 'orb', x: +p.x.toFixed(2), z: +p.z.toFixed(2), n: orbs });
    }
  }

  onZombieAttack(z) {
    const seat = z.targetSeat === 1 ? 1 : 0;
    const target = this.players[seat];
    if (!target || target.dead || target.downed) return;
    // Player.damage() 自己处理倒地（duoDown 时归零进入 downed）与单人死亡，
    // 这里只负责事件与团灭判定，不要重复实现一遍状态机。
    const wasDowned = target.downed;
    target.damage(z.def.damage, { airborne: !!z.airborne });
    if (!wasDowned && target.downed) {
      target.downTimer = 30;
      this.emit({ t: 'down', seat });
      this.checkWipe();
    } else if (target.dead) {
      this.over = true;
      this.overReason = 'DEAD';
      this.emit({ t: 'over', reason: 'DEAD' });
    }
  }

  // 开局
  start(wave = 1) {
    if (this.duo) this.zombies.startWave(wave);
    else this.zombies.startWave(wave);
  }

  /**
   * 推进一个固定步长。这是服务器唯一的入口。
   * @param {Array} inputs 每个座位的输入 {moveX, moveZ, yaw, pitch, buttons}
   */
  step(inputs) {
    if (this.over) return;
    this.tick++;
    const dt = 1 / TICK_RATE;

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const inp = (inputs && inputs[i]) || null;
      this.applyInput(p, inp, dt);
    }

    // 僵尸 AI 需要「玩家列表」：双人时两个目标，单人时一个
    const targets = this.players.filter((p) => !p.dead);
    const colliders = this.map.colliders || [];
    this.zombies.update(dt, this.players[0], colliders, this.duo ? targets : null);
    this.skySun.update(dt);

    // 双人倒地救援：两人靠近 3 米内累计 2.5 秒
    if (this.duo) this.updateRescue(dt);
  }

  applyInput(p, inp, dt) {
    const ctl = {
      move: { x: inp ? inp.moveX : 0, y: inp ? inp.moveZ : 0 },
      look: { x: 0, y: 0 },
      firing: !!(inp && inp.buttons & BTN.FIRE),
      jumpQueued: false,
      consumeLook() {
        const l = this.look;
        this.look = { x: 0, y: 0 };
        return l;
      },
      consumeJump() {
        const j = this.jumpQueued;
        this.jumpQueued = false;
        return j;
      },
    };
    // 视角是绝对角度，直接写（客户端已经是权威的来源）
    if (inp) {
      if (Number.isFinite(inp.yaw)) p.yaw = inp.yaw;
      if (Number.isFinite(inp.pitch)) p.pitch = inp.pitch;
      ctl.jumpQueued = !!(inp.buttons & BTN.JUMP);
    }
    p.update(dt, ctl, this.map, this.zombies.zombies);
  }

  // 两人同时倒地 = 团灭。在倒地发生的那一刻就判，别等下一帧扫描。
  checkWipe() {
    if (!this.duo || this.over) return;
    if (this.players.length < 2) return;
    if (this.players[0].downed && this.players[1].downed) {
      this.over = true;
      this.overReason = 'WIPE';
      this.emit({ t: 'over', reason: 'WIPE' });
    }
  }

  updateRescue(dt) {
    const a = this.players[0];
    const b = this.players[1];
    if (!a || !b) return;
    const down = a.downed ? a : b.downed ? b : null;
    const other = down === a ? b : a;
    if (!down) return;
    down.downTimer = (down.downTimer || 0) + dt;
    const dist = Math.hypot(down.pos.x - other.pos.x, down.pos.z - other.pos.z);
    if (dist <= 3 && !other.downed) {
      this.rescueAcc = (this.rescueAcc || 0) + dt;
      if (this.rescueAcc >= 2.5) {
        down.downed = false;
        down.downTimer = 0;
        down.hp = Math.round(down.maxHp * 0.5);
        down.invuln = 3;
        this.rescueAcc = 0;
        this.emit({ t: 'rescue' });
      }
    } else {
      this.rescueAcc = 0;
    }
    this.checkWipe();
  }

  // ---- 对外只读状态：快照编码从这里取数 ----

  playerState(i) {
    const p = this.players[i];
    if (!p) return null;
    return {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      yaw: p.yaw,
      pitch: p.pitch,
      hp: p.hp,
      maxHp: p.maxHp,
      downed: !!p.downed,
      downTimer: p.downTimer || 0,
      dead: !!p.dead,
    };
  }

  worldState() {
    return {
      tick: this.tick,
      sun: Math.round(this.sun),
      wave: this.zombies.wave,
      state: this.zombies.state,
      intermission: this.zombies.intermission,
      scores: this.scores.slice(),
      kills: this.kills.slice(),
      bossHp: this.zombies.boss ? Math.max(0, this.zombies.boss.hp / this.zombies.boss.maxHp) : 0,
      over: this.over,
      overReason: this.overReason,
    };
  }

  zombieStates() {
    return this.zombies.zombies.map((z) => z.serialize());
  }
}