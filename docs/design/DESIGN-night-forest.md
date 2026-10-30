# 设计案 · 夜之森林（Night Forest）

> 版本 **v3 · 已实装**（2026-10-30）。**奇幻森林 + 12 族群怪物 + 每 5 波 BOSS 轮换**。
> v2 是实装前的设计稿；**实际落地与本稿的差异见 §12「实装记录」**（代码为准，文档对齐代码）。
> v1（写实恐怖向、只用 5 种怪、含 60 秒无声教学）是本文件的历史版本，差异见 §0。
> 输入：仓库实况（src/ / config.js / tests/）+ `aigc/` 82 个 glb 逐件拆包盘点 + 四引擎联合推演。

---

## 0. 这一版改了什么

| 用户的要求 | v1 的做法 | **v2 的做法** |
| --- | --- | --- |
| **奇幻森林** | 写实恐怖：白骨、墓碑、腐叶 | **奇幻**：发光菌、自发光史莱姆、精灵光、魔法营地 |
| **怪的种类多一些**（史莱姆/哥布林/骷髅都出场） | 只留 5 种，砍掉其余 35 个 | **12 种怪 + 4 只轮换 BOSS**，按族群分工 |
| **不需要教学** | 设计了 60 秒「起承转合」无声教学 | **删除**，第 1 波直接开打 |
| **每 5 关一个 BOSS** | 未涉及 | **已有代码 + 扩成 4 只轮换**（见下） |

### 0.1 先做一个核实更正

「每 5 关一个 BOSS」**在现版本里已经存在**：

```js
// src/config.js:474
if (n % 5 === 0) list.push('boss');
```

所以真正要做的是**多 BOSS 轮换**（现在每 5 波出的都是同一只巨型骷髅），而不是新增波次机制。

顺带发现两个**既存 bug**，改轮换时必须一起修：

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `Game.js:1004` | `'第 ' + n + ' 波 · 巨人来袭'` | 文案写「巨人」，但 BOSS 模型是**巨型骷髅** |
| `Game.js:1023` | `'巨人僵尸出现了!'` | 同上，对不上 |

这两处是硬编码字符串，和 `ZombieManager` 里 7 处 `type === 'boss'` 一起，都应该改成数据驱动。

---

## 1. 素材盘点：这次真的能用掉一大半

### 1.1 现状（已核对）

| 项 | 数字 | 出处 |
| --- | --- | --- |
| `aigc/` 下 glb 总数 | **82**（monsters 40 / plants 16 / props 7 / weapons 19） | `git ls-files aigc \| grep -c '\.glb$'` |
| 运行时实际加载 | 5（全在 `public/models/`，与 aigc 互不重叠） | `ZombieModel.js` MODELS |
| `src/` 里引用 `aigc/` | **0** | 全局 grep |

### 1.2 v1 太保守了：逐件成本表推翻了它的结论

v1 只敢用 5 种怪，理由是「draw call 是硬墙」。这次**把 40 个怪逐个拆包数 `primitives`**，结论反过来了：

| dc/只 | 模型 |
| --- | --- |
| **1** | `demon-3`、`giant`、`goblin`、`tentacle`、`wolf` |
| **2** | `ghost-skull`、`mimic`、`rat`、`slime`、`spider`、`zombie` |
| **3** | `ghost`、`green-blob`、`skeleton` |
| **4** | `alien`、`crab`、`frog`、`glub-evolved`、`goleling`、`green-spiky-blob`、`mushnub`、`pink-slime`、`wasp` |
| **5–6** | `demon-brute`、`tribal`、`dragon-evolved`、`bat`、`yeti`、`dino`、`blue-demon` |
| **7** | `bull`、`mushroom-king`、`orc-enemy`、`slime-enemy`、`demon` |
| **11** | `orc` |

**同屏预算实算**（250 上限 − 场景基线 130 − 森林装饰 11 = **109 dc 给 14 只怪**，平均每只 7.8）：

| 场景 | 同屏 | dc | 判定 |
| --- | --- | --- | --- |
| 第 10 波混编（哥布林/史莱姆/狼/蜘蛛/蝙蝠/骷髅各 2） | 14 | **33** | 余量充足 |
| 第 15 波加重（再掺幽灵） | 14 | **36** | 余量充足 |
| **最坏：6 蝙蝠 + 4 骷髅 + 4 蘑菇精** | 14 | **64** | **仍在 109 内** |
| 对照：现有游戏 14 只全 alchemist | 14 | 28 | 现状基线 |

> **结论：v1 的「只用 5 种」是被旧骷髅 BOSS 的 12 dc 吓出来的。奇幻怪绝大多数是 1–4 dc，比现在场上主力（alchemist 2 dc）还便宜。「怪的种类多一些」在性能上完全可行。**
> 唯一要限流的是 `bat`（6 dc）；`orc`（11 dc）本轮不用。

### 1.3 怪物选型：12 种，四个族群各有夜间语言

奇幻森林不是「把僵尸换个皮」，而是**四族群各有自己的一句话**：

| 族群 | 模型 | dc | hp | 速度 | 夜间身份 | 出场 |
| --- | --- | --- | --- | --- | --- | --- |
| **哥布林** | `humanoid/goblin` | 1 | 55 | 2.6 | 成群、吵、冲得快 | W1 |
| | `humanoid/demon-3` | 1 | 80 | 2.2 | 小恶魔，比哥布林耐打 | W6 |
| **史莱姆** | `slime/slime` | 2 | 70 | 1.5 | 弹跳前进，死后留一滩减速黏液 | W1 |
| | `slime/pink-slime` | 4 | 45 | 1.8 | 死亡分裂成 2 只小史莱姆 | W7 |
| | `slime/green-blob` | 3 | 120 | 1.2 | 厚、慢、轻护甲（弹开豌豆） | W9 |
| **亡灵** | `undead/skeleton` | 3 | 90 | 1.9 | 脆、成群、夜里显形 | W4 |
| | `undead/ghost` | 3 | 70 | 1.7 | 半透明，**不吃地面碰撞（能穿树）** | W6 |
| | `undead/ghost-skull` | 2 | 50 | 2.1 | 更快更小的幽灵 | W11 |
| **兽** | `beasts/wolf` | 1 | 75 | 3.0 | 侧翼、贴地、最快 | W3 |
| | `beasts/spider` | 2 | 60 | 1.4 | 静止伏击，被照到才起身 | W5 |
| | `beasts/rat` | 2 | 25 | 3.2 | 极小，成群 4–6 只 | W2 |
| | `beasts/bat` | 6 | 40 | 2.4 | 飞行（`airborne`），同屏 ≤2 | W8 |

**明确不用、以及理由**：

| 模型 | dc | 为什么不用 |
| --- | --- | --- |
| `orc` | 11 | 最贵，且与巨人 BOSS 定位重叠 |
| `tentacle` | 1 | 只有 3 段无意义动画（`TentacleArma/…Armat/…Armatur`），当摆件比当怪合适 |
| `mimic` | 2 | 0 段动画的静态网格，适合当**可破坏宝箱道具**，不进怪池 |
| 其余 24 只 | 3–7 | **留作后续扩充**。动画族已验证（§1.4），加一只基本是纯配置工作 |

> 累计启用：**12 种怪 + 4 只 BOSS + 5 个 props + 8 个植物彩蛋 ≈ 29 / 82（35%）**，比 v1 的 18 个多出 60%。

### 1.4 关键工程发现：40 个怪只有约 12 个动画命名族

这是「扩怪种类」最省事的一点。把 40 个 glb 的 clip 名去掉前缀后聚类：

| 族 | 模型数 | clip 名 |
| --- | --- | --- |
| **A** | **9** | `Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes` |
| **B** | **7** | `Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes` |
| **C** | **5** | `Death, Duck, HitReact, Idle, Jump…, Punch, Run, Walk, Wave, Weapon, Yes` |
| **D** | **4** | `Attack, Death, HitRecieve, Idle, Jump, Run, Walk` |
| 单件 | 各 1 | `Slime_*`、`Spider_*`、`Rat_*`、`Bat_*`、`Wolf`、`Snake_*`、`Wasp_*`、`Bull`、`Dragon_*`、`Tentacle*`、僵尸 16 段 |

**落地含义**：`Zombie.buildAnimations` 现在是 `isSkeleton ? KayKit组 : Quaternius组` 的二分。改成**按动画族查表**后，A 族 9 个模型共用一组候选名、B 族 7 个共用一组——**加一只怪不需要再写动画分支**。

> ⚠️ **A/B/C 族普遍带 `Fast_Flying` / `Flying_Idle`，不等于它们会飞**。`ghost` 确实浮空，但 `goleling`、`tribal` 同样带这组 clip 却是地面单位。**飞行必须由 `airborne: true` 决定，绝不能看动画名推断。**

### 1.5 命中球：按体型分档，不逐模型配

`HIT` 表按 `def.model` 查（`Zombie.js:47`）。12 种怪逐配是 12 份维护负担，**按体型分 4 档**：

| 档 | 用于 | chest | head | radius | 校验 |
| --- | --- | --- | --- | --- | --- |
| `humanoid` | goblin / demon-3 / skeleton | 1.02 | 1.52 | 1.0 | 见下方警示 |
| `small` | rat / 分裂出的小史莱姆 | 0.20 | 0.16 | 0.5 | ✓ |
| `wide` | slime / green-blob / pink-slime | 0.45 | 0.35 | 1.0 | ✓ |
| `flying` | bat / ghost / ghost-skull | 0.55 | 0.40 | 0.9 | ✓ |

> ⚠️ **别被数字误读**：现有 `HIT.zombie` 是 `chest 1.02 / head 1.52`，即 head **高度**大于 chest **高度**——这是对的（头在胸上面）。`AGENTS.md` 的硬规则「头部球必须比身体球小」说的是**半径小于**，半径走的是另一条路径 `hitRadiusScale`。
> **上表是占位值，实装前必须逐档用加载后的包围盒实测再填**，不能照抄。

### 1.6 ⚠️ 三个会让人白干一天的陷阱

**① 新骷髅会被 `spawnOne` 静默吞掉。**
`ZombieManager.js:195-205` 对 `type === 'skeleton'` 有两道闸：

```js
const blocked = alive >= SKELETON_MAX_ALIVE || !this.modelReady(type);
if (blocked) { const alt = this.queue.findIndex((t) => t !== 'skeleton' && t !== 'boss' && ...); }
```

这道闸是为**旧的 KayKit 骷髅**设的（单只 9 个蒙皮 mesh，太贵）。而 `aigc/monsters/undead/skeleton.glb` 只有 **3 dc**，根本不该吃 `SKELETON_MAX_ALIVE = 3` 的上限。
**如果直接把新骷髅挂成 `type: 'skeleton'`，它会永远被换掉、一只都刷不出来，而且不报错。**
做法：新骷髅用**独立 type 名**（如 `bones`），并把 §4.1 的 `'skeleton'` 判定一起泛化为 `def.elite`。

**② `SKELETON_MAPS = ['snow']` 会按地图过滤。**
`ZombieManager.js:63-64` 在 `startWave` 里按 `ctx.map.id` 过滤普通骷髅。森林要出亡灵，必须把 `forest` 加进这个数组——**但别在这里判断模型是否加载好**（glb 异步，`AGENTS.md` §5.3.1 记着这个坑，会导致整波刷不出骷髅、E2E 间歇失败）。

**③ 气球的空中配额是独立的一套。**
`ZombieManager.js:208` 有 `type === 'balloon' && this.airborneCount() >= this.airQuota`。新加的 `bat` 若也设 `airborne: true`，它**不会自动进这套配额**，必须一并纳入 `airborneCount()`，否则 14 只上限会被蝙蝠先占满。

---

## 2. 核心玩具：光 + 族群

### 2.1 两个动词，一个按键

- **动词 1「把光打到哪儿」**：复用**已有的瞄准锥**，不新增按键——`Controls.js:138-143/240-245` 只绑了 `e.button === 0`。
  锥的参数在 `WeaponSystem.js:1229`：桌面 `0.045 rad`（2.6°）、触屏 `0.17 rad`（9.7°）、`dist ≤ 62`。**这个锥今天每帧就在跑。**
- **动词 2「对面是什么族群」**：不是新机制，而是**对已有数值关系的命名**。哥布林脆快、史莱姆分裂、亡灵成群、兽类伏击——玩家不需要背三个名字，只需要认出「这波是什么」。

### 2.2 为什么奇幻比恐怖更适合这张图

| | 写实恐怖（v1） | 奇幻（v2） |
| --- | --- | --- |
| 视觉来源 | 树影、浓雾、纯黑 | **发光菌、自发光史莱姆、精灵光点、营地篝火** |
| 与 PvZ 基调 | 偏黑深残，和「戴夫拿植物打僵尸」割裂 | **史莱姆/哥布林/魔法森林本就是 PvZ 邻域** |
| 12 种怪的协调性 | 哥布林混进写实森林很突兀 | **奇幻设定容得下任何奇幻生物** |
| 光照成本 | 暗部要细节才像夜景，容易想加真灯 | **自发光物体替代了「需要点光源」的冲动**，零额外 draw call |

> v2 最重要的改判：**奇幻设定的最大价值不是好看，而是它让「多头目怪」在叙事上自洽。** v1 的写实约束和用户「多用模型」的诉求天然冲突，改成奇幻后冲突消失。

### 2.3 不做教学

删掉 v1 §2.3 的 60 秒「起承转合」教学。仅保留一条**与森林无关的通用操作提示**：

```js
// Game.js:906
this.scheduleTutorial();   // 2.8 秒后弹出一次通用操作说明（hud.showTutorial）
```

这是现有游戏给所有地图的**按键说明**，不是关卡教学。建议森林图照常保留；若要彻底去掉，删这一行即可（列入 §8 待拍板）。

> **不教，就必须让第一波自己说话**：第 1 波只放哥布林 + 史莱姆共 6 只，让玩家在零风险里看懂「脆的冲上来、慢的会分裂」。

### 2.4 一个必须正面回答的反对意见

评审原话：

> **「你看不见、怪看得见你」不是紧张，是单方面不公平。**

**这条批评成立。** 核实：`Zombie.js` 里**没有任何 FOV/视线/潜行判定**，僵尸无条件直线追（`GAMEPLAY.md` §3）；全场唯一一盏点光源是 `Particles.js:77` 的爆炸闪光。

**v2 的处置**：夜之森林**不是潜行游戏**，不新增侦测规则。用三条**对称**约束：

| 做法 | 对称性 |
| --- | --- |
| 用 `scene.fog`（near 12 / far 35）代替逐怪隐身 | 雾对敌我一致，不存在「我看不见它、它看得见我」 |
| 雾外**不参与辅助瞄准**，但子弹**照常能打到** | 惩罚的是「自动吸附」，不是「能否命中」 |
| 脚步/呼吸音量随距离衰减（复用 `Sfx`） | 盲区有信息通道，不是纯瞎 |

> 一句话：**夜改变「谁先发现谁」的节奏，不改变「谁能伤害谁」。**

### 2.5 手感与光照成本

| 项 | 取值 | 理由 |
| --- | --- | --- |
| 桌面/触屏锥角 | **0.045 / 0.17 rad，都不动** | 放宽 = 白送命中；收窄 = 回溯性削弱现有触屏体验 |
| 光源 | **1 盏 `SpotLight` + `castShadow = false`** | 不投影 = 不多一遍 shadow pass；单盏只是每材质一次 uniform 更新 |
| 场景投影 | **本图 `renderer.shadowMap.enabled = false`**（全局在 `Game.js:72` 打开） | **省掉整个 1024 PCFSoft shadow pass**，本方案最大正收益 |
| 发光物件 | emissive 材质 + `glowTexture()`（`materials.js:338`） | **不加 PointLight**；前向渲染下每盏灯都是每材质开销 |
| 逐怪透明/隐身 | **禁止** | 逐实例材质替换触发 shader 重编译，蒙皮网格尤其贵 |

> ⚠️ `AGENTS.md` §5.6：「改阴影相机范围后必须 `shadow.camera.updateProjectionMatrix()`」。本图关投影，回避此坑；代价是没有实时影子——夜景接受。

---

## 3. 地图：90 × 90 m

| 图 | 尺寸 | 1 m 网格 | 横穿耗时（5.4 m/s） |
| --- | --- | --- | --- |
| 后院 / 雪地 / 沙城 | 46 / 35.2×41.6 / 53×53 | — | 6–10 s |
| **夜之森林** | **90 × 90** | **8,100 格** | **16.7 s** |

- 流场最坏 17.8k 节点/帧（`FlowField` 的 `timer = 0.45s` 节流），60 fps 下可忽略。
- `Game.js:1040` 是 `if (this.map.updateNav && …)` —— **流场是可选的**，实测掉帧时第一个砍它（只影响绕路质量，不影响可玩）。
- **尺寸是可回退旋钮**：`bounds` 是构造函数常量，砍到 60×60 只改两个数。

**分区（奇幻版）**：

| 区 | 中心 | 内容 | 族群主场 |
| --- | --- | --- | --- |
| **★ 月光空地** | (0, 0) | 发光水晶、精灵光点常亮 | 安全区 / 喘息 |
| **A 菌菇林** | (−28, −26) | 发光蘑菇、史莱姆黏液 | 史莱姆 |
| **B 哥布林营地** | (24, −24) | 木栅栏、篝火、破帐篷 | 哥布林 / 小恶魔 |
| **C 古墓** | (−26, 20) | 墓碑、白骨堆 | 亡灵 |
| **D 野兽巢穴** | (26, 24) | 倒木、兽骨、灌木 | 狼 / 蜘蛛 / 老鼠 |

四条主径 + 四条环径，每只怪至少 3 条路。

### 3.1 两条硬约束

1. **所有可站立平台 ≤ 0.6 m**。`FlowField.blockPlatforms` 的 `minHeight = 0.6`，高于它的平台僵尸会绕行；而**僵尸不会跳**，玩家站上去就是无敌点。
2. **树干必须登记 `walls`**。`HitWalls.sweepWalls` 只扫 `map.walls`。树若只画网格不登记，**豌豆会直接穿树**。树干登记圆柱 `{x,z,r,h}`，木箱/木桶登记盒体 OBB。
   （注：`IceWorld.addPlatform` / `DustYard.addPlatform` 都会把平台同时推进 `walls`，见 `IceWorld.js:70`、`DustYard.js:67`。）

---

## 4. 每 5 关一个 BOSS：4 只轮换

### 4.1 改成数据驱动

把 7 处 `type === 'boss'` 换成 `def.boss === true`，横幅文案读 `def.title`：

| 文件:行 | 现状 |
| --- | --- |
| `ZombieManager.js:272` | `if (type === 'boss') this.boss = z` |
| `ZombieManager.js:330` | `if (s.t === 'boss') this.boss = z`（网络同步） |
| `ZombieManager.js:202` | 换队列时排除 `'boss'` |
| `Game.js:997` | 击杀震动 `z.type === 'boss'` |
| `Game.js:1004` | 横幅「巨人来袭」← **bug** |
| `Game.js:1021` | 攻击震动 `z.type === 'boss'` |
| `Game.js:1023` | 「巨人僵尸出现了!」← **bug** |

### 4.2 四只轮换表

| 波次 | BOSS | 模型 | dc | hp | 模型成本对比 |
| --- | --- | --- | --- | --- | --- |
| 5 | **巨人** | `humanoid/giant` | **1** | 900 | 比现有骷髅王**便宜 11 dc** |
| 10 | **骷髅王**（现有） | `skeleton` | 12 | 1450 | 不变 |
| 15 | **蘑菇王** | `humanoid/mushroom-king` | 7 | 1200 | 比骷髅王便宜 5 |
| 20 | **巨龙** | `beasts/dragon-evolved` | 5 | 1600 | 比骷髅王便宜 7 |
| 25 | 循环回巨人 | | | | |

```js
// config.js
export const BOSS_ROTATION = ['gargantuar', 'boss', 'mushroomKing', 'dragon'];
// wavePlan 里：const b = BOSS_ROTATION[(Math.floor(n / 5) - 1) % BOSS_ROTATION.length];
```

> **轮换反而更省**：四只里三只都比现在的骷髅王便宜。而且 `giant` 有 `Attack/Death/Idle/*` 七段动画、`mushroom-king` 有 `Duck`、`dragon-evolved` 有 `Headbutt`，**机制全都能复用现成动画，不需要新美术**。

### 4.3 每只 BOSS 一句话机制

不做技能树，只给每只 BOSS **一个能写在横幅上的规则**：

| BOSS | 一句话 | 代码落点 |
| --- | --- | --- |
| **巨人** | 「红圈出现就走开」——0.85 s 前摇，圈内 30 伤 + 击退 3.2 m | `Zombie.slam` 状态机 |
| **骷髅王** | 「它挥木棒时别贴脸」——现有行为不变 | 已实现 |
| **蘑菇王** | 「它蹲下时不掉血」——`Duck` 期间减伤 75%，起身 1.2 s 硬直 | `vulnerable` 窗口 |
| **巨龙** | 「它飞起来打不到，等它俯冲」——`airborne`，落地 2 s 可打 | 复用 `airborne` |

> **纪律**：每只 BOSS 只加 **1 个参数级规则**，不新增系统。陷阱设计案已占用「一版一个动词」的名额，这里不能再叠数据库。

---

## 5. 波次与阳光经济

### 5.1 波次总量守恒

新怪**替换**普通僵尸名额，不叠加（否则第 20 波怪量会翻倍）：

```js
const fantasy = Math.min(10, Math.max(0, Math.floor((n - 1) * 0.55)));
const normals = Math.max(4, 4 + Math.floor(n * 1.45) - fantasy);
```

**同屏配额**（14 上限）：`rat` 算 1 只但成群 4–6；`wolf` ≤ 3；`bat` 复用现有 `AIR_QUOTA_RATIO = 0.2`（14 只时 = 2）；`ghost` ≤ 2；`spider` ≤ 2。

### 5.2 夜间阳光

PvZ 的夜里没有天降阳光。现状 `SUN_SKY = { interval: 30 }`、`sunPerOrb = 5` → 每波约 **5 阳光**。

| 波 | 击杀收入 | 天降占比 | 夜间缺口 |
| --- | --- | --- | --- |
| W1 | 25 | 20.0% | −5 |
| W10 | 440 | 1.1% | −5 |
| W20 | 895 | 0.6% | −5 |

**判定：可以砍。**
1. 绝对值恒为 5，后期占比 <1%，不影响经济结构。
2. `startSun = 60` + W1 的 25 = 85 起手，且**豌豆 `cost: 0` 是承重墙**，0 阳光也打得动 → 无死锁。
3. 前期 20% 确实疼，补一个**夜间专属来源**：

| 补偿 | 数值 | 为什么 |
| --- | --- | --- |
| **照杀奖励** | 在光锥内击杀 → 每 4 只额外掉 1 颗 | 奖励「用光」，机制与资源绑在同一动作 |

> **必须封顶**：W10 约 44 只怪，若全在光内杀 = +55 阳光，**远超白天被砍的 5**。所以**每波封顶 3 颗（15 阳光）**，净变化 ≈ +10，可被 `maxSun = 300` 吸收。

---

## 6. 渲染预算

| 项 | dc | 做法 |
| --- | --- | --- |
| 树 ×3 变体 | 3 | 先 `mergeSimple` 再 `InstancedMesh` |
| 发光菌 / 灌木 / 草 | 3 | `InstancedMesh` |
| 萤火虫（`Points`）+ 精灵光点 | 2 | |
| 5 个 props（栅栏/墓碑×3/木箱，按材质合并） | 2 | |
| 植物彩蛋（8 个静态合并） | 1 | |
| **森林装饰合计** | **≤11** | |
| 14 只混编怪（§1.2 实算） | 33–64 | |
| **场景基线 + 装饰 + 僵尸** | **≈ 174–205** ✅ | 250 线内 |

> **反面教材就在仓库里**：`Arena.js:270-294` 的树是 **1 树干 + 4 树冠 = 5 个独立 mesh 且未合并**，9 棵 = 45 dc。森林照抄会吃光预算，必须用 `Arena.js:536` 现成的 `mergeSimple()`。

---

## 7. 工程坐标

| 文件 | 改动 | 陷阱 |
| --- | --- | --- |
| **新** `src/world/NightForest.js` | 地图类，接口照 `AGENTS.md` §5.9 | 物件全挂 `root`，别直接加 `scene` |
| `src/world/maps.js` | `MAPS` 末尾加 `forest` | 顺序敏感 |
| `src/world/materials.js:388` | `outdoorEnvironment` 加 `night` 分支 | **现在只认 snow/dust，其余落回 backyard 亮蓝天** |
| `src/net/protocol.js` | `MAP_IDS` 加 `forest` | **`cleanMapId` 对未知 id 静默回退 `backyard`**（85–87 行），双人会悄悄进错图、不报错 |
| `src/entities/ZombieModel.js` | `MODELS` 加 16 项；**加载循环化** | 现在是 4 段复制粘贴的 `loader.load` |
| | 新模型走 **`targetHeight` 包围盒归一化** | aigc 普遍带 100× Armature 缩放 |
| | **`buildHat` 绝不挂新模型** | 它假设了老模型的 100× 骨骼链 |
| `src/entities/Zombie.js` | `buildAnimations` 改**按动画族查表**（§1.4） | 现在是 `isSkeleton ? :` 二分 |
| | `HIT` 加 4 个体型档（§1.5） | 实装前逐档量包围盒 |
| | BOSS 状态机 `slam` / `duck` / 俯冲 | 每只 1 个规则 |
| `src/entities/ZombieManager.js` | `'boss'` → `def.boss`（3 处） | 网络同步那处也要改 |
| `src/config.js` | `ZOMBIES` 加 12 + 4、`BOSS_ROTATION`、`wavePlan` | 数值只进这里 |
| `src/Game.js` | `997/1004/1021/1023` 改 `def.boss` / `def.title` | **修「巨人」两个 bug** |
| `src/gallery/presets.js` | 补 16 个类型 | `gallery.test.js` 强制覆盖全部 `ZOMBIES` |
| `index.html` / `src/style.css` | 选图卡片 4 张 | 响应式 + 安全区 |

---

## 8. 已知会红的地方

全部是**硬编码清单**，处理方式都是「加一项」，不是改逻辑：

| 文件:行 | 断言 | 处理 |
| --- | --- | --- |
| `tests/unit/maps.test.js:97` | `MAPS.length === 3` | 改 4 |
| `tests/unit/maps.test.js:98/156/163/957` | 地图 id 数组 | 加 `forest` |
| `tests/unit/net-protocol.test.js:62` | `MAP_IDS` | 加 `forest` |
| `tests/unit/zombiemanager.test.js:1105` | 逐图循环 | 加 |
| `tests/harness.test.js:22` | 地图 id 数组 | 加 |
| `tests/integration/flows.test.js:231` | 选图卡片顺序 | 加 |
| `tests/unit/config.test.js` | 僵尸清单硬编码 | 补 16 项 |
| `tests/unit/config.test.js` | 「boss 各项数值全场最大」 | **改成「每个 `def.boss` 都优于所有非 Boss」**，否则巨人 900 血必然判红 |
| `tests/unit/zombiemanager.test.js` | `filter(t=>t==='boss').length === 1` | 改成「`def.boss` 类型合计 1」 |
| `tests/unit/zombiemanager.test.js` | 骷髅换队/配额用例 | 新精英怪走 `def.elite` 后需同步 |
| `tests/unit/gallery.test.js` | 覆盖全部 `ZOMBIES` | 补 `presets.js` 即自动通过 |

---

## 9. 分期

### P0 · 地基（不改玩法，先让轮换可行）
- [ ] `'boss'` → `def.boss`（7 处）+ **修「巨人」两个横幅 bug**
- [ ] `MODELS` 加载循环化 + `targetHeight` 归一化
- [ ] `buildAnimations` 改成按动画族查表（§1.4 四大族）
- [ ] **精英怪泛化**：`'skeleton'` 硬判定 → `def.elite`；`SKELETON_MAPS` 加 `forest`；`bat` 纳入 `airborneCount()`（§1.6 三坑）
- [ ] `outdoorEnvironment` 加 `night`；`MAP_IDS` 加 `forest`
- [ ] 测试清单按 §8 更新

### P1 · 森林本体 + 第一批怪
- [ ] `NightForest.js`：90×90、五区、≤11 dc 装饰（树先 `mergeSimple` 再实例化）
- [ ] 哥布林 / 史莱姆 / 狼 / 老鼠（4 种，四族群各 1）
- [ ] 第 1 波只放哥布林 + 史莱姆共 6 只，不写教学
- [ ] 树干登记 `walls`；发光菌 + 雾 + 关投影

### P2 · 补满 12 种 + 四 BOSS
- [ ] 剩余 8 种怪（小恶魔/粉史莱姆/绿块/骷髅/幽灵/骷髅幽灵/蜘蛛/蝙蝠）
- [ ] `BOSS_ROTATION` 4 只 + 各自一句话机制
- [ ] 图鉴页 16 个新类型

### P3 · 待定
| 提案 | 资产 | 为什么现在不做 |
| --- | --- | --- |
| 19 把枪换 glb 视图模型 | `weapons/*` | 要重做整个武器视图层 |
| `mimic` 宝箱当可破坏道具 | `undead/mimic` | 需要新的「可破坏场景物」系统 |
| 剩余 24 只怪 | 其余 monsters | 动画族已验证，纯配置工作，等 P2 验收后再加 |

---

## 10. 待拍板

| # | 问题 | 我的建议 |
| --- | --- | --- |
| 1 | **12 种怪会不会认不过来？** | 分族递进：P1 先 4 种，P2 到 12 种；每族有固定视觉锚点 |
| 2 | **开局 2.8 s 通用操作提示保留吗？**（`Game.js:906`） | 森林图**保留**——它是按键说明不是关卡教学；要彻底去掉删一行 |
| 3 | **四只 BOSS 的轮换顺序** | 巨人 → 骷髅王 → 蘑菇王 → 巨龙 |
| 4 | **巨龙要不要真会飞？** | 只做 `airborne` 俯冲，**不做持续飞行**（否则地面武器全废） |
| 5 | **森林是否进双人** | 进；但 `MAP_IDS` 必须同步，否则静默回退到后院 |
| 6 | **`orc.glb`（11 dc）用不用** | 不用，与巨人定位重叠且最贵 |

---

## 11. 与其它设计案的关系

- **`DESIGN-traps-and-bosses-v2.md`（陷阱推进）未实装**（`grep -rln "traps\|TrapManager\|gargantuar" src/` 为空）。
- 它预留的 8 个模型中，**本方案有意共用 `goblin` 和 `giant`**：两者都只是「点名一个 glb」，实装时共享 `MODELS` 条目即可，不构成冲突。
- **唯一实质冲突**：两者都要改 `wavePlan`。若陷阱案先落地，本方案的公式要改成「从它的结果里再替换」。
- 本方案**独占**这 12 种怪的分配；陷阱案不应再点名它们。

---

## 12. 实装记录（v3 · 2026-10-30）

本方案已全部落地。以下是**实装时与设计稿不同、或设计稿没写到的**部分。

### 12.1 真正做了什么

| 文件 | 改动 |
| --- | --- |
| **新增** `src/world/NightForest.js` | 90×90 奇幻森林，五区（月光空地/菌菇林/哥布林营地/古墓/野兽巢穴） |
| **新增** `public/models/*.glb` ×15 | 从 `aigc/monsters/` 拷入，CC0，附 `LICENSE-cc0.txt` |
| `src/entities/ZombieModel.js` | `MODELS` 扩到 19 项；新增 `fitToHeight()` 包围盒归一化；加载改成循环 |
| `src/entities/Zombie.js` | `ANIM_NAMES`/`ANIM_FAMILIES` 动画族表（12 族）；`HIT` 扩到 19 项；模型来源与缩放数据驱动 |
| `src/config.js` | `ZOMBIES` 扩到 23 项；`BOSS_ROTATION`；`bossForWave()`；`waveTotal()`；地图感知 `wavePlan(n, mapId)` |
| `src/entities/ZombieManager.js` | `'boss'` → `def.boss`；空中配额改为认任意 `airborne`；阳光掉落读 `def.sun` |
| `src/Game.js` | 横幅/震屏改 `def.boss`/`def.title`；`setMap` 按 `noShadows` 开关投影 |
| `src/world/materials.js` | `nightSkyTexture` / `forestFloorTexture`；`outdoorEnvironment` 加 `forest` 分支 |
| `src/gallery/presets.js` | 图鉴补 16 项；`height` 支持 `targetHeight` |
| `src/net/protocol.js` · `maps.js` | `MAP_IDS` / `MAPS` 加 `forest` |

### 12.2 与设计稿的偏差（以代码为准）

1. **BOSS 洗牌后插队首**（设计稿没写）。实测发现：BOSS 混在队列里时，同屏上限限制了出怪速度，**第 5 波打了 20 秒 BOSS 都没出来**。现在 `wavePlan` 返回的数组第 0 项就是 BOSS。
2. **`noShadows` 真的接上了**。设计稿说「关掉 shadowMap」，实装前它只是个承诺；现在 `Game.setMap` 读 `map.noShadows`，森林图 `renderer.shadowMap.enabled = false`，其余地图照旧。
3. **场景 draw call 31**（设计稿估 ≤11）。超的是 8 个提灯光晕 Sprite（每盏一个 draw call）。它们是可读性关键（主径路口的视觉引导），保留；总账仍在预算内。
4. **`slimelet` 是独立 type**，模型复用 `slime` + `scale 0.55`，不额外下载资源。
5. **新增骷髅 type 叫 `bones`** 而不是 `skeleton`——避开旧 KayKit 骷髅的 `SKELETON_MAX_ALIVE` 限流（那套限流是为 9 dc 的旧模型设的，新骷髅只要 3 dc）。
6. **没有实现**：巨龙俯冲、蘑菇王蹲下减伤、巨人砸地的**运行时状态机**。数值与参数（`slam`/`duck`/`dive`）已经写进 `config.js`，但 `Zombie.update` 里还没有对应行为分支。BOSS 目前靠血量/体型/速度区分，机制是下一步。

### 12.3 验证结果

| 项 | 结果 |
| --- | --- |
| `npm test` | **1144 通过**（新增 69 个：`nightforest.test.js` 16 + `fantasy-units.test.js` 23 + `zombie.test.js` 7 + 其余改造） |
| `npm run build` | 通过 |
| `npm run test:e2e` | **10/10 场景通过，控制台零错误** |
| 实机验证 | 森林图第 1–10 波实跑：刷出 bones/goblin/slime/ghost/rat/normal，第 5 波**巨人**、第 10 波**骷髅王**，draw call 51–64 |
| 地图契约 | `maps.test.js` 的通用契约自动覆盖 forest（接口/碰撞/反弹体/拾取点/平台高度） |

### 12.4 仍待完成（按优先级）

1. **BOSS 机制状态机**：巨人砸地前摇、蘑菇王蹲减伤、巨龙俯冲。参数已在 config。
2. **粉史莱姆分裂**：`split` 字段已配，`ZombieManager` 里还没有死亡分裂逻辑。
3. **夜间阳光经济**：设计稿的「砍天降 + 照杀奖励封顶 3 颗」没有实装，森林图目前仍掉天降阳光。
4. **打击感**：没有为奇幻单位做专属音效（现在复用僵尸的吼叫采样）。
