# Lead Gen Intelligence — Codex Guardrails

## 0. Absolute rules

- V1 is frozen legacy/LTS.
- Do not modify V1 runtime unless a future prompt explicitly says so.
- `docs/V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md` is the canonical execution plan.
- `docs/V2_FINAL_EXECUTION_PLAN_V7.md` is historical reference only.
- One phase per session.
- Do not continue to the next phase automatically.
- Human review is required before commit and before next phase.

## 1. Required behavior every Codex session

1. Read `AGENTS.md` first if it exists.
2. Read the active phase spec.
3. Confirm allowed files.
4. Refuse or ask clarification if the task requires forbidden files.
5. Make the smallest possible changes.
6. Run required verification.
7. Append `docs/v2/codex/SESSION_LOG.md`.
8. Return file list, tests run, risks, and next recommended step.

## 2. Forbidden unless explicitly allowed

```txt
prisma/schema.prisma
prisma/migrations/**
app/** runtime routes
components/** runtime UI
lib/server/** runtime server logic
lib/scoring/** scoring logic
V1 pages/APIs/components
package dependency changes
```

## 2A. Current V8 Enterprise implementation hold

Implementation is frozen before V2.A2, V2.9, and V2.10 because V8 Enterprise requires backend invariants before Manager Review UI, CRM UI, runtime scoring, ingestion runtime, outreach, email, or sequence work.

Next planning sequence:

```txt
V2.CORE0 -> V2.CORE1 -> V2.JOB0 -> V2.INGEST-HV0 -> V2.SCORE-HV0 -> V2.CRM0
```

V2.CORE0 is docs-only and is limited to enterprise invariant ADRs:

```txt
ADR-019 through ADR-026
```

Do not proceed to:

```txt
V2.A2 Manager Review
V2.9 UI shell
V2.10 Company/Lead review UI
V2.CORE1 schema without explicit phase approval
V2.JOB0 async job engine without explicit phase approval
V2.INGEST-HV0 runtime without explicit phase approval
V2.SCORE-HV0 runtime without explicit phase approval
V2.CRM0 UI/runtime without explicit phase approval
runtime scoring implementation
benchmark scripts
schema/migrations
API routes
UI routes/components
```

ICP scoring guardrails:

```txt
Weak benchmark output is not production truth.
AI agent output is not production truth.
Company-only data may pre-rank accounts but must not overclaim final qualification for persona-sensitive ICPs.
Any ICP implementation must separate fitScore, confidenceScore, evidence quality, required evidence, persona readiness, account pre-rank, and final qualification.
Use QUALIFIED / NEEDS_REVIEW / UNQUALIFIED.
Do not use uncertain as canonical qualification output.
```

Benchmark guardrail:

```txt
Benchmark scripts must not call live AI providers.
AI assessment fields are imported/human-filled advisory data only.
```

## 3. Agent split

Codex:
- pinned execution agent
- future owner of schema, migrations, scoring, server logic only when the active phase explicitly allows that scope

OpenCode:
- in-editor helper only
- allowed files only
- no out-of-phase file creation

Antigravity:
- UI/component generation only in an explicitly approved UI phase
- forbidden from scoring, server, schema, migrations, V1

## 4. Final response contract

Every Codex final response must include:

```txt
files added/changed
runtime code changed? yes/no
schema/migrations changed? yes/no
V1 files touched? yes/no
verification commands run
known risks/open questions
next phase recommendation
```

## 5. V2.1C final lock decisions

These decisions are locked for V2 implementation until a later human-approved ADR supersedes them.

### Generic email detection

Generic email local-parts include:

- `info`
- `sales`
- `support`
- `hello`
- `contact`
- `admin`
- `marketing`
- `team`
- `office`
- `careers`
- `jobs`
- `hr`
- `noreply`
- `no-reply`

Generic emails are weak evidence only and must never auto-merge `Contact` identity.

### ActivityRecord superseding

- Corrected records use `supersedesActivityRecordId`.
- Old records remain immutable.
- Default activity views show only records not superseded by another record.
- Later optimization may use a `current_activity_records` read model.

### CSV invalid row threshold

- `0-10%` invalid rows: allow applying valid rows with warnings.
- `>10%` to `20%` invalid rows: require manager confirmation before apply.
- `>20%` invalid rows: block apply until fixed.
- Fatal header/parser error fails the job.

### Rollback permission

- Uploader can rollback their own draft/unapplied job.
- Manager/Admin can rollback `partially_applied` job.
- SDR cannot rollback another user's applied job.

### Batch policy

- Parse chunks: `500` rows.
- DB apply batches: `100-250` rows.
- These are pilot defaults and may become configurable later.

### ThemeProfile

- `ThemeProfile` remains in the roadmap.
- Default phase is after Stop & Ship.
- Earlier implementation requires explicit human approval.

### V1 boundary

- V2 must never dynamically query V1 runtime tables.
- Only one-time/manual imports are allowed with `source = v1_legacy`.

### Migration naming

- Future V2 migrations must use `YYYYMMDDHHMM_v2_<short_description>`.
- Ambiguous migration names should be rejected in review.
