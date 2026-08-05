# Pre-Domain Hardening — STATUS

> Resume pointer. Read this first, then execute the next unchecked task in
> [`PLAN.md`](./PLAN.md). Tick the box there and update this file when a task lands.

**Current phase:** Milestone A — Immediate safety
**Next task:** Task 1 — protect the database seed
**Blockers:** none for Milestone A. HTTPS/domain blocks nothing in this plan.

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
