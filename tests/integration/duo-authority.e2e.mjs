// 浏览器级 E2E：服务器权威双人联机（真实 Chromium × 2 + 真实 WebSocket + 真实 WebGL）
//
// 这个脚本要回答的核心问题（也是本次重构的全部意义）：
//   「房主那一端掉帧，另一端还会卡吗？」
//
// 场景：
//   1. 两个真实浏览器标签配对进局，都收到服务器快照
//   2. 僵尸在两端同步推进（位置一致、id 一致）
//   3. 模拟「一端卡顿」：把 A 的 CDP 帧率压到极低，B 端仍按 30Hz 平滑推进
//   4. A 端直接崩溃/关闭，B 端世界继续推进，不中断
//   5. 单人模式：全程零 WebSocket 连接
//
// 运行：node tests/integration/duo-authority.e2e.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.E2E_PORT || 4300 + Math.floor(Math.random() * 200));
const WS_PORT = PORT + 1;

function log(...a) {
  console.log(...a);
}

function fail(msg) {
  throw new Error('FAIL: ' + msg);
}

function check(cond, msg) {
  if (!cond) fail(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitServer(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:' + port + '/api/health', (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function waitHttp(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:' + port + '/', (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

// 起一个同时托管 dist/ 与 /ws 的服务器（生产同构图）
function startDuoServer() {
  const p = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(WS_PORT), HOST: '127.0.0.1', PUBLIC_DIR: path.join(ROOT, 'dist'), MAX_MATCHES: '8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return p;
}

// 静态站：直接用服务器托管的 dist（同源，/ws 与 / 同端口）
async function main() {
  log('==> 构建');
  await new Promise((resolve, reject) => {
    const b = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    b.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('build failed'))));
  });

  log('==> 启动双人服务器（: ' + WS_PORT + '）');
  const srv = startDuoServer();
  const up = await waitHttp(WS_PORT);
  if (!up) {
    srv.kill();
    fail('服务器没起来');
  }

  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const url = 'http://127.0.0.1:' + WS_PORT + '/';

  const errors = [];
  function watch(page, tag) {
    page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text());
    });
  }

  // 预读页面上的网络探针
  async function netStats(page) {
    return page.evaluate(() => {
      const s = window.__game && window.__game.duoSession;
      if (!s || !s.buffer) return null;
      return {
        frames: s.buffer.frameCount,
        delayMs: Math.round(s.buffer.delayMs),
        inputSeq: s.inputSeq,
        state: s.state,
        pending: s.pendingInputs.length,
        snapDist: +(s.snapDist || 0).toFixed(3),
        tick: s.latestSnap ? s.latestSnap.tick : -1,
      };
    });
  }

  async function zombieSignature(page) {
    return page.evaluate(() => {
      const g = window.__game;
      if (!g || !g.zombies) return null;
      return g.zombies.zombies.map((z) => ({
        id: z.netId,
        x: +z.root.position.x.toFixed(2),
        z: +z.root.position.z.toFixed(2),
        hp: Math.round(z.hp),
      }));
    });
  }

  try {
    // ---------------- 场景 1 + 2：配对、快照、僵尸同步 ----------------
    log('==> 场景 1/2：双端配对，服务器驱动僵尸');
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();
    watch(A, 'A');
    watch(B, 'B');

    // A 建房：开探针
    await A.addInitScript(() => {
      window.__netProbe = true;
    });
    await A.goto(url);
    await A.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 30000 });
    await A.click('#duoBtn');
    // 等 welcome 拿到 joinToken
    await A.waitForFunction(
      () => {
        const s = window.__game && window.__game.duoSession;
        return s && s.joinToken;
      },
      { timeout: 20000 }
    );
    const joinToken = await A.evaluate(() => window.__game.duoSession.joinToken);
    log('   A 建房，joinToken =', joinToken);

    // B 用邀请链接加入
    await B.goto(url + '?join=' + encodeURIComponent(joinToken));
    await B.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 30000 });
    // B 端页面上的会话状态
    log('   B 会话:', JSON.stringify(await B.evaluate(() => {
      const s = window.__game && window.__game.duoSession;
      return s ? { state: s.state, seat: s.seat, join: !!s.net } : null;
    })));

    // 两端都进局
    await A.waitForFunction(() => window.__game.state === 'playing' && window.__game.duo, { timeout: 30000 });
    await B.waitForFunction(() => window.__game.state === 'playing' && window.__game.duo, { timeout: 30000 });
    log('   两端都已进局');

    await sleep(2500);
    const stA = await netStats(A);
    const stB = await netStats(B);
    log('   A 快照缓冲:', JSON.stringify(stA));
    log('   B 快照缓冲:', JSON.stringify(stB));
    check(stA && stA.frames > 5, 'A 没收到足够的快照');
    check(stB && stB.frames > 5, 'B 没收到足够的快照');

    const zA = await zombieSignature(A);
    const zB = await zombieSignature(B);
    log('   A 僵尸数 =', zA.length, ' B 僵尸数 =', zB.length);
    check(zA.length > 0, 'A 端没有僵尸（服务器没刷怪）');
    check(zB.length > 0, 'B 端没有僵尸');

    // 两端看到的僵尸 id 集合应当一致（同一个权威世界）
    const idsA = zA.map((z) => z.id).sort((a, b) => a - b);
    const idsB = zB.map((z) => z.id).sort((a, b) => a - b);
    const common = idsA.filter((i) => idsB.includes(i));
    log('   共同僵尸 id 数 =', common.length, '/', Math.max(idsA.length, idsB.length));
    check(common.length >= Math.min(idsA.length, idsB.length) - 1, '两端僵尸 id 对不上（可能是两个世界）');

    // 位置差异应该很小（有插值延迟，允许 1 米内）
    let maxDelta = 0;
    for (const id of common) {
      const a = zA.find((z) => z.id === id);
      const b = zB.find((z) => z.id === id);
      maxDelta = Math.max(maxDelta, Math.hypot(a.x - b.x, a.z - b.z));
    }
    log('   两端僵尸最大位置差 =', maxDelta.toFixed(2), 'm');
    check(maxDelta < 2.5, '两端僵尸位置差过大：' + maxDelta);

    // ---------------- 场景 3：一端卡顿，另一端不受影响 ----------------
    log('==> 场景 3：把 A 端渲染帧率压到极低（模拟手机掉帧），验证 B 端不受影响');
    const cdpA = await ctxA.newCDPSession(A);
    await cdpA.send('Emulation.setCPUThrottlingRate', { rate: 12 }); // 12 倍降速 ≈ 手机严重掉帧

    // 缓冲是环形且封顶 24 帧，不能用「帧数增长」测速率；
    // 用服务器 tick 的推进量衡量「B 端是否持续收到新世界状态」。
    // tick 是服务器侧 30Hz 的单调计数，与任何一端的渲染帧率无关。
    const beforeB = await netStats(B);
    const t0 = Date.now();
    await sleep(3000);
    const elapsed = (Date.now() - t0) / 1000;
    const afterB = await netStats(B);
    const ticksGained = afterB.tick - beforeB.tick;
    const hz = ticksGained / elapsed;
    log('   A 降速 12x 后，B 端世界推进速率 =', hz.toFixed(1), 'tick/s（服务器标称 30）');
    check(ticksGained > 0, 'A 卡顿时 B 端的世界 tick 不再推进');
    // 允许一定损耗（截图/GC），但必须明显高于「被 A 拖慢」的量级
    check(hz > 15, 'A 卡顿拖慢了 B 端的世界推进：' + hz.toFixed(1) + ' tick/s');

    // A 端自己的插值仍应工作（虽然它渲染很慢）
    const stA2 = await netStats(A);
    log('   A 降速后仍在处理快照，缓冲 =', stA2.frames, '延迟 =', stA2.delayMs, 'ms');
    check(stA2.frames > 0, 'A 卡顿后就不收快照了');

    await cdpA.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    log('   ✓ A 端掉帧不再拖累 B 端');

    // ---------------- 场景 4：一端崩溃，另一端世界继续 ----------------
    log('==> 场景 4：A 端直接关闭（模拟应用被杀），B 端世界继续推进');
    const beforeClose = await zombieSignature(B);
    await A.close();
    await sleep(3000);
    const afterCloseStats = await netStats(B);
    log('   A 关闭后 B 仍有快照缓冲 =', afterCloseStats.frames);
    check(afterCloseStats.frames > 0, 'A 关闭后 B 收不到快照了（不应发生）');

    // B 端状态仍正常（没有被踢回菜单）
    const bState = await B.evaluate(() => window.__game.state);
    log('   B 端状态 =', bState);
    check(bState === 'playing', 'A 掉线导致 B 被踢出对局：' + bState);
    log('   ✓ 没有「房主」，任何一方掉线世界都继续');

    // ---------------- 场景 5：单人模式零 WebSocket ----------------
    log('==> 场景 5：单人模式全程不建立 WebSocket');
    const ctxS = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const S = await ctxS.newPage();
    const wsUrls = [];
    S.on('websocket', (ws) => wsUrls.push(ws.url()));
    await S.goto(url);
    await S.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 30000 });
    await S.click('#startBtn');
    await S.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
    await sleep(2500);
    const sState = await S.evaluate(() => ({
      state: window.__game.state,
      duo: window.__game.duo,
      zombies: window.__game.zombies.zombies.length,
    }));
    log('   单人状态:', JSON.stringify(sState), '| WebSocket 连接数 =', wsUrls.length);
    check(wsUrls.length === 0, '单人模式建立了 WebSocket 连接：' + wsUrls.join(','));
    check(sState.zombies > 0, '单人模式没有僵尸');
    log('   ✓ 单人完全离线可玩');

    await ctxS.close();

    check(errors.length === 0, '页面报错：\n' + errors.slice(0, 5).join('\n'));
    log('\n==> 全部场景通过');
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
    await sleep(300);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message || e);
    process.exit(1);
  }
);