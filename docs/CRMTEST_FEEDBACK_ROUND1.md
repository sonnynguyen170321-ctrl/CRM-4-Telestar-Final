# CRMTest Internal Feedback — Round 1

Verification and fix record for the five items raised by the CRMTest internal team.
Every item was reproduced against a running app before any code was changed.

| ID | Feedback | Verified | Fixed | Tested |
|----|----------|----------|-------|--------|
| F1 | AI SDR Assistant cannot continue after a setup question | ✅ reproduced | ✅ | ✅ |
| F2 | Bulk Upload Leads cannot process from the review/import step | ✅ reproduced | ✅ | ✅ |
| F3 | Cannot search leads by name | ✅ reproduced | ✅ | ✅ |
| F4A | Daily Task has no filters | ✅ confirmed missing | ✅ | ✅ |
| F4B | Daily Task has no bulk select/actions | ✅ confirmed missing | ✅ | ✅ |
| F5 | Need ability to delete a contact | ⚠️ mostly already built | ✅ extended | ✅ |

---

## F1 — AI Assistant setup progression

**Reproduced.** Answering question 1 and then reloading the page returned the panel to
*"Setup — Step 1 of 5"* and re-asked question 1, even though the answer was already saved
as an `AiMemory` row. The step counter lived only in component state.

**Root causes**

1. `onboardingStep` was never rehydrated from saved memories, so any refresh — or opening
   the widget on another page — restarted the questionnaire.
2. `handleOpen` called `startOnboarding()`, which reset the step to 0.
3. The answer handler never checked `res.ok` and destructured `{ valid, message }` blindly.
   A non-conforming response (401/429/500) produced `message === undefined`, which was then
   written into the chat bubble and rendered through `.replace(...)`.
4. A rejecting validator had no escape hatch: an SDR whose answer kept being judged invalid
   could not advance. With `GROQ_API_KEY` set (production) the validator is strict; locally
   it is absent and auto-accepts, which is why this only showed up for the test team.
5. A failed memory write was ignored, so the UI advanced while the answer was lost.

**Fix** — `components/AiAssistant.tsx`

- Setup progress is derived from the DB: `countAnsweredOnboardingSteps()` counts saved
  `campaign:`/`target_buyer:`/… memories and resumes at the first unanswered question.
- The resume message names where you left off instead of restarting the intro.
- Response handling validates status and shape; an unreachable or malformed validator
  accepts the answer rather than trapping the user, and never renders `undefined`.
- After `MAX_REJECTIONS_PER_STEP` (2) rejections on the same question the answer is accepted.
- A failed memory write keeps the user on the same question with an explicit retry message.

## F2 — Bulk Upload Leads

**Reproduced.** `POST /api/leads/import` returned **HTTP 500 with an empty body** in ~335 ms.
Dry run worked (`toImport: 2, errorRows: 2`); the real import died. Server log:

```
[bullmq] Redis connection error
AggregateError
```

**Root cause.** Import is enqueue-only. `startImportWorkflow` → `enqueue` → `queue.add`
throws when Redis is unreachable, and the route had no try/catch, so Next returned a bare
500 and the modal could only show a generic "Import failed". With no worker running (P10
infra is still unprovisioned) even a successful enqueue would never commit any rows.

**Fix**

- `lib/bullmq/health.ts` — `isQueueReachable()` pings Redis with a timeout (the shared
  connection retries forever, so an un-raced ping hangs instead of failing).
- `workers/import.ts` — the parse handlers take an `ImportDispatcher`; the worker keeps the
  queue-backed one.
- `lib/workflows/importInline.ts` — `runImportInline()` runs parse → chunk → commit through
  the *same* handler code with an inline dispatcher, capped at `INLINE_IMPORT_MAX_ROWS`
  (2000). Rows imported this way are indistinguishable from worker-imported rows: same
  activities, same `ImportRow` transitions, same `ImportBatch` lifecycle.
- `app/api/leads/import/route.ts` — queue first; on an unreachable queue (or a failed add)
  fall back to inline; batches over the cap return **503 with an actionable message**;
  everything is wrapped in `handleApiError` so a bare 500 is no longer possible.
- `components/CSVImportModal.tsx` — reports real counts for an inline import instead of
  claiming "queued".

> Running Redis + `npm run worker:dev` restores the normal async path automatically —
> the inline route is only taken when the queue does not answer.

## F3 — Lead search by name

**Reproduced.** `"Elena"` → 2 results, `"Popov"` → 1, **`"Elena Popov"` → 0**.

**Root cause.** `buildLeadListWhere` matched the whole query string against one column at a
time (`firstName` OR `lastName` OR `company` OR `email`), so no first-plus-last-name query
could ever match.

**Fix** — `lib/leads/listQuery.ts`: `buildSearchClauses()` splits the query on whitespace and
requires every term to match at least one searchable field. Fields now also include `phone`
and `linkedIn`, and each term is matched against its accent-stripped variant as well
(`Nguyễn` also finds `Nguyen`). The role scope remains the first `AND` clause, so search can
only narrow results — never widen them past the caller's scope.

## F4A — Daily Task filters

Dashboard now filters by channel, status, priority, lead stage, client, campaign and free
text, with an active-filter count, a Clear action, a `showing X of Y` counter and a distinct
empty state for "filtered to nothing". Client/campaign selectors are built from the loaded
tasks, so they only offer values the current user can see (`app/api/tasks/route.ts` now
includes `lead.campaign.client`).

## F4B — Daily Task bulk actions

Per-task checkboxes, select-all-visible, a selection counter and a bulk bar with
**Complete · Skip · Reschedule · Reassign** (managers) **· Add note**.

`POST /api/tasks/bulk` (`app/api/tasks/bulk/route.ts`) applies the action per task with the
same access checks as the single-task `PUT` — `canAccessUser` on the owner or
`canAccessLead` on the lead — so an SDR cannot bulk-edit another rep's tasks by posting
their ids. Tasks that fail a check are returned in `failed[]` rather than failing the batch.

Two deliberate constraints:

- **Call / LinkedIn / WhatsApp tasks are not bulk-completed without an outcome** (SKILL.md
  §21–§22). They are reported back with a reason unless a shared `outcome` is supplied.
- **Reschedule and reassign write no `Activity`** — `ActivityType` has no member for them and
  inventing one would corrupt the leaderboard, which counts outreach activity. The Prisma
  audit extension already records those mutations in `AuditLog`.

## F5 — Contact archive / delete

**Already implemented before this round.** `DELETE /api/leads/[id]` was a soft archive
(`archivedAt`, `archivedById`, `archiveReason`), it unenrolls the active sequence, list
queries hide archived leads, and the lead slide-over had an Archive button.

**Extended with what was missing**

- `POST /api/leads/[id]/restore` — director only. Archiving is available to anyone who can
  access the lead (reversible, hides nothing from history); returning a record to active
  pipeline, where it re-enters reports and client-facing counts, is a director decision.
- An **Archived** toggle on `/leads` for non-SDR roles (the API already refused
  `?archived=true` for SDRs).
- The archive confirmation now states the impact: open tasks, upcoming meetings and whether
  an active sequence will be stopped.
- The slide-over shows **Restore** on an archived lead for a director, and an "Archived"
  badge for everyone else.

Hard delete was deliberately not added — leads carry tasks, activities, meetings,
opportunities and client reporting.

---

## Verification

`tests/crmtest-feedback.test.ts` covers the search-clause builder and the bulk-action schema
(14 cases). Full suite: **386 tests / 37 files passing**. `npx tsc --noEmit`: 0 errors.

`npm run build` compiles and generates all 68 pages, but the TypeScript step needs more than
the default 2 GB heap on this codebase — without it the build worker dies with
`FATAL ERROR: Ineffective mark-compacts near heap limit` (exit 134). This is a project-size
limit, not a type error. Build with:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

End-to-end, against a running app with Redis intentionally down, 34 checks passed covering:
name search (first / last / full / lowercase / reversed / no-match), import (valid rows in,
invalid row rejected, records visible afterwards), dashboard filters and bulk actions
including the call-outcome guard, archive → hidden → visible-with-flag → history kept →
restore, an SDR being refused a restore (403), the five-question assistant setup plus a
mid-setup refresh resuming at question 2, and every route returning < 400 with no uncaught
page errors.
