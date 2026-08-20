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

**Verdict: `TELESTAR ENGINEERING INTELLIGENCE OS: NOT GREEN`** — phases 0–5 complete of 9.

---

## Current phase

**Phase 6 — drift prevention and project-truth CI.** Next task is `agent check` and
`agent knowledge-audit`. See `PLAN.md` phase 6.

### Phase 5 result — 2026-08-20

Fourteen skills written to the §VII contract and activated in the registry. Routing now
resolves to content rather than to a placeholder.

Token cost, measured by `agent context-audit`:

| Band | Skills |
|---|---|
| at or under the 800 target | 10 |
| 800–1,200 (review band) | 4 — `telestar-ai` 919, `production-release` 892, `auth-rbac-tenancy` 870, `data-prisma` 863 |
| over 1,200 (hard threshold) | **0** |

The four in the review band are the domains carrying the most hard-won failure detail. They
stay whole for now; if any crosses 1,200 the supporting reference material splits out of the
core rather than riding along on every load.

Each skill records what actually went wrong here, not generic advice: the withdrawn model id,
the migration that sorts before its tables, the `.passthrough()` that accepted a key the prompt
never read, the delete-and-recreate that silently reschedules every in-flight lead, the client
report that must never carry a rep name.

`tests/agent-skills.test.ts` holds the registry honest in both directions — no entry without a
file (which would route an agent to nothing, silently), and no file without an entry (knowledge
nobody loads, drifting unread). It also enforces one skill per domain, since two would make
selection arbitrary.

### Phase 4 result — 2026-08-20

`agent brief`, `agent impact`, `agent context-audit`. Routing is registry-driven: changing
which domain owns a path is a one-line YAML diff, not an edit to a classifier.

Measured routing behaviour:

| Change | Domain | Risk | Skills loaded |
|---|---|---|---|
| `lib/ai/pricing.ts` | telestar-ai | R3 | 1 |
| `lib/auth.ts` | auth-rbac-tenancy | **R4** | 1 |
| `prisma/migrations/.../migration.sql` | data-prisma (R3) | **R4** by escalator | 1 |
| `components/LeadCard.tsx` | frontend-role-ux | R1 | 1 |
| `workers/sequence.ts` + `lib/sequences/engine.ts` | workers-durability + email-automation | R3 | 2 |
| `docs/agent-os/PLAN.md` | documentation | **R0** | **0** |
| six domains at once | six | R4 | **capped at 3** |

Risk is the maximum across touched domains, then raised by content escalators — never
averaged. A change that is mostly documentation plus one migration is a migration.

`context-audit` reports startup context at **2,459 tokens**: `REVIEW` against the 2,000 target,
inside the 3,000 hard threshold, exit 0. Scoped `.claude/rules/*` are correctly excluded — all
six carry `paths:` frontmatter, so none is startup cost.

### Two bugs found by building it

**A glob compiler that matched everything.** The first `globToRegExp` chained `.replace()`
calls whose expansions contain the same metacharacters being matched, so each replacement
rewrote the previous one's output and the result was an empty pattern — which matches every
path. Every file would have resolved to whichever domain was declared last. Rewritten as a
single-pass scanner; `tests/agent-routing.test.ts` now asserts the negative cases explicitly,
because a router that matches everything passes every positive test.

**A comment that closed itself.** A doc comment containing the glob `app/` + `**` + `/page.tsx`
ends the block comment early — `*/` is `*/` wherever it appears. The file stopped parsing.
Worth knowing before writing glob examples in TypeScript comments.

### Deferred

Context ROI counters (§XXI) need per-session telemetry — which skills were loaded versus which
were actually used — and no such signal exists yet. Recorded as deferred rather than silently
dropped.

### Phase 3 result — 2026-08-20

`npm run agent -- facts | doctor`, both with `--json`.

Six generated files, each derived from the code that defines it:

| File | Derived by | Result |
|---|---|---|
| `role-map.json` | scanning the authorization layer | 6 roles |
| `ai-contract.json` | **importing** `lib/ai/registry.ts` | 3 models, alias invariant true |
| `env-contract.json` | **importing** `lib/env-contract.ts` | 3 AI providers, 17 production-required |
| `route-map.json` | walking `app/**` | 34 pages, 169 API routes |
| `queue-map.json` | **importing** `lib/bullmq/types.ts` | 6 queues, 18 job types, 9 workers |
| `project-facts.json` | `package.json` | stack + script inventory |

`facts --check` regenerates and diffs rather than trusting the committed copy: it exits 1 when
a generated file no longer matches its source. That is the drift gate phase 6 wires into CI.

### Drift corrected: the AI environment contract

`lib/env.ts` declared the whole "AI assistant" optional group as **`GROQ_API_KEY` alone** —
dating from when Groq was primary and Gemini the fallback. Meanwhile
`scripts/prod-check-env.ts` and `.env.production.example` correctly required all three
providers.

A deployment holding only a Groq key therefore **booted with no warning at all**, while the
deploy gate would have refused it. The three-provider failover that the whole gateway
architecture exists to provide would simply not have existed, and nothing at runtime would
have said so.

Both now read from one declaration in `lib/env-contract.ts`, which is also what the generator
imports. §LV "missing production AI env alignment", closed.

### A generator that was confidently empty

The first queue generator pattern-matched `new Queue('name')`. The names are a `QUEUES`
constant and the only `new Queue(` call passes a variable, so it matched nothing and wrote an
empty queue list — without failing. A silently empty generated fact is worse than no
generator, because a document can then cite it.

Rewritten to import `lib/bullmq/types.ts`. `tests/agent-facts.test.ts` now asserts
non-emptiness for every generator, which is the general form of that failure.

### Phase 2 result — 2026-08-20

`.agent/` exists as the tool-neutral control plane: constitution, registry, memory, capability
profiles.

| Artifact | Content |
|---|---|
| `CONSTITUTION.md` | 12 articles, v1.0.0 — evidence hierarchy, exact-candidate rule, minimum sufficient context, risk, production boundary, trust boundaries, teach-once |
| `registry/domains.yaml` | 15 domains → paths, real test globs, e2e dirs, gates, verification requirement |
| `registry/risks.yaml` | R0–R4 with obligations, 7 escalators, and the non-reasons that never lower a class |
| `registry/tests.yaml` | the four-rung ladder, static gates, external prerequisites |
| `registry/sources.yaml` | 11 subjects → the file that decides each |
| `registry/skills.yaml` | 14 skills indexed with LOAD WHEN / DO NOT LOAD WHEN, all `status: planned` |
| `registry/policies.yaml` | 10 policies, each naming what enforces it — or `none`, where nothing does yet |
| `memory/INVARIANTS.md` | 14 invariants with source + protecting test |
| `memory/decisions/` | ADR-0001..0007 |
| `memory/lessons/` | L001–L005 |
| `agents/` | 7 capability profiles + index |

Two invariants are recorded as **unprotected** rather than assumed safe: candidate-SHA binding
of evidence (13) and the kernel-does-not-grow budget (14). Both land in phase 6. Naming the gap
is worth more than implying coverage that does not exist.

`policies.yaml` does the same for policies: `production-authorization`,
`independent-verification`, `exact-candidate-evidence`, `generated-not-authored`,
`context-budget` and `kernel-does-not-grow` all currently read `enforced_by: none`. They are
stated boundaries, not enforced ones, until the phase 6 checks exist.

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
| 2026-08-20 | 2 | `js-yaml` parse of `.agent/registry/*.yaml` | 0 | 6/6 parse |
| 2026-08-20 | 2 | `git check-ignore .agent/state/probe.json` | 0 | ignored by `.gitignore:130` |
| 2026-08-20 | 3 | `agent facts` | **0** | 6 files generated |
| 2026-08-20 | 3 | `agent facts --check` (clean) | **0** | matches sources |
| 2026-08-20 | 3 | `agent facts --check` (tampered) | **1** | drift detected and named |
| 2026-08-20 | 3 | `agent doctor` | **0** | node/npm/postgres/playwright/gh present; docker/redis/gcloud/AI keys absent |
| 2026-08-20 | 3 | `vitest agent-facts + prod-env + doctor` | **0** | 43 passed |
| 2026-08-20 | 3 | `tsc --noEmit` | **0** | 0 errors |
| 2026-08-20 | 3 | `eslint .` | **0** | 0 errors, 11 warnings |
| 2026-08-20 | 4 | `agent brief --paths lib/ai/pricing.ts` | **0** | telestar-ai, R3, 1 skill |
| 2026-08-20 | 4 | `agent impact` across 5 change shapes | **0** | risk R0/R1/R3/R4 as expected |
| 2026-08-20 | 4 | `agent context-audit` | **0** | 2,459 tokens, REVIEW, under hard threshold |
| 2026-08-20 | 4 | `vitest tests/agent-routing.test.ts` | **0** | 30 passed |
| 2026-08-20 | 4 | `tsc --noEmit` | **0** | 0 errors |
| 2026-08-20 | 4 | `eslint .` | **0** | 0 errors, 11 warnings |
| 2026-08-20 | 5 | `agent context-audit` | **0** | 14 skills, none over 1,200 tokens |
| 2026-08-20 | 5 | `vitest agent-skills + agent-routing + agent-facts` | **0** | 101 passed |
| 2026-08-20 | 5 | `agent brief --paths lib/sequences/engine.ts` | **0** | email-automation, R3, 1 skill |
| 2026-08-20 | 5 | `tsc --noEmit` | **0** | 0 errors |
| 2026-08-20 | 5 | `eslint .` | **0** | 0 errors, 11 warnings |

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
