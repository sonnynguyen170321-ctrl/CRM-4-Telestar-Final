# V2 Phase 1 — Codex Prompt Pack

> One scoped prompt per session. Companion to `V2_PHASE1_EXECUTION_LOGIC_SPEC.md` (the "why/code logic")
> and `V2_SCORING_CRM_ACTION_MAP_V1_1_1.md` (the order/rules).
>
> **HOW TO USE — read before running any prompt:**
> 1. Run ONE prompt per Codex session. Never chain.
> 2. **Refresh against state first:** before running a prompt, paste the latest `git log --oneline -5` +
>    `git status` and the relevant file's current content. These prompts assume the verified state as of the
>    audit; if a prior session changed something, update the prompt.
> 3. Run a prompt only AFTER the previous session's human review gate passed.
> 4. Every prompt ends with: append `docs/v2/codex/SESSION_LOG.md`, stop, wait for review.
> 5. Backend pair (S0B) must be followed by its SEE-IT (S0C) before any other macro-phase.

Standard verification block (referenced as **[VERIFY-CODE]** below):
```
git status --short
git diff --name-only
npm run lint && npm run typecheck && npm run build
git diff -- lib/server app/api  # must be empty (no V1 touch)
```
Schema sessions also run: `npx prisma validate && npx prisma migrate dev --name <name> && npx prisma generate`.

---

## P1.S0A — Qualification/assessment schema audit (PLANNING GATE, no code)

```
CONTEXT: TeleStar SDR OS V2, phase P1.S0A. Invariant: LeadAssignment is the unit; HardRuleAssessment is
immutable; the multi-ICP signals accountPreRank/missingEvidence currently live inside JSON blobs and are not
queryable. This session produces a DIFF PLAN only — no code.

GOAL: Output an exact, reviewable schema/read-model diff plan to make multi-ICP signals first-class and to fix
the UNCERTAIN ghost state. No edits.

ALLOWED (read only): prisma/schema.prisma; lib/v2/scoring/**; lib/v2/crm/**; lib/v2/manager-review/**.

FORBIDDEN: editing ANY file except appending docs/v2/codex/SESSION_LOG.md; touching V1 (lib/server/**, app/api/**);
inventing names not found in code; adding NOT_SCORED to the DB enum.

PRODUCE:
1. Exact new enum value for V2Qualification: COMPANY_QUALIFIED_NEEDS_CONTACT (confirm enum location/name).
2. New column on V2HardRuleAssessment: accountPreRank (enum STRONG_ACCOUNT_FIT|POSSIBLE_ACCOUNT_FIT|WEAK_FIT|
   CLEAR_MISMATCH) + index name. Confirm exact existing CORE1 partial-unique index names on V2LeadAssignment.
3. Decision recorded: NOT_SCORED is READ-MODEL-DERIVED when latestHardRuleAssessmentId IS NULL — NOT a DB enum,
   and no placeholder HardRuleAssessment rows are ever created.
4. Decision: deprecate vs drop UNCERTAIN from V2Qualification (recommend, with migration impact).
5. Exact change points in mapIcpAssessmentToPersistence.ts (where accountPreRank + 4th-state get written).
6. Exact change points in queryLeadWorkspace.ts / mapLeadWorkspaceRows.ts / queryReviewQueue.ts
   (replace null→UNCERTAIN coercion with derived NOT_SCORED).
7. createReviewItem(...) signature (for the later S3 ambiguous-row call).
8. Migration outline + rollback note.

VERIFICATION: git status --short shows only SESSION_LOG changed (or nothing).
SEE-IT: none (planning gate, exempt per action-map R1).
EXIT: append SESSION_LOG with the diff plan; STOP for human review. Do not start S0B.
```

---

## P1.S0B — Schema + mapper + read-model patch (BACKEND HALF)

```
CONTEXT: P1.S0B implements the S0A-approved diff. Backend only (schema + mapper + read-model). UI is S0C.
Invariants: assessments immutable; tenant-scoped; no fake rows.

GOAL: Make accountPreRank + COMPANY_QUALIFIED_NEEDS_CONTACT first-class and queryable; derive NOT_SCORED;
remove the UNCERTAIN coercion.

ALLOWED: prisma/schema.prisma; prisma/migrations/**; lib/v2/scoring/runtime/mapIcpAssessmentToPersistence.ts;
lib/v2/crm/queryLeadWorkspace.ts; lib/v2/crm/mapLeadWorkspaceRows.ts; lib/v2/crm/types.ts;
lib/v2/manager-review/queryReviewQueue.ts.

FORBIDDEN: any UI/component file; any other lib/v2 area; V1 (lib/server/**, app/api/**); creating placeholder
HardRuleAssessment rows; adding NOT_SCORED to the DB enum.

DO:
- Add column accountPreRank (enum) + index per S0A. Add enum value COMPANY_QUALIFIED_NEEDS_CONTACT.
- mapIcpAssessmentToPersistence: write accountPreRank to the column; emit COMPANY_QUALIFIED_NEEDS_CONTACT when
  accountPreRank=STRONG_ACCOUNT_FIT && qualification=NEEDS_REVIEW && missingEvidence.length>0.
- Read model: select accountPreRank; derive NOT_SCORED when latestHardRuleAssessmentId IS NULL.
- queryReviewQueue: replace null→UNCERTAIN with derived NOT_SCORED.

GUARDRAILS: never UPDATE historical assessments (backfill via re-derive or leave + note); all queries
organizationId-scoped; do not touch the ICP1R logic in assessCompanyAgainstIcp.ts.

VERIFICATION: npx prisma validate && migrate dev --name v2_p1s0b_qualification_first_class && prisma generate;
[VERIFY-CODE]; add a unit assertion: a STRONG_ACCOUNT_FIT + missingEvidence fixture maps to
COMPANY_QUALIFIED_NEEDS_CONTACT.
SEE-IT: none (paired — surfaced in S0C). No macro-phase may start before S0C.
EXIT: append SESSION_LOG with migration + rollback note; STOP for review.
```

---

## P1.S0C — Leads UI semantic patch (SEE-IT HALF)

```
CONTEXT: P1.S0C surfaces S0B. UI only. The existing /v2/leads must stop showing the ghost UNCERTAIN and start
showing the 4th qualification state + accountPreRank band.

GOAL: Make /v2/leads tell the truth on seeded data.

ALLOWED: components/v2/leads/**; components/shared/statusBadges.tsx; app/globals.css (tokens only);
app/v2/leads/page.tsx.

FORBIDDEN: schema/migrations; lib/** runtime; V1; raw hex or style={{}} (token-backed classes only).

DO:
- Add semantic tokens for qual-qualified, qual-needs-contact, qual-needs-review, qual-unqualified,
  qual-not-scored in globals.css @theme; statusBadges maps state→token (single source).
- Render COMPANY_QUALIFIED_NEEDS_CONTACT (amber) + accountPreRank band; NOT_SCORED distinct neutral/dashed.
- Remove all UNCERTAIN UI branches. Add needs_contact to the qualification filter.

VERIFICATION: [VERIFY-CODE]; visually confirm seeded leads show the 4 states + no UNCERTAIN.
SEE-IT: /v2/leads shows correct states + pre-rank bands on seeded data.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S1 — Tokens + AppShell + Context Bar

```
CONTEXT: P1.S1. The Context Bar (Account→Project→ICP) is what makes the UI multi-ICP. Without a full selection,
lead scores are not meaningful.

GOAL: A persistent global Context Bar that re-scopes /v2/leads live; finalized AppShell + locked status tokens.

ALLOWED: components/shared/AppShell.tsx; components/shared/SideNav.tsx; new components/v2/shell/ContextBar.tsx;
app/v2/**/layout.tsx; app/globals.css; one read function in lib/v2/crm/ for account→project→ICP options.

FORBIDDEN: schema/migrations; scoring/ingestion runtime; V1; raw CSS.

DO: ContextBar = cascading Account→Project→ICP Selects; selection stored in URL search params;
queryLeadWorkspace reads those params. Gate the workspace when no full context chosen (empty-state prompt).

GUARDRAILS: tenant-scoped option query; tokens only.
VERIFICATION: [VERIFY-CODE]; changing context refilters the leads table.
SEE-IT: switching Account/Project/ICP in the top bar refilters /v2/leads live.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S2A — Identity resolver (PURE-RUNTIME module + fixtures)

```
CONTEXT: P1.S2A. Identity matching is the highest-risk logic (duplicate leads / false merges / tenant leaks),
so it is built PURE first and must be reusable by company upload, activity recap, and LinkedIn import later.

GOAL: A pure identity-resolution module + fixtures. No DB, no Prisma, no job handler.

ALLOWED: new lib/v2/identity/** (module + __fixtures__).

FORBIDDEN: Prisma/DB; job handler registration; UI; V1; touching lib/v2/activity-recaps contracts (reuse, don't break).

DO: pure function: input = normalized row + {organizationId, projectId, accountId} context; output =
{kind: "exact_company"|"exact_contact"|"candidate"|"none", companyId?, contactId?, confidence, reasons}.
Order: canonical-domain exact → normalized-name within account/project → fuzzy = candidate ONLY → none.
Mirror the existing A1 activity resolver patterns. Add fixtures for each branch incl. tenant-isolation cases.

VERIFICATION: [VERIFY-CODE]; fixtures pass.
SEE-IT: none (paired with S2B).
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S2B — IDENTITY_MATCH handler + ingestion viewer

```
CONTEXT: P1.S2B wires the S2A module into the job pipeline and surfaces it. NORMALIZE currently stops; this
session connects NORMALIZE → IDENTITY_MATCH.

GOAL: Real IDENTITY_MATCH handler that marks ingestion rows, observable in a dev viewer.

ALLOWED: lib/v2/ingestion/handlers.ts; lib/v2/jobs/handlers.ts; new app/v2/ingestion/[jobId]/page.tsx +
components; a dev-only "Run seeded ingestion" trigger.

FORBIDDEN: lead upsert (that is S3); scoring; schema; V1.

DO: IDENTITY_MATCH handler reads V2IngestionRow, calls lib/v2/identity, writes matchedCompanyId/matchedContactId,
sets status (MATCHED / ambiguous stays for review / ERROR). NORMALIZE enqueues IDENTITY_MATCH on success.
Register the handler in lib/v2/jobs/handlers.ts (replace stub for IDENTITY_MATCH only).

GUARDRAILS: idempotent (re-run safe); organizationId-scoped; dev trigger is a browser button, not a CLI script (R2).
VERIFICATION: [VERIFY-CODE]; a seeded job marks rows; re-run does not change results.
SEE-IT: /v2/ingestion/[jobId] shows rows matched/ambiguous/none.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S3 — LEAD_ASSIGNMENT_UPSERT + score enqueue (⭐ loop closes)

```
CONTEXT: P1.S3 is the milestone — uploads become real scored leads. Duplicate-prevention (company vs contact
level, nullable contact) is enforced by the CORE1 partial unique indexes.

GOAL: Real LEAD_ASSIGNMENT_UPSERT handler; chain IDENTITY_MATCH → UPSERT → auto ICP_SCORE; ambiguous rows
create a read-only ManagerReviewItem.

ALLOWED: lib/v2/ingestion/handlers.ts (or new lib/v2/ingestion/upsert module); lib/v2/jobs/handlers.ts;
lib/v2/scoring/runtime/enqueueScoringJobs.ts; lib/v2/manager-review/createReviewItem.ts;
small lineage link in components/v2/leads/**.

FORBIDDEN: changing ICP1R logic; schema (use existing indexes); UI beyond the lineage link; V1.

DO: UPSERT decides level (no contact → company-level; contact → contact-level), idempotent against the partial
unique indexes; ambiguous/fuzzy rows → createReviewItem (read-only producer, one item per row);
on clean upsert → enqueueScoringJobs(leadAssignmentId). Register handler (replace LEAD_ASSIGNMENT_UPSERT stub).

GUARDRAILS: re-run creates ZERO duplicate leads/assessments/reviews (idempotencyKey); assessment still INSERTed
immutably + latestHardRuleAssessmentId moved; tenant-scoped.
VERIFICATION: [VERIFY-CODE]; seeded upload populates /v2/leads scored; re-run = 0 dups; ambiguous row = exactly 1 review item.
SEE-IT: seeded pipeline populates /v2/leads, auto-scored.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S4 — Upload + mapping API/UI (real browser loop)

```
CONTEXT: P1.S4 replaces the seed button with a real upload flow. Tenant comes from the Auth0 session, never a
query param.

GOAL: Browser upload → column mapping → run, end-to-end.

ALLOWED: new app/v2/ingestion/route.ts, app/v2/ingestion/[jobId]/mapping/route.ts,
app/v2/ingestion/[jobId]/status/route.ts; app/v2/uploads/page.tsx; new components/v2/uploads/** (FileDropzone,
MappingTable); lib/v2/ingestion/createIngestionJob.ts (intake wiring only).

FORBIDDEN: scoring/identity logic changes; schema; V1.

DO: POST /v2/ingestion creates V2IngestionJob + accepts the file → enqueue INGESTION_PARSE.
POST .../mapping saves mappingJson (validate required headers) → enqueue INGESTION_NORMALIZE. GET .../status.
UI: dropzone (CSV only, requires full Context), papaparse header preview, react-hook-form mapping with required-
field validation.

GUARDRAILS: requirePermission("ingestion.apply"); tenant from session; idempotent job creation.
VERIFICATION: [VERIFY-CODE]; upload→map→run works from the browser.
SEE-IT: real CSV upload → mapping → run.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S5 — Scoring progress UI

```
CONTEXT: P1.S5. Scoring is async; the user must watch and trust it.
GOAL: A progress screen reading V2Job aggregates.
ALLOWED: new app/v2/ingestion/[jobId]/progress route; app/v2/ingestion/[jobId]/page.tsx (upgrade);
new components/v2/ingestion/ProgressPanel.tsx.
FORBIDDEN: mutation; schema; scoring logic; V1.
DO: progress endpoint aggregates the ingestion job + child V2Jobs (progressCurrent/Total/status); UI polls
2–3s; shows counts per qualification incl. derived NOT_SCORED; leave-and-return safe.
VERIFICATION: [VERIFY-CODE]; live counts update on a real run.
SEE-IT: live progress + counts on /v2/ingestion/[jobId].
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S6 — Results table + "why" drawer (mock parity)

```
CONTEXT: P1.S6 brings /v2/leads to mock parity and makes the drawer prove multi-ICP.
GOAL: Polished results table + "why scored" drawer + multi-ICP cross-view.
ALLOWED: components/v2/leads/** (incl. new ReasonBreakdown, MultiIcpCrossView); lib/v2/crm/queryLeadWorkspace.ts
(add same-company-across-ICP query + expose accountPreRank/missingEvidence columns).
FORBIDDEN: schema; scoring logic; V1; raw CSS.
DO: TanStack table (sort/filter/virtualize 20k); ScoreRangeSlider + type/country filters; drawer shows reason,
hard-rule flags, matched/missed rules, evidence, raw input snapshot, and cross-view (same company under other
ICPs/projects with their qualifications).
VERIFICATION: [VERIFY-CODE]; perf acceptable on a 20k seed.
SEE-IT: results screen at mock parity; drawer explains "why" per ICP + cross-view.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S7 — Async export

```
CONTEXT: P1.S7. Export is the minimal way to ACT on qualified leads; project-scoped, never a global dump.
GOAL: Job-based export → signed URL.
ALLOWED: new lib/v2/export/**; lib/v2/jobs/handlers.ts (EXPORT_GENERATE only); new app/v2/exports routes;
export control in components/v2/leads/**.
FORBIDDEN: sync CSV building; schema (unless an export-job row is needed — confirm first); V1.
DO: EXPORT_GENERATE builds CSV for scope (full/qualified-only/needs-contact/selected) → store → signed URL.
GUARDRAILS: requirePermission("crm.read"); tenant + project scoped; job-based.
VERIFICATION: [VERIFY-CODE]; a job exports the filtered set; UI downloads it.
SEE-IT: one-click export of the qualified list.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S8 — Dashboard / Home

```
CONTEXT: P1.S8. A context-scoped landing summary.
GOAL: /v2/home with counts + recent uploads + upload CTA.
ALLOWED: new app/v2/home/page.tsx; new lib/v2/dashboard/** (aggregate read); components/shared/MetricCard.
FORBIDDEN: schema; mutation; V1.
DO: context-scoped counts (qualified/needs_contact/needs_review/unqualified/derived not_scored) + recent
ingestion jobs; charts via simple SVG (recharts NOT installed — confirm before adding a dep).
VERIFICATION: [VERIFY-CODE]; counts match the leads table for the same context.
SEE-IT: /v2/home dashboard.
EXIT: append SESSION_LOG; STOP for review.
```

---

## P1.S9 — Styling pass + states audit + acceptance (SHIP)

```
CONTEXT: P1.S9 ships Phase 1.
GOAL: Match the mock; guarantee loading/error/empty everywhere; prove correctness at volume.
ALLOWED: components/** and app/v2/** styling; a docs/v2 audit note.
FORBIDDEN: new features; schema; V1.
DO: restyle via tokens to match the design system; ensure all screens have the 4 states; run a
correctness/tenant/idempotency audit on a 20k-company stress seed; record scoring-agreement metric (target ≥70%).
VERIFICATION: [VERIFY-CODE]; 20k seed run clean; metrics recorded.
SEE-IT: the whole Phase-1 product, polished and shipped.
EXIT: append SESSION_LOG with acceptance results; STOP. Phase 1 ships.
```
