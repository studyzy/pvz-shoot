# 任天堂设计法 Skill (Nintendo Game Design Philosophy) 🍄

> 封装宫本茂、横井军平、岩田聪、樱井政博、藤林秀麿、林田宏一等任天堂顶级制作人核心哲学的 AI Agent 游戏设计导师。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI Agent Skill](https://img.shields.io/badge/AI-Agent%20Skill-blueviolet.svg)](https://github.com/Wilson520403/nintendo-game-design-skill)

[English](README.md) | 简体中文

---

## 📖 简介

任天堂之所以能数十年持续产出《超级马力欧》《塞尔达传说》《宝可梦》《任天堂明星大乱斗》《斯普拉遁》《星之卡比》等划时代神作，核心在于一套独步业界的底层设计哲学与工程美学。

本 Skill 将任天堂沉淀四十年的“秘传配方”工程化、结构化，让 AI Agent 成为你的资深任天堂式关卡设计师、手感调校师与玩法架构师，支持：

1. **核心动词与白盒玩具共创 (Toy-First)**：从单一物理动词出发，打造即使在空白场景也极具快感的“好玩玩具”，践行“枯竭技术的水平思考”、“一个点子解决多个问题”与《王国之泪》创成式拼接边界控制。
2. **“起承转合” 4 步关卡设计与《惊奇》范式 (Kishōtenketsu & Wonder Effect)**：介绍机制（起）→ 安全进阶（承）→ 颠覆变招与现实扭曲（转）→ 终极考验（合），配合呼吸区、樱井政博“风险与回报”动态难度与沙发同乐无感辅助模式。
3. **“三角法则”与箱庭空间构建 (Triangle Rule & Hakoniwa)**：利用地形遮挡制造视线阻隔与好奇心循环，搭建大/中/小三级引力地标体系与塞尔达地牢拓扑结构。
4. **Game Feel 手感、Juice 微反馈与 3D 隐形吸附**：土狼时间（Coyote Time）、输入缓冲、非对称重力跳跃、水平急刹滑行、樱井政博打击顿挫（Hitstop）、双标判定盒与《星之卡比》3D 视线投射隐形命中修正。
5. **去文字化「隐性教学」(Invisible Tutorials)**：严守“Show, Don't Tell; Play, Don't Read”，通过几何构图、安全失败与环境线索实现零文字新手引导。

---

## 📂 仓库与知识库结构

```
nintendo-game-design/
├── SKILL.md                                 # Skill 核心入口：四大哲学基石、三模态实战工作流
├── README.md                                # 英文说明文档
├── README_CN.md                             # 中文说明文档 (简体中文)
├── LICENSE                                  # MIT 开源许可证
├── scripts/
│   └── game_feel_calculator.py             # CLI 工具：垂直/水平动力学反解、ASCII轨迹图、Unity/Godot/UE5代码与YAML契约生成
└── references/
    ├── ideation-and-philosophy.md          # 枯竭技术水平思考、一举多得复合解题、白盒玩具原则、《王国之泪》创成边界与按键工程学
    ├── kishotenketsu-level-design.md       # 林田宏一起承转合 4 步法、风险回报、马力欧惊奇颠覆效应与沙发同乐辅助
    ├── triangle-rule-and-exploration.md    # 藤林秀麿三角法则、大中小引力地标、箱庭微缩庭院与地牢拓扑
    ├── game-feel-and-juice.md              # 马力欧重力、水平急刹、土狼时间、打击感 6 要素与卡比 3D 视角隐形吸附
    ├── invisible-tutorials.md              # 隐性教学三大铁律、马力欧 1-1 逐格拆解、视线吸引子与去文字化排查
    └── templates-and-rubrics.md            # 5 套实战模板（玩具提案卡、起承转合关卡表、三角布局卡、任式体检表、手感工程配置表）
```

---

## ⚡ 安装方式

通过你的 AI Agent 直接安装本 Skill：

### 方式 1：AI 提示词安装（推荐）

在与 AI 对话时发送以下指令：

```text
请帮我从 https://github.com/Wilson520403/nintendo-game-design-skill.git 克隆并安装 Nintendo Game Design skill 到我的全局 skills 目录。
```

### 方式 2：命令行克隆

```bash
git clone https://github.com/Wilson520403/nintendo-game-design-skill.git ~/.config/skills/nintendo-game-design
```

---

## 🎯 使用示例

安装完成后，在与 AI 交流时直接自然语言触发：

- **白盒玩具与复合机制构思**: *“我想用‘吸附与拉扯’作为核心动词，请用横井军平‘水平思考’和宫本茂‘一举多得’法则，帮我设计一个同时解决移动、战斗与解谜的核心机制。”*
- **起承转合与惊奇关卡设计**: *“帮我设计一个以‘重力反转’为主题的平台跳跃关卡，使用林田宏一‘起-承-转-合’4 步法规划挑战，并在‘转’阶段引入马力欧惊奇式的规则扭曲。”*
- **手感与跨引擎动力学调校**: *“我们的动作游戏手感很飘、打击反馈很轻，请按照马力欧物理参数和卡比 3D 视角吸附法则，输出 Unreal Engine 5 CMC 代码与手感配置参数卡。”*
- **隐性教学改造**: *“我们现有的新手引导有太多长篇弹窗，请帮我改造为马力欧 1-1 式的‘隐性教学’方案，让玩家在完全无文字的情况下学会复合跳跃。”*

---

## 📜 核心参考书目与大师演讲

- 宫本茂 (Shigeru Miyamoto)、横井军平 (Gunpei Yokoi)、岩田聪 (Satoru Iwata) — *Nintendo Philosophy & Interviews*.
- 樱井政博 (Masahiro Sakurai) — *Masahiro Sakurai on Creating Games*.
- 藤林秀麿 (Hidemaro Fujibayashi)、林田宏一 (Koichi Hayashida)、平竹晋也 (Shinya Hiratake) — *GDC Lectures on The Legend of Zelda, Super Mario 3D Land, and Kirby and the Forgotten Land*.

---

## 📄 License

本项目采用 [MIT License](LICENSE) 授权开源。
