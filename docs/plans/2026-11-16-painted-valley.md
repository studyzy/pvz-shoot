# 计划：把 Painted Valley 渲染栈移植成 pvz-shoot 第 8 张地图

> 基线日期：2026-11-16。计划已确认、已实施完毕。
> 硬件约束（用户明确）：本机硬件很差，**不做任何性能实测/压测，只要能跑就行，不关心性能**。
> 因此所有画质参数一律取最低档，P4 的性能章节只保留「低档参数 + 能跑通」，不量帧率、不做构建期预烘焙。
>
> **实施状态（2026-11-16 收尾）**：P0～P5 全部完成。验收：`npm test` 2163 用例全绿、
> `npm run build` 通过、`npm run extract:maps` 已重生成 `src/sim/mapdata.json`（8 张图）、
> `npm run sim:headless` 7 张固定地图全过、`npm run test:e2e`（真实 Chromium/SwiftShader）
> 的 `maps` 与新增 `valley` 场景通过，valley 帧 `gl.getError() === 0`、控制台零报错，
> 真实截图确认草甸/堆云/远山 + 清晰 cel 豌豆射手 + HUD 时段按钮都正常。
> 未做性能实测（按用户要求）。

## 0. 目标与边界

- 目标：pvz-shoot 新增地图「彩绘山谷」`id: valley`（第 8 张），把 `~/painted-valley` 的手绘山谷做成可玩战场。
- 方案（用户选定）：**整体移植渲染器**。移植 `src/lib/*`（field/grass/frame、Kuwahara 笔触、ink 描边、bloom、色调曲线）与 `src/valley/*`（sky、clouds、backdrop、horizon、floor、farwoods、village、trees、water、dressing、strokes、world）。
- **不移植**：`src/figure/*`（Rapier walker、animator、cloak、input、camera）、`wanderer.js`、`sounds.js`、`patch-block`、`tools/`。玩家仍用 pvz-shoot 的 `Player`/`Controls`，音效仍用 `Sfx`。
- 机制（用户选定）：**时段变化**（正午 → 午后 → 黄金时刻 → 日落），天空/云/远山/草甸/主光一起变。
- 与「不加地形高低差」一致：不给 `Player`/`Zombie`/弹道/流场/无头数据加高度系统，而是在移植的 `world.js` 里把竞技场压平。

## 1. 决定架构的 6 个约束

1. **three 版本**：painted-valley 0.186.1 / pvz-shoot 0.169.0。移植代码进 `src/painted/` 后统一用 0.169，不升级全项目 three。已核实 0.169 支持 `GLSL3`、`WebGLRenderTarget({count:3})` MRT、`renderer.compileAsync`、`renderer.initTexture`、`Data3DTexture`。
2. **渲染器所有权**：valley 的 `frame.render(scene, camera)` 自己渲到 RT、跑笔触/ink/bloom/色调曲线并直出画布，必须整帧接管 `Game.js:1933` 的 `post.render` 分支。valley 激活时隐藏全局 `sky`/`skyline`/`weather`/`props`；`renderer.toneMapping = NoToneMapping`、`outputColorSpace = LinearSRGBColorSpace` 临时切换，切回来还原。
3. **无头兼容**：`tools/extract-map-data.mjs` 用 jsdom 跑 `createMaps()`，测试用假 WebGLRenderer。构造函数**只产出数据面**；渲染栈用动态 `import()` 延迟到 `attachRenderer(renderer, camera)`，用 `typeof renderer.compileAsync === 'function'` 能力探测，假渲染器/jsdom 一律跳过。`activate()` 只做背景/雾/`root.visible`。
4. **坐标与地面**：valley 是 1.3 km 起伏山地，pvz-shoot 是 ±30 m 平地。在 `world.js` 里把 `land()` 结果减掉 `land(0,0)`（派生高度、`TARN.level`、树/村/远林自动归零），再用 `1 - smooth(28, 80, r)` 把竞技场 56 m 内压平到 y=0，外面渐变回真山谷。`camera.far` 按图提到 ~3000、`near` 提到 0.3（否则 740 m 外的村庄、远山会被裁掉）。
5. **游戏物体与画笔**：`painted()` 用 `tHdr.a < 0.6` 跳过笔触、`inkAt()` 用 alpha 差异描边。移植后的 `frame.render` 渲场景前临时给所有非山谷材质写 alpha=0.2（`transparent=true` + `NoBlending` + `opacity=0.2`，渲完还原；已是 transparent 的特效单独放行），使僵尸/武器/阳光/拾取物不被糊成色块并自带 cel 描边，且不用改业务模块。回退：深度 blit 叠层（`samples` 必须为 0）。
6. **画质**：一律最低档（`EXTENT=512`、`extentRes=512`、`cloudSize=256`、`backdropWidth=2048`、`cloudSteps≈80`、`paint` 触屏关、`samples=0`、跳过 fluff/stones），只为在差机器上能跑通，不量性能。

## 2. 实施阶段

- **P0 尖刀（go/no-go）**：把 `lib/` + `valley/` 拷到 `src/painted/`，临时 `valley-lab.html` 用 pvz-shoot 的 renderer 设置渲一帧；验证 0.169 下 GLSL3 shader 编译无 GL 错误、`createSkyParts`/`createField`/`createFrame` 能跑、塞一只 Zombie 进去 alpha 标记生效。不过关就停在这里，不动 `Game.js`。
- **P1 移植渲染栈**：保留原始 `src/lib` + `src/valley` 的相对目录结构（零改 import）；`world.js` 加高度归零 + 竞技场压平；`frame.js` 加 alpha 标记；拷贝 `public/textures/*`（4 张 ambientCG 地表）到 `public/textures/`；新增 `src/world/valleyRenderer.js` 按 `main.js:84-206` 顺序组装、异步加载、`valleyFrame.render()` 与各 `update()`。
- **P2 地图接入**：`src/world/valleyLayout.js`（纯数据 bounds/spawn/pickupSpots/colliders/walls，点位 ≤10）、`src/world/PaintedValley.js`（§5.9 契约，root 内 ≥2 盏灯给 GLB 补光，`noShadows=true`，`update(dt)` 驱动各 update 与时段）；`maps.js` 追加 `MAPS`；`Game.js` 加 `attachRenderer`/camera.far/全局大气显隐/渲染分支；`materials.outdoorEnvironment` 加 `valley` key、`net/protocol.js` 的 `MAP_IDS` 追加、`HUD.MAP_ART` 加 SVG、`style.css` 主题；首次选中才异步构建并复用 `LoadProgress` 显示进度，`ready=false` 时菜单用 `post.render` 兜底。
- **P3 时段机制**：键位避让 painted-valley 的 `1–4` 与武器槽冲突，改 `T` 循环四档、`0` 恢复漂移、`,`/`.` 微调 ±0.25；触屏 HUD 加「时段」按钮（仅 valley 显示）；跳档走 `sky.setHour()` + `clouds.drawAll()` + `trees.cast(sunDir)`，漂移走 `soft=true` + `clouds.update(dt)`；每帧 `frame.exposure = sky.exposure` 并同步 root 两盏灯；时段逻辑放 `src/world/valleyHours.js` 便于单测。
- **P4 测试与验证**：改 `tests/harness.test.js:22`、`tests/integration/flows.test.js:339`、`tests/unit/maps.test.js`（7→8、id 数组、构造表、环境贴图 6→7）；新增 `tests/unit/painted-valley.test.js`（数据面契约、时段纯函数、压平后 `heightAt` 恒 0、假渲染器下 `attachRenderer` 空转、`activate/menuCamera`）；改前改后各跑 `npm test`；`npm run extract:maps` 重生成 `src/sim/mapdata.json` 并一起提交；`npm run sim:headless` 验证 8 张图；`npm run test:e2e`（低档参数）、`npm run build`。**不跑性能相关验证**。
- **P5 文档与署名**：README.md（地图列表/技术说明）、AGENTS.md（地图数量、§5.9 补「valley 渲染器延迟构建」、§6 新增地图步骤）、docs/GAMEPLAY.md（时段机制）；按 MIT/CC0 补 `src/painted/LICENSE`、`LICENCE-NOTES.md`/`CREDITS.md` 署名。

## 3. 验收

菜单 8 张卡可切、切图无残留、山谷画面真跑笔触/云/远山、僵尸与武器清晰且被地形正确遮挡、刷怪/拾取/波次/Boss/双人/切时段全正常、`npm test` 全绿、`npm run build` 通过、`extract:maps` 与 `mapdata.json` 已提交。

## 4. 风险与回退

| 风险 | 回退 |
|---|---|
| 0.169 跑不了移植的 GLSL3/MRT | P0 不过关就停在尖刀，改「风格复刻」或升级全项目 three 并重测 |
| alpha 标记影响粒子/透明特效 | 只对非 transparent 材质打标，特效放行；再不行改深度 blit 叠层 |
| 异步构建卡住菜单/测试 | `ready` 标志兜底直出；`attachRenderer` 能力探测跳过假渲染器 |
| 山谷尺度与 240 m 远裁冲突 | 按图调 `camera.far/near`（P2 已列） |
