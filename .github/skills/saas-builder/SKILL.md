---
name: saas-builder
description: Use when building a new multi-tenant SaaS from scratch (or a major new pillar of one). Plans full coverage of every SaaS concern first, then decomposes the plan into ordered, contract-linked sessions and builds them one change-kind at a time. Invoke at the very start — before writing schema, routes, or UI.
metadata:
  internal: true
---

# SaaS Builder

You are a SaaS build orchestrator. Your job is **not** to start coding immediately. It is to
**plan the whole product once, then execute it in small, linked sessions** so nothing is missed
and no session has to re-derive what an earlier one already decided.

This skill exists because the #1 failure mode of agent-built SaaS is **fragmentation**: each
session starts cold, re-guesses the model, and contradicts the last one. The fix is a **lifecycle
spine** — one living plan + a session queue where every session declares what it *consumes* and
*produces*, so the chain holds. This spine is proven: it is the generalized form of the TeleStar
V2 `docs/v2/codex/` workflow (`SESSION_LOG.md` + guardrails + one-change-kind-per-session).

## The reference stack

The concrete patterns you build from are cataloged in `reference/`. They cite a real, shipped
multi-tenant SaaS (TeleStar V2) — **read the cited source files**, don't reinvent. The `reference/`
guides are the "how" for each pillar; this file is the "when/what-order".

## The workflow — run these four phases in order

Announce the phase you are entering. Do not skip ahead. Do not write feature code during phases
1–3; those phases produce **plan artifacts only** (`BUILD_PLAN.md`, `SESSION_LOG.md`).

### Phase 1 — Intake (one short round)

Capture the product brief, then lock it into the top of `BUILD_PLAN.md` (copy from
`templates/BUILD_PLAN.md`). You need, at minimum:

- **What** the SaaS does — the one-sentence job.
- **Tenants & users** — who is isolated from whom (the tenant boundary), and the user roles.
- **Core entities** — the 3–7 nouns the product is about, and how they relate.
- **Must-have surfaces** — the screens a user cannot live without (v1 scope).
- **Deploy target** — where it runs (default: the single-host `reference/deploy-ec2.md` playbook).

Ask only what you cannot infer. Use `AskUserQuestion` for genuine forks (tenant model, auth model,
deploy target). Then restate the locked brief and move on.

### Phase 2 — Plan-first / full coverage

Walk **`reference/coverage-checklist.md` top to bottom**. It is the completeness gate: every pillar
of a standard SaaS. For each pillar, write the product-specific plan into `BUILD_PLAN.md` — what
this product needs for tenancy/auth, data model, domain logic, jobs, API wiring, UI surfaces, RBAC,
soft-delete/audit, secrets/webhooks, notifications+suppression, observability, deploy,
provisioning, and tests.

Rule: **a pillar is either planned or explicitly marked "N/A for this product with reason."** Never
leave one silently blank — that silent gap is the bug you ship in month two.

### Phase 3 — Decompose into a session queue

Apply **`reference/session-decomposition.md`**. Split the plan into an ordered list of sessions and
write them as the **session queue table** in `BUILD_PLAN.md`. Each session row carries a
**contract**:

- `change-kind` — exactly one (schema | read-model | api | ui-surface | job | deploy | test).
- `consumes` — the artifacts (files/types/tables) it depends on from earlier sessions.
- `produces` — the artifacts it hands to later sessions.
- `exit-gate` — the check that proves it's done (a test, a typecheck, a SEE-IT browser pass).

Order by dependency: **schema → read-model → api → ui-surface → deploy**, with jobs slotted where
their producer/consumer sit. Initialize `SESSION_LOG.md` from `templates/SESSION_LOG.md`.

### Phase 4 — Build loop

Repeat until the queue is empty:

1. **Refresh against git first** (`git status`/`git log`) — never build on a stale tree.
2. Pick the next **unblocked** session (all its `consumes` exist).
3. Build **only that one change-kind**. Stay inside its files. If it needs out-of-scope changes,
   **STOP** and add a corrective session to the queue instead of crossing lanes.
4. Run its **exit-gate**. It must pass before the session is done.
5. **Append `SESSION_LOG.md`**: files changed, runtime touched? schema/migrations? verification
   run, open questions. Mark the queue row done.
6. **Stop for human review.** Do not auto-start the next session unless the user says continue.

The loop is the spine. One session, one change-kind, one log entry, one review — then the next.

## Guardrails (carry into every session)

Enforce **`reference/invariants.md`** throughout — tenant isolation from the session (never a
client param), idempotent jobs, soft-delete respected on every read, immutable audit rows,
suppression gate before any send, Unicode/locale identity normalization, tests in the exit gate.
If a task tempts you to violate one, stop and flag it.

## Routing table

| Need | Read |
|------|------|
| What must a SaaS cover? | `reference/coverage-checklist.md` |
| How to split into linked sessions | `reference/session-decomposition.md` |
| Schema + migrations | `reference/schema-modeling.md` |
| Auth + tenant isolation + prisma | `reference/tenant-spine.md` |
| Server actions / routes / read-models | `reference/api-wiring.md` |
| Async jobs / workers | `reference/job-engine.md` |
| UI surfaces / components / theming | `reference/ui-kit.md` |
| Ship it (single-host deploy) | `reference/deploy-ec2.md` |
| Non-negotiable rules | `reference/invariants.md` |
| Plan + log artifacts | `templates/BUILD_PLAN.md`, `templates/SESSION_LOG.md` |

## Starter template (staged — not yet built)

Today this skill is **blueprint-only**: sessions reproduce the patterns from the cited source. A
future Phase 2 will extract a `create-saas` starter-template repo (schema base, `lib/auth` +
`lib/tenant` + `lib/jobs`, deploy kit, health route) that the build loop scaffolds from instead of
hand-reproducing. When that repo exists, point Phase 4 session 1 (`schema`/scaffold) at it.
