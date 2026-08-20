---
classification: CURRENT_CANONICAL
version: 1.0.0
---

# Invariants

Properties that hold regardless of task. Deliberately short — a list nobody can hold in their
head is not an invariant list, it is a document.

Each carries **where it lives** and **what would catch a violation**. An invariant with no
protecting check is a hope; those are marked, because the gap is the useful information.

---

### 1. Every query is tenant-scoped

Multi-tenant data with no exception for convenience, background jobs or admin tooling.

- **Source:** `lib/prisma.ts` (client extension), `supabase/rls.sql`
- **Protected by:** `tests/tenant-*.test.ts`, `tests/rls-policy-coverage.test.ts`, `e2e/roles/tenant-isolation.spec.ts`
- **Escape hatch:** a bare `new PrismaClient()` opts out. `prisma/seed-demo.ts` does this deliberately and is guarded by `lib/seed-guard.ts`. Any other instance needs a reviewed reason.

### 2. The database is workflow truth; queues only execute

BullMQ state is never read as business truth, and every delayed job must be rebuildable from
the database.

- **Source:** `workers/**`, `lib/queue/**`
- **Protected by:** `tests/queue-reconciliation.test.ts`, `tests/bullmq.test.ts`
- **Why:** a queue that is also the record of intent cannot survive a Redis flush, and nothing in the UI would show that it had.

### 3. Every retryable write needs a stable idempotency key

Derived from durable ids, never from a timestamp or a random value.

- **Source:** `lib/sequences/**`, `lib/queue/**`
- **Protected by:** `tests/email-idempotency.test.ts`, `tests/sequence-execute.test.ts`, `tests/import-race-stress.test.ts`
- **Why:** a retry that duplicates a send or a task is a data-integrity defect, not a nuisance. A prospect cannot be un-emailed.

### 4. Email counts as sent only on provider confirmation

Never write an `email_sent` activity from intent.

- **Source:** `lib/email/**`, `OutboundMessage`
- **Protected by:** `tests/email-safety.test.ts`, `tests/demo-email-barrier.test.ts`, `tests/unsubscribe.test.ts`

### 5. Only one module computes a schedule

`lib/automation/scheduling.ts`. Not a component, not a worker, not the preview endpoint — the
preview calls the same function server-side precisely so it cannot drift from the worker.

- **Protected by:** `tests/scheduling.test.ts`, `tests/defer-scheduling.test.ts`, `tests/weekend-policy.test.ts`
- **Corollary:** jitter and A/B selection are seeded from `tenantId + sequenceId + stepId + leadId`, never `Math.random()`. This is why the builder reconciles steps by id instead of delete-and-recreate.

### 6. AI never bypasses application authorization

Model output is a request. Domain services decide. Capability authorization ("may create tasks
at all") is not object authorization ("may act on this lead").

- **Source:** `lib/agent/authorization.ts`, the domain services
- **Protected by:** `tests/agent-object-authorization.test.ts`, `tests/object-auth-red-team.test.ts`
- **Corollary:** nothing under `lib/ai/` reads a CRM table directly, and no agent tool holds a Prisma client.

### 7. There is one path to a model

`lib/ai/gateway.ts`. Nothing else constructs a provider SDK client.

- **Protected by:** `tests/ai-provider-client-containment.test.ts`
- **Why:** three paths existed once, disagreed about which provider to try and what counted as a failure worth failing over, and every chat message in production returned "Sorry, I ran into a problem generating that."

### 8. A registered model always prices

A model whose rate will not resolve raises `PricingConfigurationError`. Never `$0`.

- **Source:** `lib/ai/pricing.ts`, `lib/ai/registry.ts`
- **Protected by:** `tests/ai-pricing-contract.test.ts`
- **Why:** zero against real tokens reads as a free call and walks straight through the tenant's spend cap.

### 9. AI down must never mean CRM down

- **Protected by:** `tests/ai-optional.test.ts`, `tests/ai-down-resilience.test.ts`

### 10. Releases have immutable identity

Build from the merge SHA; deploy by digest or exact SHA. `latest` is a convenience, never
evidence of what is running.

- **Source:** `.github/workflows/docker-image.yml`
- **Protected by:** `tests/release.test.ts`

### 11. Certification verdicts are generated from evidence

The generator owns the verdict. Hand-editing generated output fabricates evidence.

- **Source:** `scripts/certification/**`
- **Protected by:** `tests/certification-validator.test.ts`

### 12. Removing someone runs an impact check first

Removing a campaign member or deactivating a user returns **409** unless the caller names a
handling mode and a reason.

- **Source:** `lib/admin/campaignMembers.ts` — both routes delegate to it, so it cannot be bypassed
- **Protected by:** `tests/admin-impact.test.ts`

### 13. Evidence belongs to its candidate SHA

A later edit to any runtime, test or configuration file voids it.

- **Protected by:** *nothing yet* — phase 6 records the candidate SHA alongside collected evidence.

### 14. The kernel does not grow

A correction is routed to a check, a test, a scoped rule or a skill — never appended to
`AGENTS.md`.

- **Protected by:** *nothing yet* — phase 4 adds `agent context-audit`, phase 6 makes it a gate.
- **Why:** this already failed once. `CLAUDE.md` reached 30 KB by accumulating corrections of its own stale claims, and every session paid for every past mistake.

---

## Adding one

An invariant earns its place by being **violable** and **expensive**. If nothing could
plausibly break it, it is a description, not an invariant. If breaking it is cheap to detect
and cheap to fix, it belongs in a skill.

Name the source. Name the check. If there is no check, say so — the gap is worth more than a
false sense of coverage.
