import * as THREE from 'three';
import { MAPS, DEFAULT_MAP, createMaps } from './world/maps.js';
import { bossForWave, ZOMBIES } from './config.js';
import { Player } from './entities/Player.js';
import { ZombieManager } from './entities/ZombieManager.js';
import { initZombieModel, zombieModel } from './entities/ZombieModel.js';
import { ProjectileSystem } from './weapons/ProjectileSystem.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { Particles } from './fx/Particles.js';
import { SunOrbs } from './entities/SunOrbs.js';
import { SkySun } from './entities/SkySun.js';
import { WeaponPickups } from './entities/WeaponPickups.js';
import { WallNuts, RemoteShield } from './entities/WallNuts.js';
import { RemotePlayer } from './entities/RemotePlayer.js';
import { Sfx } from './audio/Sfx.js';
import { HUD } from './ui/HUD.js';
import { Controls } from './input/Controls.js';
import { TUNING, WEAPONS, DUO, SUN_SKY, BOUNTY, AIRDROP } from './config.js';
import { outdoorEnvironment } from './world/materials.js';
import { clamp, lerp, segmentSphereT } from './utils.js';
import { sweepWalls } from './weapons/HitWalls.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'menu';
    this.mapId = DEFAULT_MAP;
    this.map = null;
    this.stats = { score: 0, kills: 0, wave: 0 };
    this.duoStats = [0, 0];
    this.duoKills = [0, 0];
    // 远端玩家（联网层接上后由 DuoSession 驱动；单人下也可调试生成）
    this.remotes = [];
    this.duoSession = null;
    this.duo = null;
    this.duoPending = false;
    this.remote = null;
    this.seat = -1;
    this.remoteFiring = false;
    // M2 input 协议：房主侧跑一个无渲染/无 HUD 的 guest 代理 Player；客人侧只发 input。
    this.netGuest = null;
    this.netControls = null;
    this.netFiring = false;
    this.lastGuestSeq = 0;
    this.lastGuestInputAt = 0;
    this.lastWorldSeq = 0;
    this.guestHit = new Map();
    this.reviveA = 0;
    this.reviveB = 0;
    this.wasADown = false;
    this.wasBDown = false;
    this.remoteDown = false;
    this.netShieldHp = 0;
    this.pendingResync = null;
    this.airdropWave = -1;
    this.airdropT = 0;
    this.airdropBeam = false;
    this.airdropDropped = false;
    // 空投：每 3 波 1 次，落点提前 5 s 亮光柱
    this.airdropWave = -1;
    this.airdropT = 0;
    this.airdropBeam = false;
    this.airdropDropped = false;
    this.airdropSpot = null;
    this.sun = TUNING.startSun;
    this.shakeAmp = 0;
    this.menuT = 0;
    this.deathT = 0;
    this.clock = new THREE.Clock();
    this.perfTime = 0;
    this.perfFrames = 0;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(this.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    const ctx = (this.ctx = {});
    this.ctx.scene = this.scene;
    this.ctx.camera = this.camera;

    this.sfx = new Sfx();
    initZombieModel();
    // 调试句柄：外部脚本（E2E / 控制台）要等某个模型加载完才能断言
    this.models = zombieModel;
    this.hud = new HUD();
    this.particles = new Particles(this.scene);
    this.maps = createMaps(this.scene);
    this.player = new Player(this.sfx);
    this.sunOrbs = new SunOrbs(this.scene);
    this.pickups = new WeaponPickups(ctx);
    // WeaponSystem.dropSlot 要把丢下的枪交回地面（ctx.pickups.dropAt）
    ctx.pickups = this.pickups;
    this.skySun = new SkySun({ map: null, sunOrbs: this.sunOrbs });

    ctx.player = this.player;
    ctx.particles = this.particles;
    ctx.sfx = this.sfx;
    ctx.sunOrbs = this.sunOrbs;
    ctx.hud = this.hud;

    this.zombies = new ZombieManager(ctx);
    ctx.zombies = this.zombies;

    this.projectiles = new ProjectileSystem(ctx);
    ctx.projectiles = this.projectiles;

    ctx.spendSun = (n) => this.spendSun(n);
    ctx.shake = (a) => this.shake(a);
    ctx.onHit = (head) => this.hud.hitmarker(head);
    ctx.onExplosion = (pos, radius) => this.onExplosion(pos, radius);
    ctx.onFire = () => this.hud.fadeTutorial();

    ctx.onKill = (z, score, headshot, source) => this.onKill(z, score, headshot, source);
    // guest 的命中只发请求；host 的本地命中不会走 sendHit（sendHit 里 host 直接 return）。
    ctx.onGuestHit = (z, weaponId, dir) => {
      if (this.duoSession) this.duoSession.sendHit(weaponId, z.netId, dir);
    };
    ctx.onGuestAoe = (weaponId, pos) => {
      if (this.duoSession) this.duoSession.sendAoe(weaponId, pos);
    };
    ctx.onWaveStart = (n) => this.onWaveStart(n);
    ctx.onWaveClear = (n) => this.onWaveClear(n);
    ctx.onZombieAttack = (z) => this.onZombieAttack(z);
    ctx.onBossSpawn = (z) => this.onBossSpawn(z);
    ctx.onBossDead = (z) => this.onBossDead(z);

    // 坚果免伤盾是玩家身上的状态：必须在 Player 之后、WeaponSystem 之前建好
    this.wallNuts = new WallNuts(ctx);
    ctx.wallNuts = this.wallNuts;
    this.player.shield = this.wallNuts;
    this.player.shieldMoveMul = (WEAPONS.find((w) => w.id === 'wallnut') || {}).shieldMoveMul || 0.88;

    this.weapons = new WeaponSystem(ctx);
    ctx.weapons = this.weapons;
    this.controls = new Controls(canvas, this.hud);
    ctx.touch = this.controls.isTouch;
    document.body.classList.toggle('touch', this.controls.isTouch);
    document.body.classList.toggle('desktop', !this.controls.isTouch);
    this.hud.setMode(this.controls.isTouch);
    this.controls.onModeChange = (touch) => {
      document.body.classList.toggle('touch', touch);
      document.body.classList.toggle('desktop', !touch);
      this.ctx.touch = touch;
      this.hud.setMode(touch);
    };

    this.sunOrbs.onCollect = (amount) => this.addSun(amount);

    this.player.onDamage = () => {
      this.hud.flashDamage();
      this.shake(0.5);
      this.sfx.hurt();
    };
    this.player.onDeath = () => this.gameOver();
    this.controls.onLockChange = (locked) => {
      // 双人下失锁不自动暂停，否则会通过中继把队友也锁住。
      if (!locked && this.state === 'playing' && !this.controls.isTouch && !this.duo) this.pause();
    };

    this.hud.onStart = () => this.start();
    this.hud.onDuo = () => this.toggleDuo();
    this.hud.onDuoShare = () => this.copyDuoLink();
    this.hud.onResume = () => this.resume();
    this.hud.onRestart = () => this.restart();
    this.hud.onDuoRematch = () => this.requestDuoRematch();
    this.hud.onDuoLeave = () => this.endDuo('LEFT');
    this.hud.onPause = () => this.pause();
    this.hud.onChangeMap = () => this.backToMenu();
    this.hud.onMapSelect = (id) => this.selectMap(id);
    this.hud.onMute = (m) => this.sfx.setMuted(m);
    // 点武器槽：槽位带角色，点了就是切到那一格（空格子什么都不做）
    this.hud.onSlotSelect = (role, pos) => {
      if (this.state !== 'playing') return;
      this.weapons.equipSlot(role, pos);
    };

    this.hud.buildMapSelect(MAPS, this.mapId);
    this.setMap(this.mapId);
    this.bindButtons();
    this.bindResize();
    this.resize();
    this.checkOrientation();
    this.hud.setSun(this.sun, true);
    this.hud.setHealth(this.player.hp, this.player.maxHp);
    this.menuCamera(0);
    this.loop = this.loop.bind(this);
    this.running = true;
  }

  bindButtons() {
    const fireBtn = this.hud.fireBtn;
    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state !== 'playing') return;
      this.controls.setFiring(true);
      fireBtn.classList.add('pressed');
      this.hud.fadeTutorial();
    };
    const release = () => {
      this.controls.setFiring(false);
      fireBtn.classList.remove('pressed');
    };
    fireBtn.addEventListener('pointerdown', press);
    fireBtn.addEventListener('pointerup', release);
    fireBtn.addEventListener('pointercancel', release);
    fireBtn.addEventListener('pointerleave', release);
    fireBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    const jumpBtn = this.hud.jumpBtn;
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === 'playing') this.controls.jumpQueued = true;
    });
    jumpBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    const orientationBtn = document.getElementById('orientationBtn');
    if (orientationBtn) {
      orientationBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.requestLandscape();
      });
    }

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
  }

  bindResize() {
    const onResize = () => {
      this.resize();
      this.checkOrientation();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    document.addEventListener('fullscreenchange', () => setTimeout(onResize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  checkOrientation() {
    if (this.state === 'playing' && window.innerHeight > window.innerWidth) this.pause();
  }

  requestLandscape() {
    if (!this.controls || !this.controls.isTouch) return;
    const root = document.documentElement;
    const lock = () => {
      try {
        if (screen.orientation && screen.orientation.lock) {
          const p = screen.orientation.lock('landscape');
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) {
        // iOS Safari 不支持网页锁定方向，交给玩家手动横屏。
      }
    };
    try {
      if (root.requestFullscreen) {
        const p = root.requestFullscreen({ navigationUI: 'hide' });
        if (p && p.then) p.then(lock).catch(lock);
        else lock();
      } else {
        lock();
      }
    } catch (e) {
      lock();
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const a = w / h;
    this.camera.fov = a < 0.7 ? 90 : a < 1 ? 84 : 73;
    this.camera.updateProjectionMatrix();
    if (this.weapons) this.weapons.setAspect(a);
  }

  setMap(id) {
    if (this.state !== 'menu') return;
    this.clearRemotes();
    let map = null;
    for (let i = 0; i < this.maps.length; i++) {
      if (this.maps[i].id === id) map = this.maps[i];
    }
    if (!map) map = this.maps[0];
    for (let i = 0; i < this.maps.length; i++) {
      this.maps[i].root.visible = false;
    }
    this.map = map;
    this.mapId = map.id;
    this.ctx.map = map;
    this.ctx.env = outdoorEnvironment(this.renderer, map.id);
    // 夜之森林整图关实时投影：省掉一遍 1024 PCFSoft shadow pass，
    // 夜景本来就靠雾和自发光撑氛围。其它地图照旧开着。
    this.renderer.shadowMap.enabled = !map.noShadows;
    map.activate(this.scene);
    this.hud.setMapSelection(map.id);
    this.hud.setStartLabel(map.startLabel);
    if (this.pickups) this.pickups.setMap(map);
  }

  selectMap(id) {
    if (this.state !== 'menu' || id === this.mapId) return;
    this.setMap(id);
    if (this.duoSession && this.duoSession.host) this.duoSession.sendMap(id);
    this.menuT = 0;
    this.sfx.click();
  }

  backToMenu() {
    if (this.duoSession) {
      const s = this.duoSession;
      this.duoSession = null;
      s.close();
    }
    this.duo = null;
    this.seat = -1;
    this.remote = null;
    this.state = 'menu';
    this.hud.hideScreens();
    this.hud.showStartScreen();
    this.hud.showHud(false);
    this.controls.setEnabled(false);
    this.controls.exitLock();
    this.resetRun();
    this.hud.setDuoMode(false);
    this.hud.setDuoStatus('', 'idle');
    this.menuT = 0;
    this.clock.getDelta();
  }

  start() {
    if (this.duoSession) this.cancelDuo();
    this.sfx.unlock();
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.resetRun();
    this.player.duoDown = false;
    this.state = 'playing';
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.zombies.startWave(1);
    this.scheduleTutorial();
    this.clock.getDelta();
    this.deathT = 0;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.loop);
    }
  }

  // 调试用：在出生点右侧放一个队友（戴夫化 Farmer）。联网层接上后由网络位置驱动。
  spawnRemotePlayer(opts = {}) {
    if (!this.map) return null;
    const map = this.map;
    const x = opts.x !== undefined ? opts.x : map.spawn.x + 2.6;
    const z = opts.z !== undefined ? opts.z : map.spawn.z - 1.4;
    const yaw = opts.yaw !== undefined ? opts.yaw : Math.atan2(this.player.pos.x - x, this.player.pos.z - z);
    const r = new RemotePlayer({
      scene: this.scene,
      env: this.ctx.env,
      name: opts.name || '队友',
      x,
      z,
      y: opts.y !== undefined ? opts.y : 0,
      yaw,
    });
    this.remotes.push(r);
    return r;
  }

  clearRemotes() {
    for (let i = 0; i < this.remotes.length; i++) this.remotes[i].dispose();
    this.remotes.length = 0;
    this.netGuest = null;
    this.netControls = null;
    this.netFiring = false;
    this.lastGuestSeq = 0;
    this.lastGuestInputAt = 0;
    if (this.zombies) {
      this.zombies.setRemote(false);
      this.zombies.setDuo(false);
      this.zombies.onNetSpawn = null;
      this.zombies.onNetDead = null;
    }
    if (this.pickups) {
      this.pickups.setShared(false);
      this.pickups.onChange = null;
      this.pickups.onClaim = null;
      this.pickups.onDrop = null;
      this.pickups.onLocalPickup = null;
    }
    if (this.skySun) this.skySun.interval = SUN_SKY.interval;
  }

  isGuestWorld() {
    return !!(this.duo && this.seat === 1);
  }

  setupDuoWorld() {
    const host = this.seat === 0;
    this.zombies.setRemote(!host);
    this.zombies.setDuo(host);
    this.zombies.onNetSpawn = host
      ? (z) => {
          if (this.duoSession) this.duoSession.sendZombieSpawn(z);
        }
      : null;
    this.zombies.onNetDead = host
      ? (z) => {
          if (this.duoSession) this.duoSession.sendZombieDead(z);
        }
      : null;
    // 共享补给：host 权威刷/捡/丢并广播列表；guest 只镜像 + claim。
    if (host) {
      this.pickups.setShared(false);
      this.pickups.onChange = (list) => {
        if (this.duoSession) this.duoSession.sendPickups(list);
      };
      this.pickups.onLocalPickup = (item, index) => {
        if (item.air) this.grantAirdrop(0);
        if (this.duoSession) {
          this.duoSession.sendEvent({ type: 'pickup', id: item.id, seat: 0, index, air: item.air ? 1 : 0 });
        }
      };
    } else {
      this.pickups.setShared(true);
      this.pickups.onClaim = (id) => {
        if (this.duoSession) this.duoSession.sendClaim('pickup', id);
      };
      this.pickups.onDrop = (index, x, z) => {
        if (this.duoSession) this.duoSession.sendPickupDrop(index, x, z);
      };
    }
    if (host) this.zombies.startWave(1);
  }

  async toggleDuo() {
    if (this.state !== 'menu') return;
    if (this.duoSession) {
      this.cancelDuo();
      return;
    }
    if (this.duoPending) return;
    this.duoPending = true;
    this.hud.setDuoMode(true);
    this.hud.setDuoStatus('正在连接服务器…', 'wait');
    try {
      const { DuoSession } = await import('./net/DuoSession.js');
      if (this.state !== 'menu') {
        this.hud.setDuoMode(false);
        this.hud.setDuoStatus('', 'idle');
        return;
      }
      this.duoSession = new DuoSession(this);
      this.duoSession.start({ name: '戴夫', mapId: this.mapId });
    } catch (e) {
      console.error(e);
      this.hud.setDuoStatus('联机模块加载失败，请刷新重试', 'warn');
      this.hud.setDuoMode(false);
    } finally {
      this.duoPending = false;
    }
  }

  copyDuoLink() {
    const url = this.hud.duoShareUrl;
    if (!url) return;
    const ok = () => this.hud.setDuoStatus('邀请链接已复制，发给朋友即可', 'ok');
    const fail = () => this.hud.setDuoStatus('复制失败，请手动复制：' + url, 'warn');
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, fail);
    } else {
      fail();
    }
  }

  cancelDuo() {
    const s = this.duoSession;
    this.duoSession = null;
    if (s) s.close();
    this.duo = null;
    this.seat = -1;
    this.remote = null;
    this.hud.setDuoMode(false);
    this.hud.setDuoStatus('', 'idle');
  }

  onDuoClosed(session) {
    if (this.duoSession !== session) return;
    this.duoSession = null;
    this.hud.setDuoMode(false);
    if (this.duo && this.state !== 'menu') this.endDuo('closed');
  }

  startDuo({ mapId, seat, peerName, seed, t0 }) {
    if (this.state !== 'menu' || this.duo) return;
    this.duo = { seat, peerName, seed, t0 };
    this.seat = seat;
    this.setMap(mapId);
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.hud.setDuoMode(false);
    this.hud.setDuoStatus('', 'idle');
    this.resetRun();
    this.player.reset(duoSpawn(this.map, seat));
    this.player.duoDown = true;
    this.respawnRemote();
    this.setupDuoWorld();
    this.reviveA = 0;
    this.reviveB = 0;
    this.wasADown = false;
    this.wasBDown = false;
    this.remoteDown = false;
    this.state = 'playing';
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.clock.getDelta();
    if (this.pendingResync) this.applyResync(this.pendingResync);
  }

  respawnRemote() {
    if (!this.duo || !this.map) return;
    const s = duoSpawn(this.map, 1 - this.seat);
    this.remote = this.spawnRemotePlayer({
      name: this.duo.peerName,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
    });
    if (this.seat === 0) this.createNetGuest();
  }

  // 房主专属：guest 的无渲染代理。用真实的 Player 跑移动/跳跃/平台/僵尸碰撞，
  // 但 sfx=null、onDamage/onDeath 不接任何东西，避免客人受伤震房主的屏或结束房主的局。
  createNetGuest() {
    const s = duoSpawn(this.map, 1 - this.seat);
    this.netGuest = new Player(null);
    this.netGuest.reset({ x: s.x, z: s.z, yaw: s.yaw });
    this.netGuest.duoDown = true;
    this.netGuest.shieldMoveMul = 0.88;
    // guest 的坚果盾：host 侧权威扣血（guest 本地不再挨打），盾血经 pstate 回传
    const nutDef = WEAPONS.find((w) => w.id === 'wallnut');
    this.netGuest.shield = new RemoteShield(nutDef ? nutDef.shieldHp : 400);
    // 还没举盾：host 的血池从 0 起，等 guest 第一次 active 再灌满
    this.netGuest.shield.hp = 0;
    this.netGuest.onDamage = null;
    this.netGuest.onDeath = null;
    this.netControls = {
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      jumpQueued: false,
      firing: false,
      consumeLook() {
        const l = { x: this.look.x, y: this.look.y };
        this.look.x = 0;
        this.look.y = 0;
        return l;
      },
      consumeJump() {
        const j = this.jumpQueued;
        this.jumpQueued = false;
        return j;
      },
    };
    this.netFiring = false;
    this.lastGuestSeq = 0;
    this.lastGuestInputAt = 0;
    this.guestHit.clear();
  }

  syncNetGuest() {
    const g = this.netGuest;
    if (!g || !this.remote) return;
    const speed = TUNING.playerSpeed * (g.moveAmt || 0) * (g.speedMul || 1);
    this.remote.setTransform(g.pos.x, g.pos.z, g.yaw, g.pos.y);
    this.remote.setMoving((g.moveAmt || 0) > 0.1, speed);
    const firing = !!(this.netControls && this.netControls.firing);
    if (firing && !this.netFiring) this.remote.setFiring();
    this.netFiring = firing;
  }

  applyGuestInput(d) {
    if (!d || !this.duo || this.seat !== 0 || !this.netControls) return;
    const m = d.m;
    if (Array.isArray(m) && m.length === 2) {
      const mx = Number(m[0]);
      const mz = Number(m[1]);
      if (Number.isFinite(mx) && Number.isFinite(mz)) {
        this.netControls.move.x = Math.max(-1, Math.min(1, mx));
        this.netControls.move.y = Math.max(-1, Math.min(1, mz));
      }
    }
    const look = d.look;
    if (Array.isArray(look) && look.length === 2) {
      const lx = Number(look[0]);
      const ly = Number(look[1]);
      if (Number.isFinite(lx) && Number.isFinite(ly)) {
        this.netControls.look.x += Math.max(-0.5, Math.min(0.5, lx));
        this.netControls.look.y += Math.max(-0.5, Math.min(0.5, ly));
      }
    }
    if (d.jump) this.netControls.jumpQueued = true;
    this.netControls.firing = !!d.fire;
    if (this.netGuest && this.netGuest.shield) {
      const sh = this.netGuest.shield;
      const want = !!d.shield;
      // 重新举盾（本地已经花掉一颗坚果）：host 的血池跟着重置
      if (want && !sh.active && sh.hp <= 0) sh.hp = sh.maxHp;
      sh.active = want;
      // guest 自报的盾血只能用来“证明自己更少”，不许把 host 的血池抬高
      const rep = Number(d.sh);
      // 0 表示「本地还没举盾」或「已经碎了」，都不该把 host 刚灌满的血池压回 0
      if (Number.isFinite(rep) && rep > 0) sh.hp = Math.min(sh.hp, rep);
    }
    this.lastGuestSeq = Number(d.seq) || 0;
    this.lastGuestInputAt = Date.now();
  }

  applyPeerState(d) {
    if (!d || !this.duo || this.seat !== 1) return;
    this.lastWorldSeq = Number(d.seq) || 0;
    if (typeof d.sun === 'number') {
      this.sun = d.sun;
      this.hud.setSun(this.sun);
    }
    if (Array.isArray(d.scores) && d.scores.length === 2) {
      this.stats.score = d.scores[1];
      this.hud.setScore(d.scores[1]);
    }
    if (Array.isArray(d.kills) && d.kills.length === 2) {
      this.stats.kills = d.kills[1];
      this.hud.setKills(d.kills[1]);
    }
    if (d.h) this.applyRemoteState(d.h);
    if (d.g) this.applyGuestAuth(d.g);
    if (Array.isArray(d.o)) this.sunOrbs.applyNet(d.o);
    this.applyWorldState(d);
  }

  applyWorldState(d) {
    if (typeof d.wave === 'number' && d.wave !== this.zombies.wave) {
      this.zombies.wave = d.wave;
      this.hud.setWave(d.wave);
      this.hud.showBanner('第 ' + d.wave + ' 波', 2);
    }
    if (Array.isArray(d.z)) this.zombies.netSnapshot(d.z);
    if (typeof d.bossHp === 'number') {
      if (d.bossHp > 0) {
        this.hud.setBossVisible(true);
        this.hud.setBossHp(d.bossHp);
      } else {
        this.hud.setBossVisible(false);
      }
    }
  }

  applyWorldEvent(d) {
    if (!d) return;
    if (d.type === 'zspawn' && d.z) this.zombies.netSpawn(d.z);
    else if (d.type === 'zdead' && d.id) this.zombies.netDespawn(d.id);
    else if (d.type === 'pickups' && Array.isArray(d.list)) this.pickups.applyNetList(d.list);
    else if (d.type === 'pickup' && d.id) this.applyPickupEvent(d);
    else if (d.type === 'sun' && d.id) {
      const orb = this.sunOrbs.collectById(d.id);
      if (orb) this.sfx.pickup();
    } else if (d.type === 'air') {
      const x = Number(d.x);
      const z = Number(d.z);
      if (Number.isFinite(x) && Number.isFinite(z)) this.pickups.beamAt(x, z, AIRDROP.warn);
    }
  }

  // 共享补给的领取事件：拿的人本地入槽，另一人只看到提示与物品消失。
  applyPickupEvent(d) {
    const index = Number(d.index);
    const def = WEAPONS[index];
    if (!def) return;
    if (d.seat === this.seat) {
      if (this.seat === 1) this.weapons.pickup(index);
      if (d.air) this.hud.showBanner('你抢到了空投 +' + AIRDROP.score, 2);
    } else {
      this.hud.showBanner(d.air ? '队友抢到了空投' : '队友拿到了 ' + def.name, 1.6);
    }
    this.pickups.removeById(d.id);
  }

  // guest 的补给 claim：host 用 guest 代理位置校验距离，不信任客户端坐标。
  applyGuestClaim(d) {
    if (!d || !this.duo || this.seat !== 0 || !this.netGuest) return;
    if ((d.kind || 'pickup') === 'sun') {
      const orb = this.sunOrbs.orbs.find((o) => o.active && o.id === d.id);
      if (!orb) return;
      // host 用代理位置校验：不在磁吸范围内就不认
      const dist = Math.hypot(this.netGuest.pos.x - orb.pos.x, this.netGuest.pos.z - orb.pos.z);
      if (dist > 2.2) return;
      this.sunOrbs.collectById(d.id);
      this.addSun(TUNING.sunPerOrb);
      if (this.duoSession) this.duoSession.sendEvent({ type: 'sun', id: d.id });
      return;
    }
    if ((d.kind || 'pickup') !== 'pickup') return;
    const item = this.pickups.byId(d.id);
    if (!item || !item.active) return;
    const dist = Math.hypot(
      this.netGuest.pos.x - item.group.position.x,
      this.netGuest.pos.z - item.group.position.z
    );
    if (dist > 2.4) return;
    const index = item.index;
    if (!WEAPONS[index]) return;
    const air = !!item.air;
    this.pickups.removeById(d.id);
    if (air) this.grantAirdrop(1);
    else this.hud.showBanner('队友拿到了 ' + WEAPONS[index].name, 1.6);
    if (this.duoSession) {
      this.duoSession.sendEvent({ type: 'pickup', id: d.id, seat: 1, index, air: air ? 1 : 0 });
      this.duoSession.sendPickups(this.pickups.netList());
    }
  }

  // guest 丢枪：host 在权威世界里落地一把，再广播列表。
  applyGuestDrop(d) {
    if (!d || !this.duo || this.seat !== 0 || !this.netGuest) return;
    const index = Number(d.i);
    if (!WEAPONS[index]) return;
    const x = Number(d.x);
    const z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (Math.hypot(this.netGuest.pos.x - x, this.netGuest.pos.z - z) > 3.5) return;
    this.pickups.dropAt(index, x, z);
  }

  // guest 的命中请求：host 用 guest 代理的视线 + 武器重算，不信任 guest 的 dmg/head。
  applyGuestHit(d) {
    if (!d || !this.duo || this.seat !== 0 || !this.netGuest) return;
    const def = WEAPONS.find((w) => w.id === d.w);
    if (!def) return;
    const z = this.zombies.zombies.find((x) => x.netId === d.zid);
    if (!z || !z.alive || z.dying) return;

    const snap = this.duoSession && this.duoSession.getZombieAt(d.zid, d.seq);
    const sx = snap ? snap.x : z.root.position.x;
    const sy = snap ? snap.y : z.root.position.y;
    const sz = snap ? snap.z : z.root.position.z;
    const dir = new THREE.Vector3(
      Number(d.dir && d.dir[0]) || 0,
      Number(d.dir && d.dir[1]) || 0,
      Number(d.dir && d.dir[2]) || 0
    );
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();

    const origin = new THREE.Vector3(this.netGuest.pos.x, this.netGuest.pos.y + TUNING.playerHeight, this.netGuest.pos.z);
    // 方向必须落在 guest 代理当前视线的锥内，防止“背对目标也能命中”。
    const cp = Math.cos(this.netGuest.pitch);
    const fx = -Math.sin(this.netGuest.yaw) * cp;
    const fy = Math.sin(this.netGuest.pitch);
    const fz = -Math.cos(this.netGuest.yaw) * cp;
    if (fx * dir.x + fy * dir.y + fz * dir.z < Math.cos(0.4)) return;

    const end = origin.clone().addScaledVector(dir, 80);
    const rs = z.hitRadiusScale || 1;
    const tc = segmentSphereT(origin, end, new THREE.Vector3(sx, sy + z.chestY * z.scaleFactor, sz), 0.46 * z.scaleFactor * rs + 0.14);
    const th = segmentSphereT(origin, end, new THREE.Vector3(sx, sy + z.headY * z.scaleFactor, sz), 0.36 * z.scaleFactor * rs);
    let t = -1;
    let head = false;
    if (th >= 0 && (tc < 0 || th <= tc)) {
      t = th;
      head = true;
    } else if (tc >= 0) {
      t = tc;
    }
    if (t < 0) return;

    const bounds = this.map.bounds || { x: 23, z: 23 };
    const hitPoint = origin.clone().addScaledVector(dir, 80 * t);
    const n = new THREE.Vector3();
    if (sweepWalls(this.map.walls || [], bounds.x, bounds.z, origin, hitPoint, 0.05, n) >= 0) return;

    const aerial = typeof def.aerial === 'number' ? def.aerial : def.aerial ? 1 : 0;
    if (z.airborne && !(aerial > 0)) {
      const high = this.netGuest.pos.y >= 0.9 && Math.hypot(sx - this.netGuest.pos.x, sz - this.netGuest.pos.z) <= 3.2;
      if (!high) return;
    }

    const now = Date.now();
    const rec = this.guestHit.get(def.id) || { t: 0, n: 0 };
    const maxHits = Math.max(def.shots || 1, (def.pierce || 0) + 1);
    if (now - rec.t < (def.cooldown || 0.2) * 800) {
      if (rec.n >= maxHits) return;
      rec.n++;
    } else {
      rec.t = now;
      rec.n = 1;
    }
    this.guestHit.set(def.id, rec);

    const aerialMul = z.airborne && aerial > 0 ? aerial : 1;
    const damage = def.damage * (head ? TUNING.headshotMul : 1) * aerialMul;
    const killed = z.hit(damage, def.slow, head, {
      type: def.pierce ? 'pierce' : 'pea',
      burn: def.burn,
      armorBreak: def.armorBreak,
      source: 1,
    });
    if (killed) this.zombies.handleKill(z, head);
  }

  applyGuestAoe(d) {
    if (!d || !this.duo || this.seat !== 0) return;
    const def = WEAPONS.find((w) => w.id === d.w);
    if (!def || !def.radius) return;
    const x = Number(d.x);
    const y = Number(d.y);
    const z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const now = Date.now();
    const key = 'aoe:' + def.id;
    const rec = this.guestHit.get(key) || { t: 0, n: 0 };
    if (now - rec.t < (def.cooldown || 0.5) * 800) {
      if (rec.n >= 1) return;
    }
    rec.t = now;
    rec.n = 1;
    this.guestHit.set(key, rec);
    this.zombies.damageArea(new THREE.Vector3(x, Math.max(0.4, y), z), def.radius, def.damage, null, 1, 1);
  }

  // 客人本地预测 + 房主权威位置软校正：0.2m 内不动，0.2~1.5m 平滑拉回，>1.5m 直接吸附。
  applyGuestAuth(g) {
    const p = this.player;
    if (typeof g.hp === 'number') {
      const wasDown = p.downed;
      p.hp = Math.max(0, Math.min(p.maxHp, g.hp));
      p.downed = !!g.down;
      p.downTimer = Number(g.downT) || 0;
      if (!wasDown && p.downed) this.hud.showBanner('你倒下了，队友靠近 2.5 秒可救起', 3);
      else if (wasDown && !p.downed) this.hud.showBanner('队友把你救起来了', 2);
    }
    // 盾血以 host 为准。host 的 0 既可能是「还没举盾」也可能是「刚碎」：
    // 只有先收到过正数、再变 0 才判定为碎盾，避免刚举盾那 50 ms 被误判。
    if (typeof g.sh === 'number' && this.wallNuts) {
      const sh = Math.max(0, Math.min(this.wallNuts.maxHp, g.sh));
      if (sh > 0) {
        this.netShieldHp = sh;
        this.wallNuts.hp = sh;
      } else if (this.netShieldHp > 0) {
        this.netShieldHp = 0;
        this.wallNuts.hp = 0;
        this.wallNuts.breakShield();
      }
    }
    const x = Number(g.x);
    const z = Number(g.z);
    const y = Number(g.y) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const err = Math.hypot(x - p.pos.x, z - p.pos.z);
    if (err > 1.5) {
      p.pos.x = x;
      p.pos.y = y;
      p.pos.z = z;
    } else if (err > 0.2) {
      const k = 0.35;
      p.pos.x += (x - p.pos.x) * k;
      p.pos.y += (y - p.pos.y) * k;
      p.pos.z += (z - p.pos.z) * k;
    }
  }

  applyRemoteState(d) {
    if (!this.remote || !d) return;
    if (d.down !== undefined) {
      if (d.down && !this.remoteDown) this.hud.showBanner('队友倒下了！靠近 2.5 秒可救起', 3);
      else if (!d.down && this.remoteDown) this.hud.showBanner('队友站起来了', 2);
      this.remoteDown = !!d.down;
    }
    const x = Number(d.x);
    const z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.remote.setTarget(x, z, Number(d.yaw) || 0, Number(d.y) || 0);
    this.remote.setMoving(!!d.moving, Number(d.speed) || 0);
    if (d.firing && !this.remoteFiring) this.remote.setFiring();
    this.remoteFiring = !!d.firing;
  }

  updateDuoRescue(dt) {
    if (!this.duo || !this.netGuest || this.state !== 'playing') return;
    const a = this.player;
    const b = this.netGuest;
    if (a.downed) a.downTimer -= dt;
    if (b.downed) b.downTimer -= dt;
    if ((a.downed && a.downTimer <= 0) || (b.downed && b.downTimer <= 0)) {
      this.duoWipe();
      return;
    }
    const near = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) <= 3;
    if (a.downed && !b.downed && near) {
      this.reviveA += dt;
      if (this.reviveA >= 2.5) {
        a.revive();
        this.reviveA = 0;
        this.hud.showBanner('队友把你救起来了', 2);
      }
    } else {
      this.reviveA = 0;
    }
    if (b.downed && !a.downed && near) {
      this.reviveB += dt;
      if (this.reviveB >= 2.5) {
        b.revive();
        this.reviveB = 0;
        this.hud.showBanner('你把队友救起来了', 2);
      }
    } else {
      this.reviveB = 0;
    }
    if (a.downed && !this.wasADown) this.hud.showBanner('你倒下了，队友靠近 2.5 秒可救起', 3);
    if (b.downed && !this.wasBDown) this.hud.showBanner('队友倒下了！靠近 2.5 秒可救起', 3);
    this.wasADown = a.downed;
    this.wasBDown = b.downed;
  }

  duoWipe() {
    if (this.state !== 'playing') return;
    const result = { scores: this.duoStats.slice(), kills: this.duoKills.slice() };
    if (this.duoSession) this.duoSession.sendWipe(result.scores, result.kills);
    this.finishDuoRound(result, 'WIPE');
  }

  // 对局结束但**不关会话**：双方都停在结算页，等「再来一局」或离开。
  finishDuoRound(result, reason) {
    if (this.state === 'over' || this.state === 'menu' || !this.duo) return;
    this.state = 'over';
    this.controls.setEnabled(false);
    this.controls.exitLock();
    this.hud.setBossVisible(false);
    this.hud.showDuoResult({
      scores: result && result.scores ? result.scores : this.duoStats.slice(),
      kills: result && result.kills ? result.kills : this.duoKills.slice(),
      seat: this.seat,
      wave: this.stats.wave,
      peerName: this.duo.peerName,
      reason,
    });
    this.clock.getDelta();
  }

  onDuoWipe(d) {
    if (!this.duo) return;
    this.finishDuoRound(d, 'WIPE');
  }

  requestDuoRematch() {
    if (!this.duoSession || this.state !== 'over') return;
    if (this.duoSession.sendRematch()) this.hud.setDuoResultStatus('等待队友点「再来一局」…');
  }

  // 再来一局：同一场对局内换种子 + 换座位（服务器已交换 seat）。
  startDuoRound({ mapId, seat, seed, t0, round }) {
    if (!this.duoSession || !this.duo) return;
    const peerName = this.duo.peerName;
    this.duo = { seat, peerName, seed, t0, round };
    this.seat = seat;
    // setMap 只允许在 menu 状态调用；先借一下再回到 playing
    this.state = 'menu';
    this.setMap(mapId || this.mapId);
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.resetRun();
    this.player.reset(duoSpawn(this.map, seat));
    this.player.duoDown = true;
    this.respawnRemote();
    this.setupDuoWorld();
    this.reviveA = 0;
    this.reviveB = 0;
    this.wasADown = false;
    this.wasBDown = false;
    this.remoteDown = false;
    this.state = 'playing';
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.clock.getDelta();
    if (this.pendingResync) this.applyResync(this.pendingResync);
  }

  onPeerLeft(seconds) {
    if (this.duo) this.hud.showBanner('队友掉线，等待重连 ' + seconds + 's', 3);
  }

  onPeerJoined(name) {
    if (!this.duo) return;
    this.hud.showBanner(name + ' 已重连', 2);
    // 客人刷新后本地世界是空的：host 把整局状态补发过去
    if (this.seat === 0 && this.duoSession) this.duoSession.sendResync(this.buildResync());
  }

  buildResync() {
    const boss = this.zombies ? this.zombies.boss : null;
    return {
      wave: this.zombies ? this.zombies.wave : 0,
      sun: Math.round(this.sun || 0),
      scores: this.duoStats ? this.duoStats.slice() : [0, 0],
      kills: this.duoKills ? this.duoKills.slice() : [0, 0],
      bossHp: boss ? Math.max(0, boss.hp / boss.maxHp) : 0,
      z: this.zombies && this.zombies.zombies ? this.zombies.zombies.map((z) => z.serialize()) : [],
      pickups: this.pickups ? this.pickups.netList() : [],
      orbs: this.sunOrbs ? this.sunOrbs.serialize() : [],
    };
  }

  // 客人刷新/重连后应用 host 的完整快照；还没进局就先缓存，等 startDuo 之后再吃。
  applyResync(d) {
    if (!d) return;
    if (!this.duo || this.seat !== 1) {
      this.pendingResync = d;
      return;
    }
    this.pendingResync = null;
    this.zombies.reset();
    if (typeof d.wave === 'number') {
      this.zombies.wave = d.wave;
      this.stats.wave = d.wave;
      this.hud.setWave(d.wave);
    }
    if (typeof d.sun === 'number') {
      this.sun = d.sun;
      this.hud.setSun(this.sun);
    }
    if (Array.isArray(d.scores)) {
      this.duoStats = d.scores.slice();
      this.stats.score = this.duoStats[this.seat] || 0;
      this.hud.setScore(this.stats.score);
    }
    if (Array.isArray(d.kills)) {
      this.duoKills = d.kills.slice();
      this.stats.kills = this.duoKills[this.seat] || 0;
      this.hud.setKills(this.stats.kills);
    }
    if (Array.isArray(d.z)) {
      for (let i = 0; i < d.z.length; i++) this.zombies.netSpawn(d.z[i]);
    }
    if (Array.isArray(d.pickups)) this.pickups.applyNetList(d.pickups);
    if (Array.isArray(d.orbs)) this.sunOrbs.applyNet(d.orbs);
    if (typeof d.bossHp === 'number' && d.bossHp > 0) {
      this.hud.setBossVisible(true);
      this.hud.setBossHp(d.bossHp);
    }
  }

  endDuo(reason, result) {
    if (this.hud && this.hud.duoOverScreen) this.hud.duoOverScreen.classList.add('hidden');
    const seat = this.seat;
    const s = this.duoSession;
    this.duoSession = null;
    if (s) s.close();
    const hadDuo = !!this.duo;
    this.duo = null;
    this.seat = -1;
    this.remote = null;
    if (this.state !== 'menu') this.backToMenu();
    this.hud.setDuoMode(false);
    if (hadDuo) {
      let text =
        reason === 'PEER_TIMEOUT' || reason === 'peer-timeout'
          ? '队友掉线，对局结束'
          : reason === 'PEER_LEFT' || reason === 'peer-left'
            ? '队友离开了，对局结束'
            : reason === 'HOST_RESET' || reason === 'host-reset'
              ? '房主刷新，对局结束'
              : reason === 'WIPE'
                ? '两人都倒下了，对局结束'
                : reason === 'LEFT'
                  ? '你离开了对局'
                  : '联机已断开，对局结束';
      if (result && Array.isArray(result.scores)) {
        const local = seat === 1 ? 1 : 0;
        const other = 1 - local;
        const ls = result.scores[local] || 0;
        const os = result.scores[other] || 0;
        const lk = result.kills ? result.kills[local] || 0 : 0;
        const ok = result.kills ? result.kills[other] || 0 : 0;
        text = '本局得分 你 ' + ls + ' : ' + os + ' 队友（击杀 ' + lk + ':' + ok + '）';
      }
      this.hud.setDuoStatus(text, 'warn');
    }
  }

  resetRun() {
    // 先清 HUD 再重建武器槽：weapons.reset() 会把豌豆/坚果写回槽位并刷新底栏，
    // 顺序反了会把刚装好的 5 号槽重新抹成空。
    this.clearRemotes();
    this.remote = null;
    this.remoteFiring = false;
    this.hud.reset();
    this.player.reset(this.map.spawn);
    this.weapons.reset();
    this.zombies.reset();
    this.projectiles.clear();
    this.particles.clear();
    this.sunOrbs.clear();
    this.skySun.reset();
    // 双人：guest 不本地刷补给，只镜像 host 的列表（见 §5.3 全队唯一、先到先得）
    this.pickups.setShared(!!this.duo && this.seat === 1);
    this.pickups.reset();
    this.stats = { score: 0, kills: 0, wave: 0 };
    this.duoStats = [0, 0];
    this.duoKills = [0, 0];
    this.netShieldHp = 0;
    this.airdropWave = -1;
    this.airdropT = 0;
    this.airdropBeam = false;
    this.airdropDropped = false;
    this.airdropSpot = null;
    // 双人：共享阳光池更大（80 / 400），天降更频繁；单人保持原值。
    this.maxSun = this.duo ? DUO.maxSun : TUNING.maxSun;
    this.sun = this.duo ? DUO.startSun : TUNING.startSun;
    this.skySun.interval = this.duo ? DUO.skySunInterval : SUN_SKY.interval;
    if (this.duo) this.sunOrbs.ensureCapacity(DUO.sunOrbPool);
    this.shakeAmp = 0;
    this.hud.setSun(this.sun, true);
    this.hud.setHealth(this.player.hp, this.player.maxHp);
  }

  restart() {
    if (this.duo) {
      this.hud.hideScreens();
      this.hud.showHud(true);
      this.resetRun();
      this.player.reset(duoSpawn(this.map, this.seat));
      this.player.duoDown = true;
      this.respawnRemote();
      this.setupDuoWorld();
      this.reviveA = 0;
      this.reviveB = 0;
      this.wasADown = false;
      this.wasBDown = false;
      this.remoteDown = false;
      this.state = 'playing';
      this.controls.setEnabled(true);
      this.controls.requestLock();
      this.clock.getDelta();
      return;
    }
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.resetRun();
    this.player.duoDown = false;
    this.state = 'playing';
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.zombies.startWave(1);
    this.scheduleTutorial();
    this.clock.getDelta();
  }

  scheduleTutorial() {
    clearTimeout(this.tutorialTimer);
    this.hud.fadeTutorial();
    const self = this;
    this.tutorialTimer = setTimeout(function () {
      if (self.state === 'playing') self.hud.showTutorial();
    }, 2800);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hud.fadeDesktopHint(), 9000);
  }

  pause(fromNet = false) {
    if (this.state !== 'playing') return;
    if (this.duo && !fromNet && this.duoSession) this.duoSession.sendPause(true);
    this.state = 'paused';
    this.hud.showPause();
    this.hud.showHud(false);
    this.controls.setEnabled(false);
    this.controls.exitLock();
  }

  resume(fromNet = false) {
    if (this.state !== 'paused') return;
    if (this.duo && !fromNet && this.duoSession) this.duoSession.sendPause(false);
    this.state = 'playing';
    this.hud.hidePause();
    this.hud.showHud(true);
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.clock.getDelta();
  }

  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.deathT = 0;
    this.controls.setEnabled(false);
    this.controls.exitLock();
    this.sfx.death();
    this.hud.setBossVisible(false);
    this.hud.showHud(false);
    const self = this;
    setTimeout(function () {
      self.hud.showGameOver(self.stats.score, Math.max(1, self.stats.wave), self.stats.kills);
    }, 800);
  }

  addSun(n) {
    this.sun = Math.min(this.maxSun, this.sun + n);
    this.hud.setSun(this.sun);
    this.sfx.pickup();
  }

  spendSun(n) {
    if (n <= 0) return true;
    // guest 的池子是 host 的：本地先预测扣款，host 收到 sun 请求后再以 pstate.sun 校正。
    if (this.duo && this.seat === 1) {
      if (this.sun < n) return false;
      this.sun -= n;
      this.hud.setSun(this.sun);
      if (this.duoSession) this.duoSession.sendSunRequest(n);
      return true;
    }
    if (this.sun < n) return false;
    this.sun -= n;
    this.hud.setSun(this.sun);
    return true;
  }

  shake(amount) {
    this.shakeAmp = Math.min(1.4, this.shakeAmp + amount);
  }

  onKill(z, score, headshot, source = 0) {
    if (this.duo) {
      const s = source === 1 ? 1 : 0;
      this.duoStats[s] += score;
      // 悬赏尾刀：+300 只记在击杀者账上，按击杀判定的同一套 source
      if (z && z.bounty) {
        this.duoStats[s] += BOUNTY.bonus;
        this.hud.showBanner('悬赏拿下 +' + BOUNTY.bonus, 1.8);
      }
      this.duoKills[s] += 1;
      this.stats.score = this.duoStats[0];
      this.stats.kills = this.duoKills[0];
      this.hud.setScore(this.seat === 0 ? this.duoStats[0] : this.duoStats[1]);
      this.hud.setKills(this.seat === 0 ? this.duoKills[0] : this.duoKills[1]);
    } else {
      this.stats.score += score;
      this.stats.kills += 1;
      this.hud.setScore(this.stats.score);
      this.hud.setKills(this.stats.kills);
    }
    if (this.stats.kills === 1) this.hud.fadeTutorial();
    if (z.def && z.def.boss) this.shake(0.9);
  }

  updateAirdrop(dt) {
    if (!this.duo || this.seat !== 0 || !this.zombies || this.state !== 'playing') return;
    const wave = this.zombies.wave;
    if (wave !== this.airdropWave) {
      this.airdropWave = wave;
      this.airdropT = 0;
      this.airdropBeam = false;
      this.airdropDropped = false;
      this.airdropSpot = null;
    }
    if (!wave || wave % AIRDROP.everyWaves !== 0 || this.airdropDropped) return;
    this.airdropT += dt;
    if (!this.airdropBeam && this.airdropT >= AIRDROP.delay - AIRDROP.warn) {
      const spot = this.pickups.pickAirSpot();
      if (!spot) return;
      this.airdropBeam = true;
      this.airdropSpot = spot;
      this.pickups.beamAt(spot[0], spot[1], AIRDROP.warn);
      if (this.duoSession) this.duoSession.sendEvent({ type: 'air', x: spot[0], z: spot[1] });
      this.hud.showBanner('空投即将落地', 2);
    }
    if (this.airdropT >= AIRDROP.delay && this.airdropSpot) {
      const id = AIRDROP.weapons[Math.floor(Math.random() * AIRDROP.weapons.length)];
      const index = WEAPONS.findIndex((w) => w.id === id);
      if (index >= 0) {
        this.pickups.spawnAir(index, this.airdropSpot[0], this.airdropSpot[1]);
        this.airdropDropped = true;
        this.hud.showBanner('空投已落地：' + WEAPONS[index].name, 2);
        if (this.duoSession) this.duoSession.sendPickups(this.pickups.netList());
      }
    }
  }

  // 空投归属：拾取者 +200 个人分、全队 +40 阳光（先到先得）
  grantAirdrop(seat) {
    this.duoStats[seat] += AIRDROP.score;
    this.addSun(AIRDROP.sun);
    this.hud.showBanner((seat === this.seat ? '你' : '队友') + '抢到了空投 +' + AIRDROP.score, 2);
  }

  onWaveStart(n) {
    this.stats.wave = n;
    this.hud.setWave(n);
    const bossType = bossForWave(n);
    const bossName = bossType ? ZOMBIES[bossType].title : '';
    this.hud.showBanner(
      bossType ? '第 ' + n + ' 波 · ' + bossName + '来袭' : '第 ' + n + ' 波',
      2.4
    );
    this.sfx.waveStart(!!bossType);
  }

  onWaveClear(n) {
    this.stats.score += 150 * n;
    this.hud.setScore(this.stats.score);
    this.player.heal(14);
    this.hud.showBanner('第 ' + n + ' 波 守住了!', 2.0);
    this.sfx.waveClear();
  }

  onZombieAttack(z) {
    if (this.state !== 'playing') return;
    const target = z.targetSeat === 1 ? this.netGuest : this.player;
    if (!target || target.dead || target.downed) return;
    target.damage(z.def.damage, { airborne: !!z.airborne });
    if (z.def && z.def.boss) this.shake(0.35);
  }

  onBossSpawn(z) {
    this.hud.setBossVisible(true);
    this.hud.setBossHp(1);
    this.hud.showBanner((z && z.def && z.def.title ? z.def.title : 'BOSS') + '出现了!', 2.4);
    this.shake(0.7);
  }

  onBossDead(z) {
    this.hud.setBossVisible(false);
    const title = z && z.def && z.def.title ? z.def.title : 'BOSS';
    this.hud.showBanner(title + '倒下了!', 2.0);
    this.shake(0.8);
  }

  onExplosion(pos, radius) {
    const dist = Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
    this.shake(clamp(1 - dist / 16, 0, 1) * 1.2);
  }

  update(dt) {
    this.controls.update();
    this.player.update(dt, this.controls, this.map, this.zombies.zombies);
    if (this.duoSession) this.duoSession.captureInput();
    this.player.applyCamera(this.camera);
    this.applyShake(dt);
    if (!this.player.downed) this.weapons.update(dt, this.controls);
    this.wallNuts.update(dt);
    if (this.map.updateNav && !this.isGuestWorld()) this.map.updateNav(this.player, dt);
    this.zombies.update(dt, this.player, this.map.colliders, this.netGuest ? [this.player, this.netGuest] : null);
    if (this.netGuest && this.netControls) {
      // 客人掉线/卡住时 input 会停；300ms 没新包就把移动与开火归零，别让代理一直往前走。
      if (this.lastGuestInputAt && Date.now() - this.lastGuestInputAt > 300) {
        this.netControls.move.x = 0;
        this.netControls.move.y = 0;
        this.netControls.firing = false;
        this.netControls.jumpQueued = false;
      }
      this.netGuest.update(dt, this.netControls, this.map, this.zombies.zombies);
      this.syncNetGuest();
      this.updateDuoRescue(dt);
    }
    this.projectiles.update(dt);
    if (!this.isGuestWorld()) {
      this.skySun.ctx.map = this.map;
      this.skySun.update(dt);
      this.sunOrbs.update(dt, this.player);
      this.updateAirdrop(dt);
    } else {
      // guest：球由 host 模拟，本地只渲染 + 发 claim
      this.sunOrbs.updateRemote(dt, this.player, (id) => {
        if (this.duoSession) this.duoSession.sendClaim('sun', id);
      });
    }
    // 常规补给目前是每个客户端各自的本地掉落（共享 claim 还没做），guest 也要跑，
    // 否则它整局只能拿豌豆。这是与“先到先得”的设计偏差，见设计稿 §13。
    this.pickups.update(dt, this.player);
    for (let i = 0; i < this.remotes.length; i++) this.remotes[i].update(dt);
    if (this.duoSession) this.duoSession.update(dt);
    this.particles.update(dt);

    this.hud.setHealth(this.player.hp, this.player.maxHp);
    this.hud.setShield(this.wallNuts.hp, this.wallNuts.maxHp, this.wallNuts.active);
    if (this.zombies.boss) {
      this.hud.setBossHp(this.zombies.boss.hp / this.zombies.boss.maxHp);
    }
  }

  applyShake(dt) {
    if (this.shakeAmp > 0.002) {
      const s = this.shakeAmp;
      this.camera.rotation.x += (Math.random() - 0.5) * 0.022 * s;
      this.camera.rotation.y += (Math.random() - 0.5) * 0.022 * s;
      this.camera.rotation.z += (Math.random() - 0.5) * 0.035 * s;
      this.camera.position.x += (Math.random() - 0.5) * 0.03 * s;
      this.camera.position.y += (Math.random() - 0.5) * 0.03 * s;
      this.shakeAmp *= Math.exp(-dt * 6);
    } else {
      this.shakeAmp = 0;
    }
  }

  menuCamera(dt) {
    this.menuT += dt;
    this.map.menuCamera(this.camera, this.menuT);
  }

  updateDeathCam(dt) {
    this.deathT = Math.min(1.2, this.deathT + dt);
    const t = this.deathT / 1.2;
    const e = 1 - Math.pow(1 - t, 3);
    this.camera.position.set(
      this.player.pos.x,
      lerp(this.player.pos.y + 1.4, 0.5, e),
      this.player.pos.z
    );
    this.camera.rotation.set(-0.32 * e, this.player.yaw, 0.5 * e);
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);

    if (this.state === 'playing') {
      this.update(dt);
      this.map.update(dt);
    } else if (this.state === 'menu') {
      this.menuCamera(dt);
      this.map.update(dt);
    } else if (this.state === 'over') {
      this.updateDeathCam(dt);
      this.map.update(dt);
    }

    this.weapons.root.visible = this.state === 'playing' && !this.player.dead && !this.player.downed;

    this.trackPerformance(raw);
    this.renderer.render(this.scene, this.camera);
  }

  trackPerformance(raw) {
    if (raw <= 0) return;
    this.perfTime += raw;
    this.perfFrames += 1;
    if (this.perfTime < 2.5) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfTime = 0;
    this.perfFrames = 0;
    if (fps < 43 && this.pixelRatio > 1.02) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    } else if (fps > 57 && this.pixelRatio < this.maxPixelRatio - 0.01) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }
}

// 双人的两个出生点：在各自地图出生点左右各让开 1.8 米，避免叠在一起。
function duoSpawn(map, seat) {
  const s = (map && map.spawn) || { x: 0, z: 0, yaw: 0 };
  const side = seat === 0 ? -1 : 1;
  return { x: (s.x || 0) + side * 1.8, z: s.z || 0, yaw: s.yaw || 0 };
}
