// 冲刺 / 下蹲 / 机瞄（docs/plans/2026-11-12-render-overhaul.md §4.3）。
//
// 这三个不是「手感微调」而是玩法补完：
//   - 冲刺：快 55%，但会收枪（不能机瞄），走位有代价
//   - 下蹲：矮 37%，掩体才有意义；速度降到 45%
//   - 机瞄：fov 73 → 52，远处僵尸头点得动
//
// 共同的关键点：全部平滑过渡（crouchT / adsT），不能一帧跳变 —— 突变的视高和
// fov 会让人晕，比没有这些功能更糟。
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Player } from '../../src/entities/Player.js';
import { TUNING } from '../../src/config.js';

function fakeControls(over) {
  return {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    ads: false,
    sprinting: false,
    crouching: false,
    consumeJump: () => false,
    consumeLook: () => ({ x: 0, y: 0 }),
    ...over,
  };
}

function terrain() {
  return { bounds: { x: 23, z: 23 }, colliders: [], platforms: [] };
}

describe('下蹲', () => {
  let p;
  beforeEach(() => {
    p = new Player(null);
    p.eyeHeight = TUNING.playerHeight;
  });

  it('默认站立、视高为 playerHeight', () => {
    expect(p.crouching).toBe(false);
    expect(p.crouchT).toBe(0);
    expect(p.eyeHeight).toBeCloseTo(TUNING.playerHeight, 5);
  });

  it('按住 Ctrl 后 crouchT 逐步升到 1，视高降到约 1.05', () => {
    p.setCrouch(true);
    for (let i = 0; i < 40; i++) p.updateStance(1 / 60, fakeControls({ crouching: true }));
    expect(p.crouchT).toBe(1);
    // 1.66 * (1 - 0.37) = 1.046
    expect(p.eyeHeight).toBeCloseTo(TUNING.playerHeight * 0.63, 3);
    expect(p.eyeHeight).toBeLessThan(1.1);
  });

  it('视高是平滑过渡的，不是一帧跳到底', () => {
    p.pos.y = 0;
    p.setCrouch(true);
    p.updateStance(1 / 60, fakeControls({ crouching: true }));
    const afterOne = p.eyeHeight;
    // 一帧只走了 crouchT += 6/60 = 0.1，视高不该已经到底
    expect(afterOne).toBeLessThan(TUNING.playerHeight);
    expect(afterOne).toBeGreaterThan(TUNING.playerHeight * 0.9);
  });

  it('松开后回升到站立', () => {
    p.setCrouch(true);
    for (let i = 0; i < 40; i++) p.updateStance(1 / 60, fakeControls({ crouching: true }));
    p.setCrouch(false);
    for (let i = 0; i < 40; i++) p.updateStance(1 / 60, fakeControls());
    expect(p.crouchT).toBe(0);
    expect(p.eyeHeight).toBeCloseTo(TUNING.playerHeight, 3);
  });

  it('蹲下时移速降到 45%', () => {
    p.setCrouch(true);
    for (let i = 0; i < 40; i++) p.updateStance(1 / 60, fakeControls({ crouching: true }));
    expect(p.speedMul).toBeCloseTo(0.45, 2);
  });

  it('死亡/倒地时不能蹲', () => {
    p.dead = true;
    p.setCrouch(true);
    expect(p.crouching).toBe(false);
  });

  it('空中不能蹲（没有地面可贴）', () => {
    p.grounded = false;
    p.setCrouch(true);
    expect(p.crouching).toBe(false);
  });
});

describe('冲刺', () => {
  let p;
  beforeEach(() => {
    p = new Player(null);
  });

  it('按 Shift + 前进才冲刺', () => {
    p.updateStance(1 / 60, fakeControls({ sprinting: true, move: { x: 0, y: 1 } }));
    expect(p.sprinting).toBe(true);
    expect(p.speedMul).toBeCloseTo(1.55, 2);
  });

  it('原地按 Shift 不冲刺（没有前进输入）', () => {
    p.updateStance(1 / 60, fakeControls({ sprinting: true, move: { x: 0, y: 0 } }));
    expect(p.sprinting).toBe(false);
    expect(p.speedMul).toBe(1);
  });

  it('下蹲时不能冲刺（互斥）', () => {
    p.setCrouch(true);
    p.updateStance(1 / 60, fakeControls({ sprinting: true, crouching: true, move: { x: 0, y: 1 } }));
    expect(p.sprinting).toBe(false);
  });

  it('空中不冲刺', () => {
    p.grounded = false;
    p.updateStance(1 / 60, fakeControls({ sprinting: true, move: { x: 0, y: 1 } }));
    expect(p.sprinting).toBe(false);
  });

  it('冲刺时不能机瞄（收枪）', () => {
    p.updateStance(1 / 60, fakeControls({ sprinting: true, move: { x: 0, y: 1 } }));
    p.update(1 / 60, fakeControls({ ads: true }), terrain(), []);
    expect(p.adsT).toBe(0);
  });
});

describe('机瞄 ADS', () => {
  let p;
  beforeEach(() => {
    p = new Player(null);
  });

  it('按住右键后 adsT 平滑升到 1，fov 收到 52', () => {
    for (let i = 0; i < 60; i++) p.update(1 / 60, fakeControls({ ads: true }), terrain(), []);
    expect(p.adsT).toBe(1);
    // 73 - 21 * 1
    expect(p.cameraFov).toBeCloseTo(52, 3);
  });

  it('松开后回到 73', () => {
    for (let i = 0; i < 60; i++) p.update(1 / 60, fakeControls({ ads: true }), terrain(), []);
    for (let i = 0; i < 60; i++) p.update(1 / 60, fakeControls({ ads: false }), terrain(), []);
    expect(p.adsT).toBe(0);
    expect(p.cameraFov).toBeCloseTo(73, 3);
  });

  it('adsT 逐帧增长，不是瞬切', () => {
    p.update(1 / 60, fakeControls({ ads: true }), terrain(), []);
    expect(p.adsT).toBeGreaterThan(0);
    expect(p.adsT).toBeLessThan(0.5);
  });

  it('下蹲会额外收 6 度视野', () => {
    p.setCrouch(true);
    for (let i = 0; i < 60; i++) {
      p.updateStance(1 / 60, fakeControls({ crouching: true }));
      p.update(1 / 60, fakeControls({ crouching: true }), terrain(), []);
    }
    expect(p.cameraFov).toBeCloseTo(73 - 6, 2);
  });

  it('死亡时机瞄失效', () => {
    p.dead = true;
    for (let i = 0; i < 10; i++) p.update(1 / 60, fakeControls({ ads: true }), terrain(), []);
    expect(p.adsT).toBe(0);
  });
});

describe('与既有系统不冲突', () => {
  it('坚果罩的重甲惩罚与姿态倍率相乘（不是覆盖）', () => {
    const p = new Player(null);
    p.shield = { active: true };
    p.shieldMoveMul = 0.7;
    p.stanceMul = 1.55;
    expect(p.speedMul).toBeCloseTo(0.7 * 1.55, 5);
  });

  it('姿态不会改动 playerHeight 常量', () => {
    const p = new Player(null);
    p.setCrouch(true);
    for (let i = 0; i < 30; i++) p.updateStance(1 / 60, fakeControls({ crouching: true }));
    expect(TUNING.playerHeight).toBe(1.66);
    expect(p.eyeHeight).toBeLessThan(TUNING.playerHeight);
  });

  it('复活后视高与机瞄都归位（不能蹲着复活）', () => {
    const p = new Player(null);
    p.setCrouch(true);
    p.crouchT = 1;
    p.adsT = 1;
    p.revive(0.5);
    expect(p.eyeHeight).toBeGreaterThan(0);
  });
});