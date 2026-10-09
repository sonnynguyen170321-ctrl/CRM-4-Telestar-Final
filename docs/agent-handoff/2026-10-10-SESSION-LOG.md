---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-10. State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-10: release, AI panel, research spend, worldwide taxonomy

```bash
git fetch origin && git log --oneline -10 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

## The owner's request

"còn gì nữa không. làm cho done hết luôn" — ship everything open: the owner's own branches from
2026-10-08/09, the research fix (#268), and the backlog (AI panel upgrade, worldwide title / industry
taxonomy, research follow-ups).

## What merged

| PR | What | Deploy note |
|----|------|-------------|
| #269 | Release: bounce stops every later send (+ inbox resync, unapplied-bounces repair, bounce audit), inbox reply policy for shared sequences, lead drawer names the ICP a verdict is measured against, phone dialer panel (call from your own phone + log it), #268 research classifier truncation fix | migration adds indexes only |
| #270 | Phone panel blocks a do-not-call lead (lead / contact flag or `do_not_call` tag) before the rep dials; `wrong_number` tag warns | — |
| #271 | Lead drawer AI panel: "Use in email" seeds the composer, regenerate with a rep instruction (300 chars, fenced), saved result per lead (`LeadAiInsight`), full email draft; per-rep limit 120 / 10 min | **new tenant table → reapply `supabase/rls.sql`** |
| #272 | AI spend per research run (`AiCall.researchRunId`, shown in the run header) + "Their competitors: rule these out" control in the research builder | column + index + FK on AiCall (229 rows on prod) |

#264–#267 were closed as shipped in #269.

Reviews: the dialer branch had a security review (no CRITICAL/HIGH; the DNC gap became #270). #271
had a security review (no CRITICAL/HIGH; a malformed saved answer would crash the drawer on every
open — now zod-checked on save and on load; the per-rep limit). #272 had a database review (no
CRITICAL/HIGH; non-concurrent index is fine at 229 rows).

## Open: worldwide title / industry taxonomy

Branch `research/title-industry-taxonomy` (not yet a PR): seniority, industry and served-vertical
dictionaries extended (regions, languages incl. Vietnamese, LinkedIn V2 / NAICS / GICS labels),
whole-word matcher with accent folding (fixes the "display" → ISP class), verdict versions
weighted-v3 / points-v3. Doc: `docs/scoring/TAXONOMY_2026-10.md`. A code review found stem entries
("tech", "health") silently stop matching and a few seniority guards that demote real titles; fixes
are in progress on the branch, followed by an old-vs-new comparison over the two live ICPs before
it ships. After it deploys the owner must rescore: Leads → Rescore all, or
`scripts/backfill-lead-icp.ts --all` (preview) then `--all --apply`.

Live ICPs on prod at writing: "TeleStar ICP" v3 (titles + excluded countries only) and "Telestar" v2
(adds target industries Tech / Software / SaaS, excluded service / bpo / consultant).

## Deploy and run order (owner)

```bash
cd /opt/crm && git fetch origin && git checkout <full-sha-of-main>
./scripts/deploy.sh <full-sha-of-main>
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < supabase/rls.sql   # #271
npm run prod:cutover:postcheck
```

Then, in order:

1. Inbox resync, dry run then apply: `$DC exec -T web npx tsx scripts/inbox-resync.ts --days 30`
   (then `--apply`).
2. Add `,unapplied-bounces` to the 15-minute maintenance cron `types=` list.
3. `$DC exec -T web npx tsx scripts/audit-bounce-coverage.ts` — "bounced but not suppressed" and
   "enrollments on a bounced address" should be 0.
4. /research → run `cmuyyu4x…` → "Check again" (the 92 companies #268 left unchecked).
5. The five owner ICP runs: `scripts/research-owner-icp-runs-2026-10-08.ts --tenant default-tenant`
   (plan), then `--apply`; grade the shortlists (target ≥85% on target, ≥30 per ICP).

## Still open

- Taxonomy branch (above), then rescore.
- Phone panel review MEDIUMs not fixed: tag read-modify-write can race a concurrent tag change; the
  server does not validate `metadata.outcome` against the outcome list; 24/7 calling hours remove
  the hours gate entirely — owner to confirm that is intended.
- Proposed new industry keys (professional services, legal, staffing/HR, BPO, wholesale, nonprofit,
  security services, automotive/aerospace) — they change the research classifier's allowed list, so
  they need their own change and a research re-run.
- Owner items carried over: reset the shared default login password; rotate the PBX password in the
  repo; `ALERT_WEBHOOK_URL`; uptime monitor; mailbox daily-cap warm-up; `DATABASE_URL`
  `connection_limit`; run `preflight-health.sql`; clear old domain-wide unsubscribe rows; stale
  pgbackrest cron lines.
