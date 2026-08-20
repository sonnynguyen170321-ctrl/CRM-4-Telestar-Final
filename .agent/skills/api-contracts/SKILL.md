---
id: api-contracts
version: 1.0.0
domain: api-contracts
risk: R2
sources: [app/api/**, lib/api/**, lib/validation*.ts]
---

# API contracts

**LOAD WHEN** adding or changing a route handler, request validation, an error envelope, or
rate limiting.

**DO NOT LOAD WHEN** refactoring a service with no route-surface change.

169 API routes today (`.agent/generated/route-map.json`). Next.js App Router route handlers,
not Server Actions — the backend stays explicit and queryable.

## Core invariants

- **Validate at the boundary, with a schema.** Zod, parsed before use, and the parsed value is
  what the handler consumes.
- **Authorize before doing work** — including before enqueueing a job. Authorization after the
  job is queued is authorization after the fact.
- **A malformed request is a 4xx and never an AI or system failure.** Conflating them is how a
  validation bug hides behind "the service is down".
- **Errors do not leak internals.** No stack traces, no provider payloads, no credentials, no
  raw driver messages.
- **The response envelope is consistent** so a caller can distinguish success, failure and
  partial results without special-casing each route.

## Known failure modes

- **`.passthrough()` on a request schema.** It accepts keys nobody reviewed, and anything
  reaching a prompt or a query through it is input nobody audited. Zod's default is `.strip()`
  — the fix is usually to stop overriding it. This exact defect shipped in the chat route, with
  a comment three lines above claiming the safe behaviour.
- **Trusting client-supplied identity or counters.** Role, tenant, user id and any performance
  figure come from the session and the database. A number the browser sent is a number the
  browser chose.
- **Accepting a field nothing reads.** It looks like a wired feature and is a round trip to
  nowhere. If dropping the field would fail no test, the field is decorative.
- **An id format assumption.** A regex written for cuid v1 silently rejects UUIDs and every
  readable id — and the failure is a silent empty context, not an error.
- **Mass assignment.** Spreading a request body into an update lets a caller set fields the
  form never showed them.

## Required tests

```
tests/validation.test.ts        tests/security-injection.test.ts
tests/mass-assignment.test.ts   tests/csp.test.ts
tests/login-throttle.test.ts    tests/api-keys-and-integrations.test.ts
```

## Eval cases

- a client sets a field the UI never exposed → mass assignment, R3
- a valid request returns 500 for one role only → scope-shape mismatch, R2
- a bad payload is reported to the user as a service outage → error classification, R2
