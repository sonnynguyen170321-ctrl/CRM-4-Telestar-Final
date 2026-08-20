---
classification: CURRENT_CANONICAL
title: Engineering Intelligence OS — status
spec: ./DIRECTIVE.md
plan: ./PLAN.md
---

# Engineering Intelligence OS — status

**Resume pointer. Read this, then `PLAN.md`. The spec is `DIRECTIVE.md` and does not change.**

Branch: `feat/agent-intelligence-os` · started 2026-08-20 · stacked on
`fix/telestar-ai-three-provider` (PR #98, unmerged).

**Verdict: `TELESTAR ENGINEERING INTELLIGENCE OS: NOT GREEN`** — phases 0–1 complete of 9.

---

## Current phase

**Phase 2 — control plane skeleton.** Next task is the `.agent/` tree and
`CONSTITUTION.md`. See `PLAN.md` phase 2.

### Phase 1 result — measured 2026-08-20

| Metric | Baseline | Now | Target |
|---|---:|---:|---:|
| Startup context (tokens) | ~79,300 | **~2,460** | ≤ 2,000 (hard ≤ 3,000) |
| Always-loaded files | 113 | **2** | ≤ 10 |
| Irrelevant-stack rule files | 104 | **0** | 0 |
| Broken path references (live code) | 6 | **0** | 0 |

**97% reduction.** Inside the §XX hard-review threshold, ~460 tokens above the target — the
remaining gap closes in phase 3, when the facts now written as prose in `AGENTS.md` become
generated.

What changed:

- `AGENTS.md` rewritten to 161 lines / ~1,874 tokens. Removed the caveman response rules, the
  stop-on-any-warning rule, the finished runtime-hardening initiative and the Neon/Vercel
  topology. Kept purpose, stack, six roles, source hierarchy, invariants, risk policy,
  context-loading algorithm, testing philosophy, completion semantics and boundaries.
- `CLAUDE.md` reduced from 30,535 to 2,339 bytes: `@AGENTS.md` plus genuinely Claude-specific
  execution mechanics only.
- `.claude/rules/ecc/**` deleted — 104 files, 251 KB, 19 stacks, 15 of them irrelevant.
- The seven remaining rules replaced by six `paths:`-scoped rules: `ai`, `auth-rbac`,
  `data-prisma`, `frontend-ux`, `production`, `workers-runtime`. None load unless a matching
  file is touched.
- Ten live references to deleted rule files repointed. Eight remain inside historical
  documents, which phase 7 will classify rather than rewrite — editing them would falsify a
  record of what was true at the time.

### Drift corrected while rewriting

The old kernel warned that `prisma/seed.ts` was "armed and wired into `prisma.seed`". That was
stale: the seed is now `prisma/seed-demo.ts`, `package.json` deliberately carries no
`prisma.seed` key, and `lib/seed-guard.ts` refuses to run it where it could destroy real data.
An agent following the old warning would have been defending against a hazard that had already
been fixed, and would not have known about the guard that replaced it.

---

## Phase 0 baseline — measured 2026-08-20

Recorded before any change, because §LI forbids calling something an improvement without a
baseline to compare against.

### Always-loaded instruction surface

| Surface | Bytes | Files |
|---|---:|---:|
| `AGENTS.md` | 2,548 | 1 |
| `CLAUDE.md` | 30,535 | 1 |
| `.claude/rules/*.md` | 32,657 | 7 |
| `.claude/rules/ecc/**` | 251,376 | 104 |
| **Total** | **317,116** | **113** |

**≈ 79,300 tokens loaded before a single line of the task is read.**

Directive §XX target is ≤ 2,000 tokens, hard review ≤ 3,000. Current surface is **~40× the
target and ~26× the hard review threshold.**

### What is in that surface

`.claude/rules/ecc/` carries rules for **19 stacks**: angular, arkts, common, cpp, csharp,
dart, fsharp, golang, java, kotlin, perl, php, python, react, ruby, rust, swift, typescript,
web.

This repository's actual stack: `next@16.3` · `react@19.2` · `typescript@5` · `prisma@6.2` ·
`bullmq@6`.

**Fifteen of nineteen stacks are irrelevant to every task this repository will ever produce.**

Observed directly in the session that produced this baseline: a task confined to
`lib/ai/pricing.ts` was served the complete HarmonyOS/ArkTS state-management rules, the
Angular TestBed harness guide, and the Swift/PHP/Ruby style guides. This is §XXI's
"agent loaded 8 skills but used 2", at rule scale.

### Defects found while measuring

| # | Defect | Evidence | Directive |
|---|---|---|---|
| 1 | Six skill pointers reference a directory that does not exist | `.claude/rules/workflow.md:23-28` → `.claude/skills/ecc/` absent | §LIV deleted-path references |
| 2 | Cross-agent root carries response-style instructions | `AGENTS.md:25-35` — caveman formatting rules | §II remove |
| 3 | Cross-agent root carries stop-on-any-warning | `AGENTS.md:37-42` | §II remove |
| 4 | Cross-agent root pinned to a finished initiative | `AGENTS.md:11-23` — runtime hardening, Neon/Vercel topology | §II remove |
| 5 | Knowledge promotion writes into the always-loaded kernel | `CLAUDE.md` carries ≥3 self-corrections of its own stale claims | §LII teach-once |
| 6 | 13 `STATUS.md` / `RESUME_HERE.md` files compete as current truth | `find docs -name STATUS.md -o -name RESUME_HERE.md` | §XXXVI, §XXXVII |

Defect 5 is the load-bearing one: because facts are stored as prose in the kernel rather than
generated from code, corrections accumulate *in the file every agent must read*. The kernel
grows monotonically and every future session pays for every past mistake. §X and §XXXV exist
to break that loop.

### Targets this baseline will be measured against

| Metric | Baseline | Target |
|---|---:|---:|
| Startup context (tokens) | ~79,300 | ≤ 2,000 |
| Always-loaded rule files | 113 | ≤ 10 |
| Irrelevant-stack rule files | 104 | 0 |
| Broken path references | 6 | 0 |
| Documents claiming current truth for one subject | 13 | 1 per subject |

---

## Evidence log

| Date | Phase | Command | Exit | Result |
|---|---|---|---|---|
| 2026-08-20 | 0 | context baseline measurement | 0 | 317,116 bytes / 113 files recorded above |
| 2026-08-20 | 1 | `wc -c AGENTS.md CLAUDE.md` | 0 | 9,837 bytes always-on (~2,460 tokens) |
| 2026-08-20 | 1 | `tsc --noEmit` | **0** | 0 errors |
| 2026-08-20 | 1 | `eslint .` | **0** | 0 errors, 11 warnings |
| 2026-08-20 | 1 | frontmatter scan of `.claude/rules/*.md` | 0 | 6/6 carry `paths:` |

Exit codes are captured from the tool itself, never from the tail of a pipe.

---

## Blockers

| Item | Blocker | Class |
|---|---|---|
| CI verification of any phase | GitHub Actions refuses to start jobs — account payment / spending limit. Run `32367576357`: 8 jobs, 0 steps, ~3s each. | `BLOCKED_EXTERNAL` |
| Docker-dependent checks | `docker` not installed on this machine | `BLOCKED_EXTERNAL` |
| Redis-dependent checks | no Redis listening on 6379 | `BLOCKED_EXTERNAL` |
| Live AI provider checks | no `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` present | `BLOCKED_EXTERNAL` |

None of these blocks phases 1–7, which are repository-local.
