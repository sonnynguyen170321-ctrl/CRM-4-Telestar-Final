# Cutover open items — 2026-08-17

Everything that could not be finished from a developer workstation, why, and what closes it.
Ordered by what blocks the release, not by effort.

Nothing here is "done". Items in the second table are **declared exceptions** — open items that a
GO may be issued *around*, never items to record as completed.

Companion to [`CUTOVER_2026-08-17.md`](CUTOVER_2026-08-17.md) (runbook) and
[`CUTOVER_EVIDENCE_2026-08-17.md`](CUTOVER_EVIDENCE_2026-08-17.md) (evidence).

---

## A. Blockers — each is a mandatory NO-GO until closed

Run `npm run cutover:preflight` on the target once access exists; it mechanically checks A2, A4,
A5, A6, A7 and A9 and exits non-zero on any of them.

| # | Item | Why it is blocked | What closes it | Verify with |
|---|---|---|---|---|
| **A1** | **No deployment performed or inspected** | no SSH to `telestar-crm-vm`, no credentials | Phase 4 host audit; establish real state before changing anything | runbook Phase 4 command block |
| **A2** | **HTTPS unverified** | no reachable public URL | serve over TLS, confirm redirect, HSTS, Secure cookie | `cutover:preflight` (`https.*`) |
| **A3** | **No pre-cutover backup, no tested restore** | no Cloud SQL access | take snapshot, **restore it to a scratch instance**, record id + UTC timestamp | `CUTOVER_BACKUP_ID` + `CUTOVER_BACKUP_AT`, then `cutover:preflight` |
| **A4** | **No verified deploy or rollback command** | box's checkout resolves `IMAGE_TAG`; repo requires `CRM_IMAGE`. Last confirmed 2026-08-09 | update the checkout **and** swap `IMAGE_TAG`→`CRM_IMAGE` digest in one change, or keep the stale checkout and record deploys manually | `docker compose … config --images` dry run |
| **A5** | **Production migrations not applied** | no production database | `migrate status` → `migrate deploy` → `migrate status` | `cutover:preflight` (`db.migrations`) |
| **A6** | **No Telestar data migrated or reconciled** | source dataset never available to this session | build the transform against [`MIGRATION_INVENTORY_2026-08-17.md`](MIGRATION_INVENTORY_2026-08-17.md), rehearse on a clean DB, reconcile | `npm run check:relational-integrity` + the per-entity table |
| **A7** | **Demo credentials not rotated** | no deployed database | rotate or deactivate every demo persona; confirm `authVersion` moved | `cutover:preflight` (`creds.demo`) |
| **A8** | **No image digest, and CI has not run on the candidate** | branch not pushed; no Docker locally | push `release/internal-cutover-2026-08-17`, let CI + Docker Image build, capture the digest | `gh run list`, `docker buildx imagetools inspect` |
| **A9** | **Worker/queue never proven end to end** | no Redis in this environment | run the repaired healthcheck against the target | `npm run worker:healthcheck` — must print `completed` |
| **A10** | **`check:test-discipline --ci` cannot pass locally** | requires `REDIS_URL`; refuses to let a Redis-less env report a pass | must be green **in CI** on the release SHA | CI |
| **A11** | **Role smoke + golden journey not run on a deployment** | nothing deployed | runbook Phases 11–12, both directions per role | Playwright against the deployed `BASE_URL` |

### A4 is the one to do first

Until it closes there is no rollback, which means A3 cannot protect anything and no other item is
safely reversible.

---

## B. Declared exceptions — may accompany a GO, but stay open

| # | Item | Current state | Note |
|---|---|---|---|
| **B1** | CSP is report-only | unchanged | Enforcement is a separate browser-tested PR. Never record as enforcing. `cutover:preflight` reports it as a standing WARN. |
| **B2** | Redis durability unproven / possibly VM-local | unknown | If managed Redis is not introduced, record the limitation explicitly with autosend off, DB as source of truth, and a proven recovery procedure. Preflight checks `appendonly` and `maxmemory-policy=noeviction`. |
| **B3** | Live email autosend disabled | intended | `SEQUENCE_AUTOSEND_ENABLED=true` / `EMAIL_SEND_DRY_RUN=false` need a **separate** go-live decision after internal validation. |
| **B4** | External AI / email providers not exercised | not configured here | Out of scope for internal cutover. |
| **B5** | Sequence references scoped by tenant, not by visibility | shipped in `ff09dce` | `POST /api/leads/import` validates `sequenceId` against the caller's tenant but not their visible set. No `canReferenceSequence` exists and inventing one is new policy, not reuse. Decide deliberately, post-cutover. |

---

## C. Repository follow-ups — no release impact

| # | Item | Note |
|---|---|---|
| **C1** | PR #58 Prisma 7, PR #57 TypeScript 7 | Deliberately deferred. Post-cutover workstream, together, with a full gate run. |
| **C2** | PR #63 dev-environment unification | Partially landed (`.nvmrc`, `.gitattributes`, `.env.example`, `scripts/doctor.mjs` are on `main`); `scripts/with-env.mjs` and `docs/LOCAL_SETUP.example.md` are not. Currently conflicting — rebase or re-cut. |
| **C3** | `docs/PRODUCTION_SMOKE_TEST.md` still AWS-shaped | Corrected by banner, not rewritten. A proper rewrite against the GCP topology is worth doing once Phase 4 establishes what that topology actually is. |
| **C4** | `telestar2026` still printed in `docs/GCP_DEPLOY.md`, `docs/CLOUD_RUN_DEPLOY.md`, `docs/admin-control-center/STATUS.md` | The in-scope files were corrected. These three still show the refused command or the shared password as usable. |
| **C5** | Local dev database holds ~33,000 user rows | Test residue. It exceeds the preflight's exhaustive-password-check limit, which is why that check refused rather than sampled. Harmless, but worth pruning. |
| **C6** | `PlaybookProposalEvidence` has no `tenantId` | Inherits tenancy through its parent, so the injection layer does not filter it directly. Correct today; verify any new **direct** query on it scopes through the parent. |

---

## D. Environment limits of this session — not defects

Recorded so the next person does not re-derive them.

- No Docker → image build, digest verification and in-image checks impossible.
- No Redis → Phase 7, `redis-integration.test.ts` (the 5 skips), and `--ci` discipline impossible.
- No `.env.production` → `prod:check-env`, `prod:check-migrations`, `prod:audit` cannot run.
- `npm run <script>` shims break on this checkout path — the `&` in
  `C:\Users\admin\Desktop\Sonny & AI\…` sends `npx tsc` to `C:\Users\admin\Desktop\typescript\bin\tsc`.
  Call entry scripts through `node` directly. This is why `npm run worker:healthcheck` still fails
  **here** after the repair while `node node_modules/tsx/dist/cli.mjs scripts/worker-healthcheck.ts`
  works.
- `prisma generate` fails with `EPERM` on `query_engine-windows.dll.node` while a Next server
  holds it. Stop the server before building.
