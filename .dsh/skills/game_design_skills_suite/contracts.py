#!/usr/bin/env python3
"""Shared payload contracts for the Game Design Skills Suite.

The module deliberately has no mandatory third-party dependencies. It accepts
strict JSON and the deterministic YAML subset emitted by :func:`dump_yaml`,
including nested mappings, scalar sequences, sequences of mappings, and
multi-document streams. Parsing semantics never change based on optional
third-party packages installed in the environment.
"""

from __future__ import annotations

import ast
import json
import math
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, cast


class PayloadError(ValueError):
    """Raised when a payload cannot be parsed or violates its contract."""


PAYLOAD_ORDER = [
    "ConceptAndFormalElements",
    "ToyAndKinematics",
    "SpatialTopologyAndEncounters",
    "FullSystemAudit",
]

SUPPORTED_VERSIONS = {
    "ConceptAndFormalElements": {"1.0"},
    "ToyAndKinematics": {"1.0", "1.1"},
    "SpatialTopologyAndEncounters": {"1.1"},
    "FullSystemAudit": {"1.0", "1.1"},
    "EconomySimulationConfig": {"1.0"},
}

PAYLOAD_DESCRIPTIONS = {
    "ConceptAndFormalElements": "Contract 1: concept, experience goals, and formal elements",
    "ToyAndKinematics": "Contract 2: core toy verb and gameplay kinematics",
    "SpatialTopologyAndEncounters": "Contract 3: spatial metrics, encounters, and pacing",
    "FullSystemAudit": "Contract 4: lens audit, tetrad balance, and surgical fixes",
    "EconomySimulationConfig": "Standalone economy or dice simulation configuration",
}


# ---------------------------------------------------------------------------
# Source loading and YAML/JSON parsing
# ---------------------------------------------------------------------------


def _read_source(source: str) -> str:
    if source == "-":
        return sys.stdin.read()
    try:
        if os.path.isfile(source):
            with open(source, "r", encoding="utf-8") as handle:
                return handle.read()
    except (OSError, ValueError):
        # Treat values that are not valid filesystem paths as inline payloads.
        pass
    return source


def _split_yaml_documents(raw_text: str) -> List[str]:
    documents: List[List[str]] = [[]]
    for raw_line in raw_text.splitlines():
        marker = raw_line.strip()
        is_top_level_marker = raw_line == marker
        if marker == "---" and is_top_level_marker:
            if any(line.strip() for line in documents[-1]):
                documents.append([])
            continue
        if marker == "..." and is_top_level_marker:
            if any(line.strip() for line in documents[-1]):
                documents.append([])
            continue
        documents[-1].append(raw_line)
    return ["\n".join(lines).strip() for lines in documents if any(line.strip() for line in lines)]


def _strip_inline_comment(value: str) -> str:
    quote: Optional[str] = None
    escaped = False
    bracket_depth = 0
    for index, char in enumerate(value):
        if escaped:
            escaped = False
            continue
        if char == "\\" and quote == '"':
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
        elif char in "[{(":
            bracket_depth += 1
        elif char in "]})":
            bracket_depth = max(0, bracket_depth - 1)
        elif char == "#" and bracket_depth == 0 and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value.rstrip()


def _find_mapping_colon(text: str) -> int:
    quote: Optional[str] = None
    escaped = False
    bracket_depth = 0
    for index, char in enumerate(text):
        if escaped:
            escaped = False
            continue
        if char == "\\" and quote == '"':
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
        elif char in "[{(":
            bracket_depth += 1
        elif char in "]})":
            bracket_depth = max(0, bracket_depth - 1)
        elif char == ":" and bracket_depth == 0:
            return index
    return -1


def _reject_duplicate_object_pairs(pairs: Iterable[Tuple[str, Any]]) -> Dict[str, Any]:
    mapping: Dict[str, Any] = {}
    for key, value in pairs:
        if key in mapping:
            raise PayloadError("Duplicate JSON key '{0}'".format(key))
        mapping[key] = value
    return mapping


def _strict_json_loads(raw_text: str) -> Any:
    try:
        return json.loads(raw_text, object_pairs_hook=_reject_duplicate_object_pairs)
    except PayloadError:
        raise
    except json.JSONDecodeError:
        raise


def dump_json(data: Any, indent: int = 2) -> str:
    """Serialize standards-compliant JSON and reject NaN/Infinity."""
    try:
        return json.dumps(data, indent=indent, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise PayloadError("Cannot serialize strict JSON: {0}".format(exc)) from exc


def _parse_scalar(raw_value: str) -> Any:
    value = _strip_inline_comment(raw_value).strip()
    if value == "":
        return ""

    lowered = value.lower()
    if lowered in {"null", "none", "~"}:
        return None
    if lowered == "true":
        return True
    if lowered == "false":
        return False

    if value.startswith('"'):
        try:
            parsed = _strict_json_loads(value)
        except json.JSONDecodeError as exc:
            raise PayloadError("Invalid double-quoted YAML string: {0}".format(value)) from exc
        if not isinstance(parsed, str):
            raise PayloadError("Expected a quoted string, got: {0}".format(value))
        return parsed

    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            raise PayloadError("Invalid single-quoted YAML string: {0}".format(value))
        return value[1:-1].replace("''", "'")

    if value.startswith("[") or value.startswith("{"):
        try:
            return _strict_json_loads(value)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(value)
            except (ValueError, SyntaxError) as exc:
                raise PayloadError("Invalid inline YAML collection: {0}".format(value)) from exc
            if isinstance(parsed, dict):
                raise PayloadError("Inline YAML mappings must use strict JSON syntax")
            if not isinstance(parsed, list):
                raise PayloadError("Inline YAML value must be a list or mapping: {0}".format(value))
            return parsed

    if re.match(r"^[+-]?\d+$", value):
        return int(value)
    if re.match(r"^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$", value):
        parsed_float = float(value)
        if not math.isfinite(parsed_float):
            raise PayloadError("Non-finite numbers are not supported")
        return parsed_float

    return value


def _parse_key(raw_key: str) -> str:
    key = raw_key.strip()
    if not key:
        raise PayloadError("YAML mapping keys cannot be empty")
    if key.startswith(('"', "'")):
        parsed = _parse_scalar(key)
        if not isinstance(parsed, str):
            raise PayloadError("YAML mapping keys must be strings")
        return parsed
    return key


def _parse_yaml_subset(document: str) -> Any:
    lines: List[Tuple[int, str, int]] = []
    for line_number, raw_line in enumerate(document.splitlines(), 1):
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if "\t" in raw_line[: len(raw_line) - len(raw_line.lstrip())]:
            raise PayloadError("Tabs are not allowed for YAML indentation (line {0})".format(line_number))
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        content = raw_line[indent:].rstrip()
        lines.append((indent, content, line_number))

    if not lines:
        return {}

    def parse_block(index: int, indent: int) -> Tuple[Any, int]:
        if index >= len(lines):
            return {}, index

        is_sequence = lines[index][0] == indent and (
            lines[index][1] == "-" or lines[index][1].startswith("- ")
        )
        container: Any = [] if is_sequence else {}

        while index < len(lines):
            current_indent, content, line_number = lines[index]
            if current_indent < indent:
                break
            if current_indent > indent:
                raise PayloadError("Unexpected indentation on line {0}".format(line_number))

            current_is_sequence = content == "-" or content.startswith("- ")
            if current_is_sequence != is_sequence:
                raise PayloadError("Cannot mix mapping and sequence entries at line {0}".format(line_number))

            if is_sequence:
                item_text = content[1:].strip()
                index += 1
                if not item_text:
                    if index < len(lines) and lines[index][0] > indent:
                        item, index = parse_block(index, lines[index][0])
                    else:
                        item = None
                    container.append(item)
                    continue

                colon_index = _find_mapping_colon(item_text)
                if colon_index >= 0:
                    key = _parse_key(item_text[:colon_index])
                    raw_value = item_text[colon_index + 1 :].strip()
                    item_map: Dict[str, Any] = {}
                    if raw_value:
                        item_map[key] = _parse_scalar(raw_value)
                    elif index < len(lines) and lines[index][0] > indent + 2:
                        item_map[key], index = parse_block(index, lines[index][0])
                    else:
                        item_map[key] = {}

                    if index < len(lines) and lines[index][0] > indent:
                        tail, index = parse_block(index, lines[index][0])
                        if not isinstance(tail, dict):
                            raise PayloadError("Sequence mapping tail must be a mapping near line {0}".format(line_number))
                        for tail_key, tail_value in tail.items():
                            if tail_key in item_map:
                                raise PayloadError("Duplicate YAML key '{0}' near line {1}".format(tail_key, line_number))
                            item_map[tail_key] = tail_value
                    container.append(item_map)
                else:
                    container.append(_parse_scalar(item_text))
                continue

            colon_index = _find_mapping_colon(content)
            if colon_index < 0:
                raise PayloadError("Expected 'key: value' on line {0}".format(line_number))
            key = _parse_key(content[:colon_index])
            if key in container:
                raise PayloadError("Duplicate YAML key '{0}' on line {1}".format(key, line_number))
            raw_value = content[colon_index + 1 :].strip()
            index += 1
            if raw_value:
                container[key] = _parse_scalar(raw_value)
            elif index < len(lines) and lines[index][0] > indent:
                container[key], index = parse_block(index, lines[index][0])
            else:
                container[key] = {}

        return container, index

    parsed, final_index = parse_block(0, lines[0][0])
    if final_index != len(lines):
        _, _, line_number = lines[final_index]
        raise PayloadError("Could not parse YAML near line {0}".format(line_number))
    return parsed


def parse_payload_documents(source: str) -> List[Dict[str, Any]]:
    """Parse a path, stdin marker, or inline JSON/YAML payload stream."""
    raw_text = _read_source(source).lstrip("\ufeff").strip()
    if not raw_text:
        return []

    # A single JSON document is the fastest and most exact path.
    try:
        parsed_json = _strict_json_loads(raw_text)
    except json.JSONDecodeError:
        parsed_json = None
    else:
        if not isinstance(parsed_json, dict):
            raise PayloadError("Payload root must be a mapping/object")
        return [parsed_json]

    documents = _split_yaml_documents(raw_text)
    if not documents:
        return []

    parsed_documents: List[Dict[str, Any]] = []
    for document in documents:
        parsed = _parse_yaml_subset(document)
        if parsed is None:
            continue
        if not isinstance(parsed, dict):
            raise PayloadError("Each payload document root must be a mapping/object")
        parsed_documents.append(parsed)
    return parsed_documents


def parse_payload_data(source: str) -> Dict[str, Any]:
    """Parse exactly one payload document.

    Multi-document streams are intentionally rejected so callers cannot
    silently merge or ignore contracts.
    """
    documents = parse_payload_documents(source)
    if not documents:
        return {}
    if len(documents) != 1:
        raise PayloadError(
            "Expected exactly one payload document, received {0}; use a bundle-aware command".format(len(documents))
        )
    return documents[0]


# ---------------------------------------------------------------------------
# Safe YAML serialization
# ---------------------------------------------------------------------------


def _dump_key(key: Any) -> str:
    if not isinstance(key, str):
        raise PayloadError("YAML mapping keys must be strings")
    yaml_ambiguous = {"true", "false", "null", "none", "yes", "no", "y", "n", "on", "off", "~"}
    if re.match(r"^[A-Za-z_][A-Za-z0-9_-]*$", key) and key.lower() not in yaml_ambiguous:
        return key
    return json.dumps(key, ensure_ascii=False)


def _dump_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        lowered = value.lower()
        yaml_ambiguous = {"true", "false", "null", "none", "yes", "no", "y", "n", "on", "off", "~"}
        if re.match(r"^[A-Za-z_][A-Za-z0-9_.+/-]*$", value) and lowered not in yaml_ambiguous:
            return value
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise PayloadError("Cannot serialize non-finite numbers")
        return repr(value)
    raise PayloadError("Unsupported YAML scalar type: {0}".format(type(value).__name__))


def dump_yaml(data: Dict[str, Any]) -> str:
    """Serialize a payload using a deterministic, safely quoted YAML subset."""
    if not isinstance(data, dict):
        raise PayloadError("Payload root must be a mapping/object")

    def emit(value: Any, indent: int) -> List[str]:
        prefix = " " * indent
        if isinstance(value, dict):
            if not value:
                return [prefix + "{}"]
            output: List[str] = []
            for key, child in value.items():
                dumped_key = _dump_key(key)
                if isinstance(child, dict):
                    if child:
                        output.append(prefix + dumped_key + ":")
                        output.extend(emit(child, indent + 2))
                    else:
                        output.append(prefix + dumped_key + ": {}")
                elif isinstance(child, list):
                    if child:
                        output.append(prefix + dumped_key + ":")
                        output.extend(emit(child, indent + 2))
                    else:
                        output.append(prefix + dumped_key + ": []")
                else:
                    output.append(prefix + dumped_key + ": " + _dump_scalar(child))
            return output

        if isinstance(value, list):
            if not value:
                return [prefix + "[]"]
            output = []
            for child in value:
                if isinstance(child, (dict, list)):
                    output.append(prefix + "-")
                    output.extend(emit(child, indent + 2))
                else:
                    output.append(prefix + "- " + _dump_scalar(child))
            return output

        return [prefix + _dump_scalar(value)]

    return "\n".join(emit(data, 0))


def dump_yaml_documents(documents: Sequence[Dict[str, Any]], header: Optional[str] = None) -> str:
    if not documents:
        return ""
    body = "\n---\n".join(dump_yaml(document) for document in documents)
    if header:
        return "# " + header.replace("\n", " ") + "\n" + body
    return body


# ---------------------------------------------------------------------------
# Contract validation and extraction helpers
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Contract validation and extraction helpers
# ---------------------------------------------------------------------------


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _reject_unknown_keys(value: Dict[str, Any], allowed: Iterable[str], path: str, errors: List[str]) -> None:
    unknown = sorted(set(value) - set(allowed))
    for key in unknown:
        errors.append("{0} contains unknown field '{1}'".format(path, key))


def _require_mapping(value: Any, path: str, errors: List[str]) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        errors.append("{0} must be a mapping/object".format(path))
        return None
    return value


def _require_list(
    value: Any,
    path: str,
    errors: List[str],
    non_empty: bool = True,
    minimum_length: Optional[int] = None,
    maximum_length: Optional[int] = None,
) -> Optional[List[Any]]:
    if not isinstance(value, list):
        errors.append("{0} must be a list".format(path))
        return None
    if non_empty and not value:
        errors.append("{0} must not be empty".format(path))
    if minimum_length is not None and len(value) < minimum_length:
        errors.append("{0} must contain at least {1} items".format(path, minimum_length))
    if maximum_length is not None and len(value) > maximum_length:
        errors.append("{0} must contain at most {1} items".format(path, maximum_length))
    return value


def _require_string(value: Any, path: str, errors: List[str], non_empty: bool = True) -> None:
    if not isinstance(value, str):
        errors.append("{0} must be a string".format(path))
    elif non_empty and not value.strip():
        errors.append("{0} must not be empty".format(path))


def _require_bool(value: Any, path: str, errors: List[str]) -> None:
    if not isinstance(value, bool):
        errors.append("{0} must be a boolean".format(path))


def _require_number(
    value: Any,
    path: str,
    errors: List[str],
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    strict_minimum: bool = False,
) -> None:
    if not _is_number(value):
        errors.append("{0} must be a finite number".format(path))
        return
    numeric = float(value)
    if minimum is not None:
        if strict_minimum and numeric <= minimum:
            errors.append("{0} must be greater than {1}".format(path, minimum))
        elif not strict_minimum and numeric < minimum:
            errors.append("{0} must be at least {1}".format(path, minimum))
    if maximum is not None and numeric > maximum:
        errors.append("{0} must be at most {1}".format(path, maximum))


def _require_integer(
    value: Any,
    path: str,
    errors: List[str],
    minimum: Optional[int] = None,
    maximum: Optional[int] = None,
) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        errors.append("{0} must be an integer".format(path))
        return
    if minimum is not None and value < minimum:
        errors.append("{0} must be at least {1}".format(path, minimum))
    if maximum is not None and value > maximum:
        errors.append("{0} must be at most {1}".format(path, maximum))


def _require_close(
    actual: Any,
    expected: float,
    path: str,
    relationship: str,
    errors: List[str],
    rel_tol: float = 0.02,
    abs_tol: float = 0.01,
) -> None:
    if _is_number(actual) and not math.isclose(float(actual), expected, rel_tol=rel_tol, abs_tol=abs_tol):
        errors.append("{0} is inconsistent with {1}; expected approximately {2:.6g}".format(path, relationship, expected))


def _validate_string_list(value: Any, path: str, errors: List[str], non_empty: bool = True) -> None:
    items = _require_list(value, path, errors, non_empty=non_empty)
    if items is None:
        return
    for index, item in enumerate(items):
        _require_string(item, "{0}[{1}]".format(path, index), errors)


def _validate_concept(data: Dict[str, Any], errors: List[str]) -> None:
    _reject_unknown_keys(
        data,
        {"payload_type", "version", "high_concept", "player_experience_goals", "formal_elements", "hypotheses_to_test"},
        "payload",
        errors,
    )
    _require_string(data.get("high_concept"), "high_concept", errors)
    _validate_string_list(data.get("player_experience_goals"), "player_experience_goals", errors)
    formal = _require_mapping(data.get("formal_elements"), "formal_elements", errors)
    if formal is not None:
        _reject_unknown_keys(formal, {"players", "primary_objective", "core_rules", "resources", "conflict_sources"}, "formal_elements", errors)
        _require_string(formal.get("players"), "formal_elements.players", errors)
        _require_string(formal.get("primary_objective"), "formal_elements.primary_objective", errors)
        for key in ("core_rules", "resources", "conflict_sources"):
            _validate_string_list(formal.get(key), "formal_elements." + key, errors)
    _validate_string_list(data.get("hypotheses_to_test"), "hypotheses_to_test", errors)


def _validate_toy(data: Dict[str, Any], version: str, errors: List[str]) -> None:
    _reject_unknown_keys(
        data,
        {"payload_type", "version", "toy_verb", "multi_solution_matrix", "kinematics_parameters"},
        "payload",
        errors,
    )
    _require_string(data.get("toy_verb"), "toy_verb", errors)
    matrix = _require_mapping(data.get("multi_solution_matrix"), "multi_solution_matrix", errors)
    if matrix is not None:
        _reject_unknown_keys(matrix, {"movement", "combat", "puzzle"}, "multi_solution_matrix", errors)
        for key in ("movement", "combat", "puzzle"):
            _require_string(matrix.get(key), "multi_solution_matrix." + key, errors)

    kp = _require_mapping(data.get("kinematics_parameters"), "kinematics_parameters", errors)
    if kp is None:
        return

    if version == "1.0":
        _reject_unknown_keys(kp, {"jump_height", "time_to_apex", "fall_multiplier", "coyote_time_ms", "input_buffer_ms"}, "kinematics_parameters", errors)
        for key in ("jump_height", "time_to_apex", "fall_multiplier"):
            _require_number(kp.get(key), "kinematics_parameters." + key, errors, 0.0, 1_000_000.0, strict_minimum=True)
        for key in ("coyote_time_ms", "input_buffer_ms"):
            if key in kp:
                _require_number(kp.get(key), "kinematics_parameters." + key, errors, 0.0, 60_000.0)
        return

    _reject_unknown_keys(kp, {"horizontal", "vertical", "grace_and_juice"}, "kinematics_parameters", errors)
    horizontal = _require_mapping(kp.get("horizontal"), "kinematics_parameters.horizontal", errors)
    vertical = _require_mapping(kp.get("vertical"), "kinematics_parameters.vertical", errors)
    grace = _require_mapping(kp.get("grace_and_juice"), "kinematics_parameters.grace_and_juice", errors)
    if horizontal is not None:
        _reject_unknown_keys(
            horizontal,
            {"max_speed_mps", "acceleration_mps2", "skid_deceleration_mps2", "skid_distance_m", "air_control_factor"},
            "kinematics_parameters.horizontal",
            errors,
        )
        for key in ("max_speed_mps", "acceleration_mps2", "skid_deceleration_mps2", "skid_distance_m"):
            _require_number(horizontal.get(key), "kinematics_parameters.horizontal." + key, errors, 0.0, 1_000_000.0, strict_minimum=True)
        _require_number(horizontal.get("air_control_factor"), "kinematics_parameters.horizontal.air_control_factor", errors, 0.0, 1.0)
        if all(_is_number(horizontal.get(key)) for key in ("max_speed_mps", "skid_deceleration_mps2", "skid_distance_m")):
            expected_skid = float(horizontal["max_speed_mps"]) ** 2 / (2.0 * float(horizontal["skid_deceleration_mps2"]))
            _require_close(horizontal["skid_distance_m"], expected_skid, "kinematics_parameters.horizontal.skid_distance_m", "v²/(2×skid_deceleration)", errors)
    if vertical is not None:
        _reject_unknown_keys(
            vertical,
            {"jump_height_m", "time_to_apex_s", "fall_multiplier", "jump_velocity_mps", "gravity_up_mps2", "gravity_down_mps2", "total_air_time_s"},
            "kinematics_parameters.vertical",
            errors,
        )
        for key in ("jump_height_m", "time_to_apex_s", "fall_multiplier", "jump_velocity_mps", "gravity_up_mps2", "gravity_down_mps2", "total_air_time_s"):
            _require_number(vertical.get(key), "kinematics_parameters.vertical." + key, errors, 0.0, 1_000_000.0, strict_minimum=True)
        required = ("jump_height_m", "time_to_apex_s", "fall_multiplier", "jump_velocity_mps", "gravity_up_mps2", "gravity_down_mps2", "total_air_time_s")
        if all(_is_number(vertical.get(key)) for key in required):
            height = float(vertical["jump_height_m"])
            apex = float(vertical["time_to_apex_s"])
            fall_multiplier = float(vertical["fall_multiplier"])
            jump_velocity = float(vertical["jump_velocity_mps"])
            gravity_up = float(vertical["gravity_up_mps2"])
            gravity_down = float(vertical["gravity_down_mps2"])
            _require_close(jump_velocity, gravity_up * apex, "kinematics_parameters.vertical.jump_velocity_mps", "gravity_up × time_to_apex", errors)
            _require_close(height, 0.5 * gravity_up * apex ** 2, "kinematics_parameters.vertical.jump_height_m", "0.5 × gravity_up × time_to_apex²", errors)
            _require_close(gravity_down, gravity_up * fall_multiplier, "kinematics_parameters.vertical.gravity_down_mps2", "gravity_up × fall_multiplier", errors)
            expected_air = apex + math.sqrt(2.0 * height / gravity_down)
            _require_close(vertical["total_air_time_s"], expected_air, "kinematics_parameters.vertical.total_air_time_s", "apex time plus fall time", errors)
    if grace is not None:
        _reject_unknown_keys(
            grace,
            {"coyote_time_ms", "input_buffer_ms", "hitstop_light_frames", "hitstop_heavy_frames", "screen_shake_frames"},
            "kinematics_parameters.grace_and_juice",
            errors,
        )
        for key in ("coyote_time_ms", "input_buffer_ms"):
            _require_number(grace.get(key), "kinematics_parameters.grace_and_juice." + key, errors, 0.0, 60_000.0)
        for key in ("hitstop_light_frames", "hitstop_heavy_frames", "screen_shake_frames"):
            _require_integer(grace.get(key), "kinematics_parameters.grace_and_juice." + key, errors, 0, 10_000)


def _validate_spatial(data: Dict[str, Any], errors: List[str]) -> None:
    _reject_unknown_keys(
        data,
        {"payload_type", "version", "topology_type", "metrics_standards", "encounter_arenas", "sawtooth_pacing_sequence"},
        "payload",
        errors,
    )
    _require_string(data.get("topology_type"), "topology_type", errors)
    metrics = _require_mapping(data.get("metrics_standards"), "metrics_standards", errors)
    if metrics is not None:
        _reject_unknown_keys(metrics, {"player_height", "high_cover", "low_cover", "doorway_width", "jump_kinematics"}, "metrics_standards", errors)
        for key in ("player_height", "high_cover", "low_cover", "doorway_width"):
            _require_number(metrics.get(key), "metrics_standards." + key, errors, 0.0, 1_000_000.0, strict_minimum=True)
        if _is_number(metrics.get("high_cover")) and _is_number(metrics.get("low_cover")):
            if float(metrics["high_cover"]) <= float(metrics["low_cover"]):
                errors.append("metrics_standards.high_cover must be greater than low_cover")
        if "jump_kinematics" in metrics:
            jump = _require_mapping(metrics.get("jump_kinematics"), "metrics_standards.jump_kinematics", errors)
            if jump is not None:
                _reject_unknown_keys(jump, {"max_jump_height", "safe_span_m", "max_span_m", "sprint_span_m"}, "metrics_standards.jump_kinematics", errors)
                for key in ("max_jump_height", "safe_span_m", "max_span_m", "sprint_span_m"):
                    _require_number(jump.get(key), "metrics_standards.jump_kinematics." + key, errors, 0.0, 1_000_000.0, strict_minimum=True)
                if all(_is_number(jump.get(key)) for key in ("safe_span_m", "max_span_m", "sprint_span_m")):
                    if not float(jump["safe_span_m"]) <= float(jump["max_span_m"]) <= float(jump["sprint_span_m"]):
                        errors.append("jump spans must satisfy safe_span_m <= max_span_m <= sprint_span_m")

    arenas = _require_list(data.get("encounter_arenas"), "encounter_arenas", errors)
    if arenas is not None:
        arena_ids = set()
        for index, arena_value in enumerate(arenas):
            path = "encounter_arenas[{0}]".format(index)
            arena = _require_mapping(arena_value, path, errors)
            if arena is None:
                continue
            _reject_unknown_keys(arena, {"arena_id", "tension_score", "flanking_routes", "high_ground_perches", "cooldown_valley_after"}, path, errors)
            _require_string(arena.get("arena_id"), path + ".arena_id", errors)
            if isinstance(arena.get("arena_id"), str):
                if arena["arena_id"] in arena_ids:
                    errors.append(path + ".arena_id must be unique")
                arena_ids.add(arena["arena_id"])
            _require_number(arena.get("tension_score"), path + ".tension_score", errors, 0.0, 100.0)
            for key in ("flanking_routes", "high_ground_perches"):
                _require_integer(arena.get(key), path + "." + key, errors, 0, 1000)
            _require_string(arena.get("cooldown_valley_after"), path + ".cooldown_valley_after", errors)

    pacing = _require_list(data.get("sawtooth_pacing_sequence"), "sawtooth_pacing_sequence", errors, minimum_length=4, maximum_length=1000)
    if pacing is not None:
        for index, tension in enumerate(pacing):
            _require_number(tension, "sawtooth_pacing_sequence[{0}]".format(index), errors, 0.0, 100.0)


def _validate_balance_rubric(value: Any, errors: List[str]) -> None:
    rubric = _require_mapping(value, "balance_rubric", errors)
    if rubric is None:
        return
    _reject_unknown_keys(rubric, {"average_score", "min_score", "max_score", "high_risk_count", "dimensions"}, "balance_rubric", errors)
    for key in ("average_score", "min_score", "max_score"):
        _require_number(rubric.get(key), "balance_rubric." + key, errors, 1.0, 5.0)
    _require_integer(rubric.get("high_risk_count"), "balance_rubric.high_risk_count", errors, 0, 12)
    dimensions = _require_list(rubric.get("dimensions"), "balance_rubric.dimensions", errors, minimum_length=12, maximum_length=12)
    if dimensions is None:
        return
    indices = set()
    scores: List[float] = []
    risk_count = 0
    for index, dimension_value in enumerate(dimensions):
        path = "balance_rubric.dimensions[{0}]".format(index)
        dimension = _require_mapping(dimension_value, path, errors)
        if dimension is None:
            continue
        _reject_unknown_keys(dimension, {"index", "name", "score", "is_risk", "advice"}, path, errors)
        _require_integer(dimension.get("index"), path + ".index", errors, 1, 12)
        _require_string(dimension.get("name"), path + ".name", errors)
        _require_number(dimension.get("score"), path + ".score", errors, 1.0, 5.0)
        _require_bool(dimension.get("is_risk"), path + ".is_risk", errors)
        _require_string(dimension.get("advice"), path + ".advice", errors)
        if isinstance(dimension.get("index"), int):
            if dimension["index"] in indices:
                errors.append(path + ".index must be unique")
            indices.add(dimension["index"])
        if _is_number(dimension.get("score")):
            scores.append(float(dimension["score"]))
        if dimension.get("is_risk") is True:
            risk_count += 1
    if indices and indices != set(range(1, 13)):
        errors.append("balance_rubric dimension indices must cover 1 through 12")
    if len(scores) == 12:
        _require_close(rubric.get("average_score"), sum(scores) / 12.0, "balance_rubric.average_score", "mean dimension score", errors, rel_tol=0.0, abs_tol=0.011)
        _require_close(rubric.get("min_score"), min(scores), "balance_rubric.min_score", "minimum dimension score", errors, rel_tol=0.0, abs_tol=0.001)
        _require_close(rubric.get("max_score"), max(scores), "balance_rubric.max_score", "maximum dimension score", errors, rel_tol=0.0, abs_tol=0.001)
    if isinstance(rubric.get("high_risk_count"), int) and rubric["high_risk_count"] != risk_count:
        errors.append("balance_rubric.high_risk_count must match dimensions marked is_risk")


def _validate_audit(data: Dict[str, Any], version: str, errors: List[str]) -> None:
    allowed = {"payload_type", "version", "active_lenses", "elemental_tetrad_balance", "surgical_fixes"}
    if version == "1.1":
        allowed.add("balance_rubric")
    _reject_unknown_keys(data, allowed, "payload", errors)
    lenses = _require_list(data.get("active_lenses"), "active_lenses", errors)
    if lenses is not None:
        ids = set()
        for index, item in enumerate(lenses):
            path = "active_lenses[{0}]".format(index)
            _require_string(item, path, errors)
            if isinstance(item, str):
                match = re.search(r"#?(\d+)", item)
                if not match:
                    errors.append(path + " must contain a lens id")
                    continue
                lens_id = int(match.group(1))
                if lens_id < 1 or lens_id > 113:
                    errors.append(path + " lens id must be between 1 and 113")
                if lens_id in ids:
                    errors.append(path + " lens id must be unique")
                ids.add(lens_id)
    tetrad = _require_mapping(data.get("elemental_tetrad_balance"), "elemental_tetrad_balance", errors)
    if tetrad is not None:
        _reject_unknown_keys(tetrad, {"mechanics", "story", "aesthetics", "technology"}, "elemental_tetrad_balance", errors)
        for key in ("mechanics", "story", "aesthetics", "technology"):
            _require_string(tetrad.get(key), "elemental_tetrad_balance." + key, errors)
    fixes = _require_mapping(data.get("surgical_fixes"), "surgical_fixes", errors)
    if fixes is not None:
        _reject_unknown_keys(fixes, {"keep", "cut", "tune"}, "surgical_fixes", errors)
        for key in ("keep", "cut", "tune"):
            _validate_string_list(fixes.get(key), "surgical_fixes." + key, errors)
    if version == "1.1":
        _validate_balance_rubric(data.get("balance_rubric"), errors)


def _validate_economy(data: Dict[str, Any], errors: List[str]) -> None:
    _reject_unknown_keys(data, {"payload_type", "version", "simulation_type", "parameters", "players"}, "payload", errors)
    simulation_type = data.get("simulation_type")
    _require_string(simulation_type, "simulation_type", errors)
    supported = {"economy", "dice", "versus_dice", "multiplayer_economy"}
    if isinstance(simulation_type, str) and simulation_type not in supported:
        errors.append("simulation_type must be one of {0}".format(sorted(supported)))
    parameters = _require_mapping(data.get("parameters"), "parameters", errors)
    if parameters is None or simulation_type not in supported:
        return
    if simulation_type == "economy":
        _reject_unknown_keys(parameters, {"initial", "source", "growth", "sink", "dynamic_sink", "rounds"}, "parameters", errors)
        for key in ("initial", "source", "sink", "dynamic_sink"):
            _require_number(parameters.get(key), "parameters." + key, errors, 0.0, 1e15)
        _require_number(parameters.get("growth"), "parameters.growth", errors, -0.999999, 100.0)
        _require_integer(parameters.get("rounds"), "parameters.rounds", errors, 1, 100_000)
    elif simulation_type in {"dice", "versus_dice"}:
        allowed = {"trials", "seed", "expression"} if simulation_type == "dice" else {"trials", "seed", "expression_a", "expression_b"}
        _reject_unknown_keys(parameters, allowed, "parameters", errors)
        if simulation_type == "dice":
            _require_string(parameters.get("expression"), "parameters.expression", errors)
        else:
            _require_string(parameters.get("expression_a"), "parameters.expression_a", errors)
            _require_string(parameters.get("expression_b"), "parameters.expression_b", errors)
        _require_integer(parameters.get("trials"), "parameters.trials", errors, 1, 1_000_000)
        if parameters.get("seed") is not None:
            _require_integer(parameters.get("seed"), "parameters.seed", errors)
    else:
        _reject_unknown_keys(parameters, {"rounds"}, "parameters", errors)
        _require_integer(parameters.get("rounds"), "parameters.rounds", errors, 1, 100_000)
        players = _require_list(data.get("players"), "players", errors)
        if players is not None:
            names = set()
            for index, player_value in enumerate(players):
                path = "players[{0}]".format(index)
                player = _require_mapping(player_value, path, errors)
                if player is None:
                    continue
                _reject_unknown_keys(player, {"name", "initial", "source", "growth", "sink"}, path, errors)
                _require_string(player.get("name"), path + ".name", errors)
                if isinstance(player.get("name"), str):
                    if player["name"] in names:
                        errors.append(path + ".name must be unique")
                    names.add(player["name"])
                for key in ("initial", "source", "sink"):
                    _require_number(player.get(key), path + "." + key, errors, 0.0, 1e15)
                _require_number(player.get("growth"), path + ".growth", errors, -0.999999, 100.0)


def validate_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {"valid": False, "error": "Payload root must be a mapping/object", "errors": ["Payload root must be a mapping/object"]}

    errors: List[str] = []
    payload_type = data.get("payload_type")
    version = data.get("version")
    _require_string(payload_type, "payload_type", errors)
    _require_string(version, "version", errors)

    if isinstance(payload_type, str) and payload_type not in SUPPORTED_VERSIONS:
        errors.append("Unknown payload_type '{0}'".format(payload_type))
    if isinstance(payload_type, str) and payload_type in SUPPORTED_VERSIONS and isinstance(version, str):
        if version not in SUPPORTED_VERSIONS[payload_type]:
            errors.append(
                "Unsupported version '{0}' for {1}; supported versions: {2}".format(
                    version, payload_type, sorted(SUPPORTED_VERSIONS[payload_type])
                )
            )

    if not errors and payload_type == "ConceptAndFormalElements":
        _validate_concept(data, errors)
    elif not errors and payload_type == "ToyAndKinematics":
        _validate_toy(data, str(version), errors)
    elif not errors and payload_type == "SpatialTopologyAndEncounters":
        _validate_spatial(data, errors)
    elif not errors and payload_type == "FullSystemAudit":
        _validate_audit(data, str(version), errors)
    elif not errors and payload_type == "EconomySimulationConfig":
        _validate_economy(data, errors)

    if errors:
        return {"valid": False, "error": "; ".join(errors), "errors": errors}
    return {
        "valid": True,
        "payload_type": payload_type,
        "version": version,
        "description": PAYLOAD_DESCRIPTIONS.get(str(payload_type), ""),
        "errors": [],
    }


def parse_and_validate_payload(source: str, allowed_types: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    payload = parse_payload_data(source)
    result = validate_payload(payload)
    if not result.get("valid"):
        raise PayloadError(result.get("error", "Invalid payload"))
    if allowed_types is not None:
        allowed = set(allowed_types)
        payload_type = str(payload.get("payload_type"))
        if payload_type not in allowed:
            raise PayloadError("Payload type {0} is not accepted here; expected one of {1}".format(payload_type, sorted(allowed)))
    return payload


def validate_payload_documents(documents: Sequence[Dict[str, Any]], require_pipeline_order: bool = False) -> Dict[str, Any]:
    if not documents:
        return {"valid": False, "error": "No payload documents found", "documents": []}

    results = [validate_payload(document) for document in documents]
    errors: List[str] = []
    for index, result in enumerate(results, 1):
        if not result.get("valid"):
            errors.append("Document {0}: {1}".format(index, result.get("error", "invalid payload")))

    if require_pipeline_order:
        actual = [document.get("payload_type") for document in documents]
        if actual != PAYLOAD_ORDER:
            errors.append("Pipeline bundle order must be {0}; received {1}".format(PAYLOAD_ORDER, actual))

    return {
        "valid": not errors,
        "error": "; ".join(errors) if errors else "",
        "documents": results,
    }


def extract_kinematics(payload: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """Extract canonical numeric kinematics from Contract 2 v1.0 or v1.1."""
    kp = payload.get("kinematics_parameters")
    if not isinstance(kp, dict):
        return {}

    vertical = cast(Dict[str, Any], kp.get("vertical")) if isinstance(kp.get("vertical"), dict) else cast(Dict[str, Any], kp)
    horizontal = cast(Dict[str, Any], kp.get("horizontal")) if isinstance(kp.get("horizontal"), dict) else cast(Dict[str, Any], kp)

    def first_number(mapping: Dict[str, Any], keys: Iterable[str]) -> Optional[float]:
        for key in keys:
            value = mapping.get(key)
            if _is_number(value):
                return float(cast(Any, value))
        return None

    return {
        "jump_height": first_number(vertical, ("jump_height_m", "jump_height", "height")),
        "time_to_apex": first_number(vertical, ("time_to_apex_s", "time_to_apex", "apex_time")),
        "fall_multiplier": first_number(vertical, ("fall_multiplier",)),
        "jump_velocity": first_number(vertical, ("jump_velocity_mps", "jump_velocity")),
        "gravity_up": first_number(vertical, ("gravity_up_mps2", "gravity_up")),
        "gravity_down": first_number(vertical, ("gravity_down_mps2", "gravity_down")),
        "total_air_time": first_number(vertical, ("total_air_time_s", "total_air_time")),
        "speed": first_number(horizontal, ("max_speed_mps", "max_speed", "speed")),
        "acceleration": first_number(horizontal, ("acceleration_mps2", "acceleration")),
        "skid_deceleration": first_number(horizontal, ("skid_deceleration_mps2", "skid_deceleration")),
        "skid_distance": first_number(horizontal, ("skid_distance_m", "skid_distance")),
        "air_control": first_number(horizontal, ("air_control_factor", "air_control")),
    }


def extract_economy_parameters(payload: Dict[str, Any]) -> Dict[str, float]:
    parameters = payload.get("parameters")
    if payload.get("payload_type") == "EconomySimulationConfig" and isinstance(parameters, dict):
        extracted: Dict[str, float] = {}
        for key in ("initial", "source", "sink", "growth", "dynamic_sink", "rounds", "trials", "seed"):
            value = parameters.get(key)
            if _is_number(value):
                extracted[key] = float(cast(Any, value))
        return extracted

    # Legacy migration path for early Contract 1 drafts that embedded economy
    # values directly in formal_elements.
    formal = payload.get("formal_elements")
    if not isinstance(formal, dict):
        return {}
    aliases = {
        "initial": ("initial_wealth", "initial"),
        "source": ("source_rate", "source"),
        "sink": ("sink_rate", "sink"),
        "growth": ("growth_rate", "growth"),
        "dynamic_sink": ("dynamic_sink_rate", "dynamic_sink"),
        "rounds": ("simulation_rounds", "rounds"),
    }
    extracted = {}
    for destination, keys in aliases.items():
        for key in keys:
            value = formal.get(key)
            if _is_number(value):
                extracted[destination] = float(cast(Any, value))
                break
    return extracted
