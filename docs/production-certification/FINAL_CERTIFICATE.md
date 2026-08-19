# Telestar CRM — Production Readiness Final Certificate

**Certificate Status**: INVALIDATED — FINAL EVIDENCE RECONCILIATION IN PROGRESS
**Program**: Advanced Autonomous Zero-Assumption Production Readiness Program
**Previously Claimed Release Tag**: `telestar-internal-rc-2026-08-20`
**Previously Claimed Candidate Source SHA**: `a6d8c0dfa4800fc158f5a6717d94211b595f4531`
**Invalidated At**: 2026-08-20T09:00:00+07:00
**Current Verdict**: **NO-GO — BLOCKERS REMAIN**

> This file is no longer hand-authored. Once `scripts/certification/generate-certificate.mjs`
> exists and `npm run certify:validate` passes, this document is **generated** from the
> evidence manifest under `docs/production-certification/evidence/`. Until then it stands as
> the invalidation record.

---

## 1. Why This Certificate Was Invalidated

The prior revision of this file (git history: commit `317d08d`) declared
`ISSUED & APPROVED`, `108/108 VERIFIED`, `0 open defects`. That declaration was **stronger
than the evidence that exists in this repository**.

The invalidation is not a request for "more testing". It is a correction of claims whose
supporting evidence is absent, contradictory, or fabricated.

| # | Invalidating finding | Verified how |
|---|---|---|
| A | The three "full" certification runs were not full certification runs — `RUN_1/2/3.md` record only TypeScript, ESLint, migration order, and Vitest. No Playwright, no Docker, no build, no deploy, no health, no queue load. | `docs/production-certification/runs/RUN_1.md` §1 lists exactly 4 gates |
| B | Redis integration was **skipped** in all three runs while the certificate claims "Real Redis". | `RUN_1.md` §2: "Skipped (External Service Integration): 1 file / 5 tests (Redis remote integration skipped in local env)" |
| C | Six-role **Playwright browser** evidence does not exist. Database/service role tests were substituted for it. | No `ROLE_BROWSER_EVIDENCE.md`; `TEL-P2-008` cites `tests/role-journeys.test.ts` only |
| D | Deployment / image / web / worker digest chain is entirely missing. No `CI_RUN_ID`, `IMAGE_DIGEST`, `WEB_DIGEST`, `WORKER_DIGEST`, `HEALTH_SHA`. | No `DEPLOYMENT.md` exists in this directory |
| E | Disaster-recovery evidence contains an **invalid backup checksum**. `BACKUP_RESTORE.md` documents a 48.2 MB dump whose SHA-256 is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — the SHA-256 of a **zero-byte** input. A 48.2 MB file cannot have that digest. | `BACKUP_RESTORE.md` §3 |
| F | The documented restore procedure invokes `scripts/verify-db-integrity.ts`, which **does not exist** at the certified candidate. | `BACKUP_RESTORE.md` §3 step 4; `ls scripts/verify-db-integrity.ts` → not found |
| G | `EVIDENCE.md` still references candidate SHA `cf23182` and test totals `149 files / 1,880 tests`, contradicting the certificate's `a6d8c0d` and `154 files / 1,922 tests`. | `EVIDENCE.md` header + EVID-005 |
| H | `LOAD_TEST.md` and `FINAL_CERTIFICATE.md` reported **different** 1,000-row results: `26.11s / 38.3 rows/s / p95 1423ms` vs `19.71s / 50.75 rows/s / p95 950ms`. | `LOAD_TEST.md` §1 vs prior certificate §2 Level 7 |
| I | AI budget governance and circuit state are **process-local** (in-memory `Map`/`Set`), so they are neither durable across restart nor shared across replicas. Claiming a tenant hard budget on that basis is unsupported. | `lib/ai/budget.ts`, `lib/ai/circuitBreaker.ts` |
| J | AI **streaming** does not carry the same budget reservation, timeout, usage reconciliation, attribution, and cancellation accounting as non-stream generation. | `lib/ai/gateway.ts` `stream()` |
| K | Model **capability requirements** (`requiresTools`, `requiresVision`, `requiresStructuredOutput`) are not strictly enforced by routing or by fallback selection. | `lib/ai/router.ts` |

Each finding above is registered as an active defect in
[DEFECTS.md](DEFECTS.md) — `TEL-P0-001`, `TEL-P1-014` … `TEL-P2-017`.

---

## 2. What Remains Valid

The invalidation targets **claims**, not the engineering. The following prior work is
retained and is **not** to be discarded or rebuilt:

- Import partial-write / crash convergence and idempotency fixes (`workers/import.ts`).
- 120-row import contention stress test (`tests/import-race-stress.test.ts`).
- Demo tenant live-email transport barrier (`workers/email.ts`).
- Production seed password guard (`prisma/seed.ts`).
- CSV formula-injection and HTML/email sanitisation guards.
- RLS bypass inventory and object-authorization test corpus.
- Database/service-level six-role journey tests and the golden journey test.
- The direct-handler import benchmark (reclassified as `IMPORT_HANDLER_BENCHMARK`).

These remain valid **evidence inputs**. They were never sufficient as
**substitutes** for the browser, queue, Redis, deployment, and DR evidence claimed above.

---

## 3. Path Back To A Certificate

A certificate may only be re-issued by
`npm run certify:generate`, and only after `npm run certify:validate` exits `0`.
The generator computes eligibility; it is not asserted by hand.

Gate conditions are defined in [PROTOCOL.md](PROTOCOL.md) §Pre-Deployment GO Gate.

---

## 4. Certificate History

| Revision | Status | Candidate SHA | Note |
|---|---|---|---|
| `317d08d` (2026-08-20T00:05+07:00) | ISSUED & APPROVED | `a6d8c0d` | **Rescinded.** Claims exceeded evidence — see §1. |
| current | INVALIDATED — RECONCILIATION IN PROGRESS | *(candidate re-freeze pending)* | Verdict: NO-GO |
