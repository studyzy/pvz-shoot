// 浏览器级 E2E：双人模式下开火真的能打掉僵尸的血。
//
// 这是对「双人联机打不掉血」的回归验证。链路必须完整走通：
//   客户端本地命中 → 发 FIRE 帧（只带朝向）→ 服务器权威判定 → 扣血 → 快照回传 → 客户端看到 hp 下降
//
// 运行：node tests/integration/duo-fire.e2e.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.E2E_PORT || 4500 + Math.floor(Math.random() * 200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

async function waitHttp(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:' + port + '/', (res) => { res.resume(); resolve(res.statusCode < 500); });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log('==> 构建');
  await new Promise((resolve, reject) => {
    const b = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: ROOT, stdio: 'ignore' });
    b.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('build failed'))));
  });

  console.log('==> 启动服务器 :' + PORT);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', PUBLIC_DIR: path.join(ROOT, 'dist'), MAX_MATCHES: '8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  if (!(await waitHttp(PORT))) { srv.kill(); throw new Error('服务器没起来'); }

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--no-sandbox'] });
  const url = 'http://127.0.0.1:' + PORT + '/';
  const errors = [];

  try {
    const A = await (await browser.newContext({ viewport: { width: 1024, height: 640 } })).newPage();
    const B = await (await browser.newContext({ viewport: { width: 1024, height: 640 } })).newPage();
    for (const [p, t] of [[A, 'A'], [B, 'B']]) {
      p.on('pageerror', (e) => errors.push(t + ' pageerror: ' + e.message));
      p.on('console', (m) => { if (m.type() === 'error') errors.push(t + ' console.error: ' + m.text()); });
    }

    await A.goto(url, { timeout: 60000 });
    await A.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });
    await A.click('#duoBtn');
    await A.waitForFunction(() => window.__game.duoSession && window.__game.duoSession.joinToken, { timeout: 30000 });
    const tok = await A.evaluate(() => window.__game.duoSession.joinToken);
    await B.goto(url + '?join=' + tok, { timeout: 60000 });
    await A.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
    await B.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
    console.log('   两端已进局');

    // 等僵尸刷出来
    await A.waitForFunction(() => window.__game.zombies.zombies.length > 0, { timeout: 30000 });
    await sleep(1500);

    // 记录所有僵尸的初始血量
    const hpSnapshot = (page) => page.evaluate(() =>
      window.__game.zombies.zombies.map((z) => ({ id: z.netId, hp: Math.round(z.hp), x: +z.root.position.x.toFixed(2), z: +z.root.position.z.toFixed(2) }))
    );
    const before = await hpSnapshot(A);
    console.log('   A 端僵尸初始血量:', before.map((z) => z.id + ':' + z.hp).join(' '));
    check(before.length > 0, '没有僵尸');

    // 让 A 端把准星对准最近的僵尸，然后持续开火
    console.log('==> A 端瞄准最近僵尸并开火');
    const aimInfo = await A.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      let best = null, bd = Infinity;
      for (const z of g.zombies.zombies) {
        if (!z.alive || z.dying) continue;
        const d = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
        if (d < bd) { bd = d; best = z; }
      }
      if (!best) return null;
      const dx = z_isX(best) - p.pos.x;
      function z_isX(o) { return o.root.position.x; }
      const dz = best.root.position.z - p.pos.z;
      // 对准胸口
      const eyeY = p.pos.y + 1.66;
      const targetY = best.root.position.y + best.chestY * best.scaleFactor;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(targetY - eyeY, Math.hypot(dx, dz));
      return { id: best.netId, dist: +bd.toFixed(1), hp: Math.round(best.hp) };
    });
    console.log('   目标僵尸:', JSON.stringify(aimInfo));
    check(aimInfo, '找不到可瞄准的僵尸');

    // 持续开火 3 秒（通过真实输入通道：controls.firing）
    await A.evaluate(() => { window.__forceFire = setInterval(() => { window.__game.controls.firing = true; }, 16); });
    await sleep(3000);
    await A.evaluate(() => { clearInterval(window.__forceFire); window.__game.controls.firing = false; });

    // 检查两端血量变化
    await sleep(800);
    const afterA = await hpSnapshot(A);
    const afterB = await hpSnapshot(B);
    const targetA = afterA.find((z) => z.id === aimInfo.id);
    const targetB = afterB.find((z) => z.id === aimInfo.id);
    console.log('   A 端目标僵尸血量:', aimInfo.hp, '->', targetA ? targetA.hp : '(已消失)');
    console.log('   B 端目标僵尸血量:', targetB ? targetB.hp + ' (id ' + targetB.id + ')' : '(已消失)');

    const damaged = !targetA || targetA.hp < aimInfo.hp;
    check(damaged, `目标僵尸血量没有下降（${aimInfo.hp} -> ${targetA ? targetA.hp : '?'}），双人模式下开火无效`);
    console.log('   ✓ 开火能打掉血量');

    // 另一端也应看到同样的血量（服务器权威）
    if (targetA && targetB) {
      check(Math.abs(targetA.hp - targetB.hp) <= 1, `两端血量不一致：A=${targetA.hp} B=${targetB.hp}`);
      console.log('   ✓ 两端血量一致（服务器权威）');
    }

    // 持续开火直到把这只僵尸打死，验证整条击杀链路（含计分）
    console.log('==> 继续开火，验证能击杀并计分');
    const scoreBefore = await A.evaluate(() => {
      const g = window.__game;
      return g.duoStats ? g.duoStats[g.seat] : 0;
    });
    await A.evaluate(() => { window.__forceFire = setInterval(() => { window.__game.controls.firing = true; }, 16); });
    let killed = false;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const still = await A.evaluate((id) => window.__game.zombies.zombies.some((z) => z.netId === id && z.alive && !z.dying), aimInfo.id);
      if (!still) { killed = true; break; }
    }
    await A.evaluate(() => { clearInterval(window.__forceFire); window.__game.controls.firing = false; });
    const scoreAfter = await A.evaluate(() => {
      const g = window.__game;
      return g.duoStats ? g.duoStats[g.seat] : 0;
    });
    console.log('   目标僵尸已死亡:', killed, '| 个人分:', scoreBefore, '->', scoreAfter);
    check(killed, '持续开火 12 秒仍未击杀，链路不完整');
    check(scoreAfter > scoreBefore, `击杀后个人分没涨：${scoreBefore} -> ${scoreAfter}`);

    check(errors.length === 0, '页面报错：\n' + errors.slice(0, 5).join('\n'));
    console.log('\n✅ 双人开火链路验证通过');
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
    await sleep(300);
  }
}

main().then(() => process.exit(0), (e) => { console.error('\n' + (e.message || e)); process.exit(1); });
