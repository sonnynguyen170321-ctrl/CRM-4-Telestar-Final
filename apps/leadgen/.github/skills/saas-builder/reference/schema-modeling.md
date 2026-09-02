# Schema Modeling

Reference implementation: **TeleStar V2** — `prisma/schema.prisma`, `prisma.config.ts`,
`prisma/migrations/` (54 migrations at last count). Read those; this guide is the shape.

## Driver-adapter datasource (Prisma 7)

The datasource declares **only the provider — no `url`**:

```prisma
datasource db {
  provider = "postgresql"
}
```

The connection is supplied by a **driver adapter** at runtime (see `tenant-spine.md` →
`lib/server/prisma.ts` uses `PrismaPg`). The migrate CLI gets the URL from `prisma.config.ts`:

```ts
// prisma.config.ts — read process.env DIRECTLY, not prisma's env() helper.
// env() only parses a dotenv .env FILE; in containers/CI the URL is injected via
// env_file / -e and is invisible to it → "datasource.url required" at migrate time.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
```

This is a **paid-for gotcha** — the migrate step fails cryptically otherwise.

## Tenant-scoped model shape

Every model a tenant owns carries the tenant FK, a uniqueness scoped **within** the tenant, and an
index on the tenant column. Pattern from `V2OrganizationMembership` / project models:

```prisma
model Project {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  status         Status   @default(ACTIVE)
  deletedAt      DateTime?          // soft-delete — see invariants #8
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)

  @@unique([organizationId, name])   // unique WITHIN the tenant, not globally
  @@index([organizationId])          // every tenant-scoped read filters on this
  @@index([status])
  @@index([createdAt])
}
```

Rules:
- **`onDelete: Restrict`** on tenant FKs — never let a cascade silently wipe a tenant's data.
- **`@@unique([organizationId, ...])`** — scope uniqueness to the tenant; a name unique globally is
  a cross-tenant leak of existence.
- **`deletedAt DateTime?`** on anything deletable; reads filter `deletedAt: null` (invariant #8).
- Index the tenant column and anything you sort/filter lists by (`status`, `createdAt`).

## Immutable / audit models

Where history matters (assessments, scores, state transitions), **never update in place**. Insert a
new row and move a `latest…Id` pointer in the **same transaction**. This is invariant #4 — see how
TeleStar keeps `HardRuleAssessment` immutable and moves `latestHardRuleAssessmentId`.

## Enums for state

Model status/qualification as enums, not free strings. Keep workflow status (mutable) separate from
qualification/outcome (immutable) — never derive one blindly from the other (invariant #3).

## Migrations

- One migration per schema change; name it for the change.
- `prisma migrate deploy` runs **before** any web/worker serves traffic (the one-shot `migrate`
  service in `deploy-ec2.md`).
- A `schema` session's exit-gate = "migration applies clean on a fresh DB."

## Session fit

Schema work is a `schema` change-kind session. It may travel with the `read-model` that needs the
new columns (the one allowed pairing). It produces: the new models/enums + the migration — which the
next `read-model` / `api` sessions consume.
