---
id: leadgen-intelligence
version: 1.0.0
domain: leadgen-intelligence
risk: R2
sources: [lib/leadgen/**, app/api/leadgen/**, app/leadgen/**, app/leadgen-manager/**]
---

# Leadgen and qualification

**LOAD WHEN** changing sourcing, qualification, ICP adherence, the lead pool, or handoff to an
SDR.

**DO NOT LOAD WHEN** the change concerns what happens to a lead after it is an SDR's — that is
`product-workflows`.

## Where ICP lives

**`CampaignLeadRequirement` owns ICP.** Not the playbook — `lib/playbooks/policy.ts` is a
`.strict()` zod contract that *rejects* an `icp`, `targetTitles` or `companySizeMin` key
outright. Three owners, never merged:

| Owner | Answers |
|---|---|
| `CampaignLeadRequirement` | who to source, and what qualifies |
| `CampaignPlaybookVersion` | how approved outreach should operate |
| CRM / automation services | execution and enforcement |

## Core invariants

- **Leadgen roles are real roles.** `leadgen` and `leadgen_manager` are two of the six. They
  work a pool and a campaign requirement, not an assigned lead list.
- **Qualification is attributed.** `LeadPoolItem.qualifiedById` records who decided. It is
  history, and nothing rewrites it on transfer.
- **Handoff is explicit** — a qualified record becoming an SDR's lead is a transition with
  consequences, not a field flip.
- **ICP adherence is measured, not asserted** (`lib/leadgen/icpAdherence.ts`).

## Known failure modes

- **Pool scoping assumed to match SDR scoping.** Leadgen sees by campaign and pool, not by
  `assignedToId`. Applying the SDR scope shape returns an empty list, or someone else's.
- **Duplicate sourcing** across runs without a stable dedup key.
- **Attribution columns without foreign keys.** Several exist, so the database will not keep
  them consistent — a user deletion leaves them dangling by design.
- **Requirement changes applied retroactively** to already-qualified records, rewriting the
  basis on which a human made a call.

## Required tests

```
tests/leadgen.test.ts            tests/leadgen-redesign.test.ts
tests/icp-adherence.test.ts      tests/contact-intelligence.test.ts
tests/opportunity-handoff.test.ts
```

## Eval cases

- a leadgen user sees an empty pool → pool scoping, R2
- the same company is sourced twice in a week → dedup key, R2
- a playbook edit tries to redefine ICP → the policy contract rejects it, R2
