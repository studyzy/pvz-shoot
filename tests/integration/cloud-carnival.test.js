import { describe, it, expect, vi } from 'vitest';
import { WEAPONS, TUNING } from '../../src/config.js';
import { segmentSphereT } from '../../src/utils.js';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return { ...actual, WebGLRenderer: class { constructor(o) {
    Object.assign(this, makeFakeRenderer()); this.domElement = o && o.canvas;
  } } };
});

async function shotWorld() {
  const { readyGame } = await import('../helpers/game.js');
  const { game: g } = await readyGame();
  const THREE = await import('three');
  g.ctx.map = { id: 'cloud', bounds: { x: 36, z: 36 }, walls: [] };
  // 用真实钟位（config.CLOUD.bell）：沿 -Z 打出去命中的是北侧那口钟（id 2）。
  g.ctx.onBellHit = vi.fn();
  g.zombies.zombies = [];
  g.player.pos.set(0,0,0);
  g.player.eye.set(0,TUNING.playerHeight,0);
  g.player.applyCamera(g.camera); g.camera.updateMatrixWorld(true);
  return {g,THREE};
}

function enemy(THREE, z) {
  return {alive:true,dying:false,spawnT:1,scaleFactor:1,hitRadiusScale:1,
    getChest(out) {return out.set(0,1.66,z);},
    getHead(out) {return out.set(0,2.6,z);},
    chestY:1.66,headY:2.6,model:{scale:{y:1}},airborne:false,netId:7,
    hit:vi.fn().mockReturnValue(false)};
}

describe('云上游乐园 · 射击最早交点', () => {
  // 真实钟位：0=(-16,3) 1=(16,3) 2=(0,-17)。北侧那口钟在 17 米外，
  // 豌豆 74 m/s 要走 0.23 秒，所以每次"打得到钟"的 update 都得给足飞行时间。
  const FLY=.25;
  it('免费豌豆真实扫掠铜钟并消费弹丸', async () => {
    const {g,THREE}=await shotWorld();
    const origin=new THREE.Vector3(0,1.66,0);
    g.projectiles.spawnPea(origin,new THREE.Vector3(0,0,-1),WEAPONS[0]);
    g.projectiles.update(FLY);
    expect(g.ctx.onBellHit).toHaveBeenCalledTimes(1);
    expect(g.ctx.onBellHit.mock.calls[0][0]).toBe(2);
    expect(g.ctx.onBellHit.mock.calls[0][1]).toBe('pea');
    expect(g.ctx.onBellHit.mock.calls[0][3]).toEqual(origin);
    expect(g.projectiles.peas.some(p=>p.active)).toBe(false);
  });
  it('钟在敌人前则敲钟，不能继续伤害后面的敌人', async () => {
    const {g,THREE}=await shotWorld();const z=enemy(THREE,-20);g.zombies.zombies=[z];
    g.projectiles.spawnPea(new THREE.Vector3(0,1.66,0),new THREE.Vector3(0,0,-1),WEAPONS[0]);
    g.projectiles.update(FLY);
    expect(g.ctx.onBellHit).toHaveBeenCalledTimes(1);expect(z.hit).not.toHaveBeenCalled();
  });
  it('敌人在钟前则伤敌，不能同时敲钟', async () => {
    const {g,THREE}=await shotWorld();const z=enemy(THREE,-7);g.zombies.zombies=[z];
    g.projectiles.spawnPea(new THREE.Vector3(0,1.66,0),new THREE.Vector3(0,0,-1),WEAPONS[0]);
    g.projectiles.update(FLY);
    expect(z.hit).toHaveBeenCalledTimes(1);expect(g.ctx.onBellHit).not.toHaveBeenCalled();
  });
  it('墙在钟前阻挡敲钟', async () => {
    const {g,THREE}=await shotWorld();
    g.ctx.map.walls=[{x:0,z:-2,y:2,hx:2,hy:2,hz:.2,c:1,s:0}];
    g.projectiles.spawnPea(new THREE.Vector3(0,1.66,0),new THREE.Vector3(0,0,-1),WEAPONS[0]);
    g.projectiles.update(FLY);expect(g.ctx.onBellHit).not.toHaveBeenCalled();
    expect(g.projectiles.peas.some(p=>p.active)).toBe(false);
  });
  it('同一帧墙在钟后，先敲鐘而不是被后墙吞掉', async () => {
    const {g,THREE}=await shotWorld();
    g.ctx.map.walls=[{x:0,z:-19,y:2,hx:2,hy:2,hz:.2,c:1,s:0}];
    g.projectiles.spawnPea(new THREE.Vector3(0,1.66,0),new THREE.Vector3(0,0,-1),WEAPONS[0]);
    g.projectiles.update(FLY);expect(g.ctx.onBellHit).toHaveBeenCalledTimes(1);
  });
  it('即时射线命中铜钟时不会变成一次范围爆炸', async () => {
    const {g}=await shotWorld();const boom=vi.spyOn(g.projectiles,'explodeAt');
    g.weapons.hitscan(WEAPONS.find(w=>w.id==='cob'));
    expect(g.ctx.onBellHit).toHaveBeenCalledTimes(1);expect(boom).not.toHaveBeenCalled();
  });
  it('即时射线被钟前墙挡住，不敲钟', async () => {
    const {g}=await shotWorld();g.ctx.map.walls=[{x:0,z:-2,y:2,hx:2,hy:2,hz:.2,c:1,s:0}];
    g.weapons.hitscan(WEAPONS.find(w=>w.id==='cob'));
    expect(g.ctx.onBellHit).not.toHaveBeenCalled();
  });
});

describe('云上游乐园 · Game接线', () => {
  it('Game绑定CloudCombat且地图切换、重开清钟冷却', async () => {
    const {readyGame}=await import('../helpers/game.js');const {game:g}=await readyGame();
    expect(g.cloud).toBeTruthy();expect(g.ctx.cloud).toBe(g.cloud);
    g.setMap('cloud');expect(g.mapId).toBe('cloud');
    g.cloud.cooldown=9;g.resetRun();expect(g.cloud.cooldown).toBe(0);
    g.cloud.cooldown=9;g.setMap('snow');expect(g.cloud.cooldown).toBe(0);
    expect(g.map.id).toBe('snow');
  });
  it('cloud休整按钮与世界快照保留公共钟状态', async () => {
    const {readyGame}=await import('../helpers/game.js');const {game:g}=await readyGame();
    g.setMap('cloud');g.start();g.zombies.reset();g.zombies.wave=1;
    g.zombies.state='intermission';g.zombies.intermission=15;g.update(.01);
    expect(g.hud.nextWaveBtn.classList.contains('hidden')).toBe(false);
    g.cloud.cooldown=7;expect(g.buildResync().c).toEqual(g.cloud.serialize());
    g.hud.nextWaveBtn.click();expect(g.zombies.wave).toBe(2);
  });
  it('guest敲钟只发请求，不修改本地公共冷却', async () => {
    const {readyGame}=await import('../helpers/game.js');const {game:g}=await readyGame();
    const THREE=await import('three');g.setMap('cloud');g.duo={};g.seat=1;
    g.duoSession={sendBell:vi.fn()};
    g.ctx.onBellHit(0,'pea',new THREE.Vector3(0,0,-1),new THREE.Vector3(0,TUNING.playerHeight,0));
    expect(g.duoSession.sendBell).toHaveBeenCalledTimes(1);expect(g.cloud.cooldown).toBe(0);
  });
});

async function bellHost() {
  const {g,THREE}=await shotWorld();g.map=g.ctx.map;g.mapId='cloud';g.state='playing';
  g.duo={};g.seat=0;g.netGuest={pos:new THREE.Vector3(0,0,0),yaw:0,pitch:0,dead:false,downed:false};
  const pose={x:0,y:0,z:0,yaw:0,pitch:0,down:false};
  g.duoSession={getGuestAt:vi.fn(seq=>seq===3?pose:null),history:[{seq:3,z:[]}]};
  g.cloud=g.ctx.cloud;g.cloud.ringBell=vi.fn().mockReturnValue(true);
  // 钟位来自真实地图：沿 -Z 打出去命中的是北侧那口钟（id 2），不是凭空指定的 0。
  const dir=new THREE.Vector3(0,0,-1),origin=new THREE.Vector3(0,1.66,0);
  const bellId=g.cloud.bellIntersection(origin,origin.clone().addScaledVector(dir,80)).id;
  return {g,THREE,pose,bellId,request:{w:'pea',id:bellId,dir:[0,0,-1],origin:[0,1.66,0],seq:3}};
}

describe('云上游乐园 · host敲钟裁决',()=>{
  it('按开火时的历史位置视线重算，移动后仍能合法敲钟',async()=>{
    const {g,request,bellId}=await bellHost();g.netGuest.pos.x=5;
    g.applyGuestBell(request);expect(g.cloud.ringBell).toHaveBeenCalledWith(bellId);
  });
  it.each([
    {w:'cherry'},{w:'melon'},{w:'wallnut'},{w:'missing'},
    {id:0},{id:-1},{id:'0'},{seq:0},{seq:9},{seq:NaN},
    {dir:[0,0,1]},{dir:[NaN,0,-1]},{dir:[0,0,0]},
    {origin:[3,1.66,0]},{origin:[0,NaN,0]},
  ])('拒绝非直线武器、未知seq和伪造射线 %j',async(change)=>{
    const {g,request}=await bellHost();g.applyGuestBell({...request,...change});
    expect(g.cloud.ringBell).not.toHaveBeenCalled();
  });
  it('墙在钟前使请求失效',async()=>{
    const {g,request}=await bellHost();g.map.walls=[{x:0,z:-2,y:2,hx:2,hy:2,hz:.2,c:1,s:0}];
    g.applyGuestBell(request);expect(g.cloud.ringBell).not.toHaveBeenCalled();
  });
  it('历史目标在钟前时不能穿过敌人敲钟',async()=>{
    const {g,request}=await bellHost();
    // 胸口球在 y=1.02，射线在眼高 1.66 平飞，横向只差 0.64 米 < 0.6 半径才成立；这里给个高个子快照让遮挡真正生效。
    g.duoSession.history[0].z=[{id:7,x:0,y:0.4,z:-8,ys:1,ab:0,st:0}];
    g.applyGuestBell(request);expect(g.cloud.ringBell).not.toHaveBeenCalled();
  });
  it('倒地或举盾的guest不能敲钟',async()=>{
    const {g,request}=await bellHost();g.netGuest.downed=true;g.applyGuestBell(request);
    g.netGuest.downed=false;g.netGuest.shield={active:true};g.applyGuestBell(request);
    expect(g.cloud.ringBell).not.toHaveBeenCalled();
  });
  it('同武器的敲钟和敌人命中共享射速，不能重复消费一枪',async()=>{
    const {g,request}=await bellHost();g.applyGuestBell(request);g.applyGuestBell(request);
    expect(g.cloud.ringBell).toHaveBeenCalledTimes(1);
  });
});
