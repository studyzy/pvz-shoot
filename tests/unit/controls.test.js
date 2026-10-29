import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountIndexHtml, installPointerLock, installGlobals } from '../helpers/env.js';
import { HUD } from '../../src/ui/HUD.js';
import { Controls } from '../../src/input/Controls.js';

// jsdom 没有 PointerEvent：手工构造带 pointerId / pointerType / clientX 的事件。
function pointerEvent(type, props) {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: props.clientX || 0,
    clientY: props.clientY || 0,
    button: props.button || 0,
  });
  Object.defineProperty(e, 'pointerId', { value: props.pointerId === undefined ? 1 : props.pointerId });
  Object.defineProperty(e, 'pointerType', { value: props.pointerType || 'mouse' });
  return e;
}

function keydown(code) {
  const e = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
}
function keyup(code) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
}
function mousemove(props) {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...props }));
}

describe('Controls', () => {
  let canvas;
  let hud;
  let touchLock;

  beforeEach(() => {
    installGlobals();
    mountIndexHtml();
    canvas = document.getElementById('game');
    hud = new HUD();
    touchLock = installPointerLock();
  });

  const make = () => {
    const c = new Controls(canvas, hud);
    c.setEnabled(true);
    return c;
  };

  describe('桌面键盘', () => {
    it('WASD 与方向键都映射到 move 向量', () => {
      const c = make();
      keydown('KeyW');
      c.update();
      expect(c.move).toEqual({ x: 0, y: 1 });
      keyup('KeyW');

      keydown('KeyS');
      c.update();
      expect(c.move).toEqual({ x: 0, y: -1 });
      keyup('KeyS');

      keydown('KeyA');
      c.update();
      expect(c.move).toEqual({ x: -1, y: 0 });
      keyup('KeyA');

      keydown('KeyD');
      c.update();
      expect(c.move).toEqual({ x: 1, y: 0 });
      keyup('KeyD');

      keydown('ArrowUp');
      c.update();
      expect(c.move).toEqual({ x: 0, y: 1 });
      keyup('ArrowUp');
      keydown('ArrowDown');
      c.update();
      expect(c.move).toEqual({ x: 0, y: -1 });
      keyup('ArrowDown');
      keydown('ArrowLeft');
      c.update();
      expect(c.move).toEqual({ x: -1, y: 0 });
      keyup('ArrowLeft');
      keydown('ArrowRight');
      c.update();
      expect(c.move).toEqual({ x: 1, y: 0 });
    });

    it('斜向移动归一化到单位长度', () => {
      const c = make();
      keydown('KeyW');
      keydown('KeyD');
      c.update();
      expect(Math.hypot(c.move.x, c.move.y)).toBeCloseTo(1, 6);
      expect(c.move.x).toBeCloseTo(Math.SQRT1_2, 6);
      expect(c.move.y).toBeCloseTo(Math.SQRT1_2, 6);

      // 四个方向键全按下互相抵消
      keydown('KeyA');
      keydown('KeyS');
      c.update();
      expect(c.move).toEqual({ x: 0, y: 0 });

      // 只剩 A+S 时为左下斜向，仍归一化
      keyup('KeyW');
      keyup('KeyD');
      c.update();
      expect(Math.hypot(c.move.x, c.move.y)).toBeCloseTo(1, 6);
      expect(c.move.x).toBeCloseTo(-Math.SQRT1_2, 6);
      expect(c.move.y).toBeCloseTo(-Math.SQRT1_2, 6);
    });

    it('keyup 后 move 归零', () => {
      const c = make();
      keydown('KeyW');
      c.update();
      expect(c.move.y).toBe(1);
      keyup('KeyW');
      c.update();
      expect(c.move).toEqual({ x: 0, y: 0 });
    });

    it('Space 入队跳跃，consumeJump 读取后清零', () => {
      const c = make();
      const ev = keydown('Space');
      expect(ev.defaultPrevented).toBe(true); // 防止页面滚动
      expect(c.consumeJump()).toBe(true);
      expect(c.consumeJump()).toBe(false);
    });

    it('Digit1-4 设置 weaponRequest 0..3；Digit5 / KeyQ 设 lootRequest', () => {
      const c = make();
      for (let n = 1; n <= 4; n++) {
        keydown('Digit' + n);
        expect(c.consumeWeaponRequest()).toBe(n - 1);
        expect(c.consumeWeaponRequest()).toBe(-1);
      }
      keydown('Digit5');
      expect(c.weaponRequest).toBe(-1);
      expect(c.consumeLootRequest()).toBe(true);
      expect(c.consumeLootRequest()).toBe(false);

      keydown('KeyQ');
      expect(c.consumeLootRequest()).toBe(true);
    });

    it('Digit6+ 与其它键不产生武器请求', () => {
      const c = make();
      keydown('Digit9');
      keydown('Digit0');
      keydown('KeyZ');
      expect(c.weaponRequest).toBe(-1);
      expect(c.lootRequest).toBe(false);
    });

    it('未启用时按键不入队（但 Space 仍被 preventDefault）', () => {
      const c = new Controls(canvas, hud);
      const ev = keydown('Space');
      expect(ev.defaultPrevented).toBe(true);
      keydown('Digit2');
      expect(c.jumpQueued).toBe(false);
      expect(c.weaponRequest).toBe(-1);
      expect(c.keys.size).toBe(0);
    });

    it('窗口失焦清空按键与开火状态', () => {
      const c = make();
      keydown('KeyW');
      c.setFiring(true);
      window.dispatchEvent(new Event('blur'));
      c.update();
      expect(c.keys.size).toBe(0);
      expect(c.firing).toBe(false);
      expect(c.move).toEqual({ x: 0, y: 0 });
    });
  });

  describe('consume / setEnabled', () => {
    it('consumeLook 返回累计增量并清零', () => {
      const c = make();
      c.lookX = 1.5;
      c.lookY = -2.5;
      expect(c.consumeLook()).toEqual({ x: 1.5, y: -2.5 });
      expect(c.lookX).toBe(0);
      expect(c.lookY).toBe(0);
      expect(c.consumeLook()).toEqual({ x: 0, y: 0 });
    });

    it('setFiring 只在按下瞬间置 firePressed', () => {
      const c = make();
      c.setFiring(true);
      expect(c.consumeFirePressed()).toBe(true);
      expect(c.consumeFirePressed()).toBe(false);
      c.setFiring(true); // 已经是 true，不算新按下
      expect(c.consumeFirePressed()).toBe(false);
      c.setFiring(false);
      c.setFiring(true);
      expect(c.consumeFirePressed()).toBe(true);
    });

    it('setEnabled(false) 清空 keys/firing/请求/移动并调用 hud.hideJoystick', () => {
      const c = make();
      const hide = vi.spyOn(hud, 'hideJoystick');
      keydown('KeyW');
      c.update();
      c.setFiring(true);
      c.jumpQueued = true;
      c.weaponRequest = 2;
      c.lootRequest = true;
      c.lookX = 3;
      c.move.x = 1;

      c.setEnabled(false);
      expect(c.enabled).toBe(false);
      expect(c.keys.size).toBe(0);
      expect(c.firing).toBe(false);
      expect(c.firePressed).toBe(false);
      expect(c.weaponRequest).toBe(-1);
      expect(c.lootRequest).toBe(false);
      expect(c.move).toEqual({ x: 0, y: 0 });
      expect(hide).toHaveBeenCalledTimes(1);

      c.setEnabled(true);
      c.update();
      expect(c.move).toEqual({ x: 0, y: 0 });
    });
  });

  describe('指针锁', () => {
    it('桌面 requestLock 调用 canvas.requestPointerLock，已锁定时不重复请求', () => {
      const c = make();
      const spy = vi.spyOn(canvas, 'requestPointerLock');
      c.requestLock();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(c.lockPending).toBe(false); // pointerlockchange 已同步触发
      expect(touchLock.isLocked()).toBe(canvas);

      c.requestLock();
      expect(spy).toHaveBeenCalledTimes(1); // 已锁定
    });

    it('requestLock 失败（Promise reject）时复位 lockPending', async () => {
      const c = make();
      const spy = vi.spyOn(canvas, 'requestPointerLock').mockImplementation(() => Promise.reject(new Error('denied')));
      c.requestLock();
      expect(c.lockPending).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(c.lockPending).toBe(false);
      expect(spy).toHaveBeenCalled();
    });

    it('requestPointerLock 同步抛错时复位 lockPending', () => {
      const c = make();
      vi.spyOn(canvas, 'requestPointerLock').mockImplementation(() => {
        throw new Error('nope');
      });
      c.requestLock();
      expect(c.lockPending).toBe(false);
    });

    it('触屏设备不请求指针锁', () => {
      const c = new Controls(canvas, hud);
      const spy = vi.spyOn(canvas, 'requestPointerLock');
      c.isTouch = true;
      c.requestLock();
      expect(spy).not.toHaveBeenCalled();
      expect(c.lockPending).toBe(false);
    });

    it('pointerlockchange 解锁时清空 firing/look 并回调 onLockChange(false)', () => {
      const c = make();
      const onLockChange = vi.fn();
      c.onLockChange = onLockChange;
      c.requestLock();
      expect(onLockChange).toHaveBeenLastCalledWith(true);

      c.firing = true;
      c.lookX = 1;
      c.lookY = 1;
      touchLock.forceUnlock();
      expect(onLockChange).toHaveBeenLastCalledWith(false);
      expect(c.firing).toBe(false);
      expect(c.lookX).toBe(0);
      expect(c.lookY).toBe(0);
    });

    it('exitLock 仅在锁定到本 canvas 时调用 exitPointerLock', () => {
      const c = make();
      const exit = vi.spyOn(document, 'exitPointerLock');
      c.exitLock();
      expect(exit).not.toHaveBeenCalled();
      c.requestLock();
      c.exitLock();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(touchLock.isLocked()).toBe(null);
    });
  });

  describe('鼠标', () => {
    it('左键 pointerdown 开火并请求锁；非左键忽略', () => {
      const c = make();
      const lockSpy = vi.spyOn(canvas, 'requestPointerLock');
      canvas.dispatchEvent(pointerEvent('pointerdown', { button: 2, clientX: 10, clientY: 10 }));
      expect(c.firing).toBe(false);
      expect(lockSpy).not.toHaveBeenCalled();

      canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
      expect(c.firing).toBe(true);
      expect(c.consumeFirePressed()).toBe(true);
      expect(lockSpy).toHaveBeenCalledTimes(1);
      expect(c.mouseDragging).toBe(true);
    });

    it('未启用时 pointerdown 不响应', () => {
      const c = new Controls(canvas, hud);
      canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0 }));
      expect(c.firing).toBe(false);
    });

    it('锁定后 mousemove 以 0.0022 灵敏度累加 look', () => {
      const c = make();
      c.requestLock();
      mousemove({ movementX: 10, movementY: -4 });
      expect(c.lookX).toBeCloseTo(10 * 0.0022, 10);
      expect(c.lookY).toBeCloseTo(-4 * 0.0022, 10);
      mousemove({ movementX: 5, movementY: 2 });
      expect(c.lookX).toBeCloseTo(15 * 0.0022, 10);
      expect(c.lookY).toBeCloseTo(-2 * 0.0022, 10);
    });

    it('未锁定时 mousemove 不改 look', () => {
      const c = make();
      mousemove({ movementX: 100, movementY: 100 });
      expect(c.lookX).toBe(0);
      expect(c.lookY).toBe(0);
    });

    it('未锁定态拖拽用 0.0024 灵敏度，松开后停止', () => {
      const c = make();
      canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
      // 让 pointerdown 触发的 requestLock 解锁回去，进入拖拽模式
      touchLock.forceUnlock();
      window.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 110, clientY: 90 }));
      expect(c.lookX).toBeCloseTo(10 * 0.0024, 10);
      expect(c.lookY).toBeCloseTo(-10 * 0.0024, 10);

      window.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
      expect(c.mouseDragging).toBe(false);
      expect(c.firing).toBe(false);
      window.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200 }));
      expect(c.lookX).toBeCloseTo(10 * 0.0024, 10);
    });

    it('锁定状态下 pointermove 走拖拽分支直接返回（不重复累加）', () => {
      const c = make();
      c.requestLock();
      canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
      window.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 150, clientY: 150 }));
      expect(c.lookX).toBe(0);
    });

    it('锁定后 mousedown 左键开火，mouseup 停火', () => {
      const c = make();
      c.requestLock();
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      expect(c.firing).toBe(true);
      document.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      expect(c.firing).toBe(false);
    });

    it('未锁定时 mousedown 不开火', () => {
      const c = make();
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      expect(c.firing).toBe(false);
    });

    it('右键菜单被阻止', () => {
      const c = make();
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      canvas.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe('触屏', () => {
    const touchDown = (props) => {
      const e = pointerEvent('pointerdown', { pointerType: 'touch', ...props });
      canvas.dispatchEvent(e);
      return e;
    };
    const touchMove = (props) => window.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', ...props }));
    const touchUp = (props) => window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', ...props }));

    beforeEach(() => {
      globalThis.__setViewport(844, 390); // iPhone 横屏
      // 摇杆底板：宽 120，中心在 (80, 300)
      hud.joyBase.getBoundingClientRect = () => ({ left: 20, top: 240, width: 120, height: 120, right: 140, bottom: 360 });
    });

    it('首次触摸触发 onModeChange(true) 并切换 isTouch', () => {
      const c = make();
      const onModeChange = vi.fn();
      c.onModeChange = onModeChange;
      expect(c.isTouch).toBe(false); // setup 的 matchMedia 全 false → 桌面
      const e = touchDown({ pointerId: 7, clientX: 700, clientY: 100 });
      expect(onModeChange).toHaveBeenCalledWith(true);
      expect(c.isTouch).toBe(true);
      expect(e.defaultPrevented).toBe(true);
    });

    it('左下摇杆区按下显示摇杆，拖动产生归一化 move', () => {
      const c = make();
      const show = vi.spyOn(hud, 'showJoystick');
      const moveKnob = vi.spyOn(hud, 'moveJoystick');
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      expect(c.joyId).toBe(3);
      expect(show).toHaveBeenCalledTimes(1);
      // 半径 = max(36, 120*0.3=36) = 36，原点 (80, 300)
      expect(c.joyRadius).toBe(36);
      expect(c.joyOriginX).toBe(80);
      expect(c.joyOriginY).toBe(300);

      touchMove({ pointerId: 3, clientX: 116, clientY: 300 }); // 向右 36px = 满量程
      expect(moveKnob).toHaveBeenLastCalledWith(36, 0);
      expect(c.move.x).toBeCloseTo(1, 6);
      expect(c.move.y).toBeCloseTo(0, 6);
    });

    it('摇杆向上推时 move.y 为正（屏幕向上 = 前进）', () => {
      const c = make();
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      touchMove({ pointerId: 3, clientX: 80, clientY: 282 }); // 向上 18px，强度 0.5
      expect(c.move.x).toBeCloseTo(0, 6);
      expect(c.move.y).toBeCloseTo(0.5, 6);
    });

    it('摇杆在 0.12 死区内不产生 move', () => {
      const c = make();
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      touchMove({ pointerId: 3, clientX: 80 + 4, clientY: 300 }); // 4/36 = 0.111
      expect(c.move).toEqual({ x: 0, y: 0 });
      touchMove({ pointerId: 3, clientX: 80, clientY: 300 + 5 }); // 5/36 = 0.139
      expect(c.move.y).toBeCloseTo(-5 / 36, 6);
    });

    it('超出半径时坐标被钳制在单位圆内', () => {
      const c = make();
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      touchMove({ pointerId: 3, clientX: 80 + 200, clientY: 300 });
      expect(hud.joyKnob.style.transform).toBe('translate(36.0px, 0.0px)');
      expect(c.move.x).toBeCloseTo(1, 6);
    });

    it('右半屏拖动产生 look 增量（0.0044）', () => {
      const c = make();
      touchDown({ pointerId: 5, clientX: 600, clientY: 100 });
      expect(c.lookId).toBe(5);
      expect(c.joyId).toBe(null);
      touchMove({ pointerId: 5, clientX: 620, clientY: 90 });
      expect(c.lookX).toBeCloseTo(20 * 0.0044, 10);
      expect(c.lookY).toBeCloseTo(-10 * 0.0044, 10);
      touchMove({ pointerId: 5, clientX: 630, clientY: 95 });
      expect(c.lookX).toBeCloseTo(30 * 0.0044, 10);
    });

    it('抬起摇杆归零 move 并隐藏摇杆', () => {
      const c = make();
      const hide = vi.spyOn(hud, 'hideJoystick');
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      touchMove({ pointerId: 3, clientX: 116, clientY: 300 });
      touchUp({ pointerId: 3 });
      expect(c.joyId).toBe(null);
      expect(c.move).toEqual({ x: 0, y: 0 });
      expect(hide).toHaveBeenCalledTimes(1);
      expect(c.joyKnob).toBeUndefined();
    });

    it('抬起视角指针后 pointercancel 也能清空 lookId', () => {
      const c = make();
      touchDown({ pointerId: 9, clientX: 700, clientY: 100 });
      window.dispatchEvent(pointerEvent('pointercancel', { pointerType: 'touch', pointerId: 9 }));
      expect(c.lookId).toBe(null);
    });

    it('摇杆激活时 update() 不覆盖 move', () => {
      const c = make();
      touchDown({ pointerId: 3, clientX: 80, clientY: 300 });
      touchMove({ pointerId: 3, clientX: 116, clientY: 300 });
      keydown('KeyS');
      c.update();
      expect(c.move.x).toBeCloseTo(1, 6);
      expect(c.move.y).toBeCloseTo(0, 6);
    });

    it('拖拽视角的 pointerId 也能被 pointerup 清理', () => {
      const c = make();
      touchDown({ pointerId: 11, clientX: 700, clientY: 100 });
      c.lookX = 0;
      touchUp({ pointerId: 11 });
      expect(c.lookId).toBe(null);
      touchMove({ pointerId: 11, clientX: 800, clientY: 100 });
      expect(c.lookX).toBe(0);
    });
  });
});