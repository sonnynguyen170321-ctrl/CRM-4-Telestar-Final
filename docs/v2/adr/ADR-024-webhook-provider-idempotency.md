# ADR-024 - Webhook Provider Idempotency

Status: Proposed for V2.CORE0 human review.

## Context

Email and outreach providers can deliver duplicate, delayed, or out-of-order webhook events. V2 must not double-apply events or corrupt send/contact/activity state.

## Decision

Provider webhook handling must use provider-scoped idempotency.

Future email event/provider storage should enforce uniqueness on:

```txt
provider + providerEventId
```

or an equivalent provider-scoped event identity.

Raw provider payload snapshots should be stored for audit/debugging. Duplicate events must not double-apply state. Out-of-order events must be tolerated.

## Rationale

Provider event IDs are only meaningful within a provider. Provider-scoped uniqueness prevents collisions while allowing safe replay, debugging, and retry.

## Scope

This ADR defines webhook invariants only. V2.CORE0 does not create webhook routes, provider calls, schema, workers, or payload processing.

## Required invariants

- Webhook event identity is provider-scoped.
- Duplicate provider events are ignored or recorded without double state transition.
- Raw payload snapshots are preserved where allowed.
- Out-of-order events are handled without corrupting canonical state.
- Webhook processing must be tenant-safe once provider accounts are tenant-scoped.

## Explicit forbidden behavior

- Do not create webhook routes in CORE0.
- Do not call providers in CORE0.
- Do not apply duplicate provider events twice.
- Do not assume global uniqueness of `providerEventId` without provider scope.
- Do not discard raw payloads needed for audit/debugging unless a later privacy rule requires it.

## Future CORE1 schema implications

CORE1 may reserve or plan event/provider models for later outreach phases. If modeled, event records should include provider, provider event ID, raw payload snapshot, processing status, tenant/provider-account scope, and timestamps.

## Runtime/API/UI implications for later phases

Webhook routes should be replay-safe and idempotent. UI should surface provider event history from stored event records rather than relying only on derived contact/send state.

## Conflict notes with existing ADRs

ADR-021 async job processing may handle webhook follow-up work, but webhook receipt itself must remain idempotent.

ADR-025 suppression gate controls outbound send safety; this ADR controls inbound provider event safety.

## Open questions

- Exact provider account model and event state machine are deferred to outreach infrastructure planning.

## Human review gate

Human review must approve this ADR before webhook schema, routes, provider integration, or email event runtime work.
