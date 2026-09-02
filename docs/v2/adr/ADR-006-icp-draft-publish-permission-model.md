# ADR-006 - ICP Draft / Publish Permission Model

Status: Accepted / Canonical

## Precedence

This canonical ADR supersedes or takes precedence over `docs/v2/adr/ADR-006-icp-publish-permission.md` if there is any conflict. The older shorter ADR is retained as historical/summary context only.

## Context

ICP rules are project-specific scoring policy. SDRs need stable, published ICPs for daily review and qualification work, while team leads and managers need a way to draft and revise ICPs without changing already-published scoring expectations.

V2 uses a product tree where `V2ICPProfile` groups ICP intent and `V2ICPVersion` captures a versioned rules snapshot. `V2ICPVersion` is immutable once published.

The intended permission model is:

- SDRs may use published ICPs only.
- Team Lead / Lead Gen Lead can draft and edit ICPs.
- Manager, Admin, or CEO approves and publishes ICPs.
- Published ICP versions remain immutable.

## Decision

Use a draft/published lifecycle for ICP versions.

V2.6 schema may include lightweight publish state fields needed to represent the lifecycle. Runtime permission enforcement is deferred to a later API/RBAC phase.

## V2.6 schema implications

- Product tree models belong to `V2Organization` through `organizationId`.
- Use `V2ICPProfile` and `V2ICPVersion` naming, with `ICP` capitalized.
- `V2ICPVersion` should support status/lifecycle fields.
- `V2ICPVersion` may include `rulesJson Json?` as a schema container only.
- Possible V2.6 schema fields include:
  - `status`
  - `versionNumber`
  - `rulesJson Json?`
  - `publishedAt DateTime?`
  - `publishedByUserId String?`
- Do not create a runtime approval workflow in V2.6.

## Consequences

- Published ICP rules can be safely referenced by future scoring snapshots.
- Draft ICP work can exist without affecting SDR-facing qualification.
- Future API/RBAC work must enforce the role model, but V2.6 only represents the schema state.
- Old published versions remain available for historical assessment interpretation.

## Explicit non-goals

- No API or UI.
- No runtime permission enforcement.
- No LeadAssignment.
- No scoring persistence.
- No ingestion.
- No V1 import or backfill.

## Related files/specs

- `docs/V2_FINAL_EXECUTION_PLAN_V7.md`
- `docs/v2/architecture/V2_PHASE_ROADMAP.md`
- `docs/v2/architecture/V2_PRODUCT_TREE.md`
- `docs/v2/adr/ADR-006-icp-publish-permission.md`
- `docs/v2/migration/V2_LOCAL_FIRST_MIGRATION_STRATEGY.md`

## Verification / phase dependency notes

- V2.6 schema must not add runtime enforcement.
- V2.6 schema must not create `V2LeadAssignment`.
- V2.6 schema must not create scoring persistence models.
- Implementation must update `docs/v2/codex/SESSION_LOG.md`.
