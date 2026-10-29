import { SLOT_KEYS, SLOT_KEY_BASE } from '../config.js';

export class Controls {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.move = { x: 0, y: 0 };
    this.lookX = 0;
    this.lookY = 0;
    this.firing = false;
    this.firePressed = false;
    this.jumpQueued = false;
    this.lootRequest = false;
    // 武器槽请求：0..SLOT_KEYS.length-1 选中槽，-1 无。数字键 1-5 对应五个角色槽。
    this.slotRequest = -1;
    this.dropSlotRequest = false;
    this.slotCycle = 0;
    this.enabled = false;
    const mq = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const noHover = window.matchMedia ? window.matchMedia('(hover: none)').matches : false;
    this.isTouch = (mq || noHover) && navigator.maxTouchPoints > 0;
    this.onModeChange = null;
    this.keys = new Set();
    this.joyId = null;
    this.lookId = null;
    this.mouseDragging = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.lockPending = false;
    this.onLockChange = null;
    this.joyRadius = 58;
    this.bind();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      this.keys.clear();
      this.firing = false;
      this.firePressed = false;
        this.lootRequest = false;
      this.slotRequest = -1;
      this.dropSlotRequest = false;
        this.slotCycle = 0;
      this.joyId = null;
      this.lookId = null;
      this.move.x = 0;
      this.move.y = 0;
      this.mouseDragging = false;
      this.hud.hideJoystick();
    }
  }

  setFiring(v) {
    if (v && !this.firing) this.firePressed = true;
    this.firing = v;
  }

  consumeLook() {
    const res = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return res;
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  consumeFirePressed() {
    const f = this.firePressed;
    this.firePressed = false;
    return f;
  }

  consumeLootRequest() {
    const v = this.lootRequest;
    this.lootRequest = false;
    return v;
  }

  // 选某个武器槽（7/8/9 或点击槽位）。-1 表示没有请求。
  consumeSlotRequest() {
    const v = this.slotRequest;
    this.slotRequest = -1;
    return v;
  }

  // 丢弃当前槽（Backspace；G 现在留给手雷蓄力）。
  consumeDropRequest() {
    const v = this.dropSlotRequest;
    this.dropSlotRequest = false;
    return v;
  }

  // 循环切到下一个槽（Tab / 滚轮）。0 = 没请求，+1/-1 = 方向。
  consumeSlotCycle() {
    const v = this.slotCycle;
    this.slotCycle = 0;
    return v;
  }

  requestLock() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    if (document.pointerLockElement === this.canvas) return;
    this.lockPending = true;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockPending = false; });
    } catch (e) {
      this.lockPending = false;
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  bind() {
    const canvas = this.canvas;

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      this.lockPending = false;
      if (!locked) {
        this.firing = false;
        this.lookX = 0;
        this.lookY = 0;
      }
      if (this.onLockChange) this.onLockChange(locked);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
        this.mouseDragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.setFiring(true);
        if (document.pointerLockElement !== canvas) this.requestLock();
        return;
      }
      e.preventDefault();
      if (!this.isTouch) {
        this.isTouch = true;
        if (this.onModeChange) this.onModeChange(true);
      }
      // 左下角是固定摇杆区，其余区域（包括左上）用于拖动视角。
      const inJoyZone = e.clientX < window.innerWidth * 0.46 && e.clientY > window.innerHeight * 0.42;
      if (this.joyId === null && inJoyZone) {
        this.joyId = e.pointerId;
        const rect = this.hud.joyBase.getBoundingClientRect();
        this.joyRadius = Math.max(36, rect.width * 0.3);
        this.joyOriginX = rect.left + rect.width * 0.5;
        this.joyOriginY = rect.top + rect.height * 0.5;
        this.move.x = 0;
        this.move.y = 0;
        this.hud.showJoystick();
      } else if (this.lookId === null && e.clientX >= window.innerWidth * 0.46) {
        this.lookId = e.pointerId;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.joyId) {
        const dx = e.clientX - this.joyOriginX;
        const dy = e.clientY - this.joyOriginY;
        const d = Math.hypot(dx, dy);
        const max = this.joyRadius;
        const clamped = Math.min(d, max);
        const nx = d > 0.001 ? (dx / d) * clamped : 0;
        const ny = d > 0.001 ? (dy / d) * clamped : 0;
        this.hud.moveJoystick(nx, ny);
        const strength = clamped / max;
        if (strength < 0.12) {
          this.move.x = 0;
          this.move.y = 0;
        } else {
          this.move.x = (dx / Math.max(1, d)) * strength;
          this.move.y = -(dy / Math.max(1, d)) * strength;
        }
        return;
      }
      if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.lookX += dx * 0.0044;
        this.lookY += dy * 0.0044;
        return;
      }
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement === this.canvas) return;
        if (!this.mouseDragging) return;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.lookX += dx * 0.0024;
        this.lookY += dy * 0.0024;
      }
    });

    const endPointer = (e) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.move.x = 0;
        this.move.y = 0;
        this.hud.hideJoystick();
      }
      if (e.pointerId === this.lookId) this.lookId = null;
      if (e.pointerType === 'mouse') {
        this.mouseDragging = false;
        this.firing = false;
      }
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.canvas) return;
      this.lookX += (e.movementX || 0) * 0.0022;
      this.lookY += (e.movementY || 0) * 0.0022;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.canvas) return;
      if (e.button === 0) this.setFiring(true);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      if (!this.enabled) return;
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code.indexOf('Digit') === 0) {
        const n = parseInt(e.code.slice(5), 10);
        // 1-5 = 五个角色槽（豌豆 / 枪② / 大杀器 / 手雷 / 护盾）。
        // 植物栏已取消，所以只有这一套槽位请求，不再有 weaponRequest 的下标换算。
        const sIdx = n - SLOT_KEY_BASE;
        if (sIdx >= 0 && sIdx < SLOT_KEYS.length) this.slotRequest = sIdx;
      }
      if (e.code === 'KeyQ') this.lootRequest = true;
      if (e.code === 'Tab') {
        e.preventDefault();
        this.slotCycle = e.shiftKey ? -1 : 1;
      }
      // G 不再丢弃：G 是手雷的蓄力键（按住蓄力、松手投出），丢弃挪到 Backspace
      if (e.code === 'Backspace') this.dropSlotRequest = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
    });
  }

  update() {
    if (this.joyId !== null) return;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
  }
}
