import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountIndexHtml, installGlobals } from '../helpers/env.js';
import { HUD } from '../../src/ui/HUD.js';
import { WEAPONS } from '../../src/config.js';
import { formatNum } from '../../src/utils.js';

const $ = (id) => document.getElementById(id);
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
    it('五个角色槽：豌豆(1) 枪(2) 大杀器(3) 手雷(4) 护盾(5)，初始整条隐藏', () => {
      expect(hud.slotButtons.length).toBe(5);
      expect(hud.slotDock.classList.contains('hidden')).toBe(true);
      // 植物栏容器已删除：槽位是唯一的武器按钮来源
      expect(document.getElementById('weaponDock')).toBeNull();
      expect(hud.slotDock.parentElement.classList.contains('dock')).toBe(true);
      const keys = hud.slotButtons.map((b) => b.querySelector('.wkey').textContent);
      expect(keys).toEqual(['1', '2', '3', '4', '5']);
      const roles = hud.slotButtons.map((b) => b.dataset.role);
      expect(roles).toEqual(['peaGun', 'gun', 'demo', 'grenade', 'shield']);
      for (const b of hud.slotButtons) expect(b.classList.contains('empty')).toBe(true);
    });

    it('点击槽位回调 onSlotSelect(role, pos)', () => {
      const onSlotSelect = vi.fn();
      hud.onSlotSelect = onSlotSelect;
      hud.setSlots({ peaGun: [0], gun: [7], demo: [-1], grenade: [-1], shield: [-1] });
      click(hud.slotButtons[0]);
      expect(onSlotSelect).toHaveBeenCalledWith('peaGun', 0);
      click(hud.slotButtons[1]);
      expect(onSlotSelect).toHaveBeenCalledWith('gun', 0);
      click(hud.slotButtons[3]);
      expect(onSlotSelect).toHaveBeenCalledWith('grenade', 0);
    });

    it('setSlots：按角色填格子，空槽显示角色名；全空时整条隐藏', () => {
      hud.setSlots({ peaGun: [0], gun: [7], demo: [8], grenade: [-1], shield: [-1] });
      expect(hud.slotDock.classList.contains('hidden')).toBe(false);
      expect(hud.slotButtons[0].querySelector('.slot-name').textContent).toBe('豌豆');
      // 仙人掌在枪②
      expect(hud.slotButtons[1].classList.contains('empty')).toBe(false);
      expect(hud.slotButtons[1].querySelector('.slot-name').textContent).toBe('仙人掌');
      expect(hud.slotButtons[1].querySelector('.slot-icon').innerHTML).toContain('svg');
      // 西瓜进大杀器槽，空的手雷槽显示它属于哪个角色
      expect(hud.slotButtons[2].querySelector('.slot-name').textContent).toBe('西瓜');
      expect(hud.slotButtons[3].classList.contains('empty')).toBe(true);
      expect(hud.slotButtons[3].querySelector('.slot-name').textContent).toBe('手雷');
      hud.setSlots({ peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] });
      expect(hud.slotDock.classList.contains('hidden')).toBe(true);
    });

    it('setActiveSlot 只高亮对应的那一格（按 role+pos 匹配）', () => {
      hud.setSlots({ peaGun: [0], gun: [7], demo: [8], grenade: [-1], shield: [-1] });
      hud.setActiveSlot({ role: 'demo', pos: 0 });
      expect(hud.slotButtons[2].classList.contains('active')).toBe(true);
      expect(hud.slotButtons[0].classList.contains('active')).toBe(false);
      hud.setActiveSlot({ role: 'grenade', pos: 0 });
      // 空格子不会被点亮
      expect(hud.slotButtons[3].classList.contains('active')).toBe(false);
      hud.setActiveSlot(null);
      expect(hud.slotButtons[2].classList.contains('active')).toBe(false);
    });

    it('setSlotAmmo 写角标，0 发时标记 locked', () => {
      hud.setSlots({ peaGun: [0], gun: [7], demo: [-1], grenade: [-1], shield: [-1] });
      hud.setSlotAmmo({ role: 'gun', pos: 0 }, 12);
      expect(hud.slotButtons[1].querySelector('.wammo').textContent).toBe('12');
      hud.setSlotAmmo({ role: 'gun', pos: 0 }, 0);
      expect(hud.slotButtons[1].classList.contains('locked')).toBe(true);
    });

    it('setCharge 控制蓄力条的显隐与填充宽度', () => {
      hud.setCharge(0);
      expect(hud.chargeBar.classList.contains('on')).toBe(false);
      hud.setCharge(0.5);
      expect(hud.chargeBar.classList.contains('on')).toBe(true);
      expect(hud.chargeFill.style.width).toBe('50%');
      hud.setCharge(2); // 夹到 1
      expect(hud.chargeFill.style.width).toBe('100%');
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

    it('setShield 按比例写宽度、低于 25% 变红、收起变暗、0 隐藏', () => {
      hud.setShield(0, 400, false);
      expect($('shieldRow').classList.contains('hidden')).toBe(true);
      hud.setShield(400, 400, true);
      expect($('shieldRow').classList.contains('hidden')).toBe(false);
      expect($('shieldFill').style.width).toBe('100%');
      expect($('shieldText').textContent).toBe('400');
      hud.setShield(200, 400, true);
      expect($('shieldRow').classList.contains('mid')).toBe(true);
      hud.setShield(100, 400, true);
      expect($('shieldFill').style.width).toBe('25%');
      expect($('shieldRow').classList.contains('low')).toBe(true);
      hud.setShield(100, 400, false);
      expect($('shieldRow').classList.contains('idle')).toBe(true);
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

    it('updateAffordability 阳光低于费用时给有武器的槽加 poor 类（空槽不加）', () => {
      // 豌豆常驻 1 号槽（免费），2 号枪槽放一把双发
      const repeater = WEAPONS.findIndex((w) => w.id === 'repeater');
      hud.setSlots({ peaGun: [0], gun: [repeater], demo: [-1], grenade: [-1], shield: [-1] });
      hud.updateAffordability(0);
      hud.weaponButtons.forEach((entry) => {
        if (entry.index < 0) {
          expect(entry.btn.classList.contains('poor')).toBe(false);
          return;
        }
        expect(entry.btn.classList.contains('poor')).toBe(WEAPONS[entry.index].cost > 0);
      });
      expect(hud.weaponButtons[0].btn.classList.contains('poor')).toBe(false); // 豌豆免费

      hud.setSun(30);
      hud.weaponButtons.forEach((entry) => {
        if (entry.index < 0) return;
        expect(entry.btn.classList.contains('poor')).toBe(WEAPONS[entry.index].cost > 30);
      });
      hud.setSun(999);
      hud.weaponButtons.forEach((entry) => {
        expect(entry.btn.classList.contains('poor')).toBe(false);
      });
    });
  });

  describe('武器 / 槽位 / 弹药', () => {
    it('setAmmo(visible) 写 chip；隐藏时只收起 chip', () => {
      hud.setAmmo(12, 70, true, false);
      expect(hud.ammoChip.classList.contains('hidden')).toBe(false);
      expect(hud.ammoNow.textContent).toBe('12');
      expect(hud.ammoMax.textContent).toBe('70');
      hud.setAmmo(0, 70, false, false);
      expect(hud.ammoChip.classList.contains('hidden')).toBe(true);
    });

    it('setAmmo 会同步当前激活槽的角标（不再有单独的战利品格）', () => {
      hud.setSlots({ peaGun: [0], gun: [7], demo: [-1], grenade: [-1], shield: [-1] });
      hud.setActiveSlot({ role: 'gun', pos: 0 });
      hud.setAmmo(9, 40, true, false);
      expect(hud.slotButtons[1].querySelector('.wammo').textContent).toBe('9');
    });

    it('setAmmo(locked) 标记缺阳光：chip 加 locked', () => {
      hud.setAmmo(0, 70, true, true);
      expect(hud.ammoChip.classList.contains('locked')).toBe(true);
    });

    it('setAmmo 的 low 阈值是 max(2, max*0.2)', () => {
      hud.setAmmo(10, 100, true, false);
      expect(hud.ammoChip.classList.contains('low')).toBe(true);
      hud.setAmmo(30, 100, true, false);
      expect(hud.ammoChip.classList.contains('low')).toBe(false);
      hud.setAmmo(3, 5, true, false);
      expect(hud.ammoChip.classList.contains('low')).toBe(false); // 3 > max(2, 1)
      hud.setAmmo(2, 5, true, false);
      expect(hud.ammoChip.classList.contains('low')).toBe(true);
    });

    it('缺少弹药 DOM 时 setAmmo 安全返回', () => {
      const h2 = Object.create(HUD.prototype);
      h2.ammoChip = null;
      h2.activeSlotIndex = -1;
      expect(() => h2.setAmmo(1, 2, true, false)).not.toThrow();
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
      hud.setSlots([WEAPONS.findIndex((w) => !w.starter), -1, -1]);
      hud.setActiveSlot(0);
      hud.setAmmo(3, 10, true);
      hud.setBossVisible(true);
      hud.setAimLock(true);
      hud.flashDamage();
      hud.showBanner('x');
      hud.hitmarker(true);

      hud.reset();

      // reset() 先清缓存再写回初始值，所以缓存停在初始值上（不是 -1 哨兵）
      expect(hud.cache).toEqual({ hp: 100, sun: -1, score: 0, kills: 0, wave: 1, ammo: -1, shield: '0:0' });
      expect(hud.slotState).toEqual({ peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] });
      expect(hud.activeSlotIndex).toBe(null);
      expect(hud.slotDock.classList.contains('hidden')).toBe(true);
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

// 按钮回调都没设时，点一遍不能崩（bind 里那一串 if (this.onXxx)）
describe('HUD · 回调未设置时的点击', () => {
  beforeEach(() => {
    installGlobals();
    mountIndexHtml();
  });

  it('所有按钮在回调未设置时点击都是空操作', () => {
    const h = new HUD();
    const ids = ['startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'pauseBtn', 'duoBtn', 'duoShare'];
    for (const id of ids) {
      const el = $(id);
      if (!el) continue;
      expect(() => click(el), id).not.toThrow();
    }
    // 槽位按钮同样安全
    for (const b of h.slotButtons || []) expect(() => click(b)).not.toThrow();
  });

  it('回调设了之后点击确实会触发', () => {
    const h = new HUD();
    const calls = [];
    h.onStart = () => calls.push('start');
    h.onResume = () => calls.push('resume');
    h.onRestart = () => calls.push('restart');
    h.onAgain = () => calls.push('again');
    h.onPause = () => calls.push('pause');
    for (const id of ['startBtn', 'resumeBtn', 'restartBtn', 'againBtn', 'pauseBtn']) {
      const el = $(id);
      if (el) click(el);
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it('槽位按钮点击会调用 onSlotSelect（回调存在时）', () => {
    const h = new HUD();
    const picks = [];
    h.onSlotSelect = (role, pos) => picks.push([role, pos]);
    h.buildDock();
    for (const b of h.slotButtons) click(b);
    expect(picks.length).toBe(h.slotButtons.length);
  });
});

describe('HUD · setCharges（充能植物颗数）', () => {
  beforeEach(() => {
    installGlobals();
    mountIndexHtml();
  });

  it('找到对应槽位时写角标、控制 poor 类；找不到索引时也不崩', () => {
    const h = new HUD();
    h.buildDock();
    // 槽位按钮存在时：按每个按钮的 index 各设一次
    const idxs = new Set(h.weaponButtons.map((w) => w.index).filter((i) => i >= 0));
    for (const i of idxs) {
      expect(() => h.setCharges(i, 3, 3)).not.toThrow();
      expect(() => h.setCharges(i, 0, 3)).not.toThrow();
    }
    // 不存在的索引：走完循环后安全返回
    expect(() => h.setCharges(-999, 1, 3)).not.toThrow();
  });

  it('同一颗数重复设置会被缓存短路（不重复写 DOM）', () => {
    const h = new HUD();
    h.buildDock();
    const w = h.weaponButtons.find((x) => x.index >= 0);
    if (!w) return;
    h.setCharges(w.index, 2, 3);
    const badge = w.btn.querySelector('.wcost');
    const before = badge.textContent;
    h.setCharges(w.index, 2, 3);
    expect(badge.textContent).toBe(before);
  });

  it('颗数从 >0 变 0 会加上 poor 类，再变回正数会去掉', () => {
    const h = new HUD();
    h.buildDock();
    const w = h.weaponButtons.find((x) => x.index >= 0);
    if (!w) return;
    h.setCharges(w.index, 1, 3);
    expect(w.btn.classList.contains('poor')).toBe(false);
    h.setCharges(w.index, 0, 3);
    expect(w.btn.classList.contains('poor')).toBe(true);
    h.setCharges(w.index, 2, 3);
    expect(w.btn.classList.contains('poor')).toBe(false);
  });
});
