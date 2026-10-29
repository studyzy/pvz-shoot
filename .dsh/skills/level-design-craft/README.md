# Level Design Craft Skill 🏛️📐

> An AI Agent skill synthesizing world-class level design literature and AAA studio methodologies (Totten's Architectural Space, Ubisoft Rational Level Design, Valve Subconscious Lighting, Naughty Dog Wide-Linear Encounters, Arkane Swiss-Cheese Topology, Metroidvania Ability Gates, Environmental Puzzles, and PvP/Co-op Multiplayer Layouts).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI Agent Skill](https://img.shields.io/badge/AI-Agent%20Skill-blueviolet.svg)](https://github.com/Wilson520403/game-design-skills)

English | [简体中文](README_CN.md)

---

## 📖 Overview

Great level design is the invisible art that transforms mechanics into immersive, intuitive, and unforgettable player journeys. 

This Skill distills decades of industry-proven level design theory (Christopher W. Totten, Rudolf Kremers) and industrial practices from top studios (Valve, Ubisoft, Naughty Dog, Arkane Studios, FromSoftware, Nintendo, id Software) into an actionable AI mentor capability that supports:

1. **Architectural Space & Spatial Typology**: Leverage Christopher Totten's *Prospect & Refuge* theory, vertical compression, thresholds, and cinematic visual framing to craft spaces imbued with psychological emotion and narrative depth.
2. **Rational Level Design (RLD) & Kinematic Metrics**: Enforce strict player metrics (jump arcs, sprint leaps, ledge climbs, sightlines), coupled with physics-based jump trajectory solvers, decomposing complex gameplay into atomic challenge layers.
3. **Wide-Linear Arenas & Dynamic Encounters**: Implement Naughty Dog-style funnel-to-arena structures, multi-tiered combat perches, flanking routes, cover networks, and cat-and-mouse stealth reset loops.
4. **Subconscious Guidance & Breadcrumbs**: Apply Valve's 3-light illumination hierarchy (Key, Fill, Lead), directional composition, color coding, and breadcrumb reward trails for zero-text, intuitive navigation.
5. **Swiss Cheese & Non-Linear Topology**: Perforate multi-level spaces with vertical penetration and alternative routes (Combat / Stealth / Agility), featuring Souls-like "visible but unreachable" teasing and loopback shortcut discovery.
6. **2D Metroidvania, Environmental Puzzles & Multiplayer**: Handle 2D tile-based ability gates, Zelda/Portal causality gizmos, anti-softlock protocols, PvP 3-lane TTE symmetry, and Co-op synchronized sightlines.

---

## 📂 Repository Architecture

```
level-design-craft/
├── SKILL.md                                  # Skill Entry: Pillars, Tri-Mode workflows & System Prompt
├── README.md                                 # English Documentation
├── README_CN.md                              # Chinese Documentation (简体中文)
├── LICENSE                                   # MIT License
├── scripts/
│   └── level_metrics_and_pacing.py           # Multi-genre presets, jump arc kinematics, sawtooth analyzer & Unity/YAML exporter
└── references/
    ├── architectural-space-and-composition.md # Spatial typologies, Prospect & Refuge, thresholds & framing
    ├── rational-level-design-and-metrics.md   # Ubisoft RLD, atomic challenges, metric grids & cognitive load
    ├── pacing-encounters-and-arenas.md        # Wide-linear funnels, arena geometry, high ground & stealth loops
    ├── invisible-guidance-and-breadcrumbs.md  # Valve lighting rules, visual breadcrumbs & anti-lost heuristics
    ├── swiss-cheese-and-non-linear-topology.md # Arkane Swiss-cheese perforation & Souls shortcut loopbacks
    ├── metroidvania-and-2d-platforming.md     # 2D tile metrics, ability gate matrix, viewports & smart backtracking
    ├── environmental-puzzles-and-gizmos.md    # Spatial causality chains, 4 gizmo archetypes, 4-step pacing & anti-softlock
    ├── pvp-and-coop-multiplayer-topology.md   # PvP 3-lane & mid control, TTE symmetry, corner peeks & Co-op layouts
    └── templates-and-diagnostic-rubrics.md    # One-Page LDD, Metric Sheet, Arena Plan & 6-Axis Health Audit
```

---

## 🛠️ CLI Tooling & Code Generation

```bash
# 1. Inspect metrics across genres (3A FPS, Souls-like ARPG, 2D Metroidvania, Tactical CQB)
python scripts/level_metrics_and_pacing.py --preset fps_3a
python scripts/level_metrics_and_pacing.py --preset metroidvania_2d
python scripts/level_metrics_and_pacing.py --preset souls_arpg

# 2. Solve jump kinematics & platform clearance envelope
python scripts/level_metrics_and_pacing.py --jump_arc --jump_velocity 12 --gravity_up 35 --gravity_down 60 --speed 8

# 3. Audit sawtooth pacing waveform & fatigue warnings
python scripts/level_metrics_and_pacing.py --pacing_curve "25,60,85,20,65,95,30"

# 4. Export Unity C# Blockout Gizmo class or Pipeline Contract 3 YAML Payload
python scripts/level_metrics_and_pacing.py --export_code unity
python scripts/level_metrics_and_pacing.py --export_yaml
```

---

## ⚡ Installation

Install this skill directly via your AI Agent:

### Option 1: AI Prompt Installation (Recommended)

Paste this instruction into your AI Agent chat:

```text
Please install the Level Design Craft skill into my global skills directory from https://github.com/Wilson520403/game-design-skills.git (subfolder: level-design-craft).
```

### Option 2: Command-Line Installation

```bash
git clone https://github.com/Wilson520403/game-design-skills.git temp-skills
mkdir -p ~/.config/skills
cp -r temp-skills/level-design-craft ~/.config/skills/
rm -rf temp-skills
```

---

## 🎯 How to Use

Once installed, prompt your AI naturally in any level design conversation:

- **Macro Space & Blockout**: *"I'm designing an ancient sunken temple. Help me lay out a hub-and-spoke topology with 3 tiers of visual landmarks, defining jump/climb metrics and Prospect/Refuge transitions."*
- **2D Metroidvania Ability Gates**: *"Plan a crystal mine zone in 16px tile metrics with Double Jump and Ground Slide ability gates, including a 1-way drop chute to eliminate backtracking fatigue."*
- **Combat Encounter Pacing**: *"Create a 3-wave stealth-action arena in a ruined railway station using Naughty Dog's wide-linear layout, with high-ground sniper perches and cat-and-mouse flanking routes."*
- **Level Health & Navigation Audit**: *"Playtesters keep getting lost and missing the boss entrance in Sector 4. Perform an anti-lost diagnostic using Valve's Lead Light principles and Arkane's visual teasing rules."*
- **Environmental Puzzle Causality**: *"Design a laser-reflection and water-conduction puzzle in a water temple using 4-step implicit onboarding and anti-softlock fail-safes."*
- **PvP Competitive Arena Balance**: *"Design a 5v5 defusal map with a classic 3-lane structure, calculating TTE symmetry from spawns to bombsites and sightline angles."*

---

## 📜 References & Acknowledgments

- **Christopher W. Totten**, *An Architectural Approach to Level Design* (2nd Edition), CRC Press.
- **Rudolf Kremers**, *Level Design: Concept, Theory, and Practice*, A K Peters/CRC Press.
- **Valve Corporation**, *Half-Life & Portal Developer Commentaries on Lighting, Player Guidance, and Playtesting*.
- **Ubisoft**, *Rational Level Design (RLD) Methodology & Metric Standards*.
- **Naughty Dog**, *GDC Sessions on Wide-Linear Pacing and Dynamic Combat Arenas (Uncharted, The Last of Us)*.
- **Arkane Studios & FromSoftware**, *Level Design Philosophies on Immersive Sim Space Perforation & Shortcut Loops (Dishonored, Dark Souls, Elden Ring)*.
- **Nintendo**, *Triangle Rule of Open-World Landmarks and Implicit Puzzle Pacing (Zelda, Super Mario)*.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
