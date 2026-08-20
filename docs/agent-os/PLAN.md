---
classification: CURRENT_CANONICAL
title: Engineering Intelligence OS — execution plan
spec: ./DIRECTIVE.md
status: ./STATUS.md
---

# Engineering Intelligence OS — execution plan

Sequencing for [`DIRECTIVE.md`](./DIRECTIVE.md). Roman numerals in each task point at the
directive section that requires it. Tick a box only when its acceptance evidence exists;
`STATUS.md` records what was actually run.

**Ordering principle.** Each phase leaves the repository working and committable. Phase 1
pays for itself immediately (it is the largest context win and the smallest risk). The
generators in phase 3 are what let phases 5–7 stop being hand-maintained prose, so nothing
that *could* be generated is written by hand before them.

---

## Phase 0 — Pin the spec ✅

- [x] `docs/agent-os/DIRECTIVE.md` — verbatim spec, `CURRENT_CANONICAL` (§XXXVII)
- [x] `docs/agent-os/PLAN.md` — this file
- [x] `docs/agent-os/STATUS.md` — resume pointer (§XVIII: the *initiative* pointer is durable; per-session state is not)
- [x] Baseline context measurement recorded in `STATUS.md` (§XX, §LI — no improvement claim without a baseline)

---

## Phase 1 — Kernel, adapters, and the bloat ✅ (§II, §III, §IV, §LV)

The measured problem: ~314 KB of always-loaded instruction, of which 251 KB is generic
language rules for stacks this repository does not use.

- [x] Rewrite `AGENTS.md` to < 200 lines / ~1,500–2,000 tokens (§II) — 161 lines, ~1,874 tokens
  - [x] Removed: caveman response instructions, stop-on-any-warning rule, runtime-hardening initiative, Neon/Vercel assumptions, old SHAs and test counts
  - [x] Kept: purpose, stack, source hierarchy, six roles, invariants, risk policy, context-loading algorithm, testing philosophy, completion semantics
  - [x] Preserved the framework-managed `nextjs-agent-rules` block
- [x] Reduce `CLAUDE.md` to `@AGENTS.md` + genuinely Claude-specific behavior only (§III) — 30,535 → 2,339 bytes
- [x] Add `paths:` frontmatter to every `.claude/rules/*.md` (§III) — 6/6 scoped, none unscoped
- [x] Remove `.claude/rules/ecc/**` — 104 files, 251 KB (§LV)
- [x] Fix the six dead skill pointers (§LV, §LIV) — `workflow.md` deleted; its true content moved into scoped rules
- [x] Correct stale facts found in rules (§LV) — four-role context, pre-development architecture rule, old module inventory, old dev commands all removed; the stale `prisma.seed` hazard warning replaced with the current guard

**Acceptance:** ✅ startup context 2,459 tokens (≤ 3,000 hard review; target 2,000 reached in
phase 3 when prose facts become generated) · ✅ no broken path references in live code ·
✅ `AGENTS.md` contains no branch name, SHA or test count · ✅ `tsc` 0, `eslint` 0 errors.

---

## Phase 2 — Control plane skeleton (§V, §XIII–§XVII, §XXVI)

- [ ] `.agent/` tree per §V, with `.agent/state/` gitignored (§XVIII)
- [ ] `.agent/CONSTITUTION.md` — engineering constitution, versioned (§XLVI)
- [ ] `.agent/memory/INVARIANTS.md` — small, each invariant carrying source + protecting test (§XIV)
- [ ] `.agent/memory/decisions/` — seed ADRs for decisions already made and already load-bearing (§XV): database truth model, worker durability, GCP canonical production, single AI gateway, six-role architecture, AI tool authorization, certification evidence model
- [ ] `.agent/memory/lessons/` — seed from defects this repository has already paid for (§XVI)
- [ ] `.agent/agents/*.md` — seven capability profiles; authority, not knowledge (§XXVI, §XXVII)
- [ ] `.agent/registry/*.yaml` — domains, skills, policies, risks, tests, sources (§XXIII)

**Acceptance:** every invariant names a source and a protecting check; no ADR describes an
ordinary bug fix; `.agent/state/` is ignored by git.

---

## Phase 3 — Machine truth (§X, §XI, §XXII, §XXXV)

Nothing derivable gets hand-maintained after this phase.

- [ ] `npm run agent` CLI entrypoint, `--json` on every subcommand (§X)
- [ ] `agent facts` → `.agent/generated/`: `project-facts.json`, `role-map.json`, `route-map.json`, `ai-contract.json`, `env-contract.json`, `queue-map.json` (§X)
- [ ] Derive from source, never from prose: roles from `prisma/schema.prisma` + auth policy; routes from `app/`; models from `lib/ai/registry.ts`; env from the validator; queues from `lib/queue/`; compose services from `docker-compose*.yml`
- [ ] `agent doctor` → capability matrix: Node, npm, Docker, Redis, Postgres test DB, Playwright, gcloud, GitHub auth, AI keys as SET/NOT SET only (§XXII)
- [ ] Source-dependency declarations so knowledge artifacts can be marked REVIEW REQUIRED (§XI)

**Acceptance:** generated role list matches the Prisma enum; generated AI contract matches the
registry; `doctor` reports this machine honestly (no Docker, no Redis, no AI keys) and never
prints a secret.

---

## Phase 4 — Context compiler and impact engine (§XIX, §XX, §XXI, §XXIII, §XXIV)

- [ ] `agent brief --paths <...>` / `--diff <base>` → domain, risk, sources, skills, ADRs, lessons, target tests, production implications (§XIX)
- [ ] `agent impact --base origin/main` → changed domains, risk class, mandatory skills, candidate tests, verification requirement (§XXIII)
- [ ] Risk classifier R0–R4 driven by `registry/risks.yaml` (§XXIV)
- [ ] `agent context-audit` → enforce the §XX budgets with conservative estimation
- [ ] Context ROI counters where cheap to collect (§XXI)

**Acceptance:** `brief` on a `lib/ai/**` diff returns `telestar-ai` and R3, not the whole
portfolio; `brief` on a docs-only diff returns R0 and loads no skill.

---

## Phase 5 — Engineering skill portfolio (§VI, §VII, §VIII, §IX)

Fourteen initial skills, each written to the §VII contract and held to the §XX budget.

- [ ] `product-workflows` · `data-prisma` · `auth-rbac-tenancy` · `api-contracts`
- [ ] `workers-durability` · `email-automation` · `email-deliverability`
- [ ] `leadgen-intelligence` · `revenue-intelligence` · `telestar-ai`
- [ ] `frontend-role-ux` · `testing-certification` · `production-release` · `security-observability`
- [ ] Each: LOAD WHEN / DO NOT LOAD WHEN, source globs, invariants, known failure modes, required tests, eval cases, source fingerprint

**Acceptance:** every skill core ≤ 1,200 tokens; every skill has at least one eval case; no
skill duplicates another's invariants.

---

## Phase 6 — Drift prevention and project-truth CI (§XII, §LIV, §LVI, §LII)

- [ ] `agent check` — role sync, AI model sync, env contract sync, deleted-path references, broken links, production topology, adapter sync, skill registry integrity, source freshness, context budget, memory hygiene, classification, forbidden stale architecture language (§LIV)
- [ ] `agent knowledge-audit` — stale fingerprints, docs older than their sources, retired model references, expired temporary data (§XII)
- [ ] Wire into CI: relevant gates on PR, full integrity on release (§LVI)
- [ ] Teach-once mapping: each repeated mistake class routed to its permanent layer (§LII)

**Acceptance:** `agent check` fails on a deliberately introduced role/model/env drift, and
passes clean afterwards.

---

## Phase 7 — Document layering and garbage collection (§XXXVI, §XXXVII, §LIII)

- [ ] `docs/current/`, `docs/generated/`, `docs/production-certification/`, `docs/archive/`
- [ ] Classification header on every non-obvious document (§XXXVII)
- [ ] Move superseded STATUS documents to `docs/archive/` with snapshot date, SHA and superseded-by link
- [ ] Delete duplication that survives only because it once existed (§LIII)

**Acceptance:** no archived document is reachable as current truth; no two documents claim to
be canonical for the same subject.

---

## Phase 8 — Runtime AI intelligence (§XXXIX–§XLVII)

Separate registry from the engineering skills above; this is the product, not the toolchain.

- [ ] Runtime skill registry with role policy, required CRM context, eval cases, safe fallback (§XXXIX)
- [ ] Router taking role, intent, surface, channel, CRM object, campaign; 1–3 skills (§XL)
- [ ] Policy precedence enforced in the prompt compiler — campaign policy above skill guidance (§XLI, §XLII)
- [ ] Context provenance labels; external content marked untrusted data (§XLIII, §XXXVIII)
- [ ] Runtime memory separation; database wins every conflict (§XLIV)
- [ ] Versioned constitution/registry/skills/router/compiler surfaced in attribution (§XLV, §XLVI)
- [ ] Learning governance pipeline — no direct outcome-to-policy rewrite (§XLVII)

**Acceptance:** a campaign policy and a generic skill in conflict resolve to the campaign
policy, proven by test.

---

## Phase 9 — Evals, golden tasks, final acceptance (§XLVIII, §XLIX, §L, §LVII, §LIX)

- [ ] Routing fixtures asserting both recall and precision (§XLVIII)
- [ ] Golden engineering tasks from real Telestar defects (§XLIX)
- [ ] Performance metrics against the phase 0 baseline (§L, §LI)
- [ ] Fresh-agent acceptance run, no conversation history, seven task types (§LVII)
- [ ] Final verdict recorded (§LIX)

**Acceptance:** the fresh agent identifies architecture, roles, domain, risk, sources, tests
and production boundary without reading obsolete history.

---

## Standing rules for this initiative

- Commit per completed, verified phase-slice — not one merge at the end.
- No box ticked without evidence in `STATUS.md`; a passing command is evidence, a plan is not.
- Capture exit codes from the tool, never from the tail of a pipe.
- `BLOCKED_EXTERNAL` is not `GREEN`. `NOT_TESTED` is not `GREEN`.
- Production mutation stays behind explicit operator authorization (§XXXIV), and nothing in
  this plan grants it.
