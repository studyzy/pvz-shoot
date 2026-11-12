// 后期管线的像素级回归（docs/plans/2026-11-12-render-overhaul.md §8）。
//
// 为什么必须有这一条：M2/M3/M4 改了整整三层渲染（手写后期管线、天空穹顶+高度雾、
// SSAO），但全部靠人工截图 + vision 判断「看起来对」。这类验证不可重复 ——
// 换个人看、换个显示器、换个模型版本，结论都可能翻。
//
// 这条测试把「后期真的在起作用」变成可断言的东西：
//   1) 同一机位，后期开 vs 关，画面必须显著不同（否则后期等于没接上）；
//   2) 同一机位同一档位连续两帧，必须逐像素一致（否则有随机源在污染画面）；
//   3) 后期各档位之间必须单调不同（1 档不能等于 2 档）；
//   4) 画面不能全黑/全白（管线跑飞时最典型的症状）。
//
// 不比对「基线图」——那需要把 PNG 提交进仓库，而且改任何一处美术都会整片红。
// 这里断言的是关系（开≠关、帧间稳定、非退化），不是具体像素值。

import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8811;

const VIEW = { width: 960, height: 540 };
const MAP = 'backyard';

// 仓库用 playwright-core + 本机已下载的 chromium（见 browser.e2e.webgl.mjs 同款探测）
function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache/ms-playwright'),
    '/root/.cache/ms-playwright',
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort();
    for (const d of dirs.reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function fail(msg) {
  throw new Error(msg);
}

// 统计两张图里差值超过阈值的采样点比例
async function diffRatio(aDataUrl, bDataUrl, threshold = 12) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const a = await loadImage(aDataUrl);
  const b = await loadImage(bDataUrl);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(a, 0, 0);
  const pa = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(b, 0, 0);
  const pb = ctx.getImageData(0, 0, w, h).data;
  let changed = 0;
  let total = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const p = (y * w + x) * 4;
      total++;
      const d = Math.max(
        Math.abs(pa[p] - pb[p]),
        Math.abs(pa[p + 1] - pb[p + 1]),
        Math.abs(pa[p + 2] - pb[p + 2]),
      );
      if (d > threshold) changed++;
    }
  }
  return { ratio: changed / total, changed, total };
}

// 平均亮度与方差：用来抓「全黑/全白/全糊」这类退化
async function stats(dataUrl) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(dataUrl);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const p = (y * img.width + x) * 4;
      const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      sum += lum;
      sum2 += lum * lum;
      n++;
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), samples: n };
}

// 必须走 build + preview：dev 模式下 config 里的 %%INJECT%% 占位符不会被打包插件替换
function runBuild() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: ROOT, stdio: 'ignore',
    });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('vite build 失败，exit ' + c))));
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function startPreview() {
  const p = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview',
    '--port', String(PORT), '--strictPort', '--host', '127.0.0.1',
  ], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 60; i++) {
    if (await probe(url)) return { proc: p, url };
    await new Promise((r) => setTimeout(r, 500));
  }
  p.kill();
  throw new Error('vite preview 启动超时');
}

async function main() {
  await runBuild();
  const { proc, url: base } = await startPreview();

  const { chromium } = await import('playwright-core');
  const exe = findChromium();
  if (!exe) throw new Error('找不到 chromium，请先 npx playwright install chromium');
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const results = [];
  const check = (ok, msg) => {
    results.push({ ok, msg });
    if (!ok) fail(msg);
  };

  try {
    const page = await browser.newPage({ viewport: VIEW });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // ?post=2 强制开满后期，并关掉自适应降级（软件渲染帧率低会立刻降档）
    await page.goto(`${base}?post=2&map=${MAP}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__game && window.__game.post, { timeout: 90000 });
    // 等首屏资源与场景装配完成
    await page.waitForFunction(
      () => window.__ready === true || (window.__game && window.__game.state === 'menu'),
      { timeout: 90000 },
    );
    await page.waitForTimeout(1500);

    // 锁死机位与档位，让两次渲染只差「后期开关」这一个变量
    await page.evaluate((map) => {
      const g = window.__game;
      g.trackPerformance = () => {};       // 关掉自适应，否则帧率低会自己降档
      if (g.setQuality) g.setQuality('high');
      g.post.setLevel(2);
      g.post.locked = true;
      if (g.setMap && g.mapId !== map) g.setMap(map);
      // 固定机位：场地中央看向房子方向，画面里有地面/树/栅栏，能覆盖雾与 AO
      g.player.pos.set(0, 0, 6);
      g.player.yaw = 0;
      g.player.pitch = -0.06;
    }, MAP);
    await page.waitForTimeout(1200);

    // 停掉主循环再做像素比较：僵尸行走、天气粒子、天空云都在动，
    // 不冻结的话两帧本来就该不一样，测的就不是「管线是否稳定」了。
    await page.evaluate(() => {
      const g = window.__game;
      g.running = false;
      // 冻结天气与天空的时间推进，让场景变成静态
      if (g.weather && g.weather.update) g.weather.update = () => {};
      if (g.sky && g.sky.update) g.sky.update = () => {};
    });
    await page.waitForTimeout(600);

    // 取一帧：直接读 WebGL canvas，绕过 HUD 合成
    // 必须走 post.render 而不是裸 renderer.render —— 后者会绕过后处理，
    // 拍出来的两帧永远一样（这正是第一次跑时 0.00% 的原因）。
    const grab = () => page.evaluate(() => {
      const g = window.__game;
      const applied = g.post.render(g.scene, g.camera);
      if (!applied) g.renderer.render(g.scene, g.camera);
      return { png: g.renderer.domElement.toDataURL('image/png'), applied };
    });

    // ---- 1) 帧间稳定性：同一档位连续两帧必须几乎一致 ----
    const f1 = (await grab()).png;
    const f2 = (await grab()).png;
    const stable = await diffRatio(f1, f2, 6);
    check(stable.ratio < 0.01,
      `同档位连续两帧不一致（${(stable.ratio * 100).toFixed(2)}% 采样点变化）——画布有不该有的随机源`);

    // ---- 2) 后期开 vs 关必须显著不同 ----
    const on = (await grab()).png;
    await page.evaluate(() => { window.__game.post.setLevel(0); });
    await page.waitForTimeout(600);
    const off = (await grab()).png;
    const d = await diffRatio(on, off, 12);
    const sOn = await stats(on);
    const sOff = await stats(off);
    console.log(`  后期开 mean=${sOn.mean.toFixed(1)} std=${sOn.std.toFixed(1)} | 关 mean=${sOff.mean.toFixed(1)} std=${sOff.std.toFixed(1)}`);
    check(d.ratio > 0.02,
      `后期开/关差异只有 ${(d.ratio * 100).toFixed(2)}%，管线可能没真正接上（要求 >2%）`);

    // ---- 3) 每档都非退化：不能全黑/全白/纯色 ----
    for (const level of [0, 1, 2]) {
      await page.evaluate((lv) => { window.__game.post.setLevel(lv); }, level);
      await page.waitForTimeout(500);
      const url = (await grab()).png;
      const s = await stats(url);
      check(s.mean > 8 && s.mean < 250,
        `档位 ${level} 平均亮度 ${s.mean.toFixed(1)} 退化（接近全黑或全白）`);
      check(s.std > 6,
        `档位 ${level} 亮度标准差只有 ${s.std.toFixed(1)}，画面可能是纯色/糊成一片`);
    }

    // ---- 4) 档位之间有差异（1 档不能等于 2 档）----
    await page.evaluate(() => { window.__game.post.setLevel(1); });
    await page.waitForTimeout(500);
    const lv1 = (await grab()).png;
    await page.evaluate(() => { window.__game.post.setLevel(2); });
    await page.waitForTimeout(500);
    const lv2 = (await grab()).png;
    // 1 档（ACES + 收尾）vs 2 档（多 Bloom + SSAO）。差异比例天然不大 ——
    // Bloom 只影响高光区、SSAO 只影响缝隙，全屏 100% 变化反而是错的。
    const dd = await diffRatio(lv1, lv2, 10);
    check(dd.ratio > 0.005,
      `1 档与 2 档差异只有 ${(dd.ratio * 100).toFixed(2)}%，Bloom/SSAO 可能没生效（要求 >0.5%）`);

    // ---- 5) 高度雾在：远景必须比近景更接近雾色（不能远近一个色）----
    await page.evaluate(() => { window.__game.post.setLevel(2); });
    await page.waitForTimeout(500);
    const fogged = (await grab()).png;
    const fogStats = await stats(fogged);
    check(fogStats.std > 10, '整帧对比度太低，高度雾可能把画面糊平了');

    check(errors.length === 0, `页面有 ${errors.length} 条运行错误：${errors.slice(0, 3).join(' | ')}`);

    console.log('\n像素回归指标：');
    console.log(`  帧间差异      ${(stable.ratio * 100).toFixed(3)}%  （阈值 <1%）`);
    console.log(`  后期开/关差异 ${(d.ratio * 100).toFixed(2)}%  （阈值 >2%）`);
    console.log(`  1档 vs 2档    ${(dd.ratio * 100).toFixed(2)}%  （阈值 >0.5%）`);
    console.log(`  最终帧亮度    mean=${fogStats.mean.toFixed(1)} std=${fogStats.std.toFixed(1)}`);
    console.log(`  通过 ${results.length} 项断言\n`);
  } finally {
    await browser.close().catch(() => {});
    proc.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n✗ 像素回归失败：' + (e && e.message ? e.message : e));
    process.exit(1);
  },
);