# Lead Gen Intelligence — V1/V2 Parity Benchmark Spec

**Status:** Draft for review  
**Purpose:** prevent V2 scoring from silently breaking useful V1 behavior.

## 0. Executive Decision

Before V2 scoring is wired into persistence or UI, run a deterministic parity benchmark against selected V1 scenarios.

Parity does not mean identical internals. It means intentional and reviewed output behavior.

## 1. Benchmark fixture categories

```txt
strong product website
strong SaaS CSV but no website evidence
service-only company
service-plus-product company
website offline
data-poor row
excluded country
personal email
B2C-only signal
conflicting evidence
AI unavailable
```

## 2. Assertions

Examples:

```txt
Not Relevant should not receive score 60.
Weak/no website evidence should not become high confidence qualified.
Product-led website with pricing/platform/docs should score above service-only.
Missing website should default to review_required, not terminal fail.
Service-plus-product should not be auto-failed solely by service keywords.
```

## 3. Divergence process

For each V1/V2 divergence:

```txt
record fixture name
record V1 output
record V2 output
record reason
approve or reject divergence
update spec or tests
```

## 4. Exit gate

V2.4 is complete only when:

```txt
all benchmark fixtures pass or divergences are approved
no accidental V1 regression remains unexplained
scoring guardrails are updated if needed
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
