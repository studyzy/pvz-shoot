# pvz-shoot 画面与手感优化计划

> 基线日期：2026-11-12。所有数字来自本机实测（`vite preview` + headless Chromium，1280×633，软件/硬件渲染均采样）。

## 0. 结论先说

pvz-shoot 在**内容量和工程规范**上其实领先 Saltline（6 张图 / 12 武器 / 13 僵尸类型 / 5 兽群族 / 双人权威联网 / 1075 单元测试 + 14 个 E2E 场景）。差距**只在一条线上**：它的每一帧都"直出"，没有任何一层负责把粗糙糊成氛围的东西。

实测证据：

| 项 | pvz-shoot 现状 | 说明 |
| --- | --- | --- |
| 后期处理 | **0 个** | `EffectComposer` / `ShaderPass` / `WebGLRenderTarget` / `UnrealBloom` 全仓 0 命中 |
| 自定义 shader | **0 个** | `ShaderMaterial` / `onBeforeCompile` 全仓 0 命中，材质能力被锁死在 three 内置 |
| 法线贴图 | **0 处** | `normalMap` 全仓 0 命中 |
| 粗糙度/金属度贴图 | **0 处** | `roughnessMap` 全仓 0 命中 |
| 阴影贴图精度 | 5.9–9.8 cm/texel | 1024² 覆盖 60 m（后院）/ 100 m（摩天街区） |
| 阴影相机 | **固定不动** | `shadow.camera` 锁在 ±30 m 原点，走到场地边缘阴影就断 |
| 影子层数 | **2 层**（bug） | 真实 `castShadow` + blob 贴图同时存在，见 §1.3 |
| 地面贴图 | 22.8 px/m | 256 px tile 平铺 16 次盖 180 m |
| 天空 | 8×512 渐变条 | 拉满全屏，无太阳、无云层、无大气 |
| 环境音 | 无 | `ConvolverNode` 0 命中，无混响、无 HRTF、无 BGM |
| 打击感 | 无 | 无 hitstop、无 ADS、无冲刺、无蹲 |
| 14 僵尸同屏 | 131 draw / 17.1 万面 / 60 fps | 帧率被 vsync 锁死，**测不出真实余量** |

所以优化方向不是"加资产"，而是**补上渲染与反馈的中间层**。优先级按"单位改动带来的观感提升"排。

---

## 1. P0 — 光影基础（预计 4–6 天，观感提升 40%）

这一层单独做完，画面质感的提升就超过后面所有项之和。

### 1.1 阴影跟随玩家 + 收紧范围

**问题**：`Arena.js:90-95` 把 `shadow.camera` 写死成 `±30`，`Downtown.js:251` 写死 `±50`，光源 `position` 和 `target` 也固定在原点。玩家跑到 23 m 场地边缘时，一多半僵尸落在阴影相机外，**影子直接消失**（不是变淡，是没了）。

**做法**：

- `Game.update` 里每帧（或每 4 帧）把 `sun.position` 和 `sun.target.position` 平移到玩家脚底，同时保持原方向偏移量。
- 阴影范围从"盖全场"改成"盖玩家周围 34 m"：`±17` 而不是 `±30`。同样的 1024²，texel 从 5.86 cm 降到 **3.3 cm**，清晰度提升 78%。
- `Downtown.js` 同理：`±50 → ±22`，texel 从 9.77 cm 降到 **4.3 cm**。
- 加 `sun.shadow.camera.updateProjectionMatrix()` 只在范围变化时调，别每帧调。

**验收**：走到四角任意位置，脚下僵尸都有影子；截图对比 texel 密度；`renderer.info.render.calls` 不增加。

### 1.2 去掉 blob 影子（或只留给空中单位）

**问题**：`Zombie.js:406` 给每只僵尸挂了一个 1.5×1.5、`opacity: 0.8`、颜色 `0x20300f` 的贴图影子；`Zombie.js:485` 又给身体网格设了 `castShadow = true`。**两层影子叠在一起**，近距离看就是"脚下有块脏东西"。我用控制台把 blob 逐个 `visible = false` 后截图对比，真实投影是干净的，观感立刻好一截。

**做法**：

- 地面僵尸：`castShadow` 已开 → blob 关闭。
- 气球（`airborne`）：真实投影会飘到远处地面，反而是对的线索 → 保留 blob 但 `opacity` 降到 0.35，`scale` 收到 0.9，并让它**投在正下方地面**（现有 `shadow.position.y = (0.025 - airHeight) / scaleFactor` 已经做了，只要削弱）。
- 无阴影地图（forest / cloud，`noShadows = true`）：blob 必须保留，否则僵尸"贴地漂浮"。

**验收**：后院/雪地/沙城/摩天街区四图，僵尸脚下只有一层软阴影；森林/云园仍有 blob；`grep shadowMaterial` 只剩一处使用分支。

### 1.3 后期管线（这是最大的一块）

现状是完全 forward 直出。需要一条最小可用的 pass 链。three 0.169 自带 `examples/jsm/postprocessing/`（`EffectComposer` / `RenderPass` / `UnrealBloomPass` / `OutputPass` / `SMAAPass` 都在，无需装新包），但**推荐手写**，理由：

- 手机端 `EffectComposer` 的 RT 数量多、带宽吃紧。
- 需要跟现有自适应分辨率（`Game.js:1801-1824`）联动，手写更好控。
- 后续要接体积光/雾，自己管 RT 更省事。

**建议顺序（每一步都可单独开关，默认按设备档位）：**

| pass | 参数起点 | 目的 | 成本 |
| --- | --- | --- | --- |
| 1. 场景 → HDR RT（半浮点） | 无 | 为色调映射留余量 | 1×RT |
| 2. SSAO（8 tap 足矣） | 半径 0.6 m / 强度 0.8 | **接触阴影**，这个是"贴地感"的关键 | 1×半分辨率 RT |
| 3. 深度感知 Bloom | 强度 0.06 / 阈值 1.1 | 天空、发光植物、枪口火焰发光 | 4–6 级降采样 |
| 4. 高度雾（代替 `THREE.Fog`） | 近 40 m / 远 160 m + 高度衰减 | 远处集装箱/楼群自然淡出，成本几乎为零但观感提升巨大 | 复用 pass 4 |
| 5. ACES/AgX 色调映射 + 曝光 | 曝光 1.0，AgX 混合 0.3 | 现在用的是 `NeutralToneMapping`，高光会死白 | 1 pass |
| 6. 收尾：色差 0.0008 / 暗角 0.25 / 胶片颗粒 0.015 / 锐化 0.25 | — | 统一画面语言 | 1 pass |

**关键**：先做 1+3+5+6（约 2 天），再做 2（SSAO，1 天），最后做 4（1 天）。每步都要有 `?post=0` 的降级开关，与现有 `pixelRatio` 自适应串起来——**帧时间超过 20 ms 先关 SSAO，再关 Bloom，最后降分辨率**。

**预算约束**：现有 14 僵尸时 131 draw / 17.1 万面。加后期后总帧时间目标仍是 16.6 ms（60 fps）。若达不到，优先砍 SSAO 到 4 tap。

### 1.4 静态阴影缓存

**问题**：`shadowMap.autoUpdate` 从来没被关过，每帧重算全场阴影贴图。而地图（栅栏、房子、集装箱、楼）是**完全静态**的。

**做法**：地图静态几何单独一份 `shadowMap`，只在切图时 `needsUpdate = true` 一次；动态物体（僵尸/玩家/投射物）走第二层动态阴影或直接只吃 blob。

**收益**：省一整遍场景阴影渲染，是后期管线的预算来源。**这条做完基本能抵掉 SSAO 的开销。**

---

## 2. P1 — 材质升级（预计 3–4 天）

现状：地面 `MeshLambertMaterial`（`Arena.js:110`），其余主要是 `MeshToonMaterial`；`normalMap` 和 `roughnessMap` 全仓 0 处。

### 2.1 给程序化贴图补法线

这是**性价比最高的一步**：所有贴图都是 canvas 画的（`materials.js`），意味着高度场本来就在手里，只要多输出一张法线图。

**做法**：

- 在 `materials.js` 加一个 `toNormalMap(canvas, strength)`：把灰度当高度，用 Sobel 差分算切线空间法线，输出 `CanvasTexture`。
- 优先级：**灰色石板路（`Arena` 里的 `pathMat` 区域）> 雪地 > 沙地 > 草地 > 冰面**。石头和雪最吃法线。
- 草地不用法线，改用**视差感的双层贴图 + 边缘噪声**，成本更低。

**验收**：贴地俯视截图，石板缝/雪面颗粒有立体感；`grep normalMap` 从 0 变成 4–5 处；手机端帧时间不涨超过 1 ms。

### 2.2 材质从 Lambert/Toon 迁到 Standard（选择性）

**不要全迁**。Toon 是这个游戏的**美术语言**，迁掉会让风格崩掉。只在下列位置换 `MeshStandardMaterial`：

- 地面（石板/沥青/雪/沙）
- 金属：集装箱、铁桶、栅栏、井盖
- 玻璃/水面

其余（角色、植物、树、云、花）保留 Toon。**两套材质混用是有意的风格分层**：环境写实、角色卡通。

**注意**：一旦引入 Standard，`envMap` 必须给上。`outdoorEnvironment()`（`materials.js:736`）已经产出 PMREM 环境贴图，现在只给了僵尸（`envMapIntensity 0.35`）。地面/金属要给 `envMapIntensity 0.6~1.0`，否则金属会变成一片死灰。

### 2.3 地面细节层（不做会显得"塑料"）

现在 180 m 地面 = 一张 256 px 贴图平铺 16 次（22.8 px/m）。补三样：

1. **大尺度脏污遮罩**：一张 512² 的 mask 贴图（程序化，perlin + 边缘暗化），以世界坐标采样，让每个 tile 长得不一样。这一条能干掉"复制粘贴感"。
2. **路沿/石板描边**：用 `fwidth()` 在 shader 里画 6 m 一块的接缝和灌缝胶（Saltline 就是这么做的，见 `Tn.asphalt`）。
3. **贴花（decal）**：血迹、脚印、泥点、弹坑、轮胎印，圈在击杀点/出生点，池化复用。这是"有人来过"的廉价信号。

实现上需要第一次引入 `onBeforeCompile` 或 `ShaderMaterial`——这正是 §1.3 手写 pass 带来的能力。

### 2.4 法线陷阱提醒

`Zombie.js:485` 里 `n.receiveShadow = false` 是对的（蒙皮不要接阴影），但**地形网格必须有 `receiveShadow = true`**，现在地面已经是了，新增的贴花/石板层别忘了。

---

## 3. P2 — 天空与大气（预计 2–3 天）

现状：天空是 8×512 的 canvas 渐变，`scene.background` 直接拉满；云是 sprite（`Arena.js:465`）。

### 3.1 换个天空穹顶

- 用一个大球（半径 400，`BackSide`）配 fragment shader，按视线方向算颜色。
- 六张图只改 4 个颜色常量和太阳方向，代码一份。这是 Saltline 的做法（`SALTLINE_SKY`），性价比极高。
- 必须加：**太阳盘**（`pow(dot,200)` 的亮核）、**地平线暖带**、**云层 fbm**（3 层即可）。

### 3.2 雾改成高度雾

现有 `THREE.Fog` 6 处（`Arena.js:38` 等），是均匀距离雾，远处物体"整块变白"，很假。

改成在 pipeline 里算的高度雾：`fogFactor = 1 - exp(-density * dist * exp(-height * falloff))`。**低洼处先起雾，高处清晰**——这是"真实大气"最便宜的一条线索。

搭配：给每张图一个 `fogColor / density / falloff` 三元组，写进 `maps.js`。

### 3.3 远景剪影

后院/雪地/沙城的场地边界外现在是空的。补一层**程序化远景剪影**：一圈低多边形屋顶/树线/山脊，不接阴影、不受雾以外影响、单色。**成本约 2 个 draw call，但让"世界比场地大"这件事成立了。**

摩天街区已有楼群，只需补更远的一层（用 `LOD` 或直接远景平面）。

### 3.4 天气与粒子

夜之森林已有手电（`NightForest`），但**没有雨/雪/落叶**。建议先做一张图的：
- 雪地：落地雪粒 + 地面风速扰动（`ice` 图最适合，视觉收益最大）
- 森林：飘落叶 + 萤火
- 用 `InstancedMesh` + 顶点着色器算位置，**CPU 零开销**

---

## 4. P3 — 打击感与操作手感（预计 3 天）

这部分不用改一行渲染代码，但对"这游戏做得好不好"的主观评价影响极大。实测确认现状：**无 sprint、无 crouch、无 ADS、无 hitstop**（`grep sprint|crouch` 全仓 0 命中）。

### 4.1 Hitstop（优先级最高，2 小时）

命中/击杀时把 `dt` 乘 0.05 持续 40–70 ms（爆头 90 ms）。这是所有商业 FPS 的标配，**改动量只有几行**，但打击感能翻倍。

实现：`Game.loop` 里 `const dt = hitstop > 0 ? raw * 0.08 : raw`，`hitstop -= raw`。

### 4.2 命中反馈叠层

现有只有 `HUD.hitmarker(head)`（DOM）。补：
- **命中音**：现在 `SAMPLES.hit` 存在但只在部分路径播，检查所有弹种都覆盖。
- **数字/血迹**：命中点弹一个小平面 decal（池化 32 个）。
- **屏幕微震**：`shake(0.08)` on hit，`shake(0.35)` on kill。
- **击杀时 0.3 s 白闪**：`renderer` 的 exposure 脉冲或后处理 pass 里的 `uFlash`。

### 4.3 冲刺 / 蹲

- 冲刺：Shift 按住，`playerSpeed × 1.55`，FOV 从 73 → 79（`camera.fov` 现有 resize 逻辑要挪出来单独管），武器模型下压、准星扩散。
- 蹲：Ctrl/C，眼高 1.66 → 1.05，移速 × 0.55，准星收紧。
- **必须补 E2E 用例**：`__game.player.pos` 位移速度断言。

### 4.4 瞄准（ADS）

右键进入，FOV 73 → 55，鼠标灵敏度 × 0.6，武器模型上举居中，准星收成点。
**现有 `Controls` 只监听 `button === 0`**（`Controls.js:142,241`），要加 `button === 2` 分支，且 `contextmenu` 已经 `preventDefault` 了，不会冲突。

### 4.5 移动物理微调

现状 `playerSpeed: 5.4`，`jumpSpeed: 7.2`（跳高 1.23 m），重力 21。数值本身合理，但缺：
- **空中控制**：现在空中不能改向（没找到 `accelAir` 之类），跳到平台边缘很难救回来。
- **落地缓冲**：落地时没有镜头下沉，缺重量感。
- **斜坡行走**：`AGENTS.md §8` 明确说"没有通用地形/斜坡"，只剩轴对齐平台。**这条暂时别动**，是承重设计。

---

## 5. P4 — 音频（预计 2 天）

现状：16 个 CC0 wav 内嵌进 `main.js`（`vite.config.js` 的 `embed-audio` 插件，latin1 转义），20 条 `SAMPLES` 表驱动；`grep ConvolverNode` = 0，`grep PannerNode` = 0，**只有 `StereoPanner`（左右两声道）、无混响、无 BGM**。

### 5.1 混响总线

一条 `ConvolverNode` + 程序化 IR（噪声 + 指数衰减，500 ms / 1.4 s 两档），挂在 `master` 前的 send 上。室内/室外切换 send 量。
**成本：约 40 行代码，观感提升巨大**——现在所有声音都"贴在耳边"，加混响后立刻有空间。

### 5.2 HRTF 定位

现在僵尸低吼的 pan 是 `(z.x - player.x) / 24`（`ZombieManager.js:173`），是手工近似，**前后完全分不出来**。

换成 `PannerNode` + `panningModel: 'HRTF'` + `setPosition`。至少给僵尸吼叫/脚步/枪声这三个高频源。

### 5.3 BGM

完全没有。建议先做**分轨自适应**（Saltline 的做法）：3 条 loop（calm / combat / boss），按场上僵尸数量交叉淡入淡出。或者更省事的：一条 `drone` + 一条 `perc`，战斗强度到阈值时叠上去。

**注意授权**：`public/audio/` 现有素材是 CC0，新增必须同样留 `LICENSE-audio.txt` 记录来源与裁剪参数（仓库已有这个约定）。

### 5.4 脚步

现在没有脚步音（`SAMPLES.step` 存在但没接）。接上按地面材质分档（草地/雪/沙/石板/冰），并用 `bob` 相位触发。**这是"在地面上走"最直接的确认信号。**

---

## 6. P5 — 内容密度与关卡引导（预计 4–5 天）

### 6.1 环境叙事

后院现在"草地 + 栅栏 + 房子 + 墓碑 + 树"，是**布景**不是**场景**。补：
- 房子侧面：晾衣绳、水管、空调外机、垃圾桶
- 草地：割草机痕迹（贴花）、水洼、落叶堆、翻倒的花盆
- 栅栏：缺板、藤蔓、锈钉
- 墓碑区：枯花、蜡烛、翻开的土

**做法**：全部走现有 `InstancedMesh` 模式（`Arena.js:143/420/440` 已有 3 处范例），每种 1 draw call。

### 6.2 战斗空间的可读性

- **掩体标记**：可破坏/可躲的物件事先描边或高亮（仅在教学波次）。
- **危险预警**：Boss 技能现在有 telegraph，普通僵尸攻击（`attackTimer 1.28 s`）**没有视觉预备动作**。加抬臂前摇 + 屏幕边缘红晕。
- **刷怪点指示**：波次开始时给刷怪方向一个罗盘刻度（现在只有 banner 文字）。

### 6.3 波次节奏

`config.js` 里 `intermission: 5.0`（后院），`wavePlan` 从 `4 + n*1.45` 只僵尸线性增长，**没有起伏**。改成分段：
- 第 1–3 波：教学，慢，稀疏
- 第 4–8 波：引入新类型，**每波留 1 个"喘息波"**（数量减半）
- 第 9+：混合 + Boss 穿插
- intermission 从固定 5 s 改成**按上一波清场速度浮动**（快清快进，慢清多给 2 s）

### 6.4 死亡与重开

现在死亡直接结算。补：死亡镜头（慢放到尸体，`updateDeathCam` 已有雏形）、击杀回放（可选）、结算页给"最强一杀/最高波次"。

---

## 7. P6 — 性能与加载（预计 3 天）

### 7.1 首屏预算

实测首屏 **6.65 MB**（`main.js` 2.1 MB + `zombie/alchemist/pack.glb` 3.6 MB + 音频 0.95 MB），全量 31 MB。

- `main.js` gzip 后 720 KB，其中**内嵌音频占 756 KB 原始（转义后膨胀约 3 倍）**。改成 `fetch` 音频为独立 `.ogg`（`public/audio/*.ogg` 已经存在但**没被引用**，204 KB 全量 vs wav 756 KB）→ **省约 1.5 MB，且首屏不再阻塞**。
- `pack.glb` 1.73 MB 里 12 把植物模型，只有 2 把是开局必需。按角色槽懒加载。
- glb 全部未压缩。上 **Draco 或 meshopt**（`@gltf-transform/cli` 已在 devDependencies）：28 MB → 约 8–10 MB。**注意**：`AGENTS.md §5.3` 明确 `simplify` 会炸蒙皮，**只做 `draco`/`meshopt`，不要 `simplify`**。

### 7.2 移动端档位

现在 `maxPixelRatio = min(devicePixelRatio, 2)` 对所有设备一样，只有帧率驱动的动态降级（`Game.js:1814`，43 fps 以下降 0.25）。补：

- 触屏设备 `maxPixelRatio = 1.5`，且阴影贴图 1024 → 512
- 后期档位：低端机只开色调映射 + 暗角（不做 Bloom/SSAO）
- 提供设置面板：画质三档（低/中/高），写进 `localStorage`

### 7.3 减少 draw call

现有 36–131 个（场景 76–80，14 僵尸 +51）。可优化：
- **静态几何合并**：`Arena` 36 个 `new Mesh`、`Downtown` 26 个，按材质分桶 `mergeGeometries`（`CloudCarnival.js:27` 已有范例）。
- **骷髅 9 个蒙皮 mesh**（`AGENTS.md §5.3.1` 已知问题）：`gltf-transform join` 对蒙皮无效，只能手工按骨骼合并同材质网格，预计 9 → 3。

---

## 8. P7 — 工程侧（顺手做，卡住进度会很难受）

- **`farmer.glb` 1.4 MB 是死资产**（`RemotePlayer` 已不引用）→ 删。
- **`public/audio/*.ogg` 204 KB 从未被引用** → 要么接上（§7.1 建议接上），要么删。
- **E2E 缺渲染断言**：14 个场景里 `perf` 只采样 10 s，**没有像素级回归**。补一条：固定 `?map=backyard&cam=x,y,z` 截全屏，与基线图做 `SSIM > 0.98` 断言。后期管线改动全靠这条兜底。
- **`docs/GAMEPLAY.md` 必须同步**：所有数值改动（冲刺速度、ADS FOV、波次公式）都要写进去（`AGENTS.md §5.1` 硬约定）。
- **新增材质/贴图进 `docs/` 留痕**：`materials.js` 已经是 826 行，再加功能建议先拆 `materials/textures.js` + `materials/materials.js`。

---

## 9. 排期建议

按"每一阶段结束都能发布"来切：

| 阶段 | 内容 | 工期 | 累计观感 |
| --- | --- | --- | --- |
| **M1** | §1.1 阴影跟随 + §1.2 去双层影 + §4.1 hitstop | 1.5 天 | +25% |
| **M2** | §1.3 后期管线（Bloom + 色调映射 + 暗角/颗粒/锐化） | 2.5 天 | +50% |
| **M3** | §3.1 天空穹顶 + §3.2 高度雾 | 2 天 | +65% |
| **M4** | §1.4 静态阴影缓存 + §1.3 SSAO | 1.5 天 | +75% |
| **M5** | §2.1 法线贴图 + §2.2 环境材质迁 Standard + §2.3 地面细节 | 3.5 天 | +85% |
| **M6** | §4.3 冲刺/蹲 + §4.4 ADS + §5.1 混响 + §5.4 脚步 | 3 天 | +92% |
| **M7** | §6 内容密度 + §3.4 天气 | 4 天 | +97% |
| **M8** | §7 性能与加载 | 3 天 | 收尾 |

合计约 **21 个工作日**。如果只有一周，做 **M1 + M2 + M3**（6 天）——这三块占全部观感提升的 65%。

---

## 10. 三条不能碰的红线

写在 `AGENTS.md` 里、优化时容易顺手破坏的：

1. **Toon 材质是美术语言**，环境可以写实化，角色/植物不能。§2.2 只换地面和金属。
2. **僵尸模型不能 `simplify`**（会炸 `JOINTS_0/WEIGHTS_0`）。只能 resize / webp / draco / meshopt。
3. **`src/config.js` 是唯一数值入口**，波次/速度/FOV 改动必须写这里并同步 `docs/GAMEPLAY.md`。测试里大量硬编码下标，`WEAPONS` 只能往数组末尾加。

另外两条本项目特有：

4. **`intermission` / 波次公式改动要同时过 `wavePlan` 和 `Game.onWaveStart`**（`AGENTS.md §5.3.4` 记过第 10 波横幅不一致的坑）。
5. **新增全屏 DOM 元素必须 `pointer-events: none`**，否则挡瞄准。后期方案里的"暗角/颗粒"**必须走 canvas，不能再用 CSS 层**——现在 `#vignette` 是 DOM，`backdrop-filter` 有 16 处，移动端很吃性能。