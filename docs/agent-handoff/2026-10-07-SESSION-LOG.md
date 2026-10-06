---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-06/07. State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-06 / 07

What was done in one working session, why, and what is left. Written for the next agent.

**Before acting on anything here, check what is live.** This log goes stale the moment it is
written:

```bash
git fetch origin && git log --oneline -8 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

## Where things stood at the end of the session

- Production ran `7c5089c2` (PR #251) when this was written.
- Merged to `main`, not yet deployed: #252, #253, #254, #255. #253 adds two migrations and a new
  table, so the deploy must reapply RLS (see "Deploy").
- Deploy target handed to the owner: `6d0079e96c61770999275ceb10a59afb1b91266e` (#255 merge).
  Docker Image run 37509813972, "Build and push image" succeeded.
- Follow-up PR (this log travels in it): ICP owner-titles script, and full rescore that reaches
  every lead (the rescore buttons and `backfill-lead-icp.ts` re-read the same first 500 leads on
  every "run again"). Needs a second deploy before the script can run on production.
- **No agent deploys.** The owner runs deploys and production writes. Agents may run read-only
  production queries over `ssh telestar-vps`.

## What shipped

| PR | What | Main files |
|---|---|---|
| #251 | Per-sequence setting "Send first step immediately on enrollment": a wait-0 step 1 enrolled outside the send window goes now instead of at the next window. Enrollment hold reasons shown for mailbox/provider caps. | `lib/sequences/rules.ts`, `lib/sequences/engine.ts`, `workers/sequence.ts`, `workers/email.ts`, `SequenceRulesPanel` |
| #252 | Edit / archive campaign, team lead and up. Archive = status completed + end date, audited. | `app/api/campaigns/[id]/route.ts`, `components/campaigns/CampaignActions.tsx` |
| #253 | Lead drawer "why this verdict" panel, and a rep review button: the rep's verdict wins over the computed one wherever qualification is read; every review kept (append-only `LeadQualificationReview`). | `lib/leads/explainIcp.ts`, `lib/leads/effectiveQualification.ts`, `app/api/leads/[id]/qualification/route.ts`, `components/leads/IcpFitCard.tsx` |
| #254 | AI must-fix: draft-reply no longer returns canned "Sonny" drafts when the provider is down (503 instead); drafts read the thread; no reply drafted to unsubscribe / out-of-office; enrich-lead grounded in company research and CRM fields, never invents tech stack or claims. | `app/api/ai/draft-reply/route.ts`, `app/api/ai/enrich-lead/route.ts` |
| #255 | ICP scoring accuracy — see below. | `packages/core-scoring/src/rules/*`, `lib/leadgen/*Qualification.ts`, `lib/leads/icpScoring.ts` |

Also done on production at the owner's request: maintenance repair sweep added to cron every 15
minutes (`types=missing-delayed,stale-pending-outbound,stale-sending`). The 2026-10-06 11:44 bounce
batch on sequence Email_Mavis was checked read-only: the bounces were real; nothing un-suppressed.

### #255 scoring accuracy — the production causes

- ICP targets "USA"/"UK" were compared raw against a lead normalized to "United States" → geo 10
  (31 leads). "United Kingdom Uk" read as a non-target country (90 leads). Now every country
  comparison goes through `countryKey()`.
- "Vice President of Sales", "Sales Director" missed "VP Sales" / "Director of Sales". Multi-word
  allowlist entries now match by word set. The denylist and negative point rows stay exact.
- LinkedIn's "IT Services and IT Consulting" industry label disqualified software companies. Only a
  SERVICE_ONLY / AGENCY classification is fatal now; a services word anywhere sends an otherwise
  qualifying lead to needs_review (`services_review`). **Behaviour change the owner should know:**
  description-only "consulting"/"agency" used to hard-disqualify.
- Lead scoring now reads the company research profile; editing title/company/email rescores.
- Verdict versions bumped (`weighted-v2`, `points-v2`): a rescore writes fresh assessments.

## Owner request, 2026-10-07 (verbatim intent)

> "I think we need to do a worldwide market research to update the tool intelligence for title,
> industry, niche, vertical because there are a lot out there."
> Add to the ICP accepted titles: Managing Director, Owner, President, Sales Director, CSO,
> VP Sales. Fix the campaigns "Tele Campaign Alpha" and "2nd Floor", which still point to the
> archived "TeleStar ICP" v1. "Do the deployment first, write the request to session log."

Order the owner set: **deploy first**, then the ICP fixes, then the research.

### Production ICP state (read-only query, 2026-10-07)

| Profile | Version | Status | Campaigns on it |
|---|---|---|---|
| Telestar (tenant default) | v1 | published | 0 (used by campaigns with no ICP) |
| TeleStar ICP | v1 | **archived** | 2 — Tele Campaign Alpha (1,692 leads), Telestar - 2nd Floor campaign test (198) |
| TeleStar ICP | v2 | published | 0 |
| Telestar v2 | v1 | draft | 0 |

Campaigns with no ICP (fall back to the default): FastNetMon, Nekko_Email Campaign_Manu (93
leads), Tele - Q4 - Campaign.

Both published allowlists already contain "VP Sales" and "Director of Sales"; after #255 those also
match "Vice President of Sales" and "Sales Director". Still to add: Managing Director, Owner,
President, Sales Director, CSO, VP Sales (as an explicit entry where missing).

### Plan for the ICP fix

1. Script `scripts/icp-owner-titles-2026-10-07.ts` (logic in `lib/leadgen/icpAllowlistUpdate.ts`),
   dry run by default, using the app's own authoring path (clone → save draft → publish → assign
   campaign), so versions stay immutable and every change is a new published version. It refuses a
   profile with an open draft, and also moves any campaign still on the version it replaces:
   - "TeleStar ICP": new version = v2 + the six titles; point Tele Campaign Alpha and 2nd Floor at it.
   - "Telestar" (default): new version = v1 + the six titles, so no-ICP campaigns agree.
2. Ships in the image (scripts are copied into it), so it needs a deploy after it merges.
3. Then a full rescore: `scripts/backfill-lead-icp.ts --all` (preview of verdict moves), then
   `--all --apply`. `--all` and the cursor are new in the follow-up PR.

Commands, once the follow-up PR is deployed (tenant id from `select id, name from "Tenant"`):

```bash
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC exec -T web npx tsx scripts/icp-owner-titles-2026-10-07.ts --tenant <tenantId>            # plan
$DC exec -T web npx tsx scripts/icp-owner-titles-2026-10-07.ts --tenant <tenantId> --apply
$DC exec -T web npx tsx scripts/backfill-lead-icp.ts --all                                    # preview moves
$DC exec -T web npx tsx scripts/backfill-lead-icp.ts --all --apply
```

The owner can do step 1 by hand in the ICP builder instead; the script is the repeatable record.

### Plan for the market research (not started)

Worldwide taxonomy for titles, industries, niches and verticals, to replace the hand-made lists
in `packages/core-scoring/src/rules/dictionaries/*` (seniority, regions, industries) and the title
synonym table in `personaScore.ts`. Sources to weigh: LinkedIn industry taxonomy V2, NAICS 2022,
ISIC Rev.5, GICS, O*NET / ISCO-08 for titles, plus the free-text titles and industries already
in production (`Lead.title`, `Account.industry`) — the real distribution is the test set. Output is
data + tests, reviewed before it changes any verdict; a dictionary change bumps the verdict
version.

## Deploy (operator runs this; an agent does not deploy)

After the `Docker Image` workflow's "Build and push image" step has succeeded for the merge SHA
(an agent checks this and posts the full 40-char SHA):

```bash
cd /opt/crm && git fetch origin && git checkout <full-sha>
./scripts/deploy.sh <full-sha>       # backup, migrate deploy, up, smoke
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < supabase/rls.sql
npm run prod:cutover:postcheck
curl -s https://crm.telestar.cloud/api/health    # .commit = <full-sha>
```

RLS must be reapplied: #253 adds `LeadQualificationReview`, and a tenant table without its policy
is invisible to the app role (see the RUNBOOK, "Roles, RLS, and the thing that fails silently").
Rollback: `./scripts/rollback.sh` — both #253 migrations are additive.

## Open items

- Deploy #252–#255 (above).
- ICP titles + campaign repoint script, then deploy, then full rescore.
- Worldwide title / industry / niche / vertical research.
- AI full upgrade (approved): insert into composer, regenerate with an instruction in the drawer,
  keep the last result, full email draft.
- Owner items carried over: reset the shared Telestar2026 passwords; rotate the PBX password in the
  repo; `ALERT_WEBHOOK_URL`; uptime monitor; mailbox daily-cap warm-up; `DATABASE_URL`
  `connection_limit`; run `preflight-health.sql`; clear old domain-wide unsubscribe rows; stale
  pgbackrest cron lines.
