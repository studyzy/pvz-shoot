#!/usr/bin/env python3
"""
The Art of Game Design: 113 Lenses Picker & Diagnostic CLI Tool
基于 Jesse Schell《游戏设计的艺术：透镜之书》113 全景透镜的标准数据库、智能检索、靶向推荐与导出工具。

Usage:
    python lens_picker.py --random 3
    python lens_picker.py --tag combat
    python lens_picker.py --tag pacing --export-md
    python lens_picker.py --id 1 8 31 --export-yaml
    python lens_picker.py --query "好奇心"
    python lens_picker.py --category "挑战与心流"
"""

import argparse
import json
import os
import random
import re
import sys
from typing import List, Dict, Any, Optional

# 确保在 Windows 控制台下正确输出 UTF-8
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        getattr(sys.stdout, "reconfigure")(encoding="utf-8")
        getattr(sys.stderr, "reconfigure")(encoding="utf-8")
    except Exception:
        pass


from .contracts import (
    PayloadError,
    dump_json,
    dump_yaml,
    parse_and_validate_payload,
)


# 113 全景透镜完整数据库 (严格 1 ~ 113 连续无遗漏)
_LENSES_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "lenses-data.json")
try:
    with open(_LENSES_DATA_PATH, "r", encoding="utf-8") as handle:
        LENSES_DB: List[Dict[str, Any]] = json.load(handle)
except (OSError, ValueError, TypeError) as exc:
    raise RuntimeError("Unable to load lens catalog: {0}".format(_LENSES_DATA_PATH)) from exc

if len(LENSES_DB) != 113 or [item.get("id") for item in LENSES_DB] != list(range(1, 114)):
    raise RuntimeError("Lens catalog must contain exactly the continuous ids 1 through 113")

# 标签映射字典，便于别名查找
TAG_ALIASES: Dict[str, List[str]] = {
    "combat": ["combat", "verbs", "game-feel", "mastery", "skill"],
    "pacing": ["pacing", "tension", "flow", "progression"],
    "economy": ["economy", "sources-sinks", "reward", "trade", "circulation"],
    "puzzle": ["puzzle", "aha-moment", "exploration", "clarity"],
    "level": ["level", "space", "topology", "guidance", "framing"],
    "ui": ["ui", "ux", "diegetic", "accessibility", "visual"],
    "story": ["story", "narrative", "theme", "character", "world", "lore"],
    "social": ["social", "pvp", "coop", "multiplayer", "community", "teamwork"],
    "onboarding": ["onboarding", "invisible-tutorial", "cognitive-load", "clarity"],
    "balance": ["balance", "rules", "risk-reward", "feedback", "system"],
    "juice": ["juice", "game-feel", "hitstop", "vibration", "haptics"],
    "core": ["core", "experience", "theme", "pitch", "soul", "vision"],
    "business": ["business", "monetization", "pitch", "value", "profit"]
}

# 10 组经典场景透镜特战小队预设 (Synergy Bundles)
SYNERGY_BUNDLES: Dict[str, Dict[str, Any]] = {
    "combat_slump": {
        "name_cn": "战斗枯燥与手感迟滞特战队",
        "description": "针对动作单调、打击感欠缺、博弈乏味、操作延迟或反馈不足",
        "lens_ids": [35, 26, 44, 38, 47],
        "aliases": ["combat", "action", "battle", "combat_slump"]
    },
    "onboarding_drop": {
        "name_cn": "开局流失与上手断崖特战队",
        "description": "针对新手劝退、说明书繁重、初始目标迷茫、认知负荷过载",
        "lens_ids": [1, 36, 31, 39, 15],
        "aliases": ["onboarding", "tutorial", "beginner", "onboarding_drop"]
    },
    "dominant_strategy": {
        "name_cn": "套路单一与支配策略泛滥特战队",
        "description": "针对玩家无脑复读单一最优解、流派同质化、缺少策略抉择",
        "lens_ids": [32, 33, 28, 88],
        "aliases": ["strategy", "dominant", "exploit", "meta", "dominant_strategy"]
    },
    "endgame_burnout": {
        "name_cn": "长线枯竭与终局目标丧失特战队",
        "description": "针对后期刷刷刷疲倦、长线追求断层、虚拟资产贬值",
        "lens_ids": [5, 96, 97, 99, 100],
        "aliases": ["retention", "endgame", "burnout", "longterm", "endgame_burnout"]
    },
    "puzzle_obscure": {
        "name_cn": "解谜晦涩与挫败卡关特战队",
        "description": "针对谜题无从下手、机械试错、缺少顿悟、提示粗暴",
        "lens_ids": [4, 42, 41, 43],
        "aliases": ["puzzle", "riddle", "obscure", "puzzle_obscure"]
    },
    "social_cold": {
        "name_cn": "社交死气与组队缺乏动力特战队",
        "description": "针对多人合作缺乏粘性、玩家零交流、搭便车现象严重",
        "lens_ids": [51, 52, 55, 59, 61],
        "aliases": ["social", "multiplayer", "coop", "guild", "social_cold"]
    },
    "pacing_flat": {
        "name_cn": "关卡冗长平淡与疲劳轰炸特战队",
        "description": "针对心流单调无起伏、高潮平淡、长跑图垃圾时间过多",
        "lens_ids": [38, 31, 2, 27],
        "aliases": ["pacing", "fatigue", "rhythm", "sawtooth", "pacing_flat"]
    },
    "immersion_break": {
        "name_cn": "世界观出戏与玩法叙事割裂特战队",
        "description": "针对机制与故事冲突 (Ludonarrative Dissonance)、UI 破坏沉浸",
        "lens_ids": [7, 8, 9, 70, 76],
        "aliases": ["immersion", "narrative", "story_clash", "dissonance", "immersion_break"]
    },
    "liveops_churn": {
        "name_cn": "长线运营流失与经济崩盘特战队",
        "description": "针对数值恶性通胀、付费抽卡反感、活动枯燥、资源断流",
        "lens_ids": [88, 97, 98, 103, 105],
        "aliases": ["liveops", "economy", "f2p", "monetization", "churn", "liveops_churn"]
    },
    "difficulty_spike": {
        "name_cn": "难度骤增与挫败失控特战队",
        "description": "针对关卡难度陡峭、容错率过低、新手被连续劝退",
        "lens_ids": [26, 31, 37, 40],
        "aliases": ["difficulty", "spike", "hardcore", "balance_fail", "difficulty_spike"]
    }
}

# 核心透镜协同关联图谱 (Synergy Graph: Top Companion Lenses)
SYNERGY_GRAPH: Dict[int, List[int]] = {
    1: [6, 8, 9, 10],       # 基础体验 -> 终极问题、统一主题、全息设计、倾听
    2: [3, 4, 38, 77],      # 惊喜 -> 乐趣、好奇心、节奏、愉悦
    3: [1, 2, 31, 35],      # 乐趣 -> 基础体验、惊喜、心流、技巧
    4: [41, 42, 43, 63],    # 好奇心 -> 渐进展示、谜题、间接控制、世界构建
    5: [86, 88, 96, 99],    # 内在价值 -> 状态机、水龙头/沉没口、动机、沉没投入
    6: [1, 8, 105, 113],    # 终极问题 -> 基础体验、统一主题、商业可行性、魔法单词
    7: [8, 9, 70, 76],      # 四元组 -> 统一主题、全息设计、故事世界、氛围
    8: [1, 7, 9, 113],      # 统一主题 -> 基础体验、四元组、全息设计、魔法单词
    9: [7, 8, 113],         # 全息设计 -> 四元组、统一主题、魔法单词
    15: [36, 39, 44],       # 心智模型 -> 隐性教程、界面、角色控制
    21: [43, 45, 63],       # 空间 -> 间接控制、环境指引、世界构建
    26: [31, 35, 37, 40],   # 挑战 -> 心流、技巧、隐性容错、动态难度 DDA
    28: [32, 35, 87],       # 偶然 -> 有意义的选择、技巧、概率
    31: [26, 35, 38, 40],   # 心流 -> 挑战、技巧、节奏、动态难度
    32: [28, 33, 35, 88],   # 有意义的选择 -> 偶然、三角法则、技巧、经济水龙头
    33: [32, 35, 89],       # 三角法则 -> 有意义的选择、技巧、对称性
    35: [26, 31, 44, 47],   # 技巧 -> 挑战、心流、角色控制、触觉反馈
    36: [1, 15, 39, 43],    # 隐性教程 -> 基础体验、心智模型、界面、间接控制
    37: [26, 31, 44],       # 隐性容错 -> 挑战、心流、角色控制
    38: [2, 27, 31, 78],    # 节奏 -> 惊喜、紧迫感、心流、重音与高潮
    39: [15, 36, 44, 48],   # 界面 -> 心智模型、隐性教程、角色控制、信息可见性
    40: [26, 31, 37],       # 动态难度 -> 挑战、心流、隐性容错
    42: [4, 41, 43],        # 谜题 -> 好奇心、渐进展示、间接控制
    43: [21, 36, 41, 76],   # 间接控制 -> 空间、隐性教程、渐进展示、氛围
    44: [35, 37, 39, 47],   # 角色控制 -> 技巧、隐性容错、界面、触觉反馈
    47: [35, 44, 76],       # 触觉反馈 -> 技巧、角色控制、氛围
    51: [52, 53, 55],       # 竞争 -> 合作、公平、团队
    52: [51, 55, 59],       # 合作 -> 竞争、团队、社区
    70: [7, 8, 71, 76],     # 故事世界 -> 四元组、统一主题、角色欲望、氛围
    88: [5, 32, 97, 105],   # 经济水龙头 -> 内在价值、有意义的选择、奖励时刻表、商业
    96: [5, 31, 97, 99],    # 动机 -> 内在价值、心流、奖励时刻表、沉没投入
    97: [5, 28, 88, 96],    # 奖励时刻表 -> 内在价值、偶然、经济水龙头、动机
    99: [5, 96, 97, 100],   # 沉没投入 -> 内在价值、动机、奖励时刻表、终极目标
    105: [5, 6, 88, 106],   # 商业可行性 -> 内在价值、终极问题、经济水龙头、受众画像
    113: [1, 8, 9, 100]     # 魔法单词 -> 基础体验、统一主题、全息设计、终极目标
}

# 12 维平衡维度官方定义与调优建议
BALANCE_DIMENSIONS: List[Dict[str, str]] = [
    {"name": "1. 技巧 vs 偶然 (Skill vs Chance)", "advice": "平衡输入随机与操作空间，确保高风险决策具备合理容错。"},
    {"name": "2. 脑力 vs 体力 (Head vs Hands)", "advice": "明确目标受众画像，避免在深度策略中突然插入苛刻的毫秒级 QTE。"},
    {"name": "3. 竞争 vs 合作 (Competition vs Coop)", "advice": "防止赢家过早滚雪球无解；合作模式需设计互补分工，杜绝无脑搭便车。"},
    {"name": "4. 简短 vs 漫长 (Short vs Long)", "advice": "单局时长需契合受众碎片化习惯；长流程中增加高密度阶段存档与休息区。"},
    {"name": "5. 奖励 vs 惩罚 (Rewards vs Punishments)", "advice": "惩罚必须具备教育意义（明白为何死）；杜绝谋杀玩家不可逆的时间。"},
    {"name": "6. 自由 vs 控制 (Freedom vs Control)", "advice": "构建'有边界的游乐场'，宏观目标明确，但在解题战术与探索上充分放权。"},
    {"name": "7. 简单 vs 复杂 (Simple vs Complex)", "advice": "坚守'易于上手，难于精通'，追求涌现复杂性，剪除臃肿冗杂规则。"},
    {"name": "8. 短期 vs 长期目标 (Short vs Long Goals)", "advice": "搭建秒级/分级/小时级/终局级四层嵌套目标网，让玩家时刻有驱动力。"},
    {"name": "9. 有意义的选择 (Meaningful Choices)", "advice": "破除单一统治级最优解 (Dominant Strategy)，引入情境克制与非对称代价。"},
    {"name": "10. 动态难度 DDA (Dynamic Difficulty)", "advice": "平滑难度阶梯；后台动态补偿绝不可被玩家察觉，捍卫战胜成就感。"},
    {"name": "11. 经济水龙头/沉没口 (Sources vs Sinks)", "advice": "严控通胀率（1.05~1.15倍产销比），杜绝资源断流死锁与金币泛滥。"},
    {"name": "12. 细节 vs 想象留白 (Detail vs Imagination)", "advice": "精准展示 10% 核心细节，将 90% 脑补空间留给玩家，提升艺术余韵。"}
]


def find_bundle(bundle_query: str) -> Optional[Dict[str, Any]]:
    """根据名称或别名查找透镜特战小队"""
    q = bundle_query.strip().lower()
    for key, data in SYNERGY_BUNDLES.items():
        if q == key.lower() or q in [a.lower() for a in data.get("aliases", [])]:
            return data
    return None


def find_related_lenses(lens_id: int) -> List[Dict[str, Any]]:
    """根据透镜 ID 查找其协同关联透镜"""
    related_ids = SYNERGY_GRAPH.get(lens_id, [])
    if not related_ids:
        # 如果未在核心图中定义，则默认选取同分类下的其他透镜
        target = next((lens for lens in LENSES_DB if lens["id"] == lens_id), None)
        if target:
            related_ids = [
                lens["id"] for lens in LENSES_DB
                if lens["category"] == target["category"] and lens["id"] != lens_id
            ][:3]
    return [lens for lens in LENSES_DB if lens["id"] in related_ids]


def find_lenses(
    tag: Optional[str] = None,
    query: Optional[str] = None,
    category: Optional[str] = None,
    ids: Optional[List[int]] = None,
    bundle: Optional[str] = None
) -> List[Dict[str, Any]]:
    """根据 ID、标签、关键词、分类或特战小队精准检索透镜"""
    if bundle:
        b_data = find_bundle(bundle)
        if b_data:
            return [lens for lens in LENSES_DB if lens["id"] in b_data["lens_ids"]]
        return []

    if ids:
        return [lens for lens in LENSES_DB if lens["id"] in ids]

    results = LENSES_DB

    if category:
        c_lower = category.lower()
        results = [lens for lens in results if c_lower in lens["category"].lower()]

    if tag:
        tag_lower = tag.lower()
        matched_tags = TAG_ALIASES.get(tag_lower, [tag_lower])
        results = [
            lens for lens in results
            if any(tag_name in lens["tags"] for tag_name in matched_tags)
        ]

    if query:
        q = query.lower()
        results = [
            lens for lens in results
            if q in lens["name_cn"].lower()
            or q in lens["name_en"].lower()
            or q in lens["category"].lower()
            or any(q in question.lower() for question in lens["questions"])
        ]

    return results


def evaluate_balance_rubric(scores: List[float]) -> Dict[str, Any]:
    """
    评估 12 维游戏平衡打分 (1~5分)，生成雷达分析图与高危失衡项诊断报告。
    """
    if len(scores) != 12:
        raise ValueError(f"必须精确提供 12 个维度的打分 (当前收到 {len(scores)} 个)")

    for s in scores:
        if not (1.0 <= s <= 5.0):
            raise ValueError(f"打分必须在 1.0 到 5.0 之间 (异常分值: {s})")

    avg_score = sum(scores) / 12.0
    min_score = min(scores)
    max_score = max(scores)

    high_risk_items: List[Dict[str, Any]] = []
    dimension_reports: List[Dict[str, Any]] = []

    for idx, s in enumerate(scores):
        dim_info = BALANCE_DIMENSIONS[idx]
        is_risk = (s <= 2.5)
        item: Dict[str, Any] = {
            "index": idx + 1,
            "name": dim_info["name"],
            "score": s,
            "is_risk": is_risk,
            "advice": dim_info["advice"]
        }
        dimension_reports.append(item)
        if is_risk:
            high_risk_items.append(item)

    # 渲染 ASCII 柱状图
    ascii_bars: List[str] = []
    ascii_bars.append("=" * 76)
    ascii_bars.append("📊 12 维游戏平衡雷达评估报告 (12-Dimension Balance Rubric Evaluation)")
    ascii_bars.append("=" * 76)
    ascii_bars.append(f"{'维度名称':<44} {'得分':<6} {'状态':<12} {'可视化'}")
    ascii_bars.append("-" * 76)

    for item in dimension_reports:
        score = float(item["score"])
        full_stars = int(round(score))
        empty_stars = 5 - full_stars
        star_str = "★" * full_stars + "☆" * empty_stars
        status = "🔴 严重失衡" if score <= 2.0 else ("🟡 存在隐患" if score <= 2.5 else "🟢 健康良好")
        ascii_bars.append(f"{item['name']:<44} {score:4.1f}  {status:<12} [{star_str}]")

    ascii_bars.append("-" * 76)
    ascii_bars.append(f"📈 综合平均健康度: {avg_score:.2f} / 5.0  (最高: {max_score:.1f}, 最低: {min_score:.1f})")
    ascii_bars.append(f"⚠️ 高危失衡项: {len(high_risk_items)} 项")
    
    if high_risk_items:
        ascii_bars.append("\n🚨 重点调优与外科手术建议:")
        for r in high_risk_items:
            ascii_bars.append(f"  • 【{r['name']}】(得分 {r['score']:.1f}): {r['advice']}")
    else:
        ascii_bars.append("\n🎉 系统整体处于高度平衡健康状态！请继续保持心流通道的动态张力。")
    ascii_bars.append("=" * 76)

    formatted_text = "\n".join(ascii_bars)

    return {
        "average_score": round(avg_score, 2),
        "min_score": min_score,
        "max_score": max_score,
        "high_risk_count": len(high_risk_items),
        "high_risk_items": high_risk_items,
        "dimension_reports": dimension_reports,
        "formatted_text": formatted_text
    }


def run_triage_wizard(interactive: bool = True) -> Optional[Dict[str, Any]]:
    """交互式诊断向导；非交互模式不产生终端副作用。"""
    if not interactive:
        return None
    print("=" * 70)
    print("🩺 《透镜之书》设计病灶快速问诊向导 (Interactive Triage Wizard)")
    print("=" * 70)
    print("请选择您当前遇到的最核心设计瓶颈类别：")
    
    bundle_keys = list(SYNERGY_BUNDLES.keys())
    for idx, k in enumerate(bundle_keys, 1):
        b = SYNERGY_BUNDLES[k]
        print(f"  [{idx:2d}] {b['name_cn']} ({k})")
        print(f"       ↳ {b['description']}")

    try:
        choice = input("\n👉 请输入序号 (1~10) 或按 Ctrl+C 退出: ").strip()
        if not choice:
            return None
        choice_idx = int(choice) - 1
        if 0 <= choice_idx < len(bundle_keys):
            selected_key = bundle_keys[choice_idx]
            return SYNERGY_BUNDLES[selected_key]
        else:
            print("❌ 无效的选项序号。")
            return None
    except (ValueError, KeyboardInterrupt, EOFError):
        print("\n已退出问诊向导。")
        return None


def format_markdown(lenses: List[Dict[str, Any]]) -> str:
    lines = [
        "# 🔍 透镜靶向问诊诊断卡 (Lens Diagnostic Card)",
        "",
        f"> 本次问诊共调阅 **{len(lenses)}** 副透镜，请针对以下问题逐项质询当前游戏机制：",
        ""
    ]
    for lens in lenses:
        related = SYNERGY_GRAPH.get(lens['id'], [])
        related_str = ", ".join([f"#{rid}" for rid in related]) if related else "无"
        lines.append(f"### 【#{lens['id']} {lens['name_cn']} ({lens['name_en']})】")
        lines.append(f"- **分类**: {lens['category']} | **标签**: `{', '.join(lens['tags'])}` | **协同关联透镜**: {related_str}")
        lines.append("- **核心审问提问**:")
        for idx, question in enumerate(lens['questions'], 1):
            lines.append(f"  {idx}. {question}")
        lines.append("- **当前设计病灶诊断**: *[在此处填写针对当前机制的穿透分析]*")
        lines.append("- **外科手术式改进建议**: *[在此处填写具体的规则/手感/关卡调整方案]*")
        lines.append("")
    return "\n".join(lines)


def format_yaml_payload(
    lenses: List[Dict[str, Any]],
    elemental_tetrad_balance: Optional[Dict[str, str]] = None,
    surgical_fixes: Optional[Dict[str, List[str]]] = None,
    balance_rubric: Optional[Dict[str, Any]] = None,
) -> str:
    """Export a safely quoted Contract 4 payload."""
    payload = {
        "payload_type": "FullSystemAudit",
        "version": "1.1" if balance_rubric is not None else "1.0",
        "active_lenses": ["#{0} {1}".format(lens["id"], lens["name_cn"]) for lens in lenses],
        "elemental_tetrad_balance": elemental_tetrad_balance or {
            "mechanics": "机制健康度与选择意义待验证",
            "story": "故事主题与玩法协同待验证",
            "aesthetics": "视听层次与沉浸反馈待验证",
            "technology": "帧率与操作性能预算待验证",
        },
        "surgical_fixes": surgical_fixes or {
            "keep": ["保留已验证的核心乐趣动作"],
            "cut": ["剪除未服务核心体验的认知负荷"],
            "tune": ["依据玩家测试精调参数与补偿规则"],
        },
    }
    if balance_rubric is not None:
        reports = balance_rubric.get("dimension_reports", balance_rubric.get("dimensions", []))
        payload["balance_rubric"] = {
            "average_score": balance_rubric["average_score"],
            "min_score": balance_rubric["min_score"],
            "max_score": balance_rubric["max_score"],
            "high_risk_count": balance_rubric["high_risk_count"],
            "dimensions": [
                {
                    "index": item["index"],
                    "name": item["name"],
                    "score": item["score"],
                    "is_risk": item["is_risk"],
                    "advice": item["advice"],
                }
                for item in reports
            ],
        }
    return dump_yaml(payload)


def _apply_payload_defaults(args: argparse.Namespace) -> None:
    if not args.from_payload:
        return
    loaded = parse_and_validate_payload(
        args.from_payload,
        {"ConceptAndFormalElements", "ToyAndKinematics", "SpatialTopologyAndEncounters", "FullSystemAudit"},
    )
    payload_type = loaded.get("payload_type")
    active_lenses = loaded.get("active_lenses")
    if isinstance(active_lenses, list):
        extracted_ids: List[int] = []
        for item in active_lenses:
            if isinstance(item, int):
                extracted_ids.append(item)
            elif isinstance(item, str):
                match = re.search(r"#?(\d+)", item)
                if match:
                    extracted_ids.append(int(match.group(1)))
        if extracted_ids:
            args.id = extracted_ids
    elif not args.id and not args.bundle:
        defaults_by_contract = {
            "SpatialTopologyAndEncounters": [21, 31, 38, 43],
            "ToyAndKinematics": [2, 26, 35, 37, 44],
            "ConceptAndFormalElements": [1, 3, 6, 8, 9],
        }
        args.id = defaults_by_contract.get(str(payload_type))
    if not (args.export_md or args.export_yaml or args.export_json):
        print("📥 成功载入上游契约载荷 [{0}]".format(payload_type or "Unknown"), file=sys.stderr)


def _render_lenses(selected: List[Dict[str, Any]], args: argparse.Namespace, detailed: bool = True) -> None:
    if not selected:
        raise ValueError("未找到匹配的透镜")
    if args.export_yaml:
        print(format_yaml_payload(selected))
    elif args.export_md:
        print(format_markdown(selected))
    elif args.export_json:
        print(dump_json({"lenses": selected}))
    elif detailed:
        for lens in selected:
            print("【#{0} {1} | {2}】".format(lens["id"], lens["name_cn"], lens["name_en"]))
            for question in lens["questions"]:
                print("  - " + question)
    else:
        for lens in selected:
            print("【#{0} {1}】: {2}".format(lens["id"], lens["name_cn"], lens["questions"][0]))


def _select_lenses(args: argparse.Namespace) -> List[Dict[str, Any]]:
    if args.bundle:
        bundle = find_bundle(args.bundle)
        if not bundle:
            raise ValueError("未找到特战小队 '{0}'".format(args.bundle))
        return [lens for lens in LENSES_DB if lens["id"] in bundle["lens_ids"]]
    if args.random is not None:
        if args.random < 1 or args.random > len(LENSES_DB):
            raise ValueError("随机抽取数量必须位于 1 到 {0} 之间".format(len(LENSES_DB)))
        return random.Random(args.seed).sample(LENSES_DB, args.random)
    if args.id:
        invalid_ids = sorted(set(args.id) - {lens["id"] for lens in LENSES_DB})
        if invalid_ids:
            raise ValueError("不存在的透镜编号: {0}".format(invalid_ids))
        return find_lenses(ids=args.id)
    if args.tag or args.query or args.category:
        return find_lenses(tag=args.tag, query=args.query, category=args.category)
    if args.list:
        return LENSES_DB
    return random.Random(args.seed).sample(LENSES_DB, 3)


def main() -> None:
    parser = argparse.ArgumentParser(description="The Art of Game Design: 113 Lenses Picker CLI")
    parser.add_argument("--random", "-r", type=int, help="随机抽取 N 个透镜")
    parser.add_argument("--seed", type=int, help="随机种子，用于复现抽取结果")
    parser.add_argument("--tag", "-t", type=str, help="按标签筛选")
    parser.add_argument("--query", "-q", type=str, help="按关键词检索")
    parser.add_argument("--category", "-c", type=str, help="按大类筛选")
    parser.add_argument("--id", nargs="+", type=int, help="按透镜编号查询")
    parser.add_argument("--bundle", "-b", type=str, help="调用预设透镜特战小队")
    parser.add_argument("--list-bundles", action="store_true", help="列出全部预设小队")
    parser.add_argument("--related", type=int, help="查询关联透镜")
    parser.add_argument("--rubric-eval", type=str, help="输入 12 维平衡打分")
    parser.add_argument("--triage", action="store_true", help="启动交互式病灶问诊")
    parser.add_argument("--list", "-l", action="store_true", help="列出全部 113 个透镜")
    parser.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload", help="从文件、字符串或 stdin ('-') 载入契约")
    parser.add_argument("--export-md", "--export_md", dest="export_md", action="store_true")
    parser.add_argument("--export-yaml", "--export_yaml", dest="export_yaml", action="store_true")
    parser.add_argument("--export-json", "--export_json", dest="export_json", action="store_true")
    args = parser.parse_args()

    try:
        _apply_payload_defaults(args)
        if args.list_bundles:
            if args.export_json:
                print(dump_json(SYNERGY_BUNDLES))
            else:
                for key, value in SYNERGY_BUNDLES.items():
                    print("{0}: {1} -> {2}".format(key, value["name_cn"], value["lens_ids"]))
            return
        if args.rubric_eval:
            scores = [float(value.strip()) for value in args.rubric_eval.replace("，", ",").split(",") if value.strip()]
            result = evaluate_balance_rubric(scores)
            print(dump_json(result) if args.export_json else result["formatted_text"])
            return
        if args.triage:
            bundle_result = run_triage_wizard(interactive=True)
            if bundle_result:
                _render_lenses([lens for lens in LENSES_DB if lens["id"] in bundle_result["lens_ids"]], args, detailed=False)
            return
        if args.related is not None:
            target = next((lens for lens in LENSES_DB if lens["id"] == args.related), None)
            if target is None:
                raise ValueError("未找到透镜 #{0}".format(args.related))
            related = find_related_lenses(args.related)
            if args.export_json:
                print(dump_json({"target": target, "related": related}))
            else:
                _render_lenses(related, args, detailed=False)
            return
        _render_lenses(_select_lenses(args), args)
    except (ValueError, PayloadError, KeyError, TypeError, ArithmeticError, OverflowError) as exc:
        print("❌ {0}".format(exc), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()

