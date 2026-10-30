# 测试指南（UT + 集成测试）

项目从"没有测试"升级为一套 **Vitest 4 + jsdom** 的单元/集成测试体系，外加**真实浏览器 WebGL 冒烟测试**和一套**浏览器级 E2E**（见第 5 节）。

```bash
npm test              # 跑全部 UT + 集成测试（jsdom，约 10 秒）
npm run test:watch    # 监听模式，改代码自动重跑
npm run test:coverage # 跑全部测试并输出覆盖率报告（coverage/index.html）
npm run webgl-check   # 真实 Chromium + WebGL 冒烟（构建 → 起 preview → 点开始 → 刷僵尸 → 开火）
npm run test:e2e      # 浏览器级 E2E：6 个场景（真 WebGL/glb/DOM 交互），约 70 秒
```

---

## 1. 测试分层

| 层 | 目录 | 跑的是什么 | 能抓住什么 |
| --- | --- | --- | --- |
| 单元测试 | `tests/unit/` | 单个模块，多数直接 new 出系统对象 | 数值/公式/边界/状态机分支回归 |
| 集成测试（jsdom） | `tests/integration/` | **真实 `Game`** + 真实 `index.html` DOM + 完整 `Game.update` 帧循环 | 系统之间的接线：开火→命中→击杀→掉阳光→拾取→加分；暂停/死亡/重开；切图；触屏 |
| 静态契约 | `tests/integration/projectcontract.test.js` | 读源码文本 + config 数据 | `HUD` 引用了 index.html 里不存在的 id、新植物忘补图标、数值表被误改、外部 CDN 混入 |
| 真实渲染冒烟 | `tests/integration/spawnZombies.webgl.mjs` | Playwright + 系统 Chromium（SwiftShader） | jsdom 覆盖不到的部分：真实 WebGL 上下文、材质编译、真实 glb 加载、draw call/三角面 |
| 浏览器级 E2E | `tests/integration/browser.e2e.webgl.mjs` | 同上 + 真实键鼠/触屏/布局 | 指针锁、WASD/鼠标视角、按钮真实可点、手机横竖屏、地图切换、10 秒性能水位、结算与重开（详见第 5 节） |

jsdom 里 WebGL 是假的，所以**渲染与真实交互正确性靠 `npm run webgl-check` / `npm run test:e2e` 兜底**，其余逻辑全部在 `npm test` 里。

---

## 2. 基础设施（写测试前先看这里）

### 2.1 全局替身：`tests/setup.js`

jsdom 不提供下面这些东西，setup 里补齐，所有测试自动生效：

- `HTMLCanvasElement#getContext('2d')` → `@napi-rs/canvas`（`materials.js` 的程序化贴图、`WeaponPickups` 的名称牌都要真画）
- `requestAnimationFrame` → 手动队列（不让渲染循环真的跑起来）
- `matchMedia` / `visualViewport` / `innerWidth`×`innerHeight`（1440×860，可用 `globalThis.__setViewport(w, h)` 改）/ `devicePixelRatio=2`
- `afterEach` 清 DOM、清计时器、复位视口
- fixture 注入：`globalThis.__fixture.{indexHtml, zombieGlb, sources}`

> **坑 1：node 内置模块在 jsdom 模块图里拿不到。** vite 会把 `node:fs` / `node:path` externalize 成空壳对象。所以要读仓库文件，统一走 `vitest.config.js` 在 node 侧读好、用 `define` 注入的 fixture（新增文件要加到 `SOURCE_FILES` 列表里），测试里用 `readSource('src/Game.js')`。

### 2.2 测试替身：`tests/helpers/`

| 文件 | 提供 |
| --- | --- |
| `env.js` | `mountIndexHtml()`（渲染**真实** `index.html` 的 body）、`installFakeAudio()`（WebAudio 记录器）、`installPointerLock()`、`installGlobals()`、`readSource()` |
| `game.js` | `makeFakeRenderer()`、`createGame()`（完整可跑的 `Game`，停在 menu 态）、`step()` / `stepWithMap()`、`spawnZombieAt()`、`aimAt()`、`readyToFire()` |
| `imagebitmap.js` / `bloburl.js` | 给 GLTFLoader 的贴图链路补 `createImageBitmap` / `URL.createObjectURL` |

### 2.3 两条硬规则

**规则 A：测试文件 `import` three 时，顶部必须 mock `WebGLRenderer`。**

```js
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const { makeFakeRenderer } = await import('../helpers/game.js');
  return { ...actual, WebGLRenderer: class { constructor(o) { Object.assign(this, makeFakeRenderer()); this.domElement = o && o.canvas; } } };
});
```

否则 `new Game()` 会去找 WebGL 上下文并失败。

**规则 B：`tests/helpers/*.js` 里禁止 `import * as THREE from 'three'`（必须动态 `await import('three')`）。**

静态 import 会和 `vi.mock('three')` 的工厂形成循环等待，测试会永久挂起（表现为 20s 超时）。同理不要在 imports 里同时拉 `helper → three → Game → helper`。

### 2.4 时间

`Game.update(dt)` 用 `step()` 显式驱动，**不要依赖真实时钟**。只有 `setTimeout` 类逻辑（结算面板 800ms、引导 3s、节流重算）才用 `vi.useFakeTimers()` + `advanceTimersByTime`。

---

## 3. 加新内容时，测试要跟着补哪里

| 改动 | 必须补/会红的测试 |
| --- | --- |
| 新增植物（`config.js` WEAPONS） | `tests/unit/config.test.js` 数据完整性；`tests/unit/hud.test.js` 植物栏数量；`projectcontract.test.js` 会检查 `HUD.ICONS` 有没有图标 |
| 新增僵尸类型 | `config.test.js` 数值单调性；`tests/unit/zombie.test.js` 行为；`zombiemanager.test.js` 阳光掉落数 |
| 新增地图 | `tests/unit/maps.test.js` 的 `describe.each` 会自动跑契约（接口、点位不重叠 ≤10、spawn 不在高台上、流场可达、切图可见性）；不通过说明新地图漏了约定 |
| 新增武器机制（穿透/散射/即时命中） | `tests/unit/hitwalls.test.js`、`projectiles.test.js`、`weaponsystem.test.js` |
| 改 HUD 结构 | `tests/unit/hud.test.js` + `projectcontract.test.js`（id 必须真实存在于 index.html） |
| 改波次公式 | `tests/unit/config.test.js`；`tests/integration/flows.test.js` 的波次推进用例 |
| 改玩家手感 | `tests/unit/player.test.js`（数值都是精确断言，改手感就该顺手改它） |

---

## 4. CI

`.github/workflows/ci.yml` 在 push 到 `main` 和每个 PR 上跑 **三个并行 job**（互不依赖，任一失败即变红）：

| job | 命令 | 失败条件 |
| --- | --- | --- |
| **UT + 集成测试** | `npm ci --include=dev` → `npx vitest run --coverage` | 任何用例失败；覆盖率低于 `vitest.config.js` 的 `thresholds` |
| **浏览器级 E2E** | `npx playwright-core install --with-deps chromium` → `npm run test:e2e` | 任一场景 FAIL；页面出现 `console.error` / `pageerror` / `unhandledrejection` |
| **生产构建** | `npm ci --include=dev` → `npm run build` | 构建失败 |

- Node 版本固定 **22**（`jsdom@29` 要求 `^20.19 || ^22.13 || >=24`）。
- 覆盖率门槛写在 `vitest.config.js` 的 `coverage.thresholds`（当前：语句/行 98%、分支 89%、函数 97%；Vitest 4 的 v8 分支口径比 3 严，分支门槛按新口径校准过），**不要在 CI 里再写死一份**；本地 `npm run test:coverage` 用的是同一套阈值，低于阈值同样 exit 1。
- `playwright-core` 必须用 `npx playwright-core install`（不能用 `npx playwright install`）：E2E 脚本按 `chromium-<rev>` 目录名找可执行文件，浏览器版本必须和 `package-lock.json` 锁定的 `playwright-core` 对齐。
- artifact：`coverage/`（HTML + lcov，14 天）、失败时的 `tests/integration/.artifacts/` 截图。
- `deploy.yml` 仍然只在 push 到 `main` 时跑，与 CI 独立；想"测试通过才部署"，把 Pages 部署的触发改成 `workflow_run` 依赖 CI 成功即可（当前是并行策略，部署不阻塞）。

> **本机注意**：这台机器的 shell 里有 `NODE_ENV=production`，npm 在 production 模式下会 `omit=dev`，把 vitest/jsdom 等 devDependencies 全部裁掉。本机安装依赖请用 `env -u NODE_ENV npm ci --include=dev`。CI 里无需处理（GitHub Actions 不设 NODE_ENV）。
---

## 5. 浏览器级 E2E（真实 WebGL）

`npm test` 跑在 jsdom 里：`canvas.getContext('webgl')` 是假的，`glb` 被替身模型顶掉，指针锁、触屏媒体查询、`getBoundingClientRect` 也都不作数。**下面这些路径只有真浏览器能覆盖**，所以单独有一层 E2E：

| 只有真浏览器能验的 | 对应场景 |
| --- | --- |
| WebGL 上下文建立、材质编译、真实 draw call/三角面 | 全部 |
| `zombie.glb` 真实下载 + 贴图解码 + GPU 上传 | `glb` |
| 指针锁 `requestPointerLock()` 真被调用 | `startup` |
| 真实键鼠事件链路（keydown→controls→player 位移，mousemove→yaw） | `startup` |
| `index.html` 的真实布局：按钮能不能点、有没有被别的元素压住 | `mobile` |
| 触屏媒体查询与 `body.touch` / `body.desktop` 切换、`(orientation: portrait)` 拦截层 | `mobile` |
| 三张地图切换后 `scene.background` / `fog` 真实变化并继续渲染 | `maps` |
| 长跑 10 秒的压力水位（14 只僵尸 + 持续开火） | `perf` |
| 死亡结算面板与"再来一局"的真实 DOM 流程 | `gameover` |

```bash
npm run test:e2e                 # 等价于 node tests/integration/browser.e2e.webgl.mjs
E2E_ONLY=glb,perf npm run test:e2e   # 只跑部分场景，调试时省时间
E2E_PORT=4350 npm run test:e2e       # 固定端口（默认随机 4179-4238，避免并发冲突）
```

脚本会自己 `vite build` → `vite preview`（随机端口）→ 启 Chromium → 串行跑场景 → 退出时 kill 服务。
失败 `process.exit(1)`，末尾打印汇总表（场景 / 耗时 / PASS-FAIL / 关键指标）。

### 失败怎么定位

1. **看汇总表最后一列**：每个场景都带关键指标（击杀数、位移、draw call 峰值、僵尸类型分布…），先判断是"压根没发生"还是"发生了但值不对"。
2. **看截图**：任一场景失败会存 `tests/integration/.artifacts/phase-<name>-FAIL.png`（成功的场景不截图，`perf` / `gameover` / 竖屏拦截会留一张对照图）。截图是**当时真实画面**，HUD 没出来、黑屏、模型没加载都会直接看出来。
3. **看报错栈**：场景失败时打印的 reason 带上文/下文；`console.error` 与 `pageerror` 被探针收集，任何一条都会让场景红（`installProbes`）。
4. **单独重跑**：`E2E_ONLY=<name> npm run test:e2e`。每个场景都会自己走到"playing"（`ensurePlaying`），可以独立跑，不会因为跳过前置场景而失败。

### 环境要求与坑

- 需要 Playwright 的 Chromium：`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`（可用 `PLAYWRIGHT_BROWSERS_PATH` 指定别的缓存目录）。
- 必须带 `--use-gl=swiftshader --use-angle=swiftshader`（无 GPU 时的软渲染），否则无头浏览器拿不到 WebGL。
- **本机 shell 有 `NODE_ENV=production`**：脚本 spawn `vite build`/`vite preview` 时把 `env.NODE_ENV` 置成 `undefined`，否则 Vite 的构建行为会变。改脚本时别删这行。
- **SwiftShader 大约 6 fps**：10 秒采样只有 60 多帧是正常的，`perf` 场景断言的是 10 秒墙钟内的**峰值**而不是帧率，不要拿帧数当性能指标。
- 无头 Chromium 的指针锁**不一定真的生效**（`document.pointerLockElement` 可能是 null），所以 `startup` 断言的是"`requestPointerLock` 被调用过"，鼠标转向的两条真实路径（锁定后的 `mousemove.movementX` / 未锁定时拖动）任一生效即算通过。
- 僵尸队列由 `config.wavePlan` **随机洗牌**，需要特定类型时用 `ensureZombieTypes()` 构造前置条件（只补类型，不改生成逻辑）。
- 脚本里 `page.waitForFunction(fn, arg, { timeout })` 的 `arg` 才是传给页面的参数，写成 `fn, null, {timeout}` 会让页面里拿到 `null`（踩过一次，表现为 `Cannot read properties of null`）。

### 已有回归保护

- `glb` 场景对每只僵尸硬断言 `mats[*].envMap !== null && envMapIntensity > 0`。这条曾经红过：`ZombieManager.spawnOne()` 传给 `new Zombie()` 的 ctx 漏了 `env`，导致僵尸身体没有 PMREM 环境反射（配件反而有）。已修复，`tests/harness.test.js` 里另有对应的 jsdom 用例兜底。
