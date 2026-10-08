---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-08. State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-08: company research accuracy

What was done, why, and what is left. Written for the next agent.

```bash
git fetch origin && git log --oneline -10 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

## The owner's report

> "Research companies are wrong too often. Check the 7/10 batch. A page with the word 'saas' gets
> in even when it is not relevant." Plus five client ICPs to test with: FingerMind (aviation MRO /
> CAMO / Part 145), Stormwall (ISPs, telcos, hosters, banks, e-commerce, gaming… in MENA, Asia,
> Europe), 1CloudHub (Singapore companies with IT estates), Saigon Technology (banks, healthcare,
> financial services in NZ/DE/AU, 2–500 staff), Dpoint (Vietnamese retail, F&B, FMCG; not Vinamilk).

## What production showed (read-only)

- 2026-10-07 FMCG run (Singapore, Vietnam): 4 queries, 0 results, status `succeeded`. Every query
  carried the size band as a quoted phrase, `"51-200, 201-500, 501-1000"`, which no page contains.
- 2026-10-07 Tech run: 27 candidates — Saas-Fee (ski resort), Teck Resources (mining), UKTN (news),
  PitchBook, "Tech USA LLC", a market-cap directory. Heuristic fit = word counting (floor 54).
- Baseline with the five ICPs on production providers (`scripts/research-eval.ts`, no DB): ~43% of 37
  candidates on target; Saigon Technology 0; "ISP" → ISP Schools; "infrastructure" → AECOM.
  Hand labels: see the eval labels file in the PR description of #262 / scratch (not committed).

## What shipped (all merged)

| PR | What |
|---|---|
| #258 | Plain defects: public-suffix domains (`co.uk` was a "company"), refuse research/directory/job-board/gov/edu/roundup pages with counts by reason, no size phrase in queries, no "top X companies" query, countries round-robin, empty runs explain themselves |
| #259 | Schema: `ResearchVerification` on candidates, `ResearchDomainClassification` cache, run verification fields. Migration `20261008120000_research_verification` (additive). **Deploy must reapply `supabase/rls.sql`.** |
| #260 | Classifier (pure): company kind (operator / vendor / agency / reseller / association / government / education / media / directory-job board / research / event), industry, what they sell, HQ, size; hard rules; every model claim grounded in a verbatim quote filed under its field |
| #261 | Scoring (pure): builder params → the lead ICP engine's rules, account-level projection, research fit gates on known facts (explicit countries only, known headcount, canonical industry outside sector family at high confidence), kind policy with `competitorKinds`, ICP fit judge (LLM over grounded facts) that can reject with a named element or confirm |
| #262 | Pipeline + UI: `research.verify` job, per-domain cache with claims, identity-page fetch when evidence is thin, retries → "couldn't check" with reason, run fails only when every check failed for infrastructure reasons and can be resumed; shortlist / ruled out / couldn't check / checking views with counts; promotion refuses pending/rejected; discovery also asks in words ("Banking companies in New Zealand") |

Every PR had TDD, mutation checks where logic is pure, and an independent code review whose
CRITICAL/HIGH findings were fixed before merge.

## Deploy (operator)

After the Docker Image workflow's "Build and push image" succeeds for the merge SHA of #262:

```bash
cd /opt/crm && git fetch origin && git checkout <full-sha>
./scripts/deploy.sh <full-sha>
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < supabase/rls.sql
npm run prod:cutover:postcheck
```

Deploy web and worker together (deploy.sh does): a new web enqueues `research.verify`, which an old
worker now rejects loudly instead of completing silently.

## Measuring it (the owner's five ICPs)

```bash
$DC exec -T web npx tsx scripts/research-owner-icp-runs-2026-10-08.ts --tenant default-tenant          # plan
$DC exec -T web npx tsx scripts/research-owner-icp-runs-2026-10-08.ts --tenant default-tenant --apply  # create + start
```

Runs appear in /research. Then, read-only: per run, count `verification` and read the shortlist
against the owner's ICPs. Target: ≥85% of the shortlist on target and ≥30 companies per ICP.

## Open items

- Run the five ICPs after deploy and grade them (above).
- Builder UI has no control yet for `competitorKinds` (the script sets it).
- `canonicalizeIndustry` / `industryScore.listMatches` match by substring ("display" → ISP); fixing it
  changes lead verdicts, so it needs its own PR with a rescore preview.
- AI calls for classification/judge are attributed to the tenant, not to the run (AiCall has no run id).
- Query quality beyond the words-form query (P3): per-ICP descriptions, more results per query, not
  stopping at the first provider.

---

# Later the same day — dialer, inbox policy, Outlook (office PC session)

Verify against GitHub and production first; nothing here is deployed unless it says so.

## State at the time of writing

- Production ran `e5208aca` (#257, the 2026-10-07 release). The research PRs #258–#263 were merged
  but **not deployed**; their deploy must reapply `supabase/rls.sql` (see above).
- Open branches, pushed, **no PR yet** (this PC has no `gh`; the owner opens them):
  - `fix/inbox-sequence-owner-role` — owner decision: the owner of a shared sequence sees other
    teams' leads' replies only from team lead up; an SDR owner sees their own leads' replies.
    Replying from the mailbox the prospect wrote to, even a team lead's, stays allowed (confirmed).
  - `feat/dialer-prework-phone-panel` — the dialer pre-work below.
- Signature in Gmail confirmed fixed by the owner after #257.

## Outlook connection (owner, in progress)

Guidance given: Azure free account → Entra app registration, *any organizational directory and
personal Microsoft accounts* (the code uses the `common` endpoint), redirect
`https://crm.telestar.cloud/api/email/oauth/microsoft/callback`, delegated Graph `Mail.Send`,
`Mail.Read`, `User.Read`, `offline_access`, secret **value** into `MICROSOFT_CLIENT_ID` /
`MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI`, then `up -d --force-recreate web worker`.
Not yet confirmed by the owner. The Outlook send path (Graph MIME base64, fixed in #257) has never
sent from a real Outlook mailbox: send one test mail to self first and check sync.

## Dialer: decisions

Plivo was planned and dropped the same day; Telnyx stays. The decisions are recorded in
`docs/dialer/TASKS.md` → "Owner decisions, 2026-10-08", and `docs/dialer/TELNYX_SETUP.md` was
rewritten to match. In short: international leads only through the CRM dialer; Vietnamese numbers
from the rep's own phone, logged in the CRM; no inbound; caller ID = numbers being ported from
Bigin (a current Telnyx number meanwhile); recording on without a spoken notice by default (manager
settings); calling any time (manager setting); outcome required after hangup; whole team at once.
Today the team calls with Bigin + MicroSIP.

## Dialer: done ahead (branch `feat/dialer-prework-phone-panel`)

- Lead drawer **Call** → `components/dialer/PhoneCallPanel.tsx`: the number (E.164), copy, a `tel:`
  QR code a phone scans to dial, and the required outcome (the nine of the task Call Logging modal,
  `lib/telephony/phoneOutcomes.ts`) with the same effects (`lib/telephony/logPhoneCall.ts`): the
  `call_logged` activity in the task path's metadata shape (its route creates the callback task, next
  business day), `lastContactedAt`, a `do_not_call` / `wrong_number` tag added to the lead's tags
  read fresh, and the booking form for a booked meeting. Escape closes, focus stays in the dialog.
  Works for every lead today (MicroSIP users copy the number).
- Gate: `isAlwaysOpen` — hours 00:00–24:00 on all seven days need no timezone, so `tz_unknown` no
  longer blocks there. Every other rule is unchanged.
- Removed the old dialer: `CallDialerModal.tsx`, `/api/dialer/config` (+ its test), `sip.js`.
- New dependency `qrcode` (+ `@types/qrcode`); `npm audit --omit=dev` reported 0.

## Phase 0 tonight (owner) — `docs/dialer/TELNYX_SETUP.md`

1. Confirm Level 2 and the concurrent-call limit; ask for 40 if lower.
2. Auto-recharge.
3. New outbound profile `crm-outbound`: every country the team calls **except Vietnam**; recording off.
4. New credential connection `crm-webrtc` (separate from MicroSIP's): **call parking on**, webhook
   `https://crm.telestar.cloud/api/telephony/telnyx/webhook`, API v2.
5. Call Control app `crm-inbound` with no number (the env check needs its ID).
6. Start the Bigin port; pick a default caller-ID number; assign numbers to `crm-webrtc`.
7. Keys into `/opt/crm/.env.production` with `TELEPHONY_ENABLED=false` and `TELEPHONY_DRY_RUN=true`,
   then recreate web + worker.
8. Support ticket: concurrency, port timeline, prices, and whether `customHeaders` on `newCall`
   reaches `call.initiated` on a parked call (the docs describe it for call-control correlation).

## Next for the agent

Phase 1 (webhook + worker + reconcile, R3) and Phase 2 (softphone dock; non-VN → softphone, VN →
the phone panel) per `docs/dialer/TASKS.md`, then the live check in `TELNYX_SETUP.md` §9 before the
team is switched on.
