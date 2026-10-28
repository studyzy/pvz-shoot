import * as THREE from 'three';
import { MAPS, DEFAULT_MAP, createMaps } from './world/maps.js';
import { Player } from './entities/Player.js';
import { ZombieManager } from './entities/ZombieManager.js';
import { initZombieAtlas } from './entities/ZombieTexture.js';
import { ProjectileSystem } from './weapons/ProjectileSystem.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { Particles } from './fx/Particles.js';
import { SunOrbs } from './entities/SunOrbs.js';
import { WeaponPickups } from './entities/WeaponPickups.js';
import { Sfx } from './audio/Sfx.js';
import { HUD } from './ui/HUD.js';
import { Controls } from './input/Controls.js';
import { TUNING } from './config.js';
import { outdoorEnvironment } from './world/materials.js';
import { clamp, lerp } from './utils.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'menu';
    this.mapId = DEFAULT_MAP;
    this.map = null;
    this.stats = { score: 0, kills: 0, wave: 0 };
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
    initZombieAtlas();
    this.hud = new HUD();
    this.particles = new Particles(this.scene);
    this.maps = createMaps(this.scene);
    this.player = new Player(this.sfx);
    this.sunOrbs = new SunOrbs(this.scene);
    this.pickups = new WeaponPickups(ctx);

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

    ctx.onKill = (z, score, headshot) => this.onKill(z, score, headshot);
    ctx.onWaveStart = (n) => this.onWaveStart(n);
    ctx.onWaveClear = (n) => this.onWaveClear(n);
    ctx.onZombieAttack = (z) => this.onZombieAttack(z);
    ctx.onBossSpawn = (z) => this.onBossSpawn(z);
    ctx.onBossDead = () => this.onBossDead();

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
      if (!locked && this.state === 'playing' && !this.controls.isTouch) this.pause();
    };

    this.hud.onStart = () => this.start();
    this.hud.onResume = () => this.resume();
    this.hud.onRestart = () => this.restart();
    this.hud.onPause = () => this.pause();
    this.hud.onChangeMap = () => this.backToMenu();
    this.hud.onMapSelect = (id) => this.selectMap(id);
    this.hud.onMute = (m) => this.sfx.setMuted(m);
    this.hud.onWeaponSelect = (i) => {
      if (this.state === 'playing') this.weapons.equip(i);
    };

    this.hud.buildMapSelect(MAPS, this.mapId);
    this.setMap(this.mapId);
    this.bindButtons();
    this.bindResize();
    this.resize();
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

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
  }

  bindResize() {
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
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
    map.activate(this.scene);
    this.hud.setMapSelection(map.id);
    this.hud.setStartLabel(map.startLabel);
    if (this.pickups) this.pickups.setMap(map);
  }

  selectMap(id) {
    if (this.state !== 'menu' || id === this.mapId) return;
    this.setMap(id);
    this.menuT = 0;
    this.sfx.click();
  }

  backToMenu() {
    this.state = 'menu';
    this.hud.hideScreens();
    this.hud.showStartScreen();
    this.hud.showHud(false);
    this.controls.setEnabled(false);
    this.controls.exitLock();
    this.resetRun();
    this.menuT = 0;
    this.clock.getDelta();
  }

  start() {
    this.sfx.unlock();
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.resetRun();
    this.state = 'playing';
    this.controls.setEnabled(true);
    this.controls.requestLock();
    this.zombies.startWave(1);
    this.scheduleTutorial();
    this.hud.rotateHintIfNeeded();
    this.clock.getDelta();
    this.deathT = 0;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.loop);
    }
  }

  resetRun() {
    this.player.reset(this.map.spawn);
    this.weapons.reset();
    this.zombies.reset();
    this.projectiles.clear();
    this.particles.clear();
    this.sunOrbs.clear();
    this.pickups.reset();
    this.stats = { score: 0, kills: 0, wave: 0 };
    this.sun = TUNING.startSun;
    this.shakeAmp = 0;
    this.hud.reset();
    this.hud.setSun(this.sun, true);
    this.hud.setHealth(this.player.hp, this.player.maxHp);
  }

  restart() {
    this.hud.hideScreens();
    this.hud.showHud(true);
    this.resetRun();
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

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showPause();
    this.hud.showHud(false);
    this.controls.setEnabled(false);
    this.controls.exitLock();
  }

  resume() {
    if (this.state !== 'paused') return;
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
    this.sun = Math.min(TUNING.maxSun, this.sun + n);
    this.hud.setSun(this.sun);
    this.sfx.pickup();
  }

  spendSun(n) {
    if (n <= 0) return true;
    if (this.sun < n) return false;
    this.sun -= n;
    this.hud.setSun(this.sun);
    return true;
  }

  shake(amount) {
    this.shakeAmp = Math.min(1.4, this.shakeAmp + amount);
  }

  onKill(z, score, headshot) {
    this.stats.score += score;
    this.stats.kills += 1;
    this.hud.setScore(this.stats.score);
    this.hud.setKills(this.stats.kills);
    if (this.stats.kills === 1) this.hud.fadeTutorial();
    if (z.type === 'boss') this.shake(0.9);
  }

  onWaveStart(n) {
    this.stats.wave = n;
    this.hud.setWave(n);
    const boss = n % 5 === 0;
    this.hud.showBanner(boss ? '第 ' + n + ' 波 · 巨人来袭' : '第 ' + n + ' 波', 2.4);
    this.sfx.waveStart(boss);
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
    this.player.damage(z.def.damage);
    if (z.type === 'boss') this.shake(0.35);
  }

  onBossSpawn(z) {
    this.hud.setBossVisible(true);
    this.hud.setBossHp(1);
    this.hud.showBanner('巨人僵尸出现了!', 2.4);
    this.shake(0.7);
  }

  onBossDead() {
    this.hud.setBossVisible(false);
    this.hud.showBanner('巨人倒下了!', 2.0);
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
    this.weapons.update(dt, this.controls);
    if (this.map.updateNav) this.map.updateNav(this.player, dt);
    this.zombies.update(dt, this.player, this.map.colliders);
    this.projectiles.update(dt);
    this.sunOrbs.update(dt, this.player);
    this.pickups.update(dt, this.player);
    this.particles.update(dt);

    this.hud.setHealth(this.player.hp, this.player.maxHp);
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

    this.weapons.root.visible = this.state === 'playing' && !this.player.dead;

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
