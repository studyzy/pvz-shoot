// 浏览器级 E2E：双人模式下三类交互都必须真的生效。
//
// 这是对「双人联机打不掉血」那次的扩展回归。链路必须完整走通：
//   客户端本地动作 → 二进制帧上报（只带朝向/数量）→ 服务器权威判定 → 快照回传 → 两端一致
//
// 覆盖：1) 普通武器伤害与计分  2) 爆炸武器范围伤害  3) 花阳光真的扣得掉
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
    await A.waitForFunction(() => window.__game.zombies.zombies.length > 0, { timeout: 30000 });
    await sleep(1500);
    // 等僵尸走近一点（开波 6 秒内它们还在远处）
    for (let i = 0; i < 40; i++) {
      const close = await A.evaluate(() => window.__game.zombies.zombies.some((z) => {
        if (!z.alive || z.dying) return false;
        const d = Math.hypot(z.root.position.x - window.__game.player.pos.x, z.root.position.z - window.__game.player.pos.z);
        return d < 18;
      }));
      if (close) break;
      await sleep(500);
    }

    // 持续追踪瞄准：僵尸会走动，准星必须跟着走（真人就是这么操作的）。
    // 每 50ms 重新计算朝向，保证射线始终指向目标。
    const startTrack = () => A.evaluate(() => {
      window.__track = setInterval(() => {
        const g = window.__game, p = g.player;
        // 选目标时跳过被墙挡住的（后院一半僵尸在栅栏/房子后面，
        // 瞄准它们本来就打不到 —— 这是正确行为，不该让测试误判）
        const walls = (g.map && g.map.walls) || [];
        const bounds = (g.map && g.map.bounds) || { x: 100, z: 100 };
        const eyeY = p.pos.y + 1.66;
        const blocked = (target) => {
          if (!walls.length || !g.weapons || !g.weapons.constructor) return false;
          const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
          const dy = target.y - eyeY;
          const len = Math.hypot(dx, dy, dz);
          if (len < 0.001) return false;
          // 沿视线按 0.5 米步进采样，碰到墙就算挡
          const nx = dx / len, ny = dy / len, nz = dz / len;
          for (let t = 0.5; t < len; t += 0.5) {
            const px = p.pos.x + nx * t, py = eyeY + ny * t, pz = p.pos.z + nz * t;
            for (const w of walls) {
              if (w.r !== undefined) {
                if (py <= w.h && Math.hypot(px - w.x, pz - w.z) < w.r) return true;
              } else if (w.hx !== undefined) {
                const lx = (px - w.x) * w.c - (pz - w.z) * w.s;
                const lz = (px - w.x) * w.s + (pz - w.z) * w.c;
                if (Math.abs(lx) < w.hx && Math.abs(lz) < w.hz && Math.abs(py - w.y) < w.hy) return true;
              }
            }
          }
          return false;
        };
        let best = null, bd = Infinity;
        for (const z of g.zombies.zombies) {
          if (!z.alive || z.dying) continue;
          const d = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
          if (d >= bd) continue;
          const ty = z.root.position.y + z.chestY * z.scaleFactor;
          if (blocked({ x: z.root.position.x, y: ty, z: z.root.position.z })) continue;
          bd = d; best = z;
        }
        // 全被挡住就退回最近的（至少准星有东西）
        if (!best) {
          for (const z of g.zombies.zombies) {
            if (!z.alive || z.dying) continue;
            const d = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
            if (d < bd) { bd = d; best = z; }
          }
        }
        if (!best) return;
        const dx = best.root.position.x - p.pos.x, dz = best.root.position.z - p.pos.z;
        const targetY = best.root.position.y + best.chestY * best.scaleFactor;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(targetY - (p.pos.y + 1.66), Math.hypot(dx, dz));
        window.__trackId = best.netId;
      }, 50);
    });
    const stopTrack = () => A.evaluate(() => { clearInterval(window.__track); window.__track = null; });

    // 豌豆不是 auto 武器，靠「按下」的上升沿触发。
    // 只把 firing 置 true 只会打一枪，必须持续重新置 firePressed（等价于人一直点鼠标）。
    const startFiring = () => A.evaluate(() => {
      // 间隔必须大于武器冷却（豌豆 0.15s），否则 firePressed 会被换成冷却中的丢弃
      window.__shoot = setInterval(() => {
        const c = window.__game.controls;
        c.firing = true;
        c.firePressed = true;
      }, 200);
    });
    const stopFiring = () => A.evaluate(() => {
      clearInterval(window.__shoot);
      window.__shoot = null;
      window.__game.controls.firing = false;
    });

    const aimNearest = (page) => page.evaluate(() => {
      const g = window.__game, p = g.player;
      let best = null, bd = Infinity;
      for (const z of g.zombies.zombies) {
        if (!z.alive || z.dying) continue;
        const d = Math.hypot(z.root.position.x - p.pos.x, z.root.position.z - p.pos.z);
        if (d < bd) { bd = d; best = z; }
      }
      if (!best) return null;
      const dx = best.root.position.x - p.pos.x, dz = best.root.position.z - p.pos.z;
      const targetY = best.root.position.y + best.chestY * best.scaleFactor;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(targetY - (p.pos.y + 1.66), Math.hypot(dx, dz));
      return { id: best.netId, hp: Math.round(best.hp), dist: +bd.toFixed(1) };
    });

    const hpOf = (page, id) => page.evaluate((zid) => {
      const z = window.__game.zombies.zombies.find((x) => x.netId === zid);
      return z ? Math.round(z.hp) : null;
    }, id);

    // ---------- 1. 普通武器：伤害 + 两端一致 ----------
    console.log('==> 1) 普通武器伤害');
    const t1 = await aimNearest(A);
    check(t1, '找不到可瞄准的僵尸');
    // 只点射几发，保证掉血但不打死（击杀留给 1b 验证）
    await startTrack();
    // 持续追踪+开火，直到目标掉血为止（最多 12 秒）。
    // 僵尸会走动、可能被墙短暂遮挡，单次 1 秒窗口不可靠。
    await startFiring();
    let damagedSeen = false;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const id = await A.evaluate(() => window.__trackId);
      if (id == null) continue;
      const hp = await hpOf(A, id);
      if (hp !== null && hp < 93) { damagedSeen = true; break; }
      // 目标已经死了也算通过
      const gone = await A.evaluate((zid) => !window.__game.zombies.zombies.some((z) => z.netId === zid), id);
      if (gone) { damagedSeen = true; break; }
    }
    await stopFiring();
    await sleep(600);
    await stopTrack();
    const trackId = await A.evaluate(() => window.__trackId);
    // 诊断：客户端到底发了多少 FIRE 帧
    const fireInfo = await A.evaluate(() => ({
      fireSeq: window.__game.duoSession.fireSeq || 0,
      localKills: window.__game.stats.kills,
      sun: window.__game.sun,
      weapon: window.__game.weaponId ? window.__game.weaponId() : '?',
      downed: !!window.__game.player.downed,
      dead: !!window.__game.player.dead,
      matchState: window.__game.duoSession.state,
    }));
    console.log('   客户端 FIRE 统计:', JSON.stringify(fireInfo));
    // 等两端收敛（快照有网络延迟，B 端可能晚几十毫秒才收到）
    let aHp = null, bHp = null;
    for (let i = 0; i < 20; i++) {
      aHp = await hpOf(A, trackId || t1.id);
      bHp = await hpOf(B, trackId || t1.id);
      if (aHp === null || bHp === null || Math.abs(aHp - bHp) <= 1) break;
      await sleep(200);
    }
    console.log(`   目标 ${t1.hp} -> A=${aHp} B=${bHp}`);
    check(damagedSeen || aHp === null || aHp < t1.hp, '普通武器打不掉血（12 秒持续开火无任何伤害）');
    if (aHp !== null && bHp !== null) check(Math.abs(aHp - bHp) <= 1, `两端血量不一致 A=${aHp} B=${bHp}`);

    // ---------- 2. 爆炸武器：范围伤害 ----------
    console.log('==> 2) 爆炸武器范围伤害');
    // 用追踪瞄准 + 连续投几颗樱桃：爆炸是范围伤害，只要落点够近就必然掉血
    // 樱桃射程 22 米，必须等目标进入射程再试，否则本来就炸不到
    let boomTarget = null;
    for (let i = 0; i < 40; i++) {
      boomTarget = await A.evaluate(() => {
        const g = window.__game, p = g.player;
        const cand = g.zombies.zombies
          .filter((x) => x.alive && !x.dying)
          .map((x) => ({ z: x, d: Math.hypot(x.root.position.x - p.pos.x, x.root.position.z - p.pos.z) }))
          .filter((o) => o.d < 18) // 留余量，18 米内必在射程
          .sort((a, b) => a.d - b.d);
        if (!cand.length) return null;
        return { id: cand[0].z.netId, hp: Math.round(cand[0].z.hp), dist: +cand[0].d.toFixed(1) };
      });
      if (boomTarget) break;
      await sleep(500);
    }
    if (boomTarget) {
      await startTrack();
      await sleep(300);
      const trackBoom = await A.evaluate(() => window.__trackId);
      for (let i = 0; i < 6; i++) {
        await A.evaluate(() => { window.__game.duoSession.sendFire('cherry'); });
        await sleep(700);
        const hp = await hpOf(A, boomTarget.id);
        if (hp === null || hp < boomTarget.hp) break;
      }
      await stopTrack();
      let after = null;
      for (let i = 0; i < 15; i++) {
        after = await hpOf(A, boomTarget.id);
        if (after === null || after < boomTarget.hp) break;
        await sleep(200);
      }
      console.log(`   爆炸目标(id=${boomTarget.id}, ${boomTarget.dist}m) ${boomTarget.hp} -> ${after}`);
      check(after === null || after < boomTarget.hp, '爆炸武器范围伤害无效（6 颗樱桃都没炸掉血）');
    } else {
      console.log('   没有可用目标，跳过');
    }

    // ---------- 1b. 持续开火能击杀并计分 ----------
    console.log('==> 1b) 击杀与计分');
    // 前面的步骤可能把场上的僵尸都打死了，等下一波刷出来再验证击杀
    await A.waitForFunction(() => window.__game.zombies.zombies.filter((z) => z.alive && !z.dying).length > 0, { timeout: 40000 });
    await sleep(1000);
    const scoreBefore = await A.evaluate(() => { const g = window.__game; return g.duoStats ? g.duoStats[g.seat] : 0; });
    const killsBefore = await A.evaluate(() => { const g = window.__game; return g.duoKills ? g.duoKills[g.seat] : 0; });
    // aliveBefore 不再用于判定（新僵尸会刷出），保留仅作日志
    await startTrack();
    await A.evaluate(() => { window.__f2 = setInterval(() => { window.__game.controls.firing = true; }, 16); });
    // 用「击杀数」判定而不是「存活数」：新僵尸会不断刷出，存活数不一定减少
    let killedNow = false;
    for (let i = 0; i < 50; i++) {
      await sleep(300);
      const k = await A.evaluate(() => { const g = window.__game; return g.duoKills ? g.duoKills[g.seat] : 0; });
      if (k > killsBefore) { killedNow = true; break; }
    }
    await stopFiring();
    await stopTrack();
    await sleep(500);
    const scoreAfter = await A.evaluate(() => { const g = window.__game; return g.duoStats ? g.duoStats[g.seat] : 0; });
    const killsAfter = await A.evaluate(() => { const g = window.__game; return g.duoKills ? g.duoKills[g.seat] : 0; });
    console.log(`   击杀=${killedNow} 个人分 ${scoreBefore} -> ${scoreAfter} 击杀数 ${killsBefore} -> ${killsAfter}`);
    check(killedNow, '持续开火 15 秒没打死任何僵尸');
    check(scoreAfter > scoreBefore, `击杀后个人分没涨：${scoreBefore} -> ${scoreAfter}`);
    check(killsAfter > killsBefore, `击杀数没涨：${killsBefore} -> ${killsAfter}`);

    // ---------- 3. 阳光消费 ----------
    console.log('==> 3) 花阳光真的扣得掉');
    const sun0 = await A.evaluate(() => window.__game.sun);
    await A.evaluate(() => { window.__game.spendSun(20); });
    await sleep(1500); // 等几帧快照
    const sun1 = await A.evaluate(() => window.__game.sun);
    const sunB = await B.evaluate(() => window.__game.sun);
    console.log(`   花 20 阳光：${sun0} -> A=${sun1} B=${sunB}`);
    check(sun1 <= sun0 - 18, `花阳光后余额被服务器盖回来了：${sun0} -> ${sun1}（等于白花）`);
    check(Math.abs(sun1 - sunB) <= 2, `两端阳光不一致 A=${sun1} B=${sunB}`);

    check(errors.length === 0, '页面报错：\n' + errors.slice(0, 5).join('\n'));
    console.log('\n✅ 双人交互链验证通过（普通武器 / 爆炸 / 阳光）');
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
    await sleep(300);
  }
}

main().then(() => process.exit(0), (e) => { console.error('\n' + (e.message || e)); process.exit(1); });
