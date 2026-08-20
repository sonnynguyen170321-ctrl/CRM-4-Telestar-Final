---
id: ADR-0003
title: Capability authorization is not object authorization
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0003 — AI tool authorization

## Context

Telestar AI can call CRM tools — create a task, read a lead, draft a reply. Two different
questions have to be answered before a tool runs:

1. May the agent use this *kind* of tool at all, at the tenant's configured autonomy?
2. May this *user* act on this *record*?

They look similar enough to answer in one place, and answering them in one place is the
mistake.

## Decision

**Capability authorization** lives in `lib/agent/authorization.ts` and returns `ALLOW` /
`REQUIRE_USER_APPROVAL` / `REQUIRE_MANAGER_APPROVAL` / `DENY`.

**Object authorization** — tenant, `canAccessLead`, `canAccessUser`, pod hierarchy, campaign
scope, send-window permission — stays in the CRM domain services and is **never reproduced in
the agent layer**.

The separation is structural, not conventional: `CapabilityDecision` carries no record id, and
`decideCapability` takes no record argument. The agent layer cannot express an object decision
even by accident.

Permanent rules: CRM authorization runs independently of agent autonomy; autonomy may restrict
existing authority but never widen it; the capability ceiling is not tenant-overridable;
`prospect_reply` is `human_only` at every setting; an unregistered tool fails closed; missing
authorization context fails closed; a blocked action is never reported as if it succeeded.

## Why

`tasks = auto` means "may create tasks at all". It does not mean "may act on this lead". A
single merged check would have to carry a record id into the agent layer, and once it does,
the agent layer owns a copy of the pod-scoping rules — which then drifts from the copy in the
domain services, silently, in the direction of permissiveness.

No agent tool holds a Prisma client for the same reason: every mutation goes through a service
that already enforces tenancy, permissions and audit.

## Alternatives

- **One merged authorization call.** Rejected: duplicates object rules into a second place.
- **Trust the model to respect scope.** Rejected: model output is a request, not a decision.

## Consequences

- Nothing under `lib/ai/` may read a CRM table directly — which is why briefing queries live in `lib/briefing/service.ts`, not `lib/ai/`.
- Adding a tool means adding a domain service method, not a Prisma call.

## Protection

- `tests/agent-object-authorization.test.ts` — asserts both halves, including a source scan for direct `prisma.<model>` access under `lib/ai/`
- `tests/object-auth-red-team.test.ts`
- `tests/agent-capability-autonomy.test.ts`
