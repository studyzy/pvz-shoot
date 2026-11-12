# 双人联机网络手感优化 · 调研与方案

> 状态：调研完成，方案待实施（2026-11-01）  
> 范围：双人模式中 **guest（后加入者）** 的卡顿、回弹、僵尸抖动；单人模式不受影响  
> 关联：[DESIGN-duo-online.md](./DESIGN-duo-online.md) §9.2 同步参数

---

## 0. 一句话结论

guest 卡顿的主因不是手机渲染，而是 **guest 的本地预测被 host 的延迟位置反复拉回**，叠加 **僵尸快照 20 Hz 直接 snap、没有插值**。pstate 体积超出设计预算、没有背压，会把这两个问题在 Wi-Fi 抖动时放大。

同级别手机下，host 反而更重：host 要跑僵尸 AI、流场、分离、权威结算；guest 跳过这些权威分支。因此“只有后加入的那台卡”更像网络手感问题，而不是设备性能差异。

---

## 1. 现象与先排除项

### 1.1 现象

- 双人模式，两台手机。
- host（先加入，seat 0）相对正常。
- guest（后加入，seat 1）出现：
  - 走路像被拽住 / 回弹；
  - 僵尸移动一顿一顿；
  - 快速转身或连续移动时更明显；
  - 网络差时整局像慢半拍。

### 1.2 先排除

1. **两台真机、各自前台**。同一台设备开两个标签页时，第二个标签页会被 Safari 降频，不能作为双人性能结论。
2. 在 guest 控制台看：
   - 帧率；
   - `__game.renderer.info.render`（draw call / 三角面）。
3. 如果 FPS 正常（≥ 50）但移动/僵尸抖，才是网络层；如果 FPS 也低，先查设备、场景和分辨率。

### 1.3 环境层

- 双人服务器尽量跑在有线网络的机器上；两台手机优先 5 GHz。
- WebSocket 走 TCP，Wi-Fi 丢包会队头阻塞；pstate 越大、发送越密，抖动越明显。

---

## 2. 代码路径

guest 每帧（`src/Game.js:1499` 起）：

```text
controls.update()
player.update()                 // guest 本地预测，立即响应
weapons.update()                // 本地开火；命中远端僵尸只白闪
zombies.update()                // 远端分支只播动画，不做 AI
projectiles.update()
pickups.update()
remotes.update()
duoSession.update()             // guest 30 Hz 发 input；host 20 Hz 发 pstate
```

pstate 通过 WebSocket 异步到达，进入 `Game.applyPeerState()`（`src/Game.js:670`）：

```text
applyRemoteState(d.h)           // host 玩家 → RemotePlayer
applyGuestAuth(d.g)             // host 侧的 guest 代理 → guest 本地玩家（位置校正）
applyWorldState(d)              // 波次 / 僵尸快照 / Boss 血条
sunOrbs.applyNet(d.o)
```

关键点：

- guest 的**自身位置**由本地预测决定，但每个 pstate 又被 host 代理位置校正。
- guest 的**僵尸位置**只来自 host 快照，本地不跑 AI。
- host 的 pstate 同时承担“玩家状态 + 僵尸快照 + 波次/阳光/分数/Boss/阳光球/云园状态”。

---

## 3. 根因

### 3.1 自身位置软校正把“延迟”当成“位置错误”（主因）

代码：`src/Game.js:970` `applyGuestAuth()`

当前逻辑：

```js
const err = Math.hypot(x - p.pos.x, z - p.pos.z);
if (err > 1.5) {
  // 直接吸附
} else if (err > 0.2) {
  // 每个 pstate 拉回 35%
  p.pos.x += (x - p.pos.x) * 0.35;
  p.pos.z += (z - p.pos.z) * 0.35;
}
```

问题：

- 死区只有 **0.2 m**；
- 每个 pstate 直接拉回 **35%**；
- pstate 约 20 Hz（host 掉到 45 fps 时实际约 15 Hz）。

guest 的本地位置天然比 host 代理超前一个：

```text
输入发送延迟 + host 处理延迟 + pstate 间隔 + 一帧
```

通常 **50–100 ms**。按 4.5 m/s 走，正常误差就是 **0.22–0.45 m**，已经超过 0.2 m 死区，于是**每个快照都触发回拉**。

按当前算法做的简化模拟（20 Hz pstate、持续前进、host 代理是 guest 的延迟副本）：

| guest 与 host 代理的时间差 | guest 实际移速 | 相对单人 |
| --- | --- | --- |
| 20 ms | 4.5 m/s | 100% |
| 40 ms | 3.7 m/s | 82% |
| 60 ms | 2.9 m/s | 65% |
| 100 ms | 2.5 m/s | 55% |

> 这是算法级模拟，不是真机抓包；真实值受加速度、碰撞、帧率影响，但方向明确：**延迟越大，guest 被拽得越狠**。

设计稿 `docs/design/DESIGN-duo-online.md:384` 写的是 0.2 m / 0.15 s，并注明 0.4 m“几乎不触发”。在真实 Wi-Fi 的 50–100 ms 总延迟下，0.2 m 太小；**0.4–0.8 m 才是合理死区**。

### 3.2 僵尸快照没有插值，20 Hz 直接 snap

代码：

- `src/entities/Zombie.js:1442` `applyNetState()`
- `src/entities/ZombieManager.js:433` `netSnapshot()`

当前逻辑：

```js
this.root.position.set(s.x, s.y, s.z);
this.root.rotation.y = s.yaw;
```

问题：

- 每 50 ms 直接跳到最新位置，没有前后快照插值；
- 4.5 m/s 的僵尸每包移动 **0.225 m**；
- 60 fps 下表现为“停 3 帧、跳 0.225 m”，近距离非常明显；
- host 掉到 45 fps 时，`DuoSession.js:283` 的 `sendAcc = 0` 会让 pstate 实际只有约 **15 Hz**，跳变更大。

设计稿 `docs/design/DESIGN-duo-online.md:382` 明确写了 **“客人插值 100 ms @ 20 Hz”**，但代码里没有实现。

### 3.3 pstate 体积超预算，且没有背压

当前 `Zombie.serialize()`（`src/entities/Zombie.js:1405`）包含 24 个字段，包括：

```text
id, t, x, y, z, yaw, hp, st, sl, bo, co, ab, sp,
sk, kt, kx, kz, ys, kc, kd, kh, ks, ka, ar
```

按这些字段构造 14 只僵尸的 pstate 样本，实测：

| 项 | 当前 | 设计预算 |
| --- | --- | --- |
| 单包 | 约 3.3 KB | 1.1–1.3 KB |
| 20 Hz | 约 65 KB/s | 约 25 KB/s |

> 这是按当前字段构造的样本，不是真机抓包；但字段数量与序列化逻辑一致，量级可信。

多出来的主要是森林 / 云园加入的技能、护甲、停机、报时等字段，以及每包重复的 `t`、`bo`、`co`。

更关键的是：`src/net/NetClient.js:140` 的 `send()` 没有检查 `ws.bufferedAmount`，服务端 `server/matchmaker.js:284` 也只是原样转发。Wi-Fi 一抖，TCP 排队，input 和 pstate 一起延迟，第 3.1、3.2 条会被放大成“卡成幻灯片”。

### 3.4 次要：host 代理落后一个 RTT，命中位姿偏旧

- host 的 `netGuest` 是根据延迟到达的 input 模拟的，位置比 guest 本地落后约一个 RTT；
- 僵尸 AI 追的是这个旧位置；
- `applyGuestHit()` 用的是 host **当前**代理位姿做视线锥和射线，不是 guest 开火那一刻的位姿；
- 快速转身时，guest 明明瞄准了，host 可能判偏。

这不是“卡”的主因，但会让整体手感“慢半拍”。

---

## 4. 方案

### P0-0：先加观测（不改手感）

目标：在两台真机上拿到可量化数据，避免盲调。

建议加一个 `?netdebug=1` 面板（默认关闭，不影响玩家）：

- RTT（`NetClient.rtt`）；
- pstate 大小 / 频率 / p50/p95 到达间隔；
- `ws.bufferedAmount`；
- guest 位置校正次数、平均/最大误差；
- 插值缓冲深度；
- FPS / draw call。

同时暴露 `__game.netStats`，方便无头脚本读取。

**验收**：能回答“这台 guest 是网络抖、校正拖、还是渲染掉帧”。

---

### P0-1：自身位置改成“同一 input seq 对账”（先做）

核心思路：**不要把 host 的当前坐标和 guest 的当前坐标直接比**。拿 host 在 guest 最后一次 input 那一刻的坐标，和 guest 本地**同一个 seq** 的坐标比，误差里就不再包含 RTT。

实现：

1. host 在应用 input `seq` 的那一帧记录一次代理坐标：

   ```text
   g.ack = { seq, x, y, z }
   ```

   之后不要用同一 seq 的后续帧覆盖；等下一个 input seq 到来再更新。

2. guest 在 `sendInput()` 时把本地 `player.pos` 按 seq 存进最近 60 条历史。

3. `applyGuestAuth()`：

   ```text
   ack = localPosHistory[g.ack.seq]
   err = g.ack - ack
   err < 0.3 m      → 不动
   0.3–3.0 m        → 约 0.25 s 平滑拉回
   > 3.0 m          → 吸附（重生/传送/掉平台）
   ```

4. 正常走路时误差接近 0，不再每包被拽；真正被僵尸挡住、掉下平台时才校正。

**止血版**（如果先不改协议）：

- 死区提到 **0.8 m**；
- 去掉“每包 35%”的瞬时拉回，改成限速回拉（例如最高 2.5 m/s）；
- 仍然只在误差 > 3 m 时吸附。

**顺带修定频**：

- `DuoSession.update()` 里 `sendAcc = 0` / `inputAcc = 0` 改成 `-= 0.05` / `-= 1/30`；
- 45–50 fps 手机上，现在 input 实际只有 22–25 Hz、pstate 约 15 Hz；减法定频能把平均频率拉回目标值。

**涉及文件**：

- `src/Game.js`
- `src/net/DuoSession.js`
- `src/net/protocol.js`（如果给 `g` 增加 ack 字段）
- `tests/unit/game-duo.test.js`
- 新增 `tests/unit/duo-netcode.test.js`

**测试**：

- 模拟 100 ms 延迟 + 20 Hz pstate，guest 持续前进 3 s，平均移速 ≥ 单人的 95%；
- 构造真实位置偏差，确认仍会平滑拉回；
- 超过 3 m 确认吸附；
- 无 ack 字段时回退到大死区逻辑，不崩。

---

### P0-2：僵尸快照插值（必做）

实现：

1. 每只远端僵尸保留最近 3–4 个快照，记录到达时间：

   ```text
   netBuf = [{ t, x, y, z, yaw }, ...]
   ```

2. 渲染时间取：

   ```text
   renderAt = now - 100~120 ms
   ```

3. 在前后两个快照之间线性插值 `x/y/z`，`yaw` 走最短弧。

4. 新快照迟迟不到时最多外推 150 ms，之后保持；超过 8 m 的跳变直接吸附。

5. `applyNetState()` 继续立即应用：

   - 血量；
   - 动画状态 `st`；
   - 减速 `sl`；
   - 技能状态；
   - 护甲。

   **只把位置/朝向放进插值缓冲**。

6. 命中 / 敲钟请求的 `seq` 改成“当前渲染对应的较旧快照 seq”；host 的 `history` 从 20 包增加到 30 包。

7. guest 本地的玩家-僵尸碰撞建议用**最新快照位置**，只有渲染用插值位置，避免本地碰撞和 host 差得更多。

**涉及文件**：

- `src/entities/Zombie.js`
- `src/entities/ZombieManager.js`
- `src/Game.js`
- `src/net/DuoSession.js`
- `tests/unit/duo-authority.test.js`

**测试**：

- 两个快照间隔 100 ms，渲染时间在中点时位置为中间值；
- 重复 seq / 乱序包不会把位置拉回；
- 快照断流时外推有上限，之后保持；
- 渲染 seq 与命中请求的 `seq` 一致；
- 现有“applyPeerState 后立即等于快照坐标”的断言按插值语义改写。

---

### P0-3：pstate 降载与背压

按收益从高到低：

1. **pstate 从 20 Hz 降到 15 Hz**（有插值后完全够；设计稿 §9.2 也把 15 Hz 列为可调值）。
2. **去掉每包重复的静态字段**：
   - `t` 只在 `zspawn` / `resync` 发；
   - `bo`、`co` 只在变化时发；
   - 其余字段按 0.05–0.1 量化。
3. 目标：14 只僵尸 **≤ 35 KB/s**，先做到设计预算的 1.5 倍以内。
4. **背压**：
   - `NetClient` 暴露 `bufferedAmount`；
   - host 发现堆积超过 24 KB 就跳过这一帧 pstate，input 不受影响；
   - 可选：服务端在接收方 `bufferedAmount` 过高时丢弃旧 pstate，避免延迟越积越大。
5. 复用序列化对象/数组，减少 host 每包 `map` 产生的 GC 抖动（次要）。

**涉及文件**：

- `src/net/DuoSession.js`
- `src/net/NetClient.js`
- `server/matchmaker.js`（可选）
- `tests/unit/duosession.test.js`

**测试**：

- 14 只僵尸样本 pstate 小于目标字节数；
- `bufferedAmount` 超阈值时不发 pstate、但 input 正常发；
- 15 Hz 下插值仍然平滑（配合 P0-2）。

---

### P1-1：guest 位置上报（推荐实测后再定）

在 `input` 里加：

```text
p: [x, y, z]
yaw
```

host 做限速校验：

- 位置必须有限、在地图边界内；
- 与上一次代理位置的位移不超过 `7 m/s × 时间 + 0.8 m`；
- 合法就把 `netGuest` 位置向上报值靠拢（或直接设置）；
- 僵尸 AI / 仇恨 / 命中都用这个位置。

收益：host 代理不再落后一个 RTT，僵尸反应和 guest 屏幕能对上。

代价：**移动权威从 host 让给 guest**。PvE 双人、朋友局可以接受，但要加限速/边界校验；如果要求严格 host 权威，就不做这一条，只用 P0-1 的对账 + 大死区。

---

### P1-2：命中用“开火时”的位姿

`hit` 包加 `iseq`（guest 最后一次 input seq），host 保存 300 ms 的 guest 位姿历史，用开火时的位置 / yaw / pitch 做锥形和遮挡校验，而不是当前代理位姿。

解决：

- 快速转身时“明明瞄准了却判不中”；
- RTT 大时命中射线起点偏移。

**涉及文件**：

- `src/net/DuoSession.js`
- `src/Game.js` `applyGuestHit()`
- `tests/unit/duo-hit.test.js`

---

### P2：感知层与收尾

- guest 本地命中先做白闪/伤害数字，血量等 pstate 覆盖；击杀仍等 host。
- `netSpawn` 创建僵尸分帧（每帧最多 2–3 只），避免 resync/大波次时一次性克隆 14 个模型造成掉帧。
- 插值延迟按抖动自适应：100 ms 起步，p95 间隔大时升到 150 ms。
- 森林/云园的高频技能字段如果仍占体积，再考虑按“变化才发”的 delta 编码，不要一上来就上二进制协议。

---

## 5. 验收标准

### 5.1 手感

- 两台真机、各自前台，guest 按住前进 3 秒，平均移速 **≥ 单人 95%**；
- 行走中位置校正 **< 1 次/秒**；
- 僵尸运动无可感知的 20 Hz 台阶；
- 单帧位移不超过 `速度 × dt × 1.5`。

### 5.2 网络

- 14 只僵尸时 pstate **≤ 35 KB/s**；
- p95 到达间隔 ≤ 80 ms；
- `bufferedAmount` 常态 < 8 KB，不持续增长；
- 150 ms 模拟延迟下不出现“走一步退两步”。

### 5.3 命中

- 快速转身（180°/s）射击不再被锥形校验误拒；
- 命中白闪即时，血量在 RTT + 50 ms 内更新；
- 击杀仍以 host 为准，不出现 guest 本地先删僵尸。

### 5.4 回归

- `npm test` 全绿；
- `npm run test:coverage` 不低于现有门槛（语句/行 98%、分支 89%、函数 97%）；
- `npm run test:e2e` 全绿；
- `npm run build` 通过；
- 单人模式无网络模块加载、无行为变化。

---

## 6. 测试计划

### 6.1 单元测试

新增 `tests/unit/duo-netcode.test.js`：

- 同 seq 对账：延迟 100 ms 时不产生回拉；
- 真实偏差：被僵尸挡住 / 掉平台时仍会校正；
- 大误差吸附；
- 快照插值：中点、乱序、断流、外推上限；
- 渲染 seq 与命中 seq 一致；
- pstate 字节数预算；
- `sendAcc` / `inputAcc` 在 45 fps 下平均频率正确。

### 6.2 集成 / 模拟

- 用两个 `Game` 实例 + 假 WebSocket 中继，注入 60/100/150 ms 延迟，跑 3 秒直行；
- 断言 guest 位移、校正次数、pstate 数量；
- 现有 `tests/unit/duo-authority.test.js`、`game-duo.test.js`、`duo-hit.test.js` 按新语义更新。

### 6.3 真机验收

- 两台同级别手机，同一 Wi-Fi；
- 后院 / 森林 / 云园各一局；
- 1 只、8 只、14 只僵尸；
- 记录 guest 的 RTT、pstate KB/s、校正次数、FPS、draw call；
- 再用手机热点（4G/5G）重复一次，确认弱网下是“延迟可感知但不回弹”，而不是“卡死”。

---

## 7. 风险与不采纳方案

### 风险

- 插值会改变 guest 看到的僵尸位置，命中 `seq` 必须同步改，否则会出现“打不中”；
- guest 玩家-僵尸碰撞用最新快照、渲染用插值位置，需要确认不会造成新的漂移；
- P1-1 改变移动权威，需要防瞬移/超速校验；
- 新增分支会拉低覆盖率，必须同步补测试；
- 降低 pstate 频率会增加插值延迟，需要真机确认 15 Hz 是否够。

### 不采纳（本轮）

- **WebRTC / UDP 重写**：改动大，先用 P0 排除 TCP 排队是否为主因；
- **服务端权威模拟**：Node 端要跑完整游戏逻辑，成本过高；
- **两人各模拟一半僵尸**：AI、仇恨、计分、Boss 协调复杂，只有未来做对称竞技才值得；
- **固定步长 lockstep**：当前 AI 有随机与大量状态，不适合。

---

## 8. 实施顺序与待定决策

建议顺序：

1. **P0-0 观测面板**；
2. **P0-1 止血版**（大死区 + 限速回拉 + 定频），先让 guest 能正常走；
3. **P0-2 插值**，解决僵尸抖动；
4. **P0-1 正式版**（同 seq 对账）；
5. **P0-3 降载/背压**；
6. 根据真机数据决定 **P1-1 / P1-2**。

### 待定决策

**guest 自身位置要不要允许“客户端上报、host 限速校验”？**

- 允许：最跟手，host 代理和僵尸 AI 能对齐；
- 不允许：保留严格 host 权威，用 P0-1 对账 + 0.8 m 死区，接受 host 代理落后一个 RTT。

在拿到两台手机的 `netdebug` 数据前，建议先不放开移动权威。
