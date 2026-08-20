---
id: revenue-intelligence
version: 1.0.0
domain: revenue-intelligence
risk: R2
sources: [lib/revenue/**, lib/meetings/**, lib/opportunities/**, lib/reports/**]
---

# Opportunities, meetings, client reporting

**LOAD WHEN** changing opportunities, meetings, commercial signals, learning, or client
reports.

**DO NOT LOAD WHEN** the change is lead-stage mechanics — that is `product-workflows`.

## Core invariants

- **A client report exposes that client's own campaign and nothing else.** Meetings booked,
  contacts touched, sequence stats. **No internal team data** — no rep names, no leaderboard,
  no other client's figures. This is the highest-consequence rule in the domain: a leak here
  leaves the company.
- **Reports are tenant- and campaign-scoped at the query**, never filtered in the view. An
  aggregate computed over an unscoped base is already wrong before presentation sees it.
- **Meeting outcome capture is structured** — persona and decision-maker fields exist so the
  data is analysable later, rather than free text nobody can query.
- **Learning is proposed, reviewed and approved.** Production outcomes never rewrite policy
  directly.

## Known failure modes

- **Reference integrity in reports.** Several dedicated tests exist because a report joining
  across campaigns is exactly how one client sees another's numbers.
- **Opportunity state duplicated** from lead stage rather than derived, so the two drift and
  neither is obviously wrong.
- **A meeting counted at booking and again at occurrence.**
- **A field added to a report DTO by spreading a model**, quietly including everything the
  model gained since.

## Required tests

```
tests/opportunities.test.ts             tests/meetings.test.ts
tests/client-reports.test.ts            tests/client-report-scope.test.ts
tests/client-report-reference-integrity.test.ts
tests/revenue-intelligence-trio.test.ts tests/commercial-intelligence-master.test.ts
tests/relationship-capital.test.ts
e2e/reports/**                          e2e/meetings/**
```

## Eval cases

- a client report shows another client's meeting → report scoping, **treat as R4**
- a rep's name appears in an external report → explicit field allowlist, R4
- meeting counts differ between dashboard and report → double counting, R2
