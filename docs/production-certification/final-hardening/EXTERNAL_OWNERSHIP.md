# EXTERNAL OWNERSHIP — MULTI-AGENT BOUNDARY

## Active External PR: #107
- **PR**: #107
- **Title**: `fix(rls): raw SQL and operational tooling survive enforcement`
- **Branch**: `fix/raw-sql-tenant-context`
- **Head SHA**: `44a3cea8afbfb62e35385c62cbe3640fe150280c`
- **Base SHA**: `76b737786d09f2120ddc6ed22df6e21c5ae9ba22` (current `main`)
- **Status**: `OPEN` (Actively owned by external agent)
- **Domain**: RLS / raw SQL tenant context / operational tooling / admin client

### RED Files (READ-ONLY — DO NOT MODIFY)
1. `.agent/registry/domains.yaml`
2. `docs/pre-domain-hardening/STATUS.md`
3. `inspect_policies.ts`
4. `lib/ai/budget.ts`
5. `lib/db/adminClient.mjs`
6. `lib/leadgen/qualification.ts`
7. `lib/prisma.ts`
8. `lib/research/cache.ts`
9. `lib/search/accentSearch.ts`
10. `prisma/seed-demo.ts`
11. `scripts/agent/roi.ts`
12. `scripts/apply-p8-migration.mjs`
13. `scripts/canary-live-drill.mjs`
14. `scripts/certification/probe-environment.mjs`
15. `scripts/check-relational-integrity.ts`
16. `scripts/create-admin.ts`
17. `scripts/create-user.ts`
18. `scripts/cutover-preflight.ts`
19. `scripts/demo-seed.ts`
20. `scripts/diagnose-import.mjs`
21. `scripts/e2e-audit-fixture.ts`
22. `scripts/encrypt-existing-tokens.ts`
23. `scripts/prod-audit.ts`
24. `scripts/prod-certify.mjs`
25. `scripts/provision-telestar-organization.ts`
26. `scripts/purge-demo-tenant.ts`
27. `scripts/sync-sequence-enrollments.ts`
28. `scripts/verify-ai-attribution.ts`
29. `scripts/verify-db-integrity.ts`
30. `scripts/verify-rls-app-paths.probe.ts`
31. `scripts/worker-healthcheck.ts`
32. `tests/demo-email-barrier.test.ts`
33. `tests/email-worker.test.ts`
34. `tests/failure-matrix.test.ts`
35. `tests/helpers/sessionUser.ts`
36. `tests/raw-sql-tenant-context.test.ts`
37. `tests/setup/db-baseline.ts`
38. `workers/email.ts`

### AMBER Files (Tightly coupled callers — read/test freely, edit only if independent)
- Callers of `lib/prisma.ts`
- Callers of `workers/email.ts`
- Callers of `lib/ai/budget.ts`
- Callers of `lib/leadgen/qualification.ts`

### GREEN Files (Our autonomous hardening lane)
- Production/repository/certification truth reconciliation
- Cloud SQL PITR / backup / RPO verification & remediation
- Production release identity audit & alignment
- Durable webhook production & migration state
- Six-role browser acceptance suites (`tests/browser/**`)
- Golden cross-role organizational workflow
- Meeting workflows (`tests/meetings*`, `app/**/meetings/**`, `lib/meetings/**`)
- Opportunities pipeline (`tests/opportunity*`, `lib/opportunities/**`)
- Campaign workflows & allocations
- Reports & public share token characterization (`app/api/reports/**`, `lib/reports/**`)
- Security attack matrix & RBAC boundaries outside PR #107 files
- Observability & health checks outside PR #107 files
- Final certification harness hardening
