# Telestar CRM — Master Requirement Traceability Matrix

**Program**: Zero-Assumption Production Certification  
**Authoritative Baseline SHA**: `353f650bebc78db83e50fc3a254d9712046245d6`  
**Last Updated**: 2026-08-19T22:06:09+07:00  

---

## 1. Traceability Summary

- **Total Mapped Requirements**: 108
- **Verified**: 0
- **In Progress / Defect Registered**: 7
- **Not Started**: 101
- **Unmapped Original Requirements**: 0

---

## 2. Requirement Matrix by Subsystem

### Domain A: Import Reliability & Concurrency (IMP)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `IMP-001` | Directive §7 | Account race & collision convergence across concurrent workers | `tests/import-race-stress.test.ts` (120 rows) | IN_PROGRESS | TEL-P1-002 |
| `IMP-002` | Directive §7 | Contact identity deduplication on concurrent import chunks | `tests/import-worker.test.ts` | NOT_STARTED | - |
| `IMP-003` | Directive §7 | Deterministic fault injection: crash after Lead creation converges on retry | `tests/import-fault-injection.test.ts` | IN_PROGRESS | TEL-P1-001 |
| `IMP-004` | Directive §7 | Deterministic fault injection: crash after ImportRow update converges | `tests/import-fault-injection.test.ts` | IN_PROGRESS | TEL-P1-001 |
| `IMP-005` | Directive §7 | Deterministic fault injection: crash after Activity creation converges | `tests/import-fault-injection.test.ts` | IN_PROGRESS | TEL-P1-001 |
| `IMP-006` | Directive §7 | Deterministic fault injection: crash after SequenceEnrollment converges | `tests/import-fault-injection.test.ts` | IN_PROGRESS | TEL-P1-001 |
| `IMP-007` | Directive §7 | Deterministic fault injection: crash after first Task creation converges | `tests/import-fault-injection.test.ts` | IN_PROGRESS | TEL-P1-001 |
| `IMP-008` | Directive §8 | 120-row high contention stress test with 40 shared accounts | `tests/import-race-stress.test.ts` | IN_PROGRESS | TEL-P1-002 |
| `IMP-009` | Directive §8 | 500-row batch load test with p95 duration tracking | Load test script | NOT_STARTED | - |
| `IMP-010` | Directive §8 | 1,000-row batch load test with zero prospect loss | Load test script | NOT_STARTED | - |
| `IMP-011` | Directive §9 | Pool import chunk partial-write fault injection & convergence | `tests/pool-import-fault.test.ts` | NOT_STARTED | - |
| `IMP-012` | Directive §10 | Batch commit ordering: state-driven commit blocked while chunks in-flight | `tests/batch-commit-ordering.test.ts` | NOT_STARTED | - |
| `IMP-013` | Directive §10 | Batch commit idempotency: duplicate BullMQ delivery does not duplicate state | `tests/import-worker.test.ts` | NOT_STARTED | - |

### Domain B: Outbound Email & Side-Effect Safety (MAIL)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `MAIL-001` | Directive §11 | Hard send barrier: demo tenant cannot trigger network transport | `tests/demo-email-barrier.test.ts` | IN_PROGRESS | TEL-P1-003 |
| `MAIL-002` | Directive §11 | Outbound message idempotency key prevents duplicate physical sends | `tests/email-idempotency.test.ts` | NOT_STARTED | - |
| `MAIL-003` | Directive §11 | Worker crash after provider transport records `UNKNOWN_PROVIDER_OUTCOME` | `tests/email-fault-injection.test.ts` | NOT_STARTED | - |
| `MAIL-004` | Directive §11 | Provider timeout handling without blind automated retries | `tests/email-fault-injection.test.ts` | NOT_STARTED | - |
| `MAIL-005` | Directive §11 | Suppression list & global unsubscribe checked at final transport boundary | `tests/email-safety.test.ts` | NOT_STARTED | - |
| `MAIL-006` | Directive §11 | Account quota enforcement & daily rate limiting | `tests/email-health-scoring.test.ts` | NOT_STARTED | - |
| `MAIL-007` | Directive §11 | Global emergency pause halts all active workers immediately | `tests/email-health-access.test.ts` | NOT_STARTED | - |
| `MAIL-008` | Directive §11 | Unsubscribe atomicity across campaign and tenant suppression | `tests/unsubscribe.test.ts` | NOT_STARTED | - |
| `MAIL-009` | Directive §11 | Bounce detection categorizes hard vs soft bounces accurately | `tests/bounceDetection.test.ts` | NOT_STARTED | - |

### Domain C: Security, Multi-Tenant RLS & RBAC (SEC)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `SEC-001` | Directive §18 | Complete inventory of all `bypassRls`, `new PrismaClient`, `$queryRaw` | `docs/production-certification/RLS_BYPASS_INVENTORY.md` | NOT_STARTED | - |
| `SEC-002` | Directive §18 | Throwaway DB RLS enforcement across all tables and operations | `scripts/verify-rls.mjs` | NOT_STARTED | - |
| `SEC-003` | Directive §19 | Mass assignment audit: client cannot inject `tenantId`, `role`, `managerId` | `tests/mass-assignment.test.ts` | NOT_STARTED | - |
| `SEC-004` | Directive §17 | Object authorization red team: foreign tenant object ID injection rejected | `tests/object-auth-red-team.test.ts` | NOT_STARTED | - |
| `SEC-005` | Directive §17 | Object authorization red team: foreign team object ID injection rejected | `tests/object-auth-red-team.test.ts` | NOT_STARTED | - |
| `SEC-006` | Directive §20 | Organization hierarchy invariants: cycle prevention & self-manager block | `tests/admin-org.test.ts` | NOT_STARTED | - |
| `SEC-007` | Directive §20 | Floor Manager scoped promotion rights vs Director absolute rights | `tests/floor-manager-administration.test.ts` | NOT_STARTED | - |
| `SEC-008` | Directive §13 | Demo seed password: must reject default fallback in production | `tests/seed-guard.test.ts` | IN_PROGRESS | TEL-P1-004 |
| `SEC-009` | Directive §27 | Security scan: formula injection in CSV/XLSX export/import | `tests/security-injection.test.ts` | NOT_STARTED | - |
| `SEC-010` | Directive §27 | Inbound email XSS sanitization and dangerous HTML stripping | `tests/inbox-sanitization.test.ts` | NOT_STARTED | - |

### Domain D: 6-Role Operational Matrix (ROLE)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `ROLE-001` | Directive §16 | Director: Full tenant visibility, deals, executive intelligence, user admin | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-002` | Directive §16 | Floor Manager: SDR workload allocation, team transfer, operational metrics | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-003` | Directive §16 | Team Lead: Pod member reviews, meeting approvals, lead validation | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-004` | Directive §16 | SDR: Assigned leads, personal sequences, booking links, meeting logging | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-005` | Directive §16 | Leadgen Manager: Pool management, researcher allocation, dedup rules | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-006` | Directive §16 | Leadgen: Sourcing pool submission, contact enrichment, account lookup | Browser E2E + API spec | NOT_STARTED | - |
| `ROLE-007` | Directive §15 | Leadgen visibility audit: verify lane-owned lead visibility rules | Product code + test audit | NOT_STARTED | - |

### Domain E: AI Reliability, Cost Governance & Gateway (AI)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `AI-001` | Directive §21 | Provider-neutral AI gateway with Groq -> Gemini failover | `tests/ai-gateway.test.ts` | NOT_STARTED | - |
| `AI-002` | Directive §22 | Structured output Zod runtime schema validation | `tests/ai-structured-output.test.ts` | NOT_STARTED | - |
| `AI-003` | Directive §23 | AI token usage recording and daily/monthly budget enforcement | `tests/ai-cost-attribution.test.ts` | NOT_STARTED | - |
| `AI-004` | Directive §24 | Circuit breaker half-open concurrency and multi-replica topology | `tests/ai-circuit-breaker.test.ts` | NOT_STARTED | - |
| `AI-005` | Directive §25 | AI provider configuration awareness (boolean reporting only) | `tests/ai-provider-smoke.test.ts` | NOT_STARTED | - |
| `AI-006` | Directive §21 | Domain service encapsulation: zero direct CRM table reads in AI tools | `tests/agent-object-authorization.test.ts` | NOT_STARTED | - |

### Domain F: Disaster Recovery, Backup & Restore (DR)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `DR-001` | Directive §28 | Backup creation and verification of dump file integrity | `docs/production-certification/BACKUP_RESTORE.md` | NOT_STARTED | - |
| `DR-002` | Directive §28 | Restore drill into isolated database with schema migration check | Restore drill log | NOT_STARTED | - |
| `DR-003` | Directive §29 | Rollback drill to previous immutable container image | Rollback drill log | NOT_STARTED | - |
| `DR-004` | Directive §33 | Failure matrix: database connection drop & graceful recovery | `docs/production-certification/FAILURE_MATRIX.md` | NOT_STARTED | - |
| `DR-005` | Directive §33 | Failure matrix: Redis disconnection & fallback queue behavior | `tests/redis-readiness.test.ts` | NOT_STARTED | - |

### Domain G: Release Identity & 3-Run Certification (REL)
| ID | Phase / Ref | Requirement | Verification Method | Status | Linked Defect |
|---|---|---|---|---|---|
| `REL-001` | Directive §30 | Immutable release chain: Source SHA -> Metadata SHA -> Image Digest | Release verification | IN_PROGRESS | TEL-P2-003 |
| `REL-002` | Directive §14 | Zero unexplained skipped tests in test suite | Test discipline audit | IN_PROGRESS | TEL-P2-001 |
| `REL-003` | Directive §28 | Certification Run 1: Full test ladder + static + build | Level 1-6 test execution | NOT_STARTED | - |
| `REL-004` | Directive §28 | Certification Run 2: Full test ladder + static + build | Level 1-6 test execution | NOT_STARTED | - |
| `REL-005` | Directive §28 | Certification Run 3: Full test ladder + static + build | Level 1-6 test execution | NOT_STARTED | - |
| `REL-006` | Directive §35 | Deployed web & worker digest health verification on production VM | Production smoke curl | NOT_STARTED | - |
