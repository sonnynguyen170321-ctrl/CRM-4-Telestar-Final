---
id: L004
domain: data-prisma
severity: critical
protection: automated
---

# L004 — A migration that applies cleanly and replays broken

**Symptom.** Four times, a newly generated migration sorted *before* the tables it altered.
Each time it applied without error, `migrate status` stayed green, and the defect was invisible
until a replay from an empty database.

**Root cause.** Prisma names a migration with the wall-clock time of generation. Migrations
apply in name order. On a branch whose earlier migrations carry dates ahead of the current
clock — which happens whenever a branch is authored with a future-dated timestamp, or a machine
clock differs — a new migration sorts into the middle of history rather than at the end.

It applies fine *on your machine* because your database already has the tables it alters. Order
only matters when starting from nothing.

**Why it deceives.** Every local signal is green. `migrate dev` succeeds, `migrate status`
reports no drift, the app runs. The failing case is the one nobody runs locally: a fresh
database, which is exactly what a new environment, a CI shadow database and a disaster recovery
restore all are.

Four occurrences: `work_order_phase6a`, `work_order_lease_fencing`, `agent_execution_phase6b`,
all renamed to `202608110[123]0000`.

**Permanent protection.**

```bash
npm run check:migration-order    # ~1s — fails when a new migration sorts before the tail
```

That is a **speed** gate only. The correctness authority is a replay from empty:

```bash
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "...telestar_shadow" --exit-code
```

A migration can sort correctly and still be wrong; only the replay sees that.

**Where it applies.** Every generated migration. Read its name against the tail of
`prisma/migrations/` before applying it — the check is fast, but reading the filename is faster.

**Related.** A migration-only index or constraint has the same shape of invisibility: it works
until someone regenerates from the schema, then vanishes silently. Never add one unless the
datamodel expresses the same final schema.

- Related source: `scripts/check-migration-order.mjs`
- Related test: `tests/migration-order.test.ts`
