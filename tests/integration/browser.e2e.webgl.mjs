// 浏览器级 E2E（真实 Chromium + 真实 WebGL + 真实 glb + 真实 DOM 事件）
//
// jsdom 里 canvas/WebGL/贴图解码/指针锁/触屏媒体查询全是假的，下面这些路径只有真浏览器能覆盖：
//   1. 桌面真实开局：DOM 点击 → 指针锁 → 键盘 WASD → 鼠标转视角 → 左键射击 → 击杀
//   2. 真实 glb：贴图解码、材质、配件（交通锥/铁桶/Boss 木棒）真的挂到了场景图上
//   3. 三张地图真实切换：菜单卡片 → scene.background / fog 变化 → 真的渲染一帧
//   4. 手机模拟：触屏类、开火/跳跃按钮、虚拟摇杆、竖屏拦截层
//   5. 性能与稳定性：连续 10 秒采样 draw call / 三角面峰值 + 控制台零错误
//   6. 死亡结算与重开
//
// 运行：node tests/integration/browser.e2e.webgl.mjs
//      （package.json 里是 npm run test:e2e）
// 单独跑某几个场景：E2E_ONLY=startup,glb node tests/integration/browser.e2e.webgl.mjs
// 失败截图落到 tests/integration/.artifacts/。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACTS = path.join(ROOT, 'tests/integration/.artifacts');
// 固定端口会串行冲突；默认随机端口，需要复现时用 E2E_PORT 固定。
const PORT = Number(process.env.E2E_PORT || 4179 + Math.floor(Math.random() * 60));

const CHROME_ARGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

class PhaseError extends Error {}

function check(cond, msg) {
  if (!cond) throw new PhaseError(msg);
}

// 轮询等待；arg 会作为参数传进页面（waitForFunction 的单参数形式，别写成 fn, null, {opt}）
async function waitUntil(page, fn, timeout = 15000, label = '条件', arg = undefined) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (e) {
    throw new PhaseError('等待超时（' + timeout + 'ms）：' + label);
  }
}

function findChromium() {
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache/ms-playwright'),
    '/root/.cache/ms-playwright',
  ].filter(Boolean);
  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort();
    for (const d of dirs.reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function runBuild() {
  return new Promise((resolve) => {
    const build = spawn('node', ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: undefined },
    });
    build.on('exit', resolve);
  });
}

// ---------------------------------------------------------------- 页面工具

// 往页面里注入探针：统计 console error / pageerror、指针锁调用、未捕获 promise 拒绝。
// 用 addInitScript 在模块脚本之前执行。
async function installProbes(page) {
  await page.addInitScript(() => {
    window.__e2e = { errors: [], lockCalls: 0, lockRejects: [], audio: 0 };
    const pushErr = (kind, text) => window.__e2e.errors.push(kind + ': ' + text);
    const origError = console.error;
    console.error = function (...args) {
      pushErr('console.error', args.map((a) => (a && a.stack) || String(a)).join(' '));
      return origError.apply(this, args);
    };
    window.addEventListener('pageerror', (e) => pushErr('pageerror', (e && e.message) || String(e)));
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      pushErr('unhandledrejection', (r && r.message) || String(r));
    });
    // 无头 Chromium 的指针锁需要 --enable-features=...；这里记录“确实调过”而不是依赖成功。
    const req = HTMLCanvasElement.prototype.requestPointerLock;
    HTMLCanvasElement.prototype.requestPointerLock = function (...args) {
      window.__e2e.lockCalls++;
      const p = req.apply(this, args);
      if (p && p.catch) p.catch((e) => window.__e2e.lockRejects.push(String((e && e.message) || e)));
      return p;
    };
    // WebAudio 在无头里真实创建，统计被解锁的次数，防止“音频没解锁”这类回归。
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const resume = AC.prototype.resume;
      AC.prototype.resume = function (...a) {
        window.__e2e.audio++;
        return resume.apply(this, a);
      };
    }
  });
}

async function openPage(context, url) {
  const page = await context.newPage();
  await installProbes(page);
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + ((e && e.message) || e)));
  await page.goto(url, { waitUntil: 'load' });
  await waitUntil(page, () => !!window.__game, 30000, 'window.__game 出现');
  // glb 是异步加载的；菜单态下等待模型就绪，保证后续刷怪不落空。
  await waitUntil(
    page,
    () => window.__game.renderer && window.__game.renderer.info.render.calls > 0,
    30000,
    '渲染循环跑起来（drawCall > 0）'
  );
  return { page, consoleErrors };
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, name + '.png');
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

// 读页面里累积的错误，并清空，避免一个阶段污染下一个。
async function drainErrors(page) {
  return page.evaluate(() => {
    const e = (window.__e2e && window.__e2e.errors) || [];
    if (window.__e2e) window.__e2e.errors = [];
    return e.slice();
  });
}

// 确保处于 playing（各场景可独立运行：E2E_ONLY=glb 时也必须能跑）
async function ensurePlaying(page) {
  const state = await page.evaluate(() => window.__game.state);
  if (state === 'playing') return;
  if (state !== 'menu') {
    await page.evaluate(() => window.__game.backToMenu());
    await page.waitForFunction(() => window.__game.state === 'menu', null, { timeout: 5000 });
  }
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 10000 });
}

// 清场并刷出指定类型的僵尸（只构造前置条件；类型分布本身由 config.wavePlan 决定）。
// 注意：僵尸会被打死、也会按波次自动补刷，所以这里用“是否出现过”而不是“当前数组里有”。
async function ensureZombieTypes(page, want) {
  await ensurePlaying(page);
  await page.evaluate((types) => {
    const g = window.__game;
    g.sun = 999;
    // 玩家无敌：僵尸会打人，但让玩家活着，避免中途 game over 打断本场景
    g.player.hp = 1e9;
    g.player.maxHp = 1e9;
    g.zombies.reset();
    g.zombies.startWave(9); // 第 9 波：含锥、桶，且 n % 5 === 0 出 Boss
    // startWave 会洗牌，缺的类型提到队首
    const have = new Set(g.zombies.queue);
    for (const t of types.slice().reverse()) {
      if (!have.has(t)) g.zombies.queue.unshift(t);
    }
    g.zombies.maxAlive = 14;
    g.zombies.interval = 0.05; // 无头 SwiftShader 帧率极低，刷怪要够快
    g.zombies.spawnTimer = 0;
    // 记录出现过的类型
    window.__e2eSeen = Object.create(null);
    window.__e2eTypeWatcher = setInterval(() => {
      for (const z of g.zombies.zombies) window.__e2eSeen[z.type] = true;
    }, 20);
  }, want);

  try {
    await waitUntil(
      page,
      (types) => types.every((k) => window.__e2eSeen && window.__e2eSeen[k]),
      25000,
      '刷出僵尸类型：' + want.join('/'),
      want
    );
    // 等每种类型至少一只完成出生动画（spawnT >= 0.5 才吃伤害/参与瞄准）
    await waitUntil(
      page,
      (types) => {
        const ok = {};
        for (const z of window.__game.zombies.zombies) if (z.spawnT >= 0.5) ok[z.type] = true;
        return types.every((k) => ok[k]);
      },
      15000,
      '僵尸出生动画结束',
      want
    );
  } finally {
    await page.evaluate(() => {
      clearInterval(window.__e2eTypeWatcher);
      window.__e2eTypeWatcher = null;
      // 恢复成一个“安静”的场面：清场后只留这一批，方便断言
      const g = window.__game;
      g.zombies.interval = 1.2;
      g.zombies.spawnTimer = 1.2;
    });
  }
}

// ---------------------------------------------------------------- 场景

// 场景 1：桌面真实开局（DOM 点击 → 指针锁 → 键盘 → 鼠标 → 左键射击 → 击杀）
async function phaseStartup(ctx) {
  const { page } = ctx;
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.reload({ waitUntil: 'load' });
  await waitUntil(page, () => !!window.__game, 30000, 'window.__game');
  await waitUntil(page, () => window.__game.renderer.info.render.calls > 0, 30000, '渲染循环');

  const bodyClass = await page.evaluate(() => document.body.className);
  check(/\bdesktop\b/.test(bodyClass), '桌面 UA 下 body 应有 desktop 类，实际：' + bodyClass);

  // 真实点击开始按钮
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 10000 });
  await waitUntil(page, () => window.__game.hud.isTouch === false, 3000, 'HUD 进入桌面模式');
  check(await page.isHidden('#startScreen'), '开始后 #startScreen 应隐藏');
  check(await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')), '开始后 #hud 应可见');

  // 指针锁：断言 requestPointerLock 被调用过
  const lockCalls = await page.evaluate(() => window.__e2e.lockCalls);
  check(lockCalls > 0, '开始游戏后应调用 canvas.requestPointerLock()，实际调用 0 次');

  // 真实键盘：W 前进
  const p0 = await page.evaluate(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
  const p1 = await page.evaluate(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check(moved > 0.5, '按住 W 700ms 玩家应移动 > 0.5m，实际 ' + moved.toFixed(3) + 'm');

  // 真实鼠标：拖动转视角。无头里指针锁可能没生效，Controls 两条路径（locked mousemove / 拖动）
  // 任一生效都算通过——两条路径都是真实 DOM 事件驱动的。
  const yaw0 = await page.evaluate(() => window.__game.player.yaw);
  await page.mouse.move(720, 430);
  await page.mouse.down();
  await page.mouse.move(980, 430, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const yaw1 = await page.evaluate(() => window.__game.player.yaw);
  const dYaw = Math.abs(yaw1 - yaw0);
  check(dYaw > 0.01, '鼠标右移后 yaw 应有变化，实际 Δyaw=' + dYaw.toFixed(4));

  // 刷新一只僵尸并让它站定，然后真实左键按住射击直到击杀
  await page.evaluate(() => {
    const g = window.__game;
    g.sun = 999;
    g.zombies.reset();
    // 只刷一只普通僵尸（62 血 = 5 发豌豆），保证几秒内打死
    g.zombies.queue = ['normal'];
    g.zombies.startWave(1);
    g.zombies.queue = ['normal'];
  });
  await waitUntil(page, () => window.__game.zombies.zombies.length > 0, 15000, '刷出第一只僵尸');
  // 等出生动画结束（spawnT < 0.5 的僵尸不吃伤害、也不被辅助瞄准）
  await waitUntil(
    page,
    () => window.__game.zombies.zombies.some((z) => z.spawnT >= 0.5 && z.alive),
    5000,
    '僵尸出生动画结束'
  );

  // 按住左键 3 秒（自动武器会持续开火），期间每 300ms 重瞄一次——僵尸在朝玩家走
  await page.mouse.move(720, 430);
  await page.mouse.down();
  const firingState = await page.evaluate(() => window.__game.controls.firing);
  check(firingState === true, '按下左键后 controls.firing 应为 true');
  let lockedAt = false;
  for (let i = 0; i < 10; i++) {
    const locked = await page.evaluate(async ([first]) => {
      const g = window.__game;
      const z = g.zombies.zombies.find((x) => x.alive && !x.dying);
      if (z) {
        // 放到玩家前方 4 米：镜头不糊、瞄点稳定
        if (first) z.root.position.set(g.player.pos.x, 0, g.player.pos.z - 4);
        const p = g.player;
        const dx = z.root.position.x - p.eye.x;
        const dy = 0.95 * z.scaleFactor - p.eye.y;
        const dz = z.root.position.z - p.eye.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        p.recoil = 0;
      }
      await new Promise((r) => setTimeout(r, 300));
      return !!g.weapons.assist;
    }, [i === 0]);
    if (locked) lockedAt = true;
    if (await page.evaluate(() => window.__game.stats.kills > 0)) break;
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(lockedAt, '准星应对准僵尸（assist=true）');
  const after = await page.evaluate(() => ({
    kills: window.__game.stats.kills,
    score: window.__game.stats.score,
    firePressed: window.__game.controls.firing,
    // 开火是否真的发生：豌豆冷却被重置过 → 说明 tryFire 走过
    hitmarker: document.getElementById('hitmarker').classList.contains('show'),
    state: window.__game.state,
    yaw: window.__game.player.yaw,
    pitch: window.__game.player.pitch,
  }));
  if (after.kills < 1) {
    const diag = await page.evaluate(() => {
      const g = window.__game;
      const z = g.zombies.zombies.find((x) => x.alive) || g.zombies.zombies[0];
      return {
        zombies: g.zombies.zombies.length,
        zPos: z ? [+z.root.position.x.toFixed(2), +z.root.position.z.toFixed(2)] : null,
        zSpawnT: z ? +z.spawnT.toFixed(2) : null,
        playerPos: [+g.player.pos.x.toFixed(2), +g.player.pos.z.toFixed(2)],
        yaw: +g.player.yaw.toFixed(3),
        pitch: +g.player.pitch.toFixed(3),
        assist: !!g.weapons.assist,
        sun: g.sun,
        state: g.state,
        cooldown: +g.weapons.cooldown.toFixed(3),
        current: g.weapons.current,
      };
    });
    throw new PhaseError('按住左键 2.5 秒应击杀至少 1 只僵尸，实际 kills=' + after.kills + ' 诊断：' + JSON.stringify(diag));
  }
  check(after.state === 'playing', '开火期间玩家不应死亡/暂停，state=' + after.state);
  check(after.kills >= 1, '按住左键 2.5 秒应击杀至少 1 只僵尸，实际 kills=' + after.kills);
  check(after.score > 0, '击杀后积分应 > 0，实际 ' + after.score);
  check(after.firePressed === false, '松开左键后 controls.firing 应为 false');
  const killLabel = await page.textContent('#killLabel');
  check(Number(killLabel) >= 1, 'HUD 击杀数应同步，实际 #killLabel=' + killLabel);

  return {
    metrics: {
      lockCalls,
      moved: +moved.toFixed(2),
      dYaw: +dYaw.toFixed(3),
      kills: after.kills,
      score: after.score,
    },
  };
}

// 场景 2：真实 glb 与材质
//
// 这里必须用"真实 glb"而不是替身：加载器路径（网络 fetch → ImageBitmap 解码 → 贴图上传 GPU）、
// 材质克隆、SkeletonUtils 骨骼克隆、AnimationMixer 驱动骨骼、配件 buildHat 都只有真浏览器才跑得通。
async function phaseGlb(ctx) {
  const { page } = ctx;
  await ensureZombieTypes(page, ['normal', 'cone', 'bucket', 'boss']);

  const info = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state,
      ctxEnv: !!g.ctx.env,
      zombies: g.zombies.zombies.map((z) => {
        // 只统计 glb 本体网格（配件是 buildHat 程序化加在 body 上的，顶点很少）
        const hatMeshes = new Set();
        if (z.hat) z.hat.traverse((n) => { if (n.isMesh) hatMeshes.add(n); });
        let meshCount = 0;
        let textured = 0;
        let glbVerts = 0;
        z.body.traverse((n) => {
          if (!n.isMesh || hatMeshes.has(n)) return;
          meshCount++;
          const pos = n.geometry && n.geometry.attributes && n.geometry.attributes.position;
          if (pos) glbVerts += pos.count;
          const m = n.material;
          if (m && m.map && m.map.image) textured++;
        });
        const m0 = z.mats[0];
        const hatMat = z.hat && z.hat.children[0] && z.hat.children[0].material;
        return {
          type: z.type,
          // 骨骼动画：SkinnedMesh + 独立骨骼 + mixer 在跑
          skinned: !!z.body.getObjectByProperty('isSkinnedMesh', true),
          boneId: (() => {
            let b = null;
            z.body.traverse((n) => { if (!b && n.isBone) b = n; });
            return b ? b.uuid : null;
          })(),
          hasMixer: !!z.mixer,
          current: z.current,
          clipCount: z.mixer ? Object.keys(z.actions).length : 0,
          boneQuat: (() => {
            // 僵尸模型叫 Head，骷髅模型叫 head，统一忽略大小写
            let b = null;
            z.body.traverse((n) => { if (!b && n.isBone && /^head$/i.test(n.name)) b = n; });
            return b ? [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] : null;
          })(),
          mats: z.mats.length,
          matMap: !!(m0 && m0.map),
          matMapImage: !!(m0 && m0.map && m0.map.image),
          mapIsTex: !!(m0 && m0.map && m0.map.isTexture),
          // 贴图真的解码成了位图（不是还没加载的占位）
          mapSize: m0 && m0.map && m0.map.image
            ? [(m0.map.image.width || 0), (m0.map.image.height || 0)]
            : [0, 0],
          hasNormalMap: !!(m0 && m0.map && m0.normalMap),
          envMapBody: !!(m0 && m0.envMap),
          envMapIsTex: !!(m0 && m0.envMap && m0.envMap.isTexture),
          envIntensity: m0 ? m0.envMapIntensity : 0,
          envMapHat: !!(hatMat && hatMat.envMap),
          bodyChildren: z.body.children.length,
          meshCount,
          glbVerts,
          textured,
          hat: !!(z.hat && z.hat.children.length > 0),
          hatChildren: z.hat ? z.hat.children.length : 0,
          // 配件必须真的长在身上：取帽子和头骨的世界高度比对。
          // 只看"有没有挂上"不够——之前帽子就挂在 body 上但陷进脑袋里，只有肉眼能看出来。
          hatWorldY: (() => {
            if (!z.hat) return null;
            const v = new (z.root.position.constructor)();
            z.hat.getWorldPosition(v);
            return v.y;
          })(),
          // 身高用"头顶/脚底骨骼的世界高度差"算。**不能**直接拿蒙皮网格的顶点：
          // 那是绑定姿态坐标，applyMatrix4 之后会得到 ±35 这种垃圾值（踩过）。
          headWorldY: (() => {
            const b = z.isSkeleton ? z.body.getObjectByName('head') : z.body.getObjectByName('Head');
            if (!b) return null;
            const v = new (z.root.position.constructor)();
            b.getWorldPosition(v);
            return v.y;
          })(),
          hatType: z.def.acc,
          // Boss 是巨型骷髅：走骷髅模型，木棒挂在 handslotr 骨骼上
          isSkeletonModel: z.def.model === 'skeleton',
          hatParentName: z.hat && z.hat.parent ? z.hat.parent.name : null,
          hatParentIsBone: !!(z.hat && z.hat.parent && z.hat.parent.isBone),
          // 命中球的实际世界高度（getChest/getHead 的返回值直接给 y）
          chestY: z.getChest({ set(x, y, zz) { this.x = x; this.y = y; this.z = zz; return this; } }).y,
          headY: z.getHead({ set(x, y, zz) { this.x = x; this.y = y; this.z = zz; return this; } }).y,
          // 运行时材质独立性：直方图里每只僵尸必须有自己的材质实例（白闪/冰冻互不干扰）
          matUuid: m0 ? m0.uuid : null,
        };
      }),
    };
  });

  check(info.zombies.length >= 4, '至少应有 4 只僵尸（普通/锥/桶/Boss），实际 ' + info.zombies.length);
  check(info.ctxEnv, 'game.ctx.env 为空：PMREM 环境贴图没生成');

  const types = new Set(info.zombies.map((z) => z.type));
  for (const t of ['normal', 'cone', 'bucket', 'boss']) {
    check(types.has(t), '缺少 ' + t + ' 类型僵尸，实际有 ' + [...types].join(','));
  }

  const problems = [];
  for (const z of info.zombies) {
    if (z.mats < 1) problems.push(z.type + ': mats 为空');
    if (!z.matMap) problems.push(z.type + ': mats[0].map 为空（贴图没加载）');
    if (!z.mapIsTex) problems.push(z.type + ': mats[0].map 不是 THREE.Texture');
    if (!z.matMapImage) problems.push(z.type + ': 贴图 image 为空（decode 失败）');
    if (!(z.mapSize[0] >= 256 && z.mapSize[1] >= 256)) {
      problems.push(z.type + ': 贴图尺寸异常 ' + z.mapSize.join('x') + '（应 >= 256x256）');
    }
    if (!(z.bodyChildren > 0)) problems.push(z.type + ': body.children 为空');
    if (!(z.meshCount > 0)) problems.push(z.type + ': body 下没有 mesh');
    if (!(z.glbVerts >= 1000)) problems.push(z.type + ': glb 本体顶点数 ' + z.glbVerts + ' 不像真实模型（应 >= 1000）');
    if (z.hatType && !z.hat) problems.push(z.type + '（acc=' + z.hatType + '）: 配件 hat 没挂上');
    if (z.hatType && !(z.hatChildren >= 2)) problems.push(z.type + ': 配件 hat 子网格过少 ' + z.hatChildren);
    // 帽子必须"戴在头上"：比头骨骨骼还高，且不超过身高的合理上限。
    // 只断言"挂上了"不够——之前帽子挂在 body 上但陷进脑袋里，只有肉眼能看出来。
    if (z.hatType && z.hatType !== 'club' && z.hatWorldY != null && z.headWorldY != null) {
      if (z.hatWorldY < z.headWorldY) {
        problems.push(z.type + ': 配件比头骨还低（hat ' + z.hatWorldY.toFixed(2) + ' < head ' + z.headWorldY.toFixed(2) + '），陷进身体里了');
      }
      // 头顶不会离头骨太远：不超过头骨上方约 0.6 个模型身位
      if (z.hatWorldY > z.headWorldY + 0.75 * z.scale || z.hatWorldY > z.headWorldY + 1.2) {
        problems.push(z.type + ': 配件飘太高（hat ' + z.hatWorldY.toFixed(2) + '，head ' + z.headWorldY.toFixed(2) + '）');
      }
    }
    if (!z.hatType && z.hat) problems.push(z.type + ': 不该有配件却挂了 hat');
    if (z.hat && !z.envMapHat) problems.push(z.type + ': 配件材质 envMap 为空（ctx.env 没传进 Zombie）');
    // 回归保护：ZombieManager.spawnOne 必须把 ctx.env 传进 Zombie，否则身体材质拿不到 PMREM 环境贴图
    if (!z.envMapBody) problems.push(z.type + ': 身体材质 envMap 为空（spawnOne 没把 ctx.env 传给 Zombie）');
    if (!z.envMapIsTex) problems.push(z.type + ': 身体材质 envMap 不是 THREE.Texture');
    if (!(z.envIntensity > 0)) problems.push(z.type + ': 身体材质 envMapIntensity 应 > 0，实际 ' + z.envIntensity);
  }
  // 巨型骷髅 Boss：走骷髅模型、木棒挂 handslotr、命中球按骷髅口径抬高
  const bossInfo = info.zombies.find((z) => z.type === 'boss');
  if (bossInfo) {
    if (!bossInfo.isSkeletonModel) problems.push('boss 没用骷髅模型');
    if (!bossInfo.hatParentIsBone) problems.push('boss 的木棒没挂在骨骼上（应在 handslotr）');
    else if (!/handslot/i.test(bossInfo.hatParentName)) {
      problems.push('boss 的木棒挂错了骨骼：' + bossInfo.hatParentName);
    }
    // 骷髅口径 0.90/1.68 × scale 2.3 = 2.07 / 3.864
    if (!(bossInfo.chestY > 1.9 && bossInfo.chestY < 2.3)) problems.push('boss 胸口命中球高度异常：' + bossInfo.chestY);
    if (!(bossInfo.headY > 3.6 && bossInfo.headY < 4.1)) problems.push('boss 头部命中球高度异常：' + bossInfo.headY);
  } else {
    problems.push('场景里没有 boss，无法验证巨型骷髅');
  }

  // 骨骼动画：每只僵尸必须有独立骨骼 + 正在跑的 mixer，否则所有僵尸会共骨架一起动
  const boneIds = new Set(info.zombies.map((z) => z.boneId));
  if (boneIds.size !== info.zombies.length) {
    problems.push('僵尸骨骼被共享了（' + boneIds.size + ' 套骨骼 / ' + info.zombies.length + ' 只僵尸）');
  }
  for (const z of info.zombies) {
    if (!z.skinned) problems.push(z.type + ': 没有 SkinnedMesh（骨骼模型没生效）');
    if (!z.hasMixer) problems.push(z.type + ': mixer 为空');
    if (!z.boneQuat) problems.push(z.type + ': 找不到 Head/head 骨骼');
    if (!(z.clipCount >= 3)) problems.push(z.type + ': 动画动作只有 ' + z.clipCount + ' 个（应 >= 3）');
  }
  // 材质实例必须互不相同
  const uuids = new Set(info.zombies.map((z) => z.matUuid));
  if (uuids.size !== info.zombies.length) {
    problems.push('僵尸材质被共享了（' + uuids.size + ' 个实例 / ' + info.zombies.length + ' 只僵尸）');
  }
  check(problems.length === 0, 'glb/材质断言失败：\n   - ' + problems.join('\n   - '));

  const byType = {};
  for (const z of info.zombies) byType[z.type] = (byType[z.type] || 0) + 1;
  return {
    metrics: {
      zombies: info.zombies.length,
      types: Object.entries(byType).map(([k, v]) => k + 'x' + v).join(','),
      texture: info.zombies[0].mapSize.join('x'),
      verts: info.zombies[0].glbVerts,
      hats: info.zombies.filter((z) => z.hat).length,
      envMap: 'every-zombie',
    },
  };
}

// 场景 3：三张地图真实切换（真实点菜单卡片）
async function phaseMaps(ctx) {
  const { page } = ctx;
  await shot(page, 'phase-maps-after-start');
  // 从游戏里退回主菜单，再用真实点击切图
  await page.evaluate(() => {
    const g = window.__game;
    if (g.state !== 'menu') g.backToMenu();
  });
  await page.waitForFunction(() => window.__game.state === 'menu', null, { timeout: 5000 });
  await waitUntil(page, () => {
    const s = document.getElementById('startScreen');
    return s && !s.classList.contains('hidden');
  }, 5000, '主菜单重新出现');

  const cards = await page.$$('#mapSelect .map-card');
  check(cards.length === 3, '菜单应有三张地图卡片，实际 ' + cards.length);
  const seen = [];
  const seq = ['snow', 'dust', 'backyard'];
  for (const id of seq) {
    const before = await page.evaluate(() => {
      const g = window.__game;
      return {
        bg: g.scene.background && g.scene.background.uuid,
        fogNear: g.scene.fog && g.scene.fog.near,
        fogFar: g.scene.fog && g.scene.fog.far,
        calls: g.renderer.info.render.calls,
      };
    });
    // 真实点击卡片
    await page.click(`#mapSelect .map-card[data-map="${id}"]`);
    await page.waitForFunction(
      (want) => window.__game.mapId === want && window.__game.state === 'menu',
      id,
      { timeout: 5000 }
    );
    await page.waitForTimeout(250); // 让渲染循环跑几帧
    const after = await page.evaluate((want) => {
      const g = window.__game;
      const active = document.querySelector('#mapSelect .map-card.active');
      const visibles = g.maps.map((m) => m.root.visible);
      const pad = 1e-9;
      return {
        mapId: g.mapId,
        activeMap: active && active.dataset.map,
        bg: g.scene.background && g.scene.background.uuid,
        bgColor: g.scene.background && g.scene.background.color && g.scene.background.color.getHexString(),
        fogNear: g.scene.fog && g.scene.fog.near,
        fogFar: g.scene.fog && g.scene.fog.far,
        visibles,
        calls: g.renderer.info.render.calls,
        startLabel: document.getElementById('startBtn').textContent,
        want,
      };
    }, id);
    check(after.mapId === id, '点击 ' + id + ' 卡片后 mapId 应为 ' + id + '，实际 ' + after.mapId);
    check(after.activeMap === id, '点击 ' + id + ' 卡片后该卡片应有 active 类，实际 ' + after.activeMap);
    check(
      after.bg !== before.bg || after.fogNear !== before.fogNear || after.fogFar !== before.fogFar,
      id + '：scene.background 与 fog 都没变化（切图没生效）'
    );
    check(after.calls > 0, id + '：切图后 renderer 没有 draw call（render 失败）');
    const visibleCount = after.visibles.filter(Boolean).length;
    check(visibleCount === 1, id + '：应只有 1 张地图 root 可见，实际 ' + visibleCount);
    seen.push({ id, fogNear: after.fogNear, fogFar: after.fogFar, bg: after.bgColor });
  }
  // 三张地图的雾参数必须互不相同，否则切图只是“换了 id”
  const fogKeys = new Set(seen.map((s) => s.fogNear + '/' + s.fogFar));
  check(fogKeys.size === 3, '三张地图的雾参数应各不相同，实际 ' + JSON.stringify(seen));
  return {
    metrics: { maps: seen.map((s) => s.id).join('→'), distinctFog: fogKeys.size },
  };
}

// 场景 5（在 ctx 里以新 page 跑）：手机模拟
async function phaseMobile(ctx) {
  const { browser, url } = ctx;
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await installProbes(page);
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + ((e && e.message) || e)));
  try {
    await page.goto(url, { waitUntil: 'load' });
    await waitUntil(page, () => !!window.__game, 30000, 'window.__game');
    await waitUntil(page, () => window.__game.renderer.info.render.calls > 0, 30000, '渲染循环');

    const mode = await page.evaluate(() => ({
      cls: document.body.className,
      isTouch: window.__game.controls.isTouch,
      maxTouch: navigator.maxTouchPoints,
      coarse: window.matchMedia('(pointer: coarse)').matches,
      hoverNone: window.matchMedia('(hover: none)').matches,
    }));
    check(/\btouch\b/.test(mode.cls), '手机模式下 body 应有 touch 类，实际：' + mode.cls);
    check(mode.isTouch === true, 'controls.isTouch 应为 true，实际 ' + mode.isTouch);

    // 横屏 844x390：竖屏拦截层应隐藏
    const gateShown = await page.isVisible('#orientationGate');
    check(gateShown === false, '横屏下 #orientationGate 不应可见');

    // 真实 tap 开始
    await page.tap('#startBtn');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 10000 });
    const lockCallsTouch = await page.evaluate(() => window.__e2e.lockCalls);
    check(lockCallsTouch === 0, '触屏设备不应调用 requestPointerLock，实际调用 ' + lockCallsTouch + ' 次');

    // 开火/跳跃按钮可见且尺寸非零
    const btnBox = await page.evaluate(() => {
      const pick = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return { w: r.width, h: r.height, x: r.x, y: r.y, display: st.display, vis: st.visibility, op: st.opacity };
      };
      return { fire: pick('fireBtn'), jump: pick('jumpBtn'), dock: pick('weaponDock') };
    });
    for (const k of ['fire', 'jump']) {
      const b = btnBox[k];
      check(b && b.w > 40 && b.h > 40, k + 'Btn 尺寸非零应 >=40px，实际 ' + JSON.stringify(b));
      check(b.display !== 'none' && b.vis !== 'hidden' && Number(b.op) > 0.5, k + 'Btn 不可见：' + JSON.stringify(b));
    }
    // 按钮不能互相压住
    const overlap = !(
      btnBox.fire.x + btnBox.fire.w <= btnBox.jump.x + 1 ||
      btnBox.jump.x + btnBox.jump.w <= btnBox.fire.x + 1 ||
      btnBox.fire.y + btnBox.fire.h <= btnBox.jump.y + 1 ||
      btnBox.jump.y + btnBox.jump.h <= btnBox.fire.y + 1
    );
    check(!overlap, '开火与跳跃按钮重叠：fire=' + JSON.stringify(btnBox.fire) + ' jump=' + JSON.stringify(btnBox.jump));

    // 真实触摸按住 #fireBtn：controls.firing 应为 true，且产生弹丸
    await page.evaluate(() => {
      const g = window.__game;
      g.sun = 999;
      g.weapons.cooldown = 0;
    });
    const fireCenter = { x: btnBox.fire.x + btnBox.fire.w / 2, y: btnBox.fire.y + btnBox.fire.h / 2 };
    // touchscreen.tap 是 down+up 太快，自动武器可能一帧都没赶上；用 CDP 分开发 down/up
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: fireCenter.x, y: fireCenter.y, id: 1 }],
    });
    await page.waitForTimeout(400);
    const firing = await page.evaluate(() => ({
      firing: window.__game.controls.firing,
      pressed: document.getElementById('fireBtn').classList.contains('pressed'),
      activePeas: window.__game.projectiles.peas.filter((p) => p.active).length,
      cooldown: window.__game.weapons.cooldown,
    }));
    check(firing.firing === true, '按住 #fireBtn 后 controls.firing 应为 true，实际 ' + firing.firing);
    check(firing.pressed === true, '按住 #fireBtn 时应加 .pressed 类');
    check(firing.activePeas >= 1, '按住开火 400ms 应至少产生 1 颗弹丸，实际 ' + firing.activePeas);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    const released = await page.evaluate(() => window.__game.controls.firing);
    check(released === false, '松开开火键后 controls.firing 应为 false，实际 ' + released);

    // 真实触摸跳跃按钮
    const jumpCenter = { x: btnBox.jump.x + btnBox.jump.w / 2, y: btnBox.jump.y + btnBox.jump.h / 2 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: jumpCenter.x, y: jumpCenter.y, id: 2 }],
    });
    await page.waitForTimeout(120);
    const jumped = await page.evaluate(() => window.__game.player.pos.y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(jumped > 0.05, '点跳跃按钮后玩家应离地（pos.y > 0.05），实际 y=' + jumped.toFixed(3));
    // 落回地面，避免影响后续
    await waitUntil(page, () => window.__game.player.pos.y < 0.05, 5000, '玩家落地');

    // 真实触摸左侧摇杆区域 → 玩家移动
    const beforeJoy = await page.evaluate(() => {
      const g = window.__game;
      const rect = document.getElementById('joyBase').getBoundingClientRect();
      return { x: g.player.pos.x, z: g.player.pos.z, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width };
    });
    check(beforeJoy.w > 0, '摇杆区域应有尺寸（touch 模式 #joyBase 不能是 hidden）');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: beforeJoy.cx, y: beforeJoy.cy - 6, id: 3 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: beforeJoy.cx, y: beforeJoy.cy - beforeJoy.w * 0.44, id: 3 }],
    });
    await page.waitForTimeout(600);
    const joyState = await page.evaluate(() => ({
      x: window.__game.player.pos.x,
      z: window.__game.player.pos.z,
      moveY: window.__game.controls.move.y,
      joyActive: document.getElementById('joyBase').classList.contains('active'),
    }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const joyMoved = Math.hypot(joyState.x - beforeJoy.x, joyState.z - beforeJoy.z);
    check(joyState.joyActive, '按住摇杆区域后 #joyBase 应加 .active');
    check(joyMoved > 0.4, '推摇杆 600ms 玩家应移动 > 0.4m，实际 ' + joyMoved.toFixed(3) + 'm（move.y=' + joyState.moveY + '）');

    // 竖屏：拦截层出现，且游戏不能处于 playing（checkOrientation 会暂停）
    await page.setViewportSize({ width: 390, height: 844 });
    await waitUntil(page, () => window.__game.state !== 'playing', 5000, '竖屏后游戏暂停');
    const portrait = await page.evaluate(() => {
      const el = document.getElementById('orientationGate');
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return {
        state: window.__game.state,
        gate: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1,
        display: st.display,
      };
    });
    check(portrait.display === 'flex' && portrait.gate, '竖屏下 #orientationGate 应全屏可见：' + JSON.stringify(portrait));
    check(portrait.state !== 'playing', '竖屏下 state 不应是 playing，实际 ' + portrait.state);
    // 竖屏拦截层要真的挡住输入：点开始按钮不应进入 playing
    await page.evaluate(() => {
      // 拦截层是纯 CSS 媒体查询驱动的，这里从菜单重开一次验证它挡得住
      window.__game.backToMenu();
    });
    await page.waitForTimeout(200);
    const gateBlocks = await page.evaluate(() => {
      const el = document.getElementById('orientationGate');
      const r = document.getElementById('startBtn').getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { hit: top ? (top.id || top.className || top.tagName) : null, gateId: el.id };
    });
    check(
      gateBlocks.hit === 'orientationGate' || gateBlocks.hit === 'orientation-phone' || /orientation/.test(String(gateBlocks.hit)),
      '竖屏下开始按钮应被 #orientationGate 盖住，elementFromPoint 实际命中：' + gateBlocks.hit
    );
    await shot(page, 'phase-mobile-portrait');

    // 转回横屏：拦截层消失、可以正常开始
    await page.setViewportSize({ width: 844, height: 390 });
    await waitUntil(page, () => getComputedStyle(document.getElementById('orientationGate')).display === 'none', 5000, '横屏后拦截层隐藏');
    await page.tap('#startBtn');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 5000 });
    check(consoleErrors.length === 0, '手机场景出现 console error：\n   - ' + consoleErrors.join('\n   - '));
    return {
      metrics: {
        touchClass: mode.isTouch,
        fireBtn: Math.round(btnBox.fire.w) + 'x' + Math.round(btnBox.fire.h),
        jumpBtn: Math.round(btnBox.jump.w) + 'x' + Math.round(btnBox.jump.h),
        peas: firing.activePeas,
        jumpY: +jumped.toFixed(2),
        joyMove: +joyMoved.toFixed(2),
        portraitState: portrait.state,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

// 场景 5：性能与稳定性（10 秒采样，第 5 波 Boss 密度）
async function phasePerf(ctx) {
  const { page } = ctx;
  await ensurePlaying(page);
  // 顶到同屏上限（14 只）+ 第 5 波 Boss 波，采样才是真实压力场景
  await page.evaluate(() => {
    const g = window.__game;
    g.sun = 999;
    g.player.hp = 1e9; // 只测性能，不让玩家中途死掉影响采样
    g.player.maxHp = 1e9;
    g.zombies.reset();
    g.zombies.startWave(5);
    g.zombies.maxAlive = 14;
    g.zombies.interval = 0.05;
    g.zombies.spawnTimer = 0;
  });
  await waitUntil(page, () => window.__game.zombies.zombies.length >= 14, 30000, '同屏僵尸达到上限 14 只');
  // 持续开火（粒子/弹丸/命中特效也计入 draw call）
  await page.evaluate(() => {
    const g = window.__game;
    g.controls.setFiring(true);
    g.zombies.queue.length = 0; // 清空队列，避免采样中途刷出新一波导致波次跳变
    for (let i = 0; i < 40; i++) g.zombies.queue.push('normal');
  });

  // 采样器挂进 rAF：每次渲染后读 renderer.info（render() 内部会 reset 统计，所以 rAF 回调读到的是上一帧）
  await page.evaluate(() => {
    const g = window.__game;
    const perf = (window.__perf = {
      frames: 0,
      maxCalls: 0,
      maxTris: 0,
      sumCalls: 0,
      maxZombies: 0,
      minFps: Infinity,
      last: performance.now(),
      t0: performance.now(),
      done: false,
    });
    const tick = () => {
      const info = g.renderer.info.render;
      if (info.calls > perf.maxCalls) perf.maxCalls = info.calls;
      if (info.triangles > perf.maxTris) perf.maxTris = info.triangles;
      perf.sumCalls += info.calls;
      perf.frames++;
      if (g.zombies.zombies.length > perf.maxZombies) perf.maxZombies = g.zombies.zombies.length;
      const now = performance.now();
      const dt = now - perf.last;
      perf.last = now;
      if (now - perf.t0 < 10000) requestAnimationFrame(tick);
      else {
        perf.windowSec = (now - perf.t0) / 1000;
        perf.done = true;
      }
    };
    requestAnimationFrame(tick);
  });
  try {
    await page.waitForFunction(() => window.__perf && window.__perf.done, null, { timeout: 40000 });
  } finally {
    await page.evaluate(() => window.__game.controls.setFiring(false)).catch(() => {});
  }
  const perf = await page.evaluate(() => {
    const p = window.__perf;
    const g = window.__game;
    return {
      frames: p.frames,
      maxCalls: p.maxCalls,
      maxTris: p.maxTris,
      avgCalls: Math.round(p.sumCalls / Math.max(1, p.frames)),
      maxZombies: p.maxZombies,
      state: g.state,
      pixelRatio: g.pixelRatio,
      windowSec: p.windowSec,
    };
  });
  // 至少跑够时长（无头 SwiftShader 可能严重掉帧，帧数低但时长要对）
  const errs = await drainErrors(page);
  check(errs.length === 0, '性能采样期间有报错：\n   - ' + errs.join('\n   - '));
  check(perf.state === 'playing', '采样结束时应在 playing，实际 ' + perf.state);
  check(perf.maxCalls > 0, '采样期间没有 draw call');
  // 采样窗口必须是完整的 10 秒墙钟（SwiftShader 帧率低，帧数少但时间要够）
  check(perf.windowSec >= 10, '采样窗口不足 10 秒：' + perf.windowSec.toFixed(2) + 's');
  check(perf.frames >= 30, '10 秒内帧数过少（' + perf.frames + '），采样不足以代表峰值');
  check(perf.maxCalls <= 350, 'draw call 峰值超过 350：' + perf.maxCalls);
  check(perf.maxTris <= 300000, '三角面峰值超过 300000：' + perf.maxTris);
  check(perf.maxZombies >= 3, '第 5 波采样期间应至少同屏 3 只僵尸，实际峰值 ' + perf.maxZombies);
  await shot(page, 'phase-perf');
  return {
    metrics: {
      frames: perf.frames + '/' + perf.windowSec.toFixed(1) + 's',
      maxCalls: perf.maxCalls,
      avgCalls: perf.avgCalls,
      maxTris: perf.maxTris,
      maxZombies: perf.maxZombies,
      dpr: perf.pixelRatio,
    },
  };
}

// 场景 6：死亡结算与重开
async function phaseGameOver(ctx) {
  const { page } = ctx;
  await ensurePlaying(page);
  // 先造出真实战果（击杀/积分非零），否则结算面板的"有值"断言等于没测
  await ensureZombieTypes(page, ['normal']);
  // 走真实结算路径：Zombie.hit 只标记 dying，handleKill 才记分/计杀（damageArea 内部会调）
  await page.evaluate(() => {
    const g = window.__game;
    const z = g.zombies.zombies.find((x) => x.alive && !x.dying);
    g.zombies.damageArea(z.root.position.clone(), 0.5, 1e6, z, 1);
  });
  await waitUntil(page, () => window.__game.stats.kills > 0, 5000, '先击杀至少 1 只僵尸');
  const beforeDeath = await page.evaluate(() => ({ ...window.__game.stats, sun: window.__game.sun }));

  await page.evaluate(() => {
    const g = window.__game;
    g.hud.setKills(g.stats.kills);
    g.hud.setScore(g.stats.score);
    g.player.maxHp = 100;
    g.player.hp = 12; // 玩家只剩 12 点血：普通僵尸一下 9、两下带走
    g.player.invuln = 0;
    g.player.sinceDamage = 0; // 关掉回血
    g.zombies.reset();
    g.zombies.queue.length = 0;
    g.zombies.queue.push('normal', 'normal');
    g.zombies.startWave(5);
    g.zombies.queue.length = 0;
    g.zombies.queue.push('normal', 'normal');
  });
  // 把僵尸直接挪到玩家脸上，等它攻击
  await waitUntil(page, () => window.__game.zombies.zombies.length > 0, 20000, '刷出僵尸');
  await page.evaluate(() => {
    const g = window.__game;
    const z = g.zombies.zombies[0];
    z.root.position.set(g.player.pos.x + 0.7, 0, g.player.pos.z + 0.7);
    z.spawnT = 1;
    z.model.position.y = 0;
    z.attackTimer = 0.05;
    // 连续攻击：死亡判定需要两次命中（12 血 / 9 伤害），把无敌帧压掉
    const iv = setInterval(() => {
      g.player.invuln = 0;
      g.player.sinceDamage = 0;
      for (const zz of g.zombies.zombies) {
        zz.attackTimer = 0;
        zz.root.position.set(g.player.pos.x + 0.7, 0, g.player.pos.z + 0.7);
        zz.spawnT = 1;
      }
    }, 100);
    window.__e2eKillTimer = iv;
  });
  try {
    await waitUntil(page, () => window.__game.state === 'over', 20000, '玩家被僵尸打死');
  } finally {
    await page.evaluate(() => {
      clearInterval(window.__e2eKillTimer);
      window.__e2eKillTimer = null;
    });
  }
  // 结算面板 800ms 后出现
  await waitUntil(page, () => {
    const s = document.getElementById('overScreen');
    return s && !s.classList.contains('hidden');
  }, 5000, '#overScreen 出现');
  const over = await page.evaluate(() => ({
    state: window.__game.state,
    finalScore: document.getElementById('finalScore').textContent,
    finalWave: document.getElementById('finalWave').textContent,
    finalKills: document.getElementById('finalKills').textContent,
    hudHidden: document.getElementById('hud').classList.contains('hidden'),
    dead: window.__game.player.dead,
  }));
  check(over.state === 'over', '玩家死亡后 state 应为 over，实际 ' + over.state);
  check(over.dead, 'player.dead 应为 true');
  check(over.hudHidden, '结算时 HUD 应隐藏');
  check(/^\d/.test(over.finalScore), '#finalScore 应有值，实际 "' + over.finalScore + '"');
  check(Number(over.finalWave) >= 1, '#finalWave 应 >= 1，实际 "' + over.finalWave + '"');
  check(/^\d+$/.test(over.finalKills), '#finalKills 应是数字，实际 "' + over.finalKills + '"');
  // 面板数字必须等于真实战果（不是写死的占位）
  check(
    Number(over.finalKills) === beforeDeath.kills,
    '结算击杀应等于真实击杀 ' + beforeDeath.kills + '，实际 ' + over.finalKills
  );
  check(beforeDeath.kills >= 1, '本场景必须先造出真实击杀，实际 ' + beforeDeath.kills);
  await shot(page, 'phase-gameover');

  // 真实点“再来一局”
  await page.click('#againBtn');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state,
      stats: { ...g.stats },
      hp: g.player.hp,
      maxHp: g.player.maxHp,
      sun: g.sun,
      zombies: g.zombies.zombies.length,
      wave: g.zombies.wave,
      overHidden: document.getElementById('overScreen').classList.contains('hidden'),
      hudShown: !document.getElementById('hud').classList.contains('hidden'),
      lockCalls: window.__e2e.lockCalls,
    };
  });
  check(again.overHidden, '重开后 #overScreen 应隐藏');
  check(again.hudShown, '重开后 HUD 应可见');
  check(again.stats.score === 0 && again.stats.kills === 0, '重开后 stats 应归零，实际 ' + JSON.stringify(again.stats));
  check(again.hp === again.maxHp, '重开后玩家应满血，实际 ' + again.hp + '/' + again.maxHp);
  check(again.wave === 1, '重开后应回到第 1 波，实际 ' + again.wave);
  check(again.zombies === 0 || again.zombies <= 2, '重开后不应立刻堆满僵尸，实际 ' + again.zombies);
  const scoreLabel = await page.textContent('#scoreLabel');
  check(scoreLabel.trim() === '0', '重开后 HUD 积分应显示 0，实际 ' + scoreLabel);
  return {
    metrics: {
      finalScore: over.finalScore,
      finalWave: over.finalWave,
      finalKills: over.finalKills + '/' + beforeDeath.kills,
      hp: again.hp,
    },
  };
}

// 场景：骷髅（KayKit 独立模型 + 雪地专属 + 同屏上限）
//
// 骷髅是第二个 glb，和僵尸模型是两套资产：骨骼数、动作名、材质数都不同，
// 必须在真浏览器里确认它能加载、有独立骨骼、动作能播，而且不越过同屏上限。
async function phaseSkeleton(ctx) {
  const { page } = ctx;
  await ensurePlaying(page);

  // 先切到雪地（骷髅只在雪地图出现），再开一个高波次
  const setup = await page.evaluate(() => {
    const g = window.__game;
    g.zombies.reset();
    if (g.state !== 'menu') g.backToMenu();
    return { state: g.state };
  });
  await page.waitForFunction(() => window.__game.state === 'menu', null, { timeout: 5000 });
  await page.evaluate(() => window.__game.setMap('snow'));
  await page.evaluate(() => {
    const g = window.__game;
    g.start();
    g.sun = 999;
    g.player.hp = 1e9;
    g.player.maxHp = 1e9;
  });

  // 必须等骷髅 glb 就绪后再开波。glb 是异步加载的（1.4 MB），
  // 提前开波会让 spawnOne 跳过骷髅并打乱队列顺序，可能整波都等不到骷髅。
  await page.waitForFunction(
    () => window.__game.models && window.__game.models.skeleton.ready,
    null,
    { timeout: 20000 }
  ).catch(() => {});
  const skReady = await page.evaluate(() => !!(window.__game.models && window.__game.models.skeleton.ready));
  check(skReady, '骷髅 glb 20 秒内没加载完');

  await page.evaluate(() => {
    const g = window.__game;
    g.zombies.reset();
    g.zombies.startWave(10);
    g.zombies.maxAlive = 14;
    g.zombies.interval = 0.05;
    g.zombies.spawnTimer = 0;
  });

  // 波次队列是洗牌的，骷髅未必排得到。把队列整理成确定性顺序：
  // 骷髅提到最前（保证必刷），其余保留。这样断言不受洗牌运气影响。
  await page.evaluate(() => {
    const zm = window.__game.zombies;
    const sk = zm.queue.filter((t) => t === 'skeleton');
    const rest = zm.queue.filter((t) => t !== 'skeleton');
    zm.queue = [...sk, ...rest];
  });

  // 骷髅模型是异步加载的：等它真的刷出来（实例建好 = glb 已就绪）。
  await waitUntil(
    page,
    () => window.__game.zombies.zombies.some((z) => z.type === 'skeleton'),
    25000,
    '刷出骷髅'
  ).catch(async (err) => {
    const dbg = await page.evaluate(() => {
      const zm = window.__game.zombies;
      return {
        mapId: window.__game.mapId,
        wave: zm.wave,
        state: zm.state,
        queueLen: zm.queue.length,
        queueSk: zm.queue.filter((t) => t === 'skeleton').length,
        alive: zm.zombies.length,
        types: zm.zombies.map((z) => z.type).join(','),
        maxAlive: zm.maxAlive,
        skReady: window.__game.models.skeleton.ready,
        skFailed: window.__game.models.skeleton.failed,
      };
    });
    throw new Error(err.message + '\n现场：' + JSON.stringify(dbg));
  });

  const loaded = await page.evaluate(() => {
    const z = window.__game.zombies.zombies.find((s) => s.type === 'skeleton');
    return { ready: !!z, failed: false, clips: z && z.mixer ? Object.keys(z.actions).length : 0 };
  });
  check(loaded.ready, '骷髅 glb 没加载成功（failed=' + loaded.failed + '）');
  check(loaded.clips >= 4, '骷髅动画只有 ' + loaded.clips + ' 个动作，应 >= 4');
  // 再生几只，验证上限
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const g = window.__game;
    const sk = g.zombies.zombies.filter((z) => z.type === 'skeleton');
    return {
      mapId: g.mapId,
      count: sk.length,
      all: g.zombies.zombies.length,
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      detail: sk.map((z) => {
        let meshes = 0;
        let skinned = 0;
        let boneId = null;
        const mats = new Set();
        z.body.traverse((n) => {
          if (n.isMesh) {
            meshes++;
            if (n.isSkinnedMesh) skinned++;
            if (n.material) mats.add(n.material.uuid);
          }
          if (!boneId && n.isBone) boneId = n.uuid;
        });
        return {
          meshes,
          skinned,
          mats: mats.size,
          boneId,
          hasMixer: !!z.mixer,
          current: z.current,
          clipCount: z.mixer ? Object.keys(z.actions).length : 0,
          walkClip: z.actions && z.actions.walk ? z.actions.walk.getClip().name : null,
          attackClip: z.actions && z.actions.attack ? z.actions.attack.getClip().name : null,
          scale: z.body.scale.x,
        };
      }),
    };
  });

  check(info.mapId === 'snow', '骷髅场景应切到雪地，实际 ' + info.mapId);
  check(info.count > 0, '没刷出骷髅');
  check(info.count <= 3, '骷髅同屏 ' + info.count + ' 只，超过上限 3');
  check(info.detail.length > 0, '没有骷髅实例可检查');

  const problems = [];
  const boneIds = new Set();
  for (const d of info.detail) {
    // KayKit 骷髅是 9 个独立蒙皮部件
    if (d.meshes < 5) problems.push('骷髅只有 ' + d.meshes + ' 个 mesh（KayKit 应是 9 个）');
    if (d.skinned !== d.meshes) problems.push('骷髅有 mesh 不是 SkinnedMesh');
    if (d.mats < 2) problems.push('骷髅材质数 ' + d.mats + '，应有 skeleton + Glow 两种');
    if (!d.boneId) problems.push('骷髅没有骨骼');
    else boneIds.add(d.boneId);
    if (!d.hasMixer) problems.push('骷髅 mixer 为空');
    if (!(d.clipCount >= 4)) problems.push('骷髅动作只有 ' + d.clipCount + ' 个');
    if (!/walk/i.test(d.walkClip || '')) problems.push('骷髅 walk 动作异常：' + d.walkClip);
    if (!/attack/i.test(d.attackClip || '')) problems.push('骷髅 attack 动作异常：' + d.attackClip);
    if (!(d.scale > 0.5 && d.scale < 1.5)) problems.push('骷髅缩放异常 ' + d.scale);
  }
  if (boneIds.size !== info.detail.length) {
    problems.push('骷髅骨骼被共享了（' + boneIds.size + ' 套 / ' + info.detail.length + ' 只）');
  }
  check(problems.length === 0, '骷髅断言失败：\n   - ' + problems.join('\n   - '));

  const shot1 = await shot(page, 'phase-skeleton');

  // 还原现场：本场景为了刷骷髅切到了雪地，后续场景（maps）假定从非雪地开始，
  // 留着会污染它们的地图切换断言。退回主菜单并把地图切回后院。
  await page.evaluate(() => {
    const g = window.__game;
    g.zombies.reset();
    if (g.state !== 'menu') g.backToMenu();
  });
  await page.waitForFunction(() => window.__game.state === 'menu', null, { timeout: 5000 });
  await page.evaluate(() => window.__game.setMap('backyard'));
  await page.waitForFunction(() => window.__game.mapId === 'backyard', null, { timeout: 5000 });

  return {
    metrics: {
      map: info.mapId,
      skeletons: info.count + '/' + info.all,
      clips: loaded.clips,
      meshes: info.detail[0] && info.detail[0].meshes,
      walkClip: info.detail[0] && info.detail[0].walkClip,
      drawCalls: info.calls,
      tris: info.tris,
      shot: shot1,
    },
  };
}

// ---------------------------------------------------------------- 主流程

const PHASES = [
  { name: 'startup', label: '桌面真实开局（指针锁/键鼠/击杀）', group: 'desktop', fn: phaseStartup },
  { name: 'glb', label: '真实 glb 与材质/配件', group: 'desktop', fn: phaseGlb },
  { name: 'skeleton', label: '骷髅模型（雪地专属 + 同屏上限）', group: 'desktop', fn: phaseSkeleton },
  { name: 'maps', label: '三张地图真实切换', group: 'desktop', fn: phaseMaps },
  { name: 'mobile', label: '手机模拟（横屏 UI + 竖屏拦截）', group: 'mobile', fn: phaseMobile },
  { name: 'perf', label: '性能与稳定性（10s 采样）', group: 'desktop', fn: phasePerf },
  { name: 'gameover', label: '死亡结算与重开', group: 'desktop', fn: phaseGameOver },
];

async function main() {
  const only = (process.env.E2E_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const phases = only.length ? PHASES.filter((p) => only.includes(p.name)) : PHASES;
  if (!phases.length) {
    console.error('E2E_ONLY 没匹配到任何场景：' + only.join(','));
    process.exit(1);
  }

  const { chromium } = await import('playwright-core');

  console.log('▶ [1/3] vite build');
  const buildCode = await runBuild();
  if (buildCode !== 0) {
    console.error('\n❌ vite build 失败（exit ' + buildCode + '）');
    process.exit(1);
  }

  const executablePath = findChromium();
  if (!executablePath) {
    console.error('\n❌ 找不到 Playwright 的 Chromium，可用 PLAYWRIGHT_BROWSERS_PATH 指定');
    process.exit(1);
  }

  console.log('▶ [2/3] vite preview :' + PORT);
  const server = spawn(
    'node',
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, NODE_ENV: undefined } }
  );
  const url = 'http://127.0.0.1:' + PORT + '/';
  const up = await waitForServer(url);
  if (!up) {
    server.kill('SIGKILL');
    console.error('\n❌ vite preview 启动超时：' + url);
    process.exit(1);
  }

  console.log('▶ [3/3] 运行 ' + phases.length + ' 个场景\n');
  const browser = await chromium.launch({ executablePath, args: CHROME_ARGS });
  const results = [];
  let desktopCtx = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    const { page, consoleErrors } = await openPage(context, url);
    desktopCtx = { page, consoleErrors, browser, url, context };

    for (const phase of phases) {
      if (phase.group === 'desktop' && page.isClosed()) {
        throw new Error('桌面 page 已关闭，无法继续 ' + phase.name);
      }
      const t0 = Date.now();
      let outcome;
      try {
        outcome = (await phase.fn(desktopCtx)) || { metrics: {} };
        const errs = await drainErrors(page).catch(() => []);
        if (errs.length) throw new PhaseError('控制台/页面报错：\n   - ' + errs.join('\n   - '));
        outcome = { ok: true, metrics: outcome.metrics || {}, extra: outcome.extra };
      } catch (err) {
        let file = null;
        try {
          file = await shot(page, 'phase-' + phase.name + '-FAIL');
        } catch (e) {
          // page 已崩
        }
        outcome = {
          ok: false,
          reason: (err && err.message) || String(err),
          screenshot: file,
          metrics: {},
        };
      }
      outcome.name = phase.name;
      outcome.label = phase.label;
      outcome.ms = Date.now() - t0;
      results.push(outcome);
      console.log(
        (outcome.ok ? '  ✅ ' : '  ❌ ') +
          phase.name.padEnd(9) +
          ' ' +
          phase.label +
          '  (' +
          (outcome.ms / 1000).toFixed(1) +
          's)'
      );
      if (!outcome.ok) {
        console.log('     ' + outcome.reason.split('\n').join('\n     '));
        if (outcome.screenshot) console.log('     截图：' + path.relative(ROOT, outcome.screenshot));
      }
      // 某个桌面场景挂了就别继续跑后面的（后面的依赖同一个 page）
      if (!outcome.ok && phase.group === 'desktop') break;
    }
    // 汇总窗口级 console error（页面里被替换的 console.error 之外，Playwright 侧也收一份）
    if (desktopCtx.consoleErrors.length) {
      results.push({
        name: 'console',
        label: '整轮无 console error / pageerror',
        ok: false,
        reason: desktopCtx.consoleErrors.join('\n'),
        ms: 0,
        metrics: {},
      });
    }
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGKILL');
  }

  // 汇总表
  console.log('\n' + '─'.repeat(78));
  console.log('场景'.padEnd(12) + '耗时'.padEnd(9) + '结果'.padEnd(7) + '关键指标');
  console.log('─'.repeat(78));
  for (const r of results) {
    const metrics = Object.entries(r.metrics)
      .map(([k, v]) => k + '=' + v)
      .join(' ');
    console.log(
      r.name.padEnd(12) + ((r.ms / 1000).toFixed(1) + 's').padEnd(9) + (r.ok ? 'PASS' : 'FAIL').padEnd(7) + metrics
    );
  }
  console.log('─'.repeat(78));
  const failed = results.filter((r) => !r.ok);
  const expected = phases.length;
  const passed = results.filter((r) => r.ok).length;
  if (failed.length || passed < expected) {
    console.error('❌ E2E 失败：' + passed + '/' + expected + ' 场景通过（另有 ' + failed.length + ' 项失败）');
    for (const f of failed) console.error('  - ' + f.name + '：' + f.reason.split('\n')[0]);
    process.exit(1);
  }
  console.log('✅ 浏览器级 E2E 全部通过：' + passed + '/' + expected);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});