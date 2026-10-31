#!/usr/bin/env node
// 给 glb 拍预览图：本地起 HTTP（服务仓库根），Chromium 打开 tools/preview-glb.html
// 渲染模型并截图到 aigc/textures/previews/<name>.jpg。
// 用法：node tools/preview-glb.mjs slime.glb spider.glb ...

import http from 'http';
import { readFile } from 'fs/promises';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';

const models = process.argv.slice(2);
if (!models.length) { console.error('usage: node tools/preview-glb.mjs <model.glb> ...'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const ROOT = process.cwd();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/tools/preview-glb.html';
    const file = path.resolve(ROOT + p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;

function findChromium() {
  const dirs = [path.join(os.homedir(), '.cache/ms-playwright'), '/root/.cache/ms-playwright'];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const sub = readdirSync(dir).filter((d) => d.startsWith('chromium-')).sort().pop();
    if (!sub) continue;
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(dir, sub, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const { chromium } = await import('playwright-core');
const exe = findChromium();
if (!exe) { console.error('chromium not found'); process.exit(1); }
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 640 } });
const outDir = 'aigc/textures/previews';
mkdirSync(outDir, { recursive: true });

for (const m of models) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/?model=' + encodeURIComponent(m));
  try {
    await page.waitForFunction('window.__ready === true', { timeout: 20000 });
    if (await page.evaluate('!!window.__err')) { console.error(m, 'LOAD_ERROR', await page.evaluate('window.__err')); }
    else {
      await page.screenshot({ path: path.join(outDir, m.replace(/\.glb$/, '') + '.jpg'), type: 'jpeg', quality: 85 });
      console.log('shot ' + m + ' -> ' + outDir + '/' + m.replace(/\.glb$/, '') + '.jpg' + (errs.length ? ' (pageerror: ' + errs.join('; ') + ')' : ''));
    }
  } catch (e) { console.error(m, 'TIMEOUT', errs.join('; ')); }
  await page.close();
}
await browser.close();
server.close();
