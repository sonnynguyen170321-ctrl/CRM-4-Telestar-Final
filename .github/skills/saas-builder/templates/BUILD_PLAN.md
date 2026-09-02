<!--
  BUILD_PLAN.md — the living plan for ONE SaaS build. Copy this into the target repo root
  (or docs/) at Phase 1 and keep it current. Phases 2–3 fill it; Phase 4 walks the session queue.
  This file + SESSION_LOG.md are the lifecycle spine. Keep them the single source of truth.
-->

# BUILD_PLAN — <Product Name>

## Brief (Phase 1 — locked)

- **What it does:** <one sentence>
- **Tenant boundary:** <org / workspace / account> — the unit Org A never sees of Org B
- **Users & roles:** <roles + who can do what>
- **Core entities:** <3–7 nouns + relations>
- **Must-have surfaces (v1):** <screens the user cannot live without>
- **Deploy target:** <default: single-host docker-compose, see reference/deploy-ec2.md>

## Coverage plan (Phase 2 — walk reference/coverage-checklist.md)

For each pillar: the product-specific plan, or **N/A — <reason>**. No silent blanks.

| # | Pillar | Plan for this product | Guide |
|---|--------|-----------------------|-------|
| 1 | Tenancy & auth | | tenant-spine |
| 2 | Data model & migrations | | schema-modeling |
| 3 | Domain / business logic | | tenant-spine |
| 4 | Async jobs & scheduling | | job-engine |
| 5 | API wiring | | api-wiring |
| 6 | UI surfaces & navigation | | ui-kit |
| 7 | Access control / RBAC | | tenant-spine |
| 8 | Soft-delete & audit | | invariants #8 |
| 9 | Secrets & webhooks | | invariants #9 |
| 10 | Notifications + suppression | | invariants #10 |
| 11 | Observability & health | | deploy-ec2 |
| 12 | Deploy & env | | deploy-ec2 |
| 13 | Seed / provisioning | | tenant-spine |
| 14 | Tests / exit-gates | | invariants #13 |

## Session queue (Phase 3 — decompose; reference/session-decomposition.md)

Order by dependency: schema → read-model → api → ui-surface → deploy (jobs slot by producer/
consumer). One change-kind per row. A row is **unblocked** when every `consumes` artifact exists.

| id | change-kind | consumes | produces | exit-gate | status |
|----|-------------|----------|----------|-----------|--------|
| S1 | schema | <spine models> | | migration applies clean | pending |
| S2 | read-model | S1 | | tenant-isolation test | pending |
| S3 | api | S1 | | happy-path + validation test | pending |
| S4 | ui-surface | S2, S3 | | SEE-IT browser pass | pending |
| … | | | | | |

## Open questions / decisions

- <anything unresolved that a future session must not guess>
