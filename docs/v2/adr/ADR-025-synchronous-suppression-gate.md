# ADR-025 - Synchronous Suppression Gate

Status: Proposed for V2.CORE0 human review.

## Context

Real email/outreach sends must be blocked when a recipient is unsubscribed, bounced, blacklisted, manually suppressed, tenant-suppressed, or globally suppressed. This check must happen at the last safe moment because recipient and rendered content can change during preparation.

## Decision

Every real email/outreach send must perform an authoritative synchronous suppression check immediately before the provider API call.

Suppression sources include:

```txt
unsubscribe
bounce
blacklist
manual
tenant-level
global
```

Dry-run performs a read-only preview/check and never calls the provider.

Every real send must store `suppressionResultJson` or an equivalent final decision snapshot.

The suppression check happens after variable render and final recipient resolution, but before the provider call.

## Rationale

Send safety cannot rely on stale precomputed state. A final synchronous gate prevents accidental sends and creates an auditable decision trail.

## Scope

This ADR defines send-safety invariants only. V2.CORE0 does not implement suppression schema, provider calls, send APIs, queues, or UI.

## Required invariants

- Real sends must check suppression synchronously immediately before provider call.
- If blocked, no provider call is made.
- Dry-run is read-only and does not send.
- The final suppression decision snapshot is stored on every real send attempt.
- The check uses the final recipient after variable/render resolution.

## Explicit forbidden behavior

- Do not send first and check suppression later.
- Do not rely only on cached UI state for send permission.
- Do not call provider APIs during dry-run.
- Do not omit the final suppression decision snapshot from real send records.

## Future CORE1 schema implications

CORE1 should plan `V2SuppressionEntry` or equivalent, plus send snapshot fields such as final recipient, suppression decision/result JSON, source categories, and checked-at timestamp.

## Runtime/API/UI implications for later phases

SEND1 and sequence execution must call the suppression gate immediately before provider sends. UI should display dry-run suppression preview but must not treat it as final authorization for a later real send.

## Conflict notes with existing ADRs

ADR-017 dry-run before real send remains compatible. This ADR adds the non-negotiable final check required for real sends.

ADR-022 soft delete protects suppression evidence from casual deletion.

ADR-024 webhook idempotency handles inbound provider events after sends.

## Open questions

- Exact suppression precedence and global/tenant override policy are deferred to outreach infrastructure planning.

## Human review gate

Human review must approve this ADR before real send schema, provider integration, or sequence execution implementation.
