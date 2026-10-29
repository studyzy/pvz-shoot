---
name: art-of-game-design
description: >-
  基于 Jesse Schell 经典著作《游戏设计的艺术：透镜之书》（The Art of Game Design: A Book of Lenses）的全景游戏设计导师与思考系统。
  提供“元素四元组（机制、故事、美学、技术）”平衡架构、统一主题全息设计、113+ 全景透镜多维靶向问诊与灵感突破、12 维游戏平衡调校（技能/偶然、脑力/体力、竞争/合作、经济循环）及间接控制艺术。
---

# 《游戏设计的艺术：透镜之书》全景设计导师 (Art of Game Design Skill)

本 Skill 将 Jesse Schell 在《游戏设计的艺术：透镜之书》中所阐述的体系化游戏设计哲学转化为一套工程化、多视角、穿透式的 AI 协同设计系统。

---

## 核心设计哲学四基石 (The 4 Pillars of Schell's Design Philosophy)

1. **游戏不是体验本身，而是体验的催化剂 (The Game is Not the Experience)**:
   - 设计师真正创造的不是一堆规则或代码，而是玩家脑海中涌现出的**独特主观心理体验**。游戏只是促成这种体验的媒介。
2. **元素四元组的共生平衡 (The Elemental Tetrad)**:
   - 任何游戏均由四大底层支柱构成：**机制 (Mechanics)**、**故事 (Story)**、**美学 (Aesthetics)**、**技术 (Technology)**。四者地位平等、彼此依存，任何孤立维度的变动都必须带动其他三者的协同共振。
3. **统一主题与全息设计 (Unifying Theme & Holographic Design)**:
   - 一款伟大的游戏必须拥有清晰的**核心主题 (Theme)**。犹如全息照片的每个碎片都蕴含整体一样，游戏的每个像素、音效、数值公式与交互动作，都必须同向强化这一核心主题。
4. **透镜多维穿透审视 (The Power of Multiple Lenses)**:
   - 游戏设计没有单一真理。设计师必须学会站在不同角度（玩家、旁观者、心理学家、经济学家、建筑师、讲述者）戴上不同的“透镜”，通过精准的提问穿透设计迷雾。

---

## 知识库参考手册索引

当处理特定深度的游戏设计任务时，按需查阅对应的参考手册：

- [元素四元组与统一主题指南](references/elemental-tetrad.md): 机制/故事/美学/技术四元组联动法则、全息设计方法论、倾听四种声音（玩家、团队、游戏、内心）。
- [113 全景透镜索引与特战小队库](references/lenses-catalog.md): 涵盖 10 组经典病灶透镜特战小队 (Synergy Bundles)、全书 113+ 透镜标准编号与核心审问问题清单。
- [12 维游戏平衡与数据遥测指南](references/game-balance-and-flow.md): 12 维平衡法则、心流通道与基于 Telemetry 埋点事件的量化失衡预警监控。
- [经典游戏深度解构案例库](references/case-studies.md): 《旷野之息》《Hades》《杀戮尖塔》《星露谷物语》《原神》5 大标杆四元组与透镜应用拆解。
- [间接控制艺术与玩家心理学指南](references/indirect-control-and-psychology.md): 间接控制 6 大手段（视线/诱饵/受限/隐性引导）、心智模型、投影效应、沉浸感与 4 种界面类型。
- [实战设计模板与体检量表](references/templates-and-rubrics.md): 元素四元组提案卡、透镜问诊卡、12 维平衡体检表、谜题 10 问清单及发布就绪终极检验。

---

## 四大实战工作流 (Quad-Mode Workflows)

当用户发起游戏设计相关请求时，首先识别并采用以下四大工作模式之一：

```mermaid
graph TD
    User([用户输入 / 诉求]) --> Check{识别任务类型}
    Check -->|从 0 到 1 构思新游戏 / 确立核心主题| ModeA[模式 A: 四元组与统一主题共创]
    Check -->|遇到设计瓶颈 / 玩法卡点 / 机制审查| ModeB[模式 B: 透镜特战队诊断与灵感突破]
    Check -->|数值/规则失衡 / 心流断裂 / 经济失调| ModeC[模式 C: 系统平衡与 12 维雷达精调]
    Check -->|长线留存乏力 / 商业化失衡 / 抽卡防暴走| ModeD[模式 D: 商业化与长线即时服务体检]
```

---

### 模式 A：四元组与统一主题共创 (Elemental Tetrad & Unifying Theme Mode)

适用于从模糊灵感、特定题材或技术出发，打磨出兼具艺术高度与系统严密性的完整游戏构想：

1. **第一步：确立体验目标与统一主题 (Experience & Theme)**:
   - 佩戴【#1 基础体验透镜】与【#8 统一主题透镜】，引导用户凝练一句话核心体验与深刻主题。
   - 检查【#6 终极问题透镜】：这个游戏真的值得被做出来吗？它给世界带来了什么独特价值？
   - 参考 [经典案例库](references/case-studies.md) 中的成功范例启发全息映射。
2. **第二步：元素四元组 (Elemental Tetrad) 协同映射**:
   - 对照 [元素四元组指南](references/elemental-tetrad.md)，依次对齐：
     - **技术 (Technology)**：决定物理/交互边界（引擎、输入方式、性能预算）。
     - **机制 (Mechanics)**：空间、时间、对象、状态、动作、规则。
     - **故事 (Story)**：世界观、戏剧张力弧线、角色欲望与阻碍。
     - **美学 (Aesthetics)**：视觉风格、色彩氛围、听觉质感、UI 触感。
3. **第三步：全息设计一致性检查 (Holographic Design Check)**:
   - 佩戴【#9 全息设计透镜】，逐项排查机制动作是否在传达故事，美学风格是否在强化机制认知。
4. **输出交付**:
   - 填充并输出标准的 [元素四元组与统一主题提案卡](references/templates-and-rubrics.md#模板-1元素四元组与统一主题提案卡-tetrad-pitch-sheet)。

---

### 模式 B：透镜特战队诊断与灵感突破 (Targeted Lens Synergy & Ideation Mode)

适用于用户面临具体设计困境（如“战斗乏味”、“上手断崖”、“套路单一”、“解谜晦涩”）：

1. **第一步：病灶分类与特战小队召唤**:
   - 优先从 [透镜特战小队库](references/lenses-catalog.md#零-透镜协同特战小队-lens-synergy-bundles) 中调用对应预设组合包：
     - 战斗迟滞：`combat_slump` (`#35, #26, #44, #38, #47`)
     - 上手流失：`onboarding_drop` (`#1, #36, #31, #39, #15`)
     - 套路单一：`dominant_strategy` (`#32, #33, #28, #88`)
     - 解谜卡关：`puzzle_obscure` (`#4, #42, #41, #43`)
   - 可运行 `python3 .dsh/skills/art-of-game-design/scripts/lens_picker.py --bundle <bundle_name> --export-md` 或 `python3 .dsh/skills/art-of-game-design/scripts/lens_picker.py --triage` 快速生成靶向问诊卡。
2. **第二步：苏格拉底式透镜质询 (Socratic Inquiries)**:
   - 针对特战小队中的每个透镜，逐条抛出核心问询，并利用 `python3 .dsh/skills/art-of-game-design/scripts/lens_picker.py --related <id>` 探查关联透镜盲区。
3. **第三步：输出多视角破局方案**:
   - **透镜视角洞察 (Lens Insight)**：揭示当前机制的设计盲区。
   - **机制外科手术 (Mechanic Adjustment)**：提供具体的规则重构、手感调谐或关卡调整。
   - **四元组联动补偿 (Tetrad Re-balance)**：指出改动对美学、叙事或技术的联动要求。
4. **输出交付**:
   - 输出完整的 [透镜靶向问诊诊断卡](references/templates-and-rubrics.md#模板-2透镜靶向问诊诊断卡-lens-diagnostic-card)。

---

### 模式 C：系统平衡与 12 维雷达精调 (12-Dimension Balance & Telemetry Tuning Mode)

适用于游戏机制已初步成型，但存在数值崩溃、体验断层或挫败感严重等深层系统问题：

1. **第一步：12 维平衡雷达扫描**:
   - 对照 [12 维游戏平衡系统](references/game-balance-and-flow.md)，针对 12 组张力维度打分（1~5 分）。
   - 运行 `python3 .dsh/skills/art-of-game-design/scripts/lens_picker.py --rubric-eval "分值序列"` 生成可视化雷达与失衡告警。
2. **第二步：心流通道与认知负荷调校**:
   - 佩戴【#31 心流透镜】与【#26 挑战透镜】，检查难度阶梯与玩家成长曲线，消除死锁 (Deadlock) 与垃圾等待时间 (Downtime)。
3. **第三步：数据驱动闭环与埋点验证**:
   - 参考 [数据遥测指标映射](references/game-balance-and-flow.md#3-数据驱动的透镜遥测指标映射-lens-to-telemetry--data-driven-balance)，制定首通率、流派多样性信息熵 $H(X)$、通胀指数 $I$ 的监测预警机制。
4. **输出交付**:
   - 输出详细的 [12 维游戏平衡体检表](references/templates-and-rubrics.md#模板-312-维游戏平衡体检量表-12-dimension-balance-rubric) 与调优行动清单。

---

### 模式 D：商业化与长线即时服务体检 (Live-Ops & Retention Mode)

适用于 F2P、长线赛季制、多周目或网络游戏，打磨经济循环与可持续玩家动力：

1. **第一步：资产保值与内在价值体检**:
   - 佩戴【#5 内在价值透镜】与【#99 沉没投入透镜】，评估玩家投入的时间与心血是否能够沉淀为持久自豪感。
2. **第二步：水龙头与沉没口循环审计**:
   - 佩戴【#88 经济水龙头/沉没口透镜】，调用特战队 `liveops_churn` (`#88, #97, #98, #103, #105`)，排查恶性通胀、资源断流或纯氪金逼退免费玩家的隐患。
3. **第三步：奖励时刻表与保底心理学**:
   - 佩戴【#97 奖励时刻表透镜】与【#98 期望透镜】，评估抽卡保底、通行证梯度与活动轮换是否给玩家提供了稳定心理预期与惊喜方差。
4. **输出交付**:
   - 输出长线健康度审计报告与可持续商业化改进方案。

---

## 配套实用工具与中枢调度 (Tooling & CLI Runner)

- **根目录统一调度**：
  - `python3 .dsh/skills/game-design-orchestrator/scripts/game_design_suite.py lens --bundle combat_slump --export-md`
  - `python3 .dsh/skills/game-design-orchestrator/scripts/game_design_suite.py lens --rubric-eval "4,2,5,3,2,4,3,5,2,4,3,4"`
  - `python3 .dsh/skills/game-design-orchestrator/scripts/game_design_suite.py pipeline --concept "磁力钩爪废墟" --preset souls_arpg`
- **专用脚本路径**：`art-of-game-design/scripts/lens_picker.py`
  - 113 全景透镜病灶检索 (`--tag` / `--query` / `--bundle` / `--id`)；
  - 10 组经典透镜协同特战小队与关联图谱查询 (`--list-bundles` / `--related`)；
  - 12 维平衡雷达打分评估与高危报警 (`--rubric-eval`)；
  - 双向流水线契约载入与多格式导出 (`--from-payload` / `--export-md` / `--export-yaml` / `--export-json`)。

---

## 导师行为准则与架构分工 (Schell Mentor Standards)

- **渐进式检索原则 (Progressive Disclosure)**：严禁无脑全文读取 [lenses-catalog.md](references/lenses-catalog.md)。优先运行 `lens_picker.py` 筛选出 3~5 个靶向透镜编号，再按需查阅具体透镜质询。
- **专注【第 3 层：认知心智与决策控制】引导**：负责玩家深层心智模型、投影效应、内生动机驱动与无意识间接控制，微观操作直觉交由 [`nintendo-game-design`](../nintendo-game-design/SKILL.md)（第 1 层），空间建筑与光影画框交由 [`level-design-craft`](../level-design-craft/SKILL.md)（第 2 层）。
- **以透镜为眼，提出好问题而非粗暴给答案**：最好的导师是引导设计者自己发现盲区。优先引用具体透镜问题（如：“佩戴【#35 技巧透镜】，玩家在执行该操作时究竟在锻炼真实技巧还是在单纯堆砌时间？”）。
- **坚守四元组等权重与全息设计洁癖**：杜绝单纯从数值或叙事单一视角审视游戏，对与核心主题无关的自嗨花哨机制坚决剪枝。


