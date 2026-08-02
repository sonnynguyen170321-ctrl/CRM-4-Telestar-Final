# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed context lives in `.claude/rules/` — Claude Code loads these automatically:

| File                              | Content                                                   | Loads                   |
|-----------------------------------|-----------------------------------------------------------|-------------------------|
| `rules/project-context.md`        | Company, team hierarchy, toolstack, clients vs users      | Always                  |
| `rules/brand-design.md`           | Brand palette, design guidelines, channel + stage colors  | Always + UI files       |
| `rules/architecture.md`           | Stack, file layout, DB tables, auth, slide-over rule, state mgmt | Always + code files |
| `rules/modules.md`                | All 6 module routes, key UX per module, sidebar structure | When building modules   |
| `rules/dev-commands.md`           | npm, Prisma/Drizzle, TypeScript check, env setup          | package.json + DB files |
| `rules/workflow.md`               | SKILL.md rule, build sequence, iteration patterns, UX gotchas | Always            |
| `rules/runtime-hardening.md`      | Active initiative: runtime law, constraints, guardrails (→ plan) | Always         |

**Product spec:** `SKILL.md` — the authoritative reference for all modules, data models,
UI requirements, and iteration patterns. Always read it before writing code.

## 🔴 Active initiative — Deliverability / Email Health (item 4)

**Currently in flight.** P0–P6 are complete and green; P7a is next.

1. Read **`docs/deliverability/STATUS.md`** — resume pointer (current phase, next task, blockers).
2. Execute the next unchecked task in **`docs/deliverability/PLAN.md`**.
3. Tick the checkbox in both files when done.

> ⚠️ **`next build` is currently red** — 117 `tsc` errors and 11 failing tests, all in the
> pre-existing `client-reports` module, none from Email Health. Repairing that is task **P7a**.
> Full diagnosis in `docs/deliverability/STATUS.md` § Blockers.

> ⚠️ **Windows env trap:** the repo path contains `&` (`Sonny & AI`), which breaks every
> npm/npx `.bin` shim. Call entry scripts through node directly —
> `node node_modules/prisma/build/index.js …`, `node ./node_modules/next/dist/bin/next dev`.
> Details in `docs/deliverability/STATUS.md` § Environment gotchas.

## 🟡 Runtime Hardening + BullMQ migration

Complete except P10 infra provisioning. Before doing correctness, sequencing, email,
import, or worker/runtime work:

1. Read **`docs/runtime-hardening/STATUS.md`** — the resume pointer (current phase, next task, blockers).
2. Execute the next unchecked task in **`docs/runtime-hardening/PLAN.md`** (corrected P0–P11 roadmap + acceptance tests).
3. Tick the checkbox + update `STATUS.md` when done.

Guardrails and runtime constraints auto-load from `.claude/rules/runtime-hardening.md`.
This supersedes the original `CRM-4U_BullMQ_Runtime_Hardening_Plan.md`.
