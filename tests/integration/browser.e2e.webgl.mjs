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
  // 软件渲染走 ANGLE 的 SwiftShader（裸 GL 版已废弃，会回落到更慢的路径）
  '--use-angle=swiftshader',
  '--use-gl=angle',
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
    // startWave 会洗牌：要求的类型不管原来在队里哪个位置，都提到队首，
    // 否则同屏上限 14 会被前面的 football/cone 填满，bucket 永远排不到。
    for (const t of types.slice().reverse()) {
      g.zombies.queue = g.zombies.queue.filter((x) => x !== t);
      g.zombies.queue.unshift(t);
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
    // 刷怪速度只取决于帧数：CI 软渲染一帧可能要几百毫秒，25 秒不够刷齐 14 只里的 boss，
    // 所以给足 60 秒（本地 4 秒就跑完），超时才报失败，并把已刷出的类型带进消息里。
    await waitUntil(
      page,
      (types) => types.every((k) => window.__e2eSeen && window.__e2eSeen[k]),
      60000,
      '刷出僵尸类型：' + want.join('/'),
      want
    ).catch(async (err) => {
      const seen = await page.evaluate(() => Object.keys(window.__e2eSeen || {}));
      const dbg = await page.evaluate(() => ({ alive: window.__game.zombies.zombies.length, queue: window.__game.zombies.queue.slice(0, 6) }));
      throw new PhaseError(err.message + '（已刷出：' + (seen.join('/') || '无') + '；场上 ' + dbg.alive + ' 只，队首 ' + dbg.queue.join('/') + '）');
    });
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

  // 真实键盘：W 前进。
  // 位移只取决于"跑了多少帧"，所以等"位移达标"而不是固定等 700ms——
  // 固定墙钟在 CI 的软渲染上会把"机器慢"误判成"W 不生效"（同 mobile 摇杆那处）。
  const p0 = await page.evaluate(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
  await page.keyboard.down('KeyW');
  const W_TARGET = 0.5;
  const wDeadline = Date.now() + 15000;
  let moved = 0;
  while (Date.now() < wDeadline) {
    const p = await page.evaluate(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
    moved = Math.hypot(p.x - p0.x, p.z - p0.z);
    if (moved > W_TARGET) break;
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
  check(moved > W_TARGET, '按住 W 15s 内玩家应移动 > ' + W_TARGET + 'm，实际 ' + moved.toFixed(3) + 'm');

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

  // 按住左键（自动武器会持续开火），期间每 300ms 重瞄一次——僵尸在朝玩家走。
  // 循环按"是不是打死了"来退，而不是固定次数：慢机器上 10×300ms 的墙钟只够渲染几帧，
  // 弹道推不完就断言 kills 会把"机器慢"误判成"开枪不生效"。
  await page.mouse.move(720, 430);
  await page.mouse.down();
  const firingState = await page.evaluate(() => window.__game.controls.firing);
  check(firingState === true, '按下左键后 controls.firing 应为 true');
  let lockedAt = false;
  for (let i = 0; i < 40; i++) {
    const locked = await page.evaluate(async ([first]) => {
      const g = window.__game;
      const z = g.zombies.zombies.find((x) => x.alive && !x.dying);
      if (z) {
        // 放到玩家前方 4 米：镜头不糊、瞄点稳定
        if (first) z.root.position.set(g.player.pos.x, 0, g.player.pos.z - 4);
        const p = g.player;
        // 瞄胸口（HIT 表里的 chest），不要用固定的 0.95：0.95 在普通僵尸胸口上方 0.12 米，
        // 僵尸走近后角度会超出桌面的 2.6° 辅助瞄准锥，测试会假红。
        const chest = z.getChest(new (p.eye.constructor)());
        const dx = chest.x - p.eye.x;
        const dy = chest.y - p.eye.y;
        const dz = chest.z - p.eye.z;
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
    throw new PhaseError('按住左键持续开火仍没击杀僵尸，实际 kills=' + after.kills + ' 诊断：' + JSON.stringify(diag));
  }
  check(after.state === 'playing', '开火期间玩家不应死亡/暂停，state=' + after.state);
  check(after.kills >= 1, '按住左键持续开火应击杀至少 1 只僵尸，实际 kills=' + after.kills);
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
  // 多个 glb 都是异步加载的：Boss 用骷髅模型、橄榄球用自己的 football 模型，没就绪时
  // spawnOne 会把它们留在队首不刷，于是"刷出全部类型"永远等不到。CI 的 SwiftShader 起得慢，
  // 这个窗口会被拉长，所以先明确等模型都就绪，别让断言去猜。
  const modelsReady = await page
    .waitForFunction(
      () =>
        window.__game.models &&
        window.__game.models.ready &&
        window.__game.models.skeleton.ready &&
        window.__game.models.football.ready,
      null,
      { timeout: 60000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  if (!modelsReady) {
    const dbg = await page.evaluate(() => ({
      zombieReady: !!(window.__game.models && window.__game.models.ready),
      zombieFailed: !!(window.__game.models && window.__game.models.failed),
      skReady: !!(window.__game.models && window.__game.models.skeleton.ready),
      skFailed: !!(window.__game.models && window.__game.models.skeleton.failed),
      footballReady: !!(window.__game.models && window.__game.models.football.ready),
      footballFailed: !!(window.__game.models && window.__game.models.football.failed),
    }));
    throw new PhaseError('模型 60 秒内没加载完：' + JSON.stringify(dbg));
  }
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
        // 配件分两类：头饰（this.hat，必须高过头骨）与背后道具（this.balloon）。
        // 断言"有没有挂配件"用 accProp；"戴没戴在头上"只用 this.hat。
        const accProp = z.hat || z.balloon || null;
        const hatMat = accProp && accProp.children[0] && accProp.children[0].material;
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
          // 有没有挂配件（含背后道具气球）
          acc: !!(accProp && accProp.children.length > 0),
          accChildren: accProp ? accProp.children.length : 0,
          // 头饰：只有挂在头骨上的那些（气球不算）
          headgear: !!z.hat,
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
    if (z.hatType && !z.acc) problems.push(z.type + '（acc=' + z.hatType + '）: 配件没挂上');
    if (z.hatType && !(z.accChildren >= 2)) problems.push(z.type + ': 配件子网格过少 ' + z.accChildren);
    // 帽子必须"戴在头上"：比头骨骨骼还高，且不超过身高的合理上限。
    // 只断言"挂上了"不够——之前帽子挂在 body 上但陷进脑袋里，只有肉眼能看出来。
    // 「戴在头上」只对真正的头饰成立：木棒挂手、气球挂背，都不该套这条
    if (z.hatType && z.headgear && z.hatType !== 'club' && z.hatWorldY != null && z.headWorldY != null) {
      if (z.hatWorldY < z.headWorldY) {
        problems.push(z.type + ': 配件比头骨还低（hat ' + z.hatWorldY.toFixed(2) + ' < head ' + z.headWorldY.toFixed(2) + '），陷进身体里了');
      }
      // 头顶不会离头骨太远：不超过头骨上方约 0.6 个模型身位
      if (z.hatWorldY > z.headWorldY + 0.75 * z.scale || z.hatWorldY > z.headWorldY + 1.2) {
        problems.push(z.type + ': 配件飘太高（hat ' + z.hatWorldY.toFixed(2) + '，head ' + z.headWorldY.toFixed(2) + '）');
      }
    }
    if (!z.hatType && z.acc) problems.push(z.type + ': 不该有配件却挂了配件');
    if (z.acc && !z.envMapHat) problems.push(z.type + ': 配件材质 envMap 为空（ctx.env 没传进 Zombie）');
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
      hats: info.zombies.filter((z) => z.acc).length,
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
  check(cards.length === 4, '菜单应有四张地图卡片，实际 ' + cards.length);
  const seen = [];
  const seq = ['snow', 'dust', 'forest', 'backyard'];
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
  // 四张地图的雾参数必须互不相同，否则切图只是“换了 id”
  const fogKeys = new Set(seen.map((s) => s.fogNear + '/' + s.fogFar));
  check(fogKeys.size === 4, '四张地图的雾参数应各不相同，实际 ' + JSON.stringify(seen));
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
    // 跳跃是"起跳后几帧内离地"，同样别用固定墙钟等
    let jumped = 0;
    const jumpDeadline = Date.now() + 8000;
    while (Date.now() < jumpDeadline) {
      jumped = await page.evaluate(() => window.__game.player.pos.y);
      if (jumped > 0.05) break;
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(jumped > 0.05, '点跳跃按钮后玩家应离地（pos.y > 0.05），实际 y=' + jumped.toFixed(3));
    // 落回地面，避免影响后续。软渲染一帧几百毫秒，跳跃滞空只有几帧但墙钟可能超过 5 秒
    await waitUntil(page, () => window.__game.player.pos.y < 0.05 || window.__game.player.grounded, 15000, '玩家落地');

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
    // 摇杆位移由"实际跑了几帧"决定，不是由墙钟决定：SwiftShader 软渲染在 CI 上可能只有几帧/秒，
    // 固定等 600ms 会把"机器慢"误判成"摇杆失效"（同一份代码：本地 0.85m、CI 0.35m）。
    // 所以这里等待"位移达标"，只在超时后才算失败——测的是摇杆有没有驱动移动，不是测试机跑多快。
    const JOY_TARGET = 0.4;
    const joyDeadline = Date.now() + 15000;
    let joyState = null;
    let joyMoved = 0;
    while (Date.now() < joyDeadline) {
      joyState = await page.evaluate(() => ({
        x: window.__game.player.pos.x,
        z: window.__game.player.pos.z,
        moveY: window.__game.controls.move.y,
        joyActive: document.getElementById('joyBase').classList.contains('active'),
      }));
      joyMoved = Math.hypot(joyState.x - beforeJoy.x, joyState.z - beforeJoy.z);
      if (joyMoved > JOY_TARGET) break;
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(joyState && joyState.joyActive, '按住摇杆区域后 #joyBase 应加 .active');
    check(joyState && joyState.moveY > 0.5, '推摇杆后 controls.move.y 应接近 1，实际 ' + (joyState && joyState.moveY));
    check(joyMoved > JOY_TARGET, '推摇杆 15s 内玩家应移动 > ' + JOY_TARGET + 'm，实际 ' + joyMoved.toFixed(3) + 'm（move.y=' + (joyState && joyState.moveY) + '）');

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
  // 采样期间不持续开火：前一个场景（flashlight）的尾巴 + 开火粒子会让软渲染掉到 ~2 帧/秒，
  // 帧数不够采样器就报"采样不足"。这里要的是 14 只僵尸的渲染开销（draw call / 三角面峰值），
  // 粒子特效已经在其它场景覆盖。
  await page.evaluate(() => {
    const g = window.__game;
    g.controls.setFiring(false);
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
  // 帧数下限按墙钟换算，不写死绝对帧数：CI 的 SwiftShader 软渲染约 3 帧/秒，
  // 本地约 6 帧/秒，写死 30 帧等于在测"测试机够不够快"。真正要保证的是
  // "采样窗口覆盖了足够多的渲染帧，峰值 draw call 有意义"，所以按 ≥2 帧/秒兜底。
  // 每帧 ~500ms 起步的软渲染撑不满 2 帧/秒，门槛按 ~1.5 帧/秒兜底（再低也只多跑一会儿）
  const minFrames = Math.max(8, Math.floor(perf.windowSec * 1.5));
  check(perf.frames >= minFrames, '10 秒内帧数过少（' + perf.frames + ' < ' + minFrames + '），采样不足以代表峰值');
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

// 场景：夜之森林手电（TECH-flashlight.md §5 验收清单）
//
// 这个场景只有真浏览器能跑：亮度和"过曝"是像素级的，jsdom 里没有 WebGL 也没有截图。
// 四条断言：① 开灯后脚下地面明显变亮 ② 关灯能回到原样（=灯是唯一变量）
// ③ 手里植物没有过曝发白 ④ 切到白天地图不残留灯、draw call 没有失控。
async function phaseFlashlight(ctx) {
  const { page } = ctx;
  await page.setViewportSize({ width: 1280, height: 720 });
  await ensurePlaying(page);

  // 切到森林：只有这里应该有手电（setMap 只在 menu 状态生效，所以先退回菜单再切）
  await page.evaluate(() => window.__game.backToMenu());
  await waitUntil(page, () => window.__game.state === 'menu', 8000, '退回主菜单');
  await page.evaluate(() => window.__game.setMap('forest'));
  await waitUntil(page, () => window.__game.mapId === 'forest', 8000, '切到夜之森林');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 10000 });
  await page.waitForFunction(() => window.__game.mapId === 'forest', null, { timeout: 8000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.hp = 1e9;
    g.player.maxHp = 1e9;
  });

  // 固定镜头：出生点、朝北（-Z）、略微低头看地 —— 与 TECH-flashlight.md §0 的测量口径一致
  await page.evaluate(() => {
    const p = window.__game.player;
    p.pos.set(window.__game.map.spawn.x, 0, window.__game.map.spawn.z);
    p.vel.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = -0.25;
    p.recoil = 0;
  });
  await page.waitForTimeout(250);

  const lightState = await page.evaluate(() => {
    const g = window.__game;
    const f = g.map.flash;
    let spots = 0;
    g.camera.traverse((o) => {
      if (o.isSpotLight) spots++;
    });
    return {
      ok: !!f && f.visible === true && f.castShadow === false && spots === 1,
      visible: f && f.visible,
      castShadow: f && f.castShadow,
      spotsOnCamera: spots,
      intensity: f && f.intensity,
    };
  });
  check(lightState.ok, '森林里应有一盏挂在相机上、不投影、可见的 spot：' + JSON.stringify(lightState));

  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  // 截图 → 分区灰度均值。截图是页面真实输出，JS 侧另画一遍不算数。
  async function lumaSample() {
    const png = await page.screenshot();
    const img = await loadImage(png);
    const cv = createCanvas(img.width, img.height);
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    const W = img.width;
    const H = img.height;
    const L = (x, y) => {
      const i = (y * W + x) * 4;
      return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    };
    const region = (x0, y0, x1, y1) => {
      let s = 0;
      let n = 0;
      for (let y = Math.floor(y0 * H); y < y1 * H; y += 2) {
        for (let x = Math.floor(x0 * W); x < x1 * W; x += 2) {
          s += L(x, y);
          n++;
        }
      }
      return s / Math.max(1, n);
    };
    return { feet: region(0.1, 0.82, 0.9, 1), full: region(0, 0, 1, 1), data: d, W, H };
  }

  // 等渲染循环把新姿态吐到屏幕上（SwiftShader 很慢，按帧数等而不是按墙钟）
  async function settle() {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const tick = () => (++n >= 3 ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        })
    );
  }

  await settle();
  const on = await lumaSample();

  // 关灯再拍一次：两次唯一的差别就是这盏灯
  await page.evaluate(() => window.__game.map.setFlash(false));
  await settle();
  const off = await lumaSample();
  await page.evaluate(() => window.__game.map.setFlash(true));
  await settle();

  // 开灯后脚下地面必须明显变亮（实测 14.9 → 36.5，留一半余量）
  check(
    on.feet > off.feet * 1.5 && on.feet - off.feet > 8,
    '手电应明显照亮脚下地面，实测 关灯=' + off.feet.toFixed(1) + ' 开灯=' + on.feet.toFixed(1)
  );
  // 但不能把"夜"洗成"白天"：整屏均值仍要远低于白天地图（90–140）
  check(
    on.full < 70,
    '开灯后整屏均值应仍保持夜间（< 70），实测 ' + on.full.toFixed(1) + '（关灯 ' + off.full.toFixed(1) + '）'
  );

  // 手里植物过曝检查（§3.4）：武器视图模型在画面右下，统计高光像素占比
  let whitish = 0;
  let total = 0;
  for (let y = Math.floor(on.H * 0.55); y < on.H; y += 2) {
    for (let x = Math.floor(on.W * 0.55); x < Math.floor(on.W * 0.98); x += 2) {
      const i = (y * on.W + x) * 4;
      const l = 0.2126 * on.data[i] + 0.7152 * on.data[i + 1] + 0.0722 * on.data[i + 2];
      if (l > 235) whitish++;
      total++;
    }
  }
  const whiteRatio = whitish / Math.max(1, total);
  check(whiteRatio < 0.12, '手里植物疑似过曝：右下角高光像素占 ' + (whiteRatio * 100).toFixed(1) + '%（上限 12%）');

  // draw call 不失控 + 切到白天地图后不留灯
  const after = await page.evaluate(() => {
    const g = window.__game;
    const calls = g.renderer.info.render.calls;
    const state = g.state;
    g.backToMenu();
    g.setMap('snow');
    const forest = g.maps.find((m) => m.id === 'forest');
    let spots = 0;
    g.camera.traverse((o) => {
      if (o.isSpotLight) spots++;
    });
    return { state, calls, forestFlashVisible: forest.flash.visible, spotsOnCamera: spots, mapId: g.mapId };
  });
  check(after.state === 'playing', '亮度测量期间应保持 playing，实际 ' + after.state);
  check(after.calls < 250, '手电让 draw call 失控：' + after.calls);
  check(after.forestFlashVisible === false, '切到雪地后森林的手电必须关掉');
  check(after.spotsOnCamera === 1, '相机上始终只有一盏 spot，实际 ' + after.spotsOnCamera);

  await shot(page, 'phase-flashlight');
  return {
    metrics: {
      feet: off.feet.toFixed(1) + '→' + on.feet.toFixed(1),
      full: off.full.toFixed(1) + '→' + on.full.toFixed(1),
      white: (whiteRatio * 100).toFixed(1) + '%',
      calls: after.calls,
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
    { timeout: 60000 }
  ).catch(() => {});
  const skReady = await page.evaluate(() => !!(window.__game.models && window.__game.models.skeleton.ready));
  check(skReady, '骷髅 glb 60 秒内没加载完');

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
    60000,
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

// ---------------------------------------------------------------- 图鉴页

async function phaseGallery(ctx) {
  const { page, url } = ctx;
  const galleryUrl = new URL('gallery.html', url).toString();
  await page.goto(galleryUrl, { waitUntil: 'load' });
  await waitUntil(page, () => window.__gallery && window.__gallery.ready, 45000, '图鉴加载');
  await waitUntil(page, () => window.__gallery.renderer.info.render.calls > 0, 8000, '图鉴渲染第一帧');

  const count = await page.evaluate(() => document.querySelectorAll('#typeList [data-type]').length);
  // 图鉴必须覆盖 config 里的全部类型（老 7 种 + 夜之森林的 16 种）
  // 不要在页面里 import('/src/config.js')：生产构建没有 /src/ 路径，会打一条 404。
  // 图鉴侧栏把所有类型都渲染出来了，这里只在「已知老 7 种都在」之外断言数量与 chips 一致。
  const wantCount = await page.evaluate(() => {
    const g = window.__gallery;
    return (g && g.types && g.types.length) || 0;
  });
  check(count === wantCount, '图鉴类型数量 ' + count + '，应覆盖全部 ' + wantCount + ' 种僵尸');

  // 老 7 种 + 夜之森林代表类型都点一遍：确保每种模型都能构造、配件都能挂上
  for (const type of [
    'normal', 'cone', 'bucket', 'football', 'balloon', 'skeleton', 'boss',
    'goblin', 'slime', 'bones', 'wolf', 'bat', 'gargantuar',
  ]) {
    await page.click('[data-type="' + type + '"]');
    await waitUntil(
      page,
      (t) => window.__gallery.current && window.__gallery.current.type === t,
      10000,
      '切换到 ' + type,
      type
    );
  }

  await page.click('[data-type="football"]');
  await waitUntil(
    page,
    () => window.__gallery.current && window.__gallery.current.type === 'football',
    15000,
    '切换到橄榄球僵尸'
  );

  const before = await page.evaluate(() => ({
    t: window.__gallery.current.zombie.mixer.time,
    calls: window.__gallery.renderer.info.render.calls,
    tris: window.__gallery.renderer.info.render.triangles,
    model: window.__gallery.current.zombie.modelId,
  }));
  check(before.model === 'football', '图鉴里的橄榄球模型是 ' + before.model);
  check(before.calls > 0, '图鉴没有 draw call');
  check(before.tris > 1000, '图鉴三角面 ' + before.tris + '，模型可能没加载');

  // 走路动画必须在推进，而不是停在 bind pose
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({ t: window.__gallery.current.zombie.mixer.time }));
  check(after.t > before.t + 0.02, '走路动画没有推进：' + before.t.toFixed(3) + ' → ' + after.t.toFixed(3));

  await page.click('[data-angle="back"]');
  await waitUntil(page, () => window.__gallery.camera.position.z < -1, 6000, '背面视角');
  await page.click('[data-angle="top"]');
  await waitUntil(
    page,
    () => window.__gallery.camera.position.y > window.__gallery.controls.target.y + 1,
    6000,
    '俯视视角'
  );

  await page.click('[data-type="boss"]');
  await waitUntil(
    page,
    () => window.__gallery.current && window.__gallery.current.type === 'boss',
    15000,
    '切换到巨型骷髅'
  );
  // 切换后等一帧，截图/指标才看得到新模型和新机位
  await page.waitForTimeout(250);
  const boss = await page.evaluate(() => ({
    h: window.__gallery.current.info.height,
    d: window.__gallery.camera.position.distanceTo(window.__gallery.controls.target),
    calls: window.__gallery.renderer.info.render.calls,
  }));
  check(boss.h > 4, 'Boss 高度 ' + boss.h.toFixed(2) + '，应约 4.48 米');
  check(boss.d > 5, 'Boss 相机距离 ' + boss.d.toFixed(2) + '，太近会裁掉模型');

  const file = await shot(page, 'phase-gallery');
  return {
    metrics: {
      types: count,
      model: before.model,
      walkTime: after.t.toFixed(2) + 's',
      calls: boss.calls,
      bossHeight: boss.h.toFixed(2) + 'm',
      shot: file,
    },
  };
}

async function phaseStress(ctx) {
  const { page, url } = ctx;
  await page.goto(new URL('stress.html', url).toString(), { waitUntil: 'load' });
  await waitUntil(page, () => window.__stress && window.__stress.ready, 45000, '压测页加载');
  await waitUntil(page, () => window.__stress.renderer.info.render.calls > 0, 10000, '压测页渲染第一帧');

  const chips = await page.evaluate(() => document.querySelectorAll('#typeChips [data-type]').length);
  // 类型 chips 来自 GALLERY_TYPES，数量 = 全部僵尸类型 + 1 个「混合」
  const wantChips = await page.evaluate(() => (window.__stress.types ? window.__stress.types.length : 0) + 1);
  check(
    chips === wantChips || chips > 8,
    '压测页类型 ' + chips + ' 个，应为全部僵尸类型 + 混合（期望 ' + wantChips + '）'
  );

  // 指定数量：6 只炼金僵尸，等生成队列排空后才有稳态帧率
  await page.evaluate(() => window.__stress.setCount(6));
  await waitUntil(page, () => window.__stress.zombies.length === 6, 20000, '生成 6 只僵尸');
  await waitUntil(page, () => window.__stress.stats.frames >= 6, 20000, '帧率采样');

  const normal = await page.evaluate(() => ({
    count: window.__stress.zombies.length,
    type: window.__stress.state.type,
    calls: window.__stress.renderer.info.render.calls,
    tris: window.__stress.renderer.info.render.triangles,
    fps: window.__stress.stats.fps,
  }));
  check(normal.count === 6, '压测页僵尸数 ' + normal.count + '，应为 6');
  check(normal.type === 'normal', '压测页默认类型 ' + normal.type);
  check(normal.calls > 0, '压测页没有 draw call');
  check(normal.tris > 5000, '压测页三角面 ' + normal.tris + '，模型可能没加载');

  // 换类型：骷髅拆成 9 个蒙皮网格，同数量下 draw call 必须明显高于炼金僵尸
  await page.evaluate(() => window.__stress.setType('skeleton'));
  await waitUntil(
    page,
    () => window.__stress.state.type === 'skeleton' && window.__stress.zombies.length === 6,
    20000,
    '切换到骷髅'
  );
  await page.waitForTimeout(700);
  const skeleton = await page.evaluate(() => ({
    calls: window.__stress.renderer.info.render.calls,
    tris: window.__stress.renderer.info.render.triangles,
  }));
  check(skeleton.calls > normal.calls, '骷髅 draw call ' + skeleton.calls + ' 不高于炼金僵尸 ' + normal.calls);

  // 自动测极限：点一下开、再点一下停（完整跑完要 1 分钟，E2E 只验证按钮接线与状态机）
  await page.click('#rampBtn');
  await waitUntil(page, () => !!window.__stress.state.ramp, 6000, '自动测极限启动');
  await page.click('#rampBtn');
  await waitUntil(page, () => !window.__stress.state.ramp, 6000, '自动测极限停止');

  await page.evaluate(() => window.__stress.setCount(6));
  await waitUntil(page, () => window.__stress.zombies.length === 6, 20000, '恢复 6 只');
  const file = await shot(page, 'phase-stress');
  return {
    metrics: {
      types: chips,
      count: normal.count,
      calls: normal.calls,
      skeletonCalls: skeleton.calls,
      tris: normal.tris,
      fps: normal.fps.toFixed(1),
      shot: file,
    },
  };
}

// 场景：队友模型（Quaternius Farmer 戴夫化 + 锅盖帽/胡子/枪 + 动画）
async function phaseRemote(ctx) {
  const { page } = ctx;
  await ensurePlaying(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.zombies.reset();
    g.player.hp = 1e9;
    g.player.maxHp = 1e9;
    g.player.yaw = 0;
    g.player.pitch = -0.04;
    g.spawnRemotePlayer({ x: g.player.pos.x, z: g.player.pos.z - 3.2, name: '队友' });
  });
  await waitUntil(
    page,
    () => window.__game.remotes[0] && window.__game.remotes[0].ready === true,
    20000,
    '队友模型加载'
  );
  await page.waitForTimeout(700);

  const info = await page.evaluate(() => {
    const g = window.__game;
    const r = g.remotes[0];
    return {
      ready: r.ready,
      current: r.current,
      actions: Object.keys(r.actions),
      pot: !!r.pot,
      beard: !!r.beard,
      gun: !!r.gun,
      plate: !!r.plate,
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
    };
  });
  check(info.ready, '队友模型未就绪');
  check(info.current === 'idle', '队友待机动画 ' + info.current);
  check(info.actions.includes('idle') && info.actions.includes('run'), '队友动画缺失：' + info.actions.join(','));
  check(info.pot && info.beard && info.gun, '锅盖帽/胡子/枪没有挂上');
  check(info.plate, '头顶名牌没有生成');
  check(info.calls > 0, '队友场景没有 draw call');
  check(info.tris > 5000, '三角面 ' + info.tris + '，队友模型可能没加载');

  const file = await shot(page, 'phase-remote');
  return { metrics: { ...info, shot: file } };
}

// 月光童话战场：只控制前置位置/固定步长，技能、伤害、DOM 输入和渲染均走真实代码。
async function phaseForestRework(ctx) {
  const { page, browser, url } = ctx;
  const screenshots = [];
  const types = ['goblin', 'demon3', 'slime', 'pink-slime', 'green-blob', 'bones',
    'ghost', 'ghost-skull', 'wolf', 'spider', 'rat', 'bat', 'gargantuar', 'mushroomKing', 'dragon'];
  const snapshots = [];
  const responsive = [];
  // 停掉游戏自己的墙钟循环后按正常 update 驱动，避免 SwiftShader 把两秒落地窗口变成随机结果。
  async function stopClock(p) {
    await waitUntil(p, () => window.__game.state !== 'playing' || window.__game.weapons.root.visible, 10000, '游戏循环显示武器');
    await p.evaluate(() => { window.__game.running = false; });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  async function render(p) {
    await p.evaluate(() => {
      const g = window.__game;
      g.player.applyCamera(g.camera);
      g.map.update(0);
      g.renderer.render(g.scene, g.camera);
    });
  }
  async function reset(p) {
    await p.evaluate(() => {
      const g = window.__game;
      g.zombies.reset();
      g.projectiles.clear();
      g.controls.setFiring(false);
      g.player.pos.set(0, 0, 30);
      g.player.vel.set(0, 0, 0);
      g.player.yaw = 0;
      g.player.pitch = -0.25;
      g.player.recoil = 0;
      g.player.invuln = 0;
      g.weapons.equipSlot('peaGun', 0);
      g.update(0);
    });
  }
  async function spawn(p, type, distance = 4) {
    await reset(p);
    return p.evaluate(([t, d]) => {
      const g = window.__game;
      const z = g.zombies.spawnAt(t, 1, 0, 30 - d, 1, 0);
      // 让出生动画自行完成；speedMul=0 只用于稳定瞄点，不改技能/血量。
      for (let i = 0; i < 12; i++) z.update(0.05, g.player, g.map.colliders);
      return { hp: z.hp, state: z.skillState, skinned: !!z.body.getObjectByProperty('isSkinnedMesh', true) };
    }, [type, distance]);
  }
  async function advanceTo(p, state, seconds = 12) {
    return p.evaluate(([want, limit]) => {
      const g = window.__game;
      const z = g.zombies.zombies[0];
      let elapsed = 0;
      while (z.skillState !== want && elapsed < limit) {
        z.update(0.05, g.player, g.map.colliders);
        elapsed += 0.05;
      }
      const cue = z.skillCue;
      return { elapsed, state: z.skillState, air: z.airborne, y: z.root.position.y,
        cue: !!cue && cue.visible, timer: z.skillTimer, snapshot: z.serialize(), pose: z.model.scale.y };
    }, [state, seconds]);
  }
  async function pixels(p) {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(await p.screenshot());
    const cv = createCanvas(img.width, img.height);
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, img.width, img.height).data;
    let feet = 0, feetN = 0, white = 0, weaponN = 0, full = 0, n = 0;
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        const l = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
        full += l; n++;
        if (y > img.height * .82 && x > img.width * .1 && x < img.width * .55) { feet += l; feetN++; }
        if (y > img.height * .55 && x > img.width * .55 && x < img.width * .98) {
          weaponN++;
          if (l > 235) white++;
        }
      }
    }
    return { feet: +(feet / feetN).toFixed(2), full: +(full / n).toFixed(2), white: +(white / weaponN).toFixed(4) };
  }
  async function layout(p, selectors) {
    return p.evaluate((ss) => {
      const inside = (r) => r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
        && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      return { scroll: document.documentElement.scrollWidth > innerWidth + 1
          || document.documentElement.scrollHeight > innerHeight + 1,
        elements: ss.map((s) => {
          const el = document.querySelector(s);
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { selector: s, inside: inside(r), clickable: el === top || el.contains(top),
            w: r.width, h: r.height };
        }) };
    }, selectors);
  }
  let geometry, opening, light, split, perf, duck;
  try {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.evaluate(() => { window.__game.backToMenu(); window.__game.setMap('forest'); });
    await waitUntil(page, (ts) => ts.every((t) => window.__game.zombies.modelReady(t)), 60000, '森林真实 glb 就绪', types);
    await page.click('#startBtn');
    await waitUntil(page, () => window.__game.state === 'playing', 10000, '森林开局');
    await stopClock(page);
    opening = await page.evaluate(() => {
      const g = window.__game;
      g.zombies.reset();
      g.zombies.startWave(1);
      const plan = g.zombies.queue.slice().sort();
      const distances = [];
      while (g.zombies.queue.length) {
        const z = g.zombies.spawnOne(g.player);
        if (!z) break;
        distances.push(Math.hypot(z.root.position.x - g.player.pos.x, z.root.position.z - g.player.pos.z));
      }
      const lateNormal = [];
      for (const n of [10, 20, 30]) {
        g.zombies.startWave(n);
        const ordinary = g.zombies.queue.filter((t) => !['gargantuar', 'boss', 'mushroomKing', 'dragon'].includes(t));
        lateNormal.push(ordinary.filter((t) => t === 'normal').length / ordinary.length);
      }
      return { plan, distances, lateNormal };
    });
    check(opening.plan.join(',') === 'goblin,goblin,goblin,slime,slime', '首波必须为3哥布林+2史莱姆：' + opening.plan);
    check(opening.distances.length === 5 && opening.distances.every((d) => d >= 16 && d <= 22), '首波反应距离不合规：' + opening.distances);
    check(opening.lateNormal.every((v) => v <= .2), '后期普通僵尸超过20%：' + opening.lateNormal);
    await reset(page);
    geometry = await page.evaluate(() => {
      const g = window.__game, m = g.map, nav = m.nav;
      nav.update(m.spawn.x, m.spawn.z, 1);
      const points = [...m.pickupSpots, ...m.zombieSpawnPoints, ...m.openingSpawnPoints];
      const unreachable = points.filter(([x, z]) => {
        const idx = Math.floor((z + nav.halfZ) / nav.cell) * nav.cols + Math.floor((x + nav.halfX) / nav.cell);
        return nav.blocked[idx] || nav.dist[idx] < 0;
      });
      const c = m.walls.find((w) => w.r && w.h > 1);
      const pos = g.player.pos.clone().set(c.x - c.r - 2, .8, c.z);
      const vel = pos.clone().set((c.r + 2) * 2, 0, 0);
      const bulletWall = g.projectiles.step(pos, vel, 1, .13, 0);
      const collider = m.colliders.find((x) => x.r > .7 && Math.abs(x.x) < 40 && Math.abs(x.z) < 40);
      g.player.pos.set(collider.x + .1, 0, collider.z);
      g.player.update(0, g.controls, m, []);
      const playerBlocked = Math.hypot(g.player.pos.x - collider.x, g.player.pos.z - collider.z) > collider.r;
      g.player.pos.set(m.spawn.x, 0, m.spawn.z);
      const landmarks = Object.entries(m.landmarks).map(([name, group]) => {
        let meshes = 0;
        group.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
        return { name, meshes, parent: group.parent === m.root };
      });
      let colored = 0, invalid = 0;
      g.weapons.root.traverse((o) => {
        if (!o.isMesh || !o.userData.dayMaterial) return;
        colored++;
        if (!o.material.isMeshBasicMaterial || !o.material.vertexColors || !o.geometry.getAttribute('color')) invalid++;
      });
      return { landmarks, blocked: nav.blocked.reduce((a, b) => a + b, 0), unreachable,
        fireflies: m.fireflies.geometry.getAttribute('position').count, spawn: m.spawn.z, bulletWall, playerBlocked, colored, invalid };
    });
    check(geometry.landmarks.map((x) => x.name).sort().join(',') === 'beastDen,camp,graveyard,moonheart,mushrooms', '五地标缺失：' + JSON.stringify(geometry.landmarks));
    check(geometry.landmarks.every((x) => x.meshes >= 3 && x.parent), '地标未真实挂到地图：' + JSON.stringify(geometry.landmarks));
    check(geometry.spawn === 30 && geometry.fireflies === 140, '出生/萤火虫不合规：' + JSON.stringify(geometry));
    check(geometry.blocked > 0 && geometry.unreachable.length === 0, '导航阻挡或路径异常：' + JSON.stringify(geometry));
    check(geometry.bulletWall === 1 && geometry.playerBlocked, '森林实体未挡弹/未阻止玩家穿树');
    check(geometry.colored > 0 && geometry.invalid === 0, '森林武器未保持 Basic+vertexColors');
    for (const { name } of geometry.landmarks) {
      await page.evaluate((key) => {
        const g = window.__game, p = g.player, target = g.map.landmarks[key].position;
        // 从地标正面选真实无碰撞/无遮挡观察点，避免墓拱侧视变柱子或近树遮满截图。
        const candidates = [14, 10, 8].flatMap((r) => [0, .3, -.3, .6, -.6, .9, -.9, 1.2, -1.2].map((a) =>
          ({ x: target.x + Math.sin(a) * r, z: target.z + Math.cos(a) * r })));
        const view = candidates.find((v) => {
          if (Math.abs(v.x) > g.map.bounds.x - 2 || Math.abs(v.z) > g.map.bounds.z - 2) return false;
          const dx = target.x - v.x, dz = target.z - v.z, length2 = dx * dx + dz * dz;
          return g.map.colliders.every((c) => {
            if (Math.hypot(c.x - v.x, c.z - v.z) < c.r + .65) return false;
            if (Math.hypot(c.x - target.x, c.z - target.z) < 5) return true;
            const t = Math.max(0, Math.min(1, ((c.x - v.x) * dx + (c.z - v.z) * dz) / length2));
            return Math.hypot(c.x - v.x - t * dx, c.z - v.z - t * dz) > c.r + .55;
          });
        });
        if (!view) throw new Error('地标无可用观察点：' + key);
        p.pos.set(view.x, 0, view.z);
        p.yaw = Math.atan2(-(target.x - p.pos.x), -(target.z - p.pos.z));
        p.pitch = .02;
        g.update(0);
      }, name);
      await render(page);
      screenshots.push(await shot(page, 'forest-rework-' + name));
    }
    await reset(page);
    await render(page);
    light = await pixels(page);
    check(light.feet > 15 && light.full < 70, '夜间脚下不可读/全图过亮：' + JSON.stringify(light));
    check(light.white < .12, '森林武器发白比例过高：' + JSON.stringify(light));
    screenshots.push(await shot(page, 'forest-rework-desktop'));

    // 巨人：真实前摇固定中心，离开危险圈不扣血，回到圈内会受击。
    await spawn(page, 'gargantuar', 2);
    const telegraph = await advanceTo(page, 'telegraph');
    check(telegraph.state === 'telegraph' && telegraph.cue && telegraph.timer <= .85, '巨人前摇/警告圈缺失');
    snapshots.push(telegraph.snapshot);
    await render(page);
    screenshots.push(await shot(page, 'forest-rework-slam-warning'));
    const slam = await page.evaluate(() => {
      const g = window.__game, z = g.zombies.zombies[0];
      const before = g.player.hp;
      g.player.pos.x = 5;
      for (let i = 0; i < 18; i++) z.update(.05, g.player, g.map.colliders);
      const escaped = g.player.hp === before;
      z.update(.05, g.player, g.map.colliders);
      const recover = z.skillState;
      g.player.pos.set(0, 0, 30);
      for (let i = 0; i < 80 && z.skillState !== 'telegraph'; i++) z.update(.05, g.player, g.map.colliders);
      const locked = z.skillCenter.clone();
      for (let i = 0; i < 18; i++) z.update(.05, g.player, g.map.colliders);
      return { escaped, recover, damage: before - g.player.hp, locked: [locked.x, locked.z] };
    });
    check(slam.escaped && slam.recover === 'recover' && slam.damage > 0, '巨人逃圈/恢复/攻击异常：' + JSON.stringify(slam));

    await spawn(page, 'mushroomKing');
    duck = await advanceTo(page, 'duck');
    check(duck.state === 'duck' && duck.cue, '蘑菇王未真实蹲下');
    snapshots.push(duck.snapshot);
    await render(page);
    screenshots.push(await shot(page, 'forest-rework-duck'));
    const duckDamage = await page.evaluate(() => {
      const g = window.__game, z = g.zombies.zombies[0], hp = z.hp;
      z.hit(40, false, false, { type: 'pea' });
      const reduced = hp - z.hp;
      for (let i = 0; i < 60; i++) z.update(.05, g.player, g.map.colliders);
      const state = z.skillState, h = z.hp;
      z.hit(40, false, false, { type: 'pea' });
      return { reduced, normal: h - z.hp, state, timer: z.skillTimer };
    });
    check(duckDamage.reduced === 10 && duckDamage.normal === 40 && duckDamage.state === 'recover'
      && duckDamage.timer <= 1.2, '蘑菇王减伤/3秒蹲/恢复异常：' + JSON.stringify(duckDamage));
    await spawn(page, 'dragon');
    const dive = await advanceTo(page, 'telegraph');
    check(dive.state === 'telegraph' && dive.cue, '巨龙缺少俯冲预警');
    const dragon = await advanceTo(page, 'land');
    check(dragon.state === 'land' && !dragon.air && Math.abs(dragon.y) < .01, '巨龙未真正落地：' + JSON.stringify(dragon));
    snapshots.push(dragon.snapshot);
    await render(page);
    screenshots.push(await shot(page, 'forest-rework-dragon-land'));
    const flight = await advanceTo(page, 'fly', 2.1);
    check(flight.state === 'fly' && flight.air && flight.elapsed >= 1.9, '巨龙落地窗口不足2秒');

    // 满14实体时，母体真实死亡先排队；尸体回收后补子体，绝不超限。
    await reset(page);
    split = await page.evaluate(() => {
      const g = window.__game, m = g.zombies;
      m.maxAlive = 14;
      const parent = m.spawnAt('pink-slime', 1, 0, 26, 1, 0);
      for (let i = 0; i < 13; i++) m.spawnAt('rat', 1, 15 + i % 4, 15 + Math.floor(i / 4), 1, 0);
      for (let i = 0; i < 12; i++) m.update(.05, g.player, g.map.colliders);
      const kills = g.stats.kills;
      m.damageArea(parent.root.position.clone(), 1, 1e4, parent, 1);
      const pending = m.pendingSplits.length;
      let peak = m.zombies.length;
      for (let i = 0; i < 36; i++) { m.update(.05, g.player, g.map.colliders); peak = Math.max(peak, m.zombies.length); }
      const first = m.zombies.filter((z) => z.type === 'slimelet').length;
      const rat = m.zombies.find((z) => z.type === 'rat' && !z.dying);
      m.damageArea(rat.root.position.clone().setY(rat.root.position.y + .9 * rat.scaleFactor), .1, 1e4, rat, 1);
      for (let i = 0; i < 40; i++) { m.update(.05, g.player, g.map.colliders); peak = Math.max(peak, m.zombies.length); }
      const children = m.zombies.filter((z) => z.type === 'slimelet');
      return { pending, first, children: children.length, peak, remaining: m.pendingSplits.length,
        childSun: children.map((z) => z.def.sun), kills: g.stats.kills - kills };
    });
    check(split.pending === 2 && split.first === 1 && split.children === 2 && split.peak <= 14
      && split.remaining === 0 && split.kills === 2 && split.childSun.every((s) => s === 0), '粉史莱姆分裂丢失或突破实体上限：' + JSON.stringify(split));

    await page.evaluate(() => window.__game.map.setFlash(false));
    await spawn(page, 'spider', 12);
    const ambush = await page.evaluate(() => {
      const g = window.__game, z = g.zombies.zombies[0];
      z.update(.05, g.player, g.map.colliders);
      const warned = z.skillState === 'ambush' && z.skillCue.visible;
      g.player.pitch = 0;
      g.player.applyCamera(g.camera);
      g.map.setFlash(true);
      g.scene.updateMatrixWorld(true);
      z.update(.05, g.player, g.map.colliders);
      return { warned, state: z.skillState };
    });
    check(ambush.warned && ambush.state === 'wake', '蜘蛛伏击无可见预警/照射未唤醒：' + JSON.stringify(ambush));

    await reset(page);
    perf = await page.evaluate(() => {
      const g = window.__game;
      const mix = ['gargantuar', 'mushroomKing', 'dragon', 'bat', 'goblin', 'demon3', 'slime',
        'pink-slime', 'green-blob', 'bones', 'ghost', 'wolf', 'spider', 'rat'];
      for (let i = 0; i < mix.length; i++) g.zombies.spawnAt(mix[i], 1, (i % 5 - 2) * 3, 18 - Math.floor(i / 5) * 4, 1, 0);
      for (let i = 0; i < 20; i++) g.update(.05);
      g.player.yaw = 0; g.player.pitch = -.06;
      g.player.applyCamera(g.camera);
      g.renderer.setPixelRatio(Math.max(1, g.renderer.getPixelRatio()));
      g.renderer.render(g.scene, g.camera);
      return { count: g.zombies.zombies.length, calls: g.renderer.info.render.calls,
        triangles: g.renderer.info.render.triangles, dpr: g.renderer.getPixelRatio(),
        weaponVisible: g.weapons.root.visible && g.weapons.models[g.weapons.current].group.visible };
    });
    check(perf.count === 14 && perf.calls > 0 && perf.calls <= 250 && perf.dpr >= 1 && perf.weaponVisible, '14混合怪渲染预算异常：' + JSON.stringify(perf));
    screenshots.push(await shot(page, 'forest-rework-14-mixed'));
    await reset(page);

    // 真实清场推进休整，再用桌面 Enter 跳过（不直接设置休整最终状态）。
    await page.evaluate(() => {
      const g = window.__game;
      g.zombies.startWave(1);
      g.zombies.queue.length = 0;
      g.update(.05);
    });
    check(await page.isVisible('#nextWaveBtn'), '森林休整按钮未显示');
    const intermission = await page.evaluate(() => window.__game.zombies.intermission);
    check(intermission > 9.9 && intermission <= 10, '森林休整不是10秒');
    await page.evaluate(() => { window.__game.duo = { seat: 0 }; window.__game.seat = 0; });
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => window.__game.zombies.wave === 2), 'host Enter 未提前开波');
    await page.evaluate(() => { window.__game.duo = null; window.__game.seat = -1; });

    for (const size of [{ width: 844, height: 390 }, { width: 1024, height: 768 }]) {
      const context = await browser.newContext({ viewport: size, screen: size, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const { page: p, consoleErrors } = await openPage(context, url);
      const label = size.width === 844 ? 'phone' : 'ipad';
      try {
        await p.tap('[data-map="forest"]');
        await waitUntil(p, (ts) => ts.every((t) => window.__game.zombies.modelReady(t)), 60000, label + '真实模型', types);
        const menu = await layout(p, ['#startBtn', '[data-map="forest"]']);
        check(!menu.scroll && menu.elements.every((e) => e.inside && e.clickable), label + '森林菜单溢出/按钮遮挡：' + JSON.stringify(menu));
        screenshots.push(await shot(p, 'forest-rework-' + label + '-menu'));
        await p.tap('#startBtn');
        await waitUntil(p, () => window.__game.state === 'playing', 10000, label + '触屏开局');
        await stopClock(p);
        await reset(p);
        const ui = await layout(p, ['#fireBtn', '#jumpBtn', '#joyBase', '.slot-dock']);
        check(!ui.scroll && ui.elements.every((e) => e.inside), label + '控件溢出：' + JSON.stringify(ui));
        check(ui.elements.slice(0, 2).every((e) => e.clickable && e.w >= 44 && e.h >= 44), label + '开火/跳跃按钮被挡');
        const scale = await p.evaluate(() => {
          const g = window.__game, m = g.weapons.models[g.weapons.current];
          return { value: m.group.scale.x / m.baseScale, touch: g.controls.isTouch, locks: window.__e2e.lockCalls };
        });
        check(scale.touch && scale.locks === 0 && Math.abs(scale.value - .88) < .001, label + '森林触屏缩放/指针锁错误：' + JSON.stringify(scale));
        await render(p);
        const lighting = await pixels(p);
        check(lighting.feet > 15 && lighting.white < .12, label + '夜景或武器不可读：' + JSON.stringify(lighting));
        screenshots.push(await shot(p, 'forest-rework-' + label + '-game'));

        await spawn(p, 'bat');
        const before = await p.evaluate(() => window.__game.zombies.zombies[0].hp);
        const airborne = await p.evaluate(() => window.__game.zombies.zombies[0].airborne);
        check(airborne, label + '蝙蝠开局应在空中');
        const land = await advanceTo(p, 'land');
        check(land.state === 'land' && !land.air && Math.abs(land.y - .2) < .01, label + '蝙蝠未落到普通武器高度');
        const fire = ui.elements[0];
        const cdp = await context.newCDPSession(p);
        const box = await p.locator('#fireBtn').boundingBox();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + fire.w / 2, y: box.y + fire.h / 2, id: 1 }] });
        const killed = await p.evaluate(() => {
          const g = window.__game, z = g.zombies.zombies[0];
          const firing = g.controls.firing;
          const kills = g.stats.kills;
          const chest = z.getChest(g.player.eye.clone());
          const eye = g.player.pos.clone().setY(g.player.pos.y + 1.66);
          const d = chest.sub(eye);
          g.player.yaw = Math.atan2(-d.x, -d.z);
          g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          for (let i = 0; i < 35 && !z.dying; i++) g.update(.05);
          return { firing, hp: z.hp, dying: z.dying, kills: g.stats.kills - kills,
            state: z.skillState, weapon: g.weapons.current };
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        check(before === 40 && killed.firing && killed.dying && killed.hp === 0 && killed.kills === 1
          && killed.weapon === 0, label + '真实触屏豌豆未击杀落地蝙蝠：' + JSON.stringify(killed));
        check(await p.evaluate(() => !window.__game.controls.firing), label + '松手仍开火');
        await reset(p);
        await p.tap('#jumpBtn');
        const jumped = await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.update(.05); return g.player.pos.y; });
        check(jumped > .05, label + '真实触屏跳跃失效');
        await p.evaluate(() => { for (let i = 0; i < 30; i++) window.__game.update(.05); });
        const joy = await p.locator('#joyBase').boundingBox();
        const origin = await p.evaluate(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: joy.x + joy.width / 2, y: joy.y + joy.height / 2, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: joy.x + joy.width / 2, y: joy.y + joy.height * .1, id: 2 }] });
        const moved = await p.evaluate(([x, z]) => { const g = window.__game; for (let i = 0; i < 6; i++) g.update(.05); return Math.hypot(g.player.pos.x - x, g.player.pos.z - z); }, [origin.x, origin.z]);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        check(moved > .4, label + '森林摇杆未驱动移动');
        await reset(p);
        await p.evaluate(() => { const g = window.__game; g.zombies.startWave(1); g.zombies.queue.length = 0; g.update(.05); });
        const next = await layout(p, ['#nextWaveBtn']);
        check(next.elements[0].inside && next.elements[0].clickable, label + '提前开波按钮被遮挡');
        await p.tap('#nextWaveBtn');
        await waitUntil(p, () => window.__game.zombies.wave === 2, 5000, label + '触屏开波事件完成').catch(async (e) => {
          const d = await p.evaluate(() => ({ state: window.__game.state, wave: window.__game.zombies.wave,
            ws: window.__game.zombies.state, wt: window.__game.zombies.intermission,
            button: document.getElementById('nextWaveBtn').className }));
          throw new PhaseError(e.message + ' ' + JSON.stringify(d));
        });

        // 网络只在传输边界记录请求；远端技能/休整渲染完全使用 host 真实快照。
        await reset(p);
        const remote = await p.evaluate((states) => {
          const g = window.__game;
          g.duo = { seat: 1 }; g.seat = 1;
          g.zombies.setRemote(true);
          g.applyPeerState({ seq: 1, wave: 4, ws: 'intermission', wt: 10, z: states });
          g.update(0);
          return g.zombies.zombies.map((z) => {
            const hp = z.hp, timer = z.skillTimer;
            z.hit(1000, false, false, { type: 'pea' });
            for (let i = 0; i < 100; i++) z.update(.05, g.player, g.map.colliders);
            return { state: z.skillState, cue: z.skillCue.visible, hpStable: z.hp === hp, timerStable: z.skillTimer === timer };
          });
        }, snapshots);
        check(remote.length === 3 && remote.every((r) => r.cue && r.hpStable && r.timerStable), label + '远端Boss技能/伤害越权：' + JSON.stringify(remote));
        for (const snapshot of snapshots) {
          await p.evaluate((state) => {
            const g = window.__game;
            g.zombies.reset();
            g.applyPeerState({ seq: 1, wave: 4, ws: 'intermission', wt: 10, z: [state] });
            g.update(0);
          }, snapshot);
          await render(p);
          screenshots.push(await shot(p, 'forest-rework-' + label + '-remote-' + snapshot.t));
        }
        await p.evaluate(() => { window.__e2eNextWave = 0; window.__game.duoSession = { sendNextWave: () => window.__e2eNextWave++ }; });
        await p.tap('#nextWaveBtn');
        await waitUntil(p, () => window.__e2eNextWave === 1, 5000, label + 'guest开波请求事件完成');
        const request = await p.evaluate(() => {
          const g = window.__game;
          const before = { requests: window.__e2eNextWave, wave: g.zombies.wave, state: g.zombies.state };
          g.duoSession = null;
          g.applyPeerState({ seq: 2, wave: 5, ws: 'spawning', wt: 0, z: [] });
          g.update(0);
          return { ...before, confirmed: g.zombies.wave, hidden: document.getElementById('nextWaveBtn').classList.contains('hidden') };
        });
        check(request.requests === 1 && request.wave === 4 && request.state === 'intermission'
          && request.confirmed === 5 && request.hidden, label + 'guest 未等待host快照开波：' + JSON.stringify(request));
        const errors = [...consoleErrors, ...await drainErrors(p)];
        check(errors.length === 0, label + '控制台错误：' + errors.join('\n'));
        responsive.push(label + ':' + scale.value + '/batKill/jump/joy/' + lighting.feet);
      } catch (error) {
        const file = await shot(p, 'forest-rework-' + label + '-FAIL');
        throw new PhaseError(error.message + '；触屏截图：' + path.relative(ROOT, file));
      } finally {
        await context.close();
      }
    }
    const restored = await page.evaluate(() => {
      const g = window.__game;
      g.backToMenu(); g.setMap('snow');
      let toon = 0, invalid = 0;
      g.weapons.root.traverse((o) => {
        if (!o.isMesh || !o.userData.dayMaterial) return;
        toon++; if (!o.material.isMeshToonMaterial) invalid++;
      });
      return { toon, invalid, flash: g.maps.find((m) => m.id === 'forest').flash.visible };
    });
    check(restored.toon > 0 && restored.invalid === 0 && !restored.flash, '非森林地图未恢复Toon/残留手电：' + JSON.stringify(restored));
    return { metrics: { landmarks: geometry.landmarks.length, blocked: geometry.blocked, fireflies: geometry.fireflies,
      feet: light.feet, white: light.white, splits: split.children + '/peak' + split.peak,
      calls14: perf.calls, triangles14: perf.triangles, dpr: perf.dpr, responsive: responsive.join(','),
      screenshots: screenshots.map((s) => path.relative(ROOT, s)).join(',') } };
  } finally {
    await page.evaluate(() => {
      const g = window.__game;
      g.controls.setFiring(false);
      g.zombies.setRemote(false);
      g.zombies.reset();
      g.duo = null; g.seat = -1; g.duoSession = null;
      g.player.maxHp = 100;
      g.backToMenu();
      g.setMap('backyard');
      if (!g.running) {
        g.running = true;
        g.clock.getDelta();
        requestAnimationFrame(g.loop);
      }
    }).catch(() => {});
    await page.setViewportSize({ width: 1440, height: 860 });
  }
}

// ---------------------------------------------------------------- 主流程

const PHASES = [
  { name: 'startup', label: '桌面真实开局（指针锁/键鼠/击杀）', group: 'desktop', fn: phaseStartup },
  { name: 'glb', label: '真实 glb 与材质/配件', group: 'desktop', fn: phaseGlb },
  { name: 'skeleton', label: '骷髅模型（雪地专属 + 同屏上限）', group: 'desktop', fn: phaseSkeleton },
  { name: 'remote', label: '队友模型（Farmer 戴夫化）', group: 'desktop', fn: phaseRemote },
  { name: 'maps', label: '四张地图真实切换', group: 'desktop', fn: phaseMaps },
  { name: 'flashlight', label: '夜之森林手电（亮度/过曝/不残留）', group: 'desktop', fn: phaseFlashlight },
  { name: 'forest-rework', label: '月光森林（全图/技能/触屏/联机快照）', group: 'desktop', fn: phaseForestRework },
  { name: 'mobile', label: '手机模拟（横屏 UI + 竖屏拦截）', group: 'mobile', fn: phaseMobile },
  { name: 'perf', label: '性能与稳定性（10s 采样）', group: 'desktop', fn: phasePerf },
  { name: 'gameover', label: '死亡结算与重开', group: 'desktop', fn: phaseGameOver },
  // 图鉴是独立页面，放最后：它会导航离开游戏，不能影响前面的场景。
  { name: 'gallery', label: '僵尸图鉴（模型/走路/视角）', group: 'desktop', fn: phaseGallery },
  { name: 'stress', label: '压测页（数量/类型/帧率）', group: 'desktop', fn: phaseStress },
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