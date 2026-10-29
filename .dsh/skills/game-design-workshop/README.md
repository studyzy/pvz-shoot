# Game Design Workshop Skill 🎮

> An AI Agent skill implementing the **Playcentric Game Design** methodology from Tracy Fullerton's classic *Game Design Workshop*.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI Agent Skill](https://img.shields.io/badge/AI-Agent%20Skill-blueviolet.svg)](https://github.com/Wilson520403/game-design-skills)

English | [简体中文](README_CN.md)

---

## 📖 Overview

*Game Design Workshop* by Tracy Fullerton is the industry-standard textbook for game design education, pioneering the **Playcentric Design Philosophy** anchored by the core motto: **"Fail Early, Fail Cheap"**.

This Skill codifies the book's foundational frameworks, formal/dramatic systems, prototyping workflows, and playtesting methodologies into a structured AI mentor capability that supports:

1. **Guided Co-Design (0 to 1)**: From ideation and constraint brainstorming to Player Experience Goals, 8 Formal Elements, 4 Dramatic Elements, Prototyping recipes, and full Game Design Document (GDD) authoring.
2. **Mechanics Review & Health Diagnostic**: In-depth auditing of game mechanics, rules, and economy across player agency, dominant strategy risks, positive/negative feedback loops, and flow channels.
3. **Actionable Templates & Toolkits**: One-Page Pitch, Playcentric GDD, Prototyping Checklist, MoSCoW MVP scoping matrix, Think-Aloud Playtesting Protocols, and Playtest Debrief sheets.
4. **Advanced Monte Carlo & Virtual Economy Script**: Advantage/disadvantage, Keep-highest, Dice pool successes, Exploding dice, Multiplayer economy Gini inequality index, and YAML pipeline contract exporting.

---

## 📂 Repository Architecture

```
game-design-workshop/
├── SKILL.md                          # Skill Entry: Playcentric philosophy, triggers, dual workflows
├── README.md                         # English Documentation
├── README_CN.md                      # Chinese Documentation (简体中文)
├── LICENSE                           # MIT License
├── references/
│   ├── ideation-techniques.md        # Ideation engines, constraint brainstorming, inversion & filters
│   ├── formal-elements.md            # 8 Formal Elements & Positive/Negative Feedback Loops
│   ├── dramatic-elements.md          # 4 Dramatic Elements & Ludonarrative Harmony
│   ├── prototyping-guide.md          # Physical paper & digital greybox prototyping guides
│   ├── playtesting-and-metrics.md    # 5 Playtest stages, observer rules, Think-Aloud script & severity triage
│   └── templates-and-checklists.md   # 7 Ready-to-use templates (Pitch, GDD, MoSCoW, Surveys, Debrief)
└── scripts/
    └── prob_and_economy_sim.py       # Monte Carlo dice simulation, multiplayer economy Gini & YAML contract export
```

---

## ⚡ Installation

Install this skill directly via your AI Agent:

### Option 1: AI Prompt Installation (Recommended)

Simply paste this instruction into your AI Agent chat:

```text
Please install the Game Design Workshop skill into my global skills directory from https://github.com/Wilson520403/game-design-skills.git
```

### Option 2: Command-Line Installation

Clone directly into your AI skills directory:

```bash
git clone https://github.com/Wilson520403/game-design-skills.git temp-skills && cp -r temp-skills/game-design-workshop ~/.config/skills/ && rm -rf temp-skills
```

---

## 🎯 How to Use

Once installed, prompt your AI naturally in any game design conversation:

- **Ideation & Scaffolding**: *"I have an idea for a sign-language rhythm puzzle game. Walk me through the Playcentric design process to define its core experience goals and formal elements."*
- **Mechanics Audit**: *"Players in our playtest are hoarding gold instead of engaging with the upgrade sink. Diagnose the feedback loop issue and propose fixes based on Game Design Workshop."*
- **Playtesting Prep**: *"Generate a blind playtest observation sheet, think-aloud moderator script, and debriefing survey for our puzzle mechanics."*
- **Simulation & Pacing**: *"Simulate the probability distribution of 4d6k3 vs 6d6>=4 and assess our multiplayer resource snowball using the Python tooling."*

---

## 📜 References

- Tracy Fullerton, *Game Design Workshop: A Playcentric Approach to Creating Innovative Games* (4th/5th Edition), CRC Press.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
