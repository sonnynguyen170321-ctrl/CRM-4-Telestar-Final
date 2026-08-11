-- ============================================================================
-- Telestar SDR CRM — Row-Level Security (production / Supabase)
-- ============================================================================
-- This is the DATABASE-level enforcement layer that mirrors the application-level
-- tenant isolation already done in lib/prisma.ts (the Prisma `$allOperations`
-- extension). The app sets two per-transaction GUCs before every query:
--
--     set_config('app.current_tenant_id', <tenantId>, true)
--     set_config('app.bypass_rls', 'true' | 'false', true)
--
-- The policy below reads those exact settings, so the two layers stay in lockstep:
-- a row is visible/writable only when its `tenantId` matches the active tenant, OR
-- the connection has explicitly opted into a bypass (used by seed/maintenance
-- scripts, which run with app.bypass_rls = 'true').
--
-- FORCE ROW LEVEL SECURITY is required because the app connects as the table owner,
-- and owners bypass RLS by default. With FORCE, the policy applies to the owner too;
-- privileged scripts still work via the bypass GUC.
--
-- Apply (against the production / Supabase DB, using the DIRECT_URL):
--     psql "$DIRECT_URL" -f supabase/rls.sql
-- Re-running is safe — it is idempotent (drops + recreates each policy).
--
-- REAPPLY THIS AFTER EVERY MIGRATION THAT ADDS A TABLE. Prisma migrations carry no RLS
-- statements on purpose: a policy authored inside a migration vanishes as soon as that
-- migration is regenerated from the datamodel, and would break deployments that do not run
-- RLS. Until this file is reapplied, a newly migrated table has no database-level policy.
-- See docs/DEPLOY.md §9.
--
-- ---------------------------------------------------------------------------
-- WHY THE TABLE LIST IS A QUERY AND NOT AN ARRAY
-- ---------------------------------------------------------------------------
-- This file used to hardcode the table names. By 2026-08-08 the schema had 41
-- tenant-owned models and the array listed 24, so seventeen tables — including
-- Opportunity, Meeting, Contact, Attachment and every ClientReport* table — had no
-- database-level policy at all. `docs/opportunity-pipeline/PLAN.md` had already
-- noticed the array was stale and deferred fixing it, which is exactly what a
-- hardcoded list invites.
--
-- The set of tenant-owned tables is derivable: it is every table carrying a
-- `tenantId` column. Deriving it means adding a model can no longer silently opt
-- that model out of isolation. `tests/rls-policy-coverage.test.ts` applies this file
-- and then asserts the coverage independently, so a regression fails the build
-- rather than waiting to be noticed.
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
  applied INT := 0;
BEGIN
  FOR tbl IN
    -- Every ordinary table in `public` with a live `tenantId` column. Prisma uses the
    -- default mapping, so physical names are the quoted PascalCase model names.
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenantId'
      AND NOT a.attisdropped
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.bypass_rls', true) = 'true'
          OR "tenantId" = current_setting('app.current_tenant_id', true)
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'true'
          OR "tenantId" = current_setting('app.current_tenant_id', true)
        );
    $p$, tbl);
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'tenant_isolation applied to % table(s)', applied;

  -- Fail loudly rather than silently protecting nothing. Zero tables means the schema
  -- has not been migrated into this database yet, and a "successful" run here would
  -- read as "RLS is on".
  IF applied = 0 THEN
    RAISE EXCEPTION 'No tables with a tenantId column found — run migrations before applying RLS.';
  END IF;
END
$$;

-- Verify: every tenant-owned table should appear with rowsecurity and forced true,
-- and exactly one policy named tenant_isolation.
--
--   SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--          (SELECT count(*) FROM pg_policy p
--             WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   JOIN pg_attribute a ON a.attrelid = c.oid
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND a.attname = 'tenantId' AND NOT a.attisdropped
--   ORDER BY c.relname;
