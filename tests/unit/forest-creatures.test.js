import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { ZOMBIES } from '../../src/config.js';

vi.mock('../../src/entities/ZombieModel.js', async (importOriginal) => {
  const actual = await importOriginal();
  const T = await import('three');
  const scene = new T.Group();
  scene.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial()));
  const names = ['Idle', 'Walk', 'Attack', 'Death', 'HitRecieve', 'Duck', 'Punch',
    'Flying_Idle', 'Fast_Flying', 'Headbutt', 'Bat_Flying', 'Bat_Attack', 'Bat_Death',
    'Spider_Idle', 'Spider_Walk', 'Spider_Attack', 'Spider_Death'];
  const slot = { ready: true, scene, clips: names.map((n) => new T.AnimationClip(n, 1, [])) };
  return { ...actual, zombieModel: { ...slot, ...Object.fromEntries(Object.keys(actual.MODELS).map((k) => [k, slot])) } };
});

import { Zombie } from '../../src/entities/Zombie.js';
import { ProjectileSystem } from '../../src/weapons/ProjectileSystem.js';

const creatures = [];
const player = (x = 0, z = 0, y = 0) => ({ pos: new THREE.Vector3(x, y, z), dead: false, downed: false });
function make(type, x = 0, z = 0, map = {}) {
  const ctx = { scene: new THREE.Scene(), map: { bounds: { x: 45, z: 45 }, ...map },
    particles: { burst: vi.fn(), splat: vi.fn() }, onAttack: vi.fn(), zombies: { handleKill: vi.fn() } };
  const monster = new Zombie(type, 1, x, z, ctx, 1, 1);
  monster.spawnT = 1;
  monster.model.position.y = 0;
  monster.attackTimer = 0;
  creatures.push(monster);
  return monster;
}
function tick(z, seconds, targets, colliders = []) {
  while (seconds > 1e-8) {
    const dt = Math.min(1 / 60, seconds);
    z.update(dt, targets, colliders);
    seconds -= dt;
  }
}
afterEach(() => { for (const z of creatures.splice(0)) z.dispose(); });

describe('森林巨人 · 固定地面警告与恢复', () => {
  it('前摇中心固定，离开警告后不受伤，slam不会顺带普通攻击', () => {
    const z = make('gargantuar');
    const p = player(0, 2);
    z.update(0.01, p, []);
    expect(z.skillState).toBe('telegraph');
    expect(z.skillTimer).toBeCloseTo(z.def.slam.telegraph);
    const center = z.skillCenter.clone();
    expect(z.skillCue.visible).toBe(true);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    p.pos.set(12, 0, 12);
    tick(z, z.def.slam.telegraph + 0.02, p);
    expect(z.skillCenter).toEqual(center);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    expect(z.skillState).toBe('recover');
    const before = z.root.position.clone();
    tick(z, z.def.slam.recover - 0.1, p);
    expect(z.root.position).toEqual(before);
    expect(z.skillCue.visible).toBe(false);
    tick(z, 0.2, p);
    expect(z.skillState).toBe('idle');
    expect(z.root.position.distanceTo(before)).toBeGreaterThan(0);
  });

  it('双人范围内每个活目标只受一次伤；倒地/死亡/高处目标跳过', () => {
    const z = make('gargantuar');
    const a = player(0, 1), b = player(1, 1);
    const dead = { ...player(), dead: true };
    const down = { ...player(), downed: true };
    const raised = player(0, 1, 8);
    const seats = [];
    z.ctx.onAttack.mockImplementation((m) => seats.push(m.targetSeat));
    z.update(0.01, [a, b, dead, down, raised], []);
    tick(z, z.def.slam.telegraph + 0.1, [a, b, dead, down, raised]);
    expect(seats).toEqual([0, 1]);
    tick(z, z.def.slam.recover - 0.2, [a, b]);
    expect(seats).toEqual([0, 1]);
  });

  it('预警不会追着目标移动；技能即使没有活目标也完成恢复', () => {
    const z = make('gargantuar');
    const p = player(0, 2);
    z.update(0.01, p, []);
    p.dead = true;
    tick(z, z.def.slam.telegraph + z.def.slam.recover + 0.1, [p]);
    expect(z.skillState).toBe('idle');
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
  });
});

describe('森林蘑菇王 · 非无敌防御窗口', () => {
  it.each([
    ['idle', 'duck', 0.25], ['duck', 'idle', 1],
    ['duck', undefined, 0.25], ['idle', undefined, 1],
  ])('当前%s/历史%s按seq姿态减伤，不改当前技能', (current, historical, mul) => {
    const z = make('mushroomKing');
    z.setSkill(current, 1);
    const hp = z.hp;
    z.hit(100, false, false, { type: 'pea', skillState: historical });
    expect(z.hp).toBe(hp - 100 * mul);
    expect(z.skillState).toBe(current);
  });
  it('周期蹲伏3秒仅承受25%伤害，动作不被walk盖掉；恢复禁移动攻击', () => {
    const z = make('mushroomKing');
    const p = player(20, 0);
    tick(z, z.def.duck.period - z.def.duck.duration - z.def.duck.recover + 0.01, p);
    expect(z.skillState).toBe('duck');
    expect(z.current).toBe('duck');
    const hp = z.hp;
    z.hit(100, false, false);
    expect(z.hp).toBe(hp - 100 * z.def.duck.reduce);
    const before = z.root.position.clone();
    tick(z, z.def.duck.duration - 0.1, p);
    expect(z.current).toBe('duck');
    expect(z.root.position).toEqual(before);
    tick(z, 0.12, p);
    expect(z.skillState).toBe('recover');
    z.hit(100, false, false);
    expect(z.hp).toBe(hp - 100 * z.def.duck.reduce - 100);
    tick(z, z.def.duck.recover - 0.1, p);
    expect(z.root.position).toEqual(before);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    tick(z, 0.2, p);
    expect(z.root.position.distanceTo(before)).toBeGreaterThan(0);
  });
});

describe.each(['bat', 'dragon'])('森林%s · 可读落地窗口', (type) => {
  it('构造后首个spawn快照已经空中，不能等技能首个update才修正ab', () => {
    const z = make(type);
    const flight = z.def.landing || z.def.dive;
    expect(z.airborne).toBe(true);
    expect(z.serialize()).toMatchObject({ ab: 1, sk: 'fly', y: flight.high });
  });
  it('空中前摇平滑下降，落地后普通弹药可攻击，再平滑起飞', () => {
    const z = make(type);
    const def = z.def.landing || z.def.dive;
    const p = player(25, 0);
    expect(z.skillState).toBe('fly');
    tick(z, def.period - def.groundTime - def.telegraph + 0.01, p);
    expect(z.skillState).toBe('telegraph');
    expect(z.airborne).toBe(true);
    const high = z.root.position.y;
    tick(z, def.telegraph / 2, p);
    expect(z.root.position.y).toBeLessThan(high);
    expect(z.root.position.y).toBeGreaterThan(def.ground);
    expect(z.airborne).toBe(true);
    expect(z.skillCue.visible).toBe(true);
    tick(z, def.telegraph / 2 + 0.02, p);
    expect(z.skillState).toBe('land');
    expect(z.airborne).toBe(false);
    expect(z.root.position.y).toBeCloseTo(def.ground);
    expect(z.getChest(new THREE.Vector3()).y).toBeCloseTo(def.ground + z.chestY * z.scaleFactor);
    z.root.updateMatrixWorld(true);
    expect(z.shadow.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.025);
    const hp = z.hp;
    const hit = vi.spyOn(z, 'hit');
    const projectiles = new ProjectileSystem({ scene: z.ctx.scene, particles: z.ctx.particles,
      zombies: { zombies: [z], handleKill: vi.fn() }, sfx: { hit: vi.fn(), headshot: vi.fn() } });
    const chest = z.getChest(new THREE.Vector3());
    projectiles.spawnPea(chest.clone().add(new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, 1),
      { speed: 20, damage: 10, radius: 0.1, color: 0x66bb22 });
    projectiles.update(0.1);
    expect(hit).toHaveBeenCalled();
    expect(z.hp).toBeLessThan(hp);
    tick(z, def.groundTime, p);
    expect(z.skillState).toBe('fly');
    expect(z.airborne).toBe(true);
    expect(z.root.position.y).toBeLessThan(def.high);
    tick(z, def.telegraph, p);
    expect(z.root.position.y).toBeCloseTo(def.high);
  });

  it('浮空普通豌豆无法命中；蝙蝠高空不能从2米外凭空啃人', () => {
    const z = make(type);
    const p = player(0, 1);
    z.update(0.01, p, []);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    const projectiles = new ProjectileSystem({ scene: z.ctx.scene, particles: z.ctx.particles,
      zombies: { zombies: [z], handleKill: vi.fn() }, sfx: { hit: vi.fn(), headshot: vi.fn() } });
    const chest = z.getChest(new THREE.Vector3());
    const hp = z.hp;
    projectiles.spawnPea(chest.clone().add(new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, 1),
      { speed: 20, damage: 10, radius: 0.1, color: 0x66bb22 });
    projectiles.update(0.1);
    expect(z.hp).toBe(hp);
  });
});

describe('森林蜘蛛与幽灵', () => {
  it('蜘蛛伏击可见但不移动伤害，靠近唤醒并留预警时间', () => {
    const z = make('spider');
    const p = player(20, 0);
    tick(z, 1, p);
    expect(z.skillState).toBe('ambush');
    expect(z.skillCue.visible).toBe(true);
    expect(z.model.scale.y).toBeLessThan(1);
    expect(z.root.position.x).toBe(0);
    p.pos.x = 1;
    z.update(0.01, p, []);
    expect(z.skillState).toBe('wake');
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    tick(z, z.def.ambush.wake - 0.05, p);
    expect(z.skillState).toBe('wake');
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    tick(z, 0.1, p);
    expect(z.skillState).toBe('idle');
    expect(z.ctx.onAttack).toHaveBeenCalledTimes(1);
  });

  it('蜘蛛只有进入开启手电锥且notice距离内才被远程唤醒', () => {
    const flash = new THREE.SpotLight(0xffffff, 2, 30, Math.PI / 8);
    flash.position.set(0, 1, 0);
    flash.target.position.set(0, 0, -12);
    const z = make('spider', 0, -12, { flash });
    const p = player();
    flash.visible = false;
    z.update(0.01, p, []);
    expect(z.skillState).toBe('ambush');
    flash.visible = true;
    flash.target.position.set(12, 1, 0);
    z.update(0.01, p, []);
    expect(z.skillState).toBe('ambush');
    flash.target.position.set(0, 0, -12);
    z.root.position.z = -16;
    z.update(0.01, p, []);
    expect(z.skillState).toBe('ambush');
    z.root.position.z = -12;
    z.update(0.01, p, []);
    expect(z.skillState).toBe('wake');
  });

  it('host接受guest代理的手电方向，倒地者不能远程叫醒蜘蛛', () => {
    const flash = new THREE.SpotLight(0xffffff, 2, 30, Math.PI / 8);
    flash.position.set(25, 1, 25);
    flash.target.position.set(25, 1, 0);
    const z = make('spider', 0, -12, { flash });
    const host = player(25, 25);
    const guest = { ...player(), eye: new THREE.Vector3(0, 1.66, 0), yaw: Math.PI / 2, pitch: -0.1 };
    z.update(0.01, [host, guest], []);
    expect(z.skillState).toBe('ambush');
    guest.yaw = 0;
    guest.downed = true;
    z.update(0.01, [host, guest], []);
    expect(z.skillState).toBe('ambush');
    guest.downed = false;
    z.update(0.01, [host, guest], []);
    expect(z.skillState).toBe('wake');
  });

  it.each(['ghost', 'ghost-skull'])('%s穿越碰撞体、不吃错误流场且仍受边界限制', (type) => {
    const flowAt = vi.fn((x, z, out) => { out.x = -1; out.z = 0; return true; });
    const z = make(type, 0, 0, { bounds: { x: 5, z: 5 }, flowAt });
    const p = player(20, 0);
    tick(z, 1, p, [{ x: 1, z: 0, r: 3 }]);
    expect(flowAt).not.toHaveBeenCalled();
    expect(z.root.position.x).toBeGreaterThan(0);
    expect(z.root.position.z).toBe(0);
    tick(z, 10, p);
    expect(z.root.position.x).toBeLessThanOrEqual(4.4);
  });
});

describe('森林技能同步与资源生命周期', () => {
  it.each([
    ['gargantuar', 'telegraph', 1], ['gargantuar', 'slam', 1], ['gargantuar', 'recover', 0],
    ['mushroomKing', 'duck', 1], ['mushroomKing', 'recover', 0],
    ['bat', 'fly', 0], ['bat', 'land', 1], ['spider', 'ambush', 1], ['spider', 'wake', 1],
  ])('%s远端%s应用可见姿态但不自行推进伤害或技能时钟', (type, state, visible) => {
    const z = make(type);
    z.remote = true;
    const s = { ...z.serialize(), sk: state, kt: 0.3, kx: 2, kz: 3, ab: state === 'fly' ? 1 : 0, st: 1 };
    z.applyNetState(s);
    expect(z.skillState).toBe(state);
    expect(z.skillCue.visible).toBe(!!visible);
    if (state === 'duck') expect(z.current).toBe('duck');
    tick(z, 4, player());
    expect(z.skillState).toBe(state);
    expect(z.skillTimer).toBe(0.3);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    expect(z.serialize()).toMatchObject({ ab: s.ab, sk: state, kt: 0.3, kx: 2, kz: 3 });
    const hp = z.hp;
    z.hit(99999, false, false);
    expect(z.hp).toBe(hp);
  });

  it('远端老快照保留当前空中状态，死亡马上关圈且只播放死亡', () => {
    const z = make('bat');
    z.remote = true;
    z.applyNetState({ ...z.serialize(), sk: 'telegraph', kt: 0.5, st: 1 });
    const old = { id: 1, x: 0, y: 1, z: 0, yaw: 0, hp: z.hp, st: 0 };
    z.applyNetState(old);
    expect(z.airborne).toBe(true);
    z.applyNetState({ ...old, st: 3, hp: 0 });
    expect(z.skillCue.visible).toBe(false);
    expect(z.shadow.visible).toBe(false);
    tick(z, 2, player());
    expect(z.dead).toBe(true);
    expect(z.current).toBe('die');
  });

  it('蹲伏/伏击命中球跟随可见高度，序列化ys供历史命中裁决', () => {
    const z = make('mushroomKing');
    z.setSkill('duck', z.def.duck.duration);
    z.update(0.01, player(20, 0), []);
    expect(z.getChest(new THREE.Vector3()).y).toBeCloseTo(z.chestY * z.scaleFactor * z.model.scale.y);
    expect(z.getHead(new THREE.Vector3()).y).toBeCloseTo(z.headY * z.scaleFactor * z.model.scale.y);
    expect(z.getAimPoint(new THREE.Vector3()).y).toBe(z.getChest(new THREE.Vector3()).y);
    expect(z.serialize().ys).toBeCloseTo(z.model.scale.y);
  });

  it('巨人警告圈半径与世界固定中心精确吻合，root转动/平移不会拖圈', () => {
    const z = make('gargantuar');
    z.update(0.01, player(0, 2), []);
    z.root.position.x = 1;
    z.root.rotation.y = 1.2;
    z.updateSkillCue();
    z.root.updateMatrixWorld(true);
    const center = z.skillCue.getWorldPosition(new THREE.Vector3());
    expect(center.x).toBeCloseTo(z.skillCenter.x);
    expect(center.z).toBeCloseTo(z.skillCenter.z);
    expect(center.y).toBeCloseTo(0.045);
    expect(z.skillCue.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(z.def.slam.radius);
  });

  it.each(['bat', 'dragon'])('%s一轮落地起飞后仍按原period循环，不偷减落地时间', (type) => {
    const z = make(type);
    const def = z.def.landing || z.def.dive;
    const p = player(25, 0);
    tick(z, def.period - def.groundTime + 0.03, p);
    expect(z.skillState).toBe('land');
    tick(z, def.groundTime - 0.1, p);
    expect(z.skillState).toBe('land');
    tick(z, def.period - def.groundTime + 0.12, p);
    expect(z.skillState).toBe('land');
  });

  it('蘑菇完整9秒循环会再次蹲伏；燃烧也只在duck阶段减伤', () => {
    const z = make('mushroomKing');
    const p = player(25, 0);
    tick(z, z.def.duck.period - z.def.duck.duration - z.def.duck.recover + 0.02, p);
    const hp = z.hp;
    z.burnTimer = 1;
    z.burnDps = 100;
    z.burnTickT = 0;
    z.update(0.01, p, []);
    expect(z.hp).toBe(hp - 25 * z.def.duck.reduce);
    tick(z, z.def.duck.period, p);
    expect(z.skillState).toBe('duck');
  });

  it.each(['gargantuar', 'mushroomKing', 'bat', 'dragon', 'spider'])('%s死亡即取消技能/提示，更新不再攻击', (type) => {
    const z = make(type);
    z.update(0.01, player(0, 1), []);
    z.startDeath();
    z.ctx.onAttack.mockClear();
    tick(z, 2, player());
    expect(z.skillCue.visible).toBe(false);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    expect(z.dead).toBe(true);
    expect(z.skillState).toBe('idle');
  });

  it('远端落地攻击姿态来自st=2，远端死亡重复快照不重置死亡计时', () => {
    const z = make('dragon');
    z.remote = true;
    z.applyNetState({ ...z.serialize(), sk: 'land', kt: 1, ab: 0, st: 2, y: 0 });
    expect(z.current).toBe('attack');
    z.applyNetState({ ...z.serialize(), st: 3 });
    tick(z, 0.5, player());
    const time = z.deathT;
    z.applyNetState({ ...z.serialize(), st: 3 });
    expect(z.deathT).toBe(time);
  });

  it('20Hz快照漏掉单帧slam时，guest从恢复计时还原纯视觉冲击', () => {
    const z = make('gargantuar');
    z.remote = true;
    z.applyNetState({ ...z.serialize(), sk: 'telegraph', kt: 0.05 });
    z.applyNetState({ ...z.serialize(), sk: 'recover', kt: z.def.slam.recover });
    expect(z.skillState).toBe('recover');
    expect(z.skillCue.visible).toBe(true);
    expect(z.current).toBe('attack');
    tick(z, 1, player());
    expect(z.skillTimer).toBe(z.def.slam.recover);
    expect(z.ctx.onAttack).not.toHaveBeenCalled();
    z.applyNetState({ ...z.serialize(), sk: 'recover', kt: 0.2 });
    expect(z.skillCue.visible).toBe(false);
    expect(z.current).toBe('idle');
  });

  it('没有手电/没有活目标时蜘蛛不醒，远端生命结束后更新是空操作', () => {
    const z = make('spider');
    z.update(0.01, [null, { ...player(0, 1), dead: true }], []);
    expect(z.skillState).toBe('ambush');
    z.remote = true;
    z.dead = true;
    const age = z.age;
    z.update(1, player(), []);
    expect(z.age).toBe(age);
  });

  it('共享提示/阴影几何，单体材质独立并且死亡与dispose不残留', () => {
    const a = make('gargantuar'), b = make('gargantuar');
    expect(a.skillCue.geometry).toBe(b.skillCue.geometry);
    expect(a.skillCue.material).not.toBe(b.skillCue.material);
    expect(a.shadow.geometry).toBe(b.shadow.geometry);
    const geo = vi.spyOn(a.skillCue.geometry, 'dispose');
    const mat = vi.spyOn(a.skillCue.material, 'dispose');
    a.update(0.01, player(0, 1), []);
    a.startDeath();
    expect(a.skillCue.visible).toBe(false);
    a.dispose();
    expect(mat).toHaveBeenCalledTimes(1);
    expect(geo).not.toHaveBeenCalled();
    creatures.splice(creatures.indexOf(a), 1);
    expect(a.root.parent).toBe(null);
    expect(b.skillCue.material.opacity).toBeGreaterThan(0);
  });
});
