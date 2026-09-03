-- Identity phase 3: make the canonical domain the key.
--
-- NOT in prisma/migrations/ on purpose. `scripts/deploy.sh` runs `prisma migrate deploy` before it
-- swaps the containers, so a unique index committed while production still holds duplicate accounts
-- does not fail in review — it aborts the release. This lands in prisma/migrations/ in a follow-up,
-- once `npm run backfill:account-identity -- --verify` comes back clean against production.
--
-- Order: snapshot -> --dry-run --csv -> owner approves -> --apply -> --verify -> this file.

DO $$
DECLARE
  conflicts INT;
BEGIN
  SELECT COUNT(*) INTO conflicts FROM (
    SELECT "tenantId", "canonicalDomain"
    FROM "Account"
    WHERE "canonicalDomain" IS NOT NULL
    GROUP BY "tenantId", "canonicalDomain"
    HAVING COUNT(*) > 1
  ) duplicated;

  IF conflicts > 0 THEN
    RAISE EXCEPTION
      'Refusing to add the unique index: % tenant/domain pairs still have more than one Account. Run the phase 2 backfill with --apply first.',
      conflicts;
  END IF;
END $$;

-- Partial, because an Account without a website is not a duplicate of every other one. Postgres
-- already treats NULLs as distinct in a unique index; the WHERE clause makes that explicit and keeps
-- the index to the rows it actually covers.
CREATE UNIQUE INDEX IF NOT EXISTS "Account_tenantId_canonicalDomain_key"
  ON "Account" ("tenantId", "canonicalDomain")
  WHERE "canonicalDomain" IS NOT NULL;

-- `@@unique([tenantId, name])` stays for now. It is what the raw-name lookup in resolveAccount still
-- falls back to, and dropping it is a separate decision from adding this one.
