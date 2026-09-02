# ADR-023 - RBAC and Tenant Isolation

Status: Proposed for V2.CORE0 human review.

## Context

V2 is moving toward an enterprise SaaS foundation. Tenant boundaries and permission checks must be first-class backend invariants, not UI-only behavior. High-volume tables need direct tenant scope so authorization and query filters are reliable.

## Decision

High-volume V2 business tables must include direct `organizationId` unless a documented exception is approved.

Backend permission checks are mandatory. Hidden UI controls are not authorization. Organization membership alone does not grant every project, team, or privileged action.

Privileged actions must be audited.

V2 must not use dynamic joins to live V1 runtime tables for authorization.

## Rationale

Direct tenant scope improves query safety, authorization clarity, indexing, and future high-volume performance. Backend checks prevent accidental cross-tenant access even when UI routes or API calls are invoked directly.

## Scope

This ADR defines RBAC and tenant isolation invariants only. V2.CORE0 does not add schema, auth runtime, APIs, UI, or audit tables.

## Required invariants

- High-volume V2 business records require direct tenant scope.
- Backend code must enforce permissions on reads and writes.
- UI visibility is not a permission boundary.
- Project/team access must be checked where applicable.
- Privileged actions must be auditable.
- V2 auth must not dynamically depend on live V1 runtime tables.

## Explicit forbidden behavior

- Do not rely on sidebar/menu hiding as authorization.
- Do not assume org membership grants all project/team access.
- Do not query live V1 runtime tables as V2 auth source-of-truth.
- Do not create high-volume V2 tables without auditing whether direct `organizationId` is present.

## Future CORE1 schema implications

CORE1 should audit missing `organizationId` on V2 business tables and propose direct tenant scope where needed. CORE1 should also identify which privileged actions require audit fields/events in later phases.

## Runtime/API/UI implications for later phases

Every API route and worker mutation should receive tenant context and enforce permissions before data access. UI can mirror permissions for usability, but backend checks remain authoritative.

## Conflict notes with existing ADRs

ADR-011 V1 import/sunset remains compatible. V1 data can be imported manually, but V2 runtime authorization must not dynamically join live V1 runtime tables.

ADR-012 unified ingestion and ADR-021 async jobs must carry tenant scope through ingestion and job processing.

## Open questions

- Exact roles, project/team membership models, and audit event model are deferred to CORE1 planning and later auth/runtime phases.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or any V2 API/worker authorization implementation.
