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

## Phase 2 — Control plane skeleton ✅ (§V, §XIII–§XVII, §XXVI)

- [x] `.agent/` tree per §V, with `.agent/state/` gitignored (§XVIII) — verified with `git check-ignore`
- [x] `.agent/CONSTITUTION.md` — 12 articles, version 1.0.0 (§XLVI)
- [x] `.agent/memory/INVARIANTS.md` — 14 invariants, each naming source + protecting test; the two with no protection say so (§XIV)
- [x] `.agent/memory/decisions/` — ADR-0001..0007 (§XV)
- [x] `.agent/memory/lessons/` — L001–L005, each from a defect already paid for (§XVI)
- [x] `.agent/agents/*.md` — seven capability profiles + index (§XXVI, §XXVII)
- [x] `.agent/registry/*.yaml` — domains, risks, tests, skills, sources, policies; all parse (§XXIII)

**Acceptance:** ✅ every invariant names a source, and the two lacking a protecting check are
marked rather than implied · ✅ no ADR describes an ordinary bug fix · ✅ `.agent/state/`
ignored, README tracked · ✅ 6/6 registry files parse as YAML.

---

## Phase 3 — Machine truth ✅ (§X, §XI, §XXII, §XXXV)

- [x] `npm run agent` CLI, `--json` on every subcommand (§X)
- [x] `agent facts` → six generated files, plus `--check` drift mode (§X)
- [x] Derived from source, not prose — imported where possible, parsed only for the route tree
- [x] `agent doctor` → capability matrix, credentials as SET/NOT SET only (§XXII)
- [x] Source-dependency declarations in `.agent/registry/sources.yaml` (§XI)
- [x] `tests/agent-facts.test.ts` — 10 tests, including non-emptiness

**Acceptance:** ✅ role map = the six roles · ✅ AI contract imported from the registry, alias
invariant asserted · ✅ `doctor` reports this machine honestly (no Docker, no Redis, no gcloud,
no AI keys) and prints no secret · ✅ `facts --check` exits 1 on tampering, 0 when clean ·
✅ `tsc` 0, `eslint` 0 errors, 43 tests pass.

---

## Phase 4 — Context compiler and impact engine ✅ (§XIX, §XX, §XXI, §XXIII, §XXIV)

- [x] `agent brief --paths <...>` / `--diff <base>` (§XIX)
- [x] `agent impact` — domains, risk, candidate tests, verification requirement (§XXIII)
- [x] Risk classifier R0–R4 from `registry/risks.yaml`, plus content escalators (§XXIV)
- [x] `agent context-audit` — conservative bytes/4 estimation (§XX)
- [x] Routing evals asserting precision as well as recall (§XLVIII, pulled forward)
- [x] Context ROI counters (§XXI) — `agent roi`; the telemetry it needed now exists

**Acceptance:** ✅ `lib/ai/pricing.ts` → `telestar-ai`, R3, one skill, only the AI lesson ·
✅ docs-only → R0, zero skills · ✅ migration → R4 by escalator even though `data-prisma` is
R3 · ✅ never more than 3 skills · ✅ 30 routing evals pass · ✅ `tsc` 0, `eslint` 0 errors.

---

## Phase 5 — Engineering skill portfolio ✅ (§VI, §VII, §VIII, §IX)

- [x] `product-workflows` · `data-prisma` · `auth-rbac-tenancy` · `api-contracts`
- [x] `workers-durability` · `email-automation` · `email-deliverability`
- [x] `leadgen-intelligence` · `revenue-intelligence` · `telestar-ai`
- [x] `frontend-role-ux` · `testing-certification` · `production-release` · `security-observability`
- [x] Each carries LOAD WHEN / DO NOT LOAD WHEN, source globs, invariants, known failure modes, required tests and eval cases
- [x] All 14 flipped from `status: planned` to `active` in the registry
- [x] `tests/agent-skills.test.ts` — registry integrity and the content contract

**Acceptance:** ✅ every skill under the 1,200-token hard threshold (largest 919, ten at or
under target) · ✅ every skill has eval cases · ✅ one skill per domain, enforced · ✅ no
registry entry without a file and no file without an entry · ✅ 101 agent-system tests pass.

---

## Phase 6 — Drift prevention and project-truth CI ✅ (§XII, §LIV, §LVI, §LII)

- [x] `agent check` — six deterministic checks: generated-facts (covers role, AI model and env sync), context-budget, dead-references, stale-architecture-language, memory-hygiene, registry-integrity (§LIV)
- [x] `agent knowledge-audit` — which active skills have had their sources move underneath them, by git commit date (§XII)
- [x] Wired into CI as a mandatory step in the `quality` job (§LVI)
- [x] `tests/agent-check.test.ts` — asserts the tree is consistent and every check is capable of failing
- [ ] Full release-integrity aggregate (§LVI) — the PR gate is in place; the release-only superset lands with phase 9

**Acceptance:** ✅ injected drift (tampered `role-map.json` + a Vercel claim in a rule) →
exit **1**, both named · ✅ restored → exit **0** · ✅ `tsc` 0, `eslint` 0 errors, 104
agent-system tests pass.

---

## Phase 7 — Document layering and garbage collection ✅ (§XXXVI, §XXXVII, §LIII)

- [x] `docs/README.md` — the index: source hierarchy, classification table, live pointers, finished work
- [x] Classification front matter on all 17 status documents (§XXXVII)
- [x] `NOT CURRENT` banner on every historical one, naming where the behaviour now lives
- [x] `document-classification` added to `agent check` so this cannot decay
- [~] Physical `docs/archive/` move — **deliberately not done**; see below
- [~] Delete duplication (§LIII) — one document flagged `NEEDS_REVIEW` for a human rather than deleted by guess

**Acceptance:** ✅ no status document reads as current without saying so · ✅ 17/17 classified,
enforced by CI · ✅ `tsc` 0, `eslint` 0 errors, 104 tests pass.

**On not moving files into `docs/archive/`.** §XXXVI describes an archive directory and it
would have been the tidier shape. These documents are referenced from source comments, tests
and other docs; relocating six directories would break those references to make an index
prettier. Classification achieves what the archive is *for* — no old status document competing
as current truth — at no cost. Recorded as a deliberate deviation, not an oversight.

---

## Phase 8 — Runtime AI intelligence ✅ (§XXXIX–§XLVII)

Separate registry from the engineering skills above; this is the product, not the toolchain.

Most of this was already built. The audit below records what existed, what was missing, and
what was deliberately left alone.

- [x] Runtime skill registry (§XXXIX) — **already existed**: `lib/ai/skill-retriever.ts`, eight modules under `lib/ai/skills/`
- [x] Router capped at 1–3 skills (§XL) — **already existed**: `MAX_RETRIEVED_SKILL_MODULES = 3`, keyword `TOPIC_RULES`
- [x] Policy precedence declared as data and enforced in the prompt (§XLI, §XLII) — **this was the gap**
- [x] Versioned constitution surfaced in the compiled prompt (§XLV, §XLVI)
- [x] Untrusted-content handling (§XLIII, §XXXVIII) — **already existed**: `lib/ai/securityGuards.ts`, `lib/ai/engine/security-guards.ts`
- [x] Database wins every conflict (§XLIV) — already an invariant, enforced by ADR-0003 and the chat trust boundary
- [x] Relevance-ranked router (§XL) — scoring replaces declaration order; role and surface added as the two missing inputs. An embedding layer remains possible and now has a seam to sit in.
- [x] Learning governance pipeline (§XLVII) — **already implemented and verified**, not deferred: `lib/learning/` runs signals → proposals → role-gated review → approval → a *new draft* version, and 34 tests cover it, including "refuses to complete a proposal nobody approved" and "approval changed nothing that is running".

**Acceptance:** ✅ precedence is data, ordered security → tenancy → CRM facts → campaign policy
→ playbook → sequence → role → skills → model knowledge, with campaign policy ranked above
runtime skills by test · ✅ the constitution now reaches the model and is asserted to appear
before the style guidance it outranks · ✅ `tsc` 0, `eslint` 0, `agent check` 7/7.

---

## Phase 9 — Evals, golden tasks, final acceptance ✅ (§XLVIII, §XLIX, §L, §LVII, §LIX)

- [x] Routing fixtures asserting recall and precision (§XLVIII) — 32 in `tests/agent-routing.test.ts`
- [x] Golden engineering tasks from real defects (§XLIX) — 8 in `.agent/evals/golden-tasks/tasks.yaml`, 66 assertions
- [x] Performance metrics against the phase 0 baseline (§L, §LI) — recorded in `STATUS.md`
- [x] Fresh-agent acceptance, seven task types, no conversation history (§LVII) — deterministic half
- [x] Final verdict recorded (§LIX)

**Acceptance:** ✅ all seven task types route to the correct domain and risk from paths alone ·
✅ never more than 3 skills · ✅ 170 agent-system tests pass · ✅ full suite 2,313 passed with
one pre-existing Redis failure · ✅ build 0, audit 0, stale-models 0, migration-order 0.

**Limit of this acceptance.** §LVII asks for a *fresh capable agent* given representative
tasks. What is asserted here is the deterministic half: from paths alone, the control plane
produces the right domain, risk, skills and tests without reading obsolete history. Whether a
new agent then reasons well from that brief cannot be asserted by a test suite — it needs a
real cold-start run, which is a session, not a gate. Recorded as a bounded claim rather than
an overstated one.

---

## Standing rules for this initiative

- Commit per completed, verified phase-slice — not one merge at the end.
- No box ticked without evidence in `STATUS.md`; a passing command is evidence, a plan is not.
- Capture exit codes from the tool, never from the tail of a pipe.
- `BLOCKED_EXTERNAL` is not `GREEN`. `NOT_TESTED` is not `GREEN`.
- Production mutation stays behind explicit operator authorization (§XXXIV), and nothing in
  this plan grants it.
