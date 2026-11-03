import { WEAPONS } from '../config.js';
import { formatNum } from '../utils.js';


const ICONS = {
  pea: '<svg viewBox="0 0 48 48"><path d="M14 45c2-8 6-12 6-12" stroke="#3e7a10" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M20 35c-4.5-2-8.5-1-10 1.4 3 2.2 6.8 2 10-1.4z" fill="#4e9a12"/><circle cx="20" cy="21" r="12.5" fill="#7ed321" stroke="#2f5b0e" stroke-width="2.6"/><rect x="29.5" y="16.5" width="14" height="9.4" rx="4.7" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2.6"/><ellipse cx="14" cy="16" rx="3.2" ry="4.2" fill="#b9f276" opacity="0.85"/><circle cx="26" cy="16.5" r="1.7" fill="#2f5b0e"/><circle cx="17.5" cy="16.5" r="1.7" fill="#2f5b0e"/></svg>',
  snow: '<svg viewBox="0 0 48 48"><path d="M14 45c2-8 6-12 6-12" stroke="#2c738a" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M20 35c-4.5-2-8.5-1-10 1.4 3 2.2 6.8 2 10-1.4z" fill="#3b8fa8"/><circle cx="20" cy="21" r="12.5" fill="#9fe8ff" stroke="#175a70" stroke-width="2.6"/><rect x="29.5" y="16.5" width="14" height="9.4" rx="4.7" fill="#c9f6ff" stroke="#175a70" stroke-width="2.6"/><ellipse cx="14" cy="15" rx="3.2" ry="4.2" fill="#ffffff" opacity="0.9"/><circle cx="26" cy="16.5" r="1.7" fill="#175a70"/><circle cx="17.5" cy="16.5" r="1.7" fill="#175a70"/><path d="M10 9l3 3M13 9l-3 3" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cherry: '<svg viewBox="0 0 48 48"><path d="M17 16c2-8 7-10 12-9" stroke="#4f9c26" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M27 19c1-6 4-9 8-9" stroke="#4f9c26" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="17" cy="28" r="10" fill="#e8452f" stroke="#6d1208" stroke-width="2.4"/><circle cx="30.5" cy="31" r="8.6" fill="#e8452f" stroke="#6d1208" stroke-width="2.4"/><ellipse cx="13.5" cy="24" rx="2.6" ry="3.4" fill="#ffb3a0" opacity="0.85"/><path d="M30 9c3-3 6-3 8-2-2 3-4 4-8 2z" fill="#63b32c"/></svg>',
  cob: '<svg viewBox="0 0 48 48"><path d="M12 15c-4 5-4 12 0 18 3-4 4-12 0-18z" fill="#63b32c" stroke="#2f6b10" stroke-width="1.6"/><rect x="16" y="8" width="17" height="33" rx="8.5" fill="#ffd23f" stroke="#7a5305" stroke-width="2.4"/><g fill="#f0b62a"><circle cx="22" cy="15" r="1.7"/><circle cx="27.5" cy="15" r="1.7"/><circle cx="22" cy="21" r="1.7"/><circle cx="27.5" cy="21" r="1.7"/><circle cx="22" cy="27" r="1.7"/><circle cx="27.5" cy="27" r="1.7"/><circle cx="22" cy="33" r="1.7"/><circle cx="27.5" cy="33" r="1.7"/></g><path d="M36 17c4 4 5 10 2 16-3-3-4-10-2-16z" fill="#63b32c" stroke="#2f6b10" stroke-width="1.6"/></svg>',
  repeater: '<svg viewBox="0 0 48 48"><path d="M12 45c2-7 5-11 5-11" stroke="#3e7a10" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="14" cy="26" r="8" fill="#9ae63a" stroke="#2f5b0e" stroke-width="2.2"/><circle cx="29" cy="22" r="8" fill="#9ae63a" stroke="#2f5b0e" stroke-width="2.2"/><rect x="22" y="18.5" width="19" height="7" rx="3.5" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2.2"/><circle cx="11" cy="23" r="1.4" fill="#2f5b0e"/><circle cx="26" cy="19" r="1.4" fill="#2f5b0e"/><path d="M8 34c-3-2-6-1.5-7 0.5 2 1.6 4.8 1.4 7-0.5z" fill="#4e9a12"/></svg>',
  threepeater: '<svg viewBox="0 0 48 48"><path d="M13 45c2-7 5-11 5-11" stroke="#3e7a10" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="12" cy="31" r="6.6" fill="#76d62a" stroke="#2f5b0e" stroke-width="2"/><circle cx="24" cy="20" r="7.2" fill="#76d62a" stroke="#2f5b0e" stroke-width="2"/><circle cx="36" cy="31" r="6.6" fill="#76d62a" stroke="#2f5b0e" stroke-width="2"/><rect x="34" y="28" width="10" height="6" rx="3" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2"/><rect x="22" y="17" width="10" height="6" rx="3" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2"/><rect x="5" y="28" width="10" height="6" rx="3" fill="#8ede2a" stroke="#2f5b0e" stroke-width="2"/></svg>',
  gatling: '<svg viewBox="0 0 48 48"><circle cx="20" cy="22" r="12" fill="#c2f24e" stroke="#2f5b0e" stroke-width="2.4"/><g fill="#7ea832" stroke="#2f5b0e" stroke-width="1.4"><rect x="27" y="14" width="16" height="4" rx="2"/><rect x="27" y="19.5" width="16" height="4" rx="2"/><rect x="27" y="25" width="16" height="4" rx="2"/></g><circle cx="15" cy="18" r="1.6" fill="#2f5b0e"/><circle cx="24" cy="18" r="1.6" fill="#2f5b0e"/><path d="M14 44c2-7 5-10 5-10" stroke="#3e7a10" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
  cactus: '<svg viewBox="0 0 48 48"><rect x="19" y="10" width="11" height="31" rx="5.5" fill="#7bcf3a" stroke="#2f6b10" stroke-width="2.4"/><rect x="9" y="20" width="7" height="14" rx="3.5" fill="#7bcf3a" stroke="#2f6b10" stroke-width="2.4"/><rect x="33" y="16" width="7" height="18" rx="3.5" fill="#7bcf3a" stroke="#2f6b10" stroke-width="2.4"/><path d="M13 24h6M29 22h5" stroke="#2f6b10" stroke-width="2.4"/><g stroke="#e9ffc4" stroke-width="1.8" stroke-linecap="round"><path d="M24 14v-3M16 15l-2-2M33 13l2-2M24 34v-3M17 34l-2 2M33 31l2 2"/></g></svg>',
  melon: '<svg viewBox="0 0 48 48"><ellipse cx="24" cy="27" rx="16" ry="13.5" fill="#3fae3a" stroke="#1d5c1a" stroke-width="2.6"/><path d="M12 20c7 4 17 4 24 0M10 27c8 4 20 4 28 0M13 34c7 3 15 3 22 0" stroke="#226b1e" stroke-width="2.2" fill="none"/><path d="M24 15c0-4 3-6 7-6" stroke="#4f9c26" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M31 9c3-2 6-2 8-1-2 3-4 4-8 1z" fill="#63b32c"/></svg>',
  wallnut: '<svg viewBox="0 0 48 48"><path d="M24 6c9 0 14 7 14 17s-5 19-14 19S10 33 10 23 15 6 24 6z" fill="#c98c3e" stroke="#6b4310" stroke-width="2.6"/><path d="M13 15c3 5 3 13 0 19M35 15c-3 5-3 13 0 19" stroke="#8a5b1c" stroke-width="2.2" fill="none"/><path d="M17 13c2 4 2 9 0 12M31 13c-2 4-2 9 0 12" stroke="#8a5b1c" stroke-width="1.8" fill="none"/><circle cx="20" cy="24" r="2.2" fill="#20140a"/><circle cx="28" cy="24" r="2.2" fill="#20140a"/><path d="M21 31c2 1.6 4 1.6 6 0" stroke="#20140a" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M24 6c0-3 1-4 3-4" stroke="#4f9c26" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
  firepea: '<svg viewBox="0 0 48 48"><path d="M14 45c2-8 6-12 6-12" stroke="#3e7a10" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M20 35c-4.5-2-8.5-1-10 1.4 3 2.2 6.8 2 10-1.4z" fill="#4e9a12"/><circle cx="20" cy="21" r="12.5" fill="#ff7a1a" stroke="#7a2b04" stroke-width="2.6"/><rect x="29.5" y="16.5" width="14" height="9.4" rx="4.7" fill="#ffa03a" stroke="#7a2b04" stroke-width="2.6"/><path d="M20 3c2 5-2 6-1 10 2-2 3-4 3-4 2 5 0 8-2 9-3-2-4-6-2-9-1 3-3 3-3 3 0-4 3-6 5-9z" fill="#ffd23f" stroke="#e0662a" stroke-width="1.4"/><circle cx="26" cy="16.5" r="1.7" fill="#5a2104"/><circle cx="17.5" cy="16.5" r="1.7" fill="#5a2104"/></svg>',
  jalapeno: '<svg viewBox="0 0 48 48"><path d="M27 10c-9-2-17 5-18 15-1 8 5 14 12 13 8-1 13-8 12-16-1-4-3-7-6-9z" fill="#ff5a2a" stroke="#7a1a06" stroke-width="2.6"/><path d="M27 10c0-4 2-6 6-7" stroke="#4f9c26" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M33 3c4-1 7 0 8 2-3 1-5 1-8-2z" fill="#63b32c"/><ellipse cx="18" cy="22" rx="2.6" ry="4.4" fill="#ffb3a0" opacity="0.8"/></svg>',
};

// 首页地图卡片的场景剪影：按地图 id 画一小片"能认出来"的图形（雪柱 / 城墙 / 森林 / 云桥 / 楼群）。
// 用 CSS 变量控制颜色，暗态和选中态各取一套，不额外下载图片。
const MAP_ART = {
  backyard: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><path d="M0 58c14-6 24 4 38-1s22-9 40-3 28 2 42 5v21H0z" fill="var(--art-a)"/><g fill="var(--art-b)"><rect x="20" y="40" width="7" height="22" rx="3"/><rect x="52" y="34" width="7" height="28" rx="3"/><rect x="86" y="43" width="7" height="19" rx="3"/></g><circle cx="23.5" cy="36" r="7" fill="var(--art-c)"/><circle cx="55.5" cy="30" r="7" fill="var(--art-c)"/><circle cx="89.5" cy="39" r="6" fill="var(--art-c)"/></svg>',
  snow: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><path d="M0 60h120v20H0z" fill="var(--art-a)"/><g fill="var(--art-b)"><rect x="18" y="26" width="12" height="34"/><rect x="54" y="26" width="12" height="34"/><rect x="90" y="26" width="12" height="34"/></g><path d="M0 60l14-8 12 5 16-9 14 8 18-7 16 9 16-6 14 5v1H0z" fill="var(--art-c)"/><g fill="var(--art-c)" opacity=".55"><circle cx="38" cy="16" r="2"/><circle cx="74" cy="12" r="1.6"/><circle cx="100" cy="20" r="1.4"/></g></svg>',
  dust: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><path d="M0 62h120v18H0z" fill="var(--art-a)"/><g fill="var(--art-b)"><rect x="8" y="34" width="26" height="28" rx="2"/><rect x="40" y="26" width="18" height="36" rx="2"/><rect x="64" y="38" width="24" height="24" rx="2"/><rect x="94" y="30" width="20" height="32" rx="2"/></g><g fill="var(--art-c)"><rect x="13" y="40" width="5" height="7"/><rect x="23" y="40" width="5" height="7"/><rect x="45" y="32" width="4" height="6"/><rect x="71" y="44" width="5" height="6"/><rect x="100" y="36" width="5" height="6"/></g></svg>',
  forest: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><path d="M0 64h120v16H0z" fill="var(--art-a)"/><g fill="var(--art-b)"><path d="M20 64l10-30 10 30z"/><path d="M42 64l8-24 8 24z"/><path d="M66 64l12-36 12 36z"/><path d="M94 64l8-22 8 22z"/></g><g fill="var(--art-c)"><circle cx="30" cy="46" r="1.6"/><circle cx="80" cy="40" r="1.6"/><circle cx="100" cy="50" r="1.4"/><circle cx="52" cy="52" r="1.2"/></g></svg>',
  cloud: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><g fill="var(--art-b)"><circle cx="22" cy="56" r="12"/><circle cx="38" cy="60" r="9"/><circle cx="96" cy="58" r="11"/><circle cx="80" cy="62" r="8"/></g><path d="M34 52h52v5H34z" fill="var(--art-c)"/><g fill="var(--art-c)"><rect x="56" y="20" width="9" height="32" rx="2"/><circle cx="60.5" cy="18" r="5"/></g></svg>',
  downtown: '<svg viewBox="0 0 120 80" preserveAspectRatio="none"><g fill="var(--art-b)"><rect x="10" y="30" width="20" height="42"/><rect x="34" y="18" width="24" height="54"/><rect x="62" y="36" width="18" height="36"/><rect x="84" y="24" width="26" height="48"/></g><g fill="var(--art-c)"><rect x="15" y="36" width="3" height="3"/><rect x="22" y="36" width="3" height="3"/><rect x="40" y="24" width="3" height="3"/><rect x="49" y="24" width="3" height="3"/><rect x="40" y="34" width="3" height="3"/><rect x="49" y="34" width="3" height="3"/><rect x="67" y="44" width="3" height="3"/><rect x="90" y="32" width="3" height="3"/><rect x="100" y="32" width="3" height="3"/><rect x="90" y="42" width="3" height="3"/></g><path d="M0 72h120v8H0z" fill="var(--art-a)"/></svg>',
};

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmtBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

export class HUD {
  constructor() {
    this.hud = document.getElementById('hud');
    this.startScreen = document.getElementById('startScreen');
    this.pauseScreen = document.getElementById('pauseScreen');
    this.overScreen = document.getElementById('overScreen');
    this.hpFill = document.getElementById('hpFill');
    this.hpText = document.getElementById('hpText');
    this.peerHpRow = document.getElementById('peerHpRow');
    this.peerHpFill = document.getElementById('peerHpFill');
    this.peerHpText = document.getElementById('peerHpText');
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
    this.nextWaveBtn = document.getElementById('nextWaveBtn');
    this.damageEl = document.getElementById('damageVignette');
    this.tutorialEl = document.getElementById('tutorial');
    this.joyBase = document.getElementById('joyBase');
    this.joyKnob = document.getElementById('joyKnob');
    this.mapSelect = document.getElementById('mapSelect');
    this.startBtn = document.getElementById('startBtn');
    this.loadPanel = document.getElementById('loadPanel');
    this.loadTitle = document.getElementById('loadTitle');
    this.loadCount = document.getElementById('loadCount');
    this.loadBar = document.querySelector('#loadPanel .load-track');
    this.loadFill = document.getElementById('loadFill');
    this.loadBytes = document.getElementById('loadBytes');
    this.loadNote = document.getElementById('loadNote');
    this.loadList = document.getElementById('loadList');
    this.loadCache = { state: '', pct: -1, count: '', bytes: '', listKey: '' };
    this.duoBtn = document.getElementById('duoBtn');
    this.duoShare = document.getElementById('duoShare');
    this.duoStatusEl = document.getElementById('duoStatus');
    this.duoOverScreen = document.getElementById('duoOverScreen');
    this.duoOverStatus = document.getElementById('duoOverStatus');
    this.duoShareUrl = '';
    this.ammoChip = document.getElementById('ammoChip');
    this.ammoNow = document.getElementById('ammoNow');
    this.ammoMax = document.getElementById('ammoMax');
    this.muteBtn = document.getElementById('muteBtn');
    this.fireBtn = document.getElementById('fireBtn');
    this.jumpBtn = document.getElementById('jumpBtn');
    this.desktopHint = document.getElementById('desktopHint');
    this.isTouch = true;

    // 槽位按钮就是全部武器按钮（植物栏已取消）；entry.index 随槽内容变化
    this.weaponButtons = [];
    this.slotButtons = null;
    this.slotDock = null;
    this.slotState = { peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] };
    this.slotAmmo = [];
    this.activeSlotIndex = -1;
    this.replacing = false;
    this.currentIndex = 0;
    this.cache = { hp: -1, sun: -1, score: -1, kills: -1, wave: -1, ammo: -1, shield: -1, peer: '', duo: false };
    this.muted = false;
    this.bannerTimer = 0;
    this.tutorialTimer = 0;
    this.damageTimer = 0;

    this.buildDock();
    this.bind();
  }

  buildDock() {
    // 植物栏已取消：只有 5 个角色槽，数字键 1-5 就是全部切枪键。
    // 槽位本身带角色，所以"同类替换"天然成立，玩家看槽位就知道该装什么。
    const layout = [
      { role: 'peaGun', pos: 0, key: '1', label: '豌豆' },
      { role: 'gun', pos: 0, key: '2', label: '枪' },
      { role: 'demo', pos: 0, key: '3', label: '大杀器' },
      { role: 'grenade', pos: 0, key: '4', label: '手雷' },
      { role: 'shield', pos: 0, key: '5', label: '护盾' },
    ];
    this.slotLayout = layout;
    this.slotButtons = [];
    this.slotDock = document.createElement('div');
    this.slotDock.className = 'slot-dock';
    for (let i = 0; i < layout.length; i++) {
      const cell = layout[i];
      const btn = document.createElement('button');
      btn.className = 'weapon-btn slot-btn empty role-' + cell.role;
      btn.dataset.slot = String(i);
      btn.dataset.role = cell.role;
      btn.setAttribute('aria-label', cell.label + '（空）');
      btn.innerHTML =
        '<span class="wkey">' + cell.key + '</span>' +
        '<span class="slot-icon"></span>' +
        '<span class="wname slot-name">' + cell.label + '</span>' +
        '<span class="wcost hidden"></span>' +
        '<span class="wammo"></span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onSlotSelect) this.onSlotSelect(cell.role, cell.pos);
      });
      this.slotDock.appendChild(btn);
      this.slotButtons.push(btn);
      this.weaponButtons.push({ btn, index: -1 });
    }
    // 有槽位才显示这条；全空时整条隐藏，避免空占屏幕
    this.slotDock.classList.add('hidden');
    document.querySelector('.dock').appendChild(this.slotDock);
  }

  bind() {
    const start = document.getElementById('startBtn');
    const resume = document.getElementById('resumeBtn');
    const restart = document.getElementById('restartBtn');
    const again = document.getElementById('againBtn');
    const pause = document.getElementById('pauseBtn');

    let nextWavePointer = 'mouse';
    this.nextWaveBtn.addEventListener('pointerdown', (e) => {
      nextWavePointer = e.pointerType;
      if (nextWavePointer !== 'touch' && nextWavePointer !== 'pen') return;
      // 摇杆拖动后浏览器可能不再合成 click，触摸与跳跃键一样直接响应按下。
      e.preventDefault(); e.stopPropagation();
      if (this.onNextWave) this.onNextWave();
    });
    this.nextWaveBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.detail > 0 && nextWavePointer !== 'mouse') return;
      if (this.onNextWave) this.onNextWave();
    });
    if (start) start.addEventListener('click', () => { if (this.onStart) this.onStart(); });
    if (this.duoBtn) this.duoBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (this.onDuo) this.onDuo(); });
    if (this.duoShare) this.duoShare.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (this.onDuoShare) this.onDuoShare(); });
    if (resume) resume.addEventListener('click', () => { if (this.onResume) this.onResume(); });
    if (restart) restart.addEventListener('click', () => { if (this.onRestart) this.onRestart(); });
    if (again) again.addEventListener('click', () => { if (this.onStart) this.onStart(); });
    if (pause) pause.addEventListener('click', () => { if (this.onPause) this.onPause(); });
    const duoAgain = document.getElementById('duoAgainBtn');
    if (duoAgain) duoAgain.addEventListener('click', () => { if (this.onDuoRematch) this.onDuoRematch(); });
    const duoLeave = document.getElementById('duoLeaveBtn');
    if (duoLeave) duoLeave.addEventListener('click', () => { if (this.onDuoLeave) this.onDuoLeave(); });
    const mapBtn = document.getElementById('mapBtn');
    if (mapBtn) mapBtn.addEventListener('click', () => { if (this.onChangeMap) this.onChangeMap(); });
    const pauseMapBtn = document.getElementById('pauseMapBtn');
    if (pauseMapBtn) pauseMapBtn.addEventListener('click', () => { if (this.onChangeMap) this.onChangeMap(); });
    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', () => {
        this.muted = !this.muted;
        this.muteBtn.classList.toggle('muted', this.muted);
        if (this.onMute) this.onMute(this.muted);
      });
    }
  }

  buildMapSelect(maps, selected) {
    if (!this.mapSelect) return;
    this.mapSelect.innerHTML = '';
    this.mapButtons = [];
    for (let i = 0; i < maps.length; i++) {
      const m = maps[i];
      // 卡片结构：缩略图（渐变 + 场景剪影）→ 序号/英文标签 → 中文名 → 一句玩法 → 风险标签
      const btn = document.createElement('button');
      btn.className = 'map-card map-' + m.id;
      btn.dataset.map = m.id;
      btn.type = 'button';
      btn.innerHTML =
        '<span class="map-art" aria-hidden="true">' + (MAP_ART[m.id] || '') + '<i class="map-index">' + (i + 1) + '</i></span>' +
        '<span class="map-body">' +
        '<span class="map-tag">' + escapeHtml(m.tag) + '</span>' +
        '<span class="map-name">' + escapeHtml(m.name) + '</span>' +
        '<span class="map-desc">' + escapeHtml(m.desc) + '</span>' +
        (m.mode ? '<span class="map-chip">' + escapeHtml(m.mode) + '</span>' : '') +
        '</span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onMapSelect) this.onMapSelect(m.id);
      });
      this.mapSelect.appendChild(btn);
      this.mapButtons.push({ id: m.id, btn });
    }
    this.setMapSelection(selected);
  }

  setMapSelection(id) {
    if (!this.mapButtons) return;
    for (let i = 0; i < this.mapButtons.length; i++) {
      const on = this.mapButtons[i].id === id;
      this.mapButtons[i].btn.classList.toggle('active', on);
      this.mapButtons[i].btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  setStartLabel(text) {
    if (this.startBtn) this.startBtn.textContent = text;
  }

  // 首页加载面板。summary 来自 src/assets/LoadProgress.js 的 loadSummary()。
  // 每帧都调也行（内部做差量缓存），但 Game 只在有变化时调。
  setLoadState(summary) {
    if (!this.loadPanel) return;
    const c = this.loadCache;
    const pct = Math.max(0, Math.min(100, summary.percent || 0));
    const ready = !!summary.ready;
    const finished = !!summary.finished;
    const state = ready ? (finished ? 'done' : 'ready') : 'loading';
    if (c.state !== state) {
      c.state = state;
      this.loadPanel.dataset.state = state;
      this.loadPanel.classList.toggle('is-done', state === 'done');
      if (this.loadTitle) {
        this.loadTitle.textContent =
          state === 'loading' ? '正在下载战斗素材' : state === 'ready' ? '首屏已就绪' : '全部素材就绪';
      }
      if (this.loadNote) {
        this.loadNote.textContent =
          state === 'loading' ? '僵尸、植物与场景模型，第一次打开稍慢一点' : state === 'ready' ? '可以先开打，其余模型在后台继续加载' : '点击开始保卫后院';
      }
      // 首屏就绪后启用开始按钮（文案由 setStartLabel 管，这里只切 disabled）
      if (this.startBtn) this.startBtn.disabled = !ready;
      const screen = document.getElementById('startScreen');
      if (screen) screen.classList.toggle('is-loading', !ready);
    }
    // 进度条只在百分比变化时写 DOM（每 tick 可能都在涨，避免抖动重排）
    const shown = state === 'loading' ? Math.round(pct) : 100;
    if (c.pct !== shown) {
      c.pct = shown;
      if (this.loadFill) this.loadFill.style.width = shown + '%';
      if (this.loadBar) this.loadBar.setAttribute('aria-valuenow', String(shown));
    }
    const count = summary.done + ' / ' + summary.count;
    if (c.count !== count && this.loadCount) {
      c.count = count;
      this.loadCount.textContent = count;
    }
    const bytes = fmtBytes(summary.loaded) + (summary.total ? ' / ' + fmtBytes(summary.total) : '');
    if (c.bytes !== bytes && this.loadBytes) {
      c.bytes = bytes;
      this.loadBytes.textContent = bytes;
    }
    this.renderLoadList(summary);
  }

  // 已下载的文件清单：只显示最后几条，让玩家看见"确实在动"而不是干等一个条。
  renderLoadList(summary) {
    if (!this.loadList || !summary.files) return;
    const list = summary.files;
    const key = list.map((f) => f.label + (f.done ? '1' : '0')).join('|');
    if (this.loadCache.listKey === key) return;
    this.loadCache.listKey = key;
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      html += '<li class="' + (f.done ? 'done' : 'active') + '"><i></i><span>' + escapeHtml(f.label) + '</span><em>' + (f.total ? fmtBytes(f.total) : '') + '</em></li>';
    }
    this.loadList.innerHTML = html;
  }

  setDuoStatus(text, tone = 'idle') {
    if (!this.duoStatusEl) return;
    this.duoStatusEl.textContent = text || '';
    this.duoStatusEl.classList.toggle('hidden', !text);
    this.duoStatusEl.dataset.tone = tone;
  }

  setDuoMode(active) {
    if (!this.duoBtn) return;
    this.duoBtn.textContent = active ? '取消双人联机' : '双人联机';
    this.duoBtn.classList.toggle('active', !!active);
    if (!active) this.setDuoShare('');
  }

  setDuoShare(url) {
    this.duoShareUrl = url || '';
    if (!this.duoShare) return;
    this.duoShare.classList.toggle('hidden', !url);
  }

  showStartScreen() {
    this.startScreen.classList.remove('hidden');
  }

  setIntermission(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    if (value === this.intermissionValue) return;
    this.intermissionValue = value;
    this.nextWaveBtn.classList.toggle('hidden', value === 0);
    this.nextWaveBtn.textContent = '准备好了 · 下一波 / Enter' + (value ? '（' + value + '秒）' : '');
  }

  showHud(v) {
    this.hud.classList.toggle('hidden', !v);
  }

  hideScreens() {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.overScreen.classList.add('hidden');
    if (this.duoOverScreen) this.duoOverScreen.classList.add('hidden');
  }

  // 双人结算：比单人多一栏队友战功与胜负判定。
  showDuoResult({ scores, kills, seat, wave, peerName, reason }) {
    if (!this.duoOverScreen) return;
    const my = scores && scores[seat] !== undefined ? scores[seat] : 0;
    const other = scores && scores[1 - seat] !== undefined ? scores[1 - seat] : 0;
    const mk = kills && kills[seat] !== undefined ? kills[seat] : 0;
    const ok = kills && kills[1 - seat] !== undefined ? kills[1 - seat] : 0;
    const title = document.getElementById('duoOverTitle');
    if (title) title.textContent = reason === 'WIPE' ? '两人都倒下了' : '对局结束';
    document.getElementById('duoMyScore').textContent = formatNum(my);
    document.getElementById('duoPeerScore').textContent = formatNum(other);
    document.getElementById('duoWave').textContent = String(Math.max(1, wave || 1));
    const detail = document.getElementById('duoOverDetail');
    if (detail) {
      const verdict = my > other ? '你赢了这场战功对决' : my < other ? (peerName || '队友') + ' 赢了这场对决' : '平局';
      detail.textContent = verdict + ' · 击杀 ' + mk + ' : ' + ok;
    }
    this.setDuoResultStatus('');
    this.hideScreens();
    this.showHud(false);
    this.duoOverScreen.classList.remove('hidden');
    this.bossBar.classList.add('hidden');
  }

  setDuoResultStatus(text) {
    if (!this.duoOverStatus) return;
    this.duoOverStatus.textContent = text || '';
    this.duoOverStatus.classList.toggle('hidden', !text);
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

  // 双人有队友：整行只在双人模式出现，单人/回菜单藏掉，缓存命中不重复写 DOM
  setDuoHud(on) {
    if (this.cache.duo === !!on) return;
    this.cache.duo = !!on;
    if (!this.peerHpRow) return;
    this.peerHpRow.classList.toggle('hidden', !on);
    // 再显示时（reset 后）把最后一条血量重写一遍，别让缓存 key 把新一局的首帧短路掉
    if (on) this.setPeerHealth(this.lastHp, this.lastMax, this.lastOpts);
  }

  // 队友血量：downed 时整行 .down、数字位写「倒地」；max 未知就只显示数字、不写宽度
  setPeerHealth(hp, max, opts) {
    if (!this.peerHpRow) return;
    const downed = !!(opts && opts.downed);
    const hasMax = Number.isFinite(max) && max > 0;
    const v = downed || !Number.isFinite(hp) ? 0 : Math.max(0, Math.ceil(hp));
    const pct = downed || !hasMax ? 0 : Math.round(Math.max(0, Math.min(1, hp / max)) * 100);
    const key = downed ? 'down' : v + ':' + pct;
    this.lastHp = hp;
    this.lastMax = max;
    this.lastOpts = opts;
    if (this.cache.peer === key) return;
    this.cache.peer = key;
    this.peerHpRow.classList.toggle('down', downed);
    this.peerHpRow.classList.toggle('low', !downed && hasMax && hp / max <= 0.32);
    this.peerHpText.title = downed || !opts || !opts.name ? '' : opts.name;
    if (downed) {
      this.peerHpText.textContent = '倒地';
      return;
    }
    this.peerHpText.textContent = String(v);
    if (hasMax) this.peerHpFill.style.width = pct + '%';
  }

  // 坚果盾血：盾没展开时半透明显示剩余量，破盾/重开就整条隐藏
  setShield(hp, max, active) {
    if (!this.shieldRow) {
      this.shieldRow = document.getElementById('shieldRow');
      this.shieldFill = document.getElementById('shieldFill');
      this.shieldText = document.getElementById('shieldText');
    }
    if (!this.shieldRow) return;
    const v = Math.max(0, Math.ceil(hp || 0));
    const key = v + ':' + (active ? 1 : 0);
    if (this.cache.shield === key) return;
    this.cache.shield = key;
    this.shieldRow.classList.toggle('hidden', v <= 0);
    if (v <= 0) return;
    const ratio = Math.max(0, Math.min(1, hp / (max || 1)));
    this.shieldFill.style.width = (ratio * 100).toFixed(1) + '%';
    this.shieldText.textContent = String(v);
    this.shieldRow.classList.toggle('mid', ratio <= 0.5 && ratio > 0.25);
    this.shieldRow.classList.toggle('low', ratio <= 0.25);
    this.shieldRow.classList.toggle('idle', !active);
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
      const entry = this.weaponButtons[i];
      if (entry.index < 0) {
        entry.btn.classList.remove('poor');
        continue;
      }
      entry.btn.classList.toggle('poor', sun < WEAPONS[entry.index].cost);
    }
  }

  denySun() {
    this.sunPill.classList.remove('deny');
    void this.sunPill.offsetWidth;
    this.sunPill.classList.add('deny');
    setTimeout(() => this.sunPill.classList.remove('deny'), 340);
  }

  setWeapon(index) {
    this.currentIndex = index;
    const def = WEAPONS[index];
    if (def && this.crosshair) {
      this.crosshair.style.transform = 'scale(1.08)';
      setTimeout(() => { this.crosshair.style.transform = ''; }, 120);
    }
  }

  // 武器槽同步：slots 是按角色分组的 { gun: [i0, i1], demo: i, grenade: i, shield: i }，-1 = 空
  setSlots(slots) {
    this.slotState = slots;
    if (!this.slotButtons) return;
    const cells = this.slotLayout || [];
    const any = cells.some((c) => this.slotAt(slots, c) >= 0);
    this.slotDock.classList.toggle('hidden', !any);
    for (let i = 0; i < this.slotButtons.length; i++) {
      const btn = this.slotButtons[i];
      const cell = cells[i];
      const idx = cell ? this.slotAt(slots, cell) : -1;
      const empty = idx < 0;
      btn.classList.toggle('empty', empty);
      // 槽位按钮同时就是"武器按钮"：费用角标、可负担状态都跟着槽内容走
      if (this.weaponButtons[i]) this.weaponButtons[i].index = idx;
      const badge = btn.querySelector('.wcost');
      if (empty) {
        btn.querySelector('.slot-icon').innerHTML = '';
        btn.querySelector('.slot-name').textContent = cell ? cell.label : '空';
        btn.querySelector('.wammo').textContent = '';
        if (badge) badge.classList.add('hidden');
        btn.removeAttribute('data-weapon');
        btn.setAttribute('aria-label', (cell ? cell.label : '槽位') + '（空）');
        continue;
      }
      const def = WEAPONS[idx];
      btn.querySelector('.slot-icon').innerHTML = ICONS[def.id] || ICONS.pea;
      btn.querySelector('.slot-name').textContent = def.short;
      btn.querySelector('.wammo').textContent = String(this.slotAmmo[i] || 0);
      if (badge) {
        const free = def.cost === 0;
        badge.textContent = free ? '∞' : String(def.cost);
        badge.classList.toggle('free', free);
        badge.classList.remove('hidden');
      }
      btn.setAttribute('data-weapon', def.id);
      btn.setAttribute('aria-label', def.name + '，' + (this.slotAmmo[i] || 0) + ' 发');
    }
  }

  slotAt(slots, cell) {
    const arr = slots && slots[cell.role];
    return arr && arr[cell.pos] !== undefined ? arr[cell.pos] : -1;
  }

  // 当前激活的是哪个槽（null = 手上是植物栏里的植物）
  setActiveSlot(active) {
    this.activeSlotIndex = active;
    if (!this.slotButtons) return;
    const cells = this.slotLayout || [];
    for (let i = 0; i < this.slotButtons.length; i++) {
      const btn = this.slotButtons[i];
      const cell = cells[i];
      const on = !!active && !!cell && active.role === cell.role && active.pos === cell.pos;
      btn.classList.toggle('active', on && !btn.classList.contains('empty'));
    }
  }

  // 槽位角标上的弹药数（每个槽独立）
  setSlotAmmo(cell, ammo) {
    if (!this.slotAmmo) this.slotAmmo = [];
    if (!this.slotButtons || !this.slotLayout) return;
    const i = this.slotLayout.findIndex((c) => c.role === cell.role && c.pos === cell.pos);
    if (i < 0) return;
    this.slotAmmo[i] = ammo;
    const btn = this.slotButtons[i];
    if (!btn || btn.classList.contains('empty')) return;
    btn.querySelector('.wammo').textContent = String(ammo);
    btn.classList.toggle('locked', ammo <= 0);
  }

  // 手雷蓄力条：0..1，0 = 没在蓄力
  setCharge(ratio) {
    if (!this.chargeBar) {
      this.chargeBar = document.getElementById('chargeBar');
      this.chargeFill = document.getElementById('chargeFill');
    }
    if (!this.chargeBar) return;
    const v = Math.max(0, Math.min(1, ratio || 0));
    this.chargeBar.classList.toggle('on', v > 0);
    if (this.chargeFill) this.chargeFill.style.width = (v * 100).toFixed(1) + '%';
  }

  // 充能植物（坚果）的剩余颗数：画在它所在槽位的费用角标上
  setCharges(index, charges, max) {
    const key = 'c' + index;
    if (this.cache[key] === charges) return;
    this.cache[key] = charges;
    for (let i = 0; i < this.weaponButtons.length; i++) {
      const entry = this.weaponButtons[i];
      if (entry.index !== index) continue;
      const badge = entry.btn.querySelector('.wcost');
      if (badge) {
        badge.textContent = String(charges);
        badge.classList.remove('hidden');
        badge.classList.toggle('free', charges > 0);
      }
      const poor = charges <= 0;
      if (poor !== entry.btn.classList.contains('poor')) entry.btn.classList.toggle('poor', poor);
      return;
    }
    void max;
  }

  setAmmo(ammo, max, visible, locked) {
    // 顶部弹药条服务于"当前手上这把"；槽位角标由 WeaponSystem 通过 setSlotAmmo 单独维护
    if (visible && this.activeSlotIndex) this.setSlotAmmo(this.activeSlotIndex, ammo);
    if (!this.ammoChip) return;
    this.ammoChip.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (this.ammoNow) this.ammoNow.textContent = String(ammo);
    if (this.ammoMax) this.ammoMax.textContent = String(max);
    // 阳光不够续弹时锁定：弹药条变暗提示"枪还在，钱不够"
    this.ammoChip.classList.toggle('locked', !!locked);
    this.ammoChip.classList.toggle('low', !locked && ammo <= Math.max(2, max * 0.2));
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

  setBossName(name) {
    if (this.bossName === name) return;
    this.bossName = name;
    this.bossBar.querySelector('.boss-name').textContent = name;
  }

  setBossVisible(v) {
    this.bossBar.classList.toggle('hidden', !v);
  }

  setBossHp(ratio) {
    this.bossFill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
  }

  // 投掷物（西瓜）走抛物线，准星只表示「落点方向」，所以换成圆圈准星，和直线弹种区分开
  setCrosshair(arc) {
    if (this.arcCross === arc) return;
    this.arcCross = arc;
    this.crosshair.classList.toggle('arc', arc);
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
    if (this.joyBase) {
      this.joyBase.classList.toggle('hidden', !touch);
      if (!touch) this.joyBase.classList.remove('active');
    }
    this.tutorialEl.innerHTML = touch
      ? '<div><b>左下摇杆</b> 移动 · <b>右侧拖动</b> 瞄准</div><div><b>右下开火</b> · <b>跳跃</b>在开火上方 · 底部植物栏切换 · 踩植物拾取</div>'
      : '<div><b>WASD</b> 移动 · <b>鼠标</b> 瞄准 · <b>左键</b> 射击</div><div><b>空格</b> 跳跃 · <b>1-4</b> 切换植物 · <b>5</b> 战利品</div>';
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

  showJoystick() {
    this.joyBase.classList.remove('hidden');
    this.joyBase.classList.add('active');
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  moveJoystick(dx, dy) {
    this.joyKnob.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
  }

  hideJoystick() {
    if (!this.joyBase) return;
    this.joyBase.classList.remove('active');
    this.joyKnob.style.transform = 'translate(0px, 0px)';
    if (!this.isTouch) this.joyBase.classList.add('hidden');
  }

  reset() {
    this.cache = { hp: -1, sun: -1, score: -1, kills: -1, wave: -1, ammo: -1, shield: -1, peer: '', duo: this.cache.duo };
    this.setSlots({ peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] });
    this.setShield(0, 1, false);
    this.setActiveSlot(null);
    this.setCharge(0);
    this.setIntermission(0);
    this.setAmmo(0, 0, false);
    this.setHealth(100, 100);
    this.setScore(0);
    this.setKills(0);
    this.setWave(1);
    this.setBossVisible(false);
    this.hitmarkerEl.classList.remove('show', 'head');
    this.crosshair.classList.remove('lock');
    this.aimLock = false;
    this.setCrosshair(false);
    this.damageEl.classList.remove('show');
    this.bannerEl.classList.remove('show');
    this.tutorialEl.classList.add('fade');
  }
}
