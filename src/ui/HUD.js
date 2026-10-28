import { WEAPONS } from '../config.js';
import { formatNum } from '../utils.js';

const ICONS = {
  pea: '<svg viewBox="0 0 48 48"><path d="M14 45c2-8 6-12 6-12" stroke="#3e7a10" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M20 35c-4.5-2-8.5-1-10 1.4 3 2.2 6.8 2 10-1.4z" fill="#4e9a12"/><circle cx="20" cy="21" r="12.5" fill="#7ed321" stroke="#2f5b0e" stroke-width="2.6"/><rect x="29.5" y="16.5" width="14" height="9.4" rx="4.7" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2.6"/><ellipse cx="14" cy="16" rx="3.2" ry="4.2" fill="#b9f276" opacity="0.85"/><circle cx="26" cy="16.5" r="1.7" fill="#2f5b0e"/><circle cx="17.5" cy="16.5" r="1.7" fill="#2f5b0e"/></svg>',
  snow: '<svg viewBox="0 0 48 48"><path d="M14 45c2-8 6-12 6-12" stroke="#2c738a" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M20 35c-4.5-2-8.5-1-10 1.4 3 2.2 6.8 2 10-1.4z" fill="#3b8fa8"/><circle cx="20" cy="21" r="12.5" fill="#9fe8ff" stroke="#175a70" stroke-width="2.6"/><rect x="29.5" y="16.5" width="14" height="9.4" rx="4.7" fill="#c9f6ff" stroke="#175a70" stroke-width="2.6"/><ellipse cx="14" cy="15" rx="3.2" ry="4.2" fill="#ffffff" opacity="0.9"/><circle cx="26" cy="16.5" r="1.7" fill="#175a70"/><circle cx="17.5" cy="16.5" r="1.7" fill="#175a70"/><path d="M10 9l3 3M13 9l-3 3" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cherry: '<svg viewBox="0 0 48 48"><path d="M17 16c2-8 7-10 12-9" stroke="#4f9c26" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M27 19c1-6 4-9 8-9" stroke="#4f9c26" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="17" cy="28" r="10" fill="#e8452f" stroke="#6d1208" stroke-width="2.4"/><circle cx="30.5" cy="31" r="8.6" fill="#e8452f" stroke="#6d1208" stroke-width="2.4"/><ellipse cx="13.5" cy="24" rx="2.6" ry="3.4" fill="#ffb3a0" opacity="0.85"/><path d="M30 9c3-3 6-3 8-2-2 3-4 4-8 2z" fill="#63b32c"/></svg>',
  cob: '<svg viewBox="0 0 48 48"><path d="M12 15c-4 5-4 12 0 18 3-4 4-12 0-18z" fill="#63b32c" stroke="#2f6b10" stroke-width="1.6"/><rect x="16" y="8" width="17" height="33" rx="8.5" fill="#ffd23f" stroke="#7a5305" stroke-width="2.4"/><g fill="#f0b62a"><circle cx="22" cy="15" r="1.7"/><circle cx="27.5" cy="15" r="1.7"/><circle cx="22" cy="21" r="1.7"/><circle cx="27.5" cy="21" r="1.7"/><circle cx="22" cy="27" r="1.7"/><circle cx="27.5" cy="27" r="1.7"/><circle cx="22" cy="33" r="1.7"/><circle cx="27.5" cy="33" r="1.7"/></g><path d="M36 17c4 4 5 10 2 16-3-3-4-10-2-16z" fill="#63b32c" stroke="#2f6b10" stroke-width="1.6"/></svg>',
};

export class HUD {
  constructor() {
    this.hud = document.getElementById('hud');
    this.startScreen = document.getElementById('startScreen');
    this.pauseScreen = document.getElementById('pauseScreen');
    this.overScreen = document.getElementById('overScreen');
    this.hpFill = document.getElementById('hpFill');
    this.hpText = document.getElementById('hpText');
    this.scoreLabel = document.getElementById('scoreLabel');
    this.killLabel = document.getElementById('killLabel');
    this.waveLabel = document.getElementById('waveLabel');
    this.sunValue = document.getElementById('sunValue');
    this.sunPill = document.getElementById('sunPill');
    this.bossBar = document.getElementById('bossBar');
    this.bossFill = document.getElementById('bossFill');
    this.crosshair = document.getElementById('crosshair');
    this.hitmarkerEl = document.getElementById('hitmarker');
    this.bannerEl = document.getElementById('banner');
    this.damageEl = document.getElementById('damageVignette');
    this.tutorialEl = document.getElementById('tutorial');
    this.joyBase = document.getElementById('joyBase');
    this.joyKnob = document.getElementById('joyKnob');
    this.weaponDock = document.getElementById('weaponDock');
    this.muteBtn = document.getElementById('muteBtn');
    this.rotateHint = document.getElementById('rotateHint');
    this.fireBtn = document.getElementById('fireBtn');
    this.jumpBtn = document.getElementById('jumpBtn');
    this.desktopHint = document.getElementById('desktopHint');
    this.isTouch = true;

    this.weaponButtons = [];
    this.cache = { hp: -1, sun: -1, score: -1, kills: -1, wave: -1 };
    this.muted = false;
    this.bannerTimer = 0;
    this.tutorialTimer = 0;
    this.damageTimer = 0;

    this.buildDock();
    this.bind();
  }

  buildDock() {
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      const btn = document.createElement('button');
      btn.className = 'weapon-btn';
      btn.setAttribute('aria-label', def.name);
      btn.innerHTML =
        '<span class="wkey">' + (i + 1) + '</span>' +
        ICONS[def.id] +
        '<span class="wname">' + def.short + '</span>' +
        '<span class="wcost' + (def.cost === 0 ? ' free' : '') + '">' + (def.cost === 0 ? '∞' : def.cost) + '</span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onWeaponSelect) this.onWeaponSelect(i);
      });
      this.weaponDock.appendChild(btn);
      this.weaponButtons.push(btn);
    }
  }

  bind() {
    const start = document.getElementById('startBtn');
    const resume = document.getElementById('resumeBtn');
    const restart = document.getElementById('restartBtn');
    const again = document.getElementById('againBtn');
    const pause = document.getElementById('pauseBtn');

    if (start) start.addEventListener('click', () => { if (this.onStart) this.onStart(); });
    if (resume) resume.addEventListener('click', () => { if (this.onResume) this.onResume(); });
    if (restart) restart.addEventListener('click', () => { if (this.onRestart) this.onRestart(); });
    if (again) again.addEventListener('click', () => { if (this.onStart) this.onStart(); });
    if (pause) pause.addEventListener('click', () => { if (this.onPause) this.onPause(); });
    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', () => {
        this.muted = !this.muted;
        this.muteBtn.classList.toggle('muted', this.muted);
        if (this.onMute) this.onMute(this.muted);
      });
    }
  }

  showHud(v) {
    this.hud.classList.toggle('hidden', !v);
  }

  hideScreens() {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.overScreen.classList.add('hidden');
  }

  showPause() {
    this.pauseScreen.classList.remove('hidden');
  }

  hidePause() {
    this.pauseScreen.classList.add('hidden');
  }

  showGameOver(score, wave, kills) {
    document.getElementById('finalScore').textContent = formatNum(score);
    document.getElementById('finalWave').textContent = String(wave);
    document.getElementById('finalKills').textContent = String(kills);
    this.overScreen.classList.remove('hidden');
    this.bossBar.classList.add('hidden');
  }

  setHealth(hp, max) {
    const v = Math.max(0, Math.ceil(hp));
    if (v === this.cache.hp) return;
    this.cache.hp = v;
    const ratio = Math.max(0, Math.min(1, hp / max));
    this.hpFill.style.width = (ratio * 100).toFixed(1) + '%';
    this.hpText.textContent = String(v);
    this.hpFill.style.filter = ratio < 0.32 ? 'saturate(1.35) brightness(1.1)' : '';
  }

  setSun(value, silent) {
    if (value === this.cache.sun) return;
    const grew = this.cache.sun >= 0 && value > this.cache.sun;
    this.cache.sun = value;
    this.sunValue.textContent = String(value);
    this.updateAffordability(value);
    if (grew && !silent) {
      this.sunPill.classList.remove('pulse');
      void this.sunPill.offsetWidth;
      this.sunPill.classList.add('pulse');
    }
  }

  updateAffordability(sun) {
    for (let i = 0; i < this.weaponButtons.length; i++) {
      const poor = sun < WEAPONS[i].cost;
      this.weaponButtons[i].classList.toggle('poor', poor);
    }
  }

  denySun() {
    this.sunPill.classList.remove('deny');
    void this.sunPill.offsetWidth;
    this.sunPill.classList.add('deny');
    setTimeout(() => this.sunPill.classList.remove('deny'), 340);
  }

  setWeapon(index) {
    for (let i = 0; i < this.weaponButtons.length; i++) {
      this.weaponButtons[i].classList.toggle('active', i === index);
    }
    const def = WEAPONS[index];
    if (def && this.crosshair) {
      this.crosshair.style.transform = 'scale(1.08)';
      setTimeout(() => { this.crosshair.style.transform = ''; }, 120);
    }
  }

  setScore(value) {
    const v = Math.round(value);
    if (v === this.cache.score) return;
    this.cache.score = v;
    this.scoreLabel.textContent = formatNum(v);
  }

  setKills(value) {
    if (value === this.cache.kills) return;
    this.cache.kills = value;
    this.killLabel.textContent = String(value);
  }

  setWave(n) {
    if (n === this.cache.wave) return;
    this.cache.wave = n;
    this.waveLabel.textContent = '第 ' + n + ' 波';
  }

  setBossVisible(v) {
    this.bossBar.classList.toggle('hidden', !v);
  }

  setBossHp(ratio) {
    this.bossFill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
  }

  setAimLock(on) {
    if (this.aimLock === on) return;
    this.aimLock = on;
    this.crosshair.classList.toggle('lock', on);
  }

  hitmarker(head) {
    this.hitmarkerEl.classList.remove('show');
    void this.hitmarkerEl.offsetWidth;
    this.hitmarkerEl.classList.toggle('head', !!head);
    this.hitmarkerEl.classList.add('show');
  }

  flashDamage() {
    this.damageEl.classList.add('show');
    clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => this.damageEl.classList.remove('show'), 220);
  }

  showBanner(text, duration) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerEl.style.animationDuration = (duration || 2.2) + 's';
  }

  setMode(touch) {
    this.isTouch = touch;
    this.tutorialEl.innerHTML = touch
      ? '<div><b>左摇杆</b> 移动 · <b>右侧拖动</b> 瞄准</div><div><b>开火</b> 键射击 · 点击下方植物切换</div>'
      : '<div><b>WASD</b> 移动 · <b>鼠标</b> 瞄准 · <b>左键</b> 射击</div><div><b>空格</b> 跳跃 · <b>1-4</b> 切换植物</div>';
  }

  showTutorial() {
    this.tutorialEl.classList.remove('fade');
    clearTimeout(this.tutorialTimer);
    this.tutorialTimer = setTimeout(() => this.tutorialEl.classList.add('fade'), 9000);
  }

  fadeDesktopHint() {
    if (this.desktopHint) this.desktopHint.classList.add('fade');
  }

  fadeTutorial() {
    clearTimeout(this.tutorialTimer);
    this.tutorialEl.classList.add('fade');
  }

  showJoystick(x, y) {
    this.joyBase.style.left = x + 'px';
    this.joyBase.style.top = y + 'px';
    this.joyBase.classList.remove('hidden');
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  moveJoystick(dx, dy) {
    this.joyKnob.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
  }

  hideJoystick() {
    this.joyBase.classList.add('hidden');
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  rotateHintIfNeeded() {
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait && window.innerWidth < 620) {
      this.rotateHint.classList.remove('hidden');
      setTimeout(() => this.rotateHint.classList.add('hidden'), 4200);
    }
  }

  reset() {
    this.cache = { hp: -1, sun: -1, score: -1, kills: -1, wave: -1 };
    this.setHealth(100, 100);
    this.setScore(0);
    this.setKills(0);
    this.setWave(1);
    this.setBossVisible(false);
    this.hitmarkerEl.classList.remove('show', 'head');
    this.crosshair.classList.remove('lock');
    this.aimLock = false;
    this.damageEl.classList.remove('show');
    this.bannerEl.classList.remove('show');
    this.tutorialEl.classList.add('fade');
  }
}
