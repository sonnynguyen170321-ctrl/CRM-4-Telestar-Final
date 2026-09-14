---
classification: CURRENT_CANONICAL
---

# ICP industry-evidence audit — handoff (2026-09-14)

- **Base SHA:** `7b029f5` (main)
- **Branch:** `wip/icp-industry-evidence-audit`
- **Domain / risk:** `leadgen-intelligence` / R2 (`npm run agent -- brief --paths lib/leadgen/scorePoolItem.ts`)

## Why this branch exists

Goal: improve the lead filter + ICP scoring and fit it to the existing flow
(import | research → `resolveAccount`/`resolveContact` → `LeadPoolItem` → `scorePoolItem` →
immutable `LeadPoolAssessment` → `CampaignProspect` pointer → `convertPoolToLeads` → `Lead`).

A four-voice council (Architect / Skeptic / Pragmatist / Critic) plus a code review settled the order:

```
0. measure   how many verdicts are decided by industry evidence alone   ← this branch
1. fix       cut the summary→description feedback loop                   ← this branch
2. classify  port confidence/needsHumanReview into the taxonomy          ← only if 0 says so
3. wire      core-intel live into scoring                                ← after the Hostinger cutover
```

Rejected on purpose: relaxing `industryEvidenceMissing` so a record qualifies without evidence.
Company-only data may pre-rank an account; it must not overclaim final qualification.

## What changed

| file | change |
|---|---|
| `lib/leadgen/scorePoolItem.ts` | `buildScoringEvidence` / `scorePoolItem` take `IntelligenceCompanyEvidence` (the controlled-token mapper in `@telestar/core-intel`) instead of an ad-hoc `{industryCategory, facts, summary}`. The free-text `summary` is gone at type level. Only the eleven fields the V2 engine reads are copied — a spread let four V1-only fields into the fingerprint. Serialized evidence for a record without intelligence is byte-identical to `main`, so existing assessments still match. |
| `lib/leadgen/icpIndustryEvidenceAudit.ts` | Pure audit. Recomputes each latest assessment from its persisted `inputSnapshot` + `rulesSnapshot` with `assessIcpRulesV2` + `deriveSimpleIcpQualification`. Buckets: `not_allowlist` · `allowlist_industry_unknown` · `allowlist_match` · `allowlist_miss`. `industrySoleBlocker` is a counterfactual (fill the ICP's first target industry, rescore; qualified ⇒ industry was the only gap). `uploadedLabelOnly` = rejected on nothing but the uploaded `industry` string. `drifted` = engine no longer agrees with the stored verdict. |
| `scripts/audit-icp-industry-evidence.ts` | Runner. `--tenant` required, `--sample N`. Only `findMany`, under `tenantStorage.run({ tenantId })`. No apply mode. Prints one JSON document. |
| `tests/pool-scoring-evidence.test.ts` | 8 pure tests, no database. |
| `package.json` | `npm run audit:icp-industry-evidence` |

Not changed, deliberately: `not_scored` on the lead-filter surface vs `review` on the pool surface
is tested design (`lead-filter-phase-5`, `simple-scoring-contract`), not a defect.

## Verification (exit codes from the tools themselves)

- `vitest` pure suites (`pool-scoring-evidence`, `simple-scoring-contract`, `lead-filter-phase-5`): 26 passed, exit 0
- `eslint` on changed files: exit 0
- `tsc --noEmit` whole project (`NODE_OPTIONS=--max-old-space-size=8192`): exit 0, 0 errors
- Fingerprint bytes: probe run on `main` and on this branch, with and without `industry` — identical
- The `@ts-expect-error` guarding `summary` was proven to bite: removing it fails `tsc` with TS2353

**BLOCKED_EXTERNAL on the authoring workstation:** no database (local 5432 rejects the test
credentials, no docker), so `pool-scoring`, `pool-rescore`, `icp-adherence`, `leadgen*` did not
run there. They fail in `beforeAll` on DB auth, not on the change. Run them where a database exists
before merging.

## Next: run step 0

Confirm first which database holds `LeadPoolAssessment` rows. The cutover runbook copies only
eight tables to the VPS; operational data may still be only in GCP Cloud SQL.

On the VPS the `web` image already ships `lib/`, `scripts/`, `packages/` and `tsx`, so no rebuild
is needed — mount the two new files into a one-off container on the compose network:

```bash
cd /opt/crm && git fetch origin && git checkout wip/icp-industry-evidence-audit   # or scp the two files
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC run --rm --no-deps \
  -v /opt/crm/lib/leadgen/icpIndustryEvidenceAudit.ts:/app/lib/leadgen/icpIndustryEvidenceAudit.ts:ro \
  -v /opt/crm/scripts/audit-icp-industry-evidence.ts:/app/scripts/audit-icp-industry-evidence.ts:ro \
  web node node_modules/tsx/dist/cli.mjs scripts/audit-icp-industry-evidence.ts \
  --tenant <tenantId> --sample 10 > /opt/crm/backups/icp-industry-audit.json
```

Decide from the JSON:

| result | path |
|---|---|
| `industrySoleBlocker` is a large share of `needs_review` | do step 2 — port the confidence/alternatives/`needsHumanReview` contract; **keep** crm4's sector pre-gate, generic-tier discount and `linkedInIndustryHint`; low-confidence category = missing evidence; shadow harness classify-only, never `scorePoolItem` |
| `allowlistMissUploadedLabelOnly` is large | the problem is trusting the uploaded label, not missing evidence — strengthen the hint guard before any classifier |
| both small | step 2 is not worth it; look elsewhere in the flow |

Spot-check `samples` by hand before trusting either number.

## Open

- Move `deriveSimpleIcpQualification` out of the prisma-bearing `scorePoolItem.ts` into its own
  pure module; the audit and its tests currently import through the module that holds the client.
- `COMPANY_INTEL_PIPELINE_VERSION` is 10 here and 3 in `telestar-company-filter`'s working tree.
  Resolve before porting anything between the two taxonomies.
