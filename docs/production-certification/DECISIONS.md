# Telestar CRM — Master Architectural Decision Log

**Program**: Telestar Production Certification  

---

### DEC-001: Encapsulation of Object Authorization in Domain Services
- **Date**: 2026-08-19
- **Decision**: AI agent tools (`lib/ai/tools.ts`) must never query CRM tables directly (e.g. `prisma.lead`, `prisma.contact`). All lookups must delegate to domain services (`lib/contact-intelligence/service.ts`) to ensure single-authority multi-tenant scoping and avoid auth drift.

### DEC-002: Provider-Neutral AI Gateway Architecture
- **Date**: 2026-08-19
- **Decision**: All model generation passes through `lib/ai/gateway.ts` with circuit-breaker protection, token rate limit failover (Groq -> Gemini), and structured ledger recording (`AiCall`).

### DEC-003: Import Worker Batch Reconciliation & Concurrency
- **Date**: 2026-08-19
- **Decision**: The import worker processes chunks with explicit upsert collision handling and independent row error capture, eliminating long-running interactive transaction timeouts under high concurrency.

### DEC-004: Dependency PR Disposition for the Certification Lane
- **Date**: 2026-08-24
- **Decision**: All four open Dependabot PRs are **deferred to post-release**. None enters this
  release lane. They are recorded here so that "four open PRs" is not misread as four launch
  blockers.
- **Deciding fact**: `npm audit --audit-level=high` exits 0 with **0 vulnerabilities**. No open
  dependency PR closes a security finding, so the directive's first entry condition — "it fixes
  a current blocker/security requirement" — is not met by any of them.

  | PR | Change | CI on the PR head | Class | Why |
  |---|---|---|---|---|
  | #57 | `typescript` 5.9.3 → **7.0.2** | `Lint · types · tests` FAILURE | `MAJOR_UPGRADE_DEFER` | Major compiler upgrade with the type gate already red. A TypeScript major re-types the entire surface; that is post-release work. |
  | #58 | `@prisma/client` 6.2.1 → **7.9.1** | 4 jobs FAILURE incl. Migration validation, Docker build | `MAJOR_UPGRADE_DEFER` | Major ORM upgrade touching the data layer and migrations. The blast radius is the database; nothing here justifies taking it during a release freeze. |
  | #92 | `@types/nodemailer` 8.0.0 → 8.0.1 | all SUCCESS, MERGEABLE/CLEAN | `SAFE_PATCH_BUT_DEFER` | The only fully green one. Dev-only type patch fixing nothing we are hitting. Merging it moves the candidate SHA and costs a full re-freeze and three fresh ladder runs — the release risk of taking it exceeds the risk of deferring it. |
  | #93 | `tsx` 4.23.7 → 4.23.12 | `Lint · types · tests` FAILURE, Dependency review FAILURE, CodeQL FAILURE, Playwright CANCELLED | `SAFE_PATCH_BUT_DEFER` | Patch bump, but red on a mandatory gate. `tsx` is how the agent CLI and every certification script execute, so this one is not cosmetic and needs its own investigation post-release rather than a merge. |

- **Also noted**: every one of these branches predates current `main` (created 2026-08-09 and
  2026-08-16), so the CI results above were produced against an older tree and do not describe
  how the change behaves on the candidate. Per the repository-governance step, these should be
  **recreated or rebased from post-release main** rather than merged from stale history.
- **Reversal condition**: if `npm audit --audit-level=high` later reports a high or critical
  advisory that one of these PRs closes, that PR becomes `REQUIRED_FOR_RELEASE`, and taking it
  invalidates the candidate and restarts certification at run 1. That is the intended cost.
