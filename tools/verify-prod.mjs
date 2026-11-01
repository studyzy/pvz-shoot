// 线上验证：直接打生产服务器，验证服务器权威双人联机真的可用。
// 与 duo-authority.e2e.mjs 的区别：那个跑本地服务器的同构流程；
// 这个跑 https://124.221.164.209 的真实部署（Caddy + systemd pvz-duo）。
//
// 用法：node tools/verify-prod.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.PROD_URL || 'https://124.221.164.209/pvz/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

async function netStats(page) {
  return page.evaluate(() => {
    const s = window.__game && window.__game.duoSession;
    if (!s || !s.buffer) return null;
    return {
      frames: s.buffer.frameCount,
      delayMs: Math.round(s.buffer.delayMs),
      tick: s.latestSnap ? s.latestSnap.tick : -1,
      state: s.state,
      pending: s.pendingInputs.length,
    };
  });
}

async function zombies(page) {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g || !g.zombies) return [];
    return g.zombies.zombies.map((z) => ({
      id: z.netId,
      x: +z.root.position.x.toFixed(2),
      z: +z.root.position.z.toFixed(2),
      hp: Math.round(z.hp),
    }));
  });
}

async function main() {
  console.log('目标:', BASE);
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  try {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();
    for (const [p, tag] of [[A, 'A'], [B, 'B']]) {
      p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
      p.on('console', (m) => {
        if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text());
      });
    }

    console.log('==> A 建房（走线上 wss）');
    await A.goto(BASE, { timeout: 60000 });
    await A.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });
    await A.click('#duoBtn');
    await A.waitForFunction(() => window.__game.duoSession && window.__game.duoSession.joinToken, { timeout: 30000 });
    const token = await A.evaluate(() => window.__game.duoSession.joinToken);
    console.log('   joinToken =', token);

    console.log('==> B 用邀请链接加入');
    const joinUrl = BASE + '?join=' + encodeURIComponent(token);
    await B.goto(joinUrl, { timeout: 60000 });
    await B.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });

    await A.waitForFunction(() => window.__game.state === 'playing' && window.__game.duo, { timeout: 60000 });
    await B.waitForFunction(() => window.__game.state === 'playing' && window.__game.duo, { timeout: 60000 });
    console.log('   两端已进局');

    await sleep(4000);
    const sA = await netStats(A);
    const sB = await netStats(B);
    console.log('   A:', JSON.stringify(sA));
    console.log('   B:', JSON.stringify(sB));
    check(sA && sA.frames > 5, 'A 没收到足够快照');
    check(sB && sB.frames > 5, 'B 没收到足够快照');
    // 两端 tick 差 = 网络延迟差（约 0.5 秒 = 15 tick 是正常的跨网络抖动）
    console.log('   两端 tick 差 =', Math.abs(sA.tick - sB.tick), '（≈', (Math.abs(sA.tick - sB.tick) / 30).toFixed(2), '秒网络延迟差）');
    check(Math.abs(sA.tick - sB.tick) < 90, '两端 tick 偏差过大（超过 3 秒）：' + Math.abs(sA.tick - sB.tick));

    const zA = await zombies(A);
    const zB = await zombies(B);
    console.log('   A 僵尸数 =', zA.length, '| B 僵尸数 =', zB.length);
    check(zA.length > 0 && zB.length > 0, '没有僵尸');
    const idsA = zA.map((z) => z.id).sort((a, b) => a - b);
    const idsB = zB.map((z) => z.id).sort((a, b) => a - b);
    const common = idsA.filter((i) => idsB.includes(i));
    console.log('   共同僵尸 =', common.length, '/', Math.max(idsA.length, idsB.length));
    let maxDelta = 0;
    for (const id of common) {
      const a = zA.find((z) => z.id === id);
      const b = zB.find((z) => z.id === id);
      maxDelta = Math.max(maxDelta, Math.hypot(a.x - b.x, a.z - b.z));
    }
    console.log('   两端僵尸最大位置差 =', maxDelta.toFixed(2), 'm');
    check(maxDelta < 2.5, '两端位置差过大：' + maxDelta);

    console.log('==> A 端降速 12x（模拟手机掉帧），验证 B 端不受影响');
    const cdp = await ctxA.newCDPSession(A);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
    const before = await netStats(B);
    const t0 = Date.now();
    await sleep(4000);
    const after = await netStats(B);
    const hz = (after.tick - before.tick) / ((Date.now() - t0) / 1000);
    console.log('   B 端世界推进 =', hz.toFixed(1), 'tick/s');
    check(hz > 15, 'B 端被 A 拖慢：' + hz.toFixed(1));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    console.log('==> A 端关闭，B 端应继续');
    await A.close();
    await sleep(3000);
    const st = await B.evaluate(() => window.__game.state);
    console.log('   B 端状态 =', st);
    check(st === 'playing', 'A 关闭导致 B 被踢：' + st);

    check(errors.length === 0, '页面报错：\n' + errors.slice(0, 5).join('\n'));
    console.log('\n✅ 线上验证全部通过');
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n' + (e.message || e));
    process.exit(1);
  }
);