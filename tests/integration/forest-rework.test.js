import { describe, it, expect, vi } from 'vitest';
import { Sfx } from '../../src/audio/Sfx.js';
import { SunOrbs } from '../../src/entities/SunOrbs.js';
import { WeaponPickups } from '../../src/entities/WeaponPickups.js';
import { encode } from '../../src/net/protocol.js';
import { DuoSession } from '../../src/net/DuoSession.js';
import { WEAPONS } from '../../src/config.js';
import { installFakeAudio, readSource } from '../helpers/env.js';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return { ...actual, WebGLRenderer: class { constructor(o) {
    Object.assign(this, makeFakeRenderer()); this.domElement = o && o.canvas;
  } } };
});

async function forest() {
  const { readyGame } = await import('../helpers/game.js');
  const { game } = await readyGame();
  game.setMap('forest'); game.start(); game.zombies.reset();
  return game;
}

describe('森林改版 · 系统接线', () => {
  it('辅助瞄准在雾内生效、其他地图保持62米', async () => {
    const g = await forest();
    const THREE = await import('three');
    const z = { alive: true, dying: false, spawnT: 1,
      getChest: (out) => out.copy(g.camera.position).add(new THREE.Vector3(0,0,-35)) };
    g.player.applyCamera(g.camera);g.camera.updateMatrixWorld(true);
    g.zombies.zombies=[z];
    expect(g.weapons.findAimTarget(WEAPONS[0])).toBeNull();
    g.ctx.map={id:'backyard'};
    expect(g.weapons.findAimTarget(WEAPONS[0]).zombie).toBe(z);
    g.ctx.map={id:'forest'};z.getChest=(out)=>out.copy(g.camera.position).add(new THREE.Vector3(0,0,-20));
    expect(g.weapons.findAimTarget(WEAPONS[0]).zombie).toBe(z);
  });
  it('森林触屏视图缩小、不改变其他图与弹道', async () => {
    const g = await forest();g.ctx.touch=true;
    g.weapons.update(.016,g.controls);
    const m=g.weapons.models[g.weapons.current];
    expect(m.group.scale.x).toBeCloseTo(m.baseScale*.88);
    g.ctx.map={id:'backyard'};g.weapons.update(.016,g.controls);
    expect(m.group.scale.x).toBeCloseTo(m.baseScale);
  });
  it('森林武器受光隔离保留颜色，切回其他图恢复原材质', async () => {
    const g = await forest();
    let mesh;g.weapons.models[0].group.traverse(o=>{if(!mesh&&o.isMesh&&o.material.vertexColors)mesh=o;});
    expect(mesh).toBeTruthy();expect(mesh.material.isMeshBasicMaterial).toBe(true);
    expect(mesh.geometry.getAttribute('color')).toBeTruthy();
    const dayMaterial = mesh.userData.dayMaterial;
    g.weapons.setMapAppearance('snow');expect(mesh.material).toBe(dayMaterial);
    g.weapons.setMapAppearance('forest');expect(mesh.material.isMeshBasicMaterial).toBe(true);
  });
  it('入口补给固定首点，支路按地图武器池刷新且guest不自刷', async () => {
    const THREE = await import('three');
    const p=new WeaponPickups({scene:new THREE.Scene()});
    p.setMap({pickupSpots:[[0,24],[15,0]],initialPickupSpot:0,pickupPools:{0:['snow'],1:['cob']}});
    expect(p.items[0].active).toBe(true);expect(WEAPONS[p.items[0].index].id).toBe('snow');
    p.spawnRandom();expect(WEAPONS[p.items[1].index].id).toBe('cob');
    expect(p.spawnRandom()).toBe(false);
    p.setShared(true);p.reset();expect(p.items.some(i=>i.active)).toBe(false);
  });
  it('补给池与点位的最后一项可被抽中', async () => {
    const THREE=await import('three');const p=new WeaponPickups({scene:new THREE.Scene()});
    const random=vi.spyOn(Math,'random').mockReturnValue(.999999);
    try {
      p.setMap({pickupSpots:[[0,24],[15,0],[0,-10]],initialPickupSpot:0,pickupPools:{0:['snow','repeater','firepea'],2:['cherry','jalapeno']}});
      expect(WEAPONS[p.items[0].index].id).toBe('firepea');
      p.spawnRandom();expect(p.items[2].active).toBe(true);expect(WEAPONS[p.items[2].index].id).toBe('jalapeno');
    } finally { random.mockRestore(); }
  });
  it('丢枪复用首池后重开仍恢复固定入口补给', async () => {
    const THREE=await import('three');const p=new WeaponPickups({scene:new THREE.Scene()});
    p.setMap({pickupSpots:[[0,24],[15,0]],initialPickupSpot:0,pickupPools:{0:['snow']}});
    p.removeById(p.items[0].id);p.dropAt(WEAPONS.findIndex(w=>w.id==='repeater'),2,2);
    expect(p.items[0].spot).toBeNull();p.reset();
    expect(p.items[0].spot).toEqual([0,24]);expect(p.items[0].active).toBe(true);
    expect(WEAPONS[p.items[0].index].id).toBe('snow');expect(p.items.filter(i=>i.active)).toHaveLength(1);
  });
  it('夜间阳光只换外观，切回白天恢复且面额不变', async () => {
    const THREE = await import('three');const orbs=new SunOrbs(new THREE.Scene());
    orbs.setMap('forest');expect(orbs.mat.color.getHex()).toBe(0xffdc8a);
    expect(orbs.glowMat.color.getHex()).toBe(0x80d9dd);
    orbs.setMap('snow');expect(orbs.mat.color.getHex()).toBe(0xffd83f);
  });
  it('族群声音复用现有采样，远处静音、环境声不先解锁AudioContext', () => {
    installFakeAudio();const s=new Sfx();const play=vi.spyOn(s,'play');
    s.creature('slime',.5,-.8);expect(play).toHaveBeenCalledWith('creatureSlime',{gain:.5,pan:-.8});
    s.creature('undead',.5,.5);expect(play).toHaveBeenCalledWith('creatureUndead',{gain:.5,pan:.5});
    s.creature('beast',.5,0);s.creature('goblin',.5,1);
    s.creature('slime',0,0);expect(play).toHaveBeenCalledTimes(4);
    s.forestAmbience();expect(s.ctx).toBeNull();
    s.unlock();const noise=vi.spyOn(s,'noise');s.forestAmbience();expect(noise).toHaveBeenCalled();
  });
  it('休整按钮仅在森林间歇显示，host提前开波而guest只请求', async () => {
    const g=await forest();g.zombies.state='intermission';g.zombies.wave=1;g.zombies.intermission=10;
    g.update(.016);expect(g.hud.nextWaveBtn.classList.contains('hidden')).toBe(false);
    g.hud.nextWaveBtn.click();expect(g.zombies.wave).toBe(2);
    g.update(.016);expect(g.hud.nextWaveBtn.classList.contains('hidden')).toBe(true);
    const ask=vi.fn();g.duo={};g.seat=1;g.duoSession={sendNextWave:ask};
    g.requestNextWave();expect(ask).toHaveBeenCalledTimes(1);expect(g.zombies.wave).toBe(2);
    g.state='paused';g.requestNextWave();expect(ask).toHaveBeenCalledTimes(1);
  });
  it('摇杆手势抑制click时触摸仍开波，兼容鼠标和键盘且不重复触发', async () => {
    const g=await forest();const next=vi.fn();g.hud.onNextWave=next;
    const touch=Object.assign(new Event('pointerdown',{bubbles:true,cancelable:true}),{pointerType:'touch'});
    g.hud.nextWaveBtn.dispatchEvent(touch);
    expect(next).toHaveBeenCalledTimes(1);
    expect(touch.defaultPrevented).toBe(true);
    g.hud.nextWaveBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
    expect(next).toHaveBeenCalledTimes(1);
    g.hud.nextWaveBtn.click();expect(next).toHaveBeenCalledTimes(2);
    g.hud.nextWaveBtn.dispatchEvent(Object.assign(new Event('pointerdown'),{pointerType:'mouse'}));
    g.hud.nextWaveBtn.dispatchEvent(new MouseEvent('click',{detail:1}));
    expect(next).toHaveBeenCalledTimes(3);
  });
  it('休整按钮显示时操作提示避让，不叠文字', async () => {
    const g=await forest();const style=document.createElement('style');
    style.textContent=readSource('src/style.css');document.head.appendChild(style);
    try {
      g.hud.showTutorial();g.hud.setIntermission(10);
      expect(getComputedStyle(g.hud.tutorialEl).visibility).toBe('hidden');
      g.hud.setIntermission(0);
      expect(getComputedStyle(g.hud.tutorialEl).visibility).toBe('visible');
    } finally { style.remove(); }
  });
  it('桌面锁鼠状态可用Enter结束休整，guest历史空中状态不可绕过', async () => {
    const g=await forest();g.zombies.state='intermission';g.zombies.wave=1;g.zombies.intermission=10;
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter'}));expect(g.zombies.wave).toBe(2);
    const THREE=await import('three');const {Zombie}=await import('../../src/entities/Zombie.js');
    const z=new Zombie('bat',8,0,-4,{scene:g.scene,map:g.map,particles:g.particles,sfx:g.sfx,onAttack:()=>{}});
    z.spawnT=1;z.root.position.set(0,2,-4);z.hp=100;z.airborne=true;
    g.zombies.zombies=[z];g.map.walls=[];g.duo={};g.seat=0;
    g.netGuest={pos:new THREE.Vector3(0,0,0),yaw:0,pitch:-.2};
    const snap={id:z.netId,x:0,y:.2,z:-4,ab:0,sk:'land'};
    g.duoSession={getZombieAt:()=>snap};
    const hit={w:'pea',zid:z.netId,dir:[0,-.2,-.98],seq:5};
    g.applyGuestHit(hit);expect(z.hp).toBeLessThan(100);
    z.hp=100;z.airborne=false;snap.ab=1;g.guestHit.clear();g.applyGuestHit(hit);expect(z.hp).toBe(100);
    g.duoSession.getZombieAt=()=>null;g.applyGuestHit(hit);expect(z.hp).toBe(100);
    z.root.position.y=.2;
    for (const seq of [0,-1,undefined,1.5,NaN]) {
      g.guestHit.clear();g.applyGuestHit({...hit,seq});expect(z.hp, '非法seq '+seq).toBe(100);
    }
    z.dispose();
  });
  it('重连快照保留森林休整，陌生序号不得回退到旧窗口', async () => {
    const g=await forest();g.zombies.state='intermission';g.zombies.intermission=12;g.zombies.wave=5;
    const snap=g.buildResync();expect(snap.ws).toBe('intermission');expect(snap.wt).toBe(12);
    g.duo={};g.seat=1;g.zombies.setRemote(true);g.applyResync(snap);
    expect(g.zombies.state).toBe('intermission');expect(g.zombies.intermission).toBe(12);
    const d=new DuoSession(g);d.history=[{seq:1,z:[{id:7,ab:0}]}];
    expect(d.getZombieAt(7,1).ab).toBe(0);expect(d.getZombieAt(7,2)).toBeNull();
  });
  it('Boss血条标题随真实类型切换，guest与重连也保持一致', async () => {
    const g=await forest();g.onBossSpawn({def:{title:'巨龙'}});
    expect(g.hud.bossBar.querySelector('.boss-name').textContent).toBe('巨龙');
    g.zombies.setRemote(true);
    g.applyWorldState({wave:15,bossHp:.5,z:[{id:77,t:'mushroomKing',x:0,y:0,z:0,yaw:0,hp:500,st:0,sl:0}]});
    expect(g.hud.bossBar.querySelector('.boss-name').textContent).toBe('蘑菇王');
    g.onBossSpawn({def:{title:'骷髅王'}});
    expect(g.hud.bossBar.querySelector('.boss-name').textContent).toBe('骷髅王');
  });
  it('host快照同步休整，guest只能通过专门请求让host开波', () => {
    const g={player:{pos:{x:0,y:0,z:0},hp:100},zombies:{wave:2,state:'intermission',intermission:9,zombies:[]},sun:60,
      applyNextWaveRequest:vi.fn()};
    const d=new DuoSession(g);d.host=true;d.state='playing';d.net={relay:vi.fn()};d.sendHostState();
    const msg=JSON.parse(d.net.relay.mock.calls[0][0]);expect(msg.d.ws).toBe('intermission');expect(msg.d.wt).toBe(9);
    d.onRelay(encode('nextwave'));expect(g.applyNextWaveRequest).toHaveBeenCalledTimes(1);
    d.host=false;d.sendNextWave();expect(JSON.parse(d.net.relay.mock.calls.at(-1)[0]).t).toBe('nextwave');
  });
});
