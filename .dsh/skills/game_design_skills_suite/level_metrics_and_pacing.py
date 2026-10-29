#!/usr/bin/env python3
"""
Level Design Craft: Rational Metrics, Jump Kinematics & Sawtooth Pacing Analyzer
理性关卡度量衡自动推算器、跳跃运动学抛物线解算器、遭遇战锯齿心流疲劳检测与多引擎/契约导出工具。

Usage:
    python level_metrics_and_pacing.py --preset fps_3a
    python level_metrics_and_pacing.py --preset metroidvania_2d
    python level_metrics_and_pacing.py --preset souls_arpg
    python level_metrics_and_pacing.py --jump_arc --jump_velocity 12 --gravity_up 35 --gravity_down 60 --speed 8
    python level_metrics_and_pacing.py --pacing_curve "25,60,85,20,65,95,30"
    python level_metrics_and_pacing.py --export_code unity
    python level_metrics_and_pacing.py --export_yaml
"""

import argparse
import math
import sys
from typing import List, Dict, Any, Optional, Sequence

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
    extract_kinematics,
    parse_and_validate_payload,
)



# ==============================================================================
# 1. 多品类关卡度量衡预设库 (Multi-Genre Metrics Presets)
# ==============================================================================

PRESETS: Dict[str, Dict[str, Any]] = {
    "fps_3a": {
        "name": "3A 拟真第一/第三人称动作射击 (3A FPS/TPS)",
        "description": "适用于《战地》《使命召唤》《最后生还者》《全境封锁》等拟真或写实动作射击。",
        "player_height": 1.80,
        "eye_level": 1.65,
        "capsule_radius": 0.40,
        "high_cover": 2.07,
        "low_cover": 0.99,
        "vault_height": 1.17,
        "ledge_grab_height": 2.52,
        "crouch_height": 1.20,
        "crawl_height": 0.72,
        "door_width_single": 1.30,
        "combat_corridor_width": 2.60,
        "ceiling_clearance": 2.60,
        "stair_riser": 0.18,
        "stair_tread": 0.30,
        "dodge_roll_distance": 0.0,
        "one_way_drop_safe": 3.0,
        "fatal_fall_height": 10.0,
    },
    "souls_arpg": {
        "name": "魂系高压箱庭与动作 RPG (Souls-like ARPG)",
        "description": "适用于《黑暗之魂》《艾尔登法环》《血源诅咒》等强调翻滚躲避、高危窄桥与垂直落差的关卡。",
        "player_height": 1.80,
        "eye_level": 1.65,
        "capsule_radius": 0.45,
        "high_cover": 2.20,
        "low_cover": 1.05,
        "vault_height": 1.00,
        "ledge_grab_height": 2.40,
        "crouch_height": 1.30,
        "crawl_height": 0.80,
        "door_width_single": 1.20,
        "combat_corridor_width": 2.80,
        "ceiling_clearance": 3.20,
        "stair_riser": 0.20,
        "stair_tread": 0.35,
        "dodge_roll_distance": 3.20,
        "one_way_drop_safe": 4.0,
        "fatal_fall_height": 12.0,
        "narrow_plank_width": 0.80,
        "fog_gate_width": 2.60,
        "elevator_radius": 2.00,
    },
    "metroidvania_2d": {
        "name": "2D 银河恶魔城与平台动作 (2D Metroidvania)",
        "description": "适用于《空洞骑士》《银河战士》《蔚蓝》《奥日》等强调跳跃精度、能力锁与穿透平台的横版关卡。",
        "player_height": 1.80,
        "eye_level": 1.55,
        "capsule_radius": 0.35,
        "high_cover": 2.00,
        "low_cover": 0.90,
        "vault_height": 1.20,
        "ledge_grab_height": 2.40,
        "crouch_height": 0.90,
        "crawl_height": 0.50,
        "door_width_single": 1.20,
        "combat_corridor_width": 4.00,
        "ceiling_clearance": 2.40,
        "stair_riser": 0.50,
        "stair_tread": 0.50,
        "dodge_roll_distance": 4.50,
        "one_way_drop_safe": 8.0,
        "fatal_fall_height": 999.0,
        "wall_jump_gap_min": 2.40,
        "wall_jump_gap_max": 4.00,
        "one_way_platform_thickness": 0.20,
    },
    "tactical_cqb": {
        "name": "近距离战术室内作战 (Tactical CQB)",
        "description": "适用于《彩虹六号》《Ready or Not》《SWAT》等强调切角转弯、致命漏斗（Fatal Funnel）与门洞战术的关卡。",
        "player_height": 1.80,
        "eye_level": 1.65,
        "capsule_radius": 0.40,
        "high_cover": 2.10,
        "low_cover": 1.00,
        "vault_height": 1.10,
        "ledge_grab_height": 2.20,
        "crouch_height": 1.20,
        "crawl_height": 0.65,
        "door_width_single": 1.10,
        "combat_corridor_width": 2.20,
        "ceiling_clearance": 2.60,
        "stair_riser": 0.18,
        "stair_tread": 0.28,
        "dodge_roll_distance": 0.0,
        "one_way_drop_safe": 2.5,
        "fatal_fall_height": 8.0,
        "fatal_funnel_radius": 3.0,
        "breach_clearance_distance": 4.0,
    }
}


def calculate_rld_metrics(height: float = 1.8, preset_name: Optional[str] = None) -> Dict[str, Any]:
    """Calculate validated rational-level-design metrics."""
    if not isinstance(height, (int, float)) or isinstance(height, bool) or not math.isfinite(float(height)) or height <= 0:
        raise ValueError("player_height 必须是大于 0 的有限数值")
    if height > 1000.0:
        raise ValueError("player_height 不能超过 1,000 米")
    if preset_name is not None and preset_name not in PRESETS:
        raise ValueError("未知关卡度量预设: {0}".format(preset_name))
    if preset_name:
        base = dict(PRESETS[preset_name])
        scale = height / 1.80
        for key in list(base):
            if isinstance(base[key], (int, float)) and key not in {"fatal_fall_height", "stair_riser", "stair_tread"}:
                base[key] = round(base[key] * scale, 2)
        base["player_height"] = float(height)
        if any(isinstance(value, (int, float)) and not math.isfinite(float(value)) for value in base.values()):
            raise ValueError("关卡度量结果发生数值溢出")
        return base

    capsule_radius = round(height * 0.222, 2)
    return {
        "player_height": float(height),
        "eye_level": round(height * 0.9167, 2),
        "capsule_radius": capsule_radius,
        "high_cover": round(height * 1.15, 2),
        "low_cover": round(height * 0.55, 2),
        "vault_height": round(height * 0.65, 2),
        "ledge_grab_height": round(height * 1.40, 2),
        "crouch_height": round(height * 0.67, 2),
        "crawl_height": round(height * 0.40, 2),
        "door_width_single": round(max(1.0, capsule_radius * 2.5 + 0.3), 2),
        "combat_corridor_width": round(max(2.4, capsule_radius * 6.0), 2),
        "ceiling_clearance": round(height * 1.35, 2),
        "stair_riser": 0.18,
        "stair_tread": 0.30,
        "one_way_drop_safe": round(height * 1.8, 2),
        "fatal_fall_height": round(height * 5.5, 2),
    }


# ==============================================================================
# 2. 跳跃运动学与抛物线平台间距求解器 (Jump Kinematics & Arc Solver)
# ==============================================================================

def solve_jump_arc_metrics(
    jump_velocity: float = 12.0,
    gravity_up: float = 35.0,
    gravity_down: Optional[float] = None,
    speed: float = 8.0,
    jump_height: Optional[float] = None,
    time_to_apex: Optional[float] = None,
    fall_multiplier: Optional[float] = None,
) -> Dict[str, Any]:
    """Calculate jump trajectory while preserving complete upstream physics."""
    if (jump_height is None) != (time_to_apex is None):
        raise ValueError("jump_height 与 time_to_apex 必须同时提供")
    values: Dict[str, Any] = {"jump_velocity": jump_velocity, "gravity_up": gravity_up, "speed": speed}
    if gravity_down is not None:
        values["gravity_down"] = gravity_down
    if fall_multiplier is not None:
        values["fall_multiplier"] = fall_multiplier
    if jump_height is not None:
        values["jump_height"] = jump_height
        values["time_to_apex"] = time_to_apex
    for name, value in values.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)) or value <= 0:
            raise ValueError("{0} 必须是大于 0 的有限数值".format(name))
    if speed > 10000.0 or jump_velocity > 1_000_000.0 or gravity_up > 1_000_000.0:
        raise ValueError("跳跃速度、重力或水平速度超出安全计算范围")
    if gravity_down is not None and gravity_down > 1_000_000.0:
        raise ValueError("gravity_down 超出安全计算范围")
    if fall_multiplier is not None and fall_multiplier > 100.0:
        raise ValueError("fall_multiplier 不能超过 100")
    if jump_height is not None:
        assert time_to_apex is not None
        if jump_height > 10000.0 or not 0.01 <= time_to_apex <= 60.0:
            raise ValueError("jump_height 不能超过 10,000 米，time_to_apex 必须位于 0.01 到 60 秒之间")

    if jump_height is not None and time_to_apex is not None:
        jump_velocity = 2.0 * jump_height / time_to_apex
        gravity_up = 2.0 * jump_height / time_to_apex ** 2
        if fall_multiplier is not None:
            gravity_down = gravity_up * fall_multiplier
        elif gravity_down is None:
            gravity_down = gravity_up * 1.8
    elif gravity_down is None:
        gravity_down = 60.0

    assert gravity_down is not None
    apex_time = jump_velocity / gravity_up
    maximum_height = jump_velocity ** 2 / (2.0 * gravity_up)
    fall_time = math.sqrt(2.0 * maximum_height / gravity_down)
    air_time = apex_time + fall_time
    normal_span = speed * air_time
    calculated = (apex_time, maximum_height, fall_time, air_time, normal_span)
    if not all(math.isfinite(value) for value in calculated):
        raise ValueError("跳跃跨度计算发生数值溢出")
    return {
        "jump_velocity": round(jump_velocity, 2),
        "gravity_up": round(gravity_up, 2),
        "gravity_down": round(gravity_down, 2),
        "fall_multiplier": round(gravity_down / gravity_up, 4),
        "speed": round(speed, 2),
        "max_jump_height": round(maximum_height, 2),
        "time_to_apex": round(apex_time, 3),
        "time_fall": round(fall_time, 3),
        "total_air_time": round(air_time, 3),
        "span_normal": round(normal_span, 2),
        "span_sprint": round(speed * 1.3 * air_time, 2),
        "span_safe": round(normal_span * 0.80, 2),
        "span_hardcore": round(normal_span * 0.95, 2),
        "span_drop_2m": round(speed * (apex_time + math.sqrt(2.0 * (maximum_height + 2.0) / gravity_down)), 2),
        "span_drop_4m": round(speed * (apex_time + math.sqrt(2.0 * (maximum_height + 4.0) / gravity_down)), 2),
    }

def render_ascii_jump_arc(arc: Dict[str, Any]) -> str:
    """
    渲染跳跃抛物线与关卡平台间距 ASCII 示意图
    """
    lines = [
        "   高度 Y (m)",
        f"     ^  顶点 H_max = {arc['max_jump_height']:.2f}m (t_apex = {arc['time_to_apex']:.2f}s)",
        "     |            ★",
        "     |         .  '  .",
        "     |       .         .",
        "     |     /             \\   (下落加速 g_down = {:.1f}m/s²)".format(arc['gravity_down']),
        "     |   /                 \\",
        "     |  /                   \\",
        "     +=[起跳平台]=============\\====[安全平台]======[极限平台]====> 水平 X (m)",
        f"        x = 0m                     x = {arc['span_safe']:.2f}m        x = {arc['span_normal']:.2f}m (冲刺: {arc['span_sprint']:.2f}m)",
        "                                   [安全宽容带 80%]   [极限跨度 100%]"
    ]
    return "\n".join(lines)


# ==============================================================================
# 3. 转角遭遇与视距反应时间求解器 (Reaction & Sightlines)
# ==============================================================================

def solve_reaction_distance(
    speed: float = 6.0,
    reaction_time: float = 0.35,
    skid_deceleration: float = 15.0,
) -> Dict[str, Any]:
    """Calculate a validated corner-reaction and braking buffer distance."""
    for name, value in {"speed": speed, "reaction_time": reaction_time, "skid_deceleration": skid_deceleration}.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)) or value <= 0:
            raise ValueError("{0} 必须是大于 0 的有限数值".format(name))
    reaction_distance = round(speed * reaction_time, 2)
    skid_distance = round(speed ** 2 / (2 * skid_deceleration), 2)
    return {
        "run_speed": float(speed),
        "reaction_time_sec": float(reaction_time),
        "reaction_distance_m": reaction_distance,
        "skid_deceleration_mps2": float(skid_deceleration),
        "skid_braking_distance_m": skid_distance,
        "safe_corner_buffer_m": round(reaction_distance + skid_distance + 1.5, 2),
    }


# ==============================================================================
# 4. 张力曲线与心流疲劳诊断器 (Sawtooth Pacing Analyzer)
# ==============================================================================

def analyze_pacing_curve(tensions: Sequence[float]) -> Dict[str, Any]:
    """Analyze a validated 0-100 sawtooth pacing sequence."""
    if not isinstance(tensions, list) or not tensions:
        raise ValueError("张力序列不能为空")
    if len(tensions) < 4:
        raise ValueError("张力序列至少需要 4 个节点才能判断节奏结构")
    if len(tensions) > 1000:
        raise ValueError("张力序列最多支持 1,000 个节点")
    normalized: List[int] = []
    for index, value in enumerate(tensions):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError("节点 #{0} 的张力必须是有限数值".format(index + 1))
        if value < 0 or value > 100:
            raise ValueError("节点 #{0} 的张力必须位于 0 到 100 之间".format(index + 1))
        normalized.append(int(round(value)))

    warnings: List[str] = []
    recommendations: List[str] = []
    consecutive_high = 0
    consecutive_low = 0
    for index, tension in enumerate(normalized):
        consecutive_high = consecutive_high + 1 if tension >= 70 else 0
        consecutive_low = consecutive_low + 1 if tension <= 35 else 0
        if consecutive_high == 3:
            warnings.append("⚠️ 节点 #{0} 触发【疲劳轰炸预警】：连续 3 个区域张力 >= 70。".format(index + 1))
        if consecutive_low == 4:
            warnings.append("⚠️ 节点 #{0} 触发平淡预警：连续 4 个区域张力 <= 35。".format(index + 1))

    maximum = max(normalized)
    peak_indices = [index for index, value in enumerate(normalized) if value == maximum]
    peak_index = peak_indices[-1]
    relative_position = (peak_index + 1) / len(normalized)
    if len(normalized) >= 4 and relative_position < 0.6:
        warnings.append("⚠️ 关卡高潮过早：最高张力位于进度 {0:.0f}% 处。".format(relative_position * 100))
    if len(normalized) >= 3 and maximum < 50:
        warnings.append("⚠️ 全局平淡预警：最高张力仅为 {0}，缺少明确高潮。".format(maximum))

    for index in range(len(normalized) - 1):
        difference = normalized[index + 1] - normalized[index]
        if difference >= 60:
            warnings.append("⚠️ 节点 #{0} -> #{1} 存在 +{2} 的断崖式张力跳变。".format(index + 1, index + 2, difference))
            recommendations.append("💡 断崖式张力跳变前应增加预警、教学或微型遭遇。")
        if normalized[index] >= 80 and normalized[index + 1] > 60:
            recommendations.append("💡 在节点 #{0} 后插入 15~30 秒低压呼吸区。".format(index + 1))

    return {
        "tensions": normalized,
        "peak_value": maximum,
        "peak_node": peak_index + 1,
        "peak_nodes": [index + 1 for index in peak_indices],
        "is_healthy": not warnings,
        "warnings": warnings,
        "recommendations": recommendations,
    }


def print_pacing_waveform(tensions: List[int]):
    print("\n🌊 关卡张力心流波形图 (Pacing Waveform):")
    height = 8
    width = len(tensions)

    grid = [[" " for _ in range(width)] for _ in range(height)]
    for col, v in enumerate(tensions):
        clamped = max(0, min(100, v))
        row = int((clamped / 100.0) * (height - 1))
        grid[height - 1 - row][col] = "▲"

    for r_idx in range(height):
        lvl = int(100 - (r_idx / (height - 1)) * 100)
        row_str = "---".join(grid[r_idx])
        print(f" {lvl:3d}% | {row_str}")
    print("      +" + "----" * width)
    node_labels = "".join([f" #{i+1:<3}" for i in range(width)])
    print(f"       {node_labels}")


# ==============================================================================
# 5. 代码生成与标准流水线契约 (Code Generation & Pipeline Contracts)
# ==============================================================================

def generate_unity_csharp_gizmo(metrics: Dict[str, Any], arc: Optional[Dict[str, Any]] = None) -> str:
    """
    生成 Unity C# 关卡度量衡可视化 Gizmos 脚本
    """
    h_player = metrics.get("player_height", 1.80)
    r_capsule = metrics.get("capsule_radius", 0.40)
    h_high_cov = metrics.get("high_cover", 2.07)
    h_low_cov = metrics.get("low_cover", 0.99)
    w_door = metrics.get("door_width_single", 1.30)
    w_corridor = metrics.get("combat_corridor_width", 2.60)

    span_safe = arc["span_safe"] if arc else 4.0
    span_max = arc["span_normal"] if arc else 5.0

    return f"""// ==============================================================================
// Auto-generated by Level Design Craft (Rational Level Design Metrics Gizmo)
// 挂载至 Unity 关卡白模场景中的任一 GameObject 即可在 Scene 视图直观显示度量衡线框
// ==============================================================================

using UnityEngine;

[ExecuteInEditMode]
public class LevelMetricsGizmo : MonoBehaviour
{{
    [Header("度量衡标准 (RLD Metrics)")]
    public float playerHeight = {h_player:0.2f}f;
    public float capsuleRadius = {r_capsule:0.2f}f;
    public float highCoverHeight = {h_high_cov:0.2f}f;
    public float lowCoverHeight = {h_low_cov:0.2f}f;
    public float doorwayWidth = {w_door:0.2f}f;
    public float combatCorridorWidth = {w_corridor:0.2f}f;

    [Header("跳跃平台极限间距")]
    public float safeJumpSpan = {span_safe:0.2f}f;
    public float maxJumpSpan = {span_max:0.2f}f;

    [Header("调试显示开关")]
    public bool drawPlayerCapsule = true;
    public bool drawCoverTemplates = true;
    public bool drawJumpSpanRuler = true;

    private void OnDrawGizmos()
    {{
        Vector3 pos = transform.position;

        // 1. 绘制主角胶囊体
        if (drawPlayerCapsule)
        {{
            Gizmos.color = Color.green;
            Vector3 center = pos + Vector3.up * (playerHeight * 0.5f);
            Gizmos.DrawWireCube(center, new Vector3(capsuleRadius * 2f, playerHeight, capsuleRadius * 2f));
        }}

        // 2. 绘制高低掩体参考盒
        if (drawCoverTemplates)
        {{
            // 低掩体 (黄)
            Gizmos.color = Color.yellow;
            Vector3 lowCenter = pos + Vector3.right * 1.5f + Vector3.up * (lowCoverHeight * 0.5f);
            Gizmos.DrawWireCube(lowCenter, new Vector3(1.0f, lowCoverHeight, 0.4f));

            // 高掩体 (蓝)
            Gizmos.color = Color.cyan;
            Vector3 highCenter = pos + Vector3.right * 3.0f + Vector3.up * (highCoverHeight * 0.5f);
            Gizmos.DrawWireCube(highCenter, new Vector3(1.0f, highCoverHeight, 0.4f));
        }}

        // 3. 绘制跳跃跨度标尺
        if (drawJumpSpanRuler)
        {{
            Gizmos.color = Color.magenta;
            Gizmos.DrawLine(pos, pos + Vector3.forward * safeJumpSpan);
            Gizmos.color = Color.red;
            Gizmos.DrawLine(pos + Vector3.forward * safeJumpSpan, pos + Vector3.forward * maxJumpSpan);
        }}
    }}
}}
"""


def generate_pipeline_yaml_payload(
    metrics: Dict[str, Any],
    pacing: Optional[Dict[str, Any]] = None,
    arc: Optional[Dict[str, Any]] = None,
    topology_type: str = "Wide-Linear with Hub & Loopback Shortcuts",
    encounter_arenas: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Generate a safely quoted Contract 3 v1.1 payload."""
    tensions = list(pacing["tensions"]) if pacing else [25, 60, 85, 20, 65, 95, 30]
    metrics_standards: Dict[str, Any] = {
        "player_height": metrics.get("player_height", 1.80),
        "high_cover": metrics.get("high_cover", 2.07),
        "low_cover": metrics.get("low_cover", 0.99),
        "doorway_width": metrics.get("door_width_single", 1.30),
    }
    if arc:
        metrics_standards["jump_kinematics"] = {
            "max_jump_height": arc["max_jump_height"],
            "safe_span_m": arc["span_safe"],
            "max_span_m": arc["span_normal"],
            "sprint_span_m": arc["span_sprint"],
        }
    arenas = encounter_arenas if encounter_arenas is not None else [{
        "arena_id": "Section_Encounter_Alpha",
        "tension_score": max(tensions) if tensions else 85,
        "flanking_routes": 3,
        "high_ground_perches": 2,
        "cooldown_valley_after": "20s safe loot room (Tension 25)",
    }]
    payload = {
        "payload_type": "SpatialTopologyAndEncounters",
        "version": "1.1",
        "topology_type": topology_type,
        "metrics_standards": metrics_standards,
        "encounter_arenas": arenas,
        "sawtooth_pacing_sequence": tensions,
    }
    return dump_yaml(payload)


# ==============================================================================
# 6. 主执行入口 (CLI Entrypoint)
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Level Design Craft: Rational Metrics, Kinematics & Pacing Analyzer")
    parser.add_argument("--preset", choices=list(PRESETS.keys()), help="选择关卡度量预设")
    parser.add_argument("--player-height", "--player_height", "-H", dest="player_height", type=float, default=1.80, help="主角标准身高")
    parser.add_argument("--pacing-curve", "--pacing_curve", "-P", dest="pacing_curve", help="逗号分隔的 0~100 张力序列")
    parser.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload", help="从文件、字符串或 stdin ('-') 载入契约")
    parser.add_argument("--jump-arc", "--jump_arc", dest="jump_arc", action="store_true", help="计算跳跃抛物线")
    parser.add_argument("--jump-velocity", "--jump_velocity", dest="jump_velocity", type=float, default=12.0)
    parser.add_argument("--gravity-up", "--gravity_up", dest="gravity_up", type=float, default=35.0)
    parser.add_argument("--gravity-down", "--gravity_down", dest="gravity_down", type=float)
    parser.add_argument("--fall-multiplier", "--fall_multiplier", dest="fall_multiplier", type=float)
    parser.add_argument("--speed", type=float, default=8.0)
    parser.add_argument("--jump-height", "--jump_height", dest="jump_height", type=float)
    parser.add_argument("--time-to-apex", "--time_to_apex", dest="time_to_apex", type=float)
    parser.add_argument("--reaction-check", "--reaction_check", dest="reaction_check", action="store_true")
    parser.add_argument("--reaction-time", "--reaction_time", dest="reaction_time", type=float, default=0.35)
    parser.add_argument("--skid-deceleration", "--skid_deceleration", dest="skid_deceleration", type=float, default=15.0)
    parser.add_argument("--export-code", "--export_code", choices=["unity", "none"], default="none")
    parser.add_argument("--export-yaml", "--export_yaml", dest="export_yaml", action="store_true")
    parser.add_argument("--export-json", "--export_json", dest="export_json", action="store_true")
    args = parser.parse_args()

    try:
        loaded_payload: Optional[Dict[str, Any]] = None
        if args.from_payload:
            loaded_payload = parse_and_validate_payload(args.from_payload, {"ToyAndKinematics", "SpatialTopologyAndEncounters"})
            extracted = extract_kinematics(loaded_payload)
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
            standards = loaded_payload.get("metrics_standards")
            if isinstance(standards, dict) and isinstance(standards.get("player_height"), (int, float)):
                args.player_height = float(standards["player_height"])
            sequence = loaded_payload.get("sawtooth_pacing_sequence")
            if isinstance(sequence, list) and not args.pacing_curve:
                args.pacing_curve = ",".join(str(value) for value in sequence)
            if not (args.export_yaml or args.export_json or args.export_code != "none"):
                print("📥 成功载入上游契约载荷 [{0}]".format(loaded_payload.get("payload_type", "Unknown")), file=sys.stderr)

        metrics = calculate_rld_metrics(args.player_height, args.preset)
        arc: Optional[Dict[str, Any]] = None
        if args.jump_arc or args.jump_height is not None or args.time_to_apex is not None:
            arc = solve_jump_arc_metrics(
                jump_velocity=args.jump_velocity,
                gravity_up=args.gravity_up,
                gravity_down=args.gravity_down,
                speed=args.speed,
                jump_height=args.jump_height,
                time_to_apex=args.time_to_apex,
                fall_multiplier=args.fall_multiplier,
            )

        pacing: Optional[Dict[str, Any]] = None
        if args.pacing_curve:
            raw_values = [float(value.strip()) for value in args.pacing_curve.split(",") if value.strip()]
            pacing = analyze_pacing_curve(raw_values)

        reaction = solve_reaction_distance(args.speed, args.reaction_time, args.skid_deceleration) if args.reaction_check else None

        if args.export_yaml:
            print(generate_pipeline_yaml_payload(metrics, pacing, arc))
            return
        if args.export_json:
            print(dump_json({"metrics": metrics, "jump_arc": arc, "pacing": pacing, "reaction": reaction}))
            return
        if args.export_code == "unity":
            print(generate_unity_csharp_gizmo(metrics, arc))
            return

        title = PRESETS[args.preset]["name"] if args.preset else "通用标准模型"
        print("📐 {0} | 玩家身高 {1:.2f}m".format(title, metrics["player_height"]))
        print("全身掩体 {0:.2f}m | 半身掩体 {1:.2f}m | 走廊宽度 {2:.2f}m".format(
            metrics["high_cover"], metrics["low_cover"], metrics["combat_corridor_width"]
        ))
        if arc:
            print(render_ascii_jump_arc(arc))
            print("安全跨度 {0:.2f}m | 极限跨度 {1:.2f}m".format(arc["span_safe"], arc["span_normal"]))
        if reaction:
            print("转角安全缓冲 {0:.2f}m".format(reaction["safe_corner_buffer_m"]))
        if pacing:
            print_pacing_waveform(pacing["tensions"])
            if pacing["is_healthy"]:
                print("✅ 张力曲线未触发当前规则集中的风险项。")
            else:
                for warning in pacing["warnings"]:
                    print(warning)
            for recommendation in pacing["recommendations"]:
                print(recommendation)
    except (ValueError, PayloadError, KeyError, TypeError, ArithmeticError, OverflowError) as exc:
        print("❌ {0}".format(exc), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()

