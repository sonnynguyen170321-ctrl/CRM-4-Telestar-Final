# ADR-013 — Identity Resolution

Status: Patched / accepted for pilot defaults.

## Decision

Company canonical domain is unique per Organization by default. Non-generic contact email and LinkedIn profile are unique per Organization. Generic emails are weak evidence only.

Fuzzy name matching never auto-merges.

No-project-context imports do not create scored LeadAssignments.

## Consequences

- Stronger dedupe and suppression behavior.
- Parent/subsidiary/shared-domain ambiguity goes to manager review.
- Activity recap imports may produce more review items early, but avoid false links.
