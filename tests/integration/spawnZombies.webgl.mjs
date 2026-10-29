// 真实 WebGL 冒烟测试：jsdom 里所有 WebGL 都是假的，材质编译、GPU 渲染、真实 glb 加载
// 这些路径只有真浏览器能覆盖。用系统缓存的 Playwright Chromium（SwiftShader 软渲染）跑：
//   node node_modules/playwright-core ... 不方便，所以这里直接 node 运行本文件：
//   node tests/integration/spawnZombies.webgl.mjs
// 它会 spawn `vite preview` 一个本地静态服务，加载真实页面，点开始、刷僵尸、开火，
// 断言无 console error / pageerror，并检查 renderer.info 的 draw call 与三角面在合理区间。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.WEBGL_CHECK_PORT || 4178);

function fail(msg) {
  console.error('\n❌ WebGL 冒烟测试失败：' + msg);
  process.exit(1);
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const { chromium } = await import('playwright-core');

  // 1) 构建产物（如果 dist 不存在或过旧，先构建）
  const build = spawn('node', ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: undefined },
  });
  const buildCode = await new Promise((r) => build.on('exit', r));
  if (buildCode !== 0) fail('vite build 失败（exit ' + buildCode + '）');

  // 2) 起本地静态服务
  const server = spawn(
    'node',
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, NODE_ENV: undefined } }
  );
  const url = 'http://127.0.0.1:' + PORT + '/';
  const up = await waitForServer(url);
  if (!up) {
    server.kill('SIGKILL');
    fail('vite preview 启动超时：' + url);
  }

  const executablePath = findChromium();
  if (!executablePath) {
    server.kill('SIGKILL');
    fail('找不到 Playwright 的 Chromium，可用 PLAYWRIGHT_BROWSERS_PATH 指定');
  }

  const browser = await chromium.launch({
    executablePath,
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const errors = [];
  let result = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + (err && err.message)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });

    // 真实 glb 加载完成（异步），等 zombieModel.ready
    await page.waitForFunction(
      () => window.__game && window.__game.state === 'menu' && window.__game.zombies,
      null,
      { timeout: 30000 }
    );

    // 通过 UI 点开始，走真实事件路径
    await page.click('#startBtn');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 10000 });

    // 刷一波僵尸、开火、跑 3 秒
    await page.evaluate(() => {
      const g = window.__game;
      g.zombies.startWave(5);
      g.sun = 999;
    });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const g = window.__game;
      const z = g.zombies.zombies[0];
      if (z) {
        g.player.yaw = Math.atan2(-(z.root.position.x - g.player.pos.x), -(z.root.position.z - g.player.pos.z));
      }
      g.controls.setFiring(true);
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__game.controls.setFiring(false));

    result = await page.evaluate(() => {
      const g = window.__game;
      const info = g.renderer.info.render;
      return {
        state: g.state,
        zombies: g.zombies.zombies.length,
        wave: g.zombies.wave,
        kills: g.stats.kills,
        calls: info.calls,
        triangles: info.triangles,
        glReady: !!g.renderer.getContext(),
        zombieModelReady: g.zombies.zombies.length > 0,
      };
    });

    // 3) 断言
    if (errors.length) fail('控制台/页面报错：\n  ' + errors.join('\n  '));
    if (!result.glReady) fail('WebGL 上下文没有建立');
    if (result.state !== 'playing') fail('点击开始后状态不是 playing：' + result.state);
    if (result.zombies <= 0) fail('第 5 波没有刷出僵尸（真实 glb 可能没加载成功）');
    if (result.calls <= 0) fail('renderer 没有任何 draw call');
    if (result.calls > 600) fail('draw call 过高：' + result.calls);
    if (result.triangles > 400000) fail('三角面过高：' + result.triangles);

    console.log('✅ WebGL 冒烟测试通过');
    console.log(
      '   state=' + result.state +
      ' wave=' + result.wave +
      ' zombies=' + result.zombies +
      ' kills=' + result.kills +
      ' drawCalls=' + result.calls +
      ' triangles=' + result.triangles
    );
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});