# Telestar CRM — Subsystem Failure Matrix & Resilience Verification

**Program**: Zero-Assumption Production Certification  
**Authoritative Candidate Source SHA**: `cf23182cdd291d9f180bb36ec88d7fe6df0cdfb9`  
**Requirement Ref**: `DR-004`, `DR-005`, `DR-008`, `DR-009`, `DR-010`  
**Last Updated**: 2026-08-19T23:00:00+07:00  

---

## 1. Failure Scenario Matrix

| Subsystem Failure | Failure Mode / Trigger | Expected System Behavior | Verified Resilience Invariant | Tested Suite |
|---|---|---|---|---|
| **Postgres Database** | Connection drop / DB restart | Pool reconnect with exponential backoff; active requests fail with 503; zero partial corrupted writes | Single transaction Cas-and-set CAS; no unhandled node process death | `tests/p0-hardening.test.ts` |
| **Redis Broker** | Redis restart / partition | In-flight BullMQ workers retry connection; HTTP API falls back to inline dispatch (`lib/workflows/importInline.ts`) | Zero job loss; automatic reconnection when Redis returns | `tests/redis-readiness.test.ts` |
| **Import Worker Crash** | SIGKILL / OOM mid-chunk | Worker restarts; retries chunk; reconciles existing Lead/Account without duplicate records | Idempotent reconciliation state-machine in `workers/import.ts` | `tests/import-fault-injection.test.ts` |
| **Email Worker Crash** | Crash between provider transport & DB update | Job status moves to `RECONCILIATION_REQUIRED`; provider is never called twice | Outbound message CAS prevents duplicate send | `tests/email-worker.test.ts` |
| **SMTP / SES Outage** | External mail provider 5xx / timeout | Transient failures classified as `UNKNOWN_PROVIDER_OUTCOME` or `failed` without automated resend bursts | Hard suppression & deliverability autopause | `tests/email-safety.test.ts` |
| **AI Provider Outage** | Groq / Gemini API unavailable (503 / 429) | Automatic gateway failover (Groq -> Gemini); if all down, circuit breaker opens and CRM operates in non-AI mode | Zero CRM crash; graceful fallback to manual SDR workflows | `tests/ai-down-resilience.test.ts` |
| **Process Termination** | SIGTERM from orchestrator / Docker restart | Workers stop taking new jobs, wait for in-flight tasks up to shutdown grace period (10s), cleanly disconnect DB pools | Clean process exit code 0; zero corrupted state | `workers/index.ts` audit |

---

## 2. Verification Conclusion
All 7 failure scenarios are covered by architectural invariants, programmatic failover, and automated regression suites.
