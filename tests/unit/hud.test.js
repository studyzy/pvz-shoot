import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountIndexHtml, installGlobals } from '../helpers/env.js';
import { HUD } from '../../src/ui/HUD.js';
import { WEAPONS } from '../../src/config.js';
import { formatNum } from '../../src/utils.js';

const $ = (id) => document.getElementById(id);
const starterWeapons = WEAPONS.filter((w) => w.starter);
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('HUD 投掷物准星', () => {
  let hud;

  beforeEach(() => {
    installGlobals();
    mountIndexHtml();
    hud = new HUD();
  });

  it('setCrosshair(true) 给准星加 arc 类，false 去掉；重复设置不重复触发', () => {
    const el = $('crosshair');
    expect(el.classList.contains('arc')).toBe(false);
    hud.setCrosshair(true);
    expect(el.classList.contains('arc')).toBe(true);
    hud.setCrosshair(true); // 缓存命中，仍是 arc
    expect(el.classList.contains('arc')).toBe(true);
    hud.setCrosshair(false);
    expect(el.classList.contains('arc')).toBe(false);
  });

  it('reset() 清掉 arc 与 lock，回到直线准星', () => {
    const el = $('crosshair');
    hud.setCrosshair(true);
    hud.setAimLock(true);
    hud.reset();
    expect(el.classList.contains('arc')).toBe(false);
    expect(el.classList.contains('lock')).toBe(false);
    // reset 后缓存也要同步：再设一次 true 仍能生效
    hud.setCrosshair(true);
    expect(el.classList.contains('arc')).toBe(true);
  });
});

describe('HUD', () => {
  let hud;

  beforeEach(() => {
    installGlobals();
    mountIndexHtml();
    hud = new HUD();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildDock', () => {
    it('为每个 starter 武器生成一格，序号从 1 连续递增，data-index 指向 WEAPONS 下标', () => {
      expect(starterWeapons.length).toBeGreaterThan(0);
      expect(hud.weaponButtons).toHaveLength(starterWeapons.length);

      const btns = [...hud.weaponDock.querySelectorAll('button.weapon-btn:not(.loot-btn)')];
      expect(btns).toHaveLength(starterWeapons.length);
      expect(hud.weaponDock.children).toHaveLength(starterWeapons.length + 1); // + 战利品格

      btns.forEach((btn, slot) => {
        const def = starterWeapons[slot];
        expect(btn.querySelector('.wkey').textContent).toBe(String(slot + 1));
        expect(btn.querySelector('.wname').textContent).toBe(def.short);
        expect(btn.getAttribute('aria-label')).toBe(def.name);
        expect(Number(btn.dataset.index)).toBe(WEAPONS.indexOf(def));
        expect(btn.querySelector('svg')).toBeTruthy(); // 每个植物都有图标
        const cost = btn.querySelector('.wcost');
        if (def.cost === 0) {
          expect(cost.textContent).toBe('∞');
          expect(cost.classList.contains('free')).toBe(true);
        } else {
          expect(cost.textContent).toBe(String(def.cost));
          expect(cost.classList.contains('free')).toBe(false);
        }
      });
    });

    it('战利品格固定在最后、初始 hidden、带 5 号键位', () => {
      expect(hud.lootBtn).toBeTruthy();
      expect(hud.weaponDock.lastElementChild).toBe(hud.lootBtn);
      expect(hud.lootBtn.classList.contains('hidden')).toBe(true);
      expect(hud.lootBtn.classList.contains('loot-btn')).toBe(true);
      expect(hud.lootBtn.querySelector('.wkey').textContent).toBe('5');
    });

    it('点击植物格用 WEAPONS 下标回调 onWeaponSelect，并阻止默认行为/冒泡', () => {
      const onWeaponSelect = vi.fn();
      hud.onWeaponSelect = onWeaponSelect;
      const btn = hud.weaponButtons[2].btn;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      btn.dispatchEvent(ev);
      expect(onWeaponSelect).toHaveBeenCalledWith(hud.weaponButtons[2].index);
      expect(ev.defaultPrevented).toBe(true);
      expect(ev.bubbles).toBe(true);
    });

    it('战利品未设置时不回调；setLoot 后才回调对应下标', () => {
      const onWeaponSelect = vi.fn();
      hud.onWeaponSelect = onWeaponSelect;
      click(hud.lootBtn);
      expect(onWeaponSelect).not.toHaveBeenCalled();

      hud.setLoot(7);
      click(hud.lootBtn);
      expect(onWeaponSelect).toHaveBeenCalledWith(7);
    });
  });

  describe('buildMapSelect / setMapSelection / setStartLabel', () => {
    const maps = [
      { id: 'backyard', name: '后院', tag: '经典', desc: '草地' },
      { id: 'snow', name: '雪地', tag: 'CS', desc: '冰面' },
      { id: 'dust', name: '沙城', tag: 'dust2', desc: '沙漠' },
    ];

    it('按地图数组生成卡片，文字来自数据，选中项加 active', () => {
      hud.buildMapSelect(maps, 'snow');
      const cards = [...hud.mapSelect.querySelectorAll('button.map-card')];
      expect(cards).toHaveLength(3);
      cards.forEach((card, i) => {
        expect(card.dataset.map).toBe(maps[i].id);
        expect(card.classList.contains('map-' + maps[i].id)).toBe(true);
        expect(card.querySelector('.map-tag').textContent).toBe(maps[i].tag);
        expect(card.querySelector('.map-name').textContent).toBe(maps[i].name);
        expect(card.querySelector('.map-desc').textContent).toBe(maps[i].desc);
        expect(card.classList.contains('active')).toBe(maps[i].id === 'snow');
      });
    });

    it('重复 build 会清空旧的卡片；点击卡片回调 onMapSelect(id)', () => {
      hud.buildMapSelect(maps, 'backyard');
      const onMapSelect = vi.fn();
      hud.onMapSelect = onMapSelect;
      hud.buildMapSelect(maps, 'dust');
      expect(hud.mapSelect.children).toHaveLength(3);
      expect(hud.mapButtons).toHaveLength(3);

      click(hud.mapSelect.querySelector('[data-map="snow"]'));
      expect(onMapSelect).toHaveBeenCalledWith('snow');
    });

    it('setMapSelection 只在唯一卡片上加 active；未知 id 全部取消', () => {
      hud.buildMapSelect(maps, 'backyard');
      hud.setMapSelection('dust');
      const active = [...hud.mapSelect.querySelectorAll('.active')];
      expect(active).toHaveLength(1);
      expect(active[0].dataset.map).toBe('dust');

      hud.setMapSelection('nope');
      expect(hud.mapSelect.querySelectorAll('.active')).toHaveLength(0);
    });

    it('没有地图容器时 buildMapSelect 直接返回', () => {
      hud.mapSelect = null;
      expect(() => hud.buildMapSelect(maps, 'snow')).not.toThrow();
    });

    it('没有地图容器/没 build 过时 setMapSelection 不抛错', () => {
      const fresh = new HUD();
      expect(fresh.mapButtons).toBeUndefined();
      expect(() => fresh.setMapSelection('snow')).not.toThrow();
    });

    it('setStartLabel 写开始按钮文案', () => {
      hud.setStartLabel('开始保卫雪地');
      expect($('startBtn').textContent).toBe('开始保卫雪地');
    });
  });

  describe('界面显隐', () => {
    it('showHud 切换 hud 的 hidden 类', () => {
      expect(hud.hud.classList.contains('hidden')).toBe(true);
      hud.showHud(true);
      expect(hud.hud.classList.contains('hidden')).toBe(false);
      hud.showHud(false);
      expect(hud.hud.classList.contains('hidden')).toBe(true);
    });

    it('hideScreens 同时隐藏开始/暂停/结算；showPause/hidePause 只动暂停', () => {
      hud.showStartScreen();
      hud.showPause();
      hud.showGameOver(0, 1, 0);
      expect($('startScreen').classList.contains('hidden')).toBe(false);
      expect($('pauseScreen').classList.contains('hidden')).toBe(false);
      expect($('overScreen').classList.contains('hidden')).toBe(false);

      hud.hideScreens();
      expect($('startScreen').classList.contains('hidden')).toBe(true);
      expect($('pauseScreen').classList.contains('hidden')).toBe(true);
      expect($('overScreen').classList.contains('hidden')).toBe(true);

      hud.showPause();
      expect($('pauseScreen').classList.contains('hidden')).toBe(false);
      hud.hidePause();
      expect($('pauseScreen').classList.contains('hidden')).toBe(true);
    });

    it('showGameOver 用千分位写结算数字，并隐藏 Boss 血条', () => {
      hud.setBossVisible(true);
      hud.showGameOver(12345.6, 7, 88);
      expect($('overScreen').classList.contains('hidden')).toBe(false);
      expect($('finalScore').textContent).toBe(formatNum(12345.6));
      expect($('finalScore').textContent).toBe('12,346');
      expect($('finalWave').textContent).toBe('7');
      expect($('finalKills').textContent).toBe('88');
      expect($('bossBar').classList.contains('hidden')).toBe(true);
    });
  });

  describe('数值缓存', () => {
    let hpWidthSpy;
    let sunTextSpy;

    beforeEach(() => {
      hpWidthSpy = vi.spyOn(hud.hpFill.style, 'width', 'set');
      sunTextSpy = vi.spyOn(hud.sunValue, 'textContent', 'set');
    });

    it('setHealth 相同显示值不重复写 DOM，变化后按比例写宽度', () => {
      hud.setHealth(75, 100);
      expect(hud.hpFill.style.width).toBe('75%'); // CSS 序列化会去掉末尾的 .0
      expect(hud.hpText.textContent).toBe('75');
      expect(hpWidthSpy).toHaveBeenCalledTimes(1);

      hud.setHealth(75, 100);
      hud.setHealth(74.2, 100); // ceil 后仍是 75 → 缓存命中
      expect(hpWidthSpy).toHaveBeenCalledTimes(1);

      hud.setHealth(37, 100);
      expect(hpWidthSpy).toHaveBeenCalledTimes(2);
      expect(hud.hpFill.style.width).toBe('37%');
      expect(hud.hpText.textContent).toBe('37');
    });

    it('setHealth 低位血量加饱和滤镜，满血恢复为空，负数钳到 0', () => {
      hud.setHealth(31, 100);
      expect(hud.hpFill.style.filter).toContain('saturate(1.35)');
      hud.setHealth(32, 100);
      expect(hud.hpFill.style.filter).toBe('');

      hud.setHealth(-5, 100);
      expect(hud.hpText.textContent).toBe('0');
      expect(hud.hpFill.style.width).toBe('0%');
    });

    it('setHealth 比例钳制在 [0,1]', () => {
      hud.setHealth(250, 100);
      expect(hud.hpFill.style.width).toBe('100%');
    });

    it('setSun 相同值不重写；增长时加 pulse，减少不加', () => {
      hud.setSun(70);
      expect(hud.sunValue.textContent).toBe('70');
      expect(sunTextSpy).toHaveBeenCalledTimes(1);
      expect($('sunPill').classList.contains('pulse')).toBe(false); // 首次赋值不算增长

      hud.setSun(70);
      expect(sunTextSpy).toHaveBeenCalledTimes(1);

      hud.setSun(75);
      expect(sunTextSpy).toHaveBeenCalledTimes(2);
      expect($('sunPill').classList.contains('pulse')).toBe(true);

      hud.sunPill.classList.remove('pulse');
      hud.setSun(70);
      expect($('sunPill').classList.contains('pulse')).toBe(false); // 减少不 pulse
    });

    it('setSun silent 增长不加 pulse', () => {
      hud.setSun(70);
      hud.setSun(90, true);
      expect(hud.sunValue.textContent).toBe('90');
      expect($('sunPill').classList.contains('pulse')).toBe(false);
    });

    it('setScore 四舍五入 + 千分位并在同值时不重写', () => {
      const spy = vi.spyOn(hud.scoreLabel, 'textContent', 'set');
      hud.setScore(1234.4);
      expect(hud.scoreLabel.textContent).toBe('1,234');
      expect(spy).toHaveBeenCalledTimes(1);
      hud.setScore(1234.4);
      expect(spy).toHaveBeenCalledTimes(1);
      hud.setScore(999999);
      expect(hud.scoreLabel.textContent).toBe('999,999');
    });

    it('setKills/setWave 缓存：相同值不重写 DOM', () => {
      const killSpy = vi.spyOn(hud.killLabel, 'textContent', 'set');
      const waveSpy = vi.spyOn(hud.waveLabel, 'textContent', 'set');
      hud.setKills(3);
      hud.setKills(3);
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(hud.killLabel.textContent).toBe('3');

      hud.setWave(4);
      hud.setWave(4);
      expect(waveSpy).toHaveBeenCalledTimes(1);
      expect(hud.waveLabel.textContent).toBe('第 4 波');
    });

    it('updateAffordability 阳光低于费用时给按钮加 poor 类', () => {
      const minCost = Math.min(...starterWeapons.map((w) => w.cost));
      const expensive = starterWeapons.filter((w) => w.cost > minCost);
      hud.updateAffordability(0);
      hud.weaponButtons.forEach((entry) => {
        expect(entry.btn.classList.contains('poor')).toBe(WEAPONS[entry.index].cost > 0);
      });
      expect(expensive.length).toBeGreaterThan(0);
      expect(hud.weaponButtons[0].btn.classList.contains('poor')).toBe(false); // 豌豆免费

      hud.setSun(30);
      hud.weaponButtons.forEach((entry) => {
        expect(entry.btn.classList.contains('poor')).toBe(WEAPONS[entry.index].cost > 30);
      });
      hud.setSun(999);
      hud.weaponButtons.forEach((entry) => {
        expect(entry.btn.classList.contains('poor')).toBe(false);
      });
    });
  });

  describe('武器 / 战利品 / 弹药', () => {
    it('setWeapon 只高亮对应格并在 120ms 后还原准星缩放', () => {
      vi.useFakeTimers();
      hud.setWeapon(hud.weaponButtons[1].index);
      expect(hud.currentIndex).toBe(hud.weaponButtons[1].index);
      const active = hud.weaponButtons.filter((e) => e.btn.classList.contains('active'));
      expect(active).toHaveLength(1);
      expect(active[0]).toBe(hud.weaponButtons[1]);
      expect(hud.crosshair.style.transform).toBe('scale(1.08)');
      vi.advanceTimersByTime(119);
      expect(hud.crosshair.style.transform).toBe('scale(1.08)');
      vi.advanceTimersByTime(2);
      expect(hud.crosshair.style.transform).toBe('');
    });

    it('setLoot(-1) 隐藏战利品格并取消 active', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.setLoot(idx);
      hud.setLoot(-1);
      expect(hud.lootIndex).toBe(-1);
      expect(hud.lootBtn.classList.contains('hidden')).toBe(true);
      expect(hud.lootBtn.classList.contains('active')).toBe(false);
    });

    it('setLoot(index) 显示图标与名称，且只在是当前武器时 active', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.setLoot(idx);
      expect(hud.lootBtn.classList.contains('hidden')).toBe(false);
      expect(hud.lootBtn.classList.contains('active')).toBe(false);
      expect(hud.lootBtn.querySelector('.loot-name').textContent).toBe(WEAPONS[idx].short);
      expect(hud.lootBtn.querySelector('.loot-icon').innerHTML).toContain('<svg');

      hud.setWeapon(idx);
      expect(hud.lootBtn.classList.contains('active')).toBe(true);

      hud.setWeapon(hud.weaponButtons[0].index);
      expect(hud.lootBtn.classList.contains('active')).toBe(false);
    });

    it('缺少战利品/弹药 DOM 时 setLoot / setAmmo 安全返回', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.lootBtn = null;
      expect(() => hud.setLoot(idx)).not.toThrow();
      expect(hud.lootIndex).toBe(idx);

      hud.ammoChip = null;
      expect(() => hud.setAmmo(5, 10, true)).not.toThrow();
    });

    it('战利品格内部缺 icon/name/badge 时只跳过对应部分', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.lootBtn.querySelector('.loot-icon').remove();
      hud.lootBtn.querySelector('.loot-name').remove();
      hud.lootBtn.querySelector('.wammo').remove();
      expect(() => hud.setLoot(idx)).not.toThrow();
      expect(() => hud.setAmmo(4, 10, true)).not.toThrow();
      expect(hud.lootBtn.classList.contains('hidden')).toBe(false);
    });

    it('setAmmo(visible) 写 chip 与战利品角标；隐藏时只收起 chip', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.setLoot(idx);
      const max = WEAPONS[idx].ammo;
      hud.setAmmo(10, max, true);
      expect(hud.ammoChip.classList.contains('hidden')).toBe(false);
      expect($('ammoNow').textContent).toBe('10');
      expect($('ammoMax').textContent).toBe(String(max));
      expect(hud.lootBtn.querySelector('.wammo').textContent).toBe('10');

      hud.setAmmo(0, max, false);
      expect(hud.ammoChip.classList.contains('hidden')).toBe(true);
      expect(hud.lootBtn.querySelector('.wammo').textContent).toBe('10'); // 隐藏时不改角标
    });

    it('setAmmo(locked) 标记缺阳光：chip 加 locked、角标显示"缺阳光"', () => {
      const idx = WEAPONS.findIndex((w) => !w.starter);
      hud.setLoot(idx);
      const max = WEAPONS[idx].ammo;
      hud.setAmmo(0, max, true, true);
      expect(hud.ammoChip.classList.contains('locked')).toBe(true);
      // 锁定时不再显示 low（两者语义互斥）
      expect(hud.ammoChip.classList.contains('low')).toBe(false);
      expect(hud.lootBtn.querySelector('.wammo').textContent).toBe('缺阳光');

      // 续弹成功后解除锁定
      hud.setAmmo(max, max, true, false);
      expect(hud.ammoChip.classList.contains('locked')).toBe(false);
      expect(hud.lootBtn.querySelector('.wammo').textContent).toBe(String(max));
    });

    it('setAmmo 的 low 阈值是 max(2, max*0.2)', () => {
      hud.setLoot(WEAPONS.findIndex((w) => !w.starter));
      // max=10 → 阈值 2
      hud.setAmmo(3, 10, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(false);
      hud.setAmmo(2, 10, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(true);
      // max=5 → 阈值仍是 2（max*0.2=1）
      hud.setAmmo(3, 5, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(false);
      hud.setAmmo(2, 5, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(true);
      // max=40 → 阈值 8
      hud.setAmmo(9, 40, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(false);
      hud.setAmmo(8, 40, true);
      expect(hud.ammoChip.classList.contains('low')).toBe(true);
      hud.setAmmo(0, 40, false);
      expect(hud.ammoChip.classList.contains('low')).toBe(true); // 隐藏时保留最后一次状态
    });
  });

  describe('Boss 血条', () => {
    it('setBossVisible 切换 hidden', () => {
      hud.setBossVisible(true);
      expect($('bossBar').classList.contains('hidden')).toBe(false);
      hud.setBossVisible(false);
      expect($('bossBar').classList.contains('hidden')).toBe(true);
    });

    it('setBossHp 把比例钳制到 [0,1] 并写宽度', () => {
      hud.setBossHp(0.5);
      expect(hud.bossFill.style.width).toBe('50%');
      hud.setBossHp(1.7);
      expect(hud.bossFill.style.width).toBe('100%');
      hud.setBossHp(-0.4);
      expect(hud.bossFill.style.width).toBe('0%');
    });
  });

  describe('准星 / 命中标记 / 受伤 / 横幅', () => {
    it('setAimLock 只在状态变化时切 lock 类', () => {
      hud.setAimLock(true);
      expect(hud.crosshair.classList.contains('lock')).toBe(true);
      hud.setAimLock(true);
      expect(hud.crosshair.classList.contains('lock')).toBe(true);
      expect(hud.aimLock).toBe(true);
      hud.setAimLock(false);
      expect(hud.crosshair.classList.contains('lock')).toBe(false);
    });

    it('hitmarker 加 show，head 决定是否加 head 类', () => {
      hud.hitmarker(true);
      expect(hud.hitmarkerEl.classList.contains('show')).toBe(true);
      expect(hud.hitmarkerEl.classList.contains('head')).toBe(true);
      hud.hitmarker(false);
      expect(hud.hitmarkerEl.classList.contains('show')).toBe(true);
      expect(hud.hitmarkerEl.classList.contains('head')).toBe(false);
    });

    it('flashDamage 加 show，220ms 后移除；重复调用重新计时', () => {
      vi.useFakeTimers();
      hud.flashDamage();
      expect(hud.damageEl.classList.contains('show')).toBe(true);
      vi.advanceTimersByTime(200);
      hud.flashDamage(); // 重新计时
      vi.advanceTimersByTime(219);
      expect(hud.damageEl.classList.contains('show')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(hud.damageEl.classList.contains('show')).toBe(false);
    });

    it('showBanner 写文案与 animationDuration，默认 2.2s', () => {
      hud.showBanner('第 3 波');
      expect(hud.bannerEl.textContent).toBe('第 3 波');
      expect(hud.bannerEl.classList.contains('show')).toBe(true);
      expect(hud.bannerEl.style.animationDuration).toBe('2.2s');

      hud.showBanner('巨人僵尸来袭', 3.5);
      expect(hud.bannerEl.style.animationDuration).toBe('3.5s');
    });

    it('denySun 加 deny 类并在 340ms 后移除', () => {
      vi.useFakeTimers();
      hud.denySun();
      expect(hud.sunPill.classList.contains('deny')).toBe(true);
      vi.advanceTimersByTime(339);
      expect(hud.sunPill.classList.contains('deny')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(hud.sunPill.classList.contains('deny')).toBe(false);
    });
  });

  describe('模式与摇杆', () => {
    it('setMode(true) 显示摇杆并换成触屏教程文案', () => {
      hud.setMode(true);
      expect(hud.isTouch).toBe(true);
      expect(hud.joyBase.classList.contains('hidden')).toBe(false);
      expect(hud.tutorialEl.textContent).toContain('左下摇杆');
      expect(hud.tutorialEl.querySelectorAll('div')).toHaveLength(2);
    });

    it('setMode(false) 隐藏摇杆、去掉 active 并换成键鼠文案', () => {
      hud.setMode(true);
      hud.showJoystick();
      hud.setMode(false);
      expect(hud.isTouch).toBe(false);
      expect(hud.joyBase.classList.contains('hidden')).toBe(true);
      expect(hud.joyBase.classList.contains('active')).toBe(false);
      expect(hud.tutorialEl.textContent).toContain('WASD');
      expect(hud.tutorialEl.textContent).not.toContain('左下摇杆');
    });

    it('showJoystick 显示并复位旋钮；moveJoystick 保留一位小数', () => {
      hud.setMode(true);
      hud.showJoystick();
      expect(hud.joyBase.classList.contains('hidden')).toBe(false);
      expect(hud.joyBase.classList.contains('active')).toBe(true);
      expect(hud.joyKnob.style.transform).toBe('translate(0px, 0px)');

      hud.moveJoystick(12.345, -30);
      expect(hud.joyKnob.style.transform).toBe('translate(12.3px, -30.0px)');
    });

    it('hideJoystick 复位旋钮；非触屏时额外隐藏摇杆底板，触屏只去 active', () => {
      hud.setMode(true);
      hud.showJoystick();
      hud.hideJoystick();
      expect(hud.joyKnob.style.transform).toBe('translate(0px, 0px)');
      expect(hud.joyBase.classList.contains('active')).toBe(false);
      expect(hud.joyBase.classList.contains('hidden')).toBe(false);

      hud.setMode(false);
      hud.showJoystick();
      hud.hideJoystick();
      expect(hud.joyBase.classList.contains('hidden')).toBe(true);
    });

    it('缺少摇杆底板时 hideJoystick 安全返回（index.html 缺节点时也不会打断 setEnabled）', () => {
      hud.joyBase = null;
      hud.joyKnob = null;
      expect(() => hud.hideJoystick()).not.toThrow();
    });

    it('showTutorial 立即去 fade，9s 后再加 fade', () => {
      vi.useFakeTimers();
      hud.tutorialEl.classList.add('fade');
      hud.showTutorial();
      expect(hud.tutorialEl.classList.contains('fade')).toBe(false);
      vi.advanceTimersByTime(8999);
      expect(hud.tutorialEl.classList.contains('fade')).toBe(false);
      vi.advanceTimersByTime(2);
      expect(hud.tutorialEl.classList.contains('fade')).toBe(true);
    });

    it('fadeTutorial / fadeDesktopHint 加 fade 类', () => {
      hud.fadeTutorial();
      expect(hud.tutorialEl.classList.contains('fade')).toBe(true);
      hud.fadeDesktopHint();
      expect(hud.desktopHint.classList.contains('fade')).toBe(true);
    });
  });

  describe('reset', () => {
    it('清空缓存与各种高亮/提示状态，并写回初始值', () => {
      hud.setHealth(40, 100);
      hud.setSun(200);
      hud.setScore(555);
      hud.setKills(9);
      hud.setWave(6);
      hud.setLoot(WEAPONS.findIndex((w) => !w.starter));
      hud.setAmmo(3, 10, true);
      hud.setBossVisible(true);
      hud.setAimLock(true);
      hud.flashDamage();
      hud.showBanner('x');
      hud.hitmarker(true);

      hud.reset();

      // reset() 先清缓存再写回初始值，所以缓存停在初始值上（不是 -1 哨兵）
      expect(hud.cache).toEqual({ hp: 100, sun: -1, score: 0, kills: 0, wave: 1, ammo: -1 });
      expect(hud.lootIndex).toBe(-1);
      expect(hud.lootBtn.classList.contains('hidden')).toBe(true);
      expect(hud.ammoChip.classList.contains('hidden')).toBe(true);
      expect(hud.hpText.textContent).toBe('100');
      expect(hud.hpFill.style.width).toBe('100%');
      expect(hud.scoreLabel.textContent).toBe('0');
      expect(hud.killLabel.textContent).toBe('0');
      expect(hud.waveLabel.textContent).toBe('第 1 波');
      expect($('bossBar').classList.contains('hidden')).toBe(true);
      expect(hud.hitmarkerEl.classList.contains('show')).toBe(false);
      expect(hud.hitmarkerEl.classList.contains('head')).toBe(false);
      expect(hud.crosshair.classList.contains('lock')).toBe(false);
      expect(hud.aimLock).toBe(false);
      expect(hud.damageEl.classList.contains('show')).toBe(false);
      expect(hud.bannerEl.classList.contains('show')).toBe(false);
      expect(hud.tutorialEl.classList.contains('fade')).toBe(true);
    });

    it('reset 强制重写 DOM：旧值被丢弃，即使与上一局末值相同也写回初始值', () => {
      hud.setHealth(40, 100);
      hud.setScore(555);
      hud.setKills(9);
      hud.setWave(6);
      const scoreSpy = vi.spyOn(hud.scoreLabel, 'textContent', 'set');
      const killSpy = vi.spyOn(hud.killLabel, 'textContent', 'set');
      const waveSpy = vi.spyOn(hud.waveLabel, 'textContent', 'set');
      hud.reset();
      expect(scoreSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(waveSpy).toHaveBeenCalledTimes(1);
      expect(hud.scoreLabel.textContent).toBe('0');
      expect(hud.killLabel.textContent).toBe('0');
      expect(hud.waveLabel.textContent).toBe('第 1 波');

      // 状态与缓存一致后，相同值又被跳过了
      hud.setScore(0);
      hud.setWave(1);
      expect(scoreSpy).toHaveBeenCalledTimes(1);
      expect(waveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('按钮事件', () => {
    it('start/again 都触发 onStart', () => {
      const onStart = vi.fn();
      hud.onStart = onStart;
      click($('startBtn'));
      click($('againBtn'));
      expect(onStart).toHaveBeenCalledTimes(2);
    });

    it('resume/restart/pause 分别触发 onResume / onRestart / onPause', () => {
      const onResume = vi.fn();
      const onRestart = vi.fn();
      const onPause = vi.fn();
      hud.onResume = onResume;
      hud.onRestart = onRestart;
      hud.onPause = onPause;
      click($('resumeBtn'));
      click($('restartBtn'));
      click($('pauseBtn'));
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(onRestart).toHaveBeenCalledTimes(1);
      expect(onPause).toHaveBeenCalledTimes(1);
    });

    it('mapBtn 与 pauseMapBtn 都触发 onChangeMap', () => {
      const onChangeMap = vi.fn();
      hud.onChangeMap = onChangeMap;
      click($('mapBtn'));
      click($('pauseMapBtn'));
      expect(onChangeMap).toHaveBeenCalledTimes(2);
    });

    it('没有设置回调时点击不抛错', () => {
      expect(() => {
        click($('startBtn'));
        click($('resumeBtn'));
        click($('restartBtn'));
        click($('againBtn'));
        click($('pauseBtn'));
        click($('mapBtn'));
        click(hud.muteBtn);
        click(hud.weaponButtons[0].btn);
      }).not.toThrow();
    });

    it('静音按钮切换 muted 类并回调 onMute', () => {
      const onMute = vi.fn();
      hud.onMute = onMute;
      click(hud.muteBtn);
      expect(hud.muted).toBe(true);
      expect(hud.muteBtn.classList.contains('muted')).toBe(true);
      expect(onMute).toHaveBeenLastCalledWith(true);

      click(hud.muteBtn);
      expect(hud.muted).toBe(false);
      expect(hud.muteBtn.classList.contains('muted')).toBe(false);
      expect(onMute).toHaveBeenLastCalledWith(false);
    });
  });
});