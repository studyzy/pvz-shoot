#!/usr/bin/env python3
"""Unified CLI and contract-driven pipeline for the Game Design Skills Suite."""

from __future__ import annotations

import argparse
import random
import re
import sys
from typing import Any, Dict, List, Optional, cast

from . import __version__

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        getattr(sys.stdout, "reconfigure")(encoding="utf-8")
        getattr(sys.stderr, "reconfigure")(encoding="utf-8")
    except Exception:
        pass

from .contracts import (
    PAYLOAD_DESCRIPTIONS, PAYLOAD_ORDER, PayloadError, SUPPORTED_VERSIONS,
    dump_json, dump_yaml_documents, extract_economy_parameters, extract_kinematics,
    parse_and_validate_payload, parse_payload_data, parse_payload_documents, validate_payload as _validate_payload,
    validate_payload_documents,
)
from .lens_picker import (
    LENSES_DB, SYNERGY_BUNDLES, evaluate_balance_rubric, find_bundle, find_lenses,
    find_related_lenses, format_markdown as format_lens_markdown,
    format_yaml_payload as format_lens_yaml, run_triage_wizard,
)
from .game_feel_calculator import (
    calculate_tolerances, generate_godot_gdscript, generate_unity_csharp,
    generate_unreal_cpp, generate_yaml_payload as generate_feel_yaml,
    render_ascii_jump_trajectory, solve_horizontal_kinematics, solve_jump_kinematics,
)
from .prob_and_economy_sim import (
    generate_economy_yaml_payload, generate_pipeline_yaml_payload as generate_workshop_yaml, simulate_economy,
    simulate_multiplayer_economy, simulate_single_dice, simulate_versus_dice,
)
from .level_metrics_and_pacing import (
    PRESETS, analyze_pacing_curve, calculate_rld_metrics,
    generate_pipeline_yaml_payload as generate_level_yaml, generate_unity_csharp_gizmo,
    render_ascii_jump_arc, solve_jump_arc_metrics, solve_reaction_distance,
)

VALID_PAYLOAD_TYPES = {
    payload_type: {"versions": sorted(versions), "description": PAYLOAD_DESCRIPTIONS[payload_type]}
    for payload_type, versions in SUPPORTED_VERSIONS.items()
}

RUBRIC_LENS_MAP = {
    1: {31, 35}, 2: {4, 31}, 3: {21, 37}, 4: {10, 44},
    5: {32, 36}, 6: {27, 35}, 7: {43, 44}, 8: {8, 42},
    9: {47, 48}, 10: {46, 49}, 11: {50, 51}, 12: {52, 53},
}


def validate_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return _validate_payload(data)


def _validate_or_raise(payload: Dict[str, Any], stage_name: str) -> None:
    result = validate_payload(payload)
    if not result["valid"]:
        raise PayloadError("{0} generated an invalid payload: {1}".format(stage_name, result["error"]))


def _genre_profile(preset_name: str) -> Dict[str, str]:
    return {
        "fps_3a": {
            "players": "单人或合作行动小队",
            "topology": "Wide-Linear mission route with optional flank loops",
            "conflict": "敌方火力、视线暴露与有限掩体",
        },
        "souls_arpg": {
            "players": "单人探索与异步社群痕迹",
            "topology": "Interconnected hub with risk-reward loopback shortcuts",
            "conflict": "高压敌群、资源损失风险与未知捷径",
        },
        "metroidvania_2d": {
            "players": "单人能力成长探索",
            "topology": "Ability-gated interconnected regions with layered return paths",
            "conflict": "能力锁、平台精度与路线记忆挑战",
        },
        "tactical_cqb": {
            "players": "单人或合作战术小队",
            "topology": "Room-and-corridor CQB network with breach and flank choices",
            "conflict": "盲区、致命漏斗与不完整情报",
        },
    }[preset_name]


def _build_tetrad_summary(concept: str, verb: str, pacing: Dict[str, Any], preset_name: str) -> Dict[str, str]:
    pacing_state = "存在需修复的节奏风险" if not pacing["is_healthy"] else "当前规则集未发现显著节奏风险"
    return {
        "mechanics": "核心动词“{0}”已映射到移动、战斗和解谜三类用途。".format(verb),
        "story": "所有后续实现应持续服务《{0}》的核心体验，而非套用无关题材模板。".format(concept),
        "aesthetics": "视觉层级与反馈应突出核心动词的可供性、命中结果和路径选择。",
        "technology": "{0} 预设的尺度、动力学和性能预算需在目标引擎中实测；{1}。".format(preset_name, pacing_state),
    }


def run_full_pipeline(
    concept: str = "磁力钩爪废墟探险 (Magnetic Hook Ruins)",
    verb: str = "磁力钩爪 (Magnetic Hook)",
    preset_name: str = "souls_arpg",
    jump_height: float = 3.5,
    apex_time: float = 0.38,
    speed: float = 8.0,
    fall_multiplier: float = 1.8,
    air_control: float = 0.65,
    pacing_curve: Optional[List[int]] = None,
    rubric_scores: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """Run a four-stage pipeline in which every stage consumes prior contracts."""
    concept = str(concept).strip()
    verb = str(verb).strip()
    if not concept or not verb:
        raise ValueError("concept 和 verb 不能为空")
    if preset_name not in PRESETS:
        raise ValueError("未知预设: {0}".format(preset_name))
    if pacing_curve is None:
        pacing_curve = [25, 60, 85, 20, 65, 95, 30]
    if rubric_scores is None:
        rubric_scores = [4.0, 3.5, 4.5, 4.0, 3.0, 4.0, 4.5, 4.0, 3.0, 4.0, 3.5, 4.0]
    profile = _genre_profile(preset_name)

    workshop_yaml = generate_workshop_yaml(
        high_concept=concept,
        players=profile["players"],
        primary_obj="学习并精通“{0}”，克服《{1}》中的主要冲突并达成终局目标".format(verb, concept),
        rules=[
            "“{0}”只能作用于具有清晰视觉与交互反馈的合法目标".format(verb),
            "高收益使用方式必须承担资源、时机或空间位置上的可读风险",
        ],
        resources=["核心行动资源", "恢复或容错资源", "长期进度资源"],
        conflict_sources=[profile["conflict"], "迫使玩家在安全、速度与收益之间做选择的动态事件"],
        player_experience_goals=[
            "通过“{0}”获得清晰、可掌握且逐步深化的能动感".format(verb),
            "探索《{0}》时持续形成好奇、判断与反馈闭环".format(concept),
        ],
        hypotheses=[
            "在无美术白盒中，“{0}”是否仍能产生可重复的操作乐趣？".format(verb),
            "玩家能否在不阅读长篇说明的情况下识别合法目标、风险和结果？",
        ],
    )
    workshop_payload = parse_payload_data(workshop_yaml)
    _validate_or_raise(workshop_payload, "Stage 1")

    stage1_formal = workshop_payload["formal_elements"]
    stage1_goal = stage1_formal["primary_objective"]
    stage1_conflict = stage1_formal["conflict_sources"][0]
    stage1_resource = stage1_formal["resources"][0]
    vertical = solve_jump_kinematics(jump_height, apex_time, fall_multiplier)
    horizontal = solve_horizontal_kinematics(speed, 0.15, 0.12, air_control)
    tolerances = calculate_tolerances(60)
    solution_matrix = {
        "movement": "使用“{0}”改变移动路线与节奏，从而服务目标：{1}".format(verb, stage1_goal),
        "combat": "使用“{0}”应对“{1}”，并形成位置与时机上的风险回报选择。".format(verb, stage1_conflict),
        "puzzle": "使用“{0}”改变环境状态，同时围绕“{1}”形成可读的资源权衡。".format(verb, stage1_resource),
    }
    feel_yaml = generate_feel_yaml(vertical, horizontal, tolerances, verb, solution_matrix)
    feel_payload = parse_payload_data(feel_yaml)
    _validate_or_raise(feel_payload, "Stage 2")

    canonical = extract_kinematics(feel_payload)
    required_kinematics = ("jump_height", "time_to_apex", "speed", "fall_multiplier")
    missing_kinematics = [key for key in required_kinematics if canonical.get(key) is None]
    if missing_kinematics:
        raise PayloadError("Stage 2 payload is missing canonical kinematics: {0}".format(missing_kinematics))
    metrics = calculate_rld_metrics(1.8, preset_name)
    jump_arc = solve_jump_arc_metrics(
        jump_height=cast(float, canonical["jump_height"]),
        time_to_apex=cast(float, canonical["time_to_apex"]),
        speed=cast(float, canonical["speed"]),
        fall_multiplier=cast(float, canonical["fall_multiplier"]),
    )
    pacing = analyze_pacing_curve(pacing_curve)
    arena_id = re.sub(r"\s+", "_", concept).strip("_")[:48] or "Core_Encounter"
    level_yaml = generate_level_yaml(
        metrics, pacing, jump_arc, profile["topology"] + " for " + concept,
        encounter_arenas=[{
            "arena_id": arena_id + "_Alpha",
            "tension_score": pacing["peak_value"],
            "flanking_routes": 3 if preset_name != "metroidvania_2d" else 2,
            "high_ground_perches": 2,
            "cooldown_valley_after": "15~30s low-pressure recovery/exploration beat",
        }],
    )
    level_payload = parse_payload_data(level_yaml)
    _validate_or_raise(level_payload, "Stage 3")

    rubric = evaluate_balance_rubric(rubric_scores)
    lens_ids = {1, 8, 21, 31, 35, 43, 44}
    if pacing["warnings"]:
        lens_ids.add(38)
    if horizontal["air_control"] < 0.5 or vertical["fall_multiplier"] > 2.5:
        lens_ids.add(37)
    for risk in rubric["high_risk_items"]:
        lens_ids.update(RUBRIC_LENS_MAP.get(risk["index"], set()))
    selected_lenses = find_lenses(ids=sorted(lens_ids))
    rubric_tuning = ["【{0}】{1}".format(item["name"], item["advice"]) for item in rubric["high_risk_items"]]
    tune_items = list(pacing["warnings"] + pacing["recommendations"] + rubric_tuning) or ["通过玩家测试验证跳跃安全跨度、关卡节奏与平衡假设"]
    audit_yaml = format_lens_yaml(
        selected_lenses,
        elemental_tetrad_balance=_build_tetrad_summary(concept, verb, pacing, preset_name),
        surgical_fixes={
            "keep": ["保留通过白盒验证的核心动词“{0}”及其多用途映射".format(verb)],
            "cut": ["删除与《{0}》核心体验无关的题材硬编码、冗余规则和说明文本".format(concept)],
            "tune": tune_items,
        },
        balance_rubric=rubric,
    )
    audit_payload = parse_payload_data(audit_yaml)
    _validate_or_raise(audit_payload, "Stage 4")

    documents = [workshop_payload, feel_payload, level_payload, audit_payload]
    bundle_validation = validate_payload_documents(documents, require_pipeline_order=True)
    if not bundle_validation["valid"]:
        raise PayloadError(bundle_validation["error"])
    return {
        "concept": concept,
        "toy_verb": verb,
        "preset": preset_name,
        "stage1_workshop": {"payload": workshop_payload, "payload_yaml": workshop_yaml},
        "stage2_nintendo": {"input_contract": workshop_payload, "vertical": vertical, "horizontal": horizontal, "tolerances": tolerances, "payload": feel_payload, "payload_yaml": feel_yaml},
        "stage3_level": {"input_contract": feel_payload, "metrics": metrics, "jump_arc": jump_arc, "pacing": pacing, "payload": level_payload, "payload_yaml": level_yaml},
        "stage4_schell": {"input_contract": level_payload, "lenses": selected_lenses, "balance_rubric": rubric, "payload": audit_payload, "payload_yaml": audit_yaml},
        "bundle_validation": bundle_validation,
    }


def render_pipeline_markdown_report(data: Dict[str, Any]) -> str:
    stage1 = data["stage1_workshop"]
    stage2 = data["stage2_nintendo"]
    stage3 = data["stage3_level"]
    stage4 = data["stage4_schell"]
    lines = [
        "# 全景游戏设计工程报告: 《{0}》".format(data["concept"]), "",
        "- **核心动词**: {0}".format(data["toy_verb"]),
        "- **品类预设**: {0}".format(data["preset"]),
        "- **契约验证**: 通过", "",
        "## Contract 1 — ConceptAndFormalElements",
        "- 玩家结构：{0}".format(stage1["payload"]["formal_elements"]["players"]),
        "- 主目标：{0}".format(stage1["payload"]["formal_elements"]["primary_objective"]), "",
        "## Contract 2 — ToyAndKinematics",
        "- 跳跃高度：{0:.2f}m".format(stage2["vertical"]["height"]),
        "- 顶点时间：{0:.3f}s".format(stage2["vertical"]["apex_time"]),
        "- 奔跑速度：{0:.2f}m/s".format(stage2["horizontal"]["max_speed"]), "",
        "## Contract 3 — SpatialTopologyAndEncounters",
        "- 安全跳跃跨度：{0:.2f}m".format(stage3["jump_arc"]["span_safe"]),
        "- 极限跳跃跨度：{0:.2f}m".format(stage3["jump_arc"]["span_normal"]),
        "- 张力曲线：{0}".format(stage3["pacing"]["tensions"]),
        "- 节奏状态：{0}".format("健康" if stage3["pacing"]["is_healthy"] else "需要调优"), "",
        "## Contract 4 — FullSystemAudit",
        "- 激活透镜：{0}".format(", ".join("#{0} {1}".format(lens["id"], lens["name_cn"]) for lens in stage4["lenses"])),
        "- 12 维平均分：{0:.2f}/5".format(stage4["balance_rubric"]["average_score"]), "",
        "### Keep / Cut / Tune",
    ]
    fixes = stage4["payload"]["surgical_fixes"]
    for key in ("keep", "cut", "tune"):
        lines.append("- **{0}**: {1}".format(key.capitalize(), "；".join(fixes[key])))
    return "\n".join(lines)


def _parse_number_sequence(raw: str, label: str, expected_length: Optional[int] = None) -> List[float]:
    try:
        values = [float(value.strip()) for value in raw.replace("，", ",").split(",") if value.strip()]
    except ValueError as exc:
        raise ValueError("{0} 必须是逗号分隔的数值序列".format(label)) from exc
    if not values:
        raise ValueError("{0} 不能为空".format(label))
    if expected_length is not None and len(values) != expected_length:
        raise ValueError("{0} 必须包含 {1} 个数值".format(label, expected_length))
    return values


def _apply_feel_payload(args: argparse.Namespace, payload: Dict[str, Any]) -> None:
    extracted = extract_kinematics(payload)
    for source_key, destination in {"jump_height": "height", "time_to_apex": "apex_time", "fall_multiplier": "fall_multiplier", "speed": "speed", "air_control": "air_control"}.items():
        if extracted.get(source_key) is not None:
            setattr(args, destination, extracted[source_key])
    if payload.get("toy_verb"):
        args.toy_verb = str(payload["toy_verb"])
    elif payload.get("high_concept"):
        args.toy_verb = str(payload["high_concept"])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Game Design Skills Suite: Contract-Driven CLI")
    parser.add_argument("--version", action="version", version="%(prog)s {0}".format(__version__))
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    pipeline = subparsers.add_parser("pipeline", help="运行四阶段契约驱动流水线")
    pipeline.add_argument("--concept", default="磁力钩爪废墟探险")
    pipeline.add_argument("--verb", default="磁力钩爪")
    pipeline.add_argument("--preset", choices=list(PRESETS), default="souls_arpg")
    pipeline.add_argument("--height", type=float, default=3.5)
    pipeline.add_argument("--apex-time", "--apex_time", dest="apex_time", type=float, default=0.38)
    pipeline.add_argument("--speed", type=float, default=8.0)
    pipeline.add_argument("--fall-multiplier", "--fall_multiplier", dest="fall_multiplier", type=float, default=1.8)
    pipeline.add_argument("--air-control", "--air_control", dest="air_control", type=float, default=0.65)
    pipeline.add_argument("--pacing", default="25,60,85,20,65,95,30")
    pipeline.add_argument("--rubric", default="4,3.5,4.5,4,3,4,4.5,4,3,4,3.5,4")
    pipeline.add_argument("--export-md", "--export_md", action="store_true")
    pipeline.add_argument("--export-json", "--export_json", action="store_true")
    pipeline.add_argument("--export-yaml", "--export_yaml", action="store_true")

    validate = subparsers.add_parser("validate", help="严格校验单份契约或四文档 Bundle")
    validate.add_argument("file")
    validate.add_argument("--export-json", "--export_json", action="store_true")

    feel = subparsers.add_parser("feel", help="手感动力学计算与代码生成")
    feel.add_argument("--height", "-H", type=float, default=3.5)
    feel.add_argument("--apex-time", "--apex_time", "-T", dest="apex_time", type=float, default=0.38)
    feel.add_argument("--fall-multiplier", "--fall_multiplier", "-F", dest="fall_multiplier", type=float, default=1.8)
    feel.add_argument("--speed", "-S", type=float, default=8.0)
    feel.add_argument("--acc-time", "--acc_time", dest="acc_time", type=float, default=0.15)
    feel.add_argument("--skid-time", "--skid_time", dest="skid_time", type=float, default=0.12)
    feel.add_argument("--air-control", "--air_control", dest="air_control", type=float, default=0.65)
    feel.add_argument("--fps", type=int, default=60)
    feel.add_argument("--toy-verb", "--toy_verb", dest="toy_verb", default="Mario Standard Jump & Skid")
    feel.add_argument("--render-ascii", "--render_ascii", action="store_true")
    feel.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload")
    feel.add_argument("--export-code", "--export_code", choices=["unity", "godot", "unreal", "none"], default="none")
    feel.add_argument("--export-yaml", "--export_yaml", action="store_true")
    feel.add_argument("--export-json", "--export_json", action="store_true")

    metrics = subparsers.add_parser("metrics", help="关卡尺度、跳跃跨度与节奏分析")
    metrics.add_argument("--preset", choices=list(PRESETS))
    metrics.add_argument("--player-height", "--player_height", "-H", dest="player_height", type=float, default=1.8)
    metrics.add_argument("--pacing-curve", "--pacing_curve", "-P", dest="pacing_curve")
    metrics.add_argument("--jump-arc", "--jump_arc", dest="jump_arc", action="store_true")
    metrics.add_argument("--jump-velocity", "--jump_velocity", dest="jump_velocity", type=float, default=12.0)
    metrics.add_argument("--gravity-up", "--gravity_up", dest="gravity_up", type=float, default=35.0)
    metrics.add_argument("--gravity-down", "--gravity_down", dest="gravity_down", type=float)
    metrics.add_argument("--fall-multiplier", "--fall_multiplier", dest="fall_multiplier", type=float)
    metrics.add_argument("--speed", type=float, default=8.0)
    metrics.add_argument("--jump-height", "--jump_height", dest="jump_height", type=float)
    metrics.add_argument("--time-to-apex", "--time_to_apex", dest="time_to_apex", type=float)
    metrics.add_argument("--reaction-check", "--reaction_check", dest="reaction_check", action="store_true")
    metrics.add_argument("--reaction-time", "--reaction_time", dest="reaction_time", type=float, default=0.35)
    metrics.add_argument("--skid-deceleration", "--skid_deceleration", dest="skid_deceleration", type=float, default=15.0)
    metrics.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload")
    metrics.add_argument("--export-code", "--export_code", choices=["unity", "none"], default="none")
    metrics.add_argument("--export-yaml", "--export_yaml", action="store_true")
    metrics.add_argument("--export-json", "--export_json", action="store_true")

    economy = subparsers.add_parser("economy", help="掷骰概率与经济模拟")
    economy.add_argument("--dice", "-d")
    economy.add_argument("--trials", "-t", type=int, default=10000)
    economy.add_argument("--seed", type=int)
    economy.add_argument("--economy-sim", "--economy_sim", action="store_true")
    economy.add_argument("--economy-multiplayer", "--economy_multiplayer", action="store_true")
    economy.add_argument("--initial", type=float, default=100.0)
    economy.add_argument("--source", type=float, default=20.0)
    economy.add_argument("--growth", type=float, default=0.0)
    economy.add_argument("--sink", type=float, default=15.0)
    economy.add_argument("--dynamic-sink", "--dynamic_sink", type=float, default=0.0)
    economy.add_argument("--rounds", type=int, default=25)
    economy.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload")
    economy.add_argument("--export-yaml", "--export_yaml", action="store_true")
    economy.add_argument("--export-json", "--export_json", action="store_true")

    lens = subparsers.add_parser("lens", help="透镜检索、关联和契约导诊")
    lens.add_argument("--bundle", "-b")
    lens.add_argument("--tag", "-t")
    lens.add_argument("--query", "-q")
    lens.add_argument("--category", "-c")
    lens.add_argument("--id", nargs="+", type=int)
    lens.add_argument("--random", "-r", type=int)
    lens.add_argument("--seed", type=int)
    lens.add_argument("--related", type=int)
    lens.add_argument("--list", action="store_true")
    lens.add_argument("--list-bundles", "--list_bundles", action="store_true")
    lens.add_argument("--rubric-eval", "--rubric_eval")
    lens.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload")
    lens.add_argument("--export-md", "--export_md", action="store_true")
    lens.add_argument("--export-yaml", "--export_yaml", action="store_true")
    lens.add_argument("--export-json", "--export_json", action="store_true")

    subparsers.add_parser("triage", help="启动交互式病灶问诊")
    return parser


def _handle_pipeline(args: argparse.Namespace) -> None:
    pacing = [int(value) for value in _parse_number_sequence(args.pacing, "--pacing")]
    rubric = _parse_number_sequence(args.rubric, "--rubric", 12)
    data = run_full_pipeline(
        args.concept, args.verb, args.preset, args.height, args.apex_time, args.speed,
        args.fall_multiplier, args.air_control, pacing, rubric,
    )
    if args.export_json:
        print(dump_json(data))
    elif args.export_yaml:
        documents = [data["stage1_workshop"]["payload"], data["stage2_nintendo"]["payload"], data["stage3_level"]["payload"], data["stage4_schell"]["payload"]]
        print(dump_yaml_documents(documents, header=data["concept"] + " Pipeline Bundle"))
    else:
        print(render_pipeline_markdown_report(data))
    return


def _handle_validate(args: argparse.Namespace) -> None:
    documents = parse_payload_documents(args.file)
    result = validate_payload_documents(documents, require_pipeline_order=len(documents) > 1)
    if args.export_json:
        print(dump_json(result))
    elif result["valid"]:
        if len(documents) == 1:
            detail = result["documents"][0]
            print("✅ 契约校验通过：{0} v{1}".format(detail["payload_type"], detail["version"]))
        else:
            print("✅ 四阶段契约 Bundle 校验通过：{0}".format(" -> ".join(PAYLOAD_ORDER)))
    else:
        print("❌ 契约校验失败：{0}".format(result["error"]), file=sys.stderr)
        raise SystemExit(2)
    return


def _handle_triage(args: argparse.Namespace) -> None:
    run_triage_wizard(interactive=True)
    return


def _handle_feel(args: argparse.Namespace) -> None:
    if args.from_payload:
        _apply_feel_payload(
            args,
            parse_and_validate_payload(args.from_payload, {"ConceptAndFormalElements", "ToyAndKinematics"}),
        )
    vertical = solve_jump_kinematics(args.height, args.apex_time, args.fall_multiplier)
    horizontal = solve_horizontal_kinematics(args.speed, args.acc_time, args.skid_time, args.air_control)
    tolerances = calculate_tolerances(args.fps)
    if args.export_yaml:
        print(generate_feel_yaml(vertical, horizontal, tolerances, args.toy_verb))
    elif args.export_json:
        print(dump_json({"toy_verb": args.toy_verb, "vertical": vertical, "horizontal": horizontal, "tolerances": tolerances}))
    elif args.export_code == "unity":
        print(generate_unity_csharp(vertical, horizontal, tolerances))
    elif args.export_code == "godot":
        print(generate_godot_gdscript(vertical, horizontal, tolerances))
    elif args.export_code == "unreal":
        print(generate_unreal_cpp(vertical, horizontal, tolerances))
    else:
        print("🍄 起跳速度 {0:.2f}m/s | 上升重力 {1:.2f}m/s² | 下落重力 {2:.2f}m/s²".format(vertical["jump_velocity"], vertical["gravity_up"], vertical["gravity_down"]))
        if args.render_ascii:
            print(render_ascii_jump_trajectory(vertical, horizontal))
    return


def _handle_metrics(args: argparse.Namespace) -> None:
    if args.from_payload:
        payload = parse_and_validate_payload(args.from_payload, {"ToyAndKinematics", "SpatialTopologyAndEncounters"})
        extracted = extract_kinematics(payload)
        if extracted.get("jump_height") is not None:
            args.jump_height = extracted["jump_height"]
            args.jump_arc = True
        if extracted.get("time_to_apex") is not None:
            args.time_to_apex = extracted["time_to_apex"]
            args.jump_arc = True
        if extracted.get("speed") is not None:
            args.speed = extracted["speed"]
        if extracted.get("jump_velocity") is not None:
            args.jump_velocity = extracted["jump_velocity"]
        if extracted.get("gravity_up") is not None:
            args.gravity_up = extracted["gravity_up"]
        if extracted.get("gravity_down") is not None:
            args.gravity_down = extracted["gravity_down"]
        if extracted.get("fall_multiplier") is not None:
            args.fall_multiplier = extracted["fall_multiplier"]
        if extracted.get("skid_deceleration") is not None:
            args.skid_deceleration = extracted["skid_deceleration"]
        standards = payload.get("metrics_standards")
        if isinstance(standards, dict) and isinstance(standards.get("player_height"), (int, float)):
            args.player_height = float(standards["player_height"])
        if isinstance(payload.get("sawtooth_pacing_sequence"), list) and not args.pacing_curve:
            args.pacing_curve = ",".join(str(value) for value in payload["sawtooth_pacing_sequence"])
    metrics_data = calculate_rld_metrics(args.player_height, args.preset)
    arc = None
    if args.jump_arc or args.jump_height is not None or args.time_to_apex is not None:
        arc = solve_jump_arc_metrics(
            args.jump_velocity, args.gravity_up, args.gravity_down, args.speed,
            args.jump_height, args.time_to_apex, args.fall_multiplier,
        )
    pacing = analyze_pacing_curve(_parse_number_sequence(args.pacing_curve, "--pacing-curve")) if args.pacing_curve else None
    reaction = solve_reaction_distance(args.speed, args.reaction_time, args.skid_deceleration) if args.reaction_check else None
    if args.export_yaml:
        print(generate_level_yaml(metrics_data, pacing, arc))
    elif args.export_json:
        print(dump_json({"metrics": metrics_data, "jump_arc": arc, "pacing": pacing, "reaction": reaction}))
    elif args.export_code == "unity":
        print(generate_unity_csharp_gizmo(metrics_data, arc))
    else:
        print("📐 全身掩体 {0:.2f}m | 半身掩体 {1:.2f}m | 走廊 {2:.2f}m".format(metrics_data["high_cover"], metrics_data["low_cover"], metrics_data["combat_corridor_width"]))
        if arc:
            print(render_ascii_jump_arc(arc))
        if pacing:
            for warning in pacing["warnings"]:
                print(warning)
    return


def _handle_economy(args: argparse.Namespace) -> None:
    loaded_players: Optional[List[Dict[str, Any]]] = None
    if args.from_payload:
        payload = parse_and_validate_payload(args.from_payload, {"EconomySimulationConfig"})
        parameters = payload.get("parameters", {})
        for key, value in extract_economy_parameters(payload).items():
            setattr(args, key, int(value) if key in {"rounds", "trials", "seed"} else value)
        simulation_type = payload.get("simulation_type")
        if simulation_type == "economy":
            args.economy_sim = True
        elif simulation_type == "multiplayer_economy":
            args.economy_multiplayer = True
            loaded_players = payload.get("players")
        elif simulation_type == "dice":
            args.dice = parameters.get("expression")
        elif simulation_type == "versus_dice":
            args.dice = "{0} vs {1}".format(parameters.get("expression_a"), parameters.get("expression_b"))
    if args.export_yaml:
        if args.dice:
            versus = re.split(r"\s+vs\s+", args.dice.strip(), flags=re.IGNORECASE)
            simulation_type = "versus_dice" if len(versus) == 2 else "dice"
        elif args.economy_multiplayer:
            simulation_type = "multiplayer_economy"
        else:
            simulation_type = "economy"
        print(generate_economy_yaml_payload(
            simulation_type=simulation_type,
            initial=args.initial,
            source=args.source,
            growth=args.growth,
            sink=args.sink,
            dynamic_sink=args.dynamic_sink,
            rounds=args.rounds,
            dice_expression=args.dice,
            trials=args.trials,
            seed=args.seed,
            players=loaded_players,
        ))
        return
    if args.dice:
        versus = re.split(r"\s+vs\s+", args.dice.strip(), flags=re.IGNORECASE)
        if len(versus) == 2:
            result = simulate_versus_dice(versus[0], versus[1], args.trials, seed=args.seed)
        elif len(versus) == 1:
            result = simulate_single_dice(args.dice, args.trials, seed=args.seed)
        else:
            raise ValueError("对抗掷骰格式必须是 '<表达式> vs <表达式>'")
    elif args.economy_multiplayer:
        players = loaded_players or [
            {"name": "A", "initial": 120.0, "source": 25.0, "growth": 0.06, "sink": 15.0},
            {"name": "B", "initial": 100.0, "source": 20.0, "growth": 0.02, "sink": 15.0},
            {"name": "C", "initial": 70.0, "source": 15.0, "growth": 0.00, "sink": 14.0},
        ]
        result = simulate_multiplayer_economy(players, args.rounds)
    else:
        history = simulate_economy(args.initial, args.source, args.growth, args.sink, args.rounds, args.dynamic_sink)
        result = {"parameters": {"initial": args.initial, "source": args.source, "growth": args.growth, "sink": args.sink, "dynamic_sink": args.dynamic_sink, "rounds": args.rounds}, "history": history}
    if args.export_json:
        print(dump_json(result))
    elif args.dice and "win_rate_a" in result:
        print("⚔️ A 胜率 {0:.2f}% | B 胜率 {1:.2f}% | 平局 {2:.2f}%".format(result["win_rate_a"], result["win_rate_b"], result["draw_rate"]))
    elif args.dice:
        print("🎲 均值 {0:.3f} | 观测范围 {1}~{2}".format(result["mean"], result["min"], result["max"]))
    elif "final_gini" in result:
        print("👥 终局基尼系数 {0:.3f}".format(result["final_gini"]))
    else:
        print("💰 {0} 轮后结余 {1:.2f}".format(args.rounds, result["history"][-1]["end"]))
    return


def _handle_lens(args: argparse.Namespace) -> None:
    if args.from_payload and not args.id and not args.bundle:
        payload = parse_and_validate_payload(
            args.from_payload,
            {"ConceptAndFormalElements", "ToyAndKinematics", "SpatialTopologyAndEncounters", "FullSystemAudit"},
        )
        active = payload.get("active_lenses")
        if isinstance(active, list):
            ids = []
            for item in active:
                match = re.search(r"#?(\d+)", str(item))
                if match:
                    ids.append(int(match.group(1)))
            args.id = ids or None
        else:
            args.id = {
                "ConceptAndFormalElements": [1, 3, 6, 8, 9],
                "ToyAndKinematics": [2, 26, 35, 37, 44],
                "SpatialTopologyAndEncounters": [21, 31, 38, 43],
            }.get(str(payload.get("payload_type")))
    if args.list_bundles:
        print(dump_json(SYNERGY_BUNDLES) if args.export_json else "\n".join("{0}: {1}".format(key, value["name_cn"]) for key, value in SYNERGY_BUNDLES.items()))
        return
    if args.rubric_eval:
        result = evaluate_balance_rubric(_parse_number_sequence(args.rubric_eval, "--rubric-eval", 12))
        print(dump_json(result) if args.export_json else result["formatted_text"])
        return
    if args.related is not None:
        target = next((lens for lens in LENSES_DB if lens["id"] == args.related), None)
        if target is None:
            raise ValueError("未找到透镜 #{0}".format(args.related))
        related = find_related_lenses(args.related)
        print(dump_json({"target": target, "related": related}) if args.export_json else "\n".join("#{0} {1}".format(item["id"], item["name_cn"]) for item in related))
        return
    if args.bundle:
        bundle = find_bundle(args.bundle)
        if not bundle:
            raise ValueError("未找到特战小队 '{0}'".format(args.bundle))
        selected = [lens for lens in LENSES_DB if lens["id"] in bundle["lens_ids"]]
    elif args.random is not None:
        if args.random < 1 or args.random > len(LENSES_DB):
            raise ValueError("随机数量必须位于 1 到 {0} 之间".format(len(LENSES_DB)))
        selected = random.Random(args.seed).sample(LENSES_DB, args.random)
    elif args.id:
        invalid = sorted(set(args.id) - {lens["id"] for lens in LENSES_DB})
        if invalid:
            raise ValueError("不存在的透镜编号: {0}".format(invalid))
        selected = find_lenses(ids=args.id)
    elif args.tag or args.query or args.category:
        selected = find_lenses(tag=args.tag, query=args.query, category=args.category)
    elif args.list:
        selected = LENSES_DB
    else:
        selected = find_lenses(ids=[1, 8, 31])
    if not selected:
        raise ValueError("未找到匹配的透镜")
    if args.export_yaml:
        print(format_lens_yaml(selected))
    elif args.export_md:
        print(format_lens_markdown(selected))
    elif args.export_json:
        print(dump_json({"lenses": selected}))
    else:
        for lens in selected:
            print("【#{0} {1}】: {2}".format(lens["id"], lens["name_cn"], lens["questions"][0]))
    return


COMMAND_HANDLERS = {
    'pipeline': _handle_pipeline,
    'validate': _handle_validate,
    'triage': _handle_triage,
    'feel': _handle_feel,
    'metrics': _handle_metrics,
    'economy': _handle_economy,
    'lens': _handle_lens,
}


def main() -> None:
    args = build_parser().parse_args()
    try:
        COMMAND_HANDLERS[args.subcommand](args)
    except (ValueError, PayloadError, KeyError, TypeError, ArithmeticError, OverflowError) as exc:
        print("❌ {0}".format(exc), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
