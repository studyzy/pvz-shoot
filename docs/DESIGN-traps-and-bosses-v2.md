# 设计案 v2 · 戴夫的花园（陷阱槽 / 三只新怪 / 巨人 Boss）

> 版本 **v2**（2026-10-30）。**取代** [DESIGN-traps-and-bosses.md](DESIGN-traps-and-bosses.md)（v1），v1 保留作决策存档。
> 输入：v1 定稿 ｜ [评审 REVIEW-traps-and-bosses.md](design/REVIEW-traps-and-bosses.md) ｜ 仓库实况（src/、tests/）
> 新约束（本版的第一前提）：**外部模型只有 aigc/ 下的 82 个 CC0 glb**（已入库，共 177 个文件）。本版不新增任何程序化配件——每个新单位都必须先点名一个 glb。
> 落地时数值只进 src/config.js，同步 docs/GAMEPLAY.md 与 AGENTS.md。

---

## 0. 一句话

> **这一版只买一个体验：你在院子里种下东西，它替你把下一波吃掉。**
>
> 陷阱不是「更强的枪」，是「另一个你」——你跑去追投手的那 8 秒，身后的路口还在杀人。

v1 的三个动词（布置 / 反制远程 / 应对机制）是对的，但它是**三条平行支线**。v2 把它们收成一条主线：**花园**。所有新内容只回答一个问题——「我种的东西，值不值得我少开两枪」。

---

## 1. 和 v1 的差异（先看这张）

| 项 | v1 | v2 | 为什么改 |
| --- | --- | --- | --- |
| 陷阱付款 | 弹匣制：第一次按 6 先付 45 | **按颗付费**（10 / 8 / 25），充能回复 | 评审 §3.1：弹匣制把「要不要买」和「埋哪儿」压成一次付款；首付 = 第 1 波全部收入的 1.8 倍 |
| 陷阱来源 | 地面随机拾取 | **常驻 6 号槽，按 6 循环三株**，不进掉落池 | 评审透镜 #43：随机拾取把「铺路」的控制权交给系统；而且会把枪械掉落池从 10 稀释到 14 |
| 陷阱数量 | 4 株（雷 / 刺 / 窝瓜 / 花） | **3 株**（雷 / 刺 / 花） | 窝瓜与雷同职责（都是即时 AOE），且「眩晕打断前摇」会和后续状态机打架 |
| 新僵尸 | 7 种（含掘地 / 铁门 / 读报 / 舞王） | **3 种**（疾行者 / 分裂史莱姆 / 投手） | 一期只引入 2 个新规则；且报纸、铁门、矿工帽在资产库里**没有对应模型** |
| Boss | 伽刚特尔 + 僵尸博士（程序化机甲） | **1 只新 Boss：巨人**（giant.glb）+ 沿用骷髅王 | 没有机甲 / 电线杆模型；v1 的 8 处「复用」有 5 处要现写（评审 §4.1） |
| 新怪进场 | 叠加：第 20 波 +34% 怪量 | **替换**普通僵尸名额，总量不变 | 评审 §4.2：刷怪间隔第 16 波已触底 0.5s，再叠加只会把波间时间吃掉 |
| 新增规则 | 8 个 | **4 个**（布置 / 分裂 / 远程 / Boss 前摇窗口） | 评审透镜 #88 / #14：认知负荷超载 |
| 新美术成本 | 6 套程序化配件 + 1 套机甲 | **0**（只拷 8 个 CC0 glb，共约 1.65 MB） | 本版的核心约束 |

---

## 2. 资产现实：本版能用的东西

aigc/ 已被仓库跟踪（.gitignore 白名单放行 monsters/ plants/ weapons/ props/），**不用下载、不用转换、授权全是 CC0 1.0**。这一点让 v2 可以做一件 v1 做不到的事：**新单位直接换模型，而不是「同一具僵尸戴不同帽子」**。

### 2.1 本版点名的 8 个模型

| 用途 | 文件 | 三角面 | 骨骼 / 网格 | 动画（去前缀） | 体积 |
| --- | --- | --- | --- | --- | --- |
| 土豆雷 | plants/potato-character.glb | 2,832 | 静态 | 无 | 456 KB |
| 食人花 | plants/piranha.glb | 1,676 | 蒙皮 | Attack, Death, Out_Of_Water | 172 KB |
| 尖刺团 | monsters/slime/green-spiky-blob.glb | 4,520 | 蒙皮 | Bite_Front, Idle, Walk, Death, HitRecieve | 184 KB |
| 疾行者 | monsters/humanoid/goblin.glb | 2,912 | 12 骨骼 / 1 网格 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk | 212 KB |
| 分裂史莱姆 | monsters/slime/slime-enemy.glb | 1,744 | 7 骨骼 | Bite_Front, Death, HitRecieve, Idle, Walk | 160 KB |
| 投手 | plants/mushroom-evolved.glb | 3,072 | 4 骨骼 | Bite_Front, Death, HitRecieve, Idle, Walk | 148 KB |
| 巨人 Boss | monsters/humanoid/giant.glb | 3,812 | 12 骨骼 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk | 240 KB |
| 巨人扔的桶 | props/barrel.glb | 1,384 | 静态 | 无 | 76 KB |

落地动作：把上面 8 个文件拷到 public/models/（沿用现有约定），并新增一份 public/models/LICENSE-cc0.txt（逐件作者 + Poly Pizza 链接，摘自 aigc/*/manifest.json）。**不要**再把整个 aigc/ 暴露给运行时。

### 2.2 尺寸问题：用「目标身高」代替魔数

现有 MODELS 是手写 scale（zombie 1.55、skeleton 0.9…），每个模型都要先量原始高。新模型一律用**加载后包围盒归一化**：

```js
// ZombieModel.js
export const MODELS = {
  zombie:    { url: 'models/zombie.glb',    scale: ZOMBIE_SCALE, height: 1.85 }, // 老模型保持原样
  ...
  goblin:    { url: 'models/goblin.glb',    targetHeight: 1.62 },  // 新模型：加载后按包围盒算 scale
  spikyblob: { url: 'models/green-spiky-blob.glb', targetHeight: 0.55 },
  giant:     { url: 'models/giant.glb',     targetHeight: 1.85 },  // 再乘类型 scale 1.84 → 3.4 米
};
```

buildRig 里：scale = mod.targetHeight ? mod.targetHeight / bboxHeight(scene) : mod.scale，按模型 id 缓存一次。老四套走 scale，零回归；新模型永远不会踩「Armature 带 100 倍缩放」的坑（aigc README 已警告）。

> 同时把 initZombieModel() 里四段复制粘贴的 loader.load 改成 for (const [id, mod] of Object.entries(MODELS)) 循环——再加 5 个模型前必须先做这一步，否则就是五段同样的代码。

---

## 3. 陷阱槽（6 号槽）

### 3.1 先设计「那 3 秒」

评审最狠的一句：*「陷阱最精彩的时刻不是僵尸踩上去的 0.1 秒，而是你低头、选口子、按下按键、看到光圈亮起的 3 秒——这 3 秒设计案一个字都没写。」*

v2 把这 3 秒拆成 5 个可见节拍，缺一个都不算完成：

| # | 节拍 | 规格 |
| --- | --- | --- |
| 1 | **选** | 按 6 进陷阱槽；**再按一次循环下一株**（土豆雷 → 尖刺团 → 食人花 → …）。底栏那一格显示当前植物名 + 「2/3」+ 剩余颗数。触屏点格子同效 |
| 2 | **瞄** | 手上是陷阱时，准星落点常驻一株**半透明植株 ghost**（50% 透明 + 绿色描边）+ 地面范围环（显示触发 / 杀伤半径）。ghost 的 Y 走 player.supportHeight(map.platforms, x, z, 99)，**不是固定 0**（雪地砖台会穿模；map.platforms 可能不存在，先判空） |
| 3 | **验** | ghost 三色：绿=可放 / 黄=冷却中或缺颗数 / 红=超距或撞墙。撞墙判定复用 sweepWalls(map.walls, …, r=0.25)，从眼睛扫到落点。**不做静默钳制**——超出 10 米时 ghost 停在 10 米并变红 |
| 4 | **种** | 点击（**边沿触发**，controls.consumeFirePressed()，不能按住连放）→ 植株从 0.2 倍弹到 1 倍（0.18 秒）、土花四溅（particles.burst）、sfx.dirt()、镜头 0.06 后坐 |
| 5 | **布防 → 就绪** | 布防期植株半沉、范围环画进度；就绪瞬间一声上膛音 + 植株开始自己的 idle 动画。**「就绪」和「布防中」必须一眼分得出**，不能只靠 HUD |

再加一条**不看屏幕也知道**：HUD 那格用 3 个小圆点表示已就绪颗数，陷阱触发时整格闪一下。

> 为什么值得这么细：FPS 视角里玩家**看不见自己脚下**。没有 ghost、没有落点反馈、没有 HUD 计数，这个系统在体感上等于不存在——这正是评审判 v1「动词不成玩具」的原因。

### 3.2 经济：按颗付费，不走弹匣

| 规则 | 内容 | 理由 |
| --- | --- | --- |
| 付款时刻 | **每次放置扣 def.cost 阳光**，走现有 ctx.spendSun() | 「埋一颗 = 付一颗」，决策发生在埋的那一刻 |
| 充能 | maxCharges + recharge（**完全复用坚果那套** WeaponSystem.charges[]） | 零新经济代码；HUD 的 setCharges 也现成 |
| 冷却 | def.cooldown = 0.6s，只防一帧连放 | 真正的节流是充能，不是冷却 |
| 阳光不足 | sfx.deny() + hud.denySun() | 与枪械一致 |
| 场上上限 | 每株独立 maxActive（3 / 2 / 1），全场 ≤ 6 | 性能与「不许囤一院子雷」双保险 |
| 关卡重置 | reset() / setMap() 清空 | 与 WeaponPickups 一致 |

**对账**（按现有 wavePlan 复算，每颗阳光球 5 点、假设全捡）：

| 波次 | 本波阳光收入 | 陷阱稳态支出 | 占比 |
| --- | --- | --- | --- |
| W1 | 25 | 0~10 | ≤40%（只买得起 1 颗雷） |
| W4 | 120 | 20~40 | 17~33% |
| W10 | 440 | 35~60 | 8~14% |
| W20 | 895 | 35~60 | 4~7% |

结论：**前期是取舍，后期是习惯**。不会出现 v1 的「每波续包吃掉 78% 收入」，也不会因为太便宜而变成无脑撒。

### 3.3 三株植物（一株一个动词）

| | 土豆雷 | 尖刺团 | 食人花 |
| --- | --- | --- | --- |
| 模型 | potato-character | green-spiky-blob | piranha |
| 动词 | **预判** | **封锁** | **处决** |
| 价格 / 充能 | 10 阳光 · 3 颗 · 14s 回 1 | 8 阳光 · 2 块 · 12s 回 1 | 25 阳光 · 1 株 · 22s 回 1 |
| 布防 | 1.2s | 0.5s | 0.8s |
| 触发 / 范围 | 僵尸脚底进 1.6m → 炸 1.9m | 常驻 2.4m 圈，每 0.4s 一跳 | 僵尸进 1.5m → 扑咬 |
| 效果 | **400 爆炸伤害**（走 damageArea） | **10 伤 / 0.4s × 14s**（对圈内所有僵尸） | **非 Boss 地面单位直接吞掉**；Boss 咬 350 |
| 之后 | 消失（一次性） | 14 秒后枯萎 | 咀嚼 8 秒，之后继续值守（永久） |
| 场上上限 | 3 | 2 | 1 |
| 一句话定位 | 一颗雷换一条命，但得有人踩 | 过路费：走得越慢付得越多 | 护甲的钥匙：不用火也能处理铁桶 / 橄榄球 |

**数值推导（不是拍的）**

- **400 伤**：现有护甲公式下单发命中桶僵尸实际结算 = 400×0.3 + (400−200) = 320 > 140，橄榄球 = 400×0.5 + (400−260) = 340 > 150。也就是**任何非 Boss 地面单位一发清掉**。门槛其实只要 275 就够，留余量是为了以后加更厚的甲；同时 400 对 62 血的普通僵尸是 6.5 倍超杀——**所以才必须靠「第一只踩上去的怪」触发**：僵尸群会拿一只杂兵把它骗掉，这是它天然的反制。
- **10 伤/0.4s**：25 DPS/只，但对圈内**所有**僵尸生效。疾行者 3.1 m/s 穿过 4.8 米直径约 1.5s → 4 跳 = 40 伤（正好一只疾行者）；普通僵尸 2.05 m/s → 2.3s → 6 跳 = 60 伤（差 2 点，需要补一枪）。它永远是「削一层皮」，不是「清场」。
- **食人花**：评审要求砍掉「当前血量 ≤450」这种双读数判定（hp 与 armorHp 是两套账）。v2 改成**二分**：非 Boss 地面单位 = 吞，Boss = 350。简单、无歧义，而且给了它唯一的身份——**不靠火豌豆也能处理带甲单位**。代价是 1 株 / 22 秒 / 8 秒咀嚼，节奏很慢。

### 3.4 规则边界（写死，别再加）

- **僵尸无视陷阱**：不撞、不打、不绕、不拆。Zombie.update 一行不改——这是 v1 里最正确的一条，保留。
- 唯一例外是**巨人 Boss 的砸地会踩坏范围内陷阱**（见 §5）。这是 Boss 的专属语言，不是通用规则。
- **陷阱不打空中**：气球浮在 2.2 米，陷阱判定只看地面单位（z.airborne 直接跳过），不改对空白名单。
- 陷阱伤害统一走 z.hit() + zombies.handleKill()（保证计分、掉落、Boss 结算都走同一根管子），爆炸类走 damageArea()。
- 陷阱**不进** WeaponPickups 的 lootIndices，也不吃 Backspace 丢弃。

---

## 4. 三只新怪（每只一个新动词）

### 4.1 疾行者（Runner）——「别站着」

| 项 | 值 |
| --- | --- |
| 模型 | goblin.glb（1.62 米，瘦长、獠牙） |
| hp / 速度 / 伤害 / 分数 | **40** / **3.1 m/s** / 7 / 60 |
| 命中球 | HIT.goblin = { chest: 0.95, head: 1.35, radius: 0.8 }（乘类型 scale） |
| 行为 | 纯追击（复用现有 AI）+ 前进方向叠加横向正弦（幅 0.6m、3Hz），成群时像潮水而不是一条直线 |
| 出场 | 第 4 波起，floor((n−3)×0.7)，单波 ≤ 6，同屏配额 25% |
| 掉落 | 1 颗 |

**40 血是刻意的**：豌豆身体 15 伤要 3 发，**爆头 45 一发死**。它把「瞄准」第一次变成效率问题——对着人堆泼水要 3 倍子弹。

### 4.2 分裂史莱姆（Splitter）——「别只打一发」

| 项 | 值 |
| --- | --- |
| 模型 | slime-enemy.glb（1.15 米，带角绿史莱姆） |
| hp / 速度 / 伤害 / 分数 | **100** / 1.7 m/s / 9 / 140 |
| 行为 | 死亡时**原地裂成 2 只小史莱姆**（slimelet：hp 40 / 速度 2.3 / 伤害 5 / 分数 40 / 模型 scale 0.6，不再分裂） |
| 分裂条件 | 仅当 zombies.length + 2 ≤ maxAlive（不突破 14 只硬上限）。**不做伤害类型判断**——死了就裂，规则越少越好 |
| 出场 | 第 6 波起，1 + floor((n−5)×0.4)，单波 ≤ 4 |
| 掉落 | 2 颗 |

**为什么值得要**：它是**第一个惩罚「单发爆发」的怪**。樱桃炸死它 → 两只小怪；豌豆点死它 → 也是两只，但小怪脆（一发爆头）。真正的最优解是**先站到地刺上再打**，或者用食人花吞掉本体。这就把陷阱从「可选」变成「划算」。

### 4.3 投手（Spitter）——「别待在原地」

| 项 | 值 |
| --- | --- |
| 模型 | mushroom-evolved.glb（1.55 米，蓝色菌盖 + 獠牙大嘴） |
| hp / 速度 / 伤害 / 分数 | **130** / 1.35 m/s / 8 / 320 |
| 行为 | 维持 7~13 米距离带（近了后退、远了前进），每 2.8 秒**蓄力 0.7 秒**（模型鼓起来、嘴发亮）→ 抛一颗孢子弹 |
| 孢子弹 | 抛物线（复用 EnemyShots.lob），命中玩家 **12 伤**，撞墙消失 |
| 出场 | 第 8 波起，1 + floor((n−7)×0.3)，单波 ≤ 3，**同屏 ≤ 2** |
| 掉落 | 2 颗 |

**诚实的设计承诺**：v1 说「甩泥让掩体第一次有用」，但三张图加起来能挡的掩体不到一半（评审 §4.5），而且平直弹道会被 0.92 米的矮墙挡不住。v2 **不承诺掩体**：孢子弹是**高抛**，就是要越过矮墙——它的作用是**把你从蹲点位置赶走**，而不是逼你找掩体。你能做的只有三件事：拉近距离（它会后撤）、换位置、或者先杀它。

> 这条也解释了陷阱为什么存在：**你被赶走的时候，花园还在原地工作。**

### 4.4 波次公式（替换，不是叠加）

```js
// config.js → wavePlan(n)
const runners   = n >= 4 ? Math.min(6, Math.floor((n - 3) * 0.7)) : 0;
const splitters = n >= 6 ? Math.min(4, 1 + Math.floor((n - 5) * 0.4)) : 0;
const spitters  = n >= 8 ? Math.min(3, 1 + Math.floor((n - 7) * 0.3)) : 0;
const replaced  = runners + splitters + spitters;
const normals   = Math.max(4, 4 + Math.floor(n * 1.45) - replaced); // ← 从普通僵尸里扣
```

| 波次 | 原总怪量 | 新总怪量 | 普通 | 疾行 | 分裂 | 投手 | 变化 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 44 | **44** | 10 | 4 | 3 | 1 | 0% |
| 15 | 67 | **67** | 12 | 6 | 4 | 3 | 0% |
| 20 | 90 | **90** | 20 | 6 | 4 | 3 | 0% |

**总量一动不动**。变的只是「第 20 波里有 33 只普通僵尸」变成「20 只普通 + 13 只特殊」。评审算的 +34% 通胀直接消失。

同屏配额（14 只上限）：疾行者 ≤ 3（25%）、投手 ≤ 2、分裂体不限但受 maxAlive 约束。特殊怪**不设保底名额**——因为它们是从普通僵尸里换出来的，不存在「把普通挤没」。

> 实现上沿用 spawnOne 里已有的「超配额就换队列里下一个」机制；但**要顺手修掉它的饿死缺陷**：queue.findIndex 每 tick 全队列重扫 + 被顶到队首的怪永远排不上。改成「维护一个可刷候选索引」，或用 spawnAt 直接生成。

---

## 5. Boss：巨人（Gargantuar 的资产版）

### 5.1 为什么是巨人，不是僵尸博士

- 资产库里**没有机甲**。v1 的 acc:'zombot' 要现写玻璃罩 + 金属盆 + 喷口光晕，是纯手工美术，也是 v1「零新增美术资产」这句话里最大的漏洞。
- giant.glb 有 Attack / Death / HitRecieve / Idle / Jump / Run / Walk 七段动画，**砸地前摇可以直接播 Attack 慢放**，不需要新动画。
- 巨人扔的桶用 props/barrel.glb——现成的 CC0 道具，比程序化小鬼更符合「院子里有什么扔什么」。

僵尸博士、蘑菇王留到 P3（见 §9）。

### 5.2 数值

| 项 | 值 | 推导 |
| --- | --- | --- |
| hp | **900** | 第 5 波 zombieHpMul = 1.44 → 1296。豌豆 100 DPS + 破绽期 ×1.5 ≈ **9~10 秒**打完，不是一个 20 秒的海绵 |
| 速度 | 1.15 m/s | 比所有小怪慢，风筝成立 |
| 身高 | **3.40 米** | 模型归一化到 1.85（同普通僵尸）× 类型 scale 1.84；评审警告 4.8 米会挡掉半个屏幕，3.4 米仍然一眼是 Boss |
| 伤害 / 砸地起手 | 30 / 2.6m（`slam.range`） | 砸地替代普攻，起手距离**不套** `attackRange` 公式 |
| 分数 / 掉落 | 3000 / 7 颗 | 走 def.sun |

### 5.3 三个动作

**① 砸地（替代普攻）**

进入 2.6m → 0.85 秒前摇（举双臂 + 地面红圈半径 2.3m）→ 砸落

- 砸落：半径 2.3m 内 30 伤 + **击退 3.2 米** + ctx.shake(0.9) + 尘土环
- **砸坏范围内所有陷阱**（traps.destroyInRadius(pos, 2.3)）——这是 Boss 的专属语言：你的花园会被踩掉
- 砸完**硬直 1.4 秒**：双臂垂下、身体前倾、冒火花，**受到伤害 ×1.5**

> 「前摇 0.85 秒可走位 + 硬直 1.4 秒可倾泻」= 一个不需要新动画的 Boss 节奏。评审说 v1 的「机制」在代码里打折成「血更厚」，v2 的机制是**时间结构**，不依赖任何新规则。

**② 扔桶（半血杀招）**

- 血量降到 **50%** 和 **25%** 各触发一次：1.0 秒蓄力 → 把 barrel.glb 高抛向玩家当前位置
- 桶落地炸开 → **跳出 2 只疾行者**（spawnAt）+ 木屑粒子
- 桶本身不造成伤害（它是运兵车，不是炸弹）

**③ 走路**

普通追击 + 流场寻路。**砸地起手用 `slam.range = 2.6`，不套 `attackRange` 公式**：现有公式是 `1.15 + scale×0.55`，按 1.84 只给 2.16 米，3.4 米的巨人手够不到。2.6 米起手 + 2.3 米杀伤半径 = 看到红圈立刻后撤还来得及，站着不动必吃。

> `scaleFactor` 是 `def.scale`（1.84），不是模型归一化后的米数。命中球同样乘它：HIT.giant 用 1.85 米人形的口径（chest 1.02 / head 1.52 / radius 1.0），乘 1.84 后胸口 1.88、头部 2.80 米，头部球仍小于胸口球。

### 5.4 Boss 轮换

| 波次 | 5 | 10 | 15 | 20 | 25 | 30 |
| --- | --- | --- | --- | --- | --- | --- |
| Boss | **巨人** | 骷髅王（现状） | **巨人** | 骷髅王 | **巨人** | 骷髅王 |

规则：n % 5 === 0 时，(n / 5) % 2 === 1 → gargantuar，否则 boss（骷髅）。

**这是 v1 之外唯一必要的重构**：项目里 z.type === 'boss' 写死了 7 处（ZombieManager.js:92/168/236/290、Game.js:411/433、Zombie.js:524）。改成 ZOMBIES[type].boss === true + z.def.boss，一处数据驱动，之后加第三只 Boss 不用再改这 7 处。

**为什么值得改**：巨人 900 血、骷髅王 1450 血，两种 Boss 的「血条压力」不同，正好对应两种性格——巨人考**走位与时机**，骷髅王考**火力与走位空间**。同一个骨骼上长两套节奏，比一个 Boss 堆血量划算得多。

---

## 6. 互锁网（这张表是灵魂）

```
陷阱常驻 6 号槽 ──→ 「种什么」是切枪时的一秒决策，不是抽卡
土豆雷 ──→ 预判窄口 ──→ 疾行者冲得快、正好踩上去
尖刺团 ──→ 削一层皮 ──→ 分裂体、疾行者群在刺上越打越亏
食人花 ──→ 处决带甲 ──→ 铁桶 / 橄榄球不用火也能处理
疾行者 ──→ 逼你瞄准（爆头一发）──→ 站着不动就掉血
分裂史莱姆 ──→ 惩罚单发爆发 ──→ 先铺刺再打 / 或用食人花吞本体
投手 ──→ 把你从蹲点赶走 ──→ 你走的时候，陷阱还在原地工作
巨人砸地 ──→ 踩掉你的花园 ──→ 硬直 1.4 秒 ×1.5 ──→ 重新种 or 抢输出
巨人扔桶 ──→ 两只疾行者 ──→ 脚下有没有刺，结果完全不同
```

**闭环检查**：每一株植物都有至少一只怪让它「值得种」，每一只新怪都有至少一个不靠陷阱的解法（豌豆爆头 / 拉开 / 先手）。**没有钥匙死锁**。

---

## 7. 工程坐标（按文件）

| 文件 | 改动 | 注意 |
| --- | --- | --- |
| src/config.js | WEAPONS **末尾追加** 3 株：slot:'trap'、kind:'deploy'、trap:{…}、maxCharges/recharge、**不带 ammo** | 下标敏感（测试里全是 pickup(5) 这类硬编码） |
| | SLOT_KEYS 末尾加 { role:'trap', pos:0 } → 自动变 6 号键 | SLOT_KEY_BASE 不动 |
| | WEAPON_SLOTS 加 trap: 3（三格：三株全装） | makeSlots() 有一份硬编码 role 列表，必须同步 |
| | ZOMBIES 加 runner / splitter / slimelet / spitter / gargantuar | 每项补 sun（见下） |
| | wavePlan 三条新公式 + 从 normals 里扣 | 总量必须守恒 |
| src/entities/WeaponPickups.js | `lootIndices` 排除 `kind === 'deploy'`（现在只排除 `shield` 和豌豆） | **漏了这一步陷阱会悄悄进随机掉落池** |
| src/entities/ZombieManager.js | handleKill 的掉落改成读 z.def.sun（老 7 型补齐字段） | 现在是 7 段三元链，加 5 型会失控 |
| | spawnAt(type, x, z, opts) 公开定向生成（分裂、扔桶共用） | 跳过队列，但仍检查 maxAlive |
| | 7 处 'boss' → def.boss；队列过滤同理 | |
| | spawnOne 的配额机制修掉「队首饿死」 | |
| src/entities/Zombie.js | HIT 表加 4 套（goblin / slime / mushroom / giant） | **头部球必须仍小于胸口球** |
| | buildAnimations 从 isSkeleton ? … : … 改成**按模型 id 查动作名表** | 现在有 5 套命名（Quaternius / KayKit / Slime_* / Bite_Front…） |
| | gargantuar 状态机：slam（前摇 / 砸落 / 硬直）+ barrel（50%/25% 阈值） | 硬直期 vulnerable=1.5，在 hit() 里乘 |
| | splitter 死亡 → ctx.zombies.spawnAt('slimelet', …) ×2 | 死了就裂；只受 maxAlive 约束 |
| | spitter 距离带 + 前摇 + ctx.enemyShots.lob() | 前摇期播 Bite_Front |
| **新** src/entities/TrapManager.js | place(defIndex, point) / update(dt, zombies) / destroyInRadius(pos, r) / reset() | 仿 WeaponPickups 的池化；陷阱主动测距，Zombie 零改动 |
| **新** src/entities/EnemyShots.js | 敌方抛射物池：lob(from, to, opts)、update、sweepWalls 挡墙、只判玩家 | 与玩家 ProjectileSystem 分离（评审 §4.1 第 4 条） |
| src/weapons/WeaponSystem.js | tryFire 加 kind==='deploy' 分支（在 starter/ammo 之前） | 陷阱没有 ammo，走 charges |
| | update 里 deploy 类用 consumeFirePressed()，其余仍 firing | 否则按住会连放 |
| | equip 里 def.maxCharges 也要 setCharges（现在只在 starter 分支里） | 陷阱不是 starter |
| | equipSlot 同角色重复按键 → 循环 pos | 6 键切三株 |
| | mountTraps() 开局装三株；dropSlot 拒绝 trap | 同 peaGun |
| | ghost 预览（仅在陷阱槽可见）+ groundRange 钳制 2~10m | |
| src/ui/HUD.js | buildDock 第 6 格 {role:'trap', label:'陷阱'}；ICONS 补 3 个图标 | 契约测试会查图标 |
| | 陷阱格的「已就绪颗数」pips + 触发闪烁 | |
| src/Game.js | ctx.traps = this.traps、ctx.enemyShots = this.enemyShots | 漏了 ctx.pickups 那次教训 |
| | update 在 projectiles.update() **之后**插 traps.update()；enemyShots.update() 紧随 | 用当帧僵尸位置 |
| | reset() / setMap() 清空陷阱与弹道 | |
| | 波次横幅按 def.boss 取名字 | 现在硬编码「巨人僵尸出现了」 |
| src/entities/Player.js | knockback(dx, dz, dist)：0.25 秒衰减位移，期间输入权重降低 | 砸地的物理后果；不做就只剩震屏 |
| src/gallery/presets.js | 4 个新类型（runner / splitter / spitter / gargantuar）+ 高度与相机距离 | gallery.test.js 强制覆盖全部 ZOMBIES |
| src/style.css | .slot-btn.role-trap 配色；6 格宽度 | 见下 |
| tests/ | 见 §8 | |

### 7.1 移动端 6 格：实测不是问题

评审说「6×56px 顶到开火键上方，宽度对不上」。按 src/style.css 实际值算：

- 触屏横排每格 = --weapon-w × 0.72 = 48~62 × 0.72 ≈ **35~45px**
- 6 格 + 5×5 gap = **235~295px**
- 起点在 right: fire-size + 24（开火键 100~128px），即距右边 124~152px

844×390 的 iPhone 上，整条占 359~447px，左侧还剩近 400px 给摇杆。**够用**。只需把 --weapon-w 的下限从 48 调到 46，并给 .role-trap 一个绿色边框。

### 7.2 契约测试要一起改（不是「改测试让它过」）

| 测试 | 现在 | 应改成 |
| --- | --- | --- |
| projectcontract.test.js 武器数值 | kind 只能 ∈ ['pea','lob','hitscan','shield'] | 加 'deploy' |
| 同上：除豌豆/护盾外必须有 ammo | 陷阱没有弹匣 | 新增分支：kind==='deploy' 必须有 maxCharges/recharge、**不得**有 ammo |
| config.test.js 僵尸类型清单 | 7 项硬编码 | 补 5 项（含 slimelet） |
| config.test.js「boss 各项数值全场最大」 | 只认 boss | 改成「**每个 def.boss 都优于所有非 Boss**」——否则巨人 900 血必然判红 |
| config.test.js 波次逐项计数 | 写死 33 普通 / 19 锥… | 改成断言**总数与配比**（普通 ≥ 4、特殊 ≤ 上限、总量不变） |
| zombiemanager.test.js queue.filter(t=>t==='boss').length===1 | 只认 'boss' | 改成「def.boss 的类型合计 1」 |
| gallery.test.js | 覆盖全部 ZOMBIES | 自动通过，前提是 presets.js 补齐 |

---

## 8. 分期与验收

### P0 · 地基（半天，不改玩法）

1. def.boss 替换 7 处硬编码；handleKill 掉落改 def.sun
2. spawnAt(type, x, z)
3. MODELS 支持 targetHeight + 加载循环化
4. buildAnimations 改成按模型查表（5 套命名）
5. 契约测试按 §7.2 更新

> 验收：npm test 全绿，npm run build 通过，现有手感零变化。

### P1 · 花园（主体，一次内容包）

**内容**：6 号陷阱槽 + 三株植物 + TrapManager + ghost 预览 + 疾行者 + 分裂史莱姆

- [ ] 按 6 切陷阱、再按循环三株；底栏显示当前植物 + 颗数
- [ ] ghost 在雪地砖台上不穿模；超距变红且不静默钳制
- [ ] 土豆雷：布防 1.2 秒内踩上去**不炸**，就绪后炸；一发清掉铁桶
- [ ] 尖刺团：疾行者群穿过时肉眼可见地掉血；14 秒后枯萎
- [ ] 食人花：吞掉普通 / 铁桶 / 橄榄球；对 Boss 只咬 350；咀嚼 8 秒
- [ ] 分裂史莱姆：死时裂 2 只，且**不会突破 14 只上限**
- [ ] 波次总量与现值一致（±0）
- [ ] window.__game.traps.items 可在控制台断言
- [ ] UT 新增 tests/unit/trapmanager.test.js（布防 / 触发 / 枯萎 / 上限 / 阳光不足 / 重置）
- [ ] E2E 新增场景：种雷 → 强制僵尸踩上去 → 断言 totalKills +1

### P2 · 院外来客（Boss 与远程）

**内容**：投手 + EnemyShots + 巨人 Boss + 砸地 / 硬直 / 扔桶 + 陷阱被踩坏 + Player 击退

- [ ] startWave(5) 出巨人（3.4 米、举臂前摇、红圈）；startWave(10) 仍是骷髅王
- [ ] 红圈内被砸到掉 30 血并被推 3.2 米；圈外无伤
- [ ] 砸地后 1.4 秒硬直期伤害 ×1.5（伤害数字可验）
- [ ] 砸地范围内的陷阱全部消失
- [ ] 50%/25% 各扔一次桶，落地跳出 2 只疾行者
- [ ] 投手维持 7~13 米，0.7 秒前摇可读，孢子弹越矮墙
- [ ] 同屏投手 ≤2，超过的留在队列里下次再刷

### P3 · 待定（本轮不做）

| 提案 | 资产 | 一句话 |
| --- | --- | --- |
| 窝瓜（第四株陷阱） | pumpkin.glb | 触发式砸击 + 短眩晕；**等 P1 试玩证明「单点爆发不够用」再加**，否则和土豆雷重复 |
| 蘑菇王（机制型 Boss） | mushroom-king.glb | 召唤小蘑菇 + 蹲下减伤（Duck 动画），站桩输出的阶段考 |
| 掘地者 | rat.glb / spider.glb | 钻地不可选中（必须先做 canBeHit() 单一判定口，5 处一致） |
| 狂暴兽人（读报的资产版） | orc.glb | 破甲后进入 Run 狂暴，速度 ×2 |
| 磁力菇 / 三叶草 / 火炬树桩 | 无 | 见 v1 §7，仍未拍板 |

---

## 9. v1 里被砍掉的东西（逐条理由）

| v1 内容 | 处置 | 理由 |
| --- | --- | --- |
| 窝瓜 | **砍** | 与土豆雷同为「即时 AOE 单点」；眩晕打断会和三套状态机打架 |
| 掘地僵尸 | **推迟 P3** | 需要 buried 状态 + 命中豁免；评审要求先有 canBeHit() 单一判定口 |
| 铁门僵尸 | **砍** | 资产库没有门模型；方向性护甲用户已否决，做成材质护甲又和铁桶重复 |
| 读报僵尸 | **砍 / 改名推迟** | 没有报纸模型；「暴怒」这个好点子可以用 orc.glb 重做 |
| 舞王僵尸 | **砍** | 没有模型；召唤职责交给巨人扔桶 |
| 僵尸博士 | **改名推迟** | 没有机甲模型；蘑菇王是更便宜的机制型 Boss |
| EnemyShots 复用 throwCherry | **改** | 评审 §4.1 第 4 条：签名会读玩家武器的 damage/radius/color，混用必污染 |
| 落地 = 三处命中口自动放行 | **改** | damageArea 根本没有对空门槛；本版不引入悬浮 Boss，绕开这个坑 |
| 放置 2~8 米静默钳制 | **改 2~10 米 + 红 ghost** | 静默截断会让玩家以为「放歪了」 |

---

## 10. config 草案（可直接抄）

```js
// ── 槽位 ──
// SLOT_KEYS 字面量末尾加一行（SLOT_ORDER 由它 map 出来，别用 push，否则顺序表会漏）
{ role: 'trap', pos: 0 },                          // → 6 号键
// WEAPON_SLOTS 字面量加 trap: 3（三株全装，按 6 循环）
// makeSlots() 里那份硬编码的 role 列表同步：Object.keys(WEAPON_SLOTS).filter(k => k !== 'swapAnim')

// ── WEAPONS 末尾追加（顺序即下标，勿插中间）──
{ id: 'potatoMine', slot: 'trap', name: '土豆雷', short: '土豆雷',
  desc: '埋雷 · 预判一击', starter: false, model: 'potatoMine', kind: 'deploy',
  cost: 10, cooldown: 0.6, damage: 400,
  maxCharges: 3, recharge: 14,
  trap: { armTime: 1.2, triggerRadius: 1.6, blastRadius: 1.9, maxActive: 3, placeRange: 10 } },

{ id: 'spikeblob', slot: 'trap', name: '尖刺团', short: '尖刺',
  desc: '铺地 · 过路费', starter: false, model: 'spikeblob', kind: 'deploy',
  cost: 8, cooldown: 0.6, damage: 10,
  maxCharges: 2, recharge: 12,
  trap: { armTime: 0.5, radius: 2.4, tick: 0.4, tickDamage: 10, duration: 14,
          maxActive: 2, placeRange: 10 } },

{ id: 'chomper', slot: 'trap', name: '食人花', short: '食人花',
  desc: '处决 · 无视护甲', starter: false, model: 'chomper', kind: 'deploy',
  cost: 25, cooldown: 0.6, damage: 350,
  maxCharges: 1, recharge: 22,
  trap: { armTime: 0.8, triggerRadius: 1.5, chewTime: 8, maxActive: 1, placeRange: 10 } },

// ── ZOMBIES 新增（每项都要 sun）──
runner:    { hp: 40,  speed: 3.1,  damage: 7,  score: 60,   scale: 1,   radius: 0.38,
             sun: 1, model: 'goblin', acc: null, behavior: 'swarm', weave: 0.6 },
splitter:  { hp: 100, speed: 1.7,  damage: 9,  score: 140,  scale: 1,   radius: 0.45,
             sun: 2, model: 'slime', acc: null, split: { into: 'slimelet', count: 2 } },
slimelet:  { hp: 40,  speed: 2.3,  damage: 5,  score: 40,   scale: 0.6, radius: 0.28,
             sun: 1, model: 'slime', acc: null },
spitter:   { hp: 130, speed: 1.35, damage: 8,  score: 320,  scale: 1,   radius: 0.45,
             sun: 2, model: 'mushroom', acc: null,
             ranged: { band: [7, 13], cd: 2.8, windup: 0.7, damage: 12, speed: 16 } },
gargantuar:{ hp: 900, speed: 1.15, damage: 30, score: 3000, scale: 1.84, radius: 0.95,
             sun: 7, model: 'giant', acc: null, boss: true,
             slam: { telegraph: 0.85, radius: 2.3, knockback: 3.2, recover: 1.4, vulnMul: 1.5 },
             barrel: { at: [0.5, 0.25], cd: 1.0, spawn: 'runner', count: 2 } },

// ── 波次 ──
function wavePlan(n) {
  const runners   = n >= 4 ? Math.min(6, Math.floor((n - 3) * 0.7)) : 0;
  const splitters = n >= 6 ? Math.min(4, 1 + Math.floor((n - 5) * 0.4)) : 0;
  const spitters  = n >= 8 ? Math.min(3, 1 + Math.floor((n - 7) * 0.3)) : 0;
  const normals   = Math.max(4, 4 + Math.floor(n * 1.45) - runners - splitters - spitters);
  // …其余照旧；n%5===0 时 push((n/5)%2===1 ? 'gargantuar' : 'boss')
}

// ── 配额 ──
RUNNER_QUOTA_RATIO = 0.25;   // 同屏 ≤ 3
MAX_SPITTER_ALIVE  = 2;
```

> 以上是 **v0 起点值**，按现版经济带宽（单体 8~14 伤/阳光、AOE 15~25 伤/阳光）校准。实装后以试玩为准，改动只碰 config.js。

---

## 11. 四条设计纪律（继承 + 新增）

1. **数值只进 config.js**，改完同步 GAMEPLAY.md。
2. **护甲只进 ARMOR_MATERIALS**，不写武器 × 僵尸特例。本版**不新增材质**。
3. **命中豁免必须单点判定**：本版不引入任何新的「打不到」状态，所以 ProjectileSystem / WeaponSystem / damageArea / 燃烧跳 四处口径保持现状，不动。
4. **新内容先点名模型**：没有 glb 的点子不进设计文档。这是本版被资产逼出来的纪律，也是以后最省事的一条。

---

## 12. 一句话总结

> v1 想同时加三个动词、七只怪、两只 Boss；v2 只加一个动词——**种**。
> 种下去的东西会自己打仗，你才敢离开那个路口。这就是这一版全部的好玩。
