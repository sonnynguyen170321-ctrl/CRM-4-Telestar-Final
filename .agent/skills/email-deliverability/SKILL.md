---
id: email-deliverability
version: 1.0.0
domain: email-deliverability
risk: R3
sources: [lib/deliverability/**, app/api/email-health/**]
---

# Deliverability and mailbox health

**LOAD WHEN** changing domain or mailbox health, bounce handling, warmup, sending reputation,
or send-quota policy.

**DO NOT LOAD WHEN** the question is *what* to send or *when* — that is `email-automation`.

## Core invariants

- **The deliverability preflight runs before quota reservation**, so a blocked send never
  burns a slot the tenant paid for.
- **A bounce is a state change, not a log line.** It suppresses, it updates health, and it can
  unenrol — writing only an activity row leaves the address in rotation.
- **Reputation is per sending identity**, not per tenant. Aggregating hides the one mailbox
  that is burning.
- **Health alerts are acknowledged and resolved by people**, and those attributions are
  history, not open work — deliberately excluded from transfer impact counts.

## Known failure modes

- **Soft and hard bounces treated alike.** Suppressing on a transient failure loses reachable
  prospects; not suppressing on a permanent one burns the domain.
- **Warmup ignored under load.** A ramp that respects quota but not warmup stage produces
  exactly the reputation collapse warmup exists to prevent.
- **Provider webhooks trusted without verification**, or processed non-idempotently — the same
  bounce delivered twice must not double-count.
- **Paused accounts silently resuming** because the pause was held in memory rather than in the
  database.

## Required tests

```
tests/email-health-scoring.test.ts   tests/email-health-access.test.ts
tests/email-health-p8.test.ts        tests/bounceDetection.test.ts
tests/webhooks-scoring.test.ts       tests/email-oauth.test.ts
```

## Eval cases

- reply rate collapses on one domain → per-identity reputation, R3
- a hard-bounced address keeps receiving sends → suppression on bounce, R3
- health score moves with no matching event → scoring inputs, R2
