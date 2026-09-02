# Plan — SDR-centric reframe + premium detail drawers + qualify override reach

> Status: APPROVED, not yet executed. Deep, production-bound session. Hosting-ready
> (AWS / any VPS), fast (no N+1), logically connected architecture.

## Context
Two linked needs:

1. **Tool logic is manager-centric, but the real reviewer + user is the SDR.** The
   permission policy (`lib/v2/tenant/permissions.ts`) locks SDRs out of the core loop:
   `workflow.update` (the qualify override), `score.enqueue`, `manager_review.decide`,
   `ingestion.apply` are all manager/admin-only. Review-item *sources* already match the
   SDR's mental model (ACTIVITY_RECAP_ROW after upload + HARD_RULE_ASSESSMENT/NEEDS_REVIEW
   leads the tool couldn't auto-check + MANUAL_SDR_REQUEST) — so the fix is **widen SDR
   access + relabel "Manager Review" → "Review queue"**, NOT a data-model change.

2. **Detail drawers are uneven.** The lead drawer (`ContactLeadDrawer.tsx`) and company
   drawer (`CompanyDrawer.tsx`) are premium + fully wired (the lead drawer already does the
   NEEDS_REVIEW→QUALIFIED/UNQUALIFIED override). The **contact drawer** (`ContactDrawer.tsx`)
   is the real gap: 7 dead buttons, a **hardcoded fake "Next Action"**, no override.

**The qualify override is already invariant-correct:** `overrideLeadQualification`
(`lib/v2/crm/leadDesk.ts:296`) INSERTS a new immutable `V2HardRuleAssessment` (copies prev,
sets `qualification` + `scoringSource="manual_sdr_override"` + `previousAssessmentId`),
moves `latestHardRuleAssessmentId`, optionally bumps workflowStatus NEW→WORKING, audits.
No mutation (Inv 3/4 respected). It just needs to be reachable by SDRs + surfaced more.

### Decisions (locked with user)
- **SDR access: full self-serve** — grant SDR `workflow.update`, `manager_review.decide`,
  `score.enqueue`, `ingestion.apply`. Keep `lead.assign`, `outreach.admin`, `ai.admin`
  manager-only.
- **Relabel "Manager Review" → "Review queue"** (UI only; keep `V2ManagerReviewItem` table
  + `ManagerReviewSourceType` — no migration).
- **Rebuild all 3 drawers to a unified premium spec** (contact drawer fully; leads/company
  polished without regressing wired behavior).
- **Contact-drawer desk actions deep-link to the lead drawer** (the contact's primary lead).
- **Qualify override reach:** lead drawer (exists) + **contact drawer** + **company
  cross-ICP rows**.

### Schema / migrations — NONE. Permissions are a policy array; drawers + override reuse
existing tables.

---

## Workflow alignment (drawers must mirror the tool lifecycle)
The tool's lifecycle is: **Company → Contact → LeadAssignment (Company×Project×ICP) → Score
→ Review/Qualify → Enroll → Campaign → Activity/Outreach**. Each drawer is a *lens on the
same unit at a different altitude*, and must show (a) where the entity sits in that
lifecycle, (b) the single most-relevant next action, and (c) honest cross-links to the
adjacent stage — never dead ends.
- **Company drawer** = account altitude: intelligence + cross-ICP LeadAssignments + best-fit
  ICP. Next action: enrich / score / **qualify a NEEDS_REVIEW row** / open a lead.
- **Contact drawer** = person altitude: identity + the contact's LeadAssignments. It does
  NOT duplicate the desk — it **routes** to the canonical lead workspace for work, and can
  **qualify** the primary lead in place.
- **Lead drawer** = the unit of work (LeadAssignment): the full desk (score, qualify,
  notes, tasks, activity, enroll, compose). This is the one canonical action surface;
  contacts/companies deep-link into it rather than re-implementing it.
- Qualification badge everywhere derives from `latestHardRuleAssessmentId` (single source);
  workflowStatus is the separate operational axis (Inv 3). The override is the only
  human path to flip NEEDS_REVIEW, and it writes a new immutable assessment (Inv 4).

## Engineering constraints (fast · hosting-ready · connected)
This is a deep, production-bound pass. Hold these the whole way:
- **Fast / no N+1.** Drawers + tables read through **batched, tenant-scoped read-models**
  (the lead drawer already bundles its 7 queries in `queryLeadDrawerReadModel`; the contact
  + company drawers must keep their single server-side batch — never fetch per row/in a
  loop). Any new per-row control (qualify in a table) submits a server action; it must NOT
  add a query per row on render. Reuse existing `LEFT JOIN latestHardRuleAssessment` joins;
  keep pagination + `LIMIT`. Filter `deletedAt` in every read (Inv 8) — already enforced by
  `scripts/check-v2-readmodel-filters.mjs` (keep it green).
- **Hosting-ready (AWS/any VPS).** Already containerized (`Dockerfile`,
  `docker-compose.prod.example.yml`); the worker URL resolves via
  `V2_WORKER_APP_URL → APP_URL → NEXT_PUBLIC_APP_URL → APP_BASE_URL` fallback. Rules: **no
  hardcoded URLs/hosts** (env only); **no secrets in client components** (drawers stay
  server components + server actions; client islands receive plain data only); all new
  config via `.env.example`. Don't break `output`/standalone build. Long-running VPS =
  Prisma's pool is fine; do not open new prisma clients (reuse the `@/lib/server/prisma`
  singleton).
- **Connected / architecture.** Drawers = thin views over shared read-models + server
  actions; one canonical desk (lead drawer) reused via a single deep-link contract
  (`leadDrawerHref` → `/v2/leads?selectedLeadId=`). Qualify override = one function
  (`overrideLeadQualification`) called from all three surfaces — never re-implemented. No
  client-fetched secrets, no duplicated SQL.

---

## Workstream A — SDR-centric reframe (the logic change)

- `lib/v2/tenant/permissions.ts`: add `"SDR"` to the `workflow.update`,
  `manager_review.decide`, `score.enqueue`, `ingestion.apply` arrays (also add `TEAM_LEAD`
  to `manager_review.decide`/`ingestion.apply` for consistency). Leave `lead.assign`,
  `outreach.admin`, `ai.admin` unchanged.
- Relabel **"Manager Review" → "Review queue"** across the UI: `app/v2/reviews/page.tsx`
  (title/eyebrow/empty states), the sidebar/nav entry, and component headings/strings
  (grep `Manager Review` / `Manager review`). Keep internal type/table names. The
  activity-recap "Manager Review Rules & Flags" card stays (it's the upload-time flag view)
  but its link target/wording aligns to "Review queue".
- No logic change to `resolveReviewItem` / the resolve route beyond the now-wider gate —
  SDRs can resolve because `manager_review.decide` includes them.

## Workstream B — Premium drawers (unified spec) + override reach

**Shared spec** (Lemlist/Apollo-grade, match existing tool logic): consistent header
(avatar/name/status + score/qualification badges), tabbed body, a right-rail of quick
actions, real data only (no placeholders), and a clear "primary action" zone.

- **Contact drawer** `components/v2/contacts/ContactDrawer.tsx` — rebuild:
  - Remove the hardcoded "Follow up on ROI deck…" Next Action; show the primary lead's real
    open task (from the lead-desk) or an empty state.
  - Wire the dead buttons as **deep-links into the lead drawer** for the contact's primary
    LeadAssignment: a primary **"Work this lead"** + Log Activity / Add Note / Create Task
    each `→ /v2/leads?selectedLeadId=<primaryLeadAssignmentId>` (reuse `leadDrawerHref` in
    `lib/v2/crm/leadRoutes.ts`; the leads page opens the drawer on mount).
  - **View company** → company drawer link (`?companyId=`); **View all activity** → the
    lead drawer Activity tab. Remove the dead `•••` / Edit no-ops or give them real menus.
  - **Qualify override:** when the primary lead is `NEEDS_REVIEW`, show Mark Qualified /
    Disqualify (server-action `<form>` → `overrideLeadQualificationAction` with the primary
    `leadAssignmentId`).
- **Company drawer** `components/v2/companies/CompanyDrawer.tsx` — in the cross-ICP
  LeadAssignments table, add a **per-row Qualify / Disqualify** control (small server-action
  form) shown when that row's qualification is `NEEDS_REVIEW`. Premium-polish the existing
  tabs; do not change the already-wired actions.
- **Lead drawer** `components/v2/leads/ContactLeadDrawer.tsx` — already wired; align to the
  unified visual spec (spacing/badges/rail) only; keep all handlers.

**Reuse:** `overrideLeadQualificationAction` (`app/v2/leads/actions.ts`, gated
`workflow.update` — now incl SDR); `getContactDetail` (`lib/v2/crm/queryContacts.ts`,
returns `linkedLeadAssignments` incl primary + qualification); `CompanyDrawer`'s existing
`leadDrawerHref`/`companyLeadsHref`; the lead drawer hydration
(`/v2/api/leads/[id]/drawer`).

## Workstream C — Override cleanup
- `lib/v2/crm/leadDesk.ts` `overrideLeadQualification`: drop the `tx as any` cast (type the
  tx properly / use the raw-SQL pattern like its siblings) so it's lint/type-clean. Behavior
  unchanged (insert-only new assessment + pointer move + audit).

---

## Critical files
**Modify:** `lib/v2/tenant/permissions.ts` (SDR grants); `app/v2/reviews/page.tsx` + nav +
review components (relabel); `components/v2/contacts/ContactDrawer.tsx` (rebuild);
`components/v2/companies/CompanyDrawer.tsx` (cross-ICP override + polish);
`components/v2/leads/ContactLeadDrawer.tsx` (visual align); `lib/v2/crm/leadDesk.ts`
(override cleanup).
**Reuse (don't duplicate):** `app/v2/leads/actions.ts` (`overrideLeadQualificationAction`,
desk actions), `lib/v2/crm/leadRoutes.ts` (`leadDrawerHref`), `lib/v2/crm/queryContacts.ts`
(`getContactDetail`), the lead-drawer provider/api, shared `PageHeader/PanelCard/MetricCard`.

## Phased execution (each phase independently verifiable — tsc + lint + vitest green before the next)
1. **Permission reframe + relabel** (Workstream A). Smallest, unblocks SDR-as-reviewer.
   Verify with a policy unit test + SEE-IT an SDR session reaching the review queue.
2. **Override cleanup + reach** (Workstream C + the override parts of B): clean
   `overrideLeadQualification`; add the qualify control to the contact drawer + company
   cross-ICP rows (server-action forms reusing `overrideLeadQualificationAction`). Verify a
   NEEDS_REVIEW flip writes a new assessment + moves the pointer + audits.
3. **Contact drawer rebuild** (Workstream B): remove the hardcoded Next Action, wire the
   deep-links to the lead drawer, View-company link, premium layout.
4. **Company + lead drawer polish** to the unified spec (no behavior regression).
5. **Final gate:** full `tsc`/`lint`/`vitest` + the read-model/revalidation/pipeline
   scanners + SEE-IT all three drawers. Commit only when asked.

## Invariant guardrails
- #3 qualification ≠ workflowStatus (override only writes a new assessment; never merges).
- #4 assessments immutable (override is insert-only — already correct).
- #5 tenant scope from session. Permission widening is an explicit product policy change
  (SDR = the user), not an isolation change.
- #15 no commit unless asked.

## Verification
1. `npm run typecheck` + `npm run lint` + `npx vitest run`. Add/adjust a permission-policy
   unit test asserting SDR now has `workflow.update` + `manager_review.decide` +
   `score.enqueue` + `ingestion.apply` (and still NOT `lead.assign`/`outreach.admin`).
2. As an SDR session: open `/v2/reviews` (now "Review queue") → resolve an item; on a
   NEEDS_REVIEW lead → Mark Qualified → a NEW assessment row appears, badge flips to
   QUALIFIED, `latestHardRuleAssessmentId` moved, audit `lead.qualification_overridden`
   written, prior assessment untouched.
3. Contact drawer: dead buttons gone; Work-this-lead + desk buttons deep-link to the lead
   drawer; View company opens the company drawer; NEEDS_REVIEW primary lead shows
   Qualify/Disqualify and works.
4. Company drawer: a NEEDS_REVIEW cross-ICP row shows Qualify/Disqualify → flips that lead.
5. SEE-IT all three drawers — premium, consistent, no placeholders, no console warnings.
