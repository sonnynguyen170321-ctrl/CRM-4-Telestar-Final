# CRM Live Readiness Plan — Fix 4 Blockers, Then Run Smoke Test

**Repo:** `sonnynguyen170321-ctrl/CRM-4-Telestar-Final`  
**Goal:** Make the CRM safe and polished enough for tomorrow’s Telestar internal showcase and near-live validation.  
**Order:** Fix blockers first, run validation commands, then run the full end-to-end smoke test.

---

## Progress Tracker

Verified against the code on 2026-08-03. All four blockers were already fixed; the boxes
below had simply never been ticked, which made the document read as if nothing had been done.

```text
■ Blocker 1 — Client Report metrics        lib/client-reports/metrics.ts scopes leads through
                                           campaign.clientId, not Lead.clientId
■ Blocker 2 — prod-audit role validation   scripts/prod-audit.ts role list includes
                                           leadgen_manager and leadgen
■ Blocker 3 — EMAIL_SEND_DRY_RUN           present in .env.example and both compose files,
                                           enforced by scripts/prod-check-env.ts, honoured
                                           at workers/email.ts
■ Blocker 4 — Migration Runbook names      docs/MIGRATION_RUNBOOK.md uses BookingLink,
                                           Template, sum(value); role list current
■ Phase 5 — Local validation               tsc 0 · eslint 0 · Vitest 388/388 · Playwright 20/20
■ Phase 6 — End-to-end smoke               automated as e2e/deep-smoke.spec.ts (6 personas ×
                                           every route, role gates, outbound-email guard)
□ Phase 7 — Final demo/live sign-off       pending the actual deployment
```

> **Blocker 3 caveat — the flag is not the guard.** `EMAIL_SEND_DRY_RUN` is honoured only in
> `workers/email.ts`. `app/api/cron/sequence-engine/route.ts` sends through
> `EmailService.send()` directly and never consults it, so on any deployment without a
> worker the load-bearing guard is `SEQUENCE_AUTOSEND_ENABLED=false`. Set both, and verify
> behaviourally — `deep-smoke.spec.ts` asserts the route returns `{"disabled":true,"sent":0}`.

> **Two blockers this document never listed** were found on 2026-08-03 and are now fixed:
> the migration history did not reproduce `schema.prisma` (Meeting/BookingLink/Attachment
> and more had no migration), and the auth proxy returned 401 for every `/api/cron/*` and
> `/api/health` request before those handlers could run their own checks.

---

# Phase 0 — Setup Before Fixing

## Objective
Work safely without damaging the current main branch.

## Steps

```bash
git checkout main
git pull origin main
git checkout -b fix/live-readiness-blockers
```

## Safety Setup

Use fake/demo data only:

```text
Client: Demo Client
Campaign: Demo SDR Campaign
SDR: Demo SDR User
Leadgen Manager: Demo Leadgen Manager
Lead batch: 10 fake leads
Inbox: fake/demo inbox only
```

Make sure automation is disabled before testing email-related flows:

```env
SEQUENCE_AUTOSEND_ENABLED="false"
EMAIL_HEALTH_AUTOPAUSE="false"
```

Do **not** connect a real client mailbox during the demo test.

## Done Criteria

```text
□ New branch created
□ Local repo is clean
□ Demo/fake data plan prepared
□ Real email automation disabled
```

---

# Blocker 1 — Fix Client Report Metrics Runtime Issue

## Problem
`lib/client-reports/metrics.ts` appears to filter `Lead` records using `clientId`, but the `Lead` model does not have a direct `clientId` field.

The correct relationship is:

```text
Lead → Campaign → Client
```

If this is not fixed, **Client Report Preview may crash** when generating a report.

## Files to Check

```text
lib/client-reports/metrics.ts
app/api/client-reports/preview/route.ts
app/api/client-reports/route.ts
app/client-reports/page.tsx
```

## Required Fix

Replace any direct Lead filter like this:

```ts
const leadWhereScope: any = {
  clientId,
  ...(campaignId ? { campaignId } : {}),
};
```

with a Campaign-based scope:

```ts
const leadWhereScope = {
  campaign: {
    clientId,
    ...(campaignId ? { id: campaignId } : {}),
  },
};
```

For Lead queries, use:

```ts
where: {
  campaign: {
    clientId,
    ...(campaignId ? { id: campaignId } : {}),
  },
  archivedAt: null,
}
```

For Activity queries, use:

```ts
where: {
  lead: {
    campaign: {
      clientId,
      ...(campaignId ? { id: campaignId } : {}),
    },
  },
  createdAt: {
    gte: periodStart,
    lte: periodEnd,
  },
}
```

For Meeting queries, use:

```ts
where: {
  campaign: {
    clientId,
    ...(campaignId ? { id: campaignId } : {}),
  },
  scheduledAt: {
    gte: periodStart,
    lte: periodEnd,
  },
}
```

For Opportunity queries, direct `clientId` is okay because `Opportunity` has `clientId`.

## Extra Accuracy Fix

If the report currently uses estimated metrics such as:

```ts
const positiveReplies = Math.round(replies * 0.45);
```

Do one of these before live:

```text
Option A: Remove estimated positive replies from client-facing output.
Option B: Label it clearly as "Estimated positive replies".
Option C: Derive it from real sentiment/outcome fields later.
```

For tomorrow, safest option is **Option A or B**.

## Test This Fix

Run:

```bash
npx tsc --noEmit
npm test
npm run build
```

Manual test:

```text
□ Login as Director
□ Open Client Reports
□ Choose Demo Client
□ Choose Demo Campaign
□ Select date range
□ Generate preview
□ Confirm preview does not crash
□ Confirm KPI cards load
□ Confirm meeting section loads
□ Confirm opportunity section loads
□ Approve/freeze report if available
□ Export/share report if available
```

## Done Criteria

```text
□ Client Report Preview generates successfully
□ No Prisma unknown-field error
□ No direct Lead.clientId filtering remains
□ Estimated metrics are removed or clearly labeled
```

---

# Blocker 2 — Fix Production Audit Role Validation

## Problem
`scripts/prod-audit.ts` still treats `leadgen_manager` as an invalid role because its SQL role list is outdated.

## File to Fix

```text
scripts/prod-audit.ts
```

## Required Fix

Find the bad-role SQL check and update this role list:

```sql
'director','floor_manager','team_lead','sdr','leadgen'
```

to:

```sql
'director','floor_manager','team_lead','sdr','leadgen_manager','leadgen'
```

## Test This Fix

Create or confirm a Leadgen Manager user exists:

```bash
npm run create-user -- --email leadgen.manager.demo@telestar.local --password 'DemoPassword123!' --first-name 'Leadgen' --last-name 'Manager' --role leadgen_manager --activate
```

Then run:

```bash
npm run prod:audit
```

If `.env.production` is not configured locally, at minimum run:

```bash
npx tsc --noEmit
```

## Done Criteria

```text
□ prod-audit role list includes leadgen_manager
□ Leadgen Manager user is not flagged as bad role
□ TypeScript passes
```

---

# Blocker 3 — Fix EMAIL_SEND_DRY_RUN Safety Inconsistency

## Problem
`prod-check-env.ts` requires `EMAIL_SEND_DRY_RUN=true`, but `.env.example` does not list it and the email worker may not actually use it before sending.

This creates **false safety**.

## Files to Check

```text
scripts/prod-check-env.ts
.env.example
workers/email.ts
README.md
docs/MIGRATION_RUNBOOK.md
```

## Recommended Fix for Tomorrow

Implement real dry-run behavior in `workers/email.ts` and document it.

### Step 1 — Add to `.env.example`

Add near the sequence safety controls:

```env
# Hard dry-run for outbound email worker.
# When true, the worker marks messages as dry-run instead of calling the email provider.
EMAIL_SEND_DRY_RUN="true"
```

### Step 2 — Add Dry-Run Gate in `workers/email.ts`

Place the dry-run check **after suppression/account/quota safety checks are decided carefully**.

Recommended safe behavior for demo:

```ts
if (process.env.EMAIL_SEND_DRY_RUN === 'true') {
  await prisma.outboundMessage.update({
    where: { id: outboundMessageId },
    data: {
      status: 'sent',
      providerMessageId: `dry-run-${outboundMessageId}`,
      sentAt: new Date(),
      errorMessage: null,
    },
  });

  await prisma.activity.create({
    data: {
      userId: existing.lead?.assignedToId ?? user.id,
      leadId: existing.leadId,
      type: 'email_sent',
      channel: 'email',
      description: `[DRY RUN] Email would have been sent to ${to}`,
      metadata: {
        dryRun: true,
        subject: finalSubject,
        accountId,
        outboundMessageId,
      },
    },
  });

  return {
    success: true,
    dryRun: true,
    outboundMessageId,
    providerMessageId: `dry-run-${outboundMessageId}`,
  };
}
```

Important: make sure variables used in this block already exist. If `finalSubject` is created later in the worker, either move the dry-run block after rendering or use `subject`.

### Step 3 — Keep Production Check Strict

Keep this in `prod-check-env.ts` for tomorrow:

```text
EMAIL_SEND_DRY_RUN must remain true for this deployment
SEQUENCE_AUTOSEND_ENABLED must remain false for this deployment
```

### Step 4 — Update Documentation

In `README.md` and `docs/MIGRATION_RUNBOOK.md`, document:

```text
For demo / migration / first live validation:
EMAIL_SEND_DRY_RUN="true"
SEQUENCE_AUTOSEND_ENABLED="false"
EMAIL_HEALTH_AUTOPAUSE="false"
```

## Alternative Fast Fix

If you do not want to implement dry-run tonight:

```text
□ Remove EMAIL_SEND_DRY_RUN from prod-check-env.ts
□ Remove it from docs
□ Rely only on SEQUENCE_AUTOSEND_ENABLED=false and inbox pause
```

But this is less safe. The recommended path is to **implement the dry-run gate**.

## Test This Fix

Run with:

```env
EMAIL_SEND_DRY_RUN="true"
SEQUENCE_AUTOSEND_ENABLED="false"
```

Then test:

```text
□ Queue/send one demo email task
□ Confirm no real provider email is sent
□ Confirm OutboundMessage gets providerMessageId starting with dry-run-
□ Confirm activity says [DRY RUN]
□ Confirm no quota/safety issue breaks the demo
```

Commands:

```bash
npx tsc --noEmit
npm test
npm run build
npm run prod:check-env
```

## Done Criteria

```text
□ EMAIL_SEND_DRY_RUN exists in .env.example
□ prod-check-env and docs agree with .env.example
□ email worker actually respects EMAIL_SEND_DRY_RUN
□ Demo email does not leave the system
```

---

# Blocker 4 — Fix Migration Runbook Stale Names

## Problem
`docs/MIGRATION_RUNBOOK.md` has stale model/field names that do not match the current Prisma schema.

## File to Fix

```text
docs/MIGRATION_RUNBOOK.md
```

## Required Replacements

```text
MeetingBookingLink → BookingLink
EmailTemplate → Template
estimatedValue → value
```

## Required SQL Fix

Replace this kind of query:

```sql
SELECT stage, count(*), sum("estimatedValue") FROM "Opportunity" GROUP BY stage;
```

with:

```sql
SELECT stage, count(*), sum(value) FROM "Opportunity" GROUP BY stage;
```

## Also Review These Sections

```text
□ Entity inventory table
□ Migration execution steps
□ SQL verification section
□ Rollback notes
□ Sign-off checklist
```

Make sure names match the actual schema:

```text
BookingLink
Meeting
Opportunity
OpportunityActivity
Template
Sequence
SequenceStep
LeadPoolItem
CampaignLeadRequirement
EmailAccount
SuppressionEntry
```

## Test This Fix

Run:

```bash
grep -R "MeetingBookingLink\|EmailTemplate\|estimatedValue" docs/MIGRATION_RUNBOOK.md
```

Expected result: no output.

Then run:

```bash
npx tsc --noEmit
```

## Done Criteria

```text
□ No stale model names remain
□ SQL verification uses Opportunity.value
□ Runbook matches current Prisma schema
```

---

# Phase 5 — Run Local Validation Commands

Run these after all 4 blockers are fixed.

## Required Commands

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Optional Production Checks

Only run these if `.env.production` is configured:

```bash
npm run prod:check-env
npm run prod:audit
```

## GitHub Actions

Push the branch and confirm CI runs:

```bash
git add .
git commit -m "fix: live readiness blockers before CRM showcase"
git push origin fix/live-readiness-blockers
```

If using PR:

```text
□ Open pull request into main
□ Confirm GitHub Actions run
□ Confirm CI green
□ Merge after passing
```

If committing directly to main:

```text
□ Confirm workflow is enabled
□ Confirm latest main commit has green CI
```

## Done Criteria

```text
□ npm ci passes
□ Prisma generate passes
□ Migrations apply
□ Seed passes
□ Lint passes
□ TypeScript passes
□ Tests pass
□ Build passes
□ CI is green or local proof is recorded
```

---

# Phase 6 — Full End-to-End Smoke Test

Run this only after blockers and validation commands pass.

## Smoke Test Environment

```text
Browser: Desktop Chrome
Data: fake/demo only
Role 1: Director
Role 2: Leadgen Manager
Role 3: SDR
Email: dry-run only
Automation: disabled
```

Recommended env during smoke test:

```env
EMAIL_SEND_DRY_RUN="true"
SEQUENCE_AUTOSEND_ENABLED="false"
EMAIL_HEALTH_AUTOPAUSE="false"
```

---

## A. Login and Role Setup

```text
□ 1. Login as Director
□ 2. Create Leadgen Manager user
□ 3. Create SDR user
□ 4. Confirm Director can access Leadgen Manager Console
□ 5. Confirm Leadgen Manager can access Leadgen Manager Console
□ 6. Confirm SDR cannot access Leadgen Manager Console
```

Pass condition:

```text
Correct users see correct navigation and pages.
```

---

## B. Client and Campaign Setup

```text
□ 7. Create Client: Demo Client
□ 8. Create Campaign: Demo SDR Campaign
□ 9. Assign Demo SDR to campaign
□ 10. Confirm campaign appears in campaign/team views
```

Pass condition:

```text
Campaign exists, belongs to Demo Client, and is visible to assigned SDR/manager.
```

---

## C. Booking Link Setup

```text
□ 11. Add booking link for Demo Client or Demo Campaign
□ 12. Confirm booking link is active/default if needed
□ 13. Open a lead later and confirm booking link can be selected/sent
```

Pass condition:

```text
Booking link is stored and usable for meeting flow.
```

---

## D. Leadgen Internal Database Flow

```text
□ 14. Login/view as Leadgen Manager
□ 15. Open Leadgen Manager Console
□ 16. Import 10 fake leads into Internal Lead Database
□ 17. Run duplicate check
□ 18. Confirm import reaches Review step
□ 19. Confirm error rows can be downloaded if errors exist
□ 20. Confirm import reaches Confirm step
□ 21. Confirm records are created in Internal Database
□ 22. Qualify 5 leads
□ 23. Route 5 qualified leads to Demo SDR Campaign
□ 24. Assign routed leads to Demo SDR
```

Pass condition:

```text
Raw imported leads become qualified/routed working leads for the SDR.
```

---

## E. Lead Search and Lead Detail

```text
□ 25. Open Leads page as Director or SDR
□ 26. Search by first name
□ 27. Search by last name
□ 28. Search by full name
□ 29. Search with reversed name order if possible
□ 30. Search by company
□ 31. Open lead detail panel
```

Pass condition:

```text
Search works by name/company and lead detail opens correctly.
```

---

## F. Daily Task Filters and Bulk Actions

```text
□ 32. Open Daily Tasks dashboard
□ 33. Filter by Call
□ 34. Filter by Email
□ 35. Filter by Campaign
□ 36. Filter by Client
□ 37. Select 2 tasks
□ 38. Bulk reschedule selected tasks
□ 39. Select 1 task
□ 40. Bulk add note
□ 41. Try bulk complete on a phone task without outcome
□ 42. Confirm system blocks completion or asks for outcome
```

Pass condition:

```text
Filters narrow tasks correctly and bulk actions respect validation/access rules.
```

---

## G. AI SDR Assistant Setup Flow

```text
□ 43. Open AI SDR Assistant
□ 44. Answer Question 1
□ 45. Confirm it moves to Question 2
□ 46. Answer Questions 2–5
□ 47. Confirm setup completes
□ 48. Refresh page
□ 49. Confirm setup does not reset to Question 1
□ 50. Ask for a cold email or call prep
```

Pass condition:

```text
AI setup progresses, saves memory, and resumes correctly.
```

---

## H. Meeting Booking and Outcome Flow

```text
□ 51. Open a lead detail panel
□ 52. Send or record booking link
□ 53. Create scheduled meeting
□ 54. Confirm meeting appears in Meetings page
□ 55. Log meeting outcome as completed + qualified opportunity
□ 56. Add qualification summary
□ 57. Add pain points
□ 58. Add next step
□ 59. Confirm opportunity is created
```

Pass condition:

```text
Meeting outcome creates a linked opportunity.
```

---

## I. Opportunity Pipeline Flow

```text
□ 60. Open Opportunities page
□ 61. Confirm new opportunity appears
□ 62. Move/review opportunity through client review
□ 63. Mark handoff accepted
□ 64. Update value/probability/next step if available
□ 65. Confirm opportunity summary updates
```

Pass condition:

```text
Qualified meeting becomes a client-review opportunity and can move forward.
```

---

## J. Client Report Flow

```text
□ 66. Open Client Reports
□ 67. Select Demo Client
□ 68. Select Demo Campaign
□ 69. Select date range covering demo activity
□ 70. Generate report preview
□ 71. Confirm no crash
□ 72. Confirm KPI scorecards load
□ 73. Confirm meetings section shows demo meeting
□ 74. Confirm opportunities section shows accepted opportunity
□ 75. Confirm client-facing text does not expose internal notes accidentally
□ 76. Approve/freeze report if available
□ 77. Export PDF/CSV/share link if available
```

Pass condition:

```text
Client report generates from actual CRM data and can be reviewed/shared/exported.
```

---

## K. Email Health and Email Safety Flow

```text
□ 78. Open Email Health
□ 79. Confirm inbox health table loads
□ 80. Confirm overview cards load
□ 81. Pause demo inbox
□ 82. Confirm send worker would block paused inbox
□ 83. Resume demo inbox
□ 84. Update daily cap
□ 85. Run DNS check if domain data exists
□ 86. Trigger/send a demo email in dry-run mode
□ 87. Confirm no real email is sent
□ 88. Confirm outbound message is marked dry-run/sent safely
```

Pass condition:

```text
Email Health controls work and no real email leaves during demo.
```

---

## L. Archive and Restore Flow

```text
□ 89. Open lead detail
□ 90. Archive one demo lead
□ 91. Confirm warning modal appears
□ 92. Confirm archived lead disappears from normal Leads search
□ 93. Login/view as Director
□ 94. Restore archived lead
□ 95. Confirm lead returns to active pipeline
```

Pass condition:

```text
Archive is reversible and active views exclude archived leads by default.
```

---

# Phase 7 — Final Readiness Sign-Off

## Final Pass Criteria

```text
□ All 4 blockers fixed
□ All validation commands pass
□ Smoke test passes from step 1 to 95
□ Demo data is ready
□ Email sending is dry-run/disabled
□ Presentation deck is ready
□ Backup branch/commit exists
□ No major runtime crash in core flows
```

## Recommended Final Commit

```bash
git add .
git commit -m "fix: complete live readiness blockers and smoke test prep"
git checkout main
git pull origin main
git merge fix/live-readiness-blockers
git push origin main
```

Tag the demo-ready version:

```bash
git tag v1.0-telestar-showcase
git push origin v1.0-telestar-showcase
```

## Final Demo Positioning

Use this wording tomorrow:

```text
This is our first full working Telestar SDR-as-a-Service CRM foundation.
It connects leadgen, SDR execution, meeting outcomes, opportunity handoff,
client reporting, AI assistance, and email health into one operating workflow.

The goal of today is to showcase the product direction, prove the workflow,
and collect feedback before controlled live rollout.
```

Avoid saying:

```text
This is 100% production-live with real client sending enabled.
```

Say instead:

```text
It is demo-ready and near-live ready after final smoke test and deployment safety checks.
```

---

# Quick Final Checklist

Code and gates verified 2026-08-03 against a local PostgreSQL 16.10 stack.
Everything still open depends on the deployment itself.

```text
■ Client Report metrics fixed
■ prod-audit role list fixed
■ EMAIL_SEND_DRY_RUN implemented consistently   (but see the caveat above — it gates the
                                                 worker only; SEQUENCE_AUTOSEND_ENABLED is
                                                 the guard on the worker-free send path)
■ Migration Runbook corrected
■ npm ci passed                                  lockfile valid after moving prisma into
                                                 dependencies — the Dockerfile runs npm ci twice
■ prisma generate passed
■ migrations passed                              on an empty database; migrate diff then
                                                 reports an empty migration (zero drift)
■ seed passed
■ lint passed                                    0 errors (56 pre-existing unused-var warnings)
■ typecheck passed                               tsc --noEmit, 0 errors
■ tests passed                                   Vitest 37 suites / 388 tests
■ build passed                                   next build exit 0
■ smoke test passed                              Playwright 20/20, automated in
                                                 e2e/deep-smoke.spec.ts
■ demo data prepared                             seeded org; dominic is leadgen_manager so
                                                 the /leadgen-manager persona is reachable
□ real email sending disabled                    verify on the deployment: no EmailAccount
                                                 rows, and the cron route must answer
                                                 {"disabled":true,"sent":0}
□ tag created
```

> **Windows note:** `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`
> if a dev server is running — it holds the engine open. Stop it before building.
