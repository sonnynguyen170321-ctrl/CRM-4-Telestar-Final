# ADR-008: Variable Resolution Order

**Status:** Draft for review  
**Project:** Lead Gen Intelligence — TeleStar SDR OS V2

## Context

This ADR records a decision required before V2 implementation proceeds. It exists to prevent Codex or future agents from re-litigating or accidentally changing core product logic.

## Decision

Manual-send variables resolve from LeadAssignment context, then Contact, Company, Project, Account, fallback blanks.

## Consequences

- Future implementation must follow this decision unless a new ADR supersedes it.
- Any Codex prompt touching this area must cite this ADR.
- Divergence requires human approval.

## Implementation notes

- Keep V1 untouched.
- Prefer append-only history where this decision affects persisted data.
- Add tests/fixtures before runtime wiring when relevant.

## Open questions

- Human reviewer may add project-specific edge cases before marking this ADR accepted.
