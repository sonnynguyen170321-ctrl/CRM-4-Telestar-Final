# Lead Gen Intelligence — Pilot Scope and Success Metrics

**Status:** Draft for review  
**Purpose:** define what a successful internal pilot means and when to stop building.

## 0. Pilot decision

The pilot is not a public SaaS launch. It is an internal operating system test for Telestar-style SDR workflows.

## 1. Target pilot scale

```txt
Users: 10–15 active daily users, stress-tested toward 50 users
Client accounts: 5–10
Projects: 10–20
ICP versions: 20–50
Companies: 5k–20k initial, stress test up to 50k
Contacts: 5k–20k initial, stress test up to 50k
Activity rows: 2k–10k initial recap rows
```

## 2. Primary success metric

```txt
HardRule scoring agreement >= 70%
```

Definition:

```txt
% of deterministic qualifications that SDR/Manager accepts without changing final qualification.
```

Important:

```txt
A disagreement caused by missing data is not the same as a logic error.
```

## 3. Business usefulness metric

The team must qualify and act on a lead list faster than V1/spreadsheet workflow.

Measure:

```txt
time from upload start → reviewed/exportable/action-ready lead list
```

## 4. Activity recap trust metric

```txt
Auto-match rate should improve over time.
```

Expected pattern:

```txt
Week 1: high unmatched rate is acceptable
Week 2+: database fills, auto-match should rise
Target trend: 50% → 70–80%
```

## 5. Stop & Ship decision

After core pilot workflow is usable:

```txt
Stop building more features.
Run real internal workflow.
Measure the three metrics.
Decide whether to continue, tune, or freeze.
```

## 6. Pilot non-goals

Do not require these for pilot success:

```txt
full outreach automation
pipeline kanban
advanced reporting
advanced theme builder
public SaaS billing
SSO/SAML
multi-tenant external customer admin
```


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
