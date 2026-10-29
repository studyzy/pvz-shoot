#!/usr/bin/env python3
"""Installed-skill compatibility launcher for game_design_skills_suite.level_metrics_and_pacing."""

import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
_PACKAGE = os.path.join(_ROOT, "game_design_skills_suite")
if not os.path.isdir(_PACKAGE):
    configured = os.environ.get("GAME_DESIGN_SKILLS_ROOT")
    if configured and os.path.isdir(os.path.join(configured, "game_design_skills_suite")):
        _ROOT = os.path.abspath(configured)
    else:
        raise RuntimeError(
            "Unable to locate game_design_skills_suite. Install the shared runtime beside the five skill directories "
            "or set GAME_DESIGN_SKILLS_ROOT explicitly."
        )
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from game_design_skills_suite.level_metrics_and_pacing import *  # noqa: E402,F401,F403
from game_design_skills_suite.level_metrics_and_pacing import main as _main  # noqa: E402
from game_design_skills_suite.contracts import parse_payload_data  # noqa: E402,F401


if __name__ == "__main__":
    _main()
