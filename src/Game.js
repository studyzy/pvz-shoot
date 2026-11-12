import * as THREE from 'three';
import { MAPS, DEFAULT_MAP, createMaps } from './world/maps.js';
import { loadSummary, onLoadProgress, loader } from './assets/LoadProgress.js';
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
import { CloudCombat } from './entities/CloudCombat.js';
import { Sfx } from './audio/Sfx.js';
import { createPostFX, postLevelFromQuery, degradeStep, upgradeStep, LEVEL_OFF } from './fx/postfx.js';
import { createSkyDome } from './world/skyDome.js';
import { createSkyline } from './world/skyline.js';
import { createWeather } from './fx/weather.js';
import { fogPresetFor } from './world/heightFog.js';
import { HUD } from './ui/HUD.js';
import { Controls } from './input/Controls.js';
import { TUNING, WEAPONS, DUO, SUN_SKY, BOUNTY, AIRDROP, CLOUD } from './config.js';
import { outdoorEnvironment } from './world/materials.js';
import { clamp, lerp, segmentSphereT } from './utils.js';
import { sweepWalls } from './weapons/HitWalls.js';

// 进度面板里给每类模型一个中文名（文件名对玩家没有意义）
const LOAD_NAMES = {
  zombie: '僵尸', skeleton: '骷髅', alchemist: '炼金僵尸', football: '橄榄球僵尸', zombieDoctor: '僵尸博士',
  goblin: '哥布林', 'demon-3': '恶魔', slime: '史莱姆', 'pink-slime': '粉史莱姆', 'green-blob': '绿团子',
  bones: '骸骨', ghost: '幽灵', 'ghost-skull': '怪颅', wolf: '狼', spider: '蜘蛛', rat: '老鼠', bat: '蝙蝠',
  toySoldier: '玩具兵', springDuck: '发条鸭', teaSprite: '茶精灵', paperGlider: '纸飞机', jackBox: '弹簧玩偶',
  clockRabbit: '报时兔', giant: '巨人', 'mushroom-king': '蘑菇王', 'dragon-evolved': '巨龙',
  'pumpkin-kid': '队友',
};

function loadLabel(url) {
  const name = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
  if (name === 'pack') return '植物模型包';
  return (LOAD_NAMES[name] || name) + '模型';
}

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
    this.guestWeapon = 'pea';
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
    // guest 侧：队友（host）血量来自 applyRemoteState 的 hp/down
    this.peerHp = -1;
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
    // hitstop：命中/击杀时短暂压慢时间轴的剩余时长（秒）与倍率（见 loop()）。
    this.hitStopT = 0;
    this.hitStopScale = 1;
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

    // 后期管线（M2）。?post=0 时 level 为 0，render() 直接返回 false → 退回直出，
    // 与改动前逐字节等价。这是回滚开关，也是 E2E 的对照基线。
    // 触屏探测在这里直接做：controls 要到 205 行才建，比渲染器晚。
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const noHover = window.matchMedia ? window.matchMedia('(hover: none)').matches : false;
    const isTouch = (coarse || noHover) && (navigator.maxTouchPoints || 0) > 0;
    this.post = createPostFX(renderer, {
      level: postLevelFromQuery(window.location.search, isTouch),
      maxLevel: isTouch ? 1 : 2,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(73, 1, 0.05, 240);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // ---- M3：天空穹顶 / 远景剪影 / 天气粒子 ----
    // 三件都是「一张图一份，切图只换配方不重建」，所以在这里建一次就够。
    // 天空穹顶半径 400 大于相机远裁 240：穹顶跟着相机走，所以半径只需覆盖远裁面。
    // 穹顶半径必须小于相机远裁面，否则整个球在顶点着色器里就被裁掉（看不见）。
    // 0.85 * far 留一点余量给雾/近裁。
    this.sky = createSkyDome({ preset: DEFAULT_MAP, radius: 200 });
    this.scene.add(this.sky.mesh);
    this.skyline = createSkyline({ preset: DEFAULT_MAP });
    this.scene.add(this.skyline.group);
    this.weather = createWeather({ preset: '' });
    this.scene.add(this.weather.group);

    const ctx = (this.ctx = {});
    this.ctx.scene = this.scene;
    this.ctx.camera = this.camera;

    this.sfx = new Sfx();
    initZombieModel();
    // 调试句柄：外部脚本（E2E / 控制台）要等某个模型加载完才能断言
    this.models = zombieModel;
    this.hud = new HUD();
    this.particles = new Particles(this.scene);
    this.maps = createMaps(this.scene, this.camera);
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

    // 云上发条游乐园的公共战斗对象（敲钟冷却、茶滴、报时圈）。
    // 其它地图上 enabled=false，所有方法直接空转，不进任何热路径分支。
    ctx.game = this;
    this.cloud = new CloudCombat(ctx);
    ctx.cloud = this.cloud;

    ctx.spendSun = (n) => this.spendSun(n);
    ctx.shake = (a) => this.shake(a);
    ctx.onHit = (head, killed) => {
      this.hud.hitmarker(head);
      // 命中定格：普通命中 40 ms / 爆头 70 ms / 击杀 90 ms。
      // 爆头和击杀同时成立时按击杀算（更长），不要把两段叠起来。
      if (killed) this.hitStop(0.09, 0.06);
      else if (head) this.hitStop(0.06, 0.09);
      else this.hitStop(0.04, 0.12);
    };
    ctx.onExplosion = (pos, radius) => this.onExplosion(pos, radius);
    // 每次成功开火都会调这里（含豌豆/爆炸/手雷/护盾）。
    // 双人时要上报服务器 —— 这是「我扣了扳机」的唯一可靠信号。
    // 不能用本地命中（onGuestHit）上报：打空、被墙挡、爆炸武器都不会触发本地命中，
    // 那样「怎么打都不掉血」。
    ctx.onFire = (def) => {
      this.hud.fadeTutorial();
      if (this.duo && this.duoSession && this.duoSession.sendFire) {
        this.duoSession.sendFire(def && def.id ? def.id : 'pea');
      }
    };

    ctx.onKill = (z, score, headshot, source) => this.onKill(z, score, headshot, source);
    // 双人：开火上报统一走 ctx.onFire（扣扳机时），这里不再发请求 ——
    // 否则同一枪会发两次，而且打空的目标根本走不到这里。
    ctx.onGuestHit = () => {};
    ctx.onGuestAoe = () => {};
    ctx.onBellHit = (id, weaponId, dir, origin) => this.onBellHit(id, weaponId, dir, origin);
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

    this.hud.onNextWave = () => this.requestNextWave();
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
    this.bindLoadProgress();
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

  // 首页加载面板：首屏几 MB 模型下载期间要让玩家看见进度，而不是一张不动的海报。
  //   - 由 LoadProgress 汇总每条 glb 请求的字节/条数（ZombieModel / WeaponModels / RemotePlayer 共用一个 manager）
  //   - 首屏模型 + 植物包落定才放开开始按钮；其余模型后台继续下，不耽误开打
  //   - 菜单 / 结算 / 暂停时都刷新（回到菜单时可能还在后台加载）
  bindLoadProgress() {
    this.hud.setLoadState(this.loadView());
    this.offLoadProgress = onLoadProgress(() => this.hud.setLoadState(this.loadView()));
  }

  loadView() {
    const s = loadSummary();
    return {
      percent: s.percent,
      done: s.done,
      count: s.count,
      loaded: s.loaded,
      total: s.total,
      failed: s.failed,
      finished: s.finished,
      ready: s.ready,
      files: this.loadFiles(),
    };
  }

  // 进度面板上的文件清单：文件名 → 玩家看得懂的名字，只取最近的几条
  loadFiles() {
    const list = [];
    for (const it of loader.items) {
      if (it.url.indexOf('/models/') < 0) continue;
      list.push({ label: loadLabel(it.url), total: it.total, done: it.done });
    }
    return list.slice(-6);
  }

  bindButtons() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !e.repeat && this.zombies.state === 'intermission') this.requestNextWave();
    });
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
    // RT 尺寸必须跟 drawing buffer 一致（含 pixelRatio），否则后期会糊成一层。
    if (this.post) {
      const dpr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
      this.post.setSize(Math.max(2, Math.floor(w * dpr)), Math.max(2, Math.floor(h * dpr)));
    }
    // 天气粒子的屏幕尺寸正比于视口像素高度
    if (this.weather) this.weather.setViewportScale(h * (this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1));
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
    // 地图可选 setEnv：把 PMREM 环境贴图挂给地图自带的单例材质（摩天街区玻璃幕墙反射）。
    // NightForest.setFlash 同款「按地图开关」先例；重复 setMap 幂等，材质不重建。
    if (typeof map.setEnv === 'function') map.setEnv(this.ctx.env);
    // 夜之森林整图关实时投影：省掉一遍 1024 PCFSoft shadow pass，
    // 夜景本来就靠雾和自发光撑氛围。其它地图照旧开着。
    this.renderer.shadowMap.enabled = !map.noShadows;
    // 摩天街区黄昏整图曝光 +0.25 档（终验「菜单帧过暗」收敛）：材质/灯光提亮一轮后
    // 均色亮度仍低于其它图，曝光是把整帧抬到可比水平的最后一个全局常数；
    // 其它地图回落 1.0（shadowMap.enabled 同款按地图开关先例），幂等无副作用。
    this.renderer.toneMappingExposure = map.id === 'downtown' ? 1.5 : 1.0;
    // 手电是挂相机的（全局存在），不会被 root.visible 关掉：activate 里点亮它、
    // 同时把其它地图的手电关掉。TECH-flashlight.md §4 的"按地图开关"就落在这里。
    for (let i = 0; i < this.maps.length; i++) {
      const m = this.maps[i];
      if (m.setFlash) m.setFlash(m === map);
    }
    map.activate(this.scene, this.camera);
    // ---- M3：按地图换天空 / 远景 / 天气 ----
    // 地图的 activate 会把旧渐变贴图塞进 scene.background —— 那会把穹顶完全挡住
    // （背景先画满屏，穹顶再画也是被覆盖）。清掉它，天空交给穹顶。
    this.scene.background = null;
    this.applyAtmosphere(map);
    this.hud.setMapSelection(map.id);
    this.hud.setStartLabel(map.startLabel);
    if (this.pickups) this.pickups.setMap(map);
    this.sunOrbs.setMap(map.id);
    this.weapons.setMapAppearance(map.id);
    // 公共钟冷却跟着地图走：换图后不该带着上一张图的冷却进新局。
    if (this.cloud) this.cloud.reset();
    this.forestAmbienceT = 0;
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
    // 首屏素材没下完就点开始（againBtn 等入口也可能触发）：先给一句反馈，别开局空手。
    // 只拦"从菜单第一次开局"；已经打过再开（重开/再来一局）不走这里，模型早就热了。
    if (this.state === 'menu' && !loadSummary().ready) {
      const s = loadSummary();
      this.hud.setDuoStatus('素材还在下载（' + Math.round(s.percent) + '%），马上就好', 'wait');
      return;
    }
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

  // 调试用：在出生点右侧放一个队友（pumpkin-kid）。联网层接上后由网络位置驱动。
  spawnRemotePlayer(opts = {}) {
    if (!this.map) return null;
    const map = this.map;
    const x = opts.x !== undefined ? opts.x : map.spawn.x + 2.6;
    const z = opts.z !== undefined ? opts.z : map.spawn.z - 1.4;
    // yaw 是相机口径（面朝 -Z 为 0）；看向位于 (px,pz) 的玩家 = atan2(-(px-x), -(pz-z))
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

  // 当前手持武器的 id（给双人同步用；索引只在本机有意义）。
  weaponId() {
    const def = this.weapons && WEAPONS[this.weapons.current];
    return def ? def.id : 'pea';
  }

  clearRemotes() {
    this.guestWeapon = 'pea';
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

  // 双人：服务器权威。两个客户端都只是「发输入 + 渲染」，没有房主/客人之分。
  setupDuoWorld() {
    // 僵尸世界一律由服务器快照驱动，本地不跑 AI、不刷怪、不结算
    this.zombies.setRemote(true);
    this.zombies.setDuo(false);
    this.zombies.onNetSpawn = null;
    this.zombies.onNetDead = null;
    // 补给同样以服务器为准：本地只管显示与发起 claim
    this.pickups.setShared(true);
    this.pickups.onChange = null;
    this.pickups.onLocalPickup = null;
    this.pickups.onClaim = (id) => {
      if (this.duoSession && this.duoSession.sendClaim) this.duoSession.sendClaim('pickup', id);
    };
    this.pickups.onDrop = null;
  }

  // 邀请链接（?join=）或房主刷新：进菜单后自动连服务器。
  // 单人模式不会走到这里（地址栏没有 join 参数、也没有房主标记）。
  async autoJoinDuo() {
    if (this.state !== 'menu' || this.duoSession || this.duoPending) return false;
    let auto = false;
    try {
      const { shouldAutoJoin } = await import('./net/ClientNet.js');
      auto = shouldAutoJoin();
    } catch (e) {
      return false;
    }
    if (!auto) return false;
    await this.toggleDuo();
    return true;
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
      const { ClientNet } = await import('./net/ClientNet.js');
      if (this.state !== 'menu') {
        this.hud.setDuoMode(false);
        this.hud.setDuoStatus('', 'idle');
        return;
      }
      this.duoSession = new ClientNet(this);
      // M0：window.__netProbe = true 时开始采集（见 docs/plans/2026-11-01-netcode-refactor.md §M0）
      this.netProbe = this.duoSession.probe;
      try {
        if (typeof window !== 'undefined' && window.__netProbe) this.netProbe.on = true;
      } catch (e) {
        // 隐私模式忽略
      }
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
    this.peerHp = -1;
    this.hud.setDuoHud(true);
    this.hud.setPeerHealth(-1, 0, { downed: false, name: this.duo.peerName });
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
    this.remote.setDown(!!g.downed);
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
    if (typeof d.w === 'string') {
      this.guestWeapon = d.w;
      if (this.remote) this.remote.setWeapon(d.w);
    }
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

  // ---- 服务器权威快照（ClientNet 调用）----
  // 这是新架构下客户端唯一的「世界真相」来源：僵尸、队友、阳光、比分全部来自这里。
  applyServerSnapshot(snap) {
    if (!this.duo) return;
    const seat = this.seat;
    const me = snap.players[seat];
    const peer = snap.players[1 - seat];

    // 自己：本地已经预测过移动，这里只做校正（不直接覆盖，否则会抖）
    if (me && this.duoSession && this.duoSession.reconcile) {
      this.duoSession.reconcile(me);
    }

    // 队友：插值后的位置交给 RemotePlayer 平滑
    if (peer && this.remote) {
      this.peerHp = peer.hp;
      if (peer.downed !== this.remoteDown) {
        this.remoteDown = !!peer.downed;
        this.remote.setDown(this.remoteDown);
      }
      this.remote.setTarget(peer.x, peer.z, peer.yaw, peer.y);
      const speed = Math.hypot(peer.x - this.lastPeerX, peer.z - this.lastPeerZ) * 30;
      this.lastPeerX = peer.x;
      this.lastPeerZ = peer.z;
      this.remote.setMoving(speed > 0.6, speed);
    }

    // 世界状态
    this.sun = snap.sun;
    this.hud.setSun(this.sun);
    this.zombies.wave = snap.wave;
    this.zombies.state = snap.state;
    this.hud.setWave(snap.wave);

    // 比分与击杀：服务器权威，客户端只显示
    if (Array.isArray(snap.scores)) {
      this.duoStats = snap.scores.slice();
      this.stats.score = this.duoStats[seat] || 0;
      this.hud.setScore(this.stats.score);
    }
    if (Array.isArray(snap.kills)) {
      this.duoKills = snap.kills.slice();
      this.stats.kills = this.duoKills[seat] || 0;
      this.hud.setKills(this.stats.kills);
    }

    // 僵尸：交给现有 netSnapshot（按 id 增量 spawn/更新/回收）
    this.zombies.netSnapshot(snap.zombies);
  }

  // 服务器事件：只做表现，不改权威状态
  applyServerEvent(ev) {
    if (!ev || !this.duo) return;
    switch (ev.t) {
      case 'wave':
        this.onWaveStart(ev.n);
        break;
      case 'waveClear':
        this.hud.showBanner('第 ' + ev.n + ' 波 守住了!', 2.0);
        this.sfx.waveClear();
        break;
      case 'shot':
        // 服务器确认命中：播命中反馈（伤害数字/白闪以服务器为准）
        if (ev.seat === this.seat && ev.hit) this.hud.hitmarker(!!ev.head);
        break;
      case 'kill':
        if (ev.seat === this.seat) {
          this.hud.hitmarker(!!ev.head);
        }
        break;
      case 'down':
        if (ev.seat === 1 - this.seat) this.hud.showBanner('队友倒下了！靠近 2.5 秒可救起', 3);
        break;
      case 'rescue':
        this.hud.showBanner('队友站起来了', 2);
        break;
      case 'over': {
        const scores = this.duoStats ? this.duoStats.slice() : [0, 0];
        const kills = this.duoKills ? this.duoKills.slice() : [0, 0];
        this.finishDuoRound({ scores, kills }, ev.reason || 'WIPE');
        break;
      }
      default:
        break;
    }
  }

  applyWorldState(d) {
    if (d.ws === 'intermission' || d.ws === 'spawning') {
      this.zombies.state = d.ws;
      this.zombies.intermission = Math.max(0, Number(d.wt) || 0);
    }
    if (typeof d.wave === 'number' && d.wave !== this.zombies.wave) {
      this.zombies.wave = d.wave;
      this.hud.setWave(d.wave);
      this.hud.showBanner('第 ' + d.wave + ' 波', 2);
    }
    if (Array.isArray(d.z)) this.zombies.netSnapshot(d.z);
    // M0 探针：客人侧量「每一包快照把僵尸瞬移了多远」，这是肉眼卡顿的直接指标
    const probe = this.duoSession && this.duoSession.probe;
    if (probe && probe.on && Array.isArray(d.z)) {
      for (let i = 0; i < d.z.length; i++) {
        const s = d.z[i];
        const z = this.zombies.zombies.find((x) => x.netId === s.id);
        if (z) probe.onApply(z.root.position.x, z.root.position.z, s.x, s.z);
      }
    }
    if (this.netProbe) this.netProbe.on = true;
    if (typeof d.bossHp === 'number') {
      if (d.bossHp > 0) {
        if (this.zombies.boss) this.hud.setBossName(this.zombies.boss.def.title);
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
    if (!Number.isInteger(d.seq) || d.seq <= 0 || !snap) return;
    const airborne = snap && typeof snap.ab === 'number' ? !!snap.ab : z.airborne;
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
    const bodyY = snap ? snap.ys ?? 1 : z.model?.scale?.y ?? 1;
    const tc = segmentSphereT(origin, end, new THREE.Vector3(sx, sy + z.chestY * z.scaleFactor * bodyY, sz), 0.46 * z.scaleFactor * rs + 0.14);
    const th = segmentSphereT(origin, end, new THREE.Vector3(sx, sy + z.headY * z.scaleFactor * bodyY, sz), 0.36 * z.scaleFactor * rs);
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
    if (airborne && !(aerial > 0)) {
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

    const aerialMul = airborne && aerial > 0 ? aerial : 1;
    const damage = def.damage * (head ? TUNING.headshotMul : 1) * aerialMul;
    const killed = z.hit(damage, def.slow, head, {
      type: def.pierce ? 'pierce' : 'pea',
      burn: def.burn,
      armorBreak: def.armorBreak,
      skillState: snap ? snap.sk : undefined,
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

  // 敲钟的唯一入口：本机（单人 / host）直接裁决，guest 只发请求。
  // origin 是开火那一刻的枪口，dir 是弹道方向；两者一起用来在 host 侧重算视线。
  onBellHit(id, weaponId, dir, origin) {
    if (!this.cloud || this.mapId !== 'cloud') return false;
    if (this.duo && this.seat === 1) {
      if (this.duoSession) this.duoSession.sendBell(id, weaponId, dir, origin);
      return false;
    }
    return this.cloud.ringBell(id);
  }

  // host 裁决 guest 的敲钟请求。全部按「开火时」的历史位置重算，不用 guest 的当前位姿：
  // 网络延迟里 guest 可能已经跑开，用当前位姿会把合法的一枪判死，也会让伪造的枪蒙混过关。
  applyGuestBell(d) {
    if (!d || !this.duo || this.seat !== 0 || !this.netGuest || !this.cloud) return;
    if (this.mapId !== 'cloud') return;
    if (this.netGuest.downed || this.netGuest.dead) return;
    if (this.netGuest.shield && this.netGuest.shield.active) return;
    const def = WEAPONS.find((w) => w.id === d.w);
    // 只有直线弹种能敲钟：抛掷物和瞬时爆炸的弹道是另一套解算，不该拿射击线冒充。
    if (!def || def.arc || def.kind === 'lob' || !def.speed) return;
    if (!Number.isInteger(d.id) || !CLOUD.bell.positions[d.id]) return;
    if (!Number.isInteger(d.seq) || d.seq <= 0) return;
    const pose = this.duoSession && this.duoSession.getGuestAt(d.seq);
    if (!pose) return;
    const origin = new THREE.Vector3(
      Number(d.origin && d.origin[0]),
      Number(d.origin && d.origin[1]),
      Number(d.origin && d.origin[2])
    );
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return;
    const dir = new THREE.Vector3(
      Number(d.dir && d.dir[0]),
      Number(d.dir && d.dir[1]),
      Number(d.dir && d.dir[2])
    );
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    // 枪口必须贴着 guest 那一刻的头部，方向必须落在它那一刻的视线锥里。
    const eye = new THREE.Vector3(pose.x, pose.y + TUNING.playerHeight, pose.z);
    if (origin.distanceTo(eye) > 0.6) return;
    const cp = Math.cos(pose.pitch);
    const fx = -Math.sin(pose.yaw) * cp;
    const fy = Math.sin(pose.pitch);
    const fz = -Math.cos(pose.yaw) * cp;
    if (fx * dir.x + fy * dir.y + fz * dir.z < Math.cos(0.4)) return;
    // 和历史快照里的同一把武器共享射速，否则一枪能敲两次钟。
    const now = Date.now();
    const key = 'bell:' + def.id;
    const rec = this.guestHit.get(key) || { t: 0, n: 0 };
    if (now - rec.t < (def.cooldown || 0.2) * 800) return;
    rec.t = now;
    rec.n = 1;
    this.guestHit.set(key, rec);
    // 射线必须真的打中它报的那口钟，而且那口钟得是**最近**的一口：
    // 拿 A 钟的方向去报 B 钟，在 host 这边不成立。
    const [bx, bz] = CLOUD.bell.positions[d.id];
    const target = new THREE.Vector3(bx, CLOUD.bell.y, bz);
    const end = origin.clone().addScaledVector(dir, 80);
    const t = segmentSphereT(origin, end, target, CLOUD.bell.hitRadius);
    if (t < 0) return;
    const nearest = this.cloud.bellIntersection(origin, end);
    if (!nearest || nearest.id !== d.id) return;
    const n = new THREE.Vector3();
    const bounds = this.map.bounds || { x: 36, z: 36 };
    if (sweepWalls(this.map.walls || [], bounds.x, bounds.z, origin, target, 0.05, n) >= 0) return;
    // 开火那一帧里敌人已经挡在钟前面 → 这一枪该打敌人，不该敲钟。
    const reach = origin.distanceTo(target);
    const snap = this.duoSession && this.duoSession.history && this.duoSession.history[0];
    if (snap && Array.isArray(snap.z)) {
      for (const s of snap.z) {
        if (s.st === 3 || s.ab) continue;
        const sc = new THREE.Vector3(s.x, s.y + 1.02 * (s.ys ?? 1), s.z);
        const tc = segmentSphereT(origin, end, sc, 0.46 + 0.14);
        if (tc >= 0 && tc <= t && origin.distanceTo(sc) <= reach + 0.5) return;
      }
    }
    this.cloud.ringBell(d.id);
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

  // 左上角队友血条：host 读 netGuest（权威代理），guest 读 applyRemoteState 缓存下来的 peerHp
  updatePeerHud() {
    if (!this.duo) return;
    const b = this.netGuest;
    if (b) this.hud.setPeerHealth(b.hp, b.maxHp, { downed: !!b.downed, name: this.duo.peerName });
    else this.hud.setPeerHealth(this.peerHp, 0, { downed: this.remoteDown, name: this.duo.peerName });
  }

  applyRemoteState(d) {
    if (!this.remote || !d) return;
    if (Number.isFinite(Number(d.hp)) && d.hp !== null && d.hp !== '') this.peerHp = Number(d.hp);
    if (d.down !== undefined) {
      if (d.down && !this.remoteDown) this.hud.showBanner('队友倒下了！靠近 2.5 秒可救起', 3);
      else if (!d.down && this.remoteDown) this.hud.showBanner('队友站起来了', 2);
      this.remoteDown = !!d.down;
      this.remote.setDown(this.remoteDown);
    }
    const x = Number(d.x);
    const z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.remote.setTarget(x, z, Number(d.yaw) || 0, Number(d.y) || 0);
    this.remote.setMoving(!!d.moving, Number(d.speed) || 0);
    if (typeof d.w === 'string') this.remote.setWeapon(d.w);
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
    if (this.duoSession && this.duoSession.sendResync) this.duoSession.sendResync(this.buildResync());
  }

  buildResync() {
    const boss = this.zombies ? this.zombies.boss : null;
    return {
      wave: this.zombies ? this.zombies.wave : 0,
      ws: this.zombies ? this.zombies.state : 'idle',
      wt: this.zombies ? this.zombies.intermission : 0,
      sun: Math.round(this.sun || 0),
      scores: this.duoStats ? this.duoStats.slice() : [0, 0],
      kills: this.duoKills ? this.duoKills.slice() : [0, 0],
      bossHp: boss ? Math.max(0, boss.hp / boss.maxHp) : 0,
      z: this.zombies && this.zombies.zombies ? this.zombies.zombies.map((z) => z.serialize()) : [],
      pickups: this.pickups ? this.pickups.netList() : [],
      orbs: this.sunOrbs ? this.sunOrbs.serialize() : [],
      c: this.mapId === 'cloud' && this.cloud ? this.cloud.serialize() : undefined,
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
    this.applyWorldState(d);
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
    this.peerHp = -1;
    if (this.hud) this.hud.setDuoHud(false);
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
    this.cloud.reset();
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
    this.hitStopT = 0;
    this.hitStopScale = 1;
    this.hud.setSun(this.sun, true);
    this.hud.setHealth(this.player.hp, this.player.maxHp);
    this.peerHp = -1;
    this.hud.setDuoHud(!!this.duo);
    this.hud.setPeerHealth(-1, 0, { downed: false, name: this.duo ? this.duo.peerName : '' });
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
    if (this.sun < n) return false;
    // 本地先扣：手感必须跟手，不能等服务器往返
    this.sun -= n;
    this.hud.setSun(this.sun);
    // 双人：服务器是权威，扣款要上报（否则下一帧快照会把余额盖回来，等于白花）
    if (this.duo && this.duoSession && this.duoSession.sendSunSpend) {
      this.duoSession.sendSunSpend(n);
    }
    return true;
  }

  shake(amount) {
    this.shakeAmp = Math.min(1.4, this.shakeAmp + amount);
  }

  // 命中定格。dur 秒内时间轴按 scale 慢放；取「当前剩余」与「新请求」的较长者，
  // 这样连发时不会每颗豌豆都重新触发一整段定格（那会变成卡顿）。
  // 只在玩法中生效：菜单/结算里不该抖。
  hitStop(dur, scale) {
    if (this.state !== 'playing') return;
    const d = Number.isFinite(dur) ? dur : 0.05;
    if (d <= 0) return;
    if (d > this.hitStopT) {
      this.hitStopT = d;
      this.hitStopScale = Number.isFinite(scale) && scale > 0 ? scale : 0.08;
    }
  }

  onKill(z, score, headshot, source = 0) {
    // 双人：比分与击杀数完全由服务器快照下发（见 applyServerSnapshot），
    // 本地不再自己累加 —— 两套账并存会让 HUD 在每帧快照之间闪烁。
    if (!this.duo) {
      this.stats.score += score;
      this.stats.kills += 1;
      this.hud.setScore(this.stats.score);
      this.hud.setKills(this.stats.kills);
      if (this.stats.kills === 1) this.hud.fadeTutorial();
    }
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

  requestNextWave() {
    if (this.state !== 'playing' || (this.mapId !== 'forest' && this.mapId !== 'cloud')) return;
    if (this.duo && this.seat === 1) {
      this.duoSession.sendNextWave();
      return;
    }
    this.zombies.skipIntermission();
  }

  // 提前开波：单人直接跳过休整；双人由服务器统一控制节奏，本地请求后以快照为准
  applyNextWaveRequest() {
    if (this.duo) return;
    this.requestNextWave();
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
    this.hud.setBossName(z && z.def && z.def.title ? z.def.title : 'BOSS');
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
    this.player.applyCamera(this.camera);
    this.applyShake(dt);
    if (!this.player.downed) this.weapons.update(dt, this.controls);
    this.wallNuts.update(dt);
    // 双人：僵尸 AI / 寻路全部由服务器算，本地一行都不跑。
    // ZombieManager 处于 remote 模式时，update() 只推进动画与插值，不做 AI 决策。
    // 单人：本地即权威，invokeNav + AI 正常跑。
    if (!this.duo && this.map.updateNav) this.map.updateNav(this.player, dt);
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
    this.cloud.update(dt);
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

    this.hud.setIntermission((this.mapId === 'forest' || this.mapId === 'cloud') && this.zombies.state === 'intermission' ? this.zombies.intermission : 0);
    if (this.mapId === 'forest') {
      this.forestAmbienceT -= dt;
      if (this.forestAmbienceT <= 0) {
        this.forestAmbienceT = 3;
        this.sfx.forestAmbience();
      }
    }
    this.hud.setHealth(this.player.hp, this.player.maxHp);
    this.updatePeerHud();
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
    // 命中定格（hitstop）：命中/击杀时把时间轴压慢 40~90 ms，是打击感最便宜的一层。
    // 注意用的是 raw 而不是 dt：定格期间相机震动、HUD 动画也该一起慢下来，
    // 但 trackPerformance 仍然吃真实耗时，否则自适应分辨率会把「我们自己造的慢帧」当成掉帧。
    const scale = this.hitStopT > 0 ? this.hitStopScale : 1;
    if (this.hitStopT > 0) this.hitStopT = Math.max(0, this.hitStopT - raw);
    const dt = Math.min(0.05, raw) * scale;

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

    // 阴影视锥跟随：窗口钉在玩家（或菜单机位）周围，否则走到场地边缘半边怪没影子。
    this.syncShadowFollow();

    // ---- M3：每帧推进大气 ----
    // 天空跟着相机平移（否则走出穹顶半径就穿帮）；粒子绕相机卷回，零 CPU 几何运算。
    if (this.sky) this.sky.update(dt, this.camera);
    if (this.weather) this.weather.update(dt, this.camera);

    this.trackPerformance(raw);
    // 后期管线；任何一级失败（能力探测不过 / GL 出错 / 档位为 0）都退回直出。
    if (!this.post.render(this.scene, this.camera)) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ---- M3：按地图切换大气 ----
  // 天空穹顶、远景剪影、天气粒子、高度雾四件一起换，因为它们共同定义「这是什么地方」。
  // 任何一件缺了都会露馅：只有天空没有远景 → 场地边缘是天接地；只有远景没有天气 → 静止得像张画。
  applyAtmosphere(map) {
    const id = (map && map.id) || DEFAULT_MAP;
    if (this.sky) {
      this.sky.setPreset(id);
      // 太阳方向跟着地图的主光走：后院/雪地是正午偏南，摩天街区是低角度黄昏。
      // 有了它，穹顶的暖带和云的受光面才会和场景里的实际阴影方向一致。
      const d = this.map && this.map.sunDir;
      if (d && d.isVector3) this.sky.setSunDir(d);
    }
    if (this.skyline) this.skyline.setPreset(id);
    if (this.weather) this.weather.setPreset(id);
    // 高度雾的配方在后期合成里用（见 postfx 的 uFog* uniform）。
    // 场景自带的 THREE.Fog 保持地图原本的设定不动：它管内置材质，
    // 强行推远只会让远处失去纵深，是退步而不是优化。
    this.fogPreset = fogPresetFor(id);
    // 高度雾交给后期合成（需要深度贴图）。?post=0 时后期关掉，雾也随之失效 ——
    // 这是有意的：回滚路径必须和改动前完全一致。
    if (this.post) this.post.setFog(this.fogPreset);
  }

  // 阴影视锥跟随：把光源窗口钉在玩家脚下。
  // 玩法中跟玩家；菜单/结算跟相机（后院的菜单机位在场地外侧，跟玩家会让菜单背景没有阴影）。
  syncShadowFollow() {
    const follow = this.map && this.map.shadowFollow;
    if (!follow) return;
    const focus = (this.state === 'playing' && this.player && this.player.pos)
      ? this.player.pos
      : this.camera.position;
    follow.update(focus);
  }

  trackPerformance(raw) {
    if (raw <= 0) return;
    this.perfTime += raw;
    this.perfFrames += 1;
    if (this.perfTime < 2.5) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfTime = 0;
    this.perfFrames = 0;
    if (!this.post) return;
    // 降级顺序（M2）：先降后期档位，档位见底才降 pixelRatio。
    // 用户对分辨率下降比画质下降敏感，所以先牺牲后期。
    const st = {
      level: this.post.level,
      pixelRatio: this.pixelRatio,
      maxPixelRatio: this.maxPixelRatio,
      maxLevel: this.post.maxLevel,
    };
    if (fps < 43) {
      const next = degradeStep(st);
      if (!next.changed) return;
      this.post.setLevel(next.level);
      if (next.pixelRatio !== this.pixelRatio) {
        this.pixelRatio = next.pixelRatio;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.resize();
      }
    } else if (fps > 57) {
      const next = upgradeStep(st);
      if (!next.changed) return;
      // 严格对称：最后降的必须最先升，否则会在两个状态间来回跳
      if (next.pixelRatio !== this.pixelRatio) {
        this.pixelRatio = next.pixelRatio;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.resize();
      } else {
        this.post.setLevel(next.level);
      }
    }
  }
}

// 双人的两个出生点：在各自地图出生点左右各让开 1.8 米，避免叠在一起。
function duoSpawn(map, seat) {
  const s = (map && map.spawn) || { x: 0, z: 0, yaw: 0 };
  const side = seat === 0 ? -1 : 1;
  return { x: (s.x || 0) + side * 1.8, z: s.z || 0, yaw: s.yaw || 0 };
}
