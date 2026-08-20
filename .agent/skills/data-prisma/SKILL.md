---
id: data-prisma
version: 1.0.0
domain: data-prisma
risk: R3
sources: [prisma/**, lib/prisma.ts, supabase/**]
---

# Schema, migrations, RLS

**LOAD WHEN** changing the schema, writing a migration, touching RLS policy, altering the
seed, or reasoning about transaction semantics.

**DO NOT LOAD WHEN** writing an ordinary query through an existing service.

A migration escalates the change to **R4** regardless of what else it touches: it is not
locally recoverable once applied to a real database.

## Core invariants

- **Tenant scoping is enforced by the client extension in `lib/prisma.ts`.** Bypassing it is a
  reviewed decision, not a convenience.
- **RLS is deliberately absent from migrations.** Prisma migrations contain no `ENABLE`,
  `FORCE` or `CREATE POLICY`. Reapply `supabase/rls.sql` after any migration that adds a
  tenant-owned table, and run `npm run verify:rls`.
- **The datamodel and the migrations describe the same final schema.** A migration-only index
  or constraint survives only until someone regenerates from the schema, then vanishes
  silently.

## Known failure modes

**Migrations sort by name, not by dependency.** Prisma stamps a migration with generation
time. On a branch whose earlier migrations carry future-dated names, a new one sorts *before*
the tables it alters. It applies fine locally — your database already has those tables — and
`migrate status` stays green. **Only a replay from empty sees it.** This has happened four
times.

```bash
npm run check:migration-order    # ~1s, speed gate only
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "...telestar_shadow" --exit-code   # the correctness authority
```

Always read a generated migration's name against the tail of `prisma/migrations/` before
applying it.

**The demo seed is destructive.** `prisma/seed-demo.ts` issues 17 unfiltered `deleteMany()`
calls including `tenant` and `user`, through a bare client that bypasses tenant scoping.
Pointed at the wrong `DATABASE_URL` it empties that database. Two protections exist and
neither may be removed: `lib/seed-guard.ts`, and the deliberate **absence** of a `prisma.seed`
key in `package.json` — restoring it makes `migrate dev` and `migrate reset` invoke the seed
automatically with no prompt.

**No interactive transactions on the HTTP driver.** Single-statement compare-and-set is fine;
multi-step atomic work needs the direct TCP connection. Some services are deliberately
idempotent-resumable instead — `lib/admin/transferWork.ts` is the documented case. Wrapping it
in `$transaction` would look atomic without being atomic, because the `lib/prisma.ts`
extensions defeat array batching.

**`@updatedAt` on bulk writes** and **`findFirstOrThrow` against soft-deleted rows** are the
two ORM traps that read as data loss and are not.

## Required tests

```
tests/migration-order.test.ts    tests/migration-status.test.ts
tests/rls-policy-coverage.test.ts  tests/rls.test.ts
tests/seed-guard.test.ts         tests/*reference-integrity.test.ts
npm run check:relational-integrity   npm run verify:rls
```

## Eval cases

- a fresh environment fails to migrate while CI is green → migration ordering, R4
- a tenant sees another tenant's rows after a new table lands → RLS reapplication, R4
- a developer's database empties after `migrate reset` → seed guard, R4
