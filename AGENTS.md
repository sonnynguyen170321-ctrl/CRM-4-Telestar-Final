# AGENTS.md â€” Lead Gen Intelligence / TeleStar SDR OS V2

## Project status

V1 is frozen as legacy/LTS. V2 is built side-by-side.

## Must read before work

1. `docs/V2_FINAL_EXECUTION_PLAN_V10_ENTERPRISE.md`
2. `docs/v2/codex/V2_CODEX_GUARDRAILS.md`
3. Active phase spec
4. Relevant ADRs

`docs/V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md` is historical reference only. V10 Enterprise is the canonical execution plan.

## ACTIVE CO-CODE PHASE (pinned 2026-07-09) — read `docs/v2/UNIFIED_UI_THEME_PLAN.md`

Claude (Opus) and Antigravity are co-coding the **Unified Leadger UI theme + bug/API backlog**. That plan
doc is the shared source of truth for this phase. Ownership split (do not cross lanes):

- **Claude** owns: bug fixes (needs-contact scoring gate/label/upload, Vietnamese dedup, soft-delete leak,
  send recovery), the shared `DataTable` + state-kit primitives, and Pillar D API/route architecture
  (kill the 5s poll → SSE/backoff, granular revalidation, cached read-models, off-request drain). Anything
  touching scoring, queries, schema, or route logic.
- **Antigravity** owns (UI phase, its normal lane): once `DataTable` + the state kit exist, **migrate the
  ~12 surfaces onto them** — Contacts + Accounts first, then the CRM cluster, then the rest. UI/component
  only: consume the shared primitives + existing read-models; **no scoring, schema, API, or query changes**;
  one surface per session; stay inside that surface's files; append `docs/v2/codex/SESSION_LOG.md`.

Both: keep the V2 invariants, no commit without the user asking, refresh against git first, and if a task
needs out-of-lane changes, STOP and flag. This is a UI + bugfix phase — the V10 implementation hold below
still applies to net-new backend phases.

## Agent roles

### Codex
Pinned execution agent. One phase per session. Future owner of schema, migrations, scoring, and server logic only when the active phase explicitly allows that scope.

### OpenCode
In-editor helper only. May edit only active allowed files. Must not expand scope.

### Antigravity
UI/component generation only in an explicitly approved UI phase. Forbidden from scoring, server, schema, migrations, and V1.

## Absolute restrictions

- Do not modify V1 unless explicitly requested.
- Do not touch `prisma/schema.prisma` unless current phase allows schema work.
- Do not create migrations unless current phase allows migrations.
- Do not proceed to next phase without human review.
- Do not commit unless user asks.

## Current implementation hold

V10 Enterprise is now the source of truth for execution planning. Implementation is frozen before V2.A2, V2.9, and V2.10 because enterprise backend invariants must be locked before Manager Review UI, CRM UI, runtime scoring, ingestion runtime, outreach, email, or sequence work.

Next planning sequence:

```txt
V2.CORE0 -> V2.CORE1 -> V2.JOB0 -> V2.INGEST-HV0 -> V2.SCORE-HV0 -> V2.CRM0
```

Do not proceed to:

- V2.A2 Manager Review
- V2.9 UI shell
- V2.10 Company/Lead review UI
- V2.CORE1 schema unless V2.CORE0 and CORE1 planning are approved
- V2.JOB0 async job engine unless explicitly scoped
- V2.INGEST-HV0 high-volume ingestion runtime unless explicitly scoped
- V2.SCORE-HV0 bulk scoring runtime unless explicitly scoped
- V2.CRM0 lead workspace / manager review UI unless explicitly scoped
- runtime scoring implementation
- benchmark scripts
- schema/migrations
- API routes
- UI routes/components

ICP scoring guardrails:

- Weak benchmark output is not production truth.
- AI agent output is not production truth.
- Company-only data may pre-rank accounts but must not overclaim final qualification for persona-sensitive ICPs.
- Any ICP implementation must separate fitScore, confidenceScore, evidence quality, required evidence, persona readiness, account pre-rank, and final qualification.
- Use `QUALIFIED` / `NEEDS_REVIEW` / `UNQUALIFIED`.
- Do not use `uncertain` as canonical qualification output.
- Benchmark scripts must not call live AI providers.
- AI assessment fields are imported/human-filled advisory data only.

## Required final response for agent sessions

- Files changed
- Runtime changed? yes/no
- Schema/migrations changed? yes/no
- V1 touched? yes/no
- Verification run
- Open questions

## V2 INVARIANTS (read before every V2 session)

These are non-negotiable. If a task tempts you to violate one, STOP and flag it for human review instead of proceeding. Cite the relevant invariant number in your session log.

1. V1 IS FROZEN AND OFF-LIMITS AS A BUSINESS/RUNTIME DEPENDENCY.
   V2 must build its own runtime for every capability, even when V1 already has it (upload, parse, scoring, export, activity recap). V2 must not import from, call, proxy to, or share database tables/queues with V1 business logic. "V1 already has X" is never a reason to skip building X in V2. Allowed shared infrastructure is limited to explicitly V2-scoped auth/tenant/prisma infrastructure such as `@/lib/server/prisma`; it must not become a backdoor to V1 tables or V1 behavior. Self-check each runtime session for V1 business imports and non-`V2` table reads/writes.

2. THE UNIT IS `LeadAssignment`, NEVER `Company`.
   A company is never globally scored. Scoring/review/activity/outreach attach to LeadAssignment (= Company x Project x ICPVersion). Do not add a global company score or a global company status.

3. QUALIFICATION IS NOT WORKFLOW STATUS.
   Qualification (immutable, on HardRuleAssessment) and workflowStatus (mutable, on LeadAssignment) are separate. Never merge them or derive one blindly from the other.

4. ASSESSMENTS ARE IMMUTABLE.
   Never update a HardRuleAssessment. Always insert a new one and move `latestHardRuleAssessmentId` in the same transaction, except when an idempotent rerun reuses an already-existing identical assessment by fingerprint. Every score writes full input and rules snapshots.

5. TENANT ISOLATION IS MANDATORY.
   Every query and insert is scoped by `organizationId` from the authenticated session, never from a client parameter. Add or keep a cross-tenant check for any new read model. Org A must never see Org B.

6. IDEMPOTENCY ON ALL JOBS/UPSERTS.
   Re-running a job or re-uploading the same file must not create duplicate leads/assessments/review items. Use idempotency keys or content hashes, not filenames. State this in the session log for any runtime session.

7. NO FAKE ROWS FOR DISPLAY STATES.
   `NOT_SCORED` is read-model/UI-derived when `latestHardRuleAssessmentId IS NULL`. Never create placeholder HardRuleAssessment rows. `UNCERTAIN` is deprecated for canonical V2 output: SCORE-HV0 persistence, V2 CRM read models, and V2 UI must not newly write or surface it. Historical/internal lowercase `uncertain` helpers are cleanup candidates, not approval to reintroduce `UNCERTAIN` as canonical output.

8. SOFT-DELETE IS RESPECTED EVERYWHERE.
   Every read (leads, reviews, dashboards, exports, activity) filters `deletedAt IS NULL` where the model has `deletedAt`; otherwise it must respect active status fields. Never hard-delete core records in normal flows.

9. SECRETS AND WEBHOOKS ARE SECURED.
   Sender/provider credentials are stored encrypted and never logged. Inbound webhooks (for example email events) must verify provider signatures before acting; unsigned events are rejected.

10. SUPPRESSION IS THE LAST GATE BEFORE ANY SEND.
    No email (manual or sequence) leaves the system without a synchronous suppression check immediately before the provider call. No flag or fast path may skip it. This applies once outreach is in scope.

11. UNICODE / VIETNAMESE NORMALIZATION FOR IDENTITY.
    Company/contact matching must normalize Unicode (NFC), strip diacritics for comparison, and handle Vietnamese legal prefixes (Cong ty / TNHH / CP) and casing. Add Vietnamese fixtures. Wrong normalization creates duplicate or merged leads.

12. ONE PHASE / ONE CHANGE-KIND PER SESSION.
    Do not combine unrelated UI and backend work in one session. Schema + mapper + read-model may travel together when explicitly scoped. UI sessions may include a read-only tenant-scoped option/read-model helper only when the active phase explicitly allows it. Stay inside the allowed files; if the task needs more, stop and propose a scope correction first.

13. TESTS ARE PART OF THE EXIT GATE.
    Any backend session adds or updates the automated check for the behavior it introduces (idempotency, tenant isolation, transition validity, suppression, resolver branches). If the repo area still uses smoke scripts instead of a formal test runner, add or update the relevant smoke check and call out the test-runner gap in the session log.

14. SEE-IT PAIRING.
    A backend-only session must be immediately followed by a SEE-IT browser surface; no next macro-phase starts before SEE-IT passes. Planning/docs gates are exempt.

15. NEVER COMMIT, NEVER ADVANCE WITHOUT REVIEW.
    Do not commit unless explicitly asked. One session, then stop and append `docs/v2/codex/SESSION_LOG.md`. Do not auto-start the next phase. Refresh against actual git state before acting on any plan.

16. SOURCE OF TRUTH HIERARCHY.
    Architecture baseline = V10 Enterprise; its "next phase" pointer is stale. Active execution map = `docs/V2_FINAL_EXECUTION_PLAN_V10_ENTERPRISE.md`. Docs marked historical are not executable. V1-era mocks (`UI_UX_FLOW.md`, `APP_SKELETON.md`) are not the V2 model.

(End of section.)
