-- ============================================================================
-- Telestar SDR CRM — database roles for RLS
-- ============================================================================
-- Apply AFTER supabase/rls.sql, against the production database:
--     psql "$DIRECT_URL" -f supabase/roles.sql
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- ---------------------------------------------------------------------------
-- Row-level security does not apply to superusers. At all. `FORCE ROW LEVEL SECURITY`
-- closes the *table owner* loophole, but a superuser bypasses every policy regardless,
-- and no amount of policy authoring changes that.
--
-- Measured 2026-08-08 on a local database with rls.sql applied to all 41 tenant-owned
-- tables: `SELECT count(*) FROM "User"` connected as `postgres` still returned every
-- row. The policies were correct; the connection was privileged. Applying rls.sql and
-- then connecting as a superuser produces a system that looks isolated and is not.
--
-- So the application role below is deliberately NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
-- and is NOT the owner of the tables it reads. Separating it from the migration role is
-- what makes that possible: migrations need DDL, the application does not.
--
-- ---------------------------------------------------------------------------
-- THE ROLES
-- ---------------------------------------------------------------------------
--   crm_migrator   owns the schema; runs `prisma migrate deploy`. DDL only.
--   crm_app        the application and workers. DML only, RLS enforced.
--   crm_maintenance  approved cross-tenant maintenance. RLS enforced, but permitted to
--                    set app.bypass_rls — which is an audited, deliberate act.
--
-- `crm_app` must NOT be able to set app.bypass_rls to 'true' and read across tenants.
-- Postgres has no per-GUC permission for custom settings, so the separation is by
-- connection string: the application's DATABASE_URL uses crm_app, and nothing in the
-- request path calls set_config with a bypass. `lib/prisma.ts` only sets bypass on the
-- worker/seed path, which should use crm_maintenance.
-- ============================================================================

-- Replace these before running. Generate with: openssl rand -base64 32
\set app_password         'REPLACE_ME_APP'
\set migrator_password    'REPLACE_ME_MIGRATOR'
\set maintenance_password 'REPLACE_ME_MAINTENANCE'

-- ── Roles ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_migrator') THEN
    CREATE ROLE crm_migrator LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_maintenance') THEN
    CREATE ROLE crm_maintenance LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;
  END IF;
END
$$;

ALTER ROLE crm_migrator    WITH PASSWORD :'migrator_password';
ALTER ROLE crm_app         WITH PASSWORD :'app_password';
ALTER ROLE crm_maintenance WITH PASSWORD :'maintenance_password';

-- ── Privileges ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO crm_app, crm_maintenance, crm_migrator;

-- The application gets DML only. No DDL, so it can never drop a policy it dislikes.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app, crm_maintenance;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app, crm_maintenance;

-- Tables created by future migrations must inherit the same grants, or a new model
-- silently becomes unreadable by the app and someone "fixes" it with a superuser DSN.
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app, crm_maintenance;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app, crm_maintenance;

-- Explicitly withhold DDL from the application roles.
REVOKE CREATE ON SCHEMA public FROM crm_app, crm_maintenance;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Neither application role may be superuser; if either is, RLS is decorative.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(rolname, ', ') INTO bad
  FROM pg_roles
  WHERE rolname IN ('crm_app', 'crm_maintenance') AND rolsuper;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Role(s) % are superusers — row-level security would not apply to them.', bad;
  END IF;
END
$$;

-- Expected: rolsuper false for crm_app and crm_maintenance.
--   SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
--   FROM pg_roles WHERE rolname LIKE 'crm_%';
