# AGENTS.md — 二次开发指南

面向接手本仓库的 AI Agent 与开发者。读完这一份，应该能在不踩坑的情况下改代码。
玩家向的数值与图鉴见 [docs/GAMEPLAY.md](docs/GAMEPLAY.md)。

---

## 1. 项目速览

- 纯 Web 的 3D 第一人称射击：玩家是戴夫，手持植物打僵尸；iPhone / iPad / 桌面浏览器均可玩。
- 进入游戏先选地图：**后院**（经典草地）与 **雪地**（致敬 CS 的 fy_iceworld）；雪地上散落着可拾取的植物武器。
- 技术栈：Vite 8.3 + Three.js 0.169，原生 ES Module，**没有 TypeScript、没有外部 CDN**。单人模式是纯静态站；双人模式额外跑一个 Node WebSocket 服务器（`server/`，只做配对/中继/重连）。
- 入口：`index.html` → `src/main.js` → `src/Game.js`。所有系统在 `Game` 构造函数里组装。
- 运行：

```bash
npm install
npm run dev       # 会打印局域网地址，手机/iPad 同 Wi-Fi 直接访问
npm run build     # 输出 dist/，纯静态，可放任意静态托管
npm run preview   # 预览构建产物
npm run server    # 双人服务器（默认 8080，同时托管 dist/ 与 /ws）
npm run duo       # build 后直接起双人服务器
```

- **不能用 `file://` 直接打开 `dist/index.html`**：ES Module 与音频权限会被浏览器拦截，必须走 HTTP。
- 构建产物由 `vite.config.js` 的 `base: './'` 支持子路径部署。
- 部署：推送到 `main` 后由 `.github/workflows/deploy.yml` 自动构建 `dist/` 并发布到 GitHub Pages（https://studyzy.github.io/pvz-shoot/）；Pages Source 使用 GitHub Actions，不要提交 `dist/`。**Pages 只跑单人**；双人需要 VPS（`npm run duo`）或在 Pages workflow 注入 `VITE_NET_URL`。
- 测试：`npm test`（Vitest 4 + jsdom，UT + 集成测试，约 15 秒）、`npm run test:coverage`、`npm run test:e2e`（真实 Chromium + WebGL）。写法与约定见 [docs/TESTING.md](docs/TESTING.md)。
- **改代码前先跑 `npm test`，改完再跑一次**；动到数值/结构/地图/UI 时按 TESTING.md 第 3 节补测试。

---

## 2. 目录与职责

| 文件 | 职责 |
| --- | --- |
| `src/main.js` | 启动、创建 `Game`、挂 `window.__game` 调试句柄、启动渲染循环 |
| `gallery.html` | 独立的僵尸图鉴页入口（Vite 多页 `gallery`），主菜单右上角可进入 |
| `src/gallery/main.js` | 图鉴页 Three.js 场景、模型加载/切换、OrbitControls、视角按钮、循环 walk 动画 |
| `src/gallery/presets.js` | 图鉴类型元数据、`MODELS` 高度/相机距离、视角预设、走路速度、数值行 |
| `src/gallery/gallery.css` | 图鉴页样式（桌面左栏 + 手机顶部横条布局） |
| `stress.html` | 独立的性能压测页入口（Vite 多页 `stress`），主菜单右上角「压测台」可进入 |
| `src/stress/main.js` | 压测页 Three.js 场景：按类型/数量批量生成 `Zombie`、FPS/draw call 读数、自动爬坡 |
| `src/stress/metrics.js` | 帧率滑窗、方阵排布、相机取景、爬坡档位等纯计算（单元测试覆盖） |
| `src/stress/stress.css` | 压测页样式（读数面板 + 底部控制条，不用 backdrop-filter） |
| `src/Game.js` | 状态机（menu/playing/paused/over）、系统组装、每帧更新顺序、波次回调、阳光/计分、镜头震动、自适应分辨率 |
| `src/config.js` | **所有可调数值**：`TUNING`、`WEAPONS`、`ZOMBIES`、波次公式。改平衡先改这里 |
| `src/world/Arena.js` | 后院场景：地面、栅栏、房子、树、墓碑、割草机、光照与阴影、碰撞体列表 `colliders` |
| `src/world/IceWorld.js` | 雪地场景：按 fy_iceworld 复刻的田字四根 3.6 米高柱、两侧 0.85 米可跳矮墙、两端基地、四角砖台、11.4 米高冰墙与雪山；`platforms` 做落脚/侧碰撞、`colliders` 给僵尸绕行 |
| `src/world/DustYard.js` | 沙城场景：动线致敬 de_dust2（南广场 → B 长廊 / 中路 / 长 A 三线，中段由 B 门与 A 短道互通 → 北横道 → A、B 点与 CT 出生点），几何与配色全部自绘；`solid()` 统一生成盒体 + `platforms` + 僵尸用圆形 `colliders` |
| `src/world/FlowField.js` | 1 米网格流场（BFS）：`blockPlatforms()` 标记障碍、`update()` 按玩家位置重算、`flowAt()` 给僵尸方向；雪地与沙城共用 |
| `src/world/maps.js` | 地图注册表 `MAPS`（菜单元数据）与 `createMaps()`；新增地图从这里挂 |
| `src/world/materials.js` | Toon 材质、程序化草地/雪地/冰面/沙地/天空/沙漠天空/云/光晕/污渍贴图、PMREM 户外环境贴图（`outdoorEnvironment`，支持 backyard/snow/dust） |
| `src/entities/Player.js` | 第一人称移动、跳跃、平台落脚/踏步、碰撞、生命/回血、镜头位置与后坐力 |
| `src/entities/Zombie.js` | 单个僵尸：绑定模型骨架、AI、行走/攻击/死亡动画、受击/减速/掉落回调 |
| `src/entities/ZombieModel.js` | 加载四个外部模型：`zombie.glb`（Quaternius 僵尸，路障/铁桶/气球用）、`skeleton.glb`（KayKit 骷髅）、`alchemist.glb`（炼金模型，**普通僵尸**用）、`football.glb`（AIGC 橄榄球模型）；导出 `zombieModel` 就绪标志、`MODELS` 缩放表与 `findClip()` |
| `src/entities/ZombieManager.js` | 波次生成、分离、范围伤害、击杀结算、Boss 跟踪、阳光掉落数量 |
| `src/entities/WallNuts.js` | **坚果免伤盾**：玩家身上的一个状态（不是场景实体）。`absorb()` 拦伤害、盾血/破盾动画、罩壳跟随 |
| `src/entities/SunOrbs.js` | 阳光球池、弹跳、磁吸、拾取 |
| `src/entities/WeaponPickups.js` | 地面植物拾取物池：开局在随机点位刷 1 个、发光/名称牌、靠近自动拾取；一关内每个点位只出一次，不无限刷新 |
| `src/weapons/WeaponSystem.js` | 手持植物视图模型、瞄准辅助、开火、切枪、**角色槽（peaGun/gun/demo/grenade/shield）**、手雷蓄力、后坐/摇摆、命中判定入口 |
| `src/weapons/ProjectileSystem.js` | 豌豆池、樱桃抛物线、爆炸、爆头判定 |
| `src/fx/Particles.js` | InstancedMesh 粒子池、爆炸球壳/冲击环、临时点光源 |
| `src/audio/Sfx.js` | WebAudio 音效：开火/命中/僵尸吼叫走 CC0 采样（`SAMPLES` 表驱动），UI 提示音仍用 `tone()` / `noise()` 合成 |
| `src/fx/audio.js` | 采样素材的内嵌出口（导出名占位，构建时由 `vite.config.js` 的 `embed-audio` 插件填入 `public/audio/*.wav` 的原始字节） |
| `public/audio/` | 16 个 CC0 音效（`gun1/gun2/boom/bp/z1..z6/pop1/slime/slime2/splash5/bubble/freeze`）+ `LICENSE-audio.txt`（来源、裁剪参数、许可）；只有这份和 `src/fx/audio.js` 会被打进包里 |
| `src/input/Controls.js` | 键鼠 + 触屏输入、平台识别、虚拟摇杆、指针锁定 |
| `src/ui/HUD.js` | DOM HUD、**5 个角色槽底栏**、蓄力条、横幅、命中标记、开始/暂停/结算界面 |
| `src/style.css` | 全部界面样式与响应式/安全区适配 |
| `public/models/` | `zombie.glb`（660 KB：7.8k 三角面、50 骨骼、16 段动画）+ `skeleton.glb`（1.4 MB：5.3k 三角面、41 骨骼、13 段动画）+ `alchemist.glb`（1.3 MB：1 万三角面、22 骨骼、5 段动画）+ `football.glb`（1.4 MB：1 万三角面、22 骨骼、5 段动画）+ `farmer.glb`（1.3 MB：3.7k 三角面、24 段动画，队友用）+ `LICENSE-*.txt`，构建时原样拷贝到 `dist/models/`。**普通僵尸用 alchemist，橄榄球用 football，其余地面僵尸用 zombie；队友用 farmer** |
| `src/net/protocol.js` | 双人消息类型、版本、名字/token/地图/relay 清洗（客户端与服务器共用） |
| `src/net/NetClient.js` | 浏览器 WebSocket：hello、token（`sessionStorage`，同一浏览器两个标签页不串号）、心跳/RTT、断线重连 |
| `src/net/DuoSession.js` | 双人会话状态机：自动配对消息 → `Game.startDuo` / `applyRemoteState` / `pause` / `endDuo` |
| `server/matchmaker.js` | waiting FIFO、多场并发、座位、重连窗口、中继、结束清理 |
| `server/index.js` / `static.js` | HTTP 静态托管 + `/ws` 升级 + 心跳 + `/api/health` |
| `server/README.md` | 服务器启动、环境变量、systemd/Caddy 部署 |
| `docs/design/DESIGN-duo-online.md` | 双人玩法设计稿（M0/M1 已实现，M2 僵尸同步未开始） |
| `docs/GAMEPLAY.md` | 玩家向完整数值文档；**改数值后同步更新** |

---

## 3. 运行顺序与坐标系

### 每帧更新顺序（`Game.update`）

1. `controls.update()` — 汇总键盘移动向量
2. `player.update()` — 读取视角增量、移动、跳跃、碰撞、回血
3. `player.applyCamera(camera)` — 写入相机位置与旋转
4. `applyShake()` — 叠加镜头震动
5. `weapons.update()` — **必须在这里**：用当前帧相机做瞄准辅助与开火
6. `zombies.update()` — 僵尸 AI、动画、攻击玩家
7. `projectiles.update()` — 用更新后的僵尸位置做扫掠命中
8. `sunOrbs.update()` — 磁吸与拾取
9. `pickups.update()` — 地面武器浮起、旋转、靠近自动拾取，以及开局后的随机补刷
10. 远端玩家 `update()` + `duoSession.update()` — 队友动画/影子；双人时按 20 Hz 上报本地位置与开火
11. `particles.update()`
12. HUD 同步（带缓存，避免每帧写 DOM）

> 改顺序前想清楚：武器在相机之后、僵尸之前；弹道在僵尸之后。把武器放到 `player.applyCamera` 前面会导致瞄准偏一帧。

### 坐标与相机约定

- Three.js 右手系；相机默认看向 **-Z**。玩家 `yaw = 0` 面向 -Z，`yaw` 减小 = 向右转。
- `player.pos` 在**脚底**；眼睛高度 = `pos.y + 1.66`；脚底高度由地图 `platforms` 采样，走出平台会下落。
- 相机 `rotation.order = 'YXZ'`；俯仰限制 ±1.42 rad。
- 武器视图模型是 **相机的子节点**（`weapons.root`），近裁剪面 0.05；位置大约在 `(0.4, -0.3, -0.9)`，缩放 0.6–0.9。
- 僵尸 `root.position` 在脚底，朝向 +Z（`rotation.y = atan2(dx, dz)`）；模型正面朝 +Z。
- 命中球按模型分两套口径（见表 5.3.1）：僵尸胸口 `y = 1.02 × scale`、头部 `y = 1.52 × scale`，半径 `0.46 / 0.36 × scale`；骷髅（含巨型骷髅 Boss）胸口 `0.90`、头部 `1.68`，半径再乘 `hitRadiusScale = 0.8`。见 `Zombie.getChest/getHead` 与 `ProjectileSystem` / `WeaponSystem`。**头部球必须比身体球小**，否则扫掠时头部球总先被碰到，爆头变成“打哪儿都爆头”。

---

## 4. 开一枪的完整数据流

`controls.firing` → `WeaponSystem.update` → `tryFire()` → `ctx.spendSun(cost)`
→ `findAimTarget()`（锥形吸附胸口）→ 生成豌豆 / 抛樱桃 / 即时爆炸
→ `ProjectileSystem` 用 `segmentSphereT` 做扫掠命中 → 比较头部/身体球的 t 值判定爆头（`TUNING.headshotMul`，×3 伤害）
→ `Zombie.hit()`（白闪、减速、死亡）
→ 击杀时 `ZombieManager.handleKill()`（计分 ×1.5 爆头、掉阳光、Boss 清理）
→ `ctx.onKill` → `Game.stats` + HUD。

**弹道方向必须从相机出发，不能从枪口出发。** `models[i].muzzle` 在视图模型里、比准星低约 0.28 米、偏右约 0.25 米，从枪口朝准星打会系统性偏右下（近距离尤其明显），这是"子弹和准星对不上"的老 bug。现在 `tryFire` 里：
- 直线弹种（`kind: 'pea' | 'hitscan'`，没写 `arc`）从 `camera.position` 出发，方向 = 相机或瞄准辅助的解算点，**没有重力**；
- 只有 `arc: true` 的投掷物（樱桃、西瓜）从枪口出手，有重力（`ProjectileSystem.throwCherry` 解算抛物线，落点对着 `c.ground`，飞行时间封顶 1.5 秒）；
- 准星落点统一走 `WeaponSystem.groundRange()`（准星正前方的地面点，水平 2～22 米），玉米炮/辣椒的即时爆炸和投掷物共用，别各写一套。

**撞墙规则**：豌豆撞墙就地消失（`ProjectileSystem.update` 里 `step()` 返回非 0 就回收），投掷物撞墙由 `step()` 返回 1 交给 `stepCherry` 反弹后继续飞、落地（返回 2）才炸。`HitWalls.sweepWalls` 是唯一判定入口，改它要小心 `d[k] === 0` 的轴——那里出过"整个盒子必中"，表现为地图上凭空多出看不见的墙。

爆炸走 `ZombieManager.damageArea()`，按距离衰减（中心 100%，边缘 45%），并在内部完成击杀结算。

地面拾取的植物走另一条线：`WeaponPickups` 检测玩家距离 → `WeaponSystem.pickup(index)` → 按 `def.slot` 进对应的**角色槽** → 立即装备。**枪免费捡，子弹用阳光买**：开火扣弹药；打空后 `tryReload()` 自动扣 `cost × ammo` 续一整梭子，阳光不够则 `locked`（枪不丢，HUD 变暗显示"缺阳光"），攒够后自动续弹。

**角色槽（吃鸡式）**：`slots` 是 `{ peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] }`，每格存武器 index（-1 空）；`activeSlot` 是当前激活的 `{role, pos}`（`null` = 手上这把不在任何槽里）。`pickup()` 的返回值是**「拾取物该不该消失」**：`true` = 拿走了；`false` = 没拿走（豌豆槽拒绝外来武器、或未知武器），此时 `WeaponPickups` **必须让物品留在地上**。同角色**每格只有一个位置**，再捡就顶掉，旧枪清弹药后 `dropAt()` 掉在脚边——**没有替换弹窗**。丢弃走 `dropSlot(role, pos)` → `ctx.pickups.dropAt()`（`Game` 构造里 `ctx.pickups = this.pickups`，漏了这一步丢枪会凭空消失）。

**手雷（樱桃）**是唯一不吃 `tryFire` 那套的武器：`update()` 里走 `updateGrenade()` —— 按住蓄力累加 `this.charge`（封顶 `GRENADE.chargeTime`），松手按比例换算成 4～20 米投掷距离后调 `throwCherry()`。蓄力条由 `HUD.setCharge()` 画（`#chargeBar`）。

---

## 5. 必须遵守的约定

### 5.1 数值

- 植物/僵尸/波次数值**只写在 `src/config.js`**；不要散落到各系统。
- 改完数值同步 `docs/GAMEPLAY.md`，否则文档会骗人。
- 阳光经济（`docs/GAMEPLAY.md` §4）：初始 60、上限 300、每颗 5、未拾取 18 秒消失；掉落数量在 `ZombieManager.handleKill`，天降参数在 `config.js` 的 `SUN_SKY`（30 秒 1 颗，占收入 4~8%，主收入仍是击杀）。
- **豌豆 `cost: 0` 是承重墙**：保证阳光见底时仍有枪可用，不会出现"没钱且打不动"的死锁。不要改成收费。
- **已取消植物栏**：豌豆与坚果是 `starter: true`，分别常驻 1 号枪槽和 5 号护盾槽；其余全部靠拾取、自带弹匣 `ammo`，打空后按 `cost × ammo` 用阳光续弹。坚果不吃 `ammo`，走 `maxCharges`/`recharge` 充能。
- **新增武器必须写在 `WEAPONS` 数组末尾**：战利品与槽位的 index 是按数组下标算的，`tests/unit/weaponsystem.test.js` 里有大量 `pickup(5)`、`equip(7)` 的硬编码下标。往中间插一个会让几十个用例一起红。
- **护甲只写在 `config.js` 的 `ARMOR_MATERIALS` 表里**：`absorption`（吸收比例）、`burnImmune`（燃烧烧不动）、`pierceBlock`（挡穿透）。僵尸用 `armor: { material, hp }` 挂上。不要给某把武器写"对铁桶减伤"的特例——那是这张表推出来的。
- **对空是白名单**：`WEAPONS[].aerial` 不写 = 打不到空中目标；`'explosion'` = 爆炸类；数字 = 伤害倍率（火豌豆 0.25）。判定必须在三处一致：`ProjectileSystem.update`、`WeaponSystem.raycastZombies`、`ZombieManager.damageArea`，漏一处就会出现"玉米炮能打、豌豆也能"的破绽。
- **充能制植物**（目前只有坚果）：`maxCharges` + `recharge`，`WeaponSystem.charges[]` 是浮点（每帧累加），HUD 显示 `Math.floor`。没有 `maxCharges` 的植物恒为 `Infinity`，走原来的路径。
- **战利品一律走 `slots`，不要再用 `carried` / 植物栏**（都已删除）。`slots` 是**按角色分组**的对象 `{ peaGun: [-1], gun: [-1], demo: [-1], grenade: [-1], shield: [-1] }`，每格存武器 index。判断"有没有这把枪"用 `slotIndexOf(index)`（返回 `{role, pos}` 或 `null`），不要看 `ammo[index] > 0`——打空但没丢的枪仍在槽里。
- **槽位由 `WEAPONS[].slot` 决定归属**，五种角色：`peaGun`（豌豆常驻）、`gun`（唯一可换的枪②）、`demo`（大杀器）、`grenade`（手雷）、`shield`（坚果）。**每格只有一个位置**，同角色再捡就顶掉，旧枪 `dropAt()` 掉在脚边。**没有 `replacePrompt` 弹窗**（已删除，别再引回来）。
- **`peaGun` 是承重墙**：豌豆射手开局由 `mountPea()` 装进 1 号枪槽，`pickup()` 拒绝任何其他武器进来，`dropSlot()` 也拒绝把它丢出去。这是"阳光见底仍打得起"的保底，不要为了灵活性放开。坚果由 `mountShield()` 装进 5 号槽，不进地面随机池；少了这一步整局都拿不到盾。
- **数字键映射走 `config.js` 的 `SLOT_KEYS`**（`1→peaGun, 2→gun, 3→demo, 4→grenade, 5→shield`）+ `SLOT_KEY_BASE = 1`，不要在 `Controls` 里写 `n - 7` 之类的算术；丢弃是 `Backspace`。
- **底部植物栏已取消**：`#weaponDock` / `HUD.weaponDock` / `onWeaponSelect` / `Controls.weaponRequest` / `trySwitch` 全部删掉了，别再加回来。5 个角色槽就是唯一的武器 UI（`slot-dock`，桌面竖排在开火上方右侧、触屏横排）。触屏下 `.dock` 是 `inset: 0` 的绝对层，`body.touch .slot-dock` **必须自己定位**。

### 5.2 僵尸模型与材质

- 僵尸是**外部 glb**（Quaternius Zombie_Basic，CC0 1.0）：必须用 `SkeletonUtils` 的 `clone()` 克隆（`import { clone as cloneSkinned }`），**不能用 `scene.clone(true)`**——那样所有僵尸会共用同一套骨骼，14 只一起动。几何体在所有僵尸间共享，**不要 dispose 几何体**，只 dispose 每个僵尸自己的材质（`Zombie.dispose` 遍历 `this.mats`）。
- 每个僵尸克隆一份材质（同一张图集材质），用于白闪（`emissiveIntensity`）和冰冻（`color` 乘色）；贴图仍然全僵尸共享。
- `envMap` 来自 `Game.setMap` 写入的 `ctx.env`（`outdoorEnvironment(renderer, mapId)`，三张地图各缓存一份），`envMapIntensity` 0.35。
- glb **有 50 根骨骼 + 16 段动画**（`Idle/Walk/Run/Idle_Attack/Death/HitReact/Crawl/…`），迈步、攻击、死亡、受击都由 `AnimationMixer` 播真实骨骼动画，不再是顶点着色器假蒙皮。`Zombie.buildAnimations()` 建 `this.actions`，`play(name, fade)` 切动作；`update` 里按 `moving` / `attackAnim` / 死亡状态切换。
- **模型是 Y-up**（脚底 y≈0、面朝 +Z、总高 1.194），不需要 Z-up 换算。走路快慢靠 `mixer.timeScale`（`0.75 + speed × 0.22`，夹在 0.8–1.7），避免脚步打滑。
- 蒙皮网格要关 `frustumCulled`：骨骼动画会让静态包围盒失真，跑动时模型会突然消失。
- 换模型时改 `public/models/zombie.glb` 并同步 `ZombieModel.js` 的 `ZOMBIE_SCALE`（当前 1.55）、以及 `getChest`/`getHead` 的高度和 `ProjectileSystem`/`WeaponSystem` 里的命中半径。
- 配件（交通锥 / 铁桶 / Boss 木棒）是**程序化补回**的：`Zombie.buildHat()` 按 `cfg.acc` 挂一组 `MeshStandardMaterial` 网格。交通锥/铁桶挂 `this.body`，坐标用僵尸模型单位（头顶约 y=1.19，整体高 1.194）；**Boss 的木棒挂在骷髅骨骼 `handslotr` 上**（跟着手臂挥动），坐标用骷髅模型单位。加新配件就在这个函数里按 `acc` 分支。
- 配件材质要同时 `push` 进 `this.mats` 和 `this.matBase`，否则白闪（`applyFlash`）和冰冻（`applyTint`）只会作用在身体上，帽子不跟着变。
- **挂骨骼的配件必须抵掉骨骼链里"多出来"的缩放，且只抵掉它**：`CharacterArmature` 带 100 倍缩放，直接把帽子 `add` 到 `Head` 上几何体会被放大成十米宽的巨物。做法是 `hat.scale = 应得世界缩放 / headBone.getWorldScale()` + 反解四元数（见 `buildHat`），其中**应得世界缩放 = `MODELS[id].scale × scaleFactor`**（配件几何按模型本地单位给，本来就该吃模型缩放和 root 缩放）。曾经直接写成 `1 / getWorldScale()`，把模型缩放也除掉了 —— 交通锥/铁桶只剩身体 1/1.55 大、大半截陷进脑袋里，Boss 木棒同理缩水。
- **护肩这类不跟头动的配件挂 `this.body`，不挂头部骨骼**：挂在头上的护肩会跟着头部抖动，看起来像在耸肩。
- 每个僵尸是 **2 个蒙皮 mesh**（身体 + 眼球）+ 1 个材质（外加一块 blob 阴影），一只僵尸约 2 个 draw call。E2E 实测 14 只同屏：139 draw call / 13.5 万三角面。

### 5.3 glb 规格与压缩

- 当前 `zombie.glb` 来自 **Quaternius Zombie_Basic（CC0 1.0）**：7,822 三角面、2 个蒙皮 mesh（身体 + 眼球）、1 个 `Atlas` 材质 + 1 张 512×512 图集、50 根骨骼、**16 段动画**，660 KB。原始下载是 959 KB / 32 条动画（16 条是 `CharacterArmature|` 前缀重复项），去掉重复动画后重打包到 660 KB。
- **带骨骼模型绝对不能跑 `simplify`**：它会破坏 `JOINTS_0` / `WEIGHTS_0` 蒙皮权重，模型会烂掉。7,822 面本身不高，只做 `resize`（可选）和 `webp` 即可。
- 当前模型的来源与许可留痕见 [docs/ZOMBIE-MODELS.md](docs/ZOMBIE-MODELS.md)：2024-03-17 由 Poly Pizza 以 CC0 1.0 发布，早于 Quaternius QAL v1.0（2026-08-28）生效，按 QAL §7 不溯及既往。**不要换成从 quaternius.com 官方包现下的模型**——那受 QAL §3a「禁止以独立资产形式再分发」约束，本仓库是公开仓库。
- 模型约定：**Y 轴向上、面朝 +Z、脚底在 y≈0**，原始高 **1.194 米**，靠 `ZOMBIE_SCALE = 1.55` 拉到 1.85 米。换模型必须重新确认这四条。
- 加载是**异步**的：`ZombieManager` 在 `zombieModel.ready` 之前不刷怪（`update` 里那个 `&& zombieModel.ready` 判断），别删。

### 5.3.1 骷髅（第二个模型）

- `public/models/skeleton.glb` 是 **KayKit Skeleton_Minion（CC0 1.0）**，一个模型供两个类型用：
  - **`skeleton`（普通骷髅）**：雪地专属精英怪，`scale: 1` → 2.166 × 0.9 ≈ 1.95 米。
  - **`boss`（巨型骷髅）**：`scale: 2.3` → 约 **4.48 米**，三张地图都会出（`SKELETON_MAPS` 只限制普通骷髅，Boss 不受限）。木棒 `acc: 'club'` 挂在骨骼 `handslotr` 上，跟着手臂挥动。
- 模型规格：41 骨骼、13 段动画、5,288 面、原始高 2.166，`SKELETON_SCALE = 0.9`。
- **它的 draw call 是僵尸的 4.5 倍**：身体拆成 9 个独立蒙皮网格，单只 9 个 draw call（僵尸只有 2 个）。所以有两条硬约束，别拿掉：
  - `SKELETON_MAX_ALIVE = 3`：**普通骷髅**的同屏上限（Boss 每波只有 1 只，不吃这条）。超限时 `spawnOne` 会改刷队列里其它类型，骷髅留在队首下次再刷；队列全是骷髅且超限时 `spawnOne` 返回 `null`，此时 `update` **不重置 spawnTimer**，下个 tick 再试。
  - `SKELETON_MAPS = ['snow']`：`startWave` 里按 `ctx.map.id` 过滤**普通骷髅**（Boss 不受限）。**不要**在这里判断模型是否加载好——glb 是异步的，在这里滤掉会让整波都刷不出骷髅（踩过，E2E 间歇失败）。模型未就绪的处理在 `spawnOne`：普通骷髅和 Boss 都会留在队首等下次。
- 动作名和僵尸完全不同：骷髅用 KayKit 命名（`Walking_A` / `1H_Melee_Attack_Chop` / `Death_A` / `Hit_A`），僵尸用 Quaternius 命名（`Walk` / `Idle_Attack` / `Death` / `HitReact`）。`Zombie.buildAnimations` 按 `this.isSkeleton` 选候选名，加新模型就在这里加一组。
- **骨骼名大小写不同**：僵尸是 `Head`，骷髅是 `head`；骷髅另有 `handslotr` / `handslotl` 专用挂载点（注意 GLTFLoader 会把名字里的 `.` 去掉）。按名字找骨骼要忽略大小写（`/^head$/i`）。
- **命中球按模型高度归一**：`Zombie` 构造里按 `def.model` 定 `chestY`/`headY`/`hitRadiusScale` —— 僵尸 1.02/1.52/1.0，骷髅 0.90/1.68/0.8（骷髅骨架细，半径缩到 0.8）。`ProjectileSystem` 和 `WeaponSystem` 都乘这个倍率。**头部球必须仍小于胸口球**，加新模型时自己核一遍。
- 选模型看 `ZOMBIES[type].model`：不写 = 僵尸 glb，写 `'skeleton'` = 骷髅。缩放取 `MODELS[id].scale`，**不要**再硬编码 `ZOMBIE_SCALE`。
- `gltf-transform join` 对蒙皮网格无效（合并会被骨骼节点绑定挡住），别指望靠它降 draw call。
- 来源、裁剪记录与许可见 [public/models/LICENSE-skeleton.txt](public/models/LICENSE-skeleton.txt) 和 [docs/ZOMBIE-MODELS.md](docs/ZOMBIE-MODELS.md)。

### 5.3.2 炼金模型（第三个模型 → 普通僵尸在用）

- `public/models/alchemist.glb`：仓库所有者提供的 AIGC 资产，由 38 MB / 50 万面的 FBX 转制（处理管线见 [docs/ZOMBIE-MODELS.md](docs/ZOMBIE-MODELS.md)）。**授权由仓库所有者确认**，别当成 CC0 随便搬。
- **归属**：`ZOMBIES.normal.model = 'alchemist'`（场上最多的类型）；橄榄球用 `football.glb`（见 5.3.3）；路障 / 铁桶 / 气球仍用 `zombie.glb`（不写 `model`），因为锥帽、铁桶、气球是按那个模型的头顶尺寸挂的。
- 规格：**9,999 三角面、1 个蒙皮网格（1 draw call）、22 骨骼、5 段动画、1.3 MB**，原始高 1.077（Q 版大头身），`ALCHEMIST_SCALE = 1.72` → 1.85 米。
- **三角面预算**：它是主力怪，同屏 14 只就是 14 万面（E2E 实测 15.1 万含场景）。想再抽面必须先看**药瓶**：Decimate 到 8.5k 瓶子就开始烂，10k 是这条线。要压性能只能从别处省。
- 骨骼名是 `bone_0`…`bone_21`，只有头部重命名成了 `Head`（权重实测在这根上），没有 Hand 挂点；这个类型 `acc: null`。要加配件就挂 `this.body`。
- 动画名**故意对齐 Quaternius**（`Idle/Walk/Idle_Attack/Death/HitReact`），所以 `buildAnimations` 的非骷髅分支直接命中，不要给它单独加分支。
- 命中球单独一套：`HIT.alchemist = { chest: 0.83, head: 1.44, radius: 0.85 }`（**世界米**，不是模型本地单位 —— 模型已按 1.72 拉过）。Q 版头大，**别照抄原僵尸的 1.02/1.52**，那样头球会飘到头顶外面。
- 模型未就绪时 `spawnOne` 会改刷别的类型、它留在队首（`modelReady(type)` 按 `ZOMBIES[type].model` 查槽，所以普通僵尸等的是 alchemist 的 glb，不是 zombie 的）。
- **抽面只能用 Blender 的 Decimate**（保留顶点组 / UV）；`gltf-transform simplify` 会破坏 `JOINTS_0/WEIGHTS_0`。

### 5.3.3 橄榄球模型（第四个模型 → 橄榄球僵尸在用）

- `public/models/football.glb`：仓库所有者提供的 AIGC 橄榄球僵尸（原始 FBX 38.1 MB，处理管线见 [docs/ZOMBIE-MODELS.md](docs/ZOMBIE-MODELS.md)）。**授权与 alchemist 一样由仓库所有者确认**，不是 CC0 素材。
- **归属**：`ZOMBIES.football.model = 'football'`、`MODELS.football = { scale: 0.95, height: 1.84 }`；原始高 1.938（T-pose），× 0.95 ≈ 1.84 米，再乘类型 scale 1.12 ≈ 2.06 米。
- 规格：**10,000 三角面、1 个蒙皮网格（1 draw call）、22 骨骼、5 段动画、1.4 MB**；贴图 = 1024 baseColor JPEG + 512 normal PNG。
- **FBX 的 armature 对象带 0.01 缩放**：导出 glTF 前必须先 `unparent → transform_apply(scale)` 把骨骼和网格都变成米，否则 three.js 里蒙皮会塌缩/浮空（本次踩过）。
- Quaternius 的 `Walk/Idle_Attack` 带根位移，不能直接照搬：Walk 的根位移会让模型在动画里滑出 4 米。动画只取骨骼旋转，腿骨旋转再乘 0.62（目标腿比源模型长 1.62 倍），每段用**常量**抬升贴地，不要逐帧 `minz`（会做出半米上下颠簸）。
- **Idle 是程序化的**（手臂下垂 + 呼吸），源僵尸的 `Idle` 其实是趴地爬行；Death 保留源 `Body` 的整体旋转做后仰倒地，游戏自己负责死亡下沉。
- 命中球单独一套：`HIT.football = { chest: 1.34, head: 1.66, radius: 1 }`（乘类型 scale 1.12 → 胸口 1.50 / 头 1.86）。
- **头盔仍然是程序化的**：新模型没有头盔、但自带白色护肩和红球衣；`buildHat` 的 helmet 分支挂在 `Head` 骨骼、本地 Y 1.76，**不要再补护肩**（会和模型自带的白色护肩打架）。
- 模型未就绪时 `spawnOne` 改刷别的类型、它留在队首（`modelReady` 查 `zombieModel.football` 槽）。

### 5.3.4 队友模型（RemotePlayer）

- `public/models/farmer.glb`：**Quaternius Farmer（CC0 1.0）**，Poly Pizza 2022-02-22 发布（早于 QAL v1.0），1.3 MB / 3,716 面 / 24 段动画 / 1.823 米。**只在创建 RemotePlayer 时懒加载**，单人模式不下载。
- 骨骼：`Head`、`WristR`（glTF 里是 `Wrist.R`，GLTFLoader 会把点去掉）。帽子/胡子/枪用程序化补件，通过 `Object3D.attach()` 挂到骨骼；**不要手算 CharacterArmature 的 100 倍缩放**。
- 戴夫化（`daveifyModel`）：按材质名隐藏草帽（`Farmer_Head_2` Beige、`_4` Red），衬衫改米白、背带裤/裤子改棕色、鞋改深棕；再加锅盖帽 + 大胡子 + 鼻头 + 右手豌豆枪。每件 mesh 克隆材质，避免多个 RemotePlayer 串色。
- 动画：`Idle_Gun` 待机、`Run` 移动、`Gun_Shoot` 开火、`Death` 倒地、`HitRecieve` 受击、`Wave` 打招呼；`findClip` 自动剥 `CharacterArmature|` 前缀。
- 成本：**12 个蒙皮 mesh / 8 个材质**，约 12 draw call（帽子/胡子/枪/名牌另算）；Walk/Run 无根位移，不需要钉根骨。同屏只有 1 个队友，不影响 14 只僵尸的预算。
- 调试：`__game.spawnRemotePlayer({name:'队友'})` 在出生点右侧生成；联网层接上后由网络位置驱动 `setTransform` / `setMoving` / `setFiring`。
- 来源与许可：[public/models/LICENSE-farmer.txt](public/models/LICENSE-farmer.txt)。**不要换成从 quaternius.com 现下的 Farmer**（QAL v1.0 限制再分发）。

### 5.4 输入与平台

- 平台识别在 `Controls` 构造函数：`(pointer: coarse) || (hover: none)` 且 `maxTouchPoints > 0`；首次触摸会调用 `onModeChange` 动态切换。
- `Game` 会给 `<body>` 加 `touch` / `desktop` 类；CSS 用它们隐藏虚拟开火/跳跃并显示键位提示。
- 触屏横屏：左下固定摇杆，右半屏拖动视角；右下大号开火、开火正上方跳跃、开火左侧武器槽（参考吃鸡手游），按钮均为 DOM 且已 `stopPropagation`；竖屏由 `#orientationGate` 拦截。
  **新增全屏或大面积可点击元素时务必设 `pointer-events: none`（除非确实要点击），否则会挡住瞄准。**
- 桌面：点击开始后 `requestPointerLock`；`Esc` 解锁会触发 `onLockChange` → 自动暂停。恢复必须由用户点击按钮（浏览器手势要求）。
- 不要给触摸设备调用 `requestPointerLock`。
- 键盘/触摸可以同时使用，不要假设互斥。

### 5.5 HUD

- HUD 是 DOM，`#hud` 整体 `pointer-events: none`；交互元素单独设 `auto`。
- 所有 UI 位置都要考虑 `env(safe-area-inset-*)`（刘海屏/iPad 圆角）。
- 更新 DOM 走 `HUD` 方法（内部有缓存），不要每帧直接写 `style`。
- 隐藏 HUD 的时机：暂停/结算时 `hud.showHud(false)`；恢复/重开时 `true`。
- 植物图标在 `HUD.js` 的 `ICONS`；新增植物要同时补图标、名称、费用。
- 盾血条 `#shieldRow` / `#shieldFill` 由 `HUD.setShield(hp, max, active)` 驱动，`Game.update` 每帧同步；盾血 0 自动隐藏，收起时加 `idle` 半透明。

### 5.6 性能

- 目标：桌面 / iPad 60fps，iPhone 稳定 60；当前约 100–200 draw call、15 万三角面以内。
- 同屏僵尸 ≤ 14；粒子池固定 280；爆炸光效复用同一盏点光源。
- 渲染像素比上限 2；`Game.trackPerformance` 会在帧率 < 43 时自动降分辨率。
- 阴影：单方向光 + 1024 PCFSoft。**改阴影相机范围后必须 `shadow.camera.updateProjectionMatrix()`**，否则阴影会消失（本项目踩过这个坑）。
- 大量重复小物件用 `InstancedMesh`（草地、花朵、栅栏）。
- 不要给粒子/透明物体开阴影。

### 5.7 iOS / 移动端

- 音频必须由用户手势解锁（开始按钮里 `sfx.unlock()`）；不要在模块顶层创建 `AudioContext`。
- 视口已设 `viewport-fit=cover` + `100%` + `safe-area`；不要用 `100vh`。
- iPhone Safari 不支持元素全屏，别加 `requestFullscreen` 依赖。
- 设备像素比 3 的屏幕会被压到 2；不要为了“更清晰”提高上限。
- 触屏瞄准辅助角度更大（0.17 rad ≈ 9.7°），桌面 0.045 rad ≈ 2.6°，两者都瞄准胸口、不预判。
- 移动端是**横屏游戏**：竖屏由 `#orientationGate` 全屏拦截，不提供可玩的竖屏布局；`Game.requestLandscape()` 只在支持 `screen.orientation.lock` 的浏览器（通常需要全屏）尝试锁定，iOS Safari 不支持时依赖玩家手动横屏。

### 5.8 资源

- 只允许项目内资源：贴图放 `public/textures/`、模型放 `public/models/`，都用 `import.meta.env.BASE_URL + '...'` 引用（构建后位于 `dist/` 下同名目录）。
- **运行时**不要拉 CDN、外部字体、外部模型；但模型可以先下载进仓库再当项目内资源用（僵尸 glb 就是这么来的）。
- Three.js 由 npm 打包。
- 音效素材放 `public/audio/`（CC0，来源见 `public/audio/LICENSE-audio.txt`），**构建时内嵌**进 JS：`embed-audio` 插件（`vite.config.js` 与 `vitest.config.js` 各一份，改一处要同步另一处）把 `src/fx/audio.js` 里的 `%%INJECT%%` 占位符按索引替换成 WAV 字节。不要改成运行时 `fetch` + `decodeAudioData`——那是异步的，第一枪会没声。
- 插件替换必须走 `indexOf` + 切片（不能用 `String.replace`：采样字节里可能恰好出现 `$&` 之类的替换模式），WAV 里每个非可见 ASCII 字节都要转成 `\xNN`（同理别用 `String.fromCharCode/slice` 之类按字符操作这批数据的写法）。这两个坑都真踩过。

### 5.9 地图与地面拾取

- 每张地图是一个类实例，必须提供：`root`（所有场景物体挂在这里）、`bounds`、`colliders`、`spawn`、`pickupSpots`、`activate(scene)`、`menuCamera(camera, time)`、`update(dt)`。
- 可选 `platforms`：轴对齐平顶盒体 `{x,z,w,d,h}`，玩家用它做落脚高度与侧向碰撞；`playerColliders` 存在时玩家只吃这一组圆形碰撞（雪地用空数组，把碰撞交给 `platforms`）。
- 可选 `zombieSpawnPoints`：`[[x,z], ...]`，有则僵尸只在这些点附近刷新（雪地用于从北端基地出兵）。
- 可选 `updateNav(player, dt)` / `flowAt(x, z, out)`：有高墙的地图用 1 米网格流场给僵尸指路；`Game.update` 每帧调用，`Zombie` 优先跟随流场。
- **不要往 `scene` 直接加地图物体或灯**：切图靠 `root.visible`，直接加会残留、双份渲染、双份阴影。背景与雾由 `activate()` 设置。
- 地图元数据（`name/tag/desc/startLabel`）写在 `src/world/maps.js` 的 `MAPS`，HUD 的选图卡片由它驱动。
- 薄墙用圆形碰撞体近似时，圆心间距必须小于 `2 × (r + 僵尸半径 × 0.8)`，否则僵尸会从圆与圆之间穿过去（雪地矮墙用 0.85 米间距 / r = 0.6）。
- 拾取点位写在各自地图的 `pickupSpots`；`WeaponPickups` 池上限 `MAX_SPOTS = 10`，点位超过 10 要同时改。
- 地面刷新池是**除豌豆与坚果外的所有武器**（`lootIndices`）；拾取距离、补刷间隔在 `WeaponPickups.js` 顶部常量。
- **道具刷新受关卡边界约束**：`reset()`/`setMap()` 走 `beginLevel()`，只在开局随机刷 1 个；之后每 `SPAWN_MIN~SPAWN_MAX` 秒在**尚未出过道具**的随机空点位补刷一个（`item.used` 标记，一关每点位只出一次），被捡走/顶掉的道具不会重新出现在地图上；点位用尽后 `finished = true`，本关不再出新道具。不要加回原地重生。
- 拾取植物在 `WeaponSystem` 里按 `def.slot` 进对应**角色槽**（见 5.1）；同角色已满就直接顶掉，旧枪掉在脚边。打空不丢枪，`tryReload()` 自动续弹，钱不够则 `locked`。
- **地面刷新池排除豌豆和坚果**（`WeaponPickups.lootIndices`）：豌豆常驻枪槽，坚果靠阳光充能，都不该出现在地上。
- 新增拾取植物必须给 `model`（视图模型分支）、`ammo`、`color`，并在 `WeaponSystem.buildViewModels` 的 `builders` 里有对应构建函数。

---

### 5.10 僵尸图鉴页

- **入口**：`gallery.html`（Vite 多页），主菜单右上角「僵尸图鉴」链接；`vite.config.js` 的 `rollupOptions.input` 必须同时包含 `index.html` 和 `gallery.html`，否则 `npm run build` 不会产出图鉴页。
- **复用游戏模型**：`src/gallery/main.js` 直接 `new Zombie(type, ...)`，走和游戏相同的 `ZombieModel` / 配件 / 缩放；新增僵尸或配件会自动出现在图鉴里，不要另写一份 glb 加载器。
- **必须是走路动画**：图鉴用 `z.play('walk', 0)` + 每帧 `mixer.update(dt)`，不要换成 idle。
- **根位移**：Quaternius 的 `zombie.glb` Walk 带根位移，图鉴里把根骨的位置/旋转钉在第 0 帧，只保留四肢/躯干的走路动作；football/alchemist/skeleton 的 walk 是原地动画，不需要钉。
- **数据和视角**：类型列表、`MODELS` 高度、相机距离、3/4/正面/侧面/背面/俯视预设都在 `src/gallery/presets.js`。新增僵尸类型时 `GALLERY_TYPES` 必须同步，`tests/unit/gallery.test.js` 会检查覆盖全部 `ZOMBIES` 键。
- **覆盖率**：`src/gallery/main.js` 是独立 WebGL 入口，和 `src/main.js` 一样排除在 `vitest.config.js` 的 coverage 之外，由 E2E `gallery` 场景覆盖；纯数据 `presets.js` 仍由单元测试覆盖。

### 5.11 性能压测页

- **入口**：`stress.html`（Vite 多页 `stress`），主菜单右上角「压测台」；`vite.config.js` 的 `rollupOptions.input` 要包含它，否则构建不产出。
- **目的**：回答「这台手机 / iPad 同屏多少只僵尸开始卡」。只生成不移动的僵尸（`spawnT = 1`、`play('walk')` + 每帧 `mixer.update`），不跑 AI/寻路，专门测模型渲染与蒙皮开销。
- **必须复用 `Zombie`**：和游戏同一套 glb / 骨骼 / 配件 / 缩放，不要另写加载器，否则测出来的不是游戏里的成本。
- **渲染设置与游戏一致**：antialias、PCFSoft 1024 阴影、DPR 上限 2、NeutralToneMapping、PMREM 环境贴图（`outdoorEnvironment`）。
- **不要加自动降分辨率**：`Game.trackPerformance` 那套会把读数悄悄抹平；压测页必须显示真实开销。
- **指标**：最近 90 帧的 FPS / 平均帧时间 / P95 / draw call / 三角面 / 几何与贴图数。draw call 与三角面只统计主渲染通道，阴影 pass 另算（`renderer.info` 的口径）。
- **类型**来自 `GALLERY_TYPES`（另有「混合」），模型没加载好的类型自动禁用；新增僵尸类型不用改这个页面。
- **自动测极限**：按 `RAMP_STEPS` 递增，每档 `RAMP.warmupMs` 热身 + `RAMP.measureMs` 采样，FPS 低于 `RAMP.failFps`（45，与游戏自动降分辨率同口径）就停，报出「撑到 N 只 / M 只掉到 X fps」。
- **生成分帧**（每帧 4 只），生成与 settle 期间的帧不进统计，否则初始化开销会污染稳态读数。
- **覆盖率**：`src/stress/main.js` 是独立 WebGL 入口，排除在 `vitest.config.js` 的 coverage 外，由 E2E `stress` 场景覆盖；纯计算在 `metrics.js`，由 `tests/unit/stress.test.js` 覆盖。
- **实测口径**（每只僵尸的主通道 draw call，含 blob 影子）：普通 2、路障 6、气球 5、橄榄球 9（其中 6 个来自程序化头盔）、骷髅 10、Boss 12；普通僵尸 1 万三角面，其余 5k–1.1 万。


### 5.12 双人联机（M0 / M1 + M2 input/僵尸/命中/救援）

- **范围**：自动配对（有人等待就加入，没人等待就新建一场并等待）、多场并发（默认 `MAX_MATCHES=8`）、断线重连（45 s）、同场玩家 input 同步；**僵尸由 host 模拟、20 Hz 快照 + spawn/dead 事件同步**；guest 的命中/爆炸发请求，host 用视线 + seq 快照 + 墙体/冷却重算；共享阳光值、个人分、倒地救援已接。**共享补给 claim、阳光球同步、结算页、resync、双人缩放还没做**；常规补给目前是每客户端本地掉落，常规球的 host-only。
- **跑起来**：`npm run build && npm run server`（或开发时 `npm run dev` + `npm run server`）。客户端在 DEV 下连 `ws://<当前主机名>:8080/ws`，生产同源连 `/ws`。详见 [server/README.md](server/README.md)。
- **协议**：`src/net/protocol.js`；顶层消息 `hello/welcome/queue/peer/start/map/relay/ping/pong/error/end/bye`。`relay` 里再包一层游戏内消息（`input` / `pstate` / `evt` / `pause` / `resume`），不要绕过 `cleanRelay` 的 32 KB 上限。
- **配对**：服务器只维护 `waiting` FIFO 和 `matches`；seat 0 是房主，seat 1 是客人。`start` 后服务器只转发，不模拟。
- **邀请链接**：等待中的房主 `welcome.joinToken`（12 位）→ 客户端把地址栏改成 `?join=`，并显示「复制邀请链接」；朋友打开即加入。`hello.join` 优先于 FIFO，失效返回 `JOIN_EXPIRED`（客户端清掉参数，可重新匹配）。
- **刷新 vs 断网**：`hello.page` 是页面实例 id（同一页重连不变、刷新变）。房主刷新 = 本局结束（客人收 `HOST_RESET`）；客人刷新 = 回座但 M1 世界重置，M2 才发 `resync`。
- **远端平滑**：`applyRemoteState` 调 `setTarget`，`RemotePlayer.update` 用 100 ms 平滑；>3 m 直接吸附（重连/换图）。
- **公网加固**：`MAX_CONN_PER_IP=6`；Caddy 后设 `TRUST_PROXY=1` 读 `X-Forwarded-For`。
- **M2 input/命中**：guest 每帧 `captureInput` 累积 `look/jump`，30 Hz 发 `input {m,look,jump,fire,shield}`；host 跑 `sfx=null`、`onDamage/onDeath=null` 的 guest 代理 `Player`（`Game.netGuest`），20 Hz 回 `pstate`（`h/g/z/sun/scores/kills`）；guest 本地预测，按 0.2 m 软校正，300 ms 没输入就把代理 move/fire 归零。guest 的 `ProjectileSystem` 命中远端僵尸发 `hit {zid,seq,w,dir}`，host 用 `seq` 快照位置 + 代理视线 + 头身球 + 墙体 + 冷却重算；爆炸走 `aoe`。guest 本地只 `flashOnly`。
- **guest 僵尸世界**：`Game.isGuestWorld()` 跳过 `map.updateNav`/`skySun`/`sunOrbs`；`zombies.setRemote(true)` 后只跑 `Zombie.update` 远端分支。host 的 `ZombieManager.onNetSpawn/onNetDead` 发 `evt`，`pstate.z` 每 50 ms 同步 `id/type/x/y/z/yaw/hp/st/sl`。guest 的 `Zombie.hit()` 只白闪，不扣血、不 `handleKill`、不掉阳光。**常规补给例外**：`pickups.update` 在 guest 也跑本地掉落（共享 claim 未做）。
- **倒地/救援**：`Player.duoDown` 时 HP 归零进入 `downed`（30 s、镜头 0.55 m、不能开枪）；host 的 `Game.updateDuoRescue` 在两人相距 3 m 内累计 2.5 s 自动救起（半血 + 3 s 无敌）。超时 `duoWipe` → `sendWipe` + 回菜单，菜单状态栏显示双方比分。
- **客户端**：`NetClient` 存 `sessionStorage` 的 token；`DuoSession` 收到 `START` 调 `Game.startDuo`，收到 `RELAY input` 调 `applyGuestInput`（host），收到 `pstate` 调 `applyPeerState`（guest），收到 `evt` 调 `applyWorldEvent`。guest 30 Hz 发 input，host 20 Hz 发 pstate。
- **Game 接入**：`duoSession`/`duo`/`seat`/`remote`/`netGuest`；`startDuo` 用 `duoSpawn(map, seat)` 在出生点左右各让 1.8 m，`setupDuoWorld()` 设置远程标志/网络回调并由 host `startWave(1)`；`backToMenu`/`endDuo`/`restart` 都会清理会话、远端和僵尸回调。双人下 Esc/失锁**不自动暂停**，避免通过中继把队友锁住。
- **不要**把 `DuoSession` 静态 import 进 `Game.js`：`toggleDuo()` 里动态 `import()`，单人模式不加载网络 chunk（构建里应看到独立的 `DuoSession-*.js`）。
- **测试**：`tests/unit/matchmaker.test.js`（配对/重连/超时）、`tests/unit/netclient.test.js`、`tests/unit/duosession.test.js`、`tests/unit/duo-authority.test.js`（input/guest 世界/僵尸快照）、`tests/unit/duo-hit.test.js`（guest 命中请求与 host 裁决）、`tests/unit/duo-down.test.js`（倒地/救援/团灭）、`tests/integration/duo-server.test.js`（真实 ws 服务器）。双浏览器手动验收：两个独立上下文点「双人联机」，guest 能看到 host 刷出的僵尸（同 id/hp），guest 本地命中只白闪、host 的血量由裁决改变。

## 6. 常见改动路径

### 新增一株植物 / 武器

1. 在 `config.js` 的 `WEAPONS` 加一项（`id/name/short/cost/cooldown/damage/kind/speed/radius/color/auto/recoil`）。
2. 在 `WeaponSystem.buildViewModels` 里为新 `id` 建视图模型，返回 `{ group, muzzle, basePos, baseRot, baseScale, fireKick }`。
3. 在 `tryFire()` 里按 `kind` 分支：`pea`（弹丸）、`lob`（抛物线）、`hitscan`（即时命中）；新机制就扩展 `ProjectileSystem`。
4. 在 `HUD.js` 的 `ICONS` 加 SVG 图标；在 `config.js` 给它写 `slot`，它就会出现在对应角色槽的可替换候选里。
5. 更新 `docs/GAMEPLAY.md` 的武器表与说明。

### 新增一张地图

1. 新建 `src/world/Xxx.js`，实现 5.9 的实例接口；所有物体挂在 `this.root`，碰撞写 `this.colliders`，出生点写 `this.spawn`，武器点位写 `this.pickupSpots`，可站立平台写 `this.platforms`。
2. 在 `src/world/maps.js` 的 `MAPS` 加一项（`id/name/short/tag/desc/startLabel/create`）。
3. 如需新地表/天空贴图，在 `materials.js` 加程序化函数（勿引外部图片）。
4. 检查 5.9：背景/雾在 `activate()`，灯在 `root` 内，点位 ≤ 10。

### 新增可拾取植物

1. `config.js` → `WEAPONS` 加一项：`starter: false`、`model`、`ammo`、`cooldown/damage/kind/color`。
2. `WeaponSystem.buildViewModels` 的 `builders` 补 `model` 分支；新机制在 `tryFire` / `ProjectileSystem` 扩展。
3. `HUD.ICONS` 补图标（战利品格和拾取物都用）。
4. `WeaponPickups` 会自动把新武器加入随机池，不需要改点位。
5. 更新 `docs/GAMEPLAY.md` 的武器表。

### 新增僵尸类型

1. `config.js` → `ZOMBIES` 加属性（`hp/speed/damage/score/radius/acc`，换模型再加 `model`）。`skin/shirt/pants` 已经删了——配色由 glb 自带，别再往 config 里加回来。
2. 造型走 `model` 字段（见 5.3.1）：不写用僵尸 glb，写其他 id 就在 `ZombieModel.MODELS` 里登记 url + scale，并在 `Zombie.buildAnimations` 补一组动作名映射。
3. `ZombieManager.wavePlan` 里加入生成权重/数量；`handleKill` 里补阳光掉落数量。
4. 需要新的行为（远程、跳跃等）改 `Zombie.update`，并在 `Zombie` 里补命中球。
4b. **要护甲就写 `armor: { material, hp }`**，材质从 `ARMOR_MATERIALS` 里选（不要新造特例）；`Zombie.hit()` 会先扣护甲、打空时隐藏 `this.hat` 并播 `sfx.armorBreak()`。护甲的 `acc` 必须挂成 `this.hat`，否则破甲时脱不下来。
4c. **要空中单位就写 `airborne: true` + `airHeight`**：`root.position.y = airHeight`，`getChest/getHead` 会自动抬高度；同时它不吃地面碰撞体、攻击要过垂直判定。别忘了给 `WEAPONS` 里至少留一把 `aerial` 钥匙，并在 `wavePlan` 里配同屏配额（`AIR_QUOTA_RATIO` / `waveAirQuota`）。
5. 更新 `docs/GAMEPLAY.md` 图鉴与波次表。

### 调整波次/难度

- `config.js`：`wavePlan`、`waveMaxAlive`、`waveSpawnInterval`、`zombieHpMul`、`zombieSpeedMul`。
- 清波奖励/回血在 `Game.onWaveClear`；Boss 波逻辑在 `wavePlan` 的 `n % 5`。

### 新增 HUD 元素

1. `index.html` 加结构，`style.css` 加样式（注意 `pointer-events` 与安全区）。
2. `HUD.js` 缓存元素引用并加更新方法；Game 里驱动。
3. 屏幕阅读/触控尺寸：按钮建议 ≥ 44px。

### 新增音效

- 想接真实录音：把 CC0 素材按 `public/audio/LICENSE-audio.txt` 里的处理流程裁好（单声道 44.1kHz 16bit、去静音、峰值 -3dB）放进 `public/audio/`，在 `src/fx/audio.js` 加一个 `%%INJECT%%` 导出、在两份配置的 `AUDIO_FILES` 表里登记，再在 `Sfx.js` 的 `SAMPLES` 表里写 `方法名: [['文件键', 音量], 最低音高, 最高音高, 'pan' | 'mono']`，然后加一个 `this.play('方法名')` 的公开方法。
- 纯合成音效在 `Sfx.js` 用 `tone()` / `noise()` 组合。两种都通过 `ctx.sfx` 调用。
- 音量统一走 `master`，不要直接连 `destination`；采样表里的音量是相对量，调手感只改 `SAMPLES`。

---

## 7. 调试与验收

### 调试句柄

`window.__game` 暴露了整个游戏，可在浏览器控制台/无头脚本里直接操作：

```js
__game.state                    // menu | playing | paused | over
__game.mapId                    // backyard | snow
__game.map.colliders            // 当前地图碰撞体
__game.setMap('snow')           // 切图（仅 menu 状态有效）
__game.player.pos               // 玩家位置
__game.zombies.zombies          // 当前僵尸数组
__game.zombies.startWave(5)     // 跳到第 5 波
__game.weapons.pickup(4)        // 直接拾取指定植物（4 = 双发射手）
__game.pickups.items            // 地面拾取物池
__game.spawnRemotePlayer()      // 在出生点右侧生成一个队友戴夫（预览）
__game.remotes                  // 当前远端玩家数组
__game.duo                      // 双人对局信息（seat/peerName/seed），单人/菜单为 null
__game.remote                   // 双人队友的 RemotePlayer（网络位置驱动）
__game.duoSession               // 双人会话（含 net/rtt/state）
__game.seat                     // 双人座位：0 房主 / 1 客人 / -1 单人或菜单
__game.spendSun(999)            // 改阳光
__game.renderer.info.render     // draw call / 三角面
```

### 改动后的最低验收

- `npm run build` 通过；控制台无 error / pageerror。
- 桌面（1440×860）：选地图 → 开始 → 指针锁定 → WASD 移动 → 鼠标转视角 → 左键射击 → 1-5 切五个角色槽 → Tab 循环 → Backspace 丢枪 → 空格跳 → Esc 暂停/继续。
- 武器槽：按 1 永远回到豌豆；捡一把枪进 2 号槽、再捡一把顶掉它且旧枪掉在脚边；3/4/5 分别是玉米炮/樱桃/坚果；按住开火键蓄力投樱桃；丢下的枪在脚边可再捡回；重开一局清空（豌豆槽保留）。
- iPhone 横屏（844×390）、iPad（1024×768）：选图卡片不溢出；虚拟摇杆、右侧拖动、开火、跳跃、5 个武器槽都可用；HUD 不被安全区裁切。
- 竖屏（390×844）：显示「请横屏游玩」拦截层，不进入游戏；横过来后拦截层消失、可正常开始。
- 地图：菜单能切换后院/雪地，背景、雾、相机随之切换；雪地能看到田字四柱、两侧矮墙、两端基地、四角砖台、围墙与雪山。
- 高低差：走上四角砖台会自动踏步；两侧 0.85 米矮墙可以跳上去站稳；田字四柱 3.6 米不能跳上；走出边缘会下落；僵尸从北端基地沿通道接近，不会卡死。
- 拾取：踩到发光植物自动进对应角色槽并出现图标与弹药数；2 号槽再捡就顶掉上一把、旧枪掉在脚边；打空后枪不丢，阳光够自动续弹、不够则变暗显示「缺阳光」；捡走后本关不再原地刷新，只有其它没用过的点位会随机补刷出下一件。
- 武器：豌豆命中/爆头、寒冰减速变蓝、樱桃落地爆炸、玉米炮即时爆炸；双发/三线散射、机枪射速、仙人掌穿透、西瓜爆炸、辣椒范围灼烧。
- 坚果墙：开局 5 号槽就有坚果；按 5 切过去、左键套盾 → 僵尸贴脸打、玩家血条纹丝不动；罩壳变色并在 25% 以下闪烁；盾碎时碎裂音 + 白闪；气球从头顶咬能穿透护盾；罩内移速变慢；**手持坚果时开不了枪；切到 1/2/3/4 盾收起（人开始掉血、盾血保留），切回来自动重新举起**。
- 火豌豆：捡到火豌豆后按 2 切到它 → 弹丸拖火星、命中后僵尸身上冒火苗；打橄榄球僵尸明显快于豌豆。
- 护甲：打铁桶/橄榄球时头盔先掉（碎裂音），铁桶对豌豆减伤、橄榄球被火豌豆烧穿；仙人掌穿透打不动铁桶。
- 气球：豌豆打它穿过去（地面打出点点、无伤害）；换玉米炮/樱桃一发带走；跳到它高度以下能躲开撕咬；站上雪地矮墙 + 水平 3 米内用豌豆也能打到。
- 普通僵尸（新模型）：任意地图第 1 波就有；走路摆臂、攻击抬右手砸下、受击后仰、死亡后仰倒地；正面点头能爆头、打胸口算身体；路障/铁桶仍是原来的僵尸模型 + 锥帽/铁桶。
- 图鉴：主菜单右上角「僵尸图鉴」→ 独立页面列出 7 种僵尸；点击切换、拖动旋转、滚轮/双指缩放；模型循环走路（不是静止）；3/4/正面/侧面/背面/俯视按钮可用；橄榄球有红头盔、Boss 手持木棒。
- 压测页：主菜单右上角「压测台」→ 选类型 / 拖数量后僵尸立刻按方阵重排；开关阴影、骨骼动画、2× 像素比时读数跟着变；「自动测极限」从 2 只往上爬，掉帧后停下并报出拐点。
- 流程：击杀掉阳光并拾取（18 秒内没捡会消失）、天降阳光每 30 秒落 1 颗、清波加分、暂停/恢复、死亡结算、再来一局。
- 性能：1–4 只僵尸时 draw call 约 90–130；14 只时不超过约 250。

### 自动化验证

```bash
npm test              # UT + 集成测试（Vitest + jsdom），PR 必须全绿
npm run test:coverage # 覆盖率报告（coverage/index.html）
npm run test:e2e      # 真实 Chromium 跑 10 个浏览器场景（构建→preview→点按钮→断言），约 2 分钟
npm run build         # 生产构建
```

CI（`.github/workflows/ci.yml`）在每次 push 到 main 和每个 PR 上跑三个并行 job：

| job | 内容 | 失败条件 |
| --- | --- | --- |
| **UT + 集成测试** | `vitest run --coverage`（1075 用例） | 任何用例失败；覆盖率低于 `vitest.config.js` 的 `thresholds`（语句/行 98%、分支 89%、函数 97%） |
| **浏览器级 E2E** | `playwright-core install --with-deps chromium` + `npm run test:e2e`（10 场景） | 任一场景 FAIL 或页面出现 console.error / pageerror |
| **生产构建** | `npm run build` | 构建失败 |

覆盖率 HTML 报告与 E2E 失败截图分别作为 artifact 保留 14 天。三个 job 互不依赖，可并行跑；改覆盖率门槛请改 `vitest.config.js` 而不是在 CI 里写死。

---

## 8. 已知限制（是设计取舍，不要当 bug 修）

- 只有后院 / 雪地 / 沙城三张无尽地图，没有关卡章节/剧情。
- 没有通用地形/斜坡系统：地图只有轴对齐的平顶平台（雪地的田字四柱/矮墙/砖台、沙城的 A/B 点观景台），靠 `platforms` 采样支撑；没有斜坡、楼梯、可破坏物。
- **僵尸不会跳**：能站上去的高台必须给僵尸留活路——沙城观景台只有 0.4 米且不挂 `colliders`，`FlowField.blockPlatforms` 默认也跳过 ≤0.6 米的平台，否则玩家站上去就无敌。
- 拾取植物是弹匣制（打空用阳光续弹），但**没有手动换弹键**；豌豆常驻 1 号槽、坚果常驻 5 号槽，其它植物靠捡、打完用阳光续。
- 僵尸和骷髅全是近战，没有远程/投掷单位。
- **普通**骷髅只在雪地图出现、同屏最多 3 只——它单只 9 个 draw call（僵尸 2 个），详见 5.3.1。想提高上限先想办法合并它的蒙皮网格。巨型骷髅 Boss 不受此限（每波 1 只）。
- 僵尸用的是 Quaternius `Idle/Walk/Idle_Attack/Death/HitReact` 五段动画，攻击节奏由代码控制（`attackTimer` 1.28 秒）而不是动画事件对齐；没有 IK、没有动画事件回调，脚在急转弯时仍会轻微滑步。要完全贴合得接 IK 或动画事件。
- Boss（巨型骷髅，约 4.48 米，手持带钉木棒）只有高血量/高伤害/大攻击距离，没有专属技能；木棒只是外观，不单独计算护甲或伤害。
- 爆炸位置本身不判遮挡（范围伤害照算），但豌豆和投掷物会被地图 `walls` 挡住；辅助瞄准不预判移动。
- 僵尸默认不做网格寻路；雪地用 1 米网格流场绕开田字四柱（`IceWorld.updateNav`），其他地图仍是直线追击 + 分离 + 碰撞推出，并带贴墙滑动。
- 割草机是装饰，不会触发清场。
- 武器槽是**角色制**的：1 豌豆（常驻）/ 2 枪 / 3 大杀器 / 4 手雷 / 5 护盾。2~5 可换，豌豆永不变。可主动丢弃（Backspace）。续弹自动完成，**没有手动换弹键**、没有换弹动画。
- **坚果是免伤盾不是无敌**：盾血 400、撑多久取决于场上僵尸数量；罩内移速 ×0.88、**手持坚果期间开不了枪**、气球伤害穿透护盾。这三条是刻意的，删掉任何一条它都会变成"开着盾站桩打"的无敌点。
- **五个槽是独占的，但「收起」不等于「破盾」**：`equip()` 一开始调 `syncShieldWithHand()` —— 切走坚果走 `wallNuts.stow()`（`active=false`，罩壳隐藏，**`hp` 原样保留**，玩家开始正常承伤）；切回坚果走 `deploy()` 免费重新举起。只有 `hp` 掉到 0 才是 `breakShield()`。`clear()` 才是真正抹掉盾血，只给重开一局用。
- 原来的 `shieldShotCost`（开火扣盾血）和 `WallNuts.spendShot()` 已删除——独占到"手持坚果就不能开枪"之后它们成了死代码，别再按"开盾时还能开枪"的前提加回来。
- **气球是纯高度层级**：不吃地面碰撞体（在飞）、不被墙挡住；落地并站上 ≥0.9 米高台（雪地矮墙 0.92、沙城 1.5 箱子）用任何武器都能打到，这是刻意的零成本解法，别当漏洞修。跳跃不算（`grounded === false`）。
- 队友模型是 Quaternius Farmer 的戴夫化版本，不是 EA 的 Crazy Dave；锅盖帽 / 胡子 / 枪是程序化补件。单只约 12 个蒙皮 draw call，但同屏只有 1 个，不占 14 只僵尸的预算。
- **双人当前同步玩家 input + 僵尸 + 命中 + 共享阳光值 + 个人分 + 倒地救援**：host 模拟僵尸，guest 看 20 Hz 快照；共享补给 claim、阳光球同步、结算页、resync、双人缩放未做。常规补给是每客户端本地掉落（与“先到先得”设计偏差），阳光球仍是 host-only；救援是靠近 2.5 s 自动，不是按住 E。
- 同屏僵尸硬上限 14（移动端性能）。普通僵尸用的是 1 万面模型，14 只全普通时约 15 万三角面 —— 这已经是预算上限，再加内容要先想清楚从哪省。
- 测试跑在 jsdom 里，WebGL 是替身：渲染效果、真机手感、真实 glb 贴图要靠 `npm run test:e2e` 或人工验收，不要用 jsdom 测试冒充"渲染正常"。

---

## 9. 提交约定

- 使用简短前缀：`feat:` / `fix:` / `perf:` / `docs:` / `refactor:`，正文用中文。
- 一次提交只做一件事；美术/数值改动同时更新 `docs/GAMEPLAY.md`。
- 不提交 `node_modules/`、`dist/`、`.idea/`、`generated-images/`（已在 `.gitignore`）。

---

## 10. 快速索引

- 想改手感：`Player`（速度/跳跃/回血）+ `WeaponSystem`（后坐/摇摆/辅助瞄准）。
- 想改地图：`src/world/maps.js` + `Arena.js` / `IceWorld.js` / `DustYard.js`（寻路统一走 `FlowField.js`）；想改地面武器：`config.js` 的 `WEAPONS` + `WeaponPickups.js`。
- 想改难度：`config.js` 波次公式 + `ZombieManager` 生成逻辑。
- 想改画面：`Arena`（场景/光照）、`materials.js`（色调）、`ZombieModel`（僵尸造型）。
- 想改 UI：`index.html` + `style.css` + `HUD.js`，注意 `pointer-events` 与安全区。
- 想加内容：先加 `config.js` 数据，再补系统，最后同步 `docs/GAMEPLAY.md`。
