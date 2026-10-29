# 全景协同总线协议与数据契约规范 (Master Orchestration Protocol) 🌐

> **来源与适用范围**：本页是书籍方法论、公开行业实践与仓库自定义启发式规则的二次整理；具体阈值必须结合品类、引擎和玩家测试校准。详见 [来源与校准规范](../../SOURCE_PROVENANCE.md)。


本协议定义了 **Game Design Master Orchestrator** 驱动 4 大专业引擎进行全流程协作时的状态转换机、流转规范与标准数据载荷（Data Payloads）。

---

## 1. 状态机生命周期 (State Machine Lifecycle)

```mermaid
stateDiagram-v2
    [*] --> Idle: 等待用户输入
    
    Idle --> RouteDetermination: 接收设计诉求 / 概念 / 病灶
    
    RouteDetermination --> PipelineMode: 0 到 1 新游戏孵化
    RouteDetermination --> TriageMode: 疑难杂症专项排查
    RouteDetermination --> SwarmMode: 多 Agent 并行推演

    state PipelineMode {
        Stage1_GDW: 阶段 1: 梦工厂 (体验目标 & 8大形式元素)
        Stage2_NIN: 阶段 2: 任天堂 (核心动词 & 跳跃手感)
        Stage3_LDC: 阶段 3: 关卡工坊 (RLD度量 & 锯齿心流)
        Stage4_AGD: 阶段 4: 透镜之书 (四元组平衡 & 113透镜)
        
        Stage1_GDW --> Stage2_NIN: Contract 1 (ConceptAndFormalElements)
        Stage2_NIN --> Stage3_LDC: Contract 2 (ToyAndKinematics)
        Stage3_LDC --> Stage4_AGD: Contract 3 (SpatialTopologyAndEncounters)
    }

    state TriageMode {
        Panel_Triage: 四大导师同场质询 (Fullerton / Miyamoto / Level Master / Schell)
        Surgical_List: 生成 Keep / Cut / Tune 外科手术清单
        Panel_Triage --> Surgical_List
    }

    state SwarmMode {
        Dispatch_Subagents: 派发 4 个特化子 Agent (Workshop, Nintendo, Level, Schell)
        Collect_Contracts: 收集并校验 4 大数据载荷
        Merge_And_Arbitrate: 冲突仲裁与 GDD 合成
        Dispatch_Subagents --> Collect_Contracts --> Merge_And_Arbitrate
    }

    PipelineMode --> GenerateMasterDeliverable: 输出全景 GDD
    TriageMode --> GenerateMasterDeliverable: 输出全景体检报告
    SwarmMode --> GenerateMasterDeliverable: 输出综合推演提案

    GenerateMasterDeliverable --> [*]: 交付用户
```

---

## 2. 阶段流转与版本化数据载荷契约 (Data Payload Contracts)

为了保持跨阶段与跨 Agent 协作中的字段结构，所有中间数据采用版本化 YAML 契约，并在消费前执行严格 Schema 校验：

### 契约 1：`ConceptAndFormalElements`（梦工厂 $\rightarrow$ 任天堂）
```yaml
payload_type: ConceptAndFormalElements
version: "1.0"
high_concept: "一句话核心概念与独特卖点"
player_experience_goals:
  - "主观核心体验（如：极致潜行心跳、触觉欢愉、宏大探索敬畏感）"
formal_elements:
  players: "单人 / 合作 / PvP"
  primary_objective: "通关地牢 / 击败 Boss / 收集撤离"
  core_rules: ["核心限制规则 1", "操作规则 2"]
  resources: ["生命值", "耐力", "代币"]
  conflict_sources: ["巡逻敌军", "动态环境机关"]
hypotheses_to_test:
  - "在纯空白场景中，钩爪摆荡机制是否具备足够的物理快感？"
```

### 契约 2：`ToyAndKinematics`（任天堂 $\rightarrow$ 关卡工坊）
```yaml
payload_type: ToyAndKinematics
version: "1.1"
toy_verb: "磁力钩爪 (Magnetic Hook)"
multi_solution_matrix:
  movement: "拉拽边缘攀爬与空中摆荡"
  combat: "缴械敌人盾牌与拉拽硬直"
  puzzle: "远距离触发机关与吸附导电磁石"
kinematics_parameters:
  horizontal:
    max_speed_mps: 8.0
    acceleration_mps2: 53.3333
    skid_deceleration_mps2: 66.6667
    skid_distance_m: 0.48
    air_control_factor: 0.65
  vertical:
    jump_height_m: 3.5
    time_to_apex_s: 0.38
    fall_multiplier: 1.8
    jump_velocity_mps: 18.4211
    gravity_up_mps2: 48.4765
    gravity_down_mps2: 87.2576
    total_air_time_s: 0.6632
  grace_and_juice:
    coyote_time_ms: 83.3
    input_buffer_ms: 116.6
    hitstop_light_frames: 3
    hitstop_heavy_frames: 8
    screen_shake_frames: 4
```

生产端统一输出 v1.1；消费端同时兼容旧版 v1.0 平铺结构，便于迁移。

### 契约 3：`SpatialTopologyAndEncounters`（关卡工坊 $\rightarrow$ 透镜之书）
```yaml
payload_type: SpatialTopologyAndEncounters
version: "1.1"
topology_type: "宽线性 Hub 结构 + 魂系单向回环捷径"
metrics_standards:
  player_height: 1.8
  high_cover: 2.07
  low_cover: 0.99
  doorway_width: 1.30
  jump_kinematics:
    max_jump_height: 3.5
    safe_span_m: 4.24
    max_span_m: 5.30
    sprint_span_m: 6.89
encounter_arenas:
  - arena_id: "废弃地铁终端 A 区"
    tension_score: 85
    flanking_routes: 3
    high_ground_perches: 2
    cooldown_valley_after: "15秒安全搜刮区 (张力降至 25)"
sawtooth_pacing_sequence: [25, 60, 85, 20, 65, 95, 30]
```

### 契约 4：`FullSystemAudit`（透镜之书 $\rightarrow$ Master 汇总）
```yaml
payload_type: FullSystemAudit
version: "1.1"
active_lenses: ["#35 意义选择", "#31 心流", "#43 间接控制", "#37 隐性容错"]
elemental_tetrad_balance:
  mechanics: "能动性充沛，无支配性最优解"
  story: "玩法与世界观高度统一（玩法叙事协同）"
  aesthetics: "主导光源精准锚定，清除冗余视觉噪点"
  technology: "锁定 60fps 物理帧预算"
surgical_fixes:
  keep: ["磁力钩爪的高速惯性保留"]
  cut: ["砍掉第二关强制弹出的操作说明书"]
  tune: ["土狼时间增加 2 帧；在遭遇战 A 后强制插入 15 秒低压搜刮区"]
balance_rubric:
  average_score: 3.83
  min_score: 2.0
  max_score: 4.0
  high_risk_count: 1
  dimensions:
    -
      index: 1
      name: "1. 技巧 vs 偶然 (Skill vs Chance)"
      score: 2.0
      is_risk: true
      advice: "平衡输入随机与操作空间，确保高风险决策具备合理容错。"
    -
      index: 2
      name: "2. 脑力 vs 体力 (Head vs Hands)"
      score: 4.0
      is_risk: false
      advice: "明确目标受众画像，避免在深度策略中突然插入苛刻的毫秒级 QTE。"
    -
      index: 3
      name: "3. 竞争 vs 合作 (Competition vs Coop)"
      score: 4.0
      is_risk: false
      advice: "防止赢家过早滚雪球无解；合作模式需设计互补分工，杜绝无脑搭便车。"
    -
      index: 4
      name: "4. 简短 vs 漫长 (Short vs Long)"
      score: 4.0
      is_risk: false
      advice: "单局时长需契合受众碎片化习惯；长流程中增加高密度阶段存档与休息区。"
    -
      index: 5
      name: "5. 奖励 vs 惩罚 (Rewards vs Punishments)"
      score: 4.0
      is_risk: false
      advice: "惩罚必须具备教育意义（明白为何死）；杜绝谋杀玩家不可逆的时间。"
    -
      index: 6
      name: "6. 自由 vs 控制 (Freedom vs Control)"
      score: 4.0
      is_risk: false
      advice: "构建'有边界的游乐场'，宏观目标明确，但在解题战术与探索上充分放权。"
    -
      index: 7
      name: "7. 简单 vs 复杂 (Simple vs Complex)"
      score: 4.0
      is_risk: false
      advice: "坚守'易于上手，难于精通'，追求涌现复杂性，剪除臃肿冗杂规则。"
    -
      index: 8
      name: "8. 短期 vs 长期目标 (Short vs Long Goals)"
      score: 4.0
      is_risk: false
      advice: "搭建秒级/分级/小时级/终局级四层嵌套目标网，让玩家时刻有驱动力。"
    -
      index: 9
      name: "9. 有意义的选择 (Meaningful Choices)"
      score: 4.0
      is_risk: false
      advice: "破除单一统治级最优解 (Dominant Strategy)，引入情境克制与非对称代价。"
    -
      index: 10
      name: "10. 动态难度 DDA (Dynamic Difficulty)"
      score: 4.0
      is_risk: false
      advice: "平滑难度阶梯；后台动态补偿绝不可被玩家察觉，捍卫战胜成就感。"
    -
      index: 11
      name: "11. 经济水龙头/沉没口 (Sources vs Sinks)"
      score: 4.0
      is_risk: false
      advice: "严控通胀率（1.05~1.15倍产销比），杜绝资源断流死锁与金币泛滥。"
    -
      index: 12
      name: "12. 细节 vs 想象留白 (Detail vs Imagination)"
      score: 4.0
      is_risk: false
      advice: "精准展示 10% 核心细节，将 90% 脑补空间留给玩家，提升艺术余韵。"
```

---

## 3. 冲突仲裁原则 (Conflict Arbitration Rules)

当跨技能/跨导师之间出现设计偏好冲突时，遵循以下仲裁优先级：

1. **核心体验目标优先**：若增加复杂机制破坏了梦工厂确立的核心体验目标，坚决裁撤该机制。
2. **直觉操作优先于文字说明**：若关卡设计导致玩家必须阅读弹窗说明才能通关，必须打回关卡与手感层重构空间 Affordance 与隐性引导。
3. **心流张力与生理极限红线**：若关卡遭遇战连续 3 波张力 $\ge 70$，无条件插入 15~30 秒低压呼吸区。
4. **意义选择底线**：若数值或手感出现单一无脑最优解，强制引入【#35 意义选择透镜】修正风险与回报曲线。
