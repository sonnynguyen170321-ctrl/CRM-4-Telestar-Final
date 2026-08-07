# Pre-Domain Hardening — STATUS

> Resume pointer. Read this first, then execute the next unchecked task in
> [`PLAN.md`](./PLAN.md). Tick the box there and update this file when a task lands.

**Current phase:** Milestone A — Immediate safety
**Next task:** Task 2 — invalidate stale JWT sessions (`authVersion`)
**Blockers:** none for Milestone A. HTTPS/domain blocks nothing in this plan.

---

## 🔴 Found during Task 1 — the live Director password is published

`telestar2026` is the seeded password for **every** demo user, including `dean@telestar.vn`
(Director). It appears in `CLAUDE.md`, `app/login/page.tsx`, `docs/GCP_DEPLOY.md`,
`docs/CLOUD_RUN_DEPLOY.md` and the e2e specs as `E2E_PASSWORD` — 15 files in a repo whose
GHCR package pulls without authentication.

The live deployment at `http://34.142.236.46` was seeded with those exact credentials and
accepts them today. So the CRM's Director account, on a public IP, over plain HTTP, has a
password anyone can read from the repository.

Mitigating: it is a demo dataset, autosend is off, and the operating restrictions say no real
client data. Not mitigating: a Director can read every tenant's data, transfer work, and now
delete audit rows.

Task 1 stops the *repo* shipping a default going forward — `DEMO_SEED_PASSWORD` has no
default and a random one is generated when unset. It does **not** change what is already on
the live box, because the guard now correctly refuses to reseed a remote database.

**Fix on the box** — change the Director password in place, which needs no reseed:

```bash
npm run create-admin -- --email dean@telestar.vn --password '<new strong password>' --name 'Dean'
```

`create-admin` promotes and updates an existing user without deleting anything. Do the same
for any other account that will be used, or deactivate the unused demo users from `/admin`.

Sequencing note: Task 2 adds `authVersion`, at which point a password change also invalidates
every existing session. Doing that first makes this fix strictly stronger, which is one
argument for taking Task 2 next as planned.

---

## Where things stood when this plan was pinned (2026-08-05)

Live deployment `ee08246` on `http://34.142.236.46` — GCE + Cloud SQL + a `redis:7` container
on the same VM. Admin Control Center shipped. Gates at the time: `tsc` 0 · Vitest 536/536 ·
Playwright 20/20 · `next build` exit 0 · design audit 0 flags in every category.

Already true, so these tasks start from a better place than the plan assumes:

- **Task 4 (CI):** `.github/workflows/docker-image.yml` already builds and pushes on every
  `main` push, and `ci.yml` exists. What is missing is the *mandatory* part — required checks
  and branch protection — plus the Playwright/migration/Docker jobs.
- **Task 5 (immutable images):** CI already publishes `:sha-<7>` next to `:latest`. The tag
  exists; the task is to make it the deployed default and remove the mutable fallback.
  `.env.production` currently sets `IMAGE_TAG=latest`.
- **Task 10 (Redis):** BullMQ, `JobRun` mirroring and the maintenance worker are all in place
  from the runtime-hardening work. Queue *observability* and remote-TLS compatibility are the
  gap.
- **Crons** are installed and firing (`bin/cron-call.sh` on the VM, verified in syslog).
  `CRON_SECRET` was rotated 2026-08-05 after being exposed.

Explicitly blocked, tracked in `docs/DEPLOY.md` → "Open before real client data":

- **HTTPS / TLS.** Still plain HTTP on a bare IP; credentials cross in cleartext.
  `CRM_DOMAIN`, `CADDY_SITE_ADDRESS` and `NEXTAUTH_URL` are the only values needed.
- **Cloud SQL automated backups.** None scheduled; the only snapshot is manual.

---

## Task 1 — findings before starting

`prisma/seed.ts` is worse than `CLAUDE.md` described. Confirmed by reading it:

- **17 unguarded `deleteMany()`**, including `tenant` and `user`, with no environment check
  of any kind.
- It uses a bare `const raw = new PrismaClient()`, which **bypasses the tenant-scoping
  extension in `lib/prisma.ts` entirely** — so the deletes are not tenant-scoped even in
  principle.
- Hardcoded shared password `telestar2026` at `prisma/seed.ts:50`, applied to every seeded
  user. That string is also the demo login in `CLAUDE.md` and `E2E_PASSWORD` in the e2e specs.
- Real-looking `@telestar.vn` addresses for every persona.
- Wired into `package.json` as both `db:seed` **and** `prisma.seed`, so `prisma migrate dev`
  and `prisma migrate reset` invoke it automatically.

The `prisma.seed` wiring is the sharp edge: a routine `migrate dev` against a misconfigured
`DATABASE_URL` wipes the target database with no prompt.

---

## Progress log

- 2026-08-05 — Plan pinned from the pre-domain hardening brief. No code changed yet.

- 2026-08-05 — **Task 1 ✅** (`9908642`). `lib/seed-guard.ts` + 16 tests; `prisma/seed.ts` → `seed-demo.ts`; `prisma.seed` key removed from package.json so `migrate dev`/`reset` can no longer fire it; hardcoded password replaced by `DEMO_SEED_PASSWORD` with a random fallback. Verified by running: refused with no confirmation, on `NODE_ENV=production`, against the live Cloud SQL IP, and against `localhost/telestar_crm`; succeeded against a scratch `telestar_crm_dev`. Vitest 552/552.

- 2026-08-06 — **Task 2 in progress** (`f379cb2` on `fix/session-revocation`, pushed, **not merged**).
  Implementation complete and typechecking clean: `User.authVersion` + migration
  `20260806100000`, token stamping in `auth.ts`/`auth.config.ts`, database revalidation in
  `getSessionUser` (cached per request, run inside a `tenantStorage` bypass to avoid recursing
  through `getTenantIdFromSession`), increments on password change / admin reset / role change /
  deactivate / reactivate, and `POST /api/admin/users/[id]/sign-out-all`. 13 new tests pass.

  **Blocking merge:** 26 tests across `access-control`, `admin`, `admin-audit`,
  `email-health-access` and `leadgen-redesign` now return **401 where they assert 403**. That is
  the fix working — they mock `auth()` with synthetic users that have no database row, so the
  request is rejected as unauthenticated before reaching the role check. They encode the old
  contract in which the token was trusted.

  Two ways to fix each, both legitimate:
  1. Seed a real `User` row matching the mocked session id (keeps them as integration tests and
     keeps exercising revalidation).
  2. Mock `@/lib/auth`'s `getSessionUser` instead of `@/auth`'s `auth()` (keeps them as pure
     unit tests of route authorization; revalidation is already covered by
     `tests/session-revocation.test.ts`).

  Option 2 is cheaper and probably right for `access-control` and `leadgen-redesign`, which are
  pure authorization matrices. `admin.test.ts` already seeds users, so option 1 fits there.

  Still outstanding for Task 2 after that: a "Sign out all sessions" control in the `/admin`
  UI (the endpoint exists, nothing calls it), and the manual verification pass from PLAN.md.
