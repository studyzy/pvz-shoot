# 关卡设计大师工坊 Skill (Level Design Craft System) 🏛️📐

> 基于业界顶级关卡设计教科书与 3A 大厂工业化方法论（Totten 建筑学空间、育碧 RLD 度量、Valve 潜意识隐性引导、顽皮狗宽线性遭遇战、Arkane 瑞士奶酪非线性拓扑、2D 恶魔城能力锁、环境解谜因果链与 PvP/Co-op 多人拓扑）构建的 AI Agent 关卡设计大师系统。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI Agent Skill](https://img.shields.io/badge/AI-Agent%20Skill-blueviolet.svg)](https://github.com/Wilson520403/game-design-skills)

[English](README.md) | 简体中文

---

## 📖 简介

优秀的关卡设计是将核心玩法转化为玩家难忘体验的“无形之手”。

本 Skill 将世界顶级关卡设计专著（Christopher Totten《建筑学关卡设计方法》、Rudolf Kremers《关卡设计概念与实践》）与顶级工作室（Valve、育碧、顽皮狗、Arkane、任天堂、FromSoftware、id Software）的工业化方法论融会贯通，构筑为一套**可工程化落地、全流派适配、支持从白模构思到体检重构的 AI 协同设计系统**，支持：

1. **建筑学空间构成与情绪叙事 (Architectural Space & Typology)**：运用 Totten 的“庇护所与开阔地（Prospect & Refuge）”、垂直高压、阈限空间与画框构图，赋予关卡空间以心理张力与叙事厚度。
2. **理性关卡设计与物理度量 (Rational Level Design & Metrics)**：严守跳跃、攀爬、冲刺、视距等物理度量（Metrics），结合跳跃运动学抛物线计算，将复合机制拆解为原子化挑战阶梯，科学管控认知负荷。
3. **宽线性沙盒与遭遇战竞技场 (Wide-Linear Arenas & Encounters)**：采用顽皮狗式“漏斗-竞技场-收束”结构，打造包含制高点、掩体迂回动线与“猫鼠潜行-暴露-重置”闭环的动态战斗空间。
4. **潜意识光影与无痕引力引导 (Subconscious Guidance & Breadcrumbs)**：严守 Valve 三灯原则（主光/辅光/引路光）、视线几何引导线与面包屑诱饵链，实现零 UI、零弹窗的高自然度防迷路导航。
5. **瑞士奶酪与非线性探索拓扑 (Swiss Cheese & Shortcut Topology)**：空间多层“穿孔”与多解法渗透（战斗/潜行/垂直通道），结合魂系“可见不可达”心理诱引与单向回环（Loopback）捷径。
6. **2D 恶魔城、环境解谜与多人竞技/合作 (2D, Puzzles & Multiplayer)**：覆盖 2D 房间网格与能力锁、塞尔达/Portal 机关因果链与防死锁（Anti-Softlock）协议、PvP 三路 TTE 对称性与 Co-op 双人协同。

---

## 📂 知识库与目录结构

```
level-design-craft/
├── SKILL.md                                  # Skill 核心入口：六大基石、三模态工作流与 System Prompt
├── README.md                                 # 英文说明文档
├── README_CN.md                              # 中文说明文档 (简体中文)
├── LICENSE                                   # MIT 开源许可证
├── scripts/
│   └── level_metrics_and_pacing.py           # 度量衡预设、跳跃抛物线解算、心流波形诊断与 Unity C#/YAML 导出
└── references/
    ├── architectural-space-and-composition.md # 空间类型学、开阔与庇护、画框构图与阈限空间
    ├── rational-level-design-and-metrics.md   # 育碧 RLD 体系、度量表、原子化挑战与认知负荷
    ├── pacing-encounters-and-arenas.md        # 宽线性漏斗、竞技场几何、高低差与猫鼠潜行回路
    ├── invisible-guidance-and-breadcrumbs.md  # Valve 光影音轨、视线引导线与去文字化防迷路
    ├── swiss-cheese-and-non-linear-topology.md # Arkane 奶酪穿孔、多维度渗透与魂系单向捷径
    ├── metroidvania-and-2d-platforming.md     # 2D 网格图块度量、能力锁矩阵、视口边缘与智能回溯
    ├── environmental-puzzles-and-gizmos.md    # 空间解谜因果链、四大机关原型、4步教学与防死锁协议
    ├── pvp-and-coop-multiplayer-topology.md   # PvP 三路与中路控制、TTE对称性、转角优势与 Co-op 协同
    └── templates-and-diagnostic-rubrics.md    # 一页纸 LDD、白模尺寸表、竞技场编排表与 6 维体检
```

---

## 🛠️ 配套命令行工具与代码生成

```bash
# 1. 查询 3A FPS、魂系 ARPG 或 2D 恶魔城度量衡预设
python scripts/level_metrics_and_pacing.py --preset fps_3a
python scripts/level_metrics_and_pacing.py --preset metroidvania_2d
python scripts/level_metrics_and_pacing.py --preset souls_arpg

# 2. 解算跳跃抛物线与关卡平台间距 (支持任天堂手感参数对接)
python scripts/level_metrics_and_pacing.py --jump_arc --jump_velocity 12 --gravity_up 35 --gravity_down 60 --speed 8

# 3. 诊断遭遇战锯齿心流波形与疲劳预警
python scripts/level_metrics_and_pacing.py --pacing_curve "25,60,85,20,65,95,30"

# 4. 导出 Unity C# 关卡白模 Gizmos 辅助类或标准契约 YAML Payload
python scripts/level_metrics_and_pacing.py --export_code unity
python scripts/level_metrics_and_pacing.py --export_yaml
```

---

## ⚡ 安装方式

通过你的 AI Agent 直接安装本 Skill：

### 方式 1：AI 提示词安装（推荐）

在与 AI 对话时发送以下指令：

```text
请帮我从 https://github.com/Wilson520403/game-design-skills.git 安装 level-design-craft 技能到我的全局 skills 目录。
```

### 方式 2：命令行一键安装

```bash
git clone https://github.com/Wilson520403/game-design-skills.git temp-skills
mkdir -p ~/.config/skills
cp -r temp-skills/level-design-craft ~/.config/skills/
rm -rf temp-skills
```

---

## 🎯 实战使用示例

安装完成后，在与 AI 交流时直接自然语言触发：

- **宏观空间白模规划**: *“我想设计一个沉没水下神庙关卡。请用枢纽放射（Hub & Spoke）拓扑结构，规划 3 级引力地标与跳跃/攀爬度量标准，并融入‘开阔地与庇护所’的情绪起伏。”*
- **2D 恶魔城能力锁规划**: *“为一款 2D 横版动作游戏设计水晶矿坑区域，使用 16px 网格度量，布置二段跳与滑铲两处能力锁，并加入单向跌落滑轨消除回溯疲劳。”*
- **微观遭遇战竞技场排布**: *“帮我设计一个废弃火车站的潜行遭遇战，使用顽皮狗宽线性竞技场结构，设置制高点、侧翼迂回路线以及暴露后脱战重置潜行的闭环动线。”*
- **关卡体检与防迷路重构**: *“测试玩家在第四区频繁迷路、找不准 Boss 房入口。请用 Valve 引路光源法则和 Arkane‘可见不可达’理论帮我进行防迷路外科手术式排查并输出改造方案。”*
- **环境机关解谜因果链**: *“设计一个利用激光反射和导电水渠的水神庙空间谜题，按照 4 步无文字隐性教学排布，并加入防卡死死锁（Anti-Softlock）机制。”*
- **PvP 竞技地图平衡**: *“设计一张爆破模式 5v5 竞技场，采用经典 Three-Lane 结构，测算双方抵达 A/B 包点的 TTE 对称性与中路争夺视线角。”*

---

## 📜 核心理论参考与致敬

- **Christopher W. Totten**，《建筑学关卡设计方法》（*An Architectural Approach to Level Design*）。
- **Rudolf Kremers**，《关卡设计概念与实践》（*Level Design: Concept, Theory, and Practice*）。
- **Valve Corporation**，关于光影引导、视线控制与半衰期/传送门关卡设计的开发者音轨与设计分享。
- **Ubisoft**，理性关卡设计方法论（Rational Level Design, RLD）与原子化挑战体系。
- **Naughty Dog**，宽线性关卡心流（Wide-Linear Flow）与遭遇战竞技场动态节奏（《神秘海域》《最后生还者》）。
- **Arkane Studios & FromSoftware**，沉浸式模拟奶酪穿孔结构与魂系单向回环捷径拓扑（《耻辱》《暗黑之魂》《艾尔登法环》）。
- **Nintendo**，箱庭探索三角法则与《塞尔达传说》《超级马力欧》环境解谜与隐性教学法。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证开源。
