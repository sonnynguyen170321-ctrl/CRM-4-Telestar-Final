# Admin Control Center — Status & Handoff

**Last updated:** 2026-08-05
**Plan of record:** `C:\Users\admin\.claude\plans\what-should-come-next-greedy-wren.md`
**Branch:** `main` (uncommitted working tree — see "Commit plan" below)

---

## What this delivered

Director / Floor Manager can now run people-ops from `/admin` without scripts or DB access:
create and edit users, deactivate and reactivate them, reset passwords, restructure reporting
lines, manage clients and campaign membership, transfer work between reps, and read an audit
trail.

**The core guarantee:** no campaign-member removal and no user deactivation can strand work.
Both paths run an impact check first and refuse (HTTP 409) unless the operator picks a handling
mode — transfer / pause / keep — and gives a reason. Enforced server-side in
`lib/admin/campaignMembers.ts`, so it cannot be bypassed by choosing a different endpoint.

### Bugs fixed along the way

| # | Bug | Fix |
|---|---|---|
| 1 | `TeamAccountsPanel` chip toggle fired `DELETE /api/admin/assignments` with **no impact check** — one click could orphan 40+ leads | `DELETE` now delegates to `removeCampaignMember`, which 409s without a mode; the chip opens `ImpactPanel` |
| 2 | `PUT /api/users/[id]` never called `clearVisibleUserCache` after `managerId`/`role`/`isActive` changes — pod scoping stayed stale 60s | Cache cleared (no-arg, since the map is keyed by *viewer*) |
| 3 | The send worker gates on `EmailAccount.isActive`/`sendPausedAt`, **not** `User.isActive` — a deactivated rep's mailbox kept sending | Deactivation now stamps `sendPausedAt`/`sendPausedById`/`sendPauseReason` |
| 4 | New users all got the hardcoded password `Telestar2026!` | Server generates 20 chars from a CSPRNG, returned once in the 201 body |

---

## Gate status

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint .` | 14 errors / 74 warnings — **all pre-existing**, verified by stashing this work and re-running. They live in `scripts/*.cjs`, `next.config.ts`, `e2e/qa/laneC.spec.ts`. None in Admin Control Center files. |
| `npx vitest run` | **489/489** (36 of them new). One earlier failure was local Postgres dropping mid-run, not logic — passes with the DB up. |
| `npm run build` | **exit 0** — all 8 admin pages + 9 new API routes present in `.next/server/app/` |
| Migration | `20260806000000_admin_control_center_indexes` applied to local DB via `migrate deploy` |

> Local Postgres detaches poorly from a foreground shell. Start it with
> `Start-Process ... pg_ctl.exe ... start -WindowStyle Hidden` (PowerShell), not a plain
> `pg_ctl start`, or it dies partway through a long Vitest run.

---

## Remaining work (unassigned — pick these up)

### 1. Extract `EmailConnectionsPanel` from Settings — *deferred, low risk, no functional change*
`app/settings/page.tsx` is **839 lines**, down from 1351, but still over the project's 800-line cap.
Plan called for pulling the email-connections block into
`components/settings/EmailConnectionsPanel.tsx`, which lands it near 600.

State to move: `connectedEmails`, `showManualForm`, `manualEmail`, `imapServer`, `imapPort`,
`smtpServer`, `smtpPort`, `mailPassword`, `isConnecting`, `providerStatus`,
`editingSignatureAccountId`, `signatureText`, `isSavingSignature`.
Handlers: `handleConnectGmail`, `handleConnectOutlook`, `handleConnectManual`,
`handleDeleteEmail`, `handleStartEditSignature`, `handleSaveSignature`, `missingText`.
Pure code motion — behaviour must not change.

### 2. Vitest suites named in the plan but not yet written
Three of the planned files exist (`tests/podScoping.test.ts` extended,
`tests/admin-org-rules.test.ts`, `tests/admin-impact.test.ts`). Still outstanding:

- **`tests/admin-org.test.ts`** — route-level guards on `PUT /api/users/[id]`:
  self-manager 400 · cycle 400 · role-incompatible manager 400 · FM setting a manager outside
  their floor 403 · deactivating a user with active reports 409 without `reassignReportsTo` ·
  `clearVisibleUserCache` called (spy).
  Template: `tests/admin.test.ts` (direct handler import, `vi.mock('@/auth')`, real prisma
  inside `tenantStorage.run`).
- **`tests/admin-overview.test.ts`** — each of the 6 overview cards yields the right ids on a
  seeded fixture · FM sees only their floor · the paused-campaign card uses the
  `Lead.sequenceStatus` path (NOT a `Sequence.campaignId`, which does not exist).
- **`tests/admin-audit.test.ts`** — `logAdminAudit` stamps `userId = actorId` · cursor pages do
  not duplicate · the 30-day default window is applied · FM scoped to visible users ·
  name resolution batches (assert query count).
- **Extend `tests/admin.test.ts` / `tests/access-control.test.ts`** — 401/403 matrix for every
  new endpoint: `/api/admin/overview`, `/api/admin/users`, `/api/admin/audit-log`,
  `/api/admin/transfer-work`, `/api/clients`, `/api/clients/[id]`,
  `/api/campaigns/[id]/members`, `/api/campaigns/[id]/member-impact/[userId]`,
  `/api/users/[id]/impact`.

### 3. Playwright — done ✅
`e2e/deep-smoke.spec.ts` and `e2e/qa/personas.ts` carry every new route (Director + Floor
Manager allowed; TL / SDR / Leadgen / Leadgen Manager denied, tagged `edge`).

**`e2e/qa/laneG.spec.ts` — 5/5 passing.** The end-to-end proof of the headline rule: the impact
dialog shows non-zero counts, confirm stays disabled until a mode is chosen, Cancel leaves the
member in place, a direct mode-less `DELETE` still 409s, and a transfer actually moves the work.
Verified evidence from the run: 3 open leads moved Lan Pham → Vy Hoang, and Lan Pham then
reappears in `suggestedTargets` with `requiresCampaignAdd: true`, confirming he left the campaign.

**Run it against a production build, not `next dev`:**

```bash
npm run build
node ./node_modules/next/dist/bin/next start -p 3200
BASE_URL=http://localhost:3200 npx playwright test e2e/qa/laneG.spec.ts
```

Two harness traps this run surfaced, both worth knowing before writing another stateful lane:

- **The QA harness writes artefacts into the watched project directory** (`qa-runs/`,
  screenshots, notes). Under `next dev` every write triggers Fast Refresh, which **remounts the
  page and resets component state** — the impact dialog disappears mid-assertion. The existing
  read-only lanes never noticed; a stateful lane fails immediately. Production build has no
  watcher, and is also ~2x faster since nothing compiles per route.
- **The shared `login()` helper is hydration-sensitive.** It clicks the dev-only Demo Accounts
  button; against a recompiling server the markup exists but the handler is not attached, so the
  click silently does nothing. laneG signs in through the credentials callback instead
  (`apiLogin`), which is deterministic. Worth porting to `_helpers.ts` if other lanes start
  flaking.

### 4. Not built, and deliberately so
- **Assignment Rules** — listed in the original spec's sidebar but never specified beyond the
  name. No default-SDR routing rule engine exists. Decide what it means before building it.
- **Leadgen work is not transferable.** `LeadPoolItem.assignedSdrId` / `qualifiedById`, and the
  FK-less columns `Lead.archivedById`, `EmailAccount.sendPausedById`,
  `EmailHealthAlert.acknowledgedById` / `resolvedById` are **reported in impact as warnings
  only** — they are never moved. The UI says so; do not silently "fix" this without deciding
  the semantics.
- **`AuditLog` retention.** `auditExtension` writes a row for every create/update/delete on
  every model. The read API's mandatory 30-day window is what keeps the page fast. A pruning
  job is a follow-up.

---

## Architecture notes for whoever picks this up

**`lib/admin/transferWork.ts` has no `$transaction` — on purpose.** The Neon HTTP driver has no
interactive transactions, and the `$extends` wrappers in `lib/prisma.ts` `await query(args)`
internally, which also defeats `$transaction([...])` array batching. Wrapping it would *look*
correct and silently not be atomic. Instead each phase is one `updateMany` whose `where` still
names the FROM user, making the whole thing idempotent and resumable; an intent audit row is
written before any mutation. There is a comment saying this at the top of the file — leave it.

**`Task.lockedAt` is a cron-owned soft lock.** Every bulk write filters `lockedAt: null` so a
task the auto-send worker has claimed is never stolen mid-flight (that would double-send). The
count is surfaced to the user as "re-run in a few minutes", and there is deliberately no
force-steal option.

**Actor attribution.** `auditExtension` attributes rows to the *record's* owner
(`createdById || assignedToId || userId`), so a director deactivating an SDR lands under the
SDR. That was left alone — flipping it would rewrite the meaning of every historical row. Admin
actions instead write an explicit actor-stamped row via `logAdminAudit()` under the dotted
`admin.*` namespace.

**`CampaignSdr` stays the source of truth.** The original spec proposed a new `CampaignMember`
model + `CampaignMemberRole` enum. Not built, and it should not be: `CampaignSdr` already backs
`getVisibleCampaignIds`, `getLeadgenScope`, `getLeadWhereScope`, the campaigns cache scope-hash
and assignable-reps. A parallel model splits truth.

**Leadgen roles cannot own SDR work.** `getLeadWhereScope` scopes leadgen users by *campaign*,
not by assignee, so a lead handed to one disappears from every user-axis queue. `canOwnSdrWork`
in `lib/admin/orgRules.ts` enforces this on every transfer.

---

## File map

**New services** — `lib/admin/scope.ts` · `impact.ts` · `transferWork.ts` · `campaignMembers.ts` · `orgRules.ts`
**Extended** — `lib/audit.ts` (`logAdminAudit`) · `lib/podScoping.ts` (`wouldCreateManagerCycle`) · `lib/sequences/engine.ts` (`pauseSequencesBulk`) · `lib/validation/schemas.ts`

**New API** — `/api/admin/overview` · `/api/admin/users` · `/api/admin/transfer-work` · `/api/admin/audit-log` · `/api/users/[id]/impact` · `/api/campaigns/[id]/members` · `/api/campaigns/[id]/member-impact/[userId]` · `/api/clients` · `/api/clients/[id]`
**Changed API** — `/api/admin/assignments` (delegates) · `/api/users` (generated password + audit) · `/api/users/[id]` (cycle guard, cache, audit, mailbox pause)

**New pages** — `app/admin/page.tsx` · `users/` · `teams/` · `campaigns/` · `campaigns/[id]/members/` · `clients/` · `transfer-work/` · `audit/`
**New components** — `components/admin/ConfirmDialog.tsx` · `ImpactPanel.tsx` · `AdminTable.tsx` · `StatusBadge.tsx` · `UserFormModal.tsx`

---

## Commit plan

Everything is currently uncommitted on `main`. Suggested split:

```bash
git checkout -b feat/admin-control-center

# 1 — enabling refactor, no user-visible change
git add lib/admin/scope.ts lib/admin/orgRules.ts lib/audit.ts lib/podScoping.ts \
        app/api/admin/assignments/route.ts app/api/users/\[id\]/route.ts \
        prisma/schema.prisma prisma/migrations/20260806000000_admin_control_center_indexes \
        tests/podScoping.test.ts tests/admin-org-rules.test.ts
git commit -m "refactor(admin): share campaign scoping, add actor-stamped audit and org-integrity guards"

# 2 — the no-silent-removal engine
git add lib/admin/impact.ts lib/admin/transferWork.ts lib/admin/campaignMembers.ts \
        lib/sequences/engine.ts lib/validation/schemas.ts \
        app/api/users/\[id\]/impact app/api/campaigns/\[id\]/member-impact \
        app/api/admin/transfer-work components/admin/ConfirmDialog.tsx \
        components/admin/ImpactPanel.tsx components/settings/TeamAccountsPanel.tsx \
        tests/admin-impact.test.ts
git commit -m "feat(admin): block campaign-member removal that would orphan open work"

# 3 — the console
git add app/admin components/admin app/api/admin/overview app/api/admin/users \
        app/api/campaigns/\[id\]/members app/api/clients app/api/admin/audit-log \
        app/api/users/route.ts components/Sidebar.tsx
git commit -m "feat(admin): add the Admin Control Center console"

# 4 — settings cut
git add app/settings/page.tsx
git commit -m "refactor(settings): move user and campaign administration to /admin"

# 5 — e2e coverage
git add e2e/
git commit -m "test(e2e): cover the admin console across all six personas"
```

All gates were green at handoff — `tsc` 0, Vitest 489/489, `next build` exit 0.
