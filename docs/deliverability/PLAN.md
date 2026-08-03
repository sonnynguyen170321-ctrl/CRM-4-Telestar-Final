# Deliverability / Email Health — PLAN

> Resume pointer (read first): [`STATUS.md`](./STATUS.md).
> Source spec: `~/Downloads/deliverability-email-health-dashboard-implementation.md`.
> Working-order item **4** — the module `docs/client-reports/PLAN.md:23` defers
> email-from-CRM to.

## Goal

Turn connected inboxes, domain records and outbound/inbound events into health scoring,
alerts, a manager dashboard and **send throttling that actually throttles** — a safety
control layer, not a reporting page.

It answers: *Can this inbox safely send today? Which campaign is causing bounces? Which
client list has bad data? Should we pause, reduce volume, or switch channels?*

---

## P0 — Data capture ✅

- [x] Migration `20260802050000_email_health_data_capture`:
      `OutboundMessage.{bouncedAt,bounceType}` + 3 indexes ·
      `InboundMessage.{isBounce,isReply,bounceType,bouncedRecipient}` + 2 indexes ·
      `ActivityType.{email_replied,email_bounced}` · `SuppressionEntry(tenantId,createdAt)`.
- [x] `workers/sync.ts` rewritten — persist bounces instead of discarding them; flag
      `isReply` on lead replies; correlate bounces and replies back to the originating
      `OutboundMessage`; emit `email_replied` / `email_bounced` activities.
- [x] Fix bounce lead lookup (was keyed on the mailer-daemon sender, never matched).
- [x] `tests/sync-worker.test.ts` — 15 → **29 green**.

## P1 — Metrics + scoring ✅

- [x] `lib/email-health/types.ts` — Prisma-free shared types.
- [x] `lib/email-health/scoring.ts` — **pure** `scoreInbox(metrics, now)`, thresholds as
      module constants, exported as `SCORING_THRESHOLDS`.
- [x] `lib/email-health/recommendations.ts` — reason-code → label / action maps, kept
      separate so scorer and wording never duplicate condition logic.
- [x] `lib/email-health/metrics.ts` — grouped aggregation, **O(1) queries not O(n) inboxes**.
- [x] `tests/email-health-scoring.test.ts` — **28 green**, every boundary + level cutoff.

## P2 — Health schema ✅

- [x] Migration `20260802060000_email_health_models`: `EmailHealthSnapshot`,
      `EmailDomainHealth`, `EmailHealthAlert`, 4 enums, `EmailAccount.{healthScore,
      healthLevel,lastHealthCheckAt,sendPausedAt,sendPausedById,sendPauseReason}`.
- [x] `supabase/rls.sql` — registered the 3 new tables **and closed 4 pre-existing gaps**
      (`OutboundMessage`, `InboundMessage`, `SuppressionEntry`, `JobRun`).

## P3 — Access control ✅

- [x] `lib/email-health/access.ts` — `getEmailAccountScope` / `emailAccountWhere` /
      `canAccessEmailAccount`, wrapping `computeVisibleUserIds` from `lib/podScoping.ts`.
      **User axis only** — sharing a campaign must not expose a colleague's mailbox.
- [x] Fixed leak in `app/api/automation/stats/route.ts` (every mailbox was visible to
      every authenticated user, SDRs included).
- [x] `tests/email-health-access.test.ts` — **22 green**, incl. IDOR regressions.

## P4 — Cron + send enforcement ✅

- [x] `app/api/cron/email-health/route.ts` — hourly; `CRON_SECRET` bearer with manager-session
      fallback, per-tenant `tenantStorage.run`, one bad tenant cannot abort the pass.
- [x] `lib/email-health/snapshots.ts` — score → cache on `EmailAccount` → write snapshot →
      refresh domain rollups → reconcile alerts.
- [x] `lib/email-health/alerts.ts` — dedupe by `(accountId, type)` while `status='open'`,
      escalate on worsening severity, **auto-resolve** cleared conditions.
- [x] `workers/email.ts` — `evaluateSendBlock()` preflight **before** `atomicReserveQuota`,
      so a blocked send never burns a slot it cannot use.
- [x] `tests/email-worker.test.ts` — 7 → **17 green**.

## P5 — API routes ✅

- [x] 12 routes under `app/api/email-health/**`: `overview` · `accounts` ·
      `accounts/[id]` · `accounts/[id]/{pause,resume,cap}` · `alerts` ·
      `alerts/[id]/{acknowledge,resolve}` · `campaigns` · `domains` ·
      `domains/[domain]/check`.
- [x] `lib/email-health/queries.ts` (read models) + `alertActions.ts` (shared transition).
- [x] `lib/email-health/domains.ts` — real SPF / DMARC / MX via `dns/promises`, per-record
      timeout, never throws. DKIM manual by design.
- [x] Conventions honoured: `dynamic = 'force-dynamic'`, no `runtime` export, `parseBody`
      narrowed correctly, `handleApiError`, `Cache-Control: no-store`, access checked
      **before** any write. `/domains/[domain]/check` only permits domains the viewer sends
      from — otherwise it is an arbitrary outbound DNS probe.

## P6 — UI ✅

- [x] `app/email-health/page.tsx` (`'use client'`, TanStack Query).
- [x] `components/email-health/`: `HealthLevelBadge` · `EmailHealthOverviewCards` ·
      `InboxHealthTable` · `InboxHealthDetailPanel` (slide-over, never a route) ·
      `EmailHealthTrendChart` (recharts, `dynamic ssr:false`) · `EmailHealthAlertsPanel` ·
      `CampaignEmailHealthTable` · `DomainHealthTable` · `PauseSendingModal`.
- [x] `lib/hooks/useEmailHealth.ts`.
- [x] Sidebar entry (`ShieldCheck`, next to Automation) — visible to all roles; the API
      scopes SDRs to their own mailbox read-only.
- [x] `/automation` inbox table removed, replaced with a capacity summary + link.

---

## P7a — Repair `client-reports` ✅

Pre-existing, not caused by this work. Full diagnosis in
[`STATUS.md` § Blockers](./STATUS.md#blockers--client-reports-is-red-and-it-is-not-ours).

- [x] Narrow every `parseBody` result (`if (parsed.error) return parsed.error;`) — the bulk
      of the 117 errors.
- [x] Replace `user: { select: { name: true } }` with `firstName` / `lastName`.
- [x] Add the missing `shareLinks` include.
- [x] Await `params` before use in dynamic routes.
- [x] Reconcile `tests/client-reports.test.ts` against the real exports
      (`sanitizeClientFacingText`, `formatRepDisplayName`).
- [x] `tsc --noEmit` → 0 errors; `client-reports.test.ts` green.

## P7b — Client report integration ✅

- [x] Add `emailChannelHealth` to `ClientReportSnapshot` (`lib/client-reports/types.ts`):
      overall `Good | Watch | Risk`, emails sent, reply rate, bounce rate, corrective
      actions. **Client-safe only** — no inbox addresses, no SDR attribution, no raw scores.
- [x] Populate it in `lib/client-reports/metrics.ts` from `getCampaignHealth`.
- [x] Surface it in the report UI + exporters (CSV & HTML Print/PDF).

## P8 — Advanced Deliverability & Health ✅

- [x] Automated & selector-aware DKIM discovery (`lib/email-health/domains.ts`).
- [x] Warmup ramp recommendations & progressive scheduling (`lib/email-health/warmup.ts`).
- [x] SMTP error and bounce reason categorization (`lib/email-health/errorCategorizer.ts`).
- [x] Automatic safety cap reduction & throttling (`lib/email-health/capAdjustment.ts`).
- [x] Per-client & per-campaign deliverability thresholds (`lib/email-health/thresholds.ts`).
- [x] CSV export of health and domain DNS posture (`app/api/email-health/export/csv/route.ts`).
- [x] Unit test suite (`tests/email-health-p8.test.ts` — 17/17 green).

---

## Verification

```powershell
# NOTE: the "&" in the repo path breaks npm/npx shims — call node directly.
node node_modules/prisma/build/index.js migrate status
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app components lib context tests
node ./node_modules/next/dist/bin/next build
```

Targeted:

```powershell
node node_modules/vitest/vitest.mjs run tests/sync-worker.test.ts
node node_modules/vitest/vitest.mjs run tests/email-health-scoring.test.ts
node node_modules/vitest/vitest.mjs run tests/email-health-access.test.ts
node node_modules/vitest/vitest.mjs run tests/email-worker.test.ts
```

Cron (needs `CRON_SECRET` in `.env`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/email-health
# Run twice — the second run must NOT duplicate alerts.
```

Manual, once the dev server is up:
- Load `/email-health` as director, team lead and SDR — each must see only their scope.
- Pause an inbox, enqueue a send: assert `{skipped:true, reason:'account_paused'}` **and**
  that `dailySendCount` did not increment.
- Desktop-only (1280px+) per `brand-design.md` — no responsive breakpoint utilities.

**Definition of done:** the source doc's 13 done-criteria, plus bounce and reply rates
showing real non-zero values from live sync, and `tsc --noEmit` + the full Vitest suite +
`next build` all green.

### Cron registration (there is no `vercel.json` in this repo)

Add alongside the existing entries in `docs/DEPLOY.md`:

```cron
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://crm.yourdomain.com/api/cron/email-health
```

### New env var

```
# Optional. When "true", the send worker refuses to send from an inbox whose
# healthLevel is critical. Default off — alerts only.
EMAIL_HEALTH_AUTOPAUSE=false
```
