---
paths:
  - prisma/**
  - lib/prisma.ts
  - supabase/**
  - scripts/check-migration-order.mjs
  - scripts/check-relational-integrity.*
domain: data-prisma
risk: R3
---

# Schema, migrations, and the seed

## Migrations sort by name, not by dependency

Prisma stamps a migration with generation time, not dependency position. On a branch whose
earlier migrations carry dates ahead of the wall clock, a newly generated migration sorts
*before* the tables it alters. It then applies fine to your database — which already has those
tables — and `migrate status` stays green.

**Only a replay from empty sees it.** This has happened four times. Always check a generated
migration's name against the tail of `prisma/migrations/` before applying it.

```bash
npm run check:migration-order        # ~1s, catches a mis-sorted new migration
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5432/telestar_shadow" --exit-code
```

`check:migration-order` is a **speed** gate only. `migrate diff` from an empty shadow database
is the correctness authority — a migration can sort correctly and still be wrong.

## A migration-only index or constraint is not acceptable

Unless the datamodel represents the same final schema, it survives only until someone
regenerates a migration from the schema, then vanishes silently.

## RLS is not in the migrations

Prisma migrations deliberately contain no `ENABLE` / `FORCE` / `CREATE POLICY`. RLS-enabled
deployments must reapply `supabase/rls.sql` after any migration that adds a tenant-owned
table. `npm run verify:rls` checks coverage.

## The demo seed is destructive and guarded — keep it that way

`prisma/seed-demo.ts` issues 17 unfiltered `deleteMany()` calls including `tenant` and `user`,
through a bare `new PrismaClient()` that bypasses the tenant-scoping extension. Pointed at the
wrong `DATABASE_URL` it empties that database.

Two protections exist and neither may be removed:

- `lib/seed-guard.ts` refuses to run it anywhere it could destroy real data.
- `package.json` deliberately has **no** `prisma.seed` key. Restoring it makes
  `prisma migrate dev` and `migrate reset` invoke the destructive seed automatically, with no
  prompt. The absence is documented in place by `_prisma_seed_removed`.

Never point `migrate reset` or the seed at a deployed database.

## Tenancy

Every query is tenant-scoped. `lib/prisma.ts` extends the client to enforce it; a bare
`new PrismaClient()` opts out of that enforcement and needs a specific, reviewed reason.

Note the `$extends` wrappers defeat array batching, and the HTTP driver has no interactive
transactions — so some services are deliberately idempotent-resumable rather than
transactional. `lib/admin/transferWork.ts` is the documented example. Do not "fix" it by
wrapping it in `$transaction`; that would look atomic without being atomic.
