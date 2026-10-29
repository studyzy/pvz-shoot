#!/usr/bin/env python3
"""
Game Design Workshop: Advanced Probability & Virtual Economy Simulator
《游戏设计梦工厂》高级纸面原型蒙特卡洛掷骰期望模拟器、多玩家虚拟经济动力学与基尼系数推演工具。

Usage:
    # 基础与高级掷骰模拟
    python prob_and_economy_sim.py --dice "4d6k3"
    python prob_and_economy_sim.py --dice "6d6>=4"
    python prob_and_economy_sim.py --dice "2d6!"
    python prob_and_economy_sim.py --dice "1d20adv vs 1d20" --trials 20000

    # 单玩家经济系统推演与死锁/通胀检测
    python prob_and_economy_sim.py --economy-sim --initial 100 --source 20 --sink 15 --rounds 30
    python prob_and_economy_sim.py --economy-sim --initial 50 --source 10 --growth 0.08 --sink 12 --rounds 25

    # 多人经济对抗与正反馈滚雪球/基尼系数监测
    python prob_and_economy_sim.py --economy-multiplayer --rounds 25

    # 导出流水线标准 YAML 载荷契约
    python prob_and_economy_sim.py --export-payload
"""

import argparse
import math
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
    extract_economy_parameters,
    parse_and_validate_payload,
)



def parse_single_roll(expr: str) -> Dict[str, Any]:
    """Parse and validate a supported dice expression."""
    if not isinstance(expr, str) or not expr.strip():
        raise ValueError("掷骰表达式不能为空")
    original_expr = expr.strip()
    clean_expr = re.sub(r"\s+", "", original_expr.lower())

    def validate_dimensions(num: int, faces: int) -> None:
        if num < 1:
            raise ValueError("骰子数量必须至少为 1")
        if faces < 2:
            raise ValueError("骰子面数必须至少为 2")
        if num > 1000:
            raise ValueError("单次投掷最多支持 1000 颗骰子")
        if faces > 1000000:
            raise ValueError("单颗骰子最多支持 1,000,000 面")

    pool_match = re.match(r"^(?:(\d+))?d(\d+)>=(\d+)$", clean_expr)
    if pool_match:
        num = int(pool_match.group(1)) if pool_match.group(1) else 1
        faces = int(pool_match.group(2))
        target = int(pool_match.group(3))
        validate_dimensions(num, faces)
        if target < 1 or target > faces:
            raise ValueError("骰池成功阈值必须位于 1 到骰子面数之间")
        return {"type": "pool_success", "num_dice": num, "die_faces": faces, "target_num": target, "expr": original_expr}

    adv_match = re.match(r"^(?:(\d+))?d(\d+)(adv|dis)(?:([+-])(\d+))?$", clean_expr)
    if adv_match:
        num = int(adv_match.group(1)) if adv_match.group(1) else 1
        faces = int(adv_match.group(2))
        validate_dimensions(num, faces)
        mod_val = int(adv_match.group(5)) if adv_match.group(5) else 0
        modifier = -mod_val if adv_match.group(4) == "-" else mod_val
        return {
            "type": "advantage" if adv_match.group(3) == "adv" else "disadvantage",
            "num_dice": num,
            "die_faces": faces,
            "modifier": modifier,
            "expr": original_expr,
        }

    keep_match = re.match(r"^(?:(\d+))?d(\d+)k(l)?(\d+)(?:([+-])(\d+))?$", clean_expr)
    if keep_match:
        num = int(keep_match.group(1)) if keep_match.group(1) else 1
        faces = int(keep_match.group(2))
        keep_count = int(keep_match.group(4))
        validate_dimensions(num, faces)
        if keep_count < 1 or keep_count > num:
            raise ValueError("保留骰子数必须位于 1 到投掷总数之间")
        mod_val = int(keep_match.group(6)) if keep_match.group(6) else 0
        modifier = -mod_val if keep_match.group(5) == "-" else mod_val
        return {
            "type": "keep_lowest" if keep_match.group(3) == "l" else "keep_highest",
            "num_dice": num,
            "die_faces": faces,
            "keep_count": keep_count,
            "modifier": modifier,
            "expr": original_expr,
        }

    explode_match = re.match(r"^(?:(\d+))?d(\d+)!(?:([+-])(\d+))?$", clean_expr)
    if explode_match:
        num = int(explode_match.group(1)) if explode_match.group(1) else 1
        faces = int(explode_match.group(2))
        validate_dimensions(num, faces)
        mod_val = int(explode_match.group(4)) if explode_match.group(4) else 0
        modifier = -mod_val if explode_match.group(3) == "-" else mod_val
        return {"type": "exploding", "num_dice": num, "die_faces": faces, "modifier": modifier, "expr": original_expr}

    base_match = re.match(r"^(?:(\d+))?d(\d+)(?:([+-])(\d+))?$", clean_expr)
    if base_match:
        num = int(base_match.group(1)) if base_match.group(1) else 1
        faces = int(base_match.group(2))
        validate_dimensions(num, faces)
        mod_val = int(base_match.group(4)) if base_match.group(4) else 0
        modifier = -mod_val if base_match.group(3) == "-" else mod_val
        return {"type": "standard", "num_dice": num, "die_faces": faces, "modifier": modifier, "expr": original_expr}

    raise ValueError(
        "无法解析掷骰表达式: '{0}'。支持基础骰、优势/劣势、取高/低、骰池成功数与爆炸骰。".format(expr)
    )


def roll_single_die_exploding(faces: int, max_depth: int = 20, rng: Optional[Any] = None) -> int:
    """Roll one exploding die with a finite safety cap."""
    if faces < 2 or max_depth < 1:
        raise ValueError("爆炸骰面数至少为 2，最大爆炸深度至少为 1")
    random_source = rng if rng is not None else random
    total = 0
    for _ in range(max_depth):
        value = random_source.randint(1, faces)
        total += value
        if value != faces:
            break
    return total


def execute_roll(spec: Dict[str, Any], rng: Optional[Any] = None) -> int:
    """Execute one roll from a validated specification."""
    random_source = rng if rng is not None else random
    roll_type = spec["type"]
    num = spec["num_dice"]
    faces = spec["die_faces"]

    if roll_type == "standard":
        return sum(random_source.randint(1, faces) for _ in range(num)) + spec["modifier"]
    if roll_type == "advantage":
        first = sum(random_source.randint(1, faces) for _ in range(num))
        second = sum(random_source.randint(1, faces) for _ in range(num))
        return max(first, second) + spec["modifier"]
    if roll_type == "disadvantage":
        first = sum(random_source.randint(1, faces) for _ in range(num))
        second = sum(random_source.randint(1, faces) for _ in range(num))
        return min(first, second) + spec["modifier"]
    if roll_type in {"keep_highest", "keep_lowest"}:
        rolls = [random_source.randint(1, faces) for _ in range(num)]
        rolls.sort(reverse=roll_type == "keep_highest")
        return sum(rolls[: spec["keep_count"]]) + spec["modifier"]
    if roll_type == "exploding":
        return sum(roll_single_die_exploding(faces, rng=random_source) for _ in range(num)) + spec["modifier"]
    if roll_type == "pool_success":
        return sum(1 for _ in range(num) if random_source.randint(1, faces) >= spec["target_num"])
    raise ValueError("未知掷骰类型: {0}".format(roll_type))


def simulate_single_dice(
    expr: str,
    trials: int = 10000,
    seed: Optional[int] = None,
    rng: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run a reproducible Monte Carlo simulation for one dice expression."""
    if not isinstance(trials, int) or isinstance(trials, bool) or trials < 1:
        raise ValueError("模拟次数必须是大于 0 的整数")
    if trials > 1000000:
        raise ValueError("单次模拟最多支持 1,000,000 次试验")
    spec = parse_single_roll(expr)
    multiplier = 20 if spec["type"] == "exploding" else (2 if spec["type"] in {"advantage", "disadvantage"} else 1)
    if trials * spec["num_dice"] * multiplier > 10000000:
        raise ValueError("模拟规模过大：骰子数量 × 试验次数超过安全预算")
    random_source = rng if rng is not None else random.Random(seed)
    results = sorted(execute_roll(spec, random_source) for _ in range(trials))

    mean = sum(results) / trials
    variance = sum((value - mean) ** 2 for value in results) / trials
    counts: Dict[int, int] = {}
    for value in results:
        counts[value] = counts.get(value, 0) + 1

    def percentile(fraction: float) -> float:
        return float(results[int(fraction * (trials - 1))])

    cdf: Dict[int, float] = {}
    running_sum = 0
    for key in reversed(sorted(counts)):
        running_sum += counts[key]
        cdf[key] = running_sum / trials * 100.0

    modifier = spec.get("modifier", 0)
    if spec["type"] in {"keep_highest", "keep_lowest"}:
        theoretical_min = spec["keep_count"] + modifier
        theoretical_max: Optional[int] = spec["keep_count"] * spec["die_faces"] + modifier
    elif spec["type"] == "pool_success":
        theoretical_min = 0
        theoretical_max = spec["num_dice"]
    else:
        theoretical_min = spec["num_dice"] + modifier
        theoretical_max = None if spec["type"] == "exploding" else spec["num_dice"] * spec["die_faces"] + modifier

    return {
        "expr": expr,
        "spec": spec,
        "trials": trials,
        "seed": seed,
        "min": min(results),
        "max": max(results),
        "theoretical_min": theoretical_min,
        "theoretical_max": theoretical_max,
        "mean": mean,
        "std_dev": math.sqrt(variance),
        "p10": percentile(0.10),
        "p25": percentile(0.25),
        "p50_median": percentile(0.50),
        "p75": percentile(0.75),
        "p90": percentile(0.90),
        "distribution": counts,
        "cdf_ge": cdf,
    }


def simulate_versus_dice(
    expr_a: str,
    expr_b: str,
    trials: int = 10000,
    seed: Optional[int] = None,
    rng: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run a reproducible head-to-head dice simulation."""
    if not isinstance(trials, int) or isinstance(trials, bool) or trials < 1:
        raise ValueError("模拟次数必须是大于 0 的整数")
    if trials > 1000000:
        raise ValueError("单次模拟最多支持 1,000,000 次试验")
    spec_a = parse_single_roll(expr_a)
    spec_b = parse_single_roll(expr_b)
    def roll_cost(spec: Dict[str, Any]) -> int:
        multiplier = 20 if spec["type"] == "exploding" else (2 if spec["type"] in {"advantage", "disadvantage"} else 1)
        return spec["num_dice"] * multiplier
    if trials * (roll_cost(spec_a) + roll_cost(spec_b)) > 10000000:
        raise ValueError("模拟规模过大：骰子数量 × 试验次数超过安全预算")
    random_source = rng if rng is not None else random.Random(seed)
    wins_a = wins_b = draws = 0
    diffs: List[int] = []
    for _ in range(trials):
        value_a = execute_roll(spec_a, random_source)
        value_b = execute_roll(spec_b, random_source)
        diffs.append(value_a - value_b)
        if value_a > value_b:
            wins_a += 1
        elif value_b > value_a:
            wins_b += 1
        else:
            draws += 1
    return {
        "expr_a": expr_a,
        "expr_b": expr_b,
        "trials": trials,
        "seed": seed,
        "win_rate_a": wins_a / trials * 100.0,
        "win_rate_b": wins_b / trials * 100.0,
        "draw_rate": draws / trials * 100.0,
        "mean_diff": sum(diffs) / trials,
    }


def print_ascii_histogram(dist: Dict[int, int], cdf: Dict[int, float], total_trials: int):
    print("\n📊 概率分布与累积概率表 (Probability & CDF Table):")
    print(f" {'点数':>4} | {'直方图分布':<30} | {'单点概率':>8} | {'P(X >= x)':>10}")
    print(" " + "-" * 62)
    sorted_keys = sorted(dist.keys())
    max_count = max(dist.values()) if dist else 1

    for val in sorted_keys:
        count = dist[val]
        percentage = (count / total_trials) * 100.0
        cdf_prob = cdf.get(val, 0.0)
        bar_len = int((count / max_count) * 28)
        bar = "█" * bar_len
        print(f" {val:4d} | {bar:<28} | {percentage:7.2f}% | {cdf_prob:9.2f}%")


def calculate_gini(wealths: List[float]) -> float:
    """Calculate a Gini coefficient for finite, non-negative wealth values."""
    if not wealths:
        return 0.0
    values = [float(value) for value in wealths]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("财富值必须是有限的非负数")
    total = sum(values)
    if total == 0:
        return 0.0
    sorted_values = sorted(values)
    count = len(sorted_values)
    numerator = sum((2 * (index + 1) - count - 1) * value for index, value in enumerate(sorted_values))
    return max(0.0, min(1.0, numerator / (count * total)))


def simulate_economy(
    initial: float,
    source_base: float,
    growth: float,
    sink_base: float,
    rounds: int = 30,
    dynamic_sink_scale: float = 0.0,
) -> List[Dict[str, Any]]:
    """Simulate one virtual economy with validated finite parameters."""
    numeric_values = {
        "initial": initial,
        "source_base": source_base,
        "growth": growth,
        "sink_base": sink_base,
        "dynamic_sink_scale": dynamic_sink_scale,
    }
    for name, value in numeric_values.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError("{0} 必须是有限数值".format(name))
    if initial < 0 or source_base < 0 or sink_base < 0 or dynamic_sink_scale < 0:
        raise ValueError("初始资金、产出、消耗和动态消耗系数不能为负数")
    if max(initial, source_base, sink_base, dynamic_sink_scale) > 1e15:
        raise ValueError("经济绝对数值不能超过 1e15")
    if growth <= -1.0 or growth > 100.0:
        raise ValueError("增长系数必须大于 -1.0 且不超过 100")
    if not isinstance(rounds, int) or isinstance(rounds, bool) or rounds < 1:
        raise ValueError("推演回合数必须是大于 0 的整数")
    if rounds > 100000:
        raise ValueError("推演回合数不能超过 100,000")

    history: List[Dict[str, Any]] = []
    current = float(initial)
    for round_index in range(1, rounds + 1):
        earned = float(source_base) + current * float(growth)
        spent = float(sink_base) + current * float(dynamic_sink_scale)
        next_value = max(0.0, current + earned - spent)
        if not all(math.isfinite(value) for value in (earned, spent, next_value)):
            raise ValueError("经济参数导致数值溢出，请降低增长系数或回合数")
        history.append({
            "round": round_index,
            "start": current,
            "earned": earned,
            "spent": spent,
            "net": earned - spent,
            "end": next_value,
        })
        current = next_value
    return history


def simulate_multiplayer_economy(
    players: List[Dict[str, Any]],
    rounds: int = 25,
) -> Dict[str, Any]:
    """Simulate a validated multiplayer economy and inequality history."""
    if not isinstance(players, list) or not players:
        raise ValueError("多人经济至少需要 1 个玩家配置")
    if not isinstance(rounds, int) or isinstance(rounds, bool) or rounds < 1:
        raise ValueError("推演回合数必须是大于 0 的整数")
    if rounds > 100000:
        raise ValueError("推演回合数不能超过 100,000")

    normalized: List[Dict[str, Any]] = []
    names = set()
    for index, player in enumerate(players):
        if not isinstance(player, dict):
            raise ValueError("玩家配置 #{0} 必须是字典".format(index + 1))
        name = str(player.get("name", "")).strip()
        if not name or name in names:
            raise ValueError("玩家名称必须非空且唯一")
        names.add(name)
        values = {
            "initial": float(player.get("initial", 0.0)),
            "source": float(player.get("source", 10.0)),
            "growth": float(player.get("growth", 0.0)),
            "sink": float(player.get("sink", 8.0)),
        }
        if any(not math.isfinite(value) for value in values.values()):
            raise ValueError("玩家 {0} 包含非有限数值".format(name))
        if values["initial"] < 0 or values["source"] < 0 or values["sink"] < 0 or values["growth"] <= -1.0:
            raise ValueError("玩家 {0} 的经济参数超出合法范围".format(name))
        if max(values["initial"], values["source"], values["sink"]) > 1e15 or values["growth"] > 100.0:
            raise ValueError("玩家 {0} 的经济参数超出安全计算范围".format(name))
        normalized.append({"name": name, **values})

    current_wealths = [player["initial"] for player in normalized]
    round_records: List[Dict[str, Any]] = []
    gini_history: List[float] = []
    for round_index in range(1, rounds + 1):
        round_data: Dict[str, Any] = {"round": round_index, "wealths": {}}
        for index, player in enumerate(normalized):
            current = current_wealths[index]
            next_value = max(0.0, current + player["source"] + current * player["growth"] - player["sink"])
            if not math.isfinite(next_value):
                raise ValueError("多人经济参数导致数值溢出")
            current_wealths[index] = next_value
            round_data["wealths"][player["name"]] = next_value
        gini = calculate_gini(current_wealths)
        gini_history.append(gini)
        round_data["gini"] = gini
        round_records.append(round_data)

    maximum = max(current_wealths)
    minimum = min(current_wealths)
    gap_ratio = maximum / minimum if minimum > 0 else (1.0 if maximum == 0 else None)
    return {
        "rounds": rounds,
        "players": [player["name"] for player in normalized],
        "final_wealths": {player["name"]: current_wealths[index] for index, player in enumerate(normalized)},
        "final_gini": gini_history[-1],
        "gini_history": gini_history,
        "lead_gap_ratio": gap_ratio,
        "history": round_records,
    }


def print_ascii_chart(values: List[float]):
    if not values:
        return
    min_v = min(values)
    max_v = max(values)
    span = max_v - min_v if max_v != min_v else 1.0

    print("\n📈 资源存量演化走势图:")
    height = 10
    width = len(values)

    grid = [[" " for _ in range(width)] for _ in range(height)]
    for col, v in enumerate(values):
        row = int(((v - min_v) / span) * (height - 1))
        row = max(0, min(height - 1, row))
        grid[height - 1 - row][col] = "●"

    for r_idx in range(height):
        lvl = max_v - (r_idx / (height - 1)) * span
        row_str = "".join(grid[r_idx])
        print(f"{lvl:6.1f} | {row_str}")
    print("       +" + "-" * width)
    print(f"        回合 1 {' ' * (max(0, width - 8))} 回合 {width}")


def generate_pipeline_yaml_payload(
    high_concept: str = "双人合作深海潜水探险与寿司店经营",
    players: str = "2人合作 (Cooperative)",
    primary_obj: str = "捕获深海珍稀食材并维持寿司店五星评级",
    resources: Optional[List[str]] = None,
    rules: Optional[List[str]] = None,
    hypotheses: Optional[List[str]] = None,
    player_experience_goals: Optional[List[str]] = None,
    conflict_sources: Optional[List[str]] = None,
) -> str:
    """Generate a safely quoted Contract 1 YAML payload."""
    resources = resources or ["氧气存量 (秒)", "鱼叉耐用度", "当日营收金币", "顾客耐心值"]
    rules = rules or [
        "氧气耗尽时必须被救援艇捞起，且丢失当日所捕获的 50% 食材",
        "夜间经营必须在 180 秒内完成顾客点餐与出餐匹配",
    ]
    hypotheses = hypotheses or [
        "在白盒原型中，潜水员与厨师的信息不对称沟通能产生欢快的紧张协作感",
        "夜间营收收益投入深海装备升级能形成强烈的正向驱动循环",
    ]
    player_experience_goals = player_experience_goals or [
        "深海探索的神秘敬畏与未知恐惧",
        "双人默契配合出餐的敏捷成就感",
    ]
    conflict_sources = conflict_sources or [
        "凶猛海洋肉食掠食者 AI",
        "挑剔苛刻的 VIP 顾客限时订单",
    ]
    payload = {
        "payload_type": "ConceptAndFormalElements",
        "version": "1.0",
        "high_concept": high_concept,
        "player_experience_goals": list(player_experience_goals),
        "formal_elements": {
            "players": players,
            "primary_objective": primary_obj,
            "core_rules": list(rules),
            "resources": list(resources),
            "conflict_sources": list(conflict_sources),
        },
        "hypotheses_to_test": list(hypotheses),
    }
    return dump_yaml(payload)


def generate_economy_yaml_payload(
    simulation_type: str = "economy",
    initial: float = 100.0,
    source: float = 20.0,
    growth: float = 0.0,
    sink: float = 15.0,
    dynamic_sink: float = 0.0,
    rounds: int = 25,
    dice_expression: Optional[str] = None,
    trials: int = 10000,
    seed: Optional[int] = None,
    players: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Generate a round-trippable EconomySimulationConfig payload."""
    if simulation_type == "economy":
        parameters: Dict[str, Any] = {
            "initial": initial,
            "source": source,
            "growth": growth,
            "sink": sink,
            "dynamic_sink": dynamic_sink,
            "rounds": rounds,
        }
        payload: Dict[str, Any] = {
            "payload_type": "EconomySimulationConfig",
            "version": "1.0",
            "simulation_type": simulation_type,
            "parameters": parameters,
        }
    elif simulation_type == "dice":
        payload = {
            "payload_type": "EconomySimulationConfig",
            "version": "1.0",
            "simulation_type": simulation_type,
            "parameters": {"expression": dice_expression or "4d6k3", "trials": trials, "seed": seed},
        }
    elif simulation_type == "versus_dice":
        versus = re.split(r"\s+vs\s+", (dice_expression or "1d20 vs 1d20").strip(), flags=re.IGNORECASE)
        if len(versus) != 2:
            raise ValueError("对抗掷骰格式必须是 '<表达式> vs <表达式>'")
        payload = {
            "payload_type": "EconomySimulationConfig",
            "version": "1.0",
            "simulation_type": simulation_type,
            "parameters": {"expression_a": versus[0], "expression_b": versus[1], "trials": trials, "seed": seed},
        }
    elif simulation_type == "multiplayer_economy":
        payload = {
            "payload_type": "EconomySimulationConfig",
            "version": "1.0",
            "simulation_type": simulation_type,
            "parameters": {"rounds": rounds},
            "players": list(players or [
                {"name": "A", "initial": 120.0, "source": 25.0, "growth": 0.06, "sink": 15.0},
                {"name": "B", "initial": 100.0, "source": 20.0, "growth": 0.02, "sink": 15.0},
                {"name": "C", "initial": 70.0, "source": 15.0, "growth": 0.0, "sink": 14.0},
            ]),
        }
    else:
        raise ValueError("未知经济模拟类型: {0}".format(simulation_type))
    return dump_yaml(payload)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Game Design Workshop: Advanced Probability & Virtual Economy Simulator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dice", "-d", type=str, help="掷骰表达式，例如 4d6k3、6d6>=4、1d20adv 或 2d6 vs 1d10")
    parser.add_argument("--trials", "-t", type=int, default=10000, help="蒙特卡洛模拟次数")
    parser.add_argument("--seed", type=int, help="随机种子，用于复现实验结果")
    parser.add_argument("--from-payload", "--from_payload", "-i", type=str, help="从文件、原始字符串或 stdin ('-') 载入契约")
    parser.add_argument("--economy-sim", action="store_true", help="运行单实体虚拟经济推演")
    parser.add_argument("--economy-multiplayer", action="store_true", help="运行多玩家经济与基尼系数推演")
    parser.add_argument("--export-payload", "--export-yaml", "--export_yaml", action="store_true", help="输出可往返的 EconomySimulationConfig YAML")
    parser.add_argument("--export-json", "--export_json", action="store_true", help="只输出 JSON")
    parser.add_argument("--initial", type=float, default=100.0, help="经济初始资金")
    parser.add_argument("--source", type=float, default=20.0, help="每回合基础产出")
    parser.add_argument("--growth", type=float, default=0.0, help="正反馈增长系数")
    parser.add_argument("--sink", type=float, default=15.0, help="每回合基础消耗")
    parser.add_argument("--dynamic-sink", type=float, default=0.0, help="动态消耗系数")
    parser.add_argument("--rounds", type=int, default=25, help="推演回合数")
    args = parser.parse_args()

    try:
        loaded_players: Optional[List[Dict[str, Any]]] = None
        if args.from_payload:
            loaded = parse_and_validate_payload(args.from_payload, {"EconomySimulationConfig"})
            extracted = extract_economy_parameters(loaded)
            for key, value in extracted.items():
                setattr(args, key, int(value) if key in {"rounds", "trials", "seed"} else value)
            simulation_type = loaded.get("simulation_type")
            parameters = loaded.get("parameters", {})
            if simulation_type == "economy":
                args.economy_sim = True
            elif simulation_type == "multiplayer_economy":
                args.economy_multiplayer = True
                loaded_players = loaded.get("players")
            elif simulation_type == "dice":
                args.dice = parameters.get("expression")
            elif simulation_type == "versus_dice":
                args.dice = "{0} vs {1}".format(parameters.get("expression_a"), parameters.get("expression_b"))
            if not (args.export_json or args.export_payload):
                print("📥 成功载入上游契约载荷 [{0}]".format(loaded.get("payload_type", "Unknown")), file=sys.stderr)

        if args.export_payload:
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

        if args.economy_multiplayer:
            players = loaded_players or [
                {"name": "领跑优势方 A", "initial": 120.0, "source": 25.0, "growth": 0.06, "sink": 15.0},
                {"name": "均势普通方 B", "initial": 100.0, "source": 20.0, "growth": 0.02, "sink": 15.0},
                {"name": "受挫落后方 C", "initial": 70.0, "source": 15.0, "growth": 0.00, "sink": 14.0},
            ]
            result = simulate_multiplayer_economy(players, args.rounds)
            if args.export_json:
                print(dump_json(result))
                return
            print("👥 多人经济推演 {0} 轮 | 终局基尼系数: {1:.3f} | 首尾倍率: {2:.2f}".format(
                result["rounds"], result["final_gini"], result["lead_gap_ratio"]
            ))
            return

        if args.economy_sim:
            history = simulate_economy(args.initial, args.source, args.growth, args.sink, args.rounds, args.dynamic_sink)
            result = {"parameters": {
                "initial": args.initial,
                "source": args.source,
                "growth": args.growth,
                "sink": args.sink,
                "dynamic_sink": args.dynamic_sink,
                "rounds": args.rounds,
            }, "history": history}
            if args.export_json:
                print(dump_json(result))
                return
            ends = [entry["end"] for entry in history]
            print("💰 单人经济推演 {0} 轮 | 初始: {1:.2f} | 终局: {2:.2f}".format(args.rounds, args.initial, ends[-1]))
            print_ascii_chart(ends)
            return

        expression = args.dice or "4d6k3"
        versus = re.split(r"\s+vs\s+", expression.strip(), flags=re.IGNORECASE)
        if len(versus) == 2:
            result = simulate_versus_dice(versus[0], versus[1], args.trials, seed=args.seed)
            if args.export_json:
                print(dump_json(result))
                return
            print("⚔️ [{0}] 胜率 {1:.2f}% | [{2}] 胜率 {3:.2f}% | 平局 {4:.2f}%".format(
                result["expr_a"], result["win_rate_a"], result["expr_b"], result["win_rate_b"], result["draw_rate"]
            ))
            return
        if len(versus) != 1:
            raise ValueError("对抗掷骰格式必须是 '<表达式> vs <表达式>'")

        result = simulate_single_dice(expression, args.trials, seed=args.seed)
        if args.export_json:
            print(dump_json(result))
            return
        print("🎲 [{0}] 均值 {1:.3f} | 观测范围 {2}~{3} | 理论范围 {4}~{5}".format(
            result["expr"], result["mean"], result["min"], result["max"],
            result["theoretical_min"], "∞" if result["theoretical_max"] is None else result["theoretical_max"]
        ))
        print_ascii_histogram(result["distribution"], result["cdf_ge"], result["trials"])
    except (ValueError, PayloadError, KeyError, TypeError, ArithmeticError, OverflowError) as exc:
        print("❌ {0}".format(exc), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()

