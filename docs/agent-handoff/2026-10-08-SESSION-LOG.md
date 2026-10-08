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
