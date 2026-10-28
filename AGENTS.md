# AGENTS.md — 二次开发指南

面向接手本仓库的 AI Agent 与开发者。读完这一份，应该能在不踩坑的情况下改代码。
玩家向的数值与图鉴见 [docs/GAMEPLAY.md](docs/GAMEPLAY.md)。

---

## 1. 项目速览

- 纯 Web 的 3D 第一人称射击：玩家是戴夫，手持植物打僵尸；iPhone / iPad / 桌面浏览器均可玩。
- 技术栈：Vite 5 + Three.js 0.169，原生 ES Module，**没有 TypeScript、没有后端、没有外部 CDN**。
- 入口：`index.html` → `src/main.js` → `src/Game.js`。所有系统在 `Game` 构造函数里组装。
- 运行：

```bash
npm install
npm run dev       # 会打印局域网地址，手机/iPad 同 Wi-Fi 直接访问
npm run build     # 输出 dist/，纯静态，可放任意静态托管
npm run preview   # 预览构建产物
```

- **不能用 `file://` 直接打开 `dist/index.html`**：ES Module 与音频权限会被浏览器拦截，必须走 HTTP。
- 构建产物由 `vite.config.js` 的 `base: './'` 支持子路径部署。
- 项目没有测试框架；验收方式见第 7 节。

---

## 2. 目录与职责

| 文件 | 职责 |
| --- | --- |
| `src/main.js` | 启动、创建 `Game`、挂 `window.__game` 调试句柄、启动渲染循环 |
| `src/Game.js` | 状态机（menu/playing/paused/over）、系统组装、每帧更新顺序、波次回调、阳光/计分、镜头震动、自适应分辨率 |
| `src/config.js` | **所有可调数值**：`TUNING`、`WEAPONS`、`ZOMBIES`、波次公式。改平衡先改这里 |
| `src/world/Arena.js` | 后院场景：地面、栅栏、房子、树、墓碑、割草机、光照与阴影、碰撞体列表 `colliders` |
| `src/world/materials.js` | Toon 材质、程序化草地/天空/云/光晕/污渍贴图 |
| `src/entities/Player.js` | 第一人称移动、跳跃、碰撞、生命/回血、镜头位置与后坐力 |
| `src/entities/Zombie.js` | 单个僵尸：绑定模型骨架、AI、行走/攻击/死亡动画、受击/减速/掉落回调 |
| `src/entities/ZombieModel.js` | **代价最高、最需要小心**：程序化生成僵尸各部位合并几何、面部、帽子、UV 分区 |
| `src/entities/ZombieTexture.js` | 异步加载 4 张文生图贴图 → 裁水印 → 合成 1024 图集 → 供材质使用 |
| `src/entities/ZombieManager.js` | 波次生成、分离、范围伤害、击杀结算、Boss 跟踪、阳光掉落数量 |
| `src/entities/SunOrbs.js` | 阳光球池、弹跳、磁吸、拾取 |
| `src/weapons/WeaponSystem.js` | 手持植物视图模型、瞄准辅助、开火、切枪、后坐/摇摆、命中判定入口 |
| `src/weapons/ProjectileSystem.js` | 豌豆池、樱桃抛物线、爆炸、爆头判定 |
| `src/fx/Particles.js` | InstancedMesh 粒子池、爆炸球壳/冲击环、临时点光源 |
| `src/audio/Sfx.js` | WebAudio 程序化音效（无音频文件） |
| `src/input/Controls.js` | 键鼠 + 触屏输入、平台识别、虚拟摇杆、指针锁定 |
| `src/ui/HUD.js` | DOM HUD、植物栏、横幅、命中标记、开始/暂停/结算界面 |
| `src/style.css` | 全部界面样式与响应式/安全区适配 |
| `public/textures/` | 4 张文生图材质（JPG），构建时原样拷贝到 `dist/textures/` |
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
9. `particles.update()`
10. HUD 同步（带缓存，避免每帧写 DOM）

> 改顺序前想清楚：武器在相机之后、僵尸之前；弹道在僵尸之后。把武器放到 `player.applyCamera` 前面会导致瞄准偏一帧。

### 坐标与相机约定

- Three.js 右手系；相机默认看向 **-Z**。玩家 `yaw = 0` 面向 -Z，`yaw` 减小 = 向右转。
- `player.pos` 在**脚底**；眼睛高度 = `pos.y + 1.66`。
- 相机 `rotation.order = 'YXZ'`；俯仰限制 ±1.42 rad。
- 武器视图模型是 **相机的子节点**（`weapons.root`），近裁剪面 0.05；位置大约在 `(0.4, -0.3, -0.9)`，缩放 0.6–0.9。
- 僵尸 `root.position` 在脚底，朝向 +Z（`rotation.y = atan2(dx, dz)`）；模型正面朝 +Z。
- 命中球：胸口 `y = 1.12 × scale`、半径 `0.46 × scale`；头部 `y = 1.81 × scale`、半径 `0.30 × scale`（见 `Zombie.getChest/getHead` 与 `ProjectileSystem`）。

---

## 4. 开一枪的完整数据流

`controls.firing` → `WeaponSystem.update` → `tryFire()` → `ctx.spendSun(cost)`
→ `findAimTarget()`（锥形吸附胸口）→ 生成豌豆 / 抛樱桃 / 即时爆炸
→ `ProjectileSystem` 用 `segmentSphereT` 做扫掠命中 → 比较头部/身体球的 t 值判定爆头（×2 伤害）
→ `Zombie.hit()`（白闪、减速、死亡）
→ 击杀时 `ZombieManager.handleKill()`（计分 ×1.5 爆头、掉阳光、Boss 清理）
→ `ctx.onKill` → `Game.stats` + HUD。

爆炸走 `ZombieManager.damageArea()`，按距离衰减（中心 100%，边缘 45%），并在内部完成击杀结算。

---

## 5. 必须遵守的约定

### 5.1 数值

- 植物/僵尸/波次数值**只写在 `src/config.js`**；不要散落到各系统。
- 改完数值同步 `docs/GAMEPLAY.md`，否则文档会骗人。
- 阳光经济：初始 70、上限 999、每颗阳光 5；掉落数量在 `ZombieManager.handleKill`。

### 5.2 僵尸模型与材质

- 几何体通过 `getZombieRig(type, variant)` **按类型+变体缓存并共享**。
  **不要 dispose 这些几何体**，只 dispose 每个僵尸自己的 `mat`（见 `Zombie.dispose`）。
- 每个僵尸一份 `MeshLambertMaterial`（`vertexColors: true` + 图集 `map`），用于白闪（`emissiveIntensity`）和冰冻（`mat.color` 乘色）。
- 骨架层级：`model → spine → (body, headPivot, shoulders → elbows)`，腿直接挂在 `model` 下的 `hips → knees`。动画在 `Zombie.update` 里，死亡时 `armsLimp()`。
- 新增部位：在 `ZombieModel.js` 里用 `addPrim()` 添加，必须带 UV（所有内置几何体都有）；合并后仍是单个 mesh。
- Boss 的木棒只加在**右臂**（`armLowerClub`），不要两个手都加。
- 每个僵尸 10 个 mesh（身体/头/4 段手臂/4 段腿）+ 阴影，**同屏上限 14**；不要随意增加分段或使用独立几何体。

### 5.3 UV 与贴图图集

- 图集是 1024×1024，4 个 512 单元，每单元内缩 16px、实际 480px；区域定义在 `ZombieModel.js` 的 `UV_REG`：`skin / cloth / pants / metal`。
- 添加部位前先 `setRegion('skin'|'cloth'|'pants'|'metal')`，默认是 skin；加错区域会贴错材质。
- 图集加载是**异步**的：`ZombieTexture.zombieAtlas.map` 为空时材质先用程序化污渍兜底，`Zombie.update` 里检测到就绪后补上 `map` 并 `needsUpdate = true`。
- 生成的原始图有平台水印，合成时裁掉右侧/下侧 12%；替换贴图时保持这个裁剪逻辑，或换无水印素材。
- 贴图亮度被归一化成中性细节图（`NoColorSpace`），颜色由顶点色决定；不要直接塞彩色贴图，否则颜色会被乘暗。

### 5.4 输入与平台

- 平台识别在 `Controls` 构造函数：`(pointer: coarse) || (hover: none)` 且 `maxTouchPoints > 0`；首次触摸会调用 `onModeChange` 动态切换。
- `Game` 会给 `<body>` 加 `touch` / `desktop` 类；CSS 用它们隐藏虚拟开火/跳跃并显示键位提示。
- 触屏：左半屏动态摇杆，右半屏拖动视角；开火/跳跃/植物栏是 DOM 按钮，已 `stopPropagation`。
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

### 5.8 资源

- 只允许项目内资源。贴图放 `public/textures/`，用 `import.meta.env.BASE_URL + 'textures/...'` 引用（构建后位于 `dist/textures/`）。
- 不要引入 CDN、外部字体、外部模型；Three.js 由 npm 打包。
- `public/textures` 下的 4 张 JPG 是文生图产物，已压缩；替换时保持 1024×1024、尽量无缝、无水印。
- 程序化音效在 `Sfx.js`，无音频文件。

---

## 6. 常见改动路径

### 新增一株植物 / 武器

1. 在 `config.js` 的 `WEAPONS` 加一项（`id/name/short/cost/cooldown/damage/kind/speed/radius/color/auto/recoil`）。
2. 在 `WeaponSystem.buildViewModels` 里为新 `id` 建视图模型，返回 `{ group, muzzle, basePos, baseRot, baseScale, fireKick }`。
3. 在 `tryFire()` 里按 `kind` 分支：`pea`（弹丸）、`lob`（抛物线）、`hitscan`（即时命中）；新机制就扩展 `ProjectileSystem`。
4. 在 `HUD.js` 的 `ICONS` 加 SVG 图标，植物栏会自动多一格（`WEAPONS` 驱动）。
5. 更新 `docs/GAMEPLAY.md` 的武器表与说明。

### 新增僵尸类型

1. `config.js` → `ZOMBIES` 加属性（`hp/speed/damage/score/scale/skin/shirt/pants/acc/radius`）。
2. `ZombieModel.js` → 在 `buildHead`/`buildHat` 加配饰，或在 `getZombieRig` 里按类型分支；新几何要带 UV 并设对 `setRegion`。
3. `ZombieManager.wavePlan` 里加入生成权重/数量；`handleKill` 里补阳光掉落数量。
4. 需要新的行为（远程、跳跃等）改 `Zombie.update`，并在 `Zombie` 里补命中球。
5. 更新 `docs/GAMEPLAY.md` 图鉴与波次表。

### 调整波次/难度

- `config.js`：`wavePlan`、`waveMaxAlive`、`waveSpawnInterval`、`zombieHpMul`、`zombieSpeedMul`。
- 清波奖励/回血在 `Game.onWaveClear`；Boss 波逻辑在 `wavePlan` 的 `n % 5`。

### 新增 HUD 元素

1. `index.html` 加结构，`style.css` 加样式（注意 `pointer-events` 与安全区）。
2. `HUD.js` 缓存元素引用并加更新方法；Game 里驱动。
3. 屏幕阅读/触控尺寸：按钮建议 ≥ 44px。

### 新增音效

- 在 `Sfx.js` 用 `tone()` / `noise()` 组合，导出命名方法（如 `explosion()`）；在系统里通过 `ctx.sfx` 调用。
- 音量统一走 `master`，不要直接连 `destination`。

---

## 7. 调试与验收

### 调试句柄

`window.__game` 暴露了整个游戏，可在浏览器控制台/无头脚本里直接操作：

```js
__game.state                    // menu | playing | paused | over
__game.player.pos               // 玩家位置
__game.zombies.zombies          // 当前僵尸数组
__game.zombies.startWave(5)     // 跳到第 5 波
__game.spendSun(999)            // 改阳光
__game.renderer.info.render     // draw call / 三角面
```

### 改动后的最低验收

- `npm run build` 通过；控制台无 error / pageerror。
- 桌面（1440×860）：开始 → 指针锁定 → WASD 移动 → 鼠标转视角 → 左键射击 → 1-4 切植物 → 空格跳 → Esc 暂停/继续。
- iPhone 横屏（844×390）与竖屏（390×844）、iPad（1024×768）：虚拟摇杆、右侧拖动、开火、跳跃、植物栏都可用；HUD 不被安全区裁切。
- 武器：豌豆命中/爆头、寒冰减速变蓝、樱桃落地爆炸、玉米炮即时爆炸。
- 流程：击杀掉阳光并拾取、清波加分、暂停/恢复、死亡结算、再来一局。
- 性能：1–4 只僵尸时 draw call 约 90–130；14 只时不超过约 250。

### 无头烟测（可选）

项目不依赖 Playwright；需要时临时安装，用系统缓存 Chromium 启动，访问 `npm run dev` 的地址，点击 `#startBtn`，截图并读取 `window.__game`。测试脚本不要提交进仓库。

---

## 8. 已知限制（是设计取舍，不要当 bug 修）

- 只有一张后院无尽地图，没有关卡章节/剧情。
- 没有弹药与换弹；豌豆无限，特殊植物靠阳光。
- 僵尸全是近战，没有远程/投掷单位。
- Boss 只有高血量/高伤害/大攻击距离，没有专属技能。
- 爆炸无视遮挡（地图开阔）；辅助瞄准不预判移动。
- 僵尸不寻路，只有直线追击 + 分离 + 碰撞推出。
- 割草机是装饰，不会触发清场。
- 同屏僵尸硬上限 14（移动端性能）。
- 没有单元测试；不要假装有。

---

## 9. 提交约定

- 使用简短前缀：`feat:` / `fix:` / `perf:` / `docs:` / `refactor:`，正文用中文。
- 一次提交只做一件事；美术/数值改动同时更新 `docs/GAMEPLAY.md`。
- 不提交 `node_modules/`、`dist/`、`.idea/`、`generated-images/`（已在 `.gitignore`）。

---

## 10. 快速索引

- 想改手感：`Player`（速度/跳跃/回血）+ `WeaponSystem`（后坐/摇摆/辅助瞄准）。
- 想改难度：`config.js` 波次公式 + `ZombieManager` 生成逻辑。
- 想改画面：`Arena`（场景/光照）、`materials.js`（色调）、`ZombieModel`（僵尸造型）。
- 想改 UI：`index.html` + `style.css` + `HUD.js`，注意 `pointer-events` 与安全区。
- 想加内容：先加 `config.js` 数据，再补系统，最后同步 `docs/GAMEPLAY.md`。
