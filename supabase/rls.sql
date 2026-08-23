-- ============================================================================
-- Telestar SDR CRM — Row-Level Security (production / Supabase)
-- ============================================================================
-- This is the DATABASE-level enforcement layer that mirrors the application-level
-- tenant isolation already done in lib/prisma.ts (the Prisma `$allOperations`
-- extension). The app sets a per-transaction GUC before every query:
--
--     set_config('app.current_tenant_id', <tenantId>, true)
--
-- Apply AFTER supabase/roles.sql — the policies below are targeted at the roles that
-- file creates, so they cannot be created before it has run:
--     psql "$DIRECT_URL" -f supabase/roles.sql
--     psql "$DIRECT_URL" -f supabase/rls.sql
-- Re-running is safe — it is idempotent (drops + recreates each policy).
--
-- FORCE ROW LEVEL SECURITY is required because the table owner would otherwise bypass
-- the policy. It does NOT close the superuser loophole: nothing can. See roles.sql.
--
-- REAPPLY THIS AFTER EVERY MIGRATION THAT ADDS A TABLE. Prisma migrations carry no RLS
-- statements on purpose: a policy authored inside a migration vanishes as soon as that
-- migration is regenerated from the datamodel, and would break deployments that do not run
-- RLS. Until this file is reapplied, a newly migrated table has no database-level policy.
-- See docs/DEPLOY.md §9.
--
-- ---------------------------------------------------------------------------
-- WHY THE POLICIES ARE PER-ROLE AND NOT ONE POLICY WITH AN `OR bypass`
-- ---------------------------------------------------------------------------
-- This file used to grant every role a single policy:
--
--     USING (current_setting('app.bypass_rls', true) = 'true'
--            OR "tenantId" = current_setting('app.current_tenant_id', true))
--
-- It was correct and it was unusable. The first branch references no column, so
-- PostgreSQL cannot turn the predicate into an index condition and must evaluate it row
-- by row. Measured 2026-08-23 against the development database, 417,472 leads, the same
-- query for 1,000 rows of one tenant:
--
--     "tenantId" = current_setting(...)          Bitmap Index Scan        10 ms
--     bypass OR "tenantId" = current_setting()   Parallel Seq Scan       145 ms warm
--                                                138,805 rows discarded  1296 ms cold
--
-- Every `tenantId` index on every tenant-owned table became dead weight the moment RLS
-- was enforced. That is not a tuning problem to revisit later; it is the difference
-- between an index scan and a full table scan on every query the product makes.
--
-- Splitting the bypass into its own role-targeted policy fixes it: only policies whose
-- `TO` matches the current role are applied, so `crm_app` is left with a single,
-- indexable predicate and the planner uses the index again.
--
-- It also closes a hole roles.sql could only describe. That file notes `crm_app` must not
-- be able to set `app.bypass_rls` and read across tenants, and that "Postgres has no
-- per-GUC permission for custom settings, so the separation is by connection string" —
-- an honest admission that nothing enforced it. Now nothing needs to: `crm_app` has no
-- policy that consults the bypass, so setting the GUC does nothing at all. The privilege
-- lives in which role you connect as, which is enforced by the database.
--
-- WHAT THIS REQUIRES OF THE APPLICATION: anything that legitimately reads across tenants
-- must connect as `crm_maintenance`, not `crm_app`. That is the worker/seed/script path
-- and the public share-link lookup in lib/client-reports/shareLinks.ts, which answers
-- with no session and therefore no tenant. Under `crm_app` those now return zero rows —
-- silently, as always. `npm run verify:rls-app-paths` and `verify-rls-live` are what keep
-- that honest.
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

-- Deliberately ONE statement. `verify-rls.mjs`, `verify-rls-app-paths.mjs` and
-- `rls-policy-coverage.test.ts` all apply this file whole, because `$executeRawUnsafe`
-- refuses multi-statement strings — so the role guard below lives inside the same DO block
-- rather than in one of its own.
DO $$
DECLARE
  tbl TEXT;
  applied INT := 0;
  missing TEXT;
BEGIN
  -- The policies name these roles, so they must already exist. Failing here with a clear
  -- message beats failing per-table with "role crm_app does not exist" forty times.
  SELECT string_agg(r, ', ') INTO missing
  FROM unnest(ARRAY['crm_app', 'crm_maintenance']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Role(s) % do not exist. Apply supabase/roles.sql first — the policies are targeted at them.',
      missing;
  END IF;

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
    EXECUTE format('DROP POLICY IF EXISTS maintenance_bypass ON %I;', tbl);

    -- The application. One predicate, on an indexed column, and no mention of the
    -- bypass — so this role cannot grant itself one.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        TO crm_app
        USING ("tenantId" = current_setting('app.current_tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
    $p$, tbl);

    -- Approved cross-tenant maintenance: workers, seeds, scripts, and the public
    -- share-link lookup. Deliberately a separate ROLE rather than a flag the
    -- application could set for itself.
    EXECUTE format($p$
      CREATE POLICY maintenance_bypass ON %I
        TO crm_maintenance
        USING (true)
        WITH CHECK (true);
    $p$, tbl);

    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'tenant_isolation + maintenance_bypass applied to % table(s)', applied;

  -- Fail loudly rather than silently protecting nothing. Zero tables means the schema
  -- has not been migrated into this database yet, and a "successful" run here would
  -- read as "RLS is on".
  IF applied = 0 THEN
    RAISE EXCEPTION 'No tables with a tenantId column found — run migrations before applying RLS.';
  END IF;
END
$$;

-- Verify: every tenant-owned table should appear with rowsecurity and forced true, and
-- exactly two policies — tenant_isolation (crm_app) and maintenance_bypass (crm_maintenance).
--
--   SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
--          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   JOIN pg_attribute a ON a.attrelid = c.oid
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND a.attname = 'tenantId' AND NOT a.attisdropped
--   ORDER BY c.relname;
