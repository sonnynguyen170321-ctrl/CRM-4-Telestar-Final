# ADR-004 - Geography Rules Per ICP Version

Status: Accepted / Canonical

## Precedence

This canonical ADR supersedes or takes precedence over `docs/v2/adr/ADR-004-geography-per-icp.md` if there is any conflict. The older shorter ADR is retained as historical/summary context only.

## Context

Geography fit depends on ICP and project context. A company can be relevant for one client or project geography and irrelevant for another. Geography qualification must not become a global property of Company identity.

V2 keeps Company as reusable identity. Later LeadAssignment/scoring phases evaluate company and contact data against a selected Project and ICP Version.

## Decision

Geography rules belong to `V2ICPVersion`.

Company identity remains reusable and should not store one global geography qualification. LeadAssignment and scoring, implemented later, evaluate company/contact data against project plus ICP Version context.

## V2.6 schema implications

- `V2ICPVersion` may store geography rules inside `rulesJson Json?`.
- Prefer `rulesJson Json?` as a flexible MVP schema container.
- A dedicated geography config field should be added only if later docs explicitly support it.
- Every product tree model should include `organizationId` for tenant isolation.

## Consequences

- Geography rules can vary by ICP Version.
- Future deterministic scoring can snapshot the exact ICP Version used.
- V2 avoids a blended or global company geography score.
- Future feedback and review can be interpreted in the correct project/ICP context.

## Explicit non-goals

- No Company, Contact, or LeadAssignment schema in V2.6D.
- No scoring engine changes.
- No scoring persistence.
- No global company score.
- No import or backfill.

## Related files/specs

- `docs/V2_FINAL_EXECUTION_PLAN_V7.md`
- `docs/v2/architecture/V2_PHASE_ROADMAP.md`
- `docs/v2/architecture/V2_PRODUCT_TREE.md`
- `docs/v2/adr/ADR-004-geography-per-icp.md`
- `docs/v2/scoring/V2_ICP_VERSION_RULES_TYPE_SPEC.md`
- `docs/v2/migration/V2_LOCAL_FIRST_MIGRATION_STRATEGY.md`

## Verification / phase dependency notes

- V2.6 schema must not add global company scoring fields.
- V2.6 schema must not create `V2Company`, `V2Contact`, or `V2LeadAssignment`.
- Future scoring persistence must reference ICP Version context.
- Implementation must update `docs/v2/codex/SESSION_LOG.md`.
