# V2 Activity Schema + Unified Timeline Contract (T1)

Status: contract for human review — **docs only**. Governs T2 (`V2ActivityRecord` migration), T3
(`ACTIVITY_APPLY` runtime), T4 (`queryLeadTimeline` read model), and **binds O1** (outreach schema must comply
with §3). No schema, runtime, or migration changes here.

Source of truth: AGENTS.md V2 invariants; `V2_MASTER_IMPLEMENTATION_PLAN_WORKFLOW_FIRST.md` §4 (Link A) + §4d
(runtime job-chaining contract) + §6 (T1 spec). Where this disagrees with the repo, the repo wins — re-verify.

## 0. Why this exists

"Tracking" is the third pillar of the OS (load → qualify → **track** → outreach). It is only an OS, not a set of
pages, if **everything that happens to a lead lands on ONE timeline** (Link A). That requires two things decided
up front, before any table is created:

1. A durable **`V2ActivityRecord`** for human/SDR activity (calls, meetings, manual notes, imported recaps).
2. A **timeline union contract**: the exact shape that `V2ActivityRecord` AND the future `V2OutreachActivity`
   (O1) AND audit/review events must expose, so `queryLeadTimeline` (T4) can union them without per-source
   special-casing. If outreach is designed without this contract, the timeline fragments and Link A breaks.

## 1. What already exists (grounded)

The normalize + identity layer is built (S-ENRICH era) and T3 reuses it — **do not write a second resolver**
(Invariant 1; plan §4c coding rule):

- `lib/v2/activity-recaps/normalizeActivityRow.ts` → `CanonicalActivityRow` (activityDate, sdrUser, clientAccount,
  project, company/contact identity fields, `channel`, `activityType`, `outcome`, `rawStatus`, `note`, source
  file/sheet/row, `sourceRowHash`, **`sourceActivityHash`**), plus `expandActivityRowsFromRawRow`,
  `computeSourceActivityHash`, `parseTimestampQuality`, and `normalizeActivityChannel/Type/Outcome`.
- `lib/v2/activity-recaps/matchResolver.ts` → `resolveActivityMatch` returns matched company/contact/
  leadAssignment ids + `managerReviewRequired` + reason codes + suggested actions.
- `lib/v2/activity-recaps/types.ts` → the canonical `ActivityChannel` / `ActivityType` / `ActivityOutcome` /
  `TimestampQuality` / `ImportRowKind` enums (the persisted record reuses these — no new enums).

Not yet built (this contract defines them): **`V2ActivityRecord`** (T2) and **`V2OutreachActivity`** (O1). Schema
today has `V2AuditEvent`, `V2LeadAssignment`, `V2ManagerReviewItem` (timeline sources) but no activity/outreach
event table.

## 2. `V2ActivityRecord` (T2 implements; do not create until approved)

The durable home for a single SDR/human activity event attached to a `V2LeadAssignment`.

| Field | Type | Notes |
|---|---|---|
| `id` | String @id | cuid |
| `organizationId` | String | **tenant key** — every read/write scoped by it (Invariant 5) |
| `leadAssignmentId` | String FK → `V2LeadAssignment.id` | the unit (Invariant 2); `onDelete: Restrict` |
| `companyId` | String FK → `V2Company.id` | denormalized for company-level rollups |
| `contactId` | String? FK → `V2Contact.id` | nullable (company-level activity) |
| `actorUserId` | String? FK → `V2User.id` | the SDR who performed it; `onDelete: SetNull` |
| `channel` | enum `ActivityChannel` | reuse `activity-recaps/types.ts` |
| `activityType` | enum `ActivityType` | reuse |
| `outcome` | enum `ActivityOutcome` | reuse |
| `eventKind` | String | **timeline discriminator** (see §3); e.g. `activity.call_connected` |
| `occurredAt` | DateTime | normalized to tenant tz (see §4); the timeline sort key |
| `timestampQuality` | enum `TimestampQuality` | provenance of `occurredAt` |
| `sourceActivityHash` | String | **idempotency key — UNIQUE per org** (Invariant 6) |
| `sourceUploadId` | String? | the recap upload/job that produced it |
| `sourceRowNumber` | Int? | row provenance within the upload |
| `note` | String? | free text |
| `metadataJson` | Json? | reason codes, raw status, match snapshot, warnings |
| `createdAt` / `updatedAt` | DateTime | |
| `deletedAt` | DateTime? | soft-delete respected everywhere (Invariant 8) |

Constraints & indexes:

- `@@unique([organizationId, sourceActivityHash])` — re-applying the same recap creates **zero** duplicates
  (Invariant 6). The hash comes from `computeSourceActivityHash` (row hash + channel + column + stage +
  timestamp + event index), not the filename.
- `@@index([organizationId, leadAssignmentId, occurredAt])` — the timeline hot path.
- `@@index([organizationId, companyId, occurredAt])` — company rollups.
- `@@index([organizationId, occurredAt])` — org-wide activity feed / SDR metrics.
- No cascade delete from core records; reads filter `deletedAt IS NULL`.

Insert semantics (T3): **insert-only**; a row is never mutated after creation (corrections arrive as new rows or
review resolutions). Fuzzy rows do **not** create a record — they go to manager review (§5).

## 3. Unified Timeline Contract (Link A) — the part O1 MUST comply with

`queryLeadTimeline(leadAssignmentId)` (T4) returns ONE chronological stream that is the union of every event
source for a lead. To union without per-source branching, **every source projects onto this common shape**:

```ts
type LeadTimelineEvent = {
  source: "activity" | "outreach" | "audit" | "review"; // which table it came from
  sourceId: string;            // row id in that table
  leadAssignmentId: string;    // the unit — REQUIRED on every source
  occurredAt: string;          // ISO; the single sort key across all sources
  eventKind: string;           // namespaced discriminator: "activity.*" | "outreach.*" | "audit.*" | "review.*"
  channel: ActivityChannel | "system" | "review"; // email/call/linkedin/... or non-activity channels
  actorUserId: string | null;  // who (SDR / system / manager), nullable
  title: string;               // short human label for the row
  metadata: Record<string, unknown>; // source-specific detail (outcome, reason codes, message id, ...)
};
```

The four required common fields — **`leadAssignmentId`, `occurredAt`, `eventKind`, `channel`** — are the union
key. Mapping per source:

| Source | leadAssignmentId | occurredAt | eventKind | channel | actorUserId |
|---|---|---|---|---|---|
| `V2ActivityRecord` (T2) | column | `occurredAt` | `activity.<activityType>` | `channel` | `actorUserId` |
| `V2OutreachActivity` (**O1 must expose these**) | column | send/open/reply/bounce time | `outreach.<event>` (sent/replied/bounced/…) | `email` (or channel) | sender/system |
| `V2AuditEvent` | `entityId` where `entityType` ∈ {LeadAssignment, HardRuleAssessment→its lead} | `createdAt` | `audit.<eventType>` | `system` | `actorUserId` |
| `V2ManagerReviewItem` | `leadAssignmentId` | `createdAt` (opened) / `resolvedAt` (resolved) | `review.opened` / `review.resolved` | `review` | resolver |

**O1 binding (non-negotiable):** `V2OutreachActivity` MUST carry `leadAssignmentId`, an `occurredAt`-equivalent
timestamp, an `eventKind` it can namespace as `outreach.*`, and a `channel`. It MUST NOT attach outreach to a
global company (Invariant 2). If O1 cannot fill these four, T4's union cannot include outreach and Link A is
broken — fail O1 review, not the timeline. (Plan O1 already reserves these fields; this is the contract they
satisfy.)

Read rules for `queryLeadTimeline` (T4): tenant-scoped by `organizationId`; every source filters `deletedAt IS
NULL` (or active status); ordered by `occurredAt` then a stable tiebreak (`source`, `sourceId`); pure read model,
no writes. The outreach slot is reserved now so O4+ slots in without changing the read contract.

## 4. Timezone policy

- `occurredAt` is stored as an absolute instant (UTC in the DB) but **normalized for display and bucketing using
  the tenant's timezone** (org setting), because SDR recaps are wall-clock local ("called Tue 9am").
- `parseTimestampQuality` records provenance: `exact_datetime` keeps the instant; `date_only` anchors to local
  start-of-day in tenant tz; `inferred_from_note` / `missing` / `unparseable` / `conflicting` fall back to the
  upload time and are flagged in `metadataJson` (and may route to review per §5).
- Timeline ordering uses the stored instant; day-grouping in the UI uses tenant tz. Never mix the two.

## 5. Manager-review integration (fuzzy rows never silently land)

T3 resolves identity with the SHARED `resolveActivityMatch`:

- `auto_match` → insert one `V2ActivityRecord` against the matched `leadAssignmentId`.
- `suggested_match` / `needs_review` / `no_match`, or `managerReviewRequired` (e.g. destructive outcome,
  meeting without a lead assignment, ambiguous company/contact) → **do not insert an activity row**; create a
  `V2ManagerReviewItem` carrying the normalized event + match reason codes + suggested actions. Resolution
  (existing M1 lifecycle) then creates/links the activity. The review open/resolve events appear on the timeline
  (§3, `review.*`), so even un-applied activity is visible.
- Idempotency holds across both paths: the same `sourceActivityHash` never produces two records **or** two review
  items.

## 6. Runtime linkage (do not repeat the enrichment leak — plan §4d)

T3 runs as the `ACTIVITY_APPLY` job (currently a stub). Per §4d "every enqueue names its drainer":

- Whatever enqueues `ACTIVITY_APPLY` (the recap upload/apply route) must enqueue it in a **claimable scope** —
  bound to its source (e.g. the recap upload) so a run control / the future `O5s` worker drains it. An
  `ACTIVITY_APPLY` job enqueued `MANUAL`/unclaimable will silently stall exactly like enrichment did.
- T3 adds its chain to `scripts/check-v2-pipeline-linkage.mjs` (smoke S1c) and an `ACTIVITY_APPLY` idempotency +
  fuzzy-to-review smoke (`check-v2-activity-apply.mjs`).

## 7. Exit criteria for T1 (this doc)

- `V2ActivityRecord` fields, indexes, idempotency key, tenant isolation, soft-delete: defined (§2).
- Unified timeline shape + the four union fields + per-source mapping: defined; **O1 is bound to it** (§3).
- Timezone policy: defined (§4).
- Manager-review path for fuzzy rows: defined (§5).
- Runtime claim-scope obligation for `ACTIVITY_APPLY`: stated (§6).

Approve this before T2 creates the migration. T2 implements §2 verbatim; T4 implements §3 verbatim; O1 must read
§3 before adding `V2OutreachActivity`.
