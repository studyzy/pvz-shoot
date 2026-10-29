#!/usr/bin/env python3
"""
Nintendo Game Feel & Kinematics Calculator
任天堂手感动力学计算器：跳跃非对称重力反解、水平惯性急刹、输入容错与打击感帧数毫秒换算、ASCII轨迹可视化、多引擎(Unity/Godot/Unreal)代码与YAML标准契约生成器。

Usage:
    python game_feel_calculator.py --height 3.5 --apex_time 0.38 --fall_multiplier 1.8
    python game_feel_calculator.py --height 3.5 --speed 8.0 --acc_time 0.15 --skid_time 0.12 --render-ascii
    python game_feel_calculator.py --height 4.0 --apex_time 0.4 --fps 60 --export-code unity
    python game_feel_calculator.py --height 4.0 --apex_time 0.4 --fps 60 --export-code godot
    python game_feel_calculator.py --height 4.0 --apex_time 0.4 --fps 60 --export-code unreal
    python game_feel_calculator.py --export-payload
"""

import argparse
import math
import sys
from typing import Dict, Any, Optional

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



def solve_jump_kinematics(height: float, apex_time: float, fall_multiplier: float = 1.8) -> Dict[str, float]:
    """Solve asymmetric vertical jump parameters from design targets."""
    values = {"height": height, "apex_time": apex_time, "fall_multiplier": fall_multiplier}
    for name, value in values.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError("{0} 必须是有限数值".format(name))
        if value <= 0:
            raise ValueError("{0} 必须大于 0".format(name))
    if height > 10000.0:
        raise ValueError("height 不能超过 10,000 米")
    if apex_time < 0.01 or apex_time > 60.0:
        raise ValueError("apex_time 必须位于 0.01 到 60 秒之间")
    if fall_multiplier > 100.0:
        raise ValueError("fall_multiplier 不能超过 100")
    gravity_up = 2.0 * height / apex_time ** 2
    jump_velocity = 2.0 * height / apex_time
    gravity_down = gravity_up * fall_multiplier
    fall_time = math.sqrt(2.0 * height / gravity_down)
    impact_velocity = math.sqrt(2.0 * gravity_down * height)
    calculated = (gravity_up, jump_velocity, gravity_down, fall_time, impact_velocity)
    if not all(math.isfinite(value) for value in calculated):
        raise ValueError("跳跃参数导致数值溢出，请缩小高度、重力倍率或时间范围")
    return {
        "height": float(height),
        "apex_time": float(apex_time),
        "fall_multiplier": float(fall_multiplier),
        "jump_velocity": jump_velocity,
        "gravity_up": gravity_up,
        "gravity_down": gravity_down,
        "fall_time": fall_time,
        "total_air_time": apex_time + fall_time,
        "impact_velocity": impact_velocity,
        "terminal_velocity": impact_velocity * 1.3,
        "short_jump_cut_multiplier": 0.45,
    }


def solve_horizontal_kinematics(
    max_speed: float = 8.0,
    time_to_max: float = 0.15,
    skid_time: float = 0.12,
    air_control: float = 0.65,
) -> Dict[str, float]:
    """Solve horizontal acceleration, braking, and air-control parameters."""
    values = {"max_speed": max_speed, "time_to_max": time_to_max, "skid_time": skid_time, "air_control": air_control}
    for name, value in values.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError("{0} 必须是有限数值".format(name))
    if max_speed <= 0 or time_to_max <= 0 or skid_time <= 0:
        raise ValueError("速度、加速时间和急刹时间必须大于 0")
    if max_speed > 10000.0 or time_to_max > 60.0 or skid_time > 60.0:
        raise ValueError("速度不能超过 10,000m/s，加速与急刹时间不能超过 60 秒")
    if not 0.0 <= air_control <= 1.0:
        raise ValueError("air_control 必须位于 0.0 到 1.0 之间")
    acceleration = max_speed / time_to_max
    skid_deceleration = max_speed / skid_time
    friction_deceleration = acceleration * 0.8
    friction_stop_time = max_speed / friction_deceleration
    calculated = (acceleration, skid_deceleration, friction_deceleration, friction_stop_time)
    if not all(math.isfinite(value) for value in calculated):
        raise ValueError("水平动力学参数导致数值溢出")
    return {
        "max_speed": float(max_speed),
        "time_to_max": float(time_to_max),
        "acceleration": acceleration,
        "skid_time": float(skid_time),
        "skid_deceleration": skid_deceleration,
        "skid_distance": 0.5 * max_speed * skid_time,
        "friction_deceleration": friction_deceleration,
        "friction_stop_time": friction_stop_time,
        "friction_stop_distance": 0.5 * max_speed * friction_stop_time,
        "air_control": float(air_control),
    }


def calculate_tolerances(fps: int = 60) -> Dict[str, Any]:
    """Convert fixed millisecond grace windows to a validated target frame rate."""
    if not isinstance(fps, int) or isinstance(fps, bool) or fps < 10 or fps > 1000:
        raise ValueError("fps 必须是 10 到 1000 之间的整数")
    frame_duration_ms = 1000.0 / fps
    coyote_time_ms = 83.3
    input_buffer_ms = 116.6
    light_hitstop_frames = 3
    heavy_hitstop_frames = 8
    screen_shake_frames = 4
    return {
        "fps": fps,
        "frame_duration_ms": frame_duration_ms,
        "coyote_time_ms": coyote_time_ms,
        "coyote_time_frames": round(coyote_time_ms / frame_duration_ms),
        "input_buffer_ms": input_buffer_ms,
        "input_buffer_frames": round(input_buffer_ms / frame_duration_ms),
        "light_hitstop_frames": light_hitstop_frames,
        "light_hitstop_ms": light_hitstop_frames * frame_duration_ms,
        "heavy_hitstop_frames": heavy_hitstop_frames,
        "heavy_hitstop_ms": heavy_hitstop_frames * frame_duration_ms,
        "screen_shake_frames": screen_shake_frames,
        "screen_shake_ms": screen_shake_frames * frame_duration_ms,
        "corner_slip_pixels": 4,
    }


def render_ascii_jump_trajectory(
    k_vert: dict,
    k_horiz: Optional[dict] = None,
    width: int = 56,
    height: int = 12,
) -> str:
    """Render a validated asymmetric jump trajectory in the terminal."""
    if width < 2 or height < 2:
        raise ValueError("ASCII 轨迹图宽度和高度必须至少为 2")
    t_apex = float(k_vert["apex_time"])
    t_fall = float(k_vert["fall_time"])
    total_time = float(k_vert["total_air_time"])
    maximum_height = float(k_vert["height"])
    gravity_up = float(k_vert["gravity_up"])
    gravity_down = float(k_vert["gravity_down"])
    initial_velocity = float(k_vert["jump_velocity"])
    if min(t_apex, t_fall, total_time, maximum_height, gravity_up, gravity_down, initial_velocity) <= 0:
        raise ValueError("轨迹参数必须全部为正数")

    canvas = [[" " for _ in range(width)] for _ in range(height)]
    for column in range(width):
        time_value = column / (width - 1) * total_time
        if time_value <= t_apex:
            y_value = initial_velocity * time_value - 0.5 * gravity_up * time_value ** 2
        else:
            relative_time = time_value - t_apex
            y_value = maximum_height - 0.5 * gravity_down * relative_time ** 2
        y_value = max(0.0, min(maximum_height, y_value))
        row = int((height - 1) - y_value / maximum_height * (height - 1))
        if abs(time_value - t_apex) < total_time / width:
            canvas[row][column] = "★"
        elif time_value < t_apex:
            canvas[row][column] = "▲"
        else:
            canvas[row][column] = "▼"

    output = ["   ┌{0}┐  [高度 Y: {1:.1f}m]".format("─" * width, maximum_height)]
    for row_index, row_values in enumerate(canvas):
        y_label = maximum_height * (1.0 - row_index / (height - 1))
        tag = "{0:4.1f}m│".format(y_label) if row_index % 3 == 0 or row_index == height - 1 else "     │"
        output.append(tag + "".join(row_values) + "│")
    output.append("   └{0}┘".format("─" * width))
    output.append("     0.0s (起跳)      t_apex={0:.2f}s (最高点)      t_total={1:.2f}s (落地)".format(t_apex, total_time))
    output.append("     图例: ▲ 上升段 | ★ 顶点 | ▼ 非对称下落")
    return "\n".join(output)


def generate_unity_csharp(k_vert: dict, k_horiz: dict, t: dict) -> str:
    return f"""// ============================================================================
// Nintendo-Style Mario Kinematics Controller (Unity C#)
// Generated by game_feel_calculator.py
// ============================================================================
using UnityEngine;

[RequireComponent(typeof(CharacterController))]
public class MarioKinematicsController : MonoBehaviour
{{
    [Header("Horizontal Kinematics (Run & Skid)")]
    public float maxSpeed = {k_horiz['max_speed']:.2f}f;
    public float acceleration = {k_horiz['acceleration']:.2f}f;
    public float skidDeceleration = {k_horiz['skid_deceleration']:.2f}f;
    public float airControl = {k_horiz['air_control']:.2f}f;

    [Header("Jump Parameters (Calculated)")]
    public float jumpHeight = {k_vert['height']:.2f}f;
    public float timeToApex = {k_vert['apex_time']:.2f}f;
    public float fallMultiplier = {k_vert['fall_multiplier']:.2f}f;

    [Header("Runtime Physics (Read Only)")]
    [SerializeField] private float jumpVelocity = {k_vert['jump_velocity']:.2f}f;
    [SerializeField] private float gravityUp = {k_vert['gravity_up']:.2f}f;
    [SerializeField] private float gravityDown = {k_vert['gravity_down']:.2f}f;
    [SerializeField] private float terminalVelocity = {k_vert['terminal_velocity']:.2f}f;

    [Header("Grace & Ergonomics")]
    public float coyoteTime = {t['coyote_time_ms'] / 1000.0:.3f}f; // {t['coyote_time_frames']} frames @{t['fps']}fps
    public float inputBufferTime = {t['input_buffer_ms'] / 1000.0:.3f}f; // {t['input_buffer_frames']} frames @{t['fps']}fps

    private float _coyoteTimer;
    private float _bufferTimer;
    private Vector3 _velocity;
    private CharacterController _controller;

    private void Awake()
    {{
        _controller = GetComponent<CharacterController>();
        // 动态确保物理一致性
        gravityUp = (2f * jumpHeight) / Mathf.Pow(timeToApex, 2);
        jumpVelocity = (2f * jumpHeight) / timeToApex;
        gravityDown = gravityUp * fallMultiplier;
        terminalVelocity = Mathf.Sqrt(2f * gravityDown * jumpHeight) * 1.3f;
    }}

    private void Update()
    {{
        bool isGrounded = _controller.isGrounded;
        float inputX = Input.GetAxisRaw("Horizontal");

        // 1. 水平运动与急刹处理 (Horizontal Kinematics)
        float targetSpeed = inputX * maxSpeed;
        float currentAcc = isGrounded ? acceleration : (acceleration * airControl);
        
        // 检测急刹 (当前速度与输入方向相反)
        if (isGrounded && inputX != 0 && Mathf.Sign(inputX) != Mathf.Sign(_velocity.x) && Mathf.Abs(_velocity.x) > 0.5f)
        {{
            currentAcc = skidDeceleration; // 触发急刹减速
        }}
        _velocity.x = Mathf.MoveTowards(_velocity.x, targetSpeed, currentAcc * Time.deltaTime);

        // 2. 土狼时间与输入缓冲 (Grace Timers)
        if (isGrounded)
        {{
            _coyoteTimer = coyoteTime;
            if (_velocity.y < 0) _velocity.y = -2f; // 贴地吸附
        }}
        else
        {{
            _coyoteTimer -= Time.deltaTime;
        }}

        if (Input.GetButtonDown("Jump"))
        {{
            _bufferTimer = inputBufferTime;
        }}
        else
        {{
            _bufferTimer -= Time.deltaTime;
        }}

        // 3. 触发跳跃: 拥有缓冲 且 在土狼时间内
        if (_bufferTimer > 0f && _coyoteTimer > 0f)
        {{
            _velocity.y = jumpVelocity;
            _bufferTimer = 0f;
            _coyoteTimer = 0f;
        }}

        // 4. 非对称垂直重力应用 (长按大跳与短按小跳截断)
        if (_velocity.y > 0)
        {{
            // 上升阶段: 松开跳跃键提前施加下落重力截断
            float currentGravity = Input.GetButton("Jump") ? gravityUp : gravityDown;
            _velocity.y -= currentGravity * Time.deltaTime;
        }}
        else
        {{
            // 下落阶段: 始终施加干脆迅猛的下落重力
            _velocity.y -= gravityDown * Time.deltaTime;
            _velocity.y = Mathf.Max(_velocity.y, -terminalVelocity);
        }}

        _controller.Move(_velocity * Time.deltaTime);
    }}
}}
"""


def generate_godot_gdscript(k_vert: dict, k_horiz: dict, t: dict) -> str:
    return f"""# ============================================================================
# Nintendo-Style Mario Kinematics Controller (Godot 4 GDScript)
# Generated by game_feel_calculator.py
# ============================================================================
extends CharacterBody2D

@export_group("Horizontal Kinematics")
@export var max_speed: float = {k_horiz['max_speed'] * 50.0:.1f} # 像素/秒
@export var acceleration: float = {k_horiz['acceleration'] * 50.0:.1f}
@export var skid_deceleration: float = {k_horiz['skid_deceleration'] * 50.0:.1f}
@export var air_control: float = {k_horiz['air_control']:.2f}

@export_group("Jump Kinematics")
@export var jump_height: float = {k_vert['height'] * 50.0:.1f} # 像素高度
@export var time_to_apex: float = {k_vert['apex_time']:.2f}
@export var fall_multiplier: float = {k_vert['fall_multiplier']:.2f}

@export_group("Grace & Ergonomics")
@export var coyote_time: float = {t['coyote_time_ms'] / 1000.0:.3f} # {t['coyote_time_frames']} frames
@export var input_buffer_time: float = {t['input_buffer_ms'] / 1000.0:.3f} # {t['input_buffer_frames']} frames

var jump_velocity: float
var gravity_up: float
var gravity_down: float
var terminal_velocity: float

var coyote_timer: float = 0.0
var buffer_timer: float = 0.0

func _ready() -> void:
    gravity_up = (2.0 * jump_height) / pow(time_to_apex, 2)
    jump_velocity = -((2.0 * jump_height) / time_to_apex) # Godot Y轴向下为正
    gravity_down = gravity_up * fall_multiplier
    terminal_velocity = {k_vert['terminal_velocity'] * 50.0:.1f}

func _physics_process(delta: float) -> void:
    var input_x := Input.get_axis("ui_left", "ui_right")

    # 水平运动与急刹
    var target_speed := input_x * max_speed
    var current_acc := acceleration if is_on_floor() else (acceleration * air_control)
    if is_on_floor() and input_x != 0 and sign(input_x) != sign(velocity.x) and abs(velocity.x) > 10.0:
        current_acc = skid_deceleration
    velocity.x = move_toward(velocity.x, target_speed, current_acc * delta)

    # 容错缓冲
    if is_on_floor():
        coyote_timer = coyote_time
    else:
        coyote_timer -= delta

    if Input.is_action_just_pressed("ui_accept"):
        buffer_timer = input_buffer_time
    else:
        buffer_timer -= delta

    # 跳跃触发
    if buffer_timer > 0.0 and coyote_timer > 0.0:
        velocity.y = jump_velocity
        buffer_timer = 0.0
        coyote_timer = 0.0

    # 非对称重力处理
    if velocity.y < 0:
        var g = gravity_up if Input.is_action_pressed("ui_accept") else gravity_down
        velocity.y += g * delta
    else:
        velocity.y += gravity_down * delta
        velocity.y = min(velocity.y, terminal_velocity)

    move_and_slide()
"""


def generate_unreal_cpp(k_vert: dict, k_horiz: dict, t: dict) -> str:
    return f"""// ============================================================================
// Nintendo-Style Mario Kinematics Configuration (Unreal Engine 5 C++ & CMC)
// Generated by game_feel_calculator.py
// ============================================================================
// 在 ACharacter 派生类的构造函数或 BeginPlay 中配置 UCharacterMovementComponent (CMC):

void AMarioCharacter::SetupNintendoKinematics()
{{
    UCharacterMovementComponent* CMC = GetCharacterMovement();
    if (!CMC) return;

    // 1. 水平奔跑与急刹摩擦力 (CMC Parameters in cm/s)
    CMC->MaxWalkSpeed = {k_horiz['max_speed'] * 100.0:.1f}f;                 // 最大跑速 ({k_horiz['max_speed']:.2f} m/s)
    CMC->MaxAcceleration = {k_horiz['acceleration'] * 100.0:.1f}f;             // 起步加速度 ({k_horiz['acceleration']:.2f} m/s²)
    CMC->BrakingDecelerationWalking = {k_horiz['skid_deceleration'] * 100.0:.1f}f; // 急刹减速度 ({k_horiz['skid_deceleration']:.2f} m/s²)
    CMC->GroundFriction = 8.0f;                                     // 地面摩擦系数 (干脆起步与刹停)
    CMC->AirControl = {k_horiz['air_control']:.2f}f;                                    // 空中操控度 (保留起跳惯性但可微调)

    // 2. 垂直起跳与非对称重力 (Unreal Z-Axis in cm/s)
    CMC->JumpZVelocity = {k_vert['jump_velocity'] * 100.0:.1f}f;              // 初速度 ({k_vert['jump_velocity']:.2f} m/s -> {k_vert['height']:.2f}m 高度)
    
    // Unreal 默认重力为 980 cm/s² (9.8 m/s²), 计算重力比例:
    const float UnrealBaseGravity = 980.0f;
    const float DesiredUpGravity = {k_vert['gravity_up'] * 100.0:.1f}f;
    const float DesiredDownGravity = {k_vert['gravity_down'] * 100.0:.1f}f;

    CMC->GravityScale = DesiredUpGravity / UnrealBaseGravity;       // 上升基准重力倍率: {k_vert['gravity_up'] / 9.8:.2f}x
    
    // 3. 隐性输入容错与非对称 Tick 动态调节 (在 Tick 中根据下落状态动态调节 GravityScale):
    // if (CMC->Velocity.Z < 0.0f || !bIsJumpHeld)
    // {{
    //     CMC->GravityScale = {k_vert['gravity_down'] / 9.8:.2f}f; // 下落与小跳松键时快速下坠 ({k_vert['fall_multiplier']:.1f}x)
    // }}
    // else
    // {{
    //     CMC->GravityScale = {k_vert['gravity_up'] / 9.8:.2f}f;   // 正常上升重力
    // }}

    // 4. 土狼时间与输入缓冲配置 (毫秒与帧数):
    // CoyoteTime: {t['coyote_time_ms']:.1f} ms ({t['coyote_time_frames']} 帧 @{t['fps']}fps)
    // InputBufferTime: {t['input_buffer_ms']:.1f} ms ({t['input_buffer_frames']} 帧 @{t['fps']}fps)
}}
"""


def generate_yaml_payload(
    k_vert: dict,
    k_horiz: dict,
    t: dict,
    verb_name: str = "Mario Run & Jump",
    multi_solution_matrix: Optional[Dict[str, str]] = None,
) -> str:
    """Generate the canonical, safely quoted Contract 2 v1.1 payload."""
    matrix = multi_solution_matrix or {
        "movement": "水平惯性加速、急刹变向与非对称重力跳跃",
        "combat": "踏踩敌人跳跃借力、下落重力强化砸地冲击",
        "puzzle": "小跳与大跳高度差越过低空尖刺，急刹避开突然出现的陷阱",
    }
    payload = {
        "payload_type": "ToyAndKinematics",
        "version": "1.1",
        "toy_verb": verb_name,
        "multi_solution_matrix": dict(matrix),
        "kinematics_parameters": {
            "horizontal": {
                "max_speed_mps": round(float(k_horiz["max_speed"]), 4),
                "acceleration_mps2": round(float(k_horiz["acceleration"]), 4),
                "skid_deceleration_mps2": round(float(k_horiz["skid_deceleration"]), 4),
                "skid_distance_m": round(float(k_horiz["skid_distance"]), 4),
                "air_control_factor": round(float(k_horiz["air_control"]), 4),
            },
            "vertical": {
                "jump_height_m": round(float(k_vert["height"]), 4),
                "time_to_apex_s": round(float(k_vert["apex_time"]), 4),
                "fall_multiplier": round(float(k_vert["fall_multiplier"]), 4),
                "jump_velocity_mps": round(float(k_vert["jump_velocity"]), 4),
                "gravity_up_mps2": round(float(k_vert["gravity_up"]), 4),
                "gravity_down_mps2": round(float(k_vert["gravity_down"]), 4),
                "total_air_time_s": round(float(k_vert["total_air_time"]), 4),
            },
            "grace_and_juice": {
                "coyote_time_ms": round(float(t["coyote_time_ms"]), 4),
                "input_buffer_ms": round(float(t["input_buffer_ms"]), 4),
                "hitstop_light_frames": int(t["light_hitstop_frames"]),
                "hitstop_heavy_frames": int(t["heavy_hitstop_frames"]),
                "screen_shake_frames": int(t["screen_shake_frames"]),
            },
        },
    }
    return dump_yaml(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Nintendo Game Feel & Kinematics Calculator")
    parser.add_argument("--height", "-H", type=float, default=3.5, help="目标跳跃高度")
    parser.add_argument("--apex-time", "--apex_time", "-T", dest="apex_time", type=float, default=0.38, help="到达最高点时间")
    parser.add_argument("--fall-multiplier", "--fall_multiplier", "-F", dest="fall_multiplier", type=float, default=1.8, help="下落重力倍率")
    parser.add_argument("--speed", "-S", type=float, default=8.0, help="最大奔跑速度")
    parser.add_argument("--acc-time", "--acc_time", dest="acc_time", type=float, default=0.15, help="加速至满速时间")
    parser.add_argument("--skid-time", "--skid_time", dest="skid_time", type=float, default=0.12, help="急刹至停稳时间")
    parser.add_argument("--air-control", "--air_control", dest="air_control", type=float, default=0.65, help="空中操控系数 0~1")
    parser.add_argument("--fps", type=int, default=60, help="目标帧率")
    parser.add_argument("--toy-verb", "--toy_verb", dest="toy_verb", default="Mario Standard Jump & Skid", help="核心玩具动词")
    parser.add_argument("--from-payload", "--from_payload", "-i", dest="from_payload", help="从文件、字符串或 stdin ('-') 载入 Contract 2")
    parser.add_argument("--render-ascii", action="store_true", help="绘制 ASCII 跳跃轨迹")
    parser.add_argument("--export-code", "--export_code", choices=["unity", "godot", "unreal", "none"], default="none", help="输出引擎集成起始代码")
    parser.add_argument("--export-payload", "--export-yaml", "--export_yaml", dest="export_payload", action="store_true", help="只输出 Contract 2 YAML")
    parser.add_argument("--export-json", "--export_json", dest="export_json", action="store_true", help="只输出 JSON")
    args = parser.parse_args()

    try:
        if args.from_payload:
            loaded = parse_and_validate_payload(args.from_payload, {"ConceptAndFormalElements", "ToyAndKinematics"})
            if "toy_verb" in loaded:
                args.toy_verb = str(loaded["toy_verb"])
            elif "high_concept" in loaded:
                args.toy_verb = str(loaded["high_concept"])
            extracted = extract_kinematics(loaded)
            if extracted.get("jump_height") is not None:
                args.height = extracted["jump_height"]
            if extracted.get("time_to_apex") is not None:
                args.apex_time = extracted["time_to_apex"]
            if extracted.get("fall_multiplier") is not None:
                args.fall_multiplier = extracted["fall_multiplier"]
            if extracted.get("speed") is not None:
                args.speed = extracted["speed"]
            if extracted.get("air_control") is not None:
                args.air_control = extracted["air_control"]
            if not (args.export_payload or args.export_json or args.export_code != "none"):
                print("📥 成功载入上游契约载荷 [{0}]".format(loaded.get("payload_type", "Unknown")), file=sys.stderr)

        vertical = solve_jump_kinematics(args.height, args.apex_time, args.fall_multiplier)
        horizontal = solve_horizontal_kinematics(args.speed, args.acc_time, args.skid_time, args.air_control)
        tolerances = calculate_tolerances(args.fps)

        if args.export_payload:
            print(generate_yaml_payload(vertical, horizontal, tolerances, args.toy_verb))
            return
        if args.export_json:
            print(dump_json({
                "toy_verb": args.toy_verb,
                "vertical": vertical,
                "horizontal": horizontal,
                "tolerances": tolerances,
            }))
            return
        if args.export_code == "unity":
            print(generate_unity_csharp(vertical, horizontal, tolerances))
            return
        if args.export_code == "godot":
            print(generate_godot_gdscript(vertical, horizontal, tolerances))
            return
        if args.export_code == "unreal":
            print(generate_unreal_cpp(vertical, horizontal, tolerances))
            return

        print("🍄 核心动词: {0}".format(args.toy_verb))
        print("跳跃高度 {0:.2f}m | 顶点时间 {1:.3f}s | 跑速 {2:.2f}m/s".format(
            vertical["height"], vertical["apex_time"], horizontal["max_speed"]
        ))
        print("起跳速度 {0:.2f}m/s | 上升重力 {1:.2f}m/s² | 下落重力 {2:.2f}m/s²".format(
            vertical["jump_velocity"], vertical["gravity_up"], vertical["gravity_down"]
        ))
        print("土狼时间 {0:.1f}ms ({1} 帧) | 输入缓冲 {2:.1f}ms ({3} 帧)".format(
            tolerances["coyote_time_ms"], tolerances["coyote_time_frames"],
            tolerances["input_buffer_ms"], tolerances["input_buffer_frames"]
        ))
        if args.render_ascii:
            print(render_ascii_jump_trajectory(vertical, horizontal))
    except (ValueError, PayloadError, KeyError, TypeError, ArithmeticError, OverflowError) as exc:
        print("❌ {0}".format(exc), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()

