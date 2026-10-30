# 评审 · 双人联机方案 v2

> 评审对象：`docs/design/DESIGN-duo-online.md`（v2，536 行）
> 实装对照：当前工作区未提交的 M0/M1（`src/net/protocol.js` / `NetClient.js` / `DuoSession.js`、`server/`、`Game.js` 双人分支）
> 方法：网络工程四本账（正确性 / 公平性 / 可用性 / 工程成本）+ 代码对照 + 数值复算
> 代码判断均带行号；数值按 `src/config.js` 与实装复算。本文只给裁决与替代方案，不复述设计稿。

---

## 0. 一句话裁决

> **这是一份「玩法设计 9 分、联网落地 5 分」的设计稿。**
> 房主权威 + 服务器盲中继的选型是对的；15Hz / 100ms / 250ms 的量级也对。但协议层还停留在「发个快照、扣个血」的草图：**命中裁决、状态恢复、重连、快照 schema 四项都不足以支撑 M2**。
> 当前工作区已经有一个能跑的 M0/M1 切片（配对、中继、双人出生、互相看见），但它把「各自模拟、各自上报绝对位置」写进了公共路径；M2 一开波就是双份僵尸、双份阳光、双份分。
> 结论：**不建议按 v2 原样进 M2**。先修 6 个 P0（§3），再做 3 个验证实验（§8）。

---

## 1. 总评分（10 分制，等权）

| 维度 | 分 | 判据（一句） |
| --- | --- | --- |
| 权威模型选型 | **8.5** | 房主权威 + 盲中继，对渲染与模拟强耦合的现有代码是正确取舍；明确不做服务端全量模拟。 |
| 协议与状态设计 | **4.5** | `hit` / `snap` / `welcome.state` 三个关键 schema 都缺字段；回退没有时钟域。 |
| 延迟与手感 | **6.5** | 15/100/250 量级对；但固定 30Hz、0.4m 校正阈值、100ms 缓冲偏紧。 |
| 公平性与反作弊 | **3.5** | 客人给伤害、房主可改双方分；而核心 loop 是个人比分。 |
| 状态恢复与容错 | **4.0** | 45s 重连只保座位，不保状态；host 刷新必然分叉。 |
| 与现有代码的耦合 | **4.0** | `Game`/`Player`/`WallNuts`/HUD 全是单例；改动清单漏了 `WallNuts.js`。 |
| 部署与运维 | **7.0** | systemd/Caddy/JSONL/单进程都合理；Pages 与 VPS 二选一没定。 |
| 自动化验收 | **6.5** | M0–M4 有 kill criteria；但覆盖率门槛对 net 代码不现实。 |
| **综合** | **5.6** | **方向对，协议层不能开工。** |

---

## 2. 裁决表

### P0（必须先修，否则 M2 不可用）

| 编号 | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| P0-1 | 命中裁决没有射线，`dmg`/`head` 全由客人给 | §9.2 的 `hit {zid, dmg, head, t}` | 穿墙、无限射速、任意伤害、任意爆头；比分被客人控制 |
| P0-2 | 回退时间戳没有时钟域 | §9.2「心跳 2s 同时用于时钟同步」 | 时钟偏移吃掉 250ms 预算，移动靶大量误判 |
| P0-3 | 重连只恢复座位，不恢复状态 | `Matchmaker.attach` + `DuoSession` START 分支 | host 刷新后双方世界分叉；客人重连丢装备 |
| P0-4 | 快照缺 `y` / loadout / shield | `snap.zombies[]`、`snap.players[]` | 气球贴地、客人拿错枪、房主无法校验命中与移速 |
| P0-5 | 无 join token，UI 却在说「把网址发给朋友」 | `DuoSession.js:61`、`server/matchmaker.js:60` | 朋友打开网址只会新建一场，不是加入 |
| P0-6 | 双份模拟没有权威分支 | `Game.js:636` 的 `update` 公共路径 | M2 一开波就是双份僵尸、双份阳光、双份分 |

### P1（会踩，但可控）

| 编号 | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| P1-1 | 30Hz 固定步长是全局改造，收益不存在 | `Game.js:692-696` 现在是可变 dt | 房主继续 rAF，只把快照降到 15–20Hz |
| P1-2 | 0.4m 校正阈值太松 | 15Hz × 4.5 m/s ≈ 0.3 m/帧 | 输入重放，或降到 0.15–0.2m |
| P1-3 | 100ms 插值缓冲在移动网络偏紧 | §9.2 | 20Hz + 100ms，或 15Hz + 150ms |
| P1-4 | 快照体积估算偏乐观 | 文档 700B / 10KB/s | 实测约 1.1–1.3KB/帧 ≈ 17–20KB/s |
| P1-5 | 120ms 无快照就「连接中断」太敏感 | §9.2 | 1–2s 迟滞；host `visibilitychange` 立即广播 pause |
| P1-6 | `spendSun` 是同步 bool，共享池是跨端请求 | `Game.js:575`、`WeaponSystem.js:901/1003/1144` | 客人预测扣款 + 房主回滚，或预授权额度 |
| P1-7 | 公网单进程没有 per-IP 限制 | `server/index.js:58` 只有 maxPayload | 加连接数/hello 频率限制，否则 8 个连接占满 8 场 |
| P1-8 | 部署目标二选一没定 | AGENTS 写 Pages，§9.4 是 VPS | 保留 Pages 就在 workflow 注入 `VITE_NET_URL` + 校验 Origin |
| P1-9 | 覆盖率门槛对 net 代码不现实 | `vitest.config.js:114-119`：98/89/97 | 传输层做可注入薄适配器，或只测纯逻辑 |
| P1-10 | `SunOrbs` 池 28 是按单人调的 | `SunOrbs.js:7` | 双人击杀密度 ×1.5，提到 ~40 |
| P1-11 | 双人经济偏紧 | 总 HP ×2.25、收入 ×1.5 | 特殊武器每点伤害的阳光收入降 33%；M2 用真实一局验 `hpMul 1.5` |
| P1-12 | 房主 0 延迟且能改双方分 | §9.5 | 再来一局交换房主，成本几乎为零 |
| P1-13 | 淘汰等下一波可能空窗 2–4 分钟 | §4.1 | 改 60s 固定复活或清波复活 |

---

## 3. P0 详述

### 3.1 命中裁决：房主拿不到射线，`dmg` / `head` 全由客人给

设计稿 §9.2 写的是：

```text
hit {zid, dmg, head, t}
房主按 t - (RTT/2 + 100ms) 回退该僵尸位置做球体判定
```

按这组字段，房主只知道「打的是哪只、多少伤害、是不是头、什么时候」，**不知道子弹从哪来、朝哪飞**。球体判定没有射线可判，只能退化成「客人说打中了」；而 `dmg` 与 `head` 又是客人自己填的。

后果不是理论问题：比分按伤害占比分账，客人可以穿墙、无限射速、任意伤害、任意爆头，房主还要为它记分。**核心 loop 是个人 duel，这等于把记分板交给客人。**

**修法（协议 v1.1）：**

```text
hit { zid, seq, weapon, dir:[x,y,z] }
```

房主依次做五件事：

1. **重建起点**：房主自己保存客人的相机历史（位置 + yaw/pitch，30Hz，1 秒环形缓冲），按 `seq` 取起点。不要信客人传的 origin。
2. **校验方向**：`dir` 必须落在该武器 spread 锥内（三线/机枪有随机散射，不能要求逐位相等），且与相机前向夹角 ≤ 武器锥角。
3. **重算伤害**：按 `WEAPONS[weapon].damage` × 部位倍率（爆头 ×3）重算，`dmg` / `head` 都不再从客人读。
4. **校验资源**：射速冷却、弹匣余量、射程；用 `HitWalls.sweepWalls` 校验遮挡（客人本地撞墙消失，不代表房主端也撞了）。
5. **回执**：通过回 `hitAck {seq}`，不通过回 `reject {seq, reason}`，客人回滚命中标记与白闪。

同时，客人的本地 `Zombie.hit()` 必须走 **flashOnly** 分支：只白闪、不扣血、不触发 `ZombieManager.handleKill`（`ZombieManager.js:278-298` 会在本地加分并 `sunOrbs.spawn`）。这条不修，客人会掉双份阳光、拿双份分。

### 3.2 回退用的 `t` 没有时钟域

设计稿说「心跳 2s，同时用于时钟同步」，但没说 `hit.t` 是客人墙钟、房主时钟还是快照序号。三种解释对应三套实现，误差量级完全不同：

- 客人墙钟：需要 `offset = hostT - clientT`；2s 一次心跳、没有 min-RTT 滤波，偏移误差几十到上百 ms，250ms 的回退预算会被吃掉。
- 房主时钟：客人根本不知道房主时钟，除非每个 `snap` 都带发送时间。
- 快照序号：不需要时钟同步，天然对齐插值。

**修法：用快照序号，不用墙钟。**

```text
snap { seq, ... }
hit  { zid, seq: <客人当前渲染到的快照序号 + alpha>, ... }
```

房主端每只僵尸保存 300ms 的位置环形缓冲（30Hz × 0.3s = 9 帧，14 只约 4KB，可忽略），按 `seq` 回退。客人渲染的 `seq` 是它自己插值的那两帧，天然就是「客人看到的世界」。

如果坚持墙钟：每个 `snap` 带 `hostT`，客人用最近 20 个样本的 min-RTT 估 offset，并且把 offset 的 EWMA 一起写进 `hit`，别用 2s 心跳直接当同步。

### 3.3 重连只恢复座位，不恢复状态（当前实装可复现）

设计稿 §8.2 / §13.5 承诺「45s 内带 token 回来可回到原座位」。当前实装：

- `Matchmaker.attach`（`server/matchmaker.js:177-204`）清掉 grace timer、重绑连接、发 `WELCOME` + `START`。
- `DuoSession` 收到 `START` 时，如果 `game.duo` 已存在，只显示「已重连」然后 `break`（`src/net/DuoSession.js:106-112`）。

也就是说：**座位回来了，世界没有回来。** 更糟的是 host 刷新：

- host 页面刷新后本地 `game.duo` 为空，收到 `START` 会走 `startDuo` → `resetRun()`（`Game.js:406-422`），波次回到第 1 波、阳光回到 60、僵尸清空。
- guest 还在旧世界继续打。双方从此在不同时间线。

客人刷新也丢：武器槽、弹匣、盾血、地面补给、当前悬赏都不在 `welcome` / `snap` 里。

**v1 决策（二选一，别含糊）：**

- **推荐**：host 重连 = 本局结束（写进已知限制）；guest 重连 = host 发一份完整 `resync`（§6）。
- 或者：host 每 5s 把状态 checkpoint 到服务器，host 回来从 checkpoint 恢复。工作量大约是 `resync` 的 3 倍，v1 不值得。

同时把 M0 验收拆成两种：「网络抖动、页面还活着」可以回座；「页面刷新/崩溃」按上面的规则处理。现在的「45s 回座」把两种情况混成了一种。

### 3.4 快照 schema 缺 `y` / loadout / shield

设计稿 §9.2 的字段：

```text
zombies[{id, type, x, z, yaw, hp, state}]
players[{x, z, yaw, pitch, hp, down, score}]
```

三个缺口：

1. **`y`**：气球 `airHeight 2.2`（`src/config.js:393-394`、`Zombie.js:97` 的 `root.position.y = airHeight`），客人会把气球画在地上；玩家跳上雪地矮墙/沙城箱子、跳起时也会被拉回地面。
2. **loadout**：`players[]` 没有武器/弹匣。房主无法校验客人命中（§3.1 的第 3/4 步），队友模型也拿不对枪。
3. **shield**：盾改变移速（`Player.js:80` 的 `speedMul`）和伤害吸收（`Player.js:61` 的 `shield.absorb`）。房主模拟客人移动/承伤时不知道盾的状态，两边会分叉；客人重连后盾血也丢了。

```text
z:[{ id, t, x, y, z, yaw, hp, st, at }]
p:[{ s, x, y, z, yaw, pitch, hp, down, sc, w, a, sh }]
```

- `st`：0 idle / 1 walk / 2 attack / 3 dying / 4 dead；`at`：攻击计时，客人用它对齐动画。
- `w`：武器 index；`a`：弹匣；`sh`：盾血（0 = 未举起）。
- 装备变化也可以走 `evt {type:'equip'}`，snapshot 只带结果；但**每个 `hit` 到达时房主必须已经知道客人的装备**，否则校验没法做。

### 3.5 无房间码 vs 「把网址发给朋友」

`DuoSession.js:61/82/90` 三处都在显示「把网址发给朋友」，但：

- `hello {token, name, build, mapId, access}`（`src/net/NetClient.js`）没有房间标识。
- `Matchmaker.onHello`（`server/matchmaker.js:60-84`）只做 token 查找 → FIFO `takeWaiting()`，不知道「这个人是来找某一场的」。
- 朋友打开网址 → 新 token → 新建一场并等待。**他不会加入你那一场。**

这不是「以后再做」的问题，是当前 UI 已经在骗人。

**修法：**

```text
createMatch → { matchId, joinToken }
URL: https://host/?join=<joinToken>
hello { token, join?, name, build, mapId, access }
```

`onHello` 顺序：token 已有座位 → 回座；`join` 命中且 2 号位空 → 加入；否则 FIFO；再否则新建。joinToken 与座位 token 分开，避免把长期身份写进 URL。

自动配对可以保留为 fallback，但**默认应该是「发给朋友」，不是「随机陌生人」**。10–25 分钟、需要语音配合的合作局，陌生人匹配的产品风险比技术风险大。

### 3.6 双份模拟没有权威分支

当前 `Game.update`（`Game.js:636`）无条件跑：

```js
this.player.update(...)
this.zombies.update(...)
this.sunOrbs.update(...)
this.pickups.update(...)
```

`startDuo` 目前故意不调 `startWave`（`Game.js:421` 横幅「僵尸同步开发中」），所以 M1 不会双份僵尸。但只要 M2 加上第一波，**两台客户端会各自跑一套 AI**，几秒内就分叉。

M2 前必须加权威分支：

- guest：跳过 `zombies.update`、`skySun`、`sunOrbs` 的权威结算、`pickups` 的权威结算、`zombies.spawn`；只跑 `RemotePlayer` / `Zombie.applyState` 的插值。
- host：保留完整模拟 + 快照。
- 客人本地击杀只走 `flashOnly`，不 `handleKill`、不掉阳光、不加分。

同一块还有三个单例副作用：

- `Player.onDamage` → `hud.flashDamage()` + `shake(0.5)` + `sfx.hurt()`（`Game.js:130-134`）；`Player.onDeath` → `gameOver()`（`Game.js:135`）。房主为客人跑一个 `Player` 时，客人受伤会震房主的屏、客人死亡会结束房主的局。
- `WallNuts` 构造时 `this.player = ctx.player`（`WallNuts.js:33`），并直接 `ctx.hud.showBanner`（`:148`）。双人需要**每个玩家一份盾状态**，但改动清单里没有 `WallNuts.js`。
- `Player.update` 本地回血/无敌（`Player.js:92-95`）。客人不能用本地回血和房主快照打架，否则血条会来回跳。

---

## 4. P1 详述

### 4.1 不要 30Hz 固定步长

`Game.js:692-696` 现在是：

```js
const raw = this.clock.getDelta();
const dt = Math.min(0.05, raw);
```

固定 30Hz 会把房主自己的鼠标视角量化到 30Hz，还要给房主端再做一层插值；这是一个全系统改造，而它换来的「回放/确定性」你并不需要（只有房主一个模拟器）。**建议：房主继续 rAF + 可变 dt，只把快照按 15–20Hz 发。**

### 4.2 0.4m 校正阈值与 100ms 缓冲

15Hz 下 4.5 m/s 每帧走 0.3m，0.4m 阈值几乎不触发，客人可能「隔空挨打」（房主按旧位置判僵尸攻击）。建议输入重放，或阈值降到 0.15–0.2m。

100ms 插值缓冲在 Wi-Fi 下够，4G 抖动下偏紧；20Hz 快照 + 100ms，或 15Hz + 150ms。用 §8 的实验 A 决定。

### 4.3 快照体积

按文档字段名，14 只僵尸约 1.1–1.3KB/帧（`{id,type,x,z,yaw,hp,state}` 每条约 70–80B），15Hz ≈ 17–20KB/s，不是 700B / 10KB/s。短键 + 两位小数可以接近 700B；**预算按 20KB/s 写，别按 10KB/s**。仍然不是问题，8 场约 320KB/s。

### 4.4 断线提示与 host 切后台

「超过 120ms 就冻结并显示连接中断」对 GC/切后台太敏感，1–2s 迟滞。host 的 `visibilitychange` 应该**立即**广播 pause，而不是等 10s；iOS 可能在 10s 内就回收页面。

### 4.5 共享阳光把同步 bool 变成跨端请求

`Game.spendSun(n)`（`Game.js:575`）是同步返回 bool，`WeaponSystem` 有三处直接依赖（`901/1003/1144`）。客人续弹/开盾要走房主，不能保持同步：

- 方案 A：客人本地预测扣款，房主回 `sunAck` / `sunReject`，拒绝时回滚。
- 方案 B：房主按波给客人一个额度，额度内本地扣，超额再请求。

不选一个，客人打空换弹会卡一个 RTT。

### 4.6 公网服务器加固

已经有 `maxPayload: 64KB`（`server/index.js:58`）、`MAX_MESSAGE`（`protocol.js:12`）、30s WS heartbeat（`server/index.js:104`），这是好的。还缺：

- per-IP 连接数 / hello 频率限制；否则 8 个连接就能把 `MAX_MATCHES` 占满。
- `Origin` 校验（如果游戏仍在 GitHub Pages，WS 在 VPS）。
- 结算 JSONL 的 fsync / 轮转保留策略。

### 4.7 部署二选一

AGENTS 写的是 GitHub Pages；§9.4 是 VPS 单进程同时托管静态资源与 WS。二选一：

- 保留 Pages：`VITE_NET_URL` 在 Pages workflow 注入；服务端校验 Origin；CORS 不涉及 WS，但 HTTP API 要处理。
- 全搬 VPS：Pages workflow 作废，游戏与 WS 同源，最省心。

### 4.8 覆盖率门槛

`vitest.config.js:114-119` 是语句/行 98%、分支 89%、函数 97%。`src/net/*` 的重连、定时器、异常分支很难达到。建议：

- `NetClient` 的 WebSocket 用 `wsFactory` 注入（现在已经支持），把传输层单测做满；
- 或把纯逻辑（`protocol` / `interpolate` / `scoreSplit` / `matchmaker`）与浏览器适配层分开，后者只由 E2E 覆盖。

---

## 5. 数值复算

| 项 | 文档 | 复算 | 结论 |
| --- | --- | --- | --- |
| 快照带宽 | 14 只 ≈700B，15Hz ≈10KB/s | 约 1.1–1.3KB/帧，17–20KB/s | 预算改 20KB/s；带宽仍不是瓶颈 |
| 双人总血量 | 总 HP ×2.25 | `countMul 1.5 × hpMul 1.5 = 2.25` | 与文档一致 |
| 人均压力 | ×1.12 | 总 DPS ×2 → 2.25/2 = 1.125 | 与文档一致 |
| 阳光收入/伤害 | 收入 ×1.5 | 弹药消耗 ∝ 总 HP ×2.25 → 每点伤害的阳光收入 ×0.667 | 特殊武器更紧 33%；豌豆免费保底，不会死锁 |
| 回退缓冲 | 250ms | 30Hz × 0.25s = 7.5 → 8 帧/僵尸 | 14 只约 4KB，可忽略 |
| 阳光球池 | 未提 | 池 28（`SunOrbs.js:7`），双人击杀密度 ×1.5 | Boss 波可能静默丢球，提到 ~40 |
| 暂停 | §8.2 | 当前 `document.hidden` 立即暂停（`Game.js:220`），文档写 >10s | 统一成一个值 |

---

## 6. 协议修订草案（v1.1）

> 目标：不改「房主权威 + 盲中继」，只把字段补齐。JSON 够用，先不换二进制。

### 6.1 服务端 → 客户端

```text
welcome {
  matchId, seat, host, state, mapId, seed, t0, peer,
  joinToken?            // 仅等待中的 host 拿到，写进分享 URL
}

resync {                // guest 重连时由 host 生成，服务器转发
  wave, waveState, sun, scores:{A,B}, bossHp, bountyId, dropId,
  players:[{ seat,x,y,z,yaw,pitch,hp,down,score,weapon,ammo,shieldHp,shieldActive }],
  zombies:[{ id,type,x,y,z,yaw,hp,state,attackT }],
  orbs:[{ id,x,y,z }],
  pickups:[{ id,index,x,z }]
}

snap {
  seq, t, wave, waveState, sun, bossHp, bountyId,
  z:[{ id,t,x,y,z,yaw,hp,st,at }],
  p:[{ s,x,y,z,yaw,pitch,hp,down,sc,w,a,sh }]
}

evt { type, ... }       // kill / pickupGone / orbGone / bounty / drop / revive / hurt
```

### 6.2 客户端 → 房主

```text
input { seq, m:[x,z], look:[dy,dp], jump, fire, shield, down }
hit   { zid, seq, weapon, dir:[x,y,z] }
claim { kind:'orb'|'pickup'|'drop', id, seq }
revive{ target, seq }
```

### 6.3 房主 → 客户端

```text
hitAck  { seq }
reject  { seq, reason }
```

### 6.4 三条硬规则

1. **任何带 `seq` 的请求，都以房主在该 `seq` 的权威世界为准**；客人不能传 origin / hp / dmg / head。
2. **spawn / despawn 走事件，不靠快照里「有没有这只」推断**；否则丢一帧就会让客人把僵尸删了又建。
3. **`resync` 是完整状态，不是增量**；客人重连后先清空本地池再应用，避免旧对象残留。

---

## 7. 外科手术式修复：Keep / Cut / Tune

### 🟢 Keep（保住）

1. **房主权威 + 服务器盲中继**：对这套代码是正确取舍，别改成服务端全量模拟。
2. **15Hz / 100ms / 250ms 的量级**：慢速近战僵尸够用，只需按实验 A 微调。
3. **共享阳光 + 个人战功双账本**：合作与竞争落在不同资源上，是全文最扎实的设计。
4. **反毒性红线**：无友伤、无碰撞、分数只加、补给不加分。
5. **M0 骨架**：协议版本 / build / access、token 座位、45s grace、maxPayload、heartbeat、pause/resume 双向同步，已经跑通。
6. **RemotePlayer 复用**：队友模型、戴夫化、动画、名牌都可直接接网络位置。

### 🔴 Cut（砍掉或推迟）

1. **Cut：30Hz 固定步长**——无回放/确定性需求，收益为负。
2. **Cut：`hit.dmg` / `hit.head`**——伤害必须由房主重算。
3. **Cut：「自动配对是唯一入口」**——join token 优先，FIFO 只做兜底。
4. **Cut：「host 45s 回座」的模糊承诺**——要么本局结束，要么 checkpoint，二选一。
5. **Cut：客人本地 `handleKill`**——只白闪，不结算。
6. **Cut：0.4m 校正阈值**——近战判定太松。

### 🟡 Tune（具体替代值）

| 项 | v2 | 建议 |
| --- | --- | --- |
| 快照频率 | 15Hz | **20Hz**（或 15Hz + 150ms buffer） |
| 插值缓冲 | 100ms | **100ms @20Hz**，实验 A 后可到 150ms |
| 位置校正 | 0.4m / 0.15s | **0.2m / 0.15s**，或输入重放 |
| 回退上限 | 250ms | **250ms 保持**，按 `seq` 回退 |
| 阳光球池 | 28 | **40**（双人击杀密度 ×1.5） |
| `hpMul` | 1.5 | **1.35 先验**，M2 用真实一局复算 |
| 淘汰归队 | 下一波 | **60s 固定复活或清波复活** |
| 再来一局 | 同一 host | **交换 host**，抵消 0 延迟优势 |
| `MAX_MATCHES` | 8 | **8 + per-IP 连接上限** |

---

## 8. 三个必须做的验证实验

### 实验 A：两台真机的 RTT / jitter（1 小时）

- 两台设备：一台 Wi-Fi、一台 4G；同一服务器；开一局 M1，跑 10 分钟。
- 采样：`NetClient.rtt`（2s 一次）→ p50 / p95 / max；同时记录 `snap` 到达间隔。
- 决策：p95 < 80ms → 15Hz + 100ms；80–150ms → 20Hz + 100ms；>150ms → 20Hz + 150ms，并把「连接不佳」做成可见状态。

### 实验 B：命中回退的拒绝率（半天）

- 固定靶 + 横向移动靶各 100 发；用代理注入 50/100/150/200ms 延迟与 ±20ms 抖动。
- 统计 `reject / (hitAck + reject)`，目标 p95 延迟下 **<2%**。
- 如果超标：先加回退窗口（250→300ms），再降插值缓冲；不要直接放宽球体半径，那会把爆头判定一起放宽。

### 实验 C：单人模式零回归（半天）

- 单人启动不建立任何 WebSocket、不加载 `src/net/*`（动态 import 已经做到）。
- `npm test`、`npm run build`、`npm run test:e2e` 全绿。
- 断言 `performance.getEntriesByType('resource')` 里没有 net chunk；`__game.duoSession === null`。

---

## 9. 里程碑验收修订

| 里程碑 | 原验收 | 补上这些才算过 |
| --- | --- | --- |
| **M0** | 3 客户端 → 2 场 + 1 等待；45s 回座 | join token 打开 URL 能加入等待场；host 刷新 = 本局结束；guest 刷新 = 收到 `resync`；5 客户端 → 2 场满 + 1 等待 |
| **M1** | 互相看见移动/开火；地图/暂停同步 | 20Hz 远端插值（视觉误差 <0.1m）；peer left 1s 内冻结；pause/resume 不产生位置跳变；双人不开波 |
| **M2** | 僵尸快照、插值、共享阳光、补给、记分、悬赏 | guest 无权威分支；`hit` 五步校验；同一补给只消失一次；双方分数一致；无本地击杀奖励；无本地阳光 |
| **M3** | 救援、空投、Boss 换仇、结算 | 同时倒地团灭；救援进度双端一致；结算 ledger 与过程上报一致 |
| **M4** | systemd/Caddy/JSONL/排行榜 | 断网 30s 恢复；服务器重启战绩不丢；`/api/health` 能看到 matches/waiting/players |

---

## 10. 当前工作区实装对照（M0/M1）

> 状态：`src/net/`、`server/`、`Game.js` 双人分支均未提交；新增 5 个测试文件 47 例已通过（2026-10-30 本地验证）。设计稿头部「联网未实现」已过期。

### 10.1 已经做到的

- `protocol.js`：版本 / build / access / token / mapId 校验，64KB 上限，名字清洗。
- `NetClient.js`：连接、hello、2s ping、指数退避重连、token 持久化、`wsFactory` 注入（可测）。
- `DuoSession.js`：welcome/queue/peer/start/map/relay/end/error 路由，pause/resume 双向同步，动态 import。
- `server/matchmaker.js`：FIFO 等待、token 回座、45s grace、MAX_MATCHES、WAIT_TTL、host 改图。
- `server/index.js`：HTTP 静态 + `/api/health` + WS upgrade + maxPayload + 30s heartbeat。
- `Game.js`：双人出生点、`RemotePlayer` 生成、`applyRemoteState`、暂停同步、重连横幅。
- `RemotePlayer.js`：Farmer 戴夫化、帽/胡/枪、动画、名牌、blob 阴影。

### 10.2 与设计稿的偏差（按严重度）

| # | 偏差 | 位置 | 影响 |
| --- | --- | --- | --- |
| 1 | M1 发的是**绝对位置**（20Hz），不是输入 | `DuoSession.js:158-162` | M1 可以；M2 若沿用就是客户端权威，和设计稿相反 |
| 2 | `applyRemoteState` 直接 `setTransform`，无插值 | `Game.js:436-445`、`RemotePlayer.js:402` | 20Hz 抖动；应现在就把 100ms 缓冲做进 RemotePlayer |
| 3 | `onPeerLeft` 只弹横幅，不冻结 | `Game.js:447-449` | 与 §8.2「冻结 + 45s」不符；队友掉线时僵尸继续打 |
| 4 | `startDuo` 调 `resetRun()`，不 `startWave` | `Game.js:406-422` | M1 故意的；但 host 刷新会重置，guest 世界不动，必分叉 |
| 5 | `document.hidden` 立即暂停 | `Game.js:220` | 文档写 >10s；对 host 反而应该更早广播 |
| 6 | UI 写「把网址发给朋友」，协议无 join | `DuoSession.js:61/82/90` | 当前就是错的；见 §3.5 |
| 7 | `Game.update` 无 guest 分支 | `Game.js:636` | M2 开波即双份模拟；见 §3.6 |
| 8 | `welcome` 有 `state`，但重连不发世界 | `DuoSession.js:106-112` | 「已重连」只是座位；见 §3.3 |
| 9 | 设计稿状态写「联网未实现」 | 文档头部 | 应改为「M0/M1 已落地（未提交）」 |

### 10.3 结论

这个 M1 是**好的垂直切片**：配对、中继、双人出生、队友模型都能跑，47 例单测也覆盖了协议与配对。但它同时是**危险的模板**：绝对位置上报、无插值、无权威分支、无 resync，这四条如果被带进 M2，会比从头写更难改。

建议把它明确标成 **spike**，在 M2 前做三件事：给 `RemotePlayer` 加插值缓冲、给 `Game.update` 加 guest 权威分支、把 `hit` 协议换成 §6.2。

---

## 11. 最终结论

**架构选型：通过。协议层：不通过。**

按优先级：

1. **P0-5（join token）**：10 行服务端 + 5 行客户端，先修，因为当前 UI 已经在骗人。
2. **P0-3（resync / host reload）**：决定 v1 语义，写进已知限制；guest 重连必须发 `resync`。
3. **P0-1 + P0-2（hit 校验 + seq 回退）**：M2 的核心，先定协议再写业务。
4. **P0-4 + P0-6（快照字段 + guest 权威分支）**：和 M2 一起做，但必须在第一波僵尸前。
5. **P1**：按实验 A/B 的实测值调，不要拍脑袋。

**下一步不是写救援/空投/计分，而是：两台真机 + 一个只同步「两名玩家 + 僵尸位置」的垂直切片，把 RTT、拒绝率、校正频率测出来。** 这三组数出来之前，M2 的任何数值都是猜的。
