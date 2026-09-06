# Software Factory Skill

A portable Agent Skill for disciplined end-to-end software engineering.

It turns requests such as:

- "Build me an internal CRM"
- "Add CSV export to this Chrome extension"
- "Refactor this API without changing behavior"
- "Migrate this app from SQLite to Postgres"
- "Build and deploy a small automation service"

into a repeatable workflow:

`DISCOVER -> DESIGN -> PLAN -> BUILD -> PROVE -> SHIP`

## What is included

- `SKILL.md` — canonical workflow, intentionally compact
- `references/` — architecture, planning, testing, security, deployment, risk guidance
- `assets/` — project/architecture/implementation/ADR templates
- `scripts/` — dependency-free project detection, blueprint initialization, and validation
- `evals/` — test prompts and expected behaviors
- `adapters/` — thin examples for repo-level agent instructions

## Why this structure

The skill follows the Agent Skills open format: `SKILL.md` contains required metadata and workflow instructions, while scripts, references, and assets are loaded only when needed. The canonical engineering process lives here; tool-specific files should remain thin adapters.

## Quick start

Validate the skill itself:

```bash
python scripts/validate_skill.py .
```

Inspect an existing project:

```bash
python scripts/detect_project.py /path/to/project
```

Initialize blueprint docs in a target repository:

```bash
python scripts/init_blueprint.py /path/to/project
python scripts/validate_blueprint.py /path/to/project
```

Then ask an agent using this skill:

> Build an internal CRM for a 20-person SDR team. Start with account, contact, task and campaign management. Keep hosting cheap and make deployment reproducible.

or:

> Inspect this repository first. Add one-click LinkedIn profile capture to CSV without changing the current extension architecture. Plan before editing and verify the package afterward.

## Installing / using

This folder is designed to be imported as an Agent Skill. OpenAI Skills support directory or ZIP bundles, and ChatGPT/Codex can use skills where the product/workspace exposes Skills. Claude products that support Agent Skills can use the same skill folder.

Tool-specific repository instructions such as `AGENTS.md` or `CLAUDE.md` should point to this skill and describe only repository-specific commands, constraints, and permissions. Examples are in `adapters/`.

## Philosophy

- inspect before redesigning
- research unknowns before committing to architecture
- make the smallest reversible assumption when context is incomplete
- build in reviewable vertical slices
- test according to blast radius
- require evidence, not confidence
- keep production as a separate permission boundary
- do not hard-code a universal tech stack

## License

MIT. See `LICENSE`.
