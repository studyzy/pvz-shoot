import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { CloudCombat } from '../../src/entities/CloudCombat.js';
import { Player } from '../../src/entities/Player.js';

vi.mock('../../src/entities/ZombieModel.js', async (original) => {
  const actual = await original();
  const T = await import('three');
  const toyIds = ['toySoldier', 'springDuck', 'teaSprite', 'paperGlider', 'jackBox', 'clockRabbit'];
  const models = { ...actual.MODELS, ...Object.fromEntries(toyIds.map((id) => [id, actual.MODELS[id] || { targetHeight: id === 'clockRabbit' ? 3.4 : 1.5 }])) };
  const scene = new T.Group();
  scene.add(new T.Mesh(new T.BoxGeometry(.6, 1, .6), new T.MeshStandardMaterial()));
  const armor = new T.Mesh(new T.BoxGeometry(.65, .4, .15), new T.MeshStandardMaterial());
  armor.name = 'ChestArmor'; scene.add(armor);
  const slot = { ready: true, scene, clips: ['Idle', 'Walk', 'Idle_Attack', 'Death', 'HitReact'].map((n) => new T.AnimationClip(n, 1, [])) };
  return { ...actual, MODELS: models, zombieModel: { ...slot, ...Object.fromEntries(Object.keys(models).map((id) => [id, slot])) } };
});
import { Zombie } from '../../src/entities/Zombie.js';
import * as config from '../../src/config.js';

const creatures = [];
function make(type, x = 0, z = 0) {
  const p = new Player(null); p.pos.set(0, 0, 5); p.onDamage = vi.fn();
  const ctx = { scene: new THREE.Scene(), player: p,
    map: { id: 'cloud', bounds: { x: 36, z: 36 }, root: new THREE.Group(), walls: [], platforms: [], colliders: [], bellHit: vi.fn() },
    particles: { burst: vi.fn() }, onAttack: vi.fn(), zombies: { zombies: [], handleKill: vi.fn() },
    game: { isGuestWorld: () => false, netGuest: null } };
  ctx.cloud = new CloudCombat(ctx);
  const m = new Zombie(type, 1, x, z, ctx, 1, 1);
  m.spawnT = 1; m.model.position.y = 0; m.skillCooldown = 0; m.attackTimer = 0;
  ctx.zombies.zombies.push(m); creatures.push(m);
  return m;
}
function tick(m, seconds, targets = m.ctx.player) {
  while (seconds > 1e-8) { const dt = Math.min(1 / 60, seconds); m.update(dt, targets, m.ctx.map.colliders); seconds -= dt; }
}
afterEach(() => { for (const m of creatures.splice(0)) { m.dispose(); m.ctx.cloud.reset(); } });

const types = ['toySoldier', 'springDuck', 'teaSprite', 'paperGlider', 'jackBox', 'clockRabbit'];
describe('云上玩具数据和专属波次', () => {
  it('共享钟规则集中配置，豌豆和原图数值不改', () => {
    expect(config.CLOUD).toMatchObject({ intermission: 15, bossIntermission: 20,
      bell: { radius: 8, duration: 1.6, cooldown: 18, hitRadius: 0.575, y: 1.7,
        positions: [[-16, 3], [16, 3], [0, -17]] } });
    expect(config.WEAPONS[0].cost).toBe(0);
  });
  it('六个原创模型对应独立玩具数值、现有护甲和技能配置', () => {
    const values = [[50, 2, 8, 90, 1], [45, 2.4, 10, 100, 1], [75, 1.6, 8, 140, 2],
      [35, 2.8, 9, 100, 1], [140, 1.7, 15, 220, 3], [1400, 1.35, 24, 3000, 7]];
    types.forEach((id, i) => {
      const d = config.ZOMBIES[id];
      expect(d, id).toBeDefined();
      expect([d.hp, d.speed, d.damage, d.score, d.sun]).toEqual(values[i]);
      expect(d.model).toBe(id);
      expect(d.family).toBe('toy');
    });
    expect(config.ZOMBIES.toySoldier.armor).toEqual({ material: 'plastic', hp: 18 });
    expect(config.ZOMBIES.springDuck.charge).toMatchObject({ telegraph: .65, recover: .9, period: 3.2, speed: 4.8, range: 6, width: 1.2 });
    expect(config.ZOMBIES.teaSprite.tea).toMatchObject({ telegraph: .85, period: 3.6, speed: 8, radius: .75 });
    expect(config.ZOMBIES.paperGlider.flight).toMatchObject({ cruise: 4, telegraph: .7, descent: .45, groundTime: 2.4, ascent: .6, high: 2.6 });
    expect(config.ZOMBIES.jackBox.punch).toMatchObject({ telegraph: .7, range: 2.2, recover: 1.1, period: 3.8 });
    expect(config.ZOMBIES.clockRabbit.clock).toMatchObject({ telegraph: .9, period: 8, startRadius: 2, radius: 10, speed: 6, damage: 18, recover: 2, bodyMul: 1.5, repeatDelay: 1.2 });
    expect(config.ZOMBIES.clockRabbit.boss).toBe(true);
  });
  it.each([
    [1, [3, 2, 0, 0, 0], 5], [2, [4, 3, 0, 0, 0], 7], [3, [5, 4, 2, 0, 0], 11],
    [4, [6, 5, 2, 2, 0], 15], [5, [10, 5, 2, 2, 0], 19], [6, [11, 6, 2, 2, 4], 25],
  ])('W%i严格总量与首次解锁，唯一兔Boss排队首', (n, counts, total) => {
    const plan = config.wavePlan(n, 'cloud');
    const actual = types.slice(0, 5).map((id) => plan.filter((t) => t === id).length);
    expect(actual).toEqual(counts);
    expect(total).toBe(config.waveTotal(n));
    expect(plan.length).toBe(total + (n % 5 === 0 ? 1 : 0));
    if (n % 5 === 0) expect(plan[0]).toBe('clockRabbit');
    expect(plan.every((id) => types.includes(id))).toBe(true);
  });
  it('高波守总量和精英单波上限，不泄漏到其他图Boss轮换', () => {
    for (let n = 7; n <= 80; n++) {
      const p = config.wavePlan(n, 'cloud');
      expect(p.length).toBe(config.waveTotal(n) + (n % 5 === 0 ? 1 : 0));
      for (const [id, cap] of [['teaSprite', 4], ['paperGlider', 2], ['jackBox', 4]]) {
        expect(p.filter((x) => x === id).length).toBeGreaterThan(0);
        expect(p.filter((x) => x === id).length).toBeLessThanOrEqual(cap);
      }
      expect(p.filter((id) => config.ZOMBIES[id].boss)).toEqual(n % 5 === 0 ? ['clockRabbit'] : []);
      expect(config.bossForWave(n, 'cloud')).toBe(n % 5 === 0 ? 'clockRabbit' : null);
      expect(config.wavePlan(n, 'backyard').some((id) => types.includes(id))).toBe(false);
      expect(config.bossForWave(n)).toBe(n % 5 === 0 ? config.BOSS_ROTATION[(n / 5 - 1) % 4] : null);
    }
  });
});


describe('玩具统一停机 · 保留动作与必要生命周期', () => {
  it('停机冻结位移、骨骼、攻击技能/换人计时，不洗掉锁向和前摇', () => {
    const m = make('springDuck'); m.update(.01, m.ctx.player, []);
    expect(m.skillState).toBe('telegraph');
    m.stopTimer = 1.6;
    const pos = m.root.position.clone(), direction = m.skillDirection.clone();
    const mixerTime = m.mixer.time, timer = m.skillTimer, cooldown = m.skillCooldown, aggro = m.aggroT;
    tick(m, 1.6);
    expect(m.root.position).toEqual(pos); expect(m.skillDirection).toEqual(direction);
    expect(m.mixer.time).toBe(mixerTime); expect(m.skillTimer).toBe(timer); expect(m.skillCooldown).toBe(cooldown); expect(m.aggroT).toBe(aggro);
    expect(m.stopCue.visible).toBe(true);
    tick(m, .1); expect(m.skillTimer).toBeLessThan(timer);
    expect(m.stopCue.visible).toBe(false);
  });
  it('停机期间白闪消退、燃烧可以死亡，死亡动画与尸体回收不锁死', () => {
    const m = make('springDuck'); m.stopTimer = 9; m.flash = 1;
    tick(m, .15); expect(m.flash).toBe(0);
    m.burnTimer = 3; m.burnDps = 1000; m.burnTickT = 0;
    tick(m, .01); expect(m.dying).toBe(true); expect(m.ctx.zombies.handleKill).toHaveBeenCalled();
    tick(m, 1.7); expect(m.dead).toBe(true);
  });
  it('guest应用停机/技能/甲血/姿态，不自推解冻、技能或伤害；死亡继续', () => {
    const m = make('paperGlider'); m.remote = true;
    m.applyNetState({ ...m.serialize(), sp: 1.1, sk: 'telegraph', kt: .6, kc: 2.4, kd: [1, 0], kh: 1, ks: 1, ka: 1, ab: 1, ar: 0, ys: .8 });
    m.stopTimer = m.serialize().kh;
    const s = m.serialize(), time = m.mixer.time;
    tick(m, 2);
    expect(m.serialize()).toMatchObject({ sp: s.sp, sk: s.sk, kt: s.kt, kc: s.kc, kd: s.kd, kh: s.kh, ks: s.ks, ka: s.ka, ab: 1 });
    expect(m.mixer.time).toBe(time); expect(m.ctx.player.onDamage).not.toHaveBeenCalled();
    m.applyNetState({ ...s, st: 3 }); tick(m, 1.7); expect(m.dead).toBe(true);
  });
});

describe('弹簧鸭 · 真锁向扫掠冲撞', () => {
  it('0.65秒压缩+6米直线不追踪，撞墙停下并0.9秒恢复，不夹带近战', () => {
    const m = make('springDuck'); m.ctx.player.pos.set(0, 0, 5);
    m.update(.01, m.ctx.player, []);
    expect(m.skillState).toBe('telegraph'); expect(m.skillCue.visible).toBe(true);
    const dir = m.skillDirection.clone(); m.ctx.player.pos.set(5, 0, 5);
    tick(m, .65); expect(m.skillState).toBe('charge'); expect(m.skillDirection).toEqual(dir);
    m.ctx.map.walls.push({ x: 0, y: 1.2, z: 2, hx: 2, hy: 1.2, hz: .2, c: 1, s: 0 });
    tick(m, .5); expect(m.root.position.z).toBeLessThan(1.5); expect(m.skillState).toBe('recover');
    expect(m.ctx.player.onDamage).not.toHaveBeenCalled(); expect(m.ctx.onAttack).not.toHaveBeenCalled();
    tick(m, 1); expect(m.skillState).toBe('idle');
  });
  it('冲撞扫掠命中每seat一次，横移/高跳能避开，攻击启动间隔至少3.2秒', () => {
    const m = make('springDuck'); m.ctx.player.pos.set(0, 0, 2);
    m.update(.01, m.ctx.player, []); tick(m, .65 + 1.25);
    expect(m.ctx.player.onDamage).toHaveBeenCalledTimes(1); expect(m.ctx.player.hp).toBe(90);
    tick(m, .3); expect(m.skillState).toBe('recover');
    tick(m, .7); expect(m.skillState).toBe('idle');
    expect(m.skillCooldown).toBeGreaterThan(0);
    const jumper = make('springDuck'); jumper.ctx.player.pos.set(0, 3, 2);
    jumper.update(.01, jumper.ctx.player, []); tick(jumper, 2);
    expect(jumper.ctx.player.onDamage).not.toHaveBeenCalled();
  });
});

describe('茶壶与杰克盒 · 固定目标和可躲预警', () => {
  it('茶壶锁定地面，0.85秒后发茶滴，被墙挡视线则只接近', () => {
    const m = make('teaSprite'); m.update(.01, m.ctx.player, []);
    expect(m.skillState).toBe('teaTelegraph'); const target = m.skillCenter.clone();
    m.ctx.player.pos.set(5, 0, 5); tick(m, .86);
    expect(m.ctx.cloud.tea.filter((p) => p.active)).toHaveLength(1);
    expect(m.ctx.cloud.tea[0].target).toEqual(target);
    expect(m.ctx.onAttack).not.toHaveBeenCalled();
    const blocked = make('teaSprite'); blocked.ctx.map.walls.push({ x: 0, y: 2, z: 2, hx: 2, hy: 2, hz: .2, c: 1, s: 0 });
    tick(blocked, 1); expect(blocked.skillState).toBe('idle'); expect(blocked.root.position.z).toBeGreaterThan(0);
    expect(blocked.ctx.cloud.tea.some((p) => p.active)).toBe(false);
  });
  it('盒怪预警0.7秒拳套只击中固定方向/2.2米目标，恢复1.1秒', () => {
    const m = make('jackBox'); m.ctx.player.pos.set(0, 0, 2);
    m.update(.01, m.ctx.player, []); expect(m.skillState).toBe('punchTelegraph');
    m.ctx.player.pos.set(4, 0, 2); tick(m, .71);
    expect(m.skillState).toBe('recover'); expect(m.ctx.player.onDamage).not.toHaveBeenCalled();
    const pos = m.root.position.clone(); tick(m, 1); expect(m.root.position).toEqual(pos);
    const near = make('jackBox'); near.ctx.player.pos.set(0, 0, 2); near.update(.01, near.ctx.player, []); tick(near, .71);
    expect(near.ctx.player.hp).toBe(85); expect(near.ctx.player.onDamage).toHaveBeenCalledTimes(1);
    expect(near.ctx.onAttack).not.toHaveBeenCalled();
  });
});

describe('纸飞机 · 完整落地豌豆窗口', () => {
  it('4秒巡航/.7预警/.45下降/2.4落地/.6升空，停机不落地', () => {
    const m = make('paperGlider'); expect(m.serialize()).toMatchObject({ ab: 1, sk: 'fly', y: 2.6 });
    tick(m, 4.01); expect(m.skillState).toBe('telegraph'); expect(m.root.position.y).toBe(2.6);
    m.stopTimer = 1.6; tick(m, 1.6); expect(m.airborne).toBe(true); expect(m.root.position.y).toBe(2.6);
    tick(m, .7); expect(m.skillState).toBe('descent'); expect(m.airborne).toBe(true);
    tick(m, .45); expect(m.skillState).toBe('land'); expect(m.airborne).toBe(false); expect(m.root.position.y).toBe(0);
    tick(m, 2.3); expect(m.skillState).toBe('land');
    tick(m, .12); expect(m.skillState).toBe('rise'); expect(m.airborne).toBe(true);
    tick(m, .62); expect(m.skillState).toBe('fly'); expect(m.root.position.y).toBeCloseTo(2.6);
    expect(m.ctx.onAttack).not.toHaveBeenCalled();
  });
});

describe('报时兔 · 互斥圈波、锁向冲撞和历史恢复倍率', () => {
  it('0.9秒发圈，扩散完成才恢复2秒；下一招锁向7米冲撞', () => {
    const m = make('clockRabbit'); m.update(.01, m.ctx.player, []);
    expect(m.skillState).toBe('ringTelegraph'); tick(m, .9); expect(m.skillState).toBe('ring');
    expect(m.ctx.cloud.waves.filter((p) => p.active)).toHaveLength(1);
    tick(m, 8 / 6 + .02); expect(m.skillState).toBe('recover');
    const pos = m.root.position.clone(); tick(m, 1.8); expect(m.skillState).toBe('recover'); expect(m.root.position).toEqual(pos);
    tick(m, .22); expect(m.skillState).toBe('idle');
    m.skillCooldown = 0; m.update(.01, m.ctx.player, []); expect(m.skillState).toBe('telegraph');
    expect(m.skillDirection.length()).toBeCloseTo(1);
  });
  it('半血双圈之间等1.2秒，再给完整0.9预警，两圈结束后才恢复', () => {
    const m = make('clockRabbit'); m.hp = m.maxHp / 2; m.update(.01, m.ctx.player, []);
    tick(m, .9 + 8 / 6 + .02); expect(m.skillState).toBe('repeat');
    tick(m, 1.2); expect(m.skillState).toBe('ringTelegraph'); expect(m.skillTimer).toBeCloseTo(.9, 1);
    tick(m, .92); expect(m.ctx.cloud.waves.filter((p) => p.active)).toHaveLength(2);
    tick(m, 8 / 6 + .02); expect(m.skillState).toBe('recover');
  });
  it.each([['idle', 'recover', false, 1.5], ['recover', 'idle', false, 1], ['recover', undefined, false, 1.5], ['recover', 'recover', true, 1]])('历史%s/%s头=%s按有效状态倍率%s，不改当前技能', (current, historical, head, mul) => {
    const m = make('clockRabbit'); m.setSkill(current, 1); const hp = m.hp;
    m.hit(100, false, head, { skillState: historical }); expect(m.hp).toBe(hp - 100 * mul); expect(m.skillState).toBe(current);
  });
  it('卫兵胸甲是可见模型节点，破甲和快照可见隐藏', () => {
    const m = make('toySoldier'); expect(m.hat).toBe(m.body.getObjectByName('ChestArmor')); expect(m.hat.visible).toBe(true);
    m.hit(18, false, false); expect(m.armorHp).toBe(0); expect(m.hat.visible).toBe(false);
    const remote = make('toySoldier'); remote.remote = true; remote.applyNetState({ ...remote.serialize(), ar: 0 });
    expect(remote.hat.visible).toBe(false); expect(remote.armorHp).toBe(0);
  });
});
