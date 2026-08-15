# Cutover evidence — 2026-08-17

Companion to [`CUTOVER_2026-08-17.md`](CUTOVER_2026-08-17.md). That file says what to do; this
one records what actually happened, with the command, its **own** exit code, and the decisive
output.

> **No gate below was read from a pipe.** `tsc --noEmit | tail` reports `tail`'s exit code, and a
> full session of "green" gates once hid a real type error that way. Every exit code here was
> captured from the tool itself.

## Execution boundary — read before using this document

| | |
| --- | --- |
| Where | developer workstation, Windows 10, `C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main` |
| Available | Node 24.16.0, npm, `gh` 2.97.0, git, PostgreSQL 16 (`postgresql-x64-16`, running) |
| **Not available** | **Docker**, **Redis**, `.env.production`, deployment credentials, SSH to `telestar-crm-vm`, Cloud SQL, any public URL, the Telestar source dataset |

Phases 4–7 and 9–14 are `NOT EXECUTED`. They are procedures in the runbook, not results. Nothing
in this file should be read as evidence about the deployed environment.

---

## Phase 0 — Freeze and truth

| Item | Value |
| --- | --- |
| Repository | `sonnynguyen170321-ctrl/CRM-4-Telestar-Final` |
| Expected base | `1bb033648d0c099df694e3f2e7b852f13df6212a` |
| **Actual `origin/main` after re-fetch** | `1bb033648d0c099df694e3f2e7b852f13df6212a` — **unchanged**, zero commits since |
| Release branch | `release/internal-cutover-2026-08-17`, cut from `origin/main` |
| Working checkout at session start | `all-green/wave-3-feature-security` — **34 behind main, 1 ahead**; not used as the base |

`docs/ALL_GREEN_ACCEPTANCE_MATRIX.md` was staged in that stale checkout. Its blob hash is
identical to `origin/main`'s (`fa007b538ecbe1805dd0b551cc2c49230357280d`), so it was dropped
rather than carried — main's copy is the same file.

### Inventory

| | |
| --- | --- |
| Open PRs at start | #63 dev-environment (`DIRTY`), #58 Prisma 7, #57 TypeScript 7, #44 create-user sessions |
| Open issues | none |
| Latest CI on `main` | `CI` success · `Docker Image` success (run 31898428338, 2026-08-15T17:29Z) |
| Migrations | 46 |
| Prisma models | 62 (60 carry `tenantId`) |
| Deploy assets present in repo | `Dockerfile`, `docker-compose.yml`, `docker-compose.build.yml`, `scripts/deploy.sh`, `scripts/rollback.sh`, `scripts/post-deploy-smoke.sh` |
| Live host state | **NOT INSPECTED** — no access |

### Commits in the candidate

| SHA | Origin |
| --- | --- |
| `fb6f40a` | cherry-picked `c352469` — sidebar role during session load; dead font origins out of CSP |
| `15d0885` | Phase 1B — report-preview reference validation |
| `ff09dce` | Phase 1A — import campaign reference validation |

---

## Phase 1 — Request-reference gaps

Both were closed red-green: the test was written against unmodified code, observed to fail, then
the route was changed. Pre-fix behaviour below is **measured**, not inferred.

### 1A · `POST /api/leads/import`

Caller: ordinary SDR in tenant A (`canImportExport` admits `sdr` upward).

| Case | Before | After |
| --- | --- | --- |
| campaign in another tenant | **202 queued, `ImportBatch` created** | 404, zero writes |
| in-tenant campaign the caller cannot see | **202 queued, `ImportBatch` created** | 403, zero writes |
| campaign does not exist | **500 `Database error`** (raw FK failure) | 404, zero writes |
| no campaign on a lead import | 400 | 400 (unchanged) |
| caller's own campaign | 202 | 202, batch filed under that campaign |
| pool import, no campaign required | accepted | accepted (unaffected) |

The cross-tenant case is the serious one: `Campaign` ids are unique globally, so the foreign key
was satisfied and an `ImportBatch` owned by tenant A pointed at tenant B's campaign, with leads
stamped to match.

Fix: `canReferenceCampaign` inside `validateContext`, which runs before `requireTenantId`, before
the dry-run branch, before the queue probe, and before any row is written. `sequenceId` scoped
explicitly to the caller's tenant in the same pass. `assignedToId` already went through
`canAccessUser` and is unchanged.

```
node node_modules/vitest/vitest.mjs run tests/lead-import-reference-integrity.test.ts
  pre-fix : 3 failed | 4 passed (7)   exit 1
  post-fix: 7 passed (7)              exit 0
```

### 1B · `POST /api/client-reports/preview`

| Case | Before | After |
| --- | --- | --- |
| client in another tenant | **200 + that tenant's client name and metrics** | 404 |
| campaign in another tenant | **200 + foreign campaign in the snapshot** | 404 |
| in-tenant client the caller cannot see | **200 + its metrics** | 403 |
| in-tenant campaign the caller cannot see | **200** | 403 |
| client does not exist | **500** | 404 |
| campaign does not exist | **200** | 404 |
| campaign belongs to a different client | **200, incoherent snapshot** | 422 |
| `leadgen` — a role the create route refuses | **200 + full metrics** | 403 |
| caller's own client | 200 | 200 |

Persisting nothing was not a mitigation: the response body is the disclosure, because
`buildReportMetrics` computes real aggregates over whichever client was named.

```
node node_modules/vitest/vitest.mjs run tests/client-report-preview-reference-integrity.test.ts
  pre-fix : 8 failed | 1 passed (9)   exit 1
  post-fix: 9 passed (9)              exit 0
```

Both suites drive the real route handler against real PostgreSQL, assert the **response body**
(not just status), assert zero durable writes on refusal, and assert their own fixture tenancy
first — `applyScopedTenant` makes the context tenant win over `data.tenantId`, so a "tenant B" row
built under tenant-A context is silently tenant A and the file would prove nothing. The harness
runs `bypassRls: true` deliberately, matching the existing sibling suite: it strips ambient
scoping so what is proven is the route defending itself.

### One regression found and resolved

`tests/admin.test.ts:436` expected 202 from an import by a **floor manager** into a campaign with
**no `CampaignSdr` rows**, and began returning 403.

The implementation is correct and the fixture was stale. `getVisibleCampaignIds` returns
unrestricted (`null`) only for **director** and **leadgen manager**; every other role resolves to
the campaigns its visible users are assigned to. `POST /api/leads` has enforced exactly this
through `canReferenceCampaign` for some time — a floor manager could not create a single lead in
that campaign either. Import was the outlier among five reference surfaces
(`/api/leads`, `/api/booking-links`, `/api/booking-links/[id]`, `/api/client-reports`,
`/api/work-orders`). The fixture gained the membership row it was missing; the check was not
weakened. **15/15** after.

> **Operational consequence, announced in the runbook:** create campaign → assign at least one
> member → then import. An import into a member-less campaign is now 403 for every role except
> director and leadgen manager.

---

## Phase 2 — Repository gates

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Lint | `node node_modules/eslint/bin/eslint.js app components lib context tests workers scripts e2e` | **0** | 0 errors |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | **0** | 0 errors, 0 output lines |
| Vitest (full) | `node node_modules/vitest/vitest.mjs run` | **0** | **1696 passed · 5 skipped · 0 failed** (122 files passed, 1 skipped) |
| Build | `node scripts/build.cjs` | **0** | compiled 49s, TypeScript 57s, all routes emitted |
| Migration order | `node scripts/check-migration-order.mjs` | **0** | 46 migrations, no new migrations |
| Migration replay from empty | `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url … --exit-code` | **0** | **No difference detected** |
| Relational integrity | `node node_modules/tsx/dist/cli.mjs scripts/check-relational-integrity.ts` | **0** | No inconsistent references found |
| RLS verification | `node scripts/verify-rls.mjs` | **0** | All checks passed — PostgreSQL enforces tenant isolation |
| Playwright `audit` | `node node_modules/@playwright/test/cli.js test --project=audit` | **0** | **176 passed** in 3.1m — matches the reviewed baseline of 176/176 |
| **Test discipline** | `node scripts/check-test-discipline.mjs --ci` | **1** | **blocked on `REDIS_URL`** — see below |
| `prod:check-env` | `scripts/prod-check-env.ts` | **1** | `FAIL: .env.production not found` — not executable here |
| `prod:check-migrations` / `prod:audit` | — | — | **NOT EXECUTED** — same reason |
| Docker image build | — | — | **NOT EXECUTED** — Docker not installed |
| In-image operational commands | — | — | **NOT EXECUTED** — same |
| CodeQL / secret scan | — | — | **NOT EXECUTED locally**; both run in CI, green on `main` |

### Skipped tests — accounted for

**5 skipped, matching the reviewed baseline of 5 exactly.** All of
`tests/redis-integration.test.ts`, the only real-Redis coverage in the repository, gated on
`REDIS_URL`. No other suite skipped. A different count would require investigation; this one does
not.

### Test discipline is a legitimate FAIL here, not a code defect

`--ci` refuses to run when `DATABASE_URL` or `REDIS_URL` is unset, precisely so a broken
environment cannot report a pass. With `DATABASE_URL` exported it advances and blocks solely on:

```
REDIS_URL — tests/redis-integration.test.ts is the only real-Redis coverage in the repository.
```

The gate is working as designed. It cannot be satisfied on this machine. **CI satisfies it**, and
CI is green on `main`. It must be green on the release SHA before deployment.

### Build required stopping a running server

`prisma generate` failed with `EPERM … query_engine-windows.dll.node` — the documented Windows
trap. `next start -p 3000` (PID 13952) held the DLL. Stopped with the operator's agreement, build
run (exit 0), server restarted and confirmed serving `HTTP 200` on `/login`.

### Playwright required a run-scoped password

The first attempt failed with `9 failed, 167 did not run` — every persona rejected by
`e2e/support/fixture.ts:67`:

```
Error: E2E_PASSWORD is the published demo password. Use a run-scoped value.
```

**This is a security control working, not a broken app**, and the command printed in `CLAUDE.md`,
`docs/DEPLOY.md`, `docs/GCP_DEPLOY.md` and `docs/admin-control-center/STATUS.md` has been stale
since the guard landed. Corrected in Phase 15.

Re-run after seeding `scripts/e2e-audit-fixture.ts` (additive and idempotent — zero `deleteMany`,
namespaced `pw-audit` / `@audit.test`, 9 users across 2 tenants) with a run-scoped password:

```
BASE_URL=http://localhost:3000 E2E_PASSWORD='<run-scoped>' \
  node node_modules/@playwright/test/cli.js test --project=audit
  → 176 passed (3.1m)   exit 0
```

Run against the **production build** (`next build` + `next start`), not `next dev`. 176/176 matches
the reviewed baseline exactly. It includes the surfaces these commits touch — tenant isolation,
cross-user IDOR between two SDRs sharing a campaign, cross-tenant write on the automation cap
route, client-report share links and exports, session revocation, and the admin removal/transfer
dialogs.

`chromium` and `demo` projects: **NOT EXECUTED** — the audit project was the priority given the
routes both commits touch.

---

## Phase 3 — Release candidate

| | |
| --- | --- |
| **Gated candidate SHA** | **`d00dcaa96be9032ab6f9fdbb6a6877b21f7c8aa4`** |
| Branch | `release/internal-cutover-2026-08-17` |
| Base moved during work? | **No** — `origin/main` re-fetched at freeze, still `1bb0336`. No rebase, no gate re-run needed. |
| Tag `internal-rc-2026-08-17` | **NOT CREATED** — branch not pushed; tagging and the image digest belong to an operator with push rights |
| Image digest | **UNKNOWN** — no Docker locally, no published image for this SHA |
| Pushed to origin? | **No** |

Every gate in the Phase 2 table was run against the tree at `d00dcaa`. The final verification pass
after the documentation commit reported lint exit 0, `tsc` exit 0, and Vitest exit 0 with
**1696 passed / 5 skipped / 0 failed** — unchanged, which matters because several suites assert on
repository documentation.

Commits, in order:

```
d00dcaa  docs: cutover runbook, evidence, migration inventory, six stale claims corrected
9f650a4  test(admin): give the import fixture the campaign membership it always needed
ff09dce  fix(security): validate the imported campaign before the batch exists
15d0885  fix(security): validate report-preview references before the metrics are built
fb6f40a  fix(ui,security): sidebar role during session load; dead font origins out of CSP
1bb0336  (origin/main)
```

Any commit made after `d00dcaa` — including one that records this SHA — is documentation only and
does not change the built artifact. Re-run the gates anyway before tagging if code is touched.

**A digest is mandatory before deploying.** `docker-compose.yml` declares `${CRM_IMAGE:?…}` with
no default so a tag cannot drift under a running deployment.

---

## Phases 4–7 — NOT EXECUTED

| Phase | Status | Blocker |
| --- | --- | --- |
| 4 · deployment audit | NOT EXECUTED | no SSH to `telestar-crm-vm` |
| 5 · HTTPS | NOT EXECUTED | no public URL reachable |
| 5 · demo credential rotation | NOT EXECUTED | no production database |
| 5 · secret freshness | NOT EXECUTED | no production environment |
| 5 · CSP | **report-only — unchanged, and not claimed otherwise** | — |
| 6 · backup + tested restore | NOT EXECUTED | no Cloud SQL access |
| 6 · `migrate deploy` on production | NOT EXECUTED | no production database |
| 7 · Redis / worker proof | NOT EXECUTED | Redis not installed; no managed instance |

Last recorded deployment state, from `docs/DEPLOY.md` — **over a week old and unverified**:
`telestar-crm-vm:/opt/crm-4-u`, Cloud SQL, last deployed `68acd49c` (2026-08-09), box resolves
`IMAGE_TAG` while the repo requires `CRM_IMAGE`, so `deploy.sh` / `rollback.sh` are inert there
and `deployments.ndjson` is not being written.

**There is therefore no verified single deploy command and no verified rollback command.** That
is a NO-GO condition under the release policy until Phase 4 closes it.

## Phase 8 — Migration inventory

Rebuilt from the current schema: [`MIGRATION_INVENTORY_2026-08-17.md`](MIGRATION_INVENTORY_2026-08-17.md).
62 models, 60 tenant-owned, load order, per-entity reconciliation columns, required exception-report
format, and the schema-specific traps. `docs/MIGRATION_RUNBOOK.md` marked superseded — its "23
database models" would have omitted ~39 models including `SequenceEnrollment` and `SuppressionEntry`.

**No source data was migrated or reconciled.** The Telestar source dataset was not available.

## Phases 9–14 — NOT EXECUTED

Rehearsal, production cutover, per-role smoke, golden journey, email acceptance and scheduler
verification all require the deployed environment. Procedures are in the runbook.
`tests/golden-journey.test.ts` passes in the suite above, which proves the chain in CI — not on a
deployment.

## Phase 15 — Documentation

| File | Correction |
| --- | --- |
| `README.md` | "Node.js 20+" → **24.18.0 / npm 11.16.0**, pinned; CI asserts the exact string |
| `CLAUDE.md` | E2E block rewritten — the documented `E2E_PASSWORD=telestar2026` command is refused by the harness |
| `docs/DEPLOY.md` | same correction at the post-deploy gate |
| `docs/MIGRATION_RUNBOOK.md` | superseded banner + "23 database models" → 62 |
| `docs/PRODUCTION_SMOKE_TEST.md` | described **EC2 + RDS**; actual deployment is a **GCP VM + Cloud SQL** |
| `docs/pre-domain-hardening/STATUS.md` | deploy-tooling drift marked still open and still unverified at this cutover |

Historical findings were marked superseded with links, never deleted.

**Email safety flags were already consistent** — `README.md`, `docs/MIGRATION_RUNBOOK.md` and
`docs/PRODUCTION_SMOKE_TEST.md` all specify `SEQUENCE_AUTOSEND_ENABLED=false` and
`EMAIL_SEND_DRY_RUN=true`. The contradiction the directive anticipated does not exist.

## Phase 16 — Repository

| PR | Action | Reason |
| --- | --- | --- |
| #44 create-user revokes sessions | **CLOSED** | Content already on `main` — `authVersion` increment, `--deactivate`, exported function, `tests/create-user.test.ts` all present and passing. GitHub reported `BEHIND`. |
| #63 dev environment | **left open** | Not superseded — `.nvmrc`, `.gitattributes`, `.env.example` and `scripts/doctor.mjs` are on `main`, but `scripts/with-env.mjs` and `docs/LOCAL_SETUP.example.md` are not. `DIRTY`/conflicting, dev tooling only. Post-cutover. |
| #58 Prisma 7 | **left open** | Directive: not in this release. Post-cutover workstream. |
| #57 TypeScript 7 | **left open** | Same. |

---

# FINAL ACCEPTANCE REPORT

```text
RELEASE SHA:        d00dcaa96be9032ab6f9fdbb6a6877b21f7c8aa4
                    branch release/internal-cutover-2026-08-17 — not tagged, not pushed
                    base 1bb033648d0c099df694e3f2e7b852f13df6212a (unmoved at freeze)
IMAGE/DIGEST:       UNKNOWN — not built (no Docker); no published image for this SHA
DEPLOYED AT:        NOT DEPLOYED
DATABASE:           local PostgreSQL 16 only; production Cloud SQL not accessed
REDIS:              NOT AVAILABLE in this environment
PUBLIC/INTERNAL URL: not reachable

CI:                 green on main (1bb0336); NOT RUN on the candidate SHA
Lint:               PASS — exit 0, 0 errors
TypeScript:         PASS — exit 0, 0 errors
Vitest:             PASS — exit 0, 1696 passed / 5 skipped / 0 failed
Playwright:         PASS — audit project exit 0, 176 passed (baseline 176/176), against a
                    production build; chromium and demo projects NOT EXECUTED
Build:              PASS — exit 0
Docker:             NOT EXECUTED — Docker not installed
Migration replay:   PASS — exit 0, "No difference detected" from empty, 46 migrations
RLS verification:   PASS — exit 0 (policies enforce isolation; production RLS state unknown)
Secret scan:        NOT EXECUTED locally — runs in CI
CodeQL:             NOT EXECUTED locally — runs in CI

MIGRATION:
Source records:     NONE — source dataset not available
Imported:           0
Updated:            0
Duplicates:         0
Rejected:           0
Unresolved:         0
Relational integrity: PASS on the local database — exit 0, no inconsistent references

INFRA:
HTTPS:              NOT VERIFIED
Backup:             NOT TAKEN
Restore procedure:  NOT TESTED
Web:                NOT VERIFIED on the deployment
Worker:             NOT VERIFIED
Redis:              NOT VERIFIED
Crons:              NOT VERIFIED
Health:             NOT VERIFIED
Logs:               NOT VERIFIED

SECURITY:
Demo credentials rotated: NO — not performed; no production database reached
Tenant isolation:   improved — two cross-tenant reference paths closed and regression-tested;
                    RLS policies verified locally
RBAC:               improved — preview role gate added; import campaign scope enforced
Reference integrity: both remaining known gaps CLOSED (Phase 1A, 1B)
CSP mode:           REPORT-ONLY — unchanged
Email safety:       autosend disabled and dry-run enabled in configuration; NOT verified on a deployment

ROLE SMOKE:
Director:           NOT EXECUTED
Floor Manager:      NOT EXECUTED
Team Lead:          NOT EXECUTED
SDR:                NOT EXECUTED
Leadgen Manager:    NOT EXECUTED
Leadgen:            NOT EXECUTED

GOLDEN JOURNEY:     NOT EXECUTED on a deployment
                    (tests/golden-journey.test.ts passes in the suite — CI evidence, not deployment evidence)

KNOWN DEBT:
1.  Sequence references in POST /api/leads/import are scoped by tenant but not by visibility.
    No canReferenceSequence helper exists and inventing one would be new policy, not reuse.
2.  CSP remains report-only.
3.  Redis is not available in this environment; durability and failover are unproven, and the
    production Redis topology is unknown.
4.  PR #63 (dev-environment unification) is partially landed and conflicting.
5.  Prisma 7 (#58) and TypeScript 7 (#57) deferred as a post-cutover workstream.
6.  docs/PRODUCTION_SMOKE_TEST.md still describes AWS topology; corrected by banner, not rewritten.

BLOCKERS:
1.  No deployment was performed, inspected, or verified — phases 4-7 and 9-14 had no access.
2.  No pre-cutover backup exists and no restore has been tested.
3.  No verified deploy command and no verified rollback command: the box's checkout resolves
    IMAGE_TAG while the repo requires CRM_IMAGE, last confirmed 2026-08-09 and unverified since.
4.  No production migration applied; no Telestar data migrated or reconciled.
5.  Demo credentials not rotated on any deployed database.
6.  HTTPS not verified from a client.
7.  No image digest exists for the candidate SHA, and CI has not run on it.
8.  check:test-discipline --ci cannot pass without REDIS_URL; must be green in CI on the
    release SHA.

FINAL VERDICT:
NO-GO — for deployment on 2026-08-17 as of this session.

The code is in good shape and the repository gates that could run here are green. The verdict is
NO-GO on infrastructure and data evidence that does not exist yet, not on code quality. Under the
directive's own policy, missing pre-cutover backup, untested rollback, no applied production
migration, unreconciled data, unrotated shared credentials and unverified HTTPS are each
independently mandatory NO-GO conditions. Six of the eight blockers above are in that list.

The honest reading: Phases 0-3, 8, 15 and 16 are DONE and evidenced. Phases 4-7 and 9-14 have not
started. This becomes a GO decision only after an operator with host access executes them and
records the results here.
```
