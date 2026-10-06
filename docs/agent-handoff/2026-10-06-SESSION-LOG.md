---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-05 → 2026-10-06 (office PC). State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-06

Written for the next agent, and for the owner picking this up on the home PC. It continues
[`2026-10-05-SESSION-LOG.md`](./2026-10-05-SESSION-LOG.md).

**Check what is live first.** This log goes stale the moment it is written:

```bash
git fetch origin && git log --oneline -6 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

## Where things stood at the end of the session

| PR | What | State |
|---|---|---|
| #247 | OAuth callbacks redirect to `NEXTAUTH_URL`, not `localhost:3000`; reason codes; no gaxios config in logs | merged + deployed |
| #248 | Designed signatures: builder / paste / HTML, images inline via `cid:` (`EmailAccount.signatureImages`) | merged + deployed |
| #249 | Last night's work (see the 2026-10-05 log) + today: `source-map-js` 1.2.2, send window open to every role that can edit a sequence, team leads create campaigns and assign their pod | merged + deployed (`58f1bbe`) |
| #250 | Campaign filter, attention banner, recipient classifier, mandatory sequence senders, Email Log | **merged as `326b226`; deploy NOT confirmed** — the owner was given the command |

Deploy (Hostinger, `/opt/crm`; *not* the GCP steps in older logs):

```bash
cd /opt/crm && git fetch origin && git checkout <full-sha> && ./scripts/deploy.sh <full-sha> && tail -1 deployments.ndjson
```

The image must exist first: the `Docker Image` workflow on `main` runs after CI and takes ~15 min.
`deploy.sh` before that fails with `not found` at the resolve step and changes nothing.

## What #250 changed, and the owner's decisions behind it

- **A sequence sends only from its "Send from" mailboxes** (owner: the rep's own mailbox may be on
  another domain). `lib/sequences/sender.ts` no longer falls back to the lead owner's mailbox. With
  none chosen — or all disconnected — the step is **held** (`no_sequence_sender` /
  `sequence_senders_disconnected`), rechecked hourly, one timeline row only. **Owner's call: existing
  sequences without senders stop sending until a mailbox is ticked.** Several mailboxes: spread
  evenly, one mailbox per lead for the whole cadence.
- **Email Log** — `/email-log` and a Sends tab per sequence. `GET /api/email-log`, scoped by
  `getLeadWhereScope`; filters: status group, mailbox, rep, sequence, step, campaign, date (viewer's
  timezone), opened/clicked/replied. New index `OutboundMessage(tenantId, createdAt)`.
- **Attention banner** counted `Lead.operatingState = 'unassigned'` tenant-wide — the AI
  prospecting state, which every imported lead keeps (1764 on screen, the owner's fresh upload
  among them; assigning from the pool *raises* it because it creates new Lead rows). Every Lead has a
  rep (`assignedToId` is required), so the banner now counts **live leads whose rep is
  deactivated**, in the viewer's scope, linking to `/leads?ownerInactive=true`.
- **Pipeline Filters → Campaign**, and `/leads?campaignId=` deep links.
- **`lib/email/recipientFailure.ts`**: `account is disabled/inactive/closed` without a DSN code is no
  longer read as a dead recipient (suspected cause of the hard-bounce batch below).
- Team leads: create campaigns (creator becomes first member), manage their pod's membership at
  `/team/campaigns/[id]/members` (`pod` manage scope — no reporting-line edits, no whole-user ops).
  Floor managers no longer read members of campaigns outside their floor.

## Open items — in the order they bite

1. **Confirm the #250 deploy**, then have every team tick **Settings → Send from** on each sequence
   (Nekko, Mavis, …). Without it their sequences send nothing; Enrollments shows
   "No sending mailbox chosen".
2. **Overdue enrollments with no hold reason** (owner's screenshot: many step-1 rows "Overdue",
   ACTIVE, no reason). A step the worker evaluated always records `holdReason`; none means the
   execute job never ran — lost, or the worker was down. "Resume" does nothing on ACTIVE rows; the
   ▶ Run now button does. The repair sweep (`repairMissingDelayed`, `workers/maintenance.ts`) re-drives
   them but runs only when the maintenance cron runs — **nightly 03:30** per `docs/DEPLOY.md`.
   Given to the owner, not yet run:
   ```bash
   docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'web|worker'
   docker exec crm-web-1 npx tsx scripts/queue-staleness-check.ts
   cd /opt/crm && CRON_SECRET=$(grep '^CRON_SECRET=' .env.production | cut -d= -f2- | tr -d '"') && \
     curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
     'https://crm.telestar.cloud/api/cron/maintenance?types=missing-delayed,stale-pending-outbound,stale-sending'
   crontab -l | grep -i maintenance
   ```
   **Proposed, needs the owner's yes (production cron change):** run that sweep every 15 minutes
   instead of nightly, so a lost job is re-driven within 15 minutes.
3. **Hard-bounce batch, 2026-10-06 11:44:05** — sequence `Email_Mavis`: many unrelated prospects
   paused `hard_bounce` in one second by Branndon. Likely a sender-side error read as a dead
   recipient (fixed going forward in #250). **Those prospects are still suppressed and
   `emailInvalid`.** Next: the owner runs this read-only query and pastes the result, then write a
   dry-run-first recovery script (un-suppress, clear `emailInvalid`, resume) — production write, ask
   before running.
   ```sql
   BEGIN TRANSACTION READ ONLY; SET LOCAL app.bypass_rls = 'true';
   SELECT a.email AS mailbox, o.status, left(o."errorMessage",160) AS error, count(*)
   FROM "OutboundMessage" o JOIN "EmailAccount" a ON a.id = o."accountId"
   WHERE o."createdAt" > now() - interval '2 days' AND o.status IN ('permanently_failed','failed','bounced')
   GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20;
   SELECT count(*) FROM "SuppressionEntry" WHERE reason = 'hard_bounce' AND "createdAt" > now() - interval '2 days';
   ROLLBACK;
   ```
   Run through `crm-db`: `$DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
   with `DC="docker compose --env-file .env.production $(./scripts/production-compose.sh .env.production)"`.
4. **"Send immediately" questions.** Step 1 with wait 0 and no send window is enqueued with delay 0
   on enrollment. A step **with** a window, enrolled after its end, goes to the next day's window start
   plus a deterministic jitter (the owner's 08:12 screenshot) — correct, not a bypass. Windows apply in
   each lead's own timezone. The owner was offered "wait-0 step 1 ignores the window" as an option;
   not decided.
5. **Outlook (Microsoft Graph) for sending.** Needs an Entra app registration: multitenant + personal
   accounts, redirect `https://crm.telestar.cloud/api/email/oauth/microsoft/callback`, delegated
   `Mail.Send Mail.Read User.Read offline_access`; then `MICROSOFT_CLIENT_ID/SECRET/REDIRECT_URI` in
   `.env.production` and recreate web+worker. `branndon.ng@outlook.com` cannot reach the Azure portal
   (personal account, no tenant): either the company M365 admin registers it, or create an Azure free
   account. **Waiting on the owner: personal @outlook.com or company M365 mailboxes?** Personal
   outlook.com is a poor fit for cold outreach (~300/day, quick lockouts).
6. Gmail OAuth fixed itself once `GOOGLE_CLIENT_SECRET` in `.env.production` lost a stray quote or
   space (`invalid_client`). Note for env edits: `deploy.sh` does not apply env-only changes — use
   the `up -d --no-deps --force-recreate web worker` command in `deploy/hostinger/RUNBOOK.md`.

## Process notes for the next agent

- **Before every push, regenerate what CI diffs byte-for-byte:**
  `node scripts/certification/render-rls-bypass-inventory.mjs`,
  `render-route-authorization.mjs`, `render-route-coverage.mjs`, `npm run agent -- facts`. #248 and
  #250 each lost a CI round to `rls-bypass-inventory` drift from a two-line edit.
- A test asserting old behaviour that the owner changed on purpose is updated, not the code
  (e.g. the owner-mailbox fallback, team lead 403 on members).
- Office PC: **no `gh`**, no database, no Docker. DB-backed suites cannot run here; the owner pastes
  the tail of the CI `Tests` step (`Failed Tests` → `Test Files`). The unauthenticated GitHub API
  allows 60 calls/hour — polling CI uses it up.
